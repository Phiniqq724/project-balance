import { Box, Button, Column, Icon, Row, Spacer, Text } from '@expo/ui/jetpack-compose';
import {
  background,
  clickable,
  clip,
  fillMaxWidth,
  height,
  padding,
  Shapes,
  size,
  verticalScroll,
  weight,
  width,
} from '@expo/ui/jetpack-compose/modifiers';
import Bell from '@expo/material-symbols/notifications.xml';
import { router } from 'expo-router';
import { useState } from 'react';

import { FlowChart } from '../../../modules/balance-core/src/FlowChart';
import { HeatLegend, Heatmap } from '@/components/heatmap';
import { RefreshButton } from '@/components/refresh-button';
import { Failed, Label, Loading, Money, Rule, Screen } from '@/components/kit';
import { analyticsStart, analyze, PERIODS, type Analysis, type Period, type Share } from '@/lib/analytics';
import { digits, rupiah, shortDate } from '@/lib/format';
import { buildHeatmap, heatmapStart } from '@/lib/heatmap';
import { BalanceCore, getFlows, getUnparsedCount } from '@/lib/ledger';
import { useLedger } from '@/lib/use-ledger';
import { color, font, space } from '@/theme';

const WEEKS = 20;

async function loadOverview() {
  const now = new Date();
  const since = new Date(Math.min(analyticsStart(now).getTime(), heatmapStart(WEEKS, now).getTime()));
  const [flows, unparsed] = await Promise.all([getFlows(since), getUnparsedCount()]);
  const spend = flows.filter((f) => f.direction === 'out');
  return { now, flows, grid: buildHeatmap(spend, WEEKS, now), unparsed, hasAccess: BalanceCore.hasNotificationAccess() };
}

type Data = Awaited<ReturnType<typeof loadOverview>>;

export default function OverviewScreen() {
  const state = useLedger(loadOverview);
  const [period, setPeriod] = useState<Period>('month');

  return (
    <Screen>
      {state.status === 'loading' && <Loading />}
      {state.status === 'error' && <Failed message="Couldn't read your ledger." onRetry={state.retry} />}
      {state.status === 'ready' && <Overview data={state.data} period={period} onPeriod={setPeriod} />}
    </Screen>
  );
}

function Overview({ data, period, onPeriod }: { data: Data; period: Period; onPeriod: (p: Period) => void }) {
  const a = analyze(data.flows, period, data.now);
  const meta = PERIODS.find((p) => p.value === period)!;
  const empty = data.flows.length === 0;

  return (
    <Column modifiers={[fillMaxWidth(), verticalScroll()]}>
      {!data.hasAccess && <AccessBanner />}

      <Row horizontalArrangement="end" modifiers={[fillMaxWidth(), padding(0, 4, 8, 0)]}>
        <RefreshButton />
        <InboxBell count={data.unparsed} />
      </Row>

      <PeriodTicker period={period} onChange={onPeriod} range={rangeLabel(a)} />

      <Column modifiers={[padding(space.page, 28, space.page, 0)]} verticalArrangement={{ spacedBy: 6 }}>
        <Label size={13} weight="medium" tone="muted">
          Spent
        </Label>
        <Money value={digits(a.spent)} size={46} />
        <Pace delta={a.paceDelta} compare={meta.compare} />
      </Column>

      {empty ? (
        <Label size={15} tone="muted" modifiers={[padding(space.page, 28, space.page, 0)]}>
          Nothing logged yet. Pay with Jago or myBCA and it shows up here.
        </Label>
      ) : (
        <>
          <FlowChart
            mode="line"
            current={a.line.current}
            previous={a.hasPrevious ? a.line.previous : []}
            ticks={a.line.ticks}
            readoutLabels={a.line.readoutLabels}
            readoutValues={a.line.readoutValues}
            defaultIndex={a.nowIndex}
            textColor={color.text}
            mutedColor={color.muted}
            gridColor={color.line}
            accentColor={color.accent}
            modifiers={[fillMaxWidth(), height(224), padding(space.page, 24, space.page, 0)]}
          />
          <Row horizontalArrangement={{ spacedBy: 16 }} modifiers={[padding(space.page, 4, space.page, 0)]}>
            <LegendKey label={meta.current} />
            {a.hasPrevious && <LegendKey label={meta.previous} dashed />}
          </Row>

          <SpendGrid columns={data.grid} />

          <FlowSplit spent={a.spent} received={a.received} />

          {a.categories.length > 0 && <WhereItWent categories={a.categories} payments={a.stats.payments} />}
          {a.sources.length > 0 && <WhereItCameFrom sources={a.sources} />}

          <SectionHead title={meta.unit} />
          <FlowChart
            mode="bars"
            current={a.bars.spend}
            income={a.bars.income}
            ticks={a.line.ticks}
            readoutLabels={a.bars.readoutLabels}
            readoutValues={a.bars.readoutValues}
            defaultIndex={a.nowIndex}
            textColor={color.text}
            mutedColor={color.muted}
            gridColor={color.line}
            accentColor={color.accent}
            incomeColor={color.income}
            modifiers={[fillMaxWidth(), height(184), padding(space.page, 0, space.page, 0)]}
          />
          <Row horizontalArrangement={{ spacedBy: 16 }} modifiers={[padding(space.page, 4, space.page, 0)]}>
            <LegendKey label="Spent" tint={color.accent} />
            <LegendKey label="Received" tint={color.income} />
          </Row>

          <StatPlate a={a} />
        </>
      )}
      <Spacer modifiers={[height(space.navClearance)]} />
    </Column>
  );
}

