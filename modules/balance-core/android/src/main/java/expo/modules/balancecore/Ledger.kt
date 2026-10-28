package expo.modules.balancecore

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import java.util.UUID
import java.util.concurrent.Executors

internal data class RawNotification(
  val pkg: String,
  val title: String?,
  val body: String,
  val postedAt: Long,
)

/** Turns raw notifications into transactions. All writes go through one background thread. */
internal object Ledger {
  // Same amount, opposite direction, two different apps within this window = money moved between your own accounts.
  private const val TRANSFER_PAIR_WINDOW_MS = 15 * 60 * 1000L
  // An "ad or other" verdict this sure is put away without asking.
  private const val AD_DISMISS_CONFIDENCE = 0.8
  private const val MAX_AI_ATTEMPTS = 3

  private val writer = Executors.newSingleThreadExecutor { Thread(it, "balance-ledger") }

  fun ingestAsync(context: Context, notifications: List<RawNotification>) {
    val appContext = context.applicationContext
    writer.execute {
      val changed = ingest(appContext, notifications)
      if (changed) onChanged(appContext)
    }
  }

  /** Runs [block] on the writer thread and waits, so JS mutations never race the listener. */
  fun <T> write(context: Context, block: (BalanceDb) -> T): T {
    // Resolved on the writer thread, so a sign-in or sign-out queued earlier has already landed.
    val result = writer.submit<T> { block(BalanceDb.get(context)) }.get()
    onChanged(context.applicationContext)
    return result
  }

  private fun ingest(context: Context, notifications: List<RawNotification>): Boolean {
    if (Account.userId(context) == null) return false // No account or local mode chosen yet: nobody to log it for.
    val db = BalanceDb.get(context)
    val watched = db.watchedPackages()
    var changed = false
    for (n in notifications) {
      if (n.pkg !in watched || n.body.isBlank()) continue
      val rawId = db.writableDatabase.insertWithOnConflict(
        "raw_notifications",
        null,
        ContentValues().apply {
          put("uid", UUID.randomUUID().toString())
          put("package", n.pkg)
          put("title", n.title)
          put("body", n.body)
          put("posted_at", n.postedAt)
        },
        SQLiteDatabase.CONFLICT_IGNORE
      )
      if (rawId == -1L) continue // Already stored (re-posted or backfilled twice).
      process(db, rawId, n)
      // Live only: a bulk re-read or import must not ping for old notifications.
      ReviewNotifier.notifyOpen(context, db, rawId, recentOnly = false)
      changed = true
    }
    if (changed) AiReview.kick(context)
    return changed
  }

  private fun process(db: BalanceDb, rawId: Long, n: RawNotification) {
    val sqlite = db.writableDatabase
    // A decision the user already made on an AI suggestion wins over any rule.
    val decided = review(sqlite, rawId)
    if (decided?.state == "confirmed") {
      insertReviewed(db, rawId, n, decided)
      setStatus(sqlite, rawId, "parsed")
      return
    }
    if (decided?.state == "rejected" || decided?.state == "dismissed") {
      setStatus(sqlite, rawId, "ignored")
      return
    }

    val ai = db.aiEnabled()
    // Apps the user picked have no bank-specific rules; with AI on they skip the keyword guess.
    val result = Parsers.parse(n.pkg, n.title, n.body, generic = !(ai && n.pkg !in Settings.DEFAULT_PACKAGES))
    val status = when {
      result is ParseResult.Transaction -> {
        insertTransaction(db, rawId, n, result.tx)
        "parsed"
      }
      ai && Prefilter.isCandidate(n.title, n.body) -> {
        sqlite.execSQL(
          "INSERT OR IGNORE INTO ai_reviews (raw_id, state, updated_at) VALUES (?, 'pending', ?)",
          arrayOf<Any>(rawId, System.currentTimeMillis())
        )
        "unparsed"
      }
      result == ParseResult.Unparsed -> "unparsed"
      else -> "ignored"
    }
    setStatus(sqlite, rawId, status)
  }

  private fun setStatus(sqlite: SQLiteDatabase, rawId: Long, status: String) {
    sqlite.execSQL("UPDATE raw_notifications SET status = ? WHERE id = ?", arrayOf<Any>(status, rawId))
  }

  private class Review(
    val state: String,
    val kind: String?,
    val direction: String?,
    val amount: Long?,
    val counterparty: String?,
  )

