package expo.modules.balancecore

import android.graphics.Typeface
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import expo.modules.kotlin.views.ComposeProps
import expo.modules.kotlin.views.FunctionalComposableScope
import expo.modules.kotlin.views.OptimizedComposeProps
import expo.modules.ui.ModifierList
import expo.modules.ui.ModifierRegistry
import kotlin.math.max
import kotlin.math.roundToInt

@OptimizedComposeProps
data class FlowChartProps(
  /** "line": spend per slot vs last period. "bars": spend up, income down, per day. */
  val mode: String = "line",
  /** Line: spend per slot so far (may stop before the end). Bars: spend per slot. */
  val current: List<Double> = emptyList(),
  /** Line: last period's spend per slot, full length. */
  val previous: List<Double> = emptyList(),
  /** Bars: income per slot, drawn below the baseline. */
  val income: List<Double> = emptyList(),
  /** One label per slot; blank entries are not drawn. */
  val ticks: List<String> = emptyList(),
  /** Readout shown while a slot is selected. */
  val readoutLabels: List<String> = emptyList(),
  val readoutValues: List<String> = emptyList(),
  /** Slot shown when nobody is touching the chart. */
  val defaultIndex: Int = -1,
  val textColor: String = "#F3EBE2",
  val mutedColor: String = "#AC9F92",
  val gridColor: String = "#3A322C",
  val incomeColor: String = "#9BCB9F",
  /** The "today" dot and the scrub dot. */
  val accentColor: String = "#FF7444",
  val modifiers: ModifierList = emptyList()
) : ComposeProps

private fun parse(hex: String): Color = Color(android.graphics.Color.parseColor(hex))

/** Scrubbable chart drawn on a Canvas: @expo/ui has no chart components. */
@Composable
fun FunctionalComposableScope.FlowChartContent(props: FlowChartProps) {
  val context = LocalContext.current
  val view = LocalView.current
  val measurer = rememberTextMeasurer()
  val fonts = remember {
    fun load(name: String) = runCatching { FontFamily(Typeface.createFromAsset(context.assets, "fonts/$name.otf")) }
      .getOrDefault(FontFamily.Default)
    load("Satoshi-Medium") to load("Satoshi-Bold")
  }
  val count = max(props.ticks.size, max(props.current.size, max(props.previous.size, props.income.size)))
  var touched by remember { mutableStateOf<Int?>(null) }
  val selected = (touched ?: props.defaultIndex).takeIf { it in 0 until count }

  val colors = ChartColors(parse(props.textColor), parse(props.mutedColor), parse(props.gridColor), parse(props.incomeColor), parse(props.accentColor))
  val style = ChartText(measurer, fonts.first, fonts.second)

  Canvas(
    modifier = ModifierRegistry.applyModifiers(props.modifiers, appContext, composableScope, globalEventDispatcher)
      .pointerInput(count) {
        if (count == 0) return@pointerInput
        fun indexAt(x: Float) = ((x / size.width) * count).toInt().coerceIn(0, count - 1)
        awaitEachGesture {
          val down = awaitFirstDown()
          // Keep the page swiper from stealing a horizontal scrub that starts on the chart.
          view.parent?.requestDisallowInterceptTouchEvent(true)
          touched = indexAt(down.position.x)
          while (true) {
            val event = awaitPointerEvent()
            val change = event.changes.firstOrNull() ?: break
            if (!change.pressed) break
            touched = indexAt(change.position.x)
          }
          touched = null
          view.parent?.requestDisallowInterceptTouchEvent(false)
        }
      }
  ) {
    if (count == 0) return@Canvas
    val readoutHeight = 40.dp.toPx()
    val tickHeight = 22.dp.toPx()
    val plotTop = readoutHeight
    val plotBottom = size.height - tickHeight

    when (props.mode) {
      "bars" -> drawBars(props, count, selected, colors, style, plotTop, plotBottom)
      else -> drawLine(props, count, selected, colors, style, plotTop, plotBottom)
    }
    drawTicks(props.ticks, count, selected, colors, style, size.height - tickHeight + 6.dp.toPx())
    drawReadout(props, selected, colors, style)
  }
}

