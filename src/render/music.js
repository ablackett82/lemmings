// Music: a little two-voice chip tune behind each level. The DOS game plays
// its own arrangements of old tunes (the can-can among them); these are new
// arrangements of tunes that are out of copyright, a different one for each
// level in turn.

const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const hz = (n) => {
  const m = /^([A-G])([#b]?)(\d)$/.exec(n);
  const semis = NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) - 4) * 12 - 9; // from A4
  return 440 * 2 ** (semis / 12);
};
// "C5:2 D5" = C5 for 2 beats (eighths), D5 for 1; "-" is a rest
const parse = (s) => s.trim().split(/\s+/).map((t) => { const [n, d] = t.split(':'); return [n, Number(d || 1)]; });

const TUNES = [
  { // Offenbach: the can-can (Galop infernal)
    tempo: 300,
    melody: parse(`C5:2 D5 F5 E5 D5 G5:2 G5:2 G5 A5 E5 F5 D5:2 D5:2 D5 F5 E5 D5 C5 C6 B5 A5 G5 F5 E5 D5 C5:4
      C5:2 D5 F5 E5 D5 G5:2 G5:2 G5 A5 E5 F5 D5:2 D5:2 D5 F5 E5 D5 C5 G5 D5 E5 C5:4 -:4`),
    bass: 'C3 G3 C3 G3 G2 D3 G2 D3 C3 G3 C3 G3 G2 D3 C3 C3',
  },
  { // London Bridge is falling down
    tempo: 240,
    melody: parse(`G5:3 A5 G5:2 F5:2 E5:2 F5:2 G5:4 D5:2 E5:2 F5:4 E5:2 F5:2 G5:4
      G5:3 A5 G5:2 F5:2 E5:2 F5:2 G5:4 D5:4 G5:4 E5:2 C5:6`),
    bass: 'C3 G3 C3 G3 G2 D3 C3 G3 C3 G3 C3 G3 G2 D3 C3 C3',
  },
  { // Frere Jacques
    tempo: 220,
    melody: parse(`C5:2 D5:2 E5:2 C5:2 C5:2 D5:2 E5:2 C5:2 E5:2 F5:2 G5:4 E5:2 F5:2 G5:4
      G5 A5 G5 F5 E5:2 C5:2 G5 A5 G5 F5 E5:2 C5:2 C5:2 G4:2 C5:4 C5:2 G4:2 C5:4`),
    bass: 'C3 G3 C3 G3 C3 G3 C3 G3 C3 G3 C3 G3 C3 G3 C3 G3',
  },
  { // Yankee Doodle
    tempo: 260,
    melody: parse(`C5:2 C5:2 D5:2 E5:2 C5:2 E5:2 D5:4 C5:2 C5:2 D5:2 E5:2 C5:4 B4:4
      C5:2 C5:2 D5:2 E5:2 F5:2 E5:2 D5:2 C5:2 B4:2 G4:2 A4:2 B4:2 C5:4 C5:4`),
    bass: 'C3 G3 C3 G3 C3 G3 G2 D3 C3 G3 C3 G3 G2 D3 C3 C3',
  },
];

export class Music {
  constructor(sound) {
    this.sound = sound;
    this.timer = null;
  }

  start(n) {
    this.stop();
    const s = this.sound;
    if (!s.ctx) return;
    const tune = TUNES[n % TUNES.length];
    const beat = 60 / tune.tempo; // seconds per eighth
    // one time round the tune, as notes [start, Hz, length, wave, volume]
    const bass = tune.bass.split(' ');
    const notes = [];
    let pos = 0;
    for (const [n, d] of tune.melody) {
      if (n !== '-') notes.push([pos * beat, hz(n), d * beat, 'square', 0.5]);
      pos += d;
    }
    const loop = pos * beat;
    for (let b = 0; b < pos; b += 2) {
      // oom-pah: the bass note, then an octave up
      const f = hz(bass[Math.floor(b / 4) % bass.length]);
      notes.push([b * beat, (b & 2) ? f * 2 : f, beat * 1.6, 'triangle', 0.9]);
    }
    notes.sort((x, y) => x[0] - y[0]);
    this.gain = s.ctx.createGain();
    this.gain.gain.value = 0.18;
    this.gain.connect(s.out);
    const play = ([, f, dur, type, vol], at) => {
      const o = s.ctx.createOscillator(), g = s.ctx.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(vol, at);
      g.gain.setValueAtTime(vol, at + dur * 0.7);
      g.gain.linearRampToValueAtTime(0, at + dur * 0.95);
      o.connect(g).connect(this.gain);
      o.start(at); o.stop(at + dur);
    };
    // schedule a little ahead, every 100 ms
    let start = s.ctx.currentTime + 0.1, i = 0;
    const tick = () => {
      const now = s.ctx.currentTime;
      if (s.ctx.state !== 'running') return;
      if (start + (notes[i]?.[0] ?? 0) < now) { start = now + 0.05 - notes[i][0]; } // fell behind (asleep): carry on from here
      while (start + notes[i][0] < now + 0.4) {
        play(notes[i], start + notes[i][0]);
        if (++i >= notes.length) { i = 0; start += loop; }
      }
    };
    tick();
    this.timer = setInterval(tick, 100);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.gain) { try { this.gain.disconnect(); } catch { /* already gone */ } this.gain = null; }
  }
}
