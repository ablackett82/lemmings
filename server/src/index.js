// The shared level store: anyone can publish a level, it waits for approval,
// and only approved levels are listed. A Cloudflare Worker with one KV
// namespace (LEVELS) for the levels, and a D1 database (STATS, schema.sql) for
// how often each is played and won, and its star ratings and comments.
//
// Keys in LEVELS:
//   level:<id>      { id, name, author, status, created, decided, level }
//   preview:<id>    the level's picture (PNG bytes)
//   index:approved  [{ id, name, author, created }], newest first
//   rate:<ip>:<hr>  submissions from one address this hour
//   rate:day:<day>  submissions from everyone today
//
// STATS: plays (level, attempts, wins), ratings (one per level per device:
// stars, name, comment; a comment shows once approved, like a level).
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
const COMMENTS_PER_HOUR = 10;  // comments per address per hour
const REPORTS_PER_HOUR = 5;    // removal requests per address per hour
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
      if (path === '/api/levels' && req.method === 'GET') return json(await listing(env), cors);
      if (path === '/api/levels' && req.method === 'POST') return json(...withCors(await submit(req, env, url), cors));
      if ((m = path.match(/^\/api\/levels\/([A-Z]+-\d{3})\/preview\.png$/))) return preview(env, m[1]);
      if ((m = path.match(/^\/api\/levels\/([A-Z]+-\d{3})$/)) && req.method === 'GET') return json(...withCors(await getLevel(env, m[1], url), cors));
      if ((m = path.match(/^\/api\/levels\/([A-Z]+-\d{3})\/removal$/)) && req.method === 'POST') return json(...withCors(await askRemoval(req, env, m[1], url), cors));
      if ((m = path.match(/^\/api\/levels\/([A-Z]+-\d{3})\/play$/)) && req.method === 'POST') return json(...withCors(await play(req, env, m[1]), cors));
      if ((m = path.match(/^\/api\/levels\/([A-Z]+-\d{3})\/rating$/)) && req.method === 'POST') return json(...withCors(await rate(req, env, m[1], url), cors));
      if ((m = path.match(/^\/api\/levels\/([A-Z]+-\d{3})\/comments$/)) && req.method === 'GET') return json(...withCors(await comments(env, m[1]), cors));
      if (path === '/review' && req.method === 'GET') return reviewList(env, url);
      if ((m = path.match(/^\/review\/([A-Z]+-\d{3})$/))) {
        if (req.method === 'GET') return reviewPage(env, m[1], url);
        if (req.method === 'POST') return decide(req, env, m[1], url);
      }
      if ((m = path.match(/^\/review\/comment\/(\d+)$/))) {
        if (req.method === 'GET') return commentPage(env, m[1], url);
        if (req.method === 'POST') return decideComment(req, env, m[1], url);
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

// anyone asks for a level to be taken down: it's a Telegram message to the approver, who decides
async function askRemoval(req, env, id, url) {
  let body = {};
  try { body = await req.json(); } catch { /* no reason given is fine */ }
  const rec = await env.LEVELS.get(`level:${id}`, 'json');
  if (!rec) return [{ error: 'no such level' }, 404];
  const ip = req.headers.get('cf-connecting-ip') || 'unknown';
  const key = `report:${id}:${ip}`, hourKey = `report:${ip}:${Math.floor(Date.now() / 3_600_000)}`;
  if (await env.LEVELS.get(key)) return [{ ok: true }, 200];   // already asked: say nothing new
  const n = +await env.LEVELS.get(hourKey);
  if (n >= REPORTS_PER_HOUR) return [{ error: 'too many requests, try later' }, 429];
  await Promise.all([
    env.LEVELS.put(key, '1', { expirationTtl: 86_400 }),
    env.LEVELS.put(hourKey, String(n + 1), { expirationTtl: 3700 }),
  ]);
  await notifyRemoval(env, url.origin, rec, clean(body.reason, 200), clean(body.who, 24));
  return [{ ok: true }, 200];
}

/** Everything about a level: it, its picture, its place in the list, its plays and ratings. */
async function deleteLevel(env, id) {
  await Promise.all([env.LEVELS.delete(`level:${id}`), env.LEVELS.delete(`preview:${id}`)]);
  const index = (await approvedIndex(env)).filter(e => e.id !== id);
  await env.LEVELS.put('index:approved', JSON.stringify(index));
  if (env.STATS) await env.STATS.batch([
    env.STATS.prepare('DELETE FROM plays WHERE level = ?').bind(id),
    env.STATS.prepare('DELETE FROM ratings WHERE level = ?').bind(id),
  ]);
}

async function getLevel(env, id, url) {
  const rec = await env.LEVELS.get(`level:${id}`, 'json');
  if (!rec) return [{ error: 'no such level' }, 404];
  const stats = (await statsFor(env, [id]))[id];
  if (rec.status === 'approved' || await validToken(env, id, url.searchParams.get('t'))) return [{ ...rec, stats }, 200];
  return [{ id, status: rec.status, stats }, 200];   // the maker can see how it's getting on
}

// a go at a level ({ won: false }, as it starts) or a win ({ won: true })
async function play(req, env, id) {
  let body;
  try { body = await req.json(); } catch { return [{ error: 'bad request' }, 400]; }
  if (!await isApproved(env, id)) return [{ error: 'no such level' }, 404];
  if (body.won === true) {
    await env.STATS.prepare('UPDATE plays SET wins = MIN(wins + 1, attempts) WHERE level = ?').bind(id).run();
  } else {
    await env.STATS.prepare('INSERT INTO plays (level, attempts) VALUES (?, 1) ON CONFLICT (level) DO UPDATE SET attempts = attempts + 1').bind(id).run();
  }
  return [{ ok: true }, 200];
}

// stars (1-5), and maybe a name and a comment, from one device (a random id it keeps)
async function rate(req, env, id, url) {
  let body;
  try { body = await req.json(); } catch { return [{ error: 'bad request' }, 400]; }
  const stars = Math.round(+body.stars), device = clean(body.device, 40);
  if (!(stars >= 1 && stars <= 5) || device.length < 8) return [{ error: 'bad rating' }, 400];
  const name = clean(body.name, 24), comment = clean(body.comment, 300);
  const rec = await env.LEVELS.get(`level:${id}`, 'json');
  if (rec?.status !== 'approved') return [{ error: 'no such level' }, 404];
  const old = await env.STATS.prepare('SELECT comment, status FROM ratings WHERE level = ? AND device = ?').bind(id, device).first();
  const sameComment = old && old.comment === comment;
  if (comment && !sameComment) {
    const ip = req.headers.get('cf-connecting-ip') || 'unknown';
    const key = `rate:c:${ip}:${Math.floor(Date.now() / 3_600_000)}`;
    const n = +await env.LEVELS.get(key);
    if (n >= COMMENTS_PER_HOUR) return [{ error: 'too many comments, try later' }, 429];
    await env.LEVELS.put(key, String(n + 1), { expirationTtl: 3700 });
  }
  const status = !comment ? 'none' : sameComment ? old.status : 'pending';
  const row = await env.STATS.prepare(`INSERT INTO ratings (level, device, stars, name, comment, status, created) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (level, device) DO UPDATE SET stars = excluded.stars, name = excluded.name, comment = excluded.comment, status = excluded.status, created = excluded.created
    RETURNING id`).bind(id, device, stars, name, comment, status, Date.now()).first();
  if (status === 'pending' && !sameComment) await notifyComment(env, url.origin, rec, { id: row.id, stars, name, comment });
  return [{ ok: true, comment: status }, 200];
}

async function comments(env, id) {
  const { results } = await env.STATS.prepare(`SELECT stars, name, comment, created FROM ratings WHERE level = ? AND status = 'approved' ORDER BY created DESC LIMIT 50`).bind(id).all();
  return [results, 200];
}

/** { id: { attempts, wins, stars (average, or null), ratings, comments (shown) } } for the levels. */
async function statsFor(env, ids) {
  const out = Object.fromEntries(ids.map((id) => [id, { attempts: 0, wins: 0, stars: null, ratings: 0, comments: 0 }]));
  if (!ids.length || !env.STATS) return out;
  const [plays, stars] = await env.STATS.batch([
    env.STATS.prepare('SELECT level, attempts, wins FROM plays'),
    env.STATS.prepare(`SELECT level, AVG(stars) AS stars, COUNT(*) AS n, SUM(status = 'approved') AS said FROM ratings GROUP BY level`),
  ]);
  for (const r of plays.results) if (out[r.level]) Object.assign(out[r.level], { attempts: r.attempts, wins: r.wins });
  for (const r of stars.results) if (out[r.level]) Object.assign(out[r.level], { stars: Math.round(r.stars * 10) / 10, ratings: r.n, comments: r.said });
  return out;
}

async function isApproved(env, id) {
  return (await approvedIndex(env)).some((e) => e.id === id);
}

async function preview(env, id) {
  const png = await env.LEVELS.get(`preview:${id}`, 'arrayBuffer');
  if (!png) return new Response('not found', { status: 404 });
  return new Response(png, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400', 'access-control-allow-origin': '*' } });
}

async function approvedIndex(env) {
  return (await env.LEVELS.get('index:approved', 'json')) ?? [];
}

// the list for Our levels, each with its stats
async function listing(env) {
  const index = await approvedIndex(env);
  const stats = await statsFor(env, index.map((e) => e.id));
  return index.map((e) => ({ ...e, stats: stats[e.id] }));
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
  const { results: waiting } = await env.STATS.prepare(`SELECT id, level, name, comment FROM ratings WHERE status = 'pending' ORDER BY created DESC`).all();
  const cs = await Promise.all(waiting.map(async c =>
    `<li><a href="/review/comment/${c.id}?t=${await token(env, `c${c.id}`)}">${esc(c.comment.slice(0, 60))}</a> on ${c.level}${c.name ? ` by ${esc(c.name)}` : ''}</li>`));
  const live = await Promise.all((await approvedIndex(env)).map(async r =>
    `<li><a href="/review/${r.id}?t=${await token(env, r.id)}">${esc(r.name)}</a> by ${esc(r.author)} · ${r.id} <small>${when(r.created)}</small></li>`));
  return html(`<h1>Waiting for approval</h1>${items.length ? `<ul>${items.join('')}</ul>` : '<p>No levels waiting.</p>'}
    <h2>Shown to everyone</h2>${live.length ? `<ul>${live.join('')}</ul>` : '<p>None yet.</p>'}
    <p><small>Open one to delete it for good.</small></p>
    <h2>Comments</h2>${cs.length ? `<ul>${cs.join('')}</ul>` : '<p>No comments waiting.</p>'}`);
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
    </form>
    <form method="post" action="/review/${id}?t=${t}" onsubmit="return confirm('Delete this level for good, with its stars and comments?')">
      <button name="action" value="delete" class="gone">Delete for good</button>
    </form>`);
}

async function decide(req, env, id, url) {
  const t = url.searchParams.get('t');
  if (!await validToken(env, id, t)) return html('<p>This link isn’t right.</p>', 403);
  const rec = await env.LEVELS.get(`level:${id}`, 'json');
  if (!rec) return html('<p>That level has gone.</p>', 404);
  const action = (await req.formData()).get('action');
  if (action === 'delete') { await deleteLevel(env, id); return html(`<h1>Deleted</h1><p>${esc(rec.name)} (${id}) has gone, with its picture, stars and comments.</p>`); }
  if (action !== 'approve' && action !== 'reject') return html('<p>Pick approve, reject or delete.</p>', 400);
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

async function commentPage(env, n, url) {
  const t = url.searchParams.get('t');
  if (!await validToken(env, `c${n}`, t)) return html('<p>This link isn’t right.</p>', 403);
  const c = await env.STATS.prepare('SELECT * FROM ratings WHERE id = ?').bind(+n).first();
  if (!c) return html('<p>That comment has gone (changed or replaced).</p>', 404);
  const rec = await env.LEVELS.get(`level:${c.level}`, 'json');
  const status = { pending: 'Waiting for you', approved: 'Approved ✓', rejected: 'Rejected', none: 'No comment' }[c.status];
  return html(`
    <h1>A comment on ${esc(rec?.name ?? c.level)}</h1>
    <p>${'★'.repeat(c.stars)}${'☆'.repeat(5 - c.stars)} from <b>${esc(c.name || 'someone')}</b> · ${when(c.created)}</p>
    <blockquote>${esc(c.comment)}</blockquote>
    <p class="status ${c.status}">${status}</p>
    <form method="post" action="/review/comment/${n}?t=${t}">
      <button name="action" value="approve" class="yes">Show it</button>
      <button name="action" value="reject" class="no">Hide it</button>
    </form>
    <p><small>Hiding it keeps the stars, just not the words.</small></p>`);
}

async function decideComment(req, env, n, url) {
  const t = url.searchParams.get('t');
  if (!await validToken(env, `c${n}`, t)) return html('<p>This link isn’t right.</p>', 403);
  const action = (await req.formData()).get('action');
  if (action !== 'approve' && action !== 'reject') return html('<p>Pick one.</p>', 400);
  await env.STATS.prepare(`UPDATE ratings SET status = ? WHERE id = ? AND status != 'none'`).bind(action === 'approve' ? 'approved' : 'rejected', +n).run();
  return Response.redirect(`${url.origin}/review/comment/${n}?t=${t}`, 303);
}

// A Telegram message about a comment, with a button to its page
async function notifyComment(env, origin, rec, c) {
  if (!env.TELEGRAM_TOKEN || !env.TELEGRAM_CHAT) return;
  const t = await token(env, `c${c.id}`);
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT,
      text: `Comment on ${rec.name} (${rec.id})\n${'★'.repeat(c.stars)} from ${c.name || 'someone'}:\n“${c.comment}”`,
      reply_markup: { inline_keyboard: [[{ text: 'Show or hide', url: `${origin}/review/comment/${c.id}?t=${t}` }]] },
    }),
  }).then(async r => { if (!r.ok) console.log('telegram', r.status, await r.text()); })
    .catch(e => console.log('telegram failed', String(e)));
}

// A Telegram message asking for a level to come down, with a button to its review page (which can delete it)
async function notifyRemoval(env, origin, rec, reason, who) {
  if (!env.TELEGRAM_TOKEN || !env.TELEGRAM_CHAT) return;
  const t = await token(env, rec.id);
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT,
      text: `Removal requested: ${rec.name} (${rec.id}) by ${rec.author}\n${who ? `Asked by ${who}` : 'Asked by someone'}${reason ? `:\n“${reason}”` : ''}`,
      reply_markup: { inline_keyboard: [[{ text: 'Look & remove', url: `${origin}/review/${rec.id}?t=${t}` }]] },
    }),
  }).then(async r => { if (!r.ok) console.log('telegram', r.status, await r.text()); })
    .catch(e => console.log('telegram failed', String(e)));
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
  .yes { background: #2a8a3a; } .no { background: #a33; } .gone { background: #333; border: 1px solid #a33; margin-top: 12px; }
  blockquote { font-size: 20px; margin: 12px 0; padding: 12px; border-left: 4px solid #8cf; background: #222; }
  .play { display: block; text-align: center; padding: 14px; border: 2px solid #8cf; border-radius: 10px; text-decoration: none; font-weight: bold; }
</style></head><body>${body}</body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}
