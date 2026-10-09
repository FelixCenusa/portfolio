// Site behaviour for every page: smooth scroll, text intros and reveals, the
// Run/Stop key, autoset, the command palette, lightbox, copy-to-clipboard, the
// depth rail, lazy demos, the 3D hero and the lab. Everything degrades: without
// JS the pages are complete, and with reduced motion nothing moves that doesn't
// have to.

import { score, split, where, plan, complete, recall, remember, AUTOSET, autosetPick } from './shell.js';
import { setRun, isRunning, onRun } from './instrument.js';
import { ring } from './ease.js';

const ROOT = new URL('../../', import.meta.url); // site root, from assets/js/
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isHome = document.body.dataset.page === 'home';
const EMAIL = 'felixcenusa@gmail.com';
const { gsap, ScrollTrigger, SplitText, ScrambleTextPlugin, Lenis } = window;

/* ------------------------------------------------------------ smooth scroll */
// No extra offset for the nav: Lenis already honours the scroll-padding-top in
// site.css (the nav's height plus 24px), the same as native anchor jumps do.
let lenis = null;
// ScrambleText stays registered for the readouts (numerals only, never words)
if (gsap) gsap.registerPlugin(...[ScrollTrigger, SplitText, ScrambleTextPlugin].filter(Boolean));
if (!reduced && Lenis) {
  lenis = new Lenis({ lerp: 0.11, wheelMultiplier: 1, anchors: true });
  window.lenis = lenis; // the instance, for other modules (Lenis itself leaves only a version marker there)
  if (gsap && ScrollTrigger) {
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  } else {
    const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
  }
}
function scrollToTarget(target) {
  const el = typeof target === 'string' ? (target === '#top' ? 0 : $(target)) : target;
  if (el == null) return;
  if (lenis) lenis.scrollTo(el, { duration: 1.4 });
  else if (el === 0) scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  else el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
}

/* ------------------------------------------------------------ toast + copy */
const toast = $('.toast') || document.body.appendChild(Object.assign(document.createElement('div'), { className: 'toast', role: 'status' }));
let toastTimer = 0;
function say(html, ms = 2200) {
  toast.innerHTML = html;
  toast.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-on'), ms);
}
// a 6px flat lamp for the toast, in a token colour
const lamp = (color) => `<span class="key-lamp" style="--lamp:${color}" aria-hidden="true"></span>`;
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta);
    ta.select();
    try { document.execCommand('copy'); } catch {}
    ta.remove();
  }
  say(`${lamp('var(--signal)')}Copied ${text}`);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-copy]');
  if (b) { e.preventDefault(); copy(b.dataset.copy); }
});

/* ------------------------------------------------------------ Run/Stop, the scope's most used key */
// The nav key is labelled with what it will do: "Stop" while things move, "Run"
// once they're held. Its lamp is green running and red stopped (CSS reads
// html.is-stopped, which instrument.js sets). Stopping holds the ambient motion,
// whatever registers with instrument.js or opts in to the CSS hold; recordings
// like the visit trace carry on. It's also the page's pause control (WCAG
// 2.2.2), so the copy only promises what Stop really holds. The setting is
// remembered, and tabs follow each other.
const runKeys = $$('[data-runkey]');
const paintRun = (on) => runKeys.forEach((b) => {
  const label = $('.runkey__label', b);
  if (label) label.textContent = on ? 'Stop' : 'Run';
  b.setAttribute('aria-label', on ? 'Stop animations' : 'Run animations');
  b.title = on ? 'Hold the ambient motion' : 'Set the ambient motion going again';
});
function toggleRun(on = !isRunning()) {
  setRun(on);
  if (on) say(`${lamp('var(--signal)')}Running`);
  else say(`${lamp('var(--fault)')}${$('[data-trace]') ? 'Stopped. Your visit trace keeps recording.' : 'Stopped'}`, 2800);
}
paintRun(isRunning());
onRun(paintRun);
runKeys.forEach((b) => { b.addEventListener('click', () => toggleRun()); b.classList.add('is-ready'); });
addEventListener('storage', (e) => { // instrument.js keeps the setting under 'scope-run'
  if (e.key === 'scope-run' && (e.newValue === '1' || e.newValue === '0')) setRun(e.newValue === '1', { persist: false });
});

