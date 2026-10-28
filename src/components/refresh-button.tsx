import Refresh from '@expo/material-symbols/refresh.xml';
import { Box, CircularProgressIndicator, Icon } from '@expo/ui/jetpack-compose';
import { clickable, clip, Shapes, size } from '@expo/ui/jetpack-compose/modifiers';
import { useState } from 'react';

import { BalanceCore } from '@/lib/ledger';
import { color } from '@/theme';

/** Re-reads every saved notification with the current rules. Screens reload on the ledger event. */
export function RefreshButton() {
  const [running, setRunning] = useState(false);
  const run = async () => {
    if (running) return;
    setRunning(true);
    await BalanceCore.reprocessAll().catch(() => undefined);
    setRunning(false);
  };
  return (
    <Box modifiers={[size(48, 48), clip(Shapes.Circle), clickable(() => void run())]} contentAlignment="center">
      {running ? (
        <CircularProgressIndicator color={color.muted} strokeWidth={2} modifiers={[size(20, 20)]} />
      ) : (
        <Icon source={Refresh} size={24} tint={color.text} contentDescription="Re-read notifications" />
      )}
    </Box>
  );
}
