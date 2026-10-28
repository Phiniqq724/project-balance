package expo.modules.balancecore

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import java.io.IOException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal class BadAiKey : CodedException("ERR_BAD_KEY", "The key was rejected", null)
internal class AiKeyNoCredit : CodedException("ERR_NO_CREDIT", "The key is out of credit", null)
internal class UnknownAiKey : CodedException("ERR_UNKNOWN_KEY", "Not a Gemini, OpenAI or Claude key", null)
internal class AiKeyNetwork(cause: Throwable?) : CodedException("ERR_NETWORK", "Couldn't reach the provider", cause)

/**
 * The user's own AI key. Per phone, not per ledger: it survives switching between local and Google
 * and goes only on Remove or uninstall. Encrypted with AES-GCM under a key that never leaves the
 * Android Keystore, in a SharedPreferences file of its own. It is never synced, exported, logged or
 * sent anywhere but the provider it belongs to, and JS only ever sees [Info].
 */
internal object AiKey {
  private const val PREFS = "balance.ai_key"
  private const val BLOB = "blob"
  private const val PROVIDER = "provider"
  private const val LAST4 = "last4"
  private const val STATUS = "status"
  private const val ALIAS = "balance_ai_key"
  private const val KEYSTORE = "AndroidKeyStore"
  private const val TRANSFORM = "AES/GCM/NoPadding"
  private const val TAG_BITS = 128
  private const val IV_BYTES = 12
  // Rejected or out of credit: leave the queue alone this long before looking again.
  private const val BLOCK_SECONDS = 3600

  class Stored(val provider: AiProviders.Provider, val key: String)
  class Info(val provider: String, val last4: String, val status: String?)

  private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun isSet(context: Context): Boolean = prefs(context).contains(BLOB)

  /** Provider and last four characters, never the key. */
  fun info(context: Context): Info? {
    val p = prefs(context)
    if (!p.contains(BLOB)) return null
    val provider = p.getString(PROVIDER, null) ?: return null
    return Info(provider, p.getString(LAST4, "").orEmpty(), p.getString(STATUS, null))
  }

  /** For calls to the provider only. */
  fun get(context: Context): Stored? {
    val p = prefs(context)
    val blob = p.getString(BLOB, null) ?: return null
    val provider = AiProviders.Provider.from(p.getString(PROVIDER, null)) ?: return null
    return try {
      val bytes = Base64.decode(blob, Base64.NO_WRAP)
      val cipher = Cipher.getInstance(TRANSFORM).apply {
        init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(TAG_BITS, bytes, 0, IV_BYTES))
      }
      Stored(provider, String(cipher.doFinal(bytes, IV_BYTES, bytes.size - IV_BYTES), Charsets.UTF_8))
    } catch (_: Exception) {
      // The Keystore key is gone (restored backup, reset lock screen): the ciphertext is useless.
      clear(context)
      null
    }
  }

  /** Checks the key with one tiny real call and stores it only if that works. */
  fun validateAndSave(context: Context, raw: String): Info {
    val key = raw.trim()
    val provider = AiProviders.Provider.detect(key) ?: throw UnknownAiKey()
    try {
      AiProviders.classify(provider, key, listOf(AiProviders.Item("1", "", "Rp 10.000 paid to Test")), emptyList())
    } catch (e: AiProviders.Failure) {
      when (e.reason) {
        AiProviders.Reason.BAD_KEY -> throw BadAiKey()
        AiProviders.Reason.NO_CREDIT -> throw AiKeyNoCredit()
        AiProviders.Reason.BUSY -> Unit // It got as far as being rate limited, so the key is real.
        AiProviders.Reason.MODEL -> throw AiKeyNetwork(e)
      }
    } catch (e: IOException) {
      throw AiKeyNetwork(e)
    }
    val cipher = Cipher.getInstance(TRANSFORM).apply { init(Cipher.ENCRYPT_MODE, secretKey()) }
    val blob = cipher.iv + cipher.doFinal(key.toByteArray(Charsets.UTF_8))
    prefs(context).edit()
      .putString(BLOB, Base64.encodeToString(blob, Base64.NO_WRAP))
      .putString(PROVIDER, provider.id)
      .putString(LAST4, key.takeLast(4))
      .remove(STATUS)
      .commit()
    AiReview.block(context, 0)
    BalanceEvents.emitLedgerChanged()
    return Info(provider.id, key.takeLast(4), null)
  }

  fun clear(context: Context) {
    prefs(context).edit().clear().commit()
    runCatching { KeyStore.getInstance(KEYSTORE).apply { load(null) }.deleteEntry(ALIAS) }
    AiReview.block(context, 0)
    BalanceEvents.emitLedgerChanged()
  }

  /** Shown on the Profile row until a pass succeeds. Rejected or out of credit also pause the queue. */
  fun setStatus(context: Context, reason: AiProviders.Reason?) {
    val text = when (reason) {
      AiProviders.Reason.BAD_KEY -> "Key rejected"
      AiProviders.Reason.NO_CREDIT -> "Out of credit"
      else -> null
    }
    val p = prefs(context)
    if (!p.contains(BLOB) || p.getString(STATUS, null) == text) return
    p.edit().apply { if (text == null) remove(STATUS) else putString(STATUS, text) }.commit()
    if (text != null) AiReview.block(context, BLOCK_SECONDS)
    BalanceEvents.emitLedgerChanged()
  }

  private fun secretKey(): SecretKey {
    val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
    (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
    generator.init(
      KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build()
    )
    return generator.generateKey()
  }
}
