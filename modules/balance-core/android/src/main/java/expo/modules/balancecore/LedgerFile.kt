package expo.modules.balancecore

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.net.Uri
import expo.modules.kotlin.exception.CodedException
import java.io.InputStream
import java.io.OutputStream
import java.text.ParsePosition
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import kotlin.math.abs
import kotlin.math.roundToLong

internal class NotLedgerFileException(detail: String) : CodedException("ERR_NOT_LEDGER_FILE", detail, null)
internal class LedgerFileException(detail: String) : CodedException("ERR_LEDGER_FILE", detail, null)

/**
 * The ledger as an .xlsx workbook: a Transactions sheet and a Categories sheet.
 *
 * Readable columns come first. Hidden columns at the end (ids, package, locks, exact timestamp)
 * make export -> import lossless: rows keep their notification uid, so importing the same file
 * twice, or into the phone it came from, adds nothing. Sheets made by hand only need
 * Date, Amount and a direction (a Direction column, or negative amounts for money out).
 */
internal object LedgerFile {
  private const val TRANSACTIONS = "Transactions"
  private const val CATEGORIES = "Categories"
  private const val DAY_MS = 86_400_000.0
  private const val EPOCH_1900 = 25569.0 // 1970-01-01 as an Excel serial day.
  private const val EPOCH_1904 = 24107.0

  private object T {
    const val DATE = "Date"
    const val DIRECTION = "Direction"
    const val AMOUNT = "Amount"
    const val COUNTERPARTY = "Counterparty"
    const val CATEGORY = "Category"
    const val BANK_CATEGORY = "Bank category"
    const val SOURCE = "Source"
    const val TRANSFER = "Transfer"
    const val NOTIFICATION = "Notification"
    const val TITLE = "Title"
    const val ID = "ID"
    const val PAIR_ID = "Pair ID"
    const val CATEGORY_ID = "Category ID"
    const val PACKAGE = "Package"
    const val CATEGORY_LOCKED = "Category set by hand"
    const val TRANSFER_LOCKED = "Transfer set by hand"
    const val TIMESTAMP = "Timestamp"
  }

  private object C {
    const val NAME = "Name"
    const val KEYWORDS = "Keywords"
    const val ID = "ID"
    const val POSITION = "Position"
  }

  // ---- Export ----

  class Exported(val transactions: Int, val categories: Int)

