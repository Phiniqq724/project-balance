import { Column, FlowRow, ModalBottomSheet, Row, Spacer, Switch } from '@expo/ui/jetpack-compose';
import { background, fillMaxWidth, height, padding, paddingAll, weight } from '@expo/ui/jetpack-compose/modifiers';
import { useState } from 'react';

import { Chip, Label, Money, Rule } from '@/components/kit';
import { digits, shortDate, time } from '@/lib/format';
import { BalanceCore, sourceLabel, transactionTitle, type Category, type Transaction } from '@/lib/ledger';
import { color, space } from '@/theme';

type Props = {
  tx: Transaction;
  categories: Category[];
  onClose: () => void;
};

/** Details for one transaction, plus the two things worth fixing by hand: category and transfer. */
export function TxSheet({ tx, categories, onClose }: Props) {
  const [categoryId, setCategoryId] = useState(tx.categoryId);
  const [isTransfer, setIsTransfer] = useState(tx.isTransfer);
  const [error, setError] = useState<string | null>(null);

  const pickCategory = (id: string | null) => {
    const previous = categoryId;
    setCategoryId(id);
    BalanceCore.setTransactionCategory(tx.id, id).catch(() => {
      setCategoryId(previous);
      setError("Couldn't save the category.");
    });
  };

  const toggleTransfer = (value: boolean) => {
    setIsTransfer(value);
    BalanceCore.setTransactionTransfer(tx.id, value).catch(() => {
      setIsTransfer(!value);
      setError("Couldn't save that change.");
    });
  };

  return (
    <ModalBottomSheet onDismissRequest={onClose} containerColor={color.surface} skipPartiallyExpanded>
      <Column modifiers={[fillMaxWidth(), padding(space.page, 4, space.page, 32)]} verticalArrangement={{ spacedBy: 20 }}>
        <Column verticalArrangement={{ spacedBy: 4 }}>
          <Label size={15} weight="medium" tone="muted" maxLines={2}>
            {transactionTitle(tx)}
          </Label>
          <Money value={`${tx.direction === 'in' ? '+' : ''}${digits(tx.amount)}`} size={38} tone={tx.direction === 'in' ? 'income' : 'text'} />
          <Label size={13} tone="muted">
            {`${sourceLabel(tx.source)}  ·  ${shortDate(tx.occurredAt)}, ${time(tx.occurredAt)}`}
          </Label>
        </Column>

        <Label size={13} tone="muted" modifiers={[fillMaxWidth(), background(color.bg), paddingAll(12)]}>
          {tx.rawBody}
        </Label>

        <Rule />

        <Column verticalArrangement={{ spacedBy: 10 }}>
          <Label size={13} weight="medium" tone="muted">
            Category
          </Label>
          <FlowRow horizontalArrangement={{ spacedBy: 6 }} verticalArrangement={{ spacedBy: 6 }}>
            {categories.map((c) => (
              <Chip key={c.id} label={c.name} selected={categoryId === c.id} onPress={() => pickCategory(c.id)} />
            ))}
            <Chip label="None" selected={categoryId === null} onPress={() => pickCategory(null)} />
          </FlowRow>
        </Column>

        <Rule />

        <Row verticalAlignment="center" horizontalArrangement={{ spacedBy: 16 }} modifiers={[fillMaxWidth()]}>
          <Column modifiers={[weight(1)]} verticalArrangement={{ spacedBy: 2 }}>
            <Label weight="medium">Between my own accounts</Label>
            <Label size={13} tone="muted">
              Kept out of spending and income.
            </Label>
          </Column>
          <Switch
            value={isTransfer}
            onCheckedChange={toggleTransfer}
            colors={{ checkedTrackColor: color.text, checkedThumbColor: color.bg }}
          />
        </Row>

        {error && (
          <Label size={14} tone="danger">
            {error}
          </Label>
        )}
        <Spacer modifiers={[height(8)]} />
      </Column>
    </ModalBottomSheet>
  );
}
