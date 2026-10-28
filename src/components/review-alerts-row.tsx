import Notifications from '@expo/material-symbols/notifications.xml';
import { Switch } from '@expo/ui/jetpack-compose';
import { useState } from 'react';

import { SettingsDivider, SettingsRow } from '@/components/kit';
import { BalanceCore, SETTINGS } from '@/lib/ledger';
import { setAlerts } from '@/lib/review-alerts';
import { useLedger } from '@/lib/use-ledger';
import { color } from '@/theme';

/** Profile row, with its divider below: a notification for each thing that needs your answer. */
export function ReviewAlertsRow() {
  const state = useLedger(() => BalanceCore.getSetting(SETTINGS.reviewAlerts));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (state.status !== 'ready') return null;
  const on = state.data !== '0';

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await setAlerts(!on);
    } catch {
      setFailed(true);
    }
    setBusy(false);
  };

  return (
    <>
      <SettingsRow
        icon={Notifications}
        title="Alerts"
        subtitle={failed ? "Couldn't change it" : 'Ask me about new ones'}
        onPress={toggle}
        trailing={<Switch value={on} enabled={!busy} colors={{ checkedTrackColor: color.text, checkedThumbColor: color.bg }} />}
      />
      <SettingsDivider />
    </>
  );
}
