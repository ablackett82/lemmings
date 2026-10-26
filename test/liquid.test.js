// Water and lava (liquid.js): filling a hollow in the editor, staying put,
// pouring out of a hole and filling what's below, off the bottom of the level,
// drowning and burning lemmings, and replaying the same every time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, Lemming, WORLD_W as W, WORLD_H as H } from '../src/game/engine.js';
import { fillLiquid, WATER, LAVA } from '../src/game/liquid.js';
import { check, version, playKey } from '../src/editor/format.js';
import { Recorder, replayTo } from '../src/editor/replay.js';

/** Ground: rects [x0, x1, y0, y1]. */
function ground(rects) {
  const pix = new Uint8Array(W * H);
  for (const [x0, x1, y0, y1] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) pix[y * W + x] = 8;
  return pix;
}

/** A level: the ground, and liquid items ({ x, y, s, kind }) filled as the editor does. */
function level(pix, items, extra = {}) {
  const liquid = new Uint8Array(W * H);
  for (const it of items) {
    const f = fillLiquid(pix, it);
    for (let k = 0; k < f.n; k++) liquid[f.cells[k]] = it.kind ?? WATER;
  }
  return { terrain: pix, steel: [], objects: [], count: 1, save: 0, rate: 50, time: 5, skills: {}, brick: 64, liquid, ...extra };
}

const game = (lv) => new Game(lv, { noTimeLimit: true });
const amount = (g, x0 = 0, x1 = W, y0 = 0, y1 = H, kind = 0) => {
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const k = g.wet[y * W + x]; if (k && (!kind || k === kind)) n++; }
  return n;
};
const run = (g, n) => { for (let i = 0; i < n; i++) g.step(); };

// a bowl up high (inside x 104..160, floor at 60), and a wide basin below it (inside x 64..296, floor at 140)
const BOWL = [[100, 165, 60, 64], [100, 104, 20, 64], [161, 165, 20, 64]];
const BASIN = [[60, 300, 140, 146], [60, 64, 110, 146], [296, 300, 110, 146]];

test('the editor fills a hollow up to a level, or to its brim, and not one that would run out', () => {
  const pix = ground(BOWL);
  const f = fillLiquid(pix, { x: 130, y: 40, s: 30 });
  assert.equal(f.y, 59, 'settles to the bottom of the hollow');
  assert.equal(f.s, 30);
  assert.equal(f.n, 57 * 30);
  assert.equal(f.full, false);
  const over = fillLiquid(pix, { x: 130, y: 40, s: 5 });
  assert.equal(over.s, 20, 'too full: up to the brim');
  assert.equal(over.full, true);
  assert.equal(fillLiquid(pix, { x: 300, y: 40, s: 30 }).n, 0, 'nothing to hold it: it would run out');
  // a crack in the side, low down: it can only be filled up to the crack
  for (let y = 50; y < 52; y++) for (let x = 161; x < 165; x++) pix[y * W + x] = 0;
  const cracked = fillLiquid(pix, { x: 130, y: 40, s: 30 });
  assert.equal(cracked.s, 52);
  assert.equal(cracked.full, true);
});

test('liquid in a hollow stays as it is, and costs nothing', () => {
  const g = game(level(ground(BOWL), [{ x: 130, y: 50, s: 30 }]));
  const before = g.wet.slice();
  run(g, 200);
  assert.deepEqual(g.wet, before);
  assert.ok(g.wetAwake.every((t) => t < g.iteration), 'nothing being looked at');
});

test('a hole in the side: it gushes out down to the hole, and fills the basin below, less deep', () => {
  const g = game(level(ground([...BOWL, ...BASIN]), [{ x: 130, y: 50, s: 25 }]));
  const total = amount(g);
  for (let y = 40; y < 46; y++) for (let x = 161; x < 165; x++) g.removePixel(x, y);
  run(g, 60);
  const bowl60 = amount(g, 104, 161, 0, 64);
  assert.ok(bowl60 < total - 500, `it pours out quickly (${total - bowl60} in 60 iterations)`);
  run(g, 340);
  assert.equal(amount(g), total, 'none lost');
  const bowl = amount(g, 104, 161, 0, 64);
  assert.ok(bowl >= 57 * 14 && bowl <= 57 * 15, `the bowl's left with what's below the hole (${bowl})`);
  // the basin's water is level
  const tops = [];
  for (let x = 70; x < 290; x += 20) { let y = 139; while (g.wet[(y - 1) * W + x]) y--; tops.push(y); }
  assert.ok(Math.max(...tops) - Math.min(...tops) <= 1, `level: ${tops}`);
  assert.ok(140 - Math.min(...tops) < 25, 'shallower than it was in the bowl');
});

