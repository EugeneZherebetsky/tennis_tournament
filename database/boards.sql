CREATE TABLE IF NOT EXISTS boards (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS boards_expiry ON boards (expires_at);
CREATE INDEX IF NOT EXISTS boards_created ON boards (created_at);
