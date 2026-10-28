package expo.modules.balancecore

import android.content.Context
import java.io.File

/**
 * Who the ledger belongs to, plus the Supabase session that proves it. Kept in SharedPreferences
 * rather than a ledger file, since it has to be readable before we know which file to open.
 *
 * The owner is a Supabase user id (cloud), [LOCAL] (this phone only, no account) or absent
 * (nothing chosen yet). The listener and widgets read it too, so local mode works with the app closed.
 */
internal object Account {
  /** Owner id for the account-less ledger. Supabase ids are UUIDs, so this never collides. */
  const val LOCAL = "local"

  private const val PREFS = "balance.account"
  private const val USER_ID = "user_id"
  private const val AUTH_PREFIX = "auth:"
  private const val CLOUD_URL = "cloud_url"
  private const val CLOUD_KEY = "cloud_key"
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

  /** Supabase URL and publishable key, handed over by JS so background work can call the cloud. */
  fun setCloudConfig(context: Context, url: String, key: String) {
    prefs(context).edit().putString(CLOUD_URL, url.trimEnd('/')).putString(CLOUD_KEY, key).apply()
  }

  fun cloudUrl(context: Context): String? = prefs(context).getString(CLOUD_URL, null)

  fun cloudKey(context: Context): String? = prefs(context).getString(CLOUD_KEY, null)

  /**
   * Only call from the ledger writer thread (see [Ledger.switchUser]).
   *
   * - local -> account: the phone-only ledger moves into (or merges with) that user's ledger.
   * - account -> local: that user's ledger becomes the phone-only one. Nothing is deleted in the cloud.
   * - anything else: the pre-accounts ledger is adopted if the target has none yet.
   *
   * The owner is written last, so an interrupted switch is simply redone on the next launch.
   */
  fun switchTo(context: Context, target: String?) {
    val previous = userId(context)
    if (target == previous) return
    BalanceDb.closeCurrent()
    when {
      target == null -> Unit
      previous == LOCAL -> LedgerFiles.move(context, BalanceDb.fileName(LOCAL), BalanceDb.fileName(target))
      target == LOCAL && previous != null -> LedgerFiles.move(context, BalanceDb.fileName(previous), BalanceDb.fileName(LOCAL))
      else -> adoptLegacy(context, target)
    }
    prefs(context).edit().apply {
      if (target == null) remove(USER_ID) else putString(USER_ID, target)
    }.commit()
  }

  /** The ledger from before accounts existed goes to whoever starts using the app first on this phone. */
  private fun adoptLegacy(context: Context, owner: String) {
    val legacy = context.getDatabasePath(LEGACY_DB)
    val target = context.getDatabasePath(BalanceDb.fileName(owner))
    if (!legacy.exists() || target.exists()) return
    LedgerFiles.rename(legacy, target)
  }
}

internal object LedgerFiles {
  private val SUFFIXES = listOf("", "-wal", "-shm", "-journal")

  fun rename(from: File, to: File) {
    for (suffix in SUFFIXES) {
      val source = File(from.path + suffix)
      if (source.exists()) source.renameTo(File(to.path + suffix))
    }
  }

  /** Moves ledger [from] to [to], merging into [to] when it already exists. Safe to repeat. */
  fun move(context: Context, from: String, to: String) {
    val source = context.getDatabasePath(from)
    val target = context.getDatabasePath(to)
    if (!source.exists()) return
    if (!target.exists()) {
      rename(source, target)
      return
    }
    // Opening once brings an older file up to the current schema before it's read.
    BalanceDb.withFile(context, from) { it.writableDatabase }
    BalanceDb.withFile(context, to) { db -> LedgerMerge.mergeFile(db, source) }
    context.deleteDatabase(from)
  }
}
