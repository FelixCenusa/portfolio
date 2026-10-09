/* Fig. 06 · Aristotle's puzzle (the order-3 magic hexagon).
   Place 1..19 in a 3-4-5-4-3 hexagon so that all 15 straight lines sum to 38.
   The solver is pure and DOM-free, so node can import it:
     import { solveAll } from './aristotle.js'  ->  { sols: 12 boards, nodes, backtracks } */

export const TARGET = 38;
const N = 19, R3 = Math.sqrt(3);

// Axial hex coordinates (q, r), s = -q - r. Cells are numbered row by row, left to right.
export const CELLS = [];
for (let r = -2; r <= 2; r++) {
  const a = Math.max(-2, -2 - r), b = Math.min(2, 2 - r);
  for (let q = a; q <= b; q++) CELLS.push({ q, r, s: -q - r, row: r + 3, col: q - a + 1 });
}
const at = (q, r) => CELLS.findIndex(c => c.q === q && c.r === r);
const pick = (k, v, by) => CELLS.map((c, i) => [c, i]).filter(([c]) => c[k] === v).sort((x, y) => x[0][by] - y[0][by]).map(x => x[1]);

// 15 lines: 5 rows, 5 falling diagonals (constant q), 5 rising diagonals (constant s)
export const LINES = [], NAMES = [];
for (let v = -2; v <= 2; v++) { LINES.push(pick('r', v, 'q')); NAMES.push('Row ' + (v + 3)); }
for (let v = -2; v <= 2; v++) { LINES.push(pick('q', v, 'r')); NAMES.push('Falling diagonal ' + (v + 3)); }
for (let v = 2; v >= -2; v--) { LINES.push(pick('s', v, 'r')); NAMES.push('Rising diagonal ' + (3 - v)); }
export const CELL_LINES = CELLS.map((_, i) => LINES.flatMap((l, j) => (l.includes(i) ? [j] : [])));

// Fill order: walk the outer ring corner to corner, so every side line closes on its second
// corner (that value is forced), then one free inner cell; every later cell is forced by a
// line with a single gap left. Lines are checked the moment they close.
export const ORDER = [0, 1, 2, 6, 11, 15, 18, 17, 16, 12, 7, 3, 4, 5, 8, 13, 14, 10, 9];

export function newState() {
  return {
    val: new Int8Array(N), sum: new Int16Array(15), left: Int8Array.from(LINES, l => l.length), used: 0,
    depth: 0, nodes: 0, backtracks: 0, solutions: 0, done: false,
    cell: -1, value: 0, ok: false, line: -1, why: '', need: 0, // the last node tried
  };
}

// smallest / largest possible sum of k distinct values not yet used
const lo = (k, u) => { let t = 0; for (let v = 1; k && v <= N; v++) if (!(u >> v & 1)) { t += v; k--; } return t; };
const hi = (k, u) => { let t = 0; for (let v = N; k && v >= 1; v--) if (!(u >> v & 1)) { t += v; k--; } return t; };

function place(s, c, v) { s.val[c] = v; s.used |= 1 << v; for (const L of CELL_LINES[c]) { s.sum[L] += v; s.left[L]--; } }
function unplace(s, c) { const v = s.val[c]; s.val[c] = 0; s.used &= ~(1 << v); for (const L of CELL_LINES[c]) { s.sum[L] -= v; s.left[L]++; } }

// Candidate range for cell c from simple bounds on each of its lines. A closing line pins it to one value.
function domain(s, c) {
  let a = 1, b = N;
  for (const L of CELL_LINES[c]) {
    const k = s.left[L] - 1, need = TARGET - s.sum[L];
    a = Math.max(a, need - hi(k, s.used)); b = Math.min(b, need - lo(k, s.used));
  }
  return [Math.min(a, N + 1), Math.max(b, 0)];
}

// Would v at c keep every line through c completable? Records why not.
function test(s, c, v) {
  const u = s.used | 1 << v;
  for (const L of CELL_LINES[c]) {
    const t = s.sum[L] + v, k = s.left[L] - 1, need = TARGET - t;
    let why = '';
    if (!k) { if (t !== TARGET) why = 'sum'; }
    else if (k === 1) { if (need < 1 || need > N) why = 'range'; else if (u >> need & 1) why = 'used'; }
    else if (need < lo(k, u) || need > hi(k, u)) why = 'bound';
    if (why) { s.line = L; s.why = why; s.need = k ? need : t; return false; }
  }
  s.line = -1; s.why = ''; return true;
}

