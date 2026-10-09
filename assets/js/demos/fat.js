// Fig. 08 · FAT file system: a first-fit File Allocation Table you can drive.
// FatFS and exec() are DOM-free (testable in node); mount() is the view.

const DISK = 65536;            // 64 KiB volume
const ROW = 8192;              // bytes per map row, so the map is always 8 rows
const ROWS = DISK / ROW;
const EOF = -1, RES = -2;      // FAT markers; 0 = free
const ENTRY = 32;              // bytes per directory entry
const SIZES = [512, 1024, 2048];
const TINTS = 7;
const NAME = /^[\w.-]{1,24}$/;

class FsError extends Error {}
const fail = m => { throw new FsError(m); };
const fmtN = n => n.toLocaleString('en-US');
const fmtB = n => fmtN(n) + ' B';
const fmtBS = b => (b < 1024 ? b + ' B' : b / 1024 + ' KiB');
const fmtW = n => (n < 10000 ? fmtB(n) : (n / 1024).toFixed(1) + ' KiB');
const plural = (n, w, many = w + 's') => `${n} ${n === 1 ? w : many}`;
const byName = (a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name);

export class FatFS {
  constructor(bs = 512) { this.format(bs); }

  format(bs) {
    bs = +bs;
    if (!SIZES.includes(bs)) fail('format: block size must be 512, 1024 or 2048');
    this.bs = bs;
    this.n = DISK / bs;
    this.fat = new Array(this.n).fill(0);
    this.fat[0] = RES;         // block 0 holds the FAT itself
    this.fat[1] = EOF;         // block 1 holds the root directory
    this.ids = 0;
    this.root = this.cwd = { id: 0, name: '', dir: true, kids: [], parent: null, first: 1 };
  }

  get free() { return this.fat.reduce((c, v) => c + (v === 0), 0); }
  need(bytes) { return Math.ceil(bytes / this.bs); }

  chain(b) {                   // follow FAT entries from a first block to EOF
    const out = [];
    while (b > 0 && out.length < this.n) { out.push(b); b = this.fat[b]; }
    return out;
  }

  alloc(k) {                   // first-fit: scan the FAT for free entries, then link them
    const got = [];
    for (let b = 0; b < this.n && got.length < k; b++) if (this.fat[b] === 0) got.push(b);
    if (got.length < k) fail('no space left on device');
    got.forEach((b, i) => { this.fat[b] = i + 1 < k ? got[i + 1] : EOF; });
    return got;
  }

  release(blocks) { for (const b of blocks) this.fat[b] = 0; }

  // directories are files of 32-byte entries (plus . and .. outside the root)
  size(x, extra = 0) { return x.dir ? (x.kids.length + extra + (x.parent ? 2 : 0)) * ENTRY : x.size; }
  dirNeed(d, extra = 0) { return Math.max(1, this.need(this.size(d, extra))); }
  growth(d) { return Math.max(0, this.dirNeed(d, 1) - this.chain(d.first).length); }
  fit(d) {                     // grow or shrink a directory's chain to fit its entries
    const ch = this.chain(d.first), want = this.dirNeed(d);
    if (want > ch.length) {
      const add = this.alloc(want - ch.length);
      this.fat[ch[ch.length - 1]] = add[0];
      return add;
    }
    if (want < ch.length) { this.fat[ch[want - 1]] = EOF; this.release(ch.slice(want)); }
    return [];
  }

  path(x) { let p = ''; for (; x.parent; x = x.parent) p = '/' + x.name + p; return p || '/'; }

  resolve(path) {
    let x = path.startsWith('/') ? this.root : this.cwd;
    for (const seg of path.split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') { x = x.parent || x; continue; }
      if (!x.dir) return null;
      x = x.kids.find(k => k.name === seg);
      if (!x) return null;
    }
    return x;
  }

  get(path, cmd) {
    const x = this.resolve(path);
    if (!x) fail(`${cmd}: ${path}: no such file or directory`);
    return x;
  }

  place(path, cmd) {           // parent directory + new leaf name for a path
    const clean = path.replace(/\/+$/, '');
    const i = clean.lastIndexOf('/');
    const dirPath = i < 0 ? '.' : clean.slice(0, i) || '/';
    const name = clean.slice(i + 1);
    const dir = this.resolve(dirPath);
    if (!dir || !dir.dir) fail(`${cmd}: ${dirPath}: no such directory`);
    if (!NAME.test(name) || name === '.' || name === '..') fail(`${cmd}: bad name '${name}' (letters, digits, . _ -, max 24)`);
    if (dir.kids.some(k => k.name === name)) fail(`${cmd}: ${name}: already exists`);
    return { dir, name };
  }

