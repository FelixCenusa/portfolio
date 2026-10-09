/* Fig. 09 · 8-segment controller
   A two-digit 8-segment counter driven by a simulated ARM core, built to show
   the difference between polling and interrupts. Everything is simulated in
   the browser; timings on the analyzer are stretched so a person can see them. */

import { register } from '../instrument.js';

const NS = 'http://www.w3.org/2000/svg';
const SPAN = 4000;                        // analyzer window, ms
const HOLD_DELAY = 400, HOLD_RATE = 125;  // key auto-repeat
const AUTO_RATE = 600;                    // AUTO count interval
const IRQ_W = 36, ISR_LAT = 6, ISR_W = 70; // IRQ pulse, wake latency, handler time (ms, visual)
const POLL_HZ = 4800;                     // simulated polls per second
const CPU_WIN = 500;                      // CPU load averaging window
const HEAD = 160;                         // phosphor head on each trace, ms
const LAB = 40, PAD_R = 6, LANE = 30, TOP = 6, LA_H = TOP + LANE * 3 + 18;
const GLYPH = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f]; // bit 0 = a … bit 6 = g
const KEYS = { ArrowUp: 1, u: 1, U: 1, ArrowDown: -1, d: -1, D: -1 };
const DESC = {
  poll: '<b>Busy-wait.</b> The CPU re-reads the button register in a tight loop and is never idle.',
  irq: '<b>Sleep.</b> The CPU waits in WFI. A press or timer tick raises an IRQ; the handler counts.'
};
let uid = 0;

function el(tag, attrs, parent) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.append(n);
  return n;
}

/* Seven hexagonal segments (a…g) for one digit, centre lines on a 41 × 81 box. */
function segPolys() {
  const h = 4.5, G = 1.4, L = 4.5, R = 45.5, Y0 = 4.5, Y1 = 45, Y2 = 85.5;
  const H = (x1, x2, y) => [[x1 + G, y], [x1 + G + h, y - h], [x2 - G - h, y - h], [x2 - G, y], [x2 - G - h, y + h], [x1 + G + h, y + h]];
  const V = (x, y1, y2) => [[x, y1 + G], [x + h, y1 + G + h], [x + h, y2 - G - h], [x, y2 - G], [x - h, y2 - G - h], [x - h, y1 + G + h]];
  return [H(L, R, Y0), V(R, Y0, Y1), V(R, Y1, Y2), H(L, R, Y2), V(L, Y1, Y2), V(L, Y0, Y1), H(L, R, Y1)]
    .map(p => p.map(q => q.join(',')).join(' '));
}

function merge(iv) {
  iv.sort((p, q) => p[0] - q[0]);
  const out = [];
  for (const p of iv) {
    const l = out[out.length - 1];
    if (l && p[0] <= l[1]) l[1] = Math.max(l[1], p[1]);
    else out.push([p[0], p[1]]);
  }
  return out;
}

/* Logic-level path for sorted high intervals between tA and tB. An interval that
   runs past tB is still high, so the trace stays up at the right edge. */
function trace(iv, tA, tB, hi, lo, X) {
  const f = v => Math.round(v * 10) / 10;
  let d = '';
  for (const [a, b] of iv) {
    if (b <= tA || a >= tB) continue;
    const xa = f(X(Math.max(a, tA)));
    if (!d) d = a <= tA ? `M${xa} ${hi}` : `M${f(X(tA))} ${lo}H${xa}V${hi}`;
    else d += `H${xa}V${hi}`;
    if (b >= tB) return d + `H${f(X(tB))}`;
    d += `H${f(Math.max(X(b), xa + 1.2))}V${lo}`;
  }
  return (d || `M${f(X(tA))} ${lo}`) + `H${f(X(tB))}`;
}