/* ------------------------------------------------------------ nav, year, back to top */
// the nav (and the rail, below) switch to the board's colours over dark sections
const nav = $('.nav');
const themeMeta = $('meta[name="theme-color"]');
const darkZones = $$('[data-tone="dark"]');
const inDark = (y) => darkZones.some((z) => { const r = z.getBoundingClientRect(); return r.top <= y && r.bottom > y; });
const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const paintThemeMeta = () => { if (themeMeta) themeMeta.content = token(nav && nav.classList.contains('is-dark') ? '--d-bg-0' : '--tone-l4'); };
const onScrollNav = () => {
  if (!nav) return;
  nav.classList.toggle('is-scrolled', scrollY > 8);
  const dark = inDark(nav.offsetHeight / 2);
  if (dark !== nav.classList.contains('is-dark')) {
    nav.classList.toggle('is-dark', dark);
    paintThemeMeta();
  }
};
addEventListener('scroll', onScrollNav, { passive: true });
onScrollNav();
paintThemeMeta(); // the theme may differ from the colour in the HTML
$$('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });
$$('[data-top]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); scrollToTarget('#top'); }));
const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
$$('[data-mod-key]').forEach((k) => { k.textContent = mac ? '⌘' : 'Ctrl'; });

/* ------------------------------------------------------------ footer: FELIX in binary + live build hash */
$$('[data-bits]').forEach((el) => {
  const bits = [...el.dataset.bits].flatMap((c) => c.charCodeAt(0).toString(2).padStart(8, '0').split(''));
  el.replaceChildren(...bits.map((b) => Object.assign(document.createElement('i'), { className: b === '1' ? 'on' : '' })));
  el.title = `${el.dataset.bits} in ASCII`;
});
const build = $('[data-build]');
if (build) {
  const show = ({ sha, date }) => {
    $('[data-build-sha]', build).textContent = `${sha.slice(0, 7)} on ${date.slice(0, 10)}`;
    $('[data-build-link]', build).href = `https://github.com/FelixCenusa/portfolio/commit/${sha}`;
    build.hidden = false;
  };
  const load = async () => {
    try {
      const cached = JSON.parse(sessionStorage.getItem('build') || 'null');
      if (cached) return show(cached);
    } catch {}
    try {
      const r = await fetch('https://api.github.com/repos/FelixCenusa/portfolio/commits/main', { headers: { Accept: 'application/vnd.github+json' } });
      if (!r.ok) return;
      const j = await r.json();
      const info = { sha: j.sha, date: j.commit.committer.date };
      show(info);
      try { sessionStorage.setItem('build', JSON.stringify(info)); } catch {}
    } catch {}
  };
  const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); load(); } }, { rootMargin: '400px' });
  io.observe(build.parentElement);
}

