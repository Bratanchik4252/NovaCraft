/* ==========================================================================
   main.js — общий модуль сайта
   Навигация, бегунок активной вкладки, тема, выпадающее меню, подвал,
   плавные переходы между страницами, появление элементов.
   TODO: заменить localStorage на API-запросы к бэкенду
   (физический сервер, ноябрь-декабрь 2026)
   ========================================================================== */

'use strict';

// ---------- Конфигурация проекта ----------
const PROJECT_NAME = 'NOVACRAFT';

// Основные вкладки шапки.
// activeOn — страницы, на которых вкладка считается активной (помимо своей).
const DEFAULT_TABS = [
  { id: 'play',     label: 'Играть',       href: 'index.html'    },
  { id: 'download', label: 'Скачать',      href: 'download.html' },
  { id: 'servers',  label: 'Сервера',      href: 'servers.html'  },
  { id: 'cabinet',  label: 'Личный кабинет', href: 'profile.html' },
];

// Ключи localStorage
const KEYS = {
  theme:    'mc:theme',
  auth:     'mc:auth',
  users:    'mc:users',
  session:  'mc:session',
  attempts: 'mc:attempts',
  skin:     'mc:skin',
};

// ---------- Утилиты ----------
const $  = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

// Защита от XSS: любая пользовательская строка проходит через esc()
function esc(value) {
  const div = document.createElement('div');
  div.textContent = String(value == null ? '' : value);
  return div.innerHTML;
}

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

// ---------- Тема (чёрный / белый сайт) ----------
function initTheme() {
  const saved = localStorage.getItem(KEYS.theme) || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  return saved;
}

function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'white' ? 'dark' : 'white';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem(KEYS.theme, next);
  const btn = $('#theme-toggle');
  if (btn) btn.classList.toggle('is-white', next === 'white');
}

// ---------- Вкладки шапки (кастомизация убрана — всегда полный список) ----------
function getNavTabs() {
  return DEFAULT_TABS.slice();
}

// ---------- Шапка ----------
// Текущий пользователь (из localStorage mc:auth)
function getCurrentUser() {
  const data = getLS(KEYS.auth, { users: [], session: null });
  if (!data.session) return null;
  return data.users.find(u => u.id === data.session.userId) || null;
}

// Привилегия с цветом (например красный «Создатель») — красит ник владельца.
function privilegeColorOf(u) {
  const privs = Array.isArray(u && u.privileges) ? u.privileges : [];
  const colored = privs.find(pr => pr.color);
  return colored ? colored.color : null;
}

// Цвет префикса по владельцу (таблица prefixes, поле owner) — из кэша,
// который заполняет админ-панель. Красит ник, если привилегия цвет не дала.
function prefixColorOf(u) {
  if (!u || !u.name) return null;
  try {
    const map = JSON.parse(localStorage.getItem('mc:prefix-colors') || '{}');
    return map[String(u.name).toLowerCase()] || null;
  } catch (e) {
    return null;
  }
}

// Итоговый цвет ника: привилегия → префикс → null
function nickColorOf(u) {
  return privilegeColorOf(u) || prefixColorOf(u) || null;
}

// Топовая привилегия для микро-меню (первая, кроме стандартной «Игрок»).
function topPrivilegeOf(u) {
  const privs = Array.isArray(u && u.privileges) ? u.privileges : [];
  const visible = privs.filter(pr => String(pr.name || '').toLowerCase() !== 'игрок');
  return visible[0] || null;
}

async function logoutCurrentUser() {
  // Если Supabase подключён — завершаем сессию в облаке, потом чистим локально.
  if (window.Auth && Auth.logout) {
    await Auth.logout();
  }
  const data = getLS(KEYS.auth, { users: [], session: null });
  data.session = null;
  setLS(KEYS.auth, data);
}

