import { PullToRefreshBox } from '@expo/ui/jetpack-compose';
import { fillMaxSize } from '@expo/ui/jetpack-compose/modifiers';
import { useState, type ReactNode } from 'react';

import { BalanceCore } from '@/lib/ledger';
import { color } from '@/theme';

/** Pull down to re-read every saved notification with the current rules. Screens reload on the ledger event. */
export function PullToReread({ children }: { children: ReactNode }) {
  const [running, setRunning] = useState(false);
  const run = async () => {
    if (running) return;
    setRunning(true);
    await BalanceCore.reprocessAll().catch(() => undefined);
    setRunning(false);
  };
  return (
    <PullToRefreshBox
      isRefreshing={running}
      onRefresh={() => void run()}
      indicator={{ color: color.accent, containerColor: color.raised }}
      modifiers={[fillMaxSize()]}>
      {children}
    </PullToRefreshBox>
  );
}
