/* ==========================================================================
   topup.js — пополнение баланса через DonatePay
   Схема: сайт генерирует уникальный код (NC-XXXXXX) и создаёт «ожидающий
   платёж» в таблице donations. Игрок пишет код в сообщении доната.
   Вебхук DonatePay (api/donatepay-ipn.js) ловит сообщение, находит платёж
   по коду и начисляет баланс (RPC credit_donation).
   Кнопка «Тестовый платёж (демо)» — начисляет напрямую (RPC demo_credit),
   пока включён флаг site_config.demo_payments. Перед релизом — выключить.
   ========================================================================== */

'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const cloud = !!(window.DB && DB.configured);
  const amountsHost = document.getElementById('topup-amounts');
  const customInput = document.getElementById('topup-custom');
  const donateBtn = document.getElementById('topup-donate');
  const codeBox = document.getElementById('topup-code-box');
  const codeEl = document.getElementById('topup-code');
  const copyBtn = document.getElementById('topup-copy');
  const checkBtn = document.getElementById('topup-check');
  const demoBtn = document.getElementById('topup-demo');
  const statusEl = document.getElementById('topup-status');
  const historyHost = document.getElementById('topup-history');
  const balanceEl = document.getElementById('topup-balance');

  let amount = 100;
  let currentCode = null;
  let config = {};

  function currentUser() {
    return window.MC ? MC.getCurrentUser() : null;
  }
  function fmtRub(n) {
    return Number(n || 0).toLocaleString('ru-RU') + ' ₽';
  }
  function setStatus(msg, ok) {
    statusEl.textContent = msg;
    statusEl.style.color = ok ? 'var(--success)' : '';
  }

  // ---------- Настройки ----------
  if (cloud && DB.getSiteConfig) {
    try { config = await DB.getSiteConfig(); } catch (e) {}
  } else {
    try { config = JSON.parse(localStorage.getItem('mc:site-config') || '{}'); } catch (e) {}
  }

  const demoEnabled = config.demo_payments === '1';
  demoBtn.style.display = demoEnabled ? '' : 'none';

  const donateNick = (config.donatepay_nick || '').trim();
  if (!donateNick) {
    donateBtn.disabled = true;
    donateBtn.title = 'Страница донатов ещё не настроена (site_config.donatepay_nick)';
  }

  function renderBalance() {
    const u = currentUser();
    balanceEl.textContent = fmtRub(u ? Number(u.balanceRub) || 0 : 0);
    if (!u) balanceEl.textContent = '—';
  }

  // ---------- Сумма ----------
  function pickAmount(a) {
    amount = a;
    amountsHost.querySelectorAll('.os-tab').forEach(b => b.classList.toggle('active', Number(b.dataset.a) === a));
    if (customInput.value && Number(customInput.value) !== a) customInput.value = '';
  }
  amountsHost.querySelectorAll('.os-tab').forEach(b => {
    b.addEventListener('click', () => pickAmount(Number(b.dataset.a)));
  });
  customInput.addEventListener('input', () => {
    const v = Number(customInput.value);
    if (v > 0) pickAmount(v);
  });

  // ---------- Пополнение через DonatePay ----------
  donateBtn.addEventListener('click', async () => {
    const u = currentUser();
    if (!u) { location.href = 'auth.html?redirect=topup.html'; return; }
    setStatus('');

    const sum = Math.floor(Number(amount));
    if (!sum || sum < 10 || sum > 100000) {
      setStatus('Сумма должна быть от 10 до 100 000 ₽');
      return;
    }

    // Уникальный код для сообщения доната
    const code = 'NC-' + Math.random().toString(36).slice(2, 8).toUpperCase();

    if (cloud && DB.createDonation) {
      const d = await DB.createDonation(u.id, code, sum);
      if (!d) { setStatus('Не удалось создать платёж. Попробуй ещё раз.'); return; }
    } else {
      // localStorage-режим: храним код локально (вебхука нет)
      try {
        const arr = JSON.parse(localStorage.getItem('mc:donations:' + u.id) || '[]');
        arr.unshift({ id: 'l_' + Date.now(), code, amount: sum, status: 'pending', createdAt: new Date().toISOString() });
        localStorage.setItem('mc:donations:' + u.id, JSON.stringify(arr));
      } catch (e) {}
    }
    currentCode = code;
    codeEl.textContent = code;
    codeBox.style.display = '';
    setStatus('');

    // Открываем страницу доната DonatePay
    const base = 'https://donatepay.ru/don/' + encodeURIComponent(donateNick);
    const link = base + '?amount=' + sum + '&message=' + encodeURIComponent(code);
    window.open(link, '_blank', 'noopener');
  });

  copyBtn.addEventListener('click', () => {
    if (!currentCode) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(currentCode).catch(() => {});
    }
    copyBtn.textContent = 'Скопировано ✓';
    setTimeout(() => { copyBtn.textContent = 'Скопировать'; }, 1800);
  });

  // ---------- Проверка оплаты ----------
  checkBtn.addEventListener('click', async () => {
    const u = currentUser();
    if (!u) { location.href = 'auth.html?redirect=topup.html'; return; }
    setStatus('Проверяем…');

    let rows = [];
    if (cloud && DB.listMyDonations) {
      rows = await DB.listMyDonations(u.id);
    } else {
      try { rows = JSON.parse(localStorage.getItem('mc:donations:' + u.id) || '[]'); } catch (e) {}
    }

    const paid = rows.find(d => d.status === 'paid'
      && (!currentCode || String(d.code).toUpperCase() === String(currentCode).toUpperCase()));
    if (paid) {
      setStatus('Оплата найдена! Баланс пополнен.', true);
      currentCode = null;
      codeBox.style.display = 'none';
      // Обновляем баланс из облака
      if (cloud && DB.restoreSession) {
        await DB.restoreSession();
      }
      document.dispatchEvent(new Event('mc:auth-changed'));
      renderBalance();
      renderHistory();
      return;
    }
    setStatus('Оплата пока не найдена. Если ты уже оплатил(а) — нажми ещё раз через пару минут.');
  });

  // ---------- Тестовый платёж (демо) ----------
  demoBtn.addEventListener('click', async () => {
    const u = currentUser();
    if (!u) { location.href = 'auth.html?redirect=topup.html'; return; }
    setStatus('Начисляем…');
    const sum = Math.floor(Number(amount));
    let res;
    if (cloud) {
      res = await DB.demoCredit(sum);
    } else {
      try {
        const data = JSON.parse(localStorage.getItem('mc:auth') || '{"users":[],"session":null}');
        const x = data.users.find(y => String(y.id) === String(u.id));
        if (!x) throw new Error('Аккаунт не найден');
        x.balanceRub = (Number(x.balanceRub) || 0) + sum;
        if (!Array.isArray(x.transactions)) x.transactions = [];
        x.transactions.unshift({ type: 'in', title: 'Тестовое пополнение', server: '—', amount: sum, unit: 'rub', date: new Date().toLocaleDateString('ru-RU') });
        localStorage.setItem('mc:auth', JSON.stringify(data));
        res = { ok: true, balance: x.balanceRub };
      } catch (e) {
        res = { ok: false, error: e.message };
      }
    }
    if (!res.ok) { setStatus('Ошибка: ' + (res.error || 'неизвестна')); return; }
    setStatus('Тестовый платёж выполнен: +' + fmtRub(sum), true);
    document.dispatchEvent(new Event('mc:auth-changed'));
    renderBalance();
  });

  // ---------- История ----------
  async function renderHistory() {
    const u = currentUser();
    if (!u) { historyHost.innerHTML = '<p class="text-muted">Войди, чтобы видеть историю.</p>'; return; }
    let rows = [];
    if (cloud && DB.listMyDonations) {
      rows = await DB.listMyDonations(u.id);
    } else {
      try { rows = JSON.parse(localStorage.getItem('mc:donations:' + u.id) || '[]'); } catch (e) {}
    }
    if (!rows.length) { historyHost.innerHTML = '<p class="text-muted">Пока пусто.</p>'; return; }
    historyHost.innerHTML = rows.map(d => {
      const when = d.paidAt ? new Date(d.paidAt).toLocaleString('ru-RU') : (d.createdAt ? new Date(d.createdAt).toLocaleString('ru-RU') : '');
      return `<div class="topup-hist-row">
        <span class="topup-hist-code">${MC.esc(d.code || '')}</span>
        <b>${fmtRub(d.amount)}</b>
        <span class="text-muted" style="font-size:12px">${when}</span>
        <span class="${d.status === 'paid' ? 'badge-ok' : 'badge-off'}">${d.status === 'paid' ? 'оплачен' : 'ожидает'}</span>
      </div>`;
    }).join('');
  }

  renderBalance();
  renderHistory();
  window.topupApp = { config, renderBalance };
});
