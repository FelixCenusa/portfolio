// Readouts: real measurements under each layer heading, and the timebase.
//
// A scope prints what it measured under the screen. Each layer heading gets
// one row like that, and every number in it is real: about this visit, or
// about the code in the demos below it. Each is measured once, at idle, and
// nothing polls.
//   L4  how long this page took to load, and how much came over the network
//   L3  how often your screen draws a frame (60 frames, around their median)
//   L2  the Aristotle solver's whole search, run in small slices at idle
//   L1  the FAT demo's disk, followed live through its 'fat:change' event
//   L0  how many instructions a second the TIS node's interpreter can run (best of three 10 ms runs)
// A timebase steps down as you descend, 50 ms/div to 10 ns/div: the same
// screen, deeper down. Each row shows its own; on wide screens the rail shows
// the current one, and so does any element marked [data-timebase].
//
// Values settle with the site's step response (ease.js) once their row is on
// screen; the timebase re-ranges with ScrambleText on its numerals only.
// Reduced motion, or the instrument stopped: values just appear.
//
// Other modules can use the numbers:
//   import { measured } from './readouts.js';     // { l4: { loadMs, bytes }, l3: { frameMs, hz }, … }
//   document.addEventListener('scope:measure', (e) => e.detail);   // { layer, …the new values }
//   attachTimebase(el);   // a timebase cell built later than this module, kept in step
//   detachTimebase(el);   // …and let go of again when its element goes away
// The shell gets `probe [layer]`, which prints them (all, or one layer's).

import { ring } from './ease.js';
import { reducedMotion, isRunning } from './instrument.js';
import { addCommand, VERBS } from './shell.js';

const THIN = ' '; // between a value and its unit
const NAMES = { l4: 'web', l3: 'apps', l2: 'algorithms', l1: 'systems', l0: 'metal' };
const ORDER = ['l4', 'l3', 'l2', 'l1', 'l0'];

/* ------------------------------------------------------------ numbers (pure, so node can test them) */

// A reading is { n, d, unit }: n already in `unit`, shown with d decimals, or
// { n, count: true } for an exact count shown with thousands separators.
// Measured values keep at most three significant figures, as scopes do.

// the largest unit that keeps the value at 1 or more once it's rounded to 3 figures.
// units: [[factor, label], …] smallest first. whole: no decimals in the first unit (bytes)
export function scaled(x, units, { whole = false } = {}) {
  let [f, unit] = units[0];
  for (const [uf, ul] of units) if (Math.abs(+(x / uf).toPrecision(3)) >= 1) [f, unit] = [uf, ul];
  const n = +(x / f).toPrecision(3);
  const e = n ? Math.floor(Math.log10(Math.abs(n))) : 0;
  return { n, d: whole && f === units[0][0] ? 0 : Math.max(0, 2 - e), unit };
}

const TIME = [[1e-6, 'ns'], [1e-3, 'µs'], [1, 'ms'], [1e3, 's']];        // from milliseconds
const BYTES = [[1, 'B'], [1e3, 'kB'], [1e6, 'MB'], [1e9, 'GB']];             // SI, as a scope would
const RATE = [[1, ''], [1e3, 'thousand'], [1e6, 'million'], [1e9, 'billion']];

export const time = (ms) => scaled(ms, TIME);
export const bytes = (b) => scaled(b, BYTES, { whole: true });
export const rate = (perSecond) => scaled(perSecond, RATE, { whole: true });
export const count = (n) => ({ n: Math.round(n), count: true, unit: '' });
export const hertz = (hz) => ({ n: Math.round(hz), d: 0, unit: 'Hz' });
export const blockSize = (b) => (b < 1024 ? { n: b, d: 0, unit: 'B' } : { n: b / 1024, d: 0, unit: 'KiB' }); // as the FAT demo writes them

// the text of a reading, or of a value on its way to it (same unit, same decimals)
export function show(r, v = r.n) {
  if (r.count) return Math.round(v).toLocaleString('en-US');
  return (Math.abs(v) < 0.5 * 10 ** -r.d ? 0 : v).toFixed(r.d);
}
export const withUnit = (r) => (r.unit ? `${show(r)}${THIN}${r.unit}` : show(r));

