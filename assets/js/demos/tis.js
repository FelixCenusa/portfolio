// TIS-100-style node. The interpreter (parse / init / step / run / verdict) is pure and
// touches no DOM, so it can be imported and tested in node. mount() builds the UI.

const OPS = { NOP: 0, MOV: 2, SWP: 0, SAV: 0, ADD: 1, SUB: 1, NEG: 0, JMP: 1, JEZ: 1, JNZ: 1, JGZ: 1, JLZ: 1, JRO: 1 };
const JUMPS = new Set(['JMP', 'JEZ', 'JNZ', 'JGZ', 'JLZ']);
const PORTS = new Set(['ACC', 'NIL', 'UP', 'DOWN', 'ANY', 'LAST']);
export const MAX_LINES = 15;
export const MAX_CYCLES = 9999;
const clamp = v => Math.max(-999, Math.min(999, v));

function operand(tok, isDst) {
  if (/^-?\d+$/.test(tok)) {
    if (isDst) return { err: `${tok} IS NOT A DESTINATION` };
    const v = Number(tok);
    return v < -999 || v > 999 ? { err: `${tok} IS OUT OF RANGE` } : { v };
  }
  if (PORTS.has(tok)) return { r: tok };
  if (tok === 'LEFT' || tok === 'RIGHT') return { err: `NO NODE TO THE ${tok}` };
  return { err: `INVALID OPERAND ${tok}` };
}

