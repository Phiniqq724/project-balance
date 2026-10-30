package expo.modules.balancecore

import android.app.Notification
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
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
    connected = true
    registerDayChange()
    // Catch anything that arrived while the listener was off. Duplicates are dropped by the DB.
    val active = runCatching { activeNotifications }.getOrNull().orEmpty()
    Ledger.ingestAsync(this, active.mapNotNull(::toRaw))
  }

  override fun onListenerDisconnected() {
    connected = false
    unregisterDayChange()
    super.onListenerDisconnected()
    requestRebind(ComponentName(this, BalanceListenerService::class.java))
  }

  override fun onDestroy() {
    connected = false
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

  companion object {
    @Volatile
    var connected = false
      private set

    private val main = Handler(Looper.getMainLooper())

    fun hasAccess(context: Context): Boolean {
      val enabled = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners").orEmpty()
      return enabled.split(':').mapNotNull(ComponentName::unflattenFromString).any { it.packageName == context.packageName }
    }

    // Android can drop the listener (app update, process killed) while access still reads as granted,
    // and it won't come back until access is toggled. Waits a moment so a bind already underway can land first.
    fun ensureBound(context: Context) {
      val app = context.applicationContext
      main.removeCallbacksAndMessages(null)
      main.postDelayed({
        if (connected || !hasAccess(app)) return@postDelayed
        val component = ComponentName(app, BalanceListenerService::class.java)
        requestRebind(component)
        // requestRebind is ignored when the system still thinks the old binding is alive; re-enabling the component isn't.
        val pm = app.packageManager
        pm.setComponentEnabledSetting(component, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP)
        pm.setComponentEnabledSetting(component, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP)
      }, 2_000)
    }
  }
}