export function median(xs) {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
// the frame interval: the median picks the typical frame, and averaging the frames
// near it undoes the 1 ms rounding some browsers put on rAF timestamps
export function frameInterval(deltas) {
  const m = median(deltas), near = deltas.filter((x) => Math.abs(x - m) <= m * 0.25);
  return near.reduce((a, b) => a + b, 0) / near.length;
}

// the timebase per layer, and what that scale is about (ten divisions across the screen)
export const TIMEBASE = {
  l4: { n: 50, unit: 'ms/div', ms: 50, say: '50 milliseconds per division', cap: 'half a second across the screen' },
  l3: { n: 5, unit: 'ms/div', ms: 5, say: '5 milliseconds per division', cap: 'a few frames across the screen' },
  l2: { n: 500, unit: 'µs/div', ms: 0.5, say: '500 microseconds per division', cap: 'thousands of solver placements across the screen' },
  l1: { n: 20, unit: 'µs/div', ms: 0.02, say: '20 microseconds per division', cap: 'a few SSD block reads across the screen' },
  l0: { n: 10, unit: 'ns/div', ms: 1e-5, say: '10 nanoseconds per division', cap: 'a few hundred CPU clock cycles across the screen' },
};
const DIVS = 10;

// what was measured, filled in as readings land
export const measured = {};

// the caption, made exact where this visit measured the thing it compares with
export function caption(id, m = measured) {
  const tb = TIMEBASE[id];
  if (!tb) return '';
  const screen = tb.ms * DIVS;
  if (id === 'l4' && m.l4 && m.l4.loadMs > 0) {
    const k = screen / m.l4.loadMs; // this page's loads per screen
    if (k >= 2 / 3) return Math.round(k) === 1 ? 'about one load of this page across the screen' : `about ${Math.round(k)} loads of this page across the screen`;
    return `this page's load fills about ${Math.round(1 / k)} screens`;
  }
  if (id === 'l3' && m.l3 && m.l3.frameMs > 0) {
    const k = Math.max(1, Math.round(screen / m.l3.frameMs));
    return `about ${k} of your frames across the screen`;
  }
  if (id === 'l2' && m.l2 && m.l2.nodes > 0 && m.l2.ms > 0) {
    const k = +((m.l2.nodes / m.l2.ms) * screen).toPrecision(2);
    return `about ${k.toLocaleString('en-US')} solver placements across the screen`;
  }
  return tb.cap;
}

function record(id, data) {
  Object.assign((measured[id] ||= {}), data);
  document.dispatchEvent(new CustomEvent('scope:measure', { detail: { layer: id, ...data } }));
}

/* ------------------------------------------------------------ the rows */

const V = (k) => `<span class="ro__val" data-k="${k}"><b class="ro__v" aria-hidden="true">—</b><span class="ro__u" aria-hidden="true"></span><span class="sr-only">not measured yet</span></span>`;
const L = (t) => `<span class="ro__l">${t}</span>`;
// each layer's row: items of words (sans) and values (mono, each with its unit in sans)
const ITEMS = {
  l4: { load: `${L('This page loaded in')} ${V('load')}`, bytes: `${V('bytes')} ${L('transferred')}` },
  l3: { frame: `${L('Your screen draws a frame every')} ${V('frame')} ${L('(')}${V('hz')}${L(')')}` },
  l2: { solve: `${L('The solver below found all')} ${V('sols')} ${L('solutions in')} ${V('solve')}`, nodes: `${V('nodes')} ${L('placements tried')}` },
  l1: { disk: `${L('The disk below has')} ${V('blocks')} ${L('blocks of')} ${V('bs')}`, used: `${V('used')} ${L('in use')}` },
  l0: { ips: `${L('The node\'s interpreter can run')} ${V('ips')} ${L('instructions a second in your browser')}` },
};

const rows = new Map(); // id -> { id, el, slots: Map(key -> slot), tb, cap, seen, vis }
const tbSlots = [];     // the rail's timebase, and any [data-timebase] element
let active = null;

const RING = ring();
// how far the step response overshoots (about 9%), so a settling value can hold room for its widest text
const OVERSHOOT = Array.from({ length: 1001 }, (_, i) => RING(i / 1000)).reduce((a, b) => Math.max(a, b), 1) - 1;
const gsap = () => window.gsap;
const instant = () => reducedMotion || !isRunning() || !gsap();

function buildRow(head, id) {
  const tb = TIMEBASE[id];
  const el = document.createElement('div');
  el.className = 'ro';
  el.dataset.ro = id; // not data-layer: other code reads [data-layer] as the sections
  el.innerHTML = Object.entries(ITEMS[id]).map(([k, h]) => `<p class="ro__m" data-item="${k}">${h}</p>`).join('')
    + `<p class="ro__tb"><i class="ro__tick" aria-hidden="true"></i>${L('Timebase')} ${V('tb')}${L(',')} <span class="ro__l ro__cap"></span></p>`;
  head.append(el);
  const row = { id, el, slots: new Map(), seen: false, vis: false, cap: el.querySelector('.ro__cap') };
  el.querySelectorAll('.ro__val').forEach((s) => row.slots.set(s.dataset.k, {
    el: s, b: s.querySelector('b'), u: s.querySelector('.ro__u'), sr: s.querySelector('.sr-only'), r: null, tw: null,
  }));
  // the row's own timebase is fixed: write it straight in
  const t = row.slots.get('tb');
  row.slots.delete('tb');
  t.b.textContent = String(tb.n); t.u.textContent = THIN + tb.unit; t.sr.textContent = tb.say;
  row.tb = t;
  row.cap.textContent = caption(id);
  rows.set(id, row);
  return row;
}

// swap a row item for plain words (a measurement this browser can't make)
function sayInstead(id, item, words) {
  const row = rows.get(id), p = row && row.el.querySelector(`[data-item="${item}"]`);
  if (!p) return;
  p.querySelectorAll('.ro__val').forEach((s) => row.slots.delete(s.dataset.k));
  p.innerHTML = L(words);
}
function dropItem(id, item) {
  const row = rows.get(id), p = row && row.el.querySelector(`[data-item="${item}"]`);
  if (!p) return;
  p.querySelectorAll('.ro__val').forEach((s) => row.slots.delete(s.dataset.k));
  p.remove();
}

// put a reading in a slot: it settles if its row is on screen, and waits for the row otherwise
function put(id, key, r) {
  const row = rows.get(id), slot = row && row.slots.get(key);
  if (!slot) return;
  const prev = slot.r, same = prev && prev.unit === r.unit && !prev.count === !r.count;
  slot.r = r;
  slot.u.textContent = r.unit ? THIN + r.unit : '';
  slot.sr.textContent = withUnit(r);
  if (same && prev.n === r.n && prev.d === r.d) { // nothing moved
    if (!slot.tw && (row.seen || instant())) slot.b.textContent = show(r);
    return;
  }
  if (instant()) { draw(slot, null); return; }
  if (!row.seen) return; // still offscreen: it settles when the row arrives
  draw(slot, row.vis ? (same ? prev.n : 0) : null);
}

// from: where the number settles from, or null to just write it
function draw(slot, from) {
  const r = slot.r, b = slot.b, final = show(r);
  if (slot.tw) { slot.tw.kill(); slot.tw = null; }
  if (from == null || instant()) { b.textContent = final; b.style.minWidth = ''; return; }
  const o = { v: from };
  // tabular figures: hold the widest text the tween can show (where it starts, its overshoot, where
  // it ends) so the words beside it stay put while it rings. 950 rings through about 1036.
  const peak = r.n + (r.n - from) * OVERSHOOT;
  b.style.minWidth = `${Math.max(final.length, show(r, from).length, show(r, peak).length)}ch`;
  slot.tw = gsap().to(o, {
    v: r.n, duration: 0.8, ease: RING,
    onUpdate: () => { b.textContent = show(r, o.v); },
    onComplete: () => { b.textContent = final; b.style.minWidth = ''; slot.tw = null; },
  });
}

function arrive(row) {
  row.seen = true;
  row.slots.forEach((slot) => { if (slot.r) draw(slot, 0); });
}

/* ------------------------------------------------------------ the timebase */

function buildTbSlot(host) {
  host.innerHTML = '<span class="tb__l">Timebase</span><span class="tb__r"><i class="tb__tick"></i><b class="tb__v"></b><span class="tb__u"></span></span><span class="tb__cap"></span>';
  const slot = { el: host, v: host.querySelector('.tb__v'), u: host.querySelector('.tb__u'), cap: host.querySelector('.tb__cap'), id: null };
  tbSlots.push(slot);
  return slot;
}

function paintTb(slot, id, animate) {
  const tb = TIMEBASE[id], text = String(tb.n), g = gsap();
  slot.id = id;
  slot.el.style.setProperty('--ch', `var(--ch-${id})`);
  slot.el.style.setProperty('--step', `${ORDER.indexOf(id) * 5}px`); // under its level of the rail's trace
  slot.u.textContent = THIN + tb.unit;
  slot.cap.textContent = caption(id);
  if (g) g.killTweensOf(slot.v);
  if (!animate || instant()) { slot.v.textContent = text; if (g) g.set(slot.v, { clearProps: 'transform' }); return; }
  // re-ranging: the numerals scramble to the new scale while the value steps into place
  if (window.ScrambleTextPlugin) g.to(slot.v, { duration: 0.5, ease: 'none', scrambleText: { text, chars: '0123456789', speed: 1, revealDelay: 0.12 } });
  else slot.v.textContent = text;
  g.fromTo(slot.v, { y: -5 }, { y: 0, duration: 0.6, ease: RING });
}

// for a timebase cell built later (the lab's instrument bar, say): it follows the active layer
// from now on. Returns null on a page without layers.
export function attachTimebase(host) {
  if (!rows.size || !host || tbSlots.some((s) => s.el === host)) return null;
  const slot = buildTbSlot(host);
  paintTb(slot, active || 'l4', false);
  return slot;
}
// stop keeping a cell in step (the lab bar calls this when it's turned off). True if it was attached.
export function detachTimebase(host) {
  const i = tbSlots.findIndex((s) => s.el === host);
  if (i < 0) return false;
  dropTbSlot(i);
  return true;
}
function dropTbSlot(i) {
  const [slot] = tbSlots.splice(i, 1), g = gsap();
  if (g) g.killTweensOf(slot.v);
}
// let go of any cell whose element has left the page without being detached
function prune() {
  for (let i = tbSlots.length - 1; i >= 0; i--) if (!tbSlots[i].el.isConnected) dropTbSlot(i);
}

function setActive(id) {
  if (id === active) return;
  active = id;
  rows.forEach((row, k) => row.el.toggleAttribute('data-active', k === id));
  if (!id) return;
  prune();
  tbSlots.forEach((slot) => paintTb(slot, id, slot.id != null));
  // the row's own timebase re-acquires: the same numerals, scrambled back into place
  const row = rows.get(id), g = gsap();
  if (row && row.vis && !instant() && window.ScrambleTextPlugin) {
    g.killTweensOf(row.tb.b);
    g.to(row.tb.b, { duration: 0.45, ease: 'none', scrambleText: { text: String(TIMEBASE[id].n), chars: '0123456789', speed: 1, revealDelay: 0.1 } });
  }
}

function refreshCaption(id) {
  const row = rows.get(id);
  if (row) row.cap.textContent = caption(id);
  prune();
  tbSlots.forEach((slot) => { if (slot.id === id) slot.cap.textContent = caption(id); });
}

// which layer is active: the depth rail's rule (main.js), read the way the rail reads it, from
// live positions on every scroll (at most once a frame), so the two agree. Positions measured
// ahead of time would go stale whenever a demo above mounts and grows.
// While the layers span 45% down the viewport, it's the last one whose top has passed that line.
function follow(sections) {
  const recompute = () => {
    const mid = innerHeight * 0.45, first = sections[0], last = sections[sections.length - 1];
    let id = null;
    if (first.getBoundingClientRect().top < mid && last.getBoundingClientRect().bottom > mid) {
      for (const s of sections) if (s.getBoundingClientRect().top < mid) id = s.dataset.layer;
    }
    setActive(id);
  };
  let queued = false;
  const soon = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; recompute(); });
  };
  addEventListener('scroll', soon, { passive: true });
  addEventListener('resize', soon, { passive: true });
  // a demo mounting or growing moves the layers below it without any scroll
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(soon);
    sections.forEach((s) => ro.observe(s));
  }
  recompute();
}