  room(k, cmd) {
    const f = this.free;
    if (k > f) fail(`${cmd}: no space left on device (needs ${plural(k, 'block')}, ${f} free)`);
  }

  add(dir, node, k, cmd) {     // all-or-nothing: check space first, then allocate
    this.room(k + this.growth(dir), cmd);
    node.id = ++this.ids;
    node.parent = dir;
    const blocks = k ? this.alloc(k) : [];
    node.first = blocks[0] || 0;
    dir.kids.push(node);
    return { node, blocks, grew: this.fit(dir) };
  }

  create(path, size) {
    const m = /^(\d+(?:\.\d+)?)(k|kb|kib)?$/i.exec(String(size));
    if (!m) fail('create: size must be bytes, e.g. 2500 or 2.5k');
    size = Math.round(m[1] * (m[2] ? 1024 : 1));
    if (size > DISK) fail(`create: ${fmtB(size)} is bigger than the disk`);
    const { dir, name } = this.place(path, 'create');
    return this.add(dir, { name, dir: false, size }, this.need(size), 'create');
  }

  mkdir(path) {
    const { dir, name } = this.place(path, 'mkdir');
    return this.add(dir, { name, dir: true, kids: [] }, 1, 'mkdir');
  }

  dest(s, dst, cmd) {         // an existing directory as dst keeps the source's name
    const t = this.resolve(dst);
    return this.place(t && t.dir ? this.path(t).replace(/\/$/, '') + '/' + s.name : dst, cmd);
  }

  cp(src, dst) {
    const s = this.get(src, 'cp');
    if (s.dir) fail(`cp: ${src}: is a directory`);
    const { dir, name } = this.dest(s, dst, 'cp');
    return { ...this.add(dir, { name, dir: false, size: s.size }, this.need(s.size), 'cp'), src: s };
  }

  mv(src, dst) {
    const s = this.get(src, 'mv');
    if (s === this.root) fail('mv: cannot move /');
    const { dir, name } = this.dest(s, dst, 'mv');
    for (let x = dir; x; x = x.parent) if (x === s) fail('mv: cannot move a directory into itself');
    const from = s.parent, before = this.path(s), moved = from !== dir;
    if (moved) this.room(this.growth(dir), 'mv');
    from.kids.splice(from.kids.indexOf(s), 1);
    s.name = name; s.parent = dir; dir.kids.push(s);
    const grew = moved ? this.fit(dir) : [];
    if (moved) this.fit(from);
    return { node: s, before, moved, blocks: [], grew };
  }

  rm(path) {
    const s = this.get(path, 'rm');
    if (s === this.root) fail('rm: cannot remove /');
    if (s.dir && s.kids.length) fail(`rm: ${path}: directory not empty`);
    for (let x = this.cwd; x; x = x.parent) if (x === s) fail(`rm: ${path}: is the current directory`);
    const freed = this.chain(s.first), full = this.path(s) + (s.dir ? '/' : '');
    this.release(freed);
    s.parent.kids.splice(s.parent.kids.indexOf(s), 1);
    this.fit(s.parent);
    return { node: s, freed, path: full };
  }

  cd(path) {
    const d = path ? this.get(path, 'cd') : this.root;
    if (!d.dir) fail(`cd: ${path}: not a directory`);
    this.cwd = d;
  }

  * walk(d = this.root, depth = 0) {
    yield [d, depth];
    if (d.dir) for (const k of [...d.kids].sort(byName)) yield* this.walk(k, depth + 1);
  }

  stats() {
    let used = 0, files = 0, dirs = 0, stored = 0;
    for (const v of this.fat) if (v) used++;
    for (const [x] of this.walk()) {
      const sz = this.size(x), slack = this.chain(x.first).length * this.bs - sz;
      stored += sz;
      if (x.dir) dirs += slack; else files += slack;
    }
    return { used, free: this.n - used, total: this.n, waste: files + dirs, files, dirs, stored, fatBytes: this.n * 2 };
  }

  owners() {
    const o = new Array(this.n).fill(null);
    for (const [x] of this.walk()) for (const b of this.chain(x.first)) o[b] = x;
    return o;
  }
}

// A small tree with history: draft.tmp was deleted before cv.pdf was written, so
// first-fit split cv.pdf across the hole; build.log was deleted and left a hole.
export function seed(fs) {
  fs.mkdir('/docs');
  fs.mkdir('/src');
  fs.create('/docs/notes.txt', 2500);
  fs.create('/docs/draft.tmp', 7000);
  fs.create('/src/main.cpp', 4200);
  fs.create('/src/build.log', 3000);
  fs.rm('/docs/draft.tmp');
  fs.create('/docs/cv.pdf', 9800);
  fs.create('/src/fat.h', 1100);
  fs.rm('/src/build.log');
  fs.cwd = fs.root;
  return fs;
}

