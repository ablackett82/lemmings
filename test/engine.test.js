// The DOS rules (as Lemmix has them), checked against the engine on small
// made-up bits of terrain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, Lemming, WORLD_W, WORLD_H, DOM } from '../src/game/engine.js';
import { buildLevel } from '../src/game/level.js';

/** A game on the given terrain shapes, with one lemming walking at (x, y). */
function setup(terrain, { x = 50, y = 100, dx = 1, objects = [], skills = {}, action = 'walking', assist } = {}) {
  const spec = { name: 't', count: 1, save: 1, rate: 50, time: 5, style: 'earth', skills: { climber: 9, floater: 9, bomber: 9, blocker: 9, builder: 9, basher: 9, miner: 9, digger: 9, ...skills }, terrain, objects };
  const g = new Game(buildLevel(spec), assist);
  g.count = 99; // don't finish
  g.entriesOpened = false; // no releases
  const L = new Lemming(0);
  g.lemmings.push(L);
  g.transition(L, action);
  L.x = x; L.y = y; L.dx = dx;
  g.released = 1; g.out = 1;
  return { g, L };
}
const run = (g, n) => { for (let i = 0; i < n; i++) g.step(); };
const floor = (y = 100) => ['rect', 0, y, WORLD_W, WORLD_H - y];

test('a walker steps 1 pixel an iteration', () => {
  const { g, L } = setup([floor()]);
  run(g, 10);
  assert.equal(L.x, 60);
  assert.equal(L.y, 100);
  assert.equal(L.action, 'walking');
});

test('steps up to 2 high are walked, 3 to 6 are jumped, 7 turns the lemming round', () => {
  for (const [h, expect] of [[2, 'walk'], [3, 'jump'], [6, 'jump'], [7, 'turn']]) {
    const { g, L } = setup([floor(), ['rect', 60, 100 - h, 40, h]]);
    let jumped = false;
    for (let i = 0; i < 20; i++) { g.step(); if (L.action === 'jumping') jumped = true; }
    if (expect === 'turn') { assert.equal(L.dx, -1, `h ${h}`); assert.ok(L.x < 60); } else {
      assert.equal(L.y, 100 - h, `h ${h}`);
      assert.equal(jumped, expect === 'jump', `h ${h}`);
    }
  }
});

test('walking off an edge: down 3 is walked, 4 or more is a fall', () => {
  for (const [d, falls] of [[3, false], [4, true]]) {
    const { g, L } = setup([['rect', 0, 100, 60, 60], ['rect', 60, 100 + d, 200, 60 - d]]);
    let fell = false;
    for (let i = 0; i < 15; i++) { g.step(); if (L.action === 'falling') fell = true; }
    assert.equal(fell, falls, `drop ${d}`);
    assert.equal(L.y, 100 + d);
  }
});

test('falling 60 pixels is safe; more splats', () => {
  // the faller starts counting at 3 and adds 3 an iteration; > 60 splats
  for (const [drop, splat] of [[57, false], [63, true]]) {
    const { g, L } = setup([floor(40 + drop)], { y: 40, action: 'falling' });
    run(g, 40);
    assert.equal(L.action === 'splatting' || L.removed, splat, `drop ${drop}`);
  }
});

test('the safe-falls cheat stops the splat', () => {
  const { g, L } = setup([floor(150)], { y: 20, action: 'falling', assist: { safeFalls: true } });
  run(g, 60);
  assert.equal(L.action, 'walking');
});

test('a floater opens its umbrella and lands from any height', () => {
  const { g, L } = setup([floor(150)], { y: 10, action: 'falling' });
  g.assign('floater', L);
  run(g, 120);
  assert.ok(!L.removed);
  assert.equal(L.action, 'walking');
});

test('a climber climbs a wall and walks off the top', () => {
  const { g, L } = setup([floor(), ['rect', 70, 40, 20, 60]]);
  g.assign('climber', L);
  let climbed = false;
  for (let i = 0; i < 200 && L.y > 40 && !(L.action === 'walking' && L.y === 40); i++) { g.step(); if (L.action === 'climbing') climbed = true; }
  assert.ok(climbed);
  assert.equal(L.y, 40);
  assert.equal(L.dx, 1);
});