function buildHeader() {
  const host = $('#site-header');
  if (!host) return;

  const user = getCurrentUser();
  // Вкладка «Личный кабинет» видна только авторизованным
  const tabs = getNavTabs().filter(t => !(t.id === 'cabinet' && !user));
  // С Vercel cleanUrls адрес в браузере без «.html», а href вкладок с «.html» —
  // сравниваем нормализованные имена, чтобы активная вкладка всегда находилась.
  const normPage = p => String(p).split('/').pop().replace(/\.html$/i, '').toLowerCase();
  const currentPage = normPage(location.pathname) || 'index';

  const navLinks = tabs
    .map(t => {
      const isActive = normPage(t.href) === currentPage
        || (t.activeOn && t.activeOn.some(p => normPage(p) === currentPage));
      return `<a class="nav-link${isActive ? ' active' : ''}" data-tab="${t.id}"
         href="${t.href}">${esc(t.label)}</a>`;
    })
    .join('');

  const userCoins = user && Array.isArray(user.balance)
    ? user.balance.reduce((s, b) => s + (Number(b.balance) || 0), 0)
    : 0;
  const userRub = user ? Number(user.balanceRub) || 0 : 0;

  // Цвет привилегии красит ник в пилюле и в микро-меню
  const nickColor = user ? nickColorOf(user) : null;
  const nickStyle = nickColor ? `style="color:${nickColor}"` : '';
  const topPriv = user ? topPrivilegeOf(user) : null;

  // Колокольчик уведомлений (только для авторизованных)
  const bellBlock = user ? `
    <div class="bell-wrap">
      <button class="icon-btn bell-btn" id="bell-btn" aria-label="Уведомления" title="Уведомления">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.7 21a2 2 0 0 1-3.4 0"/>
        </svg>
        <span class="bell-badge" id="bell-badge" style="display:none">0</span>
      </button>
      <div class="bell-panel" id="bell-panel">
        <div class="bell-head">Уведомления</div>
        <div class="bell-list" id="bell-list"></div>
        <div class="bell-empty" id="bell-empty">Уведомлений пока нет</div>
      </div>
    </div>
  ` : '';

  // Блок аккаунта справа: пилюля с аватаркой и ником (если вошли)
  // или кнопка «Войти в аккаунт» (если нет).
  const accountBlock = user ? `
    <div class="account-wrap">
      <button class="account-pill" id="account-btn" aria-label="Аккаунт" title="${esc(user.name)}">
        ${user.avatar
          ? `<img class="account-avatar" src="${esc(user.avatar)}" alt="">`
          : `<span class="account-avatar account-letter">${esc(user.name[0].toUpperCase())}</span>`}
        <span class="account-name" ${nickStyle}>${esc(user.name)}</span>
        <svg class="account-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <div class="account-menu" id="account-menu">
        <div class="account-head">
          ${user.avatar
            ? `<img class="account-avatar" src="${esc(user.avatar)}" alt="">`
            : `<span class="account-avatar account-letter">${esc(user.name[0].toUpperCase())}</span>`}
          <div>
            <div class="account-nick" ${nickStyle}>${esc(user.name)}</div>
            ${topPriv
              ? `<div class="account-priv"${topPriv.color ? ` style="color:${topPriv.color}"` : ''}>${esc(topPriv.name)}</div>`
              : `<div class="account-priv">Игрок</div>`}
          </div>
        </div>
        <div class="account-balances">
          <div class="ab-row"><span>Монеты</span><b id="account-coins">${userCoins}</b></div>
          <div class="ab-row"><span>Рубли</span><b id="account-rub">${userRub} &#8381;</b></div>
        </div>
        <div class="account-links">
          <a class="account-link" href="profile.html">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2"/>
              <circle cx="12" cy="10" r="2.5"/>
              <path d="M6.5 17.5c1-2 3-3 5.5-3s4.5 1 5.5 3"/>
            </svg>
            Личный кабинет
          </a>
          <a class="account-link" href="player.html?name=${encodeURIComponent(user.name)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="8" r="4"/>
              <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>
            </svg>
            Открыть профиль
          </a>
          <a class="account-link" id="account-admin-link" href="admin.html" style="display:none">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 2 4 6v6c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V6z"/>
              <path d="M9 12l2 2 4-4"/>
            </svg>
            Админ-панель
          </a>
        </div>
        <button class="account-logout" id="account-logout" type="button">Выйти</button>
      </div>
    </div>
  ` : `
    <button class="account-login" id="account-btn" aria-label="Войти" title="Войти">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="8" r="4"/>
        <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>
      </svg>
      <span>Войти в аккаунт</span>
    </button>
  `;

  host.innerHTML = `
    <div class="header-inner">
      <a href="index.html" class="logo" aria-label="Главная">
        <svg class="logo-cube" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
          <path d="M12 2 2 7v10l10 5 10-5V7z" stroke-linejoin="round"/>
          <path d="M2 7l10 5 10-5M12 12v10" stroke-linejoin="round"/>
        </svg>
        <span>${esc(PROJECT_NAME)}</span>
      </a>

      <nav class="main-nav" id="main-nav" aria-label="Основная навигация">
        <span class="slider-indicator" id="slider-indicator"></span>
        ${navLinks}
      </nav>

      <div class="header-right">
        ${bellBlock}
        ${accountBlock}
        <button class="icon-btn" id="theme-toggle" title="Сменить тему (чёрный / белый)"
          aria-label="Сменить тему">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.6 1 2.5h6c0-.9.4-1.9 1-2.5A6 6 0 0 0 12 3z"/>
          </svg>
        </button>
        <button class="icon-btn" id="dots-btn" title="Меню" aria-label="Меню">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
            stroke-linecap="round" aria-hidden="true">
            <line x1="3" y1="6.5" x2="21" y2="6.5"/>
            <line x1="3" y1="12" x2="21" y2="12"/>
            <line x1="3" y1="17.5" x2="21" y2="17.5"/>
          </svg>
        </button>
        <div class="dropdown" id="dropdown">
          <a href="rules.html">Правила</a>
          <a href="prefixes.html">Префиксы</a>
          <a href="bans.html">Банлист</a>
          <a href="appeals.html">Обращения</a>
          <div class="dd-sep"></div>
          <a href="https://discord.gg/mMhmkgExNM" target="_blank" rel="noopener">Наш Discord</a>
          <a href="#" data-external>Наш Telegram</a>
          <div class="dd-sep"></div>
          <a href="team.html">Команда проекта</a>
          <a href="players.html">Поиск игроков</a>
        </div>
      </div>
    </div>
  `;

  const nav = $('#main-nav');
  const indicator = $('#slider-indicator');

  // Бегунок: плавно перемещается к активной кнопке.
  // offsetLeft уже считается от внутреннего отступа (padding) навигации,
  // поэтому вычитать padding НЕ нужно.
  function moveSlider(btn, animate = true) {
    if (!btn || !nav || !indicator) return;
    indicator.style.display = 'block';
    indicator.style.width = btn.offsetWidth + 'px';
    indicator.style.transform = `translateX(${btn.offsetLeft}px)`;
    if (!animate) {
      // Начальное позиционирование без анимации, чтобы бегунок не «дергался»
      // от левого края при каждой пересборке шапки.
      indicator.classList.add('no-anim');
      requestAnimationFrame(() => requestAnimationFrame(() => {
        indicator.classList.remove('no-anim');
      }));
    }
  }

  const activeTab = tabs.find(t => normPage(t.href) === currentPage || (t.activeOn && t.activeOn.some(p => normPage(p) === currentPage)));
  const activeBtn = activeTab ? $(`.nav-link[data-tab="${activeTab.id}"]`, host) : null;
  if (activeBtn) {
    moveSlider(activeBtn, false);
  } else if (indicator) {
    indicator.style.display = 'none';
  }

  $$('.nav-link', host).forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      transitionTo(link.href);
    });
  });

  window.addEventListener('resize', () => {
    const current = $('.nav-link.active', host);
    if (current) moveSlider(current);
  });

  // Пересчёт бегунка после загрузки шрифтов: без этого бегунок
  // стоит не на той вкладке (ширина вкладок меняется после подгрузки Inter)
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      const current = $('.nav-link.active', host);
      if (current) moveSlider(current);
    });
  }

  // Кнопка темы
  $('#theme-toggle').addEventListener('click', toggleTheme);

  // ---------- Блок аккаунта ----------
  const accountBtn = $('#account-btn');
  if (accountBtn) {
    accountBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (!user) {
        location.href = 'auth.html';
        return;
      }
      const menu = $('#account-menu');
      if (menu) {
        const wasOpen = menu.classList.contains('open');
        $('.dropdown')?.classList.remove('open');
        menu.classList.toggle('open', !wasOpen);
      }
    });

    const logoutBtn = $('#account-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        await logoutCurrentUser();
        location.href = 'index.html';
      });
    }

    document.addEventListener('click', e => {
      const menu = $('#account-menu');
      if (menu && !e.target.closest('.account-wrap')) menu.classList.remove('open');
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        const menu = $('#account-menu');
        if (menu) menu.classList.remove('open');
        const panel = $('#bell-panel');
        if (panel) panel.classList.remove('open');
        dropdown.classList.remove('open');
      }
    });
  }

  // ---------- Уведомления: колокольчик ----------
  initBell(user);

  // ---------- Ссылка «Админ-панель» ----------
  // Показываем всем вошедшим; доступ проверяется на самой странице admin.html
  // (иначе у старых аккаунтов с устаревшим id в localStorage кнопка не появляется).
  const adminLink = $('#account-admin-link');
  if (adminLink && user) adminLink.style.display = '';

  // Выпадающее меню «три полоски»
  const dotsBtn = $('#dots-btn');
  const dropdown = $('#dropdown');
  dotsBtn.addEventListener('click', e => {
    e.stopPropagation();
    $('.account-menu')?.classList.remove('open');
    dropdown.classList.toggle('open');
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.header-right')) dropdown.classList.remove('open');
  });

  // Ссылки Discord/Telegram — пока заглушки
  // TODO: вставить реальные ссылки после создания сообществ
  $$('[data-external]', dropdown).forEach(a => {
    a.addEventListener('click', e => e.preventDefault());
  });
}

