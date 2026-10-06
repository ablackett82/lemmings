#!/usr/bin/env node
// Plays a level's solution (or nothing, with --no-solve) to the end and says
// how it went: node tools/try.mjs <level number> [--no-solve]
import { Game } from '../src/game/engine.js';
import { buildLevel } from '../src/game/level.js';
import { LEVELS } from '../src/game/levels.js';
import { Solver } from '../src/game/solver.js';

export function play(spec, solve = true, limit = 20000) {
  const g = new Game(buildLevel(spec));
  const solver = solve ? new Solver(spec.solution ?? []) : null;
  const fate = {};
  const last = new Map();
  for (let i = 0; i < limit && !g.finished; i++) {
    solver?.apply(g);
    for (const L of g.lemmings) if (!L.removed) last.set(L, `${L.action}@${L.x},${L.y}`);
    g.step();
    for (const L of g.lemmings) if (L.removed && last.has(L)) {
      const k = last.get(L).split('@')[0];
      fate[k] = (fate[k] ?? 0) + 1;
      last.delete(L);
    }
  }
  const alive = g.lemmings.filter((L) => !L.removed).map((L) => `${L.action}@${L.x},${L.y}`);
  return { g, fate, alive, used: Object.fromEntries(Object.entries(spec.skills).map(([k, v]) => [k, v - g.skills[k]])) };
}

if (process.argv[1].endsWith('try.mjs')) {
  const n = Number(process.argv[2]);
  const list = n ? [n] : LEVELS.map((_, i) => i + 1);
  for (const k of list) {
    const spec = LEVELS[k - 1];
    const r = play(spec, !process.argv.includes('--no-solve'));
    const g = r.g;
    console.log(`${k} ${spec.name}: ${g.passed ? 'PASS' : 'fail'} saved ${g.in}/${g.count} (${g.savedPercent}% of ${g.neededPercent}%) it ${g.iteration}${g.timeUp ? ' TIME UP' : ''} fate ${JSON.stringify(r.fate)} used ${JSON.stringify(r.used)}${r.alive.length ? ' alive ' + r.alive.slice(0, 6).join(' ') : ''}`);
  }
}
