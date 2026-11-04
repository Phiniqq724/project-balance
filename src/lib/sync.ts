import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import type { CloudChanges, CloudTransactionRow, SyncKind } from '../../modules/balance-core/src/BalanceCoreModule';
import { BalanceCore } from './ledger';
import { supabase } from './supabase';

/**
 * Two-way sync between this phone's ledger and the user's cloud copy. Every phone (and the live
 * and dev builds on one phone) pulls what changed elsewhere, then pushes its own changes.
 *
 * The ledger remembers what the cloud held for each row the last time they agreed (sync_base).
 * Against that, a row missing here was deleted here, and a cloud row this phone never saw is new
 * from another device. Raw notification text never leaves the phone.
 */

const SYNC_USER = 'sync_user';
const SYNC_CURSOR = 'sync_cursor';
const CHUNK = 500;
const PAGE = 1000;
const DEBOUNCE_MS = 3000;
// Rows committed slightly out of order still get picked up; re-reading one is harmless.
const CURSOR_OVERLAP_MS = 2 * 60 * 1000;

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
type Remote<T> = T & { updated_at: string; deleted_at: string | null };

const CATEGORY_COLUMNS = 'id, name, keywords, position';
const TRANSACTION_COLUMNS =
  'id, source, direction, amount, counterparty, bank_category, category_id, category_locked, is_transfer, transfer_locked, pair_id, occurred_at';

const categoryPrint = (c: CloudCategory) => JSON.stringify([c.name, c.keywords, Number(c.position)]);
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

/** Same app, same moment, same amount: one transaction, even if two builds logged it under different ids. */
const sameTransaction = (t: CloudTransaction) => `${t.source}|${Date.parse(t.occurred_at)}|${t.direction}|${Number(t.amount)}`;

// ---- Local side ---------------------------------------------------------------------------------

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

type Base = Record<SyncKind, Map<string, string>>;
type State = { reset: boolean; cursor: string | null; base: Base };

/** What this ledger last agreed with the cloud on. Belongs to one user; anyone else starts over. */
async function loadState(userId: string): Promise<State> {
  const base: Base = { category: new Map(), transaction: new Map() };
  if ((await BalanceCore.getSetting(SYNC_USER)) !== userId) return { reset: true, cursor: null, base };
  const rows = await BalanceCore.query('SELECT kind, id, print FROM sync_base');
  for (const r of rows) base[r.kind === 'category' ? 'category' : 'transaction'].set(String(r.id), String(r.print));
  return { reset: false, cursor: await BalanceCore.getSetting(SYNC_CURSOR), base };
}

async function record(userId: string, changes: CloudChanges) {
  if (!(await BalanceCore.applyCloud(userId, changes))) throw new Error('account changed');
}

// ---- Cloud side ---------------------------------------------------------------------------------

/** Rows changed after `since` (or all of them), deleted ones included. */
async function fetchChanged<T>(table: string, columns: string, since: string | null): Promise<Remote<T>[]> {
  const out: Remote<T>[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(table).select(`${columns}, updated_at, deleted_at`);
    if (since) q = q.gt('updated_at', since);
    const { data, error } = await q
      .order('updated_at')
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data as unknown as Remote<T>[]));
    if (data.length < PAGE) return out;
  }
}

/** The cursor minus a little, as a timestamp Hermes can parse (the server sends microseconds). */
function since(cursor: string | null): string | null {
  if (!cursor) return null;
  const at = Date.parse(cursor.slice(0, 19) + 'Z');
  return Number.isNaN(at) ? null : new Date(at - CURSOR_OVERLAP_MS).toISOString();
}

// Same server format throughout, so plain string order is time order.
const newest = (a: string | null, b: string) => (a === null || b > a ? b : a);

// ---- Pull ---------------------------------------------------------------------------------------

/**
 * agree: both sides match. take: the cloud's version replaces this phone's. drop: deleted
 * elsewhere, delete here. forget: gone on both sides. keep: this phone's version wins; the push sends it.
 */
type Verdict = 'agree' | 'take' | 'drop' | 'forget' | 'keep';

