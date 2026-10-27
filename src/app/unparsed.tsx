import { Column, LazyColumn, Row } from '@expo/ui/jetpack-compose';
import { background, fillMaxSize, fillMaxWidth, padding, paddingAll, weight } from '@expo/ui/jetpack-compose/modifiers';

import { ReviewActions } from '@/components/review';
import { useSession } from '@/lib/auth';
import { Failed, Label, Loading, Rule, Screen } from '@/components/kit';
import { shortDate, time } from '@/lib/format';
import { getUnparsed, sourceLabel } from '@/lib/ledger';
import { useLedger } from '@/lib/use-ledger';
import { color, space } from '@/theme';

export default function UnparsedScreen() {
  const state = useLedger(getUnparsed);
  const cloud = !!useSession();

  return (
    <Screen>
      <Column modifiers={[fillMaxSize()]}>
        <Column modifiers={[fillMaxWidth(), padding(space.page, 28, space.page, 16)]} verticalArrangement={{ spacedBy: 6 }}>
          <Label size={28} weight="bold">
            Not understood
          </Label>
          <Label size={14} tone="muted">
            Money mentioned, no rule matched.
          </Label>
        </Column>
        <Rule />

        {state.status === 'loading' && <Loading />}
        {state.status === 'error' && <Failed message="Couldn't load these." onRetry={state.retry} />}
        {state.status === 'ready' && state.data.length === 0 && (
          <Label tone="muted" modifiers={[padding(space.page, 24, space.page, 0)]}>
            Everything so far was understood.
          </Label>
        )}
        {state.status === 'ready' && state.data.length > 0 && (
          <LazyColumn modifiers={[fillMaxSize()]} contentPadding={{ bottom: 32 }}>
            <LazyColumn.Items data={state.data} keyExtractor={(n) => String(n.id)}>
              {({ item }) => (
                <Column modifiers={[fillMaxWidth(), padding(space.page, 16, space.page, 16)]} verticalArrangement={{ spacedBy: 6 }}>
                  <Row modifiers={[fillMaxWidth()]}>
                    <Label size={13} weight="medium" tone="muted" modifiers={[weight(1)]}>
                      {sourceLabel(item.source)}
                    </Label>
                    <Label size={13} tone="muted">
                      {`${shortDate(item.postedAt)}, ${time(item.postedAt)}`}
                    </Label>
                  </Row>
                  {item.title && <Label weight="medium">{item.title}</Label>}
                  <Label size={14} lineHeight={20} modifiers={[fillMaxWidth(), background(color.surface), paddingAll(12)]}>
                    {item.body}
                  </Label>
                  {cloud && item.review && <ReviewActions n={item} />}
                </Column>
              )}
            </LazyColumn.Items>
          </LazyColumn>
        )}
      </Column>
    </Screen>
  );
}
