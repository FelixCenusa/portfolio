// The hero's front panel: the trigger the stack's traces wait for, the caption
// that reports it, and the power-on.
//
// Trigger. The traces on the slabs start flat and armed, and the caption reads
// "Waiting for trigger". Your first move (pointer, wheel, key or touch)
// triggers them, or after 2 s they trigger on their own, the way a scope's auto
// mode does. Each trace then sweeps in left to right, top layer first, and
// rolls. The caption becomes a measurement of that moment, timed from the start
// of the page load. "Single" re-arms the traces for one capture that holds;
// "Auto" (or pressing Run) goes back to rolling. The 3D stack (stack.js) and
// the SVG poster both draw from this one state: the poster through
// data-scope="armed | capture | hold" on the stage, the canvas through scope.
//
// Power-on, once per session: one flat line at mid-height splits into the
// five channels, each settling at its slab's height, then the stack fades in.
// It takes about a second, any deliberate input skips it, and reduced motion
// (or a visitor who has pressed Stop) never sees it.

import { onRun, isRunning, reducedMotion } from '../instrument.js';
import { ring } from '../ease.js';
import { addCommand } from '../shell.js';
import { CHANNELS } from '../waves.js';

export const AUTO_MS = 2000; // the auto trigger, from the start of the page load
export const SWEEP_MS = 450; // one trace's sweep, left to right
export const STAGGER_MS = 70; // between channels, L4 first
export const ROLL_S = 3.2; // a screen width every 3.2 s, the speed of the layer headings' traces
export const HOLDOFF_MS = 400; // after Single, input this soon (the press that armed it) doesn't trigger

/* ------------------------------------------------------------ the measurement (pure, tested in node) */
const THIN = ' ';
// a time the way a scope prints it: three significant figures, auto-ranged
export function readout(ms) {
  ms = Math.max(0, ms);
  if (Math.round(ms) < 1000) return { value: String(Math.round(ms)), unit: 'ms' };
  const s = ms / 1000;
  return { value: s < 999.5 ? s.toPrecision(3) : String(Math.round(s)), unit: 's' }; // 999.5 would print 1.00e+3
}
const num = ({ value, unit }) => `<span class="num">${value}</span>${THIN}${unit}`;

// the caption for a capture: { cause: 'move' | 'timeout' | 'auto' | 'load' | null, mode, at, armedAt }, times in ms since the page started loading
export function caption({ cause, mode, at, armedAt = 0 }) {
  if (cause === 'load') return 'Captured at load';
  if (at == null) return 'Waiting for trigger';
  if (cause === 'auto') return 'Running without a trigger';
  if (cause === 'timeout') return `Triggered after ${num({ value: (at / 1000).toFixed(1), unit: 's' })}`;
  if (mode === 'single') return `Triggered by your move, ${num(readout(at - armedAt))} after arming`;
  return `Triggered by your first move, ${num(readout(at))} after load`;
}

// how far channel i (0 = L4) has swept, 0..1, given when the sweep started
export function sweep(sweepAt, i, now) {
  if (sweepAt == null) return 0;
  return Math.max(0, Math.min(1, (now - sweepAt - i * STAGGER_MS) / SWEEP_MS));
}

// what the display shows: flat and waiting, a capture that rolls, or one that holds
export const display = (st) => (st.at == null || st.sweepAt == null ? 'armed' : st.mode === 'single' ? 'hold' : 'capture');

/* ------------------------------------------------------------ the state */
const now = () => performance.now();
const state = {
  mode: 'auto', // 'auto': triggers once, then rolls. 'single': triggers once, then holds
  armedAt: 0,
  at: null, // when it triggered
  cause: null,
  sweepAt: null, // when the sweep started on screen (held back while the power-on plays)
  booting: false,
  text: 'Waiting for trigger',
};
const subs = new Set();

export const scope = {
  get: () => state,
  on(fn) { subs.add(fn); return () => subs.delete(fn); },
  single: () => single(),
  auto: () => auto(),
};

const doc = typeof document !== 'undefined' ? document : null;
const stage = doc && doc.querySelector('[data-stage]');
const fig = stage && stage.closest('.hero__fig');
const cap = fig && fig.querySelector('.stage__cap');
const statusEl = cap && cap.querySelector('[data-scope-status]');
const keys = cap && cap.querySelector('.stage__keys');
const singleKey = cap && cap.querySelector('[data-scope-single]');
const autoKey = cap && cap.querySelector('[data-scope-auto]');

