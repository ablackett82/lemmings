// The lemmings' animations, drawn here pixel by pixel (the originals live in
// DOS MAIN.DAT and aren't included). Every animation has the DOS frame count,
// frame size and foot position from engine.js's ANIM table, so the lemmings
// line up with the terrain exactly as the originals do.
//
// A frame is { w, h, fx, fy, data } with data a palette index per pixel
// (0 = see-through). Each animation is drawn facing right and mirrored about
// the foot for facing left.

import { ANIM } from './engine.js';

// the lemmings' colours
export const LEM_PALETTE = [
  null,
  [0, 200, 40],     // 1 hair
  [70, 90, 240],    // 2 robe
  [240, 210, 190],  // 3 skin
  [255, 255, 255],  // 4 white
  [150, 100, 50],   // 5 wood (handles)
  [170, 170, 190],  // 6 metal (pick, shovel blade)
  [255, 120, 20],   // 7 flame
  [255, 230, 60],   // 8 yellow (flame core, sparks)
  [230, 40, 40],    // 9 red (umbrella)
  [200, 160, 110],  // 10 brick in hand
  [140, 140, 140],  // 11 grey (smoke)
];
const H = 1, B = 2, S = 3, W = 4, WD = 5, M = 6, F = 7, Y = 8, R = 9, BR = 10, G = 11;

class Frame {
  constructor(w, h, fx, fy) { this.w = w; this.h = h; this.fx = fx; this.fy = fy; this.data = new Uint8Array(w * h); }
  /** Plot relative to the foot: (0, -1) is the pixel right above the ground under the lemming. */
  p(dx, dy, c) {
    const x = this.fx + dx, y = this.fy + dy;
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.data[y * this.w + x] = c;
  }
  line(x0, y0, x1, y1, c) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= n; i++) this.p(Math.round(x0 + (x1 - x0) * i / (n || 1)), Math.round(y0 + (y1 - y0) * i / (n || 1)), c);
  }
  mirror() {
    const m = new Frame(this.w, this.h, this.fx, this.fy);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const c = this.data[y * this.w + x];
      if (!c) continue;
      const mx = 2 * this.fx - x;
      if (mx >= 0 && mx < this.w) m.data[y * this.w + mx] = c;
    }
    return m;
  }
}

/**
 * The lemming, facing right. y is how far the body is raised (0 = standing),
 * legs [back, front] are foot x offsets (and an optional lift), arms [back,
 * front] are hand positions relative to the shoulder.
 */
function body(f, o = {}) {
  const x = o.x ?? 0, y = o.y ?? 0;
  const legs = o.legs ?? [[0, 0], [0, 0]];
  const arms = o.arms ?? [[0, 3], [1, 3]];
  const top = -10 + y;
  // legs: from the hip (row -3) down to the foot
  if (!o.noLegs) {
    for (const [lx, lift = 0] of legs) {
      f.line(x, top + 7, x + lx, -1 - lift + y, B);
    }
  }
  // robe
  for (let r = top + 4; r <= top + 7; r++) { f.p(x - 1, r, B); f.p(x, r, B); }
  // head: face to the front, hair over the top and back
  f.p(x, top + 2, S); f.p(x + 1, top + 2, S);
  f.p(x, top + 3, S); f.p(x + 1, top + 3, S);
  f.p(x - 1, top + 2, H); f.p(x - 1, top + 3, H);
  f.p(x - 1, top, H); f.p(x, top, H); f.p(x - 1, top + 1, H); f.p(x, top + 1, H); f.p(x + 1, top + 1, H);
  if (o.tuft) f.p(x - 2, top + 1 + (o.tuft > 1 ? 1 : 0), H);
  // arms: from the shoulder, skin at the hand
  for (const [ax, ay] of arms) {
    const sx = x, sy = top + 4;
    f.line(sx, sy, sx + ax, sy + ay, B);
    f.p(sx + ax, sy + ay, S);
  }
}

