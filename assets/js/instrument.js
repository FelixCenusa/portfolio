// The instrument: the one place that knows whether the page is running or
// stopped, like the Run/Stop key on a scope. Anything that moves for its own
// sake (the hero, the layer traces, readout tickers, lab canvases) registers
// here and is started or stopped with everything else. Acquisition is not
// display: things that record (the footer's visit trace) keep recording while
// stopped, the way a scope keeps triggering behind a held picture.
//
//   const off = register({ start() {…}, stop() {…} });   // starts now if running
//   setRun(false);  isRunning();  onRun((running) => …);
//
// Reduced motion starts stopped; the key still lets a visitor choose Run.
// A hidden tab stops everything without changing the setting.

export const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const KEY = 'scope-run';
const items = new Set();
const listeners = new Set();

let running = !reducedMotion;
try {
  const saved = localStorage.getItem(KEY);
  if (saved === '1' || saved === '0') running = saved === '1';
} catch {}

const live = () => running && !(typeof document !== 'undefined' && document.hidden);
const apply = (item, on) => { try { (on ? item.start : item.stop)?.(); } catch (e) { console.error(e); } };

export const isRunning = () => running;
export const isLive = live;

export function register(item) {
  items.add(item);
  apply(item, live());
  return () => { if (items.delete(item)) apply(item, false); };
}

export function onRun(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function setRun(on, { persist = true } = {}) {
  on = !!on;
  if (persist) { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch {} }
  if (on === running) return;
  running = on;
  sync();
  listeners.forEach((fn) => { try { fn(running); } catch (e) { console.error(e); } });
  if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('scope:run', { detail: { running } }));
}

function sync() {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('is-stopped', !running);
  const on = live();
  items.forEach((item) => apply(item, on));
}

if (typeof document !== 'undefined') {
  document.documentElement.classList.toggle('is-stopped', !running);
  document.addEventListener('visibilitychange', () => { const on = live(); items.forEach((item) => apply(item, on)); });
}
