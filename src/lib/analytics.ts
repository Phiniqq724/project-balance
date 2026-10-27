import { digits, monthName, shortDate, startOfDay } from './format';
import type { Flow } from './ledger';

export type Period = 'week' | 'month' | 'quarter' | 'year';

/** `current`/`previous` name the two lines; `compare` finishes "12% under …". */
export const PERIODS: { value: Period; label: string; current: string; previous: string; compare: string; unit: string }[] = [
  { value: 'week', label: 'Week', current: 'This week', previous: 'Last week', compare: 'last week so far', unit: 'Day by day' },
  { value: 'month', label: '30D', current: 'Last 30 days', previous: '30 days before', compare: 'the 30 days before', unit: 'Day by day' },
  { value: 'quarter', label: '3M', current: 'Last 13 weeks', previous: '13 weeks before', compare: 'the 13 weeks before', unit: 'Week by week' },
  { value: 'year', label: 'Year', current: 'This year', previous: 'Last year', compare: 'last year so far', unit: 'Month by month' },
];

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type Slot = { start: number; end: number; tick: string; name: string };

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(date.getDate() + days);
  return next;
}

function monday(date: Date) {
  const day = startOfDay(date);
  return addDays(day, -((day.getDay() + 6) % 7));
}

/** The slots for the period containing `now`, shifted back `back` periods. */
function slotsFor(period: Period, now: Date, back: number): Slot[] {
  switch (period) {
    case 'week': {
      const start = addDays(monday(now), -7 * back);
      return Array.from({ length: 7 }, (_, i) => {
        const day = addDays(start, i);
        return { start: day.getTime(), end: addDays(day, 1).getTime(), tick: 'MTWTFSS'[i], name: shortDate(day) };
      });
    }
    case 'month': {
      // Rolling: the last slot is always today.
      const start = addDays(startOfDay(now), -29 - 30 * back);
      return Array.from({ length: 30 }, (_, i) => {
        const day = addDays(start, i);
        const tick = [0, 10, 20, 29].includes(i) ? `${day.getDate()} ${SHORT_MONTHS[day.getMonth()]}` : '';
        return { start: day.getTime(), end: addDays(day, 1).getTime(), tick, name: shortDate(day) };
      });
    }
    case 'quarter': {
      const start = addDays(monday(now), -7 * (12 + 13 * back));
      return Array.from({ length: 13 }, (_, i) => {
        const week = addDays(start, i * 7);
        const label = `${week.getDate()} ${SHORT_MONTHS[week.getMonth()]}`;
        return { start: week.getTime(), end: addDays(week, 7).getTime(), tick: i % 4 === 0 ? label : '', name: `Week of ${label}` };
      });
    }
    case 'year': {
      const year = now.getFullYear() - back;
      return Array.from({ length: 12 }, (_, m) => ({
        start: new Date(year, m, 1).getTime(),
        end: new Date(year, m + 1, 1).getTime(),
        tick: SHORT_MONTHS[m][0],
        name: `${monthName(new Date(year, m, 1))} ${year}`,
      }));
    }
  }
}

/** Earliest moment any period view needs: the start of last year, or the previous 3M window if that's earlier. */
export function analyticsStart(now = new Date()): Date {
  const lastYear = new Date(now.getFullYear() - 1, 0, 1);
  const quarter = new Date(slotsFor('quarter', now, 1)[0].start);
  return lastYear < quarter ? lastYear : quarter;
}

function bucket(flows: Flow[], slots: Slot[], direction: Flow['direction']) {
  const sums = slots.map(() => 0);
  let s = 0;
  for (const f of flows) {
    if (f.direction !== direction) continue;
    while (s < slots.length && f.at >= slots[s].end) s++;
    if (s >= slots.length) break;
    if (f.at >= slots[s].start) sums[s] += f.amount;
  }
  return sums;
}

function cumulative(values: number[]) {
  let total = 0;
  return values.map((v) => (total += v));
}

export type Share = { key: string; id: string | null; name: string; amount: number; count: number; share: number };