private data class ChartColors(val text: Color, val muted: Color, val grid: Color, val income: Color, val accent: Color)
private data class ChartText(val measurer: TextMeasurer, val medium: FontFamily, val bold: FontFamily)

private fun slotCenter(width: Float, count: Int, i: Int) = (i + 0.5f) * (width / count)

private fun DrawScope.drawLine(
  props: FlowChartProps,
  count: Int,
  selected: Int?,
  colors: ChartColors,
  text: ChartText,
  top: Float,
  bottom: Float
) {
  val peak = max(props.current.maxOrNull() ?: 0.0, props.previous.maxOrNull() ?: 0.0).takeIf { it > 0 } ?: 1.0
  val scale = niceCeil(peak)
  fun y(v: Double) = bottom - ((v / scale).toFloat() * (bottom - top))

  // Two reference lines: zero and the scale top, labelled on the left (today sits on the right edge).
  for ((value, label) in listOf(0.0 to "0", scale to WidgetBridge.compact(scale.toLong()))) {
    val yy = y(value)
    drawLine(colors.grid, Offset(0f, yy), Offset(size.width, yy), strokeWidth = 1.dp.toPx())
    if (value > 0) {
      val layout = text.measurer.measure(label, TextStyle(color = colors.muted, fontSize = 11.sp, fontFamily = text.medium))
      drawText(layout, topLeft = Offset(0f, yy + 4.dp.toPx()))
    }
  }

  fun pathOf(values: List<Double>): Path =
    smoothPath(values.mapIndexed { i, v -> Offset(slotCenter(size.width, count, i), y(v)) })

  if (props.previous.size > 1) {
    drawPath(
      pathOf(props.previous),
      colors.muted.copy(alpha = 0.7f),
      style = Stroke(width = 1.5.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 5.dp.toPx())))
    )
  }

  if (props.current.isNotEmpty()) {
    val line = pathOf(props.current)
    val lastX = slotCenter(size.width, count, props.current.lastIndex)
    val area = Path().apply {
      addPath(line)
      lineTo(lastX, bottom)
      lineTo(slotCenter(size.width, count, 0), bottom)
      close()
    }
    drawPath(area, Brush.verticalGradient(listOf(colors.text.copy(alpha = 0.14f), Color.Transparent), startY = top, endY = bottom))
    drawPath(line, colors.text, style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
    drawCircle(colors.accent, radius = 3.5.dp.toPx(), center = Offset(lastX, y(props.current.last())))
  }

  selected?.let { i ->
    val x = slotCenter(size.width, count, i)
    drawLine(colors.muted, Offset(x, top), Offset(x, bottom), strokeWidth = 1.dp.toPx())
    props.current.getOrNull(i)?.let { drawCircle(colors.accent, radius = 5.dp.toPx(), center = Offset(x, y(it))) }
    props.previous.getOrNull(i)?.let { drawCircle(colors.muted, radius = 3.5.dp.toPx(), center = Offset(x, y(it))) }
  }
}

private fun DrawScope.drawBars(
  props: FlowChartProps,
  count: Int,
  selected: Int?,
  colors: ChartColors,
  text: ChartText,
  top: Float,
  bottom: Float
) {
  // Spending gets the top 70%, income the bottom 30%; each has its own scale so one salary
  // doesn't flatten every coffee.
  val baseline = top + (bottom - top) * 0.7f
  val outPeak = (props.current.maxOrNull() ?: 0.0).takeIf { it > 0 } ?: 1.0
  val inPeak = (props.income.maxOrNull() ?: 0.0).takeIf { it > 0 } ?: 1.0
  val slot = size.width / count
  val barWidth = (slot * 0.62f).coerceAtMost(14.dp.toPx())
  val radius = CornerRadius(minOf(barWidth / 2, 3.dp.toPx()))
  val dimmed = selected != null

  drawLine(colors.grid, Offset(0f, baseline), Offset(size.width, baseline), strokeWidth = 1.dp.toPx())

  for (i in 0 until count) {
    val x = slotCenter(size.width, count, i) - barWidth / 2
    val focus = !dimmed || i == selected
    props.current.getOrNull(i)?.takeIf { it > 0 }?.let { v ->
      val h = max(((v / outPeak).toFloat() * (baseline - top - 2.dp.toPx())), 2.dp.toPx())
      drawRoundRect(
        if (focus) colors.text else colors.muted.copy(alpha = 0.45f),
        topLeft = Offset(x, baseline - 1.dp.toPx() - h),
        size = Size(barWidth, h),
        cornerRadius = radius
      )
    }
    props.income.getOrNull(i)?.takeIf { it > 0 }?.let { v ->
      val h = max(((v / inPeak).toFloat() * (bottom - baseline - 3.dp.toPx())), 2.dp.toPx())
      drawRoundRect(
        if (focus) colors.income else colors.income.copy(alpha = 0.35f),
        topLeft = Offset(x, baseline + 2.dp.toPx()),
        size = Size(barWidth, h),
        cornerRadius = radius
      )
    }
  }
}

