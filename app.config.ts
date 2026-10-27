import type { ConfigContext, ExpoConfig } from 'expo/config';

// Dev builds get their own app ID so a local `run:android` never replaces the daily (preview) install
// or its ledger. Everything else uses app.json as-is.
const isDev = process.env.APP_VARIANT === 'development';

export default ({ config }: ConfigContext): ExpoConfig => {
  const base = config as ExpoConfig;
  if (!isDev) return base;
  return {
    ...base,
    name: 'Balance Dev',
    android: { ...base.android, package: 'com.projectbalance.app.dev' },
  };
};