/* ------------------------------------------------------------ lightbox (screenshots, and videos via data-yt) */
const lb = $('.lightbox');
if (lb) {
  const img = $('img', lb), cap = $('.lightbox__cap', lb), stageBox = $('.lightbox__stage', lb), label = $('[data-lightbox-label]', lb);
  let back = null, video = null;
  const open = ({ src, yt, text }) => {
    back = document.activeElement;
    if (yt) {
      // youtube-nocookie, and only once someone asks to play
      img.hidden = true;
      video = Object.assign(document.createElement('div'), { className: 'lightbox__video' });
      const f = Object.assign(document.createElement('iframe'), {
        src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(yt)}?autoplay=1&rel=0`,
        title: text || 'Video', allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowFullscreen: true,
      });
      video.append(f);
      stageBox.append(video);
    } else {
      img.hidden = false;
      img.src = src; img.alt = text || '';
    }
    if (label) label.textContent = yt ? 'Video' : 'Screenshot';
    cap.textContent = text || '';
    lb.inert = false;
    lb.classList.add('is-open');
    lenis && lenis.stop();
    $('[data-lightbox-close]', lb).focus();
  };
  const close = () => {
    if (!lb.classList.contains('is-open')) return;
    lb.classList.remove('is-open');
    lb.inert = true;
    if (video) { video.remove(); video = null; }
    lenis && lenis.start();
    back && back.focus();
  };
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-full], [data-yt]');
    if (t && (t.dataset.full || t.dataset.yt)) { e.preventDefault(); open({ src: t.dataset.full, yt: t.dataset.yt, text: t.dataset.cap }); return; }
    if (lb.classList.contains('is-open') && lb.contains(e.target) && (e.target.closest('[data-lightbox-close]') || !e.target.closest('img, .lightbox__video'))) close();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

/* ------------------------------------------------------------ command palette */
const LAYERS = [['l4', 'L4', 'Web'], ['l3', 'L3', 'Apps'], ['l2', 'L2', 'Algorithms'], ['l1', 'L1', 'Systems'], ['l0', 'L0', 'Metal']];
const PROJECTS = [ // id, layer, name, hint, demo
  ['june', 'L4', 'June', 'JavaScript, live site'], ['timetomove', 'L4', 'TimeToMove', 'JavaScript'], ['eshop', 'L4', 'Eshop', 'SQL'],
  ['fake-gpt', 'L3', 'Fake-GPT', 'Python'], ['press-ice', 'L3', 'Press-Ice', 'Python, live demo', 'typing'], ['school-management', 'L3', 'School Management System', 'C++'],
  ['aristotle', 'L2', "Aristotle's Puzzle Solver", 'C++, live demo', 'aristotle'], ['advent-of-code', 'L2', 'Advent of Code 2024', 'Python', 'aoc'],
  ['fat-file-system', 'L1', 'Custom File System with FAT', 'C++, live demo', 'fat'],
  ['segment-display', 'L0', '8-Segment Display Controller', 'ARM, live demo', 'segment'], ['tis-100', 'L0', 'TIS-100', 'Assembly, live demo', 'tis'],
];
const ext = (u) => () => window.open(u, '_blank', 'noopener');
// home-page anchors; the other pages navigate home first
const go = (hash) => () => {
  if (!isHome) { location.href = new URL(hash === '#top' ? '' : hash, ROOT).href; return; }
  scrollToTarget(hash);
  history.replaceState(null, '', hash === '#top' ? location.pathname + location.search : hash);
};
const COMMANDS = [
  ...PROJECTS.map(([id, reg, name, hint]) => ({ group: 'Projects', reg, name, hint, run: go(`#${id}`) })),
  ...LAYERS.map(([id, reg, name]) => ({ group: 'Layers', reg, name: `${name} layer`, hint: 'jump', run: go(`#${id}`) })),
  { group: 'Pages', reg: '~', name: 'Home', hint: '/', run: () => { if (isHome) scrollToTarget('#top'); else location.href = ROOT.href; } },
  { group: 'Pages', reg: 'ls', name: 'All projects, as a table', hint: '/projects', run: () => { location.href = new URL('projects/', ROOT).href; } },
  { group: 'Pages', reg: 'cv', name: 'CV', hint: '/cv', run: () => { location.href = new URL('cv/', ROOT).href; } },
  { group: 'Pages', reg: '@', name: 'Contact', hint: '#contact', run: go('#contact') },
  { group: 'Actions', reg: 'auto', name: 'Run a demo', hint: 'autoset', run: () => autoset() },
  { group: 'Actions', reg: '⧉', name: 'Copy email address', hint: EMAIL, run: () => copy(EMAIL) },
  { group: 'Actions', reg: 'pdf', name: 'Download CV (PDF)', hint: 'felix.best', run: ext('https://felix.best/Felix_Cenusa_CV.pdf') },
  { group: 'Actions', reg: 'gh', name: 'GitHub profile', hint: 'FelixCenusa', run: ext('https://github.com/FelixCenusa') },
  { group: 'Actions', reg: 'in', name: 'LinkedIn', hint: 'felixcenusa', run: ext('https://linkedin.com/in/felixcenusa') },
  { group: 'Actions', reg: 'web', name: 'felix.best', hint: 'links', run: ext('https://felix.best') },
  { group: 'Actions', reg: '</>', name: 'View the source of this site', hint: 'GitHub', run: ext('https://github.com/FelixCenusa/portfolio') },
  { group: 'Actions', reg: 'run', get name() { return isRunning() ? 'Stop animations' : 'Run animations'; }, hint: 'stop, run', run: () => toggleRun() },
];

// The shell's picture of the site. The home page reads its own sections, so it
// follows the markup; the other pages fall back to the lists above.
const staticTree = () => LAYERS.map(([id, reg, name]) => ({
  id, name, projects: PROJECTS.filter((p) => p[1] === reg).map(([pid, , pname, , demo]) => ({ id: pid, name: pname, demo })),
}));
const siteTree = () => {
  const names = Object.fromEntries(LAYERS.map(([id, , name]) => [id, name]));
  const tree = $$('section[data-layer]').map((s) => ({
    id: s.dataset.layer, name: names[s.dataset.layer] || s.dataset.layer,
    projects: $$('article.proj[id]', s).map((a) => ({ id: a.id, name: ($('.proj__title', a) || a).textContent.trim(), demo: $('.demo[data-demo]', a)?.dataset.demo })),
  }));
  return tree.length ? tree : staticTree();
};
// the layer under the middle of the viewport, if any
const layerHere = () => {
  const mid = innerHeight / 2;
  const s = $$('section[data-layer]').find((el) => { const r = el.getBoundingClientRect(); return r.top <= mid && r.bottom > mid; });
  return s ? s.dataset.layer : null;
};

const demoEl = (name) => $(`.demo[data-demo="${CSS.escape(name)}"]`);
const firstControl = (el) => $$('a[href], button, input, select, textarea, [tabindex]', el)
  .find((n) => n.tabIndex >= 0 && !n.disabled && n.getClientRects().length);
// a demo sits in a screen with its caption bar on top; land on the whole screen
const demoScreen = (el) => el.closest('.screen') || el;

// Demos mount once each: when they come near the viewport (lazy demos, below), or
// up front when something is about to land on one.
// a demo mounting (or anything else changing the page's height) moves every
// ScrollTrigger below it; re-measure once things settle
let refreshT = 0;
const refreshTriggers = () => {
  if (!ScrollTrigger) return;
  clearTimeout(refreshT);
  refreshT = setTimeout(() => ScrollTrigger.refresh(), 200);
};
if (ScrollTrigger && 'ResizeObserver' in window) {
  let lastH = 0;
  new ResizeObserver(() => {
    const h = document.body.scrollHeight;
    if (Math.abs(h - lastH) > 40) { lastH = h; refreshTriggers(); }
  }).observe(document.body);
}

const mounting = new WeakSet();
function mountDemo(el) {
  if (mounting.has(el)) return;
  mounting.add(el);
  const name = el.dataset.demo;
  import(new URL(`assets/js/demos/${name}.js`, ROOT).href)
    .then((m) => { el.dataset.mounted = ''; m.mount(el, { reducedMotion: reduced }); refreshTriggers(); })
    .catch((err) => console.warn(`demo ${name} failed to load`, err));
}

// where a node's top comes to rest after a jump: under the nav, as an anchor's does
// (scroll-padding-top in site.css), plus any scroll-margin-top of its own
const landingGap = (node) => (parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0)
  + (parseFloat(getComputedStyle(node).scrollMarginTop) || 0);
// a node's top once the reveals it sits in have finished (a reveal starts 28px low)
const settledTop = (node) => {
  let top = node.getBoundingClientRect().top;
  if (gsap) for (let n = node.closest('[data-reveal]'); n; n = n.parentElement && n.parentElement.closest('[data-reveal]')) top -= parseFloat(gsap.getProperty(n, 'y')) || 0;
  return top;
};
const scrollToY = (y, duration = 1.4) => {
  if (lenis) lenis.scrollTo(y, { duration });
  else scrollTo({ top: y, behavior: reduced ? 'auto' : 'smooth' });
};

// Scroll to a demo's screen, then call then(from) once the demo has mounted and the
// page is at rest with the screen in place and on screen. `from` is what had focus
// when it began. The scroll aims at a number fixed when it starts, and the page
// changes under it (demos it passes mount and grow; the screen's reveal still holds
// it 28px low), so at rest it measures again and re-aims, three times at most.
// Scrolling, tapping, clicking or typing meanwhile means the visitor has taken
// over, and it gives up. A newer landing replaces an older one.
let landing = null; // cancels the landing under way
function landOn(el, then) {
  if (landing) landing();
  const screen = demoScreen(el), from = document.activeElement, ac = new AbortController();
  let timer = 0, aims = 0, lastY = NaN, until = performance.now() + 8000;
  const cancel = () => { clearTimeout(timer); ac.abort(); if (landing === cancel) landing = null; };
  landing = cancel;
  // after a task, so the key or tap that started this doesn't count as a takeover
  setTimeout(() => {
    if (ac.signal.aborted) return;
    const takeover = (e) => { if (!/^(Shift|Control|Alt|Meta|CapsLock)$/.test(e.key || '')) cancel(); };
    for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) addEventListener(type, takeover, { capture: true, passive: true, signal: ac.signal });
  }, 0);
  const offBy = () => settledTop(screen) - landingGap(screen);
  const later = (ms = 120) => { if (performance.now() < until) timer = setTimeout(tick, ms); else cancel(); };
  const tick = () => {
    const y = scrollY, still = Math.abs(y - lastY) < 1 && !(lenis && lenis.isScrolling);
    lastY = y;
    if (!still) return later();
    const off = offBy(), max = document.documentElement.scrollHeight - innerHeight;
    const placed = Math.abs(off) <= 8 || (off > 0 && y >= max - 1) || (off < 0 && y <= 0);
    if (!placed && aims < 3) { // short or long: aim again from here
      aims++; lastY = NaN; until = Math.max(until, performance.now() + 4000);
      scrollToY(y + off, 0.8);
      return later(150);
    }
    if (!('mounted' in el.dataset)) return later();
    cancel();
    const r = screen.getBoundingClientRect();
    if (r.bottom > 0 && r.top < innerHeight) then(from);
  };
  mountDemo(el);
  scrollToY(scrollY + offBy());
  timer = setTimeout(tick, 150);
}

// scroll to a demo, then put focus on its first control once it's there (unless
// focus has moved on in the meantime)
function runDemo(el) {
  landOn(el, (from) => {
    if (document.activeElement !== from && document.activeElement !== document.body) return;
    const c = firstControl(el);
    if (c) c.focus({ preventScroll: true });
  });
}

/* ------------------------------------------------------------ autoset */
// The scope key that finds the signal for you: go to the strongest live demo and
// start it. Each press moves on to the next one in the round (AUTOSET, shell.js);
// the place in the round lasts for the session, across pages.
const ROUND_KEY = 'autoset';
const readRound = () => { try { return +sessionStorage.getItem(ROUND_KEY) || 0; } catch { return 0; } };
// on the home page only the demos that are there; elsewhere the home page has them all
const nextAutoset = () => autosetPick(readRound(), isHome ? (d) => !!demoEl(d) : undefined);
const fine = matchMedia('(pointer: fine)').matches;

// How each demo starts when it doesn't handle 'demo:start' itself. Gentle: never
// presses a control that would stop something already running.
const press = (b, when = () => true) => { if (b && !b.disabled && when(b)) b.click(); return b; };
const STARTERS = {
  segment: (el) => press($('.seg__auto', el), (b) => b.getAttribute('aria-pressed') === 'false'),
  fat: (el) => press($('[data-act="create"]', el)),
  aristotle: (el) => press($('[data-a="solve"]', el), (b) => !/pause/i.test(b.textContent)),
  tis: (el) => press($('button[aria-label="Run"]', el)) || $('button[aria-label="Stop"]', el),
  typing: (el) => (fine ? $('input, textarea', el) : null), // a phone keyboard shouldn't pop up unasked
};
// Start a mounted demo and return the control to focus. A demo can take this over:
// listen for 'demo:start' on its root, call preventDefault() and set detail.focus.
function kick(el, name) {
  const ev = new CustomEvent('demo:start', { cancelable: true, detail: { focus: null, source: 'autoset' } });
  if (!el.dispatchEvent(ev)) return ev.detail.focus;
  try { return (STARTERS[name] && STARTERS[name](el)) || firstControl(el); } catch (err) { console.warn(`autoset: ${name}`, err); return null; }
}

// land on the demo's screen (landOn, above), then start it and focus its control
// (unless focus has gone elsewhere)
function startDemo(el, name) {
  landOn(el, (from) => {
    const target = kick(el, name);
    const free = document.activeElement === from || document.activeElement === document.body;
    if (target && target.isConnected && free) target.focus({ preventScroll: true });
  });
}

const announce = (entry) => {
  const there = AUTOSET.filter(([d]) => demoEl(d));
  say(`${lamp(`var(--ch-${entry[2]})`)}Demo ${there.indexOf(entry) + 1} of ${there.length}: ${entry[3]}`, 3200);
};

// the hero's "Run a demo" key: its link and lamp point at the demo it will start
const autosetKeys = $$('[data-autoset]');
function paintAutoset() {
  const pick = nextAutoset();
  autosetKeys.forEach((a) => {
    a.hidden = !pick;
    if (!pick) return;
    const [, id, layer, name] = pick.entry;
    a.setAttribute('href', `#${id}`);
    a.title = `Starts ${name}`;
    $('.key-lamp', a)?.style.setProperty('--lamp', `var(--ch-${layer})`);
  });
}

function autoset() {
  const pick = nextAutoset();
  if (!pick) { say('There are no live demos on this page'); return; }
  try { sessionStorage.setItem(ROUND_KEY, String(pick.next)); } catch {}
  paintAutoset();
  // like the real key, autoset leaves the scope running, unless motion is unwelcome
  if (!isRunning() && !reduced) setRun(true);
  const [demo, id] = pick.entry;
  if (!isHome) {
    try { sessionStorage.setItem('autoset-run', demo); } catch {}
    location.href = new URL(`#${id}`, ROOT).href;
    return;
  }
  announce(pick.entry);
  startDemo(demoEl(demo), demo);
}

autosetKeys.forEach((a) => a.addEventListener('click', (e) => {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // new tab: a plain link
  e.preventDefault();
  e.stopPropagation(); // Lenis would scroll to the anchor as well
  autoset();
}));
paintAutoset();

// "run tis" or autoset from another page lands here
if (isHome) {
  let want = null, auto = null;
  try {
    want = sessionStorage.getItem('palette-run'); sessionStorage.removeItem('palette-run');
    auto = sessionStorage.getItem('autoset-run'); sessionStorage.removeItem('autoset-run');
  } catch {}
  const entry = auto && AUTOSET.find(([d]) => d === auto);
  const el = entry ? demoEl(entry[0]) : want && demoEl(want);
  const land = () => { if (entry) { announce(entry); startDemo(el, entry[0]); } else runDemo(el); };
  if (el) {
    if (document.readyState === 'complete') land();
    else addEventListener('load', land, { once: true });
  }
}

const pal = $('.palette');
if (pal) {
  const input = $('.palette__input', pal), list = $('.palette__list', pal);
  input.placeholder = 'Jump to a project, or type help';
  $('.palette__foot', pal)?.insertAdjacentHTML('beforeend', '<span class="palette__help"><kbd>help</kbd> for commands</span>');
  // shell output, between the input and the list
  const out = document.createElement('div');
  out.className = 'palette__out';
  out.setAttribute('role', 'log');
  out.setAttribute('aria-live', 'polite');
  out.setAttribute('aria-label', 'Command output');
  $('.palette__head', pal).after(out);
  out.addEventListener('click', () => { if (!String(getSelection())) input.focus(); }); // back to typing, unless selecting text

  let items = [], sel = 0, ctx = null;
  // command history: oldest first, hi === hist.length when not browsing it
  let hist = [], hi = 0, draft = '';
  try { hist = JSON.parse(sessionStorage.getItem('palette-history')) || []; } catch {}
  hist = Array.isArray(hist) ? hist.filter((x) => typeof x === 'string') : [];
  hi = hist.length;
  const keep = (line) => {
    hist = remember(hist, line); hi = hist.length;
    try { sessionStorage.setItem('palette-history', JSON.stringify(hist)); } catch {}
  };
  const shellCtx = () => ({
    page: document.body.dataset.page || 'home', here: layerHere(), layers: siteTree(), email: EMAIL,
    running: isRunning(), autoset: nextAutoset()?.entry[3],
  });

  const print = (cmd, lines, err) => {
    const row = (text, cls) => Object.assign(document.createElement('div'), { className: cls, textContent: text });
    if (cmd != null) {
      const ps = row('', 'palette__ps');
      const prompt = Object.assign(document.createElement('span'), { textContent: `${where(ctx).short} $ ` });
      prompt.setAttribute('aria-hidden', 'true');
      ps.append(prompt, cmd);
      out.append(ps);
    }
    out.append(...lines.map((t) => row(t, err ? 'is-err' : '')));
    out.scrollTop = out.scrollHeight;
  };
  const exec = (p) => {
    const cmd = input.value.trim(), a = p.action;
    keep(cmd);
    input.value = ''; sel = 0;
    if (a.clear) out.replaceChildren();
    else if (typeof a.scope === 'boolean') { // stop, and run on its own
      setRun(a.scope);
      ctx = shellCtx();
      print(cmd, [a.scope ? 'running' : 'stopped. run sets it going again']);
    }
    else if (a.out) print(cmd, a.out, a.err);
    else if (a.copy) { copy(a.copy); print(cmd, [`copied ${a.copy}`]); }
    else if (a.call) { const out = a.call(); if (out != null) print(cmd, [].concat(out)); }
    else {
      close();
      if (a.go) go(a.go)();
      else if (a.autoset) autoset();
      else if (a.page) {
        const u = new URL(a.page, ROOT);
        if (u.pathname === location.pathname) scrollToTarget('#top'); else location.href = u.href;
      } else if (a.demo) {
        const el = isHome && $(`.demo[data-demo="${CSS.escape(a.demo)}"]`);
        if (el) runDemo(el);
        else { try { sessionStorage.setItem('palette-run', a.demo); } catch {} location.href = new URL(`#${a.id}`, ROOT).href; }
      }
      return;
    }
    render();
  };
  const browse = (d) => {
    if (hi === hist.length) draft = input.value;
    hi = recall(hist, hi, d);
    input.value = hi < hist.length ? hist[hi] : draft;
    sel = 0; render();
    input.setSelectionRange(input.value.length, input.value.length);
  };

  const render = () => {
    const q = input.value.trim().toLowerCase();
    // a command gets a Run row on top; with an argument it's the only row
    const p = plan(input.value, ctx);
    items = p && p.arg ? [] : COMMANDS.map((c) => ({ c, s: Math.max(score(q, c.name), score(q, `${c.group} ${c.name} ${c.hint}`) * 0.8) }))
      .filter((x) => x.s > 0);
    if (q) items.sort((a, b) => b.s - a.s);
    if (p) items.unshift({ c: { reg: '$', name: p.label, hint: p.usage }, plan: p });
    sel = Math.min(sel, Math.max(0, items.length - 1));
    list.replaceChildren();
    if (!items.length) {
      list.append(Object.assign(document.createElement('li'), { className: 'palette__empty', textContent: 'Nothing matches. Try “fat”, “cv” or “email”.' }));
      input.removeAttribute('aria-activedescendant');
      return;
    }
    let group = '';
    items.forEach(({ c, plan: cmd }, i) => {
      if (!q && c.group !== group) {
        group = c.group;
        list.append(Object.assign(document.createElement('li'), { className: 'palette__group', role: 'presentation', textContent: group }));
      }
      const li = document.createElement('li');
      li.className = cmd ? 'palette__item is-run' : 'palette__item';
      li.id = `pal-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === sel));
      li.innerHTML = `<span class="reg"></span><span class="name"></span><span class="hint"></span>`;
      li.children[0].textContent = c.reg; li.children[1].textContent = c.name; li.children[2].textContent = c.hint;
      li.addEventListener('pointermove', () => { if (sel !== i) { sel = i; mark(); } });
      li.addEventListener('click', () => run(i));
      list.append(li);
    });
    mark();
  };
  const mark = () => {
    $$('.palette__item', list).forEach((li, i) => li.setAttribute('aria-selected', String(i === sel)));
    const cur = $(`#pal-${sel}`, list);
    if (cur) { input.setAttribute('aria-activedescendant', cur.id); cur.scrollIntoView({ block: 'nearest' }); }
  };
  const run = (i) => {
    const it = items[i];
    if (!it) return;
    if (it.plan) { exec(it.plan); return; }
    close(); it.c.run();
  };
  const open = () => {
    if (pal.open) return;
    ctx = shellCtx();
    input.value = ''; sel = 0; hi = hist.length; out.replaceChildren(); render();
    pal.showModal();
    lenis && lenis.stop();
    input.focus();
  };
  // Lenis starts again here, not on the close event: that fires later, and a stopped Lenis ignores scrollTo
  const close = () => { if (pal.open) { pal.close(); lenis && lenis.start(); } };
  pal.addEventListener('close', () => { lenis && lenis.start(); });
  pal.addEventListener('click', (e) => { if (e.target === pal) close(); }); // backdrop
  input.addEventListener('input', () => { sel = 0; hi = hist.length; render(); });
  input.addEventListener('keydown', (e) => {
    // Up walks back through history from an empty input or a command's Run row; Down walks forward while in it
    const shellish = !input.value.trim() || !!split(input.value);
    if (e.key === 'ArrowUp' && hist.length && (hi < hist.length || (shellish && sel === 0))) { e.preventDefault(); browse(-1); }
    else if (e.key === 'ArrowDown' && hi < hist.length) { e.preventDefault(); browse(1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % Math.max(1, items.length); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + items.length) % Math.max(1, items.length); mark(); }
    else if (e.key === 'Tab' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const c = complete(input.value, ctx);
      if (!c) return; // a plain search: Tab keeps its usual job
      e.preventDefault();
      if (c.value !== input.value) { input.value = c.value; sel = 0; hi = hist.length; render(); }
      else if (c.options.length > 1) print(null, [c.options.join('  ')]);
    }
    else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
  });
  $$('[data-palette-open]').forEach((b) => b.addEventListener('click', open));
  document.addEventListener('keydown', (e) => {
    const typing = e.target.closest && e.target.closest('input, textarea, [contenteditable="true"], select');
    if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); pal.open ? close() : open(); }
    else if (e.key === '/' && !typing && !pal.open) { e.preventDefault(); open(); }
  });
}

/* ------------------------------------------------------------ depth rail */
const rail = $('.rail');
if (rail) {
  const links = new Map($$('a[data-rail]', rail).map((a) => [a.dataset.rail, a]));
  const sections = $$('[data-layer]');
  const first = sections[0], last = sections[sections.length - 1];
  const update = () => {
    const mid = innerHeight * 0.45;
    const on = first && first.getBoundingClientRect().top < mid && last.getBoundingClientRect().bottom > mid;
    rail.classList.toggle('is-on', !!on);
    rail.classList.toggle('is-dark', inDark(innerHeight / 2));
    let active = null;
    for (const s of sections) if (s.getBoundingClientRect().top < mid) active = s.dataset.layer;
    links.forEach((a, id) => {
      a.classList.toggle('is-active', id === active);
      if (id === active) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    });
  };
  let ticking = false;
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; update(); }); } }, { passive: true });
  update();
}