private fun DrawScope.drawTicks(ticks: List<String>, count: Int, selected: Int?, colors: ChartColors, text: ChartText, y: Float) {
  ticks.forEachIndexed { i, label ->
    if (label.isBlank()) return@forEachIndexed
    val layout = text.measurer.measure(
      label,
      TextStyle(color = if (i == selected) colors.text else colors.muted, fontSize = 11.sp, fontFamily = text.medium)
    )
    val x = (slotCenter(size.width, count, i) - layout.size.width / 2f).coerceIn(0f, size.width - layout.size.width)
    drawText(layout, topLeft = Offset(x, y))
  }
}

private fun DrawScope.drawReadout(props: FlowChartProps, selected: Int?, colors: ChartColors, text: ChartText) {
  val i = selected ?: return
  val value = props.readoutValues.getOrNull(i).orEmpty()
  val label = props.readoutLabels.getOrNull(i).orEmpty()
  val valueLayout = text.measurer.measure(value, TextStyle(color = colors.text, fontSize = 16.sp, fontFamily = text.bold))
  val labelLayout = text.measurer.measure(label, TextStyle(color = colors.muted, fontSize = 12.sp, fontFamily = text.medium))
  drawText(valueLayout, topLeft = Offset.Zero)
  drawText(labelLayout, topLeft = Offset(valueLayout.size.width + 8.dp.toPx(), (valueLayout.size.height - labelLayout.size.height) * 0.75f))
}

/** Rounds a chart maximum up to 1, 2 or 5 times a power of ten so the scale label reads cleanly. */
private fun niceCeil(value: Double): Double {
  var magnitude = 1.0
  while (magnitude * 10 <= value) magnitude *= 10
  return listOf(1.0, 2.0, 5.0, 10.0).map { it * magnitude }.first { it >= value }.let { if (it <= 0) 1.0 else it }
    .let { (it).roundToInt().toDouble().coerceAtLeast(1.0) }
}

/**
 * Monotone cubic curve (Fritsch–Carlson) through the points: smooth, but it never overshoots,
 * so a quiet day is never drawn dipping below zero between busy ones.
 */
private fun smoothPath(points: List<Offset>): Path = Path().apply {
  if (points.isEmpty()) return@apply
  moveTo(points[0].x, points[0].y)
  if (points.size == 1) return@apply

  val n = points.size
  val slopes = FloatArray(n - 1) { i -> (points[i + 1].y - points[i].y) / (points[i + 1].x - points[i].x) }
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
    val h = a * a + b * b
    if (h > 9f) {
      val t = 3f / kotlin.math.sqrt(h)
      tangents[i] = t * a * slopes[i]
      tangents[i + 1] = t * b * slopes[i]
    }
  }
  for (i in 0 until n - 1) {
    val p0 = points[i]
    val p1 = points[i + 1]
    val dx = (p1.x - p0.x) / 3f
    cubicTo(p0.x + dx, p0.y + tangents[i] * dx, p1.x - dx, p1.y - tangents[i + 1] * dx, p1.x, p1.y)
  }
}
