import { Row } from '@expo/ui/jetpack-compose';
import { clickable, fillMaxWidth, padding, weight } from '@expo/ui/jetpack-compose/modifiers';
import { useState } from 'react';

import { Label } from '@/components/kit';
import { setAiReviewEnabled } from '@/lib/ai-review';
import { BalanceCore, SETTINGS } from '@/lib/ledger';
import { useLedger } from '@/lib/use-ledger';
import { space } from '@/theme';

/** Profile row: send money-looking notifications from your picked apps to AI for you to confirm. Signed-in only. */
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
    <Row verticalAlignment="center" modifiers={[fillMaxWidth(), clickable(toggle), padding(space.page, 18, space.page, 18)]}>
      <Label weight="medium" modifiers={[weight(1)]}>
        AI review
      </Label>
      <Label weight="medium" tone={failed ? 'danger' : 'muted'}>
        {failed ? 'Failed' : busy ? '…' : on ? 'On' : 'Off'}
      </Label>
    </Row>
  );
}
