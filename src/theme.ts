import type { MaterialColors } from '@expo/ui/jetpack-compose';

/** Instrument: cool graphite, numbers first, green only where money grows or spending heats up. */
export const color = {
  bg: '#0B0D0E',
  surface: '#131618',
  raised: '#1B1F22',
  line: '#23282C',
  selected: '#2C3236',
  text: '#E6EAEC',
  muted: '#8F989E',
  accent: '#39D353',
  danger: '#F2867A',
  heat: ['#1A1F23', '#0E4429', '#006D32', '#26A641', '#39D353'],
} as const;

/** Satoshi weights are registered as separate families by the expo-font plugin. */
export const font = {
  regular: 'Satoshi-Regular',
  medium: 'Satoshi-Medium',
  bold: 'Satoshi-Bold',
} as const;

export const space = {
  page: 20,
  section: 32,
  /** Room under scrolling content so the floating navbar never covers the last row. */
  navClearance: 104,
} as const;

/** Pins Material components (sheets, switches, fields) to the palette instead of dynamic color. */
export const materialOverrides: Partial<MaterialColors> = {
  primary: color.text,
  onPrimary: color.bg,
  primaryContainer: color.raised,
  onPrimaryContainer: color.text,
  secondaryContainer: color.raised,
  onSecondaryContainer: color.text,
  background: color.bg,
  onBackground: color.text,
  surface: color.bg,
  onSurface: color.text,
  surfaceVariant: color.surface,
  onSurfaceVariant: color.muted,
  surfaceContainer: color.surface,
  surfaceContainerLow: color.surface,
  surfaceContainerLowest: color.bg,
  surfaceContainerHigh: color.raised,
  surfaceContainerHighest: color.raised,
  outline: color.muted,
  outlineVariant: color.line,
  error: color.danger,
};