/* ------------------------------------------------------------ measuring, once, at idle */

const afterLoad = (fn) => {
  if (document.readyState === 'complete') setTimeout(fn, 0);
  else addEventListener('load', () => setTimeout(fn, 0), { once: true }); // loadEventEnd is 0 until the load handlers finish
};
// the next idle moment with at least `need` ms free (or the timeout)
function idle(need = 0, tries = 12) {
  return new Promise((resolve) => {
    const ask = (n) => {
      if (!window.requestIdleCallback) { setTimeout(() => resolve({ timeRemaining: () => Math.max(need, 8), didTimeout: true }), 30); return; }
      requestIdleCallback((dl) => (dl.didTimeout || dl.timeRemaining() >= need || n <= 0 ? resolve(dl) : ask(n - 1)), { timeout: 1500 });
    };
    ask(tries);
  });
}
const whenVisible = () => new Promise((resolve) => {
  if (!document.hidden) { resolve(); return; }
  const on = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', on); resolve(); } };
  document.addEventListener('visibilitychange', on);
});

function showSolver({ solutions, nodes, ms }, byVisitor = false) {
  if (!(ms > 0)) { sayInstead('l2', 'solve', 'Run the solver below to measure it'); dropItem('l2', 'nodes'); return; } // a frozen or coarse clock read nothing
  record('l2', { solutions, nodes, ms, byVisitor });
  put('l2', 'sols', count(solutions));
  put('l2', 'solve', time(ms));
  put('l2', 'nodes', count(nodes));
  refreshCaption('l2');
}
function showDisk({ blocks, blockSize: bs, used, free }) {
  record('l1', { blocks, blockSize: bs, used, free });
  put('l1', 'blocks', count(blocks));
  put('l1', 'bs', blockSize(bs));
  put('l1', 'used', count(used));
}

