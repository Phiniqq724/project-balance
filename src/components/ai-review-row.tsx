import StarShine from '@expo/material-symbols/star_shine.xml';
import { Switch } from '@expo/ui/jetpack-compose';
import { useState } from 'react';

import { SettingsDivider, SettingsRow } from '@/components/kit';
import { setAiReviewEnabled } from '@/lib/ai-review';
import { BalanceCore, SETTINGS } from '@/lib/ledger';
import { useLedger } from '@/lib/use-ledger';
import { color } from '@/theme';

/** Profile row, with its divider below: send money-looking notifications from your picked apps to AI for you to confirm. Signed-in only. */
export function AiReviewRow() {
  const state = useLedger(() => BalanceCore.getSetting(SETTINGS.aiReview));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (state.status !== 'ready') return null;
  const on = state.data === '1';

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await setAiReviewEnabled(!on);
    } catch {
      setFailed(true);
    }
    setBusy(false);
  };

  return (
    <>
      <SettingsRow
        icon={StarShine}
        title="AI review"
        subtitle={failed ? "Couldn't change it" : 'Ask AI about unclear notifications'}
        onPress={toggle}
        trailing={<Switch value={on} enabled={!busy} colors={{ checkedTrackColor: color.text, checkedThumbColor: color.bg }} />}
      />
      <SettingsDivider />
    </>
  );
}
