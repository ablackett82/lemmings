// Builds a level made in the editor into what the engine plays, the same as
// DosData.build does for an original level: the set's pieces drawn in order,
// the paint and rubber brushes, the skill stamps, the steel and the objects.
//
// A skill stamp is made by the game itself: an invisible lemming is put where
// the stamp is and given the skill, and the engine runs it until it's done,
// so a staircase is exactly what a builder would lay (and stops where one
// would), and a tunnel exactly what a basher or miner would cut.

import { Game, Lemming, WORLD_W, WORLD_H } from '../game/engine.js';
import { BRICK, drawPiece, levelPalette } from '../dos/dosdata.js';
import { SETS, texture } from './sets.js';

export const STAMPS = ['build', 'bash', 'mine', 'dig', 'bomb'];
const SKILL = { build: 'building', bash: 'bashing', mine: 'mining', dig: 'digging' };

/** The objects a set has, with what each one is, for the editor's tray. */
export function objectKinds(dos, setNo) {
  const top = SETS[setNo].exitTop[0];
  return dos.set(setNo).objects.map((d, id) => d && id !== top && {
    id, w: d.w, h: d.h,
    kind: id === 1 ? 'entrance' : d.effect === 'exit' ? 'exit' : d.effect === 'trap' ? 'trap' : d.effect === 'water' ? 'water'
      : d.effect === 'fire' ? 'fire' : d.effect === 'oneWayLeft' ? 'left' : d.effect === 'oneWayRight' ? 'right' : 'deco',
  }).filter(Boolean);
}

/**
 * Where an object goes (its top) so that it stands on ground at groundY: for
 * an exit, so its trigger (which the game checks in 4-pixel steps) is where
 * the lemmings' feet are, as in the original levels.
 */
export function standY(dos, setNo, id, groundY) {
  const d = dos.set(setNo).objects[id];
  if (!d) return groundY;
  const y0 = groundY - d.h + 1;
  if (d.effect !== 'exit') return y0;
  const covers = (y) => { const top = (y & ~3) + d.trigger.y; return groundY >= top && groundY < top + d.trigger.h; };
  for (const dy of [0, 1, -1, 2, -2, 3, -3, 4, -4]) if (covers(y0 + dy)) return y0 + dy;
  return y0;
}

/**
 * An exit only takes lemmings in if its trigger (on the engine's 4-pixel grid)
 * covers the ground they walk on, so one that looks right can be a pixel or two
 * out (dragged, nudged). If there's ground just under it, the nearest y that works.
 */
function seatExit(pix, d, x, y) {
  const t = d.trigger;
  if (!t) return y;
  const cx = (x & ~3) + t.x + (t.w >> 1);
  if (cx < 0 || cx >= WORLD_W) return y;
  const covers = (yy, g) => { const top = (yy & ~3) + t.y; return g >= top && g < top + t.h; };
  const top = (y & ~3) + t.y;
  for (let g = Math.max(1, top - 4); g < Math.min(WORLD_H, top + t.h + 4); g++) {
    if (!pix[g * WORLD_W + cx] || pix[(g - 1) * WORLD_W + cx]) continue;
    if (covers(y, g)) return y;
    for (let dy = 1; dy <= 8; dy++) for (const yy of [y + dy, y - dy]) if (covers(yy, g)) return yy;
  }
  return y;
}

/**
 * spec (see format.js) → { level (for new Game()), boxes: per terrain item
 * its bounds {x, y, w, h}, ends: per stamp where the lemming finished }.
 */
