// Press-Ice, a web homage to a terminal typing trainer written in Python.
// A visually hidden <input> takes the keystrokes (so phones raise their keyboard);
// the target line is painted from the input's value on every `input` event.

export const LINES = {
  EASY: [
    'the sun is up and the day is long',
    'we can go out to see the sea',
    'put the red cup on the old shelf',
    'a cold wind came over the hill',
    'she sat by the fire and read a book',
  ],
  MEDIUM: [
    'practice makes your fingers remember where every key is',
    'a steady rhythm beats a fast start full of mistakes',
    'precision comes first and the speed will follow on its own',
    'the terminal waits patiently for your next keystroke',
  ],
  HARD: [
    'Precision > speed: 3 typos cost more than 0.5s saved!',
    'Set PORT=8080, then run it twice (just in case).',
    "Error #404 on line 12: expected ')' but got ';'.",
    'Meet at 19:45 by Gate 12, not Gate 21. Bring 2 IDs!',
  ],
};

// A small figlet-style font, four rows tall, just the letters the banner needs.
const FONT = {
  P: [' ___ ', '| _ \\', '|  _/', '|_|  '],
  R: [' ___ ', '| _ \\', '|   /', '|_|_\\'],
  E: [' ___ ', '| __|', '| _| ', '|___|'],
  S: [' ___ ', '/ __|', '\\__ \\', '|___/'],
  '-': ['    ', ' __ ', '|__|', '    '],
  I: [' ___ ', '|_ _|', ' | | ', '|___|'],
  C: ['  ___ ', ' / __|', '| (__ ', ' \\___|'],
};
export const banner = word => FONT.P.map((_, r) => [...word].map(ch => FONT[ch][r]).join(' ')).join('\n');

/** Words per minute (5 chars = 1 word) and keystroke accuracy, floored so 100% means no mistakes. */
export function score(target, typed, keys, good, ms) {
  let correct = 0;
  for (let i = 0; i < typed.length; i++) if (typed[i] === target[i]) correct++;
  return {
    wpm: ms > 0 ? Math.round(correct / 5 / (ms / 60000)) : 0,
    acc: keys ? Math.floor((100 * good) / keys) : 100,
  };
}

/** Group mistakes [expected, typed] into [{exp, got, n}], most frequent first. */
export function tally(mistakes) {
  const m = new Map();
  for (const [exp, got] of mistakes) {
    const k = exp + '\u0000' + got;
    const e = m.get(k) || { exp, got, n: 0 };
    e.n++;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.n - a.n);
}

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

const STORE = 'press-ice:best';
const show = ch => (ch === ' ' ? '␣' : ch);
const secs = ms => (ms / 1000).toFixed(1) + 's';

