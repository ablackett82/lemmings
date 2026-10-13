// Where levels live: the ones made on this device (localStorage), and the
// shared ones (the levels server, server/ in this repo: anyone can publish,
// a level shows for everyone once it's approved).

import { check } from './format.js';

export const API = 'https://lemmings-levels.ablackett.workers.dev';
const MINE = 'lemmings.mine', AUTHOR = 'lemmings.author', DONE = 'lemmings.shared-done';
const DEVICE = 'lemmings.device', RATED = 'lemmings.rated', SORT = 'lemmings.shared-sort';

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

// this device's ratings, by code: { stars, name, comment }
export const myRating = (code) => read(RATED, {})[code] ?? null;
function saveRating(code, r) { const all = read(RATED, {}); all[code] = r; write(RATED, all); }

// how Our levels is sorted here: 'new' | 'name' | 'stars' | 'success'
export const sortOrder = () => read(SORT, 'new');
export const setSortOrder = (s) => write(SORT, s);

/** A random id for this device, so its rating of a level replaces its last one. */
function device() {
  let d = read(DEVICE, '');
  if (!d) { d = crypto.getRandomValues(new Uint32Array(4)).reduce((s, n) => s + n.toString(36), ''); write(DEVICE, d); }
  return d;
}

// ---- the server ----

async function call(path, opts) {
  let r;
  try { r = await fetch(API + path, opts); } catch { throw new Error('Can’t reach the levels server. Are you online?'); }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ? body.error[0].toUpperCase() + body.error.slice(1) + '.' : 'The levels server said no.');
  return body;
}

/** The approved levels: [{ id, name, author, created, stats: { attempts, wins, stars, ratings, comments } }], newest first. */
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

/** Asks for a shared level to be taken down: the approver gets a message and decides. */
export const askRemoval = (code, reason, who) => call(`/api/levels/${encodeURIComponent(code)}/removal`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason, who }),
});

/** How a published level is getting on: { status: 'pending' | 'approved' | 'rejected' | 'gone', stats? }, or null offline. */
export async function status(code) {
  try {
    const r = await call(`/api/levels/${encodeURIComponent(code)}`);
    return { status: r.status ?? 'gone', stats: r.stats };
  } catch (e) { return /isn|no such/i.test(e.message) ? { status: 'gone' } : null; }
}

/** A go at a shared level (as it starts), or a win. Fire and forget: offline, it just isn't counted. */
export function recordPlay(code, won) {
  call(`/api/levels/${encodeURIComponent(code)}/play`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ won }),
  }).catch(() => {});
}

/** Rates a shared level: { stars, name, comment }. Returns 'none' | 'pending' | 'approved' (the comment's state). */
export async function rate(code, r) {
  const res = await call(`/api/levels/${encodeURIComponent(code)}/rating`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...r, device: device() }),
  });
  saveRating(code, r);
  return res.comment;
}

/** What people said about a level (approved comments): [{ stars, name, comment, created }]. */
export const comments = (code) => call(`/api/levels/${encodeURIComponent(code)}/comments`);

/** "★ 4.2 (5) · 12 goes · 4 won (33%)", for a shared level's stats. */
export function statsLine(st) {
  if (!st) return '';
  const parts = [st.ratings ? `★ ${st.stars} (${st.ratings})` : 'No stars yet'];
  parts.push(st.attempts === 1 ? '1 go' : `${st.attempts} goes`);
  if (st.attempts) parts.push(`${st.wins} won (${Math.round(100 * st.wins / st.attempts)}%)`);
  return parts.join(' · ');
}