// Depth-first backtracking. Yields 1 after every node (one value tried at one cell), 2 on a solution.
export function* search(s) {
  const nxt = new Int8Array(N + 1), top = new Int8Array(N + 1);
  let d = 0;
  for (;;) {
    if (d === N) { s.solutions++; s.cell = -1; yield 2; unplace(s, ORDER[--d]); s.depth = d; continue; }
    const c = ORDER[d];
    if (!nxt[d]) [nxt[d], top[d]] = domain(s, c);
    let v = nxt[d];
    while (v <= top[d] && s.used >> v & 1) v++;
    if (v > top[d]) { // exhausted: step back
      nxt[d] = 0;
      if (!d) { s.done = true; s.cell = -1; return; }
      unplace(s, ORDER[--d]); s.depth = d; s.backtracks++;
      continue;
    }
    nxt[d] = v + 1; s.nodes++; s.cell = c; s.value = v;
    if ((s.ok = test(s, c, v))) { place(s, c, v); s.depth = ++d; }
    yield 1;
  }
}

export function solveAll() {
  const s = newState(), sols = [];
  for (const r of search(s)) if (r === 2) sols.push(Array.from(s.val));
  return { sols, nodes: s.nodes, backtracks: s.backtracks };
}

/* ------------------------------------------------------------------ UI */

let uid = 0;
const HEX = '43.3,1.5 85.3,25.75 85.3,74.25 43.3,98.5 1.3,74.25 1.3,25.75';
const SPEEDS = [['Slow', 6], ['Fast', 420], ['Max', 0]]; // nodes per second, 0 = as fast as a frame allows. Fast finds the first solution in ~15 s
const FLASH = [320, 110, 90];
const NOTE0 = 'All runs the full search without animation.';
const fmt = n => n.toLocaleString('en-US');
const fmtT = ms => ms < 1000 ? Math.round(ms) + ' ms' : ms < 6e4 ? (ms / 1000).toFixed(1) + ' s' : `${ms / 6e4 | 0}:${String((ms / 1000 | 0) % 60).padStart(2, '0')}`;
const where = i => `row ${CELLS[i].row}, cell ${CELLS[i].col}`;
const tri = d => `<svg viewBox="0 0 10 10" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg>`;

