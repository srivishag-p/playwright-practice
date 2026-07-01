-- AI Failure Intelligence — Interaction Snapshot store schema (SQLite).
--
-- Created automatically by AiDbClient on first run. Kept here for reference
-- or manual inspection with DB Browser for SQLite / sqlite3 CLI.
--
-- Storage strategy: every table is bounded — no unbounded growth.
-- Snapshots / failures / analysis are upserted per locator.
-- Candidate matches are DELETE+INSERT per failure (capped at AI_MAX_CANDIDATES).

CREATE TABLE IF NOT EXISTS ai_executions (
  id           TEXT PRIMARY KEY,
  build_id     TEXT,
  browser      TEXT,
  environment  TEXT UNIQUE,
  started_at   TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS ai_interaction_snapshots (
  id                TEXT PRIMARY KEY,
  execution_id      TEXT REFERENCES ai_executions(id),
  scenario_name     TEXT NOT NULL,
  step_text         TEXT NOT NULL,
  url               TEXT NOT NULL,
  locator_string    TEXT NOT NULL,
  action_type       TEXT,
  locator_strategy  TEXT,
  fingerprint       TEXT,   -- JSON
  screenshot_base64 TEXT,
  captured_at       TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT ai_snapshots_unique UNIQUE (scenario_name, step_text, url, locator_string)
);

CREATE TABLE IF NOT EXISTS ai_failed_interactions (
  id                  TEXT PRIMARY KEY,
  execution_id        TEXT REFERENCES ai_executions(id),
  matched_snapshot_id TEXT REFERENCES ai_interaction_snapshots(id),
  scenario_name       TEXT NOT NULL,
  step_text           TEXT NOT NULL,
  url                 TEXT NOT NULL,
  locator_string      TEXT NOT NULL,
  error_message       TEXT,
  stack_trace         TEXT,
  current_fingerprint TEXT,  -- JSON
  failed_at           TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT ai_failed_unique UNIQUE (scenario_name, step_text, url, locator_string)
);

CREATE TABLE IF NOT EXISTS ai_candidate_matches (
  id                    TEXT PRIMARY KEY,
  failed_interaction_id TEXT REFERENCES ai_failed_interactions(id) ON DELETE CASCADE,
  rank                  INTEGER,
  suggested_locator     TEXT,
  overall_score         INTEGER,
  score_breakdown       TEXT,  -- JSON
  validation_status     TEXT,
  match_count           INTEGER,
  fingerprint           TEXT   -- JSON
);

CREATE TABLE IF NOT EXISTS ai_analysis (
  id                    TEXT PRIMARY KEY,
  failed_interaction_id TEXT UNIQUE REFERENCES ai_failed_interactions(id) ON DELETE CASCADE,
  structured_input      TEXT,  -- JSON
  structured_output     TEXT,  -- JSON
  model                 TEXT,
  latency_ms            INTEGER,
  confidence            INTEGER,
  called_at             TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
