package expo.modules.balancecore

import android.util.Xml
import org.xmlpull.v1.XmlPullParser
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.io.OutputStreamWriter
import java.math.BigDecimal
import java.math.RoundingMode
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/**
 * A minimal .xlsx (SpreadsheetML) writer and reader: just cells, no formulas or charts.
 * An xlsx file is a zip of a few XML parts, which is all the ledger needs, so there is no
 * POI-sized dependency. Reads files re-saved by Excel, Google Sheets, LibreOffice and Numbers.
 */
internal object Xlsx {
  const val MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

  // Indexes into cellXfs in [STYLES].
  const val STYLE_HEADER = 1
  const val STYLE_DATE = 2
  const val STYLE_AMOUNT = 3

  sealed interface Cell {
    data class Text(val value: String) : Cell
    data class Number(val value: Double, val style: Int = 0) : Cell
    data object Empty : Cell
  }

  class Column(val title: String, val width: Double, val hidden: Boolean = false)

  class Sheet(val name: String, val columns: List<Column>, val rows: List<List<Cell>>)

  /** A sheet as read back: strings, doubles, booleans or null, by row then column. */
  class ReadSheet(val name: String, val rows: List<List<Any?>>)

  class Workbook(val sheets: List<ReadSheet>, val date1904: Boolean)

  class FormatException(message: String) : IOException(message)

  // ---- Writing ----

  fun write(out: OutputStream, sheets: List<Sheet>) {
    val zip = ZipOutputStream(out)
    val writer = OutputStreamWriter(zip, Charsets.UTF_8)
    fun part(name: String, body: (Appendable) -> Unit) {
      zip.putNextEntry(ZipEntry(name))
      writer.write(XML_HEAD)
      body(writer)
      writer.flush()
      zip.closeEntry()
    }

    part("[Content_Types].xml") { w ->
      w.append("""<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">""")
      w.append("""<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>""")
      w.append("""<Default Extension="xml" ContentType="application/xml"/>""")
      w.append("""<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>""")
      w.append("""<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>""")
      sheets.indices.forEach { i ->
        w.append("""<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>""")
      }
      w.append("</Types>")
    }
    part("_rels/.rels") { w ->
      w.append("""<Relationships xmlns="$NS_PACKAGE_RELS">""")
      w.append("""<Relationship Id="rId1" Type="$NS_DOC_RELS/officeDocument" Target="xl/workbook.xml"/>""")
      w.append("</Relationships>")
    }
    part("xl/workbook.xml") { w ->
      w.append("""<workbook xmlns="$NS_MAIN" xmlns:r="$NS_DOC_RELS"><sheets>""")
      sheets.forEachIndexed { i, sheet ->
        w.append("""<sheet name="${escape(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>""")
      }
      w.append("</sheets></workbook>")
    }
    part("xl/_rels/workbook.xml.rels") { w ->
      w.append("""<Relationships xmlns="$NS_PACKAGE_RELS">""")
      sheets.indices.forEach { i ->
        w.append("""<Relationship Id="rId${i + 1}" Type="$NS_DOC_RELS/worksheet" Target="worksheets/sheet${i + 1}.xml"/>""")
      }
      w.append("""<Relationship Id="rId${sheets.size + 1}" Type="$NS_DOC_RELS/styles" Target="styles.xml"/>""")
      w.append("</Relationships>")
    }
    part("xl/styles.xml") { it.append(STYLES) }
    sheets.forEachIndexed { i, sheet -> part("xl/worksheets/sheet${i + 1}.xml") { writeSheet(it, sheet) } }

    writer.flush()
    zip.finish()
  }

  private fun writeSheet(w: Appendable, sheet: Sheet) {
    w.append("""<worksheet xmlns="$NS_MAIN" xmlns:r="$NS_DOC_RELS">""")
    // Header row stays put while scrolling.
    w.append("""<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>""")
    w.append("<cols>")
    sheet.columns.forEachIndexed { i, col ->
      w.append("""<col min="${i + 1}" max="${i + 1}" width="${col.width}" customWidth="1"${if (col.hidden) " hidden=\"1\"" else ""}/>""")
    }
    w.append("</cols><sheetData>")
    writeRow(w, 1, sheet.columns.map { Cell.Text(it.title) }, STYLE_HEADER)
    sheet.rows.forEachIndexed { i, row -> writeRow(w, i + 2, row, 0) }
    w.append("</sheetData></worksheet>")
  }

