import { PullToRefreshBox } from '@expo/ui/jetpack-compose';
import { fillMaxSize } from '@expo/ui/jetpack-compose/modifiers';
import { useState, type ReactNode } from 'react';

import { useCloudUser } from '@/lib/auth';
import { BalanceCore } from '@/lib/ledger';
import { syncNow } from '@/lib/sync';
import { color } from '@/theme';

/**
 * Pull down to fetch what other devices logged (signed in), then re-read every saved notification
 * with the current rules. Screens reload on the ledger event.
 */
export function PullToReread({ children }: { children: ReactNode }) {
  const user = useCloudUser();
  const [running, setRunning] = useState(false);
  const run = async () => {
    if (running) return;
    setRunning(true);
    if (user) await syncNow(user.id);
    await BalanceCore.reprocessAll().catch(() => undefined);
    setRunning(false);
  };
  return (
    <PullToRefreshBox
      isRefreshing={running}
      onRefresh={() => void run()}
      // The spinner follows the box's alignment; Expo UI drops Compose's default top-center.
      contentAlignment="topCenter"
      indicator={{ color: color.accent, containerColor: color.raised }}
      modifiers={[fillMaxSize()]}>
      {children}
    </PullToRefreshBox>
  );
}