const MEASURE = {
  // L4: navigation and resource timing; it's all same origin, so the sizes are there
  l4() {
    const nav = performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
    let loadMs = 0;
    if (nav && nav.loadEventEnd > 0) loadMs = nav.loadEventEnd - (nav.activationStart || 0);
    else if (performance.timing && performance.timing.loadEventEnd > 0) loadMs = performance.timing.loadEventEnd - performance.timing.navigationStart;
    if (loadMs > 0) { record('l4', { loadMs }); put('l4', 'load', time(loadMs)); refreshCaption('l4'); }
    else dropItem('l4', 'load');

    if (nav && typeof nav.transferSize === 'number') {
      let sum = nav.transferSize;
      for (const r of performance.getEntriesByType('resource')) sum += r.transferSize || 0;
      record('l4', { bytes: sum });
      if (sum > 0) put('l4', 'bytes', bytes(sum));
      else sayInstead('l4', 'bytes', 'Everything came from your cache');
    } else dropItem('l4', 'bytes');
  },

  // L3: 60 frame intervals, once. This is a one-off measurement of about a second, not a
  // loop: it reads rAF's own vsync timestamps, which gsap.ticker (its clock, its fps cap) would blur
  async l3() {
    await idle();
    await whenVisible();
    const deltas = await new Promise((resolve) => {
      const d = [];
      let last = 0;
      const tick = (t) => {
        if (last && t - last > 0 && t - last < 100) d.push(t - last); // a hidden tab or a long task isn't a frame
        last = t;
        if (d.length < 60) requestAnimationFrame(tick); else resolve(d);
      };
      requestAnimationFrame(tick);
    });
    const frameMs = frameInterval(deltas), hz = 1000 / frameMs;
    record('l3', { frameMs, hz });
    put('l3', 'frame', time(frameMs));
    put('l3', 'hz', hertz(hz));
    refreshCaption('l3');
  },

  // L2: the solver's whole search, a few milliseconds at a time; only its own compute time counts
  async l2() {
    let mod;
    try { mod = await import('./demos/aristotle.js'); } catch { sayInstead('l2', 'solve', 'Run the solver below to measure it'); dropItem('l2', 'nodes'); return; }
    const s = mod.newState(), g = mod.search(s);
    let ms = 0, sols = 0, done = false;
    while (!done) {
      const dl = await idle(4);
      if (measured.l2 && measured.l2.byVisitor) return; // the visitor ran it themselves meanwhile
      const budget = Math.max(3, Math.min(8, dl.timeRemaining() - 1)), t0 = performance.now();
      for (let i = 1; ; i++) {
        const r = g.next();
        if (r.done) { done = true; break; }
        if (r.value === 2) sols++;
        if (!(i & 511) && performance.now() - t0 > budget) break;
      }
      ms += performance.now() - t0;
    }
    if (measured.l2 && measured.l2.byVisitor) return; // the visitor's own run got there first
    showSolver({ solutions: sols, nodes: s.nodes, ms });
  },

  // L1: the disk as the demo starts it; the demo's own events take over once it's running
  async l1() {
    if (measured.l1) return;
    try {
      const { FatFS, seed } = await import('./demos/fat.js');
      if (measured.l1) return;
      const fs = seed(new FatFS(512)), st = fs.stats();
      showDisk({ blocks: fs.n, blockSize: fs.bs, used: st.used, free: st.free });
    } catch { if (!measured.l1) { dropItem('l1', 'disk'); dropItem('l1', 'used'); } }
  },

  // L0: what the interpreter can do, not what the node on screen does (it steps a few times a
  // second, for show). Three 10 ms runs, each in its own idle moment; the best counts. The
  // first run is cold (the JIT hasn't compiled the interpreter yet) and reads several times
  // slow, so averaging it in would undersell the rest.
  async l0() {
    let mod;
    try { mod = await import('./demos/tis.js'); } catch { dropItem('l0', 'ips'); return; }
    if (typeof mod.bench !== 'function') { dropItem('l0', 'ips'); return; }
    let best = null;
    for (let k = 0; k < 3; k++) {
      await idle(10);
      const r = mod.bench(10);
      if (r.ms > 0 && (!best || r.instructions / r.ms > best.instructions / best.ms)) best = r;
    }
    if (!best) { dropItem('l0', 'ips'); return; }
    const perSecond = best.instructions / (best.ms / 1000);
    record('l0', { perSecond, instructions: best.instructions, ms: best.ms });
    put('l0', 'ips', rate(perSecond));
  },
};

