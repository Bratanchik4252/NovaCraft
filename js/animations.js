/* ==========================================================================
   animations.js — анимации:
   частицы-квадратики в герое (Canvas), печать текста, анимированные счётчики.
   ========================================================================== */

'use strict';

(function () {
  // ---------- Анимированные частицы в герое ----------
  function initParticles() {
    const canvas = $('#particles');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let width, height;
    const particles = [];
    const COUNT = 70;

    function resize() {
      width = canvas.width = canvas.offsetWidth;
      height = canvas.height = canvas.offsetHeight;
    }

    function spawn(initial = false) {
      return {
        x: Math.random() * width,
        y: initial ? Math.random() * height : height + 10,
        size: 1 + Math.random() * 3,
        speedY: 0.2 + Math.random() * 0.8,
        drift: (Math.random() - 0.5) * 0.3,
        alpha: 0.15 + Math.random() * 0.55,
        phase: Math.random() * Math.PI * 2,
      };
    }

    function init() {
      resize();
      particles.length = 0;
      for (let i = 0; i < COUNT; i++) particles.push(spawn(true));
    }

    function tick(t) {
      ctx.clearRect(0, 0, width, height);
      for (const p of particles) {
        p.y -= p.speedY;
        p.x += p.drift + Math.sin(t / 900 + p.phase) * 0.15;
        if (p.y < -10 || p.x < -10 || p.x > width + 10) Object.assign(p, spawn());
        const twinkle = 0.6 + 0.4 * Math.sin(t / 400 + p.phase);
        ctx.globalAlpha = p.alpha * twinkle;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(p.x, p.y, p.size, p.size);
      }
      requestAnimationFrame(tick);
    }

    init();
    window.addEventListener('resize', init);
    requestAnimationFrame(tick);
  }

  // ---------- Печать текста (эффект typewriter) ----------
  function initTypewriter() {
    const el = $('#typewriter');
    if (!el) return;

    const fullText = el.dataset.text || el.textContent;
    el.textContent = '';
    el.insertAdjacentHTML('beforeend', '<span class="type-caret"></span>');
    const caret = el.querySelector('.type-caret');

    let index = 0;
    const speed = 28;

    // Начинаем печатать, когда элемент виден
    const io = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting) {
          io.disconnect();
          (function type() {
            if (index <= fullText.length) {
              caret.insertAdjacentText('beforebegin', fullText.slice(index - 1, index));
              index++;
              setTimeout(type, speed);
            }
          })();
        }
      },
      { threshold: 0.4 }
    );
    io.observe(el);
  }

  // ---------- Анимированные счётчики ----------
  function initCounters() {
    const els = $$('[data-counter]');
    if (!els.length) return;

    const io = new IntersectionObserver(
      entries => {
        entries.forEach(en => {
          if (!en.isIntersecting) return;
          io.unobserve(en.target);
          animateCounter(en.target);
        });
      },
      { threshold: 0.4 }
    );
    els.forEach(el => io.observe(el));
  }

  function animateCounter(el) {
    const target = parseFloat(el.dataset.counter);
    const duration = 1400;
    const start = performance.now();
    const format = (n) => {
      let s = Math.floor(n).toString();
      if (el.dataset.sep) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, el.dataset.sep);
      if (el.dataset.suffix) s += el.dataset.suffix;
      return s;
    };

    function frame(now) {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = format(target * eased);
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  document.addEventListener('DOMContentLoaded', () => {
    initParticles();
    initTypewriter();
    initCounters();
  });

  // Публичное API для перезапуска анимаций после динамической подгрузки
  window.Animations = { initCounters, animateCounter };
})();
