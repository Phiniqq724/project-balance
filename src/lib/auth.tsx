import type { Session, User } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { LOCAL_OWNER } from '../../modules/balance-core/src/BalanceCoreModule';
import { useAiReview } from './ai-review';
import { BalanceCore } from './ledger';
import { supabase } from './supabase';
import { syncNow, useCloudSync } from './sync';

/**
 * cloud: signed in with Google, the ledger is backed up to Supabase.
 * local: no account, the ledger lives only on this phone.
 * none: nothing chosen yet (sign-in screen).
 *
 * The native side stores which ledger is open ("balance.account" prefs), so the notification
 * listener and widgets follow the same choice with the app closed.
 */
export type Account = { mode: 'cloud'; session: Session } | { mode: 'local' } | { mode: 'none' };

// ---- Mode switching, outside React so screens can call it directly ----------------------------

let render: ((account: Account) => void) | null = null;
// Auth events and mode switches can arrive back to back; apply them in order.
let queue = Promise.resolve();
// Set while moving to local mode, so the "no session" that follows opens the phone-only ledger.
let toLocal = false;

/** Points the native ledger at whoever this session (or the stored mode) says, then renders it. */
function apply(session: Session | null): Promise<void> {
  queue = queue.then(async () => {
    const stored = BalanceCore.activeUser();
    const owner = session ? session.user.id : toLocal || stored === LOCAL_OWNER ? LOCAL_OWNER : null;
    toLocal = false;
    try {
      // local -> account merges the phone-only ledger into the account's; account -> local carries it over.
      if (owner !== stored) await BalanceCore.setActiveUser(owner);
    } catch {
      render?.({ mode: 'none' });
      return;
    }
    if (session) render?.({ mode: 'cloud', session });
    else render?.({ mode: owner === LOCAL_OWNER ? 'local' : 'none' });
  });
  return queue;
}

/** Use the app with no account. */
export function chooseLocal(): Promise<void> {
  toLocal = true;
  return apply(null);
}

/** Stops syncing and keeps everything on this phone. Nothing in the cloud is deleted. */
export async function switchToLocal(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  // Last push first, so nothing logged since the last sync is missing from the cloud.
  if (data.session) await syncNow(data.session.user.id);
  toLocal = true;
  // Local scope: other phones on this account stay signed in. The session is dropped even offline.
  await supabase.auth.signOut({ scope: 'local' });
  // Covers a sign-out that fired no event; a no-op after the one that did.
  await apply(null);
}

/** Back to the sign-in screen. The account's ledger stays on the phone for the next sign-in. */
export async function signOut(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (data.session) await syncNow(data.session.user.id);
  await supabase.auth.signOut({ scope: 'local' });
  await BalanceCore.forgetGoogleAccount().catch(() => undefined);
  await apply(null);
}

// ---- Provider ----------------------------------------------------------------------------------

/** undefined while the stored session is still being read. */
const AccountContext = createContext<Account | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | undefined>(undefined);

  useEffect(() => {
    render = setAccount;
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      void apply(next);
    });
    return () => {
      render = null;
      data.subscription.unsubscribe();
    };
  }, []);

  return (
    <AccountContext.Provider value={account}>
      {account?.mode === 'cloud' && <CloudSync userId={account.session.user.id} />}
      {children}
    </AccountContext.Provider>
  );
}

function CloudSync({ userId }: { userId: string }) {
  useCloudSync(userId);
  useAiReview(userId);
  return null;
}

export function useAccount(): Account | undefined {
  return useContext(AccountContext);
}

/** The Google-signed-in user, or null in local mode. */
export function useCloudUser(): User | null {
  const account = useContext(AccountContext);
  return account?.mode === 'cloud' ? account.session.user : null;
}

/** The signed-in user. Only use where local mode can't reach (it throws there). */
export function useUser(): User {
  const user = useCloudUser();
  if (!user) throw new Error('useUser called without a cloud account');
  return user;
}