/** Same grid as the home-screen widget: one square per day, darker green means more spent. */
function SpendGrid({ columns }: { columns: Data['grid'] }) {
  return (
    <>
      <SectionHead title={`Last ${WEEKS} weeks`} />
      <Box modifiers={[padding(space.page, 0, space.page, 0)]}>
        <Heatmap columns={columns} />
      </Box>
      <Row
        verticalAlignment="center"
        horizontalArrangement={{ spacedBy: 6 }}
        modifiers={[fillMaxWidth(), padding(space.page, 12, space.page, 0)]}>
        <Spacer modifiers={[weight(1)]} />
        <Label size={12} tone="muted">
          Less
        </Label>
        <HeatLegend />
        <Label size={12} tone="muted">
          More
        </Label>
      </Row>
    </>
  );
}

function rangeLabel(a: Analysis) {
  const first = new Date(a.slots[0].start);
  const last = new Date(a.slots[a.slots.length - 1].end - 1);
  if (a.slots.length === 12) return String(first.getFullYear());
  return `${shortDate(first).slice(4)} – ${shortDate(last).slice(4)}`;
}

/** Bell at the top right; the badge counts notifications no rule understood. */
function InboxBell({ count }: { count: number }) {
  return (
    <Box modifiers={[size(48, 48), clip(Shapes.Circle), clickable(() => router.push('/unparsed'))]} contentAlignment="center">
      <Icon source={Bell} size={24} tint={color.text} contentDescription="Inbox" />
      {count > 0 && (
        <Box modifiers={[size(48, 48), padding(24, 6, 0, 0)]}>
          <Box modifiers={[height(16), clip(Shapes.RoundedCorner(8)), background(color.accent)]} contentAlignment="center">
            <Label size={10} weight="bold" color={color.bg} modifiers={[padding(count > 9 ? 4 : 5, 0, count > 9 ? 4 : 5, 0)]}>
              {count > 99 ? '99+' : String(count)}
            </Label>
          </Box>
        </Box>
      )}
    </Box>
  );
}

/** Text tabs, no pills: the selected period is bright and underlined, the rest recede. */
function PeriodTicker({ period, onChange, range }: { period: Period; onChange: (p: Period) => void; range: string }) {
  return (
    <Row verticalAlignment="center" modifiers={[fillMaxWidth(), padding(space.page - 8, 4, space.page, 0)]}>
      {PERIODS.map((p) => {
        const on = p.value === period;
        return (
          <Column
            key={p.value}
            horizontalAlignment="center"
            modifiers={[clip(Shapes.RoundedCorner(8)), clickable(() => onChange(p.value)), padding(8, 8, 8, 6)]}>
            <Label size={15} weight={on ? 'bold' : 'medium'} tone={on ? 'text' : 'muted'}>
              {p.label}
            </Label>
            <Spacer modifiers={[height(4)]} />
            <Box modifiers={[size(16, 2), background(on ? color.text : 'transparent')]} />
          </Column>
        );
      })}
      <Spacer modifiers={[weight(1)]} />
      <Label size={13} tone="muted">
        {range}
      </Label>
    </Row>
  );
}

