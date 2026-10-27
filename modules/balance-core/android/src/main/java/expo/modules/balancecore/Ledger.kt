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
    if (Account.userId(context) == null) return false // Nobody to log it for.
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
      changed = true
    }
    return changed
  }

  private fun process(db: BalanceDb, rawId: Long, n: RawNotification) {
    val status = when (val result = Parsers.parse(n.pkg, n.title, n.body)) {
      is ParseResult.Transaction -> {
        insertTransaction(db, rawId, n, result.tx)
        "parsed"
      }
      ParseResult.Unparsed -> "unparsed"
      ParseResult.Ignored -> "ignored"
    }
    db.writableDatabase.execSQL("UPDATE raw_notifications SET status = ? WHERE id = ?", arrayOf<Any>(status, rawId))
  }

  private fun insertTransaction(db: BalanceDb, rawId: Long, n: RawNotification, tx: ParsedTransaction) {
    val sqlite = db.writableDatabase
    val isSelf = tx.isPersonTransfer && SelfNameMatcher.matches(tx.counterparty, db.selfNames())
    val txId = sqlite.insert("transactions", null, ContentValues().apply {
      put("raw_id", rawId)
      put("source", n.pkg)
      put("direction", tx.direction.value)
      put("amount", tx.amount)
      put("counterparty", tx.counterparty)
      put("bank_category", tx.bankCategory)
      put("category_id", categorize(loadRules(db), tx.counterparty, tx.bankCategory))
      put("is_transfer", if (isSelf) 1 else 0)
      put("occurred_at", n.postedAt)
    })
    pairTransfer(sqlite, txId, n.pkg, tx, n.postedAt)
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

  private class CategoryRule(val id: String, val keywords: List<Regex>)

  // Keywords match whole words, so "fee" hits "Admin Fee" but not "coffee".
  private fun loadRules(db: BalanceDb): List<CategoryRule> =
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

  private fun categorize(rules: List<CategoryRule>, counterparty: String?, bankCategory: String?): String? {
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
    val raws = sqlite.rawQuery("SELECT id, package, title, body, posted_at FROM raw_notifications ORDER BY posted_at", null).use { c ->
      buildList { while (c.moveToNext()) add(c.getLong(0) to RawNotification(c.getString(1), c.getString(2), c.getString(3), c.getLong(4))) }
    }

    sqlite.beginTransaction()
    try {
      sqlite.execSQL("DELETE FROM transactions")
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
  }

  /** Points the ledger at [userId]'s file, on the writer thread so no write lands in the wrong one. */
  fun switchUser(context: Context, userId: String?) {
    val app = context.applicationContext
    writer.submit { Account.switchTo(app, userId) }.get()
    onChanged(app)
  }

  private fun onChanged(context: Context) {
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
