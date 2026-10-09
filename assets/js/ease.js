// The site's one motion: a second-order step response. Things rise fast,
// overshoot a little, ring once and settle, the way a signal does after a step.
// Use it for positions, scales and numbers, never for opacity or colour.
//
//   gsap.to(el, { y: 0, duration: 0.6, ease: ring() });
//   gsap.to(o, { v: 412, duration: 0.5, ease: ring(0.5), onUpdate: … });
//   el.style.transitionTimingFunction = ringCss();     // the same curve for CSS

// zeta 0.6 overshoots by about 9.5%; normalised so ring()(1) === 1
export function ring(zeta = 0.6, w = 6.5) {
  const wd = w * Math.sqrt(1 - zeta * zeta), k = zeta / Math.sqrt(1 - zeta * zeta);
  const f = (t) => 1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + k * Math.sin(wd * t));
  const end = f(1);
  return (t) => (t >= 1 ? 1 : t <= 0 ? 0 : f(t) / end);
}

// CSS linear() easing sampled from ring(); falls back to the site's ease-out where linear() isn't supported
export function ringCss(zeta = 0.6, w = 6.5, steps = 24) {
  const r = ring(zeta, w);
  const stops = Array.from({ length: steps + 1 }, (_, i) => +r(i / steps).toFixed(4));
  const css = `linear(${stops.join(', ')})`;
  return typeof CSS !== 'undefined' && CSS.supports && CSS.supports('transition-timing-function', css) ? css : 'cubic-bezier(0.16, 1, 0.3, 1)';
}
