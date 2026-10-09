// The syscall boundary converts the signal. One trace runs the full width of the
// line between user space and kernel space: the L2 sawtooth to the right of a
// crossing point, the L1 square to its left. Scrolling through the boundary
// moves the crossing from left to right, so the signal is converted as it
// passes the syscall line. The picture is CSS (boundary.css); this only writes
// --split, once per scroll frame. Without this script, or with reduced motion,
// the split holds at half way.

import { reducedMotion } from './instrument.js';

const START = 0.8, END = 0.2; // 'top 80%' to 'bottom 20%', as fractions of the viewport

// how far through the boundary the page is, 0 to 1, from the element's top and
// height and the viewport height: 0 until its top reaches 80% down the viewport,
// 1 once its bottom passes 20%. Off screen it is always 0 or 1.
export function progress(top, height, vh) {
  const span = (START - END) * vh + height;
  if (!(span > 0)) return 0;
  const p = (START * vh - top) / span;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

// The split comes from where the element is right now, measured once per scroll
// frame, never from positions stored at load: the demos above mount lazily and
// change height as you use them, which would leave stored positions stale.
// Lenis scrolls the window itself, so its frames arrive as scroll events too.
function mount(el) {
  let last = -1, queued = false, near = true;
  const set = (p) => {
    const v = Math.round(p * 10000) / 10000;
    if (v === last) return;
    last = v;
    el.style.setProperty('--split', String(v));
  };
  const measure = () => { queued = false; const r = el.getBoundingClientRect(); set(progress(r.top, r.height, innerHeight)); };
  // off screen the split is pinned at 0 or 1, so there is nothing to follow
  const queue = () => { if (near && !queued) { queued = true; requestAnimationFrame(measure); } };
  measure();
  addEventListener('scroll', queue, { passive: true });
  addEventListener('resize', queue, { passive: true });
  // content above can grow or shrink without a scroll
  if (typeof ResizeObserver === 'function') new ResizeObserver(queue).observe(document.body);
  if (typeof IntersectionObserver === 'function') {
    new IntersectionObserver(([e]) => { near = e.isIntersecting; measure(); }).observe(el);
  }
}

const el = globalThis.document && document.querySelector('.boundary');
if (el && el.querySelector('.boundary__trace') && !reducedMotion) mount(el);
