import { Button, Column, ModalBottomSheet, OutlinedTextField, Row, TextButton, useNativeState } from '@expo/ui/jetpack-compose';
import { fillMaxWidth, padding } from '@expo/ui/jetpack-compose/modifiers';
import { useState } from 'react';

import { fieldColors, fieldText } from '@/components/category-sheet';
import { Chip, Label } from '@/components/kit';
import { answerReview, type Verdict } from '@/lib/ai-review';
import { rupiah } from '@/lib/format';
import type { RawNotification } from '@/lib/ledger';
import { color, space } from '@/theme';

const NOT_A_TRANSACTION: Verdict = { kind: 'ad_or_other', direction: 'out', amount: 0, counterparty: null };

/** "Spent Rp 25.000 at X?" for what the model read. */
function question(v: Verdict): string {
  const amount = rupiah(v.amount);
  if (v.kind === 'expense') return v.counterparty ? `Spent ${amount} at ${v.counterparty}?` : `Spent ${amount}?`;
  if (v.kind === 'income') return v.counterparty ? `Got ${amount} from ${v.counterparty}?` : `Got ${amount}?`;
  if (v.kind === 'transfer') return `Moved ${amount} between your accounts?`;
  return 'Not a transaction?';
}

function verdictOf(n: RawNotification): Verdict | null {
  const r = n.review;
  if (r?.state !== 'suggested' || !r.kind || !r.direction || r.amount == null) return null;
  return { kind: r.kind, direction: r.direction, amount: r.amount, counterparty: r.counterparty };
}

/** The AI's reading of one notification, with the three ways to answer it. */
export function ReviewActions({ n }: { n: RawNotification }) {
  const [fixing, setFixing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suggestion = verdictOf(n);

  const send = async (v: Verdict) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await answerReview(n, v);
    } catch {
      setError("Couldn't save. Try again.");
      setBusy(false);
    }
  };

  if (n.review?.state === 'pending') {
    return (
      <Label size={14} tone="muted">
        Reading…
      </Label>
    );
  }

  return (
    <>
      <Column verticalArrangement={{ spacedBy: 8 }}>
        {suggestion ? (
          <Label weight="medium">{question(suggestion)}</Label>
        ) : (
          <Label size={14} tone="muted">
            {"Couldn't read this one."}
          </Label>
        )}
        <Row horizontalArrangement={{ spacedBy: 8 }} verticalAlignment="center">
          {suggestion && (
            <Button onClick={() => send(suggestion)} enabled={!busy}>
              <Label weight="medium" color={color.bg}>
                Yes
              </Label>
            </Button>
          )}
          <TextButton onClick={() => setFixing(true)} enabled={!busy}>
            <Label weight="medium">{suggestion ? 'Fix' : 'Add'}</Label>
          </TextButton>
          {suggestion?.kind !== 'ad_or_other' && (
            <TextButton onClick={() => send(NOT_A_TRANSACTION)} enabled={!busy}>
              <Label weight="medium" tone="muted">
                Not money
              </Label>
            </TextButton>
          )}
        </Row>
        {error && (
          <Label size={14} tone="danger">
            {error}
          </Label>
        )}
      </Column>
      {fixing && (
        <FixSheet
          start={suggestion?.kind === 'ad_or_other' ? null : suggestion}
          onClose={() => setFixing(false)}
          onSave={(v) => {
            setFixing(false);
            void send(v);
          }}
        />
      )}
    </>
  );
}

type Kind3 = 'expense' | 'income' | 'transfer';
const KINDS: { kind: Kind3; label: string }[] = [
  { kind: 'expense', label: 'Spent' },
  { kind: 'income', label: 'Received' },
  { kind: 'transfer', label: 'Own accounts' },
];

function FixSheet({ start, onClose, onSave }: { start: Verdict | null; onClose: () => void; onSave: (v: Verdict) => void }) {
  const startKind: Kind3 = start && start.kind !== 'ad_or_other' ? start.kind : 'expense';
  const [kind, setKind] = useState<Kind3>(startKind);
  const [direction, setDirection] = useState<'in' | 'out'>(start?.direction ?? 'out');
  const [amount, setAmount] = useState(start && start.amount > 0 ? String(start.amount) : '');
  const [name, setName] = useState(start?.counterparty ?? '');
  const amountState = useNativeState(amount);
  const nameState = useNativeState(name);
  const [error, setError] = useState<string | null>(null);

  const pick = (k: Kind3) => {
    setKind(k);
    if (k === 'expense') setDirection('out');
    if (k === 'income') setDirection('in');
  };

  const save = () => {
    const value = Number(amount.replace(/[^\d]/g, ''));
    if (!Number.isInteger(value) || value <= 0) {
      setError('Enter the amount.');
      return;
    }
    onSave({ kind, direction, amount: value, counterparty: name.trim() || null });
  };

  return (
    <ModalBottomSheet onDismissRequest={onClose} containerColor={color.surface} skipPartiallyExpanded>
      <Column modifiers={[fillMaxWidth(), padding(space.page, 4, space.page, 32)]} verticalArrangement={{ spacedBy: 16 }}>
        <Label size={22} weight="bold">
          What was it?
        </Label>
        <Row horizontalArrangement={{ spacedBy: 6 }}>
          {KINDS.map((k) => (
            <Chip key={k.kind} label={k.label} selected={kind === k.kind} onPress={() => pick(k.kind)} />
          ))}
        </Row>
        {kind === 'transfer' && (
          <Row horizontalArrangement={{ spacedBy: 6 }}>
            <Chip label="Out" selected={direction === 'out'} onPress={() => setDirection('out')} />
            <Chip label="In" selected={direction === 'in'} onPress={() => setDirection('in')} />
          </Row>
        )}
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
              Who
            </Label>
          </OutlinedTextField.Label>
        </OutlinedTextField>
        {error && (
          <Label size={14} tone="danger">
            {error}
          </Label>
        )}
        <Row horizontalArrangement={{ spacedBy: 8 }}>
          <Button onClick={save}>
            <Label weight="medium" color={color.bg}>
              Save
            </Label>
          </Button>
        </Row>
      </Column>
    </ModalBottomSheet>
  );
}