export function mount(root, { reducedMotion = false } = {}) {
  root.classList.add('demo--typing');
  root.classList.toggle('is-rm', !!reducedMotion);
  const uid = 'typ-' + Math.random().toString(36).slice(2, 8);
  const levels = Object.keys(LINES);
  const idx = Object.fromEntries(levels.map(l => [l, 0]));
  let best = {};
  try { best = JSON.parse(localStorage.getItem(STORE)) || {}; } catch { best = {}; }
  let level = 'EASY', target = '', typed = '', keys = 0, good = 0, mistakes = [];
  let t0 = 0, tEnd = 0, tLast = 0, done = false, focused = false;
  let ticker = 0, typingT = 0, onScreen = true, chars = [];
  let sayAt = 0, sayTimer = 0, sayMsg = '';

  /* ---------- DOM */
  const levelBtns = levels.map(l => h('button', { type: 'button', role: 'radio', 'data-v': l, text: l, onclick: () => setLevel(l) }));
  const sw = h('div', { class: 'switch', role: 'radiogroup', 'aria-label': 'Difficulty' }, levelBtns);
  sw.addEventListener('keydown', e => {
    const i = levelBtns.indexOf(document.activeElement);
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (i < 0 || !d) return;
    e.preventDefault();
    const b = levelBtns[(i + d + levelBtns.length) % levelBtns.length];
    b.focus();
    setLevel(b.dataset.v);
  });
  const readout = name => {
    const b = h('b', { class: 'num', text: '—' });
    return { el: h('div', { class: 'readout' }, h('span', { class: 'label', text: name }), b), b };
  };
  const rBest = readout('HIGH SCORE');
  rBest.el.classList.add('readout--accent', 'typ__best');

  const mode = h('span', { class: 'label' });
  const lineNo = h('span', { class: 'label' });
  const targetEl = h('div', { class: 'typ__target', 'aria-hidden': 'true' });
  const srTarget = h('span', { class: 'sr-only', id: uid + '-t' });
  const input = h('input', {
    class: 'typ__input', type: 'text', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off',
    spellcheck: 'false', enterkeyhint: 'next', 'aria-label': 'Typing input', 'aria-describedby': uid + '-t',
  });
  const hint = h('p', { class: 'label typ__hint', 'aria-hidden': 'true' });
  const term = h('div', { class: 'typ__term' },
    h('pre', { class: 'typ__banner', 'aria-hidden': 'true', text: banner('PRESS-ICE') }),
    h('span', { class: 'sr-only', text: 'Press-Ice' }),
    h('div', { class: 'typ__mode' }, mode, lineNo),
    h('div', { class: 'typ__line' }, h('span', { class: 'typ__prompt', 'aria-hidden': 'true', text: '>' }), targetEl),
    srTarget, input, hint);

  const rWpm = readout('WPM'), rAcc = readout('ACCURACY'), rTime = readout('TIME');
  const again = h('button', { type: 'button', class: 'ctl', text: 'AGAIN', onclick: () => { load(); input.focus(); } });
  const next = h('button', { type: 'button', class: 'ctl ctl--primary', text: 'NEXT', onclick: nextLine });
  const missList = h('ul', { class: 'typ__misslist' });
  const live = h('div', { class: 'sr-only', 'aria-live': 'polite', role: 'status' });

  root.replaceChildren(
    h('div', { class: 'typ__top' }, sw, rBest.el),
    term,
    h('div', { class: 'typ__bar' },
      h('div', { class: 'readouts' }, rWpm.el, rAcc.el, rTime.el),
      h('div', { class: 'ctl-row' }, again, next)),
    h('div', { class: 'typ__miss' }, h('span', { class: 'label', text: 'MISTAKES' }), missList),
    h('p', { class: 'label typ__cap', text: 'A web re-creation of the terminal game. Runs in your browser.' }),
    live,
  );

  /* ---------- input */
  term.addEventListener('mousedown', e => { if (e.target !== input && document.activeElement === input) e.preventDefault(); });
  term.addEventListener('click', () => input.focus());
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (/^(Arrow|Home|End|Page)/.test(e.key)) e.preventDefault();
    if (e.key === 'Enter') { e.preventDefault(); if (done) nextLine(); }
  });
  input.addEventListener('paste', e => e.preventDefault());
  input.addEventListener('drop', e => e.preventDefault());
  input.addEventListener('focus', () => { focused = true; paint(); });
  input.addEventListener('blur', () => { focused = false; paint(); });
  const toEnd = () => { const n = input.value.length; if (input.selectionStart !== n || input.selectionEnd !== n) input.setSelectionRange(n, n); };
  input.addEventListener('select', toEnd);
  input.addEventListener('keyup', toEnd);
  input.addEventListener('input', onInput);

  function onInput() {
    if (done) { input.value = typed; return; }
    let v = input.value.replace(/[\r\n]/g, '');
    if (v.length > target.length) v = v.slice(0, target.length);
    let p = 0;
    while (p < typed.length && p < v.length && typed[p] === v[p]) p++;
    const now = performance.now();
    for (let i = p; i < v.length; i++) {
      keys++;
      if (v[i] === target[i]) good++;
      else mistakes.push([target[i], v[i]]);
    }
    if (keys && !t0) t0 = now;
    tLast = now;
    typed = v;
    if (input.value !== v) input.value = v;
    root.classList.add('is-typing');
    clearTimeout(typingT);
    typingT = setTimeout(() => root.classList.remove('is-typing'), 600);
    if (typed.length === target.length) finish(now);
    else { paint(); paintStats(now); tick(); }
  }

  /* ---------- painting */
  function buildTarget() {
    chars = [];
    const words = target.split(' ');
    targetEl.replaceChildren(...words.flatMap((w, i) => {
      const word = h('span', { class: 'typ__w' }, [...w].map(ch => h('span', { class: 'typ__c', text: ch })));
      chars.push(...word.children);
      if (i === words.length - 1) return [word];
      const sp = h('span', { class: 'typ__c typ__sp', text: ' ' });
      chars.push(sp);
      return [word, sp];
    }));
    srTarget.textContent = 'Line to type: ' + target;
  }
  function paint() {
    chars.forEach((c, i) => {
      const t = i < typed.length;
      c.classList.toggle('is-ok', t && typed[i] === target[i]);
      c.classList.toggle('is-bad', t && typed[i] !== target[i]);
      c.classList.toggle('is-cur', !done && i === typed.length);
    });
    root.classList.toggle('is-focus', focused);
    root.classList.toggle('is-done', done);
    hint.textContent = done ? 'Line complete. Enter or NEXT for another'
      : !focused ? 'Click or tap here to type'
      : !t0 ? 'The timer starts on your first key'
      : 'Backspace fixes mistakes';
  }
  function paintStats(now) {
    const ms = t0 ? (done ? tEnd : now) - t0 : 0;
    const s = score(target, typed, keys, good, ms);
    rWpm.b.textContent = done || ms >= 2000 ? s.wpm : '—';
    rAcc.b.textContent = keys ? s.acc + '%' : '—';
    rTime.b.textContent = secs(ms);
    rTime.el.classList.toggle('readout--signal', !!t0 && !done);
    rAcc.el.classList.toggle('readout--signal', done && s.acc === 100);
    return s;
  }
  function paintBest() {
    const b = best[level];
    rBest.b.textContent = b ? `${b.wpm} WPM` : '—';
  }
  function paintMistakes() {
    if (!done) { missList.replaceChildren(h('li', { class: 'is-empty', text: 'Shown when you finish the line' })); return; }
    const all = tally(mistakes);
    if (!all.length) { missList.replaceChildren(h('li', { class: 'is-none', text: 'NONE' })); return; }
    const items = all.slice(0, 8).map(m => h('li', null,
      h('span', { class: 'sr-only', text: 'expected ' }), h('span', { class: 'typ__exp', text: show(m.exp) }),
      h('span', { class: 'typ__arr', 'aria-hidden': 'true', text: ' → ' }),
      h('span', { class: 'sr-only', text: ', typed ' }), h('span', { class: 'typ__got', text: show(m.got) }),
      m.n > 1 ? h('span', { class: 'typ__n', text: ` ×${m.n}` }) : null));
    if (all.length > 8) items.push(h('li', { class: 'is-empty', text: `+${all.length - 8} more` }));
    missList.replaceChildren(...items);
  }
  function paintChrome() {
    levelBtns.forEach(b => {
      const on = b.dataset.v === level;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    mode.textContent = 'Train ' + level.toLowerCase();
    lineNo.textContent = `Line ${idx[level] + 1}/${LINES[level].length}`;
    paintBest();
  }

  /* ---------- flow */
  function load() {
    stopTicker();
    target = LINES[level][idx[level]];
    typed = ''; keys = 0; good = 0; mistakes = []; t0 = 0; tEnd = 0; done = false;
    input.value = '';
    buildTarget();
    paintChrome();
    paint();
    paintStats(0);
    paintMistakes();
  }
  function setLevel(l) {
    if (l === level) return;
    level = l;
    load();
    say(`Train ${l.toLowerCase()}. ${target}`);
  }
  function nextLine() {
    idx[level] = (idx[level] + 1) % LINES[level].length;
    load();
    input.focus();
    say(`Next line: ${target}`);
  }
  function finish(now) {
    done = true;
    tEnd = now;
    stopTicker();
    paint();
    const s = paintStats(now);
    paintMistakes();
    const prev = best[level];
    const record = !prev || s.wpm > prev.wpm;
    if (record) {
      best[level] = { wpm: s.wpm, acc: s.acc };
      try { localStorage.setItem(STORE, JSON.stringify(best)); } catch { /* storage is optional */ }
      paintBest();
    }
    const n = mistakes.length;
    say(`${s.wpm} WPM, ${s.acc}% accuracy in ${secs(tEnd - t0)}. ${n ? n + ' mistake' + (n > 1 ? 's' : '') : 'No mistakes'}.${record ? ' New high score.' : ''}`);
  }

  /* ---------- live readouts: only while a line is in progress, on screen, visible and recently typed in */
  function tick() {
    if (ticker || done || !t0 || !onScreen || document.hidden) return;
    ticker = setInterval(() => {
      const now = performance.now();
      if (now - tLast > 8000) { stopTicker(); return; }
      paintStats(now);
    }, 200);
  }
  function stopTicker() { clearInterval(ticker); ticker = 0; }
  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; if (onScreen) tick(); else stopTicker(); })
    : null;
  io?.observe(root);
  const onVis = () => (document.hidden ? stopTicker() : tick());
  document.addEventListener('visibilitychange', onVis);

  /* ---------- status (throttled to one message per second) */
  function say(msg) {
    sayMsg = msg;
    const wait = sayAt + 1000 - Date.now();
    if (wait <= 0) flushSay();
    else if (!sayTimer) sayTimer = setTimeout(flushSay, wait);
  }
  function flushSay() { sayTimer = 0; sayAt = Date.now(); live.textContent = sayMsg; }

  load();

  return {
    destroy() {
      stopTicker();
      clearTimeout(typingT);
      clearTimeout(sayTimer);
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      root.replaceChildren();
      root.classList.remove('demo--typing', 'is-rm', 'is-focus', 'is-done', 'is-typing');
    },
  };
}
