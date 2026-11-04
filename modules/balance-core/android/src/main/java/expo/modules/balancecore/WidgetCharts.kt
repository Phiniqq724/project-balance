package expo.modules.balancecore

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.net.Uri
import org.json.JSONObject
import java.io.File
import java.util.Calendar
import java.util.Locale
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Bitmaps for the DailySpend (4x2) and DayByDay (2x2) widgets. expo-widgets can't draw lines or
 * custom bars, so each chart is one PNG sized to its widget, like the spending grid. Props are
 * pushed by WidgetBridge.refresh, so they update with the app closed. Colors follow src/theme.ts.
 */
internal object WidgetCharts {
  private const val TEXT = 0xFFF3EBE2.toInt()
  private const val MUTED = 0xFFAC9F92.toInt()
  private const val LINE = 0xFF3A322C.toInt()
  private const val ACCENT = 0xFFFF7444.toInt()

  /** Matches src/widgets/daily-spend.tsx and day-by-day.tsx: 12dp padding, 24dp header. */
  private const val PAD = 12f
  private const val HEADER = 24f

  fun dailySpendProps(context: Context, db: BalanceDb): JSONObject {
    val today = startOfDay(Calendar.getInstance())
    val days = 30
    val start = (today.clone() as Calendar).apply { add(Calendar.DAY_OF_YEAR, -(days - 1)) }
    val totals = dailyTotals(db, start.timeInMillis)

    val values = DoubleArray(days)
    val cursor = start.clone() as Calendar
    for (i in values.indices) {
      values[i] = (totals[dayKey(cursor)] ?: 0L).toDouble()
      cursor.add(Calendar.DAY_OF_YEAR, 1)
    }

    val (width, height) = widgetSize(context, "DailySpend", 250, 110)
    val file = drawLine(context, values, days, width - PAD * 2, height - PAD * 2 - HEADER)
    return JSONObject()
      .put("chart", Uri.fromFile(file).toString())
      .put("total", WidgetBridge.compact(values.sum().toLong()))
  }

  fun dayByDayProps(context: Context, db: BalanceDb): JSONObject {
    val today = startOfDay(Calendar.getInstance())
    val start = (today.clone() as Calendar).apply { add(Calendar.DAY_OF_YEAR, -6) }
    val totals = dailyTotals(db, start.timeInMillis)

    val values = DoubleArray(7)
    val initials = Array(7) { "" }
    val cursor = start.clone() as Calendar
    for (i in 0 until 7) {
      values[i] = (totals[dayKey(cursor)] ?: 0L).toDouble()
      initials[i] = cursor.getDisplayName(Calendar.DAY_OF_WEEK, Calendar.SHORT, Locale.ENGLISH).take(1)
      cursor.add(Calendar.DAY_OF_YEAR, 1)
    }

    val (width, height) = widgetSize(context, "DayByDay", 110, 110)
    val file = drawBars(context, values, initials, width - PAD * 2, height - PAD * 2 - HEADER)
    return JSONObject()
      .put("chart", Uri.fromFile(file).toString())
      .put("total", WidgetBridge.compact(values.sum().toLong()))
  }

