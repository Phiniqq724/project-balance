import { Button, Column, ModalBottomSheet, OutlinedTextField, Row, TextButton, useNativeState } from '@expo/ui/jetpack-compose';
import { fillMaxWidth, padding } from '@expo/ui/jetpack-compose/modifiers';
import { useState } from 'react';

import { Label } from '@/components/kit';
import { BalanceCore, type Category } from '@/lib/ledger';
import { color, font, space } from '@/theme';

export const fieldColors = {
  focusedTextColor: color.text,
  unfocusedTextColor: color.text,
  focusedIndicatorColor: color.text,
  unfocusedIndicatorColor: color.line,
  focusedLabelColor: color.muted,
  unfocusedLabelColor: color.muted,
  cursorColor: color.text,
  focusedContainerColor: color.bg,
  unfocusedContainerColor: color.bg,
  focusedSupportingTextColor: color.muted,
  unfocusedSupportingTextColor: color.muted,
};

export const fieldText = { fontFamily: font.regular, fontSize: 16, color: color.text };

/** Edit a category's name and the merchant words that sort payments into it. */
export function CategorySheet({ category, onClose }: { category: Category | null; onClose: () => void }) {
  const nameState = useNativeState(category?.name ?? '');
  const keywordsState = useNativeState(category?.keywords.split(',').join(', ') ?? '');
  const [name, setName] = useState(category?.name ?? '');
  const [keywords, setKeywords] = useState(category?.keywords ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) {
      setError('Give it a name.');
      return;
    }
    setSaving(true);
    const cleaned = keywords
      .split(/[,\n]/)
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean)
      .join(',');
    try {
      await BalanceCore.saveCategory(category?.id ?? null, name, cleaned);
      onClose();
    } catch {
      setError("Couldn't save. Try again.");
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!category) return;
    try {
      await BalanceCore.deleteCategory(category.id);
      onClose();
    } catch {
      setError("Couldn't delete. Try again.");
    }
  };

  return (
    <ModalBottomSheet onDismissRequest={onClose} containerColor={color.surface} skipPartiallyExpanded>
      <Column modifiers={[fillMaxWidth(), padding(space.page, 4, space.page, 32)]} verticalArrangement={{ spacedBy: 16 }}>
        <Label size={22} weight="bold">
          {category ? 'Edit category' : 'New category'}
        </Label>

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

        <OutlinedTextField
          value={keywordsState}
          onValueChange={setKeywords}
          minLines={3}
          colors={fieldColors}
          textStyle={fieldText}
          modifiers={[fillMaxWidth()]}>
          <OutlinedTextField.Label>
            <Label size={14} tone="muted">
              Merchant words
            </Label>
          </OutlinedTextField.Label>
          <OutlinedTextField.SupportingText>
            <Label size={13} tone="muted">
              Comma separated. A payment whose name contains one lands here.
            </Label>
          </OutlinedTextField.SupportingText>
        </OutlinedTextField>

        {error && (
          <Label size={14} tone="danger">
            {error}
          </Label>
        )}

        <Row horizontalArrangement={{ spacedBy: 8 }} verticalAlignment="center">
          <Button onClick={save} enabled={!saving}>
            <Label weight="medium" color={color.bg}>
              {category ? 'Save' : 'Add category'}
            </Label>
          </Button>
          {category && (
            <TextButton onClick={remove}>
              <Label weight="medium" tone="danger">
                Delete
              </Label>
            </TextButton>
          )}
        </Row>
      </Column>
    </ModalBottomSheet>
  );
}
