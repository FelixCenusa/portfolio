// The hero: an exploded stack of the five layers this portfolio is organised
// by (Web, Apps, Algorithms, Systems, Metal), each slab a small scope screen.
// A slab's top face is dark glass with a 10 x 8 graticule, and it carries its
// channel's trace in the channel's colour. The traces wait for a trigger (your
// first move, or 2 s), sweep in left to right, top layer first, then roll;
// "Single" in the caption re-arms them for one capture that holds. That state
// lives in poweron.js, which the SVG poster follows too.
//
// Vias run down through the slabs, and short hard-edged edges travel them,
// each taking the channel colour of the last slab it passed: a request turning
// into electrons. Hover a slab to light it, click to jump to that layer.
//
// The loop is registered with the instrument (instrument.js): Stop holds the
// last frame and nothing renders, except a repaint when you hover a slab. It
// also stops off screen and in a hidden tab. Traces are THREE.Line geometry
// rewritten in place (a few hundred points), never per-frame textures; the
// face textures are drawn once.
//
// Matches the static SVG poster in index.html (same camera, slab layout, face,
// vias and traces). The canvas picks the roll up where the poster's has got to,
// and the poster keeps rolling while the canvas fades in over it, so the
// hand-off from poster to canvas is seamless.

import {
  WebGLRenderer, Scene, OrthographicCamera, Group, Mesh, BoxGeometry, EdgesGeometry, LineSegments,
  LineBasicMaterial, MeshBasicMaterial, CanvasTexture, SRGBColorSpace, Line, BufferGeometry,
  BufferAttribute, DynamicDrawUsage, Raycaster, Vector2, Vector3, Color,
} from 'three';
import { WAVES, CYCLES_PER_TILE } from '../waves.js';
import { register, reducedMotion } from '../instrument.js';
import { scope, sweep, ROLL_S } from './poweron.js';

const LAYERS = [
  { id: 'l4', key: 'web', reg: 'L4', name: 'Web' },
  { id: 'l3', key: 'apps', reg: 'L3', name: 'Apps' },
  { id: 'l2', key: 'algo', reg: 'L2', name: 'Algorithms' },
  { id: 'l1', key: 'sys', reg: 'L1', name: 'Systems' },
  { id: 'l0', key: 'metal', reg: 'L0', name: 'Metal' },
];

// The face, designed in a 100 x 100 square like the poster's: x runs to +x and
// y to +z, so (100, 100) is the corner nearest the viewer. Under each slab only
// a band along the front edges shows, so the traces run along the front-left
// band and the vias come down through the front-right one. Keep these in step
// with the poster in index.html.
const GLASS = { x0: 3, y0: 3, x1: 97, y1: 97 }; // the screen, inside a thin rim
const COLS = 10, ROWS = 8;
const DIV_X = (GLASS.x1 - GLASS.x0) / COLS, DIV_Y = (GLASS.y1 - GLASS.y0) / ROWS;
const ZERO = GLASS.y0 + 6 * DIV_Y; // each trace's zero line, on the sixth division line
const AMP = DIV_Y; // one division
const VIAS = [[95, 12], [88, 30], [94, 47]];
const N = 240; // points per trace

const THICK = 0.11;
const SIZE = 2;
const ELEV = (30 * Math.PI) / 180;
const AZIM = (45 * Math.PI) / 180;
const LIFT = THICK / 2 + 0.002; // traces sit just above the glass

// edges on the vias
const EDGE_LEN = 0.16;
const EDGE_W = 0.02;
const EDGE_SPEED = 1.35; // world units a second, at full explode
const leadFor = (gap) => 0.42 * gap; // the vias run on below the metal, so its edge shows its colour

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const fx = (x) => -1 + (2 * x) / 100; // face units to slab-local x / z
const gapFor = (e) => lerp(0.16, 0.725, e);

