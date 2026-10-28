import FileExport from '@expo/material-symbols/file_export.xml';
import FileOpen from '@expo/material-symbols/file_open.xml';
import { Button, Column, ModalBottomSheet, Row, TextButton } from '@expo/ui/jetpack-compose';
import { fillMaxWidth, padding } from '@expo/ui/jetpack-compose/modifiers';
import { Directory, File } from 'expo-file-system';
import { useState } from 'react';

import type { LedgerImportPreview } from '../../modules/balance-core/src/BalanceCoreModule';
import { Label, SettingsDivider, SettingsRow, SheetSlot } from '@/components/kit';
import { BalanceCore } from '@/lib/ledger';
import { color, space } from '@/theme';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type Pending = { uri: string; preview: LedgerImportPreview };

function today() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function summary(p: LedgerImportPreview) {
  if (p.add === 0) return `Nothing new, ${p.existing} already here`;
  return p.existing > 0 ? `${p.add} new, ${p.existing} already here` : `${p.add} new`;
}

function describe(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  return code === 'ERR_NOT_LEDGER_FILE' ? 'Not a Balance sheet' : 'Failed';
}

/** Profile rows, for a SettingsGroup: save the active ledger as .xlsx, or merge one back in. Works in cloud and local mode. */
export function DataRows() {
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);

  const exportFile = async () => {
    if (busy) return;
    setBusy(true);
    setExportNote(null);
    try {
      // The system folder picker lets the user choose where the file goes.
      const folder = await Directory.pickDirectoryAsync();
      const file = folder.createFile(`balance-${today()}`, XLSX);
      const done = await BalanceCore.exportLedger(file.uri);
      setExportNote(`${done.transactions} saved`);
    } catch (error) {
      // Dismissing the picker rejects too; only real failures are worth a note.
      const message = String((error as Error | null)?.message ?? '').toLowerCase();
      setExportNote(message.includes('cancel') ? null : 'Failed');
    }
    setBusy(false);
  };

  const pickFile = async () => {
    if (busy) return;
    setBusy(true);
    setImportNote(null);
    try {
      const picked = await File.pickFileAsync({ mimeTypes: [XLSX, '*/*'] });
      if (!picked.canceled) {
        const uri = picked.result.uri;
        setPending({ uri, preview: await BalanceCore.previewLedgerImport(uri) });
      }
    } catch (error) {
      setImportNote(describe(error));
    }
    setBusy(false);
  };

  const confirm = async () => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      const done = await BalanceCore.importLedger(pending.uri);
      setImportNote(`${done.added} added`);
    } catch (error) {
      setImportNote(describe(error));
    }
    setPending(null);
    setBusy(false);
  };

  return (
    <>
      <SettingsRow
        icon={FileExport}
        title="Export"
        subtitle="Save as .xlsx"
        status={exportNote ?? undefined}
        statusTone={exportNote === 'Failed' ? 'danger' : 'muted'}
        onPress={exportFile}
      />
      <SettingsDivider />
      <SettingsRow
        icon={FileOpen}
        title="Import"
        subtitle="Add from .xlsx"
        status={importNote ?? undefined}
        statusTone={importNote === 'Failed' || importNote === 'Not a Balance sheet' ? 'danger' : 'muted'}
        onPress={pickFile}
      />

      <SheetSlot>
        {pending && (
          <ModalBottomSheet onDismissRequest={() => setPending(null)} containerColor={color.surface} skipPartiallyExpanded>
            <Column modifiers={[fillMaxWidth(), padding(space.page, 4, space.page, 32)]} verticalArrangement={{ spacedBy: 16 }}>
              <Label size={22} weight="bold">
                {summary(pending.preview)}
              </Label>
              {pending.preview.newCategories > 0 && (
                <Label tone="muted">{`${pending.preview.newCategories} new categories`}</Label>
              )}
              {pending.preview.skipped > 0 && <Label tone="muted">{`${pending.preview.skipped} rows skipped`}</Label>}
              <Row horizontalArrangement={{ spacedBy: 8 }} verticalAlignment="center">
                <Button onClick={confirm} enabled={!busy && pending.preview.add + pending.preview.newCategories > 0}>
                  <Label weight="medium" color={color.bg}>
                    Import
                  </Label>
                </Button>
                <TextButton onClick={() => setPending(null)}>
                  <Label weight="medium" tone="muted">
                    Cancel
                  </Label>
                </TextButton>
              </Row>
            </Column>
          </ModalBottomSheet>
        )}
      </SheetSlot>
    </>
  );
}
