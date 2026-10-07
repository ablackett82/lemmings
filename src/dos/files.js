// Getting the DOS game's files onto the device: picked by the player (the
// .DAT files themselves, or a .zip of them), kept in IndexedDB so they're
// there next time. Nothing is uploaded anywhere; the files never leave the
// device. On localhost, the dev server's copy in reference/lemming1.pc is used
// when nothing has been loaded.

import { NEEDED } from './dosdata.js';
import { SOUND_FILES } from '../render/audio.js';
import { MIDI_FILES } from '../render/music.js';

/** The Windows 95 version's sounds and music: used when they're there too. */
export const EXTRA = [...SOUND_FILES, ...MIDI_FILES];
const WANTED = new Set([...NEEDED, ...EXTRA]);

const DB = 'lemmings-dos', STORE = 'files', KEY = 'vga';

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => { d.close(); resolve(req?.result); };
    t.onerror = () => { d.close(); reject(t.error); };
  });
}

/** The saved files, { name: Uint8Array }, or null. */
export async function loadSaved() {
  try {
    const rec = await tx('readonly', (s) => s.get(KEY));
    if (rec) return Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, new Uint8Array(v)]));
  } catch { /* no IndexedDB (private mode) */ }
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return fetchDev();
  return null;
}

async function fetchDev() {
  const get = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(url); return new Uint8Array(await r.arrayBuffer()); };
  const files = {};
  try { for (const n of NEEDED) files[n] = await get(`reference/lemming1.pc/${n}`); } catch { return null; }
  for (const n of EXTRA) {
    try { files[n] = await get(`reference/win95/Lemmings_95/${n.endsWith('.mid') ? 'MUSIC' : 'SOUND'}/${n.toUpperCase()}`); } catch { /* optional */ }
  }
  return files;
}

export async function save(files) {
  const rec = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.slice().buffer]));
  await tx('readwrite', (s) => s.put(rec, KEY));
}

export async function forget() {
  try { await tx('readwrite', (s) => s.delete(KEY)); } catch { /* nothing saved */ }
}

/**
 * The game's files from what the player picked (File objects: .DAT, .WAV and
 * .MID files and/or .zip files), added to the ones already loaded (`have`).
 * Returns { files, missing: [names], added: count }.
 */
export async function readPicked(list, have = {}) {
  const base = (name) => name.split(/[\\/]/).pop().toLowerCase();
  const picked = [];
  for (const f of list) {
    const data = new Uint8Array(await f.arrayBuffer());
    if (/\.zip$/i.test(f.name) || (data[0] === 0x50 && data[1] === 0x4b)) {
      for (const [name, bytes] of await unzip(data, (n) => WANTED.has(base(n)))) picked.push([base(name), bytes]);
    } else if (WANTED.has(base(f.name))) picked.push([base(f.name), data]);
  }
  // the DOS game's .DAT files only come with its MAIN.DAT: the Windows 95
  // version has its own GROUND?O.DAT files, which mustn't replace the DOS ones
  const dosToo = picked.some(([n]) => n === 'main.dat');
  const files = { ...have };
  let added = 0;
  for (const [n, data] of picked) if (dosToo || !NEEDED.includes(n)) { files[n] = data; added++; }
  return { files, missing: NEEDED.filter((n) => !files[n]), added };
}

/** The entries of a zip file that `want(name)` picks: [[name, Uint8Array]]. */
async function unzip(zip, want) {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // the central directory, from the end-of-directory record
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('That zip file looks damaged');
  const count = dv.getUint16(end + 10, true);
  let p = dv.getUint32(end + 16, true);
  const out = [];
  for (let n = 0; n < count && dv.getUint32(p, true) === 0x02014b50; n++) {
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extra = dv.getUint16(p + 30, true), comment = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extra + comment;
    if (!want(name)) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const body = zip.subarray(start, start + size);
    if (method === 0) out.push([name, body.slice()]);
    else if (method === 8) out.push([name, await inflate(body)]);
    else throw new Error(`Can't unpack ${name} from that zip (compression ${method})`);
  }
  return out;
}

async function inflate(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