// The colours are the stylesheet's tokens (the same ones the poster uses), read
// once at start and again on recolor().
function readPalette() {
  const root = getComputedStyle(document.documentElement);
  const probe = document.createElement('i');
  probe.style.display = 'none';
  document.body.append(probe);
  const rgb = (name) => {
    probe.style.color = root.getPropertyValue(name).trim();
    const c = getComputedStyle(probe).color; // rgb(r, g, b) or color(srgb r g b)
    const n = (c.match(/[\d.]+/g) || ['0', '0', '0']).slice(0, 3).map(Number);
    return c.startsWith('color(') ? n.map((v) => Math.round(v * 255)) : n;
  };
  const css = ([r, g, b], a = 1) => `rgba(${r},${g},${b},${a})`;
  const three = ([r, g, b], k = 1) => new Color().setRGB((r * k) / 255, (g * k) / 255, (b * k) / 255, SRGBColorSpace);
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const ink = rgb('--text-1'), deep = rgb('--s-bg-0'), via = rgb('--via');
  const P = { line: (a) => css(ink, a), pad: css(via, 0.9), via: three(via) };
  LAYERS.forEach((l) => {
    const face = rgb(`--slab-${l.id}`), sideL = rgb(`--slab-${l.id}-l`), ch = rgb(`--ch-${l.id}`);
    P[l.key] = {
      rim: css(face),
      glass: css(mix(face, deep, 0.7)),
      label: css(ch, 0.85),
      trace: three(ch),
      sideR: three(rgb(`--slab-${l.id}-r`)),
      sideL: three(sideL),
      under: three(sideL, 0.88),
      edge: three(rgb(`--slab-${l.id}-ink`)),
    };
  });
  probe.remove();
  return P;
}
let COL = null;