function decide(remote: string | null, local: string | undefined, base: string | undefined): Verdict {
  if (remote === null) {
    if (local === undefined) return 'forget';
    return local === base ? 'drop' : 'keep';
  }
  if (local === remote) return 'agree';
  // Missing here but agreed before: deleted on this phone.
  if (local === undefined) return base === undefined ? 'take' : 'keep';
  // Changed only elsewhere, or never synced from here (the cloud is the shared copy).
  if (base === undefined || local === base) return 'take';
  return 'keep';
}

const toNative = (t: CloudTransaction): CloudTransactionRow => ({
  id: t.id,
  source: t.source,
  direction: t.direction,
  amount: Number(t.amount),
  counterparty: t.counterparty,
  bankCategory: t.bank_category,
  categoryId: t.category_id,
  categoryLocked: t.category_locked,
  isTransfer: t.is_transfer,
  transferLocked: t.transfer_locked,
  pairId: t.pair_id,
  occurredAt: Date.parse(t.occurred_at),
});

/** Brings what changed in the cloud into this ledger. Returns cloud ids that are duplicates and should go. */
async function pull(userId: string, state: State): Promise<Set<string>> {
  const from = since(state.cursor);
  const [remoteCategories, remoteTransactions, categories, transactions] = await Promise.all([
    fetchChanged<CloudCategory>('categories', CATEGORY_COLUMNS, from),
    fetchChanged<CloudTransaction>('transactions', TRANSACTION_COLUMNS, from),
    localCategories(),
    localTransactions(),
  ]);

  const changes: Required<Omit<CloudChanges, 'cursor'>> & { cursor?: string } = {
    reset: state.reset,
    categories: [],
    deletedCategories: [],
    rekeys: [],
    transactions: [],
    deletedTransactions: [],
    base: [],
  };
  const duplicates = new Set<string>();
  let cursor = state.cursor;
  const agreed = (kind: SyncKind, id: string, print: string | null) => {
    changes.base.push({ kind, id, print });
    if (print === null) state.base[kind].delete(id);
    else state.base[kind].set(id, print);
  };

  const localCategory = new Map(categories.map((c) => [c.id, categoryPrint(c)]));
  for (const r of remoteCategories) {
    cursor = newest(cursor, r.updated_at);
    const print = r.deleted_at ? null : categoryPrint(r);
    const verdict = decide(print, localCategory.get(r.id), state.base.category.get(r.id));
    if (verdict === 'take') changes.categories.push({ id: r.id, name: r.name, keywords: r.keywords, position: Number(r.position) });
    if (verdict === 'drop') changes.deletedCategories.push(r.id);
    if (verdict === 'take' || verdict === 'agree') agreed('category', r.id, print);
    if (verdict === 'drop' || verdict === 'forget') agreed('category', r.id, null);
  }

  const local = new Map(transactions.map((t) => [t.id, t]));
  const byMoment = new Map(transactions.map((t) => [sameTransaction(t), t.id]));
  // Lowest id first, so of two copies of one transaction the lower id is always the one kept.
  const remote = [...remoteTransactions].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const r of remote) {
    cursor = newest(cursor, r.updated_at);
    const print = r.deleted_at ? null : transactionPrint(r);
    const mine = local.get(r.id);
    let verdict = decide(print, mine && transactionPrint(mine), state.base.transaction.get(r.id));

    // New to this phone, but maybe logged here under another id (two builds, before ids were shared).
    const twin = verdict === 'take' && !mine ? byMoment.get(sameTransaction(r)) : undefined;
    if (twin !== undefined && twin !== r.id) {
      if (twin < r.id) {
        duplicates.add(r.id);
        continue;
      }
      // The cloud's id is lower: this phone's copy takes it, and its old cloud row goes.
      const row = local.get(twin)!;
      local.delete(twin);
      local.set(r.id, { ...row, id: r.id });
      byMoment.set(sameTransaction(r), r.id);
      changes.rekeys.push({ from: twin, to: r.id });
      duplicates.add(twin);
      verdict = transactionPrint({ ...row, id: r.id }) === print ? 'agree' : 'take';
    }

    if (verdict === 'take') {
      changes.transactions.push(toNative(r));
      byMoment.set(sameTransaction(r), r.id);
    }
    if (verdict === 'drop') changes.deletedTransactions.push(r.id);
    if (verdict === 'take' || verdict === 'agree') agreed('transaction', r.id, print);
    if (verdict === 'drop' || verdict === 'forget') agreed('transaction', r.id, null);
  }

  if (cursor) changes.cursor = cursor;
  await record(userId, changes);
  state.reset = false;
  state.cursor = cursor;
  return duplicates;
}