  fun export(context: Context, db: BalanceDb, labels: Map<String, String>, out: OutputStream): Exported {
    val sqlite = db.readableDatabase
    val tz = TimeZone.getDefault()
    val labelCache = HashMap<String, String>()
    fun label(pkg: String) = labelCache.getOrPut(pkg) { labels[pkg] ?: appLabel(context, pkg) ?: pkg }

    val txRows = sqlite.rawQuery(
      """
      SELECT t.occurred_at, t.direction, t.amount, t.counterparty, c.name AS category_name, t.bank_category, t.source,
             t.is_transfer, r.body, r.title, r.uid, pr.uid AS pair_uid, t.category_id, t.category_locked, t.transfer_locked
      FROM transactions t
      JOIN raw_notifications r ON r.id = t.raw_id
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN transactions p ON p.id = t.pair_id
      LEFT JOIN raw_notifications pr ON pr.id = p.raw_id
      ORDER BY t.occurred_at DESC, t.id DESC
      """,
      null
    ).use { c ->
      buildList {
        while (c.moveToNext()) {
          val at = c.getLong(0)
          add(
            listOf(
              Xlsx.Cell.Number(toSerial(at, tz), Xlsx.STYLE_DATE),
              text(if (c.getString(1) == "in") "In" else "Out"),
              Xlsx.Cell.Number(c.getLong(2).toDouble(), Xlsx.STYLE_AMOUNT),
              text(c.str(3)),
              text(c.str(4)),
              text(c.str(5)),
              text(label(c.getString(6))),
              yesNo(c.getInt(7) == 1),
              text(c.str(8)),
              text(c.str(9)),
              text(c.str(10)),
              text(c.str(11)),
              text(c.str(12)),
              text(c.getString(6)),
              yesNo(c.getInt(13) == 1),
              yesNo(c.getInt(14) == 1),
              Xlsx.Cell.Number(at.toDouble()),
            )
          )
        }
      }
    }

    val catRows = sqlite.rawQuery("SELECT name, keywords, id, position FROM categories ORDER BY position", null).use { c ->
      buildList {
        while (c.moveToNext()) {
          add(listOf(text(c.str(0)), text(c.str(1)), text(c.str(2)), Xlsx.Cell.Number(c.getLong(3).toDouble())))
        }
      }
    }

    Xlsx.write(
      out,
      listOf(
        Xlsx.Sheet(
          TRANSACTIONS,
          listOf(
            Xlsx.Column(T.DATE, 17.0),
            Xlsx.Column(T.DIRECTION, 10.0),
            Xlsx.Column(T.AMOUNT, 14.0),
            Xlsx.Column(T.COUNTERPARTY, 28.0),
            Xlsx.Column(T.CATEGORY, 16.0),
            Xlsx.Column(T.BANK_CATEGORY, 18.0),
            Xlsx.Column(T.SOURCE, 14.0),
            Xlsx.Column(T.TRANSFER, 10.0),
            Xlsx.Column(T.NOTIFICATION, 60.0),
            Xlsx.Column(T.TITLE, 20.0, hidden = true),
            Xlsx.Column(T.ID, 38.0, hidden = true),
            Xlsx.Column(T.PAIR_ID, 38.0, hidden = true),
            Xlsx.Column(T.CATEGORY_ID, 38.0, hidden = true),
            Xlsx.Column(T.PACKAGE, 28.0, hidden = true),
            Xlsx.Column(T.CATEGORY_LOCKED, 10.0, hidden = true),
            Xlsx.Column(T.TRANSFER_LOCKED, 10.0, hidden = true),
            Xlsx.Column(T.TIMESTAMP, 16.0, hidden = true),
          ),
          txRows
        ),
        Xlsx.Sheet(
          CATEGORIES,
          listOf(
            Xlsx.Column(C.NAME, 18.0),
            Xlsx.Column(C.KEYWORDS, 80.0),
            Xlsx.Column(C.ID, 38.0, hidden = true),
            Xlsx.Column(C.POSITION, 10.0, hidden = true),
          ),
          catRows
        ),
      )
    )
    return Exported(txRows.size, catRows.size)
  }

  private fun appLabel(context: Context, pkg: String): String? = runCatching {
    val pm = context.packageManager
    @Suppress("DEPRECATION")
    pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
  }.getOrNull()

  private fun text(value: String?): Xlsx.Cell = if (value.isNullOrEmpty()) Xlsx.Cell.Empty else Xlsx.Cell.Text(value)
  private fun yesNo(value: Boolean): Xlsx.Cell = Xlsx.Cell.Text(if (value) "Yes" else "No")
  private fun Cursor.str(i: Int): String? = if (isNull(i)) null else getString(i)

  /** Excel stores wall-clock time as days since 1899-12-30, so the phone's time zone is applied. */
  private fun toSerial(ms: Long, tz: TimeZone): Double = (ms + tz.getOffset(ms)) / DAY_MS + EPOCH_1900

  private fun fromSerial(serial: Double, tz: TimeZone, date1904: Boolean): Long {
    val wall = ((serial - if (date1904) EPOCH_1904 else EPOCH_1900) * DAY_MS).roundToLong()
    return wall - tz.getOffset(wall - tz.getOffset(wall))
  }

  // ---- Reading a file ----

  class Row(
    val uid: String?,
    val pairUid: String?,
    val at: Long,
    val direction: String,
    val amount: Long,
    val counterparty: String?,
    val bankCategory: String?,
    val categoryId: String?,
    val categoryName: String?,
    val categoryLocked: Boolean?,
    val isTransfer: Boolean?,
    val transferLocked: Boolean?,
    val pkg: String,
    val title: String?,
    val body: String,
  )

