#!/usr/bin/env node
// Renders an original DOS level (from the game files in reference/lemming1.pc,
// or the folder in LEMMINGS_DOS) to a PNG of the whole level:
//   node tools/dosshot.mjs out.png <level 1..120> [iterations]
import fs from 'node:fs';
import path from 'node:path';
import { DosData, NEEDED } from '../src/dos/dosdata.js';
import { Game, WORLD_W, WORLD_H } from '../src/game/engine.js';
import { Raster } from './png.js';

export function loadDosFolder(dir = process.env.LEMMINGS_DOS ?? 'reference/lemming1.pc') {
  const files = {};
  for (const f of fs.readdirSync(dir)) if (NEEDED.includes(f.toLowerCase())) files[f.toLowerCase()] = new Uint8Array(fs.readFileSync(path.join(dir, f)));
  return new DosData(files);
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('dosshot.mjs')) {
  const [out = 'dos.png', num = '1', iters = '0'] = process.argv.slice(2);
  const dos = loadDosFolder();
  const lv = dos.build(Number(num) - 1);
  const g = new Game(lv);
  for (let i = 0; i < Number(iters) && !g.finished; i++) g.step();
  const r = new Raster(WORLD_W, WORLD_H);
  const draw = (o) => {
    const p = o.def.draw(o.frame);
    for (let j = 0; j < p.h; j++) for (let i = 0; i < p.w; i++) {
      const k = (j * p.w + i) * 4;
      if (p.data[k + 3] && (!o.onTerrain || g.pix[(o.y + j) * WORLD_W + o.x + i])) r.set(o.x + i, o.y + j, [p.data[k], p.data[k + 1], p.data[k + 2]]);
    }
  };
  for (const o of g.objects) if (!o.front) draw(o);
  for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) { const c = g.pix[y * WORLD_W + x]; if (c) r.set(x, y, lv.palette[c]); }
  for (const o of g.objects) if (o.front) draw(o);
  for (const s of lv.steel) for (let x = s.x; x < s.x + s.w; x++) { r.set(x, s.y, [255, 0, 255]); r.set(x, s.y + s.h - 1, [255, 0, 255]); }
  fs.writeFileSync(out, r.encode(1));
  console.log(`${out}: ${lv.rating} ${lv.number} "${lv.name}" lemmings ${lv.count} save ${lv.save} rate ${lv.rate} time ${lv.time} start ${lv.start}`, JSON.stringify(lv.skills), 'steel', JSON.stringify(lv.steel), 'objects', lv.objects.map((o) => `${o.kind}@${o.x},${o.y}`).join(' '));
}
