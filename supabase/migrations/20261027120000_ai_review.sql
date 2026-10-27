-- AI review of notifications no rule understood (cloud accounts only). Additive: no existing
-- table changes.

-- The user's own corrections, sent back to the model as few-shot examples. `text` is the
-- notification after the phone stripped account numbers, emails and long digit runs.
create table public.ai_examples (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 600),
  kind text not null check (kind in ('income', 'expense', 'transfer', 'ad_or_other')),
  direction text not null check (direction in ('in', 'out')),
  amount bigint not null check (amount >= 0),
  counterparty text check (char_length(counterparty) <= 120),
  created_at timestamptz not null default now()
);

create index ai_examples_user_created on public.ai_examples (user_id, created_at desc);

-- One row per classify-notification call, for the per-user rate limit. Users can read and add
-- their own rows but never edit or delete them, so the limit can't be reset from the app.
create table public.ai_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  items smallint not null check (items between 1 and 20),
  created_at timestamptz not null default now()
);

create index ai_requests_user_created on public.ai_requests (user_id, created_at desc);

alter table public.ai_examples enable row level security;
alter table public.ai_requests enable row level security;

create policy "Own examples read" on public.ai_examples for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Own examples insert" on public.ai_examples for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Own examples delete" on public.ai_examples for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "Own requests read" on public.ai_requests for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Own requests insert" on public.ai_requests for insert to authenticated
  with check ((select auth.uid()) = user_id);

revoke all on public.ai_examples, public.ai_requests from anon;
revoke all on public.ai_examples, public.ai_requests from authenticated;
grant select, insert, delete on public.ai_examples to authenticated;
grant select, insert on public.ai_requests to authenticated;
