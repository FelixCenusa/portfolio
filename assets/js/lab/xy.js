// XY mode: a 10×8-division screen in a modal, where x and y drive the beam
// instead of time. `xy 3 2` draws a 3:2 Lissajous figure whose phase drifts
// slowly, so it seems to turn in 3D; `xy mark` draws the site's mark, one level
// per channel colour; `xy x=… y=…` draws the visitor's own expressions.
//
// Persistence is vectors, not a fading canvas: the last K sweeps are kept and
// drawn oldest first at alpha 0.6 (1 − age/K)², each as a crisp 1.5 px line over
// a knockout stroke in the screen's colour, so the trace cuts the graticule
// cleanly. No blur, no glow. With Sound on, the screen plots what the sound card
// is actually playing (left = x, right = y), read back through two analysers.

import { register, reducedMotion, isLive } from '../instrument.js';
import { addTick, removeTick, h, rgba, cssRgb, channel, layerAt, token, store } from './util.js';
import { parseXY, lissajous, markFigure, exprFigure, sample, ageAlpha, Sweeps, levelOf, MARK_LEVELS } from './xymath.js';
import { createSound } from './sound.js';

const DRIFT = 0.4;      // rad/s of phase drift
const K = 18;           // sweeps of persistence
const N = 720;          // points per drawing on the screen
const UNIT = 3.6;       // divisions per unit of x or y (the same on both axes, as on a real scope)
const REVEAL = 0.7;     // seconds for the beam to draw a new figure
const SOUND_KEY = 'lab:sound';

// the mark's levels from the nav's own SVG when it's there, so XY follows any refinement of the mark
function markLevels() {
  const ds = [...document.querySelectorAll('.brand__mark .brand__level')].map((p) => p.getAttribute('d') || '');
  const levels = ds.map((d) => /^M\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*H\s*(-?[\d.]+)\s*$/i.exec(d.trim())).filter(Boolean)
    .map((m) => [+m[1], +m[3], +m[2]]);
  return levels.length === 5 && levels.every((l) => l.every(Number.isFinite)) ? levels : MARK_LEVELS;
}

const specText = (p) => (p.kind === 'liss' ? `${p.p} ${p.q}` : p.kind === 'mark' ? 'mark' : p.kind === 'expr' ? `x=${p.xs} y=${p.ys}` : '');