/* ------------------------------------------------------------ lazy demos */
const demoIO = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    demoIO.unobserve(e.target);
    mountDemo(e.target); // a no-op if a landing mounted it first
  }
}, { rootMargin: '600px 0px' });
$$('.demo[data-demo]').forEach((el) => demoIO.observe(el));

/* ------------------------------------------------------------ ls table filters (projects page) */
$$('[data-filter-group]').forEach((group) => {
  const rows = $$('[data-tags]', $(group.dataset.filterGroup));
  const count = $('[data-filter-count]');
  group.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-filter]');
    if (!b) return;
    $$('button[data-filter]', group).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    const f = b.dataset.filter;
    let n = 0;
    rows.forEach((r) => { const show = f === 'all' || r.dataset.tags.split(' ').includes(f); r.hidden = !show; n += show; });
    if (count) count.textContent = `${n} of ${rows.length}`;
  });
});

/* ------------------------------------------------------------ hero: 3D stack (only where it will run well) */
const stage = $('[data-stage]');
let stack = null;
if (stage) {
  const forced = new URLSearchParams(location.search).get('webgl');
  const capable = forced === '1' || (forced !== '0' && !reduced
    && matchMedia('(pointer: fine)').matches
    && !((navigator.deviceMemory || 8) < 4)
    && !((navigator.hardwareConcurrency || 8) < 4)
    && !(navigator.connection && navigator.connection.saveData));
  // pause the poster's CSS animation when it's off screen
  new IntersectionObserver(([e]) => stage.classList.toggle('is-paused', !e.isIntersecting)).observe(stage);
  if (capable) {
    const start = async () => {
      try {
        const { initStack } = await import('./hero/stack.js');
        stack = await initStack(stage, { onSelect: (id) => scrollToTarget(`#${id}`) });
        if (stack && gsap && ScrollTrigger && !reduced) {
          ScrollTrigger.create({
            trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true,
            onUpdate: (self) => stack.setExplode(1 - self.progress * 0.75),
          });
        }
      } catch (err) {
        console.warn('3D hero unavailable, keeping the poster', err);
      }
    };
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 200));
    if (document.readyState === 'complete') idle(start, { timeout: 1500 });
    else addEventListener('load', () => idle(start, { timeout: 1500 }), { once: true });
  }
}


