# Shared levels server

A Cloudflare Worker (`lemmings-levels`, on the personal Cloudflare account)
that stores levels made in the editor. Anyone can publish; a level waits until
it's approved, then it's listed for everyone.

- Live at https://lemmings-levels.ablackett.workers.dev
- Storage: one KV namespace, `LEVELS` (keys are listed in `src/index.js`)
- New levels are announced by the Telegram bot @ablackett_lemmings_bot, with a
  picture and a **Look & approve** button that opens the review page.
- Everything waiting, and everything shown: `/review?key=<ADMIN_KEY>`. Open a level from there to approve, reject or **Delete for good**. There are no admin accounts: the key is the only way in.

The game uses:

| | |
|---|---|
| `GET /api/levels` | approved levels, newest first |
| `POST /api/levels` | `{ name, author, level, preview }` (preview a PNG data URL) → `{ id, status }` |
| `GET /api/levels/<id>` | the level if approved, otherwise just its status |
| `GET /api/levels/<id>/preview.png` | its picture |
| `POST /api/levels/<id>/removal` | `{ reason?, who? }` → a Telegram message to the approver with a **Look & remove** button (5 an hour from one address) |

Limits: 5 levels an hour from one address, 40 a day in all.

## Deploy

```
cd server
npm install
npx wrangler login      # once
npx wrangler deploy
```

Secrets (`npx wrangler secret put <name>`): `ADMIN_KEY`, `TELEGRAM_TOKEN`
(the bot's, from @BotFather), `TELEGRAM_CHAT` (the chat it sends to). Copies
live in `server/.dev.vars`, which git ignores.
