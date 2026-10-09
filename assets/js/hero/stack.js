// The hero: an exploded isometric stack of the five layers this portfolio is
// organised by (Web, Apps, Algorithms, Systems, Metal). The top three are paper,
// like the sections they stand for; the bottom two are solder mask. Vias run
// through every slab and pulses travel down them like a request turning into
// electrons. Hover a slab to light it, click to jump to that layer.
//
// Matches the static SVG poster in index.html (same camera angle and slab
// layout), so the hand-off from poster to canvas is seamless.

import {
  WebGLRenderer, Scene, OrthographicCamera, Group, Mesh, BoxGeometry, EdgesGeometry, LineSegments,
  LineBasicMaterial, MeshBasicMaterial, CanvasTexture, SRGBColorSpace, Line, BufferGeometry,
  Float32BufferAttribute, Sprite, SpriteMaterial, Raycaster, Vector2, Vector3, Color,
} from 'three';

const LAYERS = [
  { id: 'l4', key: 'web', reg: 'L4', name: 'WEB' },
  { id: 'l3', key: 'apps', reg: 'L3', name: 'APPS' },
  { id: 'l2', key: 'algo', reg: 'L2', name: 'ALGORITHMS' },
  { id: 'l1', key: 'sys', reg: 'L1', name: 'SYSTEMS' },
  { id: 'l0', key: 'metal', reg: 'L0', name: 'METAL' },
];
// via positions on the unit face (u → +x, v → +z), inside the visible front band
const VIAS = [[0.86, 0.62], [0.62, 0.9], [0.93, 0.86]];

// The colours are the stylesheet's --slab-* tokens (the same ones the SVG poster
// uses), read once at start and again whenever the theme changes.
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
  const rgba = ([r, g, b]) => (a) => `rgba(${r},${g},${b},${a})`;
  const three = ([r, g, b], k = 1) => new Color().setRGB((r * k) / 255, (g * k) / 255, (b * k) / 255, SRGBColorSpace);
  const light = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b > 128;
  const P = {};
  LAYERS.forEach((l) => {
    const face = rgb(`--slab-${l.id}`), sideL = rgb(`--slab-${l.id}-l`), ink = rgb(`--slab-${l.id}-ink`);
    P[l.key] = {
      face: rgba(face)(1),
      dot: light(face) ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)',
      ink: rgba(ink),
      sideR: three(rgb(`--slab-${l.id}-r`)),
      sideL: three(sideL),
      under: three(sideL, 0.88),
      edge: three(ink),
    };
  });
  P.via = three(rgb('--via'));
  P.pulse = rgba(rgb('--pulse'));
  P.pulseRim = rgba(rgb('--pulse-rim'))(1);
  probe.remove();
  return P;
}
let COL = null;

