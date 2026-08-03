/* ==========================================================================
   player.js — публичный профиль игрока
   Банер, привилегия, компактный график онлайна + статистика, лайки,
   просмотры и комментарии.
   TODO: заменить заглушки на данные с бэкенда (/api/player?name=)
   ========================================================================== */

'use strict';

(function () {
  function init() {
    const name = new URLSearchParams(location.search).get('name') || '';
    const player = window.findPlayer ? findPlayer(name) : null;

    const hero = $('#player-hero');
    const content = $('#player-content');
    const notfound = $('#player-notfound');
    if (!player) {
      if (hero) hero.style.display = 'none';
      if (content) content.style.display = 'none';
      if (notfound) notfound.style.display = '';
      return;
    }

    renderHeader(player);
    renderPrivilege(player);
    renderStats(player);
    initActions(player);
    initComments(player);
    initChart(player);
  }

  // ---------- Шапка профиля ----------
  function renderHeader(p) {
    const banner = $('#player-banner');
    if (p.banner && p.privacy.showBanner !== false) {
      banner.innerHTML = `<img src="${MC.esc(p.banner)}" alt="">`;
    }

    const avatar = $('#player-avatar');
    if (p.avatar) {
      avatar.src = p.avatar;
    } else {
      // Нет аватарки — рисуем букву ника
      const c = document.createElement('canvas');
      c.width = 220; c.height = 220;
      const ctx = c.getContext('2d');
      ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--glass-bg-hover') || 'rgba(255,255,255,0.15)';
      ctx.fillRect(0, 0, 220, 220);
      ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text') || '#fff';
      ctx.font = '800 90px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((p.name[0] || '?').toUpperCase(), 110, 116);
      avatar.src = c.toDataURL('image/png');
    }

    $('#player-name').textContent = p.name;
    $('#player-desc').textContent = p.privacy.showDescription === false ? '' : (p.description || '');

    const status = $('#player-status');
    if (p.online) {
      status.innerHTML = '<span class="badge online"><span class="dot"></span>онлайн</span>';
    } else {
      status.innerHTML = '<span class="badge offline"><span class="dot"></span>офлайн</span>';
    }
  }

  // ---------- Лайки и просмотры ----------
  function initActions(p) {
    const key = String(p.name).toLowerCase();

    // Просмотры: +1 за каждый визит страницы
    let views = {};
    try { views = JSON.parse(localStorage.getItem('mc:profile-views') || '{}'); } catch (e) {}
    views[key] = (Number(views[key]) || 0) + 1;
    try { localStorage.setItem('mc:profile-views', JSON.stringify(views)); } catch (e) {}
    const viewsEl = $('#player-views');
    if (viewsEl) viewsEl.textContent = Number(views[key]).toLocaleString('ru-RU');

    // Лайки
    let likes = {};
    try { likes = JSON.parse(localStorage.getItem('mc:profile-likes') || '{}'); } catch (e) {}
    if (!likes[key]) likes[key] = { count: 0, liked: false };
    const btn = $('#player-heart');
    const countEl = $('#player-heart-count');
    if (!btn || !countEl) return;

    const renderLike = () => {
      btn.classList.toggle('liked', !!likes[key].liked);
      countEl.textContent = Number(likes[key].count);
    };
    renderLike();
    btn.addEventListener('click', () => {
      likes[key].liked = !likes[key].liked;
      likes[key].count = Math.max(0, (Number(likes[key].count) || 0) + (likes[key].liked ? 1 : -1));
      try { localStorage.setItem('mc:profile-likes', JSON.stringify(likes)); } catch (e) {}
      renderLike();
    });
  }

  // ---------- Привилегия ----------
  function parseRuDate(str) {
    const m = String(str || '').match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    return m ? new Date(+m[3], +m[2] - 1, +m[1]).getTime() : Date.now();
  }

  function renderPrivilege(p) {
    const host = $('#player-priv');
    if (!host) return;
    const block = $('#player-priv-block');
    const privs = Array.isArray(p.privileges) ? p.privileges : [];

    if (p.privacy.showPrivilege === false || !privs.length) {
      if (!privs.length) {
        host.innerHTML = '<div class="priv-none">У игрока пока нет привилегии</div>';
      } else {
        block.style.display = 'none';
      }
      return;
    }

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    host.innerHTML = privs.map(pr => {
      const expired = pr.expiresAt && pr.expiresAt <= now;
      if (pr.expiresAt == null) {
        // навсегда — полная зелёная полоска
        return `
          <div class="priv-card">
            <div class="priv-name">${MC.esc(pr.name)}</div>
            <div class="priv-meta">
              <span>Сервер: <strong>${MC.esc(pr.server)}</strong></span>
              <span>Дата покупки: <strong>${MC.esc(pr.purchaseDate)}</strong></span>
              <span>Срок: <strong>Навсегда</strong></span>
            </div>
            <div class="priv-bar"><div class="priv-bar-fill" style="width:100%"></div></div>
            <div class="priv-days">&#10022; Бессрочная</div>
          </div>
        `;
      }
      const total = pr.expiresAt - parseRuDate(pr.purchaseDate);
      const left = Math.max(0, pr.expiresAt - now);
      const pct = total > 0 ? Math.max(0, Math.min(100, (left / total) * 100)) : 100;
      const daysLeft = Math.ceil(left / day);
      return `
        <div class="priv-card">
          <div class="priv-name">${MC.esc(pr.name)}${expired ? ' <span class="badge badge-bad">истекла</span>' : ''}</div>
          <div class="priv-meta">
            <span>Сервер: <strong>${MC.esc(pr.server)}</strong></span>
            <span>Дата покупки: <strong>${MC.esc(pr.purchaseDate)}</strong></span>
          </div>
          <div class="priv-bar"><div class="priv-bar-fill" style="width:${pct}%"></div></div>
          <div class="priv-days">${expired ? 'Истекла' : 'Осталось: ' + daysLeft + ' дн.'}</div>
        </div>
      `;
    }).join('');
  }

  // ---------- Статистика ----------
  function renderStats(p) {
    const host = $('#player-stats');
    if (!host) return;
    const card = host.closest('.cab-card');
    if (p.privacy.showStats === false) {
      if (card) card.style.display = 'none';
      return;
    }
    let earned = 0;
    let spent = 0;
    (Array.isArray(p.transactions) ? p.transactions : []).forEach(t => {
      if (t.unit && t.unit !== 'mc') return;
      const a = Number(t.amount) || 0;
      if (t.type === 'out') spent += a;
      else if (t.type === 'in') earned += a;
    });
    $('#st-blocks').textContent = Number(p.blocks || 0).toLocaleString('ru-RU');
    $('#st-earned').textContent = Number(earned).toLocaleString('ru-RU');
    $('#st-spent').textContent = Number(spent).toLocaleString('ru-RU');
  }

  // ---------- Комментарии ----------
  function initComments(p) {
    const key = 'mc:profile-comments:' + String(p.name).toLowerCase();
    const cdKey = 'mc:pc-cd:' + String(p.name).toLowerCase();
    const COOLDOWN_MS = 60 * 1000; // 1 комментарий в минуту на страницу профиля
    let comments = [];
    try { comments = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { comments = []; }

    // Защита от старых данных: у каждого комментария есть id и votes
    comments.forEach(c => {
      if (!c.id) c.id = 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
      if (!c.votes) c.votes = {};
    });

    const list = $('#pc-list');
    const text = $('#pc-text');
    const send = $('#pc-send');
    const as = $('#pc-as');
    const cdEl = $('#pc-cd');
    if (!list || !text || !send || !as) return;

    const user = (window.Auth && Auth.getCurrentUser) ? Auth.getCurrentUser() : null;
    const isAuthed = !!user;
    const isOwner = isAuthed && String(user.name).toLowerCase() === String(p.name).toLowerCase();

    // ---------- Кд: отдельный таймер на каждую страницу профиля ----------
    function readCd() {
      try { return Number(localStorage.getItem(cdKey)) || 0; } catch (e) { return 0; }
    }
    function setCd() {
      try { localStorage.setItem(cdKey, String(Date.now())); } catch (e) {}
    }
    function cdRemaining() { return Math.max(0, readCd() + COOLDOWN_MS - Date.now()); }
    function fmtCd(ms) { return Math.ceil(ms / 1000) + ' сек'; }

    let cdTimer = null;
    function updateCdHint() {
      if (!cdEl) return;
      clearTimeout(cdTimer);
      const left = cdRemaining();
      if (left > 0) {
        cdEl.classList.add('active');
        cdEl.textContent = 'Кд: ' + fmtCd(left);
        cdTimer = setTimeout(updateCdHint, 500);
      } else {
        cdEl.classList.remove('active');
        cdEl.textContent = '';
      }
    }

    let msgTimer = null;
    function showMsg(m) {
      const el = $('#pc-msg');
      if (!el) return;
      el.textContent = m;
      clearTimeout(msgTimer);
      msgTimer = setTimeout(() => { el.textContent = ''; }, 4000);
    }

    function save() { try { localStorage.setItem(key, JSON.stringify(comments)); } catch (e) {} }

    // ---------- Уведомления ----------
    function notifyOwner(c) {
      if (!window.Notif || !isAuthed) return;
      if (String(user.name).toLowerCase() === String(p.name).toLowerCase()) return;
      window.Notif.pushToName(p.name, 'comment', 'Новый комментарий',
        c.author + ': ' + c.text.slice(0, 80),
        'player.html?name=' + encodeURIComponent(p.name));
    }
    function notifyVote(c, liked) {
      if (!window.Notif || !isAuthed) return;
      if (String(user.name).toLowerCase() === String(c.author).toLowerCase()) return;
      window.Notif.pushToName(c.author, 'like', liked ? 'Лайк на комментарии' : 'Дизлайк на комментарии',
        user.name + ' ' + (liked ? 'поставил лайк' : 'поставил дизлайк') + ': ' + c.text.slice(0, 60),
        'player.html?name=' + encodeURIComponent(p.name));
    }

    // ---------- Голосование (1 голос: лайк ИЛИ дизлайк, повтор — снять) ----------
    function voteOf(c, nick) { return (c.votes && c.votes[nick]) || 0; }
    function countVotes(c, v) {
      if (!c.votes) return 0;
      return Object.keys(c.votes).filter(k => c.votes[k] === v).length;
    }
    function setVote(c, value) {
      const cur = voteOf(c, user.name);
      if (cur === value) delete c.votes[user.name];
      else c.votes[user.name] = value;
      save();
      if (cur !== value) notifyVote(c, value === 1);
      render();
    }

    // ---------- Инлайн-редактирование (входит в кд написания) ----------
    function startEdit(c, cBody) {
      if (cdRemaining() > 0) {
        showMsg('Кд: подожди ' + fmtCd(cdRemaining()) + ' (редактирование тоже входит в кд)');
        return;
      }
      cBody.style.display = 'none';
      const wrap = document.createElement('div');
      wrap.className = 'pc-edit';
      const ta = document.createElement('textarea');
      ta.maxLength = 500;
      ta.value = c.text;
      const row = document.createElement('div');
      row.className = 'pc-edit-row';
      const saveB = document.createElement('button');
      saveB.type = 'button';
      saveB.className = 'btn btn-sm btn-primary';
      saveB.textContent = 'Сохранить';
      const cancelB = document.createElement('button');
      cancelB.type = 'button';
      cancelB.className = 'btn btn-sm';
      cancelB.textContent = 'Отмена';
      row.appendChild(saveB);
      row.appendChild(cancelB);
      wrap.appendChild(ta);
      wrap.appendChild(row);
      cBody.parentElement.insertBefore(wrap, cBody.nextSibling);

      const cancel = () => { wrap.remove(); cBody.style.display = ''; };
      cancelB.addEventListener('click', cancel);
      saveB.addEventListener('click', () => {
        const t = ta.value.trim();
        if (!t) return;
        if (cdRemaining() > 0) {
          showMsg('Кд: подожди ' + fmtCd(cdRemaining()) + ' (редактирование тоже входит в кд)');
          return;
        }
        const d = new Date();
        c.text = t;
        c.edited = true;
        c.date = d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        setCd();
        save();
        render();
      });
    }

    // ---------- Отрисовка ----------
    function render() {
      list.innerHTML = '';
      if (!comments.length) {
        const empty = document.createElement('div');
        empty.className = 'pc-empty';
        empty.textContent = 'Комментариев пока нет. Будь первым!';
        list.appendChild(empty);
        updateCdHint();
        return;
      }
      comments.slice().reverse().forEach(c => {
        const item = document.createElement('div');
        item.className = 'pc-item';

        const head = document.createElement('div');
        head.className = 'pc-head';
        const author = document.createElement('span');
        author.className = 'pc-author';
        author.textContent = c.author;
        head.appendChild(author);
        if (c.edited) {
          const ed = document.createElement('span');
          ed.className = 'pc-edited';
          ed.textContent = '(изменено)';
          head.appendChild(ed);
        }
        const date = document.createElement('span');
        date.className = 'pc-date';
        date.textContent = c.date;
        head.appendChild(date);
        item.appendChild(head);

        const cBody = document.createElement('div');
        cBody.className = 'pc-text';
        cBody.textContent = c.text;
        item.appendChild(cBody);

        const mine = isAuthed && String(user.name).toLowerCase() === String(c.author).toLowerCase();
        const actions = document.createElement('div');
        actions.className = 'pc-actions';

        // Лайк/дизлайк — только на чужие комментарии
        if (isAuthed && !mine) {
          const voted = voteOf(c, user.name);
          const likeBtn = document.createElement('button');
          likeBtn.type = 'button';
          likeBtn.className = 'pc-vote' + (voted === 1 ? ' liked' : '');
          likeBtn.title = 'Лайк';
          likeBtn.innerHTML = '&#9650; <span>' + countVotes(c, 1) + '</span>';
          likeBtn.addEventListener('click', () => setVote(c, 1));
          const disBtn = document.createElement('button');
          disBtn.type = 'button';
          disBtn.className = 'pc-vote' + (voted === -1 ? ' disliked' : '');
          disBtn.title = 'Дизлайк';
          disBtn.innerHTML = '&#9660; <span>' + countVotes(c, -1) + '</span>';
          disBtn.addEventListener('click', () => setVote(c, -1));
          actions.appendChild(likeBtn);
          actions.appendChild(disBtn);
        }

        // Свои комментарии можно редактировать
        if (mine) {
          const editBtn = document.createElement('button');
          editBtn.type = 'button';
          editBtn.className = 'pc-btn-mini';
          editBtn.textContent = 'Редактировать';
          editBtn.addEventListener('click', () => startEdit(c, cBody));
          actions.appendChild(editBtn);
        }

        // Удалять могут автор комментария и владелец профиля
        if (mine || isOwner) {
          const delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.className = 'pc-btn-mini danger';
          delBtn.textContent = 'Удалить';
          delBtn.addEventListener('click', () => {
            comments = comments.filter(x => x.id !== c.id);
            save();
            render();
          });
          actions.appendChild(delBtn);
        }

        if (actions.childNodes.length) item.appendChild(actions);
        list.appendChild(item);
      });
      updateCdHint();
    }

    if (user) {
      as.innerHTML = 'Комментируешь как <strong>' + MC.esc(user.name) + '</strong>';
      send.addEventListener('click', () => {
        const t = text.value.trim();
        if (!t) return;
        if (cdRemaining() > 0) {
          showMsg('Кд: подожди ' + fmtCd(cdRemaining()) + ' — комментарий можно оставлять раз в минуту');
          return;
        }
        const d = new Date();
        const c = {
          id: 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
          author: user.name,
          text: t,
          date: d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
          ts: d.getTime(),
          edited: false,
          votes: {},
        };
        comments.push(c);
        setCd();
        save();
        text.value = '';
        notifyOwner(c);
        render();
        updateCdHint();
      });
    } else {
      // Гость: комментарии размыты, поверх — кнопка «Войти», чтобы написать
      const section = $('#pc-section');
      if (section) {
        section.classList.add('pc-guest');
        const overlay = document.createElement('div');
        overlay.className = 'pc-guest-overlay';
        overlay.innerHTML =
          '<div class="pc-guest-box">' +
          '<div class="pc-guest-title">Комментарии для авторизованных</div>' +
          '<div class="pc-guest-sub">Войди в аккаунт, чтобы читать и оставлять комментарии.</div>' +
          '<a class="btn btn-primary" href="auth.html?redirect=' +
          encodeURIComponent('player.html?name=' + encodeURIComponent(p.name)) + '">Войти в аккаунт</a>' +
          '</div>';
        section.appendChild(overlay);
      }
      text.disabled = true;
      send.style.display = 'none';
    }

    render();
  }

  // ---------- График онлайна ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function initChart(p) {
    const canvas = $('#player-chart');
    const tip = $('#chart-tip');
    const empty = $('#chart-empty');
    const rangeWrap = $('#chart-range');
    if (!canvas || !tip || !empty) return;

    // Нет данных об онлайне — показываем заглушку
    if (!(Number(p.timeHours) > 0)) {
      canvas.style.display = 'none';
      if (rangeWrap) rangeWrap.style.display = 'none';
      empty.style.display = '';
      return;
    }

    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const padL = 46, padR = 14, padT = 14, padB = 30;
    const D = { week: 7, month: 30, '3m': 90, '6m': 182, all: 365 };
    let series = [];
    let range = 'week';

    const seed = String(p.name).split('').reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) >>> 0, 7);
    const rng = mulberry32(seed);
    const baseHours = Math.max(1, Math.min(12, Math.round((p.timeHours || 0) / 60)));

    function buildSeries() {
      const days = D[range];
      const total = range === 'week' ? Math.min(days, 7) : days;
      const arr = [];
      const nowMs = Date.now();
      for (let i = 0; i < total; i++) {
        const hours = Math.max(0, Math.round(baseHours * rng() + (i % 4) * 0.7));
        const d = new Date(nowMs - (total - 1 - i) * 24 * 60 * 60 * 1000);
        const label = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
        arr.push({ label, value: hours, date: d });
      }
      series = arr;
    }

    const fmt = n => Math.round(n);
    const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

    function draw() {
      ctx.clearRect(0, 0, W, H);
      const colorLine = cssVar('--info') || '#7aa2ff';
      const colorGrid = cssVar('--glass-border') || 'rgba(255,255,255,0.1)';
      const colorText = cssVar('--muted') || 'rgba(255,255,255,0.55)';
      const colorFill = cssVar('--glow-soft') || 'rgba(255,255,255,0.35)';

      const iw = W - padL - padR;
      const ih = H - padT - padB;
      const maxV = Math.max(4, ...series.map(s => s.value));
      const stepY = Math.ceil(maxV / 4);

      // сетка
      ctx.strokeStyle = colorGrid;
      ctx.fillStyle = colorText;
      ctx.font = '12px Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let g = 0; g <= 4; g++) {
        const val = stepY * g;
        const y = padT + ih - (val / maxV) * ih;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(W - padR, y);
        ctx.stroke();
        ctx.fillText(fmt(val) + ' ч', padL - 8, y);
      }

      if (!series.length) return;
      const step = iw / (series.length - 1 || 1);
      const px = i => padL + i * step;
      const py = v => padT + ih - (v / maxV) * ih;

      // подписи оси X
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const labelIdx = [0, Math.floor((series.length - 1) / 2), series.length - 1];
      labelIdx.forEach(i => {
        ctx.fillText(series[i].label, px(i), padT + ih + 8);
      });

      // заливка + линия
      const grad = ctx.createLinearGradient(0, padT, 0, padT + ih);
      grad.addColorStop(0, colorFill);
      grad.addColorStop(1, 'transparent');
      ctx.beginPath();
      series.forEach((s, i) => (i ? ctx.lineTo(px(i), py(s.value)) : ctx.moveTo(px(i), py(s.value))));
      ctx.strokeStyle = colorLine;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.stroke();

      // заливка под линией
      ctx.lineTo(px(series.length - 1), padT + ih);
      ctx.lineTo(px(0), padT + ih);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // точки
      const showDots = series.length <= 30;
      ctx.fillStyle = colorLine;
      series.forEach((s, i) => {
        if (showDots) {
          ctx.beginPath();
          ctx.arc(px(i), py(s.value), 3, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // ---------- Наведение ----------
    const chartWrap = canvas.parentElement;
    const rect = () => canvas.getBoundingClientRect();

    function onMove(e) {
      const r = rect();
      const scaleX = W / r.width;
      const x = (e.clientX - r.left) * scaleX;
      if (x < padL || x > W - padR || !series.length) {
        tip.style.opacity = '0';
        return;
      }
      const iw = W - padL - padR;
      const step = iw / (series.length - 1 || 1);
      const i = Math.round((x - padL) / step);
      const s = series[Math.max(0, Math.min(series.length - 1, i))];
      tip.textContent = s.label + ' — ' + s.value + ' час. онлайн';
      const dispX = ((padL + i * step) / W) * r.width;
      tip.style.left = dispX + 'px';
      tip.style.top = '12px';
      tip.style.opacity = '1';
    }

    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', () => { tip.style.opacity = '0'; });

    // ---------- Переключение диапазона ----------
    const rangeBtns = $$('#chart-range .os-tab');
    rangeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        rangeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        range = btn.dataset.range;
        buildSeries();
        draw();
      });
    });

    buildSeries();
    draw();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
