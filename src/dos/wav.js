// PCM .WAV files (the Windows 95 version's sounds: 8-bit mono, at odd sample
// rates some browsers won't take directly), read into samples -1..1.

/** Returns { rate, data: Float32Array } (the first channel). */
export function readWav(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = (o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
  let fmt = null, p = 12;
  while (p + 8 <= b.length) {
    const id = tag(p), size = dv.getUint32(p + 4, true), body = p + 8;
    if (id === 'fmt ') fmt = { format: dv.getUint16(body, true), channels: dv.getUint16(body + 2, true), rate: dv.getUint32(body + 4, true), bits: dv.getUint16(body + 14, true) };
    else if (id === 'data' && fmt) {
      if (fmt.format !== 1 || (fmt.bits !== 8 && fmt.bits !== 16)) throw new Error('unsupported WAV format');
      const step = fmt.channels * fmt.bits / 8, n = Math.floor(Math.min(size, b.length - body) / step);
      const data = new Float32Array(n);
      for (let i = 0; i < n; i++) data[i] = fmt.bits === 8 ? (b[body + i * step] - 128) / 128 : dv.getInt16(body + i * step, true) / 32768;
      return { rate: fmt.rate, data };
    }
    p = body + size + (size & 1);
  }
  throw new Error('WAV file has no sound in it');
}
