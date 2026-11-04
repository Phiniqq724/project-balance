package expo.modules.balancecore

import android.content.ContentValues
import android.database.sqlite.SQLiteDatabase
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File

class CloudCategory : Record {
  @Field val id: String = ""
  @Field val name: String = ""
  @Field val keywords: String = ""
  @Field val position: Double = 0.0
}

class CloudTransaction : Record {
  @Field val id: String = ""
  @Field val source: String = ""
  @Field val direction: String = "out"
  @Field val amount: Double = 0.0
  @Field val counterparty: String? = null
  @Field val bankCategory: String? = null
  @Field val categoryId: String? = null
  @Field val categoryLocked: Boolean = false
  @Field val isTransfer: Boolean = false
  @Field val transferLocked: Boolean = false
  @Field val pairId: String? = null
  /** Epoch milliseconds. */
  @Field val occurredAt: Double = 0.0
}

class SyncBaseEntry : Record {
  /** "category" or "transaction". */
  @Field val kind: String = ""
  @Field val id: String = ""
  /** null: forget the row (gone from the cloud). */
  @Field val print: String? = null
}

class CloudRekey : Record {
  @Field val from: String = ""
  @Field val to: String = ""
}

/** One sync step's changes for this ledger, worked out in JS (src/lib/sync.ts). */
class CloudChanges : Record {
  /** The sync state belongs to another user (or none yet): forget it before applying. */
  @Field val reset: Boolean = false
  @Field val categories: List<CloudCategory> = emptyList()
  @Field val deletedCategories: List<String> = emptyList()
  /** Local notification uids that were the same transaction as a cloud row; they take the cloud's id. */
  @Field val rekeys: List<CloudRekey> = emptyList()
  @Field val transactions: List<CloudTransaction> = emptyList()
  @Field val deletedTransactions: List<String> = emptyList()
  @Field val base: List<SyncBaseEntry> = emptyList()
  /** Newest cloud updated_at seen; the next pull asks for rows changed after it. */
  @Field val cursor: String? = null
}

/**
 * Brings rows from somewhere else into a ledger without losing or doubling anything.
 * Rows are matched on the notification uid (the cloud transaction id), so every merge can be
 * re-run after an interruption.
 */
internal object LedgerMerge {
  /** Ledger setting: the user the sync state (sync_base, cursor) belongs to. */
  const val SYNC_USER = "sync_user"
  const val SYNC_CURSOR = "sync_cursor"

  /** Status of notifications rebuilt from the cloud. Their text never left the old phone, so there's nothing to re-parse. */
  const val RESTORED = "restored"

  /** Applies cloud changes and records what was agreed. Returns true if the ledger's rows changed. */
  fun applyCloud(db: BalanceDb, userId: String, changes: CloudChanges): Boolean {
    val sqlite = db.writableDatabase
    var categoriesChanged = false
    sqlite.beginTransaction()
    try {
      if (changes.reset) {
        sqlite.execSQL("DELETE FROM sync_base")
        db.setSetting(SYNC_USER, userId)
        sqlite.delete("settings", "key = ?", arrayOf(SYNC_CURSOR))
      }

      if (changes.categories.isNotEmpty()) {
        categoriesChanged = true
        // A ledger still on the starter categories takes the cloud's set as-is, so ones the user
        // deleted elsewhere don't come back.
        if (changes.reset && hasOnlySeedCategories(sqlite)) {
          // Everything the cloud holds: rows sent to change, plus rows already matching (only in base).
          val keep = changes.categories.map { it.id }.toSet() +
            changes.base.filter { it.kind == "category" && it.print != null }.map { it.id }
          for (id in categoryIds(sqlite) - keep) sqlite.delete("categories", "id = ?", arrayOf(id))
        }
        for (c in changes.categories) {
          sqlite.execSQL(
            "UPDATE categories SET name = ?, keywords = ?, position = ? WHERE id = ?",
            arrayOf<Any>(c.name, c.keywords, c.position.toLong(), c.id)
          )
          sqlite.insertWithOnConflict("categories", null, ContentValues().apply {
            put("id", c.id)
            put("name", c.name)
            put("keywords", c.keywords)
            put("position", c.position.toLong())
          }, SQLiteDatabase.CONFLICT_IGNORE)
        }
      }

      for (r in changes.rekeys) {
        if (rawIdForUid(sqlite, r.to) != null) continue
        sqlite.execSQL("UPDATE raw_notifications SET uid = ? WHERE uid = ?", arrayOf(r.to, r.from))
      }

      val known = categoryIds(sqlite)
      for (t in changes.transactions) upsertTransaction(sqlite, t, known)
      setPairs(sqlite, changes.transactions)

      for (uid in changes.deletedTransactions) {
        val rawId = rawIdForUid(sqlite, uid) ?: continue
        sqlite.execSQL("DELETE FROM transactions WHERE raw_id = ?", arrayOf<Any>(rawId))
        sqlite.execSQL("DELETE FROM raw_notifications WHERE id = ? AND status = ?", arrayOf<Any>(rawId, RESTORED))
      }
      if (changes.deletedTransactions.isNotEmpty()) {
        sqlite.execSQL("UPDATE transactions SET pair_id = NULL WHERE pair_id IS NOT NULL AND pair_id NOT IN (SELECT id FROM transactions)")
      }

      for (id in changes.deletedCategories) {
        if (sqlite.delete("categories", "id = ?", arrayOf(id)) > 0) categoriesChanged = true
      }

      for (b in changes.base) {
        if (b.print == null) {
          sqlite.delete("sync_base", "kind = ? AND id = ?", arrayOf(b.kind, b.id))
        } else {
          sqlite.insertWithOnConflict("sync_base", null, ContentValues().apply {
            put("kind", b.kind)
            put("id", b.id)
            put("print", b.print)
          }, SQLiteDatabase.CONFLICT_REPLACE)
        }
      }
      changes.cursor?.let { db.setSetting(SYNC_CURSOR, it) }
      sqlite.setTransactionSuccessful()
    } finally {
      sqlite.endTransaction()
    }
    if (categoriesChanged) Ledger.recategorize(db)
    return categoriesChanged || changes.rekeys.isNotEmpty() || changes.transactions.isNotEmpty() || changes.deletedTransactions.isNotEmpty()
  }

