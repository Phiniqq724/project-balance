import type { MaterialColors } from '@expo/ui/jetpack-compose';

/** Ember: warm charcoal, orange only for spending heat, sage for money in, pink for errors. */
export const color = {
  bg: '#1A1614',
  surface: '#221D1A',
  raised: '#2B2521',
  line: '#3A322C',
  selected: '#463C35',
  text: '#F3EBE2',
  muted: '#AC9F92',
  accent: '#FF7444',
  income: '#9BCB9F',
  danger: '#F07AAE',
  heat: ['#2B2420', '#5C2D1C', '#93401F', '#D2582B', '#FF7444'],
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
