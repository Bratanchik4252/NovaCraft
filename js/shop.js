/* ==========================================================================
   shop.js — магазин привилегий и китов
   Шаг 1: полоска выбора сервера (кастомный дропдаун, сворачивается в угол).
   Шаг 2: подвкладки «Привилегии» (слайдер карточек-аккордеонов) и «Киты» (фото).
   Каждая привилегия — аккордеон: клик по шапке открывает/закрывает карточку.
   Внутри — аккордеоны «Команды» (команда + описание) и «Киты» (ссылки на фото).
   Клик по названию кита переключает на вкладку «Киты» и подсвечивает его фото.
   Старшинство: у вышестоящей привилегии автоматически есть команды и киты
   всех нижестоящих (в админке их описывать заново не нужно).
   Покупка: списание баланса + выдача происходят в БД (RPC purchase_privilege).
   ========================================================================== */

'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const cloud = !!(window.DB && DB.configured);

  // ---------- Состояние ----------
  let servers = [];
  let privileges = [];
  let kits = [];                 // киты с фото (все серверы), из таблицы kits
  let selected = null;           // выбранный сервер (имя)
  let activeTab = 'privs';       // 'privs' | 'kits'
  let serverKits = [];           // киты выбранного сервера (кэш рендера)
  const DURATIONS = [1, 3, 6, 12];
  let currentBuy = null;         // { priv, months }

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

  async function loadKits() {
    if (cloud) {
      try {
        const rows = await DB.listKits();
        if (Array.isArray(rows)) return rows;
      } catch (e) {}
      return [];
    }
    try { return JSON.parse(localStorage.getItem('mc:admin:kits') || '[]'); } catch (e) { return []; }
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
  const tabs = document.getElementById('shop-tabs');
  const grid = document.getElementById('shop-grid');
  const kitsGrid = document.getElementById('shop-kits-grid');
  const sliderPrev = document.getElementById('slider-prev');
  const sliderNext = document.getElementById('slider-next');

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

  // ---------- Выбор сервера ----------
  function selectServer(name) {
    closeMenu();
    selected = name;
    const s = servers.find(x => String(x.name) === String(name)) || { name, version: '' };
    ssbLabel.textContent = MC.esc(s.name || name);
    ssbMeta.textContent = s.version ? 'Версия ' + s.version : '';
    stage.classList.add('is-selected');
    content.classList.add('active');
    tabs.style.display = '';
    activeTab = 'privs';
    serverKits = kits
      .filter(k => k.enabled !== false && String(k.server || '') === String(selected))
      .sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0)
        || String(a.name || '').localeCompare(String(b.name || '')));
    syncTabs();
    renderBalanceBar();
    renderPrivileges();
    renderKits();
  }

  // ---------- Подвкладки «Привилегии» / «Киты» ----------
  function syncTabs() {
    document.querySelectorAll('#shop-tabs .os-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.shoptab === activeTab);
    });
    const p = document.getElementById('shop-tab-privs');
    const k = document.getElementById('shop-tab-kits');
    if (p) { p.style.display = activeTab === 'privs' ? '' : 'none'; }
    if (k) { k.style.display = activeTab === 'kits' ? '' : 'none'; }
  }

  function setShopTab(tab) {
    if (activeTab === tab) return;
    activeTab = tab;
    syncTabs();
    if (tab === 'kits') renderKits();
    else renderPrivileges();
  }

  tabs.addEventListener('click', e => {
    const b = e.target.closest('[data-shoptab]');
    if (b) setShopTab(b.dataset.shoptab);
  });

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
  // Собираем СВОИ команды/киты от низших к высшим: у «Дракона» автоматически
  // есть всё из «VIP». Команды — объекты {cmd, desc}; киты — названия.
  function effectivePriv(priv) {
    const serverPrivs = privileges
      .filter(p => p.enabled !== false && String(p.server || '') === String(selected))
      .sort((a, b) => (Number(a.hierarchy) || 0) - (Number(b.hierarchy) || 0)
        || (Number(a.sort) || 0) - (Number(b.sort) || 0));

    const seenCmd = new Set();
    const seenKit = new Set();
    const commands = [];
    const kitNames = [];
    const inheritedFrom = [];

    for (const p of serverPrivs) {
      (Array.isArray(p.commands) ? p.commands : []).forEach(c => {
        const cmd = (typeof c === 'string' ? c : (c && c.cmd) || '').trim();
        const desc = (typeof c === 'string' || !c) ? '' : String(c.desc || '').trim();
        if (!cmd || seenCmd.has(cmd.toLowerCase())) return;
        seenCmd.add(cmd.toLowerCase());
        commands.push({ cmd, desc, own: String(p.id) === String(priv.id), from: p.name });
      });
      (Array.isArray(p.kits) ? p.kits : []).forEach(k => {
        const key = String(k).trim();
        if (!key || seenKit.has(key.toLowerCase())) return;
        seenKit.add(key.toLowerCase());
        kitNames.push({ name: key, own: String(p.id) === String(priv.id), from: p.name });
      });
      if (String(p.id) !== String(priv.id) && Number(p.hierarchy) <= (Number(priv.hierarchy) || 0)) {
        if (!inheritedFrom.includes(p.name)) inheritedFrom.push(p.name);
      }
    }
    return { commands, kits: kitNames, inheritedFrom };
  }

  // Кит по названию для выбранного сервера (фото/описание из таблицы kits).
  function kitByName(name) {
    return serverKits.find(k => String(k.name).toLowerCase() === String(name || '').toLowerCase()) || null;
  }

  // ---------- Слайдер привилегий ----------
  function scrollSlider(dir) {
    const first = grid.querySelector('.shop-card');
    const w = first ? first.offsetWidth + 18 : 320;
    grid.scrollBy({ left: dir * w, behavior: 'smooth' });
  }
  sliderPrev.addEventListener('click', () => scrollSlider(-1));
  sliderNext.addEventListener('click', () => scrollSlider(1));

  // ---------- Карточки привилегий (слайдер-аккордеон) ----------
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

    grid.innerHTML = list.map((priv, i) => cardHtml(priv, i === 0)).join('');

    // Открытие/закрытие карточки (аккордеон)
    grid.querySelectorAll('.shop-card-toggle').forEach(btn => {
      btn.addEventListener('click', () => btn.closest('.shop-card').classList.toggle('open'));
    });

    // Длительность + цена
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

    // Покупка
    grid.querySelectorAll('.shop-buy').forEach(btn => {
      btn.addEventListener('click', () => openBuyModal(btn.closest('.shop-card')));
    });

    // Аккордеоны команд/китов внутри карточки
    grid.querySelectorAll('.shop-acc .acc-head').forEach(head => {
      head.addEventListener('click', () => head.closest('.acc-item').classList.toggle('open'));
    });

    // Клик по названию кита → вкладка «Киты» с его фото
    grid.querySelectorAll('.shop-kit-link').forEach(btn => {
      btn.addEventListener('click', () => showKitPhoto(btn.dataset.kit));
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

  function fromTag(it) {
    return it.own ? '' : `<span class="shop-from">от ${MC.esc(it.from || '')}</span>`;
  }

  function commandsAccHtml(commands) {
    if (!commands.length) return '';
    const rows = commands.map(c => `
      <div class="shop-cmd">
        <code class="shop-cmd-code">${MC.esc(c.cmd)}</code>
        <span class="shop-cmd-desc">${c.desc ? MC.esc(c.desc) : ''}</span>
        ${fromTag(c)}
      </div>`).join('');
    return `
      <div class="acc-item">
        <button class="acc-head" type="button">
          <span class="acc-num">/&gt;</span>
          <span>Команды (${commands.length})</span>
          <svg class="acc-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        <div class="acc-body"><div class="acc-body-inner shop-cmds">${rows || '<span class="text-muted">Пусто</span>'}</div></div>
      </div>`;
  }

  function kitsAccHtml(kits) {
    if (!kits.length) return '';
    const chips = kits.map(k => `
      <button type="button" class="shop-chip shop-kit-link" data-kit="${MC.esc(k.name)}" title="Показать фото кита">
        <span class="shop-kit-ico">&#128230;</span>${MC.esc(k.name)}${fromTag(k)}
      </button>`).join('');
    return `
      <div class="acc-item">
        <button class="acc-head" type="button">
          <span class="acc-num">&#128230;</span>
          <span>Киты (${kits.length})</span>
          <svg class="acc-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        <div class="acc-body"><div class="acc-body-inner shop-acc-inner">${chips || '<span class="text-muted">Пусто</span>'}</div></div>
      </div>`;
  }

  function cardHtml(priv, openFirst) {
    const eff = effectivePriv(priv);
    const base = Number(priv.price_rub) || 0;
    const color = priv.color || 'var(--info)';
    const owned = ownedInfo(priv);
    const inheritNote = eff.inheritedFrom.length
      ? `<div class="shop-inherit">Включает всё из привилегий ниже: ${eff.inheritedFrom.map(MC.esc).join(', ')}</div>`
      : '';

    return `
      <article class="shop-card glass${openFirst ? ' open' : ''}" data-price="${base}" data-months="1"
               data-id="${MC.esc(priv.id)}" style="--pcol:${MC.esc(color)}">
        <div class="shop-card-head shop-card-toggle" role="button" tabindex="0">
          <span class="shop-dot" style="background:${MC.esc(color)}"></span>
          <div class="shop-card-title">
            <div class="shop-pname" style="color:${MC.esc(color)}">${MC.esc(priv.name)}</div>
            <div class="shop-pserver">${MC.esc(priv.server || '')}</div>
          </div>
          ${owned ? `<span class="shop-owned">${MC.esc(owned.label)}</span>` : ''}
          <span class="shop-price-mini">${fmtRub(base)}/мес</span>
          <svg class="shop-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
        </div>

        <div class="shop-card-body"><div class="shop-card-body-inner">
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
            ${commandsAccHtml(eff.commands)}
            ${kitsAccHtml(eff.kits)}
          </div>
        </div></div>
      </article>`;
  }

  // ---------- Вкладка «Киты» (фото) ----------
  function renderKits() {
    if (!serverKits.length) {
      kitsGrid.innerHTML = '<p class="text-muted" style="text-align:center;grid-column:1/-1">На этом сервере киты ещё не добавлены. Добавь их в админке (раздел «Киты»).</p>';
      return;
    }
    kitsGrid.innerHTML = serverKits.map(k => {
      const name = MC.esc(k.name || '');
      const desc = MC.esc(k.description || '');
      const photo = k.photo
        ? `<img class="shop-kit-photo" src="${MC.esc(k.photo)}" alt="${name}" loading="lazy">`
        : `<div class="shop-kit-photo shop-kit-photo-empty"><span class="shop-kit-ico-big">&#128230;</span></div>`;
      return `
        <div class="shop-kit-card glass" data-kit="${MC.esc(k.name || '')}">
          ${photo}
          <div class="shop-kit-name">${name}</div>
          ${k.description ? `<div class="shop-kit-desc">${desc}</div>` : ''}
        </div>`;
    }).join('');
  }

  // Переход на вкладку «Киты» и подсветка конкретного кита
  function showKitPhoto(name) {
    setShopTab('kits');
    const target = kitsGrid.querySelector('.shop-kit-card[data-kit="' + CSS.escape(String(name || '')) + '"]');
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('flash');
    clearTimeout(target._fl);
    target._fl = setTimeout(() => target.classList.remove('flash'), 1600);
  }

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
  kits = await loadKits();
  renderServerMenu();
  renderBalanceBar();

  // Полоска баланса над сеткой привилегий
  const balHost = document.createElement('div');
  balHost.id = 'shop-balance';
  balHost.className = 'shop-balance';
  content.insertBefore(balHost, content.firstChild);

  window.shopApp = { servers, privileges, kits, selectServer, showKitPhoto };
});