// ---------- Уведомления (колокольчик) ----------
// С Supabase хранятся в таблице notifications, без него — в localStorage.
const NOTIF_TYPES = {
  comment:  { icon: '💬', label: 'Новый комментарий' },
  like:     { icon: '👍', label: 'Реакция на комментарий' },
  appeal:   { icon: '🎫', label: 'Обращение' },
  spend:    { icon: '🛒', label: 'Покупка на сайте' },
  withdraw: { icon: '💸', label: 'Вывод монет' },
};

function loadNotifs(userId) {
  if (!userId) return Promise.resolve([]);
  if (window.DB && DB.configured && DB.listNotifications) {
    return DB.listNotifications(userId);
  }
  try { return Promise.resolve(JSON.parse(localStorage.getItem('mc:notifications:' + userId)) || []); } catch (e) { return Promise.resolve([]); }
}
function saveNotifs(userId, arr) {
  // localStorage-режим: просто сохраняем. Облачный режим управляется методами DB.
  try { localStorage.setItem('mc:notifications:' + userId, JSON.stringify(arr.slice(0, 100))); } catch (e) {}
}
function pushNotif(userId, type, title, body, url) {
  if (!userId) return;
  const meta = NOTIF_TYPES[type] || { icon: '🔔', label: 'Уведомление' };
  const n = {
    id: 'n_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
    type,
    title: title || meta.label,
    body: body || '',
    url: url || null,
    read: false,
    time: Date.now(),
  };
  if (window.DB && DB.configured && DB.pushNotification) {
    DB.pushNotification(userId, type, title || meta.label, body || '', url || null).catch(() => {});
    return;
  }
  try {
    const arr = JSON.parse(localStorage.getItem('mc:notifications:' + userId)) || [];
    arr.unshift(n);
    saveNotifs(userId, arr);
  } catch (e) {}
}
function markNotifsRead(userId) {
  if (!userId) return;
  if (window.DB && DB.configured && DB.markNotificationsRead) {
    DB.markNotificationsRead(userId).catch(() => {});
    return;
  }
  saveNotifs(userId, loadNotifs(userId).map(n => { n.read = true; return n; }));
}
function removeNotif(userId, id) {
  if (!userId) return;
  if (window.DB && DB.configured && DB.removeNotification) {
    DB.removeNotification(userId, id).catch(() => {});
    return;
  }
  saveNotifs(userId, loadNotifs(userId).filter(n => n.id !== id));
}
function notifUserIdByName(nick) {
  // Уведомление по нику: в облаке ищем профиль, в localStorage — в mc:auth.
  if (window.DB && DB.configured && DB.findPlayerByName) {
    return DB.findPlayerByName(nick).then(u => u ? u.id : null).catch(() => null);
  }
  try {
    const data = JSON.parse(localStorage.getItem(KEYS.auth) || '{"users":[],"session":null}');
    const u = data.users.find(x => String(x.name).toLowerCase() === String(nick).toLowerCase());
    return Promise.resolve(u ? u.id : null);
  } catch (e) { return Promise.resolve(null); }
}

