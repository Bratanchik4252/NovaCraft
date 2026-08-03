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
      avatar: user.avatar || null,
      skin: user.skin || null,
      cape: user.cape || null,
      banner: user.banner || null,
      description: user.description || '',
      privacy: user.privacy || {},
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

      const user = rowToUser(base);
      this.saveLocalSession(user);
      return { ok: true, user };
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
