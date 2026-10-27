import { Column } from '@expo/ui/jetpack-compose';
import { fillMaxWidth, padding } from '@expo/ui/jetpack-compose/modifiers';
import { useState } from 'react';
import { Alert } from 'react-native';

import { Label, LinkRow } from '@/components/kit';
import { switchToLocal } from '@/lib/auth';
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

  const connect = async () => {
    if (state === 'running') return;
    setState('running');
    const error = await signInWithGoogle();
    setMessage(error);
    setState(error ? 'failed' : 'idle');
  };

  const disconnect = async () => {
    if (state === 'running') return;
    setState('running');
    try {
      await switchToLocal();
      setState('idle');
    } catch {
      setState('failed');
    }
  };

  const confirm = () =>
    Alert.alert('Use this phone only?', 'Backup and AI review stop. Your data stays here and in the cloud.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Stop syncing', onPress: () => void disconnect() },
    ]);

  const value = state === 'running' ? 'Working…' : state === 'failed' ? (message ?? 'Failed') : undefined;
  return cloud ? (
    <LinkRow label="Use this phone only" value={value} onPress={confirm} />
  ) : (
    <LinkRow label="Connect Google" value={value} onPress={connect} />
  );
}
