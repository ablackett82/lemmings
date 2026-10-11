// Where levels live: the ones made on this device (localStorage), and the
// shared ones (the levels server, server/ in this repo: anyone can publish,
// a level shows for everyone once it's approved).

import { check } from './format.js';

export const API = 'https://lemmings-levels.ablackett.workers.dev';
const MINE = 'lemmings.mine', AUTHOR = 'lemmings.author', DONE = 'lemmings.shared-done';

const read = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

// ---- made here ----
// an entry: { id, spec, updated, pub?: { code, status, key } }

export function myLevels() {
  return read(MINE, []).filter((e) => e?.id && e.spec).sort((a, b) => b.updated - a.updated);
}
export function getMine(id) { return myLevels().find((e) => e.id === id) ?? null; }
export function saveMine(entry) {
  const all = read(MINE, []).filter((e) => e?.id !== entry.id);
  all.push({ ...entry, updated: Date.now() });
  return write(MINE, all);
}
export function removeMine(id) { write(MINE, read(MINE, []).filter((e) => e?.id !== id)); }
export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export const author = () => read(AUTHOR, '');
export const setAuthor = (s) => write(AUTHOR, s);

// shared levels done on this device, by code
export const sharedDone = () => new Set(read(DONE, []));
export function markSharedDone(code) { const s = sharedDone(); s.add(code); write(DONE, [...s]); }

// ---- the server ----

async function call(path, opts) {
  let r;
  try { r = await fetch(API + path, opts); } catch { throw new Error('Can’t reach the levels server. Are you online?'); }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ? body.error[0].toUpperCase() + body.error.slice(1) + '.' : 'The levels server said no.');
  return body;
}

/** The approved levels: [{ id, name, author, created }], newest first. */
export const sharedList = () => call('/api/levels');

/** A shared level's spec, checked. t: an approver's token, for one not approved yet. */
export async function sharedLevel(code, t) {
  const rec = await call(`/api/levels/${encodeURIComponent(code)}${t ? `?t=${encodeURIComponent(t)}` : ''}`);
  if (!rec.level) throw new Error(rec.status === 'pending' ? 'That level is still waiting to be approved.' : 'That level isn’t there.');
  return { ...rec, spec: check(JSON.parse(rec.level)) };
}

export const previewUrl = (code) => `${API}/api/levels/${encodeURIComponent(code)}/preview.png`;

/** Publishes a level: { id, status }. */
export function publish(spec, preview) {
  return call('/api/levels', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: spec.name, author: spec.author, level: JSON.stringify(spec), preview }),
  });
}

/** How a published level is getting on: 'pending' | 'approved' | 'rejected' | 'gone'. */
export async function status(code) {
  try { return (await call(`/api/levels/${encodeURIComponent(code)}`)).status ?? 'gone'; } catch (e) { return /isn|no such/i.test(e.message) ? 'gone' : null; }
}
