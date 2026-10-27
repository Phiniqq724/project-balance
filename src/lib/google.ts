import { CodedError } from 'expo';

import { BalanceCore } from './ledger';
import { supabase } from './supabase';

/**
 * Native "Sign in with Google" (Credential Manager) handed to Supabase as an ID token.
 * Google sees only the SHA-256 of the nonce; Supabase gets the raw one and checks it against the token.
 * Returns an error message, or null when signed in or cancelled. The auth listener does the rest.
 */
export async function signInWithGoogle(): Promise<string | null> {
  const clientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  if (!clientId) return 'Google sign-in isn’t set up.';

  let credential: { idToken: string; nonce: string };
  try {
    credential = await BalanceCore.signInWithGoogle(clientId);
  } catch (error) {
    const code = error instanceof CodedError ? error.code : (error as { code?: string } | null)?.code;
    if (code === 'ERR_CANCELLED') return null;
    if (code === 'ERR_NO_ACCOUNT') return 'Add a Google account to this phone first.';
    return 'Couldn’t reach Google.';
  }

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: credential.idToken,
    nonce: credential.nonce,
  });
  if (!error) return null;
  return error.name === 'AuthRetryableFetchError' ? 'No connection.' : 'Couldn’t sign in.';
}
