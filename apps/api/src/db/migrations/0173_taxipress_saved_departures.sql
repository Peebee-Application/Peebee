-- Migration 0173: account-owned saved Taxipress departures.
-- Queue entries are ephemeral, so departure_id intentionally has no FK.
CREATE TABLE IF NOT EXISTS taxipress_saved_departures (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  environment TEXT NOT NULL CHECK (environment IN ('live','sandbox')),
  departure_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, environment, departure_id)
);
CREATE INDEX IF NOT EXISTS idx_taxipress_saved_departures_owner
  ON taxipress_saved_departures (user_id, environment, created_at DESC);