  private fun review(sqlite: SQLiteDatabase, rawId: Long): Review? =
    sqlite.rawQuery(
      "SELECT state, kind, direction, amount, counterparty FROM ai_reviews WHERE raw_id = ?",
      arrayOf(rawId.toString())
    ).use { c ->
      if (!c.moveToFirst()) null
      else Review(c.getString(0), c.getString(1), c.getString(2), if (c.isNull(3)) null else c.getLong(3), c.getString(4))
    }

  private fun insertReviewed(db: BalanceDb, rawId: Long, n: RawNotification, r: Review) {
    val direction = if (r.direction == "in") Direction.IN else Direction.OUT
    val tx = ParsedTransaction(direction, r.amount ?: 0L, r.counterparty?.takeIf { it.isNotBlank() })
    val txId = insertTransaction(db, rawId, n, tx)
    if (r.kind == "transfer") {
      db.writableDatabase.execSQL("UPDATE transactions SET is_transfer = 1, transfer_locked = 1 WHERE id = ?", arrayOf<Any>(txId))
    }
  }

  // ---- AI review (cloud mode). Called from the module and the AI worker, on the writer thread. ----

  /** Turns AI review on or off and re-reads everything, so picked apps switch between AI and the keyword guess. */
  fun setAiEnabled(db: BalanceDb, on: Boolean) {
    db.setSetting(Settings.AI_REVIEW, if (on) "1" else "0")
    reprocessAll(db)
  }

  /** Stores what the model thinks. A confident "ad or other" is put away without asking. */
  fun suggest(db: BalanceDb, rawId: Long, kind: String, direction: String, amount: Long, counterparty: String?, confidence: Double) {
    val sqlite = db.writableDatabase
    val current = review(sqlite, rawId) ?: return
    if (current.state != "pending" && current.state != "failed") return // The user got there first.
    val dismiss = kind == "ad_or_other" && confidence >= AD_DISMISS_CONFIDENCE
    sqlite.execSQL(
      """
      UPDATE ai_reviews SET state = ?, kind = ?, direction = ?, amount = ?, counterparty = ?, confidence = ?, updated_at = ?
      WHERE raw_id = ?
      """,
      arrayOf<Any?>(if (dismiss) "dismissed" else "suggested", kind, direction, amount, counterparty, confidence, System.currentTimeMillis(), rawId)
    )
    if (dismiss) setStatus(sqlite, rawId, "ignored")
  }

  /** The function answered but had nothing for this one. After a few tries it waits for the user. */
  fun reviewFailed(db: BalanceDb, rawId: Long) {
    db.writableDatabase.execSQL(
      """
      UPDATE ai_reviews SET attempts = attempts + 1,
        state = CASE WHEN attempts + 1 >= ? THEN 'failed' ELSE state END, updated_at = ?
      WHERE raw_id = ? AND state = 'pending'
      """,
      arrayOf<Any>(MAX_AI_ATTEMPTS, System.currentTimeMillis(), rawId)
    )
  }

  /**
   * The user's answer. "ad_or_other" means not a transaction; anything else becomes a normal
   * transaction with exactly these values.
   */
  fun resolve(db: BalanceDb, rawId: Long, kind: String, direction: String, amount: Long, counterparty: String?) {
    val sqlite = db.writableDatabase
    val n = sqlite.rawQuery("SELECT package, title, body, posted_at FROM raw_notifications WHERE id = ?", arrayOf(rawId.toString())).use { c ->
      if (c.moveToFirst()) RawNotification(c.getString(0), c.getString(1), c.getString(2), c.getLong(3)) else null
    } ?: return
    val rejected = kind == "ad_or_other"
    sqlite.beginTransaction()
    try {
      // No UPSERT: older Android releases ship SQLite without ON CONFLICT DO UPDATE.
      sqlite.execSQL("INSERT OR IGNORE INTO ai_reviews (raw_id) VALUES (?)", arrayOf<Any>(rawId))
      sqlite.execSQL(
        "UPDATE ai_reviews SET state = ?, kind = ?, direction = ?, amount = ?, counterparty = ?, updated_at = ? WHERE raw_id = ?",
        arrayOf<Any?>(if (rejected) "rejected" else "confirmed", kind, direction, amount, counterparty, System.currentTimeMillis(), rawId)
      )
      sqlite.execSQL("DELETE FROM transactions WHERE raw_id = ?", arrayOf<Any>(rawId))
      process(db, rawId, n)
      sqlite.setTransactionSuccessful()
    } finally {
      sqlite.endTransaction()
    }
  }

