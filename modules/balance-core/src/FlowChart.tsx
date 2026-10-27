import { createViewModifierEventListener, type ModifierConfig } from '@expo/ui/jetpack-compose/modifiers';
import { requireNativeView } from 'expo';

export type FlowChartProps = {
  /** "line": cumulative spend vs last period. "bars": spend up, income down, per slot. */
  mode: 'line' | 'bars';
  current: number[];
  previous?: number[];
  income?: number[];
  /** One label per slot; blank entries are skipped. */
  ticks: string[];
  readoutLabels: string[];
  readoutValues: string[];
  /** Slot shown in the readout when nobody is touching the chart. */
  defaultIndex?: number;
  textColor?: string;
  mutedColor?: string;
  gridColor?: string;
  accentColor?: string;
  modifiers?: ModifierConfig[];
};

const NativeFlowChart: React.ComponentType<FlowChartProps> = requireNativeView('BalanceCore', 'FlowChart');

/** Scrubbable Canvas chart from FlowChartView.kt. Must live inside a Compose Host. */
export function FlowChart({ modifiers, ...rest }: FlowChartProps) {
  return (
    <NativeFlowChart
      modifiers={modifiers}
      {...(modifiers ? createViewModifierEventListener(modifiers) : undefined)}
      {...rest}
    />
  );
}
