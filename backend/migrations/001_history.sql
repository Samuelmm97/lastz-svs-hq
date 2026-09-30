CREATE TABLE IF NOT EXISTS placement_history (
  revision INTEGER PRIMARY KEY,
  draft TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  action TEXT NOT NULL,
  source_revision INTEGER,
  changes TEXT NOT NULL
);

INSERT OR IGNORE INTO placement_history
  (revision, draft, updated_at, updated_by, action, source_revision, changes)
SELECT revision, draft, updated_at, updated_by, 'baseline', NULL,
  '{"moved":[],"locked":[],"unlocked":[],"paired":[],"unpaired":[]}'
FROM placement_drafts WHERE id = 'state-798';
