package expo.modules.balancecore

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * Drains the 'pending' AI review queue in the background so it works with the app closed: straight
 * to the provider with the user's own key ([AiKey]) when there is one, else (cloud mode) through
 * the classify-notification function. Only this code calls the function, so a
 * row is never sent twice at once. Results are suggestions; nothing reaches the ledger until the user confirms.
 */
internal object AiReview {
  const val WORK = "ai-review"
  private const val PREFS = "balance.ai"
  private const val BLOCKED_UNTIL = "blocked_until"
  private val KINDS = setOf("income", "expense", "transfer", "ad_or_other")

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun blockedUntil(context: Context): Long = prefs(context).getLong(BLOCKED_UNTIL, 0L)

  fun block(context: Context, seconds: Int) {
    prefs(context).edit().putLong(BLOCKED_UNTIL, System.currentTimeMillis() + seconds * 1000L).apply()
  }

  /** Queues a pass if there is something to read. Safe to call often. */
  fun kick(context: Context) {
    val app = context.applicationContext
    val owner = Account.userId(app)
    // Local mode has no function to call: it reads only with its own key.
    if (owner == null || (owner == Account.LOCAL && !AiKey.isSet(app))) return
    val db = BalanceDb.get(app)
    if (!db.aiEnabled() || !hasPending(db)) return
    // A delayed pass is already queued behind a rate limit.
    if (System.currentTimeMillis() < blockedUntil(app)) return
    enqueue(app, 0)
  }

  fun enqueue(context: Context, delaySeconds: Int) {
    val request = OneTimeWorkRequestBuilder<AiReviewWorker>()
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
      .setInitialDelay(delaySeconds.toLong(), TimeUnit.SECONDS)
      .build()
    // Appended, not kept: a pass that is about to finish would otherwise swallow a request that arrives just after its last look.
    WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(WORK, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
  }

  fun hasPending(db: BalanceDb): Boolean =
    db.readableDatabase.rawQuery("SELECT 1 FROM ai_reviews WHERE state = 'pending' LIMIT 1", null).use { it.moveToFirst() }

  class Item(val id: Long, val app: String, val text: String)

  fun pendingBatch(db: BalanceDb, limit: Int): List<Item> =
    db.readableDatabase.rawQuery(
      """
      SELECT r.id, r.package, r.title, r.body FROM ai_reviews a JOIN raw_notifications r ON r.id = a.raw_id
      WHERE a.state = 'pending' ORDER BY r.posted_at DESC LIMIT ?
      """,
      arrayOf(limit.toString())
    ).use { c ->
      buildList {
        while (c.moveToNext()) {
          val text = Redact.text(listOfNotNull(c.getString(2)?.takeIf { it.isNotEmpty() }, c.getString(3)).joinToString(" - "))
          add(Item(c.getLong(0), c.getString(1), text))
        }
      }
    }

  /** The latest corrections the user made on this phone, for the model to follow. */
  fun examples(db: BalanceDb, limit: Int): List<AiProviders.Example> =
    db.readableDatabase.rawQuery(
      "SELECT text, kind, direction, amount, counterparty FROM ai_examples ORDER BY id DESC LIMIT ?",
      arrayOf(limit.toString())
    ).use { c ->
      buildList { while (c.moveToNext()) add(AiProviders.Example(c.getString(0), c.getString(1), c.getString(2), c.getLong(3), c.getString(4))) }
    }

  class Answer(val kind: String, val direction: String, val amount: Long, val counterparty: String?, val confidence: Double)

  /** id -> answer. Entries the function got wrong are left out, so they count as unread. */
  fun parseAnswers(body: String): Map<Long, Answer> {
    val out = HashMap<Long, Answer>()
    try {
      val results: JSONArray = JSONObject(body).optJSONArray("results") ?: return out
      for (i in 0 until results.length()) {
        val r = results.optJSONObject(i) ?: continue
        val id = r.optString("id").toLongOrNull() ?: continue
        val kind = r.optString("kind")
        val direction = r.optString("direction")
        val amount = r.optDouble("amount", -1.0)
        if (kind !in KINDS || (direction != "in" && direction != "out") || amount < 0) continue
        val counterparty = if (r.isNull("counterparty")) null else r.optString("counterparty").trim().takeIf { it.isNotEmpty() }
        out[id] = Answer(kind, direction, amount.toLong(), counterparty, r.optDouble("confidence", 0.0))
      }
    } catch (_: JSONException) {
      out.clear()
    }
    return out
  }
}

internal class AiReviewWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result = withContext(Dispatchers.IO) { drain() }

