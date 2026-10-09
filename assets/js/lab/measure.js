// Measure cursors: two vertical and two horizontal lines across the viewport
// that you drag (or move with the arrow keys), with a readout of the distance
// between each pair, "Δx 412 px" and "Δy 96 px", as on a scope's cursor menu.
// `measure` in the shell turns them on and off; holding M shows them while it's
// held, and a quick tap of M leaves them on. Esc closes.

import { h, layerAt, typingIn } from './util.js';

const TAP_MS = 250;
const KEYS = [['x1', 'v', 0.3], ['x2', 'v', 0.7], ['y1', 'h', 0.35], ['y2', 'h', 0.65]];

export function createMeasure({ onChange = () => {} } = {}) {
  let root = null, state = 'hidden', back = null, downAt = 0, tapOff = false;
  const el = {}, tag = {}, pos = {};
  let dx = null, dy = null;

  const span = (k) => (k[0] === 'x' ? innerWidth : innerHeight);
  const clampPos = (k, v) => Math.max(0, Math.min(span(k) - 1, Math.round(v)));

  function build() {
    if (root) return;
    root = h('div', { class: 'lab-measure', role: 'group', 'aria-label': 'Measure cursors' });
    for (const [k, dir, f] of KEYS) {
      pos[k] = clampPos(k, f * span(k));
      tag[k] = h('span', { class: 'lab-cur__tag num', 'aria-hidden': 'true' });
      el[k] = h('div', {
        class: `lab-cur lab-cur--${dir}`, role: 'slider', tabindex: '0',
        'aria-label': `Cursor ${k}`, 'aria-orientation': dir === 'v' ? 'horizontal' : 'vertical', 'aria-valuemin': '0',
      }, tag[k]);
      el[k].dataset.k = k;
      el[k].addEventListener('pointerdown', grab);
      el[k].addEventListener('keydown', nudge);
      root.append(el[k]);
    }
    const value = () => h('b', { class: 'num' });
    dx = value(); dy = value();
    root.append(h('div', { class: 'lab-measure__read' },
      h('p', { class: 'lab-measure__row' }, h('span', { text: 'Δx' }), ' ', dx, ' ', h('span', { text: 'px' })),
      h('p', { class: 'lab-measure__row' }, h('span', { text: 'Δy' }), ' ', dy, ' ', h('span', { text: 'px' })),
      h('p', { class: 'lab-measure__hint', text: 'Drag a line, or focus it and use the arrow keys.' }),
      h('button', { type: 'button', class: 'lab-key', onclick: () => hide() }, 'Close', h('kbd', { text: 'esc' }))));
    document.body.append(root);
    addEventListener('resize', () => { if (state !== 'hidden') KEYS.forEach(([k]) => { pos[k] = clampPos(k, pos[k]); }); place(); }, { passive: true });
  }

  function place() {
    if (!root) return;
    for (const [k, dir] of KEYS) {
      el[k].style.transform = dir === 'v' ? `translateX(${pos[k]}px)` : `translateY(${pos[k]}px)`;
      el[k].setAttribute('aria-valuemax', String(span(k) - 1));
      el[k].setAttribute('aria-valuenow', String(pos[k]));
      el[k].setAttribute('aria-valuetext', `${pos[k]} pixels`);
      tag[k].textContent = String(pos[k]);
    }
    dx.textContent = String(Math.abs(pos.x2 - pos.x1));
    dy.textContent = String(Math.abs(pos.y2 - pos.y1));
  }

  /* ---------------------------------------------------------- dragging and keys */
  function grab(e) {
    if (e.button !== 0) return;
    const c = e.currentTarget, k = c.dataset.k;
    e.preventDefault();
    c.focus({ preventScroll: true });
    try { c.setPointerCapture(e.pointerId); } catch {}
    c.classList.add('is-dragging');
    const move = (ev) => { pos[k] = clampPos(k, k[0] === 'x' ? ev.clientX : ev.clientY); place(); };
    const up = () => {
      c.classList.remove('is-dragging');
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      c.removeEventListener('pointercancel', up);
    };
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    move(e);
  }
  function nudge(e) {
    const k = e.currentTarget.dataset.k, step = e.shiftKey ? 10 : 1;
    const d = { ArrowRight: step, ArrowUp: k[0] === 'x' ? step : -step, ArrowLeft: -step, ArrowDown: k[0] === 'x' ? -step : step }[e.key];
    let v = null;
    if (d != null) v = pos[k] + d;
    else if (e.key === 'Home') v = 0;
    else if (e.key === 'End') v = span(k) - 1;
    else if (e.key === 'PageUp' || e.key === 'PageDown') v = pos[k] + (e.key === 'PageUp' ? -50 : 50);
    if (v == null) return;
    e.preventDefault();
    pos[k] = clampPos(k, v);
    place();
  }

  /* ---------------------------------------------------------- show, hide */
  function show(how = 'sticky', { focus = how === 'sticky' } = {}) {
    build();
    if (state === 'hidden') {
      root.style.setProperty('--lab-cur', `var(--ch-${layerAt().id || 'l4'})`); // the channel on screen, as a scope's cursors take their source's colour
      KEYS.forEach(([k]) => { pos[k] = clampPos(k, pos[k]); });
      place();
      root.classList.add('is-on');
      document.documentElement.classList.add('lab-measuring');
    }
    state = how;
    if (focus) { back = document.activeElement; el.x1.focus({ preventScroll: true }); }
    onChange();
  }
  function hide() {
    if (state === 'hidden') return;
    state = 'hidden';
    root.classList.remove('is-on');
    document.documentElement.classList.remove('lab-measuring');
    if (root.contains(document.activeElement)) {
      if (back && back.isConnected && back !== document.body) back.focus({ preventScroll: true });
      else document.activeElement.blur();
    }
    back = null;
    onChange();
  }
  const toggle = () => (state === 'sticky' ? hide() : show('sticky'));

  /* ---------------------------------------------------------- M and Esc */
  const anyDialog = () => !!document.querySelector('dialog[open], .lightbox.is-open');
  function onKeyDown(e) {
    if (e.key === 'Escape' && state !== 'hidden' && !anyDialog()) { hide(); return; }
    if ((e.key !== 'm' && e.key !== 'M') || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (typingIn(e.target) || anyDialog()) return;
    downAt = performance.now();
    if (state === 'hidden') show('held', { focus: false });
    else if (state === 'sticky') tapOff = true;
  }
  function onKeyUp(e) {
    if (e.key !== 'm' && e.key !== 'M') return;
    const tap = performance.now() - downAt < TAP_MS;
    if (state === 'held') { if (tap) { state = 'sticky'; onChange(); } else hide(); }
    else if (state === 'sticky' && tapOff && tap) hide();
    tapOff = false;
  }
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  addEventListener('blur', () => { if (state === 'held') hide(); });

  return { show, hide, toggle, get on() { return state !== 'hidden'; } };
}
