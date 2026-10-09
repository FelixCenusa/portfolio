// Project captures: commit history as traces, with A/B cursors.
//
// Above each project title sits a thin capture of its public repo's history:
// commits per week as a step trace in the layer's channel colour. Hover or
// focus it and two cursors land on the first and last commit, and the readout
// measures between them, the way a scope's cursors do: "Δ 4 weeks, 90 commits,
// Dec 2024". A project with no public repo shows a flat line (no signal on the
// probe) and the page's own reason. On /projects/ a compact capture sits under
// each project's description, and hovering the row measures it.
//
// The data is assets/data/captures.json, written once by tools/captures.py
// (dates and counts only). Nothing happens if it's missing. The shell gets
// `log [project]`, which prints the same readouts.

import { reducedMotion } from './instrument.js';
import { ring, ringCss } from './ease.js';
import { addCommand, score } from './shell.js';

const DAY = 864e5;
const T = ' '; // thin space: between a value and its unit, and around a spaced range dash
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/* ------------------------------------------------------------ readouts and geometry (pure, tested in node) */

// '2024-12-01' -> whole days since 1970-01-01, in UTC so no time zone can move a commit
export const dayOf = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY);

// a time difference in days, auto-ranged the way a scope picks its units
export function span(days) {
  if (days < 14) return { v: days, digits: 0, unit: days === 1 ? 'day' : 'days' };
  if (days < 140) return { v: Math.round(days / 7), digits: 0, unit: 'weeks' };
  if (days < 730) return { v: Math.round(days / 30.44), digits: 0, unit: 'months' };
  return { v: days / 365.25, digits: 1, unit: 'years' };
}

// 'Jun 2024', 'Feb–Apr 2024', 'Sep 2024 – Apr 2026' (en dash; spaced only when the ends are two words)
export function monthRange(first, last, gap = T, names = MONTHS) {
  const [y0, m0] = first.split('-').map(Number), [y1, m1] = last.split('-').map(Number);
  const a = names[m0 - 1], b = names[m1 - 1];
  if (y0 === y1 && m0 === m1) return `${a} ${y0}`;
  if (y0 === y1) return `${a}–${b} ${y0}`;
  return `${a} ${y0}${gap}–${gap}${b} ${y1}`;
}

// what the cursors measure: from the start of the first commit's day to the end of the last one's
export function readout(cap) {
  if (!cap || cap.none || !cap.first || !cap.last) return null;
  const delta = span(dayOf(cap.last) - dayOf(cap.first) + 1);
  const commits = cap.commits, noun = commits === 1 ? 'commit' : 'commits';
  const range = monthRange(cap.first, cap.last);
  const dv = delta.v.toFixed(delta.digits);
  return {
    delta, commits, noun, range,
    text: `Δ${T}${dv}${T}${delta.unit}, ${commits}${T}${noun}, ${range}`,
    label: `Commits per week, ${monthRange(cap.first, cap.last, '', MONTH_NAMES).replace('–', ' to ')}. ${commits} ${noun}, ${dv} ${delta.unit} from the first to the last`,
  };
}

// the capture's window, in days: every week from a little before the first commit to a
// little after the last (a scope's pre- and post-trigger), with the commits binned per week
export function frame(cap) {
  const weeks = cap.weeks.map(([w, n]) => [dayOf(w), n]).sort((p, q) => p[0] - q[0]);
  const w0 = weeks[0][0], w1 = weeks[weeks.length - 1][0] + 7;
  const pad = 7 * Math.max(1, Math.round(((w1 - w0) / 7) * 0.12));
  const t0 = w0 - pad, bins = new Array((w1 + pad - t0) / 7).fill(0);
  for (const [t, n] of weeks) bins[Math.round((t - t0) / 7)] += n;
  return { t0, t1: t0 + bins.length * 7, bins, peak: Math.max(...bins), a: dayOf(cap.first), b: dayOf(cap.last) + 1 };
}