  class Category(val id: String?, val name: String, val keywords: String, val position: Long?)

  class Parsed(val rows: List<Row>, val categories: List<Category>, val skipped: Int)

  fun read(input: InputStream, labels: Map<String, String>): Parsed {
    val workbook = try {
      Xlsx.read(input)
    } catch (e: Xlsx.FormatException) {
      throw NotLedgerFileException(e.message ?: "Not an xlsx file")
    } catch (e: org.xmlpull.v1.XmlPullParserException) {
      throw NotLedgerFileException("Broken xlsx file")
    }
    val tz = TimeZone.getDefault()
    val byLabel = labels.entries.associate { (pkg, label) -> label.lowercase(Locale.ROOT) to pkg }

    val txSheet = workbook.sheets.firstOrNull { it.name.equals(TRANSACTIONS, true) }
      ?: workbook.sheets.firstOrNull { sheet -> header(sheet).let { it.has(T.DATE) && it.has(T.AMOUNT) } }
    val catSheet = workbook.sheets.firstOrNull { it.name.equals(CATEGORIES, true) }

    val rows = ArrayList<Row>()
    var skipped = 0
    if (txSheet != null) {
      val h = header(txSheet)
      if (!h.has(T.DATE) || !h.has(T.AMOUNT)) throw NotLedgerFileException("No Date and Amount columns")
      for (cells in txSheet.rows.drop(1)) {
        if (cells.all { it == null || (it is String && it.isBlank()) }) continue
        val row = parseRow(cells, h, tz, workbook.date1904, byLabel)
        if (row == null) skipped++ else rows += row
      }
    }

    val categories = ArrayList<Category>()
    if (catSheet != null) {
      val h = header(catSheet)
      if (h.has(C.NAME)) {
        for (cells in catSheet.rows.drop(1)) {
          val name = h.string(cells, C.NAME) ?: continue
          categories += Category(
            id = h.string(cells, C.ID),
            name = name,
            keywords = h.string(cells, C.KEYWORDS).orEmpty(),
            position = h.number(cells, C.POSITION)?.toLong(),
          )
        }
      }
    }

    if (txSheet == null && categories.isEmpty()) throw NotLedgerFileException("No Transactions sheet")
    return Parsed(rows, categories, skipped)
  }

  private class Header(private val index: Map<String, Int>) {
    fun has(name: String) = name.lowercase(Locale.ROOT) in index
    fun cell(cells: List<Any?>, name: String): Any? = index[name.lowercase(Locale.ROOT)]?.let { cells.getOrNull(it) }
    fun string(cells: List<Any?>, name: String): String? = when (val v = cell(cells, name)) {
      null -> null
      is String -> v.trim().ifEmpty { null }
      is Double -> if (v % 1.0 == 0.0) v.toLong().toString() else v.toString()
      else -> v.toString()
    }
    fun number(cells: List<Any?>, name: String): Double? = when (val v = cell(cells, name)) {
      is Double -> v
      is String -> v.trim().toDoubleOrNull()
      else -> null
    }
    fun bool(cells: List<Any?>, name: String): Boolean? = when (val v = cell(cells, name)) {
      is Boolean -> v
      is Double -> v != 0.0
      is String -> when (v.trim().lowercase(Locale.ROOT)) {
        "yes", "y", "true", "1", "ya" -> true
        "no", "n", "false", "0", "tidak", "" -> false
        else -> null
      }
      else -> null
    }
  }

  private fun header(sheet: Xlsx.ReadSheet): Header {
    val first = sheet.rows.firstOrNull().orEmpty()
    val index = HashMap<String, Int>()
    first.forEachIndexed { i, v -> (v as? String)?.trim()?.lowercase(Locale.ROOT)?.let { if (it.isNotEmpty()) index.putIfAbsent(it, i) } }
    return Header(index)
  }