function initBell(user) {
  const btn = $('#bell-btn');
  const panel = $('#bell-panel');
  const list = $('#bell-list');
  const empty = $('#bell-empty');
  const badge = $('#bell-badge');
  if (!btn || !panel || !user) return;

  function renderList() {
    loadNotifs(user.id).then(notifs => {
      const unread = notifs.filter(n => !n.read).length;
      if (badge) {
        badge.style.display = unread ? '' : 'none';
        badge.textContent = unread > 99 ? '99+' : String(unread);
      }
      if (!notifs.length) {
        list.innerHTML = '';
        empty.style.display = '';
        return;
      }
      empty.style.display = 'none';
      list.innerHTML = notifs.map(n => {
        const meta = NOTIF_TYPES[n.type] || { icon: '🔔', label: 'Уведомление' };
        const d = new Date(n.time);
        const dateStr = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ' ' +
          d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        return `
          <div class="bell-item${n.read ? '' : ' unread'}">
            <div class="bell-item-icon">${meta.icon}</div>
            <div class="bell-item-main">
              <div class="bell-item-title">${esc(n.title)}</div>
              ${n.body ? '<div class="bell-item-body">' + esc(n.body) + '</div>' : ''}
              <div class="bell-item-date">${dateStr}</div>
            </div>
            <button class="bell-item-del" data-id="${esc(n.id)}" aria-label="Удалить" title="Удалить" type="button">&times;</button>
          </div>
        `;
      }).join('');

      list.querySelectorAll('.bell-item-del').forEach(b => {
        b.addEventListener('click', e => {
          e.stopPropagation();
          removeNotif(user.id, b.dataset.id);
          renderList();
        });
      });
      list.querySelectorAll('.bell-item').forEach(item => {
        item.addEventListener('click', () => {
          const del = item.querySelector('.bell-item-del');
          if (!del) return;
          const n = notifs.find(x => x.id === del.dataset.id);
          if (!n) return;
          markNotifsRead(user.id);
          renderList();
          if (n.url) location.href = n.url;
        });
      });
    });
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const wasOpen = panel.classList.contains('open');
    $('.dropdown')?.classList.remove('open');
    $('.account-menu')?.classList.remove('open');
    panel.classList.toggle('open', !wasOpen);
    if (!wasOpen) {
      markNotifsRead(user.id);
      renderList();
    }
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.bell-wrap')) panel.classList.remove('open');
  });
  renderList();
}