/* ------------------------------------------------------------ motion: intro, split headings, reveals */
// Things arrive the way a signal does after a step: positions and scales use
// ring() from ease.js (a fast rise, about 9% overshoot, one ring, settled).
// Opacity never rings; it fades. None of this is ambient, so Stop doesn't hold
// it: a reveal always finishes.
const html = document.documentElement;
if (gsap && !reduced) {
  const mm = gsap.matchMedia();
  mm.add('(prefers-reduced-motion: no-preference)', () => {
    const fade = 'power2.out';
    const step = ring();
    const lines = ring(0.75); // lines rise inside a mask: overshoot ~2% so their tops don't clip

    // hero intro (the head script hid these to avoid a flash; only run if we're in time)
    const heroTitle = $('.hero__title');
    if (heroTitle && html.classList.contains('intro')) {
      const tl = gsap.timeline({ delay: 0.1 });
      const fades = $$('[data-hero-fade]'), fig = $$('.hero__fig');
      if (fades.length || fig.length) gsap.set([...fades, ...fig], { autoAlpha: 0, y: 18 });
      html.classList.remove('intro');
      if (SplitText) {
        const split = SplitText.create(heroTitle, { type: 'lines', mask: 'lines', linesClass: 'line' });
        tl.from(split.lines, { yPercent: 110, duration: 1.1, ease: lines, stagger: 0.09 }, 0.05);
        tl.call(() => split.revert(), null, '>');
      } else {
        tl.from(heroTitle, { autoAlpha: 0, duration: 0.8, ease: fade }, 0.05);
        tl.from(heroTitle, { y: 24, duration: 0.9, ease: step }, 0.05);
      }
      if (fades.length) {
        tl.to(fades, { autoAlpha: 1, duration: 0.9, ease: fade, stagger: 0.08 }, 0.45);
        tl.to(fades, { y: 0, duration: 0.9, ease: step, stagger: 0.08 }, 0.45);
      }
      if (fig.length) {
        tl.to(fig, { autoAlpha: 1, duration: 1.4, ease: fade }, 0.3);
        tl.to(fig, { y: 0, duration: 1.1, ease: step }, 0.3);
      }
    } else {
      html.classList.remove('intro');
    }

    // Printing wants the whole page. The entrances that wait for a scroll are kept
    // by element (a re-split replaces its heading's), so the ones nobody has
    // scrolled to yet can be finished first, along with the reveals.
    const waiting = new Map();
    let revealed = [];
    const printAll = () => {
      if (revealed.length) gsap.set(revealed, { autoAlpha: 1, y: 0 });
      waiting.forEach((t) => t.progress(1));
    };
    addEventListener('beforeprint', printAll);

    // section headings: lines rise out of a mask as they come into view
    if (SplitText && ScrollTrigger) {
      $$('[data-split]').forEach((el) => {
        if (el === heroTitle) return;
        SplitText.create(el, {
          type: 'lines', mask: 'lines', linesClass: 'line', autoSplit: true,
          onSplit: (self) => {
            const t = gsap.from(self.lines, {
              yPercent: 110, duration: 1.1, ease: lines, stagger: 0.08,
              scrollTrigger: { trigger: el, start: 'top 88%', once: true },
            });
            waiting.set(el, t);
            return t;
          },
        });
      });
    }

    // blocks fade up in batches: the fade and the rise are separate tweens, so only the rise rings
    if (ScrollTrigger) {
      const els = $$('[data-reveal]');
      gsap.set(els, { autoAlpha: 0, y: 28 });
      ScrollTrigger.batch(els, {
        start: 'top 90%', once: true,
        onEnter: (batch) => {
          gsap.to(batch, { autoAlpha: 1, duration: 0.8, ease: fade, stagger: 0.07, overwrite: 'auto' });
          gsap.to(batch, { y: 0, duration: 0.9, ease: step, stagger: 0.07, overwrite: 'auto' });
        },
      });
      revealed = els; // for printAll

      // each layer's "you are here" level steps into place as its heading arrives
      $$('.layermap .is-here').forEach((el) => {
        waiting.set(el, gsap.from(el, { scaleX: 0, transformOrigin: '0 50%', duration: 0.9, ease: step, clearProps: 'transform', scrollTrigger: { trigger: el, start: 'top 88%', once: true } }));
      });

      // the footer's bits light up as it arrives
      $$('.bits').forEach((b) => {
        waiting.set(b, gsap.from($$('i.on', b), { opacity: 0, duration: 0.4, stagger: { each: 0.02, from: 'random' }, scrollTrigger: { trigger: b, start: 'top 95%', once: true } }));
      });
    }
    return () => { html.classList.remove('intro'); removeEventListener('beforeprint', printAll); };
  });
  // fonts change line breaks; let ScrollTrigger re-measure once they're in
  document.fonts && document.fonts.ready.then(() => ScrollTrigger && ScrollTrigger.refresh());
} else {
  html.classList.remove('intro');
}

/* ------------------------------------------------------------ the lab */
// Experiments that aren't on the site yet. ?lab=1 turns them on for this browser,
// ?lab=0 turns them off again. A missing or broken lab never breaks the page.
{
  const want = new URLSearchParams(location.search).get('lab');
  let on = want === '1';
  try {
    if (want === '1') localStorage.setItem('lab', '1');
    else if (want === '0') localStorage.removeItem('lab');
    else on = localStorage.getItem('lab') === '1';
  } catch {}
  // lab.js starts itself on import; init() is idempotent, so calling it as well is safe
  if (on) {
    import('./lab/lab.js')
      .then((m) => { if (m && typeof m.init === 'function') return m.init(); })
      .catch((err) => console.warn('the lab did not load', err));
  }
}
