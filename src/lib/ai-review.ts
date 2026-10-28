import { useEffect } from 'react';
import { AppState } from 'react-native';

import { redact } from '../../supabase/functions/_shared/redact';
import { BalanceCore, type Direction, type RawNotification } from './ledger';
import { supabase } from './supabase';
import { LOCAL_OWNER, type AiKind } from '../../modules/balance-core/src/BalanceCoreModule';

/**
 * AI review. Notifications no rule understood and that look like money wait in `ai_reviews` as
 * 'pending'. The native side drains them in the background (AiReviewWorker): with your own key
 * (see ai-key.ts) straight to the provider, otherwise, for cloud accounts, through the
 * classify-notification function. Results are only suggestions: nothing reaches the ledger until
 * the user confirms (see components/review.tsx).
 */

const DEBOUNCE_MS = 1500;

/** Asks the native side to read whatever is pending. Cheap; it does nothing when there is nothing to do. */
export function runAiReview(): Promise<void> {
  return BalanceCore.runAiReview().catch(() => {});
}

/** Nudges the queue while signed in: on mount, on new notifications and on foreground. */
export function useAiReview(userId: string) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void runAiReview(), DEBOUNCE_MS);
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

/** The user's answer: logs it (or drops it) on the phone, which also keeps it as a few-shot example; cloud accounts share it too. */
export async function answerReview(n: RawNotification, v: Verdict): Promise<void> {
  const counterparty = v.counterparty?.trim() || null;
  await BalanceCore.aiResolve(n.id, v.kind, v.direction, v.amount, counterparty);
  if (BalanceCore.activeUser() === LOCAL_OWNER) return; // No account to teach.
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
