document.addEventListener('DOMContentLoaded', () => {
  'use strict';
  const column = document.getElementById('main-col');
  const divider = document.getElementById('dash-splitter');
  const key = 'climascope-dashboard-map-share';
  let share = 55, drag = null, resizeFrame = null;
  try {
    const saved = Number(localStorage.getItem(key));
    if (saved >= 20 && saved <= 80) share = saved;
  } catch {}
  function resizeMap() {
    if (resizeFrame !== null) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      document.dispatchEvent(new Event('climascope:dashboard:resize'));
    });
  }
  function setShare(value, save = false) {
    share = Math.min(80, Math.max(20, value));
    column.style.setProperty('--dashboard-map-share', share + '%');
    divider.setAttribute('aria-valuenow', String(Math.round(share)));
    divider.setAttribute('aria-valuetext', 'Map ' + Math.round(share) + '%, Dashboard ' + Math.round(100 - share) + '%');
    if (save) { try { localStorage.setItem(key, String(share)); } catch {} }
    resizeMap();
  }
  divider.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    drag = {id:event.pointerId, share, offset:event.clientY - divider.getBoundingClientRect().top};
    divider.setPointerCapture(event.pointerId);
    divider.focus();
    document.body.classList.add('dashboard-resizing');
    event.preventDefault();
  });
  divider.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const rect = column.getBoundingClientRect();
    setShare((event.clientY - rect.top - drag.offset) / rect.height * 100);
  });
  function finish(cancelled) {
    if (!drag) return;
    const original = drag.share;
    drag = null;
    document.body.classList.remove('dashboard-resizing');
    setShare(cancelled ? original : share, !cancelled);
  }
  divider.addEventListener('pointerup', () => finish(false));
  divider.addEventListener('pointercancel', () => finish(true));
  divider.addEventListener('lostpointercapture', () => finish(false));
  divider.addEventListener('dblclick', () => setShare(55, true));
  divider.addEventListener('keydown', event => {
    const choices = {ArrowUp:share - 5, ArrowDown:share + 5, Home:20, End:80, Enter:55};
    if (event.key === 'Escape') { finish(true); return; }
    if (!(event.key in choices)) return;
    event.preventDefault();
    setShare(choices[event.key], true);
  });
  new ResizeObserver(resizeMap).observe(document.getElementById('map-area'));
  setShare(share);
});
