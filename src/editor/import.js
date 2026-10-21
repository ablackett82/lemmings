// An original level as an editor level (format.js), so it can be copied into
// My levels and changed. The pieces and objects are the ones the file lists,
// in the same order, so it builds back to the same level. The exceptions: the
// full-screen-picture levels (null: there are no pieces to edit), and the
// exits' roofs, which the editor adds to an exit itself. The original files'
// separate steel rectangles aren't copied: in the editor only the set's steel
// pieces are steel (see sets.js), so ground that doesn't look like steel never is.

import { SKILL_ORDER } from '../dos/dosdata.js';
import { SETS } from './sets.js';

const be16 = (b, o) => (b[o] << 8) | b[o + 1];

/** Original level i (0..119) as a spec, or null if it's drawn as one picture. */
export function originalSpec(dos, i) {
  const info = dos.levels[i];
  const raw = dos.levelSection(info.file, info.part);
  if (be16(raw, 0x1c)) return null;
  const stats = info.odd ? dos.odd.subarray((info.file * 8 + info.part) * 56) : raw;
  const setNo = be16(raw, 0x1a), set = dos.set(setNo);

  const terrain = [];
  for (let k = 0; k < 400; k++) {
    const o = 0x120 + k * 4;
    if (raw[o] === 0xff && raw[o + 1] === 0xff && raw[o + 2] === 0xff && raw[o + 3] === 0xff) continue;
    const v = ((raw[o] << 24) | (raw[o + 1] << 16) | (raw[o + 2] << 8) | raw[o + 3]) >>> 0;
    const p = v & 0x3f, flags = (v >>> 29) & 7, yv = (v >>> 7) & 0x1ff;
    if (!set.pieces[p]) continue;
    const it = { k: 'piece', p, x: ((v >>> 16) & 0xfff) - 16, y: yv - (yv > 256 ? 516 : 4) };
    if (flags & 2) it.fv = true;
    if (flags & 4) it.behind = true;
    if (flags & 1) it.erase = true;
    terrain.push(it);
  }

  let objects = [];
  for (let k = 0; k < 32; k++) {
    const o = 0x20 + k * 8, flags = be16(raw, o + 6);
    if (!flags || !set.objects[be16(raw, o + 4)]) continue;
    let y = be16(raw, o + 2); if (y >= 0x8000) y -= 0x10000;
    const ob = { id: be16(raw, o + 4), x: be16(raw, o) - 16, y };
    if (flags & 0x80) ob.fv = true;
    if (flags & 0x8000) ob.behind = true;
    objects.push(ob);
  }
  // an exit's roof comes with the exit in the editor
  const [roof, dy] = SETS[setNo].exitTop;
  const exits = objects.filter((o) => set.objects[o.id].effect === 'exit');
  objects = objects.filter((o) => !(o.id === roof && o.behind && exits.some((e) => e.x === o.x && e.y + dy === o.y)));

  const w = (k) => be16(stats, k);
  return {
    v: 1, name: info.name, author: '', set: setNo,
    count: w(2), save: w(4), rate: w(0), time: w(6),
    skills: Object.fromEntries(SKILL_ORDER.map((s, k) => [s, w(8 + k * 2)])),
    start: be16(raw, 0x18),
    terrain, objects,
  };
}
