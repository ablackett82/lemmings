// The shared level store: anyone can publish a level, it waits for approval,
// and only approved levels are listed. A Cloudflare Worker with one KV
// namespace (LEVELS).
//
// Keys in LEVELS:
//   level:<id>      { id, name, author, status, created, decided, level }
//   preview:<id>    the level's picture (PNG bytes)
//   index:approved  [{ id, name, author, created }], newest first
//   rate:<ip>:<hr>  submissions from one address this hour
//   rate:day:<day>  submissions from everyone today
//
// The game talks to /api/...; the approver uses /review/... from the button in
// the Telegram message. Each review link carries a token for that one level
// (an HMAC of its id), so the admin key itself never leaves the server.
//
// Secrets (wrangler secret put): ADMIN_KEY, TELEGRAM_TOKEN (the bot's, from
// @BotFather), TELEGRAM_CHAT (the chat the bot sends to).

const MAX_LEVEL = 100_000;     // characters of level data
const MAX_PREVIEW = 300_000;   // bytes of PNG
const PER_HOUR = 5;            // submissions per address per hour
const PER_DAY = 40;            // submissions from everyone per day
const ORIGINS = ['https://ablackett82.github.io'];
const GAME = 'https://ablackett82.github.io/arcade/games/lemmings/';
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/; // testing on this computer

const WORDS = ['FROG', 'BEAR', 'DUCK', 'MOLE', 'NEWT', 'OWL', 'FOX', 'YAK', 'EMU', 'CRAB', 'SEAL', 'WOLF',
  'HARE', 'LION', 'GOAT', 'TOAD', 'SWAN', 'MOTH', 'WASP', 'LYNX', 'PUMA', 'IBIS', 'KIWI', 'DODO', 'BAT',
  'CAT', 'DOG', 'PIG', 'COW', 'HEN', 'APE', 'ELK', 'EEL', 'ANT', 'BEE', 'RAM', 'KOI', 'ORCA', 'DEER', 'MULE'];

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const cors = corsHeaders(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      let m;
      if (path === '/api/levels' && req.method === 'GET') return json(await approvedIndex(env), cors);
      if (path === '/api/levels' && req.method === 'POST') return json(...withCors(await submit(req, env, url), cors));
      if ((m = path.match(/^\/api\/levels\/([A-Z]+-\d{3})\/preview\.png$/))) return preview(env, m[1]);
      if ((m = path.match(/^\/api\/levels\/([A-Z]+-\d{3})$/)) && req.method === 'GET') return json(...withCors(await getLevel(env, m[1], url), cors));
      if (path === '/review' && req.method === 'GET') return reviewList(env, url);
      if ((m = path.match(/^\/review\/([A-Z]+-\d{3})$/))) {
        if (req.method === 'GET') return reviewPage(env, m[1], url);
        if (req.method === 'POST') return decide(req, env, m[1], url);
      }
      if (path === '/') return new Response('Lemmings levels', { headers: { 'content-type': 'text/plain' } });
      return json({ error: 'not found' }, cors, 404);
    } catch (e) {
      return json({ error: 'server error' }, cors, 500);
    }
  },
};

// ---- the game's side ----

async function submit(req, env, url) {
  if (+req.headers.get('content-length') > MAX_LEVEL + MAX_PREVIEW * 1.4 + 2000) return [{ error: 'too big' }, 413];
  let body;
  try { body = await req.json(); } catch { return [{ error: 'bad request' }, 400]; }
  const name = clean(body.name, 40), author = clean(body.author, 24);
  if (!name || !author) return [{ error: 'needs a name and a maker' }, 400];
  if (typeof body.level !== 'string' || !body.level || body.level.length > MAX_LEVEL) return [{ error: 'bad level' }, 400];
  const png = decodePng(body.preview);
  if (!png) return [{ error: 'bad picture' }, 400];

  const ip = req.headers.get('cf-connecting-ip') || 'unknown';
  const now = Date.now(), hour = Math.floor(now / 3_600_000), day = Math.floor(now / 86_400_000);
  const ipKey = `rate:${ip}:${hour}`, dayKey = `rate:day:${day}`;
  const [ipCount, dayCount] = await Promise.all([env.LEVELS.get(ipKey), env.LEVELS.get(dayKey)]);
  if (+ipCount >= PER_HOUR || +dayCount >= PER_DAY) return [{ error: 'too many levels sent, try later' }, 429];
  await Promise.all([
    env.LEVELS.put(ipKey, String(+ipCount + 1), { expirationTtl: 3700 }),
    env.LEVELS.put(dayKey, String(+dayCount + 1), { expirationTtl: 90_000 }),
  ]);

  const id = await newId(env);
  const rec = { id, name, author, status: 'pending', created: now, decided: null, level: body.level };
  await env.LEVELS.put(`preview:${id}`, png);
  await env.LEVELS.put(`level:${id}`, JSON.stringify(rec));
  await notify(env, url.origin, rec, png);
  return [{ id, status: 'pending' }, 201];
}

