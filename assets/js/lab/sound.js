// The XY figure as sound: left channel is x, right channel is y, so the audio
// literally draws the picture on a real scope in XY mode (oscilloscope music).
// About 100 drawings a second, through a GainNode at 0.04. Two analysers read the
// output back so the screen can plot what is actually playing.
//
// Nothing here runs until enable() is called from a click or a typed command,
// which is when the AudioContext is made (browsers only allow it then anyway).

import { fillStereo } from './xymath.js';

const LEVEL = 0.04;
const DRAWINGS = 100;      // per second
const SEG = 10;            // drawings per buffer while the figure drifts (0.1 s)
const LEAD = 0.03;         // seconds of headroom when switching buffers

export function createSound() {
  let ctx = null, gain = null, anL = null, anR = null;
  let fig = null, rate = 0, n = 480;
  let cur = null;          // { src, start, dur, a0, dynamic }
  let playing = false;

  const supported = () => typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);

  // make the context; only from a user gesture
  function enable() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return true; }
    const AC = supported() && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return false;
    try {
      ctx = new AC();
      n = Math.max(64, Math.round(ctx.sampleRate / DRAWINGS));
      gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(ctx.destination);
      const split = ctx.createChannelSplitter(2);
      anL = ctx.createAnalyser(); anR = ctx.createAnalyser();
      anL.fftSize = anR.fftSize = 1024;
      split.connect(anL, 0); split.connect(anR, 1);
      gain._split = split;
      return true;
    } catch (e) {
      console.warn('lab: no audio', e);
      ctx = null;
      return false;
    }
  }

  function buffer(a0, frames) {
    const b = ctx.createBuffer(2, frames, ctx.sampleRate);
    fillStereo(fig, n, a0, rate, ctx.sampleRate, b.getChannelData(0), b.getChannelData(1));
    return b;
  }
  function source(buf, when) {
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true; // if a refill is ever late, the last buffer repeats instead of going silent
    s.connect(gain); s.connect(gain._split);
    s.start(when);
    return s;
  }
  // the next drawing boundary of what's playing, at least LEAD from now
  function boundary(period) {
    const now = ctx.currentTime + LEAD;
    if (!cur) return now;
    return cur.start + Math.max(1, Math.ceil((now - cur.start) / period)) * period;
  }

  // what to play: a figure, the drift rate in rad/s and the drift phase to start from
  function setFigure(f, driftRate = 0, a0 = 0) {
    fig = f; rate = f && f.dynamic ? driftRate : 0;
    if (playing) restart(a0);
  }
  function restart(a0 = 0) {
    if (!ctx || !fig) return;
    const dynamic = !!(fig.dynamic && rate);
    const frames = n * (dynamic ? SEG : 1);
    const when = boundary(n / ctx.sampleRate);
    if (cur) { try { cur.src.stop(when); } catch {} }
    const src = source(buffer(a0, frames), when);
    cur = { src, start: when, frames, dur: frames / ctx.sampleRate, a0, dynamic };
  }
  // keep a drifting figure's buffers coming; call often (every frame is fine)
  function pump() {
    if (!playing || !cur || !cur.dynamic || ctx.state !== 'running') return;
    const end = cur.start + cur.dur;
    if (ctx.currentTime < end - 0.15) return;
    const when = ctx.currentTime + LEAD > end ? boundary(n / ctx.sampleRate) : end;
    const a0 = cur.a0 + rate * (when - cur.start);
    const src = source(buffer(a0, cur.frames), when);
    try { cur.src.stop(when); } catch {}
    cur = { ...cur, src, start: when, a0 };
  }

  function play(a0 = 0) {
    if (!ctx || !fig) return false;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    playing = true;
    const t = ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.setTargetAtTime(LEVEL, t, 0.015); // a short fade, so it starts without a click
    restart(a0);
    return true;
  }
  function silence() {
    playing = false;
    if (!ctx) return;
    const t = ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.setTargetAtTime(0, t, 0.01);
    if (cur) { try { cur.src.stop(t + 0.08); } catch {} cur = null; }
  }
  // Run/Stop and hidden tabs: hold the sound card without forgetting what was playing
  function hold(on) {
    if (!ctx) return;
    if (on) ctx.suspend().catch(() => {});
    else if (playing) ctx.resume().catch(() => {});
  }

  // the analysers' latest samples, as interleaved x, y into out; returns the point count or 0
  let L = null, R = null;
  function read(out) {
    if (!playing || !anL || ctx.state !== 'running') return 0;
    const size = anL.fftSize;
    if (!L || L.length !== size) { L = new Float32Array(size); R = new Float32Array(size); }
    anL.getFloatTimeDomainData(L);
    anR.getFloatTimeDomainData(R);
    const m = Math.min(size, out.length >> 1);
    for (let i = 0; i < m; i++) { out[i * 2] = L[i]; out[i * 2 + 1] = R[i]; }
    return m;
  }

  return {
    supported, enable, setFigure, play, silence, hold, pump, read,
    get on() { return playing; },
    get ready() { return !!ctx; },
    get perDrawing() { return n; },
    get rate() { return ctx ? ctx.sampleRate : 0; },
  };
}
