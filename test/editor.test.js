// The level editor's engine-side parts: building levels from the original
// pieces, skill stamps, the fall lines, the ghost run, and recording and
// replaying a game (the proof a level can be done, and rewinding).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadDosFolder } from '../tools/dosshot.mjs';
import { Game, WORLD_W } from '../src/game/engine.js';
import { buildCustom, standY } from '../src/editor/build.js';
import { newLevel, check, playKey } from '../src/editor/format.js';
import { ghostRun, falls, SAFE_DROP } from '../src/editor/analyse.js';
import { Recorder, replayTo, proves } from '../src/editor/replay.js';

const dos = loadDosFolder();

/** Flat ground from x0 to x1 (square ends), its top at y, 10 deep: a pile of thin brush strokes. */
const ground = (x0, x1, y) => Array.from({ length: 10 }, (_, k) => ({ k: 'paint', r: 1, pts: [[x0 + 1, y + k + 1], [x1 - 2, y + k + 1]] }));

function level(terrain, objects, extra = {}) {
  const spec = { ...newLevel(0), terrain, objects, ...extra };
  return { spec, ...buildCustom(check(spec), dos) };
}

test('every set builds a new level with an entrance and a working exit', () => {
  for (let set = 0; set < 5; set++) {
    const spec = newLevel(set, standY(dos, set, 0, 128));
    const { level: lv } = buildCustom(spec, dos);
    assert.ok(lv.objects.some((o) => o.kind === 'entrance'), `set ${set}`);
    assert.ok(lv.objects.some((o) => o.kind === 'exit'), `set ${set}`);
    const run = ghostRun(lv);
    assert.equal(run.home, lv.count, `set ${set}: all walk home on the starting level`);
  }
});

test('an exit that looks right on the ground takes them in, even a few pixels out', () => {
  for (let set = 0; set < 5; set++) {
    const spec = newLevel(set, standY(dos, set, 0, 128));
    const exit = spec.objects.find((o) => o.id === 0);
    const at = exit.y;
    for (const dy of [-4, -2, -1, 1, 3, 6]) {
      exit.y = at + dy;
      assert.equal(ghostRun(buildCustom(check(spec), dos).level).home, spec.count, `set ${set}, ${dy} out`);
    }
  }
});

test('a staircase stamp is what a builder lays: 12 bricks a staircase, chained', () => {
  const one = level([...ground(0, 400, 120), { k: 'stamp', s: 'build', x: 300, y: 120, dir: 1, n: 1 }], []);
  const three = level([...ground(0, 400, 120), { k: 'stamp', s: 'build', x: 300, y: 120, dir: 1, n: 3 }], []);
  assert.equal(120 - one.ends.at(-1).y, 12, 'one staircase climbs 12');
  assert.equal(120 - three.ends.at(-1).y, 36, 'three climb 36');
  // the same as a real builder
  const g = new Game(level([...ground(0, 400, 120)], []).level, { noTimeLimit: true });
  const bricks = (pix) => { let n = 0; for (const c of pix) if (c >= 64 && c < 76) n++; return n; };
  assert.equal(bricks(one.level.terrain), 12 * 6);
  assert.equal(bricks(g.pix), 0);
});

test('stamps cut what bashers, miners, diggers and bombs cut, and stop at steel', () => {
  const solid = (lv, x, y) => lv.terrain[y * WORLD_W + x] !== 0;
  const block = { k: 'paint', r: 20, pts: [[300, 120], [380, 120]] };
  const bash = level([...ground(0, 600, 130), block, { k: 'stamp', s: 'bash', x: 270, y: 130, dir: 1 }], []).level;
  assert.ok(!solid(bash, 330, 125), 'a tunnel through the block');
  const dig = level([...ground(0, 600, 130), block, { k: 'stamp', s: 'dig', x: 340, y: 100, dir: 1 }], []).level;
  assert.ok(!solid(dig, 340, 110) && solid(dig, 360, 110), 'a hole straight down');
  // steel: piece 23 of the dirt set; a basher stops at it
  const steel = level([...ground(0, 600, 130), { k: 'piece', p: 23, x: 320, y: 106 }, { k: 'stamp', s: 'bash', x: 250, y: 130, dir: 1 }, block], []).level;
  assert.ok(steel.steel.length === 1);
});

test('the fall lines agree with the engine about what splats', () => {
  assert.equal(SAFE_DROP, 63);
  const top = 30;
  for (const [drop, dies] of [[SAFE_DROP - 1, false], [SAFE_DROP, false], [SAFE_DROP + 1, true]]) {
    // the platform's corner is a pixel lower than its top: the edge is at top + 1
    const { level: lv } = level([...ground(100, 200, top), ...ground(150, 400, top + 1 + drop)], []);
    const f = falls(lv, lv.terrain).find((x) => x.dir === 1 && x.x < 250);
    assert.ok(f, `a fall of ${drop}`);
    assert.equal(f.land.y - f.y, drop);
    assert.equal(f.land.dies, dies, `a fall of ${drop}`);
  }
});

