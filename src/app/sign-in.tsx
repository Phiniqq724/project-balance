import { Button, Column, Spacer, TextButton } from '@expo/ui/jetpack-compose';
import { fillMaxWidth, height, padding } from '@expo/ui/jetpack-compose/modifiers';
import { useState } from 'react';

import { Label, Screen } from '@/components/kit';
import { chooseLocal } from '@/lib/auth';
import { signInWithGoogle } from '@/lib/google';
import { color, space } from '@/theme';

export default function SignInScreen() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const google = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const message = await signInWithGoogle();
    setBusy(false);
    setError(message);
    // With a session, the root layout swaps this screen for the app.
  };

  const local = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await chooseLocal();
    } catch {
      setError('Couldn’t open the ledger.');
    }
    setBusy(false);
  };

  return (
    <Screen>
      <Column modifiers={[fillMaxWidth(), padding(space.page, 72, space.page, 32)]}>
        <Label size={15} weight="bold" tone="muted">
          Balance
        </Label>
        <Spacer modifiers={[height(8)]} />
        <Label size={32} weight="bold">
          Sign in
        </Label>
        <Spacer modifiers={[height(32)]} />

        <Button onClick={google} enabled={!busy} modifiers={[fillMaxWidth(), height(52)]}>
          <Label weight="bold" color={color.bg}>
            {busy ? 'Working…' : 'Continue with Google'}
          </Label>
        </Button>
        {error && (
          <Label size={14} tone="danger" modifiers={[padding(0, 12, 0, 0)]}>
            {error}
          </Label>
        )}
        <Spacer modifiers={[height(8)]} />
        <TextButton onClick={local} enabled={!busy} modifiers={[fillMaxWidth()]}>
          <Label weight="medium" tone="muted">
            Use on this phone only
          </Label>
        </TextButton>
      </Column>
    </Screen>
  );
}
