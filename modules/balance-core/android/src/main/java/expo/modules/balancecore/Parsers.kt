package expo.modules.balancecore

import android.content.Context
import org.json.JSONObject
import kotlin.math.roundToLong

internal enum class Direction(val value: String) { IN("in"), OUT("out") }

internal data class ParsedTransaction(
  val direction: Direction,
  val amount: Long,
  val counterparty: String? = null,
  val bankCategory: String? = null,
)

internal sealed interface ParseResult {
  data class Transaction(val tx: ParsedTransaction) : ParseResult
  // Mentions money but no rule understood it. Shown in the Unparsed list.
  data object Unparsed : ParseResult
  // OTPs, promos, login alerts and the like.
  data object Ignored : ParseResult
}

/**
 * Bank rules come from JS (src/lib/parse-rules.ts) so they ship by OTA update. They are kept in
 * prefs, not a ledger, so the listener reads them with the app closed and for every account.
 */
internal class RuleSet(
  val strip: List<Regex>,
  val rules: List<Rule>,
  val promo: Regex?,
  val outWords: Regex?,
  val inWords: Regex?,
) {
  // Group numbers count the one `{amount}` adds. 0 = not captured. Direction null = not a transaction.
  class Rule(val packages: Set<String>, val regex: Regex, val direction: Direction?, val amount: Int, val who: Int, val category: Int)
}

internal object Parsers {
  private const val AMOUNT = """(?:Rp|IDR)\.?\s?([\d.,]+)"""
  private const val PREFS = "balance.parser"
  private const val KEY_RULES = "rules"

  private val anyAmount = Regex(AMOUNT, RegexOption.IGNORE_CASE)
  private val empty = RuleSet(emptyList(), emptyList(), null, null, null)

  @Volatile private var cached: Pair<String, RuleSet>? = null

  fun rules(context: Context): RuleSet {
    val json = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_RULES, null) ?: return empty
    cached?.let { (source, set) -> if (source == json) return set }
    val set = runCatching { compile(json) }.getOrDefault(empty)
    cached = json to set
    return set
  }

  /** Stores new rules. Throws, keeping the old ones, if any pattern doesn't compile. */
  fun setRules(context: Context, json: String) {
    val set = compile(json)
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_RULES, json).commit()
    cached = json to set
  }

  private fun compile(json: String): RuleSet {
    val root = JSONObject(json)
    fun regex(pattern: String) = Regex(pattern.replace("{amount}", AMOUNT), RegexOption.IGNORE_CASE)
    fun optRegex(obj: JSONObject?, key: String) = obj?.optString(key)?.takeIf { it.isNotEmpty() }?.let(::regex)
    val strip = root.optJSONArray("strip")?.let { a -> List(a.length()) { regex(a.getString(it)) } }.orEmpty()
    val rules = root.optJSONArray("rules")?.let { a ->
      List(a.length()) { i ->
        val r = a.getJSONObject(i)
        val packages = r.getJSONArray("packages").let { p -> List(p.length()) { p.getString(it) }.toSet() }
        val direction = when (val d = r.getString("direction")) {
          "in" -> Direction.IN
          "out" -> Direction.OUT
          "ignore" -> null
          else -> throw IllegalArgumentException("Unknown direction $d")
        }
        RuleSet.Rule(packages, regex(r.getString("pattern")), direction, r.optInt("amount", 1), r.optInt("who"), r.optInt("category"))
      }
    }.orEmpty()
    val generic = root.optJSONObject("generic")
    return RuleSet(strip, rules, optRegex(generic, "promo"), optRegex(generic, "out"), optRegex(generic, "in"))
  }

  /** [generic] off = only the bank-specific rules; anything else is left for AI review. */
  fun parse(rules: RuleSet, pkg: String, title: String?, body: String, generic: Boolean = true): ParseResult {
    val text = normalize(body, rules.strip)
    for (rule in rules.rules) {
      if (pkg !in rule.packages) continue
      val m = rule.regex.matchEntire(text) ?: continue
      val direction = rule.direction ?: return ParseResult.Ignored
      fun group(i: Int) = m.groupValues.getOrNull(i)?.takeIf { i > 0 }?.let(::cleanName)?.takeIf { it.isNotEmpty() }
      val value = amount(m.groupValues.getOrElse(rule.amount) { "" }) ?: continue
      return ParseResult.Transaction(ParsedTransaction(direction, value, group(rule.who), group(rule.category)))
    }

    if (!anyAmount.containsMatchIn(text)) return ParseResult.Ignored
    if (rules.promo?.containsMatchIn(text) == true) return ParseResult.Ignored
    if (!generic) return ParseResult.Unparsed
    return parseGeneric(rules, text)?.let { ParseResult.Transaction(it) } ?: ParseResult.Unparsed
  }

  // Last resort for apps without dedicated rules: needs an amount and one clear direction word.
  private fun parseGeneric(rules: RuleSet, text: String): ParsedTransaction? {
    val value = anyAmount.find(text)?.groupValues?.get(1)?.let(::amount) ?: return null
    val isOut = rules.outWords?.containsMatchIn(text) == true
    val isIn = rules.inWords?.containsMatchIn(text) == true
    return when {
      isOut && !isIn -> ParsedTransaction(Direction.OUT, value)
      isIn && !isOut -> ParsedTransaction(Direction.IN, value)
      else -> null
    }
  }

  /** Strips zero-width characters (Jago puts them inside names), footers like the help line and extra spaces. */
  fun normalize(body: String, strip: List<Regex> = emptyList()): String =
    strip
      .fold(body.replace(Regex("[\\u200B-\\u200D\\u2060\\uFEFF]"), "")) { text, footer -> footer.replace(text, "") }
      .replace(Regex("""\s+"""), " ")
      .trim()
      .trimEnd('.')

  /**
   * "1.000" and "Rp10.000" use dots for thousands, "1,000.00" uses commas.
   * Whichever separator comes last with 1-2 digits after it is the decimal point.
   */
  fun amount(raw: String): Long? {
    val s = raw.trim().trimEnd('.', ',')
    if (s.isEmpty()) return null
    val lastSep = s.indexOfLast { it == '.' || it == ',' }
    val normalized = if (lastSep >= 0 && s.length - lastSep - 1 in 1..2) {
      s.substring(0, lastSep).filter(Char::isDigit) + "." + s.substring(lastSep + 1)
    } else {
      s.filter(Char::isDigit)
    }
    return normalized.toDoubleOrNull()?.roundToLong()
  }

  // Jago wraps some merchant names in dots: "ke .DUNIA ELEKTRIK..".
  private fun cleanName(raw: String): String = raw.trim().trimStart('.').trim()
}

