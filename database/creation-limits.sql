-- Run once, before deploying the code that uses it:
--   wrangler d1 execute <database-name> --remote --file=database/creation-limits.sql
-- Adds a per-client creation limit and lets unfinished tournaments expire
-- 180 days after their last change. Finished tournaments stay permanent.
ALTER TABLE boards ADD COLUMN creator TEXT;
CREATE INDEX IF NOT EXISTS boards_creator ON boards (creator, created_at);
UPDATE boards SET expires_at = UNIXEPOCH() + 15552000
WHERE finalized_at IS NULL AND expires_at = 253402300799;