export function runsOf(ch) {   // contiguous runs: [[start, end], ...]
  const r = [];
  for (const b of ch) { const last = r[r.length - 1]; if (last && b === last[1] + 1) last[1] = b; else r.push([b, b]); }
  return r;
}

// chain as tokens: n number, a arrow, j arrow into a new run (a jump), e ellipsis, x EOF
export function chainTokens(ch, max = 12) {
  if (!ch.length) return [['e', 'no blocks']];
  const t = [], full = ch.length <= max;
  runsOf(ch).forEach(([s, e], i) => {
    if (i) t.push(['j', '→']);
    if (!full && e - s >= 3) t.push(['n', s], ['a', '→'], ['e', '…'], ['a', '→'], ['n', e]);
    else for (let b = s; b <= e; b++) { if (b > s) t.push(['a', '→']); t.push(['n', b]); }
  });
  t.push(['a', '→'], ['x', 'EOF']);
  return t;
}
const chainText = (ch, max) => chainTokens(ch, max).map(t => t[1]).join(' ');
const rangeText = ch => runsOf(ch).map(([s, e]) => (s === e ? s : `${s}–${e}`)).join(', ');

const HELP = [
  ['ls [path]', 'type, size, first block'],
  ['cd <dir>', 'change directory (.. and /)'],
  ['mkdir <name>', 'new directory; uses a block'],
  ['create <name> <bytes>', 'allocate a file, first-fit'],
  ['cp <src> <dst>', 'copy into a brand-new chain'],
  ['mv <src> <dst>', 'rename or move; no blocks move'],
  ['rm <name>', 'free a file or empty directory'],
  ['cat <name>', 'print its block chain'],
  ['df', 'used, free and wasted space'],
  ['format <512|1024|2048>', 'wipe with a new block size'],
  ['clear', 'clear the screen'],
];

