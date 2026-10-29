-- npx wrangler d1 execute lemmings-stats --remote --file schema.sql
-- (a database made before `kind` existed also needs migrations/001-kind.sql, once)
CREATE TABLE IF NOT EXISTS plays (
  level TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0
);
-- one rating per level per device; a comment shows once it's approved
CREATE TABLE IF NOT EXISTS ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL,
  device TEXT NOT NULL,
  stars INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT '',          -- the voter's say: fun | tricky | taxing | mayhem | '' (didn't say)
  name TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'none',   -- none (no comment) | pending | approved | rejected
  created INTEGER NOT NULL,
  UNIQUE (level, device)
);
CREATE INDEX IF NOT EXISTS ratings_level ON ratings (level, status);
