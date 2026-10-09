// The pointer persistence's hit grid, kept free of the page so it can be tested
// in node. One cell per 8×8 CSS pixels holds how often the pointer crossed it,
// like a DPO's intensity map; every frame multiplies it by about 0.96 (246/256),
// in integers, so it always reaches zero and leaves no grey ghosts. It is drawn
// in four discrete steps, never interpolated.

export const CELL = 8;
export const HIT = 1000;
export const STEPS = [120, 600, 2400, 7000]; // level 1..4 thresholds

export function createGrid(cols, rows) {
  cols = Math.max(1, cols | 0);
  rows = Math.max(1, rows | 0);
  return { cols, rows, v: new Uint16Array(cols * rows) };
}

export function hit(g, x, y, amount = HIT) {
  if (x < 0 || y < 0 || x >= g.cols || y >= g.rows) return;
  const i = y * g.cols + x, n = g.v[i] + amount;
  g.v[i] = n > 65535 ? 65535 : n;
}

// Bresenham from (x0, y0) to (x1, y1). skipFirst leaves the start cell alone,
// so a chain of segments doesn't count each joint twice.
export function line(g, x0, y0, x1, y1, amount = HIT, skipFirst = false) {
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, first = true, guard = 4096;
  for (;;) {
    if (!(first && skipFirst)) hit(g, x0, y0, amount);
    first = false;
    if ((x0 === x1 && y0 === y1) || !guard--) return;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// one frame of decay; returns how many cells are still lit
export function decay(g) {
  const v = g.v;
  let live = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (x) { const y = (x * 246) >> 8; v[i] = y; if (y) live++; }
  }
  return live;
}

export const levelOf = (v) => (v >= STEPS[3] ? 4 : v >= STEPS[2] ? 3 : v >= STEPS[1] ? 2 : v >= STEPS[0] ? 1 : 0);

// colours: five packed RGBA pixels, index 0 for an empty cell (transparent)
export function paint(g, u32, colors) {
  const v = g.v, n = Math.min(v.length, u32.length);
  const s0 = STEPS[0], s1 = STEPS[1], s2 = STEPS[2], s3 = STEPS[3];
  const c0 = colors[0], c1 = colors[1], c2 = colors[2], c3 = colors[3], c4 = colors[4];
  for (let i = 0; i < n; i++) {
    const x = v[i];
    u32[i] = x < s0 ? c0 : x < s1 ? c1 : x < s2 ? c2 : x < s3 ? c3 : c4;
  }
}

// [r, g, b, a] (0..255) as one pixel of a Uint32Array view on ImageData
const LITTLE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
export const pack = (r, g, b, a = 255) => (LITTLE
  ? ((a << 24) | (b << 16) | (g << 8) | r) >>> 0
  : ((r << 24) | (g << 16) | (b << 8) | a) >>> 0);

// four steps of one channel colour, darkest first: the colour scaled towards black,
// opaque, because the canvas is blended with `lighten` (it only ever adds light)
export const LEVELS = [0.2, 0.34, 0.52, 0.78];
export function ramp([r, g, b]) {
  return [0, ...LEVELS.map((k) => pack(Math.round(r * k), Math.round(g * k), Math.round(b * k), 255))];
}