const started = new Set();
function want(id) {
  if (started.has(id) || !MEASURE[id] || !rows.has(id)) return;
  started.add(id);
  afterLoad(() => { Promise.resolve().then(MEASURE[id]).catch((e) => console.warn(`readout ${id} failed`, e)); });
}

/* ------------------------------------------------------------ the shell: probe [layer] */

// one line per layer, in the shell's own plain words
function probeLine(id) {
  const m = measured[id], line = (text) => `${id} ${NAMES[id].padEnd(11)}${text}`;
  if (id === 'l4') {
    const a = m && m.loadMs ? `loaded in ${withUnit(time(m.loadMs))}` : 'load time not measured';
    const b = !m || m.bytes == null ? '' : m.bytes > 0 ? `, ${withUnit(bytes(m.bytes))} transferred` : ', everything from your cache';
    return line(a + b);
  }
  if (id === 'l3') return line(m ? `a frame every ${withUnit(time(m.frameMs))} (${withUnit(hertz(m.hz))})` : 'still timing your frames');
  if (id === 'l2') return line(m ? `all ${m.solutions} solutions in ${withUnit(time(m.ms))}, ${show(count(m.nodes))} placements tried` : 'timing the solver, probe again in a moment');
  if (id === 'l1') return line(m ? `${m.blocks} blocks of ${withUnit(blockSize(m.blockSize))}, ${m.used} in use` : 'reading the disk, probe again in a moment');
  return line(m ? `the node's interpreter can run ${withUnit(rate(m.perSecond))} instructions a second` : 'timing the node, probe again in a moment');
}
const TB_LABEL = 'timebase'.padEnd(14); // lines up with 'l2 algorithms '
const tbLine = (id) => `${TB_LABEL}${TIMEBASE[id].n}${THIN}${TIMEBASE[id].unit}, ${caption(id)}`;