/** Parse source into instructions. Line numbers in errors are 0-based. */
export function parse(src) {
  const lines = String(src).replace(/\r/g, '').split('\n');
  const code = [], labels = new Map(), errors = [];
  let pending = [];
  if (lines.length > MAX_LINES) errors.push({ line: MAX_LINES, msg: `TOO MANY LINES (MAX ${MAX_LINES})` });
  lines.forEach((raw, line) => {
    let s = raw.replace(/#.*/, '').toUpperCase().trim().replace(/^!\s*/, '');
    const m = /^([A-Z0-9_]+)\s*:(.*)$/.exec(s);
    if (m) {
      if (labels.has(m[1])) errors.push({ line, msg: `LABEL ${m[1]} IS ALREADY DEFINED` });
      else { labels.set(m[1], 0); pending.push(m[1]); }
      s = m[2].trim();
    }
    if (!s) return;
    const [op, ...args] = s.split(/[\s,]+/).filter(Boolean);
    if (!(op in OPS)) return errors.push({ line, msg: `INVALID OPCODE ${op}` });
    const n = OPS[op];
    if (args.length !== n) return errors.push({ line, msg: `${op} TAKES ${n} OPERAND${n === 1 ? '' : 'S'}` });
    const ins = { op, line };
    if (JUMPS.has(op)) ins.label = args[0];
    else for (let i = 0; i < n; i++) {
      const o = operand(args[i], op === 'MOV' && i === 1);
      if (o.err) return errors.push({ line, msg: o.err });
      ins[i ? 'b' : 'a'] = o;
    }
    for (const l of pending) labels.set(l, code.length);
    pending = [];
    code.push(ins);
  });
  // a label after the last instruction wraps to the first, like the game
  for (const l of pending) labels.set(l, 0);
  for (const ins of code) {
    if (ins.label === undefined) continue;
    if (labels.has(ins.label)) ins.to = labels.get(ins.label);
    else errors.push({ line: ins.line, msg: `UNDEFINED LABEL ${ins.label}` });
  }
  errors.sort((x, y) => x.line - y.line);
  return { code, errors, lines };
}

export function init() {
  return { acc: 0, bak: 0, pc: 0, cur: -1, last: null, mode: 'IDLE', inPtr: 0, out: [], cycles: 0, io: null, halt: null };
}

/** Execute one cycle. Returns a new state; `prev` is not modified. */
export function step(code, prev, input) {
  const s = { ...prev, out: prev.out.slice(), io: null, mode: 'RUN' };
  if (!code.length) return { ...s, mode: 'IDLE', halt: 'EMPTY' };
  const ins = code[s.pc];
  s.cur = s.pc;
  s.cycles++;
  let blocked = null;
  const read = o => {
    if (o.r === undefined) return o.v;
    let r = o.r;
    if (r === 'ACC') return s.acc;
    if (r === 'NIL') return 0;
    if (r === 'LAST') { if (!s.last) return 0; r = s.last; }
    if (r === 'ANY') r = 'UP';
    if (r === 'UP' && s.inPtr < input.length) {
      if (o.r === 'ANY') s.last = 'UP';
      const v = input[s.inPtr++];
      s.mode = 'READ';
      s.io = { port: 'UP', v };
      return v;
    }
    blocked = 'READ'; // nothing left upstream, or reading the output port: waits forever
    return 0;
  };
  const write = (o, v) => {
    let r = o.r;
    if (r === 'ACC') { s.acc = v; return; }
    if (r === 'NIL') return;
    if (r === 'LAST') { if (!s.last) return; r = s.last; }
    if (r === 'ANY') { r = 'DOWN'; s.last = 'DOWN'; }
    if (r === 'DOWN') { s.out.push(v); s.mode = 'WRTE'; s.io = { port: 'DOWN', v }; return; }
    blocked = 'WRTE';
  };
  let next = s.pc + 1;
  switch (ins.op) {
    case 'MOV': { const v = read(ins.a); if (!blocked) write(ins.b, v); break; }
    case 'ADD': { const v = read(ins.a); if (!blocked) s.acc = clamp(s.acc + v); break; }
    case 'SUB': { const v = read(ins.a); if (!blocked) s.acc = clamp(s.acc - v); break; }
    case 'NEG': s.acc = -s.acc || 0; break;
    case 'SAV': s.bak = s.acc; break;
    case 'SWP': [s.acc, s.bak] = [s.bak, s.acc]; break;
    case 'JMP': next = ins.to; break;
    case 'JEZ': if (s.acc === 0) next = ins.to; break;
    case 'JNZ': if (s.acc !== 0) next = ins.to; break;
    case 'JGZ': if (s.acc > 0) next = ins.to; break;
    case 'JLZ': if (s.acc < 0) next = ins.to; break;
    case 'JRO': { const v = read(ins.a); if (!blocked) next = Math.max(0, Math.min(code.length - 1, s.pc + v)); break; }
    default: break; // NOP
  }
  if (blocked) return { ...s, mode: blocked, halt: 'STALL' };
  s.pc = next % code.length;
  return s;
}

export const verdict = (out, exp) => (out.length === exp.length && out.every((v, i) => v === exp[i]) ? 'OK' : 'FAIL');

/** Run until the output is complete, the node stalls, or the cycle limit. */
export function run(code, input, expected, max = MAX_CYCLES) {
  let s = init();
  while (s.out.length < expected.length && !s.halt && s.cycles < max) s = step(code, s, input);
  return { state: s, verdict: verdict(s.out, expected) };
}

const preset = (task, src, input, f) => ({ task, src: src.join('\n'), input, expected: input.map(f) });
export const PRESETS = {
  AMPLIFY: preset('Read a value from IN, write it doubled to OUT',
    ['# OUT = IN x 2', 'MOV UP, ACC', 'ADD ACC', 'MOV ACC, DOWN'],
    [12, -7, 31, 0, 45, -18, 9, 64], x => clamp(x * 2)),
  SIGN: preset('Write 1 if IN > 0, 0 if IN = 0, -1 if IN < 0',
    ['# OUT = SIGN(IN)', 'S: MOV UP, ACC', 'JGZ GT', 'JLZ LT', 'MOV 0, DOWN', 'JMP S', 'GT: MOV 1, DOWN', 'JMP S', 'LT: MOV -1, DOWN'],
    [34, -12, 0, 7, -55, 0, 81, -3], x => Math.sign(x)),
  ABS: preset('Write the absolute value of IN to OUT',
    ['# OUT = |IN|', 'MOV UP, ACC', 'JGZ W', 'NEG', 'W: MOV ACC, DOWN'],
    [-23, 41, 0, -7, 88, -150, 12, -1], x => Math.abs(x)),
};

/* ------------------------------------------------------------------ UI */

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat().filter(c => c != null));
  return el;
}

const arrow = () => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 10 10');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<path d="M5 1v7M2 5.5 5 8.5 8 5.5" fill="none" stroke="currentColor" stroke-width="1.3"/>';
  return s;
};

function highlight(line) {
  const out = [];
  const ci = line.indexOf('#');
  let code = ci < 0 ? line : line.slice(0, ci);
  const m = /^(\s*!?\s*[A-Za-z0-9_]+\s*:)(.*)$/.exec(code);
  if (m) { out.push(h('span', { class: 'tis__lbl', text: m[1] })); code = m[2]; }
  const o = /^(\s*)([A-Za-z]+)(.*)$/.exec(code);
  if (o) out.push(o[1], h('span', { class: 'tis__op', text: o[2] }), o[3]);
  else out.push(code);
  if (ci >= 0) out.push(h('span', { class: 'tis__com', text: line.slice(ci) }));
  return out;
}

