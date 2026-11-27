ALTER TABLE boards ADD COLUMN layout_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE boards ADD COLUMN match_versions TEXT NOT NULL DEFAULT '{}';
ALTER TABLE boards ADD COLUMN finalized_at INTEGER;

CREATE TABLE IF NOT EXISTS board_archives (
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  finalized_at INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  PRIMARY KEY (board_id, revision)
);

CREATE TRIGGER IF NOT EXISTS archive_final_board
AFTER UPDATE OF finalized_at ON boards
WHEN OLD.finalized_at IS NULL AND NEW.finalized_at IS NOT NULL
BEGIN
  INSERT INTO board_archives (board_id, revision, finalized_at, snapshot)
  VALUES (NEW.id, NEW.revision, NEW.finalized_at, NEW.snapshot);
END;
