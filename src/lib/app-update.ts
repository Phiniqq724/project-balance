import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

export const CURRENT_VERSION = Constants.expoConfig?.version ?? '';

/** Minimum gap between automatic update checks (launch and coming back to the app). */
export const AUTO_CHECK_GAP_MS = 5 * 60 * 1000;

/** Whether OTA updates work in this build (off in dev builds). */
const otaEnabled = () => Updates.isEnabled && !__DEV__;

/** True when `latest` is a strictly newer dotted version than `current`; missing or non-numeric segments count as 0. */
export function isNewerVersion(current: string, latest: string): boolean {
  const a = latest.split('.').map((n) => parseInt(n, 10) || 0);
  const b = current.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** Resolves "downloaded" when an OTA update is ready to apply on restart, "latest" when there is none. */
async function fetchLatestUpdate(): Promise<'latest' | 'downloaded'> {
  const { isAvailable } = await Updates.checkForUpdateAsync();
  if (!isAvailable) return 'latest';
  await Updates.fetchUpdateAsync();
  return 'downloaded';
}

/**
 * Downloads the APK and opens the system installer. The native modules are required lazily so an
 * OTA update on a binary built without expo-intent-launcher falls back instead of crashing.
 * Resolves false when it can't, so the caller can open the URL in a browser.
 */
async function downloadAndInstallApk(apkUrl: string): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { File, Directory, Paths } = require('expo-file-system') as typeof import('expo-file-system');
    const IntentLauncher = require('expo-intent-launcher') as typeof import('expo-intent-launcher');
    /* eslint-enable @typescript-eslint/no-require-imports */

    // A fresh folder each time, so a re-download never collides with an earlier APK.
    const dir = new Directory(Paths.cache, 'updates');
    if (dir.exists) dir.delete();
    dir.create();

    const file = await File.downloadFileAsync(apkUrl, dir);
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: file.contentUri,
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
      type: 'application/vnd.android.package-archive',
    });
    return true;
  } catch {
    return false;
  }
}

type Release = { version: string; apk_url: string };

/** Newest published APK, or null. Works signed out: the table is readable by anon. */
async function latestRelease(): Promise<Release | null> {
  const { data } = await supabase
    .from('app_releases')
    .select('version, apk_url')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as Release | null;
}

/** Outcome of a manual check that didn't restart or open the installer. */
export type UpdateResult = 'latest' | 'failed';

/**
 * Checks for and downloads OTA updates on mount and whenever the app returns to the foreground,
 * at most once per `AUTO_CHECK_GAP_MS`. Errors are ignored; the next check tries again.
 */
export function useAutoUpdateCheck() {
  const lastCheck = useRef(0);
  useEffect(() => {
    if (!otaEnabled()) return;
    const check = () => {
      const now = Date.now();
      if (now - lastCheck.current < AUTO_CHECK_GAP_MS) return;
      lastCheck.current = now;
      fetchLatestUpdate().catch(() => {});
    };
    check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => sub.remove();
  }, []);
}

/**
 * Version and update state for the profile row. `kind` says what `run` will do: install a newer
 * APK, restart into a downloaded OTA update, or check for one.
 */
export function useAppUpdate() {
  const { isUpdatePending } = Updates.useUpdates();
  const [release, setRelease] = useState<Release | null>(null);

  useEffect(() => {
    latestRelease()
      .then((r) => setRelease(r && isNewerVersion(CURRENT_VERSION, r.version) ? r : null))
      .catch(() => {});
  }, []);

  const kind = release ? 'apk' : isUpdatePending ? 'restart' : 'check';

  const run = async (): Promise<UpdateResult | null> => {
    if (release) {
      if (!(await downloadAndInstallApk(release.apk_url))) await WebBrowser.openBrowserAsync(release.apk_url);
      return null;
    }
    if (isUpdatePending) {
      await Updates.reloadAsync();
      return null;
    }
    if (!otaEnabled()) return 'latest';
    try {
      if ((await fetchLatestUpdate()) === 'downloaded') {
        await Updates.reloadAsync();
        return null;
      }
      return 'latest';
    } catch {
      return 'failed';
    }
  };

  return { version: CURRENT_VERSION, newVersion: release?.version ?? null, kind, run } as const;
}