// a layer by id ('l2', or '2'), name ('algorithms') or an unambiguous start of one ('alg')
function pickLayer(word) {
  const w = /^\d$/.test(word) ? `l${word}` : word.toLowerCase();
  if (rows.has(w)) return w;
  const hits = ORDER.filter((id) => rows.has(id) && NAMES[id].startsWith(w));
  return hits.length === 1 ? hits[0] : null;
}

function probe(arg) {
  const a = arg.trim();
  if (a) {
    const id = pickLayer(a);
    if (!id) return { err: `probe: no such layer: ${a}` };
    return { label: `Probe ${id.toUpperCase()} ${NAMES[id][0].toUpperCase()}${NAMES[id].slice(1)}`, action: { call: () => { want(id); return [probeLine(id), tbLine(id)]; } } };
  }
  return {
    label: 'Print what this page measured',
    action: { call: () => {
      ORDER.forEach(want); // asking is a reason to measure now
      return [...ORDER.filter((id) => rows.has(id)).map(probeLine), active ? tbLine(active) : `${TB_LABEL}set by the layer on screen`];
    } },
  };
}

/* ------------------------------------------------------------ start */

function init() {
  if (typeof document === 'undefined') return;
  const sections = [...document.querySelectorAll('section.layer[data-layer]')].filter((s) => TIMEBASE[s.dataset.layer]);
  const heads = sections.map((s) => [s, s.querySelector('header.layer__head')]).filter(([, h]) => h && !h.querySelector('.ro'));
  if (!heads.length) return; // no layers on this page: nothing to measure under

  heads.forEach(([s, h]) => buildRow(h, s.dataset.layer));

  // the timebase in the rail (wide screens) and in any [data-timebase] element (an instrument bar, say)
  const rail = document.querySelector('.rail');
  if (rail && !rail.querySelector('.rail__tb')) {
    const host = document.createElement('div');
    host.className = 'rail__tb';
    host.setAttribute('aria-hidden', 'true'); // each layer's row already says it
    rail.append(host);
    buildTbSlot(host);
  }
  document.querySelectorAll('[data-timebase]').forEach(buildTbSlot);
  tbSlots.forEach((slot) => paintTb(slot, 'l4', false));

  // rows settle as they arrive, and the lazy measurements start a screen ahead of them
  const byEl = new Map([...rows.values()].map((r) => [r.el, r]));
  if ('IntersectionObserver' in window) {
    const vis = new IntersectionObserver((es) => es.forEach((e) => {
      const row = byEl.get(e.target);
      row.vis = e.isIntersecting;
      if (row.vis && !row.seen) arrive(row);
    }), { rootMargin: '0px 0px -6% 0px' });
    const near = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) { near.unobserve(e.target); want(byEl.get(e.target).id); }
    }), { rootMargin: '100% 0px' });
    rows.forEach((row) => { vis.observe(row.el); near.observe(row.el); });
  } else {
    rows.forEach((row) => { row.seen = row.vis = true; want(row.id); });
  }
  want('l4');
  want('l3'); // the page's own numbers, measured whether or not you scroll to them

  // the demos report what they do
  document.addEventListener('fat:change', (e) => { if (e.detail) showDisk(e.detail); });
  document.addEventListener('aristotle:solved', (e) => {
    const d = e.detail;
    if (d && d.all && d.ms > 0) showSolver({ solutions: d.solutions, nodes: d.nodes, ms: d.ms }, true);
  });

  follow(sections);

  // `measure` belongs to the lab's cursors; this is the probe you touch to a layer
  if (!Object.hasOwn(VERBS, 'probe')) {
    addCommand('probe', {
      usage: 'probe [layer]', about: 'Print what this page measured on your visit', arg: true,
      words: () => ORDER.filter((id) => rows.has(id)).flatMap((id) => [[id], [NAMES[id]]]),
      plan: (arg) => probe(arg || ''),
    });
  }
}

init();
