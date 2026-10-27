/**
 * Strips the obviously personal bits from a notification before it leaves the phone (and again
 * on the server, in case an old app version skipped it). Names stay: they are the counterparty.
 * Plain TypeScript, no Deno or React Native APIs, so the app and the edge function share it.
 */

export const MAX_TEXT = 500;

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
// "****1234", "xxxx-5678", "••••9012": masked card or account numbers.
const MASKED = /[*xX•]{2,}[\s-]?\d{2,}/g;
// 8+ digits, optionally split by spaces or dashes: account, card, phone and reference numbers.
// Money always has "." or "," grouping in these notifications, so it never matches.
const LONG_NUMBER = /\+?\d[\d -]{6,}\d/g;
const MONEY_PREFIX = /(?:Rp|IDR)\.?\s?$/i;

export function redact(text: string): string {
  return text
    .replace(EMAIL, '[email]')
    .replace(MASKED, '[number]')
    .replace(LONG_NUMBER, (match: string, offset: number, whole: string) =>
      // "Rp10000000" written without grouping is still an amount.
      MONEY_PREFIX.test(whole.slice(Math.max(0, offset - 5), offset)) ? match : '[number]'
    )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT);
}
