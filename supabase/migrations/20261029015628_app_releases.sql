-- APK releases for the in-app updater. Additive: no existing table changes.
-- Rows are written by the publish-release edge function (service role) when a v* tag is built.

create table public.app_releases (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  apk_url text not null,
  release_notes text,
  created_at timestamptz not null default now()
);

alter table public.app_releases enable row level security;

-- Readable signed out too: local mode has no account but still wants updates.
create policy "Releases read" on public.app_releases for select to anon, authenticated
  using (true);