test('a climber under an overhang falls off backwards', () => {
  const { g, L } = setup([floor(), ['rect', 70, 40, 20, 60], ['rect', 50, 40, 20, 4]]);
  g.assign('climber', L);
  for (let i = 0; i < 300 && L.action !== 'falling'; i++) g.step();
  assert.equal(L.action, 'falling');
  assert.equal(L.dx, -1);
});

test('a builder lays 12 bricks, 2 across and 1 up each, then shrugs', () => {
  const { g, L } = setup([floor()]);
  g.assign('builder', L);
  assert.equal(L.action, 'building');
  let shrugged = false;
  for (let i = 0; i < 16 * 13 && !shrugged; i++) { g.step(); if (L.action === 'shrugging') shrugged = true; }
  assert.ok(shrugged);
  assert.equal(L.y, 100 - 12);
  assert.equal(L.x, 50 + 24);
  // the bricks: row y-1 of each step is 6 wide
  for (let i = 0; i < 12; i++) assert.ok(g.hasPixel(50 + i * 2 + 2, 100 - 1 - i), `brick ${i}`);
});

test('a builder that hits a wall turns round', () => {
  const { g, L } = setup([floor(), ['rect', 64, 60, 20, 40]]);
  g.assign('builder', L);
  for (let i = 0; i < 300 && L.action === 'building'; i++) g.step();
  assert.equal(L.action, 'walking');
  assert.equal(L.dx, -1);
});

test('a blocker turns others round and can only be undone by a bomb', () => {
  const { g, L } = setup([floor()], { x: 80 });
  g.assign('blocker', L);
  const M = new Lemming(1);
  g.lemmings.push(M); g.transition(M, 'walking'); M.x = 40; M.y = 100; M.dx = 1;
  run(g, 60);
  assert.equal(L.action, 'blocking');
  assert.equal(L.x, 80);
  assert.equal(M.dx, -1, 'turned back by the blocker');
  assert.ok(M.x < 80);
  // a second blocker can't stand in the first one's field
  M.x = 84; M.dx = 1;
  assert.equal(g.canAssign('blocker', M, null), null);
});

test('a digger digs down 1 a step until there is nothing left, then falls', () => {
  const { g, L } = setup([['rect', 0, 100, WORLD_W, 20], floor(140)]);
  g.assign('digger', L);
  for (let i = 0; i < 400 && L.action === 'digging'; i++) g.step();
  assert.equal(L.action, 'falling');
  assert.ok(L.y >= 119 && L.y <= 121, `y ${L.y}`);
  run(g, 40);
  assert.equal(L.action, 'walking');
  assert.equal(L.y, 140);
});

test('a digger stops at steel', () => {
  const { g, L } = setup([floor(), ['steel', 0, 108, 200, 16]]);
  g.assign('digger', L);
  for (let i = 0; i < 400 && L.action === 'digging'; i++) g.step();
  assert.equal(L.action, 'walking');
  assert.ok(L.y <= 108);
});

test('a basher tunnels through a wall and walks on when it runs out', () => {
  const { g, L } = setup([floor(), ['rect', 60, 70, 30, 30]]);
  run(g, 4);
  g.checkObjects(L);
  g.assign('basher', L);
  for (let i = 0; i < 600 && L.action === 'bashing'; i++) g.step();
  assert.equal(L.action, 'walking');
  run(g, 20);
  assert.ok(L.x > 95, `x ${L.x}`);
  assert.equal(L.y, 100);
  assert.ok(!g.hasPixel(75, 95), 'tunnel cut');
  assert.ok(g.hasPixel(75, 85), 'roof left');
});

test("a basher can't be given the skill facing steel", () => {
  const { g, L } = setup([floor(), ['steel', 56, 68, 32, 32]]);
  g.step();
  assert.equal(L.objInFront, DOM.STEEL);
  assert.equal(g.canAssign('basher', L, null), null);
});

