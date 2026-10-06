// Builds a playable level from its description in levels.js: draws the
// terrain into the 1600x160 world, textures it in the level's style, and
// places the objects.
//
// Terrain shapes, drawn in order (each can take { erase: true } to cut away
// instead, or { mat: 'alt' } for the style's second material):
//   ['rect', x, y, w, h]          ['oval', cx, cy, rx, ry]
//   ['poly', [[x, y], ...]]       ['land', x, w, top, bottom, rough]
//   ['steel', x, y, w, h]         (indestructible: also marks the steel area)
// Objects, placed by where lemmings meet them:
//   ['entrance', x, y]   lemmings appear at (x, y)
//   ['exit', x, ground]  the doorway, standing on ground y
//   ['water', x, surface, tiles]    ['fire', x, surface, tiles]
//   ['trap', x, ground]
//   ['oneway', x, y, w, h, 'left' | 'right']  (arrows on the terrain there)

import { WORLD_W, WORLD_H } from './engine.js';
import { makeObjectDefs } from './objects.js';

export const BRICK = 64;   // palette 64..75: the builder's bricks, darker to lighter
export const STEEL = 80;   // palette 80..87: steel

export const STYLES = {
  earth: {
    ground: [[120, 72, 36], [140, 86, 44], [160, 100, 52], [104, 62, 30], [176, 118, 64], [90, 54, 28]],
    top: [[60, 170, 40], [40, 140, 30]],
    alt: [[130, 130, 140], [110, 110, 122], [150, 150, 160], [96, 96, 108]],
    brick: [200, 150, 90], pattern: 'earth',
  },
  rock: {
    ground: [[110, 110, 130], [126, 126, 146], [94, 94, 114], [140, 140, 160], [80, 80, 100], [150, 150, 170]],
    top: [[170, 170, 190], [150, 150, 170]],
    alt: [[150, 110, 70], [130, 94, 60], [170, 128, 84], [116, 82, 52]],
    brick: [200, 190, 160], pattern: 'rock', water: [20, 80, 180],
  },
  brick: {
    ground: [[170, 70, 50], [190, 84, 60], [150, 60, 44], [200, 100, 70], [130, 50, 36], [180, 76, 54]],
    top: [[210, 170, 120], [190, 150, 104]],
    alt: [[200, 180, 140], [180, 160, 120], [220, 200, 160], [160, 140, 104]],
    mortar: [90, 70, 60], brick: [230, 200, 120], pattern: 'brick', exitStone: [150, 150, 160],
  },
  crystal: {
    ground: [[130, 60, 170], [150, 76, 190], [110, 50, 150], [170, 100, 210], [96, 40, 130], [190, 130, 230]],
    top: [[230, 180, 255], [200, 150, 240]],
    alt: [[60, 160, 190], [70, 180, 210], [50, 140, 170], [90, 200, 230]],
    brick: [120, 230, 230], pattern: 'crystal', water: [40, 140, 220], exitStone: [120, 200, 220],
  },
  fire: {
    ground: [[120, 60, 40], [100, 48, 34], [140, 72, 48], [84, 40, 30], [150, 90, 50], [70, 34, 26]],
    top: [[230, 120, 40], [200, 90, 30]],
    alt: [[60, 60, 70], [74, 74, 86], [50, 50, 60], [90, 90, 100]],
    brick: [240, 180, 80], pattern: 'rock', exitStone: [110, 100, 100],
  },
};

const STEEL_COLS = [[120, 124, 136], [150, 154, 166], [100, 104, 116], [180, 184, 196], [80, 84, 96], [200, 204, 216], [134, 138, 150], [60, 64, 74]];

