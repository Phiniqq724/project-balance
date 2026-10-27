import BalanceCore, { type Row } from '../../modules/balance-core/src/BalanceCoreModule';

export { BalanceCore };

export type Direction = 'in' | 'out';

export type Transaction = {
  id: number;
  source: string;
  direction: Direction;
  amount: number;
  counterparty: string | null;
  bankCategory: string | null;
  categoryId: string | null;
  categoryName: string | null;
  isTransfer: boolean;
  /** The other half of an own-account transfer, when both notifications arrived. */
  pairId: number | null;
  occurredAt: Date;
  rawBody: string;
};

export type Category = {
  id: string;
  name: string;
  keywords: string;
};

export type RawNotification = {
  id: number;
  source: string;
  title: string | null;
  body: string;
  postedAt: Date;
};

export const SETTINGS = {
  watchedPackages: 'watched_packages',
  selfNames: 'self_names',
} as const;

/** Watched out of the box: the banks the parsers were written against. */
export const DEFAULT_PACKAGES = ['com.jago.digitalBanking', 'com.bca.mybca.omni.android', 'com.bca'];

/** Indonesian banking and e-wallet apps, IDs checked against their Play Store listings. */
export const MONEY_APPS: Record<string, string> = {
  'com.jago.digitalBanking': 'Jago',
  'com.bca.mybca.omni.android': 'myBCA',
  'com.bca': 'BCA mobile',
  'com.bcadigital.blu': 'blu',
  'id.co.bcasyariah.bsya': 'BSya',
  'id.bmri.livin': 'Livin',
  'id.co.bri.brimo': 'BRImo',
  'id.co.bankraya.apps': 'Raya',
  'id.bni.wondr': 'wondr',
  'src.com.bni': 'BNI Mobile',
  'co.id.bankbsi.superapp': 'BYOND',
  'com.bsm.activity2': 'BSI Mobile',
  'id.co.btn.mobilebanking.android': 'bale',
  'id.co.cimbniaga.mobile.android': 'OCTO',
  'com.dbank.mobile': 'D-Bank PRO',
  'net.myinfosys.PermataMobileX': 'Permata ME',
  'com.ocbcnisp.onemobileapp': 'OCBC',
  'id.com.uiux.mobile': 'Maybank2u',
  'com.panin.mobilepanin': 'MobilePanin',
  'com.msmile.bankmega': 'M-Smile',
  'com.dev.jakone.mbanking': 'JakOne',
  'com.bjbsmb': 'DIGI bjb',
  'com.mnc.mbanking': 'MotionBank',
  'com.btpn.dc': 'Jenius',
  'id.co.bankbkemobile.digitalbank': 'SeaBank',
  'com.alloapp.yump': 'Allo Bank',
  'com.bnc.finance': 'neobank',
  'com.krom.android': 'Krom',
  'com.hibank.mobile': 'hibank',
  'com.uob.id.digitalbank': 'TMRW',
  'com.dbs.id.pt.digitalbank': 'digibank',
  'com.gojek.gopay': 'GoPay',
  'com.gojek.app': 'Gojek',
  'ovo.id': 'OVO',
  'id.dana': 'DANA',
  'com.shopeepay.id': 'ShopeePay',
  'com.shopee.id': 'Shopee',
  'com.telkom.mwallet': 'LinkAja',
};

export function sourceLabel(pkg: string): string {
  return MONEY_APPS[pkg] ?? BalanceCore.appLabel(pkg) ?? pkg;
}

/** The name a row shows: who you paid, else what the bank called it. */
export function transactionTitle(tx: Transaction): string {
  return tx.counterparty ?? tx.bankCategory ?? sourceLabel(tx.source);
}

const TX_SELECT = `
  SELECT t.id, t.source, t.direction, t.amount, t.counterparty, t.bank_category, t.category_id,
         c.name AS category_name, t.is_transfer, t.pair_id, t.occurred_at, r.body
  FROM transactions t
  JOIN raw_notifications r ON r.id = t.raw_id
  LEFT JOIN categories c ON c.id = t.category_id
`;

function toTransaction(row: Row): Transaction {
  return {
    id: Number(row.id),
    source: String(row.source),
    direction: row.direction === 'in' ? 'in' : 'out',
    amount: Number(row.amount),
    counterparty: (row.counterparty as string | null) ?? null,
    bankCategory: (row.bank_category as string | null) ?? null,
    categoryId: (row.category_id as string | null) ?? null,
    categoryName: (row.category_name as string | null) ?? null,
    isTransfer: Number(row.is_transfer) === 1,
    pairId: row.pair_id == null ? null : Number(row.pair_id),
    occurredAt: new Date(Number(row.occurred_at)),
    rawBody: String(row.body ?? ''),
  };
}

export async function getTransactions(options: { from?: Date; limit?: number } = {}): Promise<Transaction[]> {
  const rows = await BalanceCore.query(
    `${TX_SELECT} WHERE t.occurred_at >= ? ORDER BY t.occurred_at DESC LIMIT ?`,
    [options.from?.getTime() ?? 0, options.limit ?? 2000]
  );
  return rows.map(toTransaction);
}

/** A spend or income event, without the notification text. Transfers are left out. */
export type Flow = {
  direction: Direction;
  amount: number;
  categoryId: string | null;
  categoryName: string | null;
  title: string;
  at: number;
};

export async function getFlows(from: Date): Promise<Flow[]> {
  const rows = await BalanceCore.query(
    `SELECT t.direction, t.amount, t.category_id, c.name AS category_name, t.counterparty, t.bank_category,
            t.source, t.occurred_at
     FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.is_transfer = 0 AND t.occurred_at >= ?
     ORDER BY t.occurred_at`,
    [from.getTime()]
  );
  return rows.map((r) => ({
    direction: r.direction === 'in' ? 'in' : 'out',
    amount: Number(r.amount),
    categoryId: (r.category_id as string | null) ?? null,
    categoryName: (r.category_name as string | null) ?? null,
    title: String(r.counterparty ?? r.bank_category ?? sourceLabel(String(r.source))),
    at: Number(r.occurred_at),
  }));
}

export async function getCategories(): Promise<Category[]> {
  const rows = await BalanceCore.query('SELECT id, name, keywords FROM categories ORDER BY position');
  return rows.map((r) => ({ id: String(r.id), name: String(r.name), keywords: String(r.keywords) }));
}

export async function getUnparsed(): Promise<RawNotification[]> {
  const rows = await BalanceCore.query(
    `SELECT id, package, title, body, posted_at FROM raw_notifications
     WHERE status = 'unparsed' ORDER BY posted_at DESC LIMIT 200`
  );
  return rows.map((r) => ({
    id: Number(r.id),
    source: String(r.package),
    title: (r.title as string | null) ?? null,
    body: String(r.body),
    postedAt: new Date(Number(r.posted_at)),
  }));
}

export async function getUnparsedCount(): Promise<number> {
  const [row] = await BalanceCore.query("SELECT COUNT(*) AS n FROM raw_notifications WHERE status = 'unparsed'");
  return Number(row?.n ?? 0);
}

export async function getList(key: string, separator = ','): Promise<string[]> {
  const value = await BalanceCore.getSetting(key);
  return (value ?? '')
    .split(separator)
    .map((s) => s.trim())
    .filter(Boolean);
}
