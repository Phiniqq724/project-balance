package expo.modules.balancecore

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import java.util.Locale
import org.json.JSONObject

/**
 * One notification per item that needs an answer (an AI suggestion, a failed read, or an
 * unreadable money-looking notification with no AI), with Yes / Not money / Fix on it.
 * The id is the raw notification id. [syncOpen] drops whatever got answered elsewhere.
 */
internal object ReviewNotifier {
  private const val CHANNEL = "review"
  private const val GROUP = "balance.review"
  private const val SUMMARY_ID = -1
  private const val ACCENT = 0xFFFF7444.toInt()
  // Results of a bulk re-read or import for old notifications stay quiet.
  private const val RECENT_MS = 24 * 60 * 60 * 1000L
  const val ACTION_YES = "expo.modules.balancecore.REVIEW_YES"
  const val ACTION_NOT_MONEY = "expo.modules.balancecore.REVIEW_NOT_MONEY"
  const val EXTRA_RAW_ID = "raw_id"

  class Item(
    val rawId: Long,
    val pkg: String,
    val title: String?,
    val body: String,
    val postedAt: Long,
    val state: String?,
    val kind: String?,
    val direction: String?,
    val amount: Long?,
    val counterparty: String?,
  ) {
    /** The suggestion, when there is one to say yes to. */
    val suggestion: Boolean get() = state == "suggested" && kind != null && direction != null && amount != null
  }

  /** Null unless this notification still waits for an answer. */
  fun load(db: BalanceDb, rawId: Long): Item? =
    db.readableDatabase.rawQuery(
      """
      SELECT r.package, r.title, r.body, r.posted_at, a.state, a.kind, a.direction, a.amount, a.counterparty
      FROM raw_notifications r LEFT JOIN ai_reviews a ON a.raw_id = r.id
      WHERE r.id = ? AND r.status = 'unparsed' AND (a.state IS NULL OR a.state IN ('suggested', 'failed'))
      """,
      arrayOf(rawId.toString())
    ).use { c ->
      if (!c.moveToFirst()) null
      else Item(
        rawId, c.getString(0), c.getString(1), c.getString(2), c.getLong(3), c.getString(4), c.getString(5), c.getString(6),
        if (c.isNull(7)) null else c.getLong(7), c.getString(8)
      )
    }

  fun enabled(context: Context, db: BalanceDb): Boolean =
    db.getSetting(Settings.REVIEW_ALERTS) != "0" && NotificationManagerCompat.from(context).areNotificationsEnabled()

  /** Posts the item's notification if it needs an answer, or clears it if it doesn't. Writer thread. */
  fun notifyOpen(context: Context, db: BalanceDb, rawId: Long, recentOnly: Boolean) {
    val app = context.applicationContext
    val item = load(db, rawId)
    // No AI read: only what looks like money is worth a ping.
    if (item == null || (item.state == null && !Prefilter.isCandidate(item.title, item.body))) {
      cancel(app, rawId)
      return
    }
    if (recentOnly && System.currentTimeMillis() - item.postedAt > RECENT_MS) return
    if (!enabled(app, db)) return
    post(app, item)
  }

  /** Cancels every notification of ours whose item was answered or went away. */
  fun syncOpen(context: Context) {
    val app = context.applicationContext
    val shown = active(app).filter { it != SUMMARY_ID }
    if (shown.isEmpty()) return
    val db = BalanceDb.get(app)
    val open = db.readableDatabase.rawQuery(
      """
      SELECT r.id FROM raw_notifications r LEFT JOIN ai_reviews a ON a.raw_id = r.id
      WHERE r.status = 'unparsed' AND (a.state IS NULL OR a.state IN ('suggested', 'failed'))
      """,
      null
    ).use { c -> buildSet { while (c.moveToNext()) add(c.getInt(0)) } }
    val gone = shown.filter { it !in open }
    gone.forEach { NotificationManagerCompat.from(app).cancel(it) }
    if (gone.isNotEmpty()) updateSummary(app, include = null, exclude = gone.toSet())
  }

  fun cancel(context: Context, rawId: Long) {
    val id = rawId.toInt()
    if (id !in active(context)) return
    NotificationManagerCompat.from(context).cancel(id)
    updateSummary(context, include = null, exclude = setOf(id))
  }

  /** Old account's items must not linger after sign-out or a switch. */
  fun cancelAll(context: Context) {
    val manager = NotificationManagerCompat.from(context)
    active(context).forEach { manager.cancel(it) }
  }

