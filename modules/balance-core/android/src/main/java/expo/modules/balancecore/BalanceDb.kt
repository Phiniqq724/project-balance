package expo.modules.balancecore

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.util.UUID

/**
 * The only way into the ledger. The listener service and the JS side share this
 * one connection, so there is never a second SQLite library touching the file.
 * Each signed-in user gets their own file; see [Account].
 */
internal class BalanceDb private constructor(context: Context, val name: String) :
  SQLiteOpenHelper(context.applicationContext, name, null, 2) {

  override fun onConfigure(db: SQLiteDatabase) {
    db.setForeignKeyConstraintsEnabled(true)
    db.enableWriteAheadLogging()
  }

  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL(
      """
      CREATE TABLE raw_notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uid TEXT UNIQUE,
        package TEXT NOT NULL,
        title TEXT,
        body TEXT NOT NULL,
        posted_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        UNIQUE (package, posted_at, body)
      )
      """
    )
    db.execSQL(
      """
      CREATE TABLE categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        keywords TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0
      )
      """
    )
    db.execSQL(
      """
      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        raw_id INTEGER NOT NULL UNIQUE REFERENCES raw_notifications(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
        amount INTEGER NOT NULL,
        counterparty TEXT,
        bank_category TEXT,
        category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
        category_locked INTEGER NOT NULL DEFAULT 0,
        is_transfer INTEGER NOT NULL DEFAULT 0,
        transfer_locked INTEGER NOT NULL DEFAULT 0,
        pair_id INTEGER,
        occurred_at INTEGER NOT NULL
      )
      """
    )
    db.execSQL("CREATE INDEX transactions_occurred_at ON transactions(occurred_at)")
    db.execSQL("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")

    seedCategories(db)
    db.insert("settings", null, ContentValues().apply {
      put("key", Settings.WATCHED_PACKAGES)
      put("value", Settings.DEFAULT_PACKAGES.joinToString(","))
    })
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    if (oldVersion < 2) {
      // A stable id per notification, so re-parsing keeps the same cloud row.
      db.execSQL("ALTER TABLE raw_notifications ADD COLUMN uid TEXT")
      val ids = db.rawQuery("SELECT id FROM raw_notifications", null).use { c ->
        buildList { while (c.moveToNext()) add(c.getLong(0)) }
      }
      for (id in ids) {
        db.execSQL("UPDATE raw_notifications SET uid = ? WHERE id = ?", arrayOf<Any>(UUID.randomUUID().toString(), id))
      }
      db.execSQL("CREATE UNIQUE INDEX raw_notifications_uid ON raw_notifications(uid)")
    }
  }

  private fun seedCategories(db: SQLiteDatabase) {
    val seed = listOf(
      Triple("food", "Food", "gofood,grabfood,shopeefood,resto,restaurant,kopi,coffee,cafe,warung,bakery,mcd,kfc,starbucks,janji jiwa,fore coffee,food,makan"),
      Triple("transport", "Transport", "gojek,goride,gocar,grab,maxim,krl,commuter,mrt,lrt,transjakarta,pertamina,shell,parkir,toll,tol,bluebird"),
      Triple("groceries", "Groceries", "indomaret,alfamart,alfamidi,superindo,hypermart,lotte,ranch,grocer,sayur,pasar"),
      Triple("shopping", "Shopping", "tokopedia,shopee,lazada,tiktok,blibli,zalora,uniqlo,ikea"),
      Triple("bills", "Bills", "pln,listrik,pdam,telkomsel,indihome,xl,axis,smartfren,by.u,pulsa,bpjs,internet,first media,biznet"),
      Triple("subscriptions", "Subscriptions", "netflix,spotify,youtube,google,apple,disney,vidio,chatgpt,openai,anthropic,claude"),
      Triple("fees", "Fees", "admin fee,biaya admin,fee,biaya"),
    )
    seed.forEachIndexed { index, (id, name, keywords) ->
      db.insert("categories", null, ContentValues().apply {
        put("id", id)
        put("name", name)
        put("keywords", keywords)
        put("position", index)
      })
    }
  }

  fun getSetting(key: String): String? =
    readableDatabase.rawQuery("SELECT value FROM settings WHERE key = ?", arrayOf(key)).use {
      if (it.moveToFirst()) it.getString(0) else null
    }

  fun setSetting(key: String, value: String) {
    writableDatabase.insertWithOnConflict(
      "settings",
      null,
      ContentValues().apply {
        put("key", key)
        put("value", value)
      },
      SQLiteDatabase.CONFLICT_REPLACE
    )
  }

  fun watchedPackages(): Set<String> =
    Settings.splitList(getSetting(Settings.WATCHED_PACKAGES)).toSet()

  fun selfNames(): List<String> = Settings.splitList(getSetting(Settings.SELF_NAMES), '\n')

  fun query(sql: String, args: List<Any?>): List<Map<String, Any?>> {
    val bound = args.map(::bindable).toTypedArray()
    return readableDatabase.rawQuery(sql, bound).use { cursor ->
      val rows = ArrayList<Map<String, Any?>>(cursor.count)
      while (cursor.moveToNext()) {
        rows += (0 until cursor.columnCount).associate { i -> cursor.getColumnName(i) to cursor.value(i) }
      }
      rows
    }
  }

  fun execute(sql: String, args: List<Any?>) {
    writableDatabase.execSQL(sql, args.map { if (it is Double && it % 1.0 == 0.0) it.toLong() else it }.toTypedArray())
  }

  companion object {
    @Volatile private var instance: BalanceDb? = null

    /** The signed-in user's ledger. Signed out, an empty one that nothing writes to. */
    fun get(context: Context): BalanceDb {
      val name = fileName(Account.userId(context))
      instance?.takeIf { it.name == name }?.let { return it }
      return synchronized(this) {
        instance?.takeIf { it.name == name } ?: run {
          instance?.close()
          BalanceDb(context, name).also { instance = it }
        }
      }
    }

    fun fileName(userId: String?): String = if (userId == null) "balance-signed-out.db" else "balance-$userId.db"

    /** Closes the open ledger so its file can be moved or deleted. */
    fun closeCurrent() = synchronized(this) {
      instance?.close()
      instance = null
    }

    // JS numbers arrive as Double; "1.79E12" would bind as text, so whole numbers become Long strings.
    private fun bindable(value: Any?): String? = when (value) {
      null -> null
      is Double -> if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()
      is Boolean -> if (value) "1" else "0"
      else -> value.toString()
    }

    private fun Cursor.value(i: Int): Any? = when (getType(i)) {
      Cursor.FIELD_TYPE_NULL -> null
      Cursor.FIELD_TYPE_INTEGER -> getLong(i).toDouble()
      Cursor.FIELD_TYPE_FLOAT -> getDouble(i)
      else -> getString(i)
    }
  }
}

internal object Settings {
  const val WATCHED_PACKAGES = "watched_packages"
  const val SELF_NAMES = "self_names"

  val DEFAULT_PACKAGES = listOf(
    "com.jago.digitalBanking",
    "com.bca.mybca.omni.android",
    "com.bca",
  )

  fun splitList(value: String?, separator: Char = ','): List<String> =
    value.orEmpty().split(separator).map { it.trim() }.filter { it.isNotEmpty() }
}
