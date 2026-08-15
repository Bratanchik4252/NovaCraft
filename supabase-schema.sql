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
  prefixes     jsonb not null default '[]', -- префиксы, выданные админом игроку (массив названий)
  active_prefix text not null default '',   -- какой префикс сейчас надет (из списка prefixes)
  two_fa       boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Для уже существующей таблицы profiles добавляем колонку уровня админа (безопасно повторять)
alter table public.profiles add column if not exists admin_level integer not null default 0;
alter table public.profiles add column if not exists prefixes jsonb not null default '[]';
alter table public.profiles add column if not exists active_prefix text not null default '';

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
-- Префикс — это «бейдж», который админ выдаёт игроку вручную (по нику или ID,
-- таблица profiles.prefixes). Создавать префиксы можно без владельца.
-- Цвет: префикс красит ник, если его приоритет выше цвета привилегии (приоритет > 0).
create table if not exists public.prefixes (
  id        bigint generated always as identity primary key,
  name      text not null,
  color     text,                        -- hex-цвет префикса
  priority  integer not null default 0,  -- чем больше, тем главнее (0 — ник не красит)
  sort      integer not null default 0
);

-- Миграция (безопасно повторять): приоритет у старых префиксов + переносим
-- старые выдачи (prefixes.owner) в profiles.prefixes, удаляем owner и public
-- («доступные/закрытые» теперь считаются персонально: выдан префикс или нет).
alter table public.prefixes add column if not exists priority integer not null default 0;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'prefixes' and column_name = 'owner'
  ) then
    update public.profiles p
    set prefixes = coalesce(p.prefixes, '[]'::jsonb) || sub.names
    from (
      select lower(owner) as nick, jsonb_agg(name) as names
      from public.prefixes
      where owner is not null and owner <> ''
      group by lower(owner)
    ) sub
    where lower(p.name) = sub.nick;

    alter table public.prefixes drop column owner;
  end if;
end $$;

alter table public.prefixes drop column if exists "public";

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

-- Выдать/снять префикс игроку (админка, «Префиксы» → «Выдать префикс игроку»).
-- Вызывать может только администратор/создатель (admin_level >= 2).
-- Работает через security definer, чтобы не менять RLS-политику profiles.
create or replace function public.grant_prefix(target_id uuid, prefix_name text, do_add boolean)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  cur jsonb;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and admin_level >= 2
  ) then
    return jsonb_build_object('ok', false, 'error', 'Нет прав');
  end if;

  select prefixes into cur from public.profiles where id = target_id;
  if cur is null then cur := '[]'::jsonb; end if;

  if do_add then
    if not exists (select 1 from jsonb_array_elements_text(cur) x where x = prefix_name) then
      cur := cur || jsonb_build_array(prefix_name);
    end if;
  else
    select coalesce(jsonb_agg(x), '[]'::jsonb) into cur
    from jsonb_array_elements_text(cur) x
    where x <> prefix_name;
  end if;

  update public.profiles set prefixes = cur where id = target_id;
  return jsonb_build_object('ok', true, 'prefixes', cur);
end;
$$;

grant execute on function public.grant_prefix(uuid, text, boolean) to authenticated;

-- Реферальная система: регистрация по ссылке ?ref=NICK.
-- У пригласившего появляется запись { nick, hours: 0 } в referrals.
-- (security definer — новый игрок не может менять чужую строку по RLS)
create or replace function public.add_referral(target_name text, new_nick text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  targ uuid;
  cur  jsonb;
begin
  select id, coalesce(referrals, '[]'::jsonb) into targ, cur
  from public.profiles
  where lower(name) = lower(target_name);

  if targ is null then
    return jsonb_build_object('ok', false, 'error', 'Реферер не найден');
  end if;

  if not exists (
    select 1 from jsonb_array_elements(cur) x
    where x->>'nick' = new_nick
  ) then
    cur := cur || jsonb_build_object('nick', new_nick, 'hours', 0);
    update public.profiles set referrals = cur where id = targ;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.add_referral(text, text) to authenticated;

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

-- ---------- Лайки профилей ----------
-- Один игрок — один лайк на профиль. Лайк ставится только авторизованным
-- (anon вставить не сможет), счётчик виден всем.
create table if not exists public.likes (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  liker_id   uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, liker_id)
);

alter table public.likes enable row level security;

drop policy if exists "likes_select" on public.likes;
drop policy if exists "likes_insert" on public.likes;
drop policy if exists "likes_delete" on public.likes;
create policy "likes_select" on public.likes
  for select using (true);
create policy "likes_insert" on public.likes
  for insert with check (auth.uid() = liker_id);