  private fun insertTransaction(db: BalanceDb, rawId: Long, n: RawNotification, tx: ParsedTransaction): Long {
    val sqlite = db.writableDatabase
    val txId = sqlite.insert("transactions", null, ContentValues().apply {
      put("raw_id", rawId)
      put("source", n.pkg)
      put("direction", tx.direction.value)
      put("amount", tx.amount)
      put("counterparty", tx.counterparty)
      put("bank_category", tx.bankCategory)
      put("category_id", categorize(loadRules(db), tx.counterparty, tx.bankCategory))
      put("is_transfer", 0)
      put("occurred_at", n.postedAt)
    })
    pairTransfer(sqlite, txId, n.pkg, tx, n.postedAt)
    return txId
  }

  private fun pairTransfer(db: SQLiteDatabase, txId: Long, source: String, tx: ParsedTransaction, at: Long) {
    val opposite = if (tx.direction == Direction.IN) "out" else "in"
    val partner = db.rawQuery(
      """
      SELECT id FROM transactions
      WHERE direction = ? AND amount = ? AND source != ? AND pair_id IS NULL AND transfer_locked = 0
        AND id != ? AND ABS(occurred_at - ?) <= ?
      ORDER BY ABS(occurred_at - ?) LIMIT 1
      """,
      arrayOf(opposite, tx.amount.toString(), source, txId.toString(), at.toString(), TRANSFER_PAIR_WINDOW_MS.toString(), at.toString())
    ).use { if (it.moveToFirst()) it.getLong(0) else null } ?: return

    db.execSQL("UPDATE transactions SET is_transfer = 1, pair_id = ? WHERE id = ?", arrayOf<Any>(partner, txId))
    db.execSQL(
      "UPDATE transactions SET is_transfer = CASE WHEN transfer_locked = 1 THEN is_transfer ELSE 1 END, pair_id = ? WHERE id = ?",
      arrayOf<Any>(txId, partner)
    )
  }

  internal class CategoryRule(val id: String, val keywords: List<Regex>)

  // Keywords match whole words, so "fee" hits "Admin Fee" but not "coffee".
  internal fun loadRules(db: BalanceDb): List<CategoryRule> =
    db.readableDatabase.rawQuery("SELECT id, keywords FROM categories ORDER BY position", null).use { c ->
      buildList {
        while (c.moveToNext()) {
          val keywords = Settings.splitList(c.getString(1)).map { keyword ->
            Regex("""(^|[^\p{L}\p{N}])${Regex.escape(keyword.lowercase())}($|[^\p{L}\p{N}])""")
          }
          add(CategoryRule(c.getString(0), keywords))
        }
      }
    }

  internal fun categorize(rules: List<CategoryRule>, counterparty: String?, bankCategory: String?): String? {
    val haystack = listOfNotNull(counterparty, bankCategory).joinToString(" ").lowercase()
    if (haystack.isBlank()) return null
    return rules.firstOrNull { rule -> rule.keywords.any { it.containsMatchIn(haystack) } }?.id
  }

  /** Re-runs categories on every transaction the user hasn't set by hand. */
  fun recategorize(db: BalanceDb) {
    val sqlite = db.writableDatabase
    val rules = loadRules(db)
    val rows = sqlite.rawQuery("SELECT id, counterparty, bank_category FROM transactions WHERE category_locked = 0", null).use { c ->
      buildList { while (c.moveToNext()) add(Triple(c.getLong(0), c.getString(1), c.getString(2))) }
    }
    sqlite.beginTransaction()
    try {
      for ((id, counterparty, bankCategory) in rows) {
        sqlite.execSQL("UPDATE transactions SET category_id = ? WHERE id = ?", arrayOf(categorize(rules, counterparty, bankCategory), id))
      }
      sqlite.setTransactionSuccessful()
    } finally {
      sqlite.endTransaction()
    }
  }