test('a hole in the bottom: it pours out and off the bottom of the level', () => {
  const g = game(level(ground(BOWL), [{ x: 130, y: 50, s: 30 }]));
  for (let y = 60; y < 64; y++) for (let x = 128; x < 136; x++) g.removePixel(x, y);
  run(g, 400);
  assert.ok(amount(g) < 120, `most of it's gone (${amount(g)} left)`);
});

test('lava pours out more slowly than water', () => {
  const left = (kind) => {
    const g = game(level(ground(BOWL), [{ x: 130, y: 50, s: 25, kind }]));
    for (let y = 50; y < 60; y++) for (let x = 161; x < 165; x++) g.removePixel(x, y);
    run(g, 100);
    return amount(g, 104, 161, 0, 64);
  };
  assert.ok(left(LAVA) > left(WATER) * 2);
});

/** A lemming walking right from x on ground at y. */
function walker(g, x, y) {
  const L = new Lemming(0);
  g.lemmings.push(L); g.out = 1; g.released = 1;
  L.x = x; L.y = y; L.dx = 1;
  g.transition(L, 'walking');
  return L;
}

test('a lemming that walks into deep water drowns; a puddle it walks through', () => {
  // a pool 10 deep, set into the ground
  const pix = ground([[0, 400, 120, 160]]);
  for (let y = 110; y < 130; y++) for (let x = 100; x < 140; x++) pix[y * W + x] = 0;
  pix.fill(8, 129 * W + 100, 129 * W + 140);
  let g = game(level(pix, [{ x: 120, y: 125, s: 120 }]));
  let L = walker(g, 80, 119);
  const events = [];
  for (let i = 0; i < 200 && L.action !== 'drowning'; i++) { g.step(); events.push(...g.events); }
  assert.equal(L.action, 'drowning');
  assert.ok(events.includes('drown'));
  // a puddle 2 deep: walks on through
  g = game(level(pix, [{ x: 120, y: 128, s: 127 }]));
  L = walker(g, 80, 119);
  for (let i = 0; i < 200; i++) g.step();
  assert.equal(L.action, 'walking', 'it walks about in it');
  assert.ok(!L.removed);
});

test('any lava burns a lemming', () => {
  const pix = ground([[0, 400, 120, 160]]);
  for (let y = 110; y < 130; y++) for (let x = 100; x < 140; x++) pix[y * W + x] = 0;
  pix.fill(8, 129 * W + 100, 129 * W + 140);
  const g = game(level(pix, [{ x: 120, y: 128, s: 128, kind: LAVA }]));
  const L = walker(g, 80, 119);
  for (let i = 0; i < 200 && L.action !== 'vaporizing'; i++) g.step();
  assert.equal(L.action, 'vaporizing');
});

test('a basher that bashes into a full hollow lets it out, and drowns in it', () => {
  // a pool behind a wall, on a floor the lemming walks along
  const pix = ground([[0, 600, 140, 160], [300, 310, 60, 140], [400, 410, 60, 140]]);
  const lv = level(pix, [{ x: 350, y: 130, s: 80 }], { skills: { basher: 1 } });
  const g = game(lv);
  const L = walker(g, 280, 139);
  for (let i = 0; i < 30 && L.x < 295; i++) g.step();
  assert.equal(g.assignAt('basher', L.x, L.y - 5), L);
  const events = [];
  for (let i = 0; i < 300 && L.action !== 'drowning'; i++) { g.step(); events.push(...g.events); }
  assert.equal(L.action, 'drowning');
  g.count = 2; // (still going with the one lemming gone)
  run(g, 400);
  assert.ok(amount(g, 0, 300) > 1000, `the water came out (${amount(g, 0, 300)})`);
  // and it's found its level both sides of the wall, joined by the tunnel
  const surface = (x) => { let y = 139; while (g.wet[(y - 1) * W + x]) y--; return y; };
  assert.ok(Math.abs(surface(150) - surface(350)) <= 1, `level: ${surface(150)}, ${surface(350)}`);
});

test('a game with flowing water replays exactly', () => {
  const pix = ground([[0, 600, 140, 160], [300, 310, 60, 140], [400, 410, 60, 140]]);
  const lv = level(pix, [{ x: 350, y: 130, s: 80 }], { skills: { basher: 1 }, count: 1 });
  const g = game(lv), rec = new Recorder();
  const L = walker(g, 280, 139);
  for (let i = 0; i < 30 && L.x < 295; i++) { rec.beforeStep(g); g.step(); }
  rec.assign(g, 'basher', L); g.assign('basher', L);
  for (let i = 0; i < 150; i++) { rec.beforeStep(g); g.step(); }
  // the same again, from the log
  const lv2 = { ...lv, liquid: lv.liquid.slice() };
  const h = new Game(lv2, { noTimeLimit: true });
  const M = walker(h, 280, 139);
  const log = rec.log.slice();
  let k = 0;
  while (h.iteration < g.iteration) {
    while (k < log.length && log[k][0] === h.iteration) { if (log[k][1] === 'a') h.assign(log[k][2], M); k++; }
    h.step();
  }
  assert.deepEqual(h.wet, g.wet);
  assert.equal(M.action, L.action);
  assert.ok(replayTo, 'replay.js is the same machinery');
});

