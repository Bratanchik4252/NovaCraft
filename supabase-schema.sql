-- ==========================================================================
-- NOVACRAFT — схема Supabase
-- Как использовать:
--   1. supabase.com -> SQL Editor -> New query
--   2. Вставь содержимое этого файла целиком и нажми Run.
--   3. Затем в Project Settings -> API возьми Project URL и anon public key
--      и впиши их в js/supabase-config.js (enabled: true).
-- ==========================================================================

-- ---------- Профили пользователей (аналог mc:auth) ----------
create table if not exists public.profiles (
  id           uuid primary key default gen_random_uuid(),
  name         text unique not null,
  email        text unique,
  pass_hash    text,                    -- пока оставим (localStorage-режим)
  balance      jsonb not null default '[{"serverName":"Мирный","balance":0}]',
  balance_rub  numeric not null default 0,
  stats        jsonb not null default '{"blocks":0,"mobs":0,"timeHours":0,"timeMinutes":0}',
  privileges   jsonb not null default '[]',
  transactions jsonb not null default '[]',
  providers    jsonb not null default '["email"]',
  referrals    jsonb not null default '[]',
  ref_by       text,
  avatar       text,
  skin         text,
  cape         text,
  banner       text,
  description  text not null default '',
  privacy      jsonb not null default '{"showStats":true,"showTime":true,"showPrivilege":true,"showDescription":true,"showBanner":true}',
  two_fa       boolean not null default false,
  created_at   timestamptz not null default now()
);

-- ---------- Логи с игрового сервера (мод будет писать сюда) ----------
create table if not exists public.logs (
  id          bigint generated always as identity primary key,
  type        text not null,            -- block_break, chat, purchase, login, ...
  nick        text,
  world       text,
  x           double precision,
  y           double precision,
  z           double precision,
  payload     jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists logs_type_idx  on public.logs (type);
create index if not exists logs_nick_idx  on public.logs (nick);
create index if not exists logs_created_idx on public.logs (created_at desc);

-- ---------- Доступ ----------
-- anon (публичный ключ с сайта) может читать логи и профили,
-- писать логи (для мода) и создавать профили.
alter table public.profiles enable row level security;
alter table public.logs    enable row level security;

create policy "profiles_select" on public.profiles
  for select using (true);
create policy "profiles_insert" on public.profiles
  for insert with check (true);
create policy "profiles_update" on public.profiles
  for update using (true);

create policy "logs_select" on public.logs
  for select using (true);
create policy "logs_insert" on public.logs
  for insert with check (true);
create policy "logs_delete" on public.logs
  for delete using (true);
