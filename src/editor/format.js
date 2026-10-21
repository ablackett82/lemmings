// A level made in the editor, as it's saved and shared:
//
// { v: 1, name, author, set (0..4: Dirt, Fire, Marble, Pillar, Crystal),
//   count, save, rate, time (minutes), skills: { climber: n, ... }, start,
//   terrain: [item, ...] (drawn in order), objects: [{ id, x, y, fv?, behind?, g? }],
//   sv: 2 (steel is drawn: the 'steel' items below. Without it, an older level,
//     where each of the set's steel pieces made its own area: see upgradeSteel()),
//   proof?: a recorded win (replay.js) }
//
// Terrain items:
//   { k: 'piece', p, x, y, fv?, fh?, behind?, erase? }   one of the set's pieces, top left at x, y
//   { k: 'paint', r, pts: [[x, y], ...] }              the paint brush (the set's texture)
//   { k: 'erase', r, pts }                             the rubber
//   { k: 'stamp', s, x, y, dir, n? }                   a skill stamp (build.js)
//   { k: 'steel', x, y, w, h }                         an area lemmings can't dig into (invisible in the game)
// Any terrain item or object may also have g: a group number. Items with the
// same g are picked, moved, copied, flipped and deleted together in the
// editor. It changes nothing about how the level plays.

import { SKILLS, WORLD_W } from '../game/engine.js';

export const LIMITS = { count: [1, 80], rate: [1, 99], time: [1, 9], skill: [0, 99] };

/** A new level: the set's ground along the bottom (its top at y 128), an entrance and an exit (exitY: its top, from standY()). */
export function newLevel(set = 0, exitY = 112) {
  return {
    v: 1, sv: 2, name: '', author: '', set,
    count: 20, save: 10, rate: 50, time: 5,
    skills: Object.fromEntries(SKILLS.map((s) => [s, 5])),
    start: 0,
    terrain: [{ k: 'paint', r: 12, pts: [[30, 140], [610, 140]] }],
    objects: [{ id: 1, x: 100, y: 70 }, { id: 0, x: 480, y: exitY }],
  };
}

/** Checks a level read from storage or the server; returns a clean copy, or throws. */
export function check(spec) {
  if (!spec || spec.v !== 1) throw new Error('not a level');
  const int = (v, lo, hi, d = lo) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, Math.round(+v))) : d);
  const out = {
    v: 1, name: String(spec.name ?? '').slice(0, 40), author: String(spec.author ?? '').slice(0, 24),
    set: int(spec.set, 0, 4),
    count: int(spec.count, ...LIMITS.count, 20), rate: int(spec.rate, ...LIMITS.rate, 50), time: int(spec.time, ...LIMITS.time, 5),
    skills: Object.fromEntries(SKILLS.map((s) => [s, int(spec.skills?.[s], ...LIMITS.skill, 0)])),
    start: int(spec.start, 0, WORLD_W),
    terrain: [], objects: [],
  };
  if (spec.sv === 2) out.sv = 2;
  out.save = int(spec.save, 0, out.count, 1);
  const pts = (a) => (Array.isArray(a) ? a.slice(0, 4000).map((p) => [int(p?.[0], -100, 1700), int(p?.[1], -100, 260)]) : []);
  for (const it of Array.isArray(spec.terrain) ? spec.terrain.slice(0, 3000) : []) {
    const flags = (o) => { for (const f of ['fv', 'fh', 'behind', 'erase']) if (it[f]) o[f] = true; return o; };
    const before = out.terrain.length;
    if (it?.k === 'piece') out.terrain.push(flags({ k: 'piece', p: int(it.p, 0, 63), x: int(it.x, -300, 1900), y: int(it.y, -300, 460) }));
    else if (it?.k === 'steel') out.terrain.push({ k: 'steel', x: int(it.x, -300, 1900), y: int(it.y, -300, 460), w: int(it.w, 4, 1700, 4), h: int(it.h, 4, 170, 4) });
    else if (it?.k === 'paint' || it?.k === 'erase') out.terrain.push({ k: it.k, r: int(it.r, 1, 40), pts: pts(it.pts) });
    else if (it?.k === 'stamp' && ['build', 'bash', 'mine', 'dig', 'bomb'].includes(it.s)) {
      out.terrain.push({ k: 'stamp', s: it.s, x: int(it.x, 0, 1647), y: int(it.y, 0, 163), dir: it.dir < 0 ? -1 : 1, n: int(it.n, 1, 40, 1) });
    }
    if (out.terrain.length > before && it.g) out.terrain.at(-1).g = int(it.g, 1, 9999);
  }
  for (const o of Array.isArray(spec.objects) ? spec.objects.slice(0, 32) : []) {
    const c = { id: int(o?.id, 0, 15), x: int(o?.x, -300, 1900), y: int(o?.y, -300, 460) };
    if (o.fv) c.fv = true;
    if (o.behind) c.behind = true;
    if (o.g) c.g = int(o.g, 1, 9999);
    out.objects.push(c);
  }
  if (spec.proof && Array.isArray(spec.proof.log)) out.proof = { log: spec.proof.log.slice(0, 5000), key: String(spec.proof.key ?? '') };
  return out;
}

/** A short fingerprint of the parts of a level that change how it plays: a proof only counts for these. */
export function playKey(spec) {
  const { name, author, proof, ...rest } = spec;
  const s = JSON.stringify(rest, (k, v) => (k === 'g' ? undefined : v)); // grouping changes nothing about play
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36) + s.length.toString(36);
}