create policy "likes_delete" on public.likes
  for delete using (auth.uid() = liker_id);

-- ==========================================================================
-- Лаунчер NOVACRAFT
-- ==========================================================================

-- ---------- Настройки лаунчера (key/value) ----------
-- Здесь лежит адрес игрового сервера (server_host / server_port) и прочие
-- настройки, которые НЕ должны быть зашиты в клиент: лаунчер запрашивает
-- их из БД при запуске. Читают только авторизованные, пишет персонал.
create table if not exists public.launcher_meta (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

insert into public.launcher_meta (key, value) values
  ('server_host', ''),
  ('server_port', '25565')
on conflict (key) do nothing;

alter table public.launcher_meta enable row level security;

drop policy if exists "launcher_meta_select" on public.launcher_meta;
drop policy if exists "launcher_meta_insert" on public.launcher_meta;
drop policy if exists "launcher_meta_update" on public.launcher_meta;
create policy "launcher_meta_select" on public.launcher_meta
  for select using (auth.uid() is not null);
create policy "launcher_meta_insert" on public.launcher_meta
  for insert with check (is_staff());
create policy "launcher_meta_update" on public.launcher_meta
  for update using (is_staff());

-- ---------- Бан железа (HWID) ----------
-- Считается из железа ПК и сверяется лаунчером при старте и входе.
-- Читать может любой (проверка до логина), менять — только создатель (уровень 3).
create table if not exists public.hwid_bans (
  hwid      text primary key,
  reason    text,
  banned_at timestamptz not null default now()
);

alter table public.hwid_bans enable row level security;

drop policy if exists "hwid_bans_select" on public.hwid_bans;
drop policy if exists "hwid_bans_insert" on public.hwid_bans;
drop policy if exists "hwid_bans_delete" on public.hwid_bans;
create policy "hwid_bans_select" on public.hwid_bans
  for select using (true);
create policy "hwid_bans_insert" on public.hwid_bans
  for insert with check (is_creator());
create policy "hwid_bans_delete" on public.hwid_bans
  for delete using (is_creator());

-- ==========================================================================
-- Магазин привилегий + пополнение баланса (DonatePay)
-- ==========================================================================

-- ---------- Каталог привилегий магазина ----------
-- Старшинство (hierarchy): чем больше число, тем «топовее» привилегия.
-- Команды и киты нижестоящих привилегий АВТОМАТИЧЕСКИ переносятся
-- в вышестоящие (на сайте и в лаунчере считается сумма по иерархии),
-- поэтому у каждой привилегии хранятся ТОЛЬКО свои команды/киты.
create table if not exists public.privileges (
  id          bigint generated always as identity primary key,
  name        text not null,                -- название привилегии (VIP, Dragon, ...)
  server      text not null default '',     -- название сервера из таблицы servers
  hierarchy   integer not null default 0,   -- старшинство: чем больше, тем топовее
  price_rub   numeric not null default 0,   -- цена за 1 месяц, рубли
  color       text,                         -- hex-цвет карточки привилегии
  description text not null default '',
  commands    jsonb not null default '[]',  -- СВОИ команды (напр. /fly, /kit vip)
  kits        jsonb not null default '[]',  -- СВОИ киты
  sort        integer not null default 0,
  enabled     boolean not null default true -- 1 — продаётся, 0 — скрыта из магазина
);
create index if not exists privileges_server_idx on public.privileges (server, hierarchy, sort);

-- ---------- Ожидающие пополнения (связка DonatePay -> аккаунт) ----------
-- При пополнении сайт генерирует уникальный код (NC-XXXXXX), игрок пишет его
-- в сообщении доната. Вебхук DonatePay (api/donatepay-ipn.js, service_role)
-- находит платёж по коду через credit_donation() и начисляет баланс.
create table if not exists public.donations (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  code            text not null,                  -- уникальный код из сообщения доната
  amount_expected numeric not null default 0,
  status          text not null default 'pending',-- pending / paid / expired
  operation_id    text,                           -- id операции из вебхука (защита от дублей)
  donor_message   text,                           -- сообщение доната целиком
  paid_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists donations_user_idx on public.donations (user_id, created_at desc);
create unique index if not exists donations_code_idx on public.donations (lower(code));

-- ---------- Настройки сайта (key/value), читаются публично ----------
create table if not exists public.site_config (
  key   text primary key,
  value text not null default ''
);

insert into public.site_config (key, value) values
  ('donatepay_url', ''),    -- полная ссылка на страницу донатов, напр. https://donatepay.eu/don/49274
  ('donatepay_nick', ''),   -- устарело (оставлено для совместимости), используется donatepay_url
  ('demo_payments', '1')    -- 1 — кнопка «Тестовый платёж» доступна, 0 — выключена
on conflict (key) do nothing;

-- ==========================================================================
-- RPC: покупка привилегии
-- security definer — игрок не может сам себе начислить баланс через
-- profiles.update: списание и выдача происходят только здесь.
-- ==========================================================================
create or replace function public.purchase_privilege(p_id bigint, months integer)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me     uuid := auth.uid();
  priv   public.privileges%rowtype;
  rub    numeric;
  price  numeric;
  cur_privs jsonb;
  cur_trans jsonb;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'error', 'Войди в аккаунт');
  end if;
  if months not in (1, 3, 6, 12) then
    return jsonb_build_object('ok', false, 'error', 'Неверный срок');
  end if;

  select * into priv from public.privileges where id = p_id;
  if priv is null then
    return jsonb_build_object('ok', false, 'error', 'Привилегия не найдена');
  end if;
  if not priv.enabled then
    return jsonb_build_object('ok', false, 'error', 'Привилегия недоступна');
  end if;

  price := coalesce(priv.price_rub, 0) * months;
  select balance_rub into rub from public.profiles where id = me;
  if rub is null then rub := 0; end if;
  if rub < price then
    return jsonb_build_object('ok', false, 'error', 'Недостаточно средств');
  end if;

  select coalesce(privileges, '[]'::jsonb) into cur_privs from public.profiles where id = me;
  select coalesce(transactions, '[]'::jsonb) into cur_trans from public.profiles where id = me;

  cur_privs := cur_privs || jsonb_build_object(
    'name', priv.name,
    'server', priv.server,
    'purchaseDate', to_char(now(), 'DD.MM.YYYY'),
    'expiresAt', (extract(epoch from (now() + make_interval(months => months))) * 1000)::bigint
  );

  cur_trans := jsonb_build_array(jsonb_build_object(
    'type', 'out',
    'title', 'Покупка: ' || priv.name,
    'server', priv.server,
    'amount', price,
    'unit', 'rub',
    'date', to_char(now(), 'DD.MM.YYYY')
  )) || cur_trans;

  update public.profiles
     set balance_rub = rub - price,
         privileges = cur_privs,
         transactions = cur_trans
   where id = me;

  insert into public.notifications (user_id, type, title, body, url)
  values (me, 'spend', 'Покупка привилегии',
          'Привилегия «' || priv.name || '» на сервере «' || priv.server || '» на ' || months || ' мес.',
          'shop.html');

  return jsonb_build_object('ok', true, 'balance', rub - price);
end;
$$;
grant execute on function public.purchase_privilege(bigint, integer) to authenticated;

-- ==========================================================================
-- RPC: начисление баланса по донату (вызывает ТОЛЬКО вебхук с service_role)
-- Идемпотентно: одна operation_id начисляется один раз.
-- ==========================================================================
create or replace function public.credit_donation(p_code text, p_amount numeric, p_operation_id text, p_message text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  d record;
  rub numeric;
  cur_trans jsonb;
begin
  select * into d from public.donations
   where lower(code) = lower(coalesce(p_code, ''))
     and status = 'pending'
   order by id desc
   limit 1;
  if d is null then
    return jsonb_build_object('ok', false, 'error', 'Платёж не найден');
  end if;

  if p_operation_id is not null and exists (
    select 1 from public.donations
     where operation_id = p_operation_id and status = 'paid'
  ) then
    return jsonb_build_object('ok', false, 'error', 'Уже начислено');
  end if;

  select balance_rub into rub from public.profiles where id = d.user_id;
  if rub is null then rub := 0; end if;
  select coalesce(transactions, '[]'::jsonb) into cur_trans from public.profiles where id = d.user_id;

  update public.profiles
     set balance_rub = rub + p_amount,
         transactions = jsonb_build_array(jsonb_build_object(
           'type', 'in',
           'title', 'Пополнение баланса (DonatePay)',
           'server', '—',
           'amount', p_amount,
           'unit', 'rub',
           'date', to_char(now(), 'DD.MM.YYYY')
         )) || cur_trans
   where id = d.user_id;

  update public.donations
     set status = 'paid',
         operation_id = p_operation_id,
         donor_message = p_message,
         paid_at = now()
   where id = d.id;

  insert into public.notifications (user_id, type, title, body, url)
  values (d.user_id, 'topup', 'Баланс пополнен',
          'Начислено ' || p_amount || ' ₽ через DonatePay.', 'topup.html');

  return jsonb_build_object('ok', true, 'balance', rub + p_amount);
end;
$$;
grant execute on function public.credit_donation(text, numeric, text, text) to service_role;

-- ==========================================================================
-- RPC: тестовый платёж (кнопка «Тестовый платёж» на topup.html).
-- Включён, пока site_config.demo_payments = '1'. Перед релизом выключить:
--   update public.site_config set value = '0' where key = 'demo_payments';
-- ==========================================================================
create or replace function public.demo_credit(p_amount numeric)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me   uuid := auth.uid();
  rub  numeric;
  flag text;
  cur_trans jsonb;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'error', 'Войди в аккаунт');
  end if;

  select value into flag from public.site_config where key = 'demo_payments';
  if coalesce(flag, '0') <> '1' then
    return jsonb_build_object('ok', false, 'error', 'Тестовые платежи выключены');
  end if;

  if p_amount is null or p_amount <= 0 or p_amount > 100000 then
    return jsonb_build_object('ok', false, 'error', 'Некорректная сумма');
  end if;

  select balance_rub into rub from public.profiles where id = me;
  if rub is null then rub := 0; end if;
  select coalesce(transactions, '[]'::jsonb) into cur_trans from public.profiles where id = me;

  update public.profiles
     set balance_rub = rub + p_amount,
         transactions = jsonb_build_array(jsonb_build_object(
           'type', 'in',
           'title', 'Тестовое пополнение',
           'server', '—',
           'amount', p_amount,
           'unit', 'rub',
           'date', to_char(now(), 'DD.MM.YYYY')
         )) || cur_trans
   where id = me;

  return jsonb_build_object('ok', true, 'balance', rub + p_amount);
end;
$$;
grant execute on function public.demo_credit(numeric) to authenticated;

-- ==========================================================================
-- RPC: ручная корректировка баланса игрока (админка, уровень 3+).
-- Деньги (начисление/списание, выплаты) — только для создателя.
-- delta может быть отрицательной (списание/возврат).
-- ==========================================================================
create or replace function public.admin_set_balance(target_name text, delta numeric)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  targ uuid;
  rub  numeric;
  cur_trans jsonb;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and admin_level >= 3
  ) then
    return jsonb_build_object('ok', false, 'error', 'Нет прав');
  end if;

  select id into targ from public.profiles where lower(name) = lower(target_name);
  if targ is null then
    return jsonb_build_object('ok', false, 'error', 'Игрок не найден');
  end if;

  select balance_rub into rub from public.profiles where id = targ;
  if rub is null then rub := 0; end if;
  rub := greatest(0, rub + delta);
  select coalesce(transactions, '[]'::jsonb) into cur_trans from public.profiles where id = targ;

  update public.profiles
     set balance_rub = rub,
         transactions = jsonb_build_array(jsonb_build_object(
           'type', case when delta >= 0 then 'in' else 'out' end,
           'title', 'Ручная корректировка (админ)',
           'server', '—',
           'amount', abs(delta),
           'unit', 'rub',
           'date', to_char(now(), 'DD.MM.YYYY')
         )) || cur_trans
   where id = targ;

  return jsonb_build_object('ok', true, 'balance', rub);
