package expo.modules.balancecore

import android.app.Activity
import android.util.Base64
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
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
 * The "Sign in with Google" sheet from Credential Manager, no browser. Google gets the SHA-256 of a
 * fresh nonce; the raw nonce goes back to JS for Supabase, which checks it against the ID token.
 */
internal object GoogleSignIn {
  suspend fun signIn(activity: Activity, serverClientId: String): Map<String, String> {
    val nonce = ByteArray(32).also(SecureRandom()::nextBytes).let {
      Base64.encodeToString(it, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    }
    val hashed = MessageDigest.getInstance("SHA-256").digest(nonce.toByteArray()).joinToString("") { "%02x".format(it) }

    val option = GetSignInWithGoogleOption.Builder(serverClientId).setNonce(hashed).build()
    val request = GetCredentialRequest.Builder().addCredentialOption(option).build()

    val credential = try {
      CredentialManager.create(activity).getCredential(activity, request).credential
    } catch (e: GetCredentialCancellationException) {
      throw GoogleSignInCancelled()
    } catch (e: NoCredentialException) {
      throw NoGoogleAccount(e)
    } catch (e: GetCredentialException) {
      throw GoogleSignInFailed(e)
    }

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
}