  private fun writeRow(w: Appendable, index: Int, cells: List<Cell>, style: Int) {
    w.append("""<row r="$index">""")
    cells.forEachIndexed { col, cell ->
      val ref = columnName(col) + index
      when (cell) {
        Cell.Empty -> Unit
        is Cell.Text -> {
          w.append("""<c r="$ref" t="inlineStr"""")
          if (style != 0) w.append(""" s="$style"""")
          w.append("""><is><t xml:space="preserve">""").append(escape(cell.value)).append("</t></is></c>")
        }
        is Cell.Number -> {
          w.append("""<c r="$ref"""")
          if (cell.style != 0) w.append(""" s="${cell.style}"""")
          w.append("><v>").append(number(cell.value)).append("</v></c>")
        }
      }
    }
    w.append("</row>")
  }

  private fun number(value: Double): String =
    if (value % 1.0 == 0.0 && kotlin.math.abs(value) < 1e15) value.toLong().toString()
    else BigDecimal(value).setScale(10, RoundingMode.HALF_UP).stripTrailingZeros().toPlainString()

  fun columnName(index: Int): String {
    var n = index + 1
    val sb = StringBuilder()
    while (n > 0) {
      val r = (n - 1) % 26
      sb.insert(0, ('A' + r))
      n = (n - 1) / 26
    }
    return sb.toString()
  }

  private fun columnIndex(ref: String): Int? {
    var n = 0
    for (ch in ref) {
      if (ch in 'A'..'Z') n = n * 26 + (ch - 'A' + 1)
      else if (ch in 'a'..'z') n = n * 26 + (ch - 'a' + 1)
      else break
    }
    return if (n == 0) null else n - 1
  }

  /** XML-escapes text and drops characters XML 1.0 can't carry (stray control chars in notifications). */
  private fun escape(text: String): String {
    val sb = StringBuilder(text.length + 16)
    for (ch in text) {
      when {
        ch == '&' -> sb.append("&amp;")
        ch == '<' -> sb.append("&lt;")
        ch == '>' -> sb.append("&gt;")
        ch == '"' -> sb.append("&quot;")
        ch == '\t' || ch == '\n' || ch == '\r' -> sb.append(ch)
        ch < ' ' || ch == '￾' || ch == '￿' -> Unit
        else -> sb.append(ch)
      }
    }
    return sb.toString()
  }

  // ---- Reading ----

  private const val MAX_PART_BYTES = 64L * 1024 * 1024
  private const val MAX_TOTAL_BYTES = 128L * 1024 * 1024

  fun read(input: InputStream): Workbook {
    val parts = unzip(input)
    if ("[Content_Types].xml" !in parts) throw FormatException("Not an xlsx file")

    val workbookPath = relationships(parts, "_rels/.rels", "")
      .values.firstOrNull { it.first.endsWith("/officeDocument") }?.second ?: "xl/workbook.xml"
    val workbookXml = parts[workbookPath] ?: throw FormatException("No workbook")
    val baseDir = workbookPath.substringBeforeLast('/', "")
    val rels = relationships(parts, "$baseDir/_rels/${workbookPath.substringAfterLast('/')}.rels", baseDir)

    val shared = rels.values.firstOrNull { it.first.endsWith("/sharedStrings") }?.second?.let { parts[it] }?.let(::sharedStrings)
      ?: emptyList()

    var date1904 = false
    val sheetRefs = mutableListOf<Pair<String, String>>()
    parse(workbookXml) { p ->
      when (p.localName()) {
        "workbookPr" -> date1904 = p.attr("date1904").let { it == "1" || it == "true" }
        "sheet" -> {
          val rid = p.attr("id") ?: return@parse
          val target = rels[rid]?.second ?: return@parse
          sheetRefs += (p.attr("name") ?: "") to target
        }
      }
    }
    val sheets = sheetRefs.mapNotNull { (name, path) -> parts[path]?.let { ReadSheet(name, sheetRows(it, shared)) } }
    return Workbook(sheets, date1904)
  }

  private fun unzip(input: InputStream): Map<String, ByteArray> {
    val parts = HashMap<String, ByteArray>()
    var total = 0L
    try {
      ZipInputStream(input).use { zip ->
        while (true) {
          val entry = zip.nextEntry ?: break
          val name = entry.name.trimStart('/')
          if (entry.isDirectory || !(name.endsWith(".xml") || name.endsWith(".rels"))) continue
          val buffer = java.io.ByteArrayOutputStream()
          val chunk = ByteArray(16 * 1024)
          while (true) {
            val n = zip.read(chunk)
            if (n < 0) break
            buffer.write(chunk, 0, n)
            total += n
            if (buffer.size() > MAX_PART_BYTES || total > MAX_TOTAL_BYTES) throw FormatException("File too large")
          }
          parts[name] = buffer.toByteArray()
        }
      }
    } catch (e: java.util.zip.ZipException) {
      throw FormatException("Not an xlsx file")
    }
    return parts
  }

  /** Relationship id -> (type, resolved part path). */
  private fun relationships(parts: Map<String, ByteArray>, path: String, baseDir: String): Map<String, Pair<String, String>> {
    val xml = parts[path.trimStart('/')] ?: return emptyMap()
    val out = HashMap<String, Pair<String, String>>()
    parse(xml) { p ->
      if (p.localName() != "Relationship") return@parse
      val id = p.attr("Id") ?: return@parse
      val target = p.attr("Target") ?: return@parse
      if (p.attr("TargetMode") == "External") return@parse
      out[id] = (p.attr("Type") ?: "") to resolve(baseDir, target)
    }
    return out
  }

  private fun resolve(baseDir: String, target: String): String {
    if (target.startsWith("/")) return target.trimStart('/')
    val segments = if (baseDir.isEmpty()) mutableListOf() else baseDir.split('/').toMutableList()
    for (s in target.split('/')) {
      when (s) {
        ".." -> if (segments.isNotEmpty()) segments.removeAt(segments.size - 1)
        ".", "" -> Unit
        else -> segments += s
      }
    }
    return segments.joinToString("/")
  }

  private fun sharedStrings(xml: ByteArray): List<String> {
    val out = ArrayList<String>()
    val parser = newParser(xml)
    var current: StringBuilder? = null
    var phonetic = 0
    var inText = false
    while (true) {
      when (parser.next()) {
        XmlPullParser.END_DOCUMENT -> return out
        XmlPullParser.START_TAG -> when (parser.localName()) {
          "si" -> current = StringBuilder()
          "rPh" -> phonetic++
          "t" -> inText = phonetic == 0
        }
        XmlPullParser.END_TAG -> when (parser.localName()) {
          "si" -> {
            out += current?.toString() ?: ""
            current = null
          }
          "rPh" -> phonetic--
          "t" -> inText = false
        }
        XmlPullParser.TEXT -> if (inText) current?.append(parser.text)
      }
    }
  }

  private fun sheetRows(xml: ByteArray, shared: List<String>): List<List<Any?>> {
    val rows = ArrayList<MutableList<Any?>>()
    val parser = newParser(xml)
    var row: MutableList<Any?>? = null
    var col = 0
    var type: String? = null
    var value: StringBuilder? = null
    var inline: StringBuilder? = null
    var inValue = false
    var inInlineText = false

    fun place(target: MutableList<Any?>, index: Int, v: Any?) {
      while (target.size <= index) target += null
      target[index] = v
    }

    while (true) {
      when (parser.next()) {
        XmlPullParser.END_DOCUMENT -> return rows
        XmlPullParser.START_TAG -> when (parser.localName()) {
          "row" -> {
            val index = parser.attr("r")?.toIntOrNull()?.minus(1) ?: rows.size
            while (rows.size < index) rows.add(mutableListOf())
            row = mutableListOf()
            col = 0
          }
          "c" -> {
            col = parser.attr("r")?.let(::columnIndex) ?: col
            type = parser.attr("t")
            value = null
            inline = null
          }
          "v" -> {
            inValue = true
            value = StringBuilder()
          }
          "is" -> inline = StringBuilder()
          "t" -> inInlineText = inline != null
        }
        XmlPullParser.END_TAG -> when (parser.localName()) {
          "v" -> inValue = false
          "t" -> inInlineText = false
          "c" -> {
            val raw = value?.toString()
            val v: Any? = when (type) {
              "s" -> raw?.trim()?.toIntOrNull()?.let { shared.getOrNull(it) }
              "inlineStr" -> inline?.toString() ?: raw
              "str", "d" -> raw
              "b" -> raw?.trim()?.let { it == "1" || it.equals("true", true) }
              "e" -> null
              else -> raw?.trim()?.toDoubleOrNull()
            }
            row?.let { place(it, col, v) }
            col++
          }
          "row" -> {
            row?.let { rows.add(it) }
            row = null
          }
        }
        XmlPullParser.TEXT -> {
          if (inValue) value?.append(parser.text)
          else if (inInlineText) inline?.append(parser.text)
        }
      }
    }
  }

  private fun newParser(xml: ByteArray): XmlPullParser =
    Xml.newPullParser().apply {
      setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
      setInput(ByteArrayInputStream(xml), null)
    }

  private fun parse(xml: ByteArray, onStart: (XmlPullParser) -> Unit) {
    val parser = newParser(xml)
    while (true) {
      when (parser.next()) {
        XmlPullParser.END_DOCUMENT -> return
        XmlPullParser.START_TAG -> onStart(parser)
      }
    }
  }

  // Some writers prefix every tag ("x:row"); namespaces are off, so strip the prefix by hand.
  private fun XmlPullParser.localName(): String = name.substringAfter(':')

  /** Attribute by local name, ignoring any prefix ("r:id" matches "id"). */
  private fun XmlPullParser.attr(local: String): String? {
    for (i in 0 until attributeCount) {
      if (getAttributeName(i).substringAfter(':') == local) return getAttributeValue(i)
    }
    return null
  }

  private const val XML_HEAD = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>""" + "\n"
  private const val NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  private const val NS_DOC_RELS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  private const val NS_PACKAGE_RELS = "http://schemas.openxmlformats.org/package/2006/relationships"

  private const val STYLES = """<styleSheet xmlns="$NS_MAIN">""" +
    """<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/><numFmt numFmtId="165" formatCode="#,##0"/></numFmts>""" +
    """<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>""" +
    """<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>""" +
    """<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>""" +
    """<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>""" +
    """<cellXfs count="4">""" +
    """<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>""" +
    """<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>""" +
    """<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>""" +
    """<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>""" +
    """</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>"""
}
