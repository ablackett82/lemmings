-- Once, on a database made before ratings had a kind:
-- npx wrangler d1 execute lemmings-stats --remote --file migrations/001-kind.sql
ALTER TABLE ratings ADD COLUMN kind TEXT NOT NULL DEFAULT '';
