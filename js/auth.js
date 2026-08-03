/* ==========================================================================
   auth.js — регистрация / авторизация / сессия
   С Supabase: регистрация через OTP (реальный код на почту), вход по
   ник/email + пароль, данные в облаке. Без Supabase — фолбэк на localStorage.
   Защита: валидация полей, защита от брутфорса (5 попыток -> блок 5 минут).
   TODO: перенести брутфорс-защиту на бэкенд
   (физический сервер, ноябрь-декабрь 2026)
   ========================================================================== */

'use strict';

(function () {
  const AUTH_KEY = 'mc:auth'; // обёртка: { users: [], session: {} }
  const ATTEMPTS_KEY = 'mc:attempts'; // { count, lockedUntil }

  const MAX_ATTEMPTS = 5;   // после 5 неудачных попыток — блок
  const LOCK_MS = 5 * 60 * 1000; // 5 минут

  // TODO: использовать bcrypt на бэкенде (сейчас имитация — base64)
  function hashPassword(password) {
    return btoa(unescape(encodeURIComponent('mc_salt::' + password)));
  }

  function loadAuth() {
    try {
      return JSON.parse(localStorage.getItem(AUTH_KEY)) || { users: [], session: null };
    } catch (e) {
      return { users: [], session: null };
    }
  }

  function saveAuth(data) {
    localStorage.setItem(AUTH_KEY, JSON.stringify(data));
  }

  // ---------- Модель пользователя ----------
  function createUser({ name, email, passHash }) {
    return {
      id: 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      name,
      email,
      passHash,
      // TODO: эти поля придёт с бэкенда
      balance: [{ serverName: 'Мирный', balance: 0 }], // монеты по серверам (новый аккаунт — 0)
      balanceRub: 0,                                    // рубли (новый аккаунт — 0)
      stats: { blocks: 0, mobs: 0, timeHours: 0, timeMinutes: 0 },
      privileges: [],      // [{ name, server, purchaseDate, expiresAt|null }]
      transactions: [],    // [{ type:'in'|'out', title, server, amount, unit, date }]
      providers: ['email'],// способы авторизации
      referrals: [],       // [{ nick, hours }] — приглашённые
      refBy: null,         // кто пригласил
      avatar: null,        // dataURL (картинка или GIF до 5МБ)
      skin: null,          // dataURL скина
      cape: null,          // dataURL плаща
      banner: null,        // фон публичного профиля (до 5МБ)
      description: '',     // «о себе»
      privacy: { showStats: true, showTime: true, showPrivilege: true, showDescription: true, showBanner: true },
    };
  }

  // Сумма монет по всем серверам
  function totalCoins(user) {
    return (Array.isArray(user.balance) ? user.balance : []).reduce((s, b) => s + (Number(b.balance) || 0), 0);
  }

  // Начисление монет на сервер (по умолчанию — первый из списка)
  function addCoins(user, amount, serverName) {
    if (!Array.isArray(user.balance) || !user.balance.length) user.balance = [{ serverName: serverName || 'Мирный', balance: 0 }];
    const entry = user.balance.find(b => b.serverName === (serverName || user.balance[0].serverName));
    entry.balance = (Number(entry.balance) || 0) + amount;
  }

  // Выдача привилегии. months: число или 'forever'
  function grantPrivilege(user, name, server, months) {
    const now = Date.now();
    user.privileges.push({
      name,
      server: server || '—',
      purchaseDate: new Date(now).toLocaleDateString('ru-RU'),
      expiresAt: months === 'forever' ? null : now + months * 30 * 24 * 60 * 60 * 1000,
    });
  }

  // Запись транзакции. type: 'in' (пополнение) | 'out' (списание), unit: 'rub'|'coins'
  function addTransaction(user, type, title, server, amount, unit) {
    user.transactions.unshift({
      type,
      title,
      server: server || '—',
      amount: Number(amount) || 0,
      unit: unit || 'rub',
      date: new Date().toLocaleDateString('ru-RU'),
    });
  }

  // ---------- Реферальная система ----------
  // При регистрации по ссылке (?ref=NICK):
  //  - приглашённый получает VIP на 7 дней;
  //  - у пригласившего появляется запись в списке рефералов.
  // TODO: заменить на логику бэкенда (начисление монет за часы игры).
  function applyReferral(data, user) {
    let refNick = null;
    try { refNick = localStorage.getItem('mc:ref'); } catch (e) {}
    if (!refNick) return;

    const referrer = data.users.find(u => u.name.toLowerCase() === refNick.toLowerCase());
    if (referrer) {
      if (!Array.isArray(referrer.referrals)) referrer.referrals = [];
      if (!referrer.referrals.some(r => r.nick === user.name)) {
        referrer.referrals.push({ nick: user.name, hours: 0 });
      }
    }
    // Приглашённому по ссылке — VIP на 7 дней
    user.privileges.push({
      name: 'VIP',
      server: '—',
      purchaseDate: new Date().toLocaleDateString('ru-RU'),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });
    try { localStorage.removeItem('mc:ref'); } catch (e) {}
  }

  // ---------- Публичное API модуля ----------
  const Auth = {
    // Текущий пользователь или null
    getCurrentUser() {
      const data = loadAuth();
      if (!data.session) return null;
      return data.users.find(u => u.id === data.session.userId) || null;
    },

    isAuthed() {
      return !!this.getCurrentUser();
    },

    async login(identifier, password) {
      // Если подключён Supabase — вход через облако.
      if (window.DB && DB.configured) {
        const res = await DB.signIn(identifier, password);
        if (!res.ok) return res;
        // Автоответ для реферальной метки сохранён в localStorage — профиль уже в БД.
        return res;
      }
      const data = loadAuth();
      const user = data.users.find(
        u => (u.email.toLowerCase() === identifier.toLowerCase() || u.name.toLowerCase() === identifier.toLowerCase())
      );
      if (!user || user.passHash !== hashPassword(password)) {
        return { ok: false, error: 'Неверный логин или пароль' };
      }
      data.session = {
        userId: user.id,
        token: 'token_' + Date.now() + '_' + Math.random().toString(36).slice(2),
        // TODO: заменить на реальный токен из бэкенда
      };
      saveAuth(data);
      return { ok: true, user };
    },

    async register(name, email, password) {
      // Если подключён Supabase — регистрация через облако.
      if (window.DB && DB.configured) {
        const res = await DB.signUp(name, email, password);
        return res;
      }      const data = loadAuth();
      const nameTaken = data.users.some(u => u.name.toLowerCase() === name.toLowerCase());
      if (nameTaken) return { ok: false, error: 'Этот никнейм уже занят' };

      const emailTaken = data.users.some(u => u.email.toLowerCase() === email.toLowerCase());
      if (emailTaken) return { ok: false, error: 'Этот email уже зарегистрирован' };

      const user = createUser({ name, email, passHash: hashPassword(password) });
      applyReferral(data, user);
      data.users.push(user);
      data.session = { userId: user.id, token: 'token_' + Date.now() };
      saveAuth(data);
      return { ok: true, user };
    },

    // Меняет текущего пользователя и сохраняет. fn(user) -> user
    updateCurrentUser(fn) {
      const data = loadAuth();
      if (!data.session) return null;
      const user = data.users.find(u => u.id === data.session.userId);
      if (!user) return null;
      const res = fn(user);
      saveAuth(data);
      // Если Supabase подключён — зеркалим изменения профиля в облако.
      if (window.DB && DB.configured) {
        DB.updateProfile(user);
      }
      return res === undefined ? user : res;
    },

    async logout() {
      if (window.DB && DB.configured) {
        await DB.signOut();
        return;
      }
      const data = loadAuth();
      data.session = null;
      saveAuth(data);
    },

    // ---------- Защита от брутфорса ----------
    getAttempts() {
      try {
        return JSON.parse(localStorage.getItem(ATTEMPTS_KEY)) || { count: 0, lockedUntil: 0 };
      } catch (e) {
        return { count: 0, lockedUntil: 0 };
      }
    },

    isLocked() {
      const a = this.getAttempts();
      return a.lockedUntil > Date.now();
    },

    getLockRemaining() {
      const a = this.getAttempts();
      const ms = a.lockedUntil - Date.now();
      return ms > 0 ? Math.ceil(ms / 1000) : 0;
    },

    registerFailure() {
      const a = this.getAttempts();
      a.count = (a.count || 0) + 1;
      if (a.count >= MAX_ATTEMPTS) {
        a.lockedUntil = Date.now() + LOCK_MS;
        a.count = 0;
      }
      localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(a));
      return a;
    },

    clearAttempts() {
      localStorage.removeItem(ATTEMPTS_KEY);
    },

    // ---------- Утилиты (общие для магазина/кабинета) ----------
    createUser,
    totalCoins,
    addCoins,
    grantPrivilege,
    addTransaction,
  };

  window.Auth = Auth;

  // ---------- Валидаторы ----------
  function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
  }

  // Пароль: минимум 8 символов, минимум 1 цифра, 1 заглавная буква
  function validatePassword(password) {
    if (password.length < 8) return 'Пароль должен быть не короче 8 символов';
    if (!/\d/.test(password)) return 'Пароль должен содержать хотя бы одну цифру';
    if (!/[A-ZА-Я]/.test(password)) return 'Пароль должен содержать хотя бы одну заглавную букву';
    return null;
  }

  // ---------- Логика страницы auth.html ----------
  function initAuthPage() {
    const tabLogin = $('#tab-login');
    const tabRegister = $('#tab-register');
    const loginForm = $('#login-form');
    const registerForm = $('#register-form');
    if (!loginForm || !registerForm) return;

    // Реферальная ссылка: auth.html?ref=NICK
    // TODO: проверять реферала на бэкенде
    const refParam = new URLSearchParams(location.search).get('ref');
    if (refParam && refParam.trim()) {
      try { localStorage.setItem('mc:ref', refParam.trim().slice(0, 32)); } catch (e) {}
    }

    const redirect = new URLSearchParams(location.search).get('redirect') || 'profile.html';

    function switchTab(which) {
      const isLogin = which === 'login';
      tabLogin.classList.toggle('active', isLogin);
      tabRegister.classList.toggle('active', !isLogin);
      loginForm.style.display = isLogin ? 'block' : 'none';
      registerForm.style.display = isLogin ? 'none' : 'block';
    }
    tabLogin.addEventListener('click', () => switchTab('login'));
    tabRegister.addEventListener('click', () => switchTab('register'));

    // Таймер блокировки
    function renderLock() {
      const box = $('#lock-box');
      if (!box) return;
      if (Auth.isLocked()) {
        box.style.display = 'block';
        const remaining = Auth.getLockRemaining();
        box.querySelector('#lock-timer').textContent =
          Math.floor(remaining / 60) + ' мин ' + (remaining % 60) + ' сек';
      } else {
        box.style.display = 'none';
      }
    }
    if ($('#lock-box')) {
      setInterval(renderLock, 1000);
      renderLock();
    }

    // Вход
    loginForm.addEventListener('submit', async e => {
      e.preventDefault();
      const err = $('#login-error');
      const attemptsBox = $('#attempts-info');

      if (Auth.isLocked()) {
        err.textContent = 'Слишком много попыток. Подождите до конца блокировки.';
        renderLock();
        return;
      }

      const identifier = $('#login-identifier').value.trim();
      const password = $('#login-password').value;

      const res = await Auth.login(identifier, password);
      if (!res.ok) {
        const a = Auth.registerFailure();
        err.textContent = res.error;
        // Имитация CAPTCHA: подсказываем, сколько осталось попыток
        if (attemptsBox) {
          const left = MAX_ATTEMPTS - (a.count || 0);
          attemptsBox.textContent = left > 0
            ? 'Неверный ввод. Осталось попыток: ' + left + ' из ' + MAX_ATTEMPTS
            : 'Слишком много попыток — аккаунт заблокирован на 5 минут';
        }
        renderLock();
        return;
      }

      Auth.clearAttempts();
      location.href = redirect;
    });

    // ---------- Регистрация ----------
    // Поток: email → код из письма → ник (с предложениями) + пароль.
    // Если подключён Supabase — код реально приходит на почту (OTP).
    // Если нет — фолбэк на старую заглушку (код показывается в форме).
    // Соцсети при регистрации убраны; вход — только по нику/email и паролю.
    const regEmail = $('#reg-email');
    const regEmailSend = $('#reg-email-send');
    const regEmailError = $('#reg-email-error');
    const regCodeStep = $('#reg-code-step');
    const regCode = $('#reg-code');
    const regCodeCheck = $('#reg-code-check');
    const regCodeError = $('#reg-code-error');
    const regCodeHint = $('#reg-code-hint');
    const regMainStep = $('#reg-main-step');
    const regName = $('#reg-name');
    const regNameError = $('#reg-name-error');
    const regSuggestions = $('#reg-suggestions');
    const regPassword = $('#reg-password');
    const regPassword2 = $('#reg-password2');

    let regEmailOk = null;  // подтверждённый email
    let regCodeValue = '';  // код из «письма» (только для фолбэка)

    const sbOn = !!(window.DB && DB.configured);

    function allNames() {
      try {
        const data = JSON.parse(localStorage.getItem('mc:auth') || '{"users":[],"session":null}');
        return new Set(data.users.map(u => u.name.toLowerCase()));
      } catch (e) {
        return new Set();
      }
    }
    function isNickFree(nick) {
      return !allNames().has(String(nick).toLowerCase());
    }
    // Асинхронная проверка ника: сначала локально, потом в облаке (если Supabase).
    async function isNickFreeAsync(nick) {
      if (!isNickFree(nick)) return false;
      if (sbOn && DB.isNameFree) {
        const free = await DB.isNameFree(nick);
        if (free === false) return false;
      }
      return true;
    }

    // Шаг 1: отправить код на почту (реально, через Supabase OTP)
    regEmailSend.addEventListener('click', async () => {
      const email = regEmail.value.trim();
      regEmailError.textContent = '';
      regCodeError.textContent = '';
      if (!validateEmail(email)) {
        regEmailError.textContent = 'Введите корректный email';
        return;
      }

      // Supabase: реальное письмо. Фолбэк: заглушка с кодом в форме.
      if (sbOn && DB.sendOtp) {
        regEmailSend.disabled = true;
        regEmailSend.textContent = 'Отправляем…';
        const res = await DB.sendOtp(email);
        regEmailSend.disabled = false;
        regEmailSend.textContent = 'Подтвердить почту';
        if (!res.ok) {
          regEmailError.textContent = res.error;
          return;
        }
        regCodeStep.style.display = 'block';
        if (regCodeHint) regCodeHint.innerHTML = 'Код отправлен на почту. Введи его из письма:';
        regCode.value = '';
        regCode.focus();
        return;
      }

      // Фолбэк (без Supabase): код показывается прямо в форме
      const data = JSON.parse(localStorage.getItem('mc:auth') || '{"users":[],"session":null}');
      const taken = data.users.some(u => String(u.email).toLowerCase() === email.toLowerCase());
      if (taken) {
        regEmailError.textContent = 'Этот email уже зарегистрирован';
        return;
      }
      regCodeValue = String(Math.floor(100000 + Math.random() * 900000));
      regCodeStep.style.display = 'block';
      regEmailSend.disabled = true;
      if (regCodeHint) regCodeHint.innerHTML = 'Код отправлен на почту (заглушка). Введи его: <code>' + regCodeValue + '</code>';
      regCode.value = '';
      regCode.focus();
    });

    // Шаг 2: проверить код
    regCodeCheck.addEventListener('click', async () => {
      regCodeError.textContent = '';

      if (sbOn && DB.verifyOtp) {
        regCodeCheck.disabled = true;
        regCodeCheck.textContent = 'Проверяем…';
        const res = await DB.verifyOtp(regEmail.value.trim(), regCode.value.trim());
        regCodeCheck.disabled = false;
        regCodeCheck.textContent = 'Подтвердить код';
        if (!res.ok) {
          regCodeError.textContent = res.error;
          return;
        }
        regEmailOk = regEmail.value.trim().toLowerCase();
        regCodeStep.style.display = 'none';
        regMainStep.style.display = 'block';
        regName.focus();
        return;
      }

      // Фолбэк: проверка локального кода
      if (regCode.value.trim() !== regCodeValue) {
        regCodeError.textContent = 'Неверный код. Проверь и попробуй ещё раз.';
        return;
      }
      regEmailOk = regEmail.value.trim().toLowerCase();
      regCodeStep.style.display = 'none';
      regMainStep.style.display = 'block';
      regName.focus();
    });

    // Предложения свободных ников, если введённый занят
    function suggestNick(base) {
      const clean = String(base).replace(/[^A-Za-z0-9А-Яа-яЁё_]/g, '');
      if (clean.length < 3) return [];
      const pool = [
        clean + '123', clean + '_1', clean + '_2', 'xX' + clean + 'Xx',
        clean + '2026', clean + '_MC', clean + 'Pro', clean + 'x',
      ];
      const out = [];
      for (const p of pool) {
        if (String(p).toLowerCase() !== clean.toLowerCase() && isNickFree(p) && !out.includes(p)) out.push(p);
        if (out.length >= 4) break;
      }
      return out;
    }

    let nickTimer = null;
    regName.addEventListener('input', () => {
      clearTimeout(nickTimer);
      regNameError.textContent = '';
      regSuggestions.innerHTML = '';
      nickTimer = setTimeout(async () => {
        const val = regName.value.trim();
        if (val.length < 3) return;
        const free = await isNickFreeAsync(val);
        if (free) {
          regNameError.style.color = 'var(--success)';
          regNameError.textContent = 'Ник свободен';
          return;
        }
        regNameError.style.color = '';
        regNameError.textContent = 'Этот ник уже занят. Попробуй один из вариантов:';
        suggestNick(val).forEach(s => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'rs-chip';
          b.textContent = s;
          b.addEventListener('click', () => {
            regName.value = s;
            regSuggestions.innerHTML = '';
            regNameError.style.color = 'var(--success)';
            regNameError.textContent = 'Ник свободен';
          });
          regSuggestions.appendChild(b);
        });
      }, 300);
    });

    registerForm.addEventListener('submit', async e => {
      e.preventDefault();
      const err = $('#register-error');
      err.textContent = '';

      const name = regName.value.trim();
      const pass = regPassword.value;
      const pass2 = regPassword2.value;

      if (!regEmailOk) return showErr(err, 'Сначала подтверди email');
      if (name.length < 3) return showErr(err, 'Никнейм должен быть не короче 3 символов');
      const passErr = validatePassword(pass);
      if (passErr) return showErr(err, passErr);
      if (pass !== pass2) return showErr(err, 'Пароли не совпадают');

      // Supabase: завершаем регистрацию (пароль + ник). Фолбэк — старая логика.
      let res;
      if (sbOn && DB.finishRegistration) {
        res = await DB.finishRegistration(name, pass);
      } else {
        res = await Auth.register(name, regEmailOk, pass);
      }
      if (!res.ok) return showErr(err, res.error);

      location.href = redirect;
    });

    function showErr(el, msg) {
      el.textContent = msg;
    }
  }

  document.addEventListener('DOMContentLoaded', initAuthPage);
})();
