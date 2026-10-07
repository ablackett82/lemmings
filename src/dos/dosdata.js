// Reads the DOS game's own data files (VGA version) and turns them into what
// the engine and the screen use: the 120 levels, the terrain and objects of
// each graphic set, the lemmings' animations, the dig masks and the skill
// panel. The formats are as ccexplore documented them, and as Lemmix and
// Lemmings.ts (Thomas Zeugner, MIT) read them.
//
// files: { 'main.dat': Uint8Array, 'level000.dat': ..., ... } (lower-case names)

import { unpackDat } from './dat.js';
import { WORLD_W, WORLD_H } from '../game/engine.js';

export const RATINGS = ['Fun', 'Tricky', 'Taxing', 'Mayhem'];

// which level file and section each of the 120 levels is, rating by rating:
// file * 10 + section, negative where the stats and name come from ODDTABLE.DAT
const ORDER = [
  [91, 95, 96, 92, 93, 94, 97, -6, -12, -32, -42, -7, 16, -17, -22, -24, -27, -43, -51, -63, -84, 13, -41, -57, -60, -71, -46, -61, -65, -82],
  [0, -16, -21, -30, -31, -33, -34, -47, -62, -73, -77, -80, -83, 2, -91, -93, -94, -95, -97, 3, 5, 6, 7, 10, 11, 12, 14, 15, 20, 17],
  [22, 23, 24, 25, 26, 27, 30, 31, 32, 33, 34, 35, 36, 37, 1, 40, 41, 42, 43, 44, 45, 46, 47, 50, 51, 52, 53, 54, 21, 67],
  [55, 56, 57, 60, 61, 62, 63, 64, 65, 66, -67, 70, 71, 72, 73, 74, 75, 76, 77, -92, 80, 4, 81, 82, 83, 84, 85, 86, 87, 90],
];

/** The files the game needs (VGA, the sounds aside). */
export const NEEDED = [
  'main.dat', 'oddtable.dat',
  ...Array.from({ length: 10 }, (_, i) => `level00${i}.dat`),
  ...Array.from({ length: 5 }, (_, i) => `ground${i}o.dat`),
  ...Array.from({ length: 5 }, (_, i) => `vgagr${i}.dat`),
  ...Array.from({ length: 4 }, (_, i) => `vgaspec${i}.dat`),
];

const SKILL_ORDER = ['climber', 'floater', 'bomber', 'blocker', 'builder', 'basher', 'miner', 'digger'];
const EFFECTS = { 1: 'exit', 4: 'trap', 5: 'water', 6: 'fire', 7: 'oneWayLeft', 8: 'oneWayRight' };
export const BRICK = 64; // where the builder's brick colour goes in a level's palette

