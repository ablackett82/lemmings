// The gadgets: flip boards and cannons. Not in the original game, so never in
// the 120 levels; levels made in the editor can have them.
//
// Flip board: a sprung plank on the ground. A lemming walking onto it is
// flung into the air the way the board points, at its angle and power.
//
// Cannon: a little gun carriage that crawls along the ground, round corners
// and up walls, staying square to whatever it's on (it drops off anything
// that would leave it upside down, and falls if the ground under it goes).
// The player drives and aims it. A lemming walking into an empty one climbs
// in (up the side of the carriage and over into the barrel), it counts 3, 2,
// 1, and fires it out of the barrel; the rest walk on past a loaded one.
//
// Flying (both): the lemming's position in 1/256 pixels, gravity, and the
// game's own fall rule on landing (more than 60 below the top of its arc
// splats; a floater opens its umbrella 16 down). Everything here is whole
// numbers, sin and cos from a table, so a game replays the same everywhere.
//
// Angles are degrees, anticlockwise from pointing right (y up, as in maths).

import { WORLD_W, WORLD_H } from './engine.js';

export const GADGETS = ['flip', 'cannon'];

const FX = 256;                 // flying positions are in 1/256 pixels
const GRAVITY = 64;             // a quarter of a pixel per iteration, per iteration
const MAX_VY = 8 * FX;
const MAX_FALL = 60;            // the engine's MAX_FALLDISTANCE
const MAX_X = 1647, MAX_Y = 163, HEAD_MIN_Y = -5;
const COUNT = 12;               // iterations per number of a cannon's 3, 2, 1
const CRAWL = 2;                // pixels a cannon moves an iteration
const TURN = 3;                 // degrees a cannon's barrel turns an iteration
const CLIMB = 8, HOIST = 6;     // iterations climbing a cannon's side, then over into the barrel

// sin and cos, x4096, a whole degree at a time
const SIN = Array.from({ length: 360 }, (_, d) => Math.round(Math.sin(d * Math.PI / 180) * 4096));
const sin = (d) => SIN[((d % 360) + 360) % 360];
const cos = (d) => sin(d + 90);

/** How fast a power (1..10) sends a lemming, in 1/256 pixels an iteration. */
const speed = (pow) => 512 + 154 * pow;

/** Is there ground at (x, y)? For cannons the level's edges count as ground. */
function solid(pix, x, y) {
  if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) return true;
  return pix[y * WORLD_W + x] !== 0;
}

// ---- setting up -------------------------------------------------------------------

/**
 * The gadgets as a game (or the editor's picture) starts them, from the
 * level's list: flip { x, y (the ground the lemmings walk on), dir, ang,
 * pow }, cannon { x, y (the ground it sits on), aim, pow }.
 */
export function makeGadgets(list, pix) {
  return list.map((d) => {
    if (d.k === 'flip') {
      // on the ground: up out of it, or down onto it
      let y = d.y;
      if (solid(pix, d.x, y)) while (y > 0 && solid(pix, d.x, y - 1)) y--;
      else while (y < WORLD_H - 1 && !solid(pix, d.x, y)) y++;
      return { ...d, y, frame: 0 };
    }
    const c = { ...d, y: d.y - 1, h: 0, ang: 90, load: null, timer: 0, cool: 0, drive: 0, turn: 0, falling: false };
    // the empty pixel just above the ground there
    while (c.y > 0 && solid(pix, c.x, c.y)) c.y--;
    if (!touching(pix, c)) c.falling = true;
    else c.ang = upAngle(pix, c);
    return c;
  });
}

// ---- each iteration ---------------------------------------------------------------

/** The gadgets move on an iteration: cannons drive, turn, fall and fire; boards spring back. */
export function updateGadgets(g) {
  for (const c of g.gadgets) {
    if (c.k === 'flip') { if (c.frame && ++c.frame > 8) c.frame = 0; continue; }
    if (c.cool) c.cool--;
    c.aim = Math.max(0, Math.min(180, c.aim + c.turn * TURN));
    if (c.falling || !touching(g.pix, c)) fall(g.pix, c);
    else if (c.drive) for (let k = 0; k < CRAWL; k++) crawl(g.pix, c, c.drive);
    if (!c.falling) {
      const up = upAngle(g.pix, c);
      // upside down (under something): it drops off
      if (sin(up) < -1800) { c.falling = true; fall(g.pix, c); } else c.ang = towards(c.ang, up, 15);
    }
    const L = c.load;
    if (!L) continue;
    if (L.removed || L.action !== 'incannon') { c.load = null; continue; }
    if (L.boarding) { board(c, L); if (!L.boarding) g.events.push('tick'); continue; }
    L.x = c.x; L.y = c.y;
    c.timer--;
    if (c.timer > 0 && c.timer % COUNT === 0) g.events.push('tick');
    if (c.timer <= 0) fire(g, c);
  }
}

