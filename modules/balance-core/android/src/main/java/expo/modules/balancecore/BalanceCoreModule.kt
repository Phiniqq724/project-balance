package expo.modules.balancecore

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.net.Uri
import android.provider.Settings as AndroidSettings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.ui.ExpoUIView
import java.io.File
import java.util.UUID

class BalanceCoreModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("BalanceCore")

    ExpoUIView<FlowChartProps>("FlowChart") {
      Content { props -> FlowChartContent(props) }
    }

    Events("onLedgerChanged")

    OnStartObserving("onLedgerChanged") {
      BalanceEvents.listener = { sendEvent("onLedgerChanged", emptyMap<String, Any>()) }
    }

    OnStopObserving("onLedgerChanged") {
      BalanceEvents.listener = null
    }

    Function("hasNotificationAccess") {
      val enabled = AndroidSettings.Secure.getString(context.contentResolver, "enabled_notification_listeners").orEmpty()
      enabled.split(':').mapNotNull(ComponentName::unflattenFromString).any { it.packageName == context.packageName }
    }

    Function("openNotificationAccessSettings") {
      val component = ComponentName(context, BalanceListenerService::class.java).flattenToString()
      val intent = Intent("android.settings.NOTIFICATION_LISTENER_DETAIL_SETTINGS")
        .putExtra("android.provider.extra.NOTIFICATION_LISTENER_COMPONENT_NAME", component)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      val fallback = Intent(AndroidSettings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      runCatching { context.startActivity(intent) }.onFailure { context.startActivity(fallback) }
    }

    Function("appLabel") { pkg: String ->
      runCatching {
        val pm = context.packageManager
        @Suppress("DEPRECATION")
        pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
      }.getOrNull()
    }

    // Every app with a launcher icon, with its icon cached as a PNG so Compose can load it by URI.
    AsyncFunction("installedApps") {
      val pm = context.packageManager
      val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
      val dir = File(context.cacheDir, "app-icons").apply { mkdirs() }
      val size = (48 * context.resources.displayMetrics.density).toInt()
      @Suppress("DEPRECATION")
      pm.queryIntentActivities(launcher, 0)
        .map { it.activityInfo.applicationInfo }
        .distinctBy { it.packageName }
        .filter { it.packageName != context.packageName }
        .map { info ->
          @Suppress("DEPRECATION")
          val updated = runCatching { pm.getPackageInfo(info.packageName, 0).lastUpdateTime }.getOrDefault(0L)
          val file = File(dir, "${info.packageName}-$updated.png")
          if (!file.exists()) {
            runCatching {
              val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
              val drawable = pm.getApplicationIcon(info)
              drawable.setBounds(0, 0, size, size)
              drawable.draw(Canvas(bitmap))
              file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
              bitmap.recycle()
            }
          }
          mapOf(
            "package" to info.packageName,
            "label" to pm.getApplicationLabel(info).toString(),
            "icon" to if (file.exists()) Uri.fromFile(file).toString() else null
          )
        }
        .sortedBy { (it["label"] ?: "").lowercase() }
    }

    AsyncFunction("query") { sql: String, args: List<Any?>? ->
      BalanceDb.get(context).query(sql, args.orEmpty())
    }

    AsyncFunction("setTransactionCategory") { id: Long, categoryId: String? ->
      Ledger.write(context) { db ->
        db.writableDatabase.execSQL(
          "UPDATE transactions SET category_id = ?, category_locked = 1 WHERE id = ?",
          arrayOf(categoryId, id)
        )
      }
    }

    AsyncFunction("setTransactionTransfer") { id: Long, isTransfer: Boolean ->
      Ledger.write(context) { db ->
        db.writableDatabase.execSQL(
          "UPDATE transactions SET is_transfer = ?, transfer_locked = 1 WHERE id = ?",
          arrayOf<Any>(if (isTransfer) 1 else 0, id)
        )
      }
    }

    AsyncFunction("saveCategory") { id: String?, name: String, keywords: String ->
      Ledger.write(context) { db ->
        val sqlite = db.writableDatabase
        val categoryId = id ?: UUID.randomUUID().toString()
        if (id == null) {
          sqlite.execSQL(
            "INSERT INTO categories (id, name, keywords, position) VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM categories))",
            arrayOf(categoryId, name.trim(), keywords)
          )
        } else {
          sqlite.execSQL("UPDATE categories SET name = ?, keywords = ? WHERE id = ?", arrayOf(name.trim(), keywords, id))
        }
        Ledger.recategorize(db)
        categoryId
      }
    }

    AsyncFunction("deleteCategory") { id: String ->
      Ledger.write(context) { db ->
        db.writableDatabase.execSQL("DELETE FROM categories WHERE id = ?", arrayOf(id))
        Ledger.recategorize(db)
      }
    }

    AsyncFunction("getSetting") { key: String ->
      BalanceDb.get(context).getSetting(key)
    }

    AsyncFunction("setSetting") { key: String, value: String ->
      Ledger.write(context) { db ->
        db.setSetting(key, value)
        // Watched apps and self names change what counts as a transaction or a transfer.
        if (key == Settings.WATCHED_PACKAGES || key == Settings.SELF_NAMES) Ledger.reprocessAll(db)
      }
    }

    AsyncFunction("reprocessAll") {
      Ledger.write(context) { db -> Ledger.reprocessAll(db) }
    }

    // AI review (cloud mode). JS calls the edge function and hands results back here.
    AsyncFunction("setAiReview") { on: Boolean ->
      Ledger.write(context) { db -> Ledger.setAiEnabled(db, on) }
    }

    AsyncFunction("aiSuggest") { rawId: Long, kind: String, direction: String, amount: Long, counterparty: String?, confidence: Double ->
      requireReview(kind, direction, amount)
      Ledger.write(context) { db -> Ledger.suggest(db, rawId, kind, direction, amount, counterparty, confidence) }
    }

    AsyncFunction("aiFailed") { rawId: Long ->
      Ledger.write(context) { db -> Ledger.reviewFailed(db, rawId) }
    }

    AsyncFunction("aiResolve") { rawId: Long, kind: String, direction: String, amount: Long, counterparty: String? ->
      requireReview(kind, direction, amount)
      Ledger.write(context) { db -> Ledger.resolve(db, rawId, kind, direction, amount, counterparty?.trim()?.takeIf { it.isNotEmpty() }) }
    }

    // Supabase's session storage. Synchronous so the client can read it before the first render.
    Function("getAuthItem") { key: String -> Account.getAuthItem(context, key) }
    Function("setAuthItem") { key: String, value: String -> Account.setAuthItem(context, key, value) }
    Function("removeAuthItem") { key: String -> Account.removeAuthItem(context, key) }

    AsyncFunction("setActiveUser") { userId: String? ->
      Ledger.switchUser(context, userId)
    }

    // Whose ledger is open: a user id, "local", or null before anything is chosen.
    Function("activeUser") { Account.userId(context) }

    AsyncFunction("mergeFromCloud") { userId: String, categories: List<CloudCategory>, transactions: List<CloudTransaction>, selfNames: String? ->
      Ledger.write(context) { db ->
        // Only into the ledger it was fetched for; the owner may have changed while the fetch ran.
        if (Account.userId(context) != userId) false else LedgerMerge.mergeCloud(db, userId, categories, transactions, selfNames)
      }
    }

    AsyncFunction("signInWithGoogle") Coroutine { serverClientId: String ->
      val activity = appContext.currentActivity ?: throw Exceptions.MissingActivity()
      GoogleSignIn.signIn(activity, serverClientId)
    }

    AsyncFunction("refreshWidgets") {
      WidgetBridge.refresh(context)
    }
  }

  private fun requireReview(kind: String, direction: String, amount: Long) {
    require(kind in setOf("income", "expense", "transfer", "ad_or_other")) { "Unknown kind $kind" }
    require(direction == "in" || direction == "out") { "Unknown direction $direction" }
    require(amount >= 0) { "Negative amount" }
  }
}