// Run one command line against fs. Returns printable lines and what the view should do.
export function exec(fs, line) {
  const out = [], res = { out, blocks: [] };
  const say = (t, c = '') => out.push([c, t]);
  const [cmd = '', ...a] = line.trim().split(/\s+/).filter(Boolean);
  const args = k => { if (a.length < k) fail('usage: ' + HELP.find(([u]) => u.split(' ')[0] === cmd)[0]); };
  const where = x => fs.path(x) + (x.dir && x.parent ? '/' : '');
  const made = (verb, r) => {
    const x = r.node, ch = fs.chain(x.first), slack = ch.length * fs.bs - fs.size(x);
    say(`${verb} ${where(x)}, ${fmtB(fs.size(x))} in ${plural(ch.length, 'block')}${x.dir ? '' : `, ${fmtB(slack)} slack`}`);
    say(chainText(ch, 24), 'dim');
    const runs = runsOf(ch).length;
    if (runs > 1) say(`not contiguous: ${runs} runs, because first-fit reused freed holes`, 'key');
    if (r.grew.length) say(`${where(x.parent)} grew to ${plural(fs.chain(x.parent.first).length, 'block')} to fit the new entry`, 'dim');
    res.blocks = [...r.blocks, ...r.grew];
    res.pin = x;
    res.status = `${verb} ${x.name}, ${plural(ch.length, 'block')}${ch.length ? ' from ' + ch[0] : ''}.`;
  };
  try {
    switch (cmd) {
      case '': break;
      case 'help':
        for (const [c, d] of HELP) say(c.padEnd(23) + d, 'hang');
        say('quick actions print the command they run, so you can retype them.', 'dim');
        break;
      case 'ls': {
        const x = a[0] ? fs.get(a[0], 'ls') : fs.cwd;
        const items = x.dir ? [...x.kids].sort(byName) : [x];
        if (!items.length) say('(empty)', 'dim');
        const w = Math.max(...items.map(k => k.name.length + k.dir));
        for (const k of items) {
          say(`${k.dir ? 'd' : '-'}  ${(k.name + (k.dir ? '/' : '')).padEnd(w)}  ${fmtB(fs.size(k)).padStart(8)}  ${k.first ? '@' + k.first : '-'}`);
        }
        break;
      }
      case 'cd': fs.cd(a[0]); break;
      case 'mkdir': args(1); made('created', fs.mkdir(a[0])); break;
      case 'create': args(2); made('created', fs.create(a[0], a[1])); break;
      case 'cp': {
        args(2);
        const r = fs.cp(a[0], a[1]);
        made('copied to', r);
        say(`${where(r.src)} keeps its own chain @${r.src.first || '-'}; cp writes every block again`, 'dim');
        break;
      }
      case 'mv': {
        args(2);
        const r = fs.mv(a[0], a[1]), x = r.node;
        say(`${r.moved ? 'moved' : 'renamed'} ${r.before} → ${where(x)}`);
        say(`0 blocks moved: only the directory entry changed. chain still starts @${x.first || '-'}`, 'key');
        res.blocks = r.grew;
        res.pin = x;
        res.status = `${r.moved ? 'Moved' : 'Renamed'} to ${fs.path(x)}. No data blocks moved.`;
        break;
      }
      case 'rm': {
        args(1);
        const r = fs.rm(a[0]);
        say(`removed ${r.path}, freed ${plural(r.freed.length, 'block')}${r.freed.length ? ': ' + rangeText(r.freed) : ''}`);
        say('their FAT entries are 0 again; the bytes stay until a new file reuses them', 'dim');
        res.gone = r.node;
        res.status = `Removed ${r.node.name}, freed ${plural(r.freed.length, 'block')}.`;
        break;
      }
      case 'cat': {
        args(1);
        const x = fs.get(a[0], 'cat'), ch = fs.chain(x.first), sz = fs.size(x);
        const what = x.dir ? `directory, ${plural(sz / ENTRY, 'entry', 'entries')} × 32 B` : fmtB(sz);
        say(`${where(x)}: ${what}, ${plural(ch.length, 'block')} × ${fmtBS(fs.bs)}, ${fmtB(ch.length * fs.bs - sz)} slack`);
        say('FAT  ' + chainText(ch, 24), 'key');
        if (ch.length) say(`${plural(runsOf(ch).length, 'run')}: ${rangeText(ch)}`, 'dim');
        res.pin = x;
        res.status = `${x.name}: blocks ${chainText(ch, 24).replace(/→/g, 'then')}.`;
        break;
      }
      case 'df': {
        const s = fs.stats();
        say(`blocks  ${s.used} used, ${s.free} free, ${s.total} × ${fmtBS(fs.bs)}`);
        say(`bytes   ${fmtB(s.stored)} stored in ${fmtB(s.used * fs.bs - fs.bs)} of data blocks`);
        say(`waste   ${fmtB(s.waste)} slack in partly filled last blocks (files ${fmtN(s.files)}, dirs ${fmtN(s.dirs)})`, 'key');
        say(`FAT     ${s.total} entries × 2 B = ${fmtB(s.fatBytes)}, in block 0`);
        res.status = `${s.used} used, ${s.free} free, ${fmtB(s.waste)} wasted.`;
        break;
      }
      case 'format': {
        args(1);
        fs.format(a[0]);
        seed(fs);
        say(`formatted 64 KiB as ${fs.n} blocks × ${fmtBS(fs.bs)}; the FAT is ${fs.n} entries × 2 B = ${fmtB(fs.n * 2)}`);
        say('sample tree re-seeded: compare Waste and FAT across block sizes', 'dim');
        res.formatted = true;
        res.status = `Formatted with ${fmtBS(fs.bs)} blocks, ${fs.n} blocks. Sample files re-seeded.`;
        break;
      }
      case 'clear': res.clear = true; break;
      default: fail(`${cmd}: command not found, try help`);
    }
  } catch (e) {
    if (!(e instanceof FsError)) throw e;
    say(e.message, 'err');
    res.err = e.message;
  }
  return res;
}

/* ---- view ---- */
// Markup is built from numbers and validated names only ([\w.-]); typed text goes in as text nodes.

const unit = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const NAMES = ['todo.md', 'report.txt', 'photo.jpg', 'data.csv', 'song.mp3', 'backup.zip', 'main.o', 'readme.md', 'log.txt', 'slides.pdf'];
const LEGEND = [['k-fat', 'FAT'], ['k-dir', 'dir'], ['t0', 'file'], ['k-slack', 'slack'], ['k-free', 'free']]
  .map(([k, t]) => `<span class="fat-key"><i class="fat-sw ${k}"></i>${t}</span>`).join('') + '<br>hover or tap a file to trace its FAT chain';
const READOUTS = [['bs', 'Block'], ['used', 'Used', ' readout--accent'], ['free', 'Free'], ['waste', 'Waste'], ['fat', 'FAT']];
const ACTIONS = [
  ['create', 'create file', 'a random file in this directory'], ['cp', 'cp', 'copy the selected file, or a random one'],
  ['rm', 'rm', 'remove the selected file, or a random one'], ['frag', 'fragment it', 'create and delete files until the disk fragments'],
];

