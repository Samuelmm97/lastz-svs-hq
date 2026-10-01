CREATE TABLE IF NOT EXISTS placement_drafts (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  draft TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS placement_history (
  revision INTEGER PRIMARY KEY,
  draft TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  action TEXT NOT NULL,
  source_revision INTEGER,
  changes TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS placement_plans (
  signature TEXT PRIMARY KEY,
  plan TEXT NOT NULL,
  created_at TEXT NOT NULL
);
