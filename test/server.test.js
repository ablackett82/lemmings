// The shared levels server (server/src/index.js) against in-memory stand-ins for
// its KV store and D1 database: asking for a level to come down, and deleting it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../server/src/index.js';

function kv() {
  const m = new Map();
  return {
    m,
    async get(k, type) { const v = m.get(k); if (v === undefined) return null; return type === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, typeof v === 'string' ? v : v); },
    async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  };
}
function d1() {
  const ran = [];
  const stmt = (sql) => ({ sql, args: [], bind(...a) { this.args = a; return this; }, async run() { ran.push([sql, this.args]); return { results: [] }; }, async first() { return null; }, async all() { return { results: [] }; } });
  return { ran, prepare: stmt, async batch(list) { for (const s of list) ran.push([s.sql, s.args]); return list.map(() => ({ results: [] })); } };
}
// a 1x1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('anyone can ask for a level to come down; the approver gets a message and can delete it for good', async () => {
  const env = { LEVELS: kv(), STATS: d1(), ADMIN_KEY: 'sekrit', TELEGRAM_TOKEN: 't', TELEGRAM_CHAT: 'c' };
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push({ url: String(url), body: init?.body }); return new Response('{}'); };
  try {
    const call = (path, method = 'GET', body, headers = {}) =>
      worker.fetch(new Request(`https://lv.test${path}`, { method, headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.2.3.4', ...headers }, body: body && JSON.stringify(body) }), env);

    const made = await (await call('/api/levels', 'POST', { name: 'Tricky', author: 'Sam', level: '{"v":1}', preview: PNG })).json();
    assert.equal(made.status, 'pending');
    assert.equal(made.edit, undefined, 'nothing secret is handed out');
    sent.length = 0;

    assert.equal((await call('/api/levels/NOPE-123/removal', 'POST', {})).status, 404);

    const asked = await call(`/api/levels/${made.id}/removal`, 'POST', { reason: 'it is rude', who: 'Alex' });
    assert.equal(asked.status, 200);
    assert.equal(sent.length, 1);
    const msg = JSON.parse(sent[0].body);
    assert.match(msg.text, /Removal requested: Tricky/);
    assert.match(msg.text, /it is rude/);
    const link = msg.reply_markup.inline_keyboard[0][0];
    assert.equal(link.text, 'Look & remove');

    // asking again from the same address says nothing new
    await call(`/api/levels/${made.id}/removal`, 'POST', {});
    assert.equal(sent.length, 1);

    // the button's page offers Delete for good; a wrong link doesn't
    const page = await (await worker.fetch(new Request(link.url), env)).text();
    assert.match(page, /Delete for good/);
    const t = new URL(link.url).search;
    assert.equal((await worker.fetch(new Request(`https://lv.test/review/${made.id}?t=nope`, { method: 'POST', body: new URLSearchParams({ action: 'delete' }) }), env)).status, 403);
    assert.ok(await env.LEVELS.get(`level:${made.id}`));

    const gone = await worker.fetch(new Request(`https://lv.test/review/${made.id}${t}`, { method: 'POST', body: new URLSearchParams({ action: 'delete' }) }), env);
    assert.equal(gone.status, 200);
    assert.equal(await env.LEVELS.get(`level:${made.id}`), null);
    assert.equal(await env.LEVELS.get(`preview:${made.id}`), null);
    assert.deepEqual(await env.LEVELS.get('index:approved', 'json'), []);
    assert.ok(env.STATS.ran.some(([sql]) => /DELETE FROM ratings/.test(sql)) && env.STATS.ran.some(([sql]) => /DELETE FROM plays/.test(sql)));
    assert.equal((await call(`/api/levels/${made.id}`)).status, 404);
  } finally { globalThis.fetch = realFetch; }
});

test('the admin list shows approved levels too, so any of them can be opened and deleted', async () => {
  const env = { LEVELS: kv(), STATS: d1(), ADMIN_KEY: 'sekrit' };
  await env.LEVELS.put('index:approved', JSON.stringify([{ id: 'FROG-123', name: 'Hop', author: 'Kim', created: 1 }]));
  const res = await worker.fetch(new Request('https://lv.test/review?key=sekrit'), env);
  const page = await res.text();
  assert.match(page, /Shown to everyone/);
  assert.match(page, /\/review\/FROG-123\?t=/);
  assert.equal((await worker.fetch(new Request('https://lv.test/review?key=wrong'), env)).status, 403);
});
