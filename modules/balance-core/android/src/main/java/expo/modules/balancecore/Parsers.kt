package expo.modules.balancecore

import kotlin.math.roundToLong

internal enum class Direction(val value: String) { IN("in"), OUT("out") }

internal data class ParsedTransaction(
  val direction: Direction,
  val amount: Long,
  val counterparty: String? = null,
  val bankCategory: String? = null,
  // The bank text itself says money moved between people (not a merchant payment).
  val isPersonTransfer: Boolean = false,
)

internal sealed interface ParseResult {
  data class Transaction(val tx: ParsedTransaction) : ParseResult
  // Mentions money but no rule understood it. Shown in the Unparsed list.
  data object Unparsed : ParseResult
  // OTPs, promos, login alerts and the like.
  data object Ignored : ParseResult
}

internal object Parsers {
  const val JAGO = "com.jago.digitalBanking"
  const val MYBCA = "com.bca.mybca.omni.android"

  private const val AMOUNT = """(?:Rp|IDR)\s?([\d.,]+)"""

  private val jagoPaid = Regex("""^You have paid $AMOUNT to (.+)$""", RegexOption.IGNORE_CASE)
  private val jagoTransferred = Regex("""^You've transferred $AMOUNT to (.+)$""", RegexOption.IGNORE_CASE)
  private val jagoReceived = Regex("""^(.+?) has sent $AMOUNT to you$""", RegexOption.IGNORE_CASE)

  private val bcaSpent = Regex("""^You spent $AMOUNT at (.+)$""", RegexOption.IGNORE_CASE)
  private val bcaReceivedFrom = Regex("""^You received $AMOUNT from (.+) at (.+?) category$""", RegexOption.IGNORE_CASE)
  private val bcaReceived = Regex("""^You received $AMOUNT at (.+?) category$""", RegexOption.IGNORE_CASE)

  private val anyAmount = Regex(AMOUNT, RegexOption.IGNORE_CASE)
  private val promo = Regex("""\b(cashback|promo|voucher|diskon|discount|menangkan|hadiah|reward|poin|points)\b""", RegexOption.IGNORE_CASE)
  private val outWords = Regex("""\b(paid|spent|transferred|payment|pembayaran|bayar|transfer ke|debit|keluar)\b""", RegexOption.IGNORE_CASE)
  private val inWords = Regex("""\b(received|sent .* to you|diterima|masuk|menerima|kredit|credit)\b""", RegexOption.IGNORE_CASE)

  /** [generic] off = only the bank-specific rules; anything else is left for AI review. */
  fun parse(pkg: String, title: String?, body: String, generic: Boolean = true): ParseResult {
    val text = normalize(body)

    val specific = when (pkg) {
      JAGO -> parseJago(text)
      MYBCA -> parseMyBca(text)
      else -> null
    }
    if (specific != null) return ParseResult.Transaction(specific)

    if (!anyAmount.containsMatchIn(text)) return ParseResult.Ignored
    if (promo.containsMatchIn(text)) return ParseResult.Ignored
    if (!generic) return ParseResult.Unparsed
    return parseGeneric(text)?.let { ParseResult.Transaction(it) } ?: ParseResult.Unparsed
  }

  private fun parseJago(text: String): ParsedTransaction? {
    jagoPaid.matchEntire(text)?.let { m ->
      return ParsedTransaction(Direction.OUT, amount(m.groupValues[1]) ?: return null, cleanName(m.groupValues[2]))
    }
    jagoTransferred.matchEntire(text)?.let { m ->
      return ParsedTransaction(Direction.OUT, amount(m.groupValues[1]) ?: return null, cleanName(m.groupValues[2]), isPersonTransfer = true)
    }
    jagoReceived.matchEntire(text)?.let { m ->
      return ParsedTransaction(Direction.IN, amount(m.groupValues[2]) ?: return null, cleanName(m.groupValues[1]), isPersonTransfer = true)
    }
    return null
  }

  private fun parseMyBca(text: String): ParsedTransaction? {
    bcaSpent.matchEntire(text)?.let { m ->
      val category = cleanName(m.groupValues[2])
      return ParsedTransaction(Direction.OUT, amount(m.groupValues[1]) ?: return null, bankCategory = category, isPersonTransfer = category.isTransferCategory())
    }
    bcaReceivedFrom.matchEntire(text)?.let { m ->
      val category = cleanName(m.groupValues[3])
      return ParsedTransaction(Direction.IN, amount(m.groupValues[1]) ?: return null, cleanName(m.groupValues[2]), category, category.isTransferCategory())
    }
    bcaReceived.matchEntire(text)?.let { m ->
      return ParsedTransaction(Direction.IN, amount(m.groupValues[1]) ?: return null, bankCategory = cleanName(m.groupValues[2]))
    }
    return null
  }

  // Last resort for apps without dedicated rules: needs an amount and one clear direction word.
  private fun parseGeneric(text: String): ParsedTransaction? {
    val value = anyAmount.find(text)?.groupValues?.get(1)?.let(::amount) ?: return null
    val isOut = outWords.containsMatchIn(text)
    val isIn = inWords.containsMatchIn(text)
    return when {
      isOut && !isIn -> ParsedTransaction(Direction.OUT, value)
      isIn && !isOut -> ParsedTransaction(Direction.IN, value)
      else -> null
    }
  }

  /** Strips zero-width characters (Jago puts them inside names), the help-line footer and extra spaces. */
  fun normalize(body: String): String =
    body
      .replace(Regex("[\\u200B-\\u200D\\u2060\\uFEFF]"), "")
      .replace(Regex("""\s*Need help\?.*$""", RegexOption.IGNORE_CASE), "")
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

  private fun cleanName(raw: String): String = raw.trim().trimEnd('.').trim()

  private fun String.isTransferCategory() = contains("transfer", ignoreCase = true)
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

/**
 * Matches what a bank shows against the names the user entered.
 * Handles Jago's truncation ("FAHRELL SANDY ZHARIIF WI"), initials ("FAHRELL S. Z. W.")
 * and BCA's masking ("****ELL **NDY **AR").
 */
internal object SelfNameMatcher {
  fun matches(shown: String?, selfNames: List<String>): Boolean {
    if (shown.isNullOrBlank()) return false
    val shownTokens = tokens(shown.substringBefore(','))
    if (shownTokens.isEmpty()) return false
    return selfNames.any { name -> matchesName(shownTokens, tokens(name)) }
  }

  private fun matchesName(shown: List<String>, name: List<String>): Boolean {
    if (shown.size > name.size) return false
    val visibleLetters = shown.sumOf { it.count { c -> c != '*' } }
    if (visibleLetters < 3) return false
    return shown.withIndex().all { (i, token) ->
      val word = name[i]
      val isLast = i == shown.lastIndex
      when {
        token == word -> true
        token.contains('*') -> word.contains(token.replace("*", ""))
        token.length == 1 -> word.startsWith(token)
        isLast -> word.startsWith(token)
        else -> false
      }
    }
  }

  private fun tokens(value: String): List<String> =
    value.uppercase()
      .replace(Regex("[^A-Z* ]"), " ")
      .split(' ')
      .filter { it.isNotBlank() }
}
