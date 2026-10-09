// Each layer's waveform, as functions of phase u (in cycles), returning -1..1.
// They match the CSS traces under the layer headings (site.css, --wave), so the
// hero, the readouts and the lab draw the same signals the headings do.
//   l4 sine   l3 triangle   l2 sawtooth   l1 square   l0 a data stream
// The CSS tiles are 120 units wide; one cycle is 60 (l4, l1), 30 (l3, l2) or
// the whole 120-unit tile (l0, whose bits are 4 units each).

export const CHANNELS = ['l4', 'l3', 'l2', 'l1', 'l0'];

// the l0 tile, 4 units per bit: H8 V6 H16 V22 H36 V6 H44 V22 H52 V6 H76 V22 H96 V6 H104 V22 H120
export const BITS = [0, 0, 1, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0];

const frac = (u) => u - Math.floor(u);

export const WAVES = {
  l4: (u) => Math.sin(2 * Math.PI * u),
  l3: (u) => 1 - 4 * Math.abs(frac(u + 0.25) - 0.5),
  l2: (u) => 2 * frac(u) - 1,
  l1: (u) => (frac(u) < 0.5 ? 1 : -1),
  l0: (u) => (BITS[Math.floor(frac(u) * BITS.length)] ? 1 : -1),
};

// cycles of each wave in one 120-unit CSS tile, so a canvas can match a heading's trace
export const CYCLES_PER_TILE = { l4: 2, l3: 4, l2: 4, l1: 2, l0: 1 };

// the channel colours from the CSS tokens, as '#rrggbb' strings keyed by layer id
export function channelColors(root = document.documentElement) {
  const cs = getComputedStyle(root);
  return Object.fromEntries(CHANNELS.map((id) => [id, cs.getPropertyValue(`--ch-${id}`).trim()]));
}
