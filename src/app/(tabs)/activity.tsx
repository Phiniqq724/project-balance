import Search from '@expo/material-symbols/search.xml';
import { Box, Column, DockedSearchBar, Icon, LazyColumn, Row } from '@expo/ui/jetpack-compose';
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
import { useEffect, useState } from 'react';

import { Chip, Failed, Label, Loading, Rule, Screen } from '@/components/kit';
import { PullToReread } from '@/components/pull-to-reread';
import { TxRow } from '@/components/tx-row';
import { TxSheet } from '@/components/tx-sheet';
import { UnparsedCard, useApps } from '@/components/unparsed-card';
import { dayKey, dayLabel, digits } from '@/lib/format';
import {
  getCategories,
  getTransactions,
  getUnparsed,
  sourceLabel,
  transactionTitle,
  type Category,
  type RawNotification,
  type Transaction,
} from '@/lib/ledger';
import { askOnce } from '@/lib/review-alerts';
import { useLedger } from '@/lib/use-ledger';
import { color, space } from '@/theme';

type DayItem = { kind: 'day'; key: string; label: string; spent: number; received: number };
type Item = DayItem | { kind: 'tx'; key: string; tx: Transaction; pair?: Transaction };

async function loadActivity() {
  const [transactions, categories, unparsed] = await Promise.all([getTransactions(), getCategories(), getUnparsed()]);
  return { transactions, categories, unparsed };
}

/**
 * `f` in the URL: all, out, in, transfer, cat:<id> / cat:none, or review for notifications no rule
 * understood. Overview links here with a category; the review alerts link with review and `fix`.
 */
function matches(tx: Transaction, f: string) {
  if (f === 'all') return true;
  if (f === 'transfer') return tx.isTransfer;
  if (tx.isTransfer) return false;
  if (f === 'out' || f === 'in') return tx.direction === f;
  if (f.startsWith('cat:')) {
    const id = f.slice(4);
    return tx.direction === 'out' && (id === 'none' ? tx.categoryId === null : tx.categoryId === id);
  }
  return true;
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

function buildItems(transactions: Transaction[]): Item[] {
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
  return items;
}

export default function ActivityScreen() {
  const state = useLedger(loadActivity);
  const params = useLocalSearchParams<{ f?: string; fix?: string }>();
  const filter = params.f ?? 'all';
  const fixId = params.fix ? Number(params.fix) : null;
  const [openId, setOpenId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const apps = useApps();

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

  const { transactions, categories, unparsed } = state.data;
  const q = query.trim().toLowerCase();
  const appName = (source: string) => apps[source]?.label ?? sourceLabel(source);
  const visible = reviewing
    ? []
    : transactions.filter(
        (t) =>
          matches(t, filter) &&
          found(q, transactionTitle(t), t.categoryName, t.bankCategory, t.amount, appName(t.source))
      );
  const notes = reviewing
    ? unparsed
        .filter((n) => found(q, n.title, n.body, appName(n.source)))
        // A "Fix" tap from a review alert puts that card first.
        .sort((a, b) => Number(b.id === fixId) - Number(a.id === fixId))
    : [];
  const items = buildItems(visible);
  const maxDay = Math.max(1, ...items.map((i) => (i.kind === 'day' ? i.spent : 0)));
  const out = visible.reduce((sum, t) => (t.direction === 'out' && !t.isTransfer ? sum + t.amount : sum), 0);
  const income = visible.reduce((sum, t) => (t.direction === 'in' && !t.isTransfer ? sum + t.amount : sum), 0);
  const open = transactions.find((t) => t.id === openId);
  const count = reviewing ? notes.length : visible.length;

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
                {reviewing ? `${count} to check` : count === 1 ? '1 entry' : `${count} entries`}
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
          ) : items.length === 0 ? (
            <Label tone="muted" modifiers={[padding(space.page, 24, space.page, 0)]}>
              {transactions.length === 0 ? 'No transactions yet.' : 'Nothing here.'}
            </Label>
          ) : (
            <LazyColumn modifiers={[fillMaxSize()]} contentPadding={{ bottom: space.navClearance }}>
              <LazyColumn.Items data={items} keyExtractor={(item) => item.key}>
                {({ item }) =>
                  item.kind === 'day' ? (
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