async function getLevel(env, id, url) {
  const rec = await env.LEVELS.get(`level:${id}`, 'json');
  if (!rec) return [{ error: 'no such level' }, 404];
  if (rec.status === 'approved' || await validToken(env, id, url.searchParams.get('t'))) return [rec, 200];
  return [{ id, status: rec.status }, 200];   // the maker can see how it's getting on
}

async function preview(env, id) {
  const png = await env.LEVELS.get(`preview:${id}`, 'arrayBuffer');
  if (!png) return new Response('not found', { status: 404 });
  return new Response(png, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400', 'access-control-allow-origin': '*' } });
}

async function approvedIndex(env) {
  return (await env.LEVELS.get('index:approved', 'json')) ?? [];
}

// ---- the approver's side ----

async function reviewList(env, url) {
  if (url.searchParams.get('key') !== env.ADMIN_KEY) return html('<p>Not allowed.</p>', 403);
  const rows = [];
  let cursor;
  do {
    const page = await env.LEVELS.list({ prefix: 'level:', cursor });
    for (const k of page.keys) {
      const rec = await env.LEVELS.get(k.name, 'json');
      if (rec?.status === 'pending') rows.push(rec);
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  rows.sort((a, b) => b.created - a.created);
  const items = await Promise.all(rows.map(async r =>
    `<li><a href="/review/${r.id}?t=${await token(env, r.id)}">${esc(r.name)}</a> by ${esc(r.author)} <small>${when(r.created)}</small></li>`));
  return html(`<h1>Waiting for approval</h1>${items.length ? `<ul>${items.join('')}</ul>` : '<p>Nothing waiting.</p>'}`);
}

async function reviewPage(env, id, url) {
  const t = url.searchParams.get('t');
  if (!await validToken(env, id, t)) return html('<p>This link isn’t right.</p>', 403);
  const rec = await env.LEVELS.get(`level:${id}`, 'json');
  if (!rec) return html('<p>That level has gone.</p>', 404);
  const status = { pending: 'Waiting for you', approved: 'Approved ✓', rejected: 'Rejected' }[rec.status];
  return html(`
    <h1>${esc(rec.name)}</h1>
    <p>by <b>${esc(rec.author)}</b> · ${when(rec.created)} · code <b>${id}</b></p>
    <img src="/api/levels/${id}/preview.png" alt="The level">
    <p class="status ${rec.status}">${status}</p>
    <p><a class="play" href="${GAME}?review=${id}&amp;t=${t}">▶ Play it (or watch how it’s done)</a></p>
    <form method="post" action="/review/${id}?t=${t}">
      <button name="action" value="approve" class="yes">Approve</button>
      <button name="action" value="reject" class="no">Reject</button>
    </form>`);
}

async function decide(req, env, id, url) {
  const t = url.searchParams.get('t');
  if (!await validToken(env, id, t)) return html('<p>This link isn’t right.</p>', 403);
  const rec = await env.LEVELS.get(`level:${id}`, 'json');
  if (!rec) return html('<p>That level has gone.</p>', 404);
  const action = (await req.formData()).get('action');
  if (action !== 'approve' && action !== 'reject') return html('<p>Pick approve or reject.</p>', 400);
  rec.status = action === 'approve' ? 'approved' : 'rejected';
  rec.decided = Date.now();
  // a rejected level is kept for a month so its maker can see what happened
  const opts = rec.status === 'rejected' ? { expirationTtl: 30 * 86_400 } : {};
  await env.LEVELS.put(`level:${id}`, JSON.stringify(rec), opts);
  const png = rec.status === 'rejected' && await env.LEVELS.get(`preview:${id}`, 'arrayBuffer');
  if (png) await env.LEVELS.put(`preview:${id}`, png, opts);
  const index = (await approvedIndex(env)).filter(e => e.id !== id);
  if (rec.status === 'approved') index.unshift({ id, name: rec.name, author: rec.author, created: rec.created });
  await env.LEVELS.put('index:approved', JSON.stringify(index));
  return Response.redirect(`${url.origin}/review/${id}?t=${t}`, 303);
}

// A Telegram message from the bot: the level's picture, and a button that
// opens its review page.
async function notify(env, origin, rec, png) {
  if (!env.TELEGRAM_TOKEN || !env.TELEGRAM_CHAT) return;
  const t = await token(env, rec.id);
  const form = new FormData();
  form.append('chat_id', env.TELEGRAM_CHAT);
  form.append('photo', new Blob([png], { type: 'image/png' }), `${rec.id}.png`);
  form.append('caption', `New level: ${rec.name}\nby ${rec.author} · ${rec.id}`);
  form.append('reply_markup', JSON.stringify({ inline_keyboard: [[{ text: 'Look & approve', url: `${origin}/review/${rec.id}?t=${t}` }]] }));
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendPhoto`, { method: 'POST', body: form })
    .then(async r => { if (!r.ok) console.log('telegram', r.status, await r.text()); })
    .catch(e => console.log('telegram failed', String(e)));
}

// ---- helpers ----

async function newId(env) {
  for (;;) {
    const id = `${WORDS[rand(WORDS.length)]}-${String(rand(1000)).padStart(3, '0')}`;
    if (!await env.LEVELS.get(`level:${id}`)) return id;
  }
}

function rand(n) {
  return crypto.getRandomValues(new Uint32Array(1))[0] % n;
}

async function token(env, id) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.ADMIN_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(id)));
  return [...sig.slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function validToken(env, id, t) {
  if (!t || !env.ADMIN_KEY) return false;
  const want = await token(env, id);
  let diff = want.length ^ t.length;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ (t.charCodeAt(i) || 0);
  return diff === 0;
}

function clean(s, max) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function decodePng(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) return null;
  let bin;
  try { bin = atob(dataUrl.slice(22)); } catch { return null; }
  if (bin.length > MAX_PREVIEW) return null;
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  return sig.every((b, i) => bytes[i] === b) ? bytes : null;
}

function corsHeaders(req) {
  const origin = req.headers.get('origin');
  return ORIGINS.includes(origin) || LOCAL.test(origin ?? '') ? {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'vary': 'origin',
  } : {};
}

// [data, status] from a handler, as json()'s arguments
function withCors([data, status], cors) {
  return [data, cors, status];
}

function json(data, headers = {}, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, 'content-type': 'application/json' } });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function when(ms) {
  return new Date(ms).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' });
}

function html(body, status = 200) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Lemmings levels</title>
<style>
  body { font: 17px/1.4 system-ui, sans-serif; margin: 0 auto; padding: 16px; max-width: 1000px; background: #111; color: #eee; }
  a { color: #8cf; } h1 { margin: 0 0 4px; } small { color: #999; }
  img { width: 100%; image-rendering: pixelated; border: 1px solid #444; background: #000; }
  .status { font-weight: bold; } .approved { color: #6d6; } .rejected { color: #e66; }
  form { display: flex; gap: 12px; } button { flex: 1; font-size: 20px; padding: 16px; border: 0; border-radius: 10px; color: #fff; }
  .yes { background: #2a8a3a; } .no { background: #a33; }
  .play { display: block; text-align: center; padding: 14px; border: 2px solid #8cf; border-radius: 10px; text-decoration: none; font-weight: bold; }
</style></head><body>${body}</body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}
