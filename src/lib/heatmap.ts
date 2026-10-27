import { dayKey, startOfDay } from './format';

export type HeatCell = {
  date: Date;
  amount: number;
  /** 0 = no spend, 1-4 = quartile of spending days, -1 = in the future. */
  level: number;
};

/**
 * Monday-first week columns ending with the current week. Mirrors WidgetBridge.kt so the
 * in-app grid and the home-screen widget agree.
 */
export function buildHeatmap(spend: { at: number; amount: number }[], weeks: number, now = new Date()): HeatCell[][] {
  const today = startOfDay(now);
  const sinceMonday = (today.getDay() + 6) % 7;
  const start = new Date(today);
  start.setDate(today.getDate() - sinceMonday - (weeks - 1) * 7);

  const totals = new Map<string, number>();
  for (const s of spend) {
    const key = dayKey(new Date(s.at));
    totals.set(key, (totals.get(key) ?? 0) + s.amount);
  }

  const days: { date: Date; amount: number; future: boolean }[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    days.push({ date, amount: totals.get(dayKey(date)) ?? 0, future: date > today });
  }

  const sorted = days.filter((d) => !d.future && d.amount > 0).map((d) => d.amount).sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.floor((sorted.length - 1) * p)];
  const levelOf = (amount: number) => {
    if (amount <= 0 || sorted.length === 0) return 0;
    if (amount <= q(0.25)) return 1;
    if (amount <= q(0.5)) return 2;
    if (amount <= q(0.75)) return 3;
    return 4;
  };

  const columns: HeatCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    columns.push(
      days.slice(w * 7, w * 7 + 7).map((d) => ({ date: d.date, amount: d.amount, level: d.future ? -1 : levelOf(d.amount) }))
    );
  }
  return columns;
}

export function heatmapStart(weeks: number, now = new Date()): Date {
  const today = startOfDay(now);
  const start = new Date(today);
  start.setDate(today.getDate() - ((today.getDay() + 6) % 7) - (weeks - 1) * 7);
  return start;
}
