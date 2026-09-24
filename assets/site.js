/* kodalivenow.com — tiny progressive enhancement.
   Scroll reveals via IntersectionObserver. No framework.
   Everything here is inert when JS is off or reduced-motion is on. */
(function () {
  'use strict';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;

  var els = document.querySelectorAll('.reveal');
  if (!els.length) return;

  if (!('IntersectionObserver' in window)) {
    els.forEach(function (el) { el.classList.add('in'); });
    return;
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

  els.forEach(function (el, i) {
    // gentle stagger only within a shared parent group
    if (!el.style.getPropertyValue('--d')) {
      var siblings = Array.prototype.indexOf.call(el.parentNode.children, el);
      el.style.setProperty('--d', Math.min(siblings, 6) * 70 + 'ms');
    }
    io.observe(el);
  });
})();
