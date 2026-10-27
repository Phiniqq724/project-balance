package expo.modules.balancecore

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.net.Uri
import org.json.JSONObject
import java.io.File
import java.util.Calendar
import java.util.Locale

/**
 * Pushes fresh props into the expo-widgets layouts without the JS runtime.
 *
 * expo-widgets keeps each widget's props in the "expo.modules.widgets" SharedPreferences under
 * "__expo_widgets_<name>_props" and renders through "<package>.<name>Provider". If an expo-widgets
 * upgrade changes either name, the widgets stop updating from the background (the app still works).
 */
internal object WidgetBridge {
  private const val PREFS = "expo.modules.widgets"
  private const val GAP_RATIO = 0.25f
  private val HEAT = intArrayOf(0xFF2B2420.toInt(), 0xFF5C2D1C.toInt(), 0xFF93401F.toInt(), 0xFFD2582B.toInt(), 0xFFFF7444.toInt())

  @Synchronized
  fun refresh(context: Context) {
    val app = context.applicationContext
    val db = BalanceDb.get(app)
    push(app, "SpendGrid", spendGridProps(app, db))
    push(app, "MonthPulse", monthPulseProps(db))
  }

  private fun push(context: Context, name: String, props: JSONObject) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString("__expo_widgets_${name}_props", props.toString())
      .commit()

