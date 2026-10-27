package expo.modules.balancecore

import android.app.Notification
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

class BalanceListenerService : NotificationListenerService() {
  // The spend grid and "today" totals roll over at midnight even when no notification arrives.
  private val dayChangeReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      WidgetBridge.refresh(context)
    }
  }
  private var receiverRegistered = false

  override fun onListenerConnected() {
    super.onListenerConnected()
    registerDayChange()
    // Catch anything that arrived while the listener was off. Duplicates are dropped by the DB.
    val active = runCatching { activeNotifications }.getOrNull().orEmpty()
    Ledger.ingestAsync(this, active.mapNotNull(::toRaw))
  }

  override fun onListenerDisconnected() {
    unregisterDayChange()
    super.onListenerDisconnected()
  }

  override fun onDestroy() {
    unregisterDayChange()
    super.onDestroy()
  }

  override fun onNotificationPosted(sbn: StatusBarNotification) {
    toRaw(sbn)?.let { Ledger.ingestAsync(this, listOf(it)) }
  }

  private fun toRaw(sbn: StatusBarNotification): RawNotification? {
    val notification = sbn.notification ?: return null
    // Group summaries repeat their children's text (or carry none).
    if (notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) return null
    val extras = notification.extras ?: return null
    val body = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
      ?: extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
      ?: return null
    return RawNotification(
      pkg = sbn.packageName,
      title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString(),
      body = body,
      postedAt = sbn.postTime,
    )
  }

  private fun registerDayChange() {
    if (receiverRegistered) return
    val filter = IntentFilter().apply {
      addAction(Intent.ACTION_DATE_CHANGED)
      addAction(Intent.ACTION_TIME_CHANGED)
      addAction(Intent.ACTION_TIMEZONE_CHANGED)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(dayChangeReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      registerReceiver(dayChangeReceiver, filter)
    }
    receiverRegistered = true
  }

  private fun unregisterDayChange() {
    if (!receiverRegistered) return
    runCatching { unregisterReceiver(dayChangeReceiver) }
    receiverRegistered = false
  }
}
