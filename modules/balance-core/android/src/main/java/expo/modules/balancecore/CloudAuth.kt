package expo.modules.balancecore

import android.content.Context
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONException
import org.json.JSONObject

internal class HttpResult(val code: Int, val body: String, val retryAfter: Int?)

internal object CloudHttp {
  /** POSTs [json]. Network failures throw [IOException]; any HTTP status comes back as a result. */
  fun post(url: String, headers: Map<String, String>, json: String, timeoutMs: Int): HttpResult {
    val conn = URL(url).openConnection() as HttpURLConnection
    try {
      conn.requestMethod = "POST"
      conn.connectTimeout = 15_000
      conn.readTimeout = timeoutMs
      conn.doOutput = true
      conn.setRequestProperty("Content-Type", "application/json")
      headers.forEach { (k, v) -> conn.setRequestProperty(k, v) }
      conn.outputStream.use { it.write(json.toByteArray()) }
      val code = conn.responseCode
      val stream = if (code in 200..399) conn.inputStream else conn.errorStream
      val body = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
      return HttpResult(code, body, conn.getHeaderField("Retry-After")?.trim()?.toIntOrNull())
    } finally {
      conn.disconnect()
    }
  }
}

/** The signed-in user's Supabase session, read and refreshed natively so background work can call the cloud. */
internal object CloudAuth {
  private const val REFRESH_MARGIN_S = 60

  class Session(val accessToken: String, val userId: String)

  /**
   * A usable session for [owner], refreshed when it expires within a minute. Null when nobody
   * is signed in or the refresh token was revoked (JS finds that out on its own). The stored
   * JSON keeps the shape supabase-js writes, so the JS client reads it unchanged.
   */
  @Synchronized
  fun session(context: Context, owner: String, timeoutMs: Int = 30_000): Session? {
    val url = Account.cloudUrl(context) ?: return null
    val key = Account.cloudKey(context) ?: return null
    val storageKey = "sb-${URL(url).host.substringBefore('.')}-auth-token"

    var tried: String? = null
    repeat(2) {
      val stored = parse(Account.getAuthItem(context, storageKey)) ?: return null
      val userId = stored.optJSONObject("user")?.optString("id")?.takeIf { it.isNotEmpty() } ?: return null
      if (userId != owner) return null
      val access = stored.optString("access_token")
      val refresh = stored.optString("refresh_token")
      if (access.isEmpty() || refresh.isEmpty()) return null
      if (stored.optLong("expires_at") - System.currentTimeMillis() / 1000 > REFRESH_MARGIN_S) return Session(access, userId)
      // The JS client may have rotated the token since we last looked; then its newer session is the one to use.
      if (refresh == tried) return null
      tried = refresh

      val res = CloudHttp.post(
        "$url/auth/v1/token?grant_type=refresh_token",
        mapOf("apikey" to key),
        JSONObject().put("refresh_token", refresh).toString(),
        timeoutMs
      )
      when {
        res.code in 200..299 -> {
          val fresh = parse(res.body) ?: return null
          if (!fresh.has("expires_at") && fresh.has("expires_in")) {
            fresh.put("expires_at", System.currentTimeMillis() / 1000 + fresh.getLong("expires_in"))
          }
          Account.setAuthItem(context, storageKey, fresh.toString())
          val token = fresh.optString("access_token").takeIf { it.isNotEmpty() } ?: return null
          return Session(token, userId)
        }
        res.code == 400 || res.code == 401 || res.code == 403 -> Unit // Revoked, or rotated under us: look once more.
        else -> throw IOException("refresh ${res.code}")
      }
    }
    return null
  }

  /** Headers for a call to the project as this user. */
  fun headers(context: Context, session: Session): Map<String, String> =
    mapOf("apikey" to Account.cloudKey(context).orEmpty(), "Authorization" to "Bearer ${session.accessToken}")

  private fun parse(text: String?): JSONObject? =
    try {
      text?.let(::JSONObject)
    } catch (_: JSONException) {
      null
    }
}
