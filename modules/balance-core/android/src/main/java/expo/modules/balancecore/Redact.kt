package expo.modules.balancecore

/** Port of supabase/functions/_shared/redact.ts; keep the two in step. */
internal object Redact {
  private const val MAX_TEXT = 500

  private val email = Regex("""[\w.+-]+@[\w-]+\.[\w.-]+""")
  private val masked = Regex("""[*xX•]{2,}[\s-]?\d{2,}""")
  private val longNumber = Regex("""\+?\d[\d -]{6,}\d""")
  private val moneyPrefix = Regex("""(?:Rp|IDR)\.?\s?$""", RegexOption.IGNORE_CASE)
  // JS \s also covers non-breaking and other Unicode spaces.
  private val spaces = Regex("""[\s   -     　﻿]+""")

  fun text(input: String): String {
    val step = input.replace(email, "[email]").replace(masked, "[number]")
    return step
      .replace(longNumber) { m ->
        // "Rp10000000" written without grouping is still an amount.
        val before = step.substring(maxOf(0, m.range.first - 5), m.range.first)
        if (moneyPrefix.containsMatchIn(before)) m.value else "[number]"
      }
      .replace(spaces, " ")
      .trim()
      .take(MAX_TEXT)
  }
}
