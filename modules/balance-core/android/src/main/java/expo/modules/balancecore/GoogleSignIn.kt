package expo.modules.balancecore

import android.app.Activity
import android.util.Base64
import androidx.credentials.Credential
import androidx.credentials.CredentialManager
import androidx.credentials.CredentialOption
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import expo.modules.kotlin.exception.CodedException
import java.security.MessageDigest
import java.security.SecureRandom

internal class GoogleSignInCancelled : CodedException("ERR_CANCELLED", "Google sign-in was cancelled", null)
internal class NoGoogleAccount(cause: Throwable) : CodedException("ERR_NO_ACCOUNT", "No Google account on this phone", cause)
internal class GoogleSignInFailed(cause: Throwable?) : CodedException("ERR_GOOGLE_SIGN_IN", cause?.message ?: "Google sign-in failed", cause)

/**
 * Credential Manager's account bottom sheet, no browser: accounts already used here first (one taps
 * in by itself), then every account on the phone. The full "Sign in with Google" dialog is only the
 * fallback for a phone with no Google account, since it can add one. Google gets the SHA-256 of a
 * fresh nonce; the raw nonce goes back to JS for Supabase, which checks it against the ID token.
 */
internal object GoogleSignIn {
  suspend fun signIn(activity: Activity, serverClientId: String): Map<String, String> {
    val nonce = ByteArray(32).also(SecureRandom()::nextBytes).let {
      Base64.encodeToString(it, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    }
    val hashed = MessageDigest.getInstance("SHA-256").digest(nonce.toByteArray()).joinToString("") { "%02x".format(it) }

    val manager = CredentialManager.create(activity)
    suspend fun get(option: CredentialOption): Credential? = try {
      manager.getCredential(activity, GetCredentialRequest.Builder().addCredentialOption(option).build()).credential
    } catch (e: NoCredentialException) {
      null
    } catch (e: GetCredentialCancellationException) {
      throw GoogleSignInCancelled()
    } catch (e: GetCredentialException) {
      throw GoogleSignInFailed(e)
    }
    fun sheet(returning: Boolean) = GetGoogleIdOption.Builder()
      .setServerClientId(serverClientId)
      .setNonce(hashed)
      .setFilterByAuthorizedAccounts(returning)
      .setAutoSelectEnabled(returning)
      .build()

    val credential = get(sheet(returning = true))
      ?: get(sheet(returning = false))
      ?: get(GetSignInWithGoogleOption.Builder(serverClientId).setNonce(hashed).build())
      ?: throw NoGoogleAccount(NoCredentialException())

    if (credential !is CustomCredential || credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
      throw GoogleSignInFailed(null)
    }
    val token = try {
      GoogleIdTokenCredential.createFrom(credential.data).idToken
    } catch (e: GoogleIdTokenParsingException) {
      throw GoogleSignInFailed(e)
    }
    return mapOf("idToken" to token, "nonce" to nonce)
  }

  /** After signing out, so the next sign-in shows the accounts instead of picking the last one. */
  suspend fun forget(context: android.content.Context) {
    runCatching { CredentialManager.create(context).clearCredentialState(androidx.credentials.ClearCredentialStateRequest()) }
  }
}