  private fun parseRow(cells: List<Any?>, h: Header, tz: TimeZone, date1904: Boolean, byLabel: Map<String, String>): Row? {
    val shown = when (val d = h.cell(cells, T.DATE)) {
      is Double -> fromSerial(d, tz, date1904)
      is String -> parseDate(d.trim())
      else -> null
    }
    val stamp = h.number(cells, T.TIMESTAMP)?.toLong()
    // The exact timestamp wins unless someone edited the visible date.
    val at = when {
      stamp != null && (shown == null || abs(shown - stamp) < 60_000) -> stamp
      else -> shown
    } ?: return null

    val rawAmount = when (val a = h.cell(cells, T.AMOUNT)) {
      is Double -> a
      is String -> parseAmount(a)
      else -> null
    } ?: return null
    val amount = abs(rawAmount).roundToLong()
    if (amount == 0L) return null

    val direction = when (h.string(cells, T.DIRECTION)?.lowercase(Locale.ROOT)) {
      "in", "income", "masuk", "credit", "+" -> "in"
      "out", "expense", "keluar", "debit", "-" -> "out"
      null -> if (rawAmount < 0) "out" else "in"
      else -> return null
    }

    val counterparty = h.string(cells, T.COUNTERPARTY)
    val bankCategory = h.string(cells, T.BANK_CATEGORY)
    val source = h.string(cells, T.SOURCE)
    val pkg = h.string(cells, T.PACKAGE)
      ?: source?.let { byLabel[it.lowercase(Locale.ROOT)] ?: it }
      ?: "Imported"
    val title = h.string(cells, T.TITLE)
    // Hand-made rows have no notification; a stable stand-in keeps re-imports from duplicating them.
    val body = h.string(cells, T.NOTIFICATION)
      ?: listOf(if (direction == "in") "In" else "Out", amount.toString(), counterparty ?: bankCategory ?: "").joinToString(" ").trim()

    return Row(
      uid = h.string(cells, T.ID),
      pairUid = h.string(cells, T.PAIR_ID),
      at = at,
      direction = direction,
      amount = amount,
      counterparty = counterparty,
      bankCategory = bankCategory,
      categoryId = h.string(cells, T.CATEGORY_ID),
      categoryName = h.string(cells, T.CATEGORY),
      categoryLocked = if (h.has(T.CATEGORY_LOCKED)) h.bool(cells, T.CATEGORY_LOCKED) else null,
      isTransfer = if (h.has(T.TRANSFER)) h.bool(cells, T.TRANSFER) else null,
      transferLocked = if (h.has(T.TRANSFER_LOCKED)) h.bool(cells, T.TRANSFER_LOCKED) else null,
      pkg = pkg,
      title = title,
      body = body,
    )
  }

  private val DATE_PATTERNS = listOf(
    "yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd HH:mm", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd",
    "dd/MM/yyyy HH:mm:ss", "dd/MM/yyyy HH:mm", "dd/MM/yyyy",
  )

  private fun parseDate(text: String): Long? {
    if (text.isEmpty()) return null
    for (pattern in DATE_PATTERNS) {
      val format = SimpleDateFormat(pattern, Locale.ROOT).apply { isLenient = false }
      val pos = ParsePosition(0)
      val date = format.parse(text, pos) ?: continue
      if (pos.index == text.length) return date.time
    }
    return null
  }

  /** "Rp 1.250.000", "-50,000", "1.250.000,00": Rupiah has no cents, so grouping marks are dropped. */
  private fun parseAmount(text: String): Double? {
    val trimmed = text.trim().replace(Regex("""[.,]\d{1,2}$"""), "")
    val negative = trimmed.startsWith("-") || trimmed.startsWith("−") || (trimmed.startsWith("(") && trimmed.endsWith(")"))
    val digits = trimmed.filter { it.isDigit() }
    if (digits.isEmpty() || digits.length > 15) return null
    return digits.toDouble() * if (negative) -1 else 1
  }