/** After a lemming moves: onto a flip board, or into (or up against) a cannon. */
export function checkGadgets(g, L) {
  if (L.action !== 'walking') return;
  for (const c of g.gadgets) {
    if (c.k === 'flip') {
      if (Math.abs(L.x - c.x) > 4 || Math.abs(L.y - c.y) > 2) continue;
      c.frame = 1;
      L.dx = c.dir;
      launch(g, L, L.x, L.y, c.dir > 0 ? c.ang : 180 - c.ang, c.pow);
      g.events.push('boing');
      return;
    }
    if (c.falling || Math.abs(L.x - c.x) > 8 || Math.abs(L.y - 1 - c.y) > 3) continue;
    if (!c.load && !c.cool) {
      c.load = L; c.timer = 3 * COUNT;
      g.transition(L, 'incannon');
      // it climbs in from where it is, beside the carriage (kept relative to the cannon, which may be driven meanwhile)
      L.boarding = CLIMB + HOIST; L.bx = L.x - c.x; L.by = L.y - c.y;
      return;
    }
  }
}

/**
 * Climbing in, an iteration of it: up the side of the carriage on its own
 * side (drawn climbing), then over the top into the barrel (drawn hoisting).
 * L.look and L.frame say how to draw it; once L.boarding is 0 it's inside.
 */
function board(c, L) {
  const k = CLIMB + HOIST - L.boarding--;
  const ux = sin(c.ang), uy = cos(c.ang), nx = cos(c.ang), ny = -sin(c.ang); // along the ground, and up from it (x4096)
  const side = L.bx * ux + L.by * uy < 0 ? -1 : 1;
  const top = { x: Math.round((side * 6 * ux + 8 * nx) / 4096), y: Math.round((side * 6 * uy + 8 * ny) / 4096) };
  const into = { x: Math.round(7 * nx / 4096), y: Math.round(7 * ny / 4096) };
  let x, y;
  if (k < CLIMB) {
    const t = k + 1;
    x = L.bx + Math.round((top.x - L.bx) * t / CLIMB); y = L.by + Math.round((top.y - L.by) * t / CLIMB);
    L.look = 'climbing'; L.frame = k % 8;
  } else {
    const t = k - CLIMB + 1;
    x = top.x + Math.round((into.x - top.x) * t / HOIST); y = top.y + Math.round((into.y - top.y) * t / HOIST);
    L.look = 'hoisting'; L.frame = Math.min(7, k - CLIMB + 1);
  }
  L.x = c.x + x; L.y = c.y + y;
}

/** Boom: the lemming inside comes out of the barrel. */
function fire(g, c) {
  const L = c.load;
  c.load = null; c.cool = 6;
  const m = muzzle(c);
  launch(g, L, m.x, m.y + 4, m.dir, c.pow);
  g.events.push('boom');
}

/** The number a loaded cannon is showing (3, 2, 1), or 0. */
export const countdown = (c) => (c.load && !c.load.boarding ? Math.ceil(c.timer / COUNT) : 0);

/** Where a cannon's barrel ends, and which way it points. */
export function muzzle(c) {
  const dir = c.ang - 90 + c.aim;
  return {
    x: c.x + Math.round((cos(c.ang) * 6 + cos(dir) * 13) / 4096),
    y: c.y - Math.round((sin(c.ang) * 6 + sin(dir) * 13) / 4096),
    dir,
  };
}

/** Where a gadget sends a lemming from, and which way: for the editor's aiming line. */
export function launchPoint(c) {
  if (c.k === 'flip') return { x: c.x, y: c.y, dir: c.dir > 0 ? c.ang : 180 - c.ang };
  const m = muzzle(c);
  return { x: m.x, y: m.y + 4, dir: m.dir };
}

// ---- flying ---------------------------------------------------------------------

/** Sends a lemming flying from (x, y) at angle dir. */
export function launch(g, L, x, y, dir, pow) {
  g.transition(L, 'flying');
  L.x = x; L.y = y;
  L.fx = x * FX; L.fy = y * FX;
  const v = speed(pow);
  L.vx = Math.trunc(v * cos(dir) / 4096);
  L.vy = -Math.trunc(v * sin(dir) / 4096);
  L.apex = y;
  if (L.vx) L.dx = Math.sign(L.vx);
}

