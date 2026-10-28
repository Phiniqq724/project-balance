import Cloud from '@expo/material-symbols/cloud.xml';
import Logout from '@expo/material-symbols/logout.xml';
import Mobile from '@expo/material-symbols/mobile.xml';
import { Column } from '@expo/ui/jetpack-compose';
import { fillMaxWidth, padding } from '@expo/ui/jetpack-compose/modifiers';
import { useState } from 'react';

import { ConfirmDialog, Label, SettingsDivider, SettingsRow } from '@/components/kit';
import { signOut, switchToLocal } from '@/lib/auth';
import { signInWithGoogle } from '@/lib/google';
import { space } from '@/theme';

/** Profile header in local mode, where there is no username or photo to show. */
export function LocalHeader() {
  return (
    <Column modifiers={[fillMaxWidth(), padding(space.page, 6, space.page, 6)]} verticalArrangement={{ spacedBy: 2 }}>
      <Label size={17} weight="medium">
        This phone only
      </Label>
      <Label size={13} tone="muted">
        Not backed up
      </Label>
    </Column>
  );
}

/**
 * Local: connect Google (the phone's ledger merges into the account's, then backs up).
 * Cloud: stop syncing and keep everything on the phone. Nothing is deleted from the cloud.
 */
export function AccountSwitch({ cloud }: { cloud: boolean }) {
  const [state, setState] = useState<'idle' | 'running' | 'failed'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [asking, setAsking] = useState<'local' | 'signOut' | null>(null);

  const connect = async () => {
    if (state === 'running') return;
    setState('running');
    const error = await signInWithGoogle();
    setMessage(error);
    setState(error ? 'failed' : 'idle');
  };

  const leave = async (task: () => Promise<void>) => {
    if (state === 'running') return;
    setState('running');
    try {
      await task();
      setState('idle');
    } catch {
      setState('failed');
    }
  };

  const status = state === 'running' ? 'Working…' : state === 'failed' ? (message ?? 'Failed') : undefined;
  return cloud ? (
    <>
      <SettingsRow icon={Mobile} title="Use this phone only" status={status} statusTone="danger" onPress={() => setAsking('local')} />
      <SettingsDivider />
      <SettingsRow icon={Logout} title="Sign out" tone="danger" onPress={() => setAsking('signOut')} />
      {asking === 'local' && (
        <ConfirmDialog
          title="Use this phone only?"
          text="Backup and AI review stop. Your data stays here and in the cloud."
          confirm="Stop syncing"
          onConfirm={() => void leave(switchToLocal)}
          onDismiss={() => setAsking(null)}
        />
      )}
      {asking === 'signOut' && (
        <ConfirmDialog
          title="Sign out?"
          text="Your data stays backed up. Sign in again to get it back."
          confirm="Sign out"
          danger
          onConfirm={() => void leave(signOut)}
          onDismiss={() => setAsking(null)}
        />
      )}
    </>
  ) : (
    <SettingsRow
      icon={Cloud}
      title="Connect Google"
      subtitle="Back up and sync"
      status={status}
      statusTone={state === 'failed' ? 'danger' : 'muted'}
      onPress={connect}
    />
  );
}
