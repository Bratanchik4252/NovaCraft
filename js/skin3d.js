/* ==========================================================================
   skin3d.js — 3D-превью скина через skinview3d (three.js), как на loliland.net
   Использует те же параметры, что и они: fov 10, zoom 1, WalkAnimation,
   вращение мышью (OrbitControls), поворот модели на -0.5 по Y.
   skinview3d умеет элитры, уши, плащ и корректно рендерит любые скины 64x64/64x32.
   Если skinview3d не загрузился — запасной 2D-рендер (start3DFallback).
   ========================================================================== */

'use strict';

(function () {
  // Скин по умолчанию для модели (когда у пользователя нет своего)
  const DEFAULT_SKIN = 'img/skins/steve_original.png?v=2';

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
        animation: new skinview3d.WalkAnimation(),
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
    if (capeUrl && viewer.player && viewer.player.cape) {
      viewer.loadCape(capeUrl);
    }

    // ---------- Очистка ----------
    canvas._skin3d = {
      dispose() {
        try { viewer.dispose(); } catch (e) {}
      },
    };
  };
})();