  private fun active(context: Context): List<Int> =
    (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).activeNotifications
      .filter { it.notification.group == GROUP }
      .map { it.id }

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL) == null) {
      manager.createNotificationChannel(NotificationChannel(CHANNEL, "To check", NotificationManager.IMPORTANCE_DEFAULT))
    }
  }

  private fun post(context: Context, item: Item) {
    ensureChannel(context)
    val id = item.rawId.toInt()
    val title = if (item.suggestion) question(item) else if (item.kind == "ad_or_other") "Not a transaction?" else "Not sure about this one"
    val label = runCatching {
      val pm = context.packageManager
      @Suppress("DEPRECATION")
      pm.getApplicationLabel(pm.getApplicationInfo(item.pkg, 0)).toString()
    }.getOrDefault(item.pkg)

    val builder = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(R.drawable.ic_review)
      .setColor(ACCENT)
      .setContentTitle(title)
      .setContentText("$label · ${item.body}")
      .setStyle(NotificationCompat.BigTextStyle().bigText(item.body).setSummaryText(label))
      .setWhen(item.postedAt)
      .setAutoCancel(true)
      .setOnlyAlertOnce(true)
      .setGroup(GROUP)
      .setContentIntent(open(context, "projectbalance://unparsed", id * 4))
    if (item.suggestion && item.kind != "ad_or_other") builder.addAction(0, "Yes", answer(context, ACTION_YES, item.rawId, id * 4 + 1))
    builder.addAction(0, "Not money", answer(context, ACTION_NOT_MONEY, item.rawId, id * 4 + 2))
    builder.addAction(0, "Fix", open(context, "projectbalance://unparsed?fix=${item.rawId}", id * 4 + 3))

    try {
      NotificationManagerCompat.from(context).notify(id, builder.build())
    } catch (_: SecurityException) {
      return // Permission taken away since we checked.
    }
    updateSummary(context, include = id, exclude = emptySet())
  }

  /** "N to check" once there are two or more; the system folds them under it. */
  private fun updateSummary(context: Context, include: Int?, exclude: Set<Int>) {
    val manager = NotificationManagerCompat.from(context)
    val ids = (active(context).filter { it != SUMMARY_ID } + listOfNotNull(include)).toSet() - exclude
    if (ids.size < 2) {
      manager.cancel(SUMMARY_ID)
      return
    }
    val summary = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(R.drawable.ic_review)
      .setColor(ACCENT)
      .setContentTitle("${ids.size} to check")
      .setGroup(GROUP)
      .setGroupSummary(true)
      .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
      .setAutoCancel(true)
      .setContentIntent(open(context, "projectbalance://unparsed", SUMMARY_ID))
      .build()
    try {
      manager.notify(SUMMARY_ID, summary)
    } catch (_: SecurityException) {
    }
  }

  // The package is pinned so the dev and live builds never open each other.
  private fun open(context: Context, uri: String, requestCode: Int): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  private fun answer(context: Context, action: String, rawId: Long, requestCode: Int): PendingIntent {
    val intent = Intent(context, ReviewActionReceiver::class.java).setAction(action).putExtra(EXTRA_RAW_ID, rawId)
    return PendingIntent.getBroadcast(context, requestCode, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  private fun rupiah(value: Long): String = "Rp " + String.format(Locale.US, "%,d", value).replace(',', '.')

  /** Same wording as the inbox card. */
  private fun question(item: Item): String {
    val amount = rupiah(item.amount ?: 0)
    val who = item.counterparty?.takeIf { it.isNotBlank() }
    return when (item.kind) {
      "expense" -> if (who != null) "Spent $amount at $who?" else "Spent $amount?"
      "income" -> if (who != null) "Got $amount from $who?" else "Got $amount?"
      "transfer" -> "Moved $amount between your accounts?"
      else -> "Not a transaction?"
    }
  }
}

/** Yes / Not money from a review notification. Does nothing if the item was answered meanwhile. */
class ReviewActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val rawId = intent.getLongExtra(ReviewNotifier.EXTRA_RAW_ID, -1L)
    val yes = intent.action == ReviewNotifier.ACTION_YES
    if (rawId < 0 || (!yes && intent.action != ReviewNotifier.ACTION_NOT_MONEY)) return
    val app = context.applicationContext
    val pending = goAsync()
    Thread {
      try {
        resolve(app, rawId, yes)
      } finally {
        pending.finish()
      }
    }.start()
  }

  private fun resolve(context: Context, rawId: Long, yes: Boolean) {
    val owner = Account.userId(context) ?: return
    var verdict: ReviewNotifier.Item? = null
    var text: String? = null
    Ledger.write(context) { db ->
      // Same checks on the writer thread, so an answer given in the app first wins.
      val item = ReviewNotifier.load(db, rawId) ?: return@write
      if (yes && !(item.suggestion && item.kind != "ad_or_other")) return@write
      verdict = item
      text = Redact.text(listOfNotNull(item.title?.takeIf { it.isNotEmpty() }, item.body).joinToString(" - "))
      if (yes) Ledger.resolve(db, rawId, item.kind!!, item.direction!!, item.amount!!, item.counterparty?.trim()?.takeIf { it.isNotEmpty() })
      else Ledger.resolve(db, rawId, "ad_or_other", "out", 0, null)
    }
    ReviewNotifier.cancel(context, rawId)
    val item = verdict ?: return
    upload(context, owner, text.orEmpty(), if (yes) item else null)
  }

  /** Best effort: a failed upload only means the model learns less. */
  private fun upload(context: Context, owner: String, text: String, suggestion: ReviewNotifier.Item?) {
    runCatching {
      val url = Account.cloudUrl(context) ?: return
      val session = CloudAuth.session(context, owner, 6_000) ?: return
      val body = JSONObject()
        .put("text", text)
        .put("kind", suggestion?.kind ?: "ad_or_other")
        .put("direction", suggestion?.direction ?: "out")
        .put("amount", suggestion?.amount ?: 0L)
        .put("counterparty", suggestion?.counterparty?.trim()?.takeIf { it.isNotEmpty() } ?: JSONObject.NULL)
      CloudHttp.post(
        "$url/rest/v1/ai_examples",
        CloudAuth.headers(context, session) + ("Prefer" to "return=minimal"),
        body.toString(),
        6_000
      )
    }
  }
}
