// The gadgets (flip boards and cannons): flying, landing by the fall rule,
// cannons crawling round the ground, and recorded cannon driving replaying.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, Lemming, WORLD_W, WORLD_H } from '../src/game/engine.js';
import { check, playKey } from '../src/editor/format.js';
import { Recorder, replayTo } from '../src/editor/replay.js';

/** A level of plain ground: rects [x0, x1, y0, y1], and the gadgets. */
function level(rects, gadgets) {
  const pix = new Uint8Array(WORLD_W * WORLD_H);
  for (const [x0, x1, y0, y1] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) pix[y * WORLD_W + x] = 8;
  return { terrain: pix, steel: [], objects: [], count: 1, save: 0, rate: 50, time: 5, skills: {}, brick: 64, gadgets };
}

/** A game with one lemming walking from x. */
function walker(lv, x, y = 120, dx = 1, assist = {}) {
  const g = new Game(lv, { noTimeLimit: true, ...assist });
  const L = new Lemming(0);
  g.lemmings.push(L); g.out = 1; g.released = 1;
  L.x = x; L.y = y; L.dx = dx;
  g.transition(L, 'walking');
  return { g, L };
}

const run = (g, L, until, max = 600) => { for (let i = 0; i < max && !until(L); i++) g.step(); };

test('a flip board throws a lemming its way; a short drop lands, a long one splats, a floater floats', () => {
  const lv = (pow) => level([[0, 600, 120, 140]], [{ k: 'flip', x: 100, y: 120, dir: -1, ang: 60, pow }]);
  // walking right onto a board pointing left: thrown back left
  let { g, L } = walker(lv(3), 80);
  run(g, L, (l) => l.action === 'flying');
  assert.equal(L.action, 'flying');
  run(g, L, (l) => l.action !== 'flying');
  assert.equal(L.action, 'walking', 'a low throw lands');
  assert.ok(L.x < 100, 'thrown left');
  ({ g, L } = walker(lv(10), 80));
  run(g, L, (l) => l.action !== 'walking' || l.x >= 100);
  run(g, L, (l) => l.action !== 'flying', 400);
  assert.equal(L.action, 'splatting', 'a high one splats');
  ({ g, L } = walker(lv(10), 80));
  L.isFloater = true;
  run(g, L, (l) => l.action === 'flying');
  run(g, L, (l) => l.action !== 'flying', 400);
  assert.equal(L.action, 'floating');
});

test('a flying lemming hitting a wall drops down it; a climber climbs it', () => {
  const lv = level([[0, 600, 120, 140], [160, 170, 40, 120]], [{ k: 'flip', x: 100, y: 120, dir: 1, ang: 30, pow: 6 }]);
  let { g, L } = walker(lv, 90);
  run(g, L, (l) => l.action === 'flying');
  run(g, L, (l) => l.action !== 'flying');
  assert.equal(L.action, 'walking');
  assert.equal(L.x, 159, 'came down at the wall');
  ({ g, L } = walker(lv, 90));
  L.isClimber = true;
  run(g, L, (l) => l.action === 'flying');
  run(g, L, (l) => l.action !== 'flying');
  assert.equal(L.action, 'climbing');
});

test('a cannon takes one lemming at a time, counts down and fires it; the next walks on past', () => {
  const lv = level([[0, 600, 120, 140]], [{ k: 'cannon', x: 200, y: 120, aim: 90, pow: 4 }]);
  const { g, L } = walker(lv, 180);
  const M = new Lemming(1);
  g.lemmings.push(M); g.out = 2;
  M.x = 170; M.y = 120; M.dx = 1;
  g.transition(M, 'walking');
  run(g, L, (l) => l.action === 'incannon');
  const c = g.gadgets[0];
  assert.equal(c.load, L);
  const events = [];
  for (let i = 0; i < 60 && L.action === 'incannon'; i++) { g.step(); events.push(...g.events); }
  assert.equal(L.action, 'flying', 'fired');
  assert.ok(events.includes('boom'));
  assert.ok(M.action === 'walking' && M.x > 210 && M.dx > 0, 'the next one walked on past the loaded cannon');
  run(g, L, (l) => l.action !== 'flying');
  assert.ok(Math.abs(L.x - 200) <= 3, 'straight up comes straight down');
});

test('a cannon drives along the ground, up a wall standing on it, and falls if the ground goes', () => {
  const lv = level([[0, 600, 120, 140], [300, 320, 40, 120]], [{ k: 'cannon', x: 200, y: 120, aim: 45, pow: 6 }]);
  const g = new Game(lv, { noTimeLimit: true });
  const c = g.gadgets[0];
  assert.deepEqual([c.x, c.y, c.ang], [200, 119, 90]);
  c.drive = 1;
  for (let i = 0; i < 200 && c.y > 80; i++) g.step();
  assert.equal(c.x, 299, 'on the wall');
  assert.equal(c.ang, 180, 'facing out from the wall');
  c.drive = -1;
  for (let i = 0; i < 100 && c.y < 119; i++) g.step();
  for (let i = 0; i < 20; i++) g.step();
  assert.equal(c.y, 119, 'back down on the floor');
  assert.equal(c.ang, 90);
  // the floor under it dug away
  c.drive = 0;
  for (let y = 120; y < 130; y++) for (let x = c.x - 6; x <= c.x + 6; x++) g.pix[y * WORLD_W + x] = 0;
  for (let i = 0; i < 10; i++) g.step();
  assert.equal(c.y, 129, 'fell to the new ground');
});