  private fun upsertTransaction(sqlite: SQLiteDatabase, t: CloudTransaction, known: Set<String>) {
    val values = ContentValues().apply {
      put("source", t.source)
      put("direction", if (t.direction == "in") "in" else "out")
      put("amount", t.amount.toLong())
      put("counterparty", t.counterparty)
      put("bank_category", t.bankCategory)
      put("category_id", t.categoryId?.takeIf { it in known })
      put("category_locked", if (t.categoryLocked) 1 else 0)
      put("is_transfer", if (t.isTransfer) 1 else 0)
      put("transfer_locked", if (t.transferLocked) 1 else 0)
      put("occurred_at", t.occurredAt.toLong())
    }
    val rawId = rawIdForUid(sqlite, t.id)
    if (rawId == null) {
      val restored = insertRestoredRaw(sqlite, t.id, t.source, t.occurredAt.toLong()) ?: return
      values.put("raw_id", restored)
      sqlite.insertOrThrow("transactions", null, values)
      return
    }
    if (sqlite.update("transactions", values, "raw_id = ?", arrayOf(rawId.toString())) > 0) return

    // This phone has the notification but didn't log it (older rules, or answered differently).
    // The other device's answer is kept as a confirmed one, so re-reading keeps it.
    values.put("raw_id", rawId)
    sqlite.insertOrThrow("transactions", null, values)
    sqlite.execSQL("UPDATE raw_notifications SET status = 'parsed' WHERE id = ? AND status != ?", arrayOf<Any>(rawId, RESTORED))
    val kind = when {
      t.isTransfer -> "transfer"
      t.direction == "in" -> "income"
      else -> "expense"
    }
    sqlite.execSQL("INSERT OR IGNORE INTO ai_reviews (raw_id) VALUES (?)", arrayOf<Any>(rawId))
    sqlite.execSQL(
      "UPDATE ai_reviews SET state = 'confirmed', kind = ?, direction = ?, amount = ?, counterparty = ?, updated_at = ? WHERE raw_id = ?",
      arrayOf<Any?>(kind, t.direction, t.amount.toLong(), t.counterparty, System.currentTimeMillis(), rawId)
    )
  }

  /** The cloud's pairing wins for the rows it sent. */
  private fun setPairs(sqlite: SQLiteDatabase, rows: List<CloudTransaction>) {
    for (t in rows) {
      val tx = txIdForUid(sqlite, t.id) ?: continue
      val partner = t.pairId?.let { txIdForUid(sqlite, it) }
      sqlite.execSQL("UPDATE transactions SET pair_id = ? WHERE id = ?", arrayOf<Any?>(partner, tx))
    }
  }