const THICK = 0.11;
const SIZE = 2;
const ELEV = (30 * Math.PI) / 180;
const AZIM = (45 * Math.PI) / 180;

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/* ---------------------------------------------------------------- face textures (drawn once) */
function faceTexture(layer, maxAniso) {
  const N = 512;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  const s = N / 100; // design in a 100x100 square, same as the SVG poster
  const col = COL[layer.key];
  g.fillStyle = col.face;
  g.fillRect(0, 0, N, N);
  g.fillStyle = col.dot;
  for (let y = 4; y < 100; y += 4) for (let x = 4; x < 100; x += 4) g.fillRect(x * s - 1, y * s - 1, 2, 2);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const line = (a = 0.7, w = 1.1) => { g.strokeStyle = col.ink(a); g.lineWidth = w * s * 0.35; };
  const fill = (a = 0.55) => { g.fillStyle = col.ink(a); };
  const rect = (x, y, w, h, r = 0) => {
    g.beginPath();
    if (g.roundRect) g.roundRect(x * s, y * s, w * s, h * s, r * s); else g.rect(x * s, y * s, w * s, h * s);
  };

  switch (layer.key) {
    case 'web': {
      line(0.75); rect(8, 8, 84, 84, 3); g.stroke();
      g.beginPath(); g.moveTo(8 * s, 19 * s); g.lineTo(92 * s, 19 * s); g.stroke();
      fill(0.8); [14, 19, 24].forEach((x) => { g.beginPath(); g.arc(x * s, 13.5 * s, 1.6 * s, 0, 7); g.fill(); });
      fill(0.16); rect(15, 26, 70, 16, 1.5); g.fill();
      fill(0.7); rect(15, 26, 38, 4, 1); g.fill();
      fill(0.35); rect(15, 33, 26, 2.4, 1); g.fill();
      [15, 39, 63].forEach((x) => {
        line(0.6); rect(x, 50, 22, 34, 1.5); g.stroke();
        fill(0.16); rect(x + 3, 54, 16, 10, 1); g.fill();
        line(0.45); g.beginPath(); g.moveTo((x + 3) * s, 70 * s); g.lineTo((x + 17) * s, 70 * s); g.moveTo((x + 3) * s, 75 * s); g.lineTo((x + 12) * s, 75 * s); g.stroke();
      });
      break;
    }
    case 'apps': {
      line(0.75); rect(8, 8, 84, 84, 3); g.stroke();
      const lens = [34, 58, 22, 46, 70, 30, 52, 18, 62, 40, 26];
      lens.forEach((ln, i) => {
        const y = 18 + i * 7;
        line(0.9); g.beginPath(); g.moveTo(13 * s, y * s); g.lineTo(15 * s, y * s); g.stroke();
        line(0.5); g.beginPath(); g.moveTo(20 * s, y * s); g.lineTo((20 + ln) * s, y * s); g.stroke();
      });
      fill(0.9); rect(48, 85, 5, 4); g.fill();
      break;
    }
    case 'algo': {
      const r = 6.6;
      [3, 4, 5, 4, 3].forEach((n, row) => {
        for (let k = 0; k < n; k++) {
          const x = 50 + (k - (n - 1) / 2) * 2 * r * 0.98;
          const y = 50 + (row - 2) * 2 * r * 0.86;
          g.beginPath();
          for (let j = 0; j < 6; j++) {
            const a = (Math.PI / 3) * j + Math.PI / 6;
            const px = (x + r * 0.92 * Math.cos(a)) * s, py = (y + r * 0.92 * Math.sin(a)) * s;
            j ? g.lineTo(px, py) : g.moveTo(px, py);
          }
          g.closePath();
          if ((row * 5 + k) % 3 === 0) { fill(0.2); g.fill(); }
          line(0.65); g.stroke();
        }
      });
      // the solved board: 15 lines that each sum to 38
      g.fillStyle = col.ink(0.85);
      g.font = `500 ${3.6 * s}px "Mona Sans Mono", monospace`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const sol = [[3, 17, 18], [19, 7, 1, 11], [16, 2, 5, 6, 9], [12, 4, 8, 14], [10, 13, 15]];
      sol.forEach((rowv, row) => rowv.forEach((v, k) => {
        const n = rowv.length;
        g.fillText(String(v), (50 + (k - (n - 1) / 2) * 2 * r * 0.98) * s, (50 + (row - 2) * 2 * r * 0.86) * s);
      }));
      break;
    }
    case 'sys': {
      const n = 8, gap = 1.6, size = 9.5, start = (100 - (n * size + (n - 1) * gap)) / 2;
      const used = new Set([3, 4, 5, 11, 12, 20, 21, 22, 23, 30, 38, 39, 45, 46, 47, 54, 55, 60, 61, 62]);
      for (let i = 0; i < n * n; i++) {
        const x = start + (i % n) * (size + gap), y = start + Math.floor(i / n) * (size + gap);
        if (used.has(i)) { fill(0.55); rect(x, y, size, size, 0.8); g.fill(); }
        else { line(0.22); rect(x, y, size, size, 0.8); g.stroke(); }
      }
      // one chain, drawn through its blocks
      line(0.95, 1.4);
      g.beginPath();
      [20, 21, 22, 23, 30, 38, 39].forEach((i, k) => {
        const x = start + (i % n) * (size + gap) + size / 2, y = start + Math.floor(i / n) * (size + gap) + size / 2;
        k ? g.lineTo(x * s, y * s) : g.moveTo(x * s, y * s);
      });
      g.stroke();
      break;
    }
    case 'metal': {
      line(0.7); rect(10, 10, 80, 80, 2); g.stroke();
      fill(0.14); rect(34, 34, 32, 32, 1.5); g.fill();
      line(0.8); rect(34, 34, 32, 32, 1.5); g.stroke();
      fill(0.8);
      for (let k = 0; k < 7; k++) {
        const p = 16 + k * 11.3;
        [[p, 13], [p, 87], [13, p], [87, p]].forEach(([x, y]) => { rect(x - 1.8, y - 1.8, 3.6, 3.6); g.fill(); });
      }
      line(0.55);
      for (let k = 1; k < 6; k++) {
        const p = 16 + k * 11.3, q = 36 + (k - 1) * 7;
        g.beginPath();
        g.moveTo(p * s, 15 * s); g.lineTo(p * s, 24 * s); g.lineTo(q * s, 30 * s); g.lineTo(q * s, 34 * s);
        g.moveTo(p * s, 85 * s); g.lineTo(p * s, 76 * s); g.lineTo(q * s, 70 * s); g.lineTo(q * s, 66 * s);
        g.moveTo(85 * s, p * s); g.lineTo(76 * s, p * s); g.lineTo(70 * s, q * s); g.lineTo(66 * s, q * s);
        g.stroke();
      }
      // a lit 8 on the die, for the segment display
      fill(0.9);
      [[42, 39, 16, 2.4], [42, 49, 16, 2.4], [42, 59, 16, 2.4]].forEach(([x, y, w, h]) => { rect(x, y, w, h, 1); g.fill(); });
      [[40, 41, 2.4, 8], [58, 41, 2.4, 8], [40, 51, 2.4, 8], [58, 51, 2.4, 8]].forEach(([x, y, w, h]) => { rect(x - 0.2, y, w, h, 1); g.fill(); });
      break;
    }
  }

  // engraved register label along the front-left edge
  g.fillStyle = col.ink(0.9);
  g.font = `500 ${3.4 * s}px "Mona Sans Mono", monospace`;
  g.textAlign = 'right'; g.textBaseline = 'alphabetic';
  g.fillText(`${layer.reg} · ${layer.name}`, 96 * s, 98.2 * s);

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

// a pulse: a bright bead with a darker rim, readable on paper and on the board
function pulseTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const halo = g.createRadialGradient(32, 32, 10, 32, 32, 32);
  halo.addColorStop(0, COL.pulse(0.45));
  halo.addColorStop(1, COL.pulse(0));
  g.fillStyle = halo;
  g.fillRect(0, 0, 64, 64);
  g.beginPath(); g.arc(32, 32, 11, 0, 7);
  g.fillStyle = COL.pulse(1); g.fill();
  g.lineWidth = 3.5; g.strokeStyle = COL.pulseRim; g.stroke();
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x000000, 0);

  // the face textures use the mono font; make sure it's there before drawing
  try { await document.fonts.load('500 20px "Mona Sans Mono"'); } catch {}
  COL = readPalette();

  const scene = new Scene();
  const cam = new OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
  const R = 20;
  cam.position.set(R * Math.cos(ELEV) * Math.sin(AZIM), R * Math.sin(ELEV), R * Math.cos(ELEV) * Math.cos(AZIM));
  cam.lookAt(0, 0, 0);

  const root = new Group();
  scene.add(root);

  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const box = new BoxGeometry(SIZE, THICK, SIZE);
  const edgesGeo = new EdgesGeometry(box);
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
    const edges = new LineSegments(edgesGeo, edgeMat);
    mesh.add(edges);
    root.add(mesh);
    return { layer, mesh, mats, top, edgeMat, hot: 0, flash: 0, y: 0 };
  });

  // vias: vertical lines through all slabs
  const viaMat = new LineBasicMaterial({ color: COL.via, transparent: true, opacity: 0.45 });
  const vias = VIAS.map(([u, v]) => {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
    const ln = new Line(geo, viaMat);
    root.add(ln);
    return { x: -1 + 2 * u, z: -1 + 2 * v, geo };
  });

  // pulses
  let bead = pulseTexture();
  const pulses = [];
  const spawn = (viaIndex = Math.floor(Math.random() * vias.length)) => {
    if (pulses.length > 8) return;
    const mat = new SpriteMaterial({ map: bead, transparent: true, depthWrite: false, depthTest: false });
    const sp = new Sprite(mat);
    sp.scale.setScalar(0.13);
    root.add(sp);
    pulses.push({ sp, via: vias[viaIndex], t: 0, speed: 0.36 + Math.random() * 0.12, passed: new Set() });
  };

  /* ---------------- layout */
  // 1 = the resting, exploded layout (identical to the SVG poster); scrolling away compresses it
  let explode = 1;
  let explodeShown = 1; // eased value actually drawn
  const gapFor = (e) => lerp(0.16, 0.725, e);

  function layout() {
    const gap = gapFor(explodeShown);
    const step = gap + THICK;
    slabs.forEach((s, i) => { s.y = (2 - i) * step; });
    const yTop = slabs[0].y, yBot = slabs[slabs.length - 1].y;
    vias.forEach((v) => {
      const p = v.geo.attributes.position;
      p.setXYZ(0, v.x, yTop + THICK / 2, v.z);
      p.setXYZ(1, v.x, yBot - THICK / 2, v.z);
      p.needsUpdate = true;
      v.geo.computeBoundingSphere();
    });
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
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  /* ---------------- interaction */
  const ray = new Raycaster();
  const ndc = new Vector2(10, 10);
  let pointerIn = false;
  let hovered = -1;
  const tilt = { x: 0, y: 0, tx: 0, ty: 0 };

  function onMove(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    pointerIn = true;
    tilt.ty = ndc.x * 0.16;
    tilt.tx = -ndc.y * 0.05;
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
  }
  function onClick() {
    if (hovered >= 0) {
      onSelect && onSelect(LAYERS[hovered].id);
    } else {
      spawn();
    }
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

  /* ---------------- loop: only while visible */
  let running = false, visible = true, raf = 0, last = performance.now(), clock = 0, nextSpawn = 0.6;

  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    clock += dt;

    explodeShown = lerp(explodeShown, explode, 1 - Math.exp(-dt * 4));
    layout();

    tilt.x = lerp(tilt.x, tilt.tx, 1 - Math.exp(-dt * 5));
    tilt.y = lerp(tilt.y, tilt.ty, 1 - Math.exp(-dt * 5));
    root.rotation.set(tilt.x, tilt.y, 0);

    if (pointerIn) {
      ray.setFromCamera(ndc, cam);
      const hit = ray.intersectObjects(slabs.map((s) => s.mesh), false)[0];
      setHover(hit ? hit.object.userData.index : -1);
    }

    // pulses
    nextSpawn -= dt;
    if (nextSpawn <= 0) { spawn(); nextSpawn = 1.4 + Math.random() * 1.2; }
    const yTop = slabs[0].y + THICK, yBot = slabs[slabs.length - 1].y;
    for (let k = pulses.length - 1; k >= 0; k--) {
      const p = pulses[k];
      p.t += dt * p.speed;
      const y = lerp(yTop, yBot, p.t);
      p.sp.position.set(p.via.x, y, p.via.z);
      p.sp.material.opacity = p.t < 0.06 ? p.t / 0.06 : p.t > 0.94 ? (1 - p.t) / 0.06 : 1;
      slabs.forEach((s, i) => {
        if (!p.passed.has(i) && y <= s.y + THICK / 2) { p.passed.add(i); s.flash = 1; }
      });
      if (p.t >= 1) { root.remove(p.sp); p.sp.material.dispose(); pulses.splice(k, 1); }
    }

    // slab states
    slabs.forEach((s, i) => {
      const bob = Math.sin(clock * 0.9 + i * 0.8) * 0.012;
      s.mesh.position.y = s.y + bob;
      const target = hovered === -1 ? 0 : hovered === i ? 1 : -1;
      s.hot = lerp(s.hot, target, 1 - Math.exp(-dt * 8));
      s.flash = Math.max(0, s.flash - dt * 2.2);
      const b = 1 + Math.max(0, s.hot) * 0.35 + s.flash * 0.18 + Math.min(0, s.hot) * 0.24;
      s.top.color.setScalar(b);
      s.edgeMat.opacity = Math.min(1, 0.3 + Math.max(0, s.hot) * 0.6 + s.flash * 0.6 + Math.min(0, s.hot) * 0.15);
    });

    placeLabels();
    renderer.render(scene, cam);
    if (running) raf = requestAnimationFrame(frame);
  }

  function sync() {
    const should = visible && !document.hidden;
    if (should && !running) {
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    } else if (!should && running) {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }
  }
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; sync(); }, { rootMargin: '80px' });
  io.observe(stage);
  document.addEventListener('visibilitychange', sync);

  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stage.classList.remove('is-live'); running = false; });

  resize();
  layout();
  placeLabels();
  renderer.render(scene, cam);
  stage.classList.add('is-live');
  sync();

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
    });
    viaMat.color.copy(COL.via);
    const old = bead;
    bead = pulseTexture();
    pulses.forEach((p) => { p.sp.material.map = bead; p.sp.material.needsUpdate = true; });
    old.dispose();
    if (!running) renderer.render(scene, cam);
  }

  return {
    setExplode(v) { explode = clamp01(v); },
    pulse(n = 1) { for (let i = 0; i < n; i++) spawn(i % vias.length); },
    recolor,
    destroy() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', sync);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('click', onClick);
      renderer.dispose();
      stage.classList.remove('is-live');
    },
  };
}
