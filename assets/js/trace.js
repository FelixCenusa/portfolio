// Your visit as a logic trace. The home page footer records which layer was on
// screen from the moment the page loaded and draws it as five digital channels,
// the way a logic analyser shows signals. The capture can be saved as a Value
// Change Dump (IEEE 1364) that GTKWave opens. Recording is one cheap scroll
// listener; drawing only happens while the footer is near the screen.

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

/* ------------------------------------------------------------ the footer instrument */
function mount(root) {
  const sections = [...document.querySelectorAll('section.layer[data-layer]')];
  if (!sections.length) return;
  const $ = (s) => root.querySelector(s);
  const plot = $('[data-trace-plot]'), svg = $('[data-trace-svg]'), axis = $('[data-trace-axis]');
  const cursor = $('[data-trace-cursor]'), tip = $('[data-trace-tip]'), summary = $('[data-trace-summary]');
  const labels = new Map([...root.querySelectorAll('[data-trace-labels] [data-ch]')].map((li) => [li.dataset.ch, li]));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

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
  // with reduced motion the picture only updates when you come to read it
  plot.addEventListener('pointerenter', (e) => { hovering = e.pointerType === 'mouse'; if (reduced && cursorT == null) draw(); });
  plot.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return;
    hovering = false;
    if (!focused) { cursorT = null; paintCursor(); }
  });

  // keyboard: it's a slider over the visit's time
  plot.addEventListener('focus', () => { focused = true; if (reduced && cursorT == null) draw(); if (cursorT == null) cursorT = 0; paintCursor(); });
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

  $('[data-trace-vcd]').addEventListener('click', () => {
    sample();
    const text = toVcd(events, performance.now(), new Date(performance.timeOrigin).toUTCString());
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'visit.vcd' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  root.hidden = false;

  // draw near the screen and keep it current while it's there. A reading under
  // the cursor holds the picture still; with reduced motion it only redraws on arrival.
  let timer = 0, inView = false;
  new IntersectionObserver(([e]) => {
    inView = e.isIntersecting;
    clearInterval(timer);
    if (!inView) { cursorT = null; return; }
    draw();
    if (!reduced) timer = setInterval(() => { if (cursorT == null) draw(); }, TICK_MS);
  }, { rootMargin: '200px 0px' }).observe(root);
  new ResizeObserver(() => { if (inView) draw(); }).observe(plot);
}

const root = globalThis.document && document.querySelector('[data-trace]');
if (root) mount(root);
