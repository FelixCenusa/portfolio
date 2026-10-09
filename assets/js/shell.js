// The command palette's little shell: parsing, completion and history for the
// handful of commands it knows. Everything here is pure, so it can be tested
// without a page. The palette hands in a context:
//   { page: 'home' | 'projects' | 'cv', here: 'l2' | null, email,
//     layers: [{ id: 'l4', name: 'Web', projects: [{ id, name, demo }] }] }   (top layer first)

export const VERBS = {
  help: { usage: 'help', about: 'List the commands' },
  ls: { usage: 'ls [layer]', about: 'List the layers and their projects', arg: true },
  cd: { usage: 'cd <layer>', about: 'Go to a layer: l4 to l0, web to metal, .. or /', arg: true },
  pwd: { usage: 'pwd', about: 'Print where you are' },
  open: { usage: 'open <name>', about: 'Go to a project', arg: true },
  run: { usage: 'run <demo>', about: 'Go to a live demo and focus it', arg: true },
  whoami: { usage: 'whoami', about: 'Who made this site' },
  mail: { usage: 'mail', about: 'Copy the email address' },
  cv: { usage: 'cv', about: 'Open the CV' },
  clear: { usage: 'clear', about: 'Clear the output' },
};
const ME = ['Felix Cenusa, software engineer in Sweden', 'Software Engineering at BTH'];

// Commands other modules add at runtime (the instrument's stop and run, the lab).
//   addCommand('stop', { usage: 'stop', about: 'Freeze every moving trace', arg: false,
//                        words: (ctx) => [['on'], ['off']],          // optional, for Tab
//                        plan: (arg, ctx) => ({ label, action }) or ({ err: 'stop: …' }) })
// The action is any action plan() can return (see below), or { call: fn }: the palette
// runs fn() and prints the lines it returns (a string or an array of strings).
const EXTRA = new Map();
export function addCommand(verb, spec) {
  VERBS[verb] = { usage: spec.usage, about: spec.about, arg: !!spec.arg };
  EXTRA.set(verb, spec);
}
const PAGES = ['projects', 'cv'];

export function score(q, text) {
  // subsequence match; rewards consecutive letters and word starts
  if (!q) return 1;
  const t = text.toLowerCase();
  let i = 0, s = 0, run = 0;
  for (const ch of q) {
    const j = t.indexOf(ch, i);
    if (j < 0) return 0;
    run = j === i ? run + 1 : 0;
    s += 1 + run * 2 + (j === 0 || t[j - 1] === ' ' ? 3 : 0);
    i = j + 1;
  }
  return s - t.length * 0.01;
}

// "cd l2" -> { verb: 'cd', arg: 'l2' }; null unless the first word is a command
export function split(input) {
  const m = /^\s*(\S+)\s*(.*?)\s*$/.exec(input);
  const verb = m && m[1].toLowerCase();
  return verb && Object.hasOwn(VERBS, verb) ? { verb, arg: m[2] } : null;
}

// the current position as a path ('/l1/systems') and as a prompt ('~/l1')
export function where({ page, here, layers }) {
  if (page !== 'home') return { path: `/${page}`, short: `~/${page}` };
  const l = layers.find((x) => x.id === here);
  return l ? { path: `/${l.id}/${l.name.toLowerCase()}`, short: `~/${l.id}` } : { path: '/', short: '~' };
}

const projectsOf = (ctx) => ctx.layers.flatMap((l) => l.projects);
const title = (l) => `${l.id.toUpperCase()} ${l.name}`;

// best fuzzy match of q over each item's keys, or null
function best(q, list, keys) {
  let top = null, s = 0;
  for (const x of list) {
    const v = Math.max(...keys(x).map((k) => score(q.toLowerCase(), k)));
    if (v > s) { s = v; top = x; }
  }
  return top;
}

// a layer by id ('l2', or just '2'), name ('algorithms') or an unambiguous start of one ('alg')
function findLayer(word, layers) {
  const w = /^\d$/.test(word) ? `l${word}` : word.toLowerCase();
  const hit = layers.find((l) => l.id === w || l.name.toLowerCase() === w);
  if (hit) return hit;
  const some = w.length > 1 ? layers.filter((l) => l.name.toLowerCase().startsWith(w)) : [];
  return some.length === 1 ? some[0] : null;
}

// where cd ends up: '' for the top, a layer id, a page name, or null if it's nowhere.
// The layers sit side by side under /, so '..' climbs one layer towards the surface.
export function resolveDir(arg, ctx) {
  const ids = ctx.layers.map((l) => l.id);
  let at = ctx.page === 'home' ? ctx.here || '' : ctx.page;
  const path = arg.trim().toLowerCase();
  if (!path || /^[~/]/.test(path)) at = '';
  for (const seg of path.replace(/^~/, '').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { const i = ids.indexOf(at); at = i > 0 ? ids[i - 1] : ''; continue; }
    if (PAGES.includes(seg)) { at = seg; continue; }
    const l = findLayer(seg, ctx.layers);
    if (!l) return null;
    at = l.id;
  }
  return at;
}

function listing(layers) {
  const w = Math.max(...layers.map((l) => l.name.length)) + 2;
  const lines = layers.map((l) => `${l.id} ${l.name.toLowerCase().padEnd(w)}${l.projects.map((x) => x.id + (x.demo ? '*' : '')).join('  ')}`);
  return layers.some((l) => l.projects.some((x) => x.demo)) ? [...lines, '* has a live demo (run <name>)'] : lines;
}

