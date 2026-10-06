// The level objects: entrance hatch, exit, water, fire, traps and one-way
// arrows. Each has its frames (drawn here, RGBA), its animation and its
// trigger area, which goes into the engine's object map. The trigger areas
// work as on DOS (4x4-pixel cells, from the object's position rounded down to
// a multiple of 4).

// an object's frames are drawn on a little canvas of palette colours
class Pic {
  constructor(w, h) { this.w = w; this.h = h; this.data = new Uint8ClampedArray(w * h * 4); }
  p(x, y, c) {
    if (!c || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = c[0]; this.data[i + 1] = c[1]; this.data[i + 2] = c[2]; this.data[i + 3] = 255;
  }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.p(x + i, y + j, c); }
}

const shade = (c, k) => c.map((v) => Math.max(0, Math.min(255, Math.round(v * k))));

/** The objects, each { w, h, frames, continuous, startFrame, trigger, draw: (frame) => Pic } */
export function makeObjectDefs(style) {
  const metal = style.metal ?? [150, 150, 170];
  const wood = style.wood ?? [140, 90, 40];
  return {
    // the hatch the lemmings drop out of: frame 1 is shut, 2..9 opening, 0 open
    // (as on DOS, so it stays open once the animation is over). Lemmings appear
    // at (x + 24, y + 14).
    entrance: {
      w: 48, h: 25, frames: 10, startFrame: 1,
      draw(f) {
        const p = new Pic(48, 25);
        const open = f === 0 ? 8 : f === 1 ? 0 : f - 1; // 0 shut .. 8 open
        // the frame round the hatch
        p.rect(4, 0, 40, 4, shade(wood, 1.1)); p.rect(4, 0, 40, 1, shade(wood, 1.4));
        p.rect(4, 4, 4, 14, wood); p.rect(40, 4, 4, 14, wood);
        p.rect(8, 4, 32, 2, shade(wood, 0.6));
        for (let x = 6; x < 44; x += 8) p.p(x, 2, shade(metal, 1.2));
        // the dark inside
        p.rect(8, 6, 32, 12, [16, 10, 8]);
        // the two doors, swinging down
        const dh = Math.round(12 * (8 - open) / 8) + 2;
        const len = 16;
        for (const side of [0, 1]) {
          for (let i = 0; i < len; i++) {
            const t = open / 8;
            const x = side ? 39 - Math.round(i * (1 - t * 0.9)) : 8 + Math.round(i * (1 - t * 0.9));
            const y = 17 + Math.round(i * t * 0.45);
            for (let k = 0; k < (open < 8 ? Math.max(1, dh - 12 + 2) : 2); k++) p.p(x, y + k, shade(wood, i % 4 === 0 ? 0.7 : 1));
          }
        }
        if (open === 0) { p.rect(8, 6, 32, 12, shade(wood, 0.9)); for (let x = 9; x < 40; x += 4) p.rect(x, 7, 1, 10, shade(wood, 0.65)); p.rect(23, 6, 2, 12, shade(wood, 0.5)); }
        return p;
      },
    },
    // the exit: a little house with a doorway and two torches. A lemming whose
    // foot is in the doorway goes in.
    exit: {
      w: 40, h: 32, frames: 6, continuous: true,
      trigger: { effect: 'exit', x: 16, y: 24, w: 8, h: 8 },
      draw(f) {
        const p = new Pic(40, 32);
        const stone = style.exitStone ?? [170, 140, 110];
        // roof
        for (let y = 0; y < 10; y++) p.rect(20 - y * 2 - 1, y + 2, y * 4 + 2, 1, shade([200, 60, 40], 1 - y * 0.03));
        // walls and dark doorway
        p.rect(6, 12, 28, 20, stone);
        for (let y = 12; y < 32; y += 4) for (let x = 6 + ((y >> 2) & 1) * 3; x < 34; x += 6) p.rect(x, y, 1, 4, shade(stone, 0.75));
        for (let y = 15; y < 32; y += 4) p.rect(6, y, 28, 1, shade(stone, 0.75));
        p.rect(13, 16, 14, 16, [10, 6, 4]);
        for (let x = 13; x < 27; x++) p.p(x, 15, shade(stone, 0.6));
        p.rect(14, 15, 12, 1, [10, 6, 4]); p.rect(15, 14, 10, 1, [10, 6, 4]);
        // torches with flickering flames
        for (const tx of [3, 36]) {
          p.rect(tx, 16, 1, 6, [110, 70, 30]);
          const fl = [[255, 220, 60], [255, 140, 20], [230, 60, 20]];
          const hgt = 3 + ((f + (tx >> 2)) % 3);
          for (let y = 0; y < hgt; y++) p.p(tx + ((f + y) % 3 === 0 ? (tx < 20 ? -1 : 1) * 0 : 0), 15 - y, fl[Math.min(2, y >> 1)]);
          p.p(tx - 1, 14, fl[1]); p.p(tx + 1, 14 - (f & 1), fl[2]);
        }
        return p;
      },
    },
    // water: 32 wide, rippling. Anything that reaches the trigger drowns.
    water: {
      w: 32, h: 16, frames: 8, continuous: true,
      trigger: { effect: 'water', x: 0, y: 4, w: 32, h: 12 },
      draw(f) {
        const p = new Pic(32, 16);
        const deep = style.water ?? [30, 60, 200];
        for (let y = 2; y < 16; y++) for (let x = 0; x < 32; x++) {
          const wave = Math.round(Math.sin((x + f * 4) / 32 * Math.PI * 4) * 1.2);
          if (y < 3 + wave) continue;
          const k = y < 4 + wave ? 1.6 : 1 - (y - 4) * 0.03 + (((x * 7 + y * 3 + f * 5) % 11) === 0 ? 0.25 : 0);
          p.p(x, y, shade(deep, k));
        }
        return p;
      },
    },
    // fire / lava: 32 wide, bubbling. Lemmings that reach it are burnt up.
    fire: {
      w: 32, h: 16, frames: 8, continuous: true,
      trigger: { effect: 'fire', x: 0, y: 4, w: 32, h: 12 },
      draw(f) {
        const p = new Pic(32, 16);
        for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) {
          const h = 5 + Math.round(Math.sin((x * 1.7 + f * 2.3)) * 2 + Math.sin(x * 0.6 - f) * 2);
          if (y < h) continue;
          const t = (y - h) / 6;
          p.p(x, y, t < 0.3 ? [255, 230, 80] : t < 1 ? [255, 140, 30] : [200, 50, 20]);
        }
        return p;
      },
    },
    // the squasher trap: a weight on a chain that drops on the first lemming
    // to step under it, then winds back up. One lemming at a time.
    trap: {
      w: 24, h: 40, frames: 16,
      trigger: { effect: 'trap', x: 8, y: 32, w: 8, h: 8 },
      draw(f) {
        const p = new Pic(24, 40);
        const drop = f === 0 ? 0 : f < 4 ? f * 8 : Math.max(0, 24 - (f - 4) * 2);
        p.rect(4, 0, 16, 3, shade(metal, 0.8));
        for (let y = 3; y < 8 + drop; y += 2) p.p(12, y, shade(metal, 1.2));
        p.rect(5, 8 + drop, 14, 8, shade(metal, 0.7)); p.rect(5, 8 + drop, 14, 1, shade(metal, 1.2));
        p.rect(7, 10 + drop, 10, 4, shade(metal, 0.55));
        if (f >= 3 && f < 6) for (let i = 0; i < 6; i++) p.p(6 + i * 3, 38 - (i & 1), [230, 40, 40]);
        return p;
      },
    },
  };
}

/** The one-way arrows' pattern: true where an arrow pixel is (pointing right). */
export function oneWayArrow(x, y) {
  const ax = ((x % 16) + 16) % 16, ay = ((y % 12) + 12) % 12;
  // a chevron 8 wide, 9 tall, in each 16x12 cell
  const d = ax - 4;
  return d >= 0 && d < 8 && Math.abs(ay - 5) <= 4 - (d >> 1) && Math.abs(ay - 5) >= 3 - (d >> 1) - 1;
}