test('a miner digs down at a slant: 4 across and 2 down a swing', () => {
  const { g, L } = setup([floor()]);
  g.assign('miner', L);
  const x0 = L.x, y0 = L.y;
  run(g, 24 * 3);
  assert.equal(L.action, 'mining');
  assert.equal(L.x - x0, 12);
  assert.equal(L.y - y0, 6);
});

test('a bomber counts down 5..1, says oh no, and blows a hole', () => {
  const { g, L } = setup([floor()]);
  g.assign('bomber', L);
  assert.equal(L.explosionTimer, 79);
  let ohno = 0;
  for (let i = 0; i < 79 + 16 + 5 && !L.removed; i++) { g.step(); if (L.action === 'ohnoing') ohno++; }
  assert.ok(L.removed && L.exploded);
  assert.ok(ohno > 0);
  assert.ok(!g.hasPixel(L.x, L.y), 'hole');
});

test('the release rate sets the gap between lemmings: (99 - rate) / 2 + 4 iterations', () => {
  for (const [rate, gap] of [[1, 53], [50, 28], [99, 4]]) {
    const spec = { name: 't', count: 3, save: 1, rate, time: 5, style: 'earth', skills: {}, terrain: [floor(140)], objects: [['entrance', 100, 60]] };
    const g = new Game(buildLevel(spec));
    const at = [];
    for (let i = 0; i < 300; i++) { const n = g.released; g.step(); if (g.released > n) at.push(g.iteration); }
    assert.equal(at[0], 35 + 20 - 1, 'first one 20 after the hatch opens');
    assert.equal(at[1] - at[0], gap, `rate ${rate}`);
  }
});

test('the clock ticks every 17 iterations', () => {
  const spec = { name: 't', count: 1, save: 1, rate: 50, time: 1, style: 'earth', skills: {}, terrain: [floor()], objects: [] };
  const g = new Game(buildLevel(spec));
  run(g, 17);
  assert.equal(g.minutes, 0);
  assert.equal(g.seconds, 59);
  run(g, 17 * 59);
  assert.equal(g.seconds, 0);
  run(g, 2);
  assert.ok(g.finished && g.timeUp);
});

test('nuking gives every lemming a bomb, one per iteration, and stops the releases', () => {
  const spec = { name: 't', count: 20, save: 1, rate: 99, time: 5, style: 'earth', skills: {}, terrain: [floor(140)], objects: [['entrance', 100, 110]] };
  const g = new Game(buildLevel(spec));
  run(g, 80);
  const out = g.released;
  g.nuke();
  run(g, 3);
  assert.ok(g.lemmings.slice(0, 3).every((L) => L.explosionTimer > 0 || L.removed));
  run(g, 200);
  assert.equal(g.released, out);
  assert.ok(g.finished);
  assert.equal(g.in, 0);
});

test('a lemming in water drowns; one at the exit goes home', () => {
  const { g, L } = setup([floor()], { objects: [['water', 80, 100, 1], ['exit', 30, 100]] });
  run(g, 60);
  assert.ok(L.removed || L.action === 'drowning');
  const t = setup([floor()], { x: 20, objects: [['exit', 30, 100]] });
  run(t.g, 40);
  assert.equal(t.g.in, 1);
});

test('a lemming can be given a skill only if the DOS rules allow it', () => {
  const { g, L } = setup([floor()]);
  assert.equal(g.canAssign('climber', L, null), L);
  g.assign('climber', L);
  assert.equal(g.canAssign('climber', L, null), null, 'already a climber');
  g.transition(L, 'falling');
  assert.equal(g.canAssign('builder', L, null), null, 'no building in the air');
  assert.equal(g.canAssign('floater', L, null), L);
  g.skills.floater = 0;
  assert.equal(g.canAssign('floater', L, null), null, 'none left');
  g.assist.unlimitedSkills = true;
  assert.equal(g.canAssign('floater', L, null), L, 'unless the cheat is on');
});
