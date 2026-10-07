// Sound, played from the game's events. With the Windows 95 version's sound
// files loaded, the original recordings ("Let's go!", "Oh no!", "Yippee!",
// the splats, the traps); without them, synthesized stand-ins.

import { readWav } from '../dos/wav.js';

// event: the Windows 95 sound file for it
const SAMPLES = {
  letsgo: 'letsgo.wav', door: 'door.wav', assign: 'mousepre.wav', tick: 'changeop.wav', yippee: 'yippee.wav',
  splat: 'splat.wav', ohno: 'ohno.wav', explode: 'explode.wav', drown: 'glug.wav', fry: 'fire.wav',
  steel: 'chink.wav', buildwarn: 'ting.wav',
  // the traps, by the sound number in the graphic set: electric, crusher, rope, 10 tons, bear trap
  trap6: 'electric.wav', trap7: 'thunk.wav', trap9: 'chain.wav', trap14: 'tenton.wav', trap15: 'mantrap.wav',
};
/** The sound files used, for the loader. */
export const SOUND_FILES = [...new Set(Object.values(SAMPLES))];

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.noiseBuf = null;
    this.music = null;
    this.wavs = {};      // name: { rate, data }
    this.buffers = {};   // name: AudioBuffer
  }

  /** The Windows 95 sound files ({ 'ohno.wav': Uint8Array, ... }), or none. */
  setSamples(files) {
    this.wavs = {}; this.buffers = {};
    for (const name of SOUND_FILES) {
      if (!files?.[name]) continue;
      try { this.wavs[name] = readWav(files[name]); } catch { /* leave that one synthesized */ }
    }
  }
  get hasSamples() { return Object.keys(this.wavs).length > 0; }

  /** A recording as an AudioBuffer at the context's own rate (resampled here: Safari won't take 3-11 kHz buffers). */
  buffer(name) {
    if (this.buffers[name]) return this.buffers[name];
    const w = this.wavs[name];
    if (!w) return null;
    const rate = this.ctx.sampleRate, k = w.rate / rate, n = Math.max(1, Math.floor(w.data.length / k));
    const buf = this.ctx.createBuffer(1, n, rate), out = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const x = i * k, j = Math.floor(x), t = x - j;
      out[i] = (w.data[j] ?? 0) * (1 - t) + (w.data[j + 1] ?? w.data[j] ?? 0) * t;
    }
    return (this.buffers[name] = buf);
  }

  sample(name) {
    const buf = this.buffer(name);
    if (!buf) return false;
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain();
    s.buffer = buf; g.gain.value = 1.6;
    s.connect(g).connect(this.out);
    s.start();
    return true;
  }

  /** Must be called from a user gesture on iOS. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.out = this.ctx.createGain();
      this.out.gain.value = this.muted ? 0 : 0.35;
      this.out.connect(this.ctx.destination);
      const n = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, n, n);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted') this.ctx.resume().catch(() => {});
  }

  setMuted(on) {
    this.muted = on;
    if (this.out) this.out.gain.value = on ? 0 : 0.35;
  }

  get ready() { return this.ctx && this.ctx.state === 'running'; }

  /** The game's events from the iterations just run. */
  play(events) {
    if (!this.ready) return;
    for (const e of new Set(events)) {
      if (SAMPLES[e] && this.sample(SAMPLES[e])) continue;
      (this[e] ?? (e.startsWith('trap') ? this.trap : null))?.call(this);
    }
  }

  tone(type, f0, f1, dur, vol = 0.5, at = 0) {
    const c = this.ctx, t = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.out);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noise(dur, f0, f1, vol = 0.6, q = 1, at = 0) {
    const c = this.ctx, t = c.currentTime + at;
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf;
    f.type = 'bandpass'; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.out);
    s.start(t); s.stop(t + dur + 0.02);
  }

  // the cheery little voice: "let's go!"
  letsgo() { this.tone('square', 520, 600, 0.12, 0.25); this.tone('square', 780, 900, 0.18, 0.25, 0.14); }
  door() { this.noise(0.5, 300, 1200, 0.3, 4); this.tone('sawtooth', 90, 140, 0.45, 0.12); }
  assign() { this.tone('square', 1200, 1200, 0.03, 0.2); this.tone('square', 1800, 1800, 0.03, 0.15, 0.03); }
  yippee() { this.tone('square', 600, 1500, 0.18, 0.2); this.tone('square', 900, 1900, 0.15, 0.15, 0.17); }
  splat() { this.noise(0.25, 400, 80, 0.8, 1.5); }
  ohno() { this.tone('square', 700, 620, 0.16, 0.22); this.tone('square', 520, 380, 0.3, 0.22, 0.18); }
  explode() { this.noise(0.6, 1500, 60, 1, 0.7); this.tone('sine', 120, 40, 0.5, 0.6); }
  drown() { for (let i = 0; i < 5; i++) this.tone('sine', 300 + i * 90, 700 + i * 60, 0.07, 0.25, i * 0.08); }
  fry() { this.noise(0.6, 3000, 1500, 0.45, 2); }
  trap() { this.tone('square', 200, 60, 0.25, 0.3); this.noise(0.2, 800, 200, 0.6, 2, 0.02); }
  steel() { this.tone('triangle', 2400, 2300, 0.25, 0.3); }
  buildwarn() { this.tone('square', 1000, 1000, 0.04, 0.15); }
  tick() { this.tone('square', 1500, 1500, 0.02, 0.12); }
}
