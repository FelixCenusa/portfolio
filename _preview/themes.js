// PREVIEW ONLY: a switcher for comparing the candidate themes on the real
// pages. The chosen theme gets folded into site.css and this folder is deleted.
// Loaded as a plain blocking script in <head>, so the theme is set before the
// first paint. ?theme=<id> picks one from the URL; the choice is remembered.
(function () {
  var THEMES = [
    { id: 'solder', name: 'Solder mask', note: 'The current design' },
    { id: 'cyanotype', name: 'Blueprint', note: 'A drafting sheet above the syscall line, a blueprint below it' },
    { id: 'scope', name: 'Oscilloscope', note: 'Dark all the way, one channel colour per layer' },
    { id: 'swiss', name: 'Swiss', note: 'White, black, a grid and one red' },
  ];

  var html = document.documentElement;
  var qs = new URLSearchParams(location.search);
  var ids = THEMES.map(function (t) { return t.id; });
  var current = qs.get('theme');
  if (current == null) { try { current = localStorage.getItem('preview-theme'); } catch (e) {} }
  if (ids.indexOf(current) < 0) current = ids[0];
  html.dataset.theme = current;

  function set(id) {
    if (id === html.dataset.theme) return;
    html.dataset.theme = id;
    try { localStorage.setItem('preview-theme', id); } catch (e) {}
    var u = new URL(location.href);
    u.searchParams.set('theme', id);
    history.replaceState(history.state, '', u);
    paint();
    document.dispatchEvent(new CustomEvent('themechange', { detail: { id: id } }));
  }

  var bar;
  function paint() {
    if (!bar) return;
    bar.innerHTML = '<span class="pv__label">Theme</span>' + THEMES.map(function (t, i) {
      return '<button type="button" role="radio" aria-checked="' + (t.id === html.dataset.theme) + '" data-id="' + t.id + '" title="' + t.note + '">'
        + '<span class="pv__n">' + (i + 1) + '</span><span class="pv__name">' + t.name + '</span></button>';
    }).join('');
  }

  addEventListener('keydown', function (e) {
    if (e.altKey && /^[1-9]$/.test(e.key) && THEMES[e.key - 1]) { e.preventDefault(); set(THEMES[e.key - 1].id); }
  });

  if (qs.get('chrome') === '0') return; // clean screenshots
  document.addEventListener('DOMContentLoaded', function () {
    var css = document.createElement('style');
    css.textContent = [
      '.pv { position: fixed; left: 50%; bottom: 14px; z-index: 9999; transform: translateX(-50%); display: flex; align-items: center; gap: 2px; padding: 4px; border-radius: 999px; background: rgba(20, 20, 20, 0.88); color: #fff; font: 500 12.5px/1 system-ui, sans-serif; box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.5); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); max-width: calc(100vw - 16px); overflow-x: auto; }',
      '.pv__label { padding: 0 8px 0 10px; opacity: 0.6; }',
      '.pv button { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; padding: 7px 11px; border-radius: 999px; white-space: nowrap; }',
      '.pv button:hover { background: rgba(255, 255, 255, 0.12); }',
      '.pv button[aria-checked="true"] { background: #fff; color: #111; }',
      '.pv button:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }',
      '.pv__n { opacity: 0.5; }',
      '@media (max-width: 640px) { .pv__name, .pv__label { display: none; } .pv button { padding: 8px 13px; } .pv__n { opacity: 1; } }',
    ].join('\n');
    document.head.append(css);
    bar = document.createElement('div');
    bar.className = 'pv';
    bar.setAttribute('role', 'radiogroup');
    bar.setAttribute('aria-label', 'Preview theme');
    bar.addEventListener('click', function (e) { var b = e.target.closest('button[data-id]'); if (b) set(b.dataset.id); });
    paint();
    document.body.append(bar);
  });
})();
