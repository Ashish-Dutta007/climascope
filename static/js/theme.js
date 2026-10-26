// Light or dark page theme: the visitor's choice if they made one, otherwise
// their device setting. Loaded in <head> so the page never flashes the wrong
// theme. Modules re-colour charts and map overlays on 'climascope:theme'.
(function () {
  var KEY = 'climascope-theme', root = document.documentElement, saved = null;
  try { saved = window.localStorage.getItem(KEY); } catch (e) { /* not remembered */ }
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function current() {
    if (saved === 'light' || saved === 'dark') return saved;
    return media && media.matches ? 'dark' : 'light';
  }
  function apply() {
    root.dataset.theme = current();
    root.style.colorScheme = current();
    var button = document.getElementById('theme-toggle');
    if (button) {
      // The button names the theme it switches to.
      var light = current() === 'light';
      button.textContent = light ? '\u263E Dark' : '\u2600 Light';
      button.title = light ? 'Switch to dark theme' : 'Switch to light theme';
      button.setAttribute('aria-label', button.title);
    }
  }
  function changed() {
    apply();
    window.dispatchEvent(new CustomEvent('climascope:theme', { detail: current() }));
  }

  apply();
  if (media && media.addEventListener) media.addEventListener('change', function () { if (!saved) changed(); });
  document.addEventListener('DOMContentLoaded', function () {
    var button = document.getElementById('theme-toggle');
    if (!button) return;
    apply();
    button.addEventListener('click', function () {
      saved = current() === 'light' ? 'dark' : 'light';
      try { window.localStorage.setItem(KEY, saved); } catch (e) { /* this page only */ }
      changed();
    });
  });

  // Colours for canvas charts, which cannot read CSS variables themselves.
  function chart() {
    var light = current() === 'light';
    return {
      light: light,
      text: light ? '#374151' : '#d1d5db',
      tick: light ? '#4b5563' : 'rgba(226,232,244,.7)',
      title: light ? '#4b5563' : 'rgba(226,232,244,.5)',
      grid: light ? 'rgba(15,23,42,.08)' : 'rgba(255,255,255,.04)',
      border: light ? '#d1d5db' : '#374151',
      surface: light ? '#ffffff' : '#111827',
      tooltip: light ? 'rgba(255,255,255,0.97)' : 'rgba(13,16,24,0.95)',
      tooltipText: light ? '#111827' : '#e2e8f4',
    };
  }
  window.ClimaScopeTheme = { get: current, chart: chart };
})();