function Pace({ delta, compare }: { delta: number | null; compare: string }) {
  if (delta === null) {
    return (
      <Label size={14} tone="muted">
        {`Nothing from ${compare.replace(' so far', '')} to compare`}
      </Label>
    );
  }
  const pct = Math.round(Math.abs(delta) * 100);
  if (pct === 0) {
    return (
      <Label size={14} tone="muted">
        {`Level with ${compare}`}
      </Label>
    );
  }
  return (
    <Text color={color.muted} style={{ fontFamily: font.regular, fontSize: 14 }}>
      <Text color={color.text} style={{ fontFamily: font.bold, fontSize: 14 }}>
        {`${delta > 0 ? '▲' : '▼'} ${pct}%`}
      </Text>
      {` ${delta > 0 ? 'over' : 'under'} ${compare}`}
    </Text>
  );
}

function LegendKey({ label, dashed, tint = color.text }: { label: string; dashed?: boolean; tint?: string }) {
  return (
    <Row verticalAlignment="center" horizontalArrangement={{ spacedBy: 6 }}>
      {dashed ? (
        <Row horizontalArrangement={{ spacedBy: 2 }}>
          {[0, 1, 2].map((i) => (
            <Box key={i} modifiers={[size(3, 2), background(color.muted)]} />
          ))}
        </Row>
      ) : (
        <Box modifiers={[size(11, 2), background(tint)]} />
      )}
      <Label size={12} tone="muted">
        {label}
      </Label>
    </Row>
  );
}

function SectionHead({ title, detail }: { title: string; detail?: string }) {
  return (
    <Column modifiers={[fillMaxWidth(), padding(0, 40, 0, 16)]}>
      <Rule />
      <Row verticalAlignment="center" modifiers={[fillMaxWidth(), padding(space.page, 16, space.page, 0)]}>
        <Label weight="bold" modifiers={[weight(1)]}>
          {title}
        </Label>
        {detail && (
          <Label size={13} tone="muted">
            {detail}
          </Label>
        )}
      </Row>
    </Column>
  );
}

function FlowSplit({ spent, received }: { spent: number; received: number }) {
  const net = received - spent;
  return (
    <>
      <SectionHead title="In and out" />
      <Row modifiers={[fillMaxWidth(), padding(space.page, 0, space.page, 0)]}>
        <Figure label="In" value={`+${digits(received)}`} tone="income" />
        <Figure label="Out" value={`−${digits(spent)}`} />
        <Figure label="Net" value={`${net >= 0 ? '+' : '−'}${digits(net)}`} />
      </Row>
      {spent + received > 0 && (
        <Row horizontalArrangement={{ spacedBy: 2 }} modifiers={[fillMaxWidth(), padding(space.page, 0, space.page, 0), height(6)]}>
          {received > 0 && <Box modifiers={[weight(received), height(6), clip(Shapes.RoundedCorner(2)), background(color.income)]} />}
          {spent > 0 && <Box modifiers={[weight(spent), height(6), clip(Shapes.RoundedCorner(2)), background(color.accent)]} />}
        </Row>
      )}
    </>
  );
}

function Figure({ label, value, tone = 'text' }: { label: string; value: string; tone?: 'text' | 'income' }) {
  return (
    <Column modifiers={[weight(1), padding(0, 0, 0, 14)]} verticalArrangement={{ spacedBy: 2 }}>
      <Label size={12} weight="medium" tone="muted">
        {label}
      </Label>
      <Label size={17} weight="bold" tone={tone} maxLines={1}>
        {value}
      </Label>
    </Column>
  );
}

/** Warm creams from bright to dim, so category ranks read without spending the accent. */
function shade(i: number, n: number) {
  const from = [0xf3, 0xeb, 0xe2];
  const to = [0x4a, 0x40, 0x3a];
  const t = n <= 1 ? 0 : i / (n - 1);
  return `#${from.map((c, k) => Math.round(c + (to[k] - c) * t).toString(16).padStart(2, '0')).join('')}`;
}