test('the ghost run says how lemmings end up', () => {
  // a gap they all fall down: out of the level
  const { level: lv } = level([...ground(0, 300, 120)], [{ id: 1, x: 100, y: 60 }, { id: 0, x: 500, y: standY(dos, 0, 0, 120) }]);
  const run = ghostRun(lv);
  assert.equal(run.home, 0);
  assert.ok(run.ends.every((e) => e.cause === 'out'), JSON.stringify(run.ends.slice(0, 3)));
});

/** Plays a level as main.js does: inputs between steps, recorded. */
function playRecorded(lv, inputs, upTo = 100000) {
  const g = new Game(lv);
  const rec = new Recorder();
  while (!g.finished && g.iteration < upTo) {
    const now = inputs(g);
    if (now?.rate !== undefined) g.rateDelta = now.rate;
    if (now?.assign) {
      const L = g.lemmings.find((m) => !m.removed && now.assign.who(m));
      if (L && g.canAssign(now.assign.skill, L, null) === L) { g.assign(now.assign.skill, L); rec.assign(g, now.assign.skill, L); }
    }
    rec.beforeStep(g);
    g.step();
  }
  return { g, rec };
}

// a wall in the way (and one behind, so they wait): a basher gets them through
const wall = (x0, x1, y0, y1) => Array.from({ length: y1 - y0 }, (_, k) => ({ k: 'paint', r: 1, pts: [[x0 + 1, y0 + k + 1], [x1 - 2, y0 + k + 1]] }));
const gapLevel = () => level([...ground(0, 700, 120), ...wall(0, 12, 40, 120), ...wall(300, 330, 60, 120)],
  [{ id: 1, x: 100, y: 60 }, { id: 0, x: 500, y: standY(dos, 0, 0, 120) }],
  { count: 10, save: 8, skills: { climber: 0, floater: 0, bomber: 0, blocker: 0, builder: 0, basher: 1, miner: 0, digger: 0 } });

const bridge = (g) => {
  const out = {};
  if (g.iteration === 40) out.rate = 1;   // faster for a bit
  if (g.iteration === 60) out.rate = 0;
  out.assign = { skill: 'basher', who: (m) => m.action === 'walking' && m.dx === 1 && m.x >= 290 && g.skills.basher === 1 };
  return out;
};

test('a recorded win replays to a win, and proves the level', () => {
  const { level: lv, spec } = gapLevel();
  assert.equal(ghostRun(lv).home, 0, 'can’t be done without skills');
  const { g, rec } = playRecorded(lv, bridge);
  assert.ok(g.passed, `saved ${g.in}`);
  assert.ok(rec.log.some((e) => e[1] === 'a') && rec.log.some((e) => e[1] === 'r'));
  assert.ok(proves(lv, rec.log));
  assert.ok(!proves(lv, []), 'no inputs: no win');
  // the proof survives being saved and read back, and is tied to the level
  const saved = check(JSON.parse(JSON.stringify({ ...spec, proof: { log: rec.log, key: playKey(check(spec)) } })));
  assert.equal(saved.proof.key, playKey(saved));
  assert.ok(proves(buildCustom(saved, dos).level, saved.proof.log));
  assert.notEqual(playKey({ ...saved, count: 11 }), playKey(saved), 'changing the level breaks the proof');
  assert.equal(playKey({ ...saved, name: 'Renamed' }), playKey(saved), 'renaming it doesn’t');
});

test('rewinding replays to exactly the same game', () => {
  const { level: lv } = gapLevel();
  const { rec } = playRecorded(lv, bridge);
  const live = playRecorded(lv, bridge, 300).g;
  const back = replayTo(lv, rec.log, 300);
  assert.equal(back.iteration, live.iteration);
  assert.deepEqual(back.lemmings.map((L) => [L.x, L.y, L.action]), live.lemmings.map((L) => [L.x, L.y, L.action]));
  assert.deepEqual([...back.pix], [...live.pix]);
  // cutting the log at a rewind keeps what came before
  const r2 = new Recorder(rec.log.slice());
  r2.cut(50);
  assert.ok(r2.log.every((e) => e[0] < 50));
});

test('check() cleans up anything odd in a level', () => {
  assert.throws(() => check({}));
  const c = check({ v: 1, count: 500, save: 900, rate: -4, skills: { builder: 1000, bogus: 3 }, terrain: [{ k: 'nope' }, { k: 'stamp', s: 'build', x: 1, y: 1, dir: -7 }], objects: [{ id: 99, x: 1, y: 2 }] });
  assert.equal(c.count, 80); assert.equal(c.save, 80); assert.equal(c.rate, 1);
  assert.equal(c.skills.builder, 99); assert.equal(c.skills.bogus, undefined);
  assert.deepEqual(c.terrain, [{ k: 'stamp', s: 'build', x: 1, y: 1, dir: -1, n: 1 }]);
  assert.equal(c.objects[0].id, 15);
});
