// Your visit as a logic trace. The home page footer records which layer was on
// screen from the moment the page loaded and draws it as five digital channels,
// the way a logic analyser shows signals. The capture can be saved as a Value
// Change Dump (IEEE 1364) that GTKWave opens, or as an image, the way a scope
// saves a screenshot: 1600 × 600, ten by eight divisions, named by the time it
// was taken. Recording is one cheap scroll listener; drawing only happens while
// the footer is near the screen.

import { channelColors } from './waves.js';
import { addCommand } from './shell.js';
import { register } from './instrument.js';

const LAYERS = [['l4', 'L4', 'Web'], ['l3', 'L3', 'Apps'], ['l2', 'L2', 'Algorithms'], ['l1', 'L1', 'Systems'], ['l0', 'L0', 'Metal']];
const NAMES = new Map(LAYERS.map(([id, reg, name]) => [id, `${reg} ${name}`]));
const TICK_MS = 400;
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]; // axis spacing, in seconds

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const half = (v) => Math.round(v * 2) / 2; // half pixels keep 1px lines crisp
const secs = (ms) => { const n = Math.round(ms / 1000); return `${n} second${n === 1 ? '' : 's'}`; };

/* ------------------------------------------------------------ VCD (pure, so it runs outside a browser too) */
// events: [{ t, layer }] oldest first, t in ms since page load, layer an id from LAYERS or null
export function toVcd(events, end, date = '') {
  const ids = new Map(LAYERS.map(([id], i) => [id, String.fromCharCode(33 + i)])); // ! " # $ %
  const out = [
    '$date', `  ${date}`, '$end',
    '$version', '  portfolio.felix.best visit trace', '$end',
    '$comment', '  One wire per layer, high while that layer was the one on screen.', '$end',
    '$timescale 1ms $end',
    '$scope module stack $end',
    ...LAYERS.map(([id, , name]) => `$var wire 1 ${ids.get(id)} ${id}_${name.toLowerCase()} $end`),
    '$upscope $end',
    '$enddefinitions $end',
  ];
  // whole milliseconds, strictly increasing; when changes share one, the last wins
  const changes = [];
  for (const e of events) {
    const t = Math.max(0, Math.round(e.t)), layer = ids.has(e.layer) ? e.layer : null;
    const prev = changes[changes.length - 1];
    if (prev && prev.t >= t) prev.layer = layer; else changes.push({ t, layer });
  }
  let state = changes.length && changes[0].t === 0 ? changes.shift().layer : null;
  out.push('#0', '$dumpvars', ...LAYERS.map(([id]) => `${id === state ? 1 : 0}${ids.get(id)}`), '$end');
  let last = 0;
  for (const { t, layer } of changes) {
    if (layer === state) continue;
    out.push(`#${t}`);
    if (state) out.push(`0${ids.get(state)}`);
    if (layer) out.push(`1${ids.get(layer)}`);
    state = layer;
    last = t;
  }
  const stop = Math.round(end);
  if (stop > last) out.push(`#${stop}`); // so viewers show the whole capture, not just up to the last edge
  return `${out.join('\n')}\n`;
}

/* ------------------------------------------------------------ saved image: names and numbers (pure) */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n) => String(n).padStart(2, '0');

