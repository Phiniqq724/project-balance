import { Box, Column, Image, Row } from '@expo/ui/jetpack-compose';
import { background, clip, fillMaxWidth, paddingAll, Shapes, size, weight } from '@expo/ui/jetpack-compose/modifiers';
import { useEffect, useState } from 'react';

import { Label } from '@/components/kit';
import { ReviewActions } from '@/components/review';
import { dayLabel, time } from '@/lib/format';
import { BalanceCore, type RawNotification } from '@/lib/ledger';
import { color } from '@/theme';

/** Installed apps by package, for their icon and name. */
export function useApps() {
  const [apps, setApps] = useState<Record<string, { label: string; icon: string | null }>>({});
  useEffect(() => {
    BalanceCore.installedApps()
      .then((list) => setApps(Object.fromEntries(list.map((a) => [a.package, a]))))
      .catch(() => {});
  }, []);
  return apps;
}

/** A notification no rule understood, with the AI's reading and the ways to answer it. */
export function UnparsedCard({ n, icon, label, fixing }: { n: RawNotification; icon: string | null; label: string; fixing: boolean }) {
  return (
    <Column
      modifiers={[fillMaxWidth(), clip(Shapes.RoundedCorner(16)), background(fixing ? color.raised : color.surface), paddingAll(16)]}
      verticalArrangement={{ spacedBy: 12 }}>
      <Row verticalAlignment="center" horizontalArrangement={{ spacedBy: 10 }} modifiers={[fillMaxWidth()]}>
        <AppIcon uri={icon} label={label} />
        <Label size={13} weight="medium" tone="muted" maxLines={1} overflow="ellipsis" modifiers={[weight(1)]}>
          {label}
        </Label>
        <Label size={13} tone="muted">
          {`${dayLabel(n.postedAt)}, ${time(n.postedAt)}`}
        </Label>
      </Row>
      <Column verticalArrangement={{ spacedBy: 4 }}>
        {n.title && <Label weight="bold">{n.title}</Label>}
        <Label size={14} lineHeight={20} tone="muted" maxLines={4} overflow="ellipsis">
          {n.body}
        </Label>
      </Column>
      <ReviewActions n={n} openFix={fixing} />
    </Column>
  );
}

function AppIcon({ uri, label }: { uri: string | null; label: string }) {
  if (uri) {
    return <Image source={{ uri }} contentDescription={null} modifiers={[size(28, 28), clip(Shapes.RoundedCorner(8))]} />;
  }
  return (
    <Box modifiers={[size(28, 28), clip(Shapes.Circle), background(color.raised)]} contentAlignment="center">
      <Label size={13} weight="bold" tone="muted">
        {label.slice(0, 1).toUpperCase()}
      </Label>
    </Box>
  );
}
