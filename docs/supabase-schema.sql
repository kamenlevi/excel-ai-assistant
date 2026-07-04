-- Excel AI Assistant — cross-device chat sync schema
-- Run this ONCE in your Supabase project: Dashboard → SQL Editor → New query → paste → Run.
-- It creates the `chats` table and Row-Level Security so each signed-in user
-- can only read/write their OWN chats.

create table if not exists public.chats (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title        text default 'New Chat',
  messages     jsonb not null default '[]'::jsonb,
  summary      text,
  total_tokens integer default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Fast list-by-user, newest first
create index if not exists chats_user_updated_idx
  on public.chats (user_id, updated_at desc);

-- Lock the table down: no access unless a policy allows it
alter table public.chats enable row level security;

-- Each user may only touch rows where user_id = their auth id
drop policy if exists "chats_select_own" on public.chats;
create policy "chats_select_own" on public.chats
  for select using (auth.uid() = user_id);

drop policy if exists "chats_insert_own" on public.chats;
create policy "chats_insert_own" on public.chats
  for insert with check (auth.uid() = user_id);

drop policy if exists "chats_update_own" on public.chats;
create policy "chats_update_own" on public.chats
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "chats_delete_own" on public.chats;
create policy "chats_delete_own" on public.chats
  for delete using (auth.uid() = user_id);
