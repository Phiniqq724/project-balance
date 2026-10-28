import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { AuthProvider, useAccount } from '@/lib/auth';
import { BalanceCore } from '@/lib/ledger';
import { applyParseRules } from '@/lib/parse-rules';
import { color } from '@/theme';
// Registers widget layouts with the native side so dev reloads pick up layout edits.
import '@/widgets/month-pulse';
import '@/widgets/spend-grid';

// Held until we know which ledger is open, so the sign-in screen never flashes for a signed-in user.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  // Widgets can't tell the app they were resized, so redraw them whenever the app is opened.
  useEffect(() => {
    BalanceCore.refreshWidgets().catch(() => {});
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') BalanceCore.refreshWidgets().catch(() => {});
    });
    return () => sub.remove();
  }, []);

  return (
    <AuthProvider>
      <StatusBar style="light" />
      <Routes />
    </AuthProvider>
  );
}

function Routes() {
  const account = useAccount();
  const ready = account !== undefined;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  // Bank rules ship with the JS, so an OTA update reaches the listener here. Each ledger is re-read once per change.
  const ledgerOpen = account !== undefined && account.mode !== 'none';
  const owner = account?.mode === 'cloud' ? account.session.user.id : account?.mode;
  useEffect(() => {
    if (ledgerOpen) applyParseRules().catch(() => {});
  }, [ledgerOpen, owner]);

  if (!ready) return null;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }}>
      <Stack.Protected guard={account?.mode !== 'none'}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="unparsed" />
      </Stack.Protected>
      <Stack.Protected guard={account?.mode === 'none'}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}