const skeleton = id => `
<div class="fat-head">
  <div class="fat-bs"><span class="label" id="${id}-bs">Block size</span>
    <div class="switch" role="radiogroup" aria-labelledby="${id}-bs">${SIZES.map(b => `<button type="button" role="radio" data-bs="${b}">${fmtBS(b)}</button>`).join('')}</div></div>
  <div class="readouts fat-ro">${READOUTS.map(([k, l, m = '']) => `<div class="readout${m}"><span class="label">${l}</span><b class="num" data-ro="${k}"></b></div>`).join('')}</div>
</div>
<div class="fat-mid">
  <div class="fat-left">
    <div class="fat-mapwrap">
      <div class="fat-ruler" aria-hidden="true"></div><div class="fat-gutter" aria-hidden="true"></div>
      <div class="fat-map" role="img"><div class="fat-cells"></div>
        <svg class="fat-trace" aria-hidden="true"><defs><marker id="${id}-arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto"><path class="arrow" d="M0 .5 8 4 0 7.5z"/></marker></defs><g></g></svg>
      </div>
    </div>
    <p class="fat-chain"></p>
  </div>
  <div class="fat-files"><div class="fat-fpanel">
    <div class="fat-fhead label" aria-hidden="true"><span>Name</span><span>Size</span><span>First</span></div>
    <ul class="fat-list" aria-label="Files and directories. Select one to trace its block chain."></ul>
  </div></div>
</div>
<div class="fat-term">
  <div class="fat-log" role="log" aria-live="off" aria-label="Terminal output" tabindex="0"></div>
  <form class="fat-inrow"><label class="sr-only" for="${id}-in"></label><span class="fat-prompt" aria-hidden="true"></span><input class="fat-in" id="${id}-in" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" placeholder="type help"></form>
</div>
<div class="ctl-row fat-acts">${ACTIONS.map(([k, t, a], i) => `<button type="button" class="ctl${i ? '' : ' ctl--primary'}" data-act="${k}" aria-label="${t}: ${a}">${t}</button>`).join('')}</div>
<p class="label fat-cap">Simulation of a FAT-style allocator. Runs in your browser.</p>
<p class="sr-only" aria-live="polite"></p>`;

let seq = 0;

