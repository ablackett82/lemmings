// The DOS game's .DAT container: one or more compressed sections, each with
// a 10-byte header. The compression (as worked out by ccexplore, and as
// Lemmix and Lemmings.ts unpack it) is read as a bit stream backwards from the
// end of the section, and the output is written backwards too: raw runs, and
// copies of earlier (later in the file) output.

/** The sections of a .DAT file, unpacked: [Uint8Array, ...] */
export function unpackDat(file) {
  const out = [];
  let pos = 0;
  while (pos + 10 < file.length) {
    const bits = file[pos], checksum = file[pos + 1];
    const size = (file[pos + 4] << 8) | file[pos + 5];
    const packed = (file[pos + 8] << 8) | file[pos + 9];
    if (packed < 10 || pos + packed > file.length) break;
    out.push(unpackSection(file.subarray(pos + 10, pos + packed), size, bits, checksum));
    pos += packed;
  }
  return out;
}

function unpackSection(src, size, firstBits, checksum) {
  let pos = src.length - 1;
  let buf = src[pos], left = firstBits, sum = buf;
  const read = (n) => {
    let r = 0;
    while (n-- > 0) {
      if (left <= 0) { buf = src[--pos]; sum ^= buf; left = 8; }
      left--;
      r = (r << 1) | (buf & 1);
      buf >>= 1;
    }
    return r;
  };
  const dst = new Uint8Array(size);
  let o = size;
  const raw = (n) => { while (n-- > 0 && o > 0) dst[--o] = read(8); };
  const ref = (n, offBits) => {
    const off = read(offBits) + 1;
    if (o + off > size) throw new Error('bad DAT data');
    while (n-- > 0 && o > 0) { o--; dst[o] = dst[o + off]; }
  };
  while (o > 0 && (pos > 0 || left > 0)) {
    if (read(1) === 0) {
      if (read(1) === 0) raw(read(3) + 1); else ref(2, 8);
    } else {
      switch (read(2)) {
        case 0: ref(3, 9); break;
        case 1: ref(4, 10); break;
        case 2: ref(read(8) + 1, 12); break;
        default: raw(read(8) + 9);
      }
    }
  }
  if (sum !== checksum) throw new Error('DAT checksum mismatch');
  return dst;
}
