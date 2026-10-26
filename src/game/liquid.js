// Water and lava that flow. Not in the original game (its water and fire are
// fixed traps), so never in the 120 levels; levels made in the editor can
// have them.
//
// The editor fills a hollow with liquid up to a level (fillLiquid). It stays
// there until something lets it out: a digger, basher, miner or bomber cutting
// into the hollow. Then it runs out of the hole, falls, runs down slopes,
// fills whatever hollow it comes to (only as deep as there's liquid for) and
// pours off the bottom of the level. A lemming it covers drowns (water) or
// burns (lava).
//
// Every pixel of liquid is a cell that moves on its own, each iteration:
// down if it can (several pixels), else down a diagonal, else along the row
// towards somewhere it can drop within reach. Then pressure: a cell with a
// gap beside it is a way out for the whole body of liquid it's part of, if
// the gap is below the body's surface. Liquid from the top of the body goes
// out through it (more, the deeper the gap is), so a hollow with a hole in its
// side gushes out of it and its surface goes down level, as water does. And
// where the body's surface is lower than its top (on the far side of a tunnel
// from a full hollow, say), liquid from the top comes up there, till it's level. Lava is thick: it falls slower, looks less far for a
// way down, and only oozes out of a hole.
//
// Only the 16x16 blocks where something moved last iteration (or the ground
// changed) are looked at, so liquid sitting in a hollow costs nothing. It's
// all whole numbers and a fixed order, so a game replays the same everywhere.

export const WATER = 1, LAVA = 2;
const W = 1600, H = 160;                   // the engine's WORLD_W, WORLD_H (engine.js imports this file, so not from there)
const CS = 16, CW = W / CS, CH = H / CS;   // the blocks
const MAX_FILL = 60000;                    // the most one hollow can hold (pixels)

// how each liquid moves: pixels it falls an iteration, how far along a row it
// looks for a way down, how far it goes along a row an iteration, and how
// often a push moves it sideways (every n iterations)
// often it's pushed out of a gap (every n iterations), and the most pixels a
// push sends out of one gap at once
const FLOW = {
  [WATER]: { fall: 3, reach: 12, run: 3, push: 1, jet: 6 },
  [LAVA]: { fall: 2, reach: 5, run: 1, push: 2, jet: 2 },
};

// ---- the editor: filling a hollow -------------------------------------------------

/**
 * The empty pixels joined (up, down, across) to (x, y) at or below row s: what
 * liquid with its surface at s fills. { cells: Int32Array of pixel indices,
 * n, leaks } — leaks: it reaches the bottom of the level (it would run out) or
 * is more than one hollow can hold. The level's sides are walls.
 */
export function region(pix, x, y, s, max = MAX_FILL) {
  const seen = new Uint8Array(W * H), cells = new Int32Array(max + 4);
  let n = 0;
  const start = y * W + x;
  if (x < 0 || x >= W || y < s || y < 0 || y >= H || pix[start]) return { cells, n: 0, leaks: true };
  seen[start] = 1; cells[n++] = start;
  for (let k = 0; k < n; k++) {
    const i = cells[k], cx = i % W, cy = (i - cx) / W;
    if (cy === H - 1) return { cells, n, leaks: true };
    const next = [cx > 0 ? i - 1 : -1, cx < W - 1 ? i + 1 : -1, cy > s ? i - W : -1, i + W];
    for (const j of next) {
      if (j < 0 || seen[j] || pix[j]) continue;
      seen[j] = 1;
      if (n >= max) return { cells, n, leaks: true };
      cells[n++] = j;
    }
  }
  return { cells, n, leaks: false };
}

/**
 * Where liquid put at (x, y) settles: up out of the ground if that's in it,
 * then down to the bottom of the hollow. { x, y } or null (no room there).
 */
export function seat(pix, x, y) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || x >= W) return null;
  y = Math.max(0, Math.min(H - 1, y));
  let up = 0;
  while (pix[y * W + x]) { if (--y < 0 || ++up > 40) return null; }
  while (y < H - 1 && !pix[(y + 1) * W + x]) y++;
  return { x, y };
}

/**
 * A liquid item from the level ({ x, y, s }: a point in the hollow and the
 * surface it's filled to): what it fills. If it would overflow at s, it's
 * filled to the brim instead (the highest it can be without running out).
 * { x, y (its bottom), s (the surface it really has), full (at the brim),
 *   cells, n } — n is 0 if it can't hold anything there (it would run out).
 */
