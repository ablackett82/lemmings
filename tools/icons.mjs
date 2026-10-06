#!/usr/bin/env node
// Renders the home-screen icons: icons/icon-180.png (iOS), icon-192.png,
// icon-512.png. A floater from the game, big, drifting down past a ledge of
// grassy earth, on black with square pixels. Everything sits inside the middle
// 80% so the maskable crop is safe.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeLemmingFrames, LEM_PALETTE } from '../src/game/sprites.js';
import { Raster } from './png.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frames = makeLemmingFrames();

function icon(size) {
  const r = new Raster(size, size);
  r.fill(0, 0, size, size, [0, 0, 0]);
  const u = size / 32; // a 32x32 grid
  const box = (x, y, w, h, c) => r.fill(Math.round(x * u), Math.round(y * u), Math.round((x + w) * u) - Math.round(x * u), Math.round((y + h) * u) - Math.round(y * u), c);
  // the ledge
  box(4, 24, 24, 4, [140, 86, 44]); box(4, 23, 24, 1, [60, 170, 40]);
  box(9, 26, 3, 1, [130, 130, 140]); box(20, 25, 2, 1, [110, 110, 122]);
  // the floater, 16 pixels tall, scaled to fit the grid
  const f = frames.floating[0][5];
  const ox = 16 - f.fx + 0.5, oy = 22.5 - f.fy;
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
    const c = f.data[y * f.w + x];
    if (c) box(ox + x * 1.25 - 2, oy + y * 1.25 - 3, 1.25, 1.25, LEM_PALETTE[c]);
  }
  return r.encode(1);
}

fs.mkdirSync(path.join(ROOT, 'icons'), { recursive: true });
for (const size of [180, 192, 512]) fs.writeFileSync(path.join(ROOT, `icons/icon-${size}.png`), icon(size));
console.log('wrote icons/icon-{180,192,512}.png');
