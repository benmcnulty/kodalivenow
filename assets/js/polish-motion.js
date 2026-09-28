/* ============================================================
   Koda — kodalivenow.com polish: motion gating + scroll reveals
   ------------------------------------------------------------
   - Adds `js-motion` to <html> ONLY when this script runs AND
     the visitor has no reduced-motion preference. No-JS and
     reduced-motion visitors always see final, static content —
     nothing is ever hidden for them.
   - IntersectionObserver adds `.in-view` once per [data-reveal]
     element (unobserved after — once:true semantics).
   - Passive, no scroll listeners, no layout reads/writes.
   - If IntersectionObserver is unavailable, the gate class is
     removed again so nothing stays hidden.
   ============================================================ */
(function () {
  'use strict';

  var docEl = document.documentElement;

  // Motion gate: JS is running (we're here) + user tolerates motion.
  var motionOK = window.matchMedia('(prefers-reduced-motion: no-preference)').matches;
  if (!motionOK) {
    return; // static final states; CSS pre-states never apply
  }
  docEl.classList.add('js-motion');

  // No IntersectionObserver: never leave content hidden.
  if (!('IntersectionObserver' in window)) {
    docEl.classList.remove('js-motion');
    return;
  }

  var io = new IntersectionObserver(
    function (entries, observer) {
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.15, rootMargin: '0px 0px -6% 0px' }
  );

  var els = docEl.querySelectorAll('[data-reveal]');
  for (var j = 0; j < els.length; j++) {
    io.observe(els[j]);
  }
})();