// a repeatable hash for textures
function hash(x, y, s = 0) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(x, y, scale, s = 0) {
  const fx = x / scale, fy = y / scale;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const a = hash(x0, y0, s), b = hash(x0 + 1, y0, s), c = hash(x0, y0 + 1, s), d = hash(x0 + 1, y0 + 1, s);
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/**
 * Builds a level: { terrain (palette indices), palette (RGB per index), steel,
 * objects, defs, count, save, rate, time, skills, brick, name, ... }
 */
export function buildLevel(spec) {
  const style = STYLES[spec.style] ?? STYLES.earth;
  const W = WORLD_W, H = WORLD_H;
  const mat = new Uint8Array(W * H); // 0 empty, 1 ground, 2 alt, 3 steel
  const steel = [];

  const plot = (x, y, m) => { if (x >= 0 && y >= 0 && x < W && y < H) mat[y * W + x] = m; };
  const fill = (test, x0, y0, x1, y1, o) => {
    const m = o?.erase ? 0 : o?.mat === 'alt' ? 2 : 1;
    for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
      if (test(x, y)) {
        if (m === 0 && o?.keepSteel && mat[y * W + x] === 3) continue;
        plot(x, y, m);
      }
    }
  };

  for (const sh of spec.terrain) {
    const [kind, ...a] = sh;
    switch (kind) {
      case 'rect': { const [x, y, w, h, o] = a; fill(() => true, x, y, x + w - 1, y + h - 1, o); break; }
      case 'oval': {
        const [cx, cy, rx, ry, o] = a;
        fill((x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1, Math.floor(cx - rx), Math.floor(cy - ry), Math.ceil(cx + rx), Math.ceil(cy + ry), o);
        break;
      }
      case 'poly': {
        const [pts, o] = a;
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        fill((x, y) => inside(pts, x + 0.5, y + 0.5), Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), o);
        break;
      }
      case 'land': {
        // a stretch of ground with a gently uneven top
        const [x, w, top, bottom, rough = 2, o] = a;
        const seed = x * 31 + top;
        fill((px, py) => py >= top + Math.round((noise(px, 0, 14, seed) - 0.5) * 2 * rough) - (rough ? Math.round(rough / 2) : 0) || false, x, top - rough * 2, x + w - 1, bottom, o);
        break;
      }
      case 'steel': {
        const [x, y, w, h] = a;
        for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) plot(i, j, 3);
        steel.push({ x, y, w, h });
        break;
      }
      default: throw new Error(`unknown terrain shape ${kind}`);
    }
  }

  // the palette: 1..6 ground, 7..8 top, 9..12 alt, 13 dark edge, 14 mortar, bricks, steel
  const palette = Array.from({ length: 256 }, () => [0, 0, 0]);
  style.ground.forEach((c, i) => { palette[1 + i] = c; });
  style.top.forEach((c, i) => { palette[7 + i] = c; });
  style.alt.forEach((c, i) => { palette[9 + i] = c; });
  palette[13] = style.ground[5].map((v) => v * 0.6);
  palette[14] = style.mortar ?? style.ground[4];
  for (let i = 0; i < 12; i++) palette[BRICK + i] = style.brick.map((v) => Math.max(0, Math.min(255, v + (i - 6) * 5)));
  STEEL_COLS.forEach((c, i) => { palette[STEEL + i] = c; });

  // texture it
  const terrain = new Uint8Array(W * H);
  const solid = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mat[y * W + x] !== 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const m = mat[y * W + x];
    if (!m) continue;
    let c;
    if (m === 3) c = steelPixel(x, y, steel);
    else if (m === 2) c = 9 + Math.floor(noise(x, y, 3, 5) * 3.99);
    else c = groundPixel(style.pattern, x, y);
    // edges: a lit top (grass on earth), a dark underside
    if (m !== 3) {
      if (!solid(x, y - 1) || (!solid(x, y - 2) && m === 1 && style.pattern === 'earth')) c = m === 2 ? 11 : 7 + (hash(x, y, 9) < 0.3 ? 1 : 0);
      else if (!solid(x, y + 1)) c = 13;
    }
    terrain[y * W + x] = c;
  }

  // objects
  const defs = makeObjectDefs(style);
  const objects = [];
  const oneway = [];
  for (const [kind, ...a] of spec.objects) {
    const def = defs[kind];
    switch (kind) {
      case 'entrance': objects.push({ kind, x: a[0] - 24, y: a[1] - 14, def }); break;
      case 'exit': objects.push({ kind, x: a[0] - 20, y: a[1] - 26, def }); break;
      case 'trap': objects.push({ kind, x: a[0] - 12, y: a[1] - 36, def }); break;
      case 'water': case 'fire':
        for (let i = 0; i < (a[2] ?? 1); i++) objects.push({ kind, x: a[0] + i * 32, y: a[1] - 3, def, front: true });
        break;
      case 'oneway': {
        const [x, y, w, h, dir] = a;
        const o = { kind, x, y, def: { w, h, frames: 1, trigger: { effect: dir === 'left' ? 'oneWayLeft' : 'oneWayRight', x: x - (x & ~3), y: y - (y & ~3), w, h } }, dir };
        oneway.push(o); objects.push(o);
        break;
      }
      default: throw new Error(`unknown object ${kind}`);
    }
  }

  return {
    ...spec,
    terrain, palette, steel, objects, oneway, defs, style,
    brick: BRICK,
    skills: { ...spec.skills },
  };
}

function groundPixel(pattern, x, y) {
  switch (pattern) {
    case 'brick': {
      const row = Math.floor(y / 6), off = (row & 1) * 6;
      if (y % 6 === 5 || (x + off) % 12 === 11) return 14;
      return 1 + Math.floor(hash(Math.floor((x + off) / 12), row, 3) * 3) * 2 + (noise(x, y, 2, 4) > 0.75 ? 1 : 0);
    }
    case 'rock': {
      const n = noise(x, y, 9, 1) * 0.7 + noise(x, y, 3, 2) * 0.3;
      if (Math.abs(noise(x, y, 11, 7) - 0.5) < 0.025) return 13; // cracks
      return 1 + Math.min(5, Math.floor(n * 6));
    }
    case 'crystal': {
      const facet = Math.floor((x + y * 0.6) / 7) * 7 + Math.floor((x - y * 0.8) / 9) * 3;
      const v = hash(facet, 0, 6);
      return 1 + Math.min(5, Math.floor(v * 6 * 0.7 + noise(x, y, 2, 2) * 1.8));
    }
    default: { // earth: soil with stones
      if (noise(x, y, 5, 8) > 0.78) return 9 + Math.floor(noise(x, y, 2, 3) * 3.99);
      const n = noise(x, y, 6, 1) * 0.6 + hash(x, y, 2) * 0.4;
      return 1 + Math.min(5, Math.floor(n * 6));
    }
  }
}

function steelPixel(x, y, steel) {
  // plates with a bevel and rivets, aligned to the steel area they're part of
  const s = steel.findLast((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) ?? { x: 0, y: 0 };
  const px = (x - s.x) % 16, py = (y - s.y) % 16;
  if (px === 0 || py === 0) return STEEL + 3;
  if (px === 15 || py === 15) return STEEL + 4;
  if ((px === 3 || px === 12) && (py === 3 || py === 12)) return STEEL + 5;
  return STEEL + ((px + py) % 7 === 0 ? 1 : 0);
}

function inside(pts, x, y) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
