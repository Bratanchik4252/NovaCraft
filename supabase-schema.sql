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
  admin_level  integer not null default 0,   -- 0 — игрок, 1 — хелпер (только обращения), 2 — администратор (всё, кроме уровней), 3 — создатель
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
  peak_online integer not null default 0, -- пиковый онлайн (автоматически обновляет бэкенд/плагин)
  max_online  integer not null default 100,
  mods        jsonb not null default '[]', -- массив названий модов
  sort        integer not null default 0
);

-- Для уже существующей таблицы servers добавляем колонку пикового онлайна (безопасно повторять)
alter table public.servers add column if not exists peak_online integer not null default 0;

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
  owner     text,                        -- ник игрока, которому выдан префикс (необязательно)
  public    boolean not null default true,
  sort      integer not null default 0
);

-- ---------- Правила (аккордеоны на rules.html) ----------
create table if not exists public.rules (
  id      bigint generated always as identity primary key,
  section text not null default 'project', -- project / servers
  title   text not null,
  text    text not null default '',
  sort    integer not null default 0
);

-- ---------- Доступ ----------
-- anon (публичный ключ с сайта) может читать логи и профили,
-- писать логи (для мода) и создавать профили.
-- Хелпер (admin_level >= 1) работает только с обращениями.
-- Администратор/создатель (admin_level >= 2) управляет контентом сайта.
-- Создатель (admin_level >= 3) — единственный, кто может менять уровни админов.
create or replace function public.is_admin()
returns boolean
language sql
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and admin_level >= 1
  );
$$;

create or replace function public.is_staff()
returns boolean
language sql
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and admin_level >= 2
  );
$$;

create or replace function public.is_creator()
returns boolean
language sql
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and admin_level >= 3
  );
$$;

alter table public.profiles enable row level security;
alter table public.logs    enable row level security;
alter table public.notifications enable row level security;
alter table public.profile_comments enable row level security;
alter table public.tickets enable row level security;
alter table public.servers enable row level security;
alter table public.bans enable row level security;
alter table public.team enable row level security;
alter table public.prefixes enable row level security;
alter table public.rules enable row level security;

-- Скрипт можно запускать повторно: политики перед созданием удаляются.
drop policy if exists "profiles_select" on public.profiles;
drop policy if exists "profiles_insert" on public.profiles;
drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_select" on public.profiles
  for select using (true);
create policy "profiles_insert" on public.profiles
  for insert with check (true);
-- Менять профиль может только его владелец или создатель проекта (уровень 3).
-- Так хелперы и администраторы не смогут выдавать себе админку.
create policy "profiles_update" on public.profiles
  for update using (auth.uid() = id or is_creator());

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

-- Тикеты: видит и меняет только владелец; администратор — все тикеты
drop policy if exists "tickets_select" on public.tickets;
drop policy if exists "tickets_insert" on public.tickets;
drop policy if exists "tickets_update" on public.tickets;
drop policy if exists "tickets_delete" on public.tickets;
create policy "tickets_select" on public.tickets
  for select using (auth.uid() = owner_id or is_admin());
create policy "tickets_insert" on public.tickets
  for insert with check (auth.uid() = owner_id);
create policy "tickets_update" on public.tickets
  for update using (auth.uid() = owner_id or is_admin());
create policy "tickets_delete" on public.tickets
  for delete using (auth.uid() = owner_id or is_admin());

-- Публичные данные (сервера, баны, команда, префиксы, правила): все читают,
-- пишет администратор/создатель (admin_level >= 2, функция is_staff).
-- Хелперы (уровень 1) контент не меняют — только обращения.
drop policy if exists "servers_select"  on public.servers;
drop policy if exists "bans_select"     on public.bans;
drop policy if exists "team_select"     on public.team;
drop policy if exists "prefixes_select" on public.prefixes;
drop policy if exists "rules_select"    on public.rules;
create policy "servers_select"  on public.servers  for select using (true);
create policy "bans_select"     on public.bans     for select using (true);
create policy "team_select"     on public.team     for select using (true);
create policy "prefixes_select" on public.prefixes for select using (true);
create policy "rules_select"    on public.rules    for select using (true);

drop policy if exists "servers_admin_insert"  on public.servers;
drop policy if exists "bans_admin_insert"     on public.bans;
drop policy if exists "team_admin_insert"     on public.team;
drop policy if exists "prefixes_admin_insert" on public.prefixes;
drop policy if exists "rules_admin_insert"    on public.rules;
create policy "servers_admin_insert"  on public.servers  for insert with check (is_staff());
create policy "bans_admin_insert"     on public.bans     for insert with check (is_staff());
create policy "team_admin_insert"     on public.team     for insert with check (is_staff());
create policy "prefixes_admin_insert" on public.prefixes for insert with check (is_staff());
create policy "rules_admin_insert"    on public.rules    for insert with check (is_staff());

drop policy if exists "servers_admin_update"  on public.servers;
drop policy if exists "bans_admin_update"     on public.bans;
drop policy if exists "team_admin_update"     on public.team;
drop policy if exists "prefixes_admin_update" on public.prefixes;
drop policy if exists "rules_admin_update"    on public.rules;
create policy "servers_admin_update"  on public.servers  for update using (is_staff());
create policy "bans_admin_update"     on public.bans     for update using (is_staff());
create policy "team_admin_update"     on public.team     for update using (is_staff());
create policy "prefixes_admin_update" on public.prefixes for update using (is_staff());
create policy "rules_admin_update"    on public.rules    for update using (is_staff());

drop policy if exists "servers_admin_delete"  on public.servers;
drop policy if exists "bans_admin_delete"     on public.bans;
drop policy if exists "team_admin_delete"     on public.team;
drop policy if exists "prefixes_admin_delete" on public.prefixes;
drop policy if exists "rules_admin_delete"    on public.rules;
create policy "servers_admin_delete"  on public.servers  for delete using (is_staff());
create policy "bans_admin_delete"     on public.bans     for delete using (is_staff());
create policy "team_admin_delete"     on public.team     for delete using (is_staff());
create policy "prefixes_admin_delete" on public.prefixes for delete using (is_staff());
create policy "rules_admin_delete"    on public.rules    for delete using (is_staff());
