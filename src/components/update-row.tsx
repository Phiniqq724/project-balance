import SystemUpdate from '@expo/material-symbols/system_update_alt.xml';
import { useState } from 'react';

import { Label, SettingsRow } from '@/components/kit';
import { type UpdateResult, useAppUpdate } from '@/lib/app-update';

type Status = 'idle' | 'checking' | 'downloading' | UpdateResult;

const STATUS_TEXT: Record<Exclude<Status, 'idle'>, string> = {
  checking: 'Checking…',
  downloading: 'Downloading…',
  latest: 'Up to date',
  failed: "Couldn't check",
};

/** Profile row: shows the version, and turns into the update action when a new APK or a downloaded OTA update is waiting. */
export function UpdateRow() {
  const { version, newVersion, kind, run } = useAppUpdate();
  const [status, setStatus] = useState<Status>('idle');
  const busy = status === 'checking' || status === 'downloading';
  const available = kind !== 'check';

  const press = async () => {
    if (busy) return;
    setStatus(kind === 'apk' ? 'downloading' : kind === 'check' ? 'checking' : 'idle');
    try {
      setStatus((await run()) ?? 'idle');
    } catch {
      setStatus('failed');
    }
  };

  const title = kind === 'apk' ? `Update to ${newVersion}` : kind === 'restart' ? 'Restart to update' : `Version ${version}`;
  const text = status === 'idle' ? null : STATUS_TEXT[status];

  return (
    <SettingsRow
      icon={SystemUpdate}
      title={title}
      onPress={press}
      status={text ?? undefined}
      statusTone={status === 'failed' ? 'danger' : 'muted'}
      trailing={
        !text && available ? (
          <Label size={14} weight="medium" tone="accent">
            New
          </Label>
        ) : undefined
      }
    />
  );
}
