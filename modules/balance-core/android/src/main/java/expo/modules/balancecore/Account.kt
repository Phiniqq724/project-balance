package expo.modules.balancecore

import android.content.Context
import java.io.File

/**
 * Who the ledger belongs to, plus the Supabase session that proves it. Kept in SharedPreferences
 * rather than a ledger file, since it has to be readable before we know which file to open.
 */
internal object Account {
  private const val PREFS = "balance.account"
  private const val USER_ID = "user_id"
  private const val AUTH_PREFIX = "auth:"
  private const val LEGACY_DB = "balance.db"

  private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun userId(context: Context): String? = prefs(context).getString(USER_ID, null)

  fun getAuthItem(context: Context, key: String): String? = prefs(context).getString(AUTH_PREFIX + key, null)

  fun setAuthItem(context: Context, key: String, value: String) {
    prefs(context).edit().putString(AUTH_PREFIX + key, value).commit()
  }

  fun removeAuthItem(context: Context, key: String) {
    prefs(context).edit().remove(AUTH_PREFIX + key).commit()
  }

  /** Only call from the ledger writer thread (see [Ledger.switchUser]). */
  fun switchTo(context: Context, userId: String?) {
    if (userId == userId(context)) return
    BalanceDb.closeCurrent()
    if (userId != null) adoptLegacy(context, userId)
    prefs(context).edit().apply {
      if (userId == null) remove(USER_ID) else putString(USER_ID, userId)
    }.commit()
  }

  /** The ledger from before accounts existed goes to whoever signs in first on this phone. */
  private fun adoptLegacy(context: Context, userId: String) {
    val legacy = context.getDatabasePath(LEGACY_DB)
    val target = context.getDatabasePath(BalanceDb.fileName(userId))
    if (!legacy.exists() || target.exists()) return
    for (suffix in listOf("", "-wal", "-shm", "-journal")) {
      val from = File(legacy.path + suffix)
      if (from.exists()) from.renameTo(File(target.path + suffix))
    }
  }
}