export function mount(root, { reducedMotion = false } = {}) {
  root.classList.add('demo--tis');
  root.classList.toggle('is-rm', !!reducedMotion);
  const uid = 'tis-' + Math.random().toString(36).slice(2, 8);
  const sources = Object.fromEntries(Object.entries(PRESETS).map(([k, p]) => [k, p.src]));
  let key = 'AMPLIFY', prog = parse(sources[key]), st = init();
  let running = false, fast = false, editing = false, finished = null, timer = 0, onScreen = true;
  let sayAt = 0, sayTimer = 0, sayMsg = '';

  /* ---------- DOM */
  const presetBtns = Object.keys(PRESETS).map(k =>
    h('button', { type: 'button', role: 'radio', 'data-v': k, text: k, onclick: () => pick(k) }));
  const sw = h('div', { class: 'switch', role: 'radiogroup', 'aria-label': 'Puzzle' }, presetBtns);
  sw.addEventListener('keydown', e => {
    const i = presetBtns.indexOf(document.activeElement);
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (i < 0 || !d) return;
    e.preventDefault();
    const b = presetBtns[(i + d + presetBtns.length) % presetBtns.length];
    b.focus();
    pick(b.dataset.v);
  });
  const revertBtn = h('button', { type: 'button', class: 'ctl', text: 'REVERT', hidden: true, onclick: revert });
  const editBtn = h('button', { type: 'button', class: 'ctl', 'aria-pressed': 'false', text: 'EDIT', onclick: () => (editing ? leaveEdit() : enterEdit()) });
  const task = h('p', { class: 'tis__task' });

  const col = (name, aria) => {
    const list = h('ol', { class: 'tis__cells', 'aria-label': aria });
    return { el: h('div', { class: 'tis__col' }, h('span', { class: 'label', 'aria-hidden': 'true', text: name }), list), list };
  };
  const colIn = col('IN', 'Input stream'), colExp = col('EXP', 'Expected output'), colOut = col('OUT', 'Output stream');
  const streams = h('div', { class: 'tis__streams' }, colIn.el, colExp.el, colOut.el);

  const listing = h('ol', { class: 'tis__listing', 'aria-label': 'Program' });
  const errId = uid + '-err';
  const ta = h('textarea', {
    class: 'tis__edit', rows: MAX_LINES, wrap: 'off', spellcheck: 'false', autocomplete: 'off',
    autocapitalize: 'characters', 'aria-label': `Program source, up to ${MAX_LINES} lines`, 'aria-describedby': errId, hidden: true,
  });
  ta.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.isComposing && ta.value.split('\n').length >= MAX_LINES) e.preventDefault();
  });
  ta.addEventListener('input', () => { if (errs.childElementCount) showErrors([]); });

  const reg = (name, cls = '') => {
    const b = h('b', { class: 'num' });
    return { el: h('div', { class: 'readout ' + cls }, h('span', { class: 'label', text: name }), b), b };
  };
  const rAcc = reg('ACC'), rBak = reg('BAK'), rLast = reg('LAST'), rMode = reg('MODE');
  const regs = h('div', { class: 'tis__regs', 'aria-label': 'Registers', role: 'group' }, rAcc.el, rBak.el, rLast.el, rMode.el);
  const port = name => {
    const v = h('b', { class: 'num' });
    return { el: h('span', { class: 'tis__port tis__port--' + name.toLowerCase(), 'aria-hidden': 'true' }, arrow(), name, v), v };
  };
  const pUp = port('UP'), pDown = port('DOWN');
  const codeBox = h('div', { class: 'tis__code' }, listing, ta);
  const node = h('div', { class: 'tis__node' }, pUp.el, codeBox, regs, pDown.el);
  const errs = h('ul', { class: 'tis__errs', id: errId, hidden: true });

  const btn = (text, fn, extra = {}) => h('button', { type: 'button', class: 'ctl', text, onclick: fn, ...extra });
  const stepBtn = btn('STEP', doStep, { 'aria-label': 'Step one cycle' });
  const runBtn = btn('RUN', doRun);
  const fastBtn = btn('FAST', doFast, { 'aria-pressed': 'false' });
  const resetBtn = btn('RESET', () => { stop(); reset(); render(); say('Reset'); });
  (reducedMotion ? stepBtn : runBtn).classList.add('ctl--primary');
  const rCyc = reg('CYCLES'), rVer = reg('VERDICT');
  const live = h('div', { class: 'sr-only', 'aria-live': 'polite', role: 'status' });

  root.replaceChildren(
    h('div', { class: 'tis__top' }, sw, h('div', { class: 'ctl-row' }, revertBtn, editBtn)),
    task,
    h('div', { class: 'tis__board' }, streams, node),
    errs,
    h('div', { class: 'tis__bar' },
      h('div', { class: 'ctl-row', role: 'group', 'aria-label': 'Execution' }, stepBtn, runBtn, fastBtn, resetBtn),
      h('div', { class: 'readouts' }, rCyc.el, rVer.el)),
    h('p', { class: 'label tis__cap', text: 'A TIS-100-style node, re-created in JavaScript. Runs in your browser.' }),
    live,
  );

  /* ---------- rendering */
  function renderListing() {
    const lines = sources[key].replace(/\r/g, '').split('\n');
    listing.replaceChildren(...Array.from({ length: MAX_LINES }, (_, i) => h('li', { class: 'tis__ln' },
      h('span', { class: 'tis__no', 'aria-hidden': 'true', text: String(i + 1).padStart(2, '0') }),
      h('span', { class: 'tis__src' }, highlight(lines[i] || '')))));
  }
  function renderStreams() {
    const p = PRESETS[key];
    const cells = (list, vals) => list.replaceChildren(...vals.map(v => h('li', { class: 'num', text: v == null ? '' : String(v) })));
    cells(colIn.list, p.input);
    cells(colExp.list, p.expected);
    cells(colOut.list, p.expected.map(() => null));
  }
  function render() {
    const p = PRESETS[key];
    const started = st.cycles > 0;
    rAcc.b.textContent = st.acc;
    rBak.b.textContent = `(${st.bak})`;
    rLast.b.textContent = st.last || 'N/A';
    const stalled = !!finished && st.halt === 'STALL';
    rMode.b.textContent = started && (!finished || stalled) ? st.mode : 'IDLE';
    rMode.el.classList.toggle('readout--signal', started && !finished);
    rMode.el.classList.toggle('readout--fault', stalled);
    const execLine = started && !finished && st.cur >= 0 ? prog.code[st.cur]?.line : -1;
    [...listing.children].forEach((li, i) => {
      const on = i === execLine;
      li.classList.toggle('is-exec', on);
      if (on) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    [...colIn.list.children].forEach((li, i) => {
      li.classList.toggle('is-used', i < st.inPtr);
      li.classList.toggle('is-next', started && i === st.inPtr);
    });
    [...colOut.list.children].forEach((li, i) => {
      const v = st.out[i];
      li.textContent = v === undefined ? '' : String(v);
      li.classList.toggle('is-ok', v !== undefined && v === p.expected[i]);
      li.classList.toggle('is-bad', v !== undefined && v !== p.expected[i]);
    });
    for (const [pt, name] of [[pUp, 'UP'], [pDown, 'DOWN']]) {
      const hot = !finished && st.io?.port === name;
      pt.el.classList.toggle('is-live', hot);
      pt.v.textContent = hot ? String(st.io.v) : '';
    }
    rCyc.b.textContent = String(st.cycles).padStart(4, '0');
    rVer.b.textContent = finished || '—';
    rVer.el.classList.toggle('readout--signal', finished === 'OK');
    rVer.el.classList.toggle('readout--fault', finished === 'FAIL');
    runBtn.textContent = running ? 'STOP' : 'RUN';
    runBtn.setAttribute('aria-label', running ? 'Stop' : 'Run');
    fastBtn.setAttribute('aria-pressed', String(running && fast));
  }
  function renderChrome() {
    presetBtns.forEach(b => {
      const on = b.dataset.v === key;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    task.textContent = PRESETS[key].task;
    editBtn.setAttribute('aria-pressed', String(editing));
    editBtn.textContent = editing ? 'DONE' : 'EDIT';
    revertBtn.hidden = !editing;
    codeBox.classList.toggle('is-editing', editing);
    listing.setAttribute('aria-hidden', String(editing));
    ta.hidden = !editing;
  }
  function showErrors(list) {
    errs.replaceChildren(...list.map(e => h('li', null, h('span', { class: 'num', text: `LINE ${String(e.line + 1).padStart(2, '0')}` }), ' ', e.msg)));
    errs.hidden = !list.length;
  }

  /* ---------- status (throttled to one message per second) */
  function say(msg) {
    sayMsg = msg;
    const wait = sayAt + 1000 - Date.now();
    if (wait <= 0) flushSay();
    else if (!sayTimer) sayTimer = setTimeout(flushSay, wait);
  }
  function flushSay() { sayTimer = 0; sayAt = Date.now(); live.textContent = sayMsg; }

  /* ---------- execution */
  function schedule() {
    clearInterval(timer);
    timer = 0;
    if (running && onScreen && !document.hidden) timer = setInterval(advance, fast ? 30 : 170);
  }
  function stop() { running = false; schedule(); }
  function reset() { st = init(); finished = null; }
  function advance() {
    if (finished) return;
    const p = PRESETS[key];
    st = step(prog.code, st, p.input);
    if (st.out.length >= p.expected.length) {
      const v = verdict(st.out, p.expected);
      const wrong = st.out.filter((x, i) => x !== p.expected[i]).length;
      finish(v, v === 'OK' ? `Output complete: OK in ${st.cycles} cycles` : `Output complete: FAIL, ${wrong} of ${p.expected.length} values wrong`);
    } else if (st.halt) {
      finish('FAIL', st.halt === 'EMPTY' ? 'No instructions to run'
        : `Stalled after ${st.cycles} cycles waiting to ${st.mode === 'READ' ? 'read' : 'write'}, ${st.out.length} of ${p.expected.length} values written`);
    } else if (st.cycles >= MAX_CYCLES) {
      finish('FAIL', `Stopped after ${MAX_CYCLES} cycles without completing the output`);
    }
    render();
  }
  function finish(v, msg) { finished = v; stop(); say(msg); }
  function ready() {
    if (editing && !leaveEdit()) return false;
    if (finished) reset();
    return true;
  }
  function doStep() {
    if (!ready()) return;
    if (running) stop();
    advance();
    if (!finished) {
      const ins = prog.code[st.cur];
      say(ins ? `Cycle ${st.cycles}, line ${ins.line + 1}: ${ins.op}, ACC ${st.acc}` : '');
    }
  }
  function doRun() {
    if (running) { stop(); render(); say(`Stopped at cycle ${st.cycles}`); return; }
    if (!ready()) return;
    running = true;
    fast = false;
    advance();
    schedule();
    render();
  }
  function doFast() {
    if (running) fast = !fast;
    else {
      if (!ready()) return;
      running = true;
      fast = true;
      advance();
    }
    schedule();
    render();
  }

  /* ---------- presets and editor */
  function pick(k) {
    if (editing) sources[key] = ta.value;
    if (k === key) return;
    key = k;
    stop();
    reset();
    prog = parse(sources[key]);
    renderStreams();
    if (editing) { ta.value = sources[key]; showErrors([]); }
    else if (prog.errors.length) enterEdit(prog.errors);
    renderListing();
    renderChrome();
    render();
    say(`${k} loaded. ${PRESETS[k].task}.`);
  }
  function enterEdit(errors = []) {
    stop();
    reset();
    editing = true;
    ta.value = sources[key];
    showErrors(errors);
    renderChrome();
    render();
    ta.focus();
  }
  function leaveEdit() {
    const src = ta.value.replace(/\r/g, '');
    const p = parse(src);
    if (p.errors.length) {
      showErrors(p.errors);
      say(`${p.errors.length} parse error${p.errors.length > 1 ? 's' : ''}. ${p.errors[0].msg} on line ${p.errors[0].line + 1}`);
      ta.focus();
      return false;
    }
    sources[key] = src;
    prog = p;
    editing = false;
    showErrors([]);
    renderListing();
    renderChrome();
    render();
    return true;
  }
  function revert() {
    ta.value = PRESETS[key].src;
    showErrors([]);
    ta.focus();
    say('Program reverted');
  }

  /* ---------- visibility: only tick while on screen and the tab is visible */
  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; schedule(); })
    : null;
  io?.observe(root);
  const onVis = () => schedule();
  document.addEventListener('visibilitychange', onVis);

  renderStreams();
  renderListing();
  renderChrome();
  render();

  return {
    destroy() {
      running = false;
      clearInterval(timer);
      clearTimeout(sayTimer);
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      root.replaceChildren();
      root.classList.remove('demo--tis', 'is-rm');
    },
  };
}
