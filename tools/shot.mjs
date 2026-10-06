#!/usr/bin/env node
// Renders a level to a PNG after some iterations, playing its solution:
//   node tools/shot.mjs out.png <level number> [iterations] [scrollX] [--no-solve]
import fs from 'node:fs';
import { Game } from '../src/game/engine.js';
import { buildLevel } from '../src/game/level.js';
import { LEVELS } from '../src/game/levels.js';
import { Solver } from '../src/game/solver.js';
import { Screen, SCREEN_W, SCREEN_H } from '../src/render/screen.js';
import { Raster } from './png.js';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const [out = 'shot.png', num = '1', iters = '0', scroll] = args;
const spec = LEVELS[Number(num) - 1];
const g = new Game(buildLevel(spec));
const solver = process.argv.includes('--no-solve') ? null : new Solver(spec.solution ?? []);
for (let i = 0; i < Number(iters) && !g.finished; i++) { solver?.apply(g); g.step(); }
const s = new Screen();
const rgba = s.drawGame(g, { scrollX: scroll !== undefined ? Number(scroll) : spec.start ?? 0, selected: 'digger' });
fs.writeFileSync(out, new Raster(SCREEN_W, SCREEN_H).fromRGBA(rgba).encode(3));
console.log(`${out}: level ${num} "${spec.name}" it ${g.iteration} out ${g.out} in ${g.in} released ${g.released} finished ${g.finished} passed ${g.passed}`);