  // ---- Merging into the ledger ----

  class Plan(
    /** Rows to add, with the id of an already stored notification that has no transaction yet. */
    val fresh: List<Pair<Row, Long?>>,
    val existing: Int,
    val skipped: Int,
    val newCategories: Int,
    val categories: List<Category>,
  ) {
    fun summary(): Map<String, Any?> = mapOf(
      "add" to fresh.size,
      "existing" to existing,
      "skipped" to skipped,
      "newCategories" to newCategories,
      "from" to fresh.minOfOrNull { it.first.at }?.toDouble(),
      "to" to fresh.maxOfOrNull { it.first.at }?.toDouble(),
    )
  }

  fun plan(db: BalanceDb, parsed: Parsed): Plan {
    val sqlite = db.readableDatabase
    val seenUids = HashSet<String>()
    val seenPrints = HashSet<String>()
    val fresh = ArrayList<Pair<Row, Long?>>()
    var existing = 0
    for (row in parsed.rows) {
      // Rows with no notification text are told apart by id alone.
      val print = if (row.body.isBlank()) null else "${row.pkg}\u0000${row.at}\u0000${row.body}"
      if ((row.uid != null && !seenUids.add(row.uid)) || (print != null && !seenPrints.add(print))) {
        existing++
        continue
      }
      val match = sqlite.rawQuery(
        """
        SELECT r.id, t.id FROM raw_notifications r LEFT JOIN transactions t ON t.raw_id = r.id
        WHERE r.uid = ? OR (? AND r.package = ? AND r.posted_at = ? AND r.body = ?) LIMIT 1
        """,
        arrayOf(row.uid ?: "", if (print != null) "1" else "0", row.pkg, row.at.toString(), row.body)
      ).use { c -> if (c.moveToFirst()) c.getLong(0) to (if (c.isNull(1)) null else c.getLong(1)) else null }
      when {
        match == null -> fresh += row to null
        match.second == null -> fresh += row to match.first
        else -> existing++
      }
    }

    val merge = CategoryMerge(sqlite)
    parsed.categories.forEach { merge.resolve(it.id, it.name, dryRun = true) }
    fresh.forEach { (row, _) -> merge.resolve(row.categoryId, row.categoryName, dryRun = true) }

    return Plan(fresh, existing, parsed.skipped, merge.added, parsed.categories)
  }

  /**
   * Maps imported category ids and names onto this ledger's categories. The ledger's own
   * categories win: a match by id or by name is reused, never overwritten.
   */
  private class CategoryMerge(private val sqlite: SQLiteDatabase) {
    private val ids = HashSet<String>()
    private val byName = HashMap<String, String>()
    private val aliases = HashMap<String, String>()
    private var nextPosition = 0L
    var added = 0
      private set

    init {
      sqlite.rawQuery("SELECT id, name, position FROM categories", null).use { c ->
        while (c.moveToNext()) {
          ids += c.getString(0)
          byName.putIfAbsent(c.getString(1).trim().lowercase(Locale.ROOT), c.getString(0))
          nextPosition = maxOf(nextPosition, c.getLong(2) + 1)
        }
      }
    }

    fun resolve(id: String?, name: String?, keywords: String = "", dryRun: Boolean = false): String? {
      id?.let { aliases[it] ?: it.takeIf { known -> known in ids } }?.let { return it }
      val clean = name?.trim()?.ifEmpty { null } ?: return null
      val key = clean.lowercase(Locale.ROOT)
      byName[key]?.let { existing ->
        // Same category under another id: later rows with that id land here too.
        if (id != null) aliases[id] = existing
        return existing
      }
      val newId = id ?: UUID.randomUUID().toString()
      if (!dryRun) {
        sqlite.insert("categories", null, ContentValues().apply {
          put("id", newId)
          put("name", clean)
          put("keywords", keywords)
          put("position", nextPosition)
        })
      }
      nextPosition++
      added++
      ids += newId
      byName[key] = newId
      return newId
    }
  }