// The step trace and cursor positions for a w x h box (CSS px), snapped to the device pixel
// grid so every horizontal and vertical lands whole: crisp, with no smeared edges. ox and oy are
// the box's offset from the viewport's top left when it's measured. Scrolling moves a box by whole
// device pixels, so the snap holds as it scrolls; a sticky box (stuck at a whole-pixel viewport y
// while its page offset is fractional) is snapped where it's read. Heights are square-rooted so a
// one-commit week still shows next to a forty-commit one; the readout carries the real numbers.
export function layout(f, { w, h, dpr = 1, ox = 0, oy = 0, stroke = 1.5, inset = 3 }) {
  const dev = Math.max(1, Math.round(stroke * dpr)), half = dev % 2 ? 0.5 : 0;
  const snap = (v, o) => (Math.round((v + o) * dpr - half) + half) / dpr - o;
  const base = h - inset, amp = h - 2 * inset;
  const flat = snap(base, oy);
  const out = { stroke: dev / dpr, flat };
  if (!f) return { ...out, points: `0,${r4(flat)} ${r4(w)},${r4(flat)}` };
  const x = (t) => ((t - f.t0) / (f.t1 - f.t0)) * w;
  const level = (n) => snap(base - (f.peak ? Math.sqrt(n / f.peak) : 0) * amp, oy);
  const pts = [[0, level(f.bins[0])]];
  let prev = pts[0][1];
  for (let i = 1; i < f.bins.length; i++) {
    const y = level(f.bins[i]);
    if (y === prev) continue;
    const xi = snap(x(f.t0 + 7 * i), ox);
    pts.push([xi, prev], [xi, y]);
    prev = y;
  }
  pts.push([w, prev]);
  // 1px cursors on whole device pixels: A starts at the first commit, B ends at the last
  const line = (v) => Math.min(w - 1, Math.max(0, Math.round((v + ox) * dpr) / dpr - ox));
  return { ...out, points: pts.map(([px, py]) => `${r4(px)},${r4(py)}`).join(' '), a: line(x(f.a)), b: line(x(f.b) - 1) };
}
const r4 = (v) => Math.round(v * 1e4) / 1e4;

// one line per project for the shell, in plain spaces so the columns line up in mono
export function logLines(projects, ids = Object.keys(projects)) {
  const w = Math.max(...ids.map((id) => id.length)) + 2;
  return ids.map((id) => {
    const cap = projects[id], r = readout(cap);
    if (!r) return `${id.padEnd(w)}${(cap && cap.none) || 'No public history'}`;
    const d = `${r.delta.v.toFixed(r.delta.digits)} ${r.delta.unit}`;
    return `${id.padEnd(w)}${String(r.commits).padStart(4)} ${r.noun.padEnd(7)}  Δ ${d.padEnd(10)}  ${monthRange(cap.first, cap.last, ' ')}`;
  });
}

/* ------------------------------------------------------------ the page */

const SVG = 'http://www.w3.org/2000/svg';
const el = (tag, cls, ...kids) => { const e = document.createElement(tag); if (cls) e.className = cls; e.append(...kids); return e; };
const num = (text) => el('span', 'num', text);
const state = new WeakMap(); // host -> { box, svg, line, read, f, r, nums, tween }
let DATA = null;
let EASE = '';

function frameEl(compact) {
  const host = el('div', compact ? 'capture capture--row is-pending' : 'capture is-pending');
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'capture__trace');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const line = document.createElementNS(SVG, 'polyline');
  line.setAttribute('vector-effect', 'non-scaling-stroke');
  line.setAttribute('stroke-width', '1.5');
  svg.append(line);
  const a = el('span', 'capture__cursor'), b = el('span', 'capture__cursor');
  a.dataset.c = 'a';
  b.dataset.c = 'b';
  const box = el('span', 'capture__box', svg, a, b);
  const read = el('span', 'capture__read');
  read.setAttribute('aria-hidden', 'true');
  host.append(read, box);
  state.set(host, { box, svg, line, read });
  return host;
}

// the label names the project: the capture sits above its title, so a screen reader meets it first
const named = (name, text) => (name ? `${name}: ${text.charAt(0).toLowerCase()}${text.slice(1)}` : text);
// settle() counts up with ring(0.5), which peaks at 1.183 on its way to 1 (90 commits pass through 106)
const PEAK = 1.2;
const widest = (v, digits) => Math.max(v.toFixed(digits).length, (v * PEAK).toFixed(digits).length);

