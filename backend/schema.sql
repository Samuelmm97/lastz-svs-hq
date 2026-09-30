CREATE TABLE IF NOT EXISTS placement_drafts (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  draft TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
