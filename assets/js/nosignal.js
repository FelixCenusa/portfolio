// "No signal" (the 404 page). One flat trace across a 10 × 8 graticule, with a
// noise floor of ±0.5 px redrawn every 120 ms, the way a free-running scope
// looks with nothing on the probe. It registers with the instrument, so Run/Stop
// freezes it, and it rests while off screen. With reduced motion the page starts
// stopped, so it draws once and holds. Under the screen it names the address
// that was probed, and only a real one.

import { register } from './instrument.js';

const NOISE = 0.5;   // px either side of the zero line
const STEP = 2;      // px between samples
const EVERY = 120;   // ms between sweeps

// the trace as an SVG path in CSS pixels: w wide, centred in h, every sample
// within ±amp of the middle
export function noisePath(w, h, rand = Math.random, step = STEP, amp = NOISE) {
  if (!(w > 0) || !(h > 0)) return '';
  const mid = Math.round(h / 2);
  const y = () => (mid + (rand() * 2 - 1) * amp).toFixed(2);
  let d = `M0 ${y()}`;
  for (let x = step; x < w; x += step) d += `L${x} ${y()}`;
  return `${d}L${w} ${y()}`;
}

// the address that was probed, as typed: '' for the 404 page itself, and the
// raw path when it holds an escape that doesn't decode (such as /%E0%A4%A)
export function probedPath(pathname) {
  if (!pathname || pathname === '/404.html' || pathname === '/404') return '';
  let p = pathname;
  try { p = decodeURIComponent(pathname); } catch { /* keep it raw */ }
  return p.slice(0, 80);
}

function mount(root) {
  const where = root.querySelector('[data-lost-path]');
  if (where) where.textContent = probedPath(location.pathname); // the bar hides while this is empty (nosignal.css)
  const svg = root.querySelector('svg'), path = svg && svg.querySelector('path');
  if (!path) return;
  let w = 0, h = 0, timer = 0, running = false, inView = true;

  const draw = () => { if (w && h) path.setAttribute('d', noisePath(w, h)); };
  const size = () => {
    const r = svg.getBoundingClientRect();
    const nw = Math.round(r.width), nh = Math.round(r.height);
    if (!nw || !nh || (nw === w && nh === h)) return;
    w = nw; h = nh;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    draw();
  };
  const sync = () => {
    const on = running && inView;
    if (on && !timer) timer = setInterval(draw, EVERY);
    else if (!on && timer) { clearInterval(timer); timer = 0; }
  };

  size();
  if ('ResizeObserver' in window) new ResizeObserver(size).observe(svg);
  else addEventListener('resize', size, { passive: true });
  if ('IntersectionObserver' in window) new IntersectionObserver(([e]) => { inView = e.isIntersecting; sync(); }).observe(root);
  register({ start() { running = true; sync(); }, stop() { running = false; sync(); } });
}

const root = globalThis.document && document.querySelector('[data-nosignal]');
if (root) mount(root);
