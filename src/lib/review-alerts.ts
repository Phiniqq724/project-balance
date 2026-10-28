import { PermissionsAndroid, Platform } from 'react-native';

import { BalanceCore, SETTINGS } from './ledger';

// Android 13 made notifications opt-in; before that they are on from install.
const NEEDS_PERMISSION = Platform.OS === 'android' && Number(Platform.Version) >= 33;
const PERMISSION = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;

export async function alertsOn(): Promise<boolean> {
  return (await BalanceCore.getSetting(SETTINGS.reviewAlerts)) !== '0';
}

/** Asks for the notification permission. Resolves false if it was refused. */
export async function askForPermission(): Promise<{ granted: boolean; blocked: boolean }> {
  if (!NEEDS_PERMISSION) return { granted: true, blocked: false };
  if (await PermissionsAndroid.check(PERMISSION)) return { granted: true, blocked: false };
  const result = await PermissionsAndroid.request(PERMISSION);
  return { granted: result === PermissionsAndroid.RESULTS.GRANTED, blocked: result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN };
}

export async function setAlerts(on: boolean): Promise<void> {
  await BalanceCore.setSetting(SETTINGS.reviewAlerts, on ? '1' : '0');
  if (!on) return;
  const { granted, blocked } = await askForPermission();
  // Android won't show the prompt again, so send them to the switch.
  if (!granted && blocked) BalanceCore.openNotificationSettings();
}

/** Asks once, the first time there is something to check. A refusal is final until they turn Alerts on themselves. */
export async function askOnce(): Promise<void> {
  if ((await BalanceCore.getSetting(SETTINGS.alertsAsked)) === '1') return;
  await BalanceCore.setSetting(SETTINGS.alertsAsked, '1');
  if (await alertsOn()) await askForPermission();
}