export function createXY({ onChange = () => {} } = {}) {
  const sound = createSound();
  let dlg = null, canvas = null, g = null, nameEl = null, input = null, errEl = null, soundBtn = null, readEl = null, ro = null;
  let spec = { kind: 'liss', p: 3, q: 2 }, fig = null;
  let a = Math.PI / 4, last = 0, live = false, ticking = false, revealAt = 0, reveal = 1, unreg = null;
  let col = { trace: '#f4e04d', bg: '#060709', grid: 'rgba(233,237,242,.09)', axis: 'rgba(233,237,242,.22)', ch: [] };
  const sweeps = new Sweeps(K, 2048 * 2);
  const buf = new Float32Array(2048 * 2);
  let wantSound = store.flag(SOUND_KEY, false);

  /* ---------------------------------------------------------- the dialog */
  function build() {
    if (dlg) return;
    const id = 'lab-xy';
    const preset = (label, value) => h('button', { type: 'button', class: 'lab-key', 'data-fig': value, text: label });
    canvas = h('canvas', { class: 'lab-xy__canvas', role: 'img', 'aria-label': 'XY screen' });
    nameEl = h('p', { class: 'lab-xy__name', 'aria-live': 'polite' });
    input = h('input', {
      id: `${id}-in`, class: 'lab-xy__in', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      enterkeyhint: 'go', placeholder: '3 2, mark, or x=sin(3*t) y=sin(2*t)', 'aria-describedby': `${id}-help ${id}-err`,
    });
    errEl = h('p', { class: 'lab-xy__err', id: `${id}-err`, 'aria-live': 'polite' });
    soundBtn = h('button', { type: 'button', class: 'lab-key lab-key--switch', role: 'switch', 'aria-checked': 'false' }, h('i', { class: 'lab-lamp', 'aria-hidden': 'true' }), 'Sound');
    readEl = h('p', { class: 'lab-xy__read', 'aria-live': 'polite' });
    dlg = h('dialog', { class: 'lab-xy', 'aria-labelledby': `${id}-title`, 'data-lenis-prevent': true }, h('div', { class: 'lab-xy__body' },
      h('div', { class: 'lab-xy__head' },
        h('div', { class: 'lab-xy__titles' }, h('h2', { class: 'lab-xy__title', id: `${id}-title`, text: 'XY mode' }), nameEl),
        h('button', { type: 'button', class: 'lab-key', 'data-close': true }, 'Close', h('kbd', { text: 'esc' }))),
      h('div', { class: 'lab-xy__screen' }, canvas),
      h('div', { class: 'lab-xy__keys' },
        h('div', { class: 'lab-xy__presets', role: 'group', 'aria-label': 'Figures' }, preset('3:2', '3 2'), preset('5:4', '5 4'), preset('1:2', '1 2'), preset('The mark', 'mark')),
        soundBtn),
      readEl,
      h('form', { class: 'lab-xy__form' },
        h('label', { class: 'lab-xy__label', for: `${id}-in`, text: 'Figure' }), input,
        h('button', { type: 'submit', class: 'lab-key', text: 'Draw' })),
      h('p', { class: 'lab-xy__help', id: `${id}-help`, text: 'Two numbers for a Lissajous ratio, mark, or x= and y= in t (0 to 2π) and a (a slow drift). sin, cos, sqrt, pow, pi and ^ work.' }),
      errEl));
    g = canvas.getContext('2d');
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) { // the backdrop (and not the dialog's own scrollbar)
        const r = dlg.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
        return;
      }
      const b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-close')) close();
      else if (b.dataset.fig) show(parseXY(b.dataset.fig));
      else if (b === soundBtn) setSound(!wantSound);
    });
    dlg.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const p = parseXY(input.value);
      if (p.err) { errEl.textContent = p.err.replace(/^xy: /, ''); return; }
      if (p.kind === 'off') { close(); return; }
      if (p.kind === 'open') return;
      const err = show(p);
      if (err) errEl.textContent = err;
    });
    dlg.addEventListener('close', cleanup);
    document.body.append(dlg);
    ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { size(); paint(); }) : null;
    if (ro) ro.observe(canvas);
  }

  function colours() {
    const ch = (channel(layerAt().id || 'l4'));
    const t1 = rgba(token('--text-1') || '#e9edf2', [233, 237, 242, 255]);
    col = {
      trace: cssRgb(rgba(ch, [244, 224, 77, 255])),
      bg: cssRgb(rgba(token('--s-bg-0') || '#060709', [6, 7, 9, 255])),
      grid: cssRgb(t1, 0.085),
      axis: cssRgb(t1, 0.2),
      ch: ['l4', 'l3', 'l2', 'l1', 'l0'].map((id) => cssRgb(rgba(channel(id)))),
    };
  }

  function size() {
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(10, Math.round(canvas.clientWidth * dpr)), hgt = Math.max(8, Math.round(w * 0.8));
    if (canvas.width !== w || canvas.height !== hgt) { canvas.width = w; canvas.height = hgt; }
  }

  /* ---------------------------------------------------------- drawing */
  function graticule(W, H, dpr) {
    const lw = Math.max(1, Math.round(dpr));
    g.fillStyle = col.grid;
    for (let i = 1; i < 10; i++) g.fillRect(Math.round((i * W) / 10 - lw / 2), 0, lw, H);
    for (let j = 1; j < 8; j++) g.fillRect(0, Math.round((j * H) / 8 - lw / 2), W, lw);
    g.fillRect(0, 0, W, lw); g.fillRect(0, H - lw, W, lw); g.fillRect(0, 0, lw, H); g.fillRect(W - lw, 0, lw, H);
    // the centre axes carry minor ticks, five per division
    g.fillStyle = col.axis;
    const cx = Math.round(W / 2 - lw / 2), cy = Math.round(H / 2 - lw / 2), tick = Math.round(3 * dpr);
    for (let i = 1; i < 50; i++) g.fillRect(Math.round((i * W) / 50 - lw / 2), cy - tick, lw, tick * 2 + lw);
    for (let j = 1; j < 40; j++) g.fillRect(cx - tick, Math.round((j * H) / 40 - lw / 2), tick * 2 + lw, lw);
  }

  // one sweep: a knockout stroke in the screen colour, then the trace; NaN lifts the pen
  function stroke(data, count, alpha, dpr, W, H) {
    const cx = W / 2, cy = H / 2, unit = (UNIT * H) / 8, lim = 40;
    const levels = fig && fig.kind === 'mark' ? fig.levels : null;
    const all = new Path2D(), parts = levels ? levels.map(() => new Path2D()) : null;
    let pen = false, px = 0, py = 0, prevY = 0;
    for (let i = 0; i < count; i++) {
      let x = data[i * 2], y = data[i * 2 + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) { pen = false; continue; }
      x = x > lim ? lim : x < -lim ? -lim : x;
      y = y > lim ? lim : y < -lim ? -lim : y;
      const X = cx + x * unit, Y = cy - y * unit;
      if (pen) {
        all.lineTo(X, Y);
        if (parts) { const p = parts[levelOf((y + prevY) / 2, levels)]; p.moveTo(px, py); p.lineTo(X, Y); }
      } else { all.moveTo(X, Y); pen = true; }
      px = X; py = Y; prevY = y;
    }
    g.globalAlpha = alpha;
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = col.bg; g.lineWidth = 4.5 * dpr; g.stroke(all);
    g.lineWidth = 1.5 * dpr;
    if (parts) parts.forEach((p, i) => { g.strokeStyle = col.ch[i] || col.trace; g.stroke(p); });
    else { g.strokeStyle = col.trace; g.stroke(all); }
    g.globalAlpha = 1;
  }

  function paint() {
    if (!g || !canvas.width) return;
    const W = canvas.width, H = canvas.height, dpr = Math.min(window.devicePixelRatio || 1, 2);
    g.globalAlpha = 1;
    g.fillStyle = col.bg;
    g.fillRect(0, 0, W, H);
    graticule(W, H, dpr);
    if (!sweeps.count) sweepFigure();
    sweeps.forEach((data, len, age) => stroke(data, len >> 1, ageAlpha(age, K), dpr, W, H));
  }

  // one sweep of the figure into the persistence; while the beam is still drawing a
  // new figure only the part it has reached is stored, so no older sweep shows the rest early
  function sweepFigure() {
    if (!fig) return;
    sample(fig, N, a, buf);
    sweeps.push(buf, (reveal < 1 ? Math.max(2, Math.floor((N + 1) * reveal)) : N + 1) * 2);
  }

  /* ---------------------------------------------------------- the loop */
  const animates = () => !!dlg && dlg.open && live && (reveal < 1 || sound.on || (fig && fig.dynamic && !reducedMotion));
  function frame(now) {
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    // still drawing at the start of this frame: sweep even on the frame the reveal completes, so the whole figure lands
    const revealing = reveal < 1;
    if (revealing) reveal = Math.min(1, (now - revealAt) / (REVEAL * 1000));
    if (fig && fig.dynamic && !reducedMotion) a += DRIFT * dt;
    // with Sound on, plot what is playing: one drawing's worth of the analysers' samples
    const got = sound.on ? Math.min(sound.read(buf), sound.perDrawing + 1) : 0;
    if (got > 1) sweeps.push(buf, got * 2);
    else if ((fig && fig.dynamic && !reducedMotion) || revealing || !sweeps.count) sweepFigure();
    sound.pump();
    paint();
    if (!animates()) stopLoop();
  }
  function startLoop() { if (!ticking && animates()) { ticking = true; last = 0; addTick(frame); } }
  function stopLoop() { if (ticking) { ticking = false; removeTick(frame); } }

  const instrument = {
    start() {
      live = true;
      sound.hold(false);
      if (sound.on && fig) sound.setFigure(fig, reducedMotion ? 0 : DRIFT, a);
      startLoop();
    },
    stop() {
      live = false;
      stopLoop();
      // a hidden tab silences the sound card; Stop only holds the picture and the drift
      if (document.hidden) sound.hold(true);
      else {
        sound.hold(false); // back from a hidden tab while stopped
        if (sound.on && fig) sound.setFigure(fig, 0, a);
      }
      // stopped mid-reveal: hold the whole figure, not the part the beam had reached
      if (reveal < 1) { reveal = 1; sweepFigure(); }
      paint();
    },
  };

  /* ---------------------------------------------------------- figures */
  function figureFor(p) {
    if (p.kind === 'liss') return lissajous(p.p, p.q);
    if (p.kind === 'mark') return markFigure(markLevels());
    if (p.kind === 'expr') return exprFigure(p);
    return null;
  }

  function describe() {
    if (!fig) return;
    nameEl.textContent = fig.name;
    canvas.setAttribute('aria-label', `XY screen showing ${fig.kind === 'mark' ? 'the mark, one level per channel' : fig.kind === 'liss' ? `a ${fig.name}` : fig.name}`);
    soundBtn.setAttribute('aria-checked', String(wantSound && sound.on));
    readEl.replaceChildren();
    if (!sound.on) { readEl.append(wantSound && !sound.supported() ? 'This browser has no Web Audio.' : 'Sound off. Switch it on to hear the figure: left is x, right is y.'); return; }
    const per = sound.rate / (sound.perDrawing || 1);
    // label in the sans, value in mono, unit in the sans (the spaces are for screen readers; the gap draws them)
    const val = (label, v, unit) => h('span', { class: 'lab-read' }, h('span', { text: label }), ' ', h('b', { class: 'num', text: v }), ' ', h('span', { text: unit }));
    readEl.append('Sound on, left is x and right is y. ');
    if (fig.kind === 'liss') readEl.append(val('x', fmt(fig.p * per), 'Hz'), ' ', val('y', fmt(fig.q * per), 'Hz'));
    else readEl.append(val('Drawing rate', fmt(per), 'Hz'));
  }
  const fmt = (v) => (v >= 100 ? Math.round(v).toString() : v.toFixed(1));

  // draw a parsed `xy` request; returns an error message, or '' when it worked
  function show(p) {
    if (!p || p.err) return p ? p.err : 'xy: nothing to draw';
    let f;
    try { f = figureFor(p); } catch (e) { return `xy: ${e.message}`; }
    if (!f) return '';
    spec = p; fig = f;
    if (errEl) errEl.textContent = '';
    if (input) input.value = specText(p);
    sweeps.clear();
    reveal = reducedMotion || !isLive() || sound.on ? 1 : 0;
    revealAt = performance.now();
    if (sound.on) sound.setFigure(fig, live && !reducedMotion ? DRIFT : 0, a);
    describe();
    paint();
    startLoop();
    onChange();
    return '';
  }

  /* ---------------------------------------------------------- open, close */
  // would this request draw? '' when it would, or the reason it can't
  function check(p) {
    if (!p) return 'xy: nothing to draw';
    if (p.err) return p.err;
    if (p.kind === 'off' || p.kind === 'open') return '';
    try { figureFor(p); return ''; } catch (e) { return `xy: ${e.message}`; }
  }
  function open(p = { kind: 'open' }) {
    if (p.kind === 'off') { close(); return ''; }
    const want = p.kind === 'open' ? spec : p;
    // build the figure first, so a bad expression never opens an empty screen
    try { figureFor(want); } catch (e) { return `xy: ${e.message}`; }
    build();
    colours();
    const first = !dlg.open;
    if (first) {
      document.documentElement.classList.add('lab-modal');
      try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); }
      size();
    }
    const err = show(want);
    if (first) {
      unreg = register(instrument); // starts the loop now if the instrument is running
      if (wantSound) { startSound(); describe(); }
    }
    (matchMedia('(pointer: fine)').matches ? input : dlg.querySelector('[data-close]')).focus();
    return err;
  }
  function close() { if (dlg && dlg.open) dlg.close(); }
  function cleanup() {
    stopLoop();
    if (unreg) { unreg(); unreg = null; }
    live = false;
    sound.silence();
    sound.hold(true);
    document.documentElement.classList.remove('lab-modal');
    onChange();
  }

  /* ---------------------------------------------------------- sound */
  function startSound() {
    if (!sound.enable()) return false;
    if (fig) {
      sound.setFigure(fig, live && !reducedMotion ? DRIFT : 0, a);
      if (!document.hidden) sound.play(a);
    }
    return true;
  }
  // on: remember it, make the AudioContext (this is the opt-in click or command) and play if the screen is open
  function setSound(on) {
    wantSound = !!on;
    store.set(SOUND_KEY, wantSound ? '1' : '0');
    let ok = true;
    if (wantSound) {
      ok = sound.supported() && sound.enable();
      // as in show(): with Sound on the screen plots the sound card, so there's no beam reveal
      if (ok && dlg && dlg.open) { startSound(); reveal = 1; sweeps.clear(); startLoop(); }
    } else {
      sound.silence();
      sweeps.clear();
      if (dlg && dlg.open) paint();
    }
    if (dlg) describe();
    onChange();
    return ok;
  }

  return {
    open, close, check, setSound,
    get isOpen() { return !!(dlg && dlg.open); },
    get soundWanted() { return wantSound; },
    get soundPlaying() { return sound.on; },
    get soundSupported() { return sound.supported(); },
    get figure() { return fig ? fig.name : ''; },
  };
}
