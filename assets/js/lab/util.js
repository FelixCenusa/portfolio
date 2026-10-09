// Small helpers the lab's experiments share: storage that never throws, one
// frame loop for all of them, the layer under the reading line, and CSS colours
// resolved to numbers a canvas can use.

/* ------------------------------------------------------------ storage */
export const store = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : v; } catch { return fallback; }
  },
  set(key, value) {
    try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, String(value)); } catch {}
  },
  flag(key, fallback = false) {
    const v = store.get(key);
    return v === '1' ? true : v === '0' ? false : fallback;
  },
};

/* ------------------------------------------------------------ one loop */
// gsap.ticker when GSAP is on the page (Lenis already runs on it), otherwise a
// single requestAnimationFrame loop. It only runs while something is subscribed.
const ticks = new Set();
let onGsap = null, raf = 0;
function run(now) {
  for (const fn of ticks) {
    try { fn(now); } catch (e) { ticks.delete(fn); console.error(e); }
  }
}
const gsapTick = () => { run(performance.now()); if (!ticks.size) idle(); };
const rafTick = (now) => { raf = 0; run(now); if (ticks.size) raf = requestAnimationFrame(rafTick); };
function idle() {
  if (onGsap) { onGsap.remove(gsapTick); onGsap = null; }
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
}
export function addTick(fn) {
  ticks.add(fn);
  if (!onGsap && !raf) {
    const t = typeof window !== 'undefined' && window.gsap && window.gsap.ticker;
    if (t) { onGsap = t; t.add(gsapTick); } else raf = requestAnimationFrame(rafTick);
  }
  return () => removeTick(fn);
}
export function removeTick(fn) {
  ticks.delete(fn);
  if (!ticks.size) idle();
}

/* ------------------------------------------------------------ where we are */
export const LAYERS = [['l4', 'L4', 'Web'], ['l3', 'L3', 'Apps'], ['l2', 'L2', 'Algorithms'], ['l1', 'L1', 'Systems'], ['l0', 'L0', 'Metal']];
export const sections = () => [...document.querySelectorAll('section[data-layer]')];

// The rail's rule (main.js): while the layers span 45% of the way down the
// viewport, the active one is the last whose top has passed that line.
// { id, nearest, above }: id is null outside the layers; nearest is the closest layer.
export function layerAt(list = sections()) {
  if (!list.length) return { id: null, nearest: null, above: false };
  const mid = innerHeight * 0.45;
  const first = list[0], last = list[list.length - 1];
  const top = first.getBoundingClientRect().top, bottom = last.getBoundingClientRect().bottom;
  if (top >= mid) return { id: null, nearest: first.dataset.layer, above: true };
  if (bottom <= mid) return { id: null, nearest: last.dataset.layer, above: false };
  let id = null;
  for (const s of list) if (s.getBoundingClientRect().top < mid) id = s.dataset.layer;
  return { id, nearest: id, above: false };
}

/* ------------------------------------------------------------ colours */
// any CSS colour (hex, rgb(), color-mix(), var()) as [r, g, b, a] 0..255, via a probe element
let probe = null;
export function rgba(css, fallback = [79, 214, 238, 255]) {
  if (typeof document === 'undefined' || !css) return fallback;
  if (!probe) {
    probe = document.createElement('i');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none';
  }
  if (!probe.isConnected) document.body.append(probe);
  probe.style.color = '';
  probe.style.color = css;
  const m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?/.exec(getComputedStyle(probe).color);
  if (!m) return fallback;
  const a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return [+m[1], +m[2], +m[3], Math.round(a * 255)];
}
export const cssRgb = ([r, g, b], alpha = 1) => `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
export const token = (name, el = document.documentElement) => getComputedStyle(el).getPropertyValue(name).trim();
// a channel's colour by layer id, from the --ch-* tokens
export const channel = (id) => token(`--ch-${id || 'l4'}`) || '#f4e04d';

/* ------------------------------------------------------------ DOM */
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat().filter((k) => k != null && k !== false));
  return el;
}

// is the key event aimed at something that takes text, or inside a live demo?
export const typingIn = (t) => !!(t && t.closest && t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], .demo, [data-demo]'));

// scroll the page; Lenis handles anchor clicks itself, so this is for positions
export function scrollToY(y) {
  const l = typeof window !== 'undefined' && window.lenis;
  if (l && typeof l.scrollTo === 'function') l.scrollTo(y, { immediate: true });
  else scrollTo({ top: y, behavior: 'auto' });
}

// the palette is a <dialog>; closing it fires its close event, which restarts Lenis
export function closePalette() {
  const p = document.querySelector('dialog.palette');
  if (p && p.open) p.close();
}