/** A flying lemming's iteration. True means check objects (water, exits...). */
export function fly(g, L) {
  L.vy = Math.min(MAX_VY, L.vy + GRAVITY);
  const tx = L.fx + L.vx, ty = L.fy + L.vy;
  const x0 = L.x, y0 = L.y, nx = tx >> 8, ny = ty >> 8;
  const n = Math.max(Math.abs(nx - x0), Math.abs(ny - y0));
  let hit = false;
  for (let i = 1; i <= n && !hit; i++) {
    const x1 = x0 + Math.round((nx - x0) * i / n), y1 = y0 + Math.round((ny - y0) * i / n);
    // going up: up first, then across; coming down: across, then down
    const order = L.vy < 0 ? ['y', 'x'] : ['x', 'y'];
    for (const axis of order) {
      if (axis === 'x' && x1 !== L.x) {
        if (x1 < 0 || x1 > MAX_X) { L.vx = -L.vx; L.dx = -L.dx; hit = true; break; }
        if (g.hasPixel(x1, L.y)) {
          // the foot's caught something: a lip to hop over, somewhere to land, or a wall
          let k = 1;
          while (k <= 3 && g.hasPixel(x1, L.y - k)) k++;
          if (k <= 3 && L.vy >= 0) { L.x = x1; L.y = L.y - k + 1; return land(g, L); }
          if (k <= 3) L.y -= k;
        }
        if (g.hasPixel(x1, L.y) || g.hasPixel(x1, L.y - 5) || g.hasPixel(x1, L.y - 8)) {
          if (L.isClimber) { L.x = x1; g.transition(L, 'climbing'); return true; }
          hit = true; L.vx = 0; break;
        }
        L.x = x1;
      } else if (axis === 'y' && y1 !== L.y) {
        if (y1 > L.y) {
          if (g.hasPixel(L.x, y1)) { L.y = y1; return land(g, L); }
          L.y = y1;
          if (L.y > MAX_Y) { g.removeLemming(L); return false; }
        } else {
          if (y1 - 10 < HEAD_MIN_Y || g.hasPixel(L.x, y1 - 9)) { hit = true; L.vy = 0; break; }
          L.y = y1;
        }
      }
    }
  }
  if (hit) { L.fx = L.x * FX + 128; L.fy = L.y * FX; } else { L.fx = tx; L.fy = ty; }
  L.apex = Math.min(L.apex, L.y);
  if (L.isFloater && L.vy > 0 && L.y - L.apex > 16) g.transition(L, 'floating');
  return true;
}

function land(g, L) {
  L.fallen = L.y - L.apex;
  g.transition(L, L.fallen > MAX_FALL && !g.assist.safeFalls ? 'splatting' : 'walking');
  return true;
}

// ---- a cannon on the ground -----------------------------------------------------

// the four ways a cannon can be heading, clockwise on the screen
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

/** Is any of the 8 pixels round it ground? */
function touching(pix, c) {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && solid(pix, c.x + dx, c.y + dy)) return true;
  return false;
}

/**
 * One pixel along the ground: side 1 keeps the ground on its right (on flat
 * ground, that's going right), -1 on its left. A wall follower: c.h is the
 * way it was going (for side 1; side -1 goes the opposite way along the same
 * path), and it stays in empty pixels with ground beside it.
 */
function crawl(pix, c, side) {
  let h = side > 0 ? c.h : (c.h + 2) % 4;
  for (let k = 0; k < 4; k++) {
    const r = (h + (side > 0 ? 1 : 3)) % 4;
    const [rx, ry] = DIRS[r], [fx, fy] = DIRS[h];
    if (!solid(pix, c.x + rx, c.y + ry)) { h = r; c.x += rx; c.y += ry; break; }
    if (!solid(pix, c.x + fx, c.y + fy)) { c.x += fx; c.y += fy; break; }
    h = (h + (side > 0 ? 3 : 1)) % 4;
  }
  c.h = side > 0 ? h : (h + 2) % 4;
}

/** Falling: 3 pixels an iteration until there's ground under it, then on it, the right way up. */
function fall(pix, c) {
  c.falling = true;
  for (let k = 0; k < 3; k++) {
    if (solid(pix, c.x, c.y + 1)) { c.falling = false; c.h = 0; c.ang = 90; return; }
    c.y++;
  }
}

/** Which way is up, off the ground round it: away from the ground within 4 pixels, to the nearest 5 degrees. */
function upAngle(pix, c) {
  let sx = 0, sy = 0;
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    if (dx * dx + dy * dy <= 16 && solid(pix, c.x + dx, c.y + dy)) { sx -= dx; sy += dy; }
  }
  // sx, sy: away from the ground, y up
  let best = 90, bestDot = -Infinity;
  for (let d = 0; d < 360; d += 5) {
    const dot = sx * cos(d) + sy * sin(d);
    if (dot > bestDot) { bestDot = dot; best = d; }
  }
  return best;
}

