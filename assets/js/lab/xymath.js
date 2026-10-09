// The XY screen's maths, kept free of the page so it can be tested in node:
// what `xy …` means, the figures (Lissajous, the mark, the visitor's own
// expressions), sampling them for the screen and for the sound card, and the
// ring of past sweeps that gives the trace its persistence.
//
// A figure is { kind, name, dynamic, span, levels?, at(u, a, out) }: u runs 0..1
// once round the figure, a is the slow phase drift in radians, and at() writes
// x and y (about -1..1) into out. dynamic means a changes the picture. span is
// how much of u draws the picture (the mark is drawn forwards, then retraced).

export const TAU = Math.PI * 2;
export const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };
const clamp1 = (v) => (v > 1 ? 1 : v < -1 ? -1 : v === v ? v : 0); // NaN becomes 0

/* ------------------------------------------------------------ what `xy …` asks for */
// { kind: 'open' | 'off' | 'mark' } | { kind: 'liss', p, q } | { kind: 'expr', x, y, xs, ys, usesA } | { err }
export const XY_HINT = 'try xy 3 2, xy mark or xy x=sin(3*t) y=sin(2*t)';
export function parseXY(arg) {
  const s = String(arg == null ? '' : arg).trim();
  const low = s.toLowerCase();
  if (!s) return { kind: 'open' };
  if (low === 'off' || low === 'close' || low === 'exit') return { kind: 'off' };
  if (low === 'mark') return { kind: 'mark' };
  const m = /^(\d{1,3})\s*[:,x/\s]\s*(\d{1,3})$/i.exec(s);
  if (m) {
    const p = +m[1], q = +m[2];
    if (!p || !q || p > 16 || q > 16) return { err: 'xy: use whole numbers from 1 to 16, like xy 3 2' };
    const g = gcd(p, q);
    return { kind: 'liss', p: p / g, q: q / g };
  }
  if (!/[xy]\s*=/i.test(s)) return { err: `xy: ${XY_HINT}` };
  const pair = splitPair(s);
  if (pair.err) return pair;
  const x = checkExpr(pair.x), y = checkExpr(pair.y);
  if (x.err) return { err: `xy: x = ${pair.x}: ${x.err}` };
  if (y.err) return { err: `xy: y = ${pair.y}: ${y.err}` };
  return { kind: 'expr', x: x.js, y: y.js, xs: pair.x, ys: pair.y, usesA: x.usesA || y.usesA };
}

// "x=sin(3*t) y=sin(2*t)", "x = …, y = …", "y=… x=…"
function splitPair(s) {
  const sep = '(?:\\s*[,;]\\s*|\\s+)';
  let m = new RegExp(`^x\\s*=\\s*(.+?)${sep}y\\s*=\\s*(.+?)\\s*;?$`, 'i').exec(s);
  if (m) return { x: m[1].trim(), y: m[2].trim() };
  m = new RegExp(`^y\\s*=\\s*(.+?)${sep}x\\s*=\\s*(.+?)\\s*;?$`, 'i').exec(s);
  if (m) return { x: m[2].trim(), y: m[1].trim() };
  return { err: 'xy: give both, like xy x=sin(3*t) y=sin(2*t)' };
}

/* ------------------------------------------------------------ the visitor's expressions */
// Only numbers, t (0 to 2π round the figure), a (the slow drift), a few
// constants and Math functions get through; everything else is refused before
// anything is compiled. ^ means power, and 3t means 3*t.
const FUNCS = new Set(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh', 'abs', 'sign', 'sqrt', 'cbrt',
  'exp', 'log', 'log2', 'log10', 'pow', 'min', 'max', 'floor', 'ceil', 'round', 'trunc', 'hypot']);
const CONSTS = { pi: 'Math.PI', PI: 'Math.PI', tau: '(2*Math.PI)', E: 'Math.E' };
const VARS = new Set(['t', 'a']);
export const EXPR_WORDS = { funcs: [...FUNCS], consts: Object.keys(CONSTS), vars: [...VARS] };

