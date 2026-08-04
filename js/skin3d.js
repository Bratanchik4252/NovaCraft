/* ==========================================================================
   skin3d.js — 3D-превью скина через skinview3d (three.js), как на loliland.net
   Использует те же параметры, что и они: fov 10, zoom 1, WalkAnimation,
   вращение мышью (OrbitControls), поворот модели на -0.5 по Y.
   skinview3d умеет элитры, уши, плащ и корректно рендерит любые скины 64x64/64x32.
   Если skinview3d не загрузился — запасной 2D-рендер (start3DFallback).

   Плащ: юзер кадрирует картинку в ВЕРТИКАЛЬНУЮ рамку формы плаща (наружная
   грань 10x16), кроп пакуется в наружную грань текстуры плаща + зеркало на
   внутреннюю. Размер выбирается слайдером «тип плаща» (Классик/HD/UHD).
   ========================================================================== */

'use strict';

(function () {
  // Скин по умолчанию для модели (когда у пользователя нет своего)
  const DEFAULT_SKIN = 'img/skins/steve_original.png?v=2';

  // ---------- Типы плаща ----------
  // Масштаб текстуры: классик 64x32 (scale 1), HD 128x64 (scale 2), UHD 256x128 (scale 4).
  // Геометрия плаща в skinview3d — бокс 10x16x1, UV наружной грани читает колонки
  // 1..10 (x=1*sc..10*sc, y=1*sc..16*sc), внутренняя грань — 12..21 (x=12*sc..21*sc).
  const CAPE_TYPES = [
    { label: 'Классик 64×32', scale: 1 },
    { label: 'HD 128×64', scale: 2 },
    { label: 'UHD 256×128', scale: 4 },
  ];

  // Координаты граней в файле размера (64*scale) x (32*scale)
  function capeOuter(sc) { return { x: 1 * sc, y: 1 * sc, w: 10 * sc, h: 16 * sc }; }
  function capeInner(sc) { return { x: 12 * sc, y: 1 * sc, w: 10 * sc, h: 16 * sc }; }

  function capeScaleOfWidth(w) {
    if (w >= 128) return 2;
    return 1;
  }

  // ---------- Паковка кропа (вертикальная рамка 10:16) в файл плаща ----------
  // srcCanvas — канвас с соотношением 10:16 (то, что юзер поместил в рамку).
  // Рисуем его ровно в наружную грань + зеркалим в внутреннюю, остальное прозрачно.
  window.packCapeCrop = function (srcCanvas, scale) {
    const sc = scale || 1;
    const out = document.createElement('canvas');
    out.width = 64 * sc;
    out.height = 32 * sc;
    const g = out.getContext('2d');
    g.clearRect(0, 0, out.width, out.height);
    g.imageSmoothingEnabled = false;

    const outer = capeOuter(sc);
    // Рисуем кроп (любой размер, пропорция 10:16) без искажений в наружную грань
    let s = Math.min(outer.w / srcCanvas.width, outer.h / srcCanvas.height);
    let dw = srcCanvas.width * s;
    let dh = srcCanvas.height * s;
    g.drawImage(srcCanvas, 0, 0, srcCanvas.width, srcCanvas.height,
      outer.x + (outer.w - dw) / 2, outer.y + (outer.h - dh) / 2, dw, dh);

    // Зеркало на внутреннюю грань
    const inner = capeInner(sc);
    g.save();
    g.translate(inner.x + inner.w, 0);
    g.scale(-1, 1);
    g.drawImage(srcCanvas, 0, 0, srcCanvas.width, srcCanvas.height,
      -(inner.x + inner.w) + (inner.x + (inner.w - dw) / 2), inner.y + (inner.h - dh) / 2, dw, dh);
    g.restore();

    return out.toDataURL('image/png');
  };

  // ---------- Превью наружной грани плаща (вертикальная картинка 10:16) ----------
  // Достаёт наружную грань из готового файла плаща для плоского превью.
  window.getCapeFace = function (capeDataUrl, outW, outH) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const sc = capeScaleOfWidth(img.naturalWidth);
        const outer = capeOuter(sc);
        const c = document.createElement('canvas');
        c.width = outW || 100;
        c.height = outH || Math.round((outW || 100) * 1.6);
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = false;
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, outer.x, outer.y, outer.w, outer.h, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = () => resolve(null);
      img.src = capeDataUrl;
    });
  };

  // ---------- Кол-во типов плаща для слайдера ----------
  window.CAPE_TYPES = CAPE_TYPES;

  // ---------- Главная функция ----------
  window.start3D = function (canvas, skinUrl, capeUrl) {
    if (!canvas) return;
    if (!window.skinview3d) {
      if (window.start3DFallback) window.start3DFallback(canvas, skinUrl, capeUrl);
      return;
    }

    // Перезапуск: освобождаем старую сцену (если перезагружают скин)
    if (canvas._skin3d) {
      try { canvas._skin3d.dispose(); } catch (e) {}
      canvas._skin3d = null;
    }

    const W = canvas.width || 300;
    const H = canvas.height || 356;

    let viewer;
    try {
      // Те же параметры, что в кабинете loliland.net:
      // height 356, fov 10, zoom 1, WalkAnimation, rotation -0.5
      viewer = new skinview3d.SkinViewer({
        canvas,
        width: W,
        height: H,
        skin: skinUrl || DEFAULT_SKIN,
        fov: 10,
        zoom: 1,
        animation: new skinview3d.WalkingAnimation(),
      });
      viewer.controls.enableZoom = false;
      viewer.controls.enablePan = false;
      viewer.playerWrapper.rotation.y = -0.5;
      viewer.animation.speed = 0.6;
    } catch (e) {
      if (window.start3DFallback) window.start3DFallback(canvas, skinUrl, capeUrl);
      return;
    }

    // Плащ (если передан) — как отдельная текстура на спине.
    if (capeUrl && viewer.playerObject && viewer.playerObject.cape) {
      try {
        viewer.loadCape(capeUrl);
      } catch (e) {
        // Плохой плащ не роняет превью скина — просто рисуем без него
      }
    }

    // ---------- Очистка ----------
    canvas._skin3d = {
      dispose() {
        try { viewer.dispose(); } catch (e) {}
      },
    };
  };
})();