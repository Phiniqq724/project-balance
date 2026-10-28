import Back from '@expo/material-symbols/arrow_back.xml';
import { Box, Column, Icon, Image, LazyColumn, Row } from '@expo/ui/jetpack-compose';
import { background, clickable, clip, fillMaxSize, fillMaxWidth, padding, paddingAll, Shapes, size, weight } from '@expo/ui/jetpack-compose/modifiers';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { Failed, Label, Loading, Screen } from '@/components/kit';
import { ReviewActions } from '@/components/review';
import { useCloudUser } from '@/lib/auth';
import { dayLabel, time } from '@/lib/format';
import { BalanceCore, getUnparsed, sourceLabel, type RawNotification } from '@/lib/ledger';
import { useLedger } from '@/lib/use-ledger';
import { color, space } from '@/theme';

/** Installed apps by package, for their icon and name. */
function useApps() {
  const [apps, setApps] = useState<Record<string, { label: string; icon: string | null }>>({});
  useEffect(() => {
    BalanceCore.installedApps()
      .then((list) => setApps(Object.fromEntries(list.map((a) => [a.package, a]))))
      .catch(() => {});
  }, []);
  return apps;
}

export default function UnparsedScreen() {
  const state = useLedger(getUnparsed);
  const cloud = !!useCloudUser();
  const apps = useApps();

  return (
    <Screen>
      <Column modifiers={[fillMaxSize()]}>
        <Row verticalAlignment="center" horizontalArrangement={{ spacedBy: 4 }} modifiers={[fillMaxWidth(), padding(8, 8, space.page, 8)]}>
          <Box modifiers={[size(48, 48), clip(Shapes.Circle), clickable(() => router.back())]} contentAlignment="center">
            <Icon source={Back} size={24} tint={color.text} contentDescription="Back" />
          </Box>
          <Label size={28} weight="bold">
            Inbox
          </Label>
        </Row>

        {state.status === 'loading' && <Loading />}
        {state.status === 'error' && <Failed message="Couldn't load these." onRetry={state.retry} />}
        {state.status === 'ready' && state.data.length === 0 && (
          <Label tone="muted" modifiers={[padding(space.page, 16, space.page, 0)]}>
            Nothing to check.
          </Label>
        )}
        {state.status === 'ready' && state.data.length > 0 && (
          <LazyColumn
            modifiers={[fillMaxSize()]}
            verticalArrangement={{ spacedBy: 10 }}
            contentPadding={{ start: space.page, end: space.page, top: 8, bottom: 32 }}>
            {/* No recycling: a recycled row would hand one card's pressed state to the next item. */}
            <LazyColumn.Items data={state.data} keyExtractor={(n) => String(n.id)} recycling={false}>
              {({ item }) => (
                <Card n={item} icon={apps[item.source]?.icon ?? null} label={apps[item.source]?.label ?? sourceLabel(item.source)} cloud={cloud} />
              )}
            </LazyColumn.Items>
          </LazyColumn>
        )}
      </Column>
    </Screen>
  );
}

function Card({ n, icon, label, cloud }: { n: RawNotification; icon: string | null; label: string; cloud: boolean }) {
  return (
    <Column
      modifiers={[fillMaxWidth(), clip(Shapes.RoundedCorner(16)), background(color.surface), paddingAll(16)]}
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
      {cloud && n.review && <ReviewActions n={n} />}
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
