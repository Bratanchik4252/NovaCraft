/* ==========================================================================
   shop.js — магазин привилегий
   Шаг 1: полоска выбора сервера во всю ширину (кастомный дропдаун).
          После выбора полоска плавно сжимается и уезжает в правый верхний угол.
   Шаг 2: карточки привилегий с аккордеонами «Команды» и «Киты».
   Старшинство (hierarchy): у вышестоящей привилегии автоматически есть
   команды и киты всех нижестоящих — в админке их описывать заново не нужно.
   Покупка: списание баланса + выдача происходят в БД (RPC purchase_privilege).
   ========================================================================== */

'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const cloud = !!(window.DB && DB.configured);

  // ---------- Состояние ----------
  let servers = [];
  let privileges = [];
  let selected = null;          // выбранный сервер (имя)
  const DURATIONS = [1, 3, 6, 12];
  let currentBuy = null;        // { priv, months }

  // ---------- Загрузка данных ----------
  async function loadServers() {
    if (cloud) {
      try {
        const rows = await DB.listServers();
        if (Array.isArray(rows)) return rows;
      } catch (e) {}
      return [];
    }
    try { return JSON.parse(localStorage.getItem('mc:admin:servers') || '[]'); } catch (e) { return []; }
  }

  async function loadPrivileges() {
    if (cloud) {
      try {
        const rows = await DB.listPrivileges();
        if (Array.isArray(rows)) return rows;
      } catch (e) {}
      return [];
    }
    try { return JSON.parse(localStorage.getItem('mc:admin:privileges') || '[]'); } catch (e) { return []; }
  }

  // ---------- Элементы ----------
  const stage = document.getElementById('shop-stage');
  const serverbar = document.getElementById('serverbar');
  const serverbtn = document.getElementById('serverbtn');
  const ssbLabel = document.getElementById('ssb-label');
  const ssbMeta = document.getElementById('ssb-meta');
  const servermenu = document.getElementById('servermenu');
  const content = document.getElementById('shop-content');
  const hint = document.getElementById('shop-hint');
  const grid = document.getElementById('shop-grid');

  // ---------- Селектор сервера (кастомный, плавный) ----------
  function fmtOnline(s) {
    const n = Number(s.online) || 0;
    return n > 0
      ? '<span class="badge online"><span class="dot"></span>' + n + '</span>'
      : '<span class="badge offline"><span class="dot"></span>0</span>';
  }

  function renderServerMenu() {
    if (!servers.length) {
      servermenu.innerHTML = '<div class="shop-server-empty">Сервера ещё не добавлены. Загляни позже.</div>';
      return;
    }
    servermenu.innerHTML = servers.map(s => {
      const name = MC.esc(s.name || '');
      const ver = MC.esc(s.version || '');
      const online = fmtOnline(s);
      return `<button type="button" class="shop-server-opt" data-server="${MC.esc(s.name || '')}">
        <span class="shop-server-opt-name">${name}</span>
        <span class="shop-server-opt-ver">${ver}</span>
        ${online}
      </button>`;
    }).join('');
    servermenu.querySelectorAll('.shop-server-opt').forEach(b => {
      b.addEventListener('click', () => selectServer(b.dataset.server));
    });
  }

  function openMenu() {
    renderServerMenu();
    serverbar.classList.add('open');
  }
  function closeMenu() {
    serverbar.classList.remove('open');
  }

  serverbtn.addEventListener('click', e => {
    e.stopPropagation();
    serverbar.classList.contains('open') ? closeMenu() : openMenu();
  });
  document.addEventListener('click', e => {
    if (!serverbar.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeMenu();
  });

  // ---------- Выбор сервера: плавное сворачивание полоски в правый верхний угол ----------
  function selectServer(name) {
    closeMenu();
    selected = name;
    const s = servers.find(x => String(x.name) === String(name)) || { name, version: '' };
    ssbLabel.textContent = MC.esc(s.name || name);
    ssbMeta.textContent = s.version ? 'Версия ' + s.version : '';
    stage.classList.add('is-selected');
    content.classList.add('active');
    renderBalanceBar();
    renderPrivileges();
  }

  // ---------- Баланс ----------
  function currentUser() {
    return window.MC ? MC.getCurrentUser() : null;
  }

  function renderBalanceBar() {
    const user = currentUser();
    const bar = document.getElementById('shop-balance');
    if (!bar) return;
    if (!user) {
      bar.innerHTML = '<div class="shop-balance-row"><span>Баланс:</span><a href="auth.html?redirect=shop.html" class="btn btn-sm">Войти, чтобы покупать</a></div>';
      return;
    }
    bar.innerHTML = '<div class="shop-balance-row"><span>Твой баланс:</span><b>' +
      fmtRub(Number(user.balanceRub) || 0) + '</b>' +
      '<a href="topup.html" class="btn btn-sm">Пополнить</a></div>';
  }

  function fmtRub(n) {
    return Number(n || 0).toLocaleString('ru-RU') + ' ₽';
  }

  // ---------- Наследование команд/китов по старшинству ----------
  // Сортируем по hierarchy (и sort), копим СВОИ команды/киты от низших
  // к высшим: у «Дракона» автоматически оказывается всё из «VIP».
  function effectivePriv(priv) {
    const serverPrivs = privileges
      .filter(p => p.enabled !== false && String(p.server || '') === String(selected))
      .sort((a, b) => (Number(a.hierarchy) || 0) - (Number(b.hierarchy) || 0)
        || (Number(a.sort) || 0) - (Number(b.sort) || 0));

    const seenCmd = new Set();
    const seenKit = new Set();
    const commands = [];
    const kits = [];
    const inheritedFrom = [];

    for (const p of serverPrivs) {
      (Array.isArray(p.commands) ? p.commands : []).forEach(c => {
        const key = String(c).trim();
        if (!key || seenCmd.has(key)) return;
        seenCmd.add(key);
        commands.push({ text: key, own: String(p.id) === String(priv.id), from: p.name });
      });
      (Array.isArray(p.kits) ? p.kits : []).forEach(k => {
        const key = String(k).trim();
        if (!key || seenKit.has(key)) return;
        seenKit.add(key);
        kits.push({ text: key, own: String(p.id) === String(priv.id), from: p.name });
      });
      if (String(p.id) !== String(priv.id) && Number(p.hierarchy) <= (Number(priv.hierarchy) || 0)) {
        if (!inheritedFrom.includes(p.name)) inheritedFrom.push(p.name);
      }
    }
    return { commands, kits, inheritedFrom };
  }

  // ---------- Карточки привилегий ----------
  function renderPrivileges() {
    hint.style.display = 'none';
    const list = privileges
      .filter(p => p.enabled !== false && String(p.server || '') === String(selected))
      .sort((a, b) => (Number(a.hierarchy) || 0) - (Number(b.hierarchy) || 0)
        || (Number(a.sort) || 0) - (Number(b.sort) || 0));

    if (!list.length) {
      grid.innerHTML = '<p class="text-muted" style="text-align:center;grid-column:1/-1">На этом сервере привилегии ещё не добавлены.</p>';
      return;
    }

    grid.innerHTML = list.map(priv => cardHtml(priv)).join('');

    grid.querySelectorAll('.shop-dur .os-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.shop-card');
        const dur = card.querySelector('.shop-dur');
        dur.querySelectorAll('.os-tab').forEach(b => b.classList.toggle('active', b === btn));
        const months = Number(btn.dataset.m);
        const base = Number(card.dataset.price) || 0;
        const total = base * months;
        card.querySelector('.shop-price-num').textContent = fmtRub(total);
        card.querySelector('.shop-price-note').textContent = 'за ' + months + (months === 12 ? ' мес (год)' : ' мес');
        card.querySelector('.shop-buy-total').textContent = fmtRub(total);
        card.dataset.months = months;
      });
    });

    grid.querySelectorAll('.shop-buy').forEach(btn => {
      btn.addEventListener('click', () => openBuyModal(btn.closest('.shop-card')));
    });
  }

  function ownedInfo(priv) {
    const user = currentUser();
    if (!user || !Array.isArray(user.privileges)) return null;
    const p = user.privileges.find(x => String(x.name) === String(priv.name)
      && (String(x.server) === String(priv.server) || String(x.server) === '—'));
    if (!p) return null;
    if (p.expiresAt == null) return { forever: true, label: 'Куплена навсегда' };
    if (Number(p.expiresAt) > Date.now()) {
      const d = new Date(Number(p.expiresAt)).toLocaleDateString('ru-RU');
      return { forever: false, label: 'Действует до ' + d };
    }
    return null;
  }

  function cardHtml(priv) {
    const eff = effectivePriv(priv);
    const base = Number(priv.price_rub) || 0;
    const color = priv.color || 'var(--info)';
    const owned = ownedInfo(priv);
    const inheritNote = eff.inheritedFrom.length
      ? `<div class="shop-inherit">Включает всё из привилегий ниже: ${eff.inheritedFrom.map(MC.esc).join(', ')}</div>`
      : '';

    const itemHtml = (items, label) => {
      if (!items.length) return '';
      const chips = items.map(it => {
        const tag = it.own ? '' : `<span class="shop-from">от ${MC.esc(it.from || '')}</span>`;
        return `<span class="shop-chip">${MC.esc(it.text)}${tag}</span>`;
      }).join('');
      return `
        <div class="acc-item open">
          <button class="acc-head" type="button">
            <span class="acc-num">${label === 'Команды' ? '/>' : '&#128230;'}</span>
            <span>${label} (${items.length})</span>
            <svg class="acc-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          <div class="acc-body"><div class="acc-body-inner shop-acc-inner">${chips || '<span class="text-muted">Пусто</span>'}</div></div>
        </div>`;
    };

    return `
      <article class="shop-card glass" data-price="${base}" data-months="1" data-id="${MC.esc(priv.id)}" style="--pcol:${MC.esc(color)}">
        <div class="shop-card-head">
          <span class="shop-dot" style="background:${MC.esc(color)}"></span>
          <div class="shop-card-title">
            <div class="shop-pname" style="color:${MC.esc(color)}">${MC.esc(priv.name)}</div>
            <div class="shop-pserver">${MC.esc(priv.server || '')}</div>
          </div>
          ${owned ? `<span class="shop-owned">${MC.esc(owned.label)}</span>` : ''}
        </div>

        ${priv.description ? `<p class="shop-pdesc">${MC.esc(priv.description)}</p>` : ''}
        ${inheritNote}

        <div class="shop-price">
          <span class="shop-price-num" style="color:${MC.esc(color)}">${fmtRub(base)}</span>
          <span class="shop-price-note">за 1 мес</span>
        </div>

        <div class="seg shop-dur">
          ${DURATIONS.map(m => `<button class="os-tab${m === 1 ? ' active' : ''}" data-m="${m}" type="button">${m} мес${m === 12 ? ' (год)' : ''}</button>`).join('')}
        </div>

        <button class="btn btn-primary shop-buy" type="button" ${owned ? 'disabled' : ''}>
          ${owned ? 'Куплена' : 'Купить за <span class="shop-buy-total">' + fmtRub(base) + '</span>'}
        </button>

        <div class="shop-acc">
          ${itemHtml(eff.commands, 'Команды')}
          ${itemHtml(eff.kits, 'Киты')}
        </div>
      </article>`;
  }

  // ---------- Аккордеоны «Команды»/«Киты» ----------
  grid.addEventListener('click', e => {
    const head = e.target.closest('.shop-acc .acc-head');
    if (!head) return;
    head.closest('.acc-item').classList.toggle('open');
  });

  // ---------- Покупка ----------
  function openBuyModal(card) {
    const user = currentUser();
    if (!user) {
      location.href = 'auth.html?redirect=shop.html';
      return;
    }
    const priv = privileges.find(p => String(p.id) === String(card.dataset.id));
    if (!priv) return;
    const months = Number(card.dataset.months) || 1;
    const total = (Number(priv.price_rub) || 0) * months;

    currentBuy = { priv, months, total, card };
    document.getElementById('buy-modal-text').textContent =
      'Привилегия «' + priv.name + '» на сервере «' + priv.server + '» на ' +
      months + (months === 12 ? ' мес (год)' : ' мес') + '.';
    document.getElementById('buy-modal-balance').textContent =
      'Цена: ' + fmtRub(total) + ' · На балансе: ' + fmtRub(Number(user.balanceRub) || 0);
    document.getElementById('buy-modal').classList.add('open');
  }

  document.getElementById('buy-confirm').addEventListener('click', async () => {
    const b = document.getElementById('buy-modal');
    b.classList.remove('open');
    if (!currentBuy) return;
    await doBuy(currentBuy);
  });

  document.getElementById('buy-cancel').addEventListener('click', () => {
    document.getElementById('buy-modal').classList.remove('open');
    currentBuy = null;
  });
  document.getElementById('buy-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.classList.remove('open');
  });

  document.getElementById('funds-cancel').addEventListener('click', () => {
    document.getElementById('funds-modal').classList.remove('open');
  });
  document.getElementById('funds-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.classList.remove('open');
  });

  function showFundsModal(required, balance) {
    document.getElementById('funds-modal-text').textContent =
      'Нужно ' + fmtRub(required) + ', а на балансе ' + fmtRub(balance) + '.';
    document.getElementById('funds-modal').classList.add('open');
  }

  async function doBuy({ priv, months, total }) {
    const user = currentUser();
    if (!user) { location.href = 'auth.html?redirect=shop.html'; return; }
    const balance = Number(user.balanceRub) || 0;
    if (balance < total) { showFundsModal(total, balance); return; }

    let res;
    if (cloud) {
      res = await DB.purchasePrivilege(priv.id, months);
    } else {
      res = buyLocal(priv, months, total, user);
    }

    if (!res.ok) {
      if (res.error && /Недостаточно|недостаточно/i.test(res.error)) {
        showFundsModal(total, balance);
      } else {
        alert(res.error || 'Ошибка покупки');
      }
      return;
    }

    // Обновляем локальную копию пользователя и шапку.
    // Облако: RPC уже списал баланс и выдал привилегию — обновляем кэш.
    // localStorage: buyLocal() уже всё записал в mc:auth.
    if (cloud) {
      const u = currentUser();
      if (u) {
        u.balanceRub = Number(res.balance) || (Number(u.balanceRub) || 0) - total;
        if (!Array.isArray(u.privileges)) u.privileges = [];
        u.privileges.push({
          name: priv.name,
          server: priv.server,
          purchaseDate: new Date().toLocaleDateString('ru-RU'),
          expiresAt: months > 0 ? Date.now() + months * 30 * 24 * 60 * 60 * 1000 : null,
        });
        if (!Array.isArray(u.transactions)) u.transactions = [];
        u.transactions.unshift({
          type: 'out', title: 'Покупка: ' + priv.name, server: priv.server,
          amount: total, unit: 'rub', date: new Date().toLocaleDateString('ru-RU'),
        });
        if (DB.saveLocalSession) DB.saveLocalSession(u);
      }
    }
    document.dispatchEvent(new Event('mc:auth-changed'));

    // В облаке уведомление уже создаёт RPC purchase_privilege — не дублируем.
    if (!cloud && window.Notif) {
      const u = currentUser();
      Notif.push(u ? u.id : null, 'spend', 'Покупка привилегии',
        'Привилегия «' + priv.name + '» на сервере «' + priv.server + '» на ' + months + ' мес.', 'shop.html');
    }

    showToast('Привилегия «' + priv.name + '» куплена!');
    renderBalanceBar();
    renderPrivileges();
  }

  // Покупка без облака (localStorage): имитация в mc:auth
  function buyLocal(priv, months, total, user) {
    try {
      const data = JSON.parse(localStorage.getItem('mc:auth') || '{"users":[],"session":null}');
      const u = data.users.find(x => String(x.id) === String(user.id));
      if (!u) return { ok: false, error: 'Аккаунт не найден' };
      if ((Number(u.balanceRub) || 0) < total) return { ok: false, error: 'Недостаточно средств' };
      u.balanceRub = (Number(u.balanceRub) || 0) - total;
      if (!Array.isArray(u.privileges)) u.privileges = [];
      u.privileges.push({
        name: priv.name, server: priv.server,
        purchaseDate: new Date().toLocaleDateString('ru-RU'),
        expiresAt: months > 0 ? Date.now() + months * 30 * 24 * 60 * 60 * 1000 : null,
      });
      if (!Array.isArray(u.transactions)) u.transactions = [];
      u.transactions.unshift({
        type: 'out', title: 'Покупка: ' + priv.name, server: priv.server,
        amount: total, unit: 'rub', date: new Date().toLocaleDateString('ru-RU'),
      });
      localStorage.setItem('mc:auth', JSON.stringify(data));
      return { ok: true, balance: u.balanceRub };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ---------- Уведомление-тост ----------
  function showToast(text) {
    let toast = document.getElementById('shop-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'shop-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove('show'), 3200);
  }

  // ---------- Инициализация ----------
  servers = await loadServers();
  privileges = await loadPrivileges();
  renderServerMenu();
  renderBalanceBar();

  // Полоска баланса над сеткой привилегий
  const balHost = document.createElement('div');
  balHost.id = 'shop-balance';
  balHost.className = 'shop-balance';
  content.insertBefore(balHost, content.firstChild);

  window.shopApp = { servers, privileges, selectServer };
});
