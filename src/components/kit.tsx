import ChevronRight from '@expo/material-symbols/chevron_right.xml';
import {
  AlertDialog,
  Box,
  Button,
  CircularProgressIndicator,
  Column,
  HorizontalDivider,
  Host,
  Icon,
  Row,
  Text,
  TextButton,
  type TextProps,
} from '@expo/ui/jetpack-compose';
import {
  background,
  clickable,
  clip,
  defaultMinSize,
  fillMaxSize,
  fillMaxWidth,
  padding,
  paddingAll,
  weight,
  Shapes,
} from '@expo/ui/jetpack-compose/modifiers';
import type { ReactNode } from 'react';
import type { ImageSourcePropType } from 'react-native';
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

type Tone = 'text' | 'muted' | 'income' | 'accent' | 'danger';

const toneColor: Record<Tone, string> = {
  text: color.text,
  muted: color.muted,
  income: color.income,
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

type RowTone = 'text' | 'danger';

/** Rounded card holding a short list of settings rows. */
export function SettingsGroup({ children }: { children: ReactNode }) {
  return (
    <Column modifiers={[fillMaxWidth(), padding(space.page, 0, space.page, 0), clip(Shapes.RoundedCorner(16)), background(color.surface)]}>
      {children}
    </Column>
  );
}

/** Hairline between rows, inset to line up with the titles (16 padding + 22 icon + 14 gap). */
export function SettingsDivider() {
  return (
    <Box modifiers={[fillMaxWidth(), padding(52, 0, 0, 0)]}>
      <Rule />
    </Box>
  );
}

type SettingsRowProps = {
  title: string;
  onPress: () => void;
  icon?: ImageSourcePropType;
  subtitle?: string;
  tone?: RowTone;
  /** Text at the end, for progress or a result. Replaces the chevron. */
  status?: string;
  statusTone?: 'muted' | 'danger';
  /** A control at the end, such as a Switch. Replaces the chevron. */
  trailing?: ReactNode;
};

/** The whole row presses. The end shows what it does: a chevron, a status, or a control. */
export function SettingsRow({ title, onPress, icon, subtitle, tone = 'text', status, statusTone = 'muted', trailing }: SettingsRowProps) {
  return (
    <Row
      verticalAlignment="center"
      horizontalArrangement={{ spacedBy: 14 }}
      modifiers={[fillMaxWidth(), defaultMinSize({ minHeight: 56 }), clickable(onPress), padding(16, 10, 16, 10)]}>
      {icon && <Icon source={icon} size={22} tint={tone === 'danger' ? color.danger : color.muted} />}
      <Column modifiers={[weight(1)]}>
        <Label weight="medium" tone={tone}>
          {title}
        </Label>
        {subtitle && (
          <Label size={13} tone="muted">
            {subtitle}
          </Label>
        )}
      </Column>
      {trailing ??
        (status ? (
          <Label size={14} weight="medium" tone={statusTone}>
            {status}
          </Label>
        ) : (
          <Icon source={ChevronRight} size={22} tint={color.muted} />
        ))}
    </Row>
  );
}

/** Two-button confirm in the app's colors. Confirm closes the dialog before running. */
export function ConfirmDialog({
  title,
  text,
  confirm,
  danger,
  onConfirm,
  onDismiss,
}: {
  title: string;
  text: string;
  confirm: string;
  danger?: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  return (
    <AlertDialog
      onDismissRequest={onDismiss}
      colors={{ containerColor: color.raised, titleContentColor: color.text, textContentColor: color.muted }}>
      <AlertDialog.Title>
        <Label size={20} weight="bold">
          {title}
        </Label>
      </AlertDialog.Title>
      <AlertDialog.Text>
        <Label tone="muted" lineHeight={21}>
          {text}
        </Label>
      </AlertDialog.Text>
      <AlertDialog.ConfirmButton>
        <TextButton
          onClick={() => {
            onDismiss();
            onConfirm();
          }}>
          <Label weight="bold" tone={danger ? 'danger' : 'text'}>
            {confirm}
          </Label>
        </TextButton>
      </AlertDialog.ConfirmButton>
      <AlertDialog.DismissButton>
        <TextButton onClick={onDismiss}>
          <Label weight="medium" tone="muted">
            Cancel
          </Label>
        </TextButton>
      </AlertDialog.DismissButton>
    </AlertDialog>
  );
}
