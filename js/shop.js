/* ==========================================================================
   shop.js — магазин привилегий
   Привилегии ГЛОБАЛЬНЫЕ, набор фиксированный: VIP, PREMIUM, GRAND, DELUXE,
   LEGEND (в админке только редактирование). Команды — СВОИ на каждом сервере
   (privilege_commands), киты — на сервер + привилегию (kits), скидки —
   discounts. В магазине: квадраты привилегий (можно с картинкой) → по клику
   ниже деталь: киты (фото), команды (с замками «Доступно от X» для привилегий
   выше по старшинству) и блок покупки (1/3/6/12 мес или «навсегда»).
   Покупка: списание баланса + выдача в БД (RPC purchase_privilege).
   ========================================================================== */

'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const cloud = !!(window.DB && DB.configured);

  // ---------- Состояние ----------
  let servers = [];
  let privileges = [];    // глобальные
  let kits = [];          // киты (сервер + привилегия)
  let commandRows = [];   // privilege_commands: { privilege, server, cmd, desc }
  let discounts = [];     // акции
  let selected = null;    // выбранный сервер (имя)
  let selectedPrivId = null; // id выбранной привилегии (квадрата)
  let currentBuy = null;  // { priv, months, forever, total }
  const DURATIONS = [1, 3, 6, 12];

  // ---------- Загрузка данных (облако / localStorage) ----------
  function lsTable(key) {
    try { return JSON.parse(localStorage.getItem('mc:admin:' + key) || '[]') || []; }
    catch (e) { return []; }
  }

  async function loadList(fn, key) {
    if (cloud) {
      try {
        const rows = await fn();
        if (Array.isArray(rows)) return rows;
      } catch (e) {}
      return [];
    }
    return lsTable(key);
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
  const squaresHost = document.getElementById('shop-squares');
  const detailHost = document.getElementById('shop-detail');

  // Полоска баланса (создаётся один раз над сеткой)
  const balHost = document.createElement('div');
  balHost.id = 'shop-balance';
  balHost.className = 'shop-balance';
  content.insertBefore(balHost, content.firstChild);

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

  function openMenu() { renderServerMenu(); serverbar.classList.add('open'); }
  function closeMenu() { serverbar.classList.remove('open'); }

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

    const list = sortedPrivs();
    selectedPrivId = list.length ? String(list[0].id) : null;
    renderSquares();
    renderBalanceBar();
    renderDetail();
  }

  // ---------- Баланс ----------
  function currentUser() {
    return window.MC ? MC.getCurrentUser() : null;
  }

  function renderBalanceBar() {
    if (!balHost) return;
    const user = currentUser();
    if (!user) {
      balHost.innerHTML = '<div class="shop-balance-row"><span>Баланс:</span><a href="auth.html?redirect=shop.html" class="btn btn-sm">Войти, чтобы покупать</a></div>';
      return;
    }
    balHost.innerHTML = '<div class="shop-balance-row"><span>Твой баланс:</span><b>' +
      fmtRub(Number(user.balanceRub) || 0) + '</b>' +
      '<a href="topup.html" class="btn btn-sm">Пополнить</a></div>';
  }

  function fmtRub(n) {
    return Number(n || 0).toLocaleString('ru-RU') + ' ₽';
  }

  // ---------- Скидки ----------
  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Процент скидки для привилегии (как privilege_discount в БД):
  // max по активным акциям — глобальным и по этой привилегии.
  function discountPct(privName) {
    const t = todayStr();
    let pct = 0;
    (Array.isArray(discounts) ? discounts : []).forEach(d => {
      if (d.enabled === false) return;
      if (d.scope === 'privilege' && String(d.privilege || '') !== String(privName)) return;
      if (d.starts_at && String(d.starts_at) > t) return;
      if (d.ends_at && String(d.ends_at) < t) return;
      const p = Number(d.percent) || 0;
      if (p > pct) pct = p;
    });
    return pct;
  }

  // Цена с учётом скидки: { total (итог), base (без скидки), pct }
  function priceFor(priv, months, forever) {
    const pct = discountPct(priv.name);
    const base = forever
      ? (Number(priv.price_forever) || 0)
      : ((Number(priv.price_rub) || 0) * months);
    const total = Math.round(base * (100 - pct) / 100);
    return { total, base, pct };
  }

  // ---------- Команды: свои на сервере + наследование по старшинству ----------
  function sortedPrivs() {
    return privileges
      .filter(p => p.enabled !== false)
      .sort((a, b) => (Number(a.hierarchy) || 0) - (Number(b.hierarchy) || 0)
        || (Number(a.sort) || 0) - (Number(b.sort) || 0));
  }

  // Собственные команды привилегии на выбранном сервере.
  // Если таблица privilege_commands пуста — фолбэк на старый формат
  // (команды лежали глобально в jsonb privileges.commands).
  function cmdsForPriv(priv) {
    const rows = commandRows.filter(c =>
      String(c.privilege) === String(priv.name) && String(c.server) === String(selected));
    if (rows.length) {
      return rows
        .map(c => ({ cmd: String(c.cmd || '').trim(), desc: String(c.description || '').trim() }))
        .filter(x => x.cmd);
    }
    const legacy = Array.isArray(priv.commands) ? priv.commands : [];
    return legacy
      .map(c => ({
        cmd: (typeof c === 'string' ? c : (c && c.cmd) || '').trim(),
        desc: (typeof c === 'string' || !c) ? '' : String(c.desc || '').trim(),
      }))
      .filter(x => x.cmd);
  }

  // { own: [{cmd, desc, from|null}], locked: [{cmd, desc, from}] }
  // own — команды этой привилегии + всех нижестоящих (старшинство меньше);
  // locked — команды привилегий выше по старшинству, под замком «Доступно от X».
  function buildCommands(priv) {
    const list = sortedPrivs();
    const myHier = Number(priv.hierarchy) || 0;
    const seen = new Set();
    const lockedSeen = new Set();
    const own = [];
    const locked = [];
    for (const p of list) {
      const h = Number(p.hierarchy) || 0;
      for (const c of cmdsForPriv(p)) {
        const key = String(c.cmd).toLowerCase();
        if (h <= myHier) {
          if (seen.has(key)) continue;
          seen.add(key);
          own.push({ cmd: c.cmd, desc: c.desc, from: h < myHier ? p.name : null });
        } else {
          if (seen.has(key) || lockedSeen.has(key)) continue;
          lockedSeen.add(key);
          locked.push({ cmd: c.cmd, desc: c.desc, from: p.name });
        }
      }
    }
    return { own, locked };
  }

  // ---------- Киты привилегии на выбранном сервере ----------
  function kitsForPriv(priv) {
    const own = kits.filter(k => k.enabled !== false
      && String(k.server) === String(selected)
      && String(k.privilege || '') === String(priv.name));
    if (own.length) return own;
    // легаси: привилегия ссылалась на киты по названию (tags)
    const names = (Array.isArray(priv.kits) ? priv.kits : []).map(String);
    return kits.filter(k => k.enabled !== false
      && String(k.server) === String(selected)
      && names.includes(String(k.name)));
  }

  // ---------- Владение ----------
  function ownedInfo(priv) {
    const user = currentUser();
    if (!user || !Array.isArray(user.privileges)) return null;
    const p = user.privileges.find(x => String(x.name) === String(priv.name)
      && (String(x.server) === String(selected) || x.server == null || String(x.server) === '—'));
    if (!p) return null;
    if (p.expiresAt == null) return { forever: true, label: 'Куплена навсегда' };
    if (Number(p.expiresAt) > Date.now()) {
      const d = new Date(Number(p.expiresAt)).toLocaleDateString('ru-RU');
      return { forever: false, label: 'До ' + d };
    }
    return null;
  }

  // ---------- Квадраты привилегий ----------
  function renderSquares() {
    hint.style.display = 'none';
    const list = sortedPrivs();
    if (!list.length) {
      squaresHost.innerHTML = '<p class="text-muted" style="text-align:center;padding:20px 0">Привилегии ещё не добавлены. Загляни позже.</p>';
      detailHost.style.display = 'none';
      return;
    }
    detailHost.style.display = '';
    squaresHost.innerHTML = list.map(priv => {
      const color = priv.color || 'var(--info)';
      const name = MC.esc(priv.name || '');
      const base = Number(priv.price_rub) || 0;
      const active = String(priv.id) === String(selectedPrivId);
      const img = priv.photo
        ? `<img class="sq-photo" src="${MC.esc(priv.photo)}" alt="${name}" loading="lazy">`
        : '';
      return `<button type="button" class="shop-square${active ? ' active' : ''}" data-id="${MC.esc(priv.id)}"
                style="--pcol:${MC.esc(color)}">
        ${img}
        <span class="sq-name" style="color:${MC.esc(color)}">${name}</span>
        <span class="sq-price">${base ? fmtRub(base) + '/мес' : ''}</span>
      </button>`;
    }).join('');

    squaresHost.querySelectorAll('.shop-square').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedPrivId = btn.dataset.id;
        renderSquares();
        renderDetail(true);
      });
    });
  }

  // ---------- Деталь привилегии (ниже квадратов) ----------
  function selectedPriv() {
    return privileges.find(p => String(p.id) === String(selectedPrivId)) || sortedPrivs()[0] || null;
  }

  function renderDetail(scrollTo) {
    const priv = selectedPriv();
    if (!priv) { detailHost.innerHTML = ''; return; }
    const color = priv.color || 'var(--info)';
    const owned = ownedInfo(priv);
    const eff = buildCommands(priv);
    const klist = kitsForPriv(priv)
      .sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0)
        || String(a.name || '').localeCompare(String(b.name || '')));
    const pct = discountPct(priv.name);
    const first = priceFor(priv, 1, false);
    const foreverPrice = Number(priv.price_forever) || 0;

    const cmdRows = eff.own.map(c => `
      <div class="shop-cmd">
        <code class="shop-cmd-code">${MC.esc(c.cmd)}</code>
        <span class="shop-cmd-desc">${c.desc ? MC.esc(c.desc) : ''}</span>
        ${c.from ? `<span class="shop-from">от ${MC.esc(c.from)}</span>` : ''}
      </div>`).join('');

    const lockRows = eff.locked.map(c => `
      <div class="shop-cmd locked">
        <svg class="shop-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        <code class="shop-cmd-code">${MC.esc(c.cmd)}</code>
        <span class="shop-cmd-desc">${c.desc ? MC.esc(c.desc) : ''}</span>
        <span class="shop-lock-note">Доступно от ${MC.esc(c.from)}</span>
      </div>`).join('');

    const cmdSection = (eff.own.length || eff.locked.length) ? `
      <section class="shop-section">
        <h3 class="shop-section-title">Команды</h3>
        <div class="shop-cmds">${cmdRows}${lockRows}</div>
      </section>` : '';

    const kitCards = klist.map(k => `
      <div class="shop-kit-card glass">
        ${k.photo
          ? `<img class="shop-kit-photo" src="${MC.esc(k.photo)}" alt="${MC.esc(k.name || '')}" loading="lazy">`
          : `<div class="shop-kit-photo shop-kit-photo-empty"><span class="shop-kit-ico-big">&#128230;</span></div>`}
        <div class="shop-kit-name">${MC.esc(k.name || '')}</div>
        ${k.description ? `<div class="shop-kit-desc">${MC.esc(k.description)}</div>` : ''}
      </div>`).join('');

    const kitSection = klist.length ? `
      <section class="shop-section">
        <h3 class="shop-section-title">Киты</h3>
        <div class="shop-kits-grid">${kitCards}</div>
      </section>` : '';

    const durHtml = DURATIONS.map(m =>
      `<button class="os-tab${m === 1 ? ' active' : ''}" data-m="${m}" data-forever="0" type="button">${m} мес${m === 12 ? ' (год)' : ''}</button>`
    ).join('') +
    `<button class="os-tab" data-m="0" data-forever="1" type="button">Навсегда${foreverPrice ? '' : ''}</button>`;

    detailHost.innerHTML = `
  <article class="shop-card glass" data-id="${MC.esc(priv.id)}" data-months="1" data-forever="0" style="--pcol:${MC.esc(color)}">
    <header class="shop-card-head">
      <span class="shop-dot" style="background:${MC.esc(color)}"></span>
      <div class="shop-card-title">
        <div class="shop-pname" style="color:${MC.esc(color)}">${MC.esc(priv.name)}</div>
        ${priv.description ? `<div class="shop-pdesc">${MC.esc(priv.description)}</div>` : ''}
      </div>
      ${owned ? `<span class="shop-owned">${MC.esc(owned.label)}</span>` : ''}
    </header>

    <div class="shop-buyblock">
      <div class="shop-price-row">
        <span class="shop-price-num" style="color:${MC.esc(color)}">${fmtRub(first.total)}</span>
        <span class="shop-price-note">за 1 мес</span>
        <span class="shop-price-old" style="${pct > 0 ? '' : 'display:none'}">${pct > 0 ? fmtRub(first.base) : ''}</span>
        ${pct > 0 ? `<span class="shop-disc-badge">−${pct}%</span>` : ''}
      </div>
      <div class="seg shop-dur">${durHtml}</div>
      <button class="btn btn-primary shop-buy" type="button" ${owned ? 'disabled' : ''}>
        ${owned ? 'Куплена' : 'Купить за <span class="shop-buy-total">' + fmtRub(first.total) + '</span>'}
      </button>
    </div>

    ${kitSection}
    ${cmdSection}
  </article>`;

    // Длительность / «навсегда»
    detailHost.querySelectorAll('.shop-dur .os-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = detailHost.querySelector('.shop-card');
        const dur = card.querySelector('.shop-dur');
        dur.querySelectorAll('.os-tab').forEach(b => b.classList.toggle('active', b === btn));
        card.dataset.forever = btn.dataset.forever === '1' ? '1' : '0';
        card.dataset.months = btn.dataset.forever === '1' ? 0 : (Number(btn.dataset.m) || 1);
        updateBuyBlock(card);
      });
    });

    detailHost.querySelector('.shop-buy').addEventListener('click', () => openBuyModal());

    if (scrollTo) detailHost.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function updateBuyBlock(card) {
    const priv = selectedPriv();
    if (!priv) return;
    const forever = card.dataset.forever === '1';
    const months = Number(card.dataset.months) || 1;
    const { total, base, pct } = priceFor(priv, months, forever);
    const num = card.querySelector('.shop-price-num');
    const note = card.querySelector('.shop-price-note');
    const oldEl = card.querySelector('.shop-price-old');
    const buyTxt = card.querySelector('.shop-buy-total');
    if (num) num.textContent = fmtRub(total);
    if (note) note.textContent = forever ? 'навсегда' : ('за ' + months + (months === 12 ? ' мес (год)' : ' мес'));
    if (oldEl) {
      if (pct > 0) { oldEl.textContent = fmtRub(base); oldEl.style.display = ''; }
      else { oldEl.textContent = ''; oldEl.style.display = 'none'; }
    }
    if (buyTxt) buyTxt.textContent = fmtRub(total);
  }

  // ---------- Покупка ----------
  function openBuyModal() {
    const user = currentUser();
    if (!user) {
      location.href = 'auth.html?redirect=shop.html';
      return;
    }
    const priv = selectedPriv();
    if (!priv) return;
    const card = detailHost.querySelector('.shop-card');
    const forever = card.dataset.forever === '1';
    const months = Number(card.dataset.months) || 1;
    const { total, pct } = priceFor(priv, months, forever);

    currentBuy = { priv, months, forever, total };
    const durText = forever ? 'навсегда' : ('на ' + months + (months === 12 ? ' мес (год)' : ' мес'));
    document.getElementById('buy-modal-text').textContent =
      'Привилегия «' + priv.name + '» на сервере «' + selected + '» ' + durText + '.';
    document.getElementById('buy-modal-balance').textContent =
      'Цена: ' + fmtRub(total) + (pct > 0 ? ' (скидка ' + pct + '%)' : '') +
      ' · На балансе: ' + fmtRub(Number(user.balanceRub) || 0);
    document.getElementById('buy-modal').classList.add('open');
  }

  document.getElementById('buy-confirm').addEventListener('click', async () => {
    const b = document.getElementById('buy-modal');
    b.classList.remove('open');
    await doBuy();
  });

  document.getElementById('buy-cancel').addEventListener('click', () => {
    document.getElementById('buy-modal').classList.remove('open');
    currentBuy = null;
  });
  document.getElementById('buy-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) { e.currentTarget.classList.remove('open'); currentBuy = null; }
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

  async function doBuy() {
    const b = currentBuy;
    if (!b) return;
    const user = currentUser();
    if (!user) { location.href = 'auth.html?redirect=shop.html'; return; }
    const balance = Number(user.balanceRub) || 0;
    if (balance < b.total) { showFundsModal(b.total, balance); return; }

    let res;
    if (cloud) {
      res = await DB.purchasePrivilege(b.priv.id, b.months, selected, b.forever);
    } else {
      res = buyLocal(b, user);
    }

    if (!res.ok) {
      if (res.error && /Недостаточно|недостаточно/i.test(res.error)) {
        showFundsModal(b.total, balance);
      } else {
        alert(res.error || 'Ошибка покупки');
      }
      return;
    }

    if (cloud) {
      const u = currentUser();
      if (u) {
        u.balanceRub = Number(res.balance) || ((Number(u.balanceRub) || 0) - b.total);
        if (!Array.isArray(u.privileges)) u.privileges = [];
        u.privileges.push({
          name: b.priv.name,
          server: selected,
          purchaseDate: new Date().toLocaleDateString('ru-RU'),
          expiresAt: b.forever ? null : Date.now() + b.months * 30 * 24 * 60 * 60 * 1000,
        });
        if (!Array.isArray(u.transactions)) u.transactions = [];
        u.transactions.unshift({
          type: 'out', title: 'Покупка: ' + b.priv.name, server: selected,
          amount: b.total, unit: 'rub', date: new Date().toLocaleDateString('ru-RU'),
        });
        if (DB.saveLocalSession) DB.saveLocalSession(u);
      }
    }
    document.dispatchEvent(new Event('mc:auth-changed'));

    if (!cloud && window.Notif) {
      const u = currentUser();
      Notif.push(u ? u.id : null, 'spend', 'Покупка привилегии',
        'Привилегия «' + b.priv.name + '» на сервере «' + selected + '»' +
        (b.forever ? ' навсегда.' : ' на ' + b.months + ' мес.'), 'shop.html');
    }

    showToast('Привилегия «' + b.priv.name + '» куплена!');
    renderBalanceBar();
    renderSquares();
    renderDetail();
  }

  // Покупка без облака (localStorage): имитация в mc:auth
  function buyLocal(b, user) {
    try {
      const data = JSON.parse(localStorage.getItem('mc:auth') || '{"users":[],"session":null}');
      const u = data.users.find(x => String(x.id) === String(user.id));
      if (!u) return { ok: false, error: 'Аккаунт не найден' };
      if ((Number(u.balanceRub) || 0) < b.total) return { ok: false, error: 'Недостаточно средств' };
      u.balanceRub = (Number(u.balanceRub) || 0) - b.total;
      if (!Array.isArray(u.privileges)) u.privileges = [];
      u.privileges.push({
        name: b.priv.name, server: selected,
        purchaseDate: new Date().toLocaleDateString('ru-RU'),
        expiresAt: b.forever ? null : Date.now() + b.months * 30 * 24 * 60 * 60 * 1000,
      });
      if (!Array.isArray(u.transactions)) u.transactions = [];
      u.transactions.unshift({
        type: 'out', title: 'Покупка: ' + b.priv.name, server: selected,
        amount: b.total, unit: 'rub', date: new Date().toLocaleDateString('ru-RU'),
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

  // ---------- Перерисовка при смене аккаунта ----------
  document.addEventListener('mc:auth-changed', () => {
    renderBalanceBar();
    if (selected) { renderSquares(); renderDetail(); }
  });

  // ---------- Инициализация ----------
  servers = await loadList(() => DB.listServers(), 'servers');
  privileges = await loadList(() => DB.listPrivileges(), 'privileges');
  kits = await loadList(() => DB.listKits(), 'kits');
  commandRows = await loadList(() => DB.listPrivilegeCommands(), 'privilege_commands');
  discounts = await loadList(() => DB.listDiscounts(), 'discounts');

  renderServerMenu();
  renderBalanceBar();

  window.shopApp = { servers, privileges, kits, commandRows, discounts, selectServer };
});