test('levels with water or lava are saved as v 3', () => {
  const spec = check({ v: 3, set: 0, terrain: [], objects: [{ id: 1, x: 10, y: 10 }, { k: 'water', x: 100, y: 50, s: 30 }, { k: 'lava', x: 5000, y: -4, s: 999 }] });
  assert.equal(spec.v, 3);
  assert.deepEqual(spec.objects[1], { k: 'water', x: 100, y: 50, s: 30 });
  assert.deepEqual(spec.objects[2], { k: 'lava', x: W - 1, y: 0, s: 159 });
  assert.equal(version({ objects: [{ k: 'cannon' }] }), 2);
  assert.equal(version({ objects: [{ id: 0 }] }), 1);
  assert.notEqual(playKey(spec), playKey({ ...spec, objects: [spec.objects[0], { ...spec.objects[1], s: 31 }, spec.objects[2]] }), 'how full it is changes the level');
});

test('a pond with a lumpy bottom leaves puddles in the dips when it drains', () => {
  // a pond, its floor two dips either side of a hump, drained through its right-hand side
  const pix = ground([[96, 100, 40, 130], [260, 264, 40, 130], [100, 260, 120, 130], [170, 190, 100, 120], [100, 110, 110, 120], [250, 260, 110, 120]]);
  const g = game(level(pix, [{ x: 140, y: 60, s: 70 }]));
  for (let y = 60; y < 110; y++) for (let x = 250; x < 264; x++) g.removePixel(x, y);
  run(g, 500);
  assert.equal(amount(g, 110, 170, 0, 130), 60 * 20, 'the left dip, full to its lip (the hump in the middle)');
  const right = amount(g, 190, 250, 0, 130);
  assert.ok(right >= 60 * 10 && right <= 60 * 11, `the right dip, full to its lower lip (give or take a film level with it: ${right})`);
  assert.equal(amount(g, 100, 260, 0, 100), 0, 'nothing above the lips');
});

test('the editor fills a hollow where it\'s tapped, makes it fuller, emptier and full, and turns it to lava', async () => {
  const { loadDosFolder } = await import('../tools/dosshot.mjs');
  const { buildCustom, standY } = await import('../src/editor/build.js');
  const { newLevel } = await import('../src/editor/format.js');
  const dos = loadDosFolder();
  globalThis.document ??= { createElement: () => ({ getContext: () => ({}) }) };
  const { Editor } = await import('../src/editor/editor.js');
  const spec = check(newLevel(0, standY(dos, 0, 0, 128)));
  // two walls on the ground make a hollow, x 205..295, its top at 60
  spec.terrain.push({ k: 'paint', r: 5, pts: [[200, 60], [200, 128]] }, { k: 'paint', r: 5, pts: [[300, 60], [300, 128]] });
  const ed = Object.create(Editor.prototype);
  const bar = { querySelectorAll: () => [], querySelector: () => null, hidden: true, style: {} };
  Object.assign(ed, { entry: { spec }, hooks: { dos: () => dos }, undoStack: [], redoStack: [], more: [], sel: null, tool: 'water', opts: { liquid: 'water' }, cam: { z: 1 },
    selbar: { ...bar }, gadbar: { ...bar }, toast(m) { this.said = m; }, draw() {},
    changed() { this.spec.v = version(this.spec); this.built = buildCustom(this.spec, dos); } });
  ed.built = buildCustom(spec, dos);
  ed.tap({ x: 250, y: 100 }, null);
  const w = spec.objects[2];
  assert.equal(w.k, 'water');
  assert.equal(w.s, 100, 'up to where it was tapped');
  assert.ok(w.y > 120, 'kept as the bottom of the hollow');
  assert.equal(spec.v, 3);
  assert.ok(ed.built.level.liquid[110 * W + 250] && !ed.built.level.liquid[99 * W + 250]);
  assert.deepEqual(ed.hit(250, 110), { t: 'object', i: 2 }, 'tapping in it picks it');
  assert.deepEqual(ed.sel, { t: 'object', i: 2 });
  ed.fill(-1); ed.fill(-1);
  assert.equal(w.s, 98);
  ed.selAction('brim');
  assert.ok(w.s <= 62 && ed.built.liquids[2].full, `to the top (${w.s})`);
  ed.fill(-1);
  assert.equal(w.s, ed.built.liquids[2].s, 'no fuller than full');
  ed.selAction('liquid');
  assert.equal(w.k, 'lava');
  assert.ok(ed.built.level.liquid.includes(LAVA));
  // out on the open ground there's nothing to hold it
  ed.tap({ x: 500, y: 100 }, null);
  assert.equal(spec.objects.length, 3);
  assert.match(ed.said, /run out/);
});