// ---------- Плавный переход между страницами ----------
function transitionTo(url) {
  document.body.classList.add('page-exit');
  setTimeout(() => { location.href = url; }, 300);
}

// ---------- Подвал ----------
function buildFooter() {
  const host = $('#site-footer');
  if (!host) return;
  host.innerHTML = `
    <div class="footer-inner">
      <div>&copy; 2026 ${esc(PROJECT_NAME)} &mdash; модовый проект. Все права защищены.</div>
      <div class="footer-links">
        <a href="rules.html">Правила</a>
        <a href="bans.html">Банлист</a>
        <a href="appeals.html">Обращения</a>
        <a href="team.html">Команда</a>
      </div>
    </div>
  `;
}

// ---------- Появление элементов при скролле ----------
function initReveal() {
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (en.isIntersecting) {
        en.target.classList.add('in-view');
        io.unobserve(en.target);
      }
    });
  }, { threshold: 0.15 });

  const watch = () => $$('.reveal:not(.in-view)').forEach(el => io.observe(el));
  watch();

  // Контент, отрисованный позже (данные из БД и т.п.), тоже должен появиться:
  // как только в DOM добавились новые .reveal-элементы — начинаем их наблюдать.
  const mo = new MutationObserver(watch);
  mo.observe(document.body, { childList: true, subtree: true });
}

