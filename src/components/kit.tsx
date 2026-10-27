import {
  Box,
  Button,
  CircularProgressIndicator,
  Column,
  HorizontalDivider,
  Host,
  Text,
  type TextProps,
} from '@expo/ui/jetpack-compose';
import {
  background,
  clickable,
  clip,
  fillMaxSize,
  fillMaxWidth,
  padding,
  paddingAll,
  Shapes,
} from '@expo/ui/jetpack-compose/modifiers';
import type { ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, font, materialOverrides, space } from '@/theme';

/** One Compose host per screen, pinned to the palette and the status-bar inset. */
export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <Host style={{ flex: 1, backgroundColor: color.bg }} colorScheme="dark" colorOverrides={materialOverrides}>
      <Box modifiers={[fillMaxSize(), padding(0, insets.top, 0, 0)]}>{children}</Box>
    </Host>
  );
}

type Tone = 'text' | 'muted' | 'accent' | 'danger';

const toneColor: Record<Tone, string> = {
  text: color.text,
  muted: color.muted,
  accent: color.accent,
  danger: color.danger,
};

type LabelProps = Omit<TextProps, 'style'> & {
  size?: number;
  weight?: keyof typeof font;
  tone?: Tone;
  lineHeight?: number;
};

/** Every piece of text goes through here so Satoshi is never forgotten. */
export function Label({ size = 15, weight = 'regular', tone = 'text', lineHeight, color: override, children, ...rest }: LabelProps) {
  return (
    <Text {...rest} color={override ?? toneColor[tone]} style={{ fontFamily: font[weight], fontSize: size, lineHeight }}>
      {children}
    </Text>
  );
}

/** "Rp" set small and muted so the digits carry the weight. */
export function Money({ value, size, tone = 'text' }: { value: string; size: number; tone?: Tone }) {
  return (
    <Text color={toneColor[tone]} style={{ fontFamily: font.bold, fontSize: size }}>
      <Text color={color.muted} style={{ fontFamily: font.medium, fontSize: Math.round(size * 0.45) }}>
        {'Rp '}
      </Text>
      {value}
    </Text>
  );
}

export function Rule() {
  return <HorizontalDivider thickness={1} color={color.line} />;
}

export function Loading() {
  return (
    <Box modifiers={[fillMaxSize()]} contentAlignment="center">
      <CircularProgressIndicator color={color.muted} />
    </Box>
  );
}

export function Failed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Column modifiers={[fillMaxWidth(), paddingAll(space.page)]} verticalArrangement={{ spacedBy: 12 }}>
      <Label size={17} weight="medium">
        {message}
      </Label>
      <Button onClick={onRetry}>
        <Label weight="medium" color={color.bg}>
          Try again
        </Label>
      </Button>
    </Column>
  );
}

/** Square-ish text chip. Selected inverts to a solid light block; the rest are hairline outlines. */
export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    // `border` is always rectangular, so the hairline is an outer line-colored shape inset by 1dp.
    <Box modifiers={[clip(Shapes.RoundedCorner(8)), background(selected ? color.text : color.line), padding(1, 1, 1, 1)]}>
      <Box
        modifiers={[
          clip(Shapes.RoundedCorner(7)),
          background(selected ? color.text : color.bg),
          clickable(onPress),
          padding(11, 6, 11, 6),
        ]}>
        <Label size={13} weight="medium" color={selected ? color.bg : color.muted}>
          {label}
        </Label>
      </Box>
    </Box>
  );
}
