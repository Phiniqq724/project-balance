import { Box, Column, LazyColumn, Row } from '@expo/ui/jetpack-compose';
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
import { useState } from 'react';

import { Chip, Failed, Label, Loading, Rule, Screen } from '@/components/kit';
import { RefreshButton } from '@/components/refresh-button';
import { TxRow } from '@/components/tx-row';
import { TxSheet } from '@/components/tx-sheet';
import { dayKey, dayLabel, digits } from '@/lib/format';
import { getCategories, getTransactions, type Category, type Transaction } from '@/lib/ledger';
import { useLedger } from '@/lib/use-ledger';
import { color, space } from '@/theme';

type DayItem = { kind: 'day'; key: string; label: string; spent: number; received: number };
type Item = DayItem | { kind: 'tx'; key: string; tx: Transaction; pair?: Transaction };

async function loadActivity() {
  const [transactions, categories] = await Promise.all([getTransactions(), getCategories()]);
  return { transactions, categories };
}

/** `f` in the URL: all, out, in, transfer, or cat:<id> / cat:none. Overview links here with a category. */
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
  const params = useLocalSearchParams<{ f?: string }>();
  const filter = params.f ?? 'all';
  const [openId, setOpenId] = useState<number | null>(null);

  if (state.status !== 'ready') {
    return (
      <Screen>
        {state.status === 'loading' ? <Loading /> : <Failed message="Couldn't load activity." onRetry={state.retry} />}
      </Screen>
    );
  }

  const { transactions, categories } = state.data;
  const visible = transactions.filter((t) => matches(t, filter));
  const items = buildItems(visible);
  const maxDay = Math.max(1, ...items.map((i) => (i.kind === 'day' ? i.spent : 0)));
  const out = visible.reduce((sum, t) => (t.direction === 'out' && !t.isTransfer ? sum + t.amount : sum), 0);
  const income = visible.reduce((sum, t) => (t.direction === 'in' && !t.isTransfer ? sum + t.amount : sum), 0);
  const open = transactions.find((t) => t.id === openId);

  return (
    <Screen>
      <Column modifiers={[fillMaxSize()]}>
        <Column modifiers={[fillMaxWidth(), padding(space.page, 18, space.page - 12, 0)]} verticalArrangement={{ spacedBy: 4 }}>
          <Row verticalAlignment="center" modifiers={[fillMaxWidth()]}>
            <Label size={28} weight="bold" modifiers={[weight(1)]}>
              Activity
            </Label>
            <Label size={13} tone="muted">
              {visible.length === 1 ? '1 entry' : `${visible.length} entries`}
            </Label>
            <RefreshButton />
          </Row>
          <Row horizontalArrangement={{ spacedBy: 16 }}>
            <Label size={14} weight="medium" tone="accent">{`−${digits(out)}`}</Label>
            <Label size={14} weight="medium" tone="income">{`+${digits(income)}`}</Label>
          </Row>
        </Column>

        <FilterStrip filter={filter} categories={categories} />
        <Rule />

        {items.length === 0 ? (
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

      {open && <TxSheet key={open.id} tx={open} categories={categories} onClose={() => setOpenId(null)} />}
    </Screen>
  );
}

function FilterStrip({ filter, categories }: { filter: string; categories: Category[] }) {
  const options = [
    { value: 'all', label: 'All' },
    { value: 'out', label: 'Spent' },
    { value: 'in', label: 'Received' },
    { value: 'transfer', label: 'Transfers' },
    ...categories.map((c) => ({ value: `cat:${c.id}`, label: c.name })),
    { value: 'cat:none', label: 'No category' },
  ];

  return (
    <Row
      horizontalArrangement={{ spacedBy: 6 }}
      modifiers={[fillMaxWidth(), horizontalScroll(), padding(space.page, 18, space.page, 14)]}>
      {options.map((o) => (
        <Chip key={o.value} label={o.label} selected={o.value === filter} onPress={() => router.setParams({ f: o.value })} />
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