function fill(host, cap, compact, name) {
  const st = state.get(host), r = readout(cap);
  host.classList.remove('is-pending');
  host.setAttribute('role', 'img');
  if (!r) {
    // no signal on the probe: a flat line and the page's own reason (the table says why in its Links column)
    const why = (cap && cap.none) || 'No public history';
    host.classList.add('is-none');
    host.setAttribute('aria-label', named(name, why));
    st.read.append(el('span', 'capture__idle', compact ? why.replace(/\s*\(.*\)$/, '') : why));
    return;
  }
  st.f = frame(cap);
  st.r = r;
  host.tabIndex = 0;
  host.setAttribute('aria-label', named(name, r.label));
  host.style.setProperty('--cap-ease', EASE || (EASE = ringCss()));
  const dv = r.delta.v.toFixed(r.delta.digits), c = String(r.commits);
  st.nums = { d: num(dv), c: num(c) };
  // wide enough for the overshoot too, so the rest of the line never shifts while they settle
  st.nums.d.style.minWidth = `${widest(r.delta.v, r.delta.digits)}ch`;
  st.nums.c.style.minWidth = `${widest(r.commits, 0)}ch`;
  st.read.append(
    el('span', 'capture__idle', num(c), `${T}${r.noun}, ${r.range}`),
    el('span', 'capture__meas', `Δ${T}`, st.nums.d, `${T}${r.delta.unit}, `, st.nums.c, `${T}${r.noun}, ${r.range}`),
  );
}

// Drawing is a read pass then a write pass: every box is measured before any is written, so a
// resize costs one layout, not one per capture.
function measure(host) {
  const st = state.get(host);
  if (!st || host.classList.contains('is-pending')) return null;
  const box = st.box.getBoundingClientRect();
  if (box.width < 1 || box.height < 1) return null; // hidden (a filtered table row); drawn when it shows
  return { st, w: box.width, h: box.height, x: box.left, y: box.top, dpr: Math.min(window.devicePixelRatio || 1, 3) };
}

const frac = (v) => r4(v - Math.floor(v));

function paint(m) {
  if (!m) return;
  const { st, w, h, dpr } = m;
  // the snap only depends on where the box sits within a device pixel, so most redraws write nothing
  const key = `${r4(w)},${r4(h)},${dpr},${frac(m.x * dpr)},${frac(m.y * dpr)}`;
  if (key === st.key) return;
  st.key = key;
  const L = layout(st.f || null, { w, h, dpr, ox: m.x, oy: m.y });
  st.svg.setAttribute('viewBox', `0 0 ${r4(w)} ${r4(h)}`);
  st.line.setAttribute('points', L.points);
  st.line.setAttribute('stroke-width', String(L.stroke));
  if (st.f) {
    st.box.style.setProperty('--a', `${r4(L.a)}px`);
    st.box.style.setProperty('--b', `${r4(L.b)}px`);
    st.box.style.setProperty('--w', `${r4(Math.max(0, w - 1))}px`);
  }
}

const drawAll = (hosts) => hosts.map(measure).forEach(paint);

// the readout's numbers settle like a meter: rise, overshoot a little, ring once
function settle(st) {
  const { nums, r } = st;
  if (st.tween) st.tween.kill();
  st.tween = null;
  const put = (k) => {
    nums.d.textContent = Math.max(0, r.delta.v * k).toFixed(r.delta.digits);
    nums.c.textContent = String(Math.max(0, Math.round(r.commits * k)));
  };
  const { gsap } = window;
  if (!gsap || reducedMotion) return put(1);
  const o = { k: 0 };
  put(0);
  st.tween = gsap.to(o, { k: 1, duration: 0.55, ease: ring(0.5), onUpdate: () => put(o.k), onComplete: () => put(1) });
}

// hover (mouse or pen) or focus (keyboard, or a tap, since the capture is focusable) measures
function wire(host, hoverEl) {
  const st = state.get(host);
  if (!st.f) return; // nothing to measure on a flat line
  let hover = false, focus = false;
  const set = () => {
    const on = hover || focus;
    if (host.classList.contains('is-on') === on) return;
    host.classList.toggle('is-on', on);
    if (on) settle(st);
  };
  hoverEl.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') { hover = true; set(); } });
  hoverEl.addEventListener('pointerleave', () => { hover = false; set(); });
  host.addEventListener('focus', () => { focus = true; set(); });
  host.addEventListener('blur', () => { focus = false; set(); });
}

