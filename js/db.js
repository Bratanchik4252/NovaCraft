/* ==========================================================================
   db.js — слой данных сайта.
   Работает в двух режимах:
   1) Supabase подключён (SUPABASE_CONFIG.enabled === true):
      авторизация и профили хранятся в облаке.
   2) Supabase НЕ подключён (по умолчанию):
      всё падает обратно в localStorage — сайт работает как раньше.
   Так проект не ломается, пока ты не вставишь свои ключи.
   ========================================================================== */

'use strict';

(function () {
  const CONFIG = (window.SUPABASE_CONFIG) || { enabled: false, url: '', anonKey: '' };
  const enabled = CONFIG.enabled && CONFIG.url && CONFIG.anonKey;

  let client = null;
  if (enabled && window.supabase) {
    client = window.supabase.createClient(CONFIG.url, CONFIG.anonKey);
  }

  const LOCAL_AUTH_KEY = 'mc:auth';

  // ---------- helpers для localStorage (фолбэк и кэш) ----------
  function getLS(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }
  function setLS(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  // ---------- Профиль: маппинг user <-> строка БД ----------
  // В Supabase профиль хранится как строка таблицы profiles.
  function userToRow(user) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      balance: user.balance || [{ serverName: 'Мирный', balance: 0 }],
      balance_rub: Number(user.balanceRub) || 0,
      stats: user.stats || { blocks: 0, mobs: 0, timeHours: 0, timeMinutes: 0 },
      privileges: user.privileges || [],
      transactions: user.transactions || [],
      providers: user.providers || ['email'],
      referrals: user.referrals || [],
      ref_by: user.refBy || null,
      admin_level: Number(user.adminLevel) || 0,
      avatar: user.avatar || null,
      skin: user.skin || null,
      cape: user.cape || null,
      banner: user.banner || null,
      description: user.description || '',
      privacy: user.privacy || {},
      prefixes: Array.isArray(user.prefixes) ? user.prefixes : [],
      active_prefix: user.activePrefix || '',
      two_fa: !!user.twoFA,
    };
  }

  function rowToUser(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      email: row.email || '',
      passHash: row.pass_hash || null,
      balance: Array.isArray(row.balance) ? row.balance : [{ serverName: 'Мирный', balance: 0 }],
      balanceRub: Number(row.balance_rub) || 0,
      stats: row.stats || { blocks: 0, mobs: 0, timeHours: 0, timeMinutes: 0 },
      privileges: Array.isArray(row.privileges) ? row.privileges : [],
      transactions: Array.isArray(row.transactions) ? row.transactions : [],
      providers: Array.isArray(row.providers) ? row.providers : ['email'],
      referrals: Array.isArray(row.referrals) ? row.referrals : [],
      refBy: row.ref_by || null,
      adminLevel: Number(row.admin_level) || 0,
      prefixes: Array.isArray(row.prefixes) ? row.prefixes : [],
      activePrefix: row.active_prefix || '',
      avatar: row.avatar || null,
      skin: row.skin || null,
      cape: row.cape || null,
      banner: row.banner || null,
      description: row.description || '',
      privacy: row.privacy || {},
      twoFA: !!row.two_fa,
    };
  }

  // ---------- Сессия в localStorage (фолбэк) ----------
  function localAuth() {
    return getLS(LOCAL_AUTH_KEY, { users: [], session: null });
  }

  // ---------- Публичное API ----------
  window.DB = {
    /** true, если Supabase настроен и работает */
    get configured() {
      return !!(client && enabled);
    },

    get client() {
      return client;
    },

    // ---------------- АВТОРИЗАЦИЯ ----------------
    /**
     * Регистрация через Supabase.
     * name — ник, email — почта, password — пароль.
     * Возвращает { ok: true, user } или { ok: false, error }.
     */
    async signUp(name, email, password) {
      if (!this.configured) return { ok: false, error: 'Supabase не настроен' };

      // Проверяем, не занят ли ник в облаке
      const { data: nameTaken } = await client
        .from('profiles')
        .select('id')
        .ilike('name', name)
        .maybeSingle();
      if (nameTaken) return { ok: false, error: 'Этот никнейм уже занят' };

      const { data: emailTaken } = await client
        .from('profiles')
        .select('id')
        .ilike('email', email)
        .maybeSingle();
      if (emailTaken) return { ok: false, error: 'Этот email уже зарегистрирован' };

      const { data, error } = await client.auth.signUp({ email, password });
      if (error) return { ok: false, error: error.message };

      const userId = data.user ? data.user.id : null;
      if (!userId) {
        return { ok: false, error: 'Не удалось создать аккаунт' };
      }

      // Если «Confirm email» включён в Supabase — сессии не будет, вход не сработает.
      // В дашборде: Authentication → Sign In / Up → Confirm email = OFF.
      if (data.session == null) {
        return {
          ok: false,
          error: 'Аккаунт создан, но нужно подтвердить email. Включи настройку «Confirm email» = OFF в Supabase (Authentication → Sign In / Up).',
          needsConfirm: true,
        };
      }

      // Создаём профиль в таблице profiles
      const base = userToRow({
        id: userId,
        name,
        email,
        balance: [{ serverName: 'Мирный', balance: 0 }],
        balanceRub: 0,
        stats: { blocks: 0, mobs: 0, timeHours: 0, timeMinutes: 0 },
        privileges: [],
        transactions: [],
        providers: ['email'],
        referrals: [],
        refBy: null,
        avatar: null,
        skin: null,
        cape: null,
        banner: null,
        description: '',
        privacy: { showStats: true, showTime: true, showPrivilege: true, showDescription: true, showBanner: true },
        twoFA: false,
      });
      const { error: insErr } = await client.from('profiles').insert(base);
      if (insErr) {
        // профиль не создался, но auth-юзер есть — пробуем дописать мету
        return { ok: false, error: 'Ошибка создания профиля: ' + insErr.message };
      }

      // Реферальная система (облако): регистрация по ссылке ?ref=NICK.
      // Приглашённый получает VIP на 7 дней, у пригласившего — запись в referrals.
      let refNick = null;
      try { refNick = localStorage.getItem('mc:ref'); } catch (e) {}
      if (refNick && String(refNick).trim()) {
        refNick = String(refNick).trim().slice(0, 32);
        // Запись рефереру пишется через security definer RPC (RLS не даст
        // чужому игроку менять чужую строку profiles).
        try {
          await client.rpc('add_referral', { target_name: refNick, new_nick: name });
        } catch (e) {}
        // VIP на 7 дней приглашённому — своя строка, RLS пропускает.
        base.privileges = [{
          name: 'VIP',
          server: '—',
          purchaseDate: new Date().toLocaleDateString('ru-RU'),
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        }];
        base.ref_by = refNick;
        const { error: vipErr } = await client.from('profiles')
          .update({ privileges: base.privileges, ref_by: base.ref_by })
          .eq('id', userId);
        if (vipErr) {
          return { ok: false, error: 'Ошибка начисления VIP: ' + vipErr.message };
        }
        try { localStorage.removeItem('mc:ref'); } catch (e) {}
      }

      const user = rowToUser(base);
      this.saveLocalSession(user);
      return { ok: true, user };
    },

    /**
     * Шаг 1 регистрации: отправить 6-значный код на email.
     * Это НАСТОЯЩАЯ проверка почты — код физически уходит в ящик
     * (Supabase Auth, signInWithOtp). Лимиты Free-плана:
     * 360 кодов в час, повторная отправка — раз в 60 секунд.
     * NOTE: в auth.users создаётся пользователь без пароля; если игрок
     * бросил регистрацию, почта остаётся «занятой», но заново пройти
     * OTP-поток с той же почтой можно (профиля нет — блокировки нет).
     */
    async sendEmailCode(email) {
      if (!this.configured) return { ok: false, error: 'Supabase не настроен' };
      const { error } = await client.auth.signInWithOtp({ email });
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    },

    /**
     * Шаг 2: проверить код из письма. При успехе почта подтверждена,
     * и Supabase уже открыл сессию для этого пользователя (без пароля).
     */
    async verifyEmailCode(email, code) {
      if (!this.configured) return { ok: false, error: 'Supabase не настроен' };
      const { data, error } = await client.auth.verifyOtp({
        email,
        token: String(code).trim(),
        type: 'email',
      });
      if (error) return { ok: false, error: 'Неверный код. Проверь письмо.' };
      const session = data && data.session;
      if (!session || !session.user) return { ok: false, error: 'Не удалось подтвердить почту' };
      return { ok: true, userId: session.user.id, email: session.user.email || email };
    },

    /**
     * Шаг 3: задать пароль и создать профиль. Вызывается ТОЛЬКО после
     * успешной проверки кода (verifyEmailCode) — иначе аккаунт не создастся.
     */
    async finishRegistration(name, email, password) {
      if (!this.configured) return { ok: false, error: 'Supabase не настроен' };

      const { data: userData, error: userErr } = await client.auth.updateUser({ password });
      if (userErr) return { ok: false, error: userErr.message };
      const user = userData && userData.user;
      if (!user) return { ok: false, error: 'Не удалось создать аккаунт' };

      const base = userToRow({
        id: user.id,
        name,
        email: user.email || email,
        balance: [{ serverName: 'Мирный', balance: 0 }],
        balanceRub: 0,
        stats: { blocks: 0, mobs: 0, timeHours: 0, timeMinutes: 0 },
        privileges: [],
        transactions: [],
        providers: ['email'],
        referrals: [],
        refBy: null,
        avatar: null,
        skin: null,
        cape: null,
        banner: null,
        description: '',
        privacy: { showStats: true, showTime: true, showPrivilege: true, showDescription: true, showBanner: true },
        twoFA: false,
      });
      const { error: insErr } = await client.from('profiles').insert(base);
      if (insErr) return { ok: false, error: 'Ошибка создания профиля: ' + insErr.message };

      // Реферальная система (облако): регистрация по ссылке ?ref=NICK
      let refNick = null;
      try { refNick = localStorage.getItem('mc:ref'); } catch (e) {}
      if (refNick && String(refNick).trim()) {
        refNick = String(refNick).trim().slice(0, 32);
        try {
          await client.rpc('add_referral', { target_name: refNick, new_nick: name });
        } catch (e) {}
        base.privileges = [{
          name: 'VIP',
          server: '—',
          purchaseDate: new Date().toLocaleDateString('ru-RU'),
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        }];
        base.ref_by = refNick;
        const { error: vipErr } = await client.from('profiles')
          .update({ privileges: base.privileges, ref_by: base.ref_by })
          .eq('id', user.id);
        if (vipErr) {
          return { ok: false, error: 'Ошибка начисления VIP: ' + vipErr.message };
        }
        try { localStorage.removeItem('mc:ref'); } catch (e) {}
      }

      const rowUser = rowToUser(base);
      this.saveLocalSession(rowUser);
      return { ok: true, user: rowUser };
    },
    /**
     * Проверка: занят ли email в облаке.
     */
    async emailExists(email) {
      if (!this.configured) return null;
      const { data } = await client
        .from('profiles')
        .select('id')
        .eq('email', String(email).toLowerCase())
        .maybeSingle();
      return !!data;
    },

    /** Ник свободен в облаке? */
    async isNameFree(name) {
      if (!this.configured) return null;
      const { data } = await client
        .from('profiles')
        .select('id')
        .ilike('name', String(name))
        .maybeSingle();
      return !data;
    },

    /**
     * Вход. identifier — ник или email.
     */
    async signIn(identifier, password) {
      if (!this.configured) return { ok: false, error: 'Supabase не настроен' };

      const id = String(identifier).trim();
      const isEmail = /@/.test(id);

      let email = id.toLowerCase();
      if (!isEmail) {
        const { data: row } = await client
          .from('profiles')
          .select('*')
          .ilike('name', id)
          .maybeSingle();
        if (!row) return { ok: false, error: 'Неверный логин или пароль' };
        email = (row.email || '').toLowerCase();
      }

      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) return { ok: false, error: 'Неверный логин или пароль' };

      // Достаём профиль
      const { data: row } = await client
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .maybeSingle();

      const user = row ? rowToUser(row) : {
        id: data.user.id,
        name: (data.user.email || 'Игрок').split('@')[0],
        email: data.user.email || '',
        balance: [{ serverName: 'Мирный', balance: 0 }],
        balanceRub: 0,
        stats: { blocks: 0, mobs: 0, timeHours: 0, timeMinutes: 0 },
        privileges: [],
        transactions: [],
        providers: ['email'],
        referrals: [],
        refBy: null,
        avatar: null,
        skin: null,
        cape: null,
        banner: null,
        description: '',
        privacy: {},
        twoFA: false,
      };

      this.saveLocalSession(user);
      return { ok: true, user };
    },

    /**
     * Восстановление сессии при загрузке страницы.
     * Если в Supabase есть активная сессия — подтягивает профиль в localStorage.
     */
    async restoreSession() {
      if (!this.configured) return null;
      const { data } = await client.auth.getSession();
      const session = data && data.session;
      if (!session) return null;

      const { data: row } = await client
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle();
      if (!row) return null;

      const user = rowToUser(row);
      this.saveLocalSession(user);
      return user;
    },

    async signOut() {
      if (this.configured) {
        try { await client.auth.signOut(); } catch (e) {}
      }
      const auth = localAuth();
      auth.session = null;
      setLS(LOCAL_AUTH_KEY, auth);
    },

    // Кладёт пользователя в localStorage (сессия + профиль)
    saveLocalSession(user) {
      const auth = localAuth();
      const i = auth.users.findIndex(u => u.id === user.id);
      if (i >= 0) auth.users[i] = user;
      else auth.users.push(user);
      auth.session = { userId: user.id, token: 'db_' + user.id };
      setLS(LOCAL_AUTH_KEY, auth);
    },

    // Сохраняет изменения профиля обратно в Supabase
    async updateProfile(user) {
      if (!this.configured) return null;
      const row = userToRow(user);
      const { error } = await client.from('profiles').update(row).eq('id', user.id);
      return error ? { ok: false, error: error.message } : { ok: true };
    },

    // ---------------- ДАННЫЕ ПУБЛИЧНЫХ ПРОФИЛЕЙ ----------------
    async findPlayerByName(name) {
      if (!this.configured) return null;
      const { data, error } = await client
        .from('profiles')
        .select('*')
        .ilike('name', name)
        .maybeSingle();
      if (error || !data) return null;
      return rowToUser(data);
    },

    async searchPlayersByName(q) {
      if (!this.configured) return [];
      const { data, error } = await client
        .from('profiles')
        .select('*')
        .ilike('name', '%' + q + '%')
        .limit(20);
      if (error || !data) return [];
      return data.map(rowToUser).filter(Boolean);
    },

    // ---------------- ЛАЙКИ ПРОФИЛЕЙ ----------------
    // Облако: таблица likes (один игрок — один лайк на профиль).
    // Возвращает { count, liked } — liked по текущей сессии. Без Supabase — null.
    async getLikes(profileId) {
      if (!this.configured || !profileId) return null;
      const { count } = await client
        .from('likes')
        .select('*', { count: 'exact', head: true })
        .eq('profile_id', profileId);
      let liked = false;
      try {
        const { data } = await client.auth.getUser();
        const me = data && data.user ? data.user.id : null;
        if (me) {
          const { data: row } = await client
            .from('likes')
            .select('liker_id')
            .eq('profile_id', profileId)
            .eq('liker_id', me)
            .maybeSingle();
          liked = !!row;
        }
      } catch (e) {}
      return { count: count || 0, liked };
    },

    // Поставить/снять лайк текущей сессией. Только авторизованные.
    async setLike(profileId, liked) {
      if (!this.configured || !profileId) return { ok: false, error: 'Supabase не настроен' };
      let me = null;
      try {
        const { data } = await client.auth.getUser();
        me = data && data.user ? data.user.id : null;
      } catch (e) {}
      if (!me) return { ok: false, error: 'Войди в аккаунт, чтобы ставить лайки' };
      if (liked) {
        const { error } = await client.from('likes').insert({ profile_id: profileId, liker_id: me });
        return error ? { ok: false, error: error.message } : { ok: true };
      }
      const { error } = await client.from('likes')
        .delete()
        .eq('profile_id', profileId)
        .eq('liker_id', me);
      return error ? { ok: false, error: error.message } : { ok: true };
    },

    // ---------------- УВЕДОМЛЕНИЯ (колокольчик) ----------------
    // Возвращает Promise<Array> — уведомления пользователя.
    async listNotifications(userId) {
      if (!this.configured) {
        try { return JSON.parse(localStorage.getItem('mc:notifications:' + userId)) || []; } catch (e) { return []; }
      }
      if (!userId) return [];
      const { data, error } = await client
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error || !data) return [];
      return data.map(n => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        url: n.url,
        read: !!n.read,
        time: new Date(n.created_at).getTime(),
      }));
    },

    // Создать уведомление. Возвращает Promise<Object|null>.
    async pushNotification(userId, type, title, body, url) {
      if (!this.configured || !userId) return null;
      const { data, error } = await client
        .from('notifications')
        .insert({ user_id: userId, type, title: title || '', body: body || '', url: url || null })
        .select()
        .single();
      return error ? null : data;
    },

    async markNotificationsRead(userId) {
      if (!this.configured || !userId) return;
      await client.from('notifications').update({ read: true }).eq('user_id', userId);
    },

    async removeNotification(userId, id) {
      if (!this.configured || !userId) return;
      await client.from('notifications').delete().eq('id', id).eq('user_id', userId);
    },

    // ---------------- КОММЕНТАРИИ НА ПРОФИЛЯХ ----------------
    async listComments(profileName) {
      if (!this.configured) {
        try {
          return JSON.parse(localStorage.getItem('mc:profile-comments:' + String(profileName).toLowerCase())) || [];
        } catch (e) { return []; }
      }
      const { data, error } = await client
        .from('profile_comments')
        .select('*')
        .ilike('profile_name', String(profileName))
        .order('created_at', { ascending: false })
        .limit(200);
      if (error || !data) return [];
      return data.map(c => ({
        id: c.id,
        author: c.author_name,
        text: c.text,
        date: new Date(c.created_at).toLocaleDateString('ru-RU') + ' ' +
              new Date(c.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
        ts: new Date(c.created_at).getTime(),
        edited: !!c.edited,
        votes: c.votes || {},
      }));
    },

    async addComment(profileName, authorName, text, authorId) {
      if (!this.configured) return null;
      const { data, error } = await client
        .from('profile_comments')
        .insert({ profile_name: String(profileName), author_name: authorName, author_id: authorId || null, text, votes: {} })
        .select()
        .single();
      if (error || !data) return null;
      return {
        id: data.id,
        author: data.author_name,
        text: data.text,
        date: new Date(data.created_at).toLocaleDateString('ru-RU') + ' ' +
              new Date(data.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
        ts: new Date(data.created_at).getTime(),
        edited: !!data.edited,
        votes: data.votes || {},
      };
    },

    async updateComment(id, patch) {
      if (!this.configured) return;
      await client.from('profile_comments').update(patch).eq('id', id);
    },

    async removeComment(id) {
      if (!this.configured) return;
      await client.from('profile_comments').delete().eq('id', id);
    },

    // ---------------- ОБРАЩЕНИЯ (тикеты) ----------------
    async listTickets(ownerId) {
      if (!this.configured) {
        try { return JSON.parse(localStorage.getItem('mc:tickets')) || []; } catch (e) { return []; }
      }
      if (!ownerId) return [];
      const { data, error } = await client
        .from('tickets')
        .select('*')
        .eq('owner_id', ownerId)
        .order('created_at', { ascending: false });
      if (error || !data) return [];
      return data.map(t => ({
        id: t.id,
        owner: t.owner_name,
        subject: t.subject,
        status: t.status,
        createdAt: new Date(t.created_at).toLocaleString('ru-RU'),
        messages: t.messages || [],
      }));
    },

    async createTicket(ownerName, ownerId, subject, messages) {
      if (!this.configured) return null;
      const { data, error } = await client
        .from('tickets')
        .insert({ owner_name: ownerName, owner_id: ownerId, subject, status: 'open', messages })
        .select()
        .single();
      if (error || !data) return null;
      return {
        id: data.id,
        owner: data.owner_name,
        subject: data.subject,
        status: data.status,
        createdAt: new Date(data.created_at).toLocaleString('ru-RU'),
        messages: data.messages || [],
      };
    },

    async updateTicket(id, patch) {
      if (!this.configured) return;
      patch.updated_at = new Date().toISOString();
      await client.from('tickets').update(patch).eq('id', id);
    },

    // ---------------- ПУБЛИЧНЫЕ ДАННЫЕ (сервера, баны, команда, префиксы) ----------------
    // Фолбэк возвращает null — страницы используют свои заглушки, пока БД пустая.
    async listServers() {
      if (!this.configured) return null;
      const { data, error } = await client.from('servers').select('*').order('sort');
      return (error || !data) ? [] : data;
    },

    async listBans() {
      if (!this.configured) return null;
      const { data, error } = await client.from('bans').select('*').order('banned_at', { ascending: false });
      return (error || !data) ? [] : data;
    },

    async listTeam() {
      if (!this.configured) return null;
      const { data, error } = await client.from('team').select('*').order('sort');
      return (error || !data) ? [] : data;
    },

    async listPrefixes() {
      if (!this.configured) return null;
      const { data, error } = await client.from('prefixes').select('*').order('sort');
      return (error || !data) ? [] : data;
    },

    // ---------------- МАГАЗИН (привилегии) ----------------
    // Каталог привилегий. Порядок: сначала по серверу, внутри — по
    // старшинству (hierarchy), чтобы сайт мог считать «сумму» команд/китов:
    // у вышестоящей привилегии автоматически есть всё, что у нижестоящих.
    async listPrivileges() {
      if (!this.configured) return null;
      const { data, error } = await client
        .from('privileges')
        .select('*')
        .order('hierarchy', { ascending: true })
        .order('sort', { ascending: true });
      return (error || !data) ? [] : data;
    },

    // Киты магазина (с фотками). Свои на каждом (сервер, привилегия).
    async listKits() {
      if (!this.configured) return null;
      const { data, error } = await client
        .from('kits')
        .select('*')
        .order('sort', { ascending: true })
        .order('name', { ascending: true });
      return (error || !data) ? [] : data;
    },

    // Команды привилегий (свои на каждом сервере): (привилегия, сервер, cmd, desc).
    async listPrivilegeCommands() {
      if (!this.configured) return null;
      const { data, error } = await client
        .from('privilege_commands')
        .select('*')
        .order('server')
        .order('privilege')
        .order('sort');
      return (error || !data) ? [] : data;
    },

    // Полная замена команд конкретной привилегии на конкретном сервере
    // (удаляем старые, вставляем новые). RLS: только is_staff().
    async savePrivilegeCommands(privilege, server, pairs) {
      if (!this.configured) return { ok: false, error: 'Supabase не настроен' };
      const { error: delErr } = await client
        .from('privilege_commands')
        .delete()
        .eq('privilege', privilege)
        .eq('server', server);
      if (delErr) return { ok: false, error: delErr.message };
      const rows = (Array.isArray(pairs) ? pairs : [])
        .filter(p => p && String(p.cmd || '').trim())
        .map((p, i) => ({
          privilege: String(privilege),
          server: String(server),
          cmd: String(p.cmd).trim(),
          desc: String(p.desc || '').trim(),
          sort: i,
        }));
      if (!rows.length) return { ok: true };
      const { error } = await client.from('privilege_commands').insert(rows);
      return error ? { ok: false, error: error.message } : { ok: true };
    },

    // Скидки (акции): глобальные и на конкретную привилегию, с датами.
    async listDiscounts() {
      if (!this.configured) return null;
      const { data, error } = await client.from('discounts').select('*').order('sort');
      return (error || !data) ? [] : data;
    },

    // Загрузка фото кита в Supabase Storage (бакет kit-images).
    // Имя файла уникализируется (префикс + время + случайные символы).
    // Возвращает { ok, url, path } или { ok:false, error }.
    async uploadKitImage(file, name) {
      if (!this.configured) return { ok: false, error: 'Supabase не настроен' };
      const base = String(name || 'kit').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase() || 'kit';
      const ext = String((file && file.name) || '').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
      const path = base + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '.' + ext;
      const { error } = await client.storage.from('kit-images').upload(path, file, {
        cacheControl: '3600',
        contentType: file.type || 'image/png',
        upsert: false,
      });
      if (error) return { ok: false, error: error.message };
      const { data: pub } = client.storage.from('kit-images').getPublicUrl(path);
      return { ok: true, url: pub ? pub.publicUrl : null, path };
    },

    // ---------------- ПОПОЛНЕНИЕ БАЛАНСА (DonatePay) ----------------
    // Публичные настройки: страница донатов, флаг тестовых платежей.
    async getSiteConfig() {
      if (!this.configured) return {};
      const { data, error } = await client.from('site_config').select('key,value');
      if (error || !data) return {};
      const map = {};
      data.forEach(r => { map[r.key] = r.value; });
      return map;
    },

    // Изменить настройку (RLS: только персонал, is_staff()).
    async setSiteConfig(key, value) {
      if (!this.configured) return { ok: false, error: 'Supabase не настроен' };
      const { error } = await client.from('site_config').upsert({ key, value });
      return error ? { ok: false, error: error.message } : { ok: true };
    },

    // Создать «ожидающий платёж»: уникальный код, который игрок
    // напишет в сообщении доната. Возвращает строку с кодом или null.
    async createDonation(userId, code, amount) {
      if (!this.configured || !userId) return null;
      const { data, error } = await client
        .from('donations')
        .insert({ user_id: userId, code, amount_expected: Number(amount) || 0 })
        .select()
        .single();
      return error ? null : data;
    },

    // Мои ожидающие/оплаченные пополнения (кнопка «Проверить оплату»).
    async listMyDonations(userId) {
      if (!this.configured || !userId) return [];
      const { data, error } = await client
        .from('donations')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error || !data) return [];
      return data.map(d => ({
        id: d.id,
        code: d.code,
        amount: Number(d.amount_expected) || 0,
        status: d.status,
        paidAt: d.paid_at,
        createdAt: d.created_at,
      }));
    },

    // Покупка привилегии: списание баланса + выдача происходят в БД
    // (RPC purchase_privilege, security definer) — игрок не может
    // начислить себе ничего в обход. Привилегия глобальная, покупается
    // на конкретный сервер; forever=true — «навсегда» по price_forever.
    async purchasePrivilege(privId, months, server, forever) {
      if (!this.configured) return { ok: false, error: 'Supabase не настроен' };
      const { data, error } = await client.rpc('purchase_privilege', {
        p_id: privId,
        months: Number(months) || 0,
        p_server: String(server || ''),
        p_forever: !!forever,
      });
      if (error) return { ok: false, error: error.message };
      return data && data.ok !== false
        ? { ok: true, balance: Number(data.balance) }
        : { ok: false, error: (data && data.error) || 'Ошибка покупки' };
    },

    // Тестовый платёж (демо): начисляет баланс, пока включён
    // site_config.demo_payments. Перед релизом выключить флаг.
    async demoCredit(amount) {
      if (!this.configured) return { ok: false, error: 'Supabase не настроен' };
      const { data, error } = await client.rpc('demo_credit', { p_amount: Number(amount) || 0 });
      if (error) return { ok: false, error: error.message };
      return data && data.ok !== false
        ? { ok: true, balance: Number(data.balance) }
        : { ok: false, error: (data && data.error) || 'Ошибка' };
    },

    // Текущий баланс игрока (для админки, раздел «Баланс игрока»).
    async adminBalanceOf(query) {
      if (!this.configured) return null;
      const q = String(query || '').trim();
      if (!q) return null;
      let result = null;
      const byId = await client.from('profiles').select('name,balance_rub').eq('id', q).maybeSingle();
      if (byId.data) result = byId.data;
      if (!result) {
        const byName = await client.from('profiles').select('name,balance_rub').ilike('name', q).maybeSingle();
        if (byName.data) result = byName.data;
      }
      return result ? { name: result.name, balanceRub: Number(result.balance_rub) || 0 } : null;
    },

    // Ручная корректировка баланса игрока (админка, уровень 2+).
    // delta: + начислить, − списать. В localStorage-режиме — напрямую в mc:auth.
    async adminSetBalance(targetName, delta) {
      if (!this.configured) {
        try {
          const auth = JSON.parse(localStorage.getItem('mc:auth') || '{"users":[],"session":null}');
          const u = auth.users.find(x => String(x.name).toLowerCase() === String(targetName).toLowerCase());
          if (!u) return { ok: false, error: 'Аккаунт не найден' };
          u.balanceRub = Math.max(0, (Number(u.balanceRub) || 0) + Number(delta));
          if (!Array.isArray(u.transactions)) u.transactions = [];
          u.transactions.unshift({
            type: Number(delta) >= 0 ? 'in' : 'out',
            title: 'Ручная корректировка (админ)',
            server: '—',
            amount: Math.abs(Number(delta)),
            unit: 'rub',
            date: new Date().toLocaleDateString('ru-RU'),
          });
          localStorage.setItem('mc:auth', JSON.stringify(auth));
          return { ok: true, balance: u.balanceRub };
        } catch (e) {
          return { ok: false, error: 'Ошибка: ' + e.message };
        }
      }
      const { data, error } = await client.rpc('admin_set_balance', {
        target_name: String(targetName),
        delta: Number(delta) || 0,
      });
      if (error) return { ok: false, error: error.message };
      return data && data.ok !== false
        ? { ok: true, balance: Number(data.balance) }
        : { ok: false, error: (data && data.error) || 'Ошибка' };
    },

    // Кэш цветов префиксов (ник → цвет) для шапки и профилей.
    // Красит ник только НАДЕТЫЙ префикс (active_prefix) с приоритетом > 0 —
    // он идёт поверх цвета привилегии. Перестраивается после выдачи/смены.
    async refreshPrefixColors() {
      let map = {};
      if (this.configured) {
        const [pr, pl] = await Promise.all([
          this.listPrefixes(),
          client.from('profiles').select('name,prefixes,active_prefix'),
        ]);
        const byName = {};
        (Array.isArray(pr) ? pr : []).forEach(p => {
          byName[String(p.name).toLowerCase()] = { color: p.color, priority: Number(p.priority) || 0 };
        });
        (pl.data || []).forEach(u => {
          const worn = byName[String(u.active_prefix || '').toLowerCase()];
          if (worn && worn.priority > 0) map[String(u.name).toLowerCase()] = worn.color;
        });
      } else {
        // localStorage-режим: выданные и надетые префиксы лежат в mc:auth
        let users = [];
        try { users = JSON.parse(localStorage.getItem('mc:auth') || '{"users":[]}').users || []; } catch (e) {}
        let prefixes = [];
        try { prefixes = JSON.parse(localStorage.getItem('mc:admin:prefixes')) || []; } catch (e) {}
        const byName = {};
        (Array.isArray(prefixes) ? prefixes : []).forEach(p => {
          byName[String(p.name).toLowerCase()] = { color: p.color, priority: Number(p.priority) || 0 };
        });
        (Array.isArray(users) ? users : []).forEach(u => {
          const worn = byName[String(u.activePrefix || '').toLowerCase()];
          if (worn && worn.priority > 0) map[String(u.name).toLowerCase()] = worn.color;
        });
      }
      try { localStorage.setItem('mc:prefix-colors', JSON.stringify(map)); } catch (e) {}
      return map;
    },

    async listRules() {
      if (!this.configured) return null;
      const { data, error } = await client.from('rules').select('*').order('sort');
      return (error || !data) ? [] : data;
    },

    // ---------------- ТИКЕТЫ: все (для админки) ----------------
    // Админ видит обращения всех игроков (RLS: is_admin()).
    async adminListTickets() {
      if (!this.configured) return [];
      const { data, error } = await client
        .from('tickets')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error || !data) return [];
      return data.map(t => ({
        id: t.id,
        owner: t.owner_name,
        subject: t.subject,
        status: t.status,
        createdAt: new Date(t.created_at).toLocaleString('ru-RU'),
        messages: t.messages || [],
      }));
    },

    // ---------------- АДМИНКА (управление данными) ----------------
    // Все методы проверяют уровень админа на странице admin.html.
    // При изменении уровней возвращают { ok, error }.

    // Уровень админа текущего авторизованного пользователя (0/1/2/3).
    // Если по id не нашлось (у старых аккаунтов в localStorage id может
    // не совпадать с uuid из Supabase) — пробуем найти по имени.
    async adminLevel(userId, userName) {
      if (!this.configured || !userId) return 0;
      const { data, error } = await client.from('profiles').select('admin_level').eq('id', userId).maybeSingle();
      if (!error && data) return Number(data.admin_level) || 0;
      if (!userName) return 0;
      const found = await this.adminFindUser(userName);
      return found ? found.adminLevel : 0;
    },

    // Найти профиль по нику или uuid — для выдачи админки и префиксов.
    // Возвращает { id, name, admin_level, prefixes } или null.
    async adminFindUser(query) {
      if (!this.configured) return null;
      const q = String(query || '').trim();
      if (!q) return null;
      let result = null;
      const byId = await client.from('profiles').select('id,name,admin_level,prefixes').eq('id', q).maybeSingle();
      if (byId.data) result = byId.data;
      if (!result) {
        const byName = await client.from('profiles').select('id,name,admin_level,prefixes').ilike('name', q).maybeSingle();
        if (byName.data) result = byName.data;
      }
      return result
        ? { id: result.id, name: result.name, adminLevel: Number(result.admin_level) || 0, prefixes: Array.isArray(result.prefixes) ? result.prefixes : [] }
        : null;
    },

    // Выдать/снять префикс игроку. В облаке — через RPC grant_prefix
    // (только admin_level >= 2), в localStorage-режиме — напрямую в mc:auth.
    async adminGrantPrefix(targetId, prefixName, doAdd) {
      if (!this.configured) {
        let data = null;
        try { data = JSON.parse(localStorage.getItem('mc:auth') || '{"users":[],"session":null}'); } catch (e) {}
        const u = data && data.users ? data.users.find(x => String(x.id) === String(targetId)) : null;
        if (!u) return { ok: false, error: 'Аккаунт не найден' };
        if (!Array.isArray(u.prefixes)) u.prefixes = [];
        if (doAdd) {
          if (!u.prefixes.includes(prefixName)) u.prefixes.push(prefixName);
        } else {
          u.prefixes = u.prefixes.filter(n => n !== prefixName);
        }
        try { localStorage.setItem('mc:auth', JSON.stringify(data)); } catch (e) {}
        return { ok: true, prefixes: u.prefixes };
      }
      const { data, error } = await client.rpc('grant_prefix', {
        target_id: targetId,
        prefix_name: prefixName,
        do_add: !!doAdd,
      });
      return error ? { ok: false, error: error.message } : { ok: data.ok !== false, error: data.error, prefixes: data.prefixes };
    },

    // Выдать/снять админку: level = 0/1/2/3. Возвращает { ok, error }.
    // Только создатель (уровень 3) может менять уровни — проверяет RLS
    // (profiles_update: auth.uid() = id or is_creator()).
    async adminSetLevel(targetId, level) {
      if (!this.configured) return { ok: false, error: 'Supabase не настроен' };
      const { error } = await client.from('profiles').update({ admin_level: Number(level) || 0 }).eq('id', targetId);
      return error ? { ok: false, error: error.message } : { ok: true };
    },

    // Общий CRUD для админских таблиц.
    // Важно: id во всех таблицах — bigint generated ALWAYS as identity,
    // поэтому upsert с явным id падает («cannot insert a non-DEFAULT value»).
    // Для существующих записей делаем update по id, для новых — insert без id.
    async adminUpsert(table, row) {
      if (!this.configured) return { ok: false, error: 'Supabase не настроен' };
      if (row && row.id != null) {
        const clean = Object.assign({}, row);
        delete clean.id;
        const { error } = await client.from(table).update(clean).eq('id', row.id);
        return error ? { ok: false, error: error.message } : { ok: true };
      }
      const { error } = await client.from(table).insert(row);
      return error ? { ok: false, error: error.message } : { ok: true };
    },
    async adminDelete(table, id) {
      if (!this.configured) return { ok: false, error: 'Supabase не настроен' };
      const { error } = await client.from(table).delete().eq('id', id);
      return error ? { ok: false, error: error.message } : { ok: true };
    },

    // ---------------- ЛОГИ / ОНЛАЙН (задел на будущее, для мода) ----------------
    // Сюда мод на сервере будет писать данные. Сайт — читать.
    async insertLog(payload) {
      if (!this.configured) return null;
      const { error } = await client.from('logs').insert(payload);
      return error ? { ok: false, error: error.message } : { ok: true };
    },
    async getLogs(filter = {}) {
      if (!this.configured) return [];
      let q = client.from('logs').select('*').order('created_at', { ascending: false }).limit(100);
      if (filter.nick) q = q.eq('nick', filter.nick);
      if (filter.type) q = q.eq('type', filter.type);
      const { data, error } = await q;
      return error ? [] : data;
    },
  };
})();
