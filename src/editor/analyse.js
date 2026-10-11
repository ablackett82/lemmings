// The editor's design aids, worked out by the engine itself:
//
// ghostRun: the level played with no skills given, fast: where every lemming
//   walks, and where and how each one ends up (home, splatted, drowned...).
// falls: every edge a lemming can walk off, where it lands, and whether it
//   lives. A lemming dies falling more than MAX_FALL (60) as the game counts
//   it, which, with the DOS quirks (a faller starts counting at 3), isn't
//   quite the drop in pixels, so each fall is found by dropping a lemming.

import { Game, Lemming, WORLD_W, WORLD_H } from '../game/engine.js';

const CAUSE = { exiting: 'home', splatting: 'splat', drowning: 'drown', vaporizing: 'fire' };

/**
 * { trails: [[x, y, x, y, ...] per lemming], ends: [{x, y, cause}], home,
 *   count, save, timeUp, iterations }. cause: home, splat, drown, fire,
 *   trap, out (fell off the bottom), stuck (still going when time ran out).
 */
export function ghostRun(level, maxIterations = 4000) {
  const g = new Game({ ...level, skills: {} }, { noTimeLimit: true });
  const trails = [], ends = [], last = [];
  while (!g.finished && g.iteration < maxIterations) {
    g.step();
    for (const L of g.lemmings) {
      const t = (trails[L.index] ??= []);
      if (L.removed) {
        if (last[L.index] !== undefined) {
          const was = last[L.index];
          ends.push({ x: L.x, y: Math.min(L.y, WORLD_H - 1), cause: CAUSE[was] ?? (L.y >= WORLD_H ? 'out' : 'trap') });
          last[L.index] = undefined;
        }
        continue;
      }
      last[L.index] = L.action;
      if (g.iteration % 2 === 0) t.push(L.x, L.y - 5);
    }
  }
  for (const L of g.lemmings) if (!L.removed) ends.push({ x: L.x, y: L.y, cause: 'stuck' });
  return { trails, ends, home: g.in, count: g.count, save: level.save, iterations: g.iteration };
}

/** A lemming walking from (x, y) towards dir: where it ends up after a fall. */
function drop(g, x, y, dir) {
  const L = new Lemming(0);
  g.lemmings = [L];
  L.x = x; L.y = y; L.dx = dir;
  g.transition(L, 'walking');
  let fell = false, guard = 400;
  while (guard--) {
    g.handleLemming(L);
    if (L.removed) return { x: L.x, y: WORLD_H + 4, dies: true, out: true };
    if (L.action === 'falling') fell = true;
    else if (fell) return { x: L.x, y: L.y, dies: L.action === 'splatting', fallen: L.fallen };
    else if (L.action !== 'walking' && L.action !== 'jumping') return null;
    if (!fell && Math.abs(L.x - x) > 2) return null; // walked on: not a fall from here
  }
  return null;
}

/**
 * Every place a lemming can walk off an edge and fall at least `min` pixels:
 * [{ x, y (the edge it walks off), dir, land: { x, y, dies, out } }].
 */
export function falls(level, pix, min = 12) {
  const g = new Game({ ...level, terrain: pix, objects: [], count: 1, skills: {} }, { noTimeLimit: true });
  const solid = (x, y) => x >= 0 && x < WORLD_W && y >= 0 && y < WORLD_H && pix[y * WORLD_W + x] !== 0;
  const out = [];
  for (let x = 0; x < WORLD_W; x++) {
    for (let y = 1; y < WORLD_H; y++) {
      // somewhere to stand: ground here, with room for a lemming above
      if (!solid(x, y) || solid(x, y - 1) || solid(x, y - 2) || solid(x, y - 3)) continue;
      for (const dir of [-1, 1]) {
        const nx = x + dir;
        let ground = false;
        for (let d = 0; d <= 3 && !ground; d++) ground = solid(nx, y + d);
        if (ground || nx < 0 || nx >= WORLD_W) continue;
        g.pix.set(pix);
        const land = drop(g, x, y, dir);
        if (land && land.y - y >= min) out.push({ x, y, dir, land });
      }
    }
  }
  return out;
}

/** The furthest a lemming can drop off a flat edge and live, in pixels (found by trying). */
export const SAFE_DROP = (() => {
  const W = WORLD_W, top = 20;
  for (let d = 40; d < 100; d++) {
    const pix = new Uint8Array(W * WORLD_H);
    for (let x = 0; x < 30; x++) pix[top * W + x] = 1;
    for (let x = 0; x < 80; x++) if (top + d < WORLD_H) pix[(top + d) * W + x] = 1;
    const g = new Game({ terrain: pix, palette: [], steel: [], objects: [], count: 1, save: 0, rate: 1, time: 9, skills: {} });
    const r = drop(g, 29, top, 1);
    if (!r || r.dies) return d - 1;
  }
  return 60;
})();
