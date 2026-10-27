import { Column, Row } from '@expo/ui/jetpack-compose';
import { clickable, fillMaxWidth, padding, weight, width } from '@expo/ui/jetpack-compose/modifiers';

import { Label } from '@/components/kit';
import { digits, signed, time } from '@/lib/format';
import { sourceLabel, transactionTitle, type Transaction } from '@/lib/ledger';
import { space } from '@/theme';

/** One ledger line: time, who, how it was filed, amount. `pair` merges both halves of an own transfer. */
export function TxRow({ tx, pair, onPress }: { tx: Transaction; pair?: Transaction; onPress?: () => void }) {
  let title = transactionTitle(tx);
  let meta: string;
  let amount = signed(tx.amount, tx.direction);
  let tone: 'muted' | 'income' | 'accent' = tx.direction === 'in' ? 'income' : 'accent';

  if (pair) {
    title = `${sourceLabel(tx.source)} → ${sourceLabel(pair.source)}`;
    meta = 'Own transfer';
    amount = digits(tx.amount);
    tone = 'muted';
  } else if (tx.isTransfer) {
    meta = `Transfer  ·  ${sourceLabel(tx.source)}`;
    tone = 'muted';
  } else {
    meta = `${tx.categoryName ?? (tx.direction === 'in' ? 'Income' : 'No category')}  ·  ${sourceLabel(tx.source)}`;
  }

  return (
    <Row
      verticalAlignment="top"
      horizontalArrangement={{ spacedBy: 12 }}
      modifiers={[fillMaxWidth(), ...(onPress ? [clickable(onPress)] : []), padding(space.page, 12, space.page, 12)]}>
      <Label size={12} weight="medium" tone="muted" modifiers={[width(38), padding(0, 2, 0, 0)]}>
        {time(tx.occurredAt)}
      </Label>
      <Column modifiers={[weight(1)]} verticalArrangement={{ spacedBy: 2 }}>
        <Label weight="medium" maxLines={1} overflow="ellipsis">
          {title}
        </Label>
        <Label size={13} tone="muted" maxLines={1} overflow="ellipsis">
          {meta}
        </Label>
      </Column>
      <Label weight="bold" tone={tone}>
        {amount}
      </Label>
    </Row>
  );
}