const be16 = (b, o) => (b[o] << 8) | b[o + 1];
const le16 = (b, o) => b[o] | (b[o + 1] << 8);
const text = (b, o, n) => String.fromCharCode(...b.subarray(o, o + n)).replace(/[`]/g, "'").replace(/\0/g, ' ').trim();
const vga = (b, o) => [b[o] * 4 + (b[o] >> 4), b[o + 1] * 4 + (b[o + 1] >> 4), b[o + 2] * 4 + (b[o + 2] >> 4)]; // 6-bit to 8-bit

/** Planar image data to colour indices: all of plane 0's bits, then plane 1's... */
function planar(src, pos, w, h, bpp) {
  const n = w * h, out = new Uint8Array(n);
  let p = pos;
  for (let plane = 0; plane < bpp; plane++) {
    for (let i = 0; i < n; i += 8, p++) {
      const byte = src[p];
      for (let k = 0; k < 8 && i + k < n; k++) if (byte & (0x80 >> k)) out[i + k] |= 1 << plane;
    }
  }
  return { data: out, end: p };
}
const bits1 = (src, pos, w, h) => planar(src, pos, w, h, 1);

// the in-level colours 0..6 (black, the lemmings' blue, green and skin, and
// yellow, red, grey for the panel and the explosions); 7 is set per level
const IN_LEVEL = [[0, 0, 0], [16, 16, 56], [0, 44, 0], [60, 52, 52], [60, 60, 0], [60, 8, 8], [32, 32, 32]];

export class DosData {
  constructor(files) {
    const need = (n) => { const f = files[n]; if (!f) throw new Error(`${n.toUpperCase()} is missing`); return f; };
    this.files = files;
    this.need = need;
    const main = unpackDat(need('main.dat'));
    this.readLemmings(main[0]);
    this.readMasks(main[1]);
    this.readPanel(main[6], main[2]);
    this.levelFiles = new Map();
    this.sets = new Map();
    this.odd = need('oddtable.dat');
    this.levels = this.readIndex();
  }

  // ---- the lemmings -----------------------------------------------------------

  readLemmings(sec) {
    // [action, direction (r, l or both), bits per pixel, width, height, frames], in file order
    const LIST = [
      ['walking', 'r', 2, 16, 10, 8], ['jumping', 'r', 2, 16, 10, 1], ['walking', 'l', 2, 16, 10, 8], ['jumping', 'l', 2, 16, 10, 1],
      ['digging', 'b', 3, 16, 14, 16], ['climbing', 'r', 2, 16, 12, 8], ['climbing', 'l', 2, 16, 12, 8], ['drowning', 'b', 2, 16, 10, 16],
      ['hoisting', 'r', 2, 16, 12, 8], ['hoisting', 'l', 2, 16, 12, 8], ['building', 'r', 3, 16, 13, 16], ['building', 'l', 3, 16, 13, 16],
      ['bashing', 'r', 3, 16, 10, 32], ['bashing', 'l', 3, 16, 10, 32], ['mining', 'r', 3, 16, 13, 24], ['mining', 'l', 3, 16, 13, 24],
      ['falling', 'r', 2, 16, 10, 4], ['falling', 'l', 2, 16, 10, 4], ['floating', 'r', 3, 16, 16, 8], ['floating', 'l', 3, 16, 16, 8],
      ['splatting', 'b', 2, 16, 10, 16], ['exiting', 'b', 2, 16, 13, 8], ['vaporizing', 'b', 4, 16, 14, 14], ['blocking', 'b', 2, 16, 10, 16],
      ['shrugging', 'r', 2, 16, 10, 8], ['shrugging', 'l', 2, 16, 10, 8], ['ohnoing', 'b', 2, 16, 10, 16], ['exploding', 'b', 3, 32, 32, 1],
    ];
    // the foot's place in each frame (Lemmix's table, as the engine has it)
    const FOOT = {
      walking: [8, 10], jumping: [8, 10], digging: [8, 12], climbing: [8, 12], drowning: [8, 10], hoisting: [8, 12],
      building: [8, 13], bashing: [8, 10], mining: [8, 13], falling: [8, 10], floating: [8, 16], splatting: [8, 10],
      exiting: [8, 13], vaporizing: [8, 14], blocking: [8, 10], shrugging: [8, 10], ohnoing: [8, 10], exploding: [16, 25],
    };
    const frames = {};
    let pos = 0;
    for (const [action, dir, bpp, w, h, n] of LIST) {
      const list = [];
      for (let i = 0; i < n; i++) {
        const { data, end } = planar(sec, pos, w, h, bpp);
        pos = end;
        list.push({ w, h, fx: FOOT[action][0], fy: FOOT[action][1], data });
      }
      frames[action] ??= [null, null];
      if (dir !== 'l') frames[action][0] = list;
      if (dir !== 'r') frames[action][1] = list;
    }
    this.frames = frames;
  }

  readMasks(sec) {
    let pos = 0;
    const take = (w, h, n) => Array.from({ length: n }, () => { const { data, end } = bits1(sec, pos, w, h); pos = end; return { w, h, bits: data }; });
    const bashR = take(16, 10, 4), bashL = take(16, 10, 4), mineR = take(16, 13, 2), mineL = take(16, 13, 2);
    const [explode] = take(16, 22, 1);
    this.masks = { bash: [bashR, bashL], mine: [mineR, mineL], explode, digits: take(8, 8, 10) };
  }

  readPanel(sec, sec2) {
    // section 6: the panel (320x40: 16 rows for the text line, then the
    // buttons), then the green 8x16 letters of the text line
    this.panel = planar(sec, 0, 320, 40, 4).data;
    let pos = 6400;
    const chars = '%0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    this.font = {};
    for (const ch of chars) { const { data, end } = planar(sec, pos, 8, 16, 3); pos = end; this.font[ch] = data; }
    // section 2, after its copy of the panel: the skill counts' digits, 8x8,
    // each as the right-hand and the left-hand digit
    this.panelDigits = [];
    pos = 6400;
    for (let i = 0; i < 10; i++) {
      const r = bits1(sec2, pos, 8, 8), l = bits1(sec2, r.end, 8, 8);
      pos = l.end;
      this.panelDigits.push({ right: r.data, left: l.data });
    }
  }

  // ---- the levels -------------------------------------------------------------

  readIndex() {
    const out = [];
    ORDER.forEach((list, r) => list.forEach((v, i) => {
      const file = Math.floor(Math.abs(v) / 10), part = Math.abs(v) % 10;
      const raw = this.levelSection(file, part);
      const stats = v < 0 ? this.odd.subarray((file * 8 + part) * 56) : raw;
      out.push({ rating: RATINGS[r], number: i + 1, file, part, odd: v < 0, name: text(stats, v < 0 ? 24 : 0x7e0, 32) });
    }));
    return out;
  }

  levelSection(file, part) {
    let secs = this.levelFiles.get(file);
    if (!secs) { secs = unpackDat(this.need(`level00${file}.dat`)); this.levelFiles.set(file, secs); }
    return secs[part];
  }

  /** A graphic set: its terrain pieces, objects and colours. */
  set(n) {
    let s = this.sets.get(n);
    if (s) return s;
    const gr = this.need(`ground${n}o.dat`);
    const [terr, objs] = unpackDat(this.need(`vgagr${n}.dat`));
    const custom = Array.from({ length: 8 }, (_, i) => vga(gr, 984 + i * 3));
    const objects = [];
    for (let i = 0; i < 16; i++) {
      const o = i * 28;
      const frames = gr[o + 3], w = gr[o + 4], h = gr[o + 5];
      if (!frames || !w || !h) { objects.push(null); continue; }
      const size = le16(gr, o + 6), maskAt = le16(gr, o + 8), base = le16(gr, o + 21);
      const pics = [];
      for (let f = 0; f < frames; f++) {
        const at = base + f * size;
        const img = planar(objs, at, w, h, 4).data, mask = bits1(objs, at + maskAt, w, h).data;
        for (let k = 0; k < img.length; k++) img[k] = mask[k] ? img[k] | 0x10 : 0; // 0x10: opaque
        pics.push(img);
      }
      objects.push({
        id: i, w, h, frames, startFrame: gr[o + 2], continuous: (le16(gr, o) & 1) === 0, pics,
        effect: EFFECTS[gr[o + 20]] ?? null,
        trigger: { x: le16(gr, o + 14) * 4, y: le16(gr, o + 16) * 4 - 4, w: gr[o + 18] * 4, h: gr[o + 19] * 4 },
        sound: gr[o + 27],
      });
    }
    const pieces = [];
    for (let i = 0; i < 64; i++) {
      const o = 448 + i * 8, w = gr[o], h = gr[o + 1];
      if (!w || !h) { pieces.push(null); continue; }
      const at = le16(gr, o + 2), maskAt = le16(gr, o + 4);
      const img = planar(terr, at, w, h, 3).data, mask = bits1(terr, maskAt, w, h).data;
      pieces.push({ w, h, img, mask });
    }
    s = { custom, objects, pieces };
    this.sets.set(n, s);
    return s;
  }

  /** The VGASPEC picture a few levels use instead of terrain pieces: 960x160 at x 304. */
  special(n) {
    const [sec] = unpackDat(this.need(`vgaspec${n}.dat`));
    const pal = Array.from({ length: 8 }, (_, i) => vga(sec, i * 3));
    const pix = new Uint8Array(WORLD_W * WORLD_H);
    const W = 960, CH = 40, chunk = new Uint8Array(W * CH * 3 / 8);
    let p = 40, fill = 0, row = 0;
    while (p < sec.length && row < WORLD_H) {
      const b = sec[p++];
      if (b === 128) {
        const img = planar(chunk, 0, W, CH, 3).data;
        for (let y = 0; y < CH; y++) for (let x = 0; x < W; x++) {
          const c = img[y * W + x];
          if (c && row + y < WORLD_H) pix[(row + y) * WORLD_W + 304 + x] = 8 + c;
        }
        row += CH; fill = 0; chunk.fill(0);
      } else if (b < 128) {
        for (let k = 0; k <= b && p < sec.length; k++) { if (fill < chunk.length) chunk[fill++] = sec[p]; p++; }
      } else {
        const v = sec[p++];
        for (let k = 0; k < 257 - b; k++) if (fill < chunk.length) chunk[fill++] = v;
      }
    }
    return { pal, pix };
  }

  /** Level i (0..119), ready for new Game(). */
  build(i) {
    const info = this.levels[i];
    const raw = this.levelSection(info.file, info.part);
    const stats = info.odd ? this.odd.subarray((info.file * 8 + info.part) * 56) : raw;
    const w = (k) => be16(stats, k);
    const skills = {};
    SKILL_ORDER.forEach((s, k) => { skills[s] = w(8 + k * 2); });
    const setNo = be16(raw, 0x1a), specNo = be16(raw, 0x1c);
    const set = this.set(setNo);

    // the palette: 0..7 the in-level colours, 8..15 the graphic set's (or the picture's)
    let custom = set.custom, terrain;
    if (specNo) { const sp = this.special(specNo - 1); custom = sp.pal; terrain = sp.pix; } else terrain = this.drawTerrain(raw, set);
    const palette = Array.from({ length: 256 }, () => [0, 0, 0]);
    IN_LEVEL.forEach((c, k) => { palette[k] = vga(c, 0); });
    palette[7] = custom[0];
    custom.forEach((c, k) => { palette[8 + k] = c; });
    for (let k = 0; k < 12; k++) palette[BRICK + k] = custom[0];

    // steel
    const steel = [];
    for (let k = 0; k < 32; k++) {
      const o = 0x760 + k * 4, pos = be16(raw, o), size = raw[o + 2];
      if (!pos && !size) continue;
      steel.push({ x: (pos >> 7) * 4 - 16, y: (pos & 0x7f) * 4, w: (size >> 4) * 4 + 4, h: (size & 0xf) * 4 + 4 });
    }

    // objects
    const objects = [];
    for (let k = 0; k < 32; k++) {
      const o = 0x20 + k * 8;
      const flags = be16(raw, o + 6);
      if (!flags) continue;
      const def = set.objects[be16(raw, o + 4)];
      if (!def) continue;
      let y = be16(raw, o + 2); if (y >= 0x8000) y -= 0x10000;
      objects.push(this.placeObject(def, be16(raw, o) - 16, y, flags, palette));
    }

    return {
      dos: this,
      name: info.name, rating: info.rating, number: info.number,
      rate: w(0), count: w(2), save: w(4), time: w(6), skills,
      start: be16(raw, 0x18),
      terrain, palette, steel, objects, oneway: [], brick: BRICK,
      frames: this.frames, masks: this.masks,
    };
  }

  drawTerrain(raw, set) {
    const pix = new Uint8Array(WORLD_W * WORLD_H);
    for (let k = 0; k < 400; k++) {
      const o = 0x120 + k * 4;
      if (raw[o] === 0xff && raw[o + 1] === 0xff && raw[o + 2] === 0xff && raw[o + 3] === 0xff) continue;
      const v = ((raw[o] << 24) | (raw[o + 1] << 16) | (raw[o + 2] << 8) | raw[o + 3]) >>> 0;
      const x = ((v >>> 16) & 0xfff) - 16;
      const yv = (v >>> 7) & 0x1ff, y = yv - (yv > 256 ? 516 : 4);
      const piece = set.pieces[v & 0x3f];
      if (!piece) continue;
      const flags = (v >>> 29) & 7, flip = flags & 2, behind = flags & 4, erase = flags & 1;
      const { w, h, img, mask } = piece;
      for (let j = 0; j < h; j++) {
        const py = y + j;
        if (py < 0 || py >= WORLD_H) continue;
        const sj = flip ? h - 1 - j : j;
        for (let i = 0; i < w; i++) {
          const px = x + i;
          if (px < 0 || px >= WORLD_W || !mask[sj * w + i]) continue;
          const at = py * WORLD_W + px;
          if (erase) pix[at] = 0;
          else if (!behind || !pix[at]) pix[at] = 8 + img[sj * w + i];
        }
      }
    }
    return pix;
  }

  placeObject(d, x, y, flags, palette) {
    const flip = (flags & 0x80) !== 0, behind = (flags & 0x8000) !== 0, onTerrain = (flags & 0x4000) !== 0;
    const kind = d.id === 1 ? 'entrance' : d.effect === 'exit' ? 'exit' : d.effect === 'trap' ? 'trap' : d.effect === 'water' ? 'water'
      : d.effect === 'fire' ? 'fire' : d.effect?.startsWith('oneWay') ? 'arrows' : 'deco';
    const pics = d.pics.map((img) => {
      const data = new Uint8ClampedArray(d.w * d.h * 4);
      for (let j = 0; j < d.h; j++) for (let i = 0; i < d.w; i++) {
        const c = img[(flip ? d.h - 1 - j : j) * d.w + i];
        if (!c) continue;
        const k = (j * d.w + i) * 4, rgb = palette[c & 15];
        data[k] = rgb[0]; data[k + 1] = rgb[1]; data[k + 2] = rgb[2]; data[k + 3] = 255;
      }
      return { w: d.w, h: d.h, data };
    });
    const def = {
      w: d.w, h: d.h, frames: d.frames, startFrame: kind === 'entrance' ? 1 : d.startFrame, continuous: d.continuous && kind !== 'entrance',
      trigger: d.effect && d.effect !== 'exit' || kind === 'exit' ? { effect: d.effect, ...d.trigger } : null,
      sound: d.sound,
      draw: (f) => pics[f],
    };
    return { kind, x, y, def, front: !behind, onTerrain };
  }
}
