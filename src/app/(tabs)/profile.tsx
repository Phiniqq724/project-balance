import Add from '@expo/material-symbols/add.xml';
import Check from '@expo/material-symbols/check.xml';
import {
  Box,
  Button,
  Column,
  FlowRow,
  Icon,
  Image,
  ModalBottomSheet,
  OutlinedTextField,
  Row,
  Spacer,
  TextButton,
  useNativeState,
} from '@expo/ui/jetpack-compose';
import {
  align,
  alpha,
  background,
  clickable,
  clip,
  fillMaxWidth,
  height,
  offset,
  padding,
  Shapes,
  size,
  verticalScroll,
  weight,
  width,
} from '@expo/ui/jetpack-compose/modifiers';
import { router } from 'expo-router';
import { useState } from 'react';
import { useWindowDimensions } from 'react-native';

import type { InstalledApp } from '../../../modules/balance-core/src/BalanceCoreModule';
import { AiReviewRow } from '@/components/ai-review-row';
import { CategorySheet, fieldColors, fieldText } from '@/components/category-sheet';
import { Chip, Failed, Label, Loading, Rule, Screen } from '@/components/kit';
import {
  BalanceCore,
  getCategories,
  getList,
  getUnparsedCount,
  MONEY_APPS,
  SETTINGS,
  sourceLabel,
  type Category,
} from '@/lib/ledger';
import { useSession, useUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { changeAvatar, removeAvatar, saveUsername, useProfile } from '@/lib/profile';
import { syncNow, useSyncStatus } from '@/lib/sync';
import { useLedger } from '@/lib/use-ledger';
import { color, space } from '@/theme';

async function loadSettings() {
  const [watched, selfNames, categories, unparsed, apps] = await Promise.all([
    getList(SETTINGS.watchedPackages),
    getList(SETTINGS.selfNames, '\n'),
    getCategories(),
    getUnparsedCount(),
    BalanceCore.installedApps(),
  ]);
  return { watched, selfNames, categories, unparsed, apps, hasAccess: BalanceCore.hasNotificationAccess() };
}

type Data = Awaited<ReturnType<typeof loadSettings>>;

export default function ProfileScreen() {
  const state = useLedger(loadSettings);
  return (
    <Screen>
      {state.status === 'loading' && <Loading />}
      {state.status === 'error' && <Failed message="Couldn't load settings." onRetry={state.retry} />}
      {state.status === 'ready' && <ProfileBody data={state.data} />}
    </Screen>
  );
}

function ProfileBody({ data }: { data: Data }) {
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const signedIn = !!useSession();

  return (
    <>
      <Column modifiers={[fillMaxWidth(), verticalScroll()]}>
        <Label size={28} weight="bold" modifiers={[padding(space.page, 28, space.page, 20)]}>
          Profile
        </Label>

        <Account />
        <Spacer modifiers={[height(28)]} />

        <Access on={data.hasAccess} />

        <Apps installed={data.apps} initial={data.watched} />

        <Head title="Your name" />
        <SelfNames initial={data.selfNames} />

        <Head title="Categories" detail={String(data.categories.length)} />
        <FlowRow
          horizontalArrangement={{ spacedBy: 6 }}
          verticalArrangement={{ spacedBy: 6 }}
          modifiers={[fillMaxWidth(), padding(space.page, 0, space.page, 0)]}>
          {data.categories.map((c) => (
            <Chip key={c.id} label={c.name} selected={false} onPress={() => setEditing(c)} />
          ))}
          <Chip label="+ New" selected={false} onPress={() => setEditing('new')} />
        </FlowRow>

        <Spacer modifiers={[height(40)]} />
        <Rule />
        <LinkRow label="Not understood" value={String(data.unparsed)} onPress={() => router.push('/unparsed')} />
        <Rule />
        <Reprocess />
        <Rule />
        {signedIn && (
          <>
            <AiReviewRow />
            <Rule />
          </>
        )}
        <SignOut />
        <Rule />
        <Spacer modifiers={[height(space.navClearance)]} />
      </Column>

      {editing && (
        <CategorySheet
          key={editing === 'new' ? 'new' : editing.id}
          category={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function Head({ title, detail }: { title: string; detail?: string }) {
  return (
    <Row verticalAlignment="center" modifiers={[fillMaxWidth(), padding(space.page, 40, space.page, 14)]}>
      <Label weight="bold" modifiers={[weight(1)]}>
        {title}
      </Label>
      {detail && (
        <Label size={13} tone="muted">
          {detail}
        </Label>
      )}
    </Row>
  );
}

function Access({ on }: { on: boolean }) {
  return (
    <Row
      verticalAlignment="center"
      modifiers={[
        fillMaxWidth(),
        padding(space.page, 0, space.page, 0),
        clip(Shapes.RoundedCorner(12)),
        background(color.surface),
        clickable(() => BalanceCore.openNotificationAccessSettings()),
        padding(16, 14, 16, 14),
      ]}>
      <Label weight="medium" tone={on ? 'text' : 'danger'} modifiers={[weight(1)]}>
        {on ? 'Reading notifications' : 'Notification access off'}
      </Label>
      <Label size={14} weight="medium" tone="muted">
        {on ? 'Manage' : 'Turn on'}
      </Label>
    </Row>
  );
}

const COLUMNS = 4;
const GAP = 8;

/** Icon grid of the money apps on this phone. Tap to read or ignore; "Other" adds any app. */
function Apps({ installed, initial }: { installed: InstalledApp[]; initial: string[] }) {
  const [watched, setWatched] = useState(initial);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState(false);
  const window = useWindowDimensions();
  // One dp of slack: rounding the window width can otherwise push the fourth tile onto the next row.
  const tile = Math.floor((window.width - space.page * 2 - GAP * (COLUMNS - 1)) / COLUMNS) - 1;

  const byPackage = new Map(installed.map((a) => [a.package, a]));
  const shown = [
    ...installed.filter((a) => a.package in MONEY_APPS || watched.includes(a.package)),
    // Watched but not on this phone. Includes ones switched off this visit, so they can be switched back on.
    ...[...new Set([...initial, ...watched])]
      .filter((p) => !byPackage.has(p))
      .map((p) => ({ package: p, label: sourceLabel(p), icon: null })),
  ];
  const others = installed.filter((a) => !shown.some((s) => s.package === a.package));

  const save = (next: string[]) => {
    const previous = watched;
    setWatched(next);
    setError(false);
    BalanceCore.setSetting(SETTINGS.watchedPackages, next.join(',')).catch(() => {
      setWatched(previous);
      setError(true);
    });
  };
  const toggle = (pkg: string) => save(watched.includes(pkg) ? watched.filter((p) => p !== pkg) : [...watched, pkg]);

  return (
    <>
      <Head title="Read from" detail={`${watched.length} on`} />
      <FlowRow
        horizontalArrangement={{ spacedBy: GAP }}
        verticalArrangement={{ spacedBy: 4 }}
        modifiers={[fillMaxWidth(), padding(space.page, 0, space.page, 0)]}>
        {shown.map((app) => (
          <AppTile
            key={app.package}
            app={app}
            width={tile}
            on={watched.includes(app.package)}
            onPress={() => toggle(app.package)}
          />
        ))}
        <Column horizontalAlignment="center" modifiers={tileModifiers(tile, () => setPicking(true))}>
          {/* `border` is always rectangular, so the hairline is a line-colored shape with the bg inset by 1dp. */}
          <Box contentAlignment="center" modifiers={[size(52, 52), clip(Shapes.RoundedCorner(14)), background(color.line)]}>
            <Box contentAlignment="center" modifiers={[size(50, 50), clip(Shapes.RoundedCorner(13)), background(color.bg)]}>
              <Icon source={Add} size={22} tint={color.muted} contentDescription="Add an app" />
            </Box>
          </Box>
          <Label size={12} weight="medium" tone="muted" modifiers={[padding(4, 6, 4, 0)]}>
            Other
          </Label>
        </Column>
      </FlowRow>
      {error && (
        <Label size={14} tone="danger" modifiers={[padding(space.page, 10, space.page, 0)]}>
          {"Couldn't save."}
        </Label>
      )}

      {picking && (
        <AppPicker
          apps={others}
          onPick={(pkg) => {
            setPicking(false);
            save([...watched, pkg]);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}

function AppIcon({ app, dim = 52 }: { app: InstalledApp; dim?: number }) {
  if (app.icon) {
    return <Image source={{ uri: app.icon }} contentDescription={app.label} modifiers={[size(dim, dim), clip(Shapes.RoundedCorner(dim * 0.27))]} />;
  }
  return (
    <Box contentAlignment="center" modifiers={[size(dim, dim), clip(Shapes.RoundedCorner(dim * 0.27)), background(color.raised)]}>
      <Label size={18} weight="bold" tone="muted">
        {app.label.slice(0, 1).toUpperCase()}
      </Label>
    </Box>
  );
}

/** Tap area hugs the tile: rounded, with room above for the badge that overhangs the icon's corner. */
function tileModifiers(w: number, onPress: () => void) {
  return [width(w), clip(Shapes.RoundedCorner(14)), clickable(onPress), padding(0, 10, 0, 8)];
}

function AppTile({ app, width: w, on, onPress }: { app: InstalledApp; width: number; on: boolean; onPress: () => void }) {
  return (
    <Column horizontalAlignment="center" modifiers={tileModifiers(w, onPress)}>
      <Box modifiers={[size(52, 52)]}>
        <Box modifiers={[alpha(on ? 1 : 0.3)]}>
          <AppIcon app={app} />
        </Box>
        {on && (
          <Box
            contentAlignment="center"
            modifiers={[align('topEnd'), offset(7, -7), size(22, 22), clip(Shapes.Circle), background(color.bg)]}>
            <Box contentAlignment="center" modifiers={[size(18, 18), clip(Shapes.Circle), background(color.text)]}>
              <Icon source={Check} size={13} tint={color.bg} contentDescription="On" />
            </Box>
          </Box>
        )}
      </Box>
      <Label
        size={12}
        weight="medium"
        tone={on ? 'text' : 'muted'}
        maxLines={1}
        overflow="ellipsis"
        modifiers={[padding(4, 6, 4, 0)]}>
        {sourceLabel(app.package) === app.package ? app.label : sourceLabel(app.package)}
      </Label>
    </Column>
  );
}

function AppPicker({ apps, onPick, onClose }: { apps: InstalledApp[]; onPick: (pkg: string) => void; onClose: () => void }) {
  return (
    <ModalBottomSheet onDismissRequest={onClose} containerColor={color.surface} skipPartiallyExpanded>
      <Column modifiers={[fillMaxWidth(), verticalScroll(), padding(0, 4, 0, 32)]}>
        <Label size={22} weight="bold" modifiers={[padding(space.page, 0, space.page, 12)]}>
          Add an app
        </Label>
        {apps.map((app) => (
          <Row
            key={app.package}
            verticalAlignment="center"
            horizontalArrangement={{ spacedBy: 14 }}
            modifiers={[fillMaxWidth(), clickable(() => onPick(app.package)), padding(space.page, 10, space.page, 10)]}>
            <AppIcon app={app} dim={36} />
            <Column modifiers={[weight(1)]}>
              <Label weight="medium" maxLines={1} overflow="ellipsis">
                {app.label}
              </Label>
              <Label size={12} tone="muted" maxLines={1} overflow="ellipsis">
                {app.package}
              </Label>
            </Column>
          </Row>
        ))}
      </Column>
    </ModalBottomSheet>
  );
}

function SelfNames({ initial }: { initial: string[] }) {
  const field = useNativeState(initial.join('\n'));
  const [value, setValue] = useState(initial.join('\n'));
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const dirty = value.trim() !== initial.join('\n');

  const save = async () => {
    setStatus('saving');
    try {
      const names = value
        .split('\n')
        .map((n) => n.trim())
        .filter(Boolean)
        .join('\n');
      await BalanceCore.setSetting(SETTINGS.selfNames, names);
      setStatus('saved');
    } catch {
      setStatus('failed');
    }
  };

  return (
    <Column modifiers={[fillMaxWidth(), padding(space.page, 0, space.page, 0)]} verticalArrangement={{ spacedBy: 8 }}>
      <OutlinedTextField
        value={field}
        onValueChange={(v) => {
          setValue(v);
          setStatus('idle');
        }}
        minLines={1}
        colors={fieldColors}
        textStyle={fieldText}
        keyboardOptions={{ capitalization: 'characters', autoCorrectEnabled: false }}
        modifiers={[fillMaxWidth()]}>
        <OutlinedTextField.Placeholder>
          <Label tone="muted">As your bank prints it</Label>
        </OutlinedTextField.Placeholder>
      </OutlinedTextField>
      <Row verticalAlignment="center" modifiers={[fillMaxWidth()]}>
        <Label size={13} tone={status === 'failed' ? 'danger' : 'muted'} modifiers={[weight(1)]}>
          {status === 'failed' ? "Couldn't save." : status === 'saved' ? 'Saved' : 'Money sent here counts as a transfer'}
        </Label>
        {dirty && status !== 'saved' && (
          <TextButton onClick={save} enabled={status !== 'saving'}>
            <Label weight="medium">Save</Label>
          </TextButton>
        )}
      </Row>
    </Column>
  );
}

function LinkRow({ label, value, onPress }: { label: string; value?: string; onPress: () => void }) {
  return (
    <Row verticalAlignment="center" modifiers={[fillMaxWidth(), clickable(onPress), padding(space.page, 18, space.page, 18)]}>
      <Label weight="medium" modifiers={[weight(1)]}>
        {label}
      </Label>
      {value && (
        <Label weight="medium" tone="muted">
          {value}
        </Label>
      )}
    </Row>
  );
}

function Reprocess() {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'failed'>('idle');
  const run = async () => {
    if (status === 'running') return;
    setStatus('running');
    try {
      await BalanceCore.reprocessAll();
      setStatus('done');
    } catch {
      setStatus('failed');
    }
  };
  const value = { idle: undefined, running: 'Reading…', done: 'Done', failed: 'Failed' }[status];
  return <LinkRow label="Re-read everything" value={value} onPress={run} />;
}

function syncLabel(state: ReturnType<typeof useSyncStatus>): string {
  if (state.state === 'syncing') return 'Backing up…';
  if (state.state === 'failed') return 'Backup failed · tap to retry';
  if (state.at == null) return 'Not backed up yet';
  const minutes = Math.floor((Date.now() - state.at) / 60_000);
  return minutes < 1 ? 'Backed up just now' : `Backed up ${minutes}m ago`;
}

function Account() {
  const user = useUser();
  const sync = useSyncStatus();
  const profile = useProfile(user.id);
  const [editing, setEditing] = useState(false);
  const email = user.email ?? '';
  const username = profile?.profile.username;
  return (
    <>
      <Row
        verticalAlignment="center"
        horizontalArrangement={{ spacedBy: 14 }}
        modifiers={[fillMaxWidth(), clickable(() => setEditing(true)), padding(space.page, 6, space.page, 6)]}>
        <Avatar uri={profile?.avatarUri ?? null} letter={(username ?? email).slice(0, 1)} dim={56} />
        <Column modifiers={[weight(1)]}>
          <Label size={17} weight="medium" maxLines={1} overflow="ellipsis">
            {username ? `@${username}` : email}
          </Label>
          <Label
            size={13}
            tone={sync.state === 'failed' ? 'danger' : 'muted'}
            modifiers={sync.state === 'failed' ? [clickable(() => void syncNow(user.id))] : []}>
            {syncLabel(sync)}
          </Label>
        </Column>
        <Label size={14} weight="medium" tone="muted">
          Edit
        </Label>
      </Row>
      {editing && <ProfileSheet email={email} onClose={() => setEditing(false)} />}
    </>
  );
}

function Avatar({ uri, letter, dim }: { uri: string | null; letter: string; dim: number }) {
  if (uri) {
    return <Image source={{ uri }} contentScale="crop" contentDescription="Profile photo" modifiers={[size(dim, dim), clip(Shapes.Circle)]} />;
  }
  return (
    <Box contentAlignment="center" modifiers={[size(dim, dim), clip(Shapes.Circle), background(color.raised)]}>
      <Label size={Math.round(dim * 0.4)} weight="bold">
        {letter.toUpperCase()}
      </Label>
    </Box>
  );
}

function ProfileSheet({ email, onClose }: { email: string; onClose: () => void }) {
  const user = useUser();
  const profile = useProfile(user.id);
  const initial = profile?.profile.username ?? '';
  const field = useNativeState(initial);
  const [username, setUsername] = useState(initial);
  const [busy, setBusy] = useState<'photo' | 'name' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasPhoto = !!profile?.avatarUri;

  const run = async (kind: 'photo' | 'name', task: () => Promise<string | null>) => {
    setBusy(kind);
    setError(null);
    const message = await task().catch(() => "Couldn't save.");
    setBusy(null);
    setError(message);
    return message;
  };

  const saveName = async () => {
    if ((await run('name', () => saveUsername(user.id, username))) === null) onClose();
  };

  return (
    <ModalBottomSheet onDismissRequest={onClose} containerColor={color.surface} skipPartiallyExpanded>
      <Column modifiers={[fillMaxWidth(), padding(space.page, 4, space.page, 32)]} verticalArrangement={{ spacedBy: 20 }}>
        <Label size={22} weight="bold">
          Profile
        </Label>

        <Row verticalAlignment="center" horizontalArrangement={{ spacedBy: 16 }}>
          <Avatar uri={profile?.avatarUri ?? null} letter={(username || email).slice(0, 1)} dim={80} />
          <Column>
            <TextButton onClick={() => void run('photo', () => changeAvatar(user.id))} enabled={busy === null}>
              <Label weight="medium">{busy === 'photo' ? 'Uploading…' : hasPhoto ? 'Change photo' : 'Add photo'}</Label>
            </TextButton>
            {hasPhoto && (
              <TextButton onClick={() => void run('photo', () => removeAvatar(user.id))} enabled={busy === null}>
                <Label weight="medium" tone="muted">
                  Remove
                </Label>
              </TextButton>
            )}
          </Column>
        </Row>

        <OutlinedTextField
          value={field}
          onValueChange={(v) => {
            setUsername(v);
            setError(null);
          }}
          singleLine
          colors={fieldColors}
          textStyle={fieldText}
          keyboardOptions={{ capitalization: 'none', autoCorrectEnabled: false, imeAction: 'done' }}
          keyboardActions={{ onDone: () => void saveName() }}
          modifiers={[fillMaxWidth()]}>
          <OutlinedTextField.Label>
            <Label size={14} tone="muted">
              Username
            </Label>
          </OutlinedTextField.Label>
          <OutlinedTextField.SupportingText>
            <Label size={13} tone={error ? 'danger' : 'muted'}>
              {error ?? email}
            </Label>
          </OutlinedTextField.SupportingText>
        </OutlinedTextField>

        <Button
          onClick={saveName}
          enabled={busy === null && username.trim().toLowerCase() !== initial}
          modifiers={[fillMaxWidth(), height(52)]}>
          <Label weight="bold" color={color.bg}>
            {busy === 'name' ? 'Saving…' : 'Save'}
          </Label>
        </Button>
      </Column>
    </ModalBottomSheet>
  );
}

function SignOut() {
  const [status, setStatus] = useState<'idle' | 'running' | 'failed'>('idle');
  const user = useUser();
  const run = async () => {
    if (status === 'running') return;
    setStatus('running');
    // Last push first, so nothing logged since the last sync is missing from the cloud.
    await syncNow(user.id);
    // Local scope: other phones on this account stay signed in.
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) setStatus('failed');
  };
  const value = { idle: undefined, running: 'Signing out…', failed: 'Failed' }[status];
  return <LinkRow label="Sign out" value={value} onPress={run} />;
}
