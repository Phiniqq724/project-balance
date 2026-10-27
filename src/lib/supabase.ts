import { createClient, type SupportedStorage } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import { BalanceCore } from './ledger';

// The session can't live in a ledger file: which file to open depends on who is signed in.
// The native module keeps it in app-private SharedPreferences instead.
const storage: SupportedStorage = {
  getItem: (key) => BalanceCore.getAuthItem(key),
  setItem: (key, value) => BalanceCore.setAuthItem(key, value),
  removeItem: (key) => BalanceCore.removeAuthItem(key),
};

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_KEY!,
  {
    auth: {
      storage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);

AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