  private fun drain(): Result {
    val context = applicationContext
    val owner = Account.userId(context)
    if (owner == null) return Result.success()
    // Own key wins: the phone calls the provider and the function is never used.
    val own = AiKey.get(context)
    if (own == null && owner == Account.LOCAL) return Result.success()
    val url = Account.cloudUrl(context)
    if (own == null && url == null) return Result.success()
    // A rate limit already queued a later pass.
    if (System.currentTimeMillis() < AiReview.blockedUntil(context)) return Result.success()

    try {
      repeat(MAX_BATCHES) {
        // Signed out or switched account since the last batch.
        if (Account.userId(context) != owner) return Result.success()
        val db = BalanceDb.get(context)
        if (!db.aiEnabled()) return Result.success()
        val batch = AiReview.pendingBatch(db, BATCH)
        if (batch.isEmpty()) return Result.success()

        val answers = if (own != null) {
          when (val r = readWithOwnKey(context, db, own, batch)) {
            is Read.Done -> r.answers
            is Read.Stop -> return Result.success()
            Read.Retry -> return retryOrGiveUp()
          }
        } else {
          val session = CloudAuth.session(context, owner, TIMEOUT_MS) ?: return Result.success()
          val items = JSONArray().apply { batch.forEach { put(JSONObject().put("id", it.id.toString()).put("app", it.app).put("text", it.text)) } }
          val res = CloudHttp.post(
            "$url/functions/v1/classify-notification",
            CloudAuth.headers(context, session),
            JSONObject().put("items", items).toString(),
            TIMEOUT_MS
          )
          when {
            res.code in 200..299 -> AiReview.parseAnswers(res.body)
            res.code == 429 || res.code == 503 -> {
              waitFor(context, res.retryAfter)
              return Result.success()
            }
            else -> return retryOrGiveUp()
          }
        }
        apply(context, owner, batch, answers)
      }
      return Result.success()
    } catch (_: IOException) {
      return retryOrGiveUp()
    }
  }

  private sealed interface Read {
    class Done(val answers: Map<Long, AiReview.Answer>) : Read
    object Stop : Read
    object Retry : Read
  }

  private fun readWithOwnKey(context: Context, db: BalanceDb, own: AiKey.Stored, batch: List<AiReview.Item>): Read {
    try {
      val results = AiProviders.classify(
        own.provider,
        own.key,
        batch.map { AiProviders.Item(it.id.toString(), it.app, it.text) },
        AiReview.examples(db, EXAMPLES)
      )
      AiKey.setStatus(context, null)
      return Read.Done(
        results.mapNotNull { r ->
          r.id.toLongOrNull()?.let { it to AiReview.Answer(r.kind, r.direction, r.amount, r.counterparty, r.confidence) }
        }.toMap()
      )
    } catch (e: AiProviders.Failure) {
      return when (e.reason) {
        // Leave the items pending and don't try again until the key changes or an hour passes.
        AiProviders.Reason.BAD_KEY, AiProviders.Reason.NO_CREDIT -> {
          AiKey.setStatus(context, e.reason)
          Read.Stop
        }
        AiProviders.Reason.BUSY -> {
          waitFor(context, e.retryAfter)
          Read.Stop
        }
        AiProviders.Reason.MODEL -> Read.Retry
      }
    }
  }

  /** Retry() would ignore the provider's wait, so queue the next pass ourselves. */
  private fun waitFor(context: Context, retryAfter: Int?) {
    val wait = retryAfter?.takeIf { it > 0 } ?: 60
    AiReview.block(context, wait)
    AiReview.enqueue(context, wait)
  }

  private fun retryOrGiveUp(): Result = if (runAttemptCount >= MAX_RETRIES) Result.success() else Result.retry()

  private fun apply(context: Context, owner: String, batch: List<AiReview.Item>, answers: Map<Long, AiReview.Answer>) {
    Ledger.write(context) { db ->
      if (Account.userId(context) != owner) return@write
      for (item in batch) {
        val a = answers[item.id]
        if (a != null) Ledger.suggest(db, item.id, a.kind, a.direction, a.amount, a.counterparty, a.confidence)
        else Ledger.reviewFailed(db, item.id)
        ReviewNotifier.notifyOpen(context, db, item.id, recentOnly = true)
      }
    }
  }

  private companion object {
    const val BATCH = 10
    const val EXAMPLES = 8
    const val MAX_BATCHES = 50
    const val MAX_RETRIES = 6
    // The function can take about 90 seconds in the worst case; a provider call times out at 60 seconds.
    const val TIMEOUT_MS = 100_000
  }
}