export function mount(root, { reducedMotion = false } = {}) {
  const id = 'ar' + ++uid;
  root.classList.add('demo--aristotle');

  // geometry, in units of the hex circumradius
  const px = (q, r) => [R3 * (q + r / 2), 1.5 * r];
  const P = CELLS.map(c => px(c.q, c.r)), CW = R3 * 0.96, CH = 1.92, SW = 1.2, SH = 0.72;
  const chip = LINES.map((l, j) => {
    const fam = j / 5 | 0, end = fam === 1 ? l[l.length - 1] : l[0], far = P[fam === 1 ? l[0] : l[l.length - 1]];
    const [dq, dr] = [[-1, 0], [0, 1], [1, -1]][fam], a = CELLS[end];
    const [x, y] = P[end], [x2, y2] = px(a.q + dq, a.r + dr), ux = (x2 - x) / R3, uy = (y2 - y) / R3;
    return { x: x + (x2 - x) * 1.1, y: y + (y2 - y) * 1.1, ax: x, ay: y, ux, uy, far };
  });
  let X0 = 1e9, X1 = -1e9, Y0 = 1e9, Y1 = -1e9;
  const grow = (x, y, w, h) => { X0 = Math.min(X0, x - w / 2); X1 = Math.max(X1, x + w / 2); Y0 = Math.min(Y0, y - h / 2); Y1 = Math.max(Y1, y + h / 2); };
  P.forEach(([x, y]) => grow(x, y, CW, CH)); chip.forEach(c => grow(c.x, c.y, SW, SH));
  X0 -= 0.06; Y0 -= 0.06; X1 += 0.06; Y1 += 0.06;
  const W = X1 - X0, H = Y1 - Y0, f = n => +n.toFixed(3);
  const box = (x, y, w, h) => `left:${f((x - w / 2 - X0) / W * 100)}%;top:${f((y - h / 2 - Y0) / H * 100)}%;width:${f(w / W * 100)}%;height:${f(h / H * 100)}%`;

  const traces = chip.map((c, j) => {
    const sx = f(c.ax + c.ux * 0.9), sy = f(c.ay + c.uy * 0.9);
    return `<path class="ar-rail" d="M${f(c.far[0])} ${f(c.far[1])}L${f(c.x)} ${f(c.y)}"/>` +
      `<path class="ar-stub" d="M${sx} ${sy}L${f(c.x - c.ux * 0.6)} ${f(c.y - c.uy * 0.6)}"/><circle class="ar-via" cx="${sx}" cy="${sy}" r=".055"/>`;
  }).join('');
  const t = document.createElement('template');
  t.innerHTML = `
<div class="ar-bar">
  <button type="button" class="ctl ctl--primary ar-go" data-a="solve">Solve</button>
  <button type="button" class="ctl" data-a="step">Step</button>
  <button type="button" class="ctl" data-a="all">All</button>
  <button type="button" class="ctl" data-a="reset">Reset</button>
  <button type="button" class="ctl" data-a="clear">Clear</button>
  <div class="ar-speed"><span class="label" id="${id}-sp">Speed</span><div class="switch" role="radiogroup" aria-labelledby="${id}-sp">${
    SPEEDS.map(([s], k) => `<button type="button" role="radio" data-k="${k}" aria-checked="${k === 1}" tabindex="${k === 1 ? 0 : -1}">${s}</button>`).join('')}</div></div>
</div>
<div class="ar-main">
  <div class="ar-stage">
    <div class="ar-board" role="group" aria-label="Board: 19 cells in rows of 3, 4, 5, 4 and 3" aria-describedby="${id}-ln" style="aspect-ratio:${f(W)}/${f(H)};--s:${f(100 / W)}cqw">
      <svg class="ar-traces" viewBox="${f(X0)} ${f(Y0)} ${f(W)} ${f(H)}" aria-hidden="true" focusable="false">${traces}</svg>
      ${CELLS.map((c, i) => `<button type="button" class="ar-cell" data-i="${i}" tabindex="${i ? -1 : 0}" style="${box(...P[i], CW, CH)}"><svg viewBox="0 0 86.6 100" aria-hidden="true" focusable="false"><polygon points="${HEX}"/></svg><span></span></button>`).join('')}
      ${chip.map((c, j) => `<span class="ar-sum" data-l="${j}" aria-hidden="true" style="${box(c.x, c.y, SW, SH)}">—</span>`).join('')}
    </div>
    <p class="sr-only" id="${id}-ln"></p>
  </div>
  <div class="ar-side">
    <div class="ar-ro readouts">${['Nodes', 'Backtracks', 'Depth', 'Time'].map(l => `<div class="readout"><span class="label">${l}</span><b class="num">0</b></div>`).join('')}</div>
    <div class="ar-pad" role="group" aria-label="Number pad: enter a value in the selected cell">${
      Array.from({ length: N }, (_, k) => `<button type="button" class="ar-key" data-v="${k + 1}">${k + 1}</button>`).join('')}<button type="button" class="ar-key ar-key--del" data-v="0" aria-label="Erase cell">DEL</button></div>
    <div class="ar-sols">
      <div class="ar-sols__row">
        <button type="button" class="ctl" data-a="prev" aria-label="Previous solution" disabled>${tri('M7.5 1.5 2.5 5l5 3.5z')}</button>
        <div class="readout"><span class="label">Solutions</span><b class="num ar-sols__n">—</b></div>
        <button type="button" class="ctl" data-a="next" aria-label="Next solution" disabled>${tri('M2.5 1.5 7.5 5l-5 3.5z')}</button>
      </div>
      <p class="ar-sols__sum num">Not counted yet.</p>
      <p class="ar-sols__note">${NOTE0}</p>
    </div>
  </div>
</div>
<div class="ar-foot"><span class="led led--off"></span><p class="ar-status" role="status" aria-live="polite"></p></div>
<p class="label ar-cap">Backtracking search, re-created in JavaScript. Runs in your browser.</p>`;
  root.replaceChildren(t.content);

  const $ = s => root.querySelector(s), $$ = s => [...root.querySelectorAll(s)];
  const board = $('.ar-board'), cells = $$('.ar-cell'), sums = $$('.ar-sum'), rails = $$('.ar-rail'), stubs = $$('.ar-stub');
  const keys = $$('.ar-key'), ro = $$('.ar-ro b'), radios = $$('[role=radio]'), statusEl = $('.ar-status'), led = $('.ar-foot .led');
  const solN = $('.ar-sols__n'), solSum = $('.ar-sols__sum'), solNote = $('.ar-sols__note'), lnEl = root.querySelector(`[id="${id}-ln"]`);
  const btn = Object.fromEntries($$('[data-a]').map(b => [b.dataset.a, b]));
  const attr = (el, k, v) => { if (el.getAttribute(k) !== v) el.setAttribute(k, v); };
  const text = (el, v) => { if (el.textContent !== v) el.textContent = v; };

  const vals = new Int8Array(N), src = new Uint8Array(N), shown = new Int8Array(N), popAt = new Float64Array(N);
  let S = null, G = null, last = 0, running = false, speed = 1, sel = -1, hl = -1, tms = 0, stat = [0, 0, 0];
  let sols = null, si = 0, counting = false, cTimer = 0, popTimer = 0, sayTimer = 0, lastSay = -1e4, pending = '';
  let raf = 0, lastT = 0, acc = 0, onScreen = true, typed = 0, typedAt = 0;

  // aria-live status, at most one update per second (the latest message wins)
  function say(m) {
    pending = m;
    if (!sayTimer) sayTimer = setTimeout(() => { sayTimer = 0; lastSay = performance.now(); text(statusEl, pending); }, Math.max(0, lastSay + 1000 - performance.now()));
  }

  function render(now = performance.now()) {
    const d = S ? S.val : vals, cnt = new Uint8Array(N + 1), cur = S && last === 1 ? S.cell : -1;
    if (S) stat = [S.nodes, S.backtracks, tms];
    for (const v of d) cnt[v]++;
    let filled = 0, full = 0, good = 0, popping = false;
    for (let i = 0; i < N; i++) {
      const v = d[i], b = cells[i];
      if (v) filled++;
      else if (S && shown[i] && !reducedMotion) popAt[i] = now + FLASH[speed];
      shown[i] = v;
      let st = v ? (!S && cnt[v] > 1 ? 'bad' : S || src[i] ? 'set' : 'user') : popAt[i] > now ? 'pop' : '', tx = v ? String(v) : '';
      if (i === cur) { st = S.ok ? 'try' : 'bad'; tx = String(S.value); }
      popping ||= st === 'pop';
      attr(b, 'data-s', st); text(b.lastChild, tx);
      attr(b, 'aria-label', `Row ${CELLS[i].row}, cell ${CELLS[i].col}: ${v || 'empty'}`);
      b.classList.toggle('is-hl', hl >= 0 && LINES[hl].includes(i));
      b.classList.toggle('is-sel', i === sel);
    }
    for (let j = 0; j < 15; j++) {
      let sum = 0, done = true;
      for (const i of LINES[j]) { if (!d[i]) done = false; sum += d[i]; }
      let k = done ? (sum === TARGET ? 'ok' : 'bad') : '', tx = done ? String(sum) : '—';
      if (done) { full++; if (k === 'ok') good++; }
      if (cur >= 0 && !S.ok && S.line === j) { k = 'bad'; tx = S.why === 'sum' ? String(S.need) : '—'; }
      attr(sums[j], 'class', 'ar-sum' + (k && ' is-' + k) + (hl === j ? ' is-hl' : ''));
      text(sums[j], tx);
      attr(stubs[j], 'class', 'ar-stub' + (k && ' is-' + k));
      rails[j].classList.toggle('is-hl', hl === j);
    }
    const solved = filled === N && good === 15 && cnt.every((n, v) => !v || n === 1);
    root.classList.toggle('is-solved', solved);
    text(ro[0], fmt(stat[0])); text(ro[1], fmt(stat[1])); text(ro[2], String(filled)); text(ro[3], fmtT(stat[2]));
    ro[0].parentNode.classList.toggle('readout--signal', running || counting);
    keys.forEach((k, n) => k.classList.toggle('is-used', n < N && cnt[n + 1] > 0));
    text(btn.solve, running ? 'Pause' : S && last === 2 ? 'Next' : 'Solve');
    btn.prev.disabled = btn.next.disabled = !sols;
    led.className = 'led' + (running || counting || solved ? '' : ' led--off');
    text(lnEl, `${full} of 15 lines complete, ${good} summing to 38.`);
    if (popping && !running) { clearTimeout(popTimer); popTimer = setTimeout(render, FLASH[speed] + 20); }
  }

  function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
  function newSearch() { S = newState(); G = search(S); last = 0; tms = 0; }
  function toPlay() { // hand the board over from the solver to the player
    if (!S) return;
    stop(); vals.set(S.val); vals.forEach((v, i) => (src[i] = v ? 1 : 0));
    S = G = null; last = 0;
  }
  function advance() {
    const r = G.next();
    if (r.done) { last = 0; running = false; say(`Search complete: ${S.solutions} solutions in ${fmt(S.nodes)} nodes.`); return true; }
    last = r.value;
    if (last === 2) { running = false; say(`Solved after ${fmt(S.nodes)} nodes.`); return true; }
    return false;
  }
  function narrate() {
    if (last !== 1) return;
    const n = S.line >= 0 && NAMES[S.line], w = `${S.value} at ${where(S.cell)}`;
    say(S.ok ? `Trying ${w}.`
      : S.why === 'used' ? `${w}: ${n} would need ${S.need}, already used.`
      : S.why === 'range' ? `${w}: ${n} would need ${S.need}, out of range.`
      : S.why === 'sum' ? `${w}: ${n} would sum to ${S.need}.`
      : `${w}: ${n} could no longer reach 38.`);
  }

  function tick(t) {
    raf = 0;
    if (!running || !onScreen || document.hidden) return;
    const dt = lastT ? Math.min(t - lastT, 100) : 0, rate = SPEEDS[speed][1], t0 = performance.now();
    lastT = t; tms += dt;
    let n = 600;
    if (rate) { acc += dt * rate / 1000; n = acc | 0; acc -= n; }
    for (let i = 0; i < n && running; i++) {
      if (advance()) break;
      if (!rate && !(i & 63) && performance.now() - t0 > 8) break;
    }
    if (n && !speed) narrate();
    render(t);
    if (running) raf = requestAnimationFrame(tick);
  }
  function kick() { if (running && onScreen && !document.hidden && !raf) { lastT = 0; raf = requestAnimationFrame(tick); } }

  function solve() {
    if (counting) return;
    if (running) { stop(); say(`Paused after ${fmt(S.nodes)} nodes.`); render(); return; }
    if (!S || S.done) newSearch();
    if (reducedMotion) { // no animation: jump straight to the next solution
      const t0 = performance.now();
      while (!advance());
      tms += performance.now() - t0; render(); return;
    }
    running = true; acc = 1;
    if (speed) say('Searching…');
    kick(); render();
  }
  function step() {
    if (counting) return;
    stop();
    if (!S || S.done) newSearch();
    const t0 = performance.now();
    advance(); tms += performance.now() - t0;
    narrate(); render();
  }
  function countAll() {
    if (counting) return;
    stop(); S = G = null; last = 0; counting = true;
    const s = newState(), g = search(s), found = [];
    let ms = 0;
    say('Counting every solution…'); render();
    const slice = () => { // ~12 ms of work per task, so the page stays responsive
      cTimer = 0;
      const t0 = performance.now();
      let r;
      for (let i = 1; !(r = g.next()).done; i++) {
        if (r.value === 2) found.push(Int8Array.from(s.val));
        if (!(i & 2047) && performance.now() - t0 > 12) break;
      }
      ms += performance.now() - t0; stat = [s.nodes, s.backtracks, ms];
      if (!r.done) { render(); cTimer = setTimeout(slice, 0); return; }
      counting = false; sols = found;
      // the L2 readout (assets/js/readouts.js) shows the visitor's own run; ms is compute time only
      root.dispatchEvent(new CustomEvent('aristotle:solved', { bubbles: true, detail: { all: true, solutions: found.length, nodes: s.nodes, backtracks: s.backtracks, ms } }));
      text(solSum, `${fmt(s.nodes)} nodes in ${fmtT(ms)}`);
      text(solNote, `All ${found.length} are rotations and reflections of one another.`);
      say(`${found.length} solutions, ${fmt(s.nodes)} nodes in ${fmtT(ms)}`);
      load(0);
    };
    cTimer = setTimeout(slice, 0);
  }
  function load(k) {
    stop(); S = G = null; last = 0;
    si = (k + sols.length) % sols.length;
    vals.set(sols[si]); src.fill(1); shown.fill(0);
    text(solN, `${si + 1} / ${sols.length}`);
    render();
  }
  function clearBoard(msg) {
    stop(); S = G = null; last = 0;
    vals.fill(0); src.fill(0); shown.fill(0); popAt.fill(0);
    say(msg); render();
  }
  function reset() {
    clearTimeout(cTimer); counting = false; sols = null; tms = 0; stat = [0, 0, 0];
    text(solN, '—'); text(solSum, 'Not counted yet.'); text(solNote, NOTE0);
    clearBoard('Reset.');
  }
  function enter(i, v) {
    if (counting) return;
    toPlay();
    vals[i] = v; src[i] = 0;
    let m = v ? `${v} at ${where(i)}.` : `Cleared ${where(i)}.`;
    if (v && vals.some((x, j) => x === v && j !== i)) m = `${v} is already on the board.`;
    else if (v) for (const L of CELL_LINES[i]) {
      if (!LINES[L].every(c => vals[c])) continue;
      const t = LINES[L].reduce((a, c) => a + vals[c], 0);
      m = `${NAMES[L]} sums to ${t}.`;
      if (t !== TARGET) break;
    }
    render();
    say(root.classList.contains('is-solved') ? 'Solved by hand: all 15 lines sum to 38.' : m);
  }
  function select(i, focus) {
    if (i !== sel) typed = 0;
    sel = i;
    cells.forEach((b, j) => (b.tabIndex = j === Math.max(i, 0) ? 0 : -1));
    if (focus && i >= 0) cells[i].focus();
    render();
  }
  function setSpeed(k, focus) {
    speed = (k + 3) % 3; acc = Math.min(acc, 1);
    radios.forEach((r, j) => { r.setAttribute('aria-checked', j === speed); r.tabIndex = j === speed ? 0 : -1; });
    if (focus) radios[speed].focus();
  }

  root.addEventListener('click', e => {
    const a = e.target.closest('[data-a]'), c = e.target.closest('.ar-cell'), k = e.target.closest('.ar-key'), r = e.target.closest('[role=radio]');
    if (a && !a.disabled) ({ solve, step, all: countAll, reset, clear: () => clearBoard('Board cleared.'), prev: () => load(si - 1), next: () => load(si + 1) })[a.dataset.a]();
    else if (c) select(+c.dataset.i, true);
    else if (r) setSpeed(+r.dataset.k);
    else if (k) {
      let i = sel;
      if (i < 0) { i = (S ? S.val : vals).findIndex(v => !v); if (i < 0) i = 0; select(i); }
      enter(i, +k.dataset.v);
    }
  });
  board.addEventListener('keydown', e => {
    const b = e.target.closest('.ar-cell');
    if (!b || e.altKey || e.ctrlKey || e.metaKey) return;
    const i = +b.dataset.i, { q, r } = CELLS[i], key = e.key;
    let to = -1;
    if (key === 'ArrowLeft') to = at(q - 1, r);
    else if (key === 'ArrowRight') to = at(q + 1, r);
    else if (key === 'ArrowUp') to = at(q, r - 1) >= 0 ? at(q, r - 1) : at(q + 1, r - 1);
    else if (key === 'ArrowDown') to = at(q, r + 1) >= 0 ? at(q, r + 1) : at(q - 1, r + 1);
    else if (/^\d$/.test(key)) { // "1" then "5" within 0.9 s makes 15
      const now = performance.now(), two = typed * 10 + +key;
      if (typed && now - typedAt < 900 && two <= N) { enter(i, two); typed = 0; }
      else if (+key) { enter(i, +key); typed = key === '1' ? 1 : 0; typedAt = now; }
    }
    else if (key === 'Backspace' || key === 'Delete') enter(i, 0);
    else if (key === 'Escape') select(-1);
    else return;
    e.preventDefault();
    if (to >= 0) { typed = 0; select(to, true); }
  });
  root.querySelector('.switch').addEventListener('keydown', e => {
    const d = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (d) { e.preventDefault(); setSpeed(speed + d, true); }
  });
  board.addEventListener('pointerover', e => {
    const c = e.target.closest('.ar-sum'), j = c ? +c.dataset.l : -1;
    if (j !== hl) { hl = j; render(); }
  });
  board.addEventListener('pointerleave', () => { if (hl >= 0) { hl = -1; render(); } });

  const io = new IntersectionObserver(es => { onScreen = es[es.length - 1].isIntersecting; kick(); });
  io.observe(root);
  document.addEventListener('visibilitychange', kick);

  render();
  text(statusEl, 'Pick a cell and type 1–19, or press Solve.');

  return {
    destroy() {
      stop(); counting = false;
      clearTimeout(cTimer); clearTimeout(popTimer); clearTimeout(sayTimer);
      io.disconnect(); document.removeEventListener('visibilitychange', kick);
      root.replaceChildren(); root.classList.remove('demo--aristotle', 'is-solved');
    },
  };
}