function group(flows: Flow[], keyOf: (f: Flow) => { key: string; id: string | null; name: string }): Share[] {
  const map = new Map<string, Share>();
  let total = 0;
  for (const f of flows) {
    const k = keyOf(f);
    const entry = map.get(k.key) ?? { ...k, amount: 0, count: 0, share: 0 };
    entry.amount += f.amount;
    entry.count += 1;
    total += f.amount;
    map.set(k.key, entry);
  }
  return [...map.values()]
    .map((e) => ({ ...e, share: total > 0 ? e.amount / total : 0 }))
    .sort((a, b) => b.amount - a.amount);
}

export function analyze(all: Flow[], period: Period, now = new Date()) {
  const slots = slotsFor(period, now, 0);
  const prevSlots = slotsFor(period, now, 1);
  const nowIndex = Math.max(0, slots.findIndex((s) => now.getTime() >= s.start && now.getTime() < s.end));
  const from = slots[0].start;
  const to = slots[slots.length - 1].end;

  // `all` is ordered by time, so each bucket pass is a single sweep.
  const inPeriod = all.filter((f) => f.at >= from && f.at < to);
  const prevPeriod = all.filter((f) => f.at >= prevSlots[0].start && f.at < prevSlots[prevSlots.length - 1].end);
  const out = inPeriod.filter((f) => f.direction === 'out');
  const income = inPeriod.filter((f) => f.direction === 'in');

  const spendSlots = bucket(inPeriod, slots, 'out');
  const incomeSlots = bucket(inPeriod, slots, 'in');
  const prevSpend = bucket(prevPeriod, prevSlots, 'out');
  const prevCum = cumulative(prevSpend);
  const cum = cumulative(spendSlots).slice(0, nowIndex + 1);

  const spent = cum[cum.length - 1] ?? 0;
  const received = income.reduce((sum, f) => sum + f.amount, 0);
  // Same point in the last period. Longer months just repeat their final total.
  const prevAtNow = prevCum[Math.min(nowIndex, prevCum.length - 1)] ?? 0;
  // The chart draws what was spent in each slot, not the running total.
  const current = spendSlots.slice(0, nowIndex + 1);
  const previous = slots.map((_, i) => prevSpend[i] ?? 0);

  const elapsedDays = Math.max(1, Math.ceil((Math.min(now.getTime(), to) - from) / 86_400_000));
  const biggest = out.reduce<Flow | null>((best, f) => (!best || f.amount > best.amount ? f : best), null);
  const regular = group(out, (f) => ({ key: f.title.toLowerCase(), id: null, name: f.title })).sort((a, b) => b.count - a.count)[0];

  return {
    slots,
    nowIndex,
    spent,
    received,
    paceDelta: prevAtNow > 0 ? (spent - prevAtNow) / prevAtNow : null,
    hasPrevious: prevPeriod.some((f) => f.direction === 'out'),
    line: {
      current,
      previous,
      ticks: slots.map((s) => s.tick),
      readoutLabels: slots.map((s, i) => (i <= nowIndex ? s.name : `${prevSlots[Math.min(i, prevSlots.length - 1)].name}`)),
      readoutValues: slots.map((_, i) => `Rp ${digits(i <= nowIndex ? current[i] : previous[i])}`),
    },
    bars: {
      spend: spendSlots,
      income: incomeSlots,
      readoutLabels: slots.map((s) => s.name),
      readoutValues: slots.map((_, i) => {
        const parts = [];
        if (spendSlots[i] > 0) parts.push(`−${digits(spendSlots[i])}`);
        if (incomeSlots[i] > 0) parts.push(`+${digits(incomeSlots[i])}`);
        return parts.join('  ') || '0';
      }),
    },
    categories: group(out, (f) => ({
      key: f.categoryId ?? 'none',
      id: f.categoryId,
      name: f.categoryName ?? 'No category',
    })),
    sources: group(income, (f) => ({ key: f.title.toLowerCase(), id: null, name: f.title })),
    stats: {
      perDay: spent / elapsedDays,
      biggest,
      payments: out.length,
      regular: regular && regular.count > 1 ? regular : null,
    },
  };
}

export type Analysis = ReturnType<typeof analyze>;