end;
$$;
grant execute on function public.admin_set_balance(text, numeric) to authenticated;

-- ==========================================================================
-- RLS для магазина
-- ==========================================================================
alter table public.privileges enable row level security;
alter table public.donations   enable row level security;
alter table public.site_config enable row level security;

drop policy if exists "privileges_select" on public.privileges;
create policy "privileges_select" on public.privileges
  for select using (true);
drop policy if exists "privileges_admin_insert" on public.privileges;
drop policy if exists "privileges_admin_update" on public.privileges;
drop policy if exists "privileges_admin_delete" on public.privileges;
create policy "privileges_admin_insert" on public.privileges
  for insert with check (is_staff());
create policy "privileges_admin_update" on public.privileges
  for update using (is_staff());
create policy "privileges_admin_delete" on public.privileges
  for delete using (is_staff());

drop policy if exists "donations_select" on public.donations;
drop policy if exists "donations_insert" on public.donations;
create policy "donations_select" on public.donations
  for select using (auth.uid() = user_id);
create policy "donations_insert" on public.donations
  for insert with check (auth.uid() = user_id);

drop policy if exists "site_config_select" on public.site_config;
drop policy if exists "site_config_admin_insert" on public.site_config;
drop policy if exists "site_config_admin_update" on public.site_config;
create policy "site_config_select" on public.site_config
  for select using (true);
create policy "site_config_admin_insert" on public.site_config
  for insert with check (is_staff());
create policy "site_config_admin_update" on public.site_config
  for update using (is_staff());
