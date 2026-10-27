import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { BalanceCore, SETTINGS } from './ledger';
import { supabase } from './supabase';

/**
 * One-way backup: the phone's ledger is the truth, Supabase holds a copy per user.
 * Only rows that differ from what the cloud already has are sent; rows gone from
 * the phone are soft-deleted. Raw notification text never leaves the phone.
 */

const CHUNK = 500;
const PAGE = 1000;
const DEBOUNCE_MS = 3000;

type CloudCategory = { id: string; name: string; keywords: string; position: number };
type CloudTransaction = {
  id: string;
  source: string;
  direction: 'in' | 'out';
  amount: number;
  counterparty: string | null;
  bank_category: string | null;
  category_id: string | null;
  category_locked: boolean;
  is_transfer: boolean;
  transfer_locked: boolean;
  pair_id: string | null;
  occurred_at: string;
};

/** What the cloud holds for the signed-in user: id -> fingerprint of the live row. */
type Mirror = {
  userId: string;
  categories: Map<string, string>;
  transactions: Map<string, string>;
  selfNames: string | null;
};

const categoryPrint = (c: CloudCategory) => JSON.stringify([c.name, c.keywords, c.position]);
const transactionPrint = (t: CloudTransaction) =>
  JSON.stringify([
    t.source,
    t.direction,
    Number(t.amount),
    t.counterparty,
    t.bank_category,
    t.category_id,
    t.category_locked,
    t.is_transfer,
    t.transfer_locked,
    t.pair_id,
    // The server echoes timestamps as "+00:00", the phone sends "Z".
    Date.parse(t.occurred_at),
  ]);

async function localCategories(): Promise<CloudCategory[]> {
  const rows = await BalanceCore.query('SELECT id, name, keywords, position FROM categories');
  return rows.map((r) => ({ id: String(r.id), name: String(r.name), keywords: String(r.keywords), position: Number(r.position) }));
}

async function localTransactions(): Promise<CloudTransaction[]> {
  const rows = await BalanceCore.query(`
    SELECT r.uid, t.source, t.direction, t.amount, t.counterparty, t.bank_category, t.category_id,
           t.category_locked, t.is_transfer, t.transfer_locked, pr.uid AS pair_uid, t.occurred_at
    FROM transactions t
    JOIN raw_notifications r ON r.id = t.raw_id
    LEFT JOIN transactions p ON p.id = t.pair_id
    LEFT JOIN raw_notifications pr ON pr.id = p.raw_id
    WHERE r.uid IS NOT NULL
  `);
  return rows.map((r) => ({
    id: String(r.uid),
    source: String(r.source),
    direction: r.direction === 'in' ? 'in' : 'out',
    amount: Number(r.amount),
    counterparty: (r.counterparty as string | null) ?? null,
    bank_category: (r.bank_category as string | null) ?? null,
    category_id: (r.category_id as string | null) ?? null,
    category_locked: Number(r.category_locked) === 1,
    is_transfer: Number(r.is_transfer) === 1,
    transfer_locked: Number(r.transfer_locked) === 1,
    pair_id: (r.pair_uid as string | null) ?? null,
    occurred_at: new Date(Number(r.occurred_at)).toISOString(),
  }));
}

async function fetchAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .is('deleted_at', null)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data as T[]));
    if (data.length < PAGE) return out;
  }
}

async function loadMirror(userId: string): Promise<Mirror> {
  const [categories, transactions, settings] = await Promise.all([
    fetchAll<CloudCategory>('categories', 'id, name, keywords, position'),
    fetchAll<CloudTransaction>(
      'transactions',
      'id, source, direction, amount, counterparty, bank_category, category_id, category_locked, is_transfer, transfer_locked, pair_id, occurred_at'
    ),
    supabase.from('user_settings').select('value').eq('key', SETTINGS.selfNames).maybeSingle(),
  ]);
  if (settings.error) throw settings.error;
  return {
    userId,
    categories: new Map(categories.map((c) => [c.id, categoryPrint(c)])),
    transactions: new Map(transactions.map((t) => [t.id, transactionPrint(t)])),
    selfNames: settings.data?.value ?? null,
  };
}

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

async function pushTable<T extends { id: string }>(
  table: 'categories' | 'transactions',
  userId: string,
  local: T[],
  mirror: Map<string, string>,
  print: (row: T) => string
) {
  const changed = local.filter((row) => mirror.get(row.id) !== print(row));
  const onConflict = table === 'categories' ? 'user_id,id' : 'id';
  for (const batch of chunks(changed)) {
    const { error } = await supabase
      .from(table)
      .upsert(batch.map((row) => ({ ...row, user_id: userId, deleted_at: null })), { onConflict });
    if (error) throw error;
    for (const row of batch) mirror.set(row.id, print(row));
  }

  const keep = new Set(local.map((row) => row.id));
  const gone = [...mirror.keys()].filter((id) => !keep.has(id));
  for (const batch of chunks(gone)) {
    const { error } = await supabase.from(table).update({ deleted_at: new Date().toISOString() }).in('id', batch);
    if (error) throw error;
    for (const id of batch) mirror.delete(id);
  }
}

async function push(userId: string) {
  if (mirror?.userId !== userId) mirror = await loadMirror(userId);
  const m = mirror;
  const [categories, transactions, selfNames] = await Promise.all([
    localCategories(),
    localTransactions(),
    BalanceCore.getSetting(SETTINGS.selfNames),
  ]);
  // Categories first: transactions reference them.
  await pushTable('categories', userId, categories, m.categories, categoryPrint);
  await pushTable('transactions', userId, transactions, m.transactions, transactionPrint);
  if ((selfNames ?? '') !== (m.selfNames ?? '')) {
    const { error } = await supabase
      .from('user_settings')
      .upsert({ user_id: userId, key: SETTINGS.selfNames, value: selfNames ?? '' });
    if (error) throw error;
    m.selfNames = selfNames ?? '';
  }
}

// ---- Status, for the profile screen -------------------------------------------------------------

export type SyncStatus = { state: 'idle' | 'syncing' | 'synced' | 'failed'; at: number | null };

let mirror: Mirror | null = null;
let status: SyncStatus = { state: 'idle', at: null };
const listeners = new Set<() => void>();

function setStatus(next: SyncStatus) {
  status = next;
  listeners.forEach((l) => l());
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status
  );
}

// ---- Scheduling ---------------------------------------------------------------------------------

let running: Promise<void> | null = null;
let again = false;

/** Pushes now, or once more right after the push already in flight. */
export function syncNow(userId: string): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  setStatus({ ...status, state: 'syncing' });
  running = push(userId)
    .then(() => setStatus({ state: 'synced', at: Date.now() }))
    .catch(() => {
      // Start from the cloud's view next time; a half-finished push may have left the mirror stale.
      mirror = null;
      setStatus({ ...status, state: 'failed' });
    })
    .finally(() => {
      running = null;
      if (again) {
        again = false;
        void syncNow(userId);
      }
    });
  return running;
}

/** Keeps the signed-in user's cloud copy current while the app is open. */
export function useCloudSync(userId: string) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void syncNow(userId), DEBOUNCE_MS);
    };

    void syncNow(userId);
    const ledger = BalanceCore.addListener('onLedgerChanged', soon);
    const app = AppState.addEventListener('change', (next) => {
      // Notifications logged while the app was closed get pushed on return.
      if (next === 'active') soon();
    });
    return () => {
      clearTimeout(timer);
      ledger.remove();
      app.remove();
      mirror = null;
      setStatus({ state: 'idle', at: null });
    };
  }, [userId]);
}
