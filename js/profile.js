/* ==========================================================================
   profile.js — личный кабинет
   Вкладки: внешний вид (скин/аватарка), бонус, рефералы, настройки,
   2FA, способы авторизации, история транзакций.
   TODO: заменить заглушки на данные с бэкенда (физический сервер, 2026)
   ========================================================================== */

'use strict';

(function () {
  const MAX_MEDIA = 5 * 1024 * 1024; // 5 МБ

  // ---------- Утилиты ----------
  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  function fmtAmount(tx) {
    return (tx.type === 'in' ? '+' : '−') + ' ' + Number(tx.amount).toLocaleString('ru-RU') + ' ' + (tx.unit === 'coins' ? 'монет' : '₽');
  }

  // ---------- Инициализация ----------
  function initProfilePage() {
    if (!window.Auth) return;
    if (!Auth.isAuthed()) {
      location.href = 'auth.html?redirect=profile.html';
      return;
    }
    const user = Auth.getCurrentUser();
    if (!user) return;

    initTabs();
    initAppearance(user);
    initBonus(user);
    initReferral(user);
    initSettings(user);
    init2FA(user);
    initProviders(user);
    initTransactions(user);
  }

  // ---------- Переключение вкладок ----------
  function initTabs() {
    const tabs = $$('.cab-tab');
    tabs.forEach(btn => {
      btn.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        $$('.cab-panel').forEach(p => p.classList.remove('active'));
        const panel = $('#panel-' + btn.dataset.tab);
        if (panel) panel.classList.add('active');
      });
    });
  }

  // ======================================================================
  //  ВНЕШНИЙ ВИД: скин (3D-превью) + аватарка (кадрирование)
  //  Все загрузки файлов — через drag-and-drop зоны (клик открывает выбор).
  // ======================================================================

  // Drag-and-drop зона загрузки: клик открывает выбор файла,
  // можно перетащить файл прямо в зону.
  function makeFileDrop(zone, input, onFile) {
    if (!zone || !input) return;
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', e => {
      e.preventDefault();
      zone.classList.add('dragover');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('dragover');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) onFile(f);
    });
    input.addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      if (f) onFile(f);
      input.value = ''; // чтобы можно было выбрать тот же файл повторно
    });
  }

  // Скин по умолчанию для фолбэк-рендера (когда у пользователя нет своего)
  const DEFAULT_SKIN = 'img/skins/steve_original.png?v=2';

  // ---------- Дефолтный скин (классический Steve, 64x64) ----------
  function makeDefaultSkin() {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const x = c.getContext('2d');
    const fill = (sx, sy, sw, sh, col) => { x.fillStyle = col; x.fillRect(sx, sy, sw, sh); };

    const skin = '#c68e62', dark = '#b47d50', hair = '#5a3a28', hairDark = '#4a2f1f';
    const shirt = '#22a08e', shirtDark = '#17867a', sleeve = '#2aaf9e';
    const pants = '#3b4b91', pantsDark = '#2f3b77';
    const shoe = '#5c5c5c', shoeDark = '#454545';

    // --- голова ---
    fill(8, 0, 8, 8, hair);            // верх
    fill(16, 0, 8, 8, hair);           // низ
    fill(0, 8, 8, 8, hair);            // правая грань
    fill(24, 8, 8, 8, hair);           // зад
    fill(16, 8, 8, 8, hair);           // левая грань
    fill(8, 8, 8, 8, skin);            // лицо
    fill(8, 8, 8, 2, hair);            // чёлка
    fill(9, 11, 2, 2, '#ffffff');      // глаза
    fill(13, 11, 2, 2, '#ffffff');
    fill(9, 12, 2, 1, '#3f5bdb');      // зрачки
    fill(13, 12, 2, 1, '#3f5bdb');
    fill(11, 14, 2, 1, '#a87b4f');     // нос
    fill(10, 15, 4, 1, dark);          // рот
    // --- тело ---
    fill(16, 20, 4, 12, shirtDark);
    fill(20, 20, 8, 12, shirt);
    fill(28, 20, 4, 12, shirtDark);
    fill(32, 20, 8, 12, shirtDark);
    fill(20, 16, 8, 4, shirt);
    fill(28, 16, 8, 4, shirtDark);
    // --- правая рука ---
    fill(40, 20, 4, 12, shirtDark);
    fill(44, 20, 4, 12, shirt);
    fill(48, 20, 4, 12, shirtDark);
    fill(52, 20, 4, 12, shirtDark);
    fill(44, 16, 4, 4, sleeve);
    fill(48, 16, 4, 4, shirtDark);
    fill(44, 24, 4, 8, skin);
    fill(40, 24, 4, 8, dark);
    fill(48, 24, 4, 8, dark);
    fill(52, 24, 4, 8, dark);
    // --- левая рука ---
    fill(32, 52, 4, 12, shirtDark);
    fill(36, 52, 4, 12, shirt);
    fill(40, 52, 4, 12, shirtDark);
    fill(44, 52, 4, 12, shirtDark);
    fill(36, 48, 4, 4, sleeve);
    fill(40, 48, 4, 4, shirtDark);
    fill(36, 56, 4, 8, skin);
    fill(32, 56, 4, 8, dark);
    fill(40, 56, 4, 8, dark);
    fill(44, 56, 4, 8, dark);
    // --- правая нога ---
    fill(0, 20, 4, 12, pantsDark);
    fill(4, 20, 4, 12, pants);
    fill(8, 20, 4, 12, pantsDark);
    fill(12, 20, 4, 12, pantsDark);
    fill(4, 16, 4, 4, pants);
    fill(8, 16, 4, 4, pantsDark);
    fill(4, 28, 4, 4, shoe);
    fill(0, 28, 4, 4, shoeDark);
    fill(8, 28, 4, 4, shoeDark);
    fill(12, 28, 4, 4, shoeDark);
    // --- левая нога ---
    fill(16, 52, 4, 12, pantsDark);
    fill(20, 52, 4, 12, pants);
    fill(24, 52, 4, 12, pantsDark);
    fill(28, 52, 4, 12, pantsDark);
    fill(20, 48, 4, 4, pants);
    fill(24, 48, 4, 4, pantsDark);
    fill(20, 60, 4, 4, shoe);
    fill(16, 60, 4, 4, shoeDark);
    fill(24, 60, 4, 4, shoeDark);
    fill(28, 60, 4, 4, shoeDark);

    return c.toDataURL('image/png');
  }

  // ---------- 3D-превью скина (ФОЛБЭК, если three.js не загрузился) ----------
  // Персонаж собран из кубиков, текстуры — скин 64x64. Персонаж «шагает»
  // на месте, крутится перетаскиванием мыши и медленно вращается сам.
  // Основной рендер — three.js (js/skin3d.js); этот вариант — запасной.
  function start3DFallback(canvas, skinUrl) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;

    const skinImg = new Image();
    let raf = 0;
    let ready = false;
    let modelRot = 0.55;
    let rotTarget = null;
    let lastDrag = -1e9;
    let anim = 'walk';
    let jump = 0;

    function checkReady() {
      if (skinImg.complete) {
        if (raf) cancelAnimationFrame(raf);
        ready = true;
        loop(performance.now());
      }
    }
    skinImg.onload = checkReady;
    skinImg.onerror = () => {
      // Если файл-скин по умолчанию не загрузился — рисуем Стива на canvas
      if (skinImg.src !== DEFAULT_SKIN) { checkReady(); return; }
      skinImg.src = makeDefaultSkin();
      skinImg.onerror = checkReady;
    };
    skinImg.src = skinUrl || DEFAULT_SKIN;

    // UV-карта стандартного скина 64x64
    const uv = (x, y, w, h) => ({ x, y, w, h });
    const HEAD = { front: uv(8, 8, 8, 8), back: uv(24, 8, 8, 8), right: uv(0, 8, 8, 8), left: uv(16, 8, 8, 8), top: uv(8, 0, 8, 8), bottom: uv(16, 0, 8, 8) };
    const BODY = { front: uv(20, 20, 8, 12), back: uv(32, 20, 8, 12), right: uv(16, 20, 4, 12), left: uv(28, 20, 4, 12), top: uv(20, 16, 8, 4), bottom: uv(28, 16, 8, 4) };
    const ARM_R = { front: uv(44, 20, 4, 12), back: uv(52, 20, 4, 12), right: uv(40, 20, 4, 12), left: uv(48, 20, 4, 12), top: uv(44, 16, 4, 4), bottom: uv(48, 16, 4, 4) };
    const ARM_L = { front: uv(36, 52, 4, 12), back: uv(44, 52, 4, 12), right: uv(32, 52, 4, 12), left: uv(40, 52, 4, 12), top: uv(36, 48, 4, 4), bottom: uv(40, 48, 4, 4) };
    const LEG_R = { front: uv(4, 20, 4, 12), back: uv(12, 20, 4, 12), right: uv(0, 20, 4, 12), left: uv(8, 20, 4, 12), top: uv(4, 16, 4, 4), bottom: uv(8, 16, 4, 4) };
    const LEG_L = { front: uv(20, 52, 4, 12), back: uv(28, 52, 4, 12), right: uv(16, 52, 4, 12), left: uv(24, 52, 4, 12), top: uv(20, 48, 4, 4), bottom: uv(24, 48, 4, 4) };

    // Для старых 64x32 скинов (и скинов без отдельных левых конечностей)
    // левые руку/ногу берём из правых.
    function rectEmpty(img, r) {
      const t = document.createElement('canvas');
      t.width = r.w; t.height = r.h;
      const g = t.getContext('2d');
      g.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      const d = g.getImageData(0, 0, r.w, r.h).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return false;
      return true;
    }

    // 8 вершин куба (y вверх), грани как тройки A(top-left), B(top-right), C(bottom-left)
    const boxFaces = (w, h, d) => {
      const V = (sx, sy, sz) => [sx * w / 2, sy * h / 2, sz * d / 2];
      return {
        front: [V(-1, 1, 1), V(1, 1, 1), V(-1, -1, 1)],
        back: [V(1, 1, -1), V(-1, 1, -1), V(1, -1, -1)],
        right: [V(1, 1, -1), V(1, 1, 1), V(1, -1, -1)],
        left: [V(-1, 1, 1), V(-1, 1, -1), V(-1, -1, 1)],
        top: [V(-1, 1, 1), V(1, 1, 1), V(-1, 1, -1)],
        bottom: [V(-1, -1, 1), V(1, -1, 1), V(-1, -1, -1)],
      };
    };

    const S = 6.5;
    const CX = W / 2, GROUND = H - 16;

    function transformFace(face, off, pivot, ang, angZ) {
      const c = Math.cos(ang), s = Math.sin(ang);
      const cz = Math.cos(angZ || 0), sz = Math.sin(angZ || 0);
      const mc = Math.cos(modelRot), ms = Math.sin(modelRot);
      const out = [];
      for (const [vx, vy, vz] of face) {
        let x = off.x + vx - pivot.x;
        let y = off.y + vy - pivot.y;
        let z = off.z + vz - pivot.z;
        const nx = x * cz - y * sz;
        const ny = x * sz + y * cz;
        x = nx; y = ny;
        const ny2 = y * c - z * s;
        const nz = y * s + z * c;
        y = ny2; z = nz;
        x += pivot.x; y += pivot.y; z += pivot.z;
        const rx = x * mc + z * ms;
        const rz = -x * ms + z * mc;
        out.push({ x: CX + rx * S, y: GROUND - y * S, z: rz });
      }
      return out;
    }

    // Параметры анимаций: [скорость фазы, размах рук/ног, размах поворота в полёте, боб, наклон рук в стороны]
    const ANIMS = {
      walk: { speed: 1.0, swing: 0.55, flyArms: 0, bob: 1.0 },
      run:  { speed: 2.3, swing: 0.95, flyArms: 0, bob: 1.7 },
      fly:  { speed: 1.5, swing: 0.5, flyArms: 1, bob: 0.5 },
      idle: { speed: 0.45, swing: 0.1, flyArms: 0, bob: 0.4 },
    };
    const JUMP_TUCK = 1.15;

    function loop(t) {
      if (!ready) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // плавный поворот камеры к цели
      if (rotTarget !== null) {
        modelRot += (rotTarget - modelRot) * 0.08;
        if (Math.abs(rotTarget - modelRot) < 0.01) modelRot = rotTarget;
        lastDrag = Date.now();
      }

      // тень под персонажем (сжимается во время прыжка)
      const a = ANIMS[anim] || ANIMS.walk;
      const jumpH = jump * 14;
      const shadowScale = 1 - jump * 0.35;
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(CX, GROUND, 46 * shadowScale, 9 * shadowScale, 0, 0, Math.PI * 2);
      ctx.fill();

      const phase = t / 1000 * 2.6 * a.speed;
      const swing = a.swing;
      const bob = Math.abs(Math.sin(phase)) * 1.4 * a.bob;
      // в полёте руки вытянуты в стороны (поворот вокруг z)
      const flyArm = a.flyArms ? 1.35 : 0;

      const parts = [];
      const addBox = (w, h, d, off, pivot, ang, uvs, tex, facesOnly, angZ) => {
        const faces = boxFaces(w, h, d);
        const keys = facesOnly || ['top', 'bottom', 'right', 'left', 'front', 'back'];
        for (const key of keys) {
          const u = uvs[key];
          if (!u) continue;
          const pts = transformFace(faces[key], off, pivot, ang, angZ);
          parts.push({ A: pts[0], B: pts[1], C: pts[2], u, tex });
        }
      };

      // определение левых конечностей (по прозрачности региона)
      let armL = ARM_L, legL = LEG_L;
      if (rectEmpty(skinImg, ARM_L.front)) armL = ARM_R;
      if (rectEmpty(skinImg, LEG_L.front)) legL = LEG_R;

      const lift = jumpH;

      // ноги: в прыжке — поджаты; в полёте — прямые с лёгким махом
      let legSwing, legSwing2;
      if (jump > 0.05) { legSwing = -JUMP_TUCK; legSwing2 = JUMP_TUCK * 0.6; }
      else if (a.flyArms) { legSwing = Math.sin(phase) * swing * 0.6; legSwing2 = -legSwing; }
      else { legSwing = Math.sin(phase) * swing; legSwing2 = Math.sin(phase + Math.PI) * swing; }
      addBox(4, 12, 4, { x: -2, y: 6, z: 0 }, { x: -2, y: 12, z: 0 }, legSwing, legL, skinImg);
      addBox(4, 12, 4, { x: 2, y: 6, z: 0 }, { x: 2, y: 12, z: 0 }, legSwing2, LEG_R, skinImg);

      // тело
      addBox(8, 12, 4, { x: 0, y: 18 + bob + lift, z: 0 }, { x: 0, y: 24, z: 0 }, 0, BODY, skinImg);

      // руки: в прыжке подняты вверх, в полёте вытянуты в стороны
      let armSwing, armSwing2;
      if (jump > 0.05) { armSwing = -1.6; armSwing2 = -1.6; }
      else { armSwing = Math.sin(phase + Math.PI) * swing * 0.8; armSwing2 = Math.sin(phase) * swing * 0.8; }
      addBox(4, 12, 4, { x: -6, y: 18 + bob + lift, z: 0 }, { x: -6, y: 24, z: 0 }, armSwing, armL, skinImg, null, flyArm);
      addBox(4, 12, 4, { x: 6, y: 18 + bob + lift, z: 0 }, { x: 6, y: 24, z: 0 }, armSwing2, ARM_R, skinImg, null, -flyArm);

      // голова
      addBox(8, 8, 8, { x: 0, y: 30 + bob + lift, z: 0 }, { x: 0, y: 24, z: 0 }, Math.sin(phase * 0.5) * 0.05, HEAD, skinImg);

      parts.sort((a, b) => (b.A.z + b.B.z + b.C.z) - (a.A.z + a.B.z + a.C.z));
      for (const f of parts) {
        const cross = (f.B.x - f.A.x) * (f.C.y - f.A.y) - (f.B.y - f.A.y) * (f.C.x - f.A.x);
        if (cross <= 0) continue;
        ctx.setTransform(f.B.x - f.A.x, f.B.y - f.A.y, f.C.x - f.A.x, f.C.y - f.A.y, f.A.x, f.A.y);
        ctx.drawImage(f.tex, f.u.x, f.u.y, f.u.w, f.u.h, 0, 0, f.u.w, f.u.h);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      // прыжок затухает
      if (jump > 0) {
        jump = Math.max(0, jump - 0.035);
        if (jump <= 0) jump = 0;
      }

      // самовращение, когда персонажа не крутят
      if (rotTarget === null && Date.now() - lastDrag > 2500) modelRot += 0.004;

      raf = requestAnimationFrame(loop);
    }

    // ---------- Вращение перетаскиванием ----------
    let dragging = false, lastX = 0;
    canvas.addEventListener('pointerdown', e => {
      dragging = true;
      lastX = e.clientX;
      lastDrag = Date.now();
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    });
    canvas.addEventListener('pointermove', e => {
      if (!dragging) return;
      modelRot += (e.clientX - lastX) * 0.012;
      lastX = e.clientX;
      lastDrag = Date.now();
    });
    const endDrag = () => { dragging = false; lastDrag = Date.now(); };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    // ---------- Управление (общий API с three.js-версией) ----------
    canvas._skin3d = {
      controls: {
        setAnimation: name => { if (ANIMS[name]) anim = name; },
        rotateTo: rad => { rotTarget = rad; lastDrag = Date.now(); },
        jump: () => { jump = Math.min(1, jump + 0.6); },
      },
    };
  }

  function initAppearance(user) {
    const skinCanvas = $('#skin3d');
    const skinStatus = $('#skin-status');

    window.start3D(skinCanvas, user.skin);

    // ---------- Управление 3D-персонажем ----------
    // Анимации: ходьба / бег / полёт / покой + прыжок (действие) + повороты камеры.
    const animBtns = $$('#skin-actions [data-anim]');
    const viewBtns = $$('#skin-actions [data-view]');
    const jumpBtn = $('#skin-jump');
    const ctrl = () => skinCanvas._skin3d && skinCanvas._skin3d.controls;

    function setActive(group, el) {
      group.forEach(b => b.classList.remove('active'));
      el.classList.add('active');
    }
    animBtns.forEach(b => {
      b.addEventListener('click', () => {
        const c = ctrl();
        if (!c) return;
        setActive(animBtns, b);
        c.setAnimation(b.dataset.anim);
      });
    });
    viewBtns.forEach(b => {
      b.addEventListener('click', () => {
        const c = ctrl();
        if (!c) return;
        setActive(viewBtns, b);
        c.rotateTo(Number(b.dataset.view) * Math.PI / 180);
      });
    });
    if (jumpBtn) {
      jumpBtn.addEventListener('click', () => {
        const c = ctrl();
        if (!c) return;
        jumpBtn.classList.add('active');
        setTimeout(() => jumpBtn.classList.remove('active'), 350);
        c.jump();
      });
    }

    // ---------- Загрузка скина (drag-drop) ----------
    makeFileDrop($('#skin-drop'), $('#skin-input'), file => {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
        if (skinStatus) skinStatus.textContent = 'Можно загружать только PNG, JPG или WEBP';
        return;
      }
      const reader = new FileReader();
      reader.onload = ev => {
        Auth.updateCurrentUser(u => { u.skin = ev.target.result; });
        const fresh = getCurrentUser() || user;
        window.start3D(skinCanvas, fresh.skin);
        if (skinStatus) skinStatus.textContent = 'Скин сохранён';
        refreshSkinButtons();
      };
      reader.readAsDataURL(file);
    });

    // ---------- Сброс скина: вернуть дефолтный Стив ----------
    const skinReset = $('#skin-reset');
    if (skinReset) {
      skinReset.addEventListener('click', () => {
        Auth.updateCurrentUser(u => { u.skin = null; });
        const fresh = getCurrentUser() || user;
        window.start3D(skinCanvas, null);
        if (skinStatus) skinStatus.textContent = 'Скин сброшен на стандартный';
        refreshSkinButtons();
      });
    }

    // Кнопки сброса видны только когда скин/аватарка загружены
    const avatarReset = $('#avatar-reset');
    const preview = $('#avatar-preview');
    function refreshSkinButtons() {
      const fresh = getCurrentUser() || user;
      if (skinReset) skinReset.style.display = fresh.skin ? '' : 'none';
      if (avatarReset) avatarReset.style.display = fresh.avatar ? '' : 'none';
    }
    refreshSkinButtons();

    // ---------- Аватарка (drag-drop, с кадрированием в рамке квадрата) ----------
    const avatarStatus = $('#avatar-status');
    if (preview) {
      preview.src = user.avatar || '';
      preview.style.display = user.avatar ? '' : 'none';
    }

    // Сброс аватарки
    if (avatarReset) {
      avatarReset.addEventListener('click', () => {
        Auth.updateCurrentUser(u => { u.avatar = null; });
        if (avatarStatus) avatarStatus.textContent = 'Аватарка сброшена';
        if (preview) { preview.removeAttribute('src'); preview.style.display = 'none'; }
        refreshSkinButtons();
      });
    }

    makeFileDrop($('#avatar-drop'), $('#avatar-input'), file => {
      if (file.size > MAX_MEDIA) {
        if (avatarStatus) avatarStatus.textContent = 'Файл больше 5 МБ';
        return;
      }
      const reader = new FileReader();
      reader.onload = ev => {
        if (file.type === 'image/gif') {
          // GIF сохраняем как есть (кадрирование для гифок не делаем)
          Auth.updateCurrentUser(u => { u.avatar = ev.target.result; });
          if (avatarStatus) avatarStatus.textContent = 'Аватарка (GIF) сохранена';
          if (preview) { preview.src = ev.target.result; preview.style.display = ''; }
        } else {
          openCrop(ev.target.result, canvas => {
            const dataUrl = canvas.toDataURL('image/png');
            Auth.updateCurrentUser(u => { u.avatar = dataUrl; });
            if (avatarStatus) avatarStatus.textContent = 'Аватарка сохранена';
            if (preview) { preview.src = dataUrl; preview.style.display = ''; }
            refreshSkinButtons();
          }, {
            title: 'Настрой аватарку — круг в центре это она, двигай фото и зуми колесом',
          });
        }
      };
      reader.readAsDataURL(file);
    });
  }

  // ---------- Кадрирование ----------
  // Аватарка: фиксированный КРУГ (менять размер нельзя), фото затемнено вне круга.
  // Зум — колесо мыши, движение — перетаскивание. Слайдеров нет.
  // cfg: { title }
  // onSave(canvas) — готовый круглый аватар.
  function openCrop(dataUrl, onSave, cfg) {
    const overlay = $('#crop-overlay');
    const box = $('#crop-box');
    const img = $('#crop-img');
    const dark = $('#crop-dark');
    const zone = $('#crop-zone');
    const titleEl = $('#crop-title');
    const hint = $('#crop-hint');
    if (!overlay || !box || !img) return;

    cfg = cfg || {};
    if (titleEl) titleEl.textContent = cfg.title || 'Кадрирование';
    if (hint) hint.textContent = 'Колесо мыши — зум · тащи мышкой — двигай зону';

    // ---------- сброс от прошлого открытия ----------
    img.onload = null;
    img.onerror = null;
    box.classList.remove('crop-avatar');
    if (dark) dark.className = 'crop-dark';
    if (zone) zone.className = 'crop-zone';
    box.classList.add('crop-avatar');

    // ---------- размер зоны ----------
    // у аватарки зона — круг фиксированного диаметра (не меняется!)
    const AVATAR_ZONE = 240; // px диаметр круга в модалке
    let zoneW = AVATAR_ZONE;
    let zoneH = AVATAR_ZONE;

    function paintZone() {
      if (!dark || !zone) return;
      const r = zoneW / 2;
      // круг: затемнение через radial-gradient (внутри круга фото светлое)
      dark.style.background =
        'radial-gradient(circle ' + r + 'px at center, transparent 0%, transparent ' + (r - 1) + 'px, rgba(0,0,0,0.55) ' + r + 'px, rgba(0,0,0,0.55) 100%)';
      zone.style.width = zoneW + 'px';
      zone.style.height = zoneH + 'px';
      zone.style.borderRadius = '50%';
      zone.style.borderColor = 'var(--text)';
      zone.classList.add('crop-circle');
      zone.classList.remove('crop-rect');
    }

    // ---------- состояние ----------
    img.style.display = '';
    img.src = dataUrl;
    const natural = { w: 0, h: 0 };
    let baseScale = 1;
    let zoom = 1;
    let dx = 0, dy = 0;

    img.onload = () => {
      natural.w = img.naturalWidth;
      natural.h = img.naturalHeight;
      if (!natural.w || !natural.h) { close(); if (onSave) onSave(null); return; }
      // масштаб = фото полностью покрывает зону
      baseScale = Math.max(zoneW / natural.w, zoneH / natural.h);
      zoom = 1; dx = 0; dy = 0;
      applyTransform();
    };
    img.onerror = () => { close(); };

    function applyTransform(forceScale) {
      if (forceScale) baseScale = forceScale;
      const dispW = natural.w * baseScale * zoom;
      const dispH = natural.h * baseScale * zoom;
      // зона центрирована в боксе
      const bw = box.clientWidth || 480;
      const bh = box.clientHeight || 480;
      const zx = (bw - zoneW) / 2;
      const zy = (bh - zoneH) / 2;
      const maxDx = (dispW - zoneW) / 2;
      const maxDy = (dispH - zoneH) / 2;
      dx = Math.max(-maxDx, Math.min(maxDx, dx));
      dy = Math.max(-maxDy, Math.min(maxDy, dy));
      img.style.width = dispW + 'px';
      img.style.height = dispH + 'px';
      img.style.left = (zx + zoneW / 2 - dispW / 2 + dx) + 'px';
      img.style.top = (zy + zoneH / 2 - dispH / 2 + dy) + 'px';
      img.style.transform = 'none';
      paintZone();
    }

    // ---------- видимая зона в координатах исходника ----------
    function visibleSrc() {
      const scale = baseScale * zoom;
      const dispW = natural.w * scale;
      const dispH = natural.h * scale;
      const bw = box.clientWidth || 480;
      const bh = box.clientHeight || 480;
      const zx = (bw - zoneW) / 2;
      const zy = (bh - zoneH) / 2;
      const imgLeft = zx + zoneW / 2 - dispW / 2 + dx;
      const imgTop = zy + zoneH / 2 - dispH / 2 + dy;
      return {
        srcX: (zx - imgLeft) / scale,
        srcY: (zy - imgTop) / scale,
        srcW: zoneW / scale,
        srcH: zoneH / scale,
      };
    }

    // ---------- зум колесом ----------
    const onWheel = e => {
      if (!natural.w) return;
      e.preventDefault();
      const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      zoom = Math.max(1, Math.min(8, zoom * f));
      applyTransform();
    };
    box.addEventListener('wheel', onWheel, { passive: false });

    // ---------- перетаскивание ----------
    let dragging = false, startX = 0, startY = 0, startDx = 0, startDy = 0;
    const onMove = e => {
      if (!dragging) return;
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      dx = startDx + (cx - startX);
      dy = startDy + (cy - startY);
      applyTransform();
    };
    const onUp = () => {
      dragging = false;
      box.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
    };
    box.addEventListener('mousedown', e => {
      dragging = true;
      box.classList.add('dragging');
      startX = e.clientX; startY = e.clientY;
      startDx = dx; startDy = dy;
      e.preventDefault();
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    box.addEventListener('touchstart', e => {
      dragging = true;
      box.classList.add('dragging');
      startX = e.touches[0].clientX; startY = e.touches[0].clientY;
      startDx = dx; startDy = dy;
      e.preventDefault();
      document.addEventListener('touchmove', onMove);
      document.addEventListener('touchend', onUp);
    }, { passive: false });

    function close() {
      overlay.classList.remove('open');
      box.removeEventListener('wheel', onWheel);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
    }

    $('#crop-cancel').onclick = close;

    $('#crop-save').onclick = () => {
      const v = visibleSrc();
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 256;
      const ctx = canvas.getContext('2d');
      // аватарка: вырезаем КРУГ (прозрачные углы)
      ctx.imageSmoothingEnabled = true;
      ctx.beginPath();
      ctx.arc(128, 128, 128, 0, Math.PI * 2);
      ctx.clip();
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, v.srcX, v.srcY, v.srcW, v.srcH, 0, 0, 256, 256);
      if (onSave) onSave(canvas);
      close();
    };

    paintZone();
    overlay.classList.add('open');
  }




  // ======================================================================
  //  БОНУС: голосования за проект
  // ======================================================================
  function initBonus(user) {
    const host = $('#vote-list');
    if (!host) return;
    const sites = [
      { name: 'MC Rating', desc: 'Рейтинг серверов', reward: 10 },
      { name: 'MC Top', desc: 'Топ майнкрафт-серверов', reward: 10 },
      { name: 'TOP.MC', desc: 'Площадка голосований', reward: 10 },
      { name: 'MineCraftRating', desc: 'Голосование за сервер', reward: 10 },
    ];
    // TODO: точные сервисы и проверка голоса на бэкенде
    const today = new Date().toDateString();

    host.innerHTML = sites.map(s => `
      <div class="vote-card">
        <div class="vote-info">
          <b>${MC.esc(s.name)}</b>
          <span>${MC.esc(s.desc)} — ${s.reward} монет</span>
        </div>
        <a class="btn btn-sm" href="#" data-vote="${MC.esc(s.name)}">Проголосовать</a>
        <button class="btn btn-primary btn-sm" data-claim="${MC.esc(s.name)}" type="button">Получить бонус</button>
      </div>
    `).join('');

    const result = $('#vote-result');
    $$('[data-vote]', host).forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        if (result) result.textContent = 'Голосование — заглушка, сервисы добавим позже';
      });
    });

    $$('[data-claim]', host).forEach(btn => {
      btn.addEventListener('click', () => {
        const key = 'mc:voted:' + btn.dataset.claim + ':' + today;
        let claimed = false;
        try { claimed = localStorage.getItem(key) === '1'; } catch (e) {}
        if (claimed) {
          if (result) result.textContent = 'Бонус за сегодня уже получен';
          return;
        }
        Auth.updateCurrentUser(u => {
          Auth.addCoins(u, 10);
          Auth.addTransaction(u, 'in', 'Бонус за голосование: ' + btn.dataset.claim, '—', 10, 'coins');
        });
        try { localStorage.setItem(key, '1'); } catch (e) {}
        if (result) result.textContent = 'Получено +10 монет!';
        btn.disabled = true;
      });
    });
  }

  // ======================================================================
  //  РЕФЕРАЛЬНАЯ СИСТЕМА
  // ======================================================================
  function initReferral(user) {
    const linkInput = $('#ref-link');
    if (!linkInput) return;
    const link = location.origin + '/auth?ref=' + encodeURIComponent(user.name);
    linkInput.value = link;

    $('#ref-copy').addEventListener('click', () => {
      linkInput.select();
      try {
        navigator.clipboard.writeText(link);
      } catch (e) {
        document.execCommand('copy');
      }
      linkInput.value = 'Ссылка скопирована!';
      setTimeout(() => { linkInput.value = link; }, 1500);
    });

    const list = $('#ref-list');
    const refs = Array.isArray(user.referrals) ? user.referrals : [];
    if (!refs.length) {
      list.innerHTML = '<div class="text-muted" style="padding:20px;text-align:center">Пока никого не приглашено — поделись ссылкой!</div>';
      return;
    }
    list.innerHTML = refs.map(r => {
      const coins = (Number(r.hours) || 0) * 5; // 5 монет/час
      return `
        <div class="tx-row">
          <div>
            <div class="tx-title">${MC.esc(r.nick)}</div>
            <div class="tx-sub">Сыграно: ${Number(r.hours) || 0} час.</div>
          </div>
          <div class="tx-amount tx-in" style="font-size:15px">+${coins} монет</div>
        </div>
      `;
    }).join('');
  }

  // ======================================================================
  //  НАСТРОЙКИ
  // ======================================================================
  function initSettings(user) {
    // Смена пароля
    const passBtn = $('#set-pass-btn');
    const passErr = $('#set-pass-error');
    passBtn.addEventListener('click', () => {
      const cur = $('#set-pass-current').value;
      const n1 = $('#set-pass-new').value;
      const n2 = $('#set-pass-new2').value;
      if (!cur || !n1) { passErr.textContent = 'Заполните все поля'; return; }
      // TODO: bcrypt на бэкенде
      const curHash = btoa(unescape(encodeURIComponent('mc_salt::' + cur)));
      if (curHash !== user.passHash) { passErr.textContent = 'Неверный текущий пароль'; return; }
      if (n1.length < 8 || !/\d/.test(n1) || !/[A-ZА-Я]/.test(n1)) {
        passErr.textContent = 'Пароль: минимум 8 символов, цифра и заглавная буква';
        return;
      }
      if (n1 !== n2) { passErr.textContent = 'Пароли не совпадают'; return; }
      Auth.updateCurrentUser(u => { u.passHash = btoa(unescape(encodeURIComponent('mc_salt::' + n1))); });
      passErr.style.color = 'var(--success)';
      passErr.textContent = 'Пароль изменён';
      $('#set-pass-current').value = '';
      $('#set-pass-new').value = '';
      $('#set-pass-new2').value = '';
    });

    // Тема
    const themeName = $('#set-theme-name');
    const updateThemeName = () => {
      const t = document.documentElement.getAttribute('data-theme');
      themeName.textContent = t === 'white' ? 'белая' : 'тёмная';
    };
    updateThemeName();
    $('#set-theme').addEventListener('click', () => {
      if (window.MC) MC.toggleTheme();
      updateThemeName();
    });

    // Публичный профиль
    const desc = $('#set-desc');
    desc.value = user.description || '';
    const privacy = user.privacy || {};
    $('#pv-stats').checked = privacy.showStats !== false;
    $('#pv-time').checked = privacy.showTime !== false;
    $('#pv-priv').checked = privacy.showPrivilege !== false;
    $('#pv-desc').checked = privacy.showDescription !== false;
    $('#pv-banner').checked = privacy.showBanner !== false;

    makeFileDrop($('#banner-drop'), $('#set-banner'), file => {
      if (file.size > MAX_MEDIA) {
        $('#banner-status').textContent = 'Файл больше 5 МБ';
        return;
      }
      const reader = new FileReader();
      reader.onload = ev => {
        Auth.updateCurrentUser(u => { u.banner = ev.target.result; });
        $('#banner-status').textContent = 'Банер сохранён';
      };
      reader.readAsDataURL(file);
    });

    $('#set-profile-save').addEventListener('click', () => {
      const status = $('#set-profile-status');
      Auth.updateCurrentUser(u => {
        u.description = desc.value.trim().slice(0, 300);
        u.privacy = {
          showStats: $('#pv-stats').checked,
          showTime: $('#pv-time').checked,
          showPrivilege: $('#pv-priv').checked,
          showDescription: $('#pv-desc').checked,
          showBanner: $('#pv-banner').checked,
        };
      });
      status.style.color = 'var(--success)';
      status.textContent = 'Профиль сохранён';
    });
  }

  // ======================================================================
  //  2FA (заглушка)
  // ======================================================================
  function init2FA(user) {
    const toggle = $('#fa2-toggle');
    const status = $('#fa2-status');
    toggle.checked = !!user.twoFA;
    toggle.addEventListener('change', () => {
      Auth.updateCurrentUser(u => { u.twoFA = toggle.checked; });
      status.textContent = toggle.checked ? '2FA включена (заглушка, проверка позже)' : '2FA выключена';
    });
  }

  // ======================================================================
  //  СПОСОБЫ АВТОРИЗАЦИИ
  // ======================================================================
  function initProviders(user) {
    const host = $('#providers-list');
    if (!host) return;
    const ALL = [
      { id: 'email', name: 'Email / пароль' },
      { id: 'telegram', name: 'Telegram' },
      { id: 'vk', name: 'ВКонтакте' },
      { id: 'yandex', name: 'Яндекс' },
    ];
    // TODO: реальная привязка OAuth на бэкенде

    function render() {
      const u = Auth.getCurrentUser();
      const providers = Array.isArray(u.providers) ? u.providers : ['email'];
      host.innerHTML = ALL.map(p => {
        const bound = providers.includes(p.id);
        const locked = p.id === 'email';
        return `
          <div class="prov-row">
            <div class="prov-name">${MC.esc(p.name)}</div>
            <span class="prov-status badge ${bound ? 'badge-bound' : 'badge-unbound'}">
              ${bound ? 'Привязан' : 'Не привязан'}
            </span>
            ${locked
              ? '<span class="text-muted" style="font-size:13px">обязательный</span>'
              : `<button class="btn btn-sm" data-prov="${p.id}" data-act="${bound ? 'unbind' : 'bind'}" type="button">${bound ? 'Отвязать' : 'Привязать'}</button>`}
          </div>
        `;
      }).join('');

      $$('[data-prov]', host).forEach(btn => {
        btn.addEventListener('click', () => {
          const pid = btn.dataset.prov;
          const act = btn.dataset.act;
          Auth.updateCurrentUser(u => {
            if (!Array.isArray(u.providers)) u.providers = ['email'];
            if (act === 'bind' && !u.providers.includes(pid)) u.providers.push(pid);
            if (act === 'unbind') u.providers = u.providers.filter(x => x !== pid);
          });
          render();
        });
      });
    }
    render();
  }

  // ======================================================================
  //  ИСТОРИЯ ТРАНЗАКЦИЙ
  // ======================================================================
  function initTransactions(user) {
    const list = $('#tx-list');
    if (!list) return;
    let filter = 'all';

    function render() {
      const u = Auth.getCurrentUser();
      const txs = Array.isArray(u.transactions) ? u.transactions : [];
      const filtered = txs.filter(t => filter === 'all' || t.type === filter);

      if (!filtered.length) {
        list.innerHTML = '<div class="text-muted" style="padding:24px;text-align:center">Транзакций нет</div>';
        return;
      }
      list.innerHTML = filtered.map(t => `
        <div class="tx-row">
          <div>
            <div class="tx-title">${MC.esc(t.title)}</div>
            <div class="tx-sub">${MC.esc(t.server || '—')} · ${MC.esc(t.date)}</div>
          </div>
          <div class="tx-amount tx-${t.type === 'in' ? 'in' : 'out'}">${fmtAmount(t)}</div>
        </div>
      `).join('');
    }

    $$('#panel-transactions .os-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('#panel-transactions .os-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        filter = btn.dataset.tx;
        render();
      });
    });

    render();
  }

  // Запасной 2D-рендер (если three.js не загрузился)
  window.start3DFallback = start3DFallback;

  document.addEventListener('DOMContentLoaded', initProfilePage);
})();