export function fillLiquid(pix, it) {
  const p = seat(pix, it.x, it.y);
  if (!p) return { x: it.x, y: it.y, s: it.s, full: false, cells: null, n: 0 };
  const s0 = Math.max(0, Math.min(p.y, Math.round(it.s)));
  let r = region(pix, p.x, p.y, s0);
  if (!r.leaks) {
    const full = s0 === 0 || region(pix, p.x, p.y, s0 - 1).leaks;
    return { ...p, s: s0, full, cells: r.cells, n: r.n };
  }
  // too full: the brim, the highest surface that doesn't overflow
  let bad = s0, good = p.y + 1;
  r = region(pix, p.x, p.y, p.y);
  if (r.leaks) return { ...p, s: p.y, full: false, cells: null, n: 0 };
  good = p.y;
  let best = r;
  while (good - bad > 1) {
    const mid = (good + bad) >> 1, m = region(pix, p.x, p.y, mid);
    if (m.leaks) bad = mid; else { good = mid; best = m; }
  }
  return { ...p, s: good, full: true, cells: best.cells, n: best.n };
}

// ---- the game -----------------------------------------------------------------------

/** Sets a game up for liquid: g.wet (0, WATER or LAVA per pixel), from the level's. */
export function makeLiquid(g, start) {
  g.wet = new Uint8Array(start);
  g.wetMoved = new Uint32Array(W * H);     // the iteration each cell last moved
  g.wetAwake = new Int32Array(CW * CH).fill(1); // the last iteration each block needs looking at (all, the first time)
  g.wetBody = new Int32Array(W * H);       // which body of liquid a cell was found in (pressure), and
  g.wetSeq = 0;                            // the last body number given out
  g.wetHeld = new Int32Array(W * H);       // the iteration a cell was last found resting on the ground (or not: -it)
}

/**
 * Ground changed, or liquid moved, at (x, y): the liquid round it may move
 * now. It's looked at for a few iterations, until what moved counts as still
 * (still()) and the push through it (spread()) has had its go.
 */
export function stir(g, x, y) {
  const it = g.iteration + 4, a = g.wetAwake;
  const cx0 = Math.max(0, (x - 1) >> 4), cx1 = Math.min(CW - 1, (x + 1) >> 4);
  const cy0 = Math.max(0, (y - 1) >> 4), cy1 = Math.min(CH - 1, (y + 1) >> 4);
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) a[cy * CW + cx] = it;
}

/** The liquid's iteration. */
export function flowLiquid(g) {
  const wet = g.wet, pix = g.pix, moved = g.wetMoved, awake = g.wetAwake, it = g.iteration;
  const free = (x, y) => x >= 0 && x < W && y < H && !pix[y * W + x] && !wet[y * W + x];
  const move = (x, y, x2, y2) => {
    const i = y * W + x;
    if (y2 >= H) wet[i] = 0; // off the bottom
    else { const j = y2 * W + x2; wet[j] = wet[i]; wet[i] = 0; moved[j] = it; }
    stir(g, x, y); stir(g, x2, Math.min(H - 1, y2));
  };
  const pouring = (x, y) => x >= 0 && x < W && wet[y * W + x] && !still(g, y * W + x);
  const cols = [], edges = [];
  for (let cy = CH - 1; cy >= 0; cy--) {
    cols.length = 0;
    for (let cx = 0; cx < CW; cx++) if (awake[cy * CW + cx] >= it) cols.push(cx);
    if (!cols.length) continue;
    // bottom row first, so a column of it falls together; each row the other way from the last
    for (let y = cy * CS + CS - 1; y >= cy * CS; y--) {
      const dir = (it + y) & 1 ? 1 : -1;
      for (let c = 0; c < cols.length; c++) {
        const x0 = cols[dir > 0 ? c : cols.length - 1 - c] * CS;
        for (let k = 0; k < CS; k++) {
          const x = dir > 0 ? x0 + k : x0 + CS - 1 - k, i = y * W + x, kind = wet[i];
          if (!kind || moved[i] === it) continue;
          // down
          let ny = y;
          for (let n = 0; n < FLOW[kind].fall; n++) {
            if (ny + 1 >= H) { ny = H; break; }
            if (!free(x, ny + 1)) break;
            ny++;
          }
          if (ny !== y) { move(x, y, x, ny); continue; }
          // a gap beside it, above it or below a corner, or a stream going past: pushed out or up, or down or along (once everything's fallen, below)
          if (free(x + dir, y) || free(x - dir, y) || free(x + dir, y + 1) || free(x - dir, y + 1) || pouring(x + dir, y) || pouring(x - dir, y)
            || (y > 0 && free(x, y - 1))) edges.push(i, dir);
        }
      }
    }
  }
  if (edges.length) spread(g, edges, free, move);
}