function tokens(s) {
  const re = /\s+|((?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)|([A-Za-z_][A-Za-z_0-9]*)|(\*\*|[-+*/%^(),])/y;
  const list = [];
  while (re.lastIndex < s.length) {
    const at = re.lastIndex, m = re.exec(s);
    if (!m) throw new Error(`can't use "${s[at]}"`);
    if (m[1]) list.push({ k: 'num', v: m[1] });
    else if (m[2]) {
      const w = m[2];
      if (FUNCS.has(w)) list.push({ k: 'func', v: w });
      else if (Object.hasOwn(CONSTS, w)) list.push({ k: 'const', v: w });
      else if (VARS.has(w)) list.push({ k: 'var', v: w });
      else throw new Error(`unknown name "${w}" (use t, a, pi, sin, cos, …)`);
    } else if (m[3]) list.push({ k: m[3] === '**' ? '^' : m[3], v: m[3] });
  }
  return list;
}

// A small recursive-descent parser that writes fully bracketed JavaScript, so
// -t^2 means -(t^2) and 2^-t works, and nothing it emits can be a syntax error.
//   expr  = term (('+' | '-') term)*
//   term  = unary (('*' | '/' | '%') unary | unary)*      the bare one is 3t, 2(t + 1)
//   unary = ('-' | '+') unary | power
//   power = atom ('^' unary)?                              right-associative
//   atom  = number | const | var | func '(' expr (',' expr)* ')' | '(' expr ')'
export function checkExpr(src) {
  const s = String(src == null ? '' : src);
  if (!s.trim()) return { err: 'empty' };
  if (s.length > 160) return { err: 'too long (160 characters at most)' };
  let list, i = 0, usesA = false;
  try { list = tokens(s); } catch (e) { return { err: e.message }; }
  const peek = () => list[i] && list[i].k;
  const starts = (k) => k === 'num' || k === 'const' || k === 'var' || k === 'func' || k === '(';
  const fail = (msg) => { throw new Error(msg); };
  const expect = (k, msg) => { if (peek() !== k) fail(msg); i++; };
  function atom() {
    const t = list[i];
    if (!t) fail('it ends too early');
    i++;
    if (t.k === 'num') return `${t.v}`;
    if (t.k === 'const') return CONSTS[t.v];
    if (t.k === 'var') { if (t.v === 'a') usesA = true; return t.v; }
    if (t.k === 'func') {
      expect('(', `${t.v} needs brackets, like ${t.v}(t)`);
      const args = [expr()];
      while (peek() === ',') { i++; args.push(expr()); }
      expect(')', `a ( without its )`);
      return `M.${t.v}(${args.join(', ')})`;
    }
    if (t.k === '(') { const e = expr(); expect(')', 'a ( without its )'); return `(${e})`; }
    return fail(t.k === ')' ? 'a ) without its (' : `"${t.v}" in the wrong place`);
  }
  function power() {
    const b = atom();
    if (peek() === '^') { i++; return `(${b} ** ${unary()})`; }
    return b;
  }
  function unary() {
    if (peek() === '-') { i++; return `(-${unary()})`; }
    if (peek() === '+') { i++; return unary(); }
    return power();
  }
  function term() {
    let e = unary();
    for (;;) {
      const k = peek();
      if (k === '*' || k === '/' || k === '%') { i++; e = `(${e} ${k} ${unary()})`; }
      else if (starts(k)) e = `(${e} * ${unary()})`;
      else return e;
    }
  }
  function expr() {
    let e = term();
    while (peek() === '+' || peek() === '-') { const k = list[i++].k; e = `(${e} ${k} ${term()})`; }
    return e;
  }
  try {
    const js = expr();
    if (i < list.length) fail(list[i].k === ')' ? 'a ) without its (' : `"${list[i].v}" in the wrong place`);
    return { js, usesA };
  } catch (e) {
    return { err: e.message };
  }
}

// Compiles a checked expression. Only ever called with the output of checkExpr,
// on text the visitor typed (the shell or the XY screen's own field).
export function compileExpr(js) {
  // eslint-disable-next-line no-new-func
  const f = new Function('M', 't', 'a', `"use strict"; return +(${js});`);
  return (t, a) => f(Math, t, a);
}

/* ------------------------------------------------------------ figures */
export function lissajous(p, q) {
  return {
    kind: 'liss', name: `${p}:${q} Lissajous figure`, dynamic: true, span: 1, p, q,
    at(u, a, out) { out[0] = Math.sin(TAU * p * u + a); out[1] = Math.sin(TAU * q * u); },
  };
}

// the mark: five levels, L4 to L0, joined by edges (the nav mark's geometry, in its own units)
export const MARK_LEVELS = [[4.5, 9.1, 9], [9.1, 13.7, 12.5], [13.7, 18.3, 16], [18.3, 22.9, 19.5], [22.9, 27.5, 23]]; // x0, x1, y

// levels: [[x0, x1, y], …] top first, in SVG units (y down). The beam walks the
// staircase forwards and retraces it, so the loop is continuous and the sound has no jump.
export function markFigure(levels = MARK_LEVELS) {
  const pts = levels.flatMap(([x0, x1, y]) => [[x0, y], [x1, y]]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const s = 2 / (Math.max(...xs) - Math.min(...xs) || 1);
  const P = pts.map(([x, y]) => [(x - cx) * s, -(y - cy) * s]);
  const cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const L = cum[cum.length - 1] || 1;
  const levelYs = levels.map(([, , y]) => -(y - cy) * s);
  return {
    kind: 'mark', name: 'The mark', dynamic: false, span: 0.5, levels: levelYs,
    at(u, a, out) {
      const f = u - Math.floor(u);
      pointAt(P, cum, (f < 0.5 ? f * 2 : 2 - f * 2) * L, out);
    },
  };
}

function pointAt(P, cum, d, out) {
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; }
  const seg = cum[hi] - cum[lo] || 1, k = Math.min(1, Math.max(0, (d - cum[lo]) / seg));
  out[0] = P[lo][0] + (P[hi][0] - P[lo][0]) * k;
  out[1] = P[lo][1] + (P[hi][1] - P[lo][1]) * k;
}

// which level a point belongs to, for colouring the mark by channel: a level's own
// height and the edge below it take that level's colour (like the nav mark)
export function levelOf(y, levelYs, eps = 1e-6) {
  let n = 0;
  for (const ly of levelYs) if (y <= ly + eps) n++;
  return Math.max(0, Math.min(levelYs.length - 1, n - 1));
}

export function exprFigure(c) {
  const fx = compileExpr(c.x), fy = compileExpr(c.y);
  // something to draw at all? (sqrt(sin(t)) is fine; a constant NaN is not)
  let ok = 0;
  for (const t of [0, 0.7, 1.9, 3.3, 4.4, 5.8]) {
    const x = fx(t, Math.PI / 4), y = fy(t, Math.PI / 4);
    if (Number.isFinite(x) && Number.isFinite(y)) ok++;
  }
  if (!ok) throw new Error("that isn't a number for any t");
  return {
    kind: 'expr', name: `x = ${c.xs}, y = ${c.ys}`, dynamic: !!c.usesA, span: 1, xs: c.xs, ys: c.ys,
    at(u, a, out) { const t = TAU * u; out[0] = fx(t, a); out[1] = fy(t, a); },
  };
}

/* ------------------------------------------------------------ sampling */
// n + 1 points (the last closes the loop) of the first `span` of the figure, interleaved x, y
export function sample(fig, n, a, buf = new Float32Array((n + 1) * 2), span = fig.span || 1) {
  const out = [0, 0];
  for (let i = 0; i <= n; i++) {
    try { fig.at((i / n) * span, a, out); } catch { out[0] = out[1] = NaN; }
    buf[i * 2] = out[0];
    buf[i * 2 + 1] = out[1];
  }
  return buf;
}

// stereo audio: n samples per drawing, the drift advancing with real time, clipped to ±1
export function fillStereo(fig, n, a0, rate, sr, left, right) {
  const out = [0, 0];
  for (let i = 0; i < left.length; i++) {
    try { fig.at((i % n) / n, a0 + (rate * i) / sr, out); } catch { out[0] = out[1] = 0; }
    left[i] = clamp1(out[0]);
    right[i] = clamp1(out[1]);
  }
}

/* ------------------------------------------------------------ persistence */
// woscope's age ramp, done with vectors: the newest sweep is drawn at full strength,
// older ones at 0.6 * (1 - age / K)^2, so they fade to nothing in K sweeps
export const ageAlpha = (age, K) => (age <= 0 ? 1 : age >= K ? 0 : 0.6 * (1 - age / K) ** 2);

// the last K sweeps, each up to `size` floats; forEach goes oldest to newest
export class Sweeps {
  constructor(K, size) {
    this.K = K;
    this.size = size;
    this.buf = Array.from({ length: K }, () => new Float32Array(size));
    this.len = new Int32Array(K);
    this.head = -1;
    this.count = 0;
  }
  push(src, n = src.length) {
    this.head = (this.head + 1) % this.K;
    const dst = this.buf[this.head], m = Math.min(n, this.size);
    dst.set(m === src.length ? src : src.subarray(0, m));
    this.len[this.head] = m;
    this.count = Math.min(this.K, this.count + 1);
  }
  clear() { this.head = -1; this.count = 0; }
  forEach(fn) {
    for (let age = this.count - 1; age >= 0; age--) {
      const i = (this.head - age + this.K) % this.K;
      fn(this.buf[i], this.len[i], age);
    }
  }
}