export function buildCustom(spec, dos) {
  const set = dos.set(spec.set);
  const palette = levelPalette(set.custom);
  const pix = new Uint8Array(WORLD_W * WORLD_H);
  const steel = [];
  const steelPieces = new Set(SETS[spec.set].steel);
  const boxes = [], ends = [];
  const tex = texture(dos, spec.set);

  spec.terrain.forEach((it, n) => {
    let box = null;
    switch (it.k) {
      case 'piece': {
        const p = set.pieces[it.p];
        if (!p) break;
        drawPiece(pix, p, it.x, it.y, { flipV: it.fv, flipH: it.fh, behind: it.behind, erase: it.erase });
        box = { x: it.x, y: it.y, w: p.w, h: p.h };
        if (steelPieces.has(it.p) && !it.erase) steel.push({ ...box });
        break;
      }
      case 'paint': case 'erase':
        box = brush(pix, it, tex);
        break;
      case 'stamp': {
        const r = stamp(pix, it, steel, dos, palette);
        box = r.box; ends[n] = r.end;
        break;
      }
    }
    boxes.push(box);
  });

  const objects = [];
  for (const o of spec.objects) {
    const d = set.objects[o.id];
    if (!d) continue;
    const oneWay = d.effect === 'oneWayLeft' || d.effect === 'oneWayRight';
    const flags = 1 | (o.fv ? 0x80 : 0) | (o.behind ? 0x8000 : 0) | (oneWay ? 0x4000 : 0);
    const y = d.effect === 'exit' ? seatExit(pix, d, o.x, o.y) : o.y;
    objects.push(dos.placeObject(d, o.x, y, flags, palette));
    // an exit comes with its top, behind the terrain, as in the original levels
    const [topId, dy] = SETS[spec.set].exitTop;
    if (d.effect === 'exit' && set.objects[topId]) objects.push(dos.placeObject(set.objects[topId], o.x, y + dy, 1 | 0x8000, palette));
  }

  // the screen starts with the first entrance in the middle
  const ent = objects.find((o) => o.kind === 'entrance');
  const start = ent ? Math.max(0, Math.min(WORLD_W - 320, ent.x + 24 - 160)) : 0;

  const level = {
    dos, custom: true,
    name: spec.name || 'Untitled', rating: spec.author ? `by ${spec.author}` : 'New level', number: 0,
    rate: spec.rate, count: spec.count, save: spec.save, time: spec.time, skills: { ...spec.skills },
    start,
    terrain: pix, palette, steel, objects, oneway: [], brick: BRICK,
    frames: dos.frames, masks: dos.masks,
  };
  return { level, boxes, ends };
}

/**
 * A brush stroke ({ k: 'paint'|'erase', r, pts }): discs of radius r along the
 * points, from point `from` on (the editor paints a stroke as it's drawn, a
 * bit at a time: from the last point it painted). Returns the bounds of what
 * it painted.
 */
export function brush(pix, { k, r, pts }, tex, from = 0) {
  const erase = k === 'erase', world = tex.world;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const disc = (cx, cy) => {
    for (let y = Math.max(0, Math.ceil(cy - r)); y <= Math.min(WORLD_H - 1, Math.floor(cy + r)); y++) {
      for (let x = Math.max(0, Math.ceil(cx - r)); x <= Math.min(WORLD_W - 1, Math.floor(cx + r)); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) pix[y * WORLD_W + x] = erase ? 0 : 8 + world[y * WORLD_W + x];
      }
    }
  };
  for (let i = Math.max(0, from); i < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1] ?? pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / Math.max(1, r / 2)));
    for (let k = 0; k < n; k++) disc(ax + (bx - ax) * k / n, ay + (by - ay) * k / n);
    if (i === pts.length - 1) disc(ax, ay);
    x0 = Math.min(x0, ax); y0 = Math.min(y0, ay); x1 = Math.max(x1, ax); y1 = Math.max(y1, ay);
  }
  return { x: Math.floor(x0 - r), y: Math.floor(y0 - r), w: Math.ceil(x1 - x0 + 2 * r) + 1, h: Math.ceil(y1 - y0 + 2 * r) + 1 };
}

/**
 * A skill stamp, done by the engine: { s: 'build'|'bash'|'mine'|'dig'|'bomb',
 * x, y (the foot: the terrain pixel the lemming stands on), dir (1 right,
 * -1 left), n (staircases one after another) }.
 */