function help() {
  const lines = Object.values(VERBS).map((v) => v.usage.padEnd(14) + v.about[0].toLowerCase() + v.about.slice(1));
  return [...lines, 'tab completes, up recalls earlier commands'];
}

// What a line would do, without doing it. null when it isn't a command.
// { verb, arg, label, usage, action }, where action is one of
//   { out: [lines], err }  print      { go: '#id' }  home-page anchor     { page: 'cv/' }  another page
//   { demo, id }  a demo              { copy: text }                     { clear: true }
//   { call: fn }  run fn, print what it returns (added commands only)
export function plan(input, ctx) {
  const s = split(input);
  if (!s) return null;
  const { verb, arg } = s, v = VERBS[verb];
  const p = (label, action) => ({ verb, arg, label, usage: v.usage, action });
  const fail = (line) => p(v.about, { out: [line], err: true });

  if (EXTRA.has(verb)) {
    const r = EXTRA.get(verb).plan(arg, ctx) || { err: `${verb}: nothing to do` };
    return r.err ? fail(r.err) : p(r.label || v.about, r.action);
  }

  if (verb === 'help') return p(v.about, { out: help() });
  if (verb === 'pwd') return p(v.about, { out: [where(ctx).path] });
  if (verb === 'whoami') return p(v.about, { out: [...ME, ctx.email] });
  if (verb === 'mail') return p(`Copy ${ctx.email}`, { copy: ctx.email });
  if (verb === 'cv') return p(v.about, { page: 'cv/' });
  if (verb === 'clear') return p(v.about, { clear: true });
  if (verb === 'ls') {
    const at = resolveDir(arg, ctx), l = ctx.layers.find((x) => x.id === at);
    if (at === '') return p(v.about, { out: listing(ctx.layers) });
    return l ? p(`List the projects in ${title(l)}`, { out: listing([l]) }) : fail(`ls: no such layer: ${arg}`);
  }
  if (verb === 'cd') {
    const at = resolveDir(arg, ctx);
    if (at == null) return fail(`cd: no such layer: ${arg}`);
    if (at === '') return p(ctx.page === 'home' ? 'Go to the top' : 'Go to the home page', { go: '#top' });
    if (at === 'cv') return p('Open the CV', { page: 'cv/' });
    if (at === 'projects') return p('Open the projects table', { page: 'projects/' });
    return p(`Go to ${title(ctx.layers.find((l) => l.id === at))}`, { go: `#${at}` });
  }
  if (verb === 'open') {
    if (!arg) return fail('open: missing project name, try ls');
    const hit = best(arg, projectsOf(ctx), (x) => [x.id, x.name]);
    return hit ? p(`Open ${hit.name}`, { go: `#${hit.id}` }) : fail(`open: no such project: ${arg}`);
  }
  // run
  const all = projectsOf(ctx), demos = all.filter((x) => x.demo), a = arg.toLowerCase();
  if (!arg) return fail(`run: missing demo, one of: ${demos.map((x) => x.demo).join(', ')}`);
  const plain = all.find((x) => !x.demo && x.id === a);
  if (plain) return fail(`run: ${plain.id} has no live demo`);
  const hit = demos.find((x) => x.demo === a || x.id === a) || best(a, demos, (x) => [x.demo, x.id, x.name]);
  return hit ? p(`Run the ${hit.name} demo`, { demo: hit.demo, id: hit.id }) : fail(`run: no such demo: ${arg}`);
}

// the words each command's argument can be, each with extra keys for fuzzy matching
function argWords(verb, ctx) {
  const layers = ctx.layers.flatMap((l) => [[l.id], [l.name.toLowerCase()]]);
  if (verb === 'cd') return [...layers, ...PAGES.map((x) => [x])];
  if (verb === 'ls') return layers;
  if (verb === 'open') return projectsOf(ctx).map((x) => [x.id, x.name]);
  if (verb === 'run') return projectsOf(ctx).filter((x) => x.demo).map((x) => [x.demo, x.id, x.name]);
  if (EXTRA.has(verb) && EXTRA.get(verb).words) return EXTRA.get(verb).words(ctx);
  return [];
}

const common = (words) => words.reduce((a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return a.slice(0, i); });

// Tab: { value, options } for the input, or null when it isn't headed for a command
// (so Tab keeps its usual job in a plain search)
export function complete(input, ctx) {
  const m = /^\s*(\S*)(\s+)?(.*)$/.exec(input);
  const word = m[1].toLowerCase();
  if (!word) return null;
  if (!m[2]) {
    const options = Object.keys(VERBS).filter((v) => v.startsWith(word));
    if (!options.length) return null;
    const value = options.length === 1 ? options[0] + (VERBS[options[0]].arg ? ' ' : '') : common(options);
    return { value: value === word ? input : value, options };
  }
  if (!Object.hasOwn(VERBS, word)) return null;
  const arg = m[3].trim().toLowerCase(), words = argWords(word, ctx);
  let options = words.filter(([w]) => w.startsWith(arg)).map(([w]) => w);
  if (!options.length && arg) { const b = best(arg, words, (x) => x); options = b ? [b[0]] : []; }
  if (!options.length) return { value: input, options };
  const next = options.length === 1 ? options[0] : common(options);
  return { value: next.length > arg.length || options.length === 1 ? `${word} ${next}` : input, options };
}

// history: oldest first; an index equal to the length means "not browsing"
export const recall = (history, i, dir) => Math.max(0, Math.min(history.length, i + dir));
export function remember(history, line, max = 50) {
  return line ? [...history.filter((x) => x !== line), line].slice(-max) : history;
}
