// The lab: experiments that only show with ?lab=1, so they can be tried on the
// real page before deciding whether they stay. main.js imports this module when
// the lab is on; it loads its own stylesheet, puts a small panel in the
// bottom-left corner (each experiment with an on/off switch, remembered in
// localStorage) and adds its shell commands:
//
//   xy [p q | mark | x=… y=…]   the XY screen             sound on|off   play the XY figure
//   measure [on|off]            cursors with Δx and Δy     lab [leave]    list the experiments
//
// Every experiment is optional and fails quietly: on the projects page, the CV
// or the 404 page (no layers) the instrument bar simply stays away.

import { addCommand } from '../shell.js';
import { reducedMotion } from '../instrument.js';
import { ringCss } from '../ease.js';
import { store, h, closePalette, sections } from './util.js';
import { createBar } from './bar.js';
import { createPersist, persistAvailable } from './persist.js';
import { createXY } from './xy.js';
import { createMeasure } from './measure.js';
import { parseXY } from './xymath.js';

const CSS_URL = new URL('../../css/lab.css', import.meta.url).href;
const PANEL_KEY = 'lab:panel';

function loadCss() {
  return new Promise((done) => {
    if ([...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => l.href === CSS_URL)) { done(); return; }
    const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: CSS_URL });
    const t = setTimeout(done, 2500);
    link.addEventListener('load', () => { clearTimeout(t); done(); }, { once: true });
    link.addEventListener('error', () => { clearTimeout(t); done(); }, { once: true });
    document.head.append(link);
  });
}

// the same page with ?lab=0, which main.js reads as "leave the lab"
function leaveHref() {
  try {
    const u = new URL(location.href);
    u.searchParams.set('lab', '0');
    return u.pathname + u.search + u.hash;
  } catch { return '?lab=0'; }
}

const safe = (what, fn) => { try { return fn(); } catch (e) { console.warn(`lab: ${what} failed`, e); return undefined; } };

let started = null;
export function init() {
  if (!started) started = start().catch((e) => { console.warn('lab: could not start', e); });
  return started;
}