test('a game with cannon driving in it replays exactly', () => {
  const lv = level([[0, 600, 120, 140], [400, 420, 60, 120]], [{ k: 'cannon', x: 200, y: 120, aim: 45, pow: 6 }, { k: 'flip', x: 300, y: 120, dir: 1, ang: 50, pow: 5 }]);
  lv.objects = [{ kind: 'entrance', x: 100, y: 80, def: { w: 48, h: 25, frames: 10, startFrame: 1 } }];
  lv.count = 6;
  const g = new Game(lv, { noTimeLimit: true });
  const rec = new Recorder();
  const c = g.gadgets[0];
  for (let i = 0; i < 700; i++) {
    c.drive = i > 100 && i < 160 ? 1 : i > 300 && i < 330 ? -1 : 0;
    c.turn = i > 200 && i < 220 ? 1 : 0;
    rec.beforeStep(g); g.step();
  }
  assert.ok(rec.log.some((e) => e[1] === 'c'));
  const h = replayTo(lv, rec.log, g.iteration, { noTimeLimit: true });
  assert.deepEqual(h.lemmings.map((L) => [L.x, L.y, L.action]), g.lemmings.map((L) => [L.x, L.y, L.action]));
  assert.deepEqual([h.gadgets[0].x, h.gadgets[0].y, h.gadgets[0].aim], [c.x, c.y, c.aim]);
});

test('check() keeps gadgets, and a level with them is v 2', () => {
  const spec = check({ v: 1, set: 0, terrain: [], objects: [{ id: 1, x: 10, y: 10 }, { k: 'flip', x: 50, y: 100, dir: -1, ang: 200, pow: 3 }, { k: 'cannon', x: 80, y: 100, aim: 30, pow: 99 }] });
  assert.equal(spec.v, 2);
  assert.deepEqual(spec.objects.slice(1), [{ k: 'flip', x: 50, y: 100, dir: -1, ang: 85, pow: 3 }, { k: 'cannon', x: 80, y: 100, aim: 30, pow: 10 }]);
  assert.equal(check({ v: 1, set: 0, terrain: [], objects: [{ id: 1, x: 10, y: 10 }] }).v, 1);
  assert.notEqual(playKey(spec), playKey({ ...spec, objects: spec.objects.slice(0, 2) }));
});

test('the editor places gadgets on the ground, picks them, sets them, mirrors them, and shows where they throw', async () => {
  const { loadDosFolder } = await import('../tools/dosshot.mjs');
  const { buildCustom, standY } = await import('../src/editor/build.js');
  const { newLevel } = await import('../src/editor/format.js');
  const { shot } = await import('../src/editor/analyse.js');
  const dos = loadDosFolder();
  globalThis.document ??= { createElement: () => ({ getContext: () => ({}) }) };
  const { Editor } = await import('../src/editor/editor.js');
  const spec = check(newLevel(0, standY(dos, 0, 0, 128)));
  const ed = Object.create(Editor.prototype);
  Object.assign(ed, { entry: { spec }, hooks: { dos: () => dos }, undoStack: [], redoStack: [], more: [], sel: null, tool: 'things', opts: {}, cam: { z: 1 },
    selbar: { querySelectorAll: () => [], hidden: true }, gadbar: { querySelectorAll: () => [], hidden: true, style: {} }, toast() {}, draw() {},
    changed() { this.spec.v = this.spec.objects.some((o) => o.k) ? 2 : 1; this.built = buildCustom(this.spec, dos); } });
  ed.built = buildCustom(spec, dos);
  const ground = ed.ground(200, 100);
  for (const [k, x] of [['flip', 200], ['cannon', 300]]) { ed.opts.thing = k; ed.tap({ x, y: 100 }, null); }
  assert.deepEqual(spec.objects.slice(2), [{ k: 'flip', x: 200, y: ground, dir: 1, ang: 45, pow: 5 }, { k: 'cannon', x: 300, y: ground, aim: 45, pow: 6 }]);
  assert.equal(spec.v, 2);
  assert.deepEqual(ed.hit(200, ground - 4), { t: 'object', i: 2 }, 'tapping a flip board picks it');
  assert.deepEqual(ed.hit(300, ground - 10), { t: 'object', i: 3 });
  ed.setAll([{ t: 'object', i: 2 }]);
  ed.selAction('ang+'); ed.selAction('pow+'); ed.selAction('gdir');
  assert.deepEqual([spec.objects[2].ang, spec.objects[2].pow, spec.objects[2].dir], [50, 6, -1]);
  ed.setAll([{ t: 'object', i: 3 }]);
  ed.selAction('aim+'); ed.selAction('gdir');
  assert.equal(spec.objects[3].aim, 130);
  // mirrored as a pair: they swap sides and turn round
  ed.setAll([{ t: 'object', i: 2 }, { t: 'object', i: 3 }]);
  ed.multiAction('mh');
  assert.deepEqual([spec.objects[2].x, spec.objects[2].dir, spec.objects[3].x, spec.objects[3].aim], [302, 1, 202, 50], 'about the middle of the pair');
  // the aiming line: the cannon (gadget 1) throws up and to the right, onto the flat ground
  const r = shot(ed.built.level, 1);
  assert.ok(r.pts.length > 10 && r.x > 200 && Math.abs(r.y - ground) <= 1 && !r.out, JSON.stringify({ x: r.x, y: r.y }));
});
