// Standard MIDI files (the Windows 95 version's music): read into one list of
// notes in seconds, tempo changes applied.

/**
 * Returns { notes: [{ t, dur, ch, key, vel, prog }], length } with times in
 * seconds. Channel 10 (ch 9) is the drums.
 */
export function readMidi(b) {
  const str = (o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  const u32 = (o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  if (str(0) !== 'MThd') throw new Error('not a MIDI file');
  const tracks = (b[10] << 8) | b[11], division = (b[12] << 8) | b[13];
  if (division & 0x8000) throw new Error('SMPTE timing not supported');
  const events = []; // [tick, order, kind, ...]
  let p = 8 + u32(4);
  for (let t = 0; t < tracks && p < b.length; t++) {
    if (str(p) !== 'MTrk') break;
    const end = p + 8 + u32(p + 4);
    p += 8;
    let tick = 0, status = 0;
    const vlq = () => { let v = 0, c; do { c = b[p++]; v = (v << 7) | (c & 0x7f); } while (c & 0x80 && p < end); return v; };
    while (p < end) {
      tick += vlq();
      let s = b[p];
      if (s & 0x80) p++; else s = status; // running status
      if (s === 0xff) {
        const type = b[p++], len = vlq();
        if (type === 0x51) events.push([tick, events.length, 'tempo', (b[p] << 16) | (b[p + 1] << 8) | b[p + 2]]);
        p += len;
      } else if (s === 0xf0 || s === 0xf7) {
        p += vlq();
      } else {
        status = s;
        const kind = s & 0xf0, ch = s & 0x0f;
        const d1 = b[p++], d2 = kind === 0xc0 || kind === 0xd0 ? 0 : b[p++];
        if (kind === 0x90 && d2) events.push([tick, events.length, 'on', ch, d1, d2]);
        else if (kind === 0x80 || kind === 0x90) events.push([tick, events.length, 'off', ch, d1]);
        else if (kind === 0xc0) events.push([tick, events.length, 'prog', ch, d1]);
        else if (kind === 0xb0 && d1 === 7) events.push([tick, events.length, 'vol', ch, d2]);
      }
    }
    p = end;
  }
  events.sort((a, c) => a[0] - c[0] || a[1] - c[1]);

  // ticks to seconds, through the tempo changes
  let usPerBeat = 500000, lastTick = 0, time = 0;
  const prog = new Array(16).fill(0), vol = new Array(16).fill(100);
  const open = new Map(), notes = [];
  for (const e of events) {
    time += (e[0] - lastTick) * usPerBeat / division / 1e6;
    lastTick = e[0];
    const [, , kind, a, k, v] = e;
    if (kind === 'tempo') usPerBeat = a;
    else if (kind === 'prog') prog[a] = k;
    else if (kind === 'vol') vol[a] = k;
    else if (kind === 'on') {
      const id = a * 128 + k;
      if (open.has(id)) { const n = open.get(id); n.dur = time - n.t; }
      const n = { t: time, dur: 0.5, ch: a, key: k, vel: v * vol[a] / 127 / 127, prog: prog[a] };
      notes.push(n); open.set(id, n);
    } else if (kind === 'off') {
      const n = open.get(a * 128 + k);
      if (n) { n.dur = Math.max(0.02, time - n.t); open.delete(a * 128 + k); }
    }
  }
  return { notes, length: time };
}
