import { BalanceCore } from '@/lib/ledger';

/**
 * How bank notifications become transactions. The phone keeps these and the listener uses them
 * with the app closed, so a change here ships by OTA update: the next app open stores it and
 * re-reads the ledger once.
 *
 * Patterns are case-insensitive and match the whole text after `strip` and whitespace cleanup
 * (trailing dots removed). `{amount}` is "Rp"/"IDR" plus the number and counts as group 1.
 * `who` and `category` are group numbers. Written from real notifications; add a sample before
 * adding a rule.
 */

const JAGO = 'com.jago.digitalBanking';
const MYBCA = 'com.bca.mybca.omni.android';
const BCA_MOBILE = 'com.bca';
const BCA = [MYBCA, BCA_MOBILE];

// BCA mobile puts the title inside the text: "Financial Diary: Pengeluaran sebesar ...".
const diary = String.raw`(?:Financial Diary: )?`;

type Rule = {
  packages: string[];
  pattern: string;
  direction: 'in' | 'out' | 'ignore';
  amount?: number;
  who?: number;
  category?: number;
};

const rules: Rule[] = [
  // Jago, English
  // Moves between the owner's own Pockets: no money in or out.
  { packages: [JAGO], pattern: String.raw`^{amount} has been moved from your .+ to your .+$`, direction: 'ignore' },
  // "to FAHRELL S. Z. W., Perleng": after the comma is Jago's merchant type.
  { packages: [JAGO], pattern: String.raw`^You have paid {amount} to (.+?)(?:, (.+))?$`, direction: 'out', who: 2, category: 3 },
  { packages: [JAGO], pattern: String.raw`^You've transferred {amount} to (.+)$`, direction: 'out', who: 2 },
  { packages: [JAGO], pattern: String.raw`^(.+?) has sent {amount} to you$`, direction: 'in', amount: 2, who: 1 },

  // Jago, Indonesian
  { packages: [JAGO], pattern: String.raw`^Kamu telah membayar {amount} ke (.+?)(?:, (.+))?$`, direction: 'out', who: 2, category: 3 },

  // BCA, English
  { packages: BCA, pattern: String.raw`^${diary}You spent {amount} at (.+)$`, direction: 'out', category: 2 },
  { packages: BCA, pattern: String.raw`^${diary}You received {amount} from (.+) at (.+?) category$`, direction: 'in', who: 2, category: 3 },
  { packages: BCA, pattern: String.raw`^${diary}You received {amount} at (.+?) category$`, direction: 'in', category: 2 },

  // BCA, Indonesian
  { packages: BCA, pattern: String.raw`^${diary}Pengeluaran sebesar {amount} di kategori (.+)$`, direction: 'out', category: 2 },
  { packages: BCA, pattern: String.raw`^${diary}Pemasukan sebesar {amount} dari (.+) di kategori (.+)$`, direction: 'in', who: 2, category: 3 },
  { packages: BCA, pattern: String.raw`^${diary}Pemasukan sebesar {amount} di kategori (.+)$`, direction: 'in', category: 2 },
];

const parseRules = {
  // Help-line footers.
  strip: [String.raw`\s*Need help\?.*$`, String.raw`\s*Butuh bantuan\?.*$`],
  rules,
  // Last resort for picked apps when AI review is off: an amount and exactly one of these.
  generic: {
    promo: String.raw`\b(cashback|promo|voucher|diskon|discount|menangkan|hadiah|reward|poin|points)\b`,
    out: String.raw`\b(paid|spent|transferred|payment|pembayaran|bayar|membayar|pengeluaran|transfer ke|debit|keluar)\b`,
    in: String.raw`\b(received|sent .* to you|diterima|masuk|menerima|pemasukan|kredit|credit)\b`,
  },
};

/** Hands the rules to the phone. Safe to call on every open; it only re-reads when they changed. */
export function applyParseRules() {
  return BalanceCore.setParseRules(JSON.stringify(parseRules));
}
