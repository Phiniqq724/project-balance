import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { BalanceCore } from './ledger';
import { supabase } from './supabase';
import { useCloudSync } from './sync';

/** undefined while the stored session is still being read. */
const AuthContext = createContext<Session | null | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    let activeUser: string | null | undefined;
    // Auth events can arrive back to back; apply them in order.
    let queue = Promise.resolve();

    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      queue = queue.then(async () => {
        const userId = next?.user.id ?? null;
        if (userId !== activeUser) {
          try {
            // Point the ledger at this user's file before any screen reads it.
            await BalanceCore.setActiveUser(userId);
            activeUser = userId;
          } catch {
            if (!cancelled) setSession(null);
            return;
          }
        }
        if (!cancelled) setSession(next);
      });
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={session}>
      {session && <CloudSync userId={session.user.id} />}
      {children}
    </AuthContext.Provider>
  );
}

function CloudSync({ userId }: { userId: string }) {
  useCloudSync(userId);
  return null;
}

export function useSession(): Session | null | undefined {
  return useContext(AuthContext);
}

/** The signed-in session. Only use on screens behind the sign-in guard. */
export function useUser() {
  const session = useContext(AuthContext);
  if (!session) throw new Error('useUser called while signed out');
  return session.user;
}
