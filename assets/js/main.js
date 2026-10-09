// Site behaviour for every page: smooth scroll, text intros and reveals, the
// command palette, lightbox, copy-to-clipboard, the depth rail, lazy demos and
// the 3D hero. Everything degrades: without JS the pages are complete, and with
// reduced motion nothing moves that doesn't have to.

import { score, split, where, plan, complete, recall, remember } from './shell.js';

const ROOT = new URL('../../', import.meta.url); // site root, from assets/js/
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isHome = document.body.dataset.page === 'home';
const EMAIL = 'felixcenusa@gmail.com';
const { gsap, ScrollTrigger, SplitText, ScrambleTextPlugin, Lenis } = window;

/* ------------------------------------------------------------ smooth scroll */
let lenis = null;
if (gsap && ScrollTrigger) gsap.registerPlugin(ScrollTrigger, ...[SplitText, ScrambleTextPlugin].filter(Boolean));
if (!reduced && Lenis) {
  lenis = new Lenis({ lerp: 0.11, wheelMultiplier: 1, anchors: { offset: -84 } });
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
  if (lenis) lenis.scrollTo(el, { offset: el === 0 ? 0 : -84, duration: 1.4 });
  else if (el === 0) scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  else el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
}

/* ------------------------------------------------------------ toast + copy */
const toast = $('.toast') || document.body.appendChild(Object.assign(document.createElement('div'), { className: 'toast', role: 'status' }));
let toastTimer = 0;
function say(html) {
  toast.innerHTML = html;
  toast.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-on'), 2200);
}
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
  say(`<span class="led"></span>Copied ${text}`);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-copy]');
  if (b) { e.preventDefault(); copy(b.dataset.copy); }
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
  { group: 'Actions', reg: '⧉', name: 'Copy email address', hint: EMAIL, run: () => copy(EMAIL) },
  { group: 'Actions', reg: '↓', name: 'Download CV (PDF)', hint: 'felix.best', run: ext('https://felix.best/Felix_Cenusa_CV.pdf') },
  { group: 'Actions', reg: 'gh', name: 'GitHub profile', hint: 'FelixCenusa', run: ext('https://github.com/FelixCenusa') },
  { group: 'Actions', reg: 'in', name: 'LinkedIn', hint: 'felixcenusa', run: ext('https://linkedin.com/in/felixcenusa') },
  { group: 'Actions', reg: '↗', name: 'felix.best', hint: 'links', run: ext('https://felix.best') },
  { group: 'Actions', reg: '</>', name: 'View the source of this site', hint: 'GitHub', run: ext('https://github.com/FelixCenusa/portfolio') },
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