function WhereItWent({ categories, payments }: { categories: Share[]; payments: number }) {
  const shown = categories.slice(0, 8);
  return (
    <>
      <SectionHead title="Where it went" detail={payments === 1 ? '1 payment' : `${payments} payments`} />
      <Row horizontalArrangement={{ spacedBy: 2 }} modifiers={[fillMaxWidth(), padding(space.page, 0, space.page, 8), height(18)]}>
        {shown.map((c, i) => (
          <Box
            key={c.key}
            modifiers={[weight(Math.max(c.share, 0.005)), height(10), clip(Shapes.RoundedCorner(2)), background(shade(i, shown.length))]}
          />
        ))}
      </Row>
      {shown.map((c, i) => (
        <ShareRow
          key={c.key}
          rank={i + 1}
          swatch={shade(i, shown.length)}
          share={c}
          onPress={() => router.navigate({ pathname: '/activity', params: { f: `cat:${c.id ?? 'none'}` } })}
        />
      ))}
    </>
  );
}

function WhereItCameFrom({ sources }: { sources: Share[] }) {
  return (
    <>
      <SectionHead title="Where it came from" />
      {sources.slice(0, 5).map((s, i) => (
        <ShareRow key={s.key} rank={i + 1} swatch={color.income} share={s} income />
      ))}
    </>
  );
}

function ShareRow({ rank, swatch, share, income, onPress }: { rank: number; swatch: string; share: Share; income?: boolean; onPress?: () => void }) {
  return (
    <Row
      verticalAlignment="center"
      horizontalArrangement={{ spacedBy: 12 }}
      modifiers={[fillMaxWidth(), ...(onPress ? [clickable(onPress)] : []), padding(space.page, 11, space.page, 11)]}>
      <Label size={12} weight="medium" tone="muted" modifiers={[width(18)]}>
        {String(rank).padStart(2, '0')}
      </Label>
      <Box modifiers={[size(8, 8), clip(Shapes.RoundedCorner(2)), background(swatch)]} />
      <Column modifiers={[weight(1)]} verticalArrangement={{ spacedBy: 1 }}>
        <Label weight="medium" maxLines={1} overflow="ellipsis">
          {share.name}
        </Label>
        <Label size={12} tone="muted">
          {`${Math.round(share.share * 100)}%  ·  ${share.count}×`}
        </Label>
      </Column>
      <Label weight="medium" tone={income ? 'income' : 'text'}>
        {`${income ? '+' : ''}${digits(share.amount)}`}
      </Label>
    </Row>
  );
}

function StatPlate({ a }: { a: Analysis }) {
  const { perDay, biggest, payments, regular } = a.stats;
  return (
    <>
      <SectionHead title="Numbers" />
      <Column modifiers={[fillMaxWidth(), padding(space.page, 0, space.page, 0)]}>
        <Rule />
        <Row modifiers={[fillMaxWidth()]}>
          <Stat label="Per day" value={rupiah(perDay)} first />
          <Box modifiers={[size(1, 88), background(color.line)]} />
          <Stat label="Biggest" value={biggest ? rupiah(biggest.amount) : '–'} note={biggest ? biggest.title : undefined} />
        </Row>
        <Rule />
        <Row modifiers={[fillMaxWidth()]}>
          <Stat label="Payments" value={String(payments)} first />
          <Box modifiers={[size(1, 88), background(color.line)]} />
          <Stat label="Most often" value={regular ? regular.name : '–'} note={regular ? `${regular.count} times` : undefined} />
        </Row>
        <Rule />
      </Column>
    </>
  );
}

function Stat({ label, value, note, first }: { label: string; value: string; note?: string; first?: boolean }) {
  return (
    <Column modifiers={[weight(1), height(88), padding(first ? 0 : 16, 14, 12, 0)]} verticalArrangement={{ spacedBy: 3 }}>
      <Label size={12} weight="medium" tone="muted">
        {label}
      </Label>
      <Label size={17} weight="bold" maxLines={1} overflow="ellipsis">
        {value}
      </Label>
      {note && (
        <Label size={12} tone="muted" maxLines={1} overflow="ellipsis">
          {note}
        </Label>
      )}
    </Column>
  );
}

function AccessBanner() {
  return (
    <Column
      modifiers={[fillMaxWidth(), background(color.raised), padding(space.page, 18, space.page, 18)]}
      verticalArrangement={{ spacedBy: 12 }}>
      <Column verticalArrangement={{ spacedBy: 4 }}>
        <Label weight="medium">Notification access is off</Label>
        <Label size={14} tone="muted">
          Balance needs it to log your payments.
        </Label>
      </Column>
      <Button onClick={() => BalanceCore.openNotificationAccessSettings()}>
        <Label weight="medium" color={color.bg}>
          Allow access
        </Label>
      </Button>
    </Column>
  );
}
