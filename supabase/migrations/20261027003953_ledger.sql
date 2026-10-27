-- Cloud copy of each user's ledger. The phone's balance.db stays the source of truth;
-- these tables are what it syncs to. Raw notification text is never uploaded.

create table public.categories (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  name text not null,
  keywords text not null default '',
  position integer not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

-- id is the phone's raw notification uid, so re-parsing on the phone keeps the same row.
create table public.transactions (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null,
  direction text not null check (direction in ('in', 'out')),
  amount bigint not null,
  counterparty text,
  bank_category text,
  category_id text,
  category_locked boolean not null default false,
  is_transfer boolean not null default false,
  transfer_locked boolean not null default false,
  -- No FK: pairs point at each other, and rows are pushed in batches.
  pair_id uuid,
  occurred_at timestamptz not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (user_id, category_id) references public.categories (user_id, id) on delete set null (category_id)
);

-- Only settings that follow the user across phones. Watched apps are per device.
create table public.user_settings (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null check (key in ('self_names')),
  value text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

create index transactions_user_updated on public.transactions (user_id, updated_at);
create index transactions_user_occurred on public.transactions (user_id, occurred_at);
create index categories_user_updated on public.categories (user_id, updated_at);

-- Pulls ask for "rows changed since X", so the server owns updated_at.
create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger categories_touch before update on public.categories
  for each row execute function public.touch_updated_at();
create trigger transactions_touch before update on public.transactions
  for each row execute function public.touch_updated_at();
create trigger user_settings_touch before update on public.user_settings
  for each row execute function public.touch_updated_at();

alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.user_settings enable row level security;

create policy "Own categories" on public.categories for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Own transactions" on public.transactions for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Own settings" on public.user_settings for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on public.categories, public.transactions, public.user_settings from anon;
grant select, insert, update, delete on public.categories, public.transactions, public.user_settings to authenticated;

-- Play Store requires in-app account deletion. Cascades remove every row above.
create function public.delete_account() returns void
language sql security definer set search_path = '' as $$
  delete from auth.users where id = (select auth.uid());
$$;

revoke execute on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
