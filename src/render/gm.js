// A small General MIDI synth for the Windows 95 version's music: each GM
// instrument family as an oscillator voice (wave, envelope, filter), and the
// drum kit made from noise and pitched sweeps. Not a sound card's samples,
// but the right tune on roughly the right instruments.

// by GM family (program >> 3): wave, attack, decay, sustain level, release,
// lowpass (times the note's frequency, 0 = none), volume, detune (cents, for a second voice)
const FAMILY = [
  { wave: 'triangle', a: 0.005, d: 0.6, s: 0.15, r: 0.25, lp: 0, vol: 0.9 },              // piano
  { wave: 'sine', a: 0.002, d: 0.35, s: 0, r: 0.2, lp: 0, vol: 0.8 },                     // chromatic percussion
  { wave: 'square', a: 0.01, d: 0.1, s: 0.8, r: 0.08, lp: 6, vol: 0.45 },                 // organ
  { wave: 'triangle', a: 0.003, d: 0.4, s: 0.1, r: 0.15, lp: 0, vol: 0.9 },               // guitar
  { wave: 'triangle', a: 0.004, d: 0.3, s: 0.5, r: 0.08, lp: 0, vol: 1.3 },               // bass
  { wave: 'sawtooth', a: 0.06, d: 0.2, s: 0.75, r: 0.25, lp: 4, vol: 0.4, det: 8 },       // strings
  { wave: 'sawtooth', a: 0.05, d: 0.2, s: 0.75, r: 0.3, lp: 3, vol: 0.4, det: 10 },       // ensemble
  { wave: 'sawtooth', a: 0.03, d: 0.15, s: 0.7, r: 0.12, lp: 3.5, vol: 0.45 },            // brass
  { wave: 'square', a: 0.03, d: 0.1, s: 0.75, r: 0.1, lp: 4, vol: 0.4 },                  // reed
  { wave: 'sine', a: 0.03, d: 0.1, s: 0.8, r: 0.1, lp: 0, vol: 0.8 },                     // pipe
  { wave: 'sawtooth', a: 0.008, d: 0.1, s: 0.7, r: 0.1, lp: 6, vol: 0.4 },                // synth lead
  { wave: 'sawtooth', a: 0.15, d: 0.3, s: 0.7, r: 0.4, lp: 2.5, vol: 0.35, det: 12 },     // synth pad
  { wave: 'triangle', a: 0.02, d: 0.5, s: 0.4, r: 0.4, lp: 0, vol: 0.6, det: 7 },         // synth effects
  { wave: 'triangle', a: 0.003, d: 0.35, s: 0.1, r: 0.15, lp: 0, vol: 0.8 },              // ethnic
  { wave: 'sine', a: 0.002, d: 0.2, s: 0, r: 0.1, lp: 0, vol: 0.9 },                      // percussive
  { wave: 'sine', a: 0.01, d: 0.3, s: 0.2, r: 0.2, lp: 0, vol: 0.5 },                     // sound effects
];
// a few that the tunes lean on, done better than their family
const PROGRAM = {
  45: { wave: 'triangle', a: 0.002, d: 0.25, s: 0, r: 0.1, lp: 0, vol: 1 },               // pizzicato strings
  46: { wave: 'triangle', a: 0.002, d: 0.8, s: 0, r: 0.3, lp: 0, vol: 0.9 },              // harp
  38: { wave: 'sawtooth', a: 0.004, d: 0.25, s: 0.4, r: 0.08, lp: 2.5, vol: 0.8 },        // synth bass
  55: { wave: 'sawtooth', a: 0.003, d: 0.3, s: 0, r: 0.1, lp: 5, vol: 0.6, det: 15 },     // orchestra hit
  98: { wave: 'sine', a: 0.002, d: 0.6, s: 0.1, r: 0.4, lp: 0, vol: 0.7, det: 1200 },     // crystal
};

const hz = (key) => 440 * 2 ** ((key - 69) / 12);

/** Play one note: { key, vel, dur, prog } at time `at` into `dest`. */
export function playNote(ctx, dest, n, at) {
  const v = PROGRAM[n.prog] ?? FAMILY[n.prog >> 3];
  const f = hz(n.key), peak = v.vol * n.vel;
  const end = Math.max(at + n.dur, at + v.a + 0.005), stop = end + v.r + 0.02;
  // attack, decay towards the sustain level, and from the note's end, release
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + v.a);
  g.gain.setTargetAtTime(peak * v.s, at + v.a, v.d / 3);
  g.gain.setTargetAtTime(0, end, v.r / 3);
  let out = g;
  if (v.lp) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = Math.min(12000, f * v.lp); lp.Q.value = 0.7;
    lp.connect(g);
    out = lp;
  }
  g.connect(dest);
  for (const det of v.det ? [-v.det / 2, v.det / 2] : [0]) {
    const o = ctx.createOscillator();
    o.type = v.wave; o.frequency.value = f; o.detune.value = det;
    const k = v.det ? ctx.createGain() : null;
    if (k) { k.gain.value = 0.6; o.connect(k).connect(out); } else o.connect(out);
    o.start(at); o.stop(stop);
  }
}

/** Play a drum (GM key on channel 10). */
export function playDrum(ctx, dest, noise, n, at) {
  const vel = n.vel;
  const hit = (dur, type, freq, q, vol, from = freq) => {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise; f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(from, at); f.frequency.exponentialRampToValueAtTime(freq, at + dur);
    g.gain.setValueAtTime(vol * vel, at); g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(at, Math.random() * 0.5); s.stop(at + dur + 0.02);
  };
  const tone = (dur, f0, f1, vol, type = 'sine') => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + dur);
    g.gain.setValueAtTime(vol * vel, at); g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    o.connect(g).connect(dest); o.start(at); o.stop(at + dur + 0.02);
  };
  const k = n.key;
  if (k === 35 || k === 36) tone(0.25, 140, 45, 1.6);                                   // kick
  else if (k === 38 || k === 40) { hit(0.18, 'bandpass', 1800, 0.8, 1.1); tone(0.08, 220, 160, 0.5, 'triangle'); } // snare
  else if (k === 39) { hit(0.12, 'bandpass', 1200, 1.2, 1); hit(0.1, 'bandpass', 1100, 1.2, 0.6); } // clap
  else if (k === 42 || k === 44) hit(0.05, 'highpass', 7000, 0.7, 0.5);                 // closed hi-hat
  else if (k === 46) hit(0.3, 'highpass', 7000, 0.7, 0.45);                             // open hi-hat
  else if (k === 49 || k === 57 || k === 52 || k === 55) hit(1.2, 'highpass', 5000, 0.5, 0.5, 8000); // crash
  else if (k === 51 || k === 59 || k === 53) { hit(0.5, 'bandpass', 6000, 2, 0.35); tone(0.4, 3200, 3000, 0.08, 'triangle'); } // ride
  else if (k >= 41 && k <= 50) tone(0.3, 60 + (k - 41) * 18, 40 + (k - 41) * 12, 1.1);  // toms
  else if (k === 54 || k === 69 || k === 70) hit(0.12, 'highpass', 6000, 1, 0.4);       // tambourine, cabasa, maracas
  else if (k === 80 || k === 81) tone(k === 80 ? 0.15 : 0.8, 2600, 2550, 0.25);         // triangle
  else if (k === 73 || k === 74) tone(0.08, 1800, 1500, 0.4, 'triangle');               // guiro
  else if (k === 75 || k === 76 || k === 77) tone(0.05, 2400, 2200, 0.5, 'triangle');   // claves, woodblocks
  else hit(0.1, 'bandpass', 2500, 1, 0.5);
}