// ---------- Кастомный селект (современный дропдаун) ----------
// Прячет нативный <select>, рисует свой список и синхронизирует value/change.
function enhanceSelect(select) {
  if (!select || select.dataset.csel) return;
  select.dataset.csel = '1';

  const wrap = document.createElement('div');
  wrap.className = 'csel';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'csel-btn';
  btn.innerHTML = '<span class="csel-label"></span>' +
    '<svg class="csel-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6l4 4 4-4"/></svg>';

  const menu = document.createElement('div');
  menu.className = 'csel-menu';

  const label = () => select.options[select.selectedIndex]
    ? select.options[select.selectedIndex].textContent : '';

  function renderOpts() {
    menu.innerHTML = '';
    [...select.options].forEach((opt, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'csel-opt' + (opt.selected ? ' active' : '');
      b.textContent = opt.textContent;
      b.addEventListener('click', () => {
        select.selectedIndex = i;
        sync();
        select.dispatchEvent(new Event('change', { bubbles: true }));
        close();
      });
      menu.appendChild(b);
    });
  }

  function sync() {
    btn.querySelector('.csel-label').textContent = label();
    [...menu.children].forEach((b, i) => b.classList.toggle('active', i === select.selectedIndex));
  }

  function open() { renderOpts(); sync(); wrap.classList.add('open'); }
  function close() { wrap.classList.remove('open'); }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    wrap.classList.contains('open') ? close() : open();
  });
  btn.addEventListener('keydown', e => {
    if (e.key === 'Escape') close();
  });
  document.addEventListener('click', e => {
    if (!wrap.contains(e.target)) close();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && wrap.classList.contains('open')) close();
  });

  // Синхронизация при программном изменении значения (например page.select)
  select.addEventListener('change', () => { renderOpts(); sync(); });

  select.style.display = 'none';
  wrap.appendChild(btn);
  wrap.appendChild(menu);
  select.parentNode.insertBefore(wrap, select.nextSibling);
  renderOpts();
  sync();
}

// ---------- Инициализация ----------
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  buildHeader();
  buildFooter();
  initReveal();

  // Все статичные селекты на странице становятся кастомными
  document.querySelectorAll('select:not([data-csel])').forEach(enhanceSelect);

  // Если Supabase подключён — восстанавливаем сессию из облака и
  // перерисовываем шапку с авторизованным пользователем.
  if (window.DB && DB.configured) {
    DB.restoreSession().then(() => {
      buildHeader();
      buildFooter();
    });
  }

  // Кэш цветов префиксов (ник → цвет) для шапки и профилей игроков.
  // Заполняется из таблицы prefixes (поле owner), админка тоже обновляет его.
  if (window.DB && DB.configured && DB.listPrefixes) {
    DB.listPrefixes().then(rows => {
      if (!Array.isArray(rows)) return;
      const map = {};
      rows.forEach(p => {
        if (p.owner && p.color) map[String(p.owner).toLowerCase()] = p.color;
      });
      try { localStorage.setItem('mc:prefix-colors', JSON.stringify(map)); } catch (e) {}
      buildHeader();
    }).catch(() => {});
  }

  // TODO: подключить реальный бэкенд и убрать этот метод
  // Временный авто-заход для демонстрации (можно удалить)
  window.MC = {
    PROJECT_NAME,
    DEFAULT_TABS,
    KEYS,
    esc,
    getLS,
    setLS,
    transitionTo,
    toggleTheme,
    getCurrentUser,
    logoutCurrentUser,
    enhanceSelect,
  };

  // ---------- Публичное API уведомлений ----------
  window.Notif = {
    push: (userId, type, title, body, url) => pushNotif(userId, type, title, body, url),
    pushToName: (nick, type, title, body, url) => {
      notifUserIdByName(nick).then(id => pushNotif(id, type, title, body, url));
    },
    list: userId => loadNotifs(userId),
    countUnread: userId => loadNotifs(userId).then(a => a.filter(n => !n.read).length),
    markAllRead: userId => markNotifsRead(userId),
    remove: (userId, id) => removeNotif(userId, id),
    forCurrent: () => { const u = getCurrentUser(); return u ? loadNotifs(u.id) : Promise.resolve([]); },
  };
});
