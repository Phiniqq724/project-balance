import Search from '@expo/material-symbols/search.xml';
import { Box, CircularProgressIndicator, Column, DockedSearchBar, Icon, LazyColumn, Row } from '@expo/ui/jetpack-compose';
import {
  background,
  fillMaxSize,
  fillMaxWidth,
  height,
  horizontalScroll,
  padding,
  weight,
} from '@expo/ui/jetpack-compose/modifiers';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';

import { Chip, Failed, Label, Loading, Rule, Screen } from '@/components/kit';
import { PullToReread } from '@/components/pull-to-reread';
import { TxRow } from '@/components/tx-row';
import { TxSheet } from '@/components/tx-sheet';
import { UnparsedCard, useApps } from '@/components/unparsed-card';
import { dayKey, dayLabel, digits } from '@/lib/format';
import {
  getActivityPage,
  getCategories,
  getTransactionSources,
  getUnparsed,
  sourceLabel,
  type Category,
  type RawNotification,
  type Transaction,
} from '@/lib/ledger';
import { askOnce } from '@/lib/review-alerts';
import { useLedger } from '@/lib/use-ledger';
import { color, space } from '@/theme';

type DayItem = { kind: 'day'; key: string; label: string; spent: number; received: number };
type Item = DayItem | { kind: 'tx'; key: string; tx: Transaction; pair?: Transaction } | { kind: 'more'; key: string };
/** Top of the All list: Today's header with everything still to check right under it. */
type TopItem = DayItem | { kind: 'note'; key: string; n: RawNotification };

const PAGE = 25;

/**
 * `f` in the URL: all, out, in, transfer, cat:<id> / cat:none, or review for notifications no rule
 * understood. Overview links here with a category; the review alerts link with review and `fix`.
 * Filter and search run in SQL; only the newest `count` entries (whole days) come back.
 */
async function loadActivity(filter: string, q: string, count: number, appName: (source: string) => string) {
  const reviewing = filter === 'review';
  let sources: string[] = [];
  if (q && !reviewing) sources = (await getTransactionSources()).filter((s) => appName(s).toLowerCase().includes(q));
  const [page, categories, unparsed] = await Promise.all([
    reviewing ? null : getActivityPage({ filter, q, sources }, count),
    getCategories(),
    getUnparsed(),
  ]);
  return {
    transactions: page?.transactions ?? [],
    total: page?.total ?? 0,
    spent: page?.spent ?? 0,
    received: page?.received ?? 0,
    hasMore: page?.hasMore ?? false,
    categories,
    unparsed,
    // When this load ran; "today" for putting what's to check under Today.
    now: new Date(),
  };
}

/** Name, category, amount or app; "25000" and "25.000" both find Rp 25.000. */
function found(q: string, ...fields: (string | number | null)[]) {
  if (!q) return true;
  const number = q.replace(/[.,]/g, '');
  return fields.some((f) => {
    if (f === null) return false;
    if (typeof f === 'number') return /^\d+$/.test(number) && String(f).includes(number);
    return f.toLowerCase().includes(q);
  });
}

function buildItems(transactions: Transaction[], moreKey: string | null): Item[] {
  const byId = new Map(transactions.map((t) => [t.id, t]));
  const items: Item[] = [];
  const days = new Map<string, DayItem>();
  for (const tx of transactions) {
    const pair = tx.isTransfer && tx.pairId !== null ? byId.get(tx.pairId) : undefined;
    // Both halves of an own transfer collapse into the outgoing one.
    if (pair && tx.direction === 'in') continue;

    const key = dayKey(tx.occurredAt);
    let day = days.get(key);
    if (!day) {
      day = { kind: 'day', key, label: dayLabel(tx.occurredAt), spent: 0, received: 0 };
      days.set(key, day);
      items.push(day);
    }
    if (!tx.isTransfer) {
      if (tx.direction === 'out') day.spent += tx.amount;
      else day.received += tx.amount;
    }
    items.push({ kind: 'tx', key: `tx${tx.id}`, tx, pair });
  }
  if (moreKey && items.length > 0) items.push({ kind: 'more', key: moreKey });
  return items;
}

