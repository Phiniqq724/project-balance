import { Directory, File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { launchImageLibraryAsync } from 'expo-image-picker';
import { useEffect, useSyncExternalStore } from 'react';

import { BalanceCore } from './ledger';
import { supabase } from './supabase';

/**
 * Username and photo, stored in Supabase (profiles table, private avatars bucket).
 * The last known copy is kept in the user's ledger and the photo on disk, so the
 * Profile tab shows them offline and without a flash on open.
 */

export type Profile = { username: string | null; avatarPath: string | null };

export const USERNAME = /^[a-z0-9_.]{3,20}$/;

const CACHE_KEY = 'profile';
const AVATAR_SIZE = 256;

type State = { userId: string; profile: Profile; avatarUri: string | null } | null;

let state: State = null;
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

function avatarDir(): Directory {
  const dir = new Directory(Paths.document, 'avatars');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/** "<user id>/<time>.jpg" -> file in the app's avatars folder. Paths are never reused, so no stale copies. */
function avatarFile(path: string): File {
  return new File(avatarDir(), path.replace('/', '-'));
}

async function localAvatar(path: string | null): Promise<string | null> {
  if (!path) return null;
  const file = avatarFile(path);
  if (file.exists) return file.uri;
  const { data, error } = await supabase.storage.from('avatars').createSignedUrl(path, 60);
  if (error) throw error;
  return (await File.downloadFileAsync(data.signedUrl, file)).uri;
}

async function commit(userId: string, profile: Profile, avatarUri: string | null) {
  await BalanceCore.setSetting(CACHE_KEY, JSON.stringify(profile));
  if (state?.userId === userId || state === null) set({ userId, profile, avatarUri });
}

async function load(userId: string) {
  // Cached copy first, so the screen never starts blank.
  if (state?.userId !== userId) {
    const cached = await BalanceCore.getSetting(CACHE_KEY);
    const profile: Profile = cached ? JSON.parse(cached) : { username: null, avatarPath: null };
    const file = profile.avatarPath ? avatarFile(profile.avatarPath) : null;
    set({ userId, profile, avatarUri: file?.exists ? file.uri : null });
  }
  const { data, error } = await supabase.from('profiles').select('username, avatar_path').eq('id', userId).maybeSingle();
  if (error) return; // Offline: keep the cached copy.
  const profile = { username: data?.username ?? null, avatarPath: data?.avatar_path ?? null };
  const avatarUri = await localAvatar(profile.avatarPath).catch(() => null);
  await commit(userId, profile, avatarUri);
}

export function useProfile(userId: string) {
  useEffect(() => {
    void load(userId);
  }, [userId]);
  const current = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state
  );
  return current?.userId === userId ? current : null;
}

function current(userId: string): Profile {
  return state?.userId === userId ? state.profile : { username: null, avatarPath: null };
}

/** Returns an error message, or null when saved. */
export async function saveUsername(userId: string, input: string): Promise<string | null> {
  const username = input.trim().toLowerCase();
  if (!USERNAME.test(username)) return '3–20 of a–z, 0–9, _ or .';
  const { error } = await supabase.from('profiles').upsert({ id: userId, username });
  if (error?.code === '23505') return 'Taken.';
  if (error) return "Couldn't save.";
  await commit(userId, { ...current(userId), username }, state?.avatarUri ?? null);
  return null;
}

/** Opens the photo picker and uploads a square crop. Returns an error message, or null when done or cancelled. */
export async function changeAvatar(userId: string): Promise<string | null> {
  const picked = await launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
  if (picked.canceled || !picked.assets[0]) return null;

  const small = await manipulateAsync(picked.assets[0].uri, [{ resize: { width: AVATAR_SIZE, height: AVATAR_SIZE } }], {
    compress: 0.8,
    format: SaveFormat.JPEG,
  });
  const path = `${userId}/${Date.now()}.jpg`;
  const source = new File(small.uri);
  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, await source.arrayBuffer(), { contentType: 'image/jpeg' });
  if (uploadError) return "Couldn't upload.";

  const previous = current(userId).avatarPath;
  const { error } = await supabase.from('profiles').upsert({ id: userId, avatar_path: path });
  if (error) {
    void supabase.storage.from('avatars').remove([path]);
    return "Couldn't save.";
  }
  const file = avatarFile(path);
  source.copy(file);
  await commit(userId, { ...current(userId), avatarPath: path }, file.uri);
  if (previous) forget(previous);
  return null;
}

export async function removeAvatar(userId: string): Promise<string | null> {
  const previous = current(userId).avatarPath;
  if (!previous) return null;
  const { error } = await supabase.from('profiles').upsert({ id: userId, avatar_path: null });
  if (error) return "Couldn't remove.";
  await commit(userId, { ...current(userId), avatarPath: null }, null);
  forget(previous);
  return null;
}

/** Old photos: gone from the bucket and the phone. Best effort; a leftover file is harmless. */
function forget(path: string) {
  void supabase.storage.from('avatars').remove([path]);
  const file = avatarFile(path);
  if (file.exists) file.delete();
}
