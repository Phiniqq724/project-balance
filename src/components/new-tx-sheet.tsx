import { Box, Button, Column, DatePickerDialog, FlowRow, ModalBottomSheet, OutlinedTextField, Row, TimePickerDialog, useNativeState, type ObservableState } from '@expo/ui/jetpack-compose';
import { clickable, fillMaxWidth, matchParentSize, padding, weight } from '@expo/ui/jetpack-compose/modifiers';
import { useEffect, useState } from 'react';

import { fieldColors, fieldText } from '@/components/category-sheet';
import { Chip, Label } from '@/components/kit';
import { dayLabel, time } from '@/lib/format';
import { BalanceCore, getCategories, type Category, type Direction } from '@/lib/ledger';
import { color, space } from '@/theme';

/** A transaction typed in by hand. Saved like any other, with source "Manual". */
export function NewTxSheet({ onClose }: { onClose: () => void }) {
  const [direction, setDirection] = useState<Direction>('out');
  const [amount, setAmount] = useState('');
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  // Local date and time together; the pickers each change one part.
  const [when, setWhen] = useState(() => new Date());
  const [picking, setPicking] = useState<'date' | 'time' | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const today = new Date();
  const amountState = useNativeState('');
  const nameState = useNativeState('');
  const dateState = useNativeState(dayLabel(when));
  const timeState = useNativeState(time(when));

  useEffect(() => {
    dateState.set(dayLabel(when));
    timeState.set(time(when));
  }, [when, dateState, timeState]);

  useEffect(() => {
    getCategories().then(setCategories, () => {});
  }, []);

  const save = async () => {
    const value = Number(amount.replace(/[^\d]/g, ''));
    if (!Number.isSafeInteger(value) || value <= 0) {
      setError('Enter the amount.');
      return;
    }
    setSaving(true);
    try {
      await BalanceCore.addTransaction(direction, value, name.trim() || null, categoryId, Math.min(when.getTime(), Date.now()));
      onClose();
    } catch {
      setError("Couldn't save. Try again.");
      setSaving(false);
    }
  };

  return (
    <>
      <ModalBottomSheet onDismissRequest={onClose} containerColor={color.surface} skipPartiallyExpanded>
        <Column modifiers={[fillMaxWidth(), padding(space.page, 4, space.page, 32)]} verticalArrangement={{ spacedBy: 16 }}>
          <Label size={22} weight="bold">
            New transaction
          </Label>

          <Row horizontalArrangement={{ spacedBy: 6 }}>
            <Chip label="Spent" selected={direction === 'out'} onPress={() => setDirection('out')} />
            <Chip label="Received" selected={direction === 'in'} onPress={() => setDirection('in')} />
          </Row>

          <OutlinedTextField
            value={amountState}
            onValueChange={setAmount}
            singleLine
            keyboardOptions={{ keyboardType: 'number' }}
            colors={fieldColors}
            textStyle={fieldText}
            modifiers={[fillMaxWidth()]}>
            <OutlinedTextField.Label>
              <Label size={14} tone="muted">
                Amount (Rp)
              </Label>
            </OutlinedTextField.Label>
          </OutlinedTextField>

          <OutlinedTextField
            value={nameState}
            onValueChange={setName}
            singleLine
            colors={fieldColors}
            textStyle={fieldText}
            modifiers={[fillMaxWidth()]}>
            <OutlinedTextField.Label>
              <Label size={14} tone="muted">
                Name
              </Label>
            </OutlinedTextField.Label>
          </OutlinedTextField>

          <Column verticalArrangement={{ spacedBy: 10 }}>
            <Label size={13} weight="medium" tone="muted">
              Category
            </Label>
            <FlowRow horizontalArrangement={{ spacedBy: 6 }} verticalArrangement={{ spacedBy: 6 }}>
              {categories.map((c) => (
                <Chip key={c.id} label={c.name} selected={categoryId === c.id} onPress={() => setCategoryId(categoryId === c.id ? null : c.id)} />
              ))}
            </FlowRow>
          </Column>

          <Row horizontalArrangement={{ spacedBy: 12 }} modifiers={[fillMaxWidth()]}>
            <PickerField label="Date" state={dateState} grow={3} onPress={() => setPicking('date')} />
            <PickerField label="Time" state={timeState} grow={2} onPress={() => setPicking('time')} />
          </Row>

          {error && (
            <Label size={14} tone="danger">
              {error}
            </Label>
          )}

          <Row horizontalArrangement={{ spacedBy: 8 }} verticalAlignment="center">
            <Button onClick={save} enabled={!saving}>
              <Label weight="medium" color={color.bg}>
                Add
              </Label>
            </Button>
          </Row>
        </Column>
      </ModalBottomSheet>
      {picking === 'date' && (
        <DatePickerDialog
          // The dialog speaks UTC midnight; the local calendar day is what is meant.
          initialDate={new Date(Date.UTC(when.getFullYear(), when.getMonth(), when.getDate())).toISOString()}
          selectableDates={{ end: new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) }}
          color={color.text}
          onDateSelected={(d) => {
            const next = new Date(when);
            next.setFullYear(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
            setWhen(next.getTime() > Date.now() ? new Date() : next);
            setPicking(null);
          }}
          onDismissRequest={() => setPicking(null)}
        />
      )}
      {picking === 'time' && (
        <TimePickerDialog
          initialDate={when.toISOString()}
          is24Hour
          color={color.text}
          elementColors={timeColors}
          onDateSelected={(d) => {
            // The dialog hands back a Date carrying the picked hour and minute in local time.
            const next = new Date(when);
            next.setHours(d.getHours(), d.getMinutes(), 0, 0);
            setWhen(next.getTime() > Date.now() ? new Date() : next);
            setPicking(null);
          }}
          onDismissRequest={() => setPicking(null)}
        />
      )}
    </>
  );
}

// The theme's primary is near-white, so Material's defaults put light text on a light selected segment.
const timeColors = {
  containerColor: color.surface,
  clockDialColor: color.raised,
  clockDialContentColor: color.text,
  clockDialSelectedContentColor: color.bg,
  selectorColor: color.accent,
  timeSelectorSelectedContainerColor: color.accent,
  timeSelectorSelectedContentColor: color.bg,
  timeSelectorContainerColor: color.raised,
  timeSelectorContentColor: color.text,
};

/** Looks like the other fields; a layer on top takes the tap so the keyboard never opens. */
function PickerField({ label, state, grow, onPress }: { label: string; state: ObservableState<string>; grow: number; onPress: () => void }) {
  return (
    <Box modifiers={[weight(grow)]}>
      <OutlinedTextField value={state} readOnly singleLine colors={fieldColors} textStyle={fieldText} modifiers={[fillMaxWidth()]}>
        <OutlinedTextField.Label>
          <Label size={14} tone="muted">
            {label}
          </Label>
        </OutlinedTextField.Label>
      </OutlinedTextField>
      <Box modifiers={[matchParentSize(), clickable(onPress)]} />
    </Box>
  );
}