/**
 * Liquid with a gap beside it or by its foot (edges: a cell, the way it looks
 * first). If a gap beside it is below the top of the body of liquid the cell is
 * part of, it's pushed out: liquid from the top of the body goes into the gap
 * and on along the row (more the deeper the gap is). If not, it's on top: down
 * a diagonal, or along the row towards the nearest way down within reach.
 * Only liquid that's been still a moment, resting on the ground (through the
 * liquid under it), is the body: a stream pouring in, or out, isn't. And the push only carries
 * through liquid held in at both sides (by ground or more liquid), so a
 * stream standing on the ground doesn't join up the liquid above and below.
 */
function spread(g, edges, free, move) {
  const wet = g.wet, moved = g.wetMoved, body = g.wetBody, it = g.iteration;
  const bodies = new Map(); // body number -> its top (findBody)
  for (let n = 0; n < edges.length; n += 2) {
    const i = edges[n], dir = edges[n + 1], kind = wet[i];
    if (!kind || moved[i] === it) continue;
    const x = i % W, y = (i - x) / W, f = FLOW[kind];
    const held = resting(g, i); // (it may be moving itself: the edge of a heap sliding down)
    const b = held ? bodies.get(body[i]) ?? findBody(g, i, kind, bodies) : null;
    const top = () => (b ? b.top() : -1);
    // a way out along the row: a gap, maybe through liquid already pouring out
    const way = (d) => {
      for (let k = 1; k <= f.jet + 4; k++) {
        const xx = x + d * k;
        if (xx < 0 || xx >= W || g.pix[y * W + xx]) return false;
        if (!wet[y * W + xx]) return true;
      }
      return false;
    };
    const t0 = top();
    if (t0 >= 0 && ((t0 / W) | 0) < y) {
      // pushed: out of a way out, or up (a lower part of its surface rises), or held where it is
      const d = way(dir) ? dir : way(-dir) ? -dir : 0;
      const up = !d && y - ((t0 / W) | 0) >= 2 && y > 0 && free(x, y - 1);
      if (!d && !up) continue;
      if ((it + x) % f.push) { stir(g, x, y); continue; } // lava: not this time, but soon
      if (up) {
        const t = b.take(), j = i - W;
        wet[j] = kind; wet[t] = 0; moved[j] = it;
        stir(g, t % W, (t / W) | 0); stir(g, x, y - 1);
        continue;
      }
      // a pixel out for every 3 deep, through what's already pouring out, until ground
      const n = Math.min(f.jet, 1 + (((y - ((t0 / W) | 0)) / 3) | 0));
      for (let k = 1, sent = 0; sent < n && k <= n + 4; k++) {
        const xx = x + d * k;
        if (xx < 0 || xx >= W || g.pix[y * W + xx]) break;
        if (wet[y * W + xx]) continue;
        const t = top();
        if (t < 0 || ((t / W) | 0) >= y) break;
        b.take(); sent++;
        const j = y * W + xx;
        wet[j] = kind; wet[t] = 0; moved[j] = it;
        stir(g, t % W, (t / W) | 0); stir(g, xx, y);
      }
      continue;
    }
    // on top: down a diagonal (not through a corner of ground)
    if (free(x + dir, y + 1) && !g.pix[i + dir]) { move(x, y, x + dir, y + 1); continue; }
    if (free(x - dir, y + 1) && !g.pix[i - dir]) { move(x, y, x - dir, y + 1); continue; }
    // or along the row to the nearest way down
    let best = 0, bestK = 0;
    for (const d of [dir, -dir]) {
      for (let k = 1; k <= f.reach && (!best || k < bestK); k++) {
        if (!free(x + d * k, y)) break;
        if (y + 1 >= H || free(x + d * k, y + 1)) { best = d; bestK = k; break; }
      }
    }
    if (best) move(x, y, x + best * Math.min(bestK, f.run), y);
  }
}

/** Liquid that hasn't moved for a moment: not part of a stream. */
const still = (g, i) => !g.wetMoved[i] || g.iteration - g.wetMoved[i] > 2;

/** Is liquid cell i resting on the ground, through the still liquid under it? (Worked out once an iteration.) */
function resting(g, i) {
  const { wet, pix, wetMoved: moved, wetHeld: held, iteration: it } = g;
  let j = i, v;
  for (;;) {
    if (held[j] === it || held[j] === -it) { v = held[j] > 0; break; }
    const below = j + W;
    if (below >= W * H) { v = false; break; }
    if (pix[below]) { v = true; break; }
    if (!wet[below] || !still(g, below)) { v = false; break; }
    j = below;
  }
  for (let k = i; ; k += W) { held[k] = v ? it : -it; if (k === j) break; }
  return v;
}