const frame = (action, extra = {}) => {
  const a = ANIM[action];
  const w = extra.w ?? (action === 'exploding' ? 32 : 16);
  const h = extra.h ?? heights[action];
  return new Frame(w, h, a.fx, a.fy);
};
// frame heights (DOS MAIN.DAT's)
const heights = {
  walking: 10, jumping: 10, digging: 14, climbing: 12, drowning: 10, hoisting: 12, building: 13,
  bashing: 10, mining: 13, falling: 10, floating: 16, splatting: 10, exiting: 13, vaporizing: 14,
  blocking: 10, shrugging: 8 + 2, ohnoing: 10, exploding: 32,
};

const WALK_LEGS = [[-1, 1], [-1, 2], [0, 1], [1, 0], [1, -1], [2, -1], [1, 0], [0, 0]];
const WALK_ARMS = [[1, 3], [0, 3], [-1, 3], [-1, 3], [-1, 3], [0, 3], [1, 3], [1, 3]];

const DRAW = {
  walking(i) {
    const f = frame('walking');
    const [b, fr] = WALK_LEGS[i];
    const bob = i === 1 || i === 5 ? -1 : 0;
    body(f, { y: bob, legs: [[b, b === 2 ? 1 : 0], [fr, fr === 2 ? 1 : 0]], arms: [WALK_ARMS[i], [-WALK_ARMS[i][0] + 1, 3]], tuft: (i >> 1) & 1 ? 1 : 2 });
    return f;
  },
  jumping() {
    const f = frame('jumping');
    body(f, { y: -1, legs: [[-1, 1], [1, 1]], arms: [[-1, 1], [2, 1]], tuft: 2 });
    return f;
  },
  falling(i) {
    const f = frame('falling');
    const up = i & 1;
    body(f, { y: 0, legs: [[-1, 0], [1, 1]], arms: [[-2, -3 + up], [2, -3 - up + 1]], tuft: 1 + up });
    return f;
  },
  climbing(i) {
    // hands and feet on the wall in front (2 to the right)
    const f = frame('climbing');
    const ph = i & 3, high = i < 4;
    const y = -(i % 4 === 3 ? 1 : 0) - (high ? 0 : 1);
    body(f, { x: 0, y: y - 1, legs: [[1, 0], [1, 1 + (ph & 1)]], arms: [[1, -2 - (ph & 1)], [1, -1 + (ph & 1)]], tuft: 1 });
    return f;
  },
  hoisting(i) {
    const f = frame('hoisting');
    const y = Math.max(-2, -i);
    if (i < 5) body(f, { y: y + 1, legs: [[0, 0], [1, 1]], arms: [[2, -2], [2, -2]], tuft: 1 });
    else body(f, { y: 0, legs: [[0, i - 4], [2, 0]], arms: [[1, 2], [2, 2]], tuft: 1 });
    return f;
  },
  building(i) {
    // kneels, takes a brick, lays it at frame 9, stands and steps
    const f = frame('building');
    const kneel = i >= 6 && i <= 12 ? 1 : 0;
    const reach = i >= 7 && i <= 10;
    body(f, { y: kneel, legs: [[-1, 0], [1, kneel]], arms: reach ? [[3, 3], [3, 4]] : [[0, 3], [1, 3]], tuft: 1 + (i & 1) });
    if (!reach && i < 7) { f.p(-1, -6 + kneel, BR); f.p(0, -6 + kneel, BR); } // the brick in hand
    if (reach) { f.p(3, -1, BR); f.p(4, -1, BR); }
    return f;
  },
  bashing(i) {
    // 0..15 and 16..31: punches at 2..5, steps at 11..15
    const f = frame('bashing');
    const k = i & 15;
    let arms;
    if (k < 2) arms = [[-1, 1], [0, 1]];
    else if (k <= 5) arms = [[2 + (k - 2), 1 - ((k & 1) << 1)], [3 + (k - 2), 2 - (k & 1)]];
    else if (k <= 10) arms = [[1, 2], [2, 2]];
    else arms = [[1, 3], [2, 3]];
    const legs = k >= 11 ? WALK_LEGS[(k - 11) % 8] : [-1, 1];
    body(f, { legs: [[legs[0]], [legs[1]]], arms, tuft: 1 + (i >> 4) });
    return f;
  },
  mining(i) {
    // swings the pick up over the head, down in front (frames 1..2), steps (3, 15)
    const f = frame('mining');
    const k = i % 12;
    const down = i === 1 || i === 2 || i === 13 || i === 14;
    const up = (k >= 5 && k <= 11) || i === 0;
    const y = i >= 3 && i < 15 ? 0 : 1;
    if (down) {
      body(f, { y, legs: [[-1, 0], [1, 0]], arms: [[3, 2], [3, 2]], tuft: 1 });
      f.line(3, -6 + y + 2, 5, -1 + y, WD); f.p(5, 0 + y, M); f.p(6, -1 + y, M); f.p(4, 0 + y, M);
    } else if (up) {
      body(f, { y, legs: [[-1, 0], [1, 0]], arms: [[0, -3], [1, -3]], tuft: 2 });
      f.line(0, -9 + y, -3, -12 + y, WD); f.p(-4, -12 + y, M); f.p(-2, -12 + y, M); f.p(-3, -13 + y, M);
    } else {
      body(f, { y, legs: [[-1, 0], [1, 0]], arms: [[1, 1], [2, 1]], tuft: 1 });
      f.line(2, -5 + y, 4, -8 + y, WD); f.p(5, -8 + y, M); f.p(4, -9 + y, M);
    }
    return f;
  },
  digging(i) {
    // bent over, both hands on the shovel, throwing earth up at 0 and 8
    const f = frame('digging');
    const k = i & 7;
    const y = k < 4 ? 0 : 1;
    body(f, { y: y + 1, legs: [[-1, 0], [1, 0]], arms: [[1, 4 - (k < 4 ? 1 : 0)], [2, 4 - (k < 4 ? 1 : 0)]], tuft: 1 + (i >> 3) });
    f.line(2, -2 + y, 2, 1, WD); f.p(1, 1, M); f.p(2, 1, M); f.p(3, 1, M);
    if (k === 1 || k === 2) { f.p(-2 - k, -6 - k, WD); f.p(3 + k, -7 - k, WD); }
    return f;
  },
  floating(i) {
    // 0..3 opening the umbrella, 4..7 floating
    const f = frame('floating');
    body(f, { y: 0, legs: [[0, 0], [1, 0]], arms: [[1, -4], [1, -4]], tuft: 1 });
    f.line(1, -11, 1, -14, WD);
    const open = i < 4 ? i + 1 : 4;
    const sway = i >= 4 ? [0, 1, 0, -1][i - 4] : 0;
    for (let x = -open; x <= open; x++) {
      const yy = -15 + (Math.abs(x) >= open - 1 && open > 1 ? 1 : 0);
      f.p(1 + x + sway, yy, (x + 9) & 1 ? R : W);
      if (Math.abs(x) < open - 1) f.p(1 + x + sway, yy - 1, (x + 9) & 1 ? R : W);
    }
    return f;
  },
  splatting(i) {
    const f = frame('splatting');
    if (i < 4) {
      // squashed flat, getting flatter
      const w = 2 + i;
      for (let x = -w; x <= w; x++) { f.p(x, -1, B); if (Math.abs(x) < w - 1) f.p(x, -2, B); }
      f.p(-1, -3 + (i >> 1), H); f.p(0, -3 + (i >> 1), H); f.p(1, -3 + (i >> 1), S);
    } else {
      // pieces scattering and fading
      const k = i - 4, n = 12 - k;
      if (n > 0) for (let j = 0; j < 6; j++) {
        const d = 1 + (k >> 1) + (j >> 1);
        if (j < n / 2) f.p(j & 1 ? d : -d, -1 - ((k * (j + 1)) % 3 === 0 && k < 6 ? 1 : 0), [H, B, S, B, H, S][j]);
      }
    }
    return f;
  },
  exiting(i) {
    // jumps for joy, then goes in
    const f = frame('exiting');
    const y = [0, -1, -2, -3, -2, -1, 0, 0][i];
    if (i < 6) body(f, { y, legs: [[-1, i ? 1 : 0], [1, i ? 1 : 0]], arms: [[-2, -4], [2, -4]], tuft: 2 });
    else if (i === 6) body(f, { y: 1, legs: [[0, 0], [0, 0]], arms: [[0, 2], [1, 2]], noLegs: true });
    return f;
  },
  vaporizing(i) {
    // burns up: flames rise and the lemming shrinks away
    const f = frame('vaporizing');
    const fade = Math.min(10, i);
    if (i < 6) body(f, { y: 0, legs: [[-1, 0], [1, 0]], arms: [[-2, -3 + (i & 1)], [2, -4 + (i & 1)]], tuft: 2 });
    for (let j = 0; j < 8; j++) {
      const x = ((j * 5 + i * 3) % 7) - 3, y = -1 - ((j * 3 + i * 2) % (4 + fade));
      if (y > -14) f.p(x, y, j & 1 ? F : Y);
    }
    if (i >= 6) for (let j = 0; j < 4; j++) f.p(((j * 3 + i) % 5) - 2, -3 - j - (i - 6), G);
    return f;
  },
  blocking(i) {
    // arms out, tapping a foot
    const f = frame('blocking');
    const tap = (i >> 2) & 1;
    body(f, { legs: [[-1, 0], [1, tap]], arms: [[-4, 1 - ((i >> 3) & 1)], [4, 1 - ((i >> 3) & 1)]], tuft: 1 + tap });
    return f;
  },
  shrugging(i) {
    const f = frame('shrugging');
    const up = i >= 2 && i <= 5;
    body(f, { legs: [[-1, 0], [1, 0]], arms: up ? [[-3, -1], [3, -1]] : [[-2, 2], [2, 2]], tuft: up ? 2 : 1 });
    return f;
  },
  ohnoing(i) {
    // hands on head, shaking
    const f = frame('ohnoing');
    const shake = i < 12 ? ((i >> 1) & 1 ? 1 : -1) : 0;
    body(f, { x: shake > 0 ? 0 : 0, y: 0, legs: [[-1, 0], [1, 0]], arms: [[-2, -4 + (i & 1)], [2, -4 + ((i + 1) & 1)]], tuft: shake > 0 ? 2 : 1 });
    return f;
  },
  drowning(i) {
    // sinking, waving
    const f = frame('drowning');
    const sink = Math.min(8, i >> 1);
    if (sink < 8) body(f, { y: sink, legs: [[0, 0], [0, 0]], arms: [[-2, -4 + (i & 1)], [2, -5 + ((i + 1) & 1)]], tuft: 2 });
    return f;
  },
  exploding() {
    // the burst
    const f = frame('exploding');
    for (let a = 0; a < 24; a++) {
      const t = a / 24 * Math.PI * 2, r = a & 1 ? 9 : 13;
      f.line(0, -6, Math.round(Math.cos(t) * r), Math.round(-6 + Math.sin(t) * r), a % 3 === 0 ? Y : F);
    }
    for (let y = -10; y <= -2; y++) for (let x = -4; x <= 4; x++) if (x * x + (y + 6) * (y + 6) < 18) f.p(x, y, Y);
    for (let y = -8; y <= -4; y++) for (let x = -2; x <= 2; x++) if (x * x + (y + 6) * (y + 6) < 5) f.p(x, y, W);
    return f;
  },
};

/** frames[action][0 = right, 1 = left][i] */
export function makeLemmingFrames() {
  const out = {};
  for (const action of Object.keys(ANIM)) {
    const n = ANIM[action].frames;
    const right = [];
    for (let i = 0; i < n; i++) right.push(DRAW[action](i));
    out[action] = [right, right.map((f) => f.mirror())];
  }
  return out;
}

/** The countdown digits over a bomber's head: 5..1, 3x5 each. */
export const DIGITS = {
  1: ['010', '110', '010', '010', '111'],
  2: ['110', '001', '010', '100', '111'],
  3: ['110', '001', '010', '001', '110'],
  4: ['101', '101', '111', '001', '001'],
  5: ['111', '100', '110', '001', '110'],
};