// a length of time the way the header says it: "48 s", "3 min 12 s", "1 h 4 min"
export function fmtSpan(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 60)} h`;
}

// "9 Oct 2026", in the visitor's own time zone
export const fmtDate = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

// scope screenshot names: capture-20261009-2341.png
export const captureName = (d) => `capture-${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}.png`;

// the timebase for a capture spread over ten divisions, three significant figures at most.
// Rounded before the unit is picked, so 999.9 ms reads "1 s/div", not "1000 ms/div".
export function fmtDiv(spanMs, divs = 10) {
  const sig = (v) => String(Number(v.toPrecision(3)));
  const ms = Number((spanMs / divs).toPrecision(3));
  if (ms < 1000) return `${sig(ms)} ms/div`;
  if (ms < 60000) return `${sig(ms / 1000)} s/div`;
  return `${sig(ms / 60000)} min/div`;
}

/* ------------------------------------------------------------ capture helpers */
// the depth rail's rule (main.js): while the layers span 45% down the viewport,
// the active one is the last whose top has passed that line
function activeLayer(sections) {
  const mid = innerHeight * 0.45;
  const first = sections[0], last = sections[sections.length - 1];
  if (!(first.getBoundingClientRect().top < mid && last.getBoundingClientRect().bottom > mid)) return null;
  let active = null;
  for (const s of sections) if (s.getBoundingClientRect().top < mid) active = s.dataset.layer;
  return active;
}

// events as spans: [{ a, b, layer }] covering 0 to end
function segments(events, end) {
  return events.filter((e) => e.t < end).map((e, i, all) => ({ a: e.t, b: i + 1 < all.length ? all[i + 1].t : end, layer: e.layer }));
}

function layerAt(events, t) {
  let layer = null;
  for (const e of events) { if (e.t > t) break; layer = e.layer; }
  return layer;
}

function totals(segs) {
  const sum = new Map(LAYERS.map(([id]) => [id, 0]));
  for (const s of segs) if (s.layer) sum.set(s.layer, sum.get(s.layer) + s.b - s.a);
  return sum;
}

function ticksFor(span, w) {
  const s = span / 1000, most = clamp(Math.floor(w / 110), 2, 6);
  const step = STEPS.find((v) => s / v <= most) || Math.ceil(s / most / 3600) * 3600;
  const out = [];
  for (let v = 0; v <= s; v += step) out.push(v);
  return out;
}

/* ------------------------------------------------------------ drawing */
function channelSvg(id, segs, x, top, rh) {
  const hi = half(top + 5), lo = half(top + rh - 5);
  let d = '', rects = '', level = null;
  for (const s of segs) {
    const on = s.layer === id;
    if (level === null) d = `M0 ${on ? hi : lo}`;
    else if (on !== level) d += `H${x(s.a)}V${on ? hi : lo}`;
    if (on) rects += `<rect x="${x(s.a)}" y="${hi}" width="${Math.max(x(s.b) - x(s.a), 0.5)}" height="${lo - hi}"/>`;
    level = on;
  }
  d += `H${x(segs[segs.length - 1].b)}`;
  return `<g data-ch="${id}">${rects}<path class="trace__wave" d="${d}"/></g>`;
}

function gridSvg(ticks, x, w, h, rh) {
  let d = '';
  for (let i = 1; i < LAYERS.length; i++) d += `M0 ${Math.round(i * rh) + 0.5}H${w}`;
  for (const v of ticks) {
    const px = Math.round(x(v * 1000));
    if (px > 0 && px < w - 1) d += `M${px + 0.5} 0V${h}`;
  }
  return `<path class="trace__grid" d="${d}"/>`;
}

function describe(segs, span) {
  const sum = totals(segs);
  const parts = LAYERS.map(([id]) => `${NAMES.get(id)} ${secs(sum.get(id))}`);
  return `This visit so far: ${secs(span)}. Time each layer was the one on screen: ${parts.join(', ')}.`;
}

/* ------------------------------------------------------------ the saved image */
// A 1600 × 600 picture of the capture: a header, the five channels with their
// labels and time on screen, a graticule of ten by eight divisions, and the
// timebase. Drawn on any 2D context, so a stub context can run it outside a browser.
//   look: { bg, screen, text1, text2, text3, sans, mono, ch: { l4: '#…', … } }
export const CAPTURE = { w: 1600, h: 600, plot: { x: 216, y: 104, w: 1340, h: 432 }, divs: [10, 8] };

export function drawCapture(ctx, events, span, title, look) {
  const { w: W, h: H, plot: P, divs: [nx, ny] } = CAPTURE;
  span = Math.max(span, 1);
  const segs = segments(events, span);
  const sum = totals(segs);
  const x = (t) => P.x + Math.round(clamp(t / span, 0, 1) * P.w);
  const dx = P.w / nx, dy = P.h / ny, rh = P.h / LAYERS.length;
  const font = (weight, size, family) => { ctx.font = `${weight} ${size}px ${family}`; };
  const text = (s, tx, ty, color, align = 'left') => { ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(s, tx, ty); };

  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = look.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = look.screen;
  ctx.fillRect(P.x, P.y, P.w, P.h);

  // header
  font(600, 26, look.sans);
  text(title, 44, 60, look.text1);
  font(400, 16, look.sans);
  text('One channel per layer, high while that layer was the one on screen', P.x + P.w, 60, look.text3, 'right');

  // graticule: ten by eight divisions, centre axes with five minor ticks per division
  ctx.lineWidth = 1;
  ctx.strokeStyle = look.text1;
  ctx.globalAlpha = 0.07;
  ctx.beginPath();
  for (let i = 1; i < nx; i++) { const gx = Math.round(P.x + i * dx) + 0.5; ctx.moveTo(gx, P.y); ctx.lineTo(gx, P.y + P.h); }
  for (let j = 1; j < ny; j++) { const gy = Math.round(P.y + j * dy) + 0.5; ctx.moveTo(P.x, gy); ctx.lineTo(P.x + P.w, gy); }
  ctx.stroke();
  ctx.globalAlpha = 0.16;
  ctx.beginPath();
  const cx = Math.round(P.x + (nx / 2) * dx) + 0.5, cy = Math.round(P.y + (ny / 2) * dy) + 0.5;
  for (let i = 1; i < nx * 5; i++) { const tx = Math.round(P.x + (i * dx) / 5) + 0.5; ctx.moveTo(tx, cy - 4); ctx.lineTo(tx, cy + 4); }
  for (let j = 1; j < ny * 5; j++) { const ty = Math.round(P.y + (j * dy) / 5) + 0.5; ctx.moveTo(cx - 4, ty); ctx.lineTo(cx + 4, ty); }
  ctx.strokeRect(P.x + 0.5, P.y + 0.5, P.w - 1, P.h - 1);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // channels: a knockout stroke cuts the graticule, then the fill, then the trace
  LAYERS.forEach(([id, reg, name], i) => {
    const top = P.y + i * rh, mid = Math.round(top + rh / 2);
    const hi = Math.round(top + 20), lo = Math.round(top + rh - 20);
    const color = look.ch[id] || look.text2;
    const pts = [];
    let level = null;
    for (const s of segs) {
      const on = s.layer === id;
      if (level === null) pts.push([P.x, on ? hi : lo]);
      else if (on !== level) pts.push([x(s.a), level ? hi : lo], [x(s.a), on ? hi : lo]);
      level = on;
    }
    pts.push([x(segs[segs.length - 1].b), level ? hi : lo]);
    const path = () => { ctx.beginPath(); pts.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); };

    ctx.lineJoin = 'miter';
    ctx.lineCap = 'butt';
    path();
    ctx.strokeStyle = look.screen;
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.14;
    for (const s of segs) if (s.layer === id) ctx.fillRect(x(s.a), hi, Math.max(x(s.b) - x(s.a), 1), lo - hi);
    ctx.globalAlpha = 1;
    path();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    // the label column: register, name, time on screen
    font(500, 17, look.mono);
    text(reg, 44, mid - 3, color);
    font(500, 17, look.sans);
    text(name, 76, mid - 3, look.text2);
    font(400, 14, look.mono);
    text(fmtSpan(sum.get(id)), 44, mid + 19, look.text3);
  });

  // time axis: start, timebase, end
  font(400, 15, look.mono);
  text('0 s', P.x, P.y + P.h + 34, look.text3);
  text(fmtDiv(span, nx), P.x + P.w / 2, P.y + P.h + 34, look.text2, 'center');
  text(fmtSpan(span), P.x + P.w, P.y + P.h + 34, look.text3, 'right');
  ctx.restore();
}

/* ------------------------------------------------------------ the footer instrument */
function mount(root) {
  const sections = [...document.querySelectorAll('section.layer[data-layer]')];
  if (!sections.length) return;
  const $ = (s) => root.querySelector(s);
  const plot = $('[data-trace-plot]'), svg = $('[data-trace-svg]'), axis = $('[data-trace-axis]');
  const cursor = $('[data-trace-cursor]'), tip = $('[data-trace-tip]'), summary = $('[data-trace-summary]');
  const labels = new Map([...root.querySelectorAll('[data-trace-labels] [data-ch]')].map((li) => [li.dataset.ch, li]));

  // recording runs the whole visit; the first sample stands for the moment of load
  const events = [{ t: 0, layer: activeLayer(sections) }];
  const sample = () => {
    const layer = activeLayer(sections);
    if (layer !== events[events.length - 1].layer) events.push({ t: performance.now(), layer });
  };
  let queued = false;
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; sample(); }); } };
  addEventListener('scroll', queue, { passive: true });
  addEventListener('resize', queue, { passive: true });

  let view = null;      // { span, w } of the last drawing
  let cursorT = null;   // ms, while the cursor is shown
  let hovering = false, focused = false;

  const draw = () => {
    sample();
    const w = plot.clientWidth, h = plot.clientHeight;
    if (!w || !h) return;
    const span = Math.max(performance.now(), 1);
    const segs = segments(events, span);
    const rh = h / LAYERS.length;
    const x = (t) => half(t / span * w);
    const ticks = ticksFor(span, w);
    view = { span, w };
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.innerHTML = gridSvg(ticks, x, w, h, rh) + LAYERS.map(([id], i) => channelSvg(id, segs, x, i * rh, rh)).join('');
    axis.replaceChildren(...ticks.map((v) => {
      const px = x(v * 1000);
      const el = Object.assign(document.createElement('span'), { textContent: `${v} s` });
      el.style.left = `${px}px`;
      if (v > 0 && px > w - 28) el.className = 'is-end';
      return el;
    }));
    summary.textContent = describe(segs, span);
    plot.setAttribute('aria-valuemax', (span / 1000).toFixed(1));
    paintCursor();
  };

  const paintCursor = () => {
    labels.forEach((li) => li.classList.remove('is-hot'));
    cursor.hidden = cursorT == null || !view;
    if (cursor.hidden) return;
    const t = clamp(cursorT, 0, view.span);
    const px = t / view.span * view.w;
    const layer = layerAt(events, t);
    const text = `${(t / 1000).toFixed(1)} s, ${layer ? NAMES.get(layer) : 'no layer'}`;
    tip.textContent = text;
    cursor.style.transform = `translateX(${px}px)`;
    cursor.classList.toggle('is-flip', px + 8 + tip.offsetWidth > view.w);
    if (layer) labels.get(layer).classList.add('is-hot');
    plot.setAttribute('aria-valuenow', (t / 1000).toFixed(1));
    plot.setAttribute('aria-valuetext', text);
  };

  // pointer: hover with a mouse, tap or drag sideways on touch (the cursor stays after a tap)
  const point = (e) => {
    if (!view) return;
    cursorT = clamp((e.clientX - plot.getBoundingClientRect().left) / view.w, 0, 1) * view.span;
    paintCursor();
  };
  plot.addEventListener('pointerdown', point);
  plot.addEventListener('pointermove', point);
  // while the picture is held (stopped, or reduced motion) it updates when you come to read it
  plot.addEventListener('pointerenter', (e) => { hovering = e.pointerType === 'mouse'; if (!live && cursorT == null) draw(); });
  plot.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return;
    hovering = false;
    if (!focused) { cursorT = null; paintCursor(); }
  });

  // keyboard: it's a slider over the visit's time
  plot.addEventListener('focus', () => { focused = true; if (!live && cursorT == null) draw(); if (cursorT == null) cursorT = 0; paintCursor(); });
  plot.addEventListener('blur', () => { focused = false; if (!hovering) { cursorT = null; paintCursor(); } });
  plot.addEventListener('keydown', (e) => {
    if (!view) return;
    const t = cursorT ?? 0, step = (view.span / 50) * (e.shiftKey ? 5 : 1);
    const next = { ArrowLeft: t - step, ArrowDown: t - step, ArrowRight: t + step, ArrowUp: t + step, Home: 0, End: view.span }[e.key];
    if (next == null) return;
    e.preventDefault();
    cursorT = clamp(next, 0, view.span);
    paintCursor();
  });

  // the soft keys: the capture as a .vcd file, and as an image
  const vcd = $('[data-trace-vcd]');
  vcd.addEventListener('click', () => {
    sample();
    const text = toVcd(events, performance.now(), new Date(performance.timeOrigin).toUTCString());
    download(new Blob([text], { type: 'text/plain' }), 'visit.vcd');
  });

  const png = $('[data-trace-png]') || addImageKey(vcd);
  const saveImage = async () => {
    sample();
    const span = performance.now(), taken = new Date();
    const look = captureLook();
    await fontsFor(look);
    const canvas = Object.assign(document.createElement('canvas'), { width: CAPTURE.w, height: CAPTURE.h });
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const title = `${siteHost()}, ${fmtSpan(span)}, ${fmtDate(new Date(performance.timeOrigin))}`;
    drawCapture(ctx, events, span, title, look);
    const blob = await new Promise((done) => (canvas.toBlob ? canvas.toBlob(done, 'image/png') : done(null)));
    if (blob) download(blob, captureName(taken));
  };
  // a flag, not .disabled: disabling the key you just pressed would drop keyboard focus
  let saving = false;
  png.addEventListener('click', async () => {
    if (saving) return;
    saving = true;
    try { await saveImage(); } catch (err) { console.warn('could not save the capture image', err); } finally { saving = false; }
  });
  addCommand('save', {
    usage: 'save', about: 'Save an image of your visit trace', arg: false,
    plan: () => ({ label: 'Save an image of your visit trace', action: { call: () => { png.click(); return `Saving ${captureName(new Date())}`; } } }),
  });

  root.hidden = false;

  // draw near the screen and keep it current while it's there and the page is
  // running. Stop holds the picture (recording carries on underneath, and the
  // saved files always hold the whole visit); so does a reading under the cursor.
  // While stopped, and with reduced motion, it redraws when you come to read it.
  let timer = 0, inView = false, live = false;
  const loop = () => {
    clearInterval(timer);
    timer = inView && live ? setInterval(() => { if (cursorT == null) draw(); }, TICK_MS) : 0;
  };
  new IntersectionObserver(([e]) => {
    inView = e.isIntersecting;
    if (!inView) cursorT = null;
    else draw();
    loop();
  }, { rootMargin: '200px 0px' }).observe(root);
  new ResizeObserver(() => { if (inView) draw(); }).observe(plot);
  register({
    start() { live = true; if (inView && cursorT == null) draw(); loop(); },
    stop() { live = false; loop(); },
  });
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// "Save image" sits beside "Download .vcd"; made here when the page doesn't have it
function addImageKey(vcd) {
  const key = Object.assign(document.createElement('button'), { type: 'button', className: vcd.className, textContent: 'Save image' });
  key.dataset.tracePng = '';
  const keys = Object.assign(document.createElement('div'), { className: 'trace__keys' });
  vcd.replaceWith(keys);
  keys.append(key, vcd);
  return key;
}

// the page's own tokens, for the canvas
function captureLook() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  return {
    bg: v('--s-bg-1', '#0c0d10'), screen: v('--s-bg-0', '#060709'),
    text1: v('--text-1', '#e9edf2'), text2: v('--text-2', '#b4bcc8'), text3: v('--text-3', '#8f99a8'),
    sans: v('--f-sans', 'sans-serif'), mono: v('--f-mono', 'monospace'),
    ch: channelColors(),
  };
}

// the page's fonts are already in use; this only waits (briefly) if one is still on its way
async function fontsFor(look) {
  if (!document.fonts || !document.fonts.load) return;
  const ready = Promise.all([document.fonts.load(`600 26px ${look.sans}`), document.fonts.load(`500 17px ${look.mono}`)]).catch(() => {});
  await Promise.race([ready, new Promise((done) => setTimeout(done, 800))]);
}

// the site's own address, even when the page is served from somewhere else
function siteHost() {
  try { const c = document.querySelector('link[rel="canonical"]'); if (c) return new URL(c.href).host; } catch {}
  return location.host || 'portfolio.felix.best';
}

const root = globalThis.document && document.querySelector('[data-trace]');
if (root) mount(root);