// ---- Push ---------------------------------------------------------------------------------------

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

/** Sends rows that differ from what the cloud last had, and soft-deletes rows gone from this phone. */
async function pushTable<T extends { id: string }>(
  table: 'categories' | 'transactions',
  kind: SyncKind,
  userId: string,
  local: T[],
  base: Map<string, string>,
  print: (row: T) => string,
  alsoGone: Set<string> = new Set()
) {
  const changed = local.filter((row) => base.get(row.id) !== print(row));
  const onConflict = table === 'categories' ? 'user_id,id' : 'id';
  for (const batch of chunks(changed)) {
    const { error } = await supabase
      .from(table)
      .upsert(batch.map((row) => ({ ...row, user_id: userId, deleted_at: null })), { onConflict });
    if (error) throw error;
    await record(userId, { base: batch.map((row) => ({ kind, id: row.id, print: print(row) })) });
    for (const row of batch) base.set(row.id, print(row));
  }

  const keep = new Set(local.map((row) => row.id));
  const gone = [...new Set([...base.keys(), ...alsoGone])].filter((id) => !keep.has(id));
  for (const batch of chunks(gone)) {
    const { error } = await supabase.from(table).update({ deleted_at: new Date().toISOString() }).in('id', batch);
    if (error) throw error;
    await record(userId, { base: batch.map((id) => ({ kind, id, print: null })) });
    for (const id of batch) base.delete(id);
  }
}

async function sync(userId: string) {
  const state = await loadState(userId);
  // Pull first: until this phone has seen the other devices' rows, it can't tell them from deletions.
  const duplicates = await pull(userId, state);
  const [categories, transactions] = await Promise.all([localCategories(), localTransactions()]);
  // Categories first: transactions reference them.
  await pushTable('categories', 'category', userId, categories, state.base.category, categoryPrint);
  await pushTable('transactions', 'transaction', userId, transactions, state.base.transaction, transactionPrint, duplicates);
}

// ---- Status, for the profile screen -------------------------------------------------------------

export type SyncStatus = { state: 'idle' | 'syncing' | 'synced' | 'failed'; at: number | null };

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

let running: Promise<boolean> | null = null;
let queued: Promise<boolean> | null = null;

async function run(userId: string): Promise<boolean> {
  setStatus({ ...status, state: 'syncing' });
  try {
    await sync(userId);
    setStatus({ state: 'synced', at: Date.now() });
    return true;
  } catch {
    setStatus({ ...status, state: 'failed' });
    return false;
  }
}

/**
 * Syncs, starting after any sync already in flight, so everything up to this call is covered.
 * Resolves false if it failed (offline, signed out meanwhile).
 */
export function syncNow(userId: string): Promise<boolean> {
  if (queued) return queued;
  const after = running;
  const next = (after ?? Promise.resolve(true)).then(() => {
    if (queued === next) queued = null;
    return run(userId);
  });
  if (after) queued = next;
  running = next;
  void next.then(() => {
    if (running === next) running = null;
  });
  return next;
}

/** Keeps the signed-in user's ledger and cloud copy in step while the app is open. */
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
      // Back in the app: pick up what other devices logged, and push what arrived while closed.
      if (next === 'active') soon();
    });
    return () => {
      clearTimeout(timer);
      ledger.remove();
      app.remove();
      setStatus({ state: 'idle', at: null });
    };
  }, [userId]);
}
