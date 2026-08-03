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
  admin_level  integer not null default 0,   -- 0 — игрок, 1 — администратор, 2 — создатель
  avatar       text,
  skin         text,
  cape         text,
  banner       text,
  description  text not null default '',
  privacy      jsonb not null default '{"showStats":true,"showTime":true,"showPrivilege":true,"showDescription":true,"showBanner":true}',
  two_fa       boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Для уже существующей таблицы profiles добавляем колонку уровня админа (безопасно повторять)
alter table public.profiles add column if not exists admin_level integer not null default 0;

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

-- ---------- Уведомления (колокольчик в шапке) ----------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,              -- владелец уведомления (auth.users.id)
  type       text not null,              -- comment, like, appeal, spend, withdraw
  title      text not null,
  body       text,
  url        text,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

-- ---------- Комментарии на профилях ----------
create table if not exists public.profile_comments (
  id          uuid primary key default gen_random_uuid(),
  profile_name text not null,            -- ник владельца профиля, на котором оставлен комментарий
  author_name text not null,             -- ник автора комментария
  author_id   uuid,                      -- id автора (auth.users.id), может быть null у старых
  text        text not null,
  edited      boolean not null default false,
  votes       jsonb not null default '{}', -- { "Ник": 1 | -1 }
  created_at  timestamptz not null default now()
);
create index if not exists pc_profile_idx on public.profile_comments (profile_name, created_at desc);

-- ---------- Обращения (тикеты) ----------
create table if not exists public.tickets (
  id         uuid primary key default gen_random_uuid(),
  owner_name text not null,
  owner_id   uuid,
  subject    text not null,
  status     text not null default 'open', -- open / closed
  messages   jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tickets_owner_idx on public.tickets (owner_id, created_at desc);

-- ---------- Сервера проекта ----------
create table if not exists public.servers (
  id          bigint generated always as identity primary key,
  name        text not null,
  description text,
  version     text not null default '1.12.2',
  online      integer not null default 0,
  max_online  integer not null default 100,
  mods        jsonb not null default '[]', -- массив названий модов
  sort        integer not null default 0
);

-- ---------- Банлист ----------
create table if not exists public.bans (
  id         bigint generated always as identity primary key,
  nick       text not null,
  reason     text,
  banned_by  text,
  banned_at  timestamptz not null default now(),
  expires_at timestamptz,
  active     boolean not null default true
);

-- ---------- Товары магазина ----------
create table if not exists public.products (
  id          bigint generated always as identity primary key,
  category    text not null,              -- priv / items
  name        text not null,
  rub         numeric not null default 0,
  coins       numeric not null default 0,
  description text,
  features    jsonb not null default '[]', -- список возможностей привилегии
  sort        integer not null default 0
);

-- ---------- Команда проекта ----------
create table if not exists public.team (
  id     bigint generated always as identity primary key,
  name   text not null,
  roles  jsonb not null default '[]',    -- массив ролей
  sort   integer not null default 0
);

-- ---------- Префиксы ----------
create table if not exists public.prefixes (
  id        bigint generated always as identity primary key,
  name      text not null,
  color     text,                        -- hex-цвет (красит ник владельца)
  public    boolean not null default true,
  sort      integer not null default 0
);

-- ---------- Доступ ----------
-- anon (публичный ключ с сайта) может читать логи и профили,
-- писать логи (для мода) и создавать профили.
alter table public.profiles enable row level security;
alter table public.logs    enable row level security;
alter table public.notifications enable row level security;
alter table public.profile_comments enable row level security;
alter table public.tickets enable row level security;
alter table public.servers enable row level security;
alter table public.bans enable row level security;
alter table public.products enable row level security;
alter table public.team enable row level security;
alter table public.prefixes enable row level security;

-- Скрипт можно запускать повторно: политики перед созданием удаляются.
drop policy if exists "profiles_select" on public.profiles;
drop policy if exists "profiles_insert" on public.profiles;
drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_select" on public.profiles
  for select using (true);
create policy "profiles_insert" on public.profiles
  for insert with check (true);
create policy "profiles_update" on public.profiles
  for update using (true);

drop policy if exists "logs_select" on public.logs;
drop policy if exists "logs_insert" on public.logs;
drop policy if exists "logs_delete" on public.logs;
create policy "logs_select" on public.logs
  for select using (true);
create policy "logs_insert" on public.logs
  for insert with check (true);
create policy "logs_delete" on public.logs
  for delete using (true);

-- Уведомления: видит и меняет только владелец,
-- создавать может любой авторизованный (например комментарий на чужом профиле)
drop policy if exists "notif_select" on public.notifications;
drop policy if exists "notif_insert" on public.notifications;
drop policy if exists "notif_update" on public.notifications;
drop policy if exists "notif_delete" on public.notifications;
create policy "notif_select" on public.notifications
  for select using (auth.uid() = user_id);
create policy "notif_insert" on public.notifications
  for insert with check (auth.uid() is not null);
create policy "notif_update" on public.notifications
  for update using (auth.uid() = user_id);
create policy "notif_delete" on public.notifications
  for delete using (auth.uid() = user_id);

-- Комментарии: читают все, пишут авторизованные, редактирует/удаляет автор
-- или владелец профиля (тот, чей ник в profile_name и кто авторизован)
drop policy if exists "pc_select" on public.profile_comments;
drop policy if exists "pc_insert" on public.profile_comments;
drop policy if exists "pc_update" on public.profile_comments;
drop policy if exists "pc_delete" on public.profile_comments;
create policy "pc_select" on public.profile_comments
  for select using (true);
create policy "pc_insert" on public.profile_comments
  for insert with check (auth.uid() is not null);
create policy "pc_update" on public.profile_comments
  for update using (auth.uid() = author_id);
create policy "pc_delete" on public.profile_comments
  for delete using (
    auth.uid() = author_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.name = profile_name)
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.name = author_name)
  );

-- Тикеты: видит и меняет только владелец
drop policy if exists "tickets_select" on public.tickets;
drop policy if exists "tickets_insert" on public.tickets;
drop policy if exists "tickets_update" on public.tickets;
drop policy if exists "tickets_delete" on public.tickets;
create policy "tickets_select" on public.tickets
  for select using (auth.uid() = owner_id);
create policy "tickets_insert" on public.tickets
  for insert with check (auth.uid() = owner_id);
create policy "tickets_update" on public.tickets
  for update using (auth.uid() = owner_id);
create policy "tickets_delete" on public.tickets
  for delete using (auth.uid() = owner_id);

-- Публичные данные (сервера, баны, товары, команда, префиксы): все читают, пишет админ/сервис
drop policy if exists "servers_select"  on public.servers;
drop policy if exists "bans_select"     on public.bans;
drop policy if exists "products_select" on public.products;
drop policy if exists "team_select"     on public.team;
drop policy if exists "prefixes_select" on public.prefixes;
create policy "servers_select"  on public.servers  for select using (true);
create policy "bans_select"     on public.bans     for select using (true);
create policy "products_select" on public.products for select using (true);
create policy "team_select"     on public.team     for select using (true);
create policy "prefixes_select" on public.prefixes for select using (true);
