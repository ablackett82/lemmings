#!/usr/bin/env node
// Draws every lemming animation to a PNG, one row each, for checking the
// sprites by eye: node tools/sheet.mjs out.png
import fs from 'node:fs';
import { makeLemmingFrames, LEM_PALETTE } from '../src/game/sprites.js';
import { Raster } from './png.js';

const out = process.argv[2] || 'sheet.png';
const only = process.argv[3] ? process.argv[3].split(',') : null;
const scale = Number(process.argv[4]) || 3;
const frames = makeLemmingFrames();
const rows = Object.entries(frames).filter(([k]) => !only || only.includes(k));
const CW = 34, CH = 34;
const maxN = Math.max(...rows.map(([, [a]]) => a.length));
const r = new Raster(CW * maxN + 4, CH * rows.length * 2);
r.fill(0, 0, r.width, r.height, [30, 30, 40]);
rows.forEach(([, [right, left]], row) => {
  for (const [dir, list] of [[0, right], [1, left]]) list.forEach((f, i) => {
    const ox = i * CW + 2, oy = (row * 2 + dir) * CH + 2;
    r.fill(ox, oy, f.w, f.h, [0, 0, 0]);
    r.set(ox + f.fx, oy + f.fy, [90, 60, 30]);
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const c = f.data[y * f.w + x];
      if (c) r.set(ox + x, oy + y, LEM_PALETTE[c]);
    }
  });
});
fs.writeFileSync(out, r.encode(scale));
console.log(out, rows.map(([k]) => k).join(' '));
