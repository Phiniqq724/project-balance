import { FunctionsHttpError } from '@supabase/supabase-js';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { redact } from '../../supabase/functions/_shared/redact';
import { BalanceCore, SETTINGS, type Direction, type RawNotification } from './ledger';
import { supabase } from './supabase';
import type { AiKind } from '../../modules/balance-core/src/BalanceCoreModule';

/**
 * AI review (cloud accounts only). Notifications no rule understood and that look like money
 * wait in `ai_reviews` as 'pending'. This drains them in small batches through the
 * classify-notification function, which only ever produces suggestions: nothing reaches the
 * ledger until the user confirms (see components/review.tsx).
 */

const BATCH = 10;
const DEBOUNCE_MS = 1500;
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000];

type Answer = {
  id: string;
  kind: AiKind;
  direction: Direction;
  amount: number;
  counterparty: string | null;
  confidence: number;
};

let running = false;
let blockedUntil = 0;
let strikes = 0;

async function pendingBatch(): Promise<{ id: number; app: string; text: string }[]> {
  const rows = await BalanceCore.query(
    `SELECT r.id, r.package, r.title, r.body FROM ai_reviews a JOIN raw_notifications r ON r.id = a.raw_id
     WHERE a.state = 'pending' ORDER BY r.posted_at DESC LIMIT ?`,
    [BATCH]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    app: String(r.package),
    text: redact([r.title, r.body].filter(Boolean).join(' - ')),
  }));
}

/** Seconds the server asked us to wait, or null when the failure is not a rate limit. */
async function retryAfter(error: unknown): Promise<number | null> {
  if (!(error instanceof FunctionsHttpError)) return null;
  const response = error.context as Response;
  if (response.status !== 429) return null;
  const header = Number(response.headers.get('Retry-After'));
  return Number.isFinite(header) && header > 0 ? header : 60;
}

/** One pass over the pending queue. Safe to call often; returns whether it is worth calling again soon. */
export async function runAiReview(): Promise<void> {
  if (running || Date.now() < blockedUntil) return;
  running = true;
  try {
    if ((await BalanceCore.getSetting(SETTINGS.aiReview)) !== '1') return;
    for (;;) {
      const batch = await pendingBatch();
      if (batch.length === 0) return;

      const { data, error } = await supabase.functions.invoke<{ results: Answer[] }>('classify-notification', {
        body: { items: batch.map((b) => ({ id: String(b.id), app: b.app, text: b.text })) },
      });

      if (error) {
        const wait = await retryAfter(error);
        blockedUntil = Date.now() + (wait != null ? wait * 1000 : BACKOFF_MS[Math.min(strikes, BACKOFF_MS.length - 1)]);
        strikes += 1;
        return; // Still 'pending'; the next trigger after the wait picks them up.
      }
      strikes = 0;

      const byId = new Map((data?.results ?? []).map((r) => [r.id, r]));
      for (const item of batch) {
        const a = byId.get(String(item.id));
        if (a) await BalanceCore.aiSuggest(item.id, a.kind, a.direction, a.amount, a.counterparty, a.confidence);
        else await BalanceCore.aiFailed(item.id);
      }
    }
  } catch {
    blockedUntil = Date.now() + BACKOFF_MS[Math.min(strikes, BACKOFF_MS.length - 1)];
    strikes += 1;
  } finally {
    running = false;
  }
}

/** Keeps the queue draining while signed in: on new notifications, on foreground, and after a rate-limit wait. */
export function useAiReview(userId: string) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      const wait = Math.max(DEBOUNCE_MS, blockedUntil - Date.now() + 500);
      timer = setTimeout(() => {
        void runAiReview().then(() => {
          // A rate limit left work behind: come back once the wait is over.
          if (blockedUntil > Date.now()) schedule();
        });
      }, wait);
    };
    schedule();
    const ledger = BalanceCore.addListener('onLedgerChanged', schedule);
    const app = AppState.addEventListener('change', (next) => {
      if (next === 'active') schedule();
    });
    return () => {
      clearTimeout(timer);
      ledger.remove();
      app.remove();
    };
  }, [userId]);
}

export type Verdict = { kind: AiKind; direction: Direction; amount: number; counterparty: string | null };

/** The user's answer: logs it (or drops it) on the phone, then keeps it as a few-shot example for next time. */
export async function answerReview(n: RawNotification, v: Verdict): Promise<void> {
  const counterparty = v.counterparty?.trim() || null;
  await BalanceCore.aiResolve(n.id, v.kind, v.direction, v.amount, counterparty);
  // Best effort: a failed upload only means the model learns less.
  const text = redact([n.title, n.body].filter(Boolean).join(' - '));
  await supabase
    .from('ai_examples')
    .insert({ text, kind: v.kind, direction: v.direction, amount: v.amount, counterparty })
    .then(undefined, () => undefined);
}

/** Turns AI review on or off for this account's ledger. */
export function setAiReviewEnabled(on: boolean): Promise<void> {
  return BalanceCore.setAiReview(on);
}