  /** Copies every notification, transaction and category from the ledger file [source] into [db]. */
  fun mergeFile(db: BalanceDb, source: File) {
    val sqlite = db.writableDatabase
    sqlite.execSQL("ATTACH DATABASE ? AS src", arrayOf(source.path))
    try {
      sqlite.beginTransaction()
      try {
        sqlite.execSQL(
          """
          INSERT OR IGNORE INTO main.categories (id, name, keywords, position)
          SELECT id, name, keywords, position + (SELECT COALESCE(MAX(position), -1) + 1 FROM main.categories)
          FROM src.categories
          """
        )
        // A notification both files caught (same app, time and text) is kept once; its transaction comes with the target's copy.
        sqlite.execSQL(
          """
          INSERT OR IGNORE INTO main.raw_notifications (uid, package, title, body, posted_at, status)
          SELECT uid, package, title, body, posted_at, status FROM src.raw_notifications WHERE uid IS NOT NULL
          """
        )
        sqlite.execSQL(
          """
          INSERT INTO main.transactions (raw_id, source, direction, amount, counterparty, bank_category, category_id,
                                         category_locked, is_transfer, transfer_locked, occurred_at)
          SELECT mr.id, t.source, t.direction, t.amount, t.counterparty, t.bank_category,
                 CASE WHEN t.category_id IN (SELECT id FROM main.categories) THEN t.category_id END,
                 t.category_locked, t.is_transfer, t.transfer_locked, t.occurred_at
          FROM src.transactions t
          JOIN src.raw_notifications sr ON sr.id = t.raw_id
          JOIN main.raw_notifications mr ON mr.uid = sr.uid
          WHERE NOT EXISTS (SELECT 1 FROM main.transactions x WHERE x.raw_id = mr.id)
          """
        )
        val pairs = sqlite.rawQuery(
          """
          SELECT sr.uid, pr.uid FROM src.transactions t
          JOIN src.raw_notifications sr ON sr.id = t.raw_id
          JOIN src.transactions p ON p.id = t.pair_id
          JOIN src.raw_notifications pr ON pr.id = p.raw_id
          """,
          null
        ).use { c -> buildList { while (c.moveToNext()) add(c.getString(0) to c.getString(1)) } }
        linkPairs(sqlite, pairs)

        mergeSettings(db, sqlite)
        sqlite.setTransactionSuccessful()
      } finally {
        sqlite.endTransaction()
      }
    } finally {
      sqlite.execSQL("DETACH DATABASE src")
    }
  }

  private fun mergeSettings(db: BalanceDb, sqlite: SQLiteDatabase) {
    fun srcSetting(key: String): String? =
      sqlite.rawQuery("SELECT value FROM src.settings WHERE key = ?", arrayOf(key)).use { if (it.moveToFirst()) it.getString(0) else null }

    val watched = (db.watchedPackages() + Settings.splitList(srcSetting(Settings.WATCHED_PACKAGES))).distinct()
    db.setSetting(Settings.WATCHED_PACKAGES, watched.joinToString(","))
  }

  /** Points each transaction (by notification uid) at its transfer partner, where both exist and it has none yet. */
  private fun linkPairs(sqlite: SQLiteDatabase, pairs: List<Pair<String, String>>) {
    for ((uid, partnerUid) in pairs) {
      val tx = txIdForUid(sqlite, uid) ?: continue
      val partner = txIdForUid(sqlite, partnerUid) ?: continue
      sqlite.execSQL("UPDATE transactions SET pair_id = ? WHERE id = ? AND pair_id IS NULL", arrayOf<Any>(partner, tx))
    }
  }

  fun insertRestoredRaw(sqlite: SQLiteDatabase, uid: String, source: String, at: Long): Long? {
    // (package, posted_at, body) is unique and restored rows have no body, so two transactions from one
    // app in the same millisecond nudge the hidden posted_at apart. occurred_at keeps the real time.
    for (offset in 0 until 1000) {
      val id = sqlite.insertWithOnConflict("raw_notifications", null, ContentValues().apply {
        put("uid", uid)
        put("package", source)
        put("body", "")
        put("posted_at", at + offset)
        put("status", RESTORED)
      }, SQLiteDatabase.CONFLICT_IGNORE)
      if (id != -1L) return id
    }
    return null
  }

  private fun rawIdForUid(sqlite: SQLiteDatabase, uid: String): Long? =
    sqlite.rawQuery("SELECT id FROM raw_notifications WHERE uid = ?", arrayOf(uid)).use { if (it.moveToFirst()) it.getLong(0) else null }

  private fun txIdForUid(sqlite: SQLiteDatabase, uid: String): Long? =
    sqlite.rawQuery(
      "SELECT t.id FROM transactions t JOIN raw_notifications r ON r.id = t.raw_id WHERE r.uid = ?",
      arrayOf(uid)
    ).use { if (it.moveToFirst()) it.getLong(0) else null }

  private fun categoryIds(sqlite: SQLiteDatabase): Set<String> =
    sqlite.rawQuery("SELECT id FROM categories", null).use { c -> buildSet { while (c.moveToNext()) add(c.getString(0)) } }

  private fun hasOnlySeedCategories(sqlite: SQLiteDatabase): Boolean {
    val local = sqlite.rawQuery("SELECT id, name, keywords FROM categories", null).use { c ->
      buildSet { while (c.moveToNext()) add(Triple(c.getString(0), c.getString(1), c.getString(2))) }
    }
    return local == BalanceDb.SEED_CATEGORIES.toSet()
  }
}