/**
 * Cheap on-device check for what is worth sending to AI review: an amount (Rp / IDR / rupiah,
 * or Indonesian shorthand like "25rb", "1,5jt") and no sign of an OTP. Promo-sounding text only
 * passes when it also has a transaction word, since e-wallets mention cashback on real payments.
 */
internal object Prefilter {
  private val amount = Regex(
    """(?:\b(?:Rp|IDR)\.?\s?\d)|(?:\d[\d.,]*\s?(?:rb|ribu|jt|juta|rupiah)\b)""",
    RegexOption.IGNORE_CASE
  )
  private val otp = Regex(
    """\b(OTP|kode verifikasi|kode rahasia|verification code|one[- ]time (?:password|code)|PIN)\b""",
    RegexOption.IGNORE_CASE
  )
  private val txWords = Regex(
    """\b(paid|pay|payment|spent|purchase|transfer(?:red)?|received|sent|top[- ]?up|withdraw(?:al|n)?|refund(?:ed)?|debit(?:ed)?|credit(?:ed)?|""" +
      """bayar|dibayar|pembayaran|transaksi|terima|diterima|menerima|masuk|keluar|kirim|dikirim|mengirim|tarik|penarikan|belanja|isi saldo|berhasil|sukses|successful)\b""",
    RegexOption.IGNORE_CASE
  )
  private val promo = Regex(
    """\b(promo|voucher|diskon|discount|menangkan|hadiah|giveaway|gratis|free|flash sale|hemat|kupon|coupon)\b""",
    RegexOption.IGNORE_CASE
  )

  fun isCandidate(title: String?, body: String): Boolean {
    val text = Parsers.normalize(listOfNotNull(title, body).joinToString(" "))
    if (!amount.containsMatchIn(text)) return false
    if (otp.containsMatchIn(text)) return false
    return txWords.containsMatchIn(text) || !promo.containsMatchIn(text)
  }
}
