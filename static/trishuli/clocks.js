/* Live clocks for the Trishuli pages. Any element carrying data-clock is filled
   here and refreshed every 30 s, so the page never states a stale interval.
     data-clock="since-onset"   time elapsed since the flood
     data-clock="next-sar"      time to the next Sentinel-1 pass over the corridor
     data-clock="next-sar-when" that pass as a UTC timestamp and orbit
   Pass times follow the observed 12-day repeat of each relative orbit. */
(function () {
  'use strict';
  var ONSET = Date.UTC(2026, 7, 26, 2, 45, 0);
  var PASSES = [
    {t: Date.UTC(2026, 7, 28, 12, 21, 41), label: 'orbit 85 ASC'},
    {t: Date.UTC(2026, 7, 31, 0, 10, 36), label: 'orbit 121 DESC'},
    {t: Date.UTC(2026, 8, 5, 0, 18, 44), label: 'orbit 19 DESC'}
  ];
  function span(ms) {
    var h = ms / 3.6e6;
    if (h < 1) return Math.max(0, Math.round(h * 60)) + ' min';
    if (h < 48) return h.toFixed(1) + ' h';
    return (h / 24).toFixed(1) + ' days';
  }
  function tick() {
    var now = Date.now(), next = null, i;
    for (i = 0; i < PASSES.length; i++) {
      if (PASSES[i].t > now) { next = PASSES[i]; break; }
    }
    var nodes = document.querySelectorAll('[data-clock]');
    for (i = 0; i < nodes.length; i++) {
      var el = nodes[i], kind = el.getAttribute('data-clock');
      if (kind === 'since-onset') {
        el.textContent = span(now - ONSET);
      } else if (kind === 'next-sar') {
        el.textContent = next ? span(next.t - now) : 'passed';
      } else if (kind === 'next-sar-when' && next) {
        el.textContent = new Date(next.t).toISOString().slice(0, 16).replace('T', ' ')
                       + ' UTC, ' + next.label;
      }
    }
  }
  tick();
  setInterval(tick, 30000);
})();
