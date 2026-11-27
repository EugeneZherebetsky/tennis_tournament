ALTER TABLE boards ADD COLUMN join_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS boards_join_code ON boards (join_code);
UPDATE boards
SET join_code = UPPER(HEX(RANDOMBLOB(6))), expires_at = 253402300799
WHERE join_code IS NULL AND expires_at > UNIXEPOCH();