export function mount(root, { reducedMotion = false } = {}) {
  const id = 'fat' + ++seq, fs = seed(new FatFS(512)), byId = new Map(), hist = [];
  let owners = [], pinned = null, hover = null, shown, hi = 0;
  let flashing = new Set(), onScreen = true, statusT = 0, lastSaid = 0, pending = '';

  const tpl = document.createElement('template');
  tpl.innerHTML = skeleton(id);
  root.classList.add('demo--fat');
  root.replaceChildren(tpl.content);
  const $ = s => root.querySelector(s);
  const sw = $('.switch'), mapWrap = $('.fat-mapwrap'), map = $('.fat-map'), cells = $('.fat-cells'), svg = $('svg'), trace = $('svg > g');
  const chainEl = $('.fat-chain'), list = $('.fat-list'), term = $('.fat-term'), log = $('.fat-log'), form = $('form'), input = $('input');
  const ro = k => $(`[data-ro="${k}"]`);
  const rows = () => [...list.querySelectorAll('.fat-row')];

  /* -- rendering */

  function buildMap() {
    const cols = ROW / fs.bs, spans = (n, f) => Array.from({ length: n }, (_, i) => `<span>${f(i)}</span>`).join('');
    mapWrap.style.setProperty('--cols', cols);
    cells.innerHTML = Array.from({ length: fs.n }, (_, b) => `<div class="fat-c" data-b="${b}"></div>`).join('');
    $('.fat-ruler').innerHTML = spans(cols, c => c);
    $('.fat-gutter').innerHTML = spans(ROWS, r => r * cols);
  }

  function render() {
    const st = fs.stats();
    owners = fs.owners();
    const fill = new Array(fs.n).fill(1);
    for (const [x] of fs.walk()) {   // the last block of each chain is only partly full
      const ch = fs.chain(x.first);
      if (ch.length) fill[ch[ch.length - 1]] = Math.max(0.05, (fs.size(x) - (ch.length - 1) * fs.bs) / fs.bs);
    }
    [...cells.children].forEach((c, b) => {
      const o = owners[b];
      c.className = 'fat-c' + (b === 0 ? ' is-fat' : o ? (o.dir ? ' is-dir' : ' is-file t' + (o.id % TINTS)) : '') + (flashing.has(b) ? ' is-new' : '');
      c.style.setProperty('--f', fill[b].toFixed(3));
    });
    const vals = { bs: fmtBS(fs.bs), used: st.used, free: st.free, waste: fmtW(st.waste), fat: fmtB(st.fatBytes) };
    for (const k in vals) ro(k).textContent = vals[k];
    ro('free').parentNode.classList.toggle('readout--fault', !st.free);
    map.setAttribute('aria-label', `Block map: ${fs.n} blocks of ${fmtBS(fs.bs)}, ${st.used} used, ${st.free} free`);
    for (const b of sw.children) {
      const on = +b.dataset.bs === fs.bs;
      b.setAttribute('aria-checked', on);
      b.tabIndex = on ? 0 : -1;
    }
    const cwd = fs.path(fs.cwd);
    $('.fat-prompt').textContent = cwd + ' $';
    $('label').textContent = `Terminal command, in ${cwd}`;
    // the L1 readout (assets/js/readouts.js) follows the disk through this
    root.dispatchEvent(new CustomEvent('fat:change', { bubbles: true, detail: { blocks: fs.n, blockSize: fs.bs, used: st.used, free: st.free } }));
    return st;
  }

  function renderList() {
    const had = list.contains(document.activeElement) && document.activeElement.dataset.id;
    let html = '';
    byId.clear();
    for (const [x, depth] of fs.walk()) {
      byId.set(x.id, x);
      const sz = fs.size(x), n = fs.chain(x.first).length;
      html += `<li><button type="button" class="fat-row" data-id="${x.id}" style="--d:${depth}" aria-pressed="${pinned === x}"`
        + `${x === fs.cwd ? ' aria-current="location"' : ''} aria-label="${fs.path(x)}, ${x.dir ? 'directory' : 'file'}, ${fmtN(sz)} bytes, ${plural(n, 'block')}${n ? ', first block ' + x.first : ''}">`
        + `<i class="fat-sw ${x.dir ? 'k-dir' : 't' + (x.id % TINTS)}"></i><span class="nm">${x.parent ? x.name + (x.dir ? '/' : '') : '/'}</span>`
        + `<span class="sz">${fmtB(sz)}</span><span class="fb">${n ? '@' + x.first : '-'}</span></button></li>`;
    }
    list.innerHTML = html;
    if (had) list.querySelector(`[data-id="${had}"]`)?.focus({ preventScroll: true });
  }

  function renderChain(a, ch) {
    if (a === null) chainEl.innerHTML = LEGEND;
    else if (typeof a === 'number') {
      chainEl.innerHTML = `<b>block ${a}</b>: ${a ? 'free, its FAT entry is 0' : `the FAT: ${fs.n} entries × 2 B = ${fmtB(fs.n * 2)}`}`;
    } else {
      const sz = fs.size(a);
      chainEl.innerHTML = `<b>${fs.path(a)}${a.dir && a.parent ? '/' : ''}</b>&nbsp; `
        + chainTokens(ch).map(([k, v]) => (k === 'a' ? ` ${v} ` : `<span class="c-${k}">${k === 'j' ? ` ${v} ` : v}</span>`)).join('')
        + `<span class="c-meta">&nbsp; ${fmtB(sz)} in ${plural(ch.length, 'block')}, ${fmtB(ch.length * fs.bs - sz)} slack</span>`;
    }
  }

  // SVG overlay: ring at the first block, beads along runs, bowed arrows across jumps, square at EOF
  function drawTrace(ch, animate) {
    svg.classList.toggle('is-draw', animate);
    const W = cells.clientWidth, H = cells.clientHeight;
    if (!ch.length || !W) { trace.innerHTML = ''; return; }
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const cols = ROW / fs.bs, cw = W / cols, rh = H / ROWS;
    const P = b => [(b % cols + 0.5) * cw, (Math.floor(b / cols) + 0.5) * rh];
    const rd = Math.max(1.6, Math.min(2.8, Math.min(cw, rh) * 0.11)), gap = rd + 3.5, step = Math.min(40, 640 / ch.length);
    trace.innerHTML = ch.map((b, i) => {
      const [x, y] = P(b);
      let s = '';
      if (i) {
        const a = ch[i - 1], [ax, ay] = P(a);
        let d, arrow = ` marker-end="url(#${id}-arr)"`;
        if (b === a + 1 && ay === y) { d = `M${ax + gap} ${y}H${x - gap}`; arrow = ''; }
        else if (b === a + 1) d = `M${ax + gap} ${ay}H${W}M0 ${y}H${x - gap}`;   // wraps to the next row
        else {
          const dx = x - ax, dy = y - ay, L = Math.hypot(dx, dy), k = Math.min(L * 0.2, rh * 1.3);
          const cx = (ax + x) / 2 + (dy / L) * k, cy = (ay + y) / 2 - (dx / L) * k;
          const [u1, v1] = unit(cx - ax, cy - ay), [u2, v2] = unit(x - cx, y - cy);
          d = `M${ax + u1 * gap} ${ay + v1 * gap}Q${cx} ${cy} ${x - u2 * gap} ${y - v2 * gap}`;
        }
        s = `<path class="halo" d="${d}"/><path class="ln" d="${d}"${arrow}/>`;
      }
      s += i === 0 ? `<circle class="start" cx="${x}" cy="${y}" r="${rd + 2.5}"/>`
        : i === ch.length - 1 ? `<rect class="eof" x="${x - rd - 0.5}" y="${y - rd - 0.5}" width="${rd * 2 + 1}" height="${rd * 2 + 1}"/>`
          : `<circle class="dot" cx="${x}" cy="${y}" r="${rd}"/>`;
      return `<g${animate ? ` style="animation-delay:${Math.round(i * step)}ms"` : ''}>${s}</g>`;
    }).join('');
  }

  // highlight whatever is hovered, else whatever is pinned
  function updateHL(force) {
    const a = hover ?? pinned ?? null;
    if (a === shown && !force) return;
    const animate = a !== shown && !reducedMotion;
    shown = a;
    const node = a && typeof a === 'object' ? a : null, ch = node ? fs.chain(node.first) : [];
    const set = new Set(typeof a === 'number' ? [a] : ch);
    for (const c of cells.children) c.classList.toggle('is-hl', set.has(+c.dataset.b));
    map.classList.toggle('has-hl', !!node);
    for (const r of rows()) r.classList.toggle('is-hl', +r.dataset.id === node?.id);
    renderChain(a, ch);
    drawTrace(ch, animate);
  }

  const setHover = v => { if (v !== hover) { hover = v; updateHL(); } };
  const setPin = x => {
    pinned = x;
    for (const r of rows()) r.setAttribute('aria-pressed', byId.get(+r.dataset.id) === x);
    updateHL();
  };

  /* -- terminal */

  const print = (cls, ...kids) => {
    const d = document.createElement('div');
    d.className = 'fat-l' + (cls ? ' is-' + cls : '');
    d.append(...kids);
    log.append(d);
  };
  const echo = line => {
    const p = document.createElement('span');
    p.className = 'p';
    p.textContent = fs.path(fs.cwd) + ' $ ';
    print('cmd', p, line);
  };

  function run(line) {
    echo(line);
    if (line.trim() && hist[hist.length - 1] !== line) hist.push(line);
    if (hist.length > 60) hist.shift();
    hi = hist.length;
    const r = exec(fs, line);
    if (r.clear) log.replaceChildren();
    for (const [c, t] of r.out) print(c, t);
    return r;
  }

  function settle(results) {   // apply the view side of one or more commands
    const blocks = [];
    let said = '';
    for (const r of results) {
      if (r.formatted) { buildMap(); pinned = hover = null; shown = undefined; }
      if (r.gone && pinned === r.gone) pinned = null;
      if (r.gone && hover === r.gone) hover = null;
      if (r.pin) pinned = r.pin;
      blocks.push(...r.blocks);
      said = r.err ? 'Error: ' + r.err : r.status || said;
    }
    const canFlash = !reducedMotion && onScreen && !document.hidden;
    flashing = new Set(canFlash ? blocks.filter(b => fs.fat[b] !== 0) : []);
    const st = render();
    renderList();
    updateHL(true);
    while (log.childElementCount > 240) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
    if (said) announce(`${said} ${st.used} of ${st.total} blocks used.`);
  }

  const runAll = cmds => {
    const out = [];
    for (const c of cmds) { const r = run(c); out.push(r); if (r.err) break; }
    settle(out);
  };

  function announce(msg) {     // throttled: at most one announcement a second, latest wins
    pending = msg;
    if (statusT) return;
    statusT = setTimeout(() => {
      statusT = 0;
      lastSaid = Date.now();
      $('[aria-live="polite"]').textContent = pending;
    }, Math.max(0, lastSaid + 1000 - Date.now()));
  }

  /* -- quick actions: each prints the command it runs */

  const uniq = (dir, name) => {
    const dot = name.lastIndexOf('.'), base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
    let n = name;
    for (let i = 2; dir.kids.some(k => k.name === n); i++) n = base + i + ext;
    return n;
  };
  const rel = x => (x.parent === fs.cwd ? x.name : fs.path(x));
  const pickFile = () => {
    if (pinned && !pinned.dir && byId.get(pinned.id) === pinned) return pinned;
    const here = fs.cwd.kids.filter(k => !k.dir), all = [...fs.walk()].map(([x]) => x).filter(x => !x.dir);
    return here.length ? pick(here) : all.length ? pick(all) : null;
  };
  const nope = (cmd, msg) => {
    echo(cmd);
    print('err', msg);
    log.scrollTop = log.scrollHeight;
    announce('Error: ' + msg);
  };
  const act = {
    create: () => runAll([`create ${uniq(fs.cwd, pick(NAMES))} ${300 + Math.round(Math.random() * 5700)}`]),
    cp() {
      const f = pickFile();
      if (!f) return nope('cp', 'cp: no files to copy; try create file');
      const dot = f.name.lastIndexOf('.');
      const copy = uniq(f.parent, dot > 0 ? f.name.slice(0, dot) + '-copy' + f.name.slice(dot) : f.name + '-copy');
      runAll([`cp ${rel(f)} ${f.parent === fs.cwd ? copy : fs.path(f.parent) + '/' + copy}`]);
    },
    rm() {
      const f = pickFile();
      if (!f) return nope('rm', 'rm: no files left to remove');
      runAll([`rm ${rel(f)}`]);
    },
    frag() {   // four small files, delete every other one, then write a file bigger than each hole
      const d = fs.cwd, bs = fs.bs, names = ['a', 'b', 'c', 'd'].map(s => uniq(d, `frag-${s}.bin`));
      if (fs.free < 11) return nope('fragment it', `fragment it: needs 11 free blocks, ${fs.free} left; try rm or format`);
      runAll([...names.map(n => `create ${n} ${bs * 2 - 120}`), `rm ${names[0]}`, `rm ${names[2]}`, `create ${uniq(d, 'big.bin')} ${bs * 5 - 300}`]);
    },
  };

  /* -- events */

  $('.fat-acts').addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b) act[b.dataset.act](); });

  sw.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b && +b.dataset.bs !== fs.bs) runAll(['format ' + b.dataset.bs]);
  });
  sw.addEventListener('keydown', e => {   // radiogroup: arrows move the selection
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    const i = (SIZES.indexOf(fs.bs) + d + SIZES.length) % SIZES.length;
    runAll(['format ' + SIZES[i]]);
    sw.children[i].focus();
  });

  const cellOf = e => e.target.closest('.fat-c');
  cells.addEventListener('pointerover', e => { const c = cellOf(e); if (c) setHover(owners[c.dataset.b] || +c.dataset.b); });
  map.addEventListener('pointerleave', () => setHover(null));
  cells.addEventListener('click', e => { const c = cellOf(e), o = c && owners[c.dataset.b]; if (c) setPin(o && o !== pinned ? o : null); });
  cells.addEventListener('animationend', e => {
    const c = e.target;
    if (c.classList.contains('is-new')) { flashing.delete(+c.dataset.b); c.classList.remove('is-new'); }
  });

  const rowNode = e => { const r = e.target.closest('.fat-row'); return r && byId.get(+r.dataset.id); };
  list.addEventListener('pointerover', e => { const x = rowNode(e); if (x) setHover(x); });
  list.addEventListener('pointerleave', () => setHover(null));
  list.addEventListener('click', e => { const x = rowNode(e); if (x) setPin(pinned === x ? null : x); });
  list.addEventListener('focusin', e => { const x = rowNode(e); if (x) setHover(x); });
  list.addEventListener('focusout', e => { if (!list.contains(e.relatedTarget)) setHover(null); });
  list.addEventListener('keydown', e => { if (e.key === 'Escape') setPin(null); });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const v = input.value;
    input.value = '';
    runAll([v]);
  });
  term.addEventListener('keydown', e => e.stopPropagation());   // keep page shortcuts out of the terminal
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      hi = Math.max(0, Math.min(hist.length, hi + (e.key === 'ArrowUp' ? -1 : 1)));
      input.value = hist[hi] ?? '';
      input.setSelectionRange(input.value.length, input.value.length);
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      log.replaceChildren();
    } else if (e.key === 'Escape') input.value = '';
  });
  log.addEventListener('click', e => {
    if (e.pointerType !== 'touch' && getSelection().isCollapsed) input.focus({ preventScroll: true });
  });

  const io = 'IntersectionObserver' in window ? new IntersectionObserver(([en]) => { onScreen = en.isIntersecting; }) : null;
  io?.observe(root);
  const rsz = 'ResizeObserver' in window ? new ResizeObserver(() => { if (shown && typeof shown === 'object') drawTrace(fs.chain(shown.first), false); }) : null;
  rsz?.observe(cells);

  /* -- boot */

  buildMap();
  print('dim', `64 KiB volume of ${fs.n} × ${fmtBS(fs.bs)} blocks, FAT in block 0, / in block 1`);
  print('dim', 'cv.pdf is split: first-fit put it in the hole a deleted file left.');
  print('', 'type help, or pick a file and use the buttons.');
  render();
  renderList();
  updateHL(true);

  return {
    destroy() {
      clearTimeout(statusT);
      io?.disconnect();
      rsz?.disconnect();
      root.replaceChildren();
      root.classList.remove('demo--fat');
    },
  };
}
