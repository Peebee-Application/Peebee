CREATE TABLE IF NOT EXISTS financial_guest_invites (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  password_hash TEXT,
  code_hash TEXT,
  code_expires_at INTEGER,
  code_sent_at INTEGER,
  session_hash TEXT,
  session_expires_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_financial_guest_invites_creator
  ON financial_guest_invites(created_by, created_at DESC);

CREATE TABLE IF NOT EXISTS financial_guest_requests (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  invite_id TEXT REFERENCES financial_guest_invites(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_guest_pending_email
  ON financial_guest_requests(email) WHERE reviewed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_financial_guest_pending_created
  ON financial_guest_requests(created_at DESC) WHERE reviewed_at IS NULL;
