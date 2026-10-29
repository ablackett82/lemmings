// The type of a shared level comes from the average of its votes; the editor's
// Random button picks any of the terrain sets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kindOf, kindScore, statsLine } from '../src/editor/store.js';
import { SETS, randomSet } from '../src/editor/sets.js';

const votes = (fun = 0, tricky = 0, taxing = 0, mayhem = 0) => ({ votes: { fun, tricky, taxing, mayhem } });

test('a level nobody has called anything has no type', () => {
  assert.equal(kindOf(votes()), null);
  assert.equal(kindOf({}), null);
  assert.equal(kindScore(undefined), null);
});

test('the type is the average of the votes, rounded', () => {
  assert.equal(kindOf(votes(3)), 'fun');
  assert.equal(kindOf(votes(0, 0, 0, 1)), 'mayhem');
  assert.equal(kindOf(votes(1, 1)), 'tricky');          // 0.5 rounds up
  assert.equal(kindOf(votes(2, 0, 0, 1)), 'tricky');    // 1.0
  assert.equal(kindOf(votes(1, 0, 1)), 'tricky');       // 1.0: between fun and taxing
  assert.equal(kindOf(votes(0, 1, 2)), 'taxing');       // 1.67
});

test('the stats line names the type', () => {
  const st = { attempts: 2, wins: 1, stars: 4, ratings: 3, ...votes(0, 0, 3) };
  assert.equal(statsLine(st), '★ 4 (3) · Taxing · 2 goes · 1 won (50%)');
  assert.equal(statsLine({ attempts: 0, wins: 0, stars: null, ratings: 0 }), 'No stars yet · 0 goes');
});

test('Random can pick every set, and only sets', () => {
  assert.equal(randomSet(() => 0), 0);
  assert.equal(randomSet(() => 0.999999), SETS.length - 1);
  assert.equal(randomSet(() => 1), SETS.length - 1);
  const seen = new Set(Array.from({ length: 500 }, () => randomSet()));
  assert.equal(seen.size, SETS.length);
});
