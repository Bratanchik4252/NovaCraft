/* ==========================================================================
   skin3d.js — 3D-превью скина на three.js (WebGL)
   Рисует воксельного персонажа из кубиков с UV-картой скина 64x64,
   анимацией ходьбы, плащом, тенью, вращением мышью и авто-вращением.
   Заменяет старый 2D-рендер (он остаётся как фолбэк: start3DFallback).
   three.js подключается с CDN (как Google Fonts); если не загрузился —
   используется запасной 2D-рендер.
   ========================================================================== */

'use strict';

(function () {
  // Скин по умолчанию для модели (когда у пользователя нет своего)
  const DEFAULT_SKIN = 'img/skins/Flux_B13_Killer.png';

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

    fill(8, 0, 8, 8, hair);
    fill(16, 0, 8, 8, hair);
    fill(0, 8, 8, 8, hair);
    fill(24, 8, 8, 8, hair);
    fill(16, 8, 8, 8, hair);
    fill(8, 8, 8, 8, skin);
    fill(8, 8, 8, 2, hair);
    fill(9, 11, 2, 2, '#ffffff');
    fill(13, 11, 2, 2, '#ffffff');
    fill(9, 12, 2, 1, '#3f5bdb');
    fill(13, 12, 2, 1, '#3f5bdb');
    fill(11, 14, 2, 1, '#a87b4f');
    fill(10, 15, 4, 1, dark);
    fill(16, 20, 4, 12, shirtDark);
    fill(20, 20, 8, 12, shirt);
    fill(28, 20, 4, 12, shirtDark);
    fill(32, 20, 8, 12, shirtDark);
    fill(20, 16, 8, 4, shirt);
    fill(28, 16, 8, 4, shirtDark);
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

  // UV-карта стандартного скина 64x64
  const uv = (x, y, w, h) => ({ x, y, w, h });
  const HEAD = { front: uv(8, 8, 8, 8), back: uv(24, 8, 8, 8), right: uv(0, 8, 8, 8), left: uv(16, 8, 8, 8), top: uv(8, 0, 8, 8), bottom: uv(16, 0, 8, 8) };
  const BODY = { front: uv(20, 20, 8, 12), back: uv(32, 20, 8, 12), right: uv(16, 20, 4, 12), left: uv(28, 20, 4, 12), top: uv(20, 16, 8, 4), bottom: uv(28, 16, 8, 4) };
  const ARM_R = { front: uv(44, 20, 4, 12), back: uv(52, 20, 4, 12), right: uv(40, 20, 4, 12), left: uv(48, 20, 4, 12), top: uv(44, 16, 4, 4), bottom: uv(48, 16, 4, 4) };
  const ARM_L = { front: uv(36, 52, 4, 12), back: uv(44, 52, 4, 12), right: uv(32, 52, 4, 12), left: uv(40, 52, 4, 12), top: uv(36, 48, 4, 4), bottom: uv(40, 48, 4, 4) };
  const LEG_R = { front: uv(4, 20, 4, 12), back: uv(12, 20, 4, 12), right: uv(0, 20, 4, 12), left: uv(8, 20, 4, 12), top: uv(4, 16, 4, 4), bottom: uv(8, 16, 4, 4) };
  const LEG_L = { front: uv(20, 52, 4, 12), back: uv(28, 52, 4, 12), right: uv(16, 52, 4, 12), left: uv(24, 52, 4, 12), top: uv(20, 48, 4, 4), bottom: uv(24, 48, 4, 4) };

  // Проверка пустого региона (для зеркала левых конечностей на 64x32 скинах)
  function regionEmpty(img, r) {
    const t = document.createElement('canvas');
    t.width = r.w; t.height = r.h;
    const g = t.getContext('2d');
    g.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    const d = g.getImageData(0, 0, r.w, r.h).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return false;
    return true;
  }

  function regionTexture(img, r) {
    const c = document.createElement('canvas');
    c.width = r.w; c.height = r.h;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    return tex;
  }

  // ---------- Главная функция ----------
  window.start3D = function (canvas, skinUrl, capeUrl) {
    if (!canvas) return;
    if (!window.THREE) {
      if (window.start3DFallback) window.start3DFallback(canvas, skinUrl, capeUrl);
      return;
    }

    // Перезапуск: освобождаем старую сцену (если перезагружают скин)
    if (canvas._skin3d) {
      try { canvas._skin3d.dispose(); } catch (e) {}
      canvas._skin3d = null;
    }

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch (e) {
      if (window.start3DFallback) window.start3DFallback(canvas, skinUrl, capeUrl);
      return;
    }

    const W = canvas.width || 240;
    const H = canvas.height || 280;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H, false);
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 100);
    camera.position.set(3.5, 5.0, 13.5);
    camera.lookAt(0, 4.1, 0);

    // Свет: мягкая подсветка, чтобы было видно объём
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dir = new THREE.DirectionalLight(0xffffff, 0.5);
    dir.position.set(4, 6, 5);
    scene.add(dir);
    const rim = new THREE.DirectionalLight(0xffffff, 0.25);
    rim.position.set(-4, 2, -3);
    scene.add(rim);

    // Тень под персонажем
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1.7, 40),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.01;
    scene.add(shadow);

    const group = new THREE.Group();
    scene.add(group);

    const skinImg = new Image();
    let capeImg = capeUrl ? new Image() : null;
    let started = false;
    let raf = 0;
    let parts = {};

    function buildModel() {
      let armL = ARM_L, legL = LEG_L;
      if (regionEmpty(skinImg, ARM_L.front)) armL = ARM_R;
      if (regionEmpty(skinImg, LEG_L.front)) legL = LEG_R;

      const mat = (img, r) => new THREE.MeshLambertMaterial({ map: regionTexture(img, r), alphaTest: 0.5 });
      const makePart = (w, h, d, rmap, pivotTop) => {
        const geo = new THREE.BoxGeometry(w, h, d);
        if (pivotTop) geo.translate(0, -h / 2, 0);
        const mats = [
          mat(skinImg, rmap.right), mat(skinImg, rmap.left),
          mat(skinImg, rmap.top), mat(skinImg, rmap.bottom),
          mat(skinImg, rmap.front), mat(skinImg, rmap.back),
        ];
        return new THREE.Mesh(geo, mats);
      };

      // 1 юнит = 4 пикселя скина; фигура высотой ~8 юнитов (ноги 0..3, тело 3..6, голова 6..8)
      parts.body = makePart(2, 3, 1, BODY, false);
      parts.body.position.set(0, 4.5, 0);
      parts.head = makePart(2, 2, 2, HEAD, false);
      parts.head.position.set(0, 7.0, 0);
      parts.legR = makePart(1, 3, 1, LEG_R, true);
      parts.legR.position.set(0.5, 3, 0);
      parts.legL = makePart(1, 3, 1, legL, true);
      parts.legL.position.set(-0.5, 3, 0);
      parts.armR = makePart(1, 3, 1, ARM_R, true);
      parts.armR.position.set(1.5, 6, 0);
      parts.armL = makePart(1, 3, 1, armL, true);
      parts.armL.position.set(-1.5, 6, 0);

      Object.values(parts).forEach(m => group.add(m));

      if (capeImg && capeImg.complete) {
        const cgeo = new THREE.PlaneGeometry(2, 3, 1, 10);
        cgeo.translate(0, -1.5, 0);
        const ctex = regionTexture(capeImg, { x: 0, y: 0, w: capeImg.width, h: capeImg.height });
        parts.cape = new THREE.Mesh(cgeo, new THREE.MeshLambertMaterial({
          map: ctex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, depthWrite: false,
        }));
        parts.cape.position.set(0, 4.5, -0.55);
        group.add(parts.cape);
      }
    }

    function animate(t) {
      const phase = t / 1000 * 2.6;
      const bob = Math.abs(Math.sin(phase)) * 0.14;

      if (parts.body) {
        parts.body.position.y = 4.5 + bob;
        parts.head.position.y = 7.0 + bob;
        parts.legR.rotation.x = Math.sin(phase) * 0.55;
        parts.legL.rotation.x = Math.sin(phase + Math.PI) * 0.55;
        parts.armR.rotation.x = Math.sin(phase + Math.PI) * 0.45;
        parts.armL.rotation.x = Math.sin(phase) * 0.45;
        parts.legR.position.y = 3 + bob;
        parts.legL.position.y = 3 + bob;
        parts.armR.position.y = 6 + bob;
        parts.armL.position.y = 6 + bob;
        parts.head.rotation.y = Math.sin(phase * 0.5) * 0.05;
      }
      if (parts.cape) {
        parts.cape.position.y = 4.5 + bob;
        parts.cape.rotation.z = Math.sin(phase * 0.5) * 0.12;
      }

      if (Date.now() - lastDrag > 2500) modelRot += 0.004;
      group.rotation.y = modelRot;

      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    }

    function start() {
      if (started) return;
      if (!skinImg.complete) return;
      if (capeUrl && capeImg && !capeImg.complete) return;
      started = true;
      buildModel();
      raf = requestAnimationFrame(animate);
    }

    // ---------- Вращение перетаскиванием ----------
    let dragging = false, lastX = 0, lastDrag = -1e9, modelRot = 0.55;
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

    // ---------- Очистка ----------
    canvas._skin3d = {
      dispose() {
        cancelAnimationFrame(raf);
        try {
          scene.traverse(o => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) {
              if (Array.isArray(o.material)) o.material.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
              else { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
            }
          });
        } catch (e) {}
        renderer.dispose();
      },
    };

    skinImg.onload = start;
    skinImg.onerror = () => {
      // Если файл-скин по умолчанию не загрузился — рисуем Стива на canvas
      if (skinImg.src !== DEFAULT_SKIN) { start(); return; }
      skinImg.src = makeDefaultSkin();
      skinImg.onerror = start;
    };
    skinImg.src = skinUrl || DEFAULT_SKIN;
    if (capeImg) {
      capeImg.onload = start;
      capeImg.onerror = () => { capeImg = null; start(); };
      capeImg.src = capeUrl;
    }
  };
})();