function emit() {
  paint();
  subs.forEach((fn) => { try { fn(state); } catch (e) { console.error(e); } });
}

function paint() {
  if (!stage) return;
  const shown = display(state);
  if (stage.dataset.scope !== shown) stage.dataset.scope = shown;
  if (statusEl && statusEl.innerHTML !== state.text) statusEl.innerHTML = state.text;
  if (singleKey) singleKey.setAttribute('aria-pressed', String(state.mode === 'single'));
  if (autoKey) {
    const hide = state.mode !== 'single';
    // hiding the focused key would drop focus to the page; hand it to Single, beside it
    if (hide && doc.activeElement === autoKey && singleKey) singleKey.focus();
    autoKey.hidden = hide;
  }
}

/* ------------------------------------------------------------ trigger */
const INPUTS = ['pointermove', 'pointerdown', 'wheel', 'keydown', 'touchstart'];
const OPTS = { capture: true, passive: true };
let listening = false, timer = 0, holdoff = 0;

function onInput(e) {
  // browsers send a still "move" after layout changes under a resting mouse; only a real move counts
  if (e.type === 'pointermove' && e.pointerType === 'mouse' && !e.movementX && !e.movementY) return;
  // nor does typing in, or closing, the command palette (or any modal) over the page
  const t = e.target;
  if (t && t.closest && t.closest('dialog[open]')) return;
  capture('move');
}
function listen(on) {
  if (on === listening) return;
  listening = on;
  INPUTS.forEach((type) => window[on ? 'addEventListener' : 'removeEventListener'](type, onInput, OPTS));
}
function quiet() {
  clearTimeout(timer); clearTimeout(holdoff);
  timer = holdoff = 0;
  listen(false);
}

function arm(mode) {
  quiet();
  Object.assign(state, { mode, at: null, cause: null, sweepAt: null, armedAt: now() });
  state.text = caption(state);
  if (mode === 'single') {
    holdoff = setTimeout(() => listen(true), HOLDOFF_MS);
  } else {
    listen(true);
    timer = setTimeout(onTimeout, Math.max(0, AUTO_MS - now()));
  }
  emit();
}
function onTimeout() {
  timer = 0;
  if (!document.hidden) { capture('timeout'); return; }
  // a background tab: trigger when it's looked at, and say how long that took
  const seen = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', seen); capture('timeout'); } };
  document.addEventListener('visibilitychange', seen);
}

function capture(cause) {
  if (state.at != null) return;
  quiet();
  state.at = now();
  state.cause = cause;
  // the sweep waits while the power-on plays, or while Stop holds the display
  state.sweepAt = state.booting || !isRunning() ? null : state.at;
  state.text = caption(state);
  emit();
}

function single() { arm('single'); }

// bring the hero into view; from the palette, once it closes (it's a modal over the page, and Lenis waits for it)
function showHero() {
  const go = () => {
    const r = fig.getBoundingClientRect();
    if (r.top >= 0 && r.bottom <= innerHeight) return;
    const top = Math.max(0, scrollY + r.top - Math.max(0, (innerHeight - r.height) / 2));
    const { lenis } = window;
    if (lenis && typeof lenis.scrollTo === 'function') lenis.scrollTo(top, { duration: 1.4, immediate: reducedMotion, force: true });
    else scrollTo({ top, behavior: reducedMotion ? 'auto' : 'smooth' });
  };
  const modal = doc.querySelector('dialog[open]');
  if (modal) modal.addEventListener('close', go, { once: true });
  else go();
}
function auto() {
  if (state.mode !== 'single') return;
  state.mode = 'auto';
  if (state.at == null) capture('auto');
  else emit();
}

/* ------------------------------------------------------------ power-on */
const NS = 'http://www.w3.org/2000/svg';
// the slabs' side corners, at mid-thickness, in the poster's 600 x 600 box: where the stage labels sit (19.33% ... 80.67%)
export const LEVELS = [116, 208, 300, 392, 484];

function shouldBoot() {
  const { gsap } = window;
  if (!stage || !fig || !gsap || reducedMotion || !isRunning() || document.hidden) return false;
  if (now() > 2500) return false; // only as the page starts
  const r = fig.getBoundingClientRect();
  if (r.bottom < 0 || r.top > innerHeight) return false; // a reload that kept its scroll position
  try {
    if (sessionStorage.getItem('booted')) return false;
    sessionStorage.setItem('booted', '1');
  } catch {}
  return true;
}

