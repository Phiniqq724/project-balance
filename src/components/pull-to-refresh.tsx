import { PullToRefreshBox } from '@expo/ui/jetpack-compose';
import { fillMaxSize } from '@expo/ui/jetpack-compose/modifiers';
import { useState, type ReactNode } from 'react';

import { useCloudUser } from '@/lib/auth';
import { syncNow } from '@/lib/sync';
import { color } from '@/theme';

/**
 * Pull down to sync with the account: fetch what other devices logged and send this phone's changes.
 * Notifications are not read again. Local mode has no account, so there is nothing to pull.
 * Screens reload on the ledger event.
 */
export function PullToRefresh({ children }: { children: ReactNode }) {
  const user = useCloudUser();
  const [running, setRunning] = useState(false);
  if (!user) return <>{children}</>;
  const run = async () => {
    if (running) return;
    setRunning(true);
    await syncNow(user.id);
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