async function start() {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  html.classList.add('lab');
  await loadCss();

  const rows = {}; // the panel's switches, filled in below
  let ready = false; // sync() waits until the panel exists
  const bar = createBar();
  const persist = createPersist();
  const xy = createXY({ onChange: () => sync() });
  const measure = createMeasure({ onChange: () => sync() });

  const hasLayers = sections().length > 0;
  const canPersist = persistAvailable();

  /* ------------------------------------------------------------ experiments */
  // kind 'pref' is remembered; kind 'live' shows what is open right now
  const EXPERIMENTS = [
    {
      id: 'bar', kind: 'pref', key: 'lab:bar', def: true, name: 'Instrument bar',
      about: 'A status strip along the bottom: channels, the record map, trigger and Run/Stop, in place of the left rail.',
      unavailable: () => (hasLayers ? '' : 'Shows on the home page, where the layers are.'),
      apply: (on) => (on ? bar.enable() : bar.disable()),
      state: () => bar.on,
    },
    {
      id: 'persist', kind: 'pref', key: 'lab:persist', def: true, name: 'Pointer persistence',
      about: 'Where your pointer has been, graded in four steps of the channel colour.',
      unavailable: () => (canPersist ? '' : reducedMotion ? 'Off while your system asks for reduced motion.' : 'Needs a mouse or trackpad.'),
      apply: (on) => (on ? persist.enable() : persist.disable()),
      state: () => persist.on,
    },
    {
      id: 'xy', kind: 'live', name: 'XY mode',
      about: 'Lissajous figures and the mark, drawn in XY. Also xy 3 2 or xy mark in the shell.',
      unavailable: () => '',
      apply: (on) => (on ? xy.open() : xy.close()),
      state: () => xy.isOpen,
    },
    {
      id: 'sound', kind: 'pref', key: 'lab:sound', def: false, name: 'Sound',
      about: 'Plays the XY figure as stereo audio, left is x and right is y. Quiet, and only when you switch it on.',
      unavailable: () => (xy.soundSupported ? '' : 'This browser has no Web Audio.'),
      apply: (on) => xy.setSound(on), // the switch click is the opt-in that makes the AudioContext
      state: () => xy.soundWanted,
      remembers: true,
    },
    {
      id: 'measure', kind: 'live', name: 'Measure cursors',
      about: 'Two pairs of lines with Δx and Δy in pixels. Hold M, or type measure.',
      unavailable: () => '',
      apply: (on) => (on ? measure.show('sticky') : measure.hide()),
      state: () => measure.on,
    },
  ];
  const byId = Object.fromEntries(EXPERIMENTS.map((x) => [x.id, x]));

  // the remembered ones come back as they were (sound is only remembered: it waits for the XY screen)
  for (const x of EXPERIMENTS) {
    if (x.kind !== 'pref' || x.remembers || x.unavailable()) continue;
    if (store.flag(x.key, x.def)) safe(x.name, () => x.apply(true));
  }

  function set(id, on) {
    const x = byId[id];
    if (!x || x.unavailable()) return false;
    if (x.kind === 'pref') store.set(x.key, on ? '1' : '0');
    const r = safe(x.name, () => x.apply(on));
    sync();
    return r !== false;
  }

  /* ------------------------------------------------------------ the panel */
  const toggle = h('button', { type: 'button', class: 'lab-panel__toggle', 'aria-expanded': 'false', 'aria-controls': 'lab-panel-body' }, 'Lab');
  const list = h('ul', { class: 'lab-panel__list' });
  for (const x of EXPERIMENTS) {
    const nameId = `lab-x-${x.id}`, aboutId = `lab-x-${x.id}-about`;
    const sw = h('button', { type: 'button', class: 'lab-sw', role: 'switch', 'aria-checked': 'false', 'aria-labelledby': nameId, 'aria-describedby': aboutId },
      h('i', { class: 'lab-sw__knob', 'aria-hidden': 'true' }));
    sw.addEventListener('click', () => set(x.id, sw.getAttribute('aria-checked') !== 'true'));
    const about = h('p', { class: 'lab-panel__about', id: aboutId, text: x.about });
    const row = h('li', { class: 'lab-panel__row' }, h('span', { class: 'lab-panel__name', id: nameId, text: x.name }), sw, about);
    rows[x.id] = { sw, about, row };
    list.append(row);
  }
  const leave = h('a', { class: 'lab-panel__leave', href: leaveHref(), text: 'Leave the lab' });
  const hide = h('button', { type: 'button', class: 'lab-panel__hide', text: 'Hide' });
  const body = h('div', { class: 'lab-panel__body', id: 'lab-panel-body', hidden: true },
    h('div', { class: 'lab-panel__head' },
      h('p', { class: 'lab-panel__title', text: 'Lab' }),
      hide),
    h('p', { class: 'lab-panel__intro' }, 'Experiments that only show with ', h('code', { text: '?lab=1' }), '. Each switch is remembered on this browser.'),
    list,
    h('div', { class: 'lab-panel__foot' }, leave));
  const panel = h('aside', { class: 'lab-panel', 'aria-label': 'Lab experiments' }, toggle, body);
  try { panel.style.setProperty('--lab-ring', ringCss()); } catch {}

  const setOpen = (open, focus = false) => {
    body.hidden = !open;
    toggle.hidden = open;
    toggle.setAttribute('aria-expanded', String(open));
    panel.classList.toggle('is-open', open);
    store.set(PANEL_KEY, open ? 'open' : 'closed');
    if (focus) (open ? hide : toggle).focus();
  };
  toggle.addEventListener('click', () => setOpen(true, true));
  hide.addEventListener('click', () => setOpen(false, true));
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !body.hidden) { e.stopPropagation(); setOpen(false, true); } });
  document.body.append(panel);
  setOpen(store.get(PANEL_KEY, 'open') !== 'closed');

  function sync() {
    if (!ready) return;
    for (const x of EXPERIMENTS) {
      const r = rows[x.id];
      if (!r) continue;
      const why = x.unavailable();
      r.sw.disabled = !!why;
      r.sw.setAttribute('aria-checked', String(!why && !!x.state()));
      r.about.textContent = why || x.about;
      r.row.classList.toggle('is-off', !!why);
    }
  }
  ready = true;
  sync();

  /* ------------------------------------------------------------ shell */
  const words = (...w) => () => w.map((x) => [x]);

  addCommand('xy', {
    usage: 'xy [p q|mark]', about: 'Draw in XY: xy 3 2, xy mark, or xy x=sin(3*t) y=sin(2*t)', arg: true,
    words: words('3 2', '5 4', 'mark', 'off', 'x=sin(3*t) y=sin(2*t)'),
    plan(arg) {
      const p = parseXY(arg);
      if (p.err) return { err: p.err };
      const label = p.kind === 'off' ? 'Close the XY screen' : p.kind === 'open' ? 'Open the XY screen'
        : p.kind === 'mark' ? 'Draw the mark in XY' : p.kind === 'liss' ? `Draw a ${p.p}:${p.q} Lissajous figure` : `Draw x = ${p.xs}, y = ${p.ys}`;
      // the expression is compiled only here, on Enter, from what was typed
      return { label, action: { call: () => runXY(arg) } };
    },
  });
  function runXY(arg) {
    const p = parseXY(arg);
    if (p.kind === 'off') { xy.close(); return 'XY screen closed'; }
    const err = xy.check(p);
    if (err) return err;
    closePalette();
    const late = xy.open(p);
    return late || `Drawing ${xy.figure || 'in XY'}. Esc closes.`;
  }

  addCommand('sound', {
    usage: 'sound on|off', about: 'Play the XY figure as stereo audio, left x, right y', arg: true,
    words: words('on', 'off'),
    plan(arg) {
      const a = arg.trim().toLowerCase();
      if (!a) return { label: 'Is the sound on?', action: { call: () => (xy.soundWanted ? 'sound is on' : 'sound is off, sound on plays the XY figure') } };
      if (a !== 'on' && a !== 'off') return { err: 'sound: on or off' };
      return {
        label: a === 'on' ? 'Turn the sound on' : 'Turn the sound off',
        action: {
          call: () => {
            if (a === 'off') { set('sound', false); return 'Sound off'; }
            if (!xy.soundSupported) return 'sound: this browser has no Web Audio';
            set('sound', true);
            return xy.isOpen ? 'Sound on, quietly: left is x, right is y' : 'Sound on. It plays while the XY screen is open: try xy mark';
          },
        },
      };
    },
  });

  addCommand('measure', {
    usage: 'measure [off]', about: 'Cursors across the page, with Δx and Δy', arg: true,
    words: words('on', 'off'),
    plan(arg) {
      const a = arg.trim().toLowerCase();
      if (a && a !== 'on' && a !== 'off') return { err: 'measure: on or off' };
      const on = a ? a === 'on' : !measure.on;
      return {
        label: on ? 'Show the measure cursors' : 'Hide the measure cursors',
        action: { call: () => { if (on) { closePalette(); measure.show('sticky'); return 'Measure cursors on. Drag them; Esc closes'; } measure.hide(); return 'Measure cursors off'; } },
      };
    },
  });

  addCommand('lab', {
    usage: 'lab [leave]', about: 'List the lab experiments, or leave the lab', arg: true,
    words: words('leave', 'bar on', 'bar off', 'persistence on', 'persistence off'),
    plan(arg) {
      const a = arg.trim().toLowerCase();
      if (!a) {
        return {
          label: 'List the lab experiments',
          action: { call: () => EXPERIMENTS.map((x) => `${x.id.padEnd(9)}${(x.unavailable() ? 'n/a' : x.state() ? 'on' : 'off').padEnd(5)}${x.name}`) },
        };
      }
      if (a === 'leave' || a === 'off' || a === 'exit') return { label: 'Leave the lab', action: { call: () => { location.href = leaveHref(); return 'leaving the lab'; } } };
      const m = /^(bar|persist|persistence)\s+(on|off)$/.exec(a);
      if (m) {
        const id = m[1] === 'bar' ? 'bar' : 'persist', on = m[2] === 'on', x = byId[id];
        return {
          label: `${on ? 'Switch on' : 'Switch off'} ${x.name.toLowerCase()}`,
          action: { call: () => (x.unavailable() ? `lab: ${x.unavailable()}` : (set(id, on), `${x.name} ${on ? 'on' : 'off'}`)) },
        };
      }
      return { err: 'lab: try lab, lab leave or lab bar off' };
    },
  });
}

init();