  class Imported(val added: Int, val existing: Int, val newCategories: Int)

  /** Adds the plan's rows in one SQLite transaction. Runs on the ledger writer thread. */
  fun apply(db: BalanceDb, parsed: Parsed): Imported {
    val plan = plan(db, parsed)
    val sqlite = db.writableDatabase
    sqlite.beginTransaction()
    try {
      val merge = CategoryMerge(sqlite)
      plan.categories.sortedBy { it.position ?: Long.MAX_VALUE }.forEach { merge.resolve(it.id, it.name, it.keywords) }
      val rules = Ledger.loadRules(db)

      val pairs = ArrayList<Pair<Long, String>>()
      for ((row, existingRawId) in plan.fresh) {
        // Like rows restored from the cloud: no notification to re-read, so re-parsing leaves them be.
        val rawId = when {
          existingRawId != null -> {
            sqlite.execSQL("UPDATE raw_notifications SET status = ? WHERE id = ?", arrayOf<Any>(LedgerMerge.RESTORED, existingRawId))
            existingRawId
          }
          row.body.isBlank() -> LedgerMerge.insertRestoredRaw(sqlite, row.uid ?: UUID.randomUUID().toString(), row.pkg, row.at) ?: -1L
          else -> sqlite.insertWithOnConflict("raw_notifications", null, ContentValues().apply {
            put("uid", row.uid ?: UUID.randomUUID().toString())
            put("package", row.pkg)
            put("title", row.title)
            put("body", row.body)
            put("posted_at", row.at)
            put("status", LedgerMerge.RESTORED)
          }, SQLiteDatabase.CONFLICT_IGNORE)
        }
        if (rawId == -1L) continue

        // Exported rows carry their lock column and keep their category as-is; hand-made rows with
        // a category count as set by hand, and the rest go through the keyword rules.
        val named = row.categoryId != null || row.categoryName != null
        val categoryId = merge.resolve(row.categoryId, row.categoryName)
        val locked = row.categoryLocked ?: named
        val keep = row.categoryLocked != null || named
        val txId = sqlite.insert("transactions", null, ContentValues().apply {
          put("raw_id", rawId)
          put("source", row.pkg)
          put("direction", row.direction)
          put("amount", row.amount)
          put("counterparty", row.counterparty)
          put("bank_category", row.bankCategory)
          put("category_id", if (keep) categoryId else Ledger.categorize(rules, row.counterparty, row.bankCategory))
          put("category_locked", if (locked) 1 else 0)
          put("is_transfer", if (row.isTransfer == true) 1 else 0)
          put("transfer_locked", if (row.transferLocked == true) 1 else 0)
          put("occurred_at", row.at)
        })
        if (txId != -1L && row.pairUid != null) pairs += txId to row.pairUid
      }

      for ((txId, pairUid) in pairs) {
        val partner = sqlite.rawQuery(
          "SELECT t.id FROM transactions t JOIN raw_notifications r ON r.id = t.raw_id WHERE r.uid = ?",
          arrayOf(pairUid)
        ).use { if (it.moveToFirst()) it.getLong(0) else null } ?: continue
        sqlite.execSQL("UPDATE transactions SET pair_id = ? WHERE id = ?", arrayOf<Any>(partner, txId))
        sqlite.execSQL("UPDATE transactions SET pair_id = ? WHERE id = ? AND pair_id IS NULL", arrayOf<Any>(txId, partner))
      }
      sqlite.setTransactionSuccessful()
    } finally {
      sqlite.endTransaction()
    }
    return Imported(plan.fresh.size, plan.existing, plan.newCategories)
  }

  fun open(context: Context, uri: Uri): InputStream =
    context.contentResolver.openInputStream(uri) ?: throw LedgerFileException("Can't open file")
}