/** From angle a towards b, at most step degrees, the short way round. */
function towards(a, b, step) {
  const d = ((b - a + 540) % 360) - 180;
  return (a + Math.max(-step, Math.min(step, d)) + 360) % 360;
}

/** The cannon at a point in the level (for tapping it), or -1. */
export function cannonAt(gadgets, x, y, r = 12) {
  let best = -1, bd = r * r;
  gadgets.forEach((c, i) => {
    if (c.k !== 'cannon') return;
    const cx = c.x + cos(c.ang) * 6 / 4096, cy = c.y - sin(c.ang) * 6 / 4096;
    const d = (x - cx) ** 2 + (y - cy) ** 2;
    if (d <= bd) { bd = d; best = i; }
  });
  return best;
}

// ---- drawing --------------------------------------------------------------------

const WOOD = [156, 98, 46], WOOD_DK = [104, 62, 30], IRON = [64, 66, 78], IRON_HI = [150, 156, 172];
const TYRE = [36, 36, 40], HUB = [214, 178, 64], PLANK = [214, 56, 40], STRIPE = [255, 214, 70], SPRING = [180, 186, 200];

/** The bounds of a gadget as the editor places it (spec coordinates). */
export function gadgetBox(d) {
  return d.k === 'flip' ? { x: d.x - 10, y: d.y - 16, w: 21, h: 17 } : { x: d.x - 12, y: d.y - 24, w: 25, h: 25 };
}

/** Draws a gadget with put(x, y, [r, g, b]) in level pixels. */
export function drawGadget(c, put) {
  if (c.k === 'flip') return drawFlip(c, put);
  // the carriage's own frame: s along the ground (the way side 1 goes), t up from it
  const a = c.ang * Math.PI / 180, ux = Math.sin(a), uy = Math.cos(a), nx = Math.cos(a), ny = -Math.sin(a);
  const b = c.aim * Math.PI / 180, bs = Math.cos(b), bt = Math.sin(b);
  for (let j = -16; j <= 16; j++) for (let i = -16; i <= 16; i++) {
    const s = i * ux + j * uy, t = i * nx + j * ny;
    // the barrel, from its pivot
    const r = (s - 0) * bs + (t - 6) * bt, q = -(s - 0) * bt + (t - 6) * bs;
    let col = null;
    if (r >= -2 && r <= 13 && Math.abs(q) <= (r >= 10.5 ? 2.3 : 1.6)) col = Math.abs(q) < 0.6 && r < 10 ? IRON_HI : IRON;
    else if (Math.hypot(s - 4, t - 2) <= 2.3 || Math.hypot(s + 4, t - 2) <= 2.3) col = Math.hypot(s - 4, t - 2) <= 0.9 || Math.hypot(s + 4, t - 2) <= 0.9 ? HUB : TYRE;
    else if (s >= -6.5 && s <= 6.5 && t >= 2.5 && t <= 7) col = t > 6 ? WOOD_DK : WOOD;
    if (col) put(c.x + i, c.y + j, col);
  }
}

function drawFlip(c, put) {
  const f = c.frame, lift = f === 0 ? 10 : f <= 3 ? c.ang * f / 3 : c.ang * (8 - f) / 5;
  const a = Math.max(10, lift) * Math.PI / 180, dir = c.dir;
  // the base plate on the ground
  for (let i = -8; i <= 8; i++) put(c.x + i, c.y - 1, SPRING);
  // the plank, hinged at the back
  const hx = c.x - dir * 7, hy = c.y - 2, ex = dir * Math.cos(a), ey = -Math.sin(a);
  for (let k = 0; k <= 15; k++) {
    const x = Math.round(hx + ex * k), y = Math.round(hy + ey * k);
    put(x, y, PLANK);
    put(x, y - 1, k % 4 < 2 ? STRIPE : PLANK);
  }
  // the spring, from the plate up to the plank's front half
  const sx = Math.round(hx + ex * 11), sy = Math.round(hy + ey * 11);
  for (let y = sy + 1, k = 0; y < c.y - 1; y++, k++) put(sx + (k % 2 ? 1 : -1), y, SPRING);
  // an arrow on the plate, the way it throws
  put(c.x + dir * 3, c.y - 2, STRIPE); put(c.x + dir * 2, c.y - 3, STRIPE);
}