export function mount(root, { reducedMotion = false } = {}) {
  const id = 'seg' + ++uid;
  const rm = !!reducedMotion;
  const st = { count: 0, mode: 'poll', dir: 1, auto: !rm, polls: 0, irqs: 0, base: 0.9 };
  const btn = [];                             // BTN high intervals {a, b}; b = Infinity while held
  const irq = [];                             // IRQ assert times
  const modes = [{ t: -Infinity, m: 'poll' }];
  const holds = new Map();                    // source -> { d, t1, t2 }
  const timers = new Set();
  const ac = new AbortController();
  const on = (t, type, fn) => t.addEventListener(type, fn, { signal: ac.signal });
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
  const cancel = t => { clearTimeout(t); timers.delete(t); };

  root.classList.add('demo--segment');
  root.classList.toggle('is-rm', rm);
  const ownTab = !root.hasAttribute('tabindex');
  if (ownTab) root.tabIndex = -1;            // clicking anywhere in the demo gives it keyboard focus

  const radio = (v, label, chk) =>
    `<button type="button" role="radio" aria-checked="${chk}" tabindex="${chk ? 0 : -1}" data-v="${v}">${label}</button>`;
  const key = (d, label, sw, path) =>
    `<div class="seg__keywrap"><button type="button" class="seg__key" data-d="${d}" aria-label="Count ${label.toLowerCase()}" aria-keyshortcuts="${d > 0 ? 'ArrowUp U' : 'ArrowDown D'}"><span class="seg__cap"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="${path}"/></svg>${label}</span></button><span class="seg__silk" aria-hidden="true">${sw}</span></div>`;
  const ro = (k, label, cls = '', inner = '') =>
    `<div class="readout ${cls}" data-r="${k}"><span class="label">${label}</span><b class="num">${inner}</b></div>`;

  const tpl = document.createElement('template');
  tpl.innerHTML = `
<div class="seg__top">
  <div class="seg__board">
    <div class="seg__bar" aria-hidden="true"><span class="seg__silk">DS1 2 × 8-seg</span><span class="seg__silk seg__core"><span class="led"></span>CPU</span></div>
    <div class="seg__window"></div>
    <div class="seg__keys">${key(1, 'Up', 'SW1', 'M2.5 7.5 6 4l3.5 3.5')}${key(-1, 'Down', 'SW2', 'M2.5 4.5 6 8l3.5-3.5')}</div>
  </div>
  <div class="seg__panel">
    <div class="seg__field"><span class="label" aria-hidden="true">Mode</span>
      <div class="switch seg__switch" role="radiogroup" aria-label="Input handling mode" data-g="mode">${radio('poll', 'Polling', true)}${radio('irq', 'Interrupt', false)}</div></div>
    <p class="seg__desc"></p>
    <div class="readouts seg__readouts">${ro('mode', 'Mode', '', '<span></span><span class="seg__st"></span>')}${ro('cpu', 'CPU', 'readout--fault')}${ro('ev', 'Polls')}${ro('count', 'Count', 'readout--accent')}</div>
    <div class="seg__row"><span class="label" aria-hidden="true">Dir</span>
      <div class="switch" role="radiogroup" aria-label="Auto count direction" data-g="dir">${radio('up', 'Up', true)}${radio('down', 'Down', false)}</div>
      <button type="button" class="ctl seg__auto" aria-label="Auto count" aria-pressed="${st.auto}"><span class="led${st.auto ? '' : ' led--off'}"></span>Auto</button></div>
  </div>
</div>
<div class="seg__la"><div class="seg__la-bar" aria-hidden="true"><span class="label">Logic analyzer</span><span class="label">1 s/div, 3 ch</span></div></div>
<div class="seg__foot"><p class="label">Simulation of the original ARM program. Runs in your browser.</p><p class="seg__hint"><kbd>↑</kbd><kbd>↓</kbd> or <kbd>U</kbd><kbd>D</kbd></p></div>
<p class="sr-only" aria-live="polite"></p>`;
  root.replaceChildren(tpl.content);

  const $ = s => root.querySelector(s);
  const keys = [...root.querySelectorAll('.seg__key')];
  const desc = $('.seg__desc'), live = $('[aria-live]'), autoBtn = $('.seg__auto'), led = $('.seg__core .led');
  const R = {}, V = {};
  root.querySelectorAll('[data-r]').forEach(n => { R[n.dataset.r] = n; V[n.dataset.r] = n.querySelector('b'); });
  const [modeV, coreV] = V.mode.children;
  const evLabel = R.ev.querySelector('.label');
  const put = (n, v) => { if (n._v !== v) { n._v = v; n.textContent = v; } };

  /* ---- display */
  const dsp = el('svg', { class: 'seg__digits', viewBox: '0 0 140 100', role: 'img', 'aria-label': 'Display: 00' });
  const sk = el('g', { transform: 'translate(10.5 5) skewX(-7)' }, dsp);
  const ghost = el('g', { class: 'seg__ghost' }, sk);
  const lit = el('g', { class: 'seg__lit' }, sk);
  const segs = [[], []], dps = [];
  const polys = segPolys();
  for (let i = 0; i < 2; i++) {
    const tr = `translate(${i * 74} 0)`, gg = el('g', { transform: tr }, ghost), lg = el('g', { transform: tr }, lit);
    for (const p of polys) { el('polygon', { points: p }, gg); segs[i].push(el('polygon', { points: p }, lg)); }
    el('circle', { cx: 56, cy: 85.5, r: 4.3 }, gg);
    dps.push(el('circle', { cx: 56, cy: 85.5, r: 4.3 }, lg));
  }
  $('.seg__window').append(dsp);

  function showCount() {
    const n = st.count, s = String(n).padStart(2, '0');
    [Math.floor(n / 10), n % 10].forEach((v, i) => segs[i].forEach((p, k) => p.classList.toggle('is-on', !!(GLYPH[v] >> k & 1))));
    dsp.setAttribute('aria-label', 'Display: ' + s);
    put(V.count, s);
  }

  /* ---- logic analyzer */
  const la = el('svg', { class: 'seg__trace', 'aria-hidden': 'true', height: LA_H });
  $('.seg__la').append(la);
  const gridG = el('g', { class: 'seg__grid' }, la);
  const lanes = ['BTN', 'IRQ', 'CPU'].map((name, i) => {
    const y = TOP + i * LANE;
    el('text', { x: 0, y: y + 17, class: 'seg__lb seg__lb--' + name.toLowerCase() }, la).textContent = name;
    return {
      hi: y + 5, lo: y + 22,
      fl: el('path', { class: 'seg__fl' }, la), tr: el('path', { class: 'seg__tr' }, la),
      hd: el('path', { class: 'seg__hd' }, la), dot: el('circle', { class: 'seg__dot', r: 2.4 }, la)
    };
  });
  let W = 0, kx = 1, P = 40;

  const rso = new ResizeObserver(es => {
    const w = Math.round(es[es.length - 1].contentRect.width);
    if (!w || w === W) return;
    W = w;
    la.setAttribute('viewBox', `0 0 ${W} ${LA_H}`);
    const pw = W - LAB - PAD_R;
    kx = pw / SPAN;
    P = Math.max(25, Math.round(SPAN * 7 / pw / 5) * 5); // about 7 px per poll cycle
    gridG.replaceChildren();
    for (const l of lanes) el('line', { x1: LAB, x2: W - PAD_R, y1: l.lo + 0.5, y2: l.lo + 0.5, class: 'seg__base' }, gridG);
    for (let k = 0; k <= 4; k++) {
      const x = Math.round(LAB + k * pw / 4) + (k === 4 ? -0.5 : 0.5);
      el('line', { x1: x, x2: x, y1: TOP - 3, y2: TOP + LANE * 3, class: k === 4 ? 'seg__now' : '' }, gridG);
      el('text', { x, y: LA_H - 3, class: 'seg__ax', 'text-anchor': k === 0 ? 'start' : k === 4 ? 'end' : 'middle' }, gridG)
        .textContent = k === 4 ? 'now' : `−${4 - k} s`;
    }
    render(performance.now());
  });
  rso.observe(la);

  function cpuIv(t0, t1) {
    const out = [];
    modes.forEach((m, i) => {
      if (m.m !== 'poll') return;
      const s = Math.max(m.t, t0), e = Math.min(i + 1 < modes.length ? modes[i + 1].t : Infinity, t1);
      for (let k = Math.floor(s / P); k * P < e; k++) {
        const a = Math.max(k * P, s), b = Math.min(k * P + P * 0.6, e);
        if (b > a) out.push([a, b]);
      }
    });
    for (const t of irq) out.push([t + ISR_LAT, t + ISR_LAT + ISR_W]);
    return merge(out);
  }

  function draw(now) {
    if (!W) return;
    const t0 = now - SPAN, X = t => LAB + (t - t0) * kx;
    const sets = [btn.map(o => [o.a, o.b]), merge(irq.map(t => [t, t + IRQ_W])), cpuIv(t0, now)];
    lanes.forEach((l, i) => {
      const iv = sets[i], d = trace(iv, t0, now, l.hi, l.lo, X);
      l.tr.setAttribute('d', d);
      l.fl.setAttribute('d', `${d}V${l.lo}H${LAB}Z`);
      l.hd.setAttribute('d', trace(iv, now - HEAD, now, l.hi, l.lo, X));
      l.dot.setAttribute('cx', X(now).toFixed(1));
      l.dot.setAttribute('cy', iv.some(([a, b]) => a <= now && b >= now) ? l.hi : l.lo);
    });
  }

  /* ---- readouts */
  function cpuPct(now) {
    if (st.mode === 'poll') return 100;
    let busy = 0;
    for (const t of irq) {
      const a = Math.max(t + ISR_LAT, now - CPU_WIN), b = Math.min(t + ISR_LAT + ISR_W, now);
      if (b > a) busy += b - a;
    }
    const f = busy / CPU_WIN;
    return f * 100 + (1 - f) * st.base;
  }

  function prune(now) {
    const cut = now - SPAN - 200;
    while (btn.length && btn[0].b < cut) btn.shift();
    while (irq.length && irq[0] + ISR_LAT + ISR_W < cut) irq.shift();
    while (modes.length > 1 && modes[1].t < cut) modes.shift();
  }

  function render(now, withTrace = true) {
    prune(now);
    const poll = st.mode === 'poll', lastIrq = irq[irq.length - 1];
    const isr = !poll && lastIrq !== undefined && now - lastIrq < ISR_LAT + ISR_W;
    put(V.cpu, cpuPct(now).toFixed(1) + '%');
    put(V.ev, poll ? Math.floor(st.polls).toLocaleString('en-US') : String(st.irqs));
    put(modeV, poll ? 'POLL' : 'IRQ');
    put(coreV, poll ? 'spin' : isr ? 'isr' : 'wfi');
    coreV.classList.toggle('is-live', isr);
    led.classList.toggle('is-fault', poll);
    led.classList.toggle('led--off', !poll && !isr);
    if (withTrace) draw(now);
  }

  /* ---- announcements, at most one a second */
  let sayT = 0, sayAt = -1e9, sayMsg = '';
  function say(msg) {
    sayMsg = msg;
    if (sayT) return;
    sayT = setTimeout(() => { sayT = 0; sayAt = performance.now(); live.textContent = sayMsg; },
      Math.max(300, sayAt + 1000 - performance.now()));
  }
  const modeName = () => (st.mode === 'poll' ? 'polling' : 'interrupt');

  /* ---- the counter */
  let dpT = 0, flT = 0, fuT = 0;
  function step(d, cause) {
    const now = performance.now();
    if (st.mode === 'irq') {
      irq.push(now);
      st.irqs++;
      R.ev.classList.add('readout--signal');
      cancel(flT);
      flT = later(() => R.ev.classList.remove('readout--signal'), 180);
    }
    st.count = (st.count + d + 100) % 100;
    showCount();
    dps[1].classList.add('is-on');                // DP blinks once per count
    cancel(dpT);
    dpT = later(() => dps[1].classList.remove('is-on'), 120);
    if (cause !== 'tmr') say(`Count ${st.count}, ${modeName()} mode`);
    if (rm || !running) {                         // event-driven redraw only (reduced motion, or held by Stop)
      render(now);
      cancel(fuT);
      fuT = later(() => render(performance.now()), ISR_LAT + ISR_W + 30);
    }
  }

  const syncKeys = () => keys.forEach(k => {
    const d = +k.dataset.d;
    k.classList.toggle('is-down', [...holds.values()].some(h => h.d === d));
  });

  function press(src, d) {
    if (holds.has(src)) return;
    if (!holds.size) btn.push({ a: performance.now(), b: Infinity });
    const h = { d, t1: 0, t2: 0 };
    holds.set(src, h);
    syncKeys();
    step(d, 'press');
    h.t1 = setTimeout(() => { h.t2 = setInterval(() => step(d, 'rep'), HOLD_RATE); }, HOLD_DELAY);
  }

  function release(src) {
    const h = holds.get(src);
    if (!h) return;
    clearTimeout(h.t1);
    clearInterval(h.t2);
    holds.delete(src);
    if (!holds.size && btn.length) btn[btn.length - 1].b = performance.now();
    syncKeys();
    if (rm || !running) render(performance.now());
  }
  const releaseAll = () => [...holds.keys()].forEach(release);

  /* ---- switches */
  function check(g, v) {
    root.querySelectorAll(`[data-g="${g}"] [role="radio"]`).forEach(b => {
      const yes = b.dataset.v === v;
      b.setAttribute('aria-checked', String(yes));
      b.tabIndex = yes ? 0 : -1;
    });
  }

  function setMode(m, quiet) {
    if (m === st.mode && !quiet) return;
    const now = performance.now(), poll = m === 'poll';
    if (m !== st.mode) modes.push({ t: now, m });
    st.mode = m;
    check('mode', m);
    root.classList.toggle('is-irq', !poll);
    R.cpu.classList.toggle('readout--fault', poll);
    R.ev.classList.remove('readout--signal');
    evLabel.textContent = poll ? 'Polls' : 'IRQ';
    desc.innerHTML = DESC[m];
    if (!quiet) say(poll ? `Polling mode, CPU busy at 100 percent, count ${st.count}`
      : `Interrupt mode, CPU asleep until a press, count ${st.count}`);
    render(now);
  }

  function setDir(v) {
    st.dir = v === 'up' ? 1 : -1;
    check('dir', v);
    say(`Auto count direction ${v}`);
  }

  function select(b) {
    const g = b.parentElement.dataset.g;
    if (g === 'mode') setMode(b.dataset.v); else setDir(b.dataset.v);
  }

  let autoT = 0;
  function setAuto() {
    clearInterval(autoT);
    autoT = running && st.auto ? setInterval(() => step(st.dir, 'tmr'), AUTO_RATE) : 0;
  }

  /* ---- input */
  on(root, 'click', e => {
    const r = e.target.closest('[role="radio"]');
    if (r && root.contains(r)) select(r);
  });
  on(autoBtn, 'click', () => {
    st.auto = !st.auto;
    autoBtn.setAttribute('aria-pressed', String(st.auto));
    autoBtn.firstChild.classList.toggle('led--off', !st.auto);
    setAuto();
    say(`Auto count ${st.auto ? 'on' : 'off'}`);
  });

  keys.forEach(k => {
    const d = +k.dataset.d;
    on(k, 'pointerdown', e => {
      if (e.button) return;
      try { k.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      press('p' + e.pointerId, d);
    });
    const up = e => release('p' + e.pointerId);
    on(k, 'pointerup', up);
    on(k, 'pointercancel', up);
    on(k, 'lostpointercapture', up);
    on(k, 'click', e => {                         // keyboard or assistive-tech activation
      if (e.detail) return;
      press('c' + d, d);
      later(() => release('c' + d), 110);
    });
    on(k, 'contextmenu', e => e.preventDefault());
  });

  on(root, 'keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const d = KEYS[e.key];
    if (d) {
      e.preventDefault();
      if (!e.repeat) press(d > 0 ? 'kU' : 'kD', d);
      return;
    }
    const r = e.target.closest && e.target.closest('[role="radio"]');
    if (r && /^(ArrowLeft|ArrowRight|Home|End)$/.test(e.key)) {
      e.preventDefault();
      const all = [...r.parentElement.children], i = all.indexOf(r), n = all.length;
      const j = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
      all[j].focus();
      select(all[j]);
    }
  });
  on(root, 'keyup', e => { const d = KEYS[e.key]; if (d) release(d > 0 ? 'kU' : 'kD'); });
  on(root, 'focusout', e => { if (!root.contains(e.relatedTarget)) { release('kU'); release('kD'); } });
  on(window, 'blur', releaseAll);

  /* ---- run only while on screen and the tab is visible */
  let running = false, seen = false, raf = 0, slow = 0, last = 0, baseT = 0;
  function tick(now, dt) {
    if (st.mode === 'poll') st.polls += dt * POLL_HZ / 1000 * (0.94 + Math.random() * 0.12);
    if (now - baseT > 400) { baseT = now; st.base = 0.5 + Math.random() * 0.9; }
  }
  function frame() {
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    tick(now, Math.min(100, now - last));
    last = now;
    render(now);
  }
  function start() {
    last = performance.now();
    if (rm) {
      slow = setInterval(() => {               // numbers only; the analyzer waits for events
        const now = performance.now();
        tick(now, Math.min(1100, now - last));
        last = now;
        render(now, false);
      }, 1000);
      render(last);
    } else raf = requestAnimationFrame(frame);
    setAuto();
  }
  function stop() {
    cancelAnimationFrame(raf);
    clearInterval(slow);
    clearInterval(autoT);
    raf = slow = autoT = 0;
    releaseAll();
  }
  function sync() {
    const want = seen && !document.hidden && !held;
    if (want === running) return;
    running = want;
    if (want) start(); else stop();
  }
  // the page's Run/Stop key holds the picture; key presses still redraw it
  let held = false;
  const unhold = register({ start() { held = false; sync(); }, stop() { held = true; sync(); } });
  const io = new IntersectionObserver(es => { seen = es[es.length - 1].isIntersecting; sync(); });
  io.observe(root);
  on(document, 'visibilitychange', sync);

  showCount();
  setMode('poll', true);

  return {
    destroy() {
      running = false;
      unhold();
      stop();
      ac.abort();
      io.disconnect();
      rso.disconnect();
      timers.forEach(clearTimeout);
      timers.clear();
      clearTimeout(sayT);
      if (ownTab) root.removeAttribute('tabindex');
    }
  };
}
