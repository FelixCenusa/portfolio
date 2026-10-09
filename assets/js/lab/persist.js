// Intensity-graded pointer persistence: where the pointer has been, drawn the way
// a DPO grades a trace by how often the beam crossed each spot. A fixed canvas at
// 1/8 resolution, one cell per 8×8 px, scaled up with hard pixels; four discrete
// steps of the current channel's colour, no interpolation, no blur. The canvas is
// blended with `lighten`, so it only adds light where the page is darker than it:
// it shows on the dark ground and never dims text, which reads as "behind" it.
//
// Off on touch screens and with reduced motion. It sleeps after 3 s without a
// move, and Stop holds the picture (the grid neither records nor fades).

import { register, reducedMotion } from '../instrument.js';
import { addTick, removeTick, rgba, channel, layerAt } from './util.js';
import { CELL, HIT, createGrid, line, decay, paint, ramp } from './grid.js';

const IDLE_MS = 3000;

export const persistAvailable = () => !reducedMotion && typeof matchMedia === 'function'
  && matchMedia('(pointer: fine)').matches && matchMedia('(hover: hover)').matches;

export function createPersist() {
  let canvas = null, ctx = null, img = null, u32 = null, grid = null;
  let on = false, live = false, ticking = false, unreg = null;
  let lastCell = null, lastMove = 0, colors = [0, 0, 0, 0, 0], chId = '', frames = 0;

  function fit() {
    const cols = Math.ceil(innerWidth / CELL), rows = Math.ceil(innerHeight / CELL);
    if (grid && grid.cols === cols && grid.rows === rows) return;
    grid = createGrid(cols, rows);
    canvas.width = cols; canvas.height = rows;
    canvas.style.width = `${cols * CELL}px`; canvas.style.height = `${rows * CELL}px`;
    img = ctx.createImageData(cols, rows);
    u32 = new Uint32Array(img.data.buffer);
    lastCell = null;
  }

  function tint() {
    const id = layerAt().id || 'l4';
    if (id === chId) return;
    chId = id;
    colors = ramp(rgba(channel(id), [244, 224, 77, 255]));
  }

  function frame(now) {
    if ((frames++ & 15) === 0) tint(); // the channel can change as the page scrolls under a still pointer
    const lit = decay(grid);
    paint(grid, u32, colors);
    ctx.putImageData(img, 0, 0);
    if (!lit || now - lastMove > IDLE_MS) sleep();
  }
  function wake() { if (!ticking && live) { ticking = true; addTick(frame); } }
  function sleep() {
    if (!ticking) return;
    ticking = false;
    removeTick(frame);
    if (live && grid) { grid.v.fill(0); ctx.clearRect(0, 0, canvas.width, canvas.height); }
  }

  function onMove(e) {
    if (!live || e.pointerType === 'touch') return;
    const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
    const list = evs && evs.length ? evs : [e];
    for (const ev of list) {
      const x = Math.floor(ev.clientX / CELL), y = Math.floor(ev.clientY / CELL);
      if (lastCell) line(grid, lastCell[0], lastCell[1], x, y, HIT, true);
      else line(grid, x, y, x, y, HIT);
      lastCell = [x, y];
    }
    lastMove = performance.now();
    wake();
  }
  const onLeave = (e) => { if (!e.relatedTarget) lastCell = null; };
  const onResize = () => { if (canvas) { fit(); ctx.clearRect(0, 0, canvas.width, canvas.height); } };
  const onScroll = () => { lastCell = null; }; // the page moved under the pointer: don't draw a jump

  function enable() {
    if (on) return true;
    if (!persistAvailable()) return false;
    canvas = document.createElement('canvas');
    canvas.className = 'lab-persist';
    canvas.setAttribute('aria-hidden', 'true');
    ctx = canvas.getContext('2d');
    if (!ctx) { canvas = null; return false; }
    on = true;
    document.body.prepend(canvas);
    fit();
    chId = '';
    tint();
    addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('mouseout', onLeave);
    addEventListener('resize', onResize, { passive: true });
    addEventListener('scroll', onScroll, { passive: true });
    unreg = register({
      // on Run, a held picture fades out as usual instead of hanging there
      start() { live = true; lastCell = null; if (grid && grid.v.some(Boolean)) { lastMove = Math.max(lastMove, performance.now() - IDLE_MS / 2); wake(); } },
      stop() { live = false; if (ticking) { ticking = false; removeTick(frame); } }, // hold the picture as it is
    });
    return true;
  }

  function disable() {
    if (!on) return;
    on = false;
    if (unreg) { unreg(); unreg = null; }
    sleep();
    if (ticking) { ticking = false; removeTick(frame); }
    removeEventListener('pointermove', onMove);
    document.removeEventListener('mouseout', onLeave);
    removeEventListener('resize', onResize);
    removeEventListener('scroll', onScroll);
    canvas.remove();
    canvas = ctx = img = u32 = grid = null;
    live = false;
  }

  return { enable, disable, get on() { return on; } };
}
