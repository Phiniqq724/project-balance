package expo.modules.balancecore

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Redraws the spending grid when its widget is resized, so a 2x2 stretched to 4x2 gets the full
 * header and a grid drawn for the new width. Sent by the expo-widgets patch in patches/.
 */
class WidgetResizedReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.getStringExtra("widgetName") != "SpendGrid") return
    val app = context.applicationContext
    val pending = goAsync()
    Thread {
      try {
        WidgetBridge.refresh(app)
      } catch (_: Exception) {
        // No ledger open yet (signed out): the next app open draws it.
      } finally {
        pending.finish()
      }
    }.start()
  }
}