// scroll to a demo, then put focus on its first control once it has mounted
// (unless focus has moved on in the meantime)
function runDemo(el) {
  scrollToTarget(el);
  const from = document.activeElement, until = performance.now() + 6000;
  const poll = () => {
    if (document.activeElement !== from) return;
    const c = 'mounted' in el.dataset && $$('a[href], button, input, select, textarea, [tabindex]', el)
      .find((n) => n.tabIndex >= 0 && !n.disabled && n.getClientRects().length);
    if (c) c.focus({ preventScroll: true });
    else if (performance.now() < until) setTimeout(poll, 150);
  };
  poll();
}
// "run tis" from another page lands here
if (isHome) {
  let want = null;
  try { want = sessionStorage.getItem('palette-run'); sessionStorage.removeItem('palette-run'); } catch {}
  const el = want && $(`.demo[data-demo="${CSS.escape(want)}"]`);
  if (el) {
    if (document.readyState === 'complete') runDemo(el);
    else addEventListener('load', () => runDemo(el), { once: true });
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
  const shellCtx = () => ({ page: document.body.dataset.page || 'home', here: layerHere(), layers: siteTree(), email: EMAIL });

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
    else if (a.out) print(cmd, a.out, a.err);
    else if (a.copy) { copy(a.copy); print(cmd, [`copied ${a.copy}`]); }
    else {
      close();
      if (a.go) go(a.go)();
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
    const el = e.target, name = el.dataset.demo;
    import(new URL(`assets/js/demos/${name}.js`, ROOT).href)
      .then((m) => { el.dataset.mounted = ''; m.mount(el, { reducedMotion: reduced }); })
      .catch((err) => console.warn(`demo ${name} failed to load`, err));
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
const html = document.documentElement;
if (gsap && !reduced) {
  const mm = gsap.matchMedia();
  mm.add('(prefers-reduced-motion: no-preference)', () => {
    const ease = 'expo.out';

    // hero intro (the head script hid these to avoid a flash; only run if we're in time)
    const heroTitle = $('.hero__title');
    if (heroTitle && html.classList.contains('intro')) {
      const tl = gsap.timeline({ defaults: { ease }, delay: 0.1 });
      const fades = $$('[data-hero-fade]');
      gsap.set([...fades, '.hero__fig'], { autoAlpha: 0, y: 18 });
      html.classList.remove('intro');
      const eyebrow = $('[data-scramble]');
      if (eyebrow && ScrambleTextPlugin) {
        tl.to(eyebrow, { duration: 1.1, scrambleText: { text: eyebrow.textContent, chars: '01·/<>_', speed: 0.6, revealDelay: 0.2 }, ease: 'none' }, 0);
      }
      if (SplitText) {
        const split = SplitText.create(heroTitle, { type: 'lines', mask: 'lines', linesClass: 'line' });
        tl.from(split.lines, { yPercent: 110, duration: 1.3, stagger: 0.09 }, 0.05);
        tl.call(() => split.revert(), null, '>');
      } else {
        tl.from(heroTitle, { autoAlpha: 0, y: 24, duration: 1 }, 0.05);
      }
      tl.to(fades, { autoAlpha: 1, y: 0, duration: 1.1, stagger: 0.08 }, 0.45);
      tl.to('.hero__fig', { autoAlpha: 1, y: 0, duration: 1.6 }, 0.3);
    } else {
      html.classList.remove('intro');
    }

    // section headings: lines rise out of a mask as they come into view
    if (SplitText && ScrollTrigger) {
      $$('[data-split]').forEach((el) => {
        if (el === heroTitle) return;
        SplitText.create(el, {
          type: 'lines', mask: 'lines', autoSplit: true,
          onSplit: (self) => gsap.from(self.lines, {
            yPercent: 110, duration: 1.2, ease, stagger: 0.08,
            scrollTrigger: { trigger: el, start: 'top 88%', once: true },
          }),
        });
      });
    }

    // blocks fade up in batches
    if (ScrollTrigger) {
      const els = $$('[data-reveal]');
      gsap.set(els, { autoAlpha: 0, y: 28 });
      ScrollTrigger.batch(els, {
        start: 'top 90%', once: true,
        onEnter: (batch) => gsap.to(batch, { autoAlpha: 1, y: 0, duration: 1.1, ease, stagger: 0.07, overwrite: true }),
      });

      // each layer's "you are here" slab slides into place as its heading arrives
      $$('.layermap .is-here').forEach((el) => {
        gsap.from(el, { scaleX: 0, transformOrigin: '0 50%', duration: 1.2, ease, clearProps: 'transform', scrollTrigger: { trigger: el, start: 'top 88%', once: true } });
      });

      // the footer's bits light up as it arrives
      $$('.bits').forEach((b) => {
        gsap.from($$('i.on', b), { opacity: 0, duration: 0.4, stagger: { each: 0.02, from: 'random' }, scrollTrigger: { trigger: b, start: 'top 95%', once: true } });
      });
    }
    return () => html.classList.remove('intro');
  });
  // fonts change line breaks; let ScrollTrigger re-measure once they're in
  document.fonts && document.fonts.ready.then(() => ScrollTrigger && ScrollTrigger.refresh());
} else {
  html.classList.remove('intro');
}
