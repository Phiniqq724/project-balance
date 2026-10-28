import Key from '@expo/material-symbols/key.xml';
import { Button, Column, ModalBottomSheet, OutlinedTextField, Row, TextButton, useNativeState } from '@expo/ui/jetpack-compose';
import { fillMaxWidth, padding } from '@expo/ui/jetpack-compose/modifiers';
import { useState } from 'react';

import { fieldColors, fieldText } from '@/components/category-sheet';
import { ConfirmDialog, Label, SettingsDivider, SettingsRow, SheetSlot } from '@/components/kit';
import { keyError, keyLabel, useAiKey } from '@/lib/ai-key';
import { useCloudUser } from '@/lib/auth';
import { BalanceCore } from '@/lib/ledger';
import { color, space } from '@/theme';

/** Profile row, with its divider below: paste your own Gemini, OpenAI or Claude key. Local and cloud. */
export function AiKeyRow() {
  const [info, refresh] = useAiKey();
  const [open, setOpen] = useState(false);
  return (
    <>
      <SettingsRow
        icon={Key}
        title="AI key"
        subtitle={info ? keyLabel(info) : 'Use your own Gemini, OpenAI or Claude key'}
        status={info?.status ?? undefined}
        statusTone="danger"
        onPress={() => setOpen(true)}
      />
      <SettingsDivider />
      <SheetSlot>
        {open && (
          <AiKeySheet
            saved={info !== null}
            onDone={() => {
              refresh();
              setOpen(false);
            }}
            onClose={() => setOpen(false)}
          />
        )}
      </SheetSlot>
    </>
  );
}

function AiKeySheet({ saved, onDone, onClose }: { saved: boolean; onDone: () => void; onClose: () => void }) {
  const cloud = !!useCloudUser();
  const keyState = useNativeState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [removing, setRemoving] = useState(false);

  const save = async () => {
    if (!key.trim()) {
      setError('Paste a key.');
      return;
    }
    setChecking(true);
    setError(null);
    try {
      await BalanceCore.setAiKey(key.trim());
      onDone();
    } catch (e) {
      setError(keyError(e));
      setChecking(false);
    }
  };

  const remove = async () => {
    try {
      await BalanceCore.clearAiKey();
      onDone();
    } catch {
      setError("Couldn't remove it. Try again.");
    }
  };

  return (
    <ModalBottomSheet onDismissRequest={onClose} containerColor={color.surface} skipPartiallyExpanded>
      <Column modifiers={[fillMaxWidth(), padding(space.page, 4, space.page, 32)]} verticalArrangement={{ spacedBy: 16 }}>
        <Label size={22} weight="bold">
          AI key
        </Label>
        <Label tone="muted">Stays on this phone. Gemini has a free tier; OpenAI and Claude bill your account.</Label>

        <OutlinedTextField
          value={keyState}
          onValueChange={setKey}
          singleLine
          visualTransformation="password"
          keyboardOptions={{ autoCorrectEnabled: false, capitalization: 'none', keyboardType: 'password' }}
          colors={fieldColors}
          textStyle={fieldText}
          modifiers={[fillMaxWidth()]}>
          <OutlinedTextField.Label>
            <Label size={14} tone="muted">
              {saved ? 'New key' : 'Key'}
            </Label>
          </OutlinedTextField.Label>
        </OutlinedTextField>

        {error && (
          <Label size={14} tone="danger">
            {error}
          </Label>
        )}

        <Row horizontalArrangement={{ spacedBy: 8 }} verticalAlignment="center">
          <Button onClick={save} enabled={!checking}>
            <Label weight="medium" color={color.bg}>
              {checking ? 'Checking…' : 'Save'}
            </Label>
          </Button>
          {saved && (
            <TextButton onClick={() => setRemoving(true)}>
              <Label weight="medium" tone="danger">
                Remove key
              </Label>
            </TextButton>
          )}
        </Row>
      </Column>

      {removing && (
        <ConfirmDialog
          title="Remove key?"
          text={cloud ? 'Unclear notifications go back to the built-in AI.' : 'AI review turns off.'}
          confirm="Remove"
          danger
          onConfirm={remove}
          onDismiss={() => setRemoving(false)}
        />
      )}
    </ModalBottomSheet>
  );
}
