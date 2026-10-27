import { Button, Column, OutlinedTextField, Spacer, TextButton, useNativeState, type TextFieldRef } from '@expo/ui/jetpack-compose';
import { fillMaxWidth, height, padding, verticalScroll } from '@expo/ui/jetpack-compose/modifiers';
import { AuthError } from '@supabase/supabase-js';
import { useRef, useState } from 'react';

import { fieldColors, fieldText } from '@/components/category-sheet';
import { Label, Screen } from '@/components/kit';
import { supabase } from '@/lib/supabase';
import { color, space } from '@/theme';

type Mode = 'sign-in' | 'sign-up';

function describe(error: AuthError): string {
  if (error.name === 'AuthRetryableFetchError') return 'No connection.';
  if (error.code === 'invalid_credentials') return 'Wrong email or password.';
  if (error.code === 'user_already_exists') return 'That email already has an account.';
  if (error.code === 'email_not_confirmed') return 'Confirm your email first.';
  if (error.code === 'weak_password') return 'Use at least 6 characters.';
  return error.message;
}

export default function SignInScreen() {
  const [mode, setMode] = useState<Mode>('sign-in');
  const emailState = useNativeState('');
  const passwordState = useNativeState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'muted' | 'danger' } | null>(null);
  const passwordRef = useRef<TextFieldRef>(null);

  const submit = async () => {
    if (busy) return;
    const address = email.trim();
    if (!address || !password) {
      setMessage({ text: 'Enter your email and password.', tone: 'danger' });
      return;
    }
    setBusy(true);
    setMessage(null);
    const credentials = { email: address, password };
    const { data, error } =
      mode === 'sign-in' ? await supabase.auth.signInWithPassword(credentials) : await supabase.auth.signUp(credentials);
    setBusy(false);
    if (error) {
      setMessage({ text: describe(error), tone: 'danger' });
    } else if (!data.session) {
      // The project asks new accounts to confirm their email before the first sign-in.
      setMode('sign-in');
      setMessage({ text: 'Check your inbox to confirm, then sign in.', tone: 'muted' });
    }
    // With a session, the root layout swaps this screen for the app.
  };

  const signingIn = mode === 'sign-in';

  return (
    <Screen>
      <Column modifiers={[fillMaxWidth(), verticalScroll(), padding(space.page, 72, space.page, 32)]}>
        <Label size={15} weight="bold" tone="muted">
          Balance
        </Label>
        <Spacer modifiers={[height(8)]} />
        <Label size={32} weight="bold">
          {signingIn ? 'Sign in' : 'Create account'}
        </Label>
        <Spacer modifiers={[height(32)]} />

        <Column verticalArrangement={{ spacedBy: 12 }} modifiers={[fillMaxWidth()]}>
          <OutlinedTextField
            value={emailState}
            onValueChange={setEmail}
            singleLine
            enabled={!busy}
            colors={fieldColors}
            textStyle={fieldText}
            keyboardOptions={{ keyboardType: 'email', capitalization: 'none', autoCorrectEnabled: false, imeAction: 'next' }}
            keyboardActions={{ onNext: () => void passwordRef.current?.focus() }}
            modifiers={[fillMaxWidth()]}>
            <OutlinedTextField.Label>
              <Label size={14} tone="muted">
                Email
              </Label>
            </OutlinedTextField.Label>
          </OutlinedTextField>

          <OutlinedTextField
            ref={passwordRef}
            value={passwordState}
            onValueChange={setPassword}
            singleLine
            enabled={!busy}
            visualTransformation="password"
            colors={fieldColors}
            textStyle={fieldText}
            keyboardOptions={{ keyboardType: 'password', autoCorrectEnabled: false, imeAction: 'done' }}
            keyboardActions={{ onDone: () => void submit() }}
            modifiers={[fillMaxWidth()]}>
            <OutlinedTextField.Label>
              <Label size={14} tone="muted">
                Password
              </Label>
            </OutlinedTextField.Label>
          </OutlinedTextField>
        </Column>

        {message && (
          <Label size={14} tone={message.tone} modifiers={[padding(0, 12, 0, 0)]}>
            {message.text}
          </Label>
        )}

        <Spacer modifiers={[height(24)]} />
        <Button onClick={submit} enabled={!busy} modifiers={[fillMaxWidth(), height(52)]}>
          <Label weight="bold" color={color.bg}>
            {busy ? (signingIn ? 'Signing in…' : 'Creating…') : signingIn ? 'Sign in' : 'Create account'}
          </Label>
        </Button>
        <Spacer modifiers={[height(8)]} />
        <TextButton
          onClick={() => {
            setMode(signingIn ? 'sign-up' : 'sign-in');
            setMessage(null);
          }}
          enabled={!busy}
          modifiers={[fillMaxWidth()]}>
          <Label weight="medium" tone="muted">
            {signingIn ? 'New here? Create account' : 'Have an account? Sign in'}
          </Label>
        </TextButton>
      </Column>
    </Screen>
  );
}
