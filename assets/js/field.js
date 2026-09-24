/* ============================================================
   Koda — kodalivenow.com: "Field recordings" stack logic
   ------------------------------------------------------------
   - Narrow viewports (<900px): one Polaroid at a time.
     .js-stack on the container gates the hiding in CSS, so
     no-JS visitors always see the full static poster stack.
   - Wide viewports: the fan-out is pure CSS; JS only manages
     video playback.
   - Videos play ONLY when (a) the visitor has no
     prefers-reduced-motion preference, (b) the section is in
     view, and (c) on narrow, the card is the active one.
     Everyone else gets the poster frame — which is also what
     no-JS visitors see (no autoplay attribute in the HTML).
   - Controls are real buttons; swipe + arrow keys included.
   - Adding a clip later: copy one <figure class="polaroid">
     block in index.html. This script discovers cards from the
     DOM — no JS edits needed.
   ============================================================ */
(function () {
  'use strict';

  var stack = document.getElementById('field-stack');
  if (!stack) return;

  var cards = Array.prototype.slice.call(stack.querySelectorAll('.polaroid'));
  if (!cards.length) return;
  var videos = cards.map(function (card) { return card.querySelector('video'); });

  var controls = document.querySelector('.stack-controls');
  var prevBtn = document.querySelector('[data-stack-prev]');
  var nextBtn = document.querySelector('[data-stack-next]');
  var indexEl = document.querySelector('[data-stack-index]');
  var totalEl = document.querySelector('[data-stack-total]');
  var section = document.querySelector('.field');

  var motionOK = window.matchMedia('(prefers-reduced-motion: no-preference)').matches;
  var narrowMQ = window.matchMedia('(max-width: 899px)');
  var current = 0;
  var inView = false;

  function playVideo(v) {
    if (!motionOK || !v || !v.paused) return;
    var p = v.play();
    if (p && typeof p.catch === 'function') p.catch(function () { /* poster stays */ });
  }
  function pauseVideo(v) {
    if (v && !v.paused) v.pause();
  }

  function update() {
    var narrow = narrowMQ.matches;
    stack.classList.toggle('js-stack', narrow);
    if (controls) controls.hidden = !narrow;
    if (totalEl) totalEl.textContent = String(cards.length);

    if (narrow) {
      cards.forEach(function (card, i) {
        var active = i === current;
        card.classList.toggle('is-active', active);
      });
      if (indexEl) indexEl.textContent = String(current + 1);
      videos.forEach(function (v, i) {
        if (i === current && inView) playVideo(v); else pauseVideo(v);
      });
    } else {
      cards.forEach(function (card) { card.classList.remove('is-active'); });
      videos.forEach(function (v) {
        if (inView) playVideo(v); else pauseVideo(v);
      });
    }
  }

  function go(delta) {
    current = (current + delta + cards.length) % cards.length;
    update();
  }

  if (prevBtn) prevBtn.addEventListener('click', function () { go(-1); });
  if (nextBtn) nextBtn.addEventListener('click', function () { go(1); });

  /* swipe on the stack (narrow only) */
  var startX = null;
  stack.addEventListener('touchstart', function (e) {
    startX = e.touches[0].clientX;
  }, { passive: true });
  stack.addEventListener('touchend', function (e) {
    if (startX === null || !narrowMQ.matches) { startX = null; return; }
    var dx = e.changedTouches[0].clientX - startX;
    startX = null;
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
  }, { passive: true });

  /* arrow keys when focus is inside the section (narrow only) */
  document.addEventListener('keydown', function (e) {
    if (!narrowMQ.matches || !section || !section.contains(document.activeElement)) return;
    if (e.key === 'ArrowRight') { go(1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { go(-1); e.preventDefault(); }
  });

  /* pause everything when the tab hides */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) videos.forEach(pauseVideo);
    else update();
  });

  /* section visibility gates playback */
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      inView = entries[0].isIntersecting;
      update();
    }, { threshold: 0.12 }).observe(stack);
  } else {
    inView = true;
  }

  function onMQ() { update(); }
  if (typeof narrowMQ.addEventListener === 'function') narrowMQ.addEventListener('change', onMQ);
  else if (typeof narrowMQ.addListener === 'function') narrowMQ.addListener(onMQ);

  update();
})();