    val component = ComponentName(context.packageName, "${context.packageName}.${name}Provider")
    val manager = AppWidgetManager.getInstance(context)
    val ids = runCatching { manager.getAppWidgetIds(component) }.getOrNull() ?: return
    if (ids.isEmpty()) return
    context.sendBroadcast(
      Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
        .setComponent(component)
        .putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
    )
  }

  private fun spendGridProps(context: Context, db: BalanceDb): JSONObject {
    val (widthDp, heightDp) = gridArea(context)
    // Seven rows fill the height; as many week columns as fit the width.
    val unit = heightDp / (7 + 6 * GAP_RATIO)
    val weeks = ((widthDp + unit * GAP_RATIO) / (unit * (1 + GAP_RATIO))).toInt().coerceIn(4, 53)

    val today = startOfDay(Calendar.getInstance())
    // Columns are Monday-first weeks; the last column holds the current week.
    val daysSinceMonday = (today.get(Calendar.DAY_OF_WEEK) + 5) % 7
    val start = (today.clone() as Calendar).apply { add(Calendar.DAY_OF_YEAR, -(daysSinceMonday + (weeks - 1) * 7)) }
    val totals = dailySpend(db, start.timeInMillis)

    val todayIndex = daysSinceMonday + (weeks - 1) * 7
    val values = LongArray(todayIndex + 1)
    val cursor = start.clone() as Calendar
    for (i in values.indices) {
      values[i] = totals[dayKey(cursor)] ?: 0L
      cursor.add(Calendar.DAY_OF_YEAR, 1)
    }
    val levels = levelsFor(values.toList())
    val file = drawGrid(context, weeks, levels, unit)

    return JSONObject()
      .put("weeks", weeks)
      .put("grid", Uri.fromFile(file).toString())
      .put("total", compact(values.sum()))
      .put("today", compact(values[todayIndex]))
  }

  /**
   * The grid's space inside the first placed SpendGrid widget, in dp. The JS layout can't see
   * the widget size and Glance caps rows at 10 children, so the grid is drawn here as one bitmap.
   */
  private fun gridArea(context: Context): Pair<Float, Float> {
    val manager = AppWidgetManager.getInstance(context)
    val component = ComponentName(context.packageName, "${context.packageName}.SpendGridProvider")
    val id = runCatching { manager.getAppWidgetIds(component) }.getOrNull()?.firstOrNull()
    val options = id?.let { manager.getAppWidgetOptions(it) }
    // Portrait size is min width x max height.
    val width = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH)?.takeIf { it > 0 } ?: 300
    val height = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT)?.takeIf { it > 0 } ?: 150
    // Matches the layout in src/widgets/spend-grid.tsx: 14dp padding, ~20dp header, 8dp gap.
    return (width - 28f).coerceAtLeast(80f) to (height - 28f - 28f).coerceAtLeast(40f)
  }

  private fun drawGrid(context: Context, weeks: Int, levels: List<Int>, unitDp: Float): File {
    val density = context.resources.displayMetrics.density
    val cell = unitDp * density
    val gap = cell * GAP_RATIO
    val radius = cell * 0.22f
    val width = (weeks * cell + (weeks - 1) * gap).toInt().coerceAtLeast(1)
    val height = (7 * cell + 6 * gap).toInt().coerceAtLeast(1)

    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    for (i in 0 until weeks * 7) {
      val level = levels.getOrNull(i) ?: continue // Future days stay empty.
      val x = (i / 7) * (cell + gap)
      val y = (i % 7) * (cell + gap)
      paint.color = HEAT[level]
      canvas.drawRoundRect(RectF(x, y, x + cell, y + cell), radius, radius, paint)
    }

    val dir = File(context.filesDir, "widgets").apply { mkdirs() }
    val tmp = File(dir, "spend-grid.png.tmp")
    tmp.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    bitmap.recycle()
    val file = File(dir, "spend-grid.png")
    tmp.renameTo(file)
    return file
  }

  private fun monthPulseProps(db: BalanceDb): JSONObject {
    val now = Calendar.getInstance()
    val monthStart = startOfDay(now).apply { set(Calendar.DAY_OF_MONTH, 1) }
    val today = startOfDay(now)
    val (spent, received) = db.readableDatabase.rawQuery(
      """
      SELECT
        COALESCE(SUM(CASE WHEN direction = 'out' THEN amount END), 0),
        COALESCE(SUM(CASE WHEN direction = 'in' THEN amount END), 0)
      FROM transactions WHERE is_transfer = 0 AND occurred_at >= ?
      """,
      arrayOf(monthStart.timeInMillis.toString())
    ).use { c -> c.moveToFirst(); c.getLong(0) to c.getLong(1) }
    val todaySpent = db.readableDatabase.rawQuery(
      "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE is_transfer = 0 AND direction = 'out' AND occurred_at >= ?",
      arrayOf(today.timeInMillis.toString())
    ).use { c -> c.moveToFirst(); c.getLong(0) }

    return JSONObject()
      .put("month", now.getDisplayName(Calendar.MONTH, Calendar.LONG, Locale.ENGLISH))
      .put("spent", compact(spent))
      .put("received", compact(received))
      .put("today", compact(todaySpent))
  }

  private fun dailySpend(db: BalanceDb, from: Long): Map<String, Long> {
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

  /** GitHub-style: 0 for no spend, then 1-4 by quartile of the days that had spending. */
  fun levelsFor(values: List<Long>): List<Int> {
    val nonZero = values.filter { it > 0 }.sorted()
    if (nonZero.isEmpty()) return values.map { 0 }
    fun quantile(q: Double) = nonZero[((nonZero.size - 1) * q).toInt()]
    val q1 = quantile(0.25)
    val q2 = quantile(0.5)
    val q3 = quantile(0.75)
    return values.map { v ->
      when {
        v <= 0 -> 0
        v <= q1 -> 1
        v <= q2 -> 2
        v <= q3 -> 3
        else -> 4
      }
    }
  }

  /** 1284500 -> "1.28M", 45000 -> "45K", 900 -> "900". */
  fun compact(value: Long): String {
    fun trim(n: Double): String {
      val s = String.format(Locale.US, if (n >= 100) "%.0f" else if (n >= 10) "%.1f" else "%.2f", n)
      return if ('.' in s) s.trimEnd('0').trimEnd('.') else s
    }
    return when {
      value >= 1_000_000_000 -> trim(value / 1_000_000_000.0) + "B"
      value >= 1_000_000 -> trim(value / 1_000_000.0) + "M"
      value >= 1_000 -> trim(value / 1_000.0) + "K"
      else -> value.toString()
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
