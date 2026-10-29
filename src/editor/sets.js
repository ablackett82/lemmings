// What the level editor knows about each of the DOS game's five graphic sets,
// beyond what's in the files: which pieces are steel (the files don't say;
// these are the ones the original levels put steel areas over), which are the
// organic lumps the lump brush scatters, which piece the paint brush takes
// its texture from, and the exit's top (an object of its own in the files,
// which the original levels always put at the same place over the exit).

import { WORLD_W, WORLD_H } from '../game/engine.js';

export const SETS = [
  { name: 'Dirt',    steel: [23, 24, 25, 26],  lumps: [0, 1, 2, 3, 10, 19, 20, 27],  texture: 10,  exitTop: [7, -8] },
  { name: 'Fire',    steel: [12, 13, 14, 15],  lumps: [9, 10, 16, 17, 18],           texture: 16, exitTop: [6, -24] },
  { name: 'Marble',  steel: [5, 57, 58, 59],   lumps: [25, 26, 55, 56],              texture: 21, exitTop: [6, -8] },
  { name: 'Pillar',  steel: [27, 48, 49, 50],  lumps: [21, 22, 31, 32, 33, 34],      texture: 51, exitTop: [6, -8] },
  { name: 'Crystal', steel: [31, 32, 33, 34],  lumps: [25, 26, 8, 11, 12, 28],       texture: 25, exitTop: [8, -8] },
];

/** One of the sets, chosen at random (the Random button on a new level). */
export function randomSet(rand = Math.random) {
  return Math.min(SETS.length - 1, Math.floor(rand() * SETS.length));
}

const textures = new WeakMap();

/**
 * The paint brush's texture for a set: the biggest solid rectangle inside its
 * texture piece, as { w, h, img } (colour indices 0..7), repeated mirrored so
 * the joins don't show.
 */
export function texture(dos, setNo) {
  const set = dos.set(setNo);
  let t = textures.get(set);
  if (t) return t;
  const p = set.pieces[SETS[setNo].texture];
  // less a margin: a piece's edges are shaded, and repeated they'd show as stripes
  const s0 = solidRect(p), m = Math.min(3, Math.floor((Math.min(s0.w, s0.h) - 4) / 2));
  const r = { x: s0.x + m, y: s0.y + m, w: s0.w - 2 * m, h: s0.h - 2 * m };
  const img = new Uint8Array(r.w * r.h);
  for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) img[j * r.w + i] = p.img[(r.y + j) * p.w + r.x + i];
  t = { w: r.w, h: r.h, img };
  // worked out once for the whole world: painting looks it up per pixel, many times over
  t.world = new Uint8Array(WORLD_W * WORLD_H);
  for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) t.world[y * WORLD_W + x] = texel(t, x, y);
  textures.set(set, t);
  return t;
}

/**
 * The texture's colour (0..7) at a world pixel. The world is split into
 * irregular patches (each pixel belongs to the nearest of a scatter of
 * points), and each patch shows the texture from a different place, so it
 * doesn't repeat in an obvious pattern. (Slow: texture().world has it for
 * every pixel.)
 */
function texel(t, x, y) {
  const C = 22, cx = Math.floor(x / C), cy = Math.floor(y / C);
  let best = Infinity, ox = 0, oy = 0;
  for (let j = cy - 1; j <= cy + 1; j++) for (let i = cx - 1; i <= cx + 1; i++) {
    const px = (i + hash(i, j, 1)) * C, py = (j + hash(i, j, 2)) * C;
    const d = (x - px) ** 2 + (y - py) ** 2;
    if (d < best) { best = d; ox = Math.floor(hash(i, j, 3) * t.w * 2); oy = Math.floor(hash(i, j, 4) * t.h * 2); }
  }
  const mx = (x + ox) % (t.w * 2), my = (y + oy) % (t.h * 2);
  const a = mx < t.w ? mx : t.w * 2 - 1 - mx, b = my < t.h ? my : t.h * 2 - 1 - my;
  return t.img[b * t.w + a];
}

function hash(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The largest rectangle of a piece that's solid all over (the histogram method). */
function solidRect({ w, h, mask }) {
  const heights = new Array(w).fill(0);
  let best = { x: 0, y: 0, w: 1, h: 1, area: 0 };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) heights[x] = mask[y * w + x] ? heights[x] + 1 : 0;
    const stack = [];
    for (let x = 0; x <= w; x++) {
      const hh = x < w ? heights[x] : 0;
      let start = x;
      while (stack.length && stack.at(-1)[1] >= hh) {
        const [sx, sh] = stack.pop();
        const area = sh * (x - sx);
        if (area > best.area) best = { x: sx, y: y - sh + 1, w: x - sx, h: sh, area };
        start = sx;
      }
      stack.push([start, hh]);
    }
  }
  return best;
}
