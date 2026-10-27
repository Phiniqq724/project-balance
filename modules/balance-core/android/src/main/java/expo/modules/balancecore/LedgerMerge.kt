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

/**
 * Brings rows from somewhere else into a ledger without losing or doubling anything.
 * Rows are matched on the notification uid (the cloud transaction id), so every merge can be
 * re-run after an interruption: whatever already landed is skipped.
 */
internal object LedgerMerge {
  /** Ledger setting: the user whose cloud copy has been pulled into this ledger. */
  const val PULLED_FROM = "cloud_pulled"

  /** Status of notifications rebuilt from the cloud. Their text never left the old phone, so there's nothing to re-parse. */
  const val RESTORED = "restored"

  /**
   * Adds the user's cloud rows that this ledger doesn't have yet, once per ledger and user.
   * Returns false when it had already been done.
   */
  fun mergeCloud(
    db: BalanceDb,
    userId: String,
    categories: List<CloudCategory>,
    transactions: List<CloudTransaction>,
  ): Boolean {
    val sqlite = db.writableDatabase
    sqlite.beginTransaction()
    try {
      if (db.getSetting(PULLED_FROM) == userId) return false

      if (categories.isNotEmpty()) {
        // A ledger still on the starter categories takes the cloud's set as-is, so ones the user
        // deleted elsewhere don't come back. Otherwise only missing ones are added.
        val replace = hasOnlySeedCategories(sqlite)
        if (replace) {
          val keep = categories.map { it.id }.toSet()
          for (id in categoryIds(sqlite) - keep) sqlite.delete("categories", "id = ?", arrayOf(id))
        }
        for (c in categories) {
          if (replace) {
            sqlite.execSQL(
              "UPDATE categories SET name = ?, keywords = ?, position = ? WHERE id = ?",
              arrayOf<Any>(c.name, c.keywords, c.position.toLong(), c.id)
            )
          }
          sqlite.insertWithOnConflict("categories", null, ContentValues().apply {
            put("id", c.id)
            put("name", c.name)
            put("keywords", c.keywords)
            put("position", c.position.toLong())
          }, SQLiteDatabase.CONFLICT_IGNORE)
        }
      }

      val known = categoryIds(sqlite)
      val pairs = ArrayList<Pair<String, String>>()
      for (t in transactions) {
        if (rawIdForUid(sqlite, t.id) != null) continue
        val at = t.occurredAt.toLong()
        val rawId = insertRestoredRaw(sqlite, t.id, t.source, at) ?: continue
        sqlite.insertOrThrow("transactions", null, ContentValues().apply {
          put("raw_id", rawId)
          put("source", t.source)
          put("direction", if (t.direction == "in") "in" else "out")
          put("amount", t.amount.toLong())
          put("counterparty", t.counterparty)
          put("bank_category", t.bankCategory)
          put("category_id", t.categoryId?.takeIf { it in known })
          put("category_locked", if (t.categoryLocked) 1 else 0)
          put("is_transfer", if (t.isTransfer) 1 else 0)
          put("transfer_locked", if (t.transferLocked) 1 else 0)
          put("occurred_at", at)
        })
        t.pairId?.let { pairs += t.id to it }
      }
      linkPairs(sqlite, pairs)

      db.setSetting(PULLED_FROM, userId)
      sqlite.setTransactionSuccessful()
    } finally {
      sqlite.endTransaction()
    }
    // Starter categories may have been swapped out; refresh anything not set by hand.
    Ledger.recategorize(db)
    return true
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