/**
 * The still liquid of a kind joined to cell i (numbered in g.wetBody), and
 * its top: top() the cell at the top that would go next (-1: none), take()
 * takes it. They come off the top row first, from the end of the row furthest
 * from i, so the surface goes down evenly.
 */
function findBody(g, i, kind, bodies) {
  const wet = g.wet, pix = g.pix, body = g.wetBody, id = ++g.wetSeq;
  const list = g.wetList ??= new Int32Array(W * H);
  let n = 0, x0 = W, x1 = 0, y0 = H;
  const add = (j) => {
    if (body[j] === id || wet[j] !== kind || !resting(g, j)) return; // (moving, it carries the push, but doesn't feed it: top())
    body[j] = id; list[n++] = j;
  };
  body[i] = id; list[n++] = i;
  for (let k = 0; k < n; k++) {
    const c = list[k], x = c % W, y = (c - x) / W;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    // the push carries on only through liquid held in at both sides (by ground or liquid)
    if (k && !((x === 0 || pix[c - 1] || wet[c - 1]) && (x === W - 1 || pix[c + 1] || wet[c + 1]))) continue;
    if (x > 0) add(c - 1);
    if (x < W - 1) add(c + 1);
    if (y > 0) add(c - W);
    if (y < H - 1) add(c + W);
  }
  const ix = i % W, step = ix - x0 > x1 - ix ? 1 : -1, far = step > 0 ? x0 : x1;
  let row = y0, cx = far, next = -1;
  const b = {
    top() {
      while (next < 0 && row < H) {
        if (cx < x0 || cx > x1) { row++; cx = far; continue; }
        const j = row * W + cx;
        cx += step;
        if (body[j] === id && wet[j] === kind && still(g, j)) next = j;
      }
      return next;
    },
    take() { const j = b.top(); next = -1; return j; },
  };
  bodies.set(id, b);
  return b;
}

/** A lemming covered by liquid: water up to its knees drowns it, any lava burns it. */
export function checkLiquid(g, L) {
  if (L.x < 0 || L.x >= W) return;
  let water = 0, lava = 0;
  for (let y = Math.max(0, L.y - 9); y < Math.min(H, L.y); y++) {
    const k = g.wet[y * W + L.x];
    if (k === WATER) water++; else if (k === LAVA) lava++;
  }
  if (!lava && water < 4) return;
  if (L.isBlocking) { L.isBlocking = false; g.restoreMap(L); }
  // it goes under where it is, its head at the surface
  let s = L.y - 1;
  while (s > 0 && g.wet[(s - 1) * W + L.x]) s--;
  L.y = Math.min(L.y, s + (lava ? 4 : 6));
  if (lava) { g.transition(L, 'vaporizing'); g.events.push('fry'); } else { g.transition(L, 'drowning'); g.events.push('drown'); }
}

// ---- drawing ------------------------------------------------------------------------

/** Each liquid's colours: its surface, froth (moving), body and deep, and how see-through each is. */
export const LIQUID_COLS = {
  [WATER]: [[170, 215, 255, 0.9], [215, 236, 255, 0.9], [40, 110, 230, 0.62], [24, 64, 180, 0.78]],
  [LAVA]: [[255, 244, 140, 1], [255, 200, 70, 1], [255, 112, 18, 0.95], [214, 52, 8, 0.97]],
};

/**
 * Which of its colours a liquid pixel (i: its index) is: 0 its surface (1, a
 * glint on it), 1 froth (it's moving; in lava, a bubble), 2 its body, 3
 * deeper down. t: the iteration (the glints and bubbles move with it).
 * moved: g.wetMoved, or null.
 */
export function liquidShade(wet, pix, moved, i, t) {
  const x = i % W;
  if (i < W || (!wet[i - W] && !pix[i - W])) return ((x + (t >> 1)) % (wet[i] === LAVA ? 9 : 14)) < 2 ? 1 : 0;
  if (moved && moved[i] && t - moved[i] < 3) return 1;
  // lava bubbles: a few bright pixels, here and there, rising
  if (wet[i] === LAVA) {
    let h = Math.imul(x, 374761393) ^ Math.imul((i / W) | 0, 668265263) ^ Math.imul(t >> 2, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    if (((h ^ (h >>> 16)) >>> 24) < 5) return 1;
  }
  return i >= 3 * W && wet[i - 3 * W] ? 3 : 2;
}
