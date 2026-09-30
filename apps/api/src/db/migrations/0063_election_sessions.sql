-- Officer elections become a deliberate, time-boxed session the group
-- admin activates (not always-open self-nomination). A session names
-- which roles are up for election and a nomination deadline; the group
-- admin later starts a voting window with its own deadline, and results
-- stay hidden until the admin explicitly publishes them.
CREATE TABLE IF NOT EXISTS stage_election_sessions (
  id TEXT PRIMARY KEY,
  stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  -- JSON array of officer role strings up for election this session, e.g. ["chairman","treasurer"].
  roles TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'nominating' CHECK (status IN ('nominating', 'voting', 'closed', 'published')),
  nomination_deadline TEXT NOT NULL,
  voting_deadline TEXT,
  -- How long after casting a vote a member may still change it.
  vote_change_grace_seconds INTEGER NOT NULL DEFAULT 120,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  voting_started_at TEXT,
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_stage_election_sessions_stage ON stage_election_sessions(stage_id, status);

-- Each session opens one stage_officer_elections row per role (unchanged
-- table), now tagged with which session it belongs to.
ALTER TABLE stage_officer_elections ADD COLUMN session_id TEXT REFERENCES stage_election_sessions(id);

-- A nomination is now a self-application with a pitch — text and/or a
-- voice note (uploaded separately, same R2 pattern as contribution/
-- repayment proof photos).
ALTER TABLE stage_officer_nominations ADD COLUMN statement TEXT;
ALTER TABLE stage_officer_nominations ADD COLUMN voice_note_key TEXT;

-- Tracks when a vote was last cast/changed, to enforce the admin-set
-- change-of-mind grace window. D1/SQLite won't allow a non-constant
-- default on ADD COLUMN, so add it nullable and backfill from the
-- existing created_at (every pre-existing vote is treated as "just cast"
-- for grace-window purposes) — application code always sets it
-- explicitly on every insert/update from here on.
ALTER TABLE stage_officer_votes ADD COLUMN updated_at TEXT;
UPDATE stage_officer_votes SET updated_at = created_at WHERE updated_at IS NULL;
