import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { BalanceCore } from './ledger';

type Loaded<T> = { status: 'loading' } | { status: 'error'; error: Error } | { status: 'ready'; data: T };

export type LedgerState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: Error; retry: () => void }
  | { status: 'ready'; data: T };

/**
 * Runs a ledger read and re-runs it whenever the listener writes something new
 * or the app comes back to the foreground (the day may have changed).
 */
export function useLedger<T>(load: () => Promise<T>): LedgerState<T> {
  const [loaded, setLoaded] = useState<Loaded<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  // Callers pass inline loaders; keep the latest one without re-subscribing every render.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      loadRef
        .current()
        .then((data) => {
          if (!cancelled) setLoaded({ status: 'ready', data });
        })
        .catch((error: unknown) => {
          if (!cancelled) setLoaded({ status: 'error', error: error instanceof Error ? error : new Error(String(error)) });
        });
    };

    run();
    const ledger = BalanceCore.addListener('onLedgerChanged', run);
    const app = AppState.addEventListener('change', (next) => {
      if (next === 'active') run();
    });
    return () => {
      cancelled = true;
      ledger.remove();
      app.remove();
    };
  }, [attempt]);

  if (loaded.status !== 'error') return loaded;
  return {
    ...loaded,
    retry: () => {
      setLoaded({ status: 'loading' });
      setAttempt((n) => n + 1);
    },
  };
}
