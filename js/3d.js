/* ==========================================================================
   3d.js — CSS-куб земли для главной страницы
   Текстуры генерируются через Canvas (без внешних картинок, производительно).
   Вращение и затухание при скролле.
   ========================================================================== */

'use strict';

(function () {
  // ---------- Генерация текстуры дёрна (стороны) ----------
  function makeDirtTexture(seed) {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    const ctx = c.getContext('2d');

    // Базовый «шумный» коричневый цвет
    const palette = ['#79553a', '#6d4b33', '#8a6243', '#5d3f2b', '#9c7247'];
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const n = Math.abs(Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453) % 1;
        const color = palette[Math.floor(n * palette.length)];
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      }
    }

    // Полоска дёрна сверху (зелёная трава)
    const grassPalette = ['#5f9e3f', '#74b04c', '#4f8a35', '#86c45c'];
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 4; y++) {
        const n = Math.abs(Math.sin(x * 31.9898 + y * 7.233 + seed * 2) * 43758.5453) % 1;
        ctx.fillStyle = grassPalette[Math.floor(n * grassPalette.length)];
        ctx.fillRect(x, y, 1, 1);
      }
    }
    return toDataURL(c);
  }

  // ---------- Генерация текстуры верха (трава) ----------
  function makeGrassTopTexture(seed) {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    const ctx = c.getContext('2d');
    const palette = ['#5f9e3f', '#74b04c', '#4f8a35', '#86c45c', '#6aa644'];
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const n = Math.abs(Math.sin(x * 7.9898 + y * 13.233 + seed) * 43758.5453) % 1;
        ctx.fillStyle = palette[Math.floor(n * palette.length)];
        ctx.fillRect(x, y, 1, 1);
      }
    }
    return toDataURL(c);
  }

  function toDataURL(canvas) {
    const up = document.createElement('canvas');
    up.width = 64;
    up.height = 64;
    const ctx = up.getContext('2d');
    ctx.imageSmoothingEnabled = false; // пиксель-арт, как в майнкрафте
    ctx.drawImage(canvas, 0, 0, 64, 64);
    return up.toDataURL('image/png');
  }

  // ---------- Сборка куба ----------
  function initDirtCube() {
    const scene = $('#cube-scene');
    const cube = $('#dirt-cube');
    if (!scene || !cube) return;

    const side = makeDirtTexture(11);
    const top = makeGrassTopTexture(5);
    const bottom = makeDirtTexture(3);

    const faces = {
      top: top,
      bottom: bottom,
      front: side,
      back: side,
      left: side,
      right: side,
    };

    for (const [name, url] of Object.entries(faces)) {
      const face = cube.querySelector(`.face.${name}`);
      if (face) face.style.backgroundImage = `url("${url}")`;
    }

    // Исчезновение при скролле вниз (Intersection Observer)
    const io = new IntersectionObserver(
      entries => {
        entries.forEach(en => {
          scene.classList.toggle('hidden', !en.isIntersecting);
        });
      },
      { threshold: 0.2 }
    );
    io.observe(scene);
  }

  document.addEventListener('DOMContentLoaded', initDirtCube);
})();