function stamp(pix, it, steel, dos, palette) {
  const g = new Game({
    terrain: pix, palette, steel, objects: [], count: 1, save: 0, rate: 1, time: 99, skills: {},
    brick: BRICK, masks: dos.masks,
  }, { noTimeLimit: true });
  const L = new Lemming(0);
  g.lemmings.push(L);
  L.x = it.x; L.y = it.y; L.dx = it.dir < 0 ? -1 : 1;
  g.transition(L, 'walking');
  let x0 = L.x, y0 = L.y, x1 = L.x, y1 = L.y;
  const grow = () => { x0 = Math.min(x0, L.x); y0 = Math.min(y0, L.y); x1 = Math.max(x1, L.x); y1 = Math.max(y1, L.y); };

  if (it.s === 'bomb') {
    g.applyMask(dos.masks.explode, false, L.x - 8, L.y - 14);
    pix.set(g.pix);
    return { box: { x: L.x - 8, y: L.y - 14, w: 16, h: 22 }, end: { x: L.x, y: L.y } };
  }
  const action = SKILL[it.s];
  const times = it.s === 'build' ? Math.max(1, Math.min(40, it.n ?? 1)) : 1;
  for (let k = 0; k < times; k++) {
    g.transition(L, action);
    let guard = 4000;
    while (L.action === action && !L.removed && guard--) { g.handleLemming(L); grow(); }
    if (it.s !== 'build') break;
    // a staircase that ended early (it hit something) doesn't go on
    if (L.action !== 'shrugging') break;
    while (L.action === 'shrugging' && guard--) g.handleLemming(L);
    if (L.action !== 'walking') break;
  }
  pix.set(g.pix);
  const pad = it.s === 'build' ? 2 : 10;
  return { box: { x: x0 - pad - 4, y: y0 - 14, w: x1 - x0 + 2 * pad + 8, h: y1 - y0 + 16 }, end: { x: L.x, y: L.y } };
}

/**
 * The whole level as RGBA (WORLD_W x WORLD_H): the objects at their first
 * frame, behind and in front of the terrain as the game draws them. With a
 * rect ({x, y, w, h}), only that part of out is redrawn.
 */
export function drawLevel(level, pix = level.terrain, out = new Uint8ClampedArray(WORLD_W * WORLD_H * 4), rect = null) {
  const rx0 = Math.max(0, rect ? rect.x : 0), ry0 = Math.max(0, rect ? rect.y : 0);
  const rx1 = Math.min(WORLD_W, rect ? rect.x + rect.w : WORLD_W), ry1 = Math.min(WORLD_H, rect ? rect.y + rect.h : WORLD_H);
  if (rx0 >= rx1 || ry0 >= ry1) return out;
  for (let y = ry0; y < ry1; y++) {
    for (let k = (y * WORLD_W + rx0) * 4, end = (y * WORLD_W + rx1) * 4; k < end; k += 4) { out[k] = out[k + 1] = out[k + 2] = 0; out[k + 3] = 255; }
  }
  const put = (x, y, r, g, b) => {
    if (x < rx0 || y < ry0 || x >= rx1 || y >= ry1) return;
    const k = (y * WORLD_W + x) * 4;
    out[k] = r; out[k + 1] = g; out[k + 2] = b;
  };
  const obj = (o) => {
    const p = o.def.draw(o.def.startFrame ?? 0);
    if (o.x >= rx1 || o.y >= ry1 || o.x + p.w <= rx0 || o.y + p.h <= ry0) return;
    for (let j = 0; j < p.h; j++) for (let i = 0; i < p.w; i++) {
      const k = (j * p.w + i) * 4, X = o.x + i, Y = o.y + j;
      if (!p.data[k + 3]) continue;
      if (o.onTerrain && (X < 0 || Y < 0 || X >= WORLD_W || Y >= WORLD_H || !pix[Y * WORLD_W + X])) continue;
      put(X, Y, p.data[k], p.data[k + 1], p.data[k + 2]);
    }
  };
  for (const o of level.objects) if (!o.front) obj(o);
  const pal = level.palette;
  for (let y = ry0; y < ry1; y++) {
    for (let i = y * WORLD_W + rx0, end = y * WORLD_W + rx1; i < end; i++) {
      const c = pix[i];
      if (!c) continue;
      const k = i * 4, col = pal[c];
      out[k] = col[0]; out[k + 1] = col[1]; out[k + 2] = col[2];
    }
  }
  for (const o of level.objects) if (o.front) obj(o);
  return out;
}
