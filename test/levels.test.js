// Every level can be done (its solution gets enough lemmings home, with the
// skills it has), and every level needs its skills (with none used, it fails).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/game/levels.js';
import { TITLE_LEVEL } from '../src/game/title.js';
import { buildLevel } from '../src/game/level.js';
import { Game, SKILLS } from '../src/game/engine.js';
import { play } from '../tools/try.mjs';

LEVELS.forEach((spec, i) => {
  test(`level ${i + 1} "${spec.name}" can be done`, () => {
    const { g, used } = play(spec, true);
    assert.ok(g.passed, `saved ${g.in} of ${g.count}, needed ${spec.save}`);
    for (const [k, n] of Object.entries(used)) assert.ok(n <= spec.skills[k], `${k}: used ${n} of ${spec.skills[k]}`);
  });
  test(`level ${i + 1} "${spec.name}" needs skills`, () => {
    const { g } = play(spec, false);
    assert.ok(!g.passed);
  });
});

test('every level is well formed', () => {
  for (const spec of LEVELS) {
    assert.ok(spec.name && spec.rating && spec.count > 0 && spec.save > 0 && spec.save <= spec.count, spec.name);
    assert.ok(spec.rate >= 1 && spec.rate <= 99 && spec.time > 0, spec.name);
    for (const k of Object.keys(spec.skills)) assert.ok(SKILLS.includes(k), `${spec.name}: ${k}`);
    const lv = buildLevel(spec);
    assert.ok(lv.objects.some((o) => o.kind === 'entrance') && lv.objects.some((o) => o.kind === 'exit'), spec.name);
  }
});

test('the title screen builds and runs', () => {
  const g = new Game(buildLevel(TITLE_LEVEL), { noTimeLimit: true });
  for (let i = 0; i < 2000; i++) g.step();
  assert.ok(g.released > 0);
});
