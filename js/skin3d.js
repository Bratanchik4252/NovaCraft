/* ==========================================================================
   skin3d.js — 3D-превью скина через skinview3d (three.js), как на loliland.net
   Использует те же параметры, что и они: fov 10, zoom 1, WalkAnimation,
   вращение мышью (OrbitControls), поворот модели на -0.5 по Y.
   skinview3d умеет элитры, уши и корректно рендерит любые скины 64x64/64x32.
   Если skinview3d не загрузился — запасной 2D-рендер (start3DFallback).

   Управление (кнопки в кабинете) — через canvas._skin3d.controls:
     setAnimation('walk'|'run'|'fly'|'idle') — смена анимации
     rotateTo(rad)                          — плавный поворот камеры (абсолютный угол)
     jump()                                 — прыжок (поза + подъём, потом затухает)
   ========================================================================== */

'use strict';

(function () {
  // Скин по умолчанию для модели (когда у пользователя нет своего)
  const DEFAULT_SKIN = 'img/skins/steve_original.png?v=2';

  // ---------- Главная функция ----------
  window.start3D = function (canvas, skinUrl) {
    if (!canvas) return;
    if (!window.skinview3d) {
      if (window.start3DFallback) window.start3DFallback(canvas, skinUrl);
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
      if (window.start3DFallback) window.start3DFallback(canvas, skinUrl);
      return;
    }

    // ---------- Анимации ----------
    const ANIMS = {
      walk: () => new skinview3d.WalkingAnimation(),
      run: () => new skinview3d.RunningAnimation(),
      fly: () => new skinview3d.FlyingAnimation(),
      idle: () => {
        // IdleAnimation есть не во всех сборках — если нет, берём ходьбу на малой скорости
        if (skinview3d.IdleAnimation) return new skinview3d.IdleAnimation();
        return new skinview3d.WalkingAnimation();
      },
    };
    const ANIM_SPEED = { walk: 0.6, run: 1.1, fly: 1.0, idle: 0.4 };

    // ---------- Свои rAF-циклы (прыжок, поворот камеры) ----------
    const rafs = new Set();
    function rLoop(fn) {
      let raf = 0;
      const step = t => {
        if (!rafs.has(raf)) return; // остановлено при dispose
        if (fn(t) !== false) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      rafs.add(raf);
    }
    function rStop() {
      rafs.forEach(id => cancelAnimationFrame(id));
      rafs.clear();
    }

    // ---------- Прыжок ----------
    // Поза: руки вверх, ноги поджаты; тело приподнимается и опускается.
    let jumpT = 0; // 1 -> 0
    function doJump() {
      if (jumpT > 0 || !viewer.playerObject) return;
      jumpT = 1;
      rLoop(() => {
        jumpT -= 0.016 / 0.55; // прыжок ~0.55 c
        const p = 1 - jumpT;   // 0..1
        if (jumpT <= 0) {
          jumpT = 0;
          viewer.playerWrapper.position.y = 0;
          restoreLimbs();
          return false;
        }
        viewer.playerWrapper.position.y = Math.sin(p * Math.PI) * 0.9;
        setLimbs({
          leftArm: -2.6, rightArm: -2.6,
          leftLeg: -1.3, rightLeg: 1.0,
        });
      });
    }
    let limbCache = null;
    function setLimbs(poses) {
      if (!viewer.playerObject) return;
      if (!limbCache) {
        limbCache = {};
        for (const name of Object.keys(poses)) {
          const part = viewer.playerObject[name];
          if (part) limbCache[name] = { x: part.rotation.x, y: part.rotation.y, z: part.rotation.z };
        }
      }
      for (const name of Object.keys(poses)) {
        const part = viewer.playerObject[name];
        if (part) part.rotation.x = poses[name];
      }
    }
    function restoreLimbs() {
      if (!limbCache) return;
      for (const name of Object.keys(limbCache)) {
        const part = viewer.playerObject[name];
        if (part) {
          part.rotation.x = limbCache[name].x;
          part.rotation.y = limbCache[name].y;
          part.rotation.z = limbCache[name].z;
        }
      }
      limbCache = null;
    }

    // ---------- Плавный поворот камеры ----------
    function rotateTo(rad) {
      rLoop(() => {
        const d = rad - viewer.playerWrapper.rotation.y;
        if (Math.abs(d) < 0.005) {
          viewer.playerWrapper.rotation.y = rad;
          return false;
        }
        viewer.playerWrapper.rotation.y += d * 0.09;
      });
    }

    // ---------- Управление ----------
    canvas._skin3d = {
      controls: {
        setAnimation(name) {
          if (!ANIMS[name]) return;
          try {
            viewer.animation = ANIMS[name]();
            viewer.animation.speed = ANIM_SPEED[name] || 1;
          } catch (e) {}
        },
        rotateTo,
        jump: doJump,
      },
      dispose() {
        rStop();
        try { viewer.dispose(); } catch (e) {}
      },
    };
  };
})();