function boot() {
  const { gsap } = window;
  if (!gsap) return; // no timeline to play it with: go straight to the stack
  state.booting = true;
  const svg = doc.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'stage__boot');
  svg.setAttribute('viewBox', '0 0 600 600');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const line = (cls) => {
    const l = doc.createElementNS(NS, 'line');
    Object.entries({ x1: 110, x2: 470, y1: 300, y2: 300, class: cls }).forEach(([k, v]) => l.setAttribute(k, v));
    svg.append(l);
    return l;
  };
  const chans = CHANNELS.map((id) => line(`boot__ch boot__ch--${id}`));
  const flat = line('boot__flat');
  flat.setAttribute('stroke-dasharray', '360 360');
  flat.setAttribute('stroke-dashoffset', '360');
  stage.insertBefore(svg, stage.querySelector('.stage__labels'));
  stage.classList.add('is-booting');

  // the hero intro (main.js) fades and lifts the figure slowly; the power-on is its intro, so show it now
  gsap.killTweensOf(fig);
  gsap.to(fig, { autoAlpha: 1, y: 0, duration: 0.2, ease: 'none' });

  let done = false, failsafe = 0;
  const SKIP = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(failsafe);
    tl.kill();
    SKIP.forEach((t) => window.removeEventListener(t, finish, OPTS));
    stage.classList.remove('is-booting');
    stage.classList.add('is-booted');
    setTimeout(() => stage.classList.remove('is-booted'), 250);
    svg.remove();
    state.booting = false;
    if (state.at != null && state.sweepAt == null && isRunning()) state.sweepAt = now();
    emit();
  };
  const tl = gsap.timeline({ delay: 0.12, onComplete: finish });
  // the "no input" line draws across, then splits into the five channels, each ringing into place
  const settle = ring();
  const DUR = 0.5, settled = 0.3 + (chans.length - 1) * 0.05 + DUR; // when the last channel (L0) has settled
  tl.to(flat, { attr: { 'stroke-dashoffset': 0 }, duration: 0.22, ease: 'none' }, 0)
    .set(chans, { opacity: 1 }, 0.3)
    .to(flat, { opacity: 0, duration: 0.12, ease: 'none' }, 0.3);
  chans.forEach((l, i) => tl.to(l, { attr: { y1: LEVELS[i], y2: LEVELS[i] }, duration: DUR, ease: settle }, 0.3 + i * 0.05));
  // then, once all five have settled, a 150 ms crossfade to the stack
  tl.add(() => { stage.classList.remove('is-booting'); stage.classList.add('is-booted'); }, settled)
    .to(svg, { opacity: 0, duration: 0.15, ease: 'none' }, settled);
  SKIP.forEach((t) => window.addEventListener(t, finish, OPTS));
  // if frames stall (a throttled or headless tab), the traces must not wait for the power-on forever
  failsafe = setTimeout(finish, 2500);
}

/* ------------------------------------------------------------ wire it up (home page only) */
if (stage) {
  if (keys) keys.hidden = false;
  if (singleKey) singleKey.addEventListener('click', single);
  if (autoKey) autoKey.addEventListener('click', auto);
  onRun((running) => {
    if (!running) return;
    // a trigger that came while stopped sweeps in now
    if (state.at != null && state.sweepAt == null && !state.booting) state.sweepAt = now();
    // and Run after a single shot goes back to rolling, as on a scope
    if (state.mode === 'single') auto();
    else emit();
  });

  if (reducedMotion) {
    // nothing sweeps: the traces are drawn already captured, and hold
    Object.assign(state, { at: now(), armedAt: 0, cause: 'load' });
    state.sweepAt = state.at;
    state.text = caption(state);
    paint();
  } else {
    if (shouldBoot()) boot();
    arm('auto');
  }

  addCommand('single', {
    usage: 'single',
    about: 'Re-arm the hero for one capture',
    plan: () => ({
      label: 'Re-arm the hero for one capture',
      action: {
        call: () => {
          single();
          if (fig) showHero();
          return 'Armed. Close this and your next move on the page captures the hero\'s traces once, then they hold';
        },
      },
    }),
  });
}