  /**
   * Parses every stored notification again with the current rules, keeping anything the user
   * set by hand. Used after parser changes, watched-app changes or a new self name.
   */
  fun reprocessAll(db: BalanceDb) {
    val sqlite = db.writableDatabase
    data class Manual(val categoryId: String?, val categoryLocked: Boolean, val isTransfer: Int, val transferLocked: Boolean)

    val manual = sqlite.rawQuery(
      "SELECT raw_id, category_id, category_locked, is_transfer, transfer_locked FROM transactions WHERE category_locked = 1 OR transfer_locked = 1",
      null
    ).use { c ->
      buildMap { while (c.moveToNext()) put(c.getLong(0), Manual(c.getString(1), c.getInt(2) == 1, c.getInt(3), c.getInt(4) == 1)) }
    }
    // Restored rows have no text to parse; their transactions stay as they came from the cloud.
    val raws = sqlite.rawQuery(
      "SELECT id, package, title, body, posted_at FROM raw_notifications WHERE status != ? ORDER BY posted_at",
      arrayOf(LedgerMerge.RESTORED)
    ).use { c ->
      buildList { while (c.moveToNext()) add(c.getLong(0) to RawNotification(c.getString(1), c.getString(2), c.getString(3), c.getLong(4))) }
    }

    sqlite.beginTransaction()
    try {
      if (db.aiEnabled()) keepLegacyGuesses(sqlite)
      sqlite.execSQL(
        "DELETE FROM transactions WHERE raw_id NOT IN (SELECT id FROM raw_notifications WHERE status = ?)",
        arrayOf(LedgerMerge.RESTORED)
      )
      // Ids are never reused (AUTOINCREMENT), so a restored row whose partner was just removed loses the link for good.
      sqlite.execSQL("UPDATE transactions SET pair_id = NULL WHERE pair_id IS NOT NULL AND pair_id NOT IN (SELECT id FROM transactions)")
      val watched = db.watchedPackages()
      for ((rawId, n) in raws) {
        if (n.pkg in watched) {
          process(db, rawId, n)
        } else {
          sqlite.execSQL("UPDATE raw_notifications SET status = 'unwatched' WHERE id = ?", arrayOf<Any>(rawId))
        }
      }
      for ((rawId, m) in manual) {
        if (m.categoryLocked) {
          sqlite.execSQL("UPDATE transactions SET category_id = ?, category_locked = 1 WHERE raw_id = ?", arrayOf(m.categoryId, rawId))
        }
        if (m.transferLocked) {
          sqlite.execSQL("UPDATE transactions SET is_transfer = ?, transfer_locked = 1 WHERE raw_id = ?", arrayOf<Any>(m.isTransfer, rawId))
        }
      }
      sqlite.setTransactionSuccessful()
    } finally {
      sqlite.endTransaction()
    }
    AiReview.kick(db.appContext)
  }

  /**
   * Picked apps used to go through the keyword guess. With AI review on they no longer do, so
   * transactions already logged that way are kept as if the user had confirmed them.
   */
  private fun keepLegacyGuesses(sqlite: SQLiteDatabase) {
    val builtIn = Settings.DEFAULT_PACKAGES.joinToString(",") { "'$it'" }
    sqlite.execSQL(
      """
      INSERT OR IGNORE INTO ai_reviews (raw_id, state, kind, direction, amount, counterparty, updated_at)
      SELECT t.raw_id, 'confirmed',
        CASE WHEN t.is_transfer = 1 THEN 'transfer' WHEN t.direction = 'in' THEN 'income' ELSE 'expense' END,
        t.direction, t.amount, t.counterparty, ?
      FROM transactions t JOIN raw_notifications r ON r.id = t.raw_id
      WHERE r.package NOT IN ($builtIn)
      """,
      arrayOf<Any>(System.currentTimeMillis())
    )
  }

  /** Points the ledger at [userId]'s file, on the writer thread so no write lands in the wrong one. */
  fun switchUser(context: Context, userId: String?) {
    val app = context.applicationContext
    writer.submit {
      // The old account's items must not stay on screen, nor be answered into the new ledger.
      if (Account.userId(app) != userId) ReviewNotifier.cancelAll(app)
      Account.switchTo(app, userId)
    }.get()
    onChanged(app)
  }

  private fun onChanged(context: Context) {
    runCatching { ReviewNotifier.syncOpen(context) }
    WidgetBridge.refresh(context)
    BalanceEvents.emitLedgerChanged()
  }
}

/** Lets the listener service reach the JS module while the app is open. */
internal object BalanceEvents {
  @Volatile var listener: (() -> Unit)? = null

  fun emitLedgerChanged() {
    listener?.invoke()
  }
}