export default function ActivityScreen() {
  const params = useLocalSearchParams<{ f?: string; fix?: string }>();
  const filter = params.f ?? 'all';
  const fixId = params.fix ? Number(params.fix) : null;
  const [openId, setOpenId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const apps = useApps();
  // Search waits for a short pause in typing so each keystroke doesn't hit the ledger.
  const [q, setQ] = useState('');
  useEffect(() => {
    const next = query.trim().toLowerCase();
    const t = setTimeout(() => setQ(next), next ? 250 : 0);
    return () => clearTimeout(t);
  }, [query]);
  const appName = (source: string) => apps[source]?.label ?? sourceLabel(source);

  // How many entries are loaded; back to one page whenever the filter or search changes.
  const scope = `${filter}|${q}`;
  const [paging, setPaging] = useState({ scope, count: PAGE });
  const count = paging.scope === scope ? paging.count : PAGE;
  // Ledger changes reload what is already loaded instead of dropping back to one page.
  const state = useLedger(() => loadActivity(filter, q, count, appName), [filter, q, count, apps]);
  const more = useMemo(
    () => () => setPaging((p) => ({ scope, count: (p.scope === scope ? p.count : PAGE) + PAGE })),
    [scope]
  );

  const reviewing = filter === 'review';
  const toCheck = state.status === 'ready' ? state.data.unparsed.length : 0;
  // The first time there is something to check, ask once to be allowed to tell them about the next ones.
  useEffect(() => {
    if (reviewing && toCheck > 0) askOnce().catch(() => {});
  }, [reviewing, toCheck]);

  if (state.status !== 'ready') {
    return (
      <Screen>
        {state.status === 'loading' ? <Loading /> : <Failed message="Couldn't load activity." onRetry={state.retry} />}
      </Screen>
    );
  }

  const { transactions, categories, unparsed, total, hasMore } = state.data;
  const notes = reviewing
    ? unparsed
        .filter((n) => found(q, n.title, n.body, appName(n.source)))
        // A "Fix" tap from a review alert puts that card first.
        .sort((a, b) => Number(b.id === fixId) - Number(a.id === fixId))
    : [];
  const items = buildItems(transactions, hasMore ? `more${count}-${transactions.length}` : null);
  const maxDay = Math.max(1, ...items.map((i) => (i.kind === 'day' ? i.spent : 0)));
  // In All, what still waits for an answer sits at the top of Today, whatever day it came in.
  const pending = filter === 'all' ? unparsed.filter((n) => found(q, n.title, n.body, appName(n.source))) : [];
  const top: TopItem[] = [];
  if (pending.length > 0) {
    const { now } = state.data;
    const at = items.findIndex((i) => i.kind === 'day' && i.key === dayKey(now));
    const today = at >= 0 ? (items.splice(at, 1)[0] as DayItem) : { kind: 'day' as const, key: dayKey(now), label: dayLabel(now), spent: 0, received: 0 };
    top.push(today, ...pending.map((n) => ({ kind: 'note' as const, key: `note${n.id}`, n })));
  }
  const out = state.data.spent;
  const income = state.data.received;
  const open = transactions.find((t) => t.id === openId);
  const shown = reviewing ? notes.length : total;

  return (
    <Screen>
      <PullToReread>
        <Column modifiers={[fillMaxSize()]}>
          <Column modifiers={[fillMaxWidth(), padding(space.page, 28, space.page, 0)]} verticalArrangement={{ spacedBy: 4 }}>
            <Row verticalAlignment="bottom" modifiers={[fillMaxWidth()]}>
              <Label size={28} weight="bold" modifiers={[weight(1)]}>
                Activity
              </Label>
              <Label size={13} tone="muted" modifiers={[padding(0, 0, 0, 6)]}>
                {reviewing ? `${shown} to check` : shown === 1 ? '1 entry' : `${shown} entries`}
              </Label>
            </Row>
            {!reviewing && (
              <Row horizontalArrangement={{ spacedBy: 16 }}>
                <Label size={14} weight="medium" tone="accent">{`−${digits(out)}`}</Label>
                <Label size={14} weight="medium" tone="income">{`+${digits(income)}`}</Label>
              </Row>
            )}
          </Column>

          {/* Same docked bar as manage-kontrakan's members and settings. */}
          <DockedSearchBar onQueryChange={setQuery} modifiers={[fillMaxWidth(), padding(space.page, 16, space.page, 0)]}>
            <DockedSearchBar.Placeholder>
              <Label tone="muted">Search</Label>
            </DockedSearchBar.Placeholder>
            <DockedSearchBar.LeadingIcon>
              <Icon source={Search} tint={color.muted} size={20} />
            </DockedSearchBar.LeadingIcon>
          </DockedSearchBar>

          <FilterStrip filter={filter} categories={categories} toCheck={toCheck} />
          <Rule />

          {reviewing ? (
            notes.length === 0 ? (
              <Label tone="muted" modifiers={[padding(space.page, 24, space.page, 0)]}>
                {unparsed.length === 0 ? 'Nothing to check.' : 'Nothing here.'}
              </Label>
            ) : (
              <LazyColumn
                modifiers={[fillMaxSize()]}
                verticalArrangement={{ spacedBy: 10 }}
                contentPadding={{ start: space.page, end: space.page, top: 16, bottom: space.navClearance }}>
                {/* No recycling: a recycled card would hand its pressed state to the next item. */}
                <LazyColumn.Items data={notes} keyExtractor={(n: RawNotification) => String(n.id)} recycling={false}>
                  {({ item }) => (
                    <UnparsedCard
                      n={item}
                      icon={apps[item.source]?.icon ?? null}
                      label={apps[item.source]?.label ?? sourceLabel(item.source)}
                      fixing={item.id === fixId}
                    />
                  )}
                </LazyColumn.Items>
              </LazyColumn>
            )
          ) : items.length === 0 && top.length === 0 ? (
            <Label tone="muted" modifiers={[padding(space.page, 24, space.page, 0)]}>
              {filter === 'all' && !q ? 'No transactions yet.' : 'Nothing here.'}
            </Label>
          ) : (
            <LazyColumn modifiers={[fillMaxSize()]} contentPadding={{ bottom: space.navClearance }}>
              {/* No recycling here: a recycled card would hand its pressed state to the next one. */}
              <LazyColumn.Items data={top} keyExtractor={(item: TopItem) => item.key} recycling={false}>
                {({ item }) =>
                  item.kind === 'day' ? (
                    <DayHeader day={item} max={maxDay} />
                  ) : (
                    <Box modifiers={[fillMaxWidth(), padding(space.page, 6, space.page, 6)]}>
                      <UnparsedCard
                        n={item.n}
                        icon={apps[item.n.source]?.icon ?? null}
                        label={apps[item.n.source]?.label ?? sourceLabel(item.n.source)}
                        fixing={false}
                      />
                    </Box>
                  )
                }
              </LazyColumn.Items>
              <LazyColumn.Items data={items} keyExtractor={(item) => item.key}>
                {({ item }) =>
                  item.kind === 'more' ? (
                    <MoreSentinel at={item.key} onMore={more} />
                  ) : item.kind === 'day' ? (
                    <DayHeader day={item} max={maxDay} />
                  ) : (
                    <TxRow tx={item.tx} pair={item.pair} onPress={() => setOpenId(item.tx.id)} />
                  )
                }
              </LazyColumn.Items>
            </LazyColumn>
          )}
        </Column>
      </PullToReread>

      {open && <TxSheet key={open.id} tx={open} categories={categories} onClose={() => setOpenId(null)} />}
    </Screen>
  );
}

/** Last row of a partial list: when it gets composed the user is near the end, so ask for the next page. */
function MoreSentinel({ at, onMore }: { at: string; onMore: () => void }) {
  useEffect(() => {
    onMore();
    // One request per sentinel; a recycled view with a new key asks again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at]);
  return (
    <Row horizontalArrangement="center" modifiers={[fillMaxWidth(), padding(0, 16, 0, 16)]}>
      <CircularProgressIndicator color={color.muted} />
    </Row>
  );
}

function FilterStrip({ filter, categories, toCheck }: { filter: string; categories: Category[]; toCheck: number }) {
  const options = [
    { value: 'all', label: 'All' },
    // Only there while something waits, or while it's the open filter.
    ...(toCheck > 0 || filter === 'review' ? [{ value: 'review', label: toCheck > 0 ? `To check ${toCheck}` : 'To check' }] : []),
    { value: 'out', label: 'Spent' },
    { value: 'in', label: 'Received' },
    { value: 'transfer', label: 'Transfers' },
    ...categories.map((c) => ({ value: `cat:${c.id}`, label: c.name })),
    { value: 'cat:none', label: 'No category' },
  ];

  return (
    <Row
      horizontalArrangement={{ spacedBy: 6 }}
      modifiers={[fillMaxWidth(), horizontalScroll(), padding(space.page, 14, space.page, 14)]}>
      {options.map((o) => (
        <Chip key={o.value} label={o.label} selected={o.value === filter} onPress={() => router.setParams({ f: o.value, fix: undefined })} />
      ))}
    </Row>
  );
}

/** Day label and total, with a hairline bar showing how heavy the day was against the busiest one listed. */
function DayHeader({ day, max }: { day: DayItem; max: number }) {
  return (
    <Column modifiers={[fillMaxWidth(), padding(space.page, 24, space.page, 4)]} verticalArrangement={{ spacedBy: 8 }}>
      <Row verticalAlignment="center" horizontalArrangement={{ spacedBy: 12 }} modifiers={[fillMaxWidth()]}>
        <Label size={13} weight="bold" modifiers={[weight(1)]}>
          {day.label}
        </Label>
        {day.received > 0 && (
          <Label size={13} weight="medium" tone="income">
            {`+${digits(day.received)}`}
          </Label>
        )}
        {day.spent > 0 && (
          <Label size={13} weight="medium" tone="accent">
            {`−${digits(day.spent)}`}
          </Label>
        )}
      </Row>
      <Box modifiers={[fillMaxWidth(), height(2), background(color.line)]}>
        {day.spent > 0 && <Box modifiers={[fillMaxWidth(Math.max(day.spent / max, 0.01)), height(2), background(color.accent)]} />}
      </Box>
    </Column>
  );
}