/* ---------------------------------------------------------------- face textures (drawn once) */
function faceTexture(layer, maxAniso) {
  const S = 512, s = S / 100;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const col = COL[layer.key];
  const px = (v) => Math.round(v * s);
  const { x0, y0, x1, y1 } = GLASS;
  g.fillStyle = col.rim;
  g.fillRect(0, 0, S, S);
  g.fillStyle = col.glass;
  g.fillRect(px(x0), px(y0), px(x1) - px(x0), px(y1) - px(y0));

  // graticule: 10 x 8 divisions, the centre axes a step stronger
  g.fillStyle = COL.line(0.07);
  for (let i = 1; i < COLS; i++) if (i !== 5) g.fillRect(px(x0 + i * DIV_X) - 1, px(y0), 2, px(y1) - px(y0));
  for (let j = 1; j < ROWS; j++) if (j !== 4) g.fillRect(px(x0), px(y0 + j * DIV_Y) - 1, px(x1) - px(x0), 2);
  g.fillStyle = COL.line(0.13);
  g.fillRect(px(x0 + 5 * DIV_X) - 1, px(y0), 2, px(y1) - px(y0));
  g.fillRect(px(x0), px(y0 + 4 * DIV_Y) - 1, px(x1) - px(x0), 2);

  // where the vias go through
  g.fillStyle = COL.pad;
  VIAS.forEach(([x, y]) => g.fillRect(px(x - 1.2), px(y - 1.2), px(2.4), px(2.4)));

  // the register, engraved by the front corner: "L4" is a value (mono), "Web" a name (sans)
  const size = 3.6 * s, base = 95.3 * s, right = 95.5 * s;
  g.fillStyle = col.label;
  g.textAlign = 'right';
  g.textBaseline = 'alphabetic';
  g.font = `520 ${size}px "Mona Sans", sans-serif`;
  const w = g.measureText(layer.name).width;
  g.fillText(layer.name, right, base);
  g.font = `500 ${size}px "Mona Sans Mono", monospace`;
  g.fillText(layer.reg, right - w - 0.3 * size, base);

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

/* ---------------------------------------------------------------- scene */
export async function initStack(stage, { onSelect } = {}) {
  const canvas = stage.querySelector('.stage__canvas');
  const labels = LAYERS.map((l) => stage.querySelector(`[data-layer-label="${l.id}"]`));
  if (!canvas) return null;

  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    return null;
  }
  const pr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pr);
  renderer.setClearColor(0x000000, 0);

  // the face labels use both faces of the font; make sure they're there before drawing
  try { await Promise.all([document.fonts.load('500 20px "Mona Sans Mono"'), document.fonts.load('520 20px "Mona Sans"')]); } catch {}
  COL = readPalette();

  const scene = new Scene();
  const cam = new OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
  const R = 20;
  cam.position.set(R * Math.cos(ELEV) * Math.sin(AZIM), R * Math.sin(ELEV), R * Math.cos(ELEV) * Math.cos(AZIM));
  cam.lookAt(0, 0, 0);

  const root = new Group();
  scene.add(root);

  /* ---------------- slabs, each with its trace */
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const box = new BoxGeometry(SIZE, THICK, SIZE);
  const edgesGeo = new EdgesGeometry(box);
  const xs = Float32Array.from({ length: N }, (_, k) => fx(GLASS.x0 + ((GLASS.x1 - GLASS.x0) * k) / (N - 1)));
  const zZero = fx(ZERO);
  // WebGL draws lines one device pixel wide; on a dense screen each trace is drawn twice, a pixel apart
  const copies = pr >= 1.5 ? 2 : 1;
  const traceLines = [];
  const addLines = (mesh, geo, mat) => Array.from({ length: copies }, (_, k) => {
    const ln = new Line(geo, mat);
    ln.frustumCulled = false;
    ln.userData.copy = k;
    ln.position.y = LIFT;
    mesh.add(ln);
    traceLines.push(ln);
    return ln;
  });

  const slabs = LAYERS.map((layer, i) => {
    const col = COL[layer.key];
    const top = new MeshBasicMaterial({ map: faceTexture(layer, aniso), color: new Color(1, 1, 1) });
    const mats = [
      new MeshBasicMaterial({ color: col.sideR }), // +x
      new MeshBasicMaterial({ color: col.under }), // -x
      top, // +y
      new MeshBasicMaterial({ color: col.under }), // -y
      new MeshBasicMaterial({ color: col.sideL }), // +z
      new MeshBasicMaterial({ color: col.under }), // -z
    ];
    const mesh = new Mesh(box, mats);
    mesh.userData.index = i;
    const edgeMat = new LineBasicMaterial({ color: col.edge, transparent: true, opacity: 0.3 });
    mesh.add(new LineSegments(edgesGeo, edgeMat));
    root.add(mesh);

    // the trace: N points along the band, rewritten in place while it rolls
    const wpos = new Float32Array(N * 3);
    for (let k = 0; k < N; k++) { wpos[3 * k] = xs[k]; wpos[3 * k + 2] = zZero; }
    const wattr = new BufferAttribute(wpos, 3).setUsage(DynamicDrawUsage);
    const wgeo = new BufferGeometry().setAttribute('position', wattr);
    wgeo.setDrawRange(0, 0);
    // the flat line that waits for the trigger, and that the sweep overwrites
    const fpos = new Float32Array([xs[0], 0, zZero, xs[N - 1], 0, zZero]);
    const fattr = new BufferAttribute(fpos, 3).setUsage(DynamicDrawUsage);
    const fgeo = new BufferGeometry().setAttribute('position', fattr);
    const base = col.trace.clone();
    const tmat = new LineBasicMaterial({ color: base.clone() });
    addLines(mesh, wgeo, tmat);
    const flats = addLines(mesh, fgeo, tmat);
    return { layer, mesh, mats, top, edgeMat, tmat, base, wpos, wattr, wgeo, fpos, fattr, flats, drawn: NaN, hot: 0, flash: 0, y: 0 };
  });

  /* ---------------- vias: vertical lines through all the slabs, on below the metal */
  const viaMat = new LineBasicMaterial({ color: COL.via, transparent: true, opacity: 0.45 });
  const vias = VIAS.map(([u, v]) => {
    const geo = new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(6), 3));
    const ln = new Line(geo, viaMat);
    ln.frustumCulled = false;
    root.add(ln);
    return { x: fx(u), z: fx(v), geo };
  });

  /* ---------------- edges: short, hard-edged, in the colour of the last slab passed */
  const edgeGeo = new BoxGeometry(EDGE_W, 1, EDGE_W);
  const edgeMats = LAYERS.map((l) => new MeshBasicMaterial({ color: COL[l.key].trace.clone() }));
  const edges = [];
  const viaLen0 = 4 * (gapFor(1) + THICK) + THICK + leadFor(gapFor(1));
  const spawn = (vi = Math.floor(Math.random() * vias.length)) => {
    if (reducedMotion || edges.length > 8) return;
    const m = new Mesh(edgeGeo, edgeMats[0]);
    m.visible = false;
    root.add(m);
    edges.push({ m, via: vias[vi], t: 0, speed: EDGE_SPEED * (0.9 + Math.random() * 0.2), passed: new Set() });
  };

  /* ---------------- layout */
  // 1 = the resting, exploded layout (identical to the SVG poster); scrolling away compresses it
  let explode = 1;
  let explodeShown = 1; // eased value actually drawn
  let yTop = 0, yEnd = 0;

  function layout() {
    const gap = gapFor(explodeShown);
    const step = gap + THICK;
    slabs.forEach((s, i) => { s.y = (2 - i) * step; });
    yTop = slabs[0].y + THICK / 2;
    yEnd = slabs[slabs.length - 1].y - THICK / 2 - leadFor(gap);
    vias.forEach((v) => {
      const p = v.geo.attributes.position;
      p.setXYZ(0, v.x, yTop, v.z);
      p.setXYZ(1, v.x, yEnd, v.z);
      p.needsUpdate = true;
    });
  }

  /* ---------------- traces */
  let phase = 0; // in screen widths; rolls while running
  let seenSweep = null;
  // how far the poster's traces have rolled: their CSS roll began with the capture and pauses with
  // Stop and off screen, so a capture the canvas first sees picks up in step with it
  const posterWave = stage.querySelector('.poster .wave');
  function rollPhase(st, now) {
    let ms = now - st.sweepAt;
    try {
      const a = posterWave && posterWave.getAnimations ? posterWave.getAnimations()[0] : null;
      if (a && typeof a.currentTime === 'number') ms = a.currentTime;
    } catch {}
    return ((ms / 1000 / ROLL_S) % 1 + 1) % 1;
  }
  function writeWave(s) {
    const w = WAVES[s.layer.id], cyc = CYCLES_PER_TILE[s.layer.id], p = s.wpos;
    for (let k = 0; k < N; k++) p[3 * k + 2] = fx(ZERO - AMP * w(cyc * (k / (N - 1) + phase)));
    s.wattr.needsUpdate = true;
    s.drawn = phase;
  }
  function traces(now, dt) {
    const st = scope.get();
    const captured = st.at != null && st.sweepAt != null;
    const rolls = captured && st.mode === 'auto' && !reducedMotion;
    if (captured && st.sweepAt !== seenSweep) {
      nextSpawn = Math.min(nextSpawn, 0.15); // the trigger sends an edge down
      if (rolls) phase = rollPhase(st, now); // also on the first call, at init: the poster may have been rolling a while
    } else if (rolls) phase = (phase + dt / ROLL_S) % 1;
    seenSweep = captured ? st.sweepAt : null;
    slabs.forEach((s, i) => {
      const p = captured ? (reducedMotion ? 1 : sweep(st.sweepAt, i, now)) : 0;
      const n = p >= 1 ? N : Math.floor(p * N);
      if (n > 0 && s.drawn !== phase) writeWave(s);
      s.wgeo.setDrawRange(0, n >= 2 ? n : 0);
      const flat = n < N;
      s.flats.forEach((l) => { l.visible = flat; });
      const from = xs[Math.max(0, n - 1)];
      if (flat && s.fpos[0] !== from) { s.fpos[0] = from; s.fattr.needsUpdate = true; }
    });
    return captured;
  }

  /* ---------------- sizing */
  let W = 1, H = 1;
  function resize() {
    W = Math.max(1, canvas.clientWidth);
    H = Math.max(1, canvas.clientHeight);
    renderer.setSize(W, H, false);
    const asp = W / H;
    const hh = 2.357; // same scale as the poster: slab half-diagonal = 30% of the width
    const shift = 0.075; // stack sits slightly left, leaving room for the labels
    cam.left = -hh * asp + shift;
    cam.right = hh * asp + shift;
    cam.top = hh;
    cam.bottom = -hh;
    cam.updateProjectionMatrix();
    // one device pixel, as a lift above the glass (it shows as a pixel straight down the screen)
    const devPx = (cam.top - cam.bottom) / (H * pr) / Math.cos(ELEV);
    traceLines.forEach((ln) => { ln.position.y = LIFT + ln.userData.copy * devPx; });
    if (!running) paint();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  /* ---------------- interaction */
  const ray = new Raycaster();
  const ndc = new Vector2(10, 10);
  let pointerIn = false;
  let hovered = -1;
  const tilt = { x: 0, y: 0, tx: 0, ty: 0 };

  function pick() {
    ray.setFromCamera(ndc, cam);
    const hit = ray.intersectObjects(slabs.map((s) => s.mesh), false)[0];
    setHover(hit ? hit.object.userData.index : -1);
  }
  function onMove(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    pointerIn = true;
    if (!reducedMotion) {
      tilt.ty = ndc.x * 0.16;
      tilt.tx = -ndc.y * 0.05;
    }
    if (!running) pick(); // stopped: still answer the hover, with a single repaint
  }
  function onLeave() {
    pointerIn = false;
    tilt.tx = tilt.ty = 0;
    setHover(-1);
  }
  function setHover(i) {
    if (i === hovered) return;
    hovered = i;
    canvas.style.cursor = i >= 0 ? 'pointer' : '';
    labels.forEach((el, k) => el && el.classList.toggle('is-hot', k === i));
    if (!running) {
      slabs.forEach((s, k) => { s.hot = i === -1 ? 0 : i === k ? 1 : -1; look(s); });
      paint();
    }
  }
  function onClick() {
    if (hovered >= 0) onSelect && onSelect(LAYERS[hovered].id);
    else spawn();
  }
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('click', onClick);

  /* ---------------- labels follow the slabs' right corners */
  const corner = new Vector3();
  function placeLabels() {
    slabs.forEach((s, i) => {
      const el = labels[i];
      if (!el) return;
      corner.set(SIZE / 2, s.y, -SIZE / 2);
      root.localToWorld(corner);
      corner.project(cam);
      el.style.left = `${(corner.x * 0.5 + 0.5) * 100}%`;
      el.style.top = `${(-corner.y * 0.5 + 0.5) * 100}%`;
    });
  }

  // a slab's brightness: lit when hovered, dimmed when another is, a short flash when an edge passes
  function look(s) {
    const b = 1 + Math.max(0, s.hot) * 0.35 + s.flash * 0.18 + Math.min(0, s.hot) * 0.24;
    s.top.color.setScalar(b);
    s.edgeMat.opacity = Math.min(1, 0.3 + Math.max(0, s.hot) * 0.6 + s.flash * 0.6 + Math.min(0, s.hot) * 0.15);
    s.tmat.color.copy(s.base).multiplyScalar(1 + Math.min(0, s.hot) * 0.45);
  }
  function paint() {
    placeLabels();
    renderer.render(scene, cam);
  }

  /* ---------------- the loop: only while running, visible and on screen */
  let ambient = false, visible = true, lost = false, running = false;
  let raf = 0, last = performance.now(), clock = 0, nextSpawn = 0.6;
  const slow = (navigator.hardwareConcurrency || 8) <= 4; // 30 fps there
  const ticker = window.gsap && window.gsap.ticker;

  function frame(now) {
    if (slow && now - last < 30) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    clock += dt;

    explodeShown = lerp(explodeShown, explode, 1 - Math.exp(-dt * 4));
    layout();

    tilt.x = lerp(tilt.x, tilt.tx, 1 - Math.exp(-dt * 5));
    tilt.y = lerp(tilt.y, tilt.ty, 1 - Math.exp(-dt * 5));
    root.rotation.set(tilt.x, tilt.y, 0);

    if (pointerIn) pick();

    const captured = traces(now, dt);

    // edges: one now and then once the traces have triggered
    if (captured && !reducedMotion) {
      nextSpawn -= dt;
      if (nextSpawn <= 0) { spawn(); nextSpawn = 1.4 + Math.random() * 1.2; }
    }
    const span = yTop - yEnd;
    for (let k = edges.length - 1; k >= 0; k--) {
      const e = edges[k];
      e.t += (dt * e.speed) / viaLen0;
      const head = yTop - e.t * span;
      slabs.forEach((s, i) => {
        if (!e.passed.has(i) && head <= s.mesh.position.y) { e.passed.add(i); s.flash = 1; e.m.material = edgeMats[i]; }
      });
      const hi = Math.min(head + EDGE_LEN, yTop), lo = Math.max(head, yEnd);
      if (hi - lo > 0.002) {
        e.m.visible = true;
        e.m.scale.y = hi - lo;
        e.m.position.set(e.via.x, (hi + lo) / 2, e.via.z);
      } else e.m.visible = false;
      if (head + EDGE_LEN <= yEnd) { root.remove(e.m); edges.splice(k, 1); }
    }

    // slab states
    slabs.forEach((s, i) => {
      const bob = reducedMotion ? 0 : Math.sin(clock * 0.9 + i * 0.8) * 0.012;
      s.mesh.position.y = s.y + bob;
      const target = hovered === -1 ? 0 : hovered === i ? 1 : -1;
      s.hot = lerp(s.hot, target, 1 - Math.exp(-dt * 8));
      s.flash = Math.max(0, s.flash - dt * 2.2);
      look(s);
    });

    paint();
  }

  const tick = () => frame(performance.now());
  const rafTick = (now) => { raf = 0; frame(now); if (running) raf = requestAnimationFrame(rafTick); };
  function sync() {
    const should = ambient && visible && !lost && !document.hidden;
    if (should === running) return;
    running = should;
    if (should) {
      last = performance.now();
      if (ticker) ticker.add(tick); else raf = requestAnimationFrame(rafTick);
    } else {
      if (ticker) ticker.remove(tick);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }
  }
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; sync(); }, { rootMargin: '80px' });
  io.observe(stage);

  const onLost = (e) => { e.preventDefault(); lost = true; stage.classList.remove('is-live'); sync(); };
  canvas.addEventListener('webglcontextlost', onLost);

  resize();
  layout();
  slabs.forEach((s) => { s.mesh.position.y = s.y; look(s); });
  traces(performance.now(), 0);
  paint();
  // while the canvas fades in, the poster's traces keep rolling under it (hero.css), so the two stay in step
  stage.classList.add('is-live', 'is-handoff');
  const handoff = setTimeout(() => stage.classList.remove('is-handoff'), 1000);
  // Run/Stop (and a hidden tab) start and stop the loop; stopped, the last frame holds
  const unregister = register({
    start() { ambient = true; sync(); },
    stop() { ambient = false; sync(); },
  });

  // repaint with the current theme's colours
  function recolor() {
    COL = readPalette();
    slabs.forEach((s) => {
      const col = COL[s.layer.key];
      s.top.map.dispose();
      s.top.map = faceTexture(s.layer, aniso);
      s.mats[0].color.copy(col.sideR);
      s.mats[4].color.copy(col.sideL);
      [1, 3, 5].forEach((k) => s.mats[k].color.copy(col.under));
      s.edgeMat.color.copy(col.edge);
      s.base.copy(col.trace);
      look(s);
    });
    edgeMats.forEach((m, i) => m.color.copy(COL[LAYERS[i].key].trace));
    viaMat.color.copy(COL.via);
    if (!running) paint();
  }

  return {
    setExplode(v) { explode = clamp01(v); },
    pulse(n = 1) { for (let i = 0; i < n; i++) spawn(i % vias.length); },
    recolor,
    destroy() {
      unregister();
      ambient = false;
      sync();
      io.disconnect();
      ro.disconnect();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('webglcontextlost', onLost);
      clearTimeout(handoff);
      // free the GPU side too: every geometry, material and face texture (shared ones once)
      const geoms = new Set([box, edgesGeo, edgeGeo]), materials = new Set([viaMat, ...edgeMats]);
      scene.traverse((o) => {
        if (o.geometry) geoms.add(o.geometry);
        [].concat(o.material || []).forEach((m) => materials.add(m));
      });
      geoms.forEach((g) => g.dispose());
      materials.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
      edges.forEach((e) => root.remove(e.m));
      edges.length = 0;
      renderer.dispose();
      stage.classList.remove('is-live', 'is-handoff');
    },
  };
}