function boot() {
  const text = (e) => (e?.textContent || '').replace(/\s+/g, ' ').trim();
  const home = [...document.querySelectorAll('article.proj[id] .proj__title')]
    .map((title) => ({ id: title.closest('article.proj').id, at: title, compact: false, name: text(title) }));
  const table = [...document.querySelectorAll('.ls__table .ls__name')]
    .map((cell) => {
      const link = cell.querySelector('a[href*="#"]');
      return { id: (link?.getAttribute('href') || '').split('#')[1], at: cell, compact: true, name: text(cell.querySelector('a')) };
    })
    .filter((x) => x.id);
  const targets = [...home, ...table];
  if (!targets.length) return;

  // empty frames go in now, before ScrollTrigger measures the page, so the data arriving moves nothing
  for (const t of targets) {
    t.host = frameEl(t.compact);
    if (t.compact) t.at.append(t.host);
    else t.at.before(t.host);
  }

  const drop = (list) => {
    list.forEach((t) => t.host.remove());
    if (list.length && document.readyState === 'complete') window.ScrollTrigger?.refresh();
  };

  fetch(new URL('../data/captures.json', import.meta.url))
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`captures.json: HTTP ${res.status}`))))
    .then((data) => {
      if (!data || typeof data.projects !== 'object' || !data.projects) throw new Error('captures.json: no projects');
      DATA = data;
      const ro = typeof ResizeObserver === 'function' ? new ResizeObserver((es) => drawAll(es.map((e) => e.target.parentElement))) : null;
      // each trace sweeps in once, left to right, as it comes on screen
      const io = !reducedMotion && typeof IntersectionObserver === 'function'
        ? new IntersectionObserver((es) => es.forEach((e) => {
          if (!e.isIntersecting) return;
          e.target.classList.add('is-captured');
          io.unobserve(e.target);
        }), { rootMargin: '0px 0px -12% 0px' })
        : null;
      const missing = [], live = [];
      for (const t of targets) {
        const cap = data.projects[t.id];
        if (!cap) { missing.push(t); continue; }
        fill(t.host, cap, t.compact, t.name);
        wire(t.host, (t.compact && t.at.closest('tr')) || t.host);
        live.push(t.host);
        if (ro) ro.observe(state.get(t.host).box);
        if (io) io.observe(t.host);
        else t.host.classList.add('is-captured');
      }
      if (!ro) drawAll(live);
      // Re-snap once things settle: the ResizeObserver only sees size changes, but the snap also
      // goes stale when a box moves (fonts swap, content above changes, zoom changes the pixel
      // ratio) or when a sticky title sticks or lets go mid-scroll. Cheap: paint() skips any
      // capture whose place within a device pixel hasn't changed.
      let timer = 0;
      const later = () => { clearTimeout(timer); timer = setTimeout(() => drawAll(live), 150); };
      addEventListener('scroll', later, { passive: true });
      addEventListener('resize', later);
      if (document.readyState !== 'complete') addEventListener('load', later, { once: true });
      document.fonts?.ready?.then(later);
      window.ScrollTrigger?.addEventListener?.('refresh', later);
      drop(missing);
    })
    .catch(() => drop(targets));

  // the shell: `log` prints every project's readout, `log aoc` just one
  addCommand('log', {
    usage: 'log [project]',
    about: 'Print the commit history of each project',
    arg: true,
    words: () => Object.keys(DATA?.projects || {}).map((id) => [id]),
    plan(arg, ctx) {
      if (!DATA) return { err: 'log: no history loaded' };
      const ids = Object.keys(DATA.projects), a = (arg || '').trim().toLowerCase();
      if (!a) return { label: 'Print the commit history of each project', action: { out: logLines(DATA.projects, ids) } };
      const names = new Map((ctx?.layers || []).flatMap((l) => l.projects || []).map((p) => [p.id, p.name || '']));
      const byName = ids.find((x) => (names.get(x) || '').toLowerCase().includes(a));
      let id = ids.find((x) => x === a) || ids.find((x) => x.startsWith(a)) || byName;
      if (!id) {
        // then the shell's own fuzzy match, as open and run use: 'aoc' finds advent-of-code
        let top = 0;
        for (const x of ids) {
          const s = Math.max(score(a, x), score(a, names.get(x) || ''));
          if (s > top) { top = s; id = x; }
        }
      }
      if (!id) return { err: `log: no such project: ${arg}` };
      return { label: `Print the commit history of ${names.get(id) || id}`, action: { out: logLines(DATA.projects, [id]) } };
    },
  });
}

if (typeof document !== 'undefined') boot();