  /** The first placed widget's size in dp (portrait: min width x max height), else the size it's added at. */
  private fun widgetSize(context: Context, name: String, defaultWidth: Int, defaultHeight: Int): Pair<Float, Float> {
    val manager = AppWidgetManager.getInstance(context)
    val component = ComponentName(context.packageName, "${context.packageName}.${name}Provider")
    val id = runCatching { manager.getAppWidgetIds(component) }.getOrNull()?.firstOrNull()
    val options = id?.let { manager.getAppWidgetOptions(it) }
    val width = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH)?.takeIf { it > 0 } ?: defaultWidth
    val height = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT)?.takeIf { it > 0 } ?: defaultHeight
    return width.toFloat() to height.toFloat()
  }

  /** Spend per local day, keyed by dayKey. */
  private fun dailyTotals(db: BalanceDb, from: Long): Map<String, Long> {
    val totals = HashMap<String, Long>()
    val day = Calendar.getInstance()
    db.readableDatabase.rawQuery(
      "SELECT occurred_at, amount FROM transactions WHERE is_transfer = 0 AND direction = 'out' AND occurred_at >= ?",
      arrayOf(from.toString())
    ).use { c ->
      while (c.moveToNext()) {
        day.timeInMillis = c.getLong(0)
        val key = dayKey(day)
        totals[key] = (totals[key] ?: 0L) + c.getLong(1)
      }
    }
    return totals
  }

  private fun newCanvas(context: Context, widthDp: Float, heightDp: Float): Triple<Bitmap, Canvas, Float> {
    val density = context.resources.displayMetrics.density
    val bitmap = Bitmap.createBitmap(
      (widthDp * density).toInt().coerceAtLeast(1),
      (heightDp * density).toInt().coerceAtLeast(1),
      Bitmap.Config.ARGB_8888
    )
    return Triple(bitmap, Canvas(bitmap), density)
  }

  private fun save(context: Context, bitmap: Bitmap, name: String): File {
    val dir = File(context.filesDir, "widgets").apply { mkdirs() }
    val tmp = File(dir, "$name.png.tmp")
    tmp.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    bitmap.recycle()
    val file = File(dir, "$name.png")
    tmp.renameTo(file)
    return file
  }

  private fun font(context: Context): Typeface =
    runCatching { Typeface.createFromAsset(context.assets, "fonts/Satoshi-Medium.otf") }.getOrDefault(Typeface.DEFAULT)

  /** Same look as the Overview line: light line over a soft fill, two rules, accent dot on today. */
  private fun drawLine(context: Context, values: DoubleArray, days: Int, widthDp: Float, heightDp: Float): File {
    val (bitmap, canvas, density) = newCanvas(context, widthDp, heightDp)
    val w = bitmap.width.toFloat()
    val h = bitmap.height.toFloat()
    val top = 2 * density
    val bottom = h - 2 * density
    val peak = (values.maxOrNull() ?: 0.0).takeIf { it > 0 } ?: 1.0
    val scale = niceCeil(peak)
    fun x(i: Int) = (i + 0.5f) * (w / days)
    fun y(v: Double) = bottom - (v / scale).toFloat() * (bottom - top)

    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    paint.color = LINE
    paint.strokeWidth = density
    canvas.drawLine(0f, y(0.0), w, y(0.0), paint)
    canvas.drawLine(0f, y(scale), w, y(scale), paint)

    if (values.any { it > 0 }) {
      val label = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = MUTED
        textSize = 10 * density
        typeface = font(context)
      }
      canvas.drawText(WidgetBridge.compact(scale.toLong()), 0f, y(scale) - 3 * density + label.textSize, label)
    }

    val points = values.mapIndexed { i, v -> x(i) to y(v) }
    if (points.size > 1) {
      val line = smoothPath(points)
      val area = Path(line).apply {
        lineTo(points.last().first, bottom)
        lineTo(points.first().first, bottom)
        close()
      }
      paint.style = Paint.Style.FILL
      paint.shader = LinearGradient(0f, top, 0f, bottom, (TEXT and 0x00FFFFFF) or 0x24000000, 0x00000000, Shader.TileMode.CLAMP)
      canvas.drawPath(area, paint)
      paint.shader = null
      paint.style = Paint.Style.STROKE
      paint.strokeWidth = 2 * density
      paint.strokeCap = Paint.Cap.ROUND
      paint.strokeJoin = Paint.Join.ROUND
      paint.color = TEXT
      canvas.drawPath(line, paint)
    }
    paint.style = Paint.Style.FILL
    paint.color = ACCENT
    canvas.drawCircle(points.last().first, points.last().second, 3.5f * density, paint)
    return save(context, bitmap, "daily-spend")
  }

  /** Seven bars, today's in accent and the rest muted, weekday initials underneath. */
  private fun drawBars(context: Context, values: DoubleArray, initials: Array<String>, widthDp: Float, heightDp: Float): File {
    val (bitmap, canvas, density) = newCanvas(context, widthDp, heightDp)
    val w = bitmap.width.toFloat()
    val h = bitmap.height.toFloat()
    val labelSize = 10 * density
    val base = h - labelSize - 6 * density
    val peak = (values.maxOrNull() ?: 0.0).takeIf { it > 0 } ?: 1.0
    val slot = w / values.size
    val barWidth = min(slot * 0.62f, 14 * density)
    val radius = min(barWidth / 2, 3 * density)

    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    val label = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      textSize = labelSize
      typeface = font(context)
      textAlign = Paint.Align.CENTER
    }
    for (i in values.indices) {
      val cx = (i + 0.5f) * slot
      val isToday = i == values.lastIndex
      val v = values[i]
      paint.color = if (v <= 0) LINE else if (isToday) ACCENT else (MUTED and 0x00FFFFFF) or 0x73000000
      val barHeight = if (v <= 0) 2 * density else max((v / peak).toFloat() * (base - 2 * density), 2 * density)
      canvas.drawRoundRect(RectF(cx - barWidth / 2, base - barHeight, cx + barWidth / 2, base), radius, radius, paint)
      label.color = if (isToday) TEXT else MUTED
      canvas.drawText(initials[i], cx, h - 1 * density, label)
    }
    return save(context, bitmap, "day-by-day")
  }

  /** Rounds a chart maximum up to 1, 2 or 5 times a power of ten, like the Overview scale label. */
  private fun niceCeil(value: Double): Double {
    var magnitude = 1.0
    while (magnitude * 10 <= value) magnitude *= 10
    return listOf(1.0, 2.0, 5.0, 10.0).map { it * magnitude }.first { it >= value }
  }

  /** Monotone cubic curve (Fritsch-Carlson): never dips below zero between busy days. */
  private fun smoothPath(points: List<Pair<Float, Float>>): Path = Path().apply {
    moveTo(points[0].first, points[0].second)
    val n = points.size
    val slopes = FloatArray(n - 1) { i -> (points[i + 1].second - points[i].second) / (points[i + 1].first - points[i].first) }
    val tangents = FloatArray(n) { i ->
      when (i) {
        0 -> slopes[0]
        n - 1 -> slopes[n - 2]
        else -> if (slopes[i - 1] * slopes[i] <= 0f) 0f else (slopes[i - 1] + slopes[i]) / 2f
      }
    }
    for (i in 0 until n - 1) {
      if (slopes[i] == 0f) {
        tangents[i] = 0f
        tangents[i + 1] = 0f
        continue
      }
      val a = tangents[i] / slopes[i]
      val b = tangents[i + 1] / slopes[i]
      val hyp = a * a + b * b
      if (hyp > 9f) {
        val t = 3f / sqrt(hyp)
        tangents[i] = t * a * slopes[i]
        tangents[i + 1] = t * b * slopes[i]
      }
    }
    for (i in 0 until n - 1) {
      val (x0, y0) = points[i]
      val (x1, y1) = points[i + 1]
      val dx = (x1 - x0) / 3f
      cubicTo(x0 + dx, y0 + tangents[i] * dx, x1 - dx, y1 - tangents[i + 1] * dx, x1, y1)
    }
  }

  private fun startOfDay(calendar: Calendar): Calendar = (calendar.clone() as Calendar).apply {
    set(Calendar.HOUR_OF_DAY, 0)
    set(Calendar.MINUTE, 0)
    set(Calendar.SECOND, 0)
    set(Calendar.MILLISECOND, 0)
  }

  private fun dayKey(c: Calendar) = "${c.get(Calendar.YEAR)}-${c.get(Calendar.DAY_OF_YEAR)}"
}
