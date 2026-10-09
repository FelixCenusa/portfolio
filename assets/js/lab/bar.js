// The instrument bar: the depth rail as a DSO's bottom status strip. Left to
// right: the five channel boxes (the one on screen is filled in its colour, as
// a scope marks the selected channel; click one to go there), the record map
// (the whole stack in proportion, with a bracket for what's on screen, like the
// record-length bar on a real DSO), the timebase, the trigger status and the
// Run/Stop key. On phones it's just the current channel and Run/Stop. It steps
// aside while the footer's visit trace is on screen, since that takes over.

import { isRunning, setRun, onRun } from '../instrument.js';
import { h, LAYERS, sections, layerAt, scrollToY } from './util.js';

// The timebase cell is handed to readouts.js (attachTimebase), which owns the values and
// re-ranges every timebase on the page together. These are only the fallback if it isn't there.
const TIMEBASE = { l4: ['50', 'ms/div'], l3: ['5', 'ms/div'], l2: ['500', 'µs/div'], l1: ['20', 'µs/div'], l0: ['10', 'ns/div'] };
const TRIGGER_AFTER_MS = 2000; // the hero's rule: the first move, or 2 s after load

export function createBar() {
  let bar = null, list = [], box = {}, seg = {}, map = null, bracket = null, tbCell = null, tbVal = null, tbUnit = null, ownTb = true, readouts = null, trigEl = null, runBtn = null, runText = null;
  let top = 0, total = 1, bw = 0, mapW = 160, raf = 0, ro = null, io = null, offRun = null, shown = null;
  let trig = 'waiting', fallback = null, mo = null;
  const cleanups = [];
  const listen = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); cleanups.push(() => target.removeEventListener(type, fn, opts)); };

  function build() {
    const chs = LAYERS.map(([id, reg, name]) => {
      box[id] = h('a', { class: 'lab-ch', href: `#${id}`, 'data-ch': id }, h('b', { text: reg }), ' ', h('span', { text: name }));
      return box[id];
    });
    map = h('div', { class: 'lab-map', 'aria-hidden': 'true', title: 'The whole stack, and the part on screen' });
    for (const [id] of LAYERS) { seg[id] = h('i', { class: 'lab-map__seg', 'data-ch': id }); map.append(seg[id]); }
    bracket = h('b', { class: 'lab-map__bracket' });
    map.append(bracket);
    tbVal = h('b', { class: 'num' }); tbUnit = h('span');
    trigEl = h('span', { class: 'lab-bar__trig' });
    runText = h('span');
    runBtn = h('button', { type: 'button', class: 'lab-run' }, h('i', { class: 'lab-lamp', 'aria-hidden': 'true' }), runText);
    bar = h('div', { class: 'lab-bar', role: 'region', 'aria-label': 'Instrument bar' },
      h('nav', { class: 'lab-bar__chs', 'aria-label': 'Channels' }, chs),
      map,
      tbCell = h('p', { class: 'lab-bar__cell lab-bar__tb', 'aria-hidden': 'true' }, h('span', { class: 'lab-bar__label', text: 'Timebase' }), ' ', tbVal, ' ', tbUnit),
      h('p', { class: 'lab-bar__cell lab-bar__tr' }, h('span', { class: 'lab-bar__label', text: 'Trigger' }), ' ', trigEl),
      runBtn);
    runBtn.addEventListener('click', () => setRun(!isRunning()));
    map.addEventListener('click', (e) => {
      const r = map.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (e.clientX - r.left) / (r.width || 1)));
      scrollToY(Math.max(0, top + f * total - innerHeight * 0.45));
    });
    document.body.append(bar);
  }

  /* ---------------------------------------------------------- layout and scroll */
  function measure() {
    if (!bar || !list.length) return;
    const y = scrollY;
    const rects = list.map((s) => s.getBoundingClientRect());
    top = rects[0].top + y;
    total = Math.max(1, rects[rects.length - 1].bottom + y - top);
    list.forEach((s, i) => { const s2 = seg[s.dataset.layer]; if (s2) s2.style.flexGrow = String(Math.max(1, Math.round(rects[i].height))); });
    mapW = map.clientWidth || 160;
    bw = Math.max(6, Math.min(mapW, (innerHeight / total) * mapW));
    bracket.style.width = `${bw}px`;
    update();
  }
  function update() {
    raf = 0;
    if (!bar || !list.length) return;
    const f = (scrollY - top) / total;
    const x = Math.max(0, Math.min(mapW - bw, f * mapW));
    bracket.style.transform = `translateX(${x}px)`;
    bracket.classList.toggle('is-out', scrollY + innerHeight <= top || scrollY >= top + total);
    const at = layerAt(list);
    const near = at.id || at.nearest;
    const key = `${at.id}|${near}`;
    if (key !== shown) {
      shown = key;
      for (const [id] of LAYERS) {
        const b = box[id];
        b.classList.toggle('is-active', id === at.id);
        b.classList.toggle('is-near', id === near);
        if (id === at.id) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
      }
      if (ownTb) {
        const tb = TIMEBASE[near] || TIMEBASE.l4;
        tbVal.textContent = tb[0];
        tbUnit.textContent = tb[1];
      }
    }
  }
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
  const onResize = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };

  /* ---------------------------------------------------------- trigger and Run/Stop */
  function paintRun() {
    const on = isRunning();
    runText.textContent = on ? 'Stop' : 'Run';
    runBtn.title = on ? 'Stop every moving trace' : 'Run the traces again';
    bar.classList.toggle('is-stopped', !on);
    trigEl.textContent = !on ? 'Stopped' : trig === 'triggered' ? 'Triggered' : 'Waiting';
  }
  const fire = () => {
    if (trig === 'triggered') return;
    trig = 'triggered';
    if (fallback) { fallback(); fallback = null; }
    if (bar) paintRun();
  };
  // The hero (hero/poweron.js) publishes its trigger state on the stage as
  // data-scope="armed | capture | hold"; follow it whenever it's there.
  function fromStage() {
    const v = document.querySelector('[data-stage]')?.dataset.scope;
    if (!v) return false;
    trig = v === 'armed' ? 'waiting' : 'triggered';
    if (fallback) { fallback(); fallback = null; }
    if (bar) paintRun();
    return true;
  }
  // until the hero says otherwise, the same rule it uses: the first move, scroll, key or touch, or 2 s after load
  function armFromLoad() {
    if (performance.now() >= TRIGGER_AFTER_MS) { trig = 'triggered'; return; }
    const types = ['pointermove', 'wheel', 'keydown', 'touchstart', 'scroll'];
    const opts = { passive: true, capture: true };
    types.forEach((t) => addEventListener(t, fire, opts));
    const timer = setTimeout(fire, TRIGGER_AFTER_MS - performance.now());
    fallback = () => { types.forEach((t) => removeEventListener(t, fire, opts)); clearTimeout(timer); };
  }

  /* ---------------------------------------------------------- on, off */
  function enable() {
    if (bar) return true;
    list = sections();
    if (!list.length) return false; // a page without the stack (projects, CV, 404): nothing to map
    build();
    document.documentElement.classList.add('lab-has-bar');
    listen(window, 'scroll', onScroll, { passive: true });
    listen(window, 'resize', onResize, { passive: true });
    if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(onResize); list.forEach((s) => ro.observe(s)); }
    const foot = document.querySelector('.footer');
    if (foot && typeof IntersectionObserver === 'function') {
      io = new IntersectionObserver(([e]) => {
        bar.classList.toggle('is-away', e.isIntersecting);
        bar.inert = e.isIntersecting;
      });
      io.observe(foot);
    }
    offRun = onRun(() => paintRun());
    // the shared timebase (each layer row says it too, so the bar's copy is aria-hidden, like the rail's)
    ownTb = true;
    const cell = tbCell;
    import('../readouts.js')
      .then((m) => { readouts = m; if (bar && tbCell === cell && typeof m.attachTimebase === 'function' && m.attachTimebase(cell)) ownTb = false; })
      .catch(() => {});
    const stage = document.querySelector('[data-stage]');
    if (stage && typeof MutationObserver === 'function') {
      mo = new MutationObserver(fromStage);
      mo.observe(stage, { attributes: true, attributeFilter: ['data-scope'] });
    }
    if (!fromStage() && trig === 'waiting' && !fallback) armFromLoad();
    paintRun();
    measure();
    return true;
  }
  function disable() {
    if (!bar) return;
    cleanups.splice(0).forEach((f) => f());
    if (ro) { ro.disconnect(); ro = null; }
    if (io) { io.disconnect(); io = null; }
    if (mo) { mo.disconnect(); mo = null; }
    if (offRun) { offRun(); offRun = null; }
    if (fallback) { fallback(); fallback = null; }
    cancelAnimationFrame(raf); raf = 0;
    if (!ownTb && readouts && typeof readouts.detachTimebase === 'function') readouts.detachTimebase(tbCell);
    bar.remove();
    bar = null; shown = null;
    document.documentElement.classList.remove('lab-has-bar');
  }

  return { enable, disable, get on() { return !!bar; }, available: () => sections().length > 0 };
}
