-- Admin-managed Resend credentials. Secrets are AES-GCM encrypted by the API.
-- Every account group shares cooldowns and the admin's request-window budget.
CREATE TABLE IF NOT EXISTS email_api_keys (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  key_encrypted TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_hint TEXT NOT NULL,
  account_tag TEXT NOT NULL DEFAULT 'default',
  from_address TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  is_live INTEGER NOT NULL DEFAULT 0 CHECK (is_live IN (0, 1)),
  use_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS email_api_one_live ON email_api_keys(is_live) WHERE is_live = 1;
CREATE TABLE IF NOT EXISTS email_api_usage (
  account_tag TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL DEFAULT 0,
  request_count INTEGER NOT NULL DEFAULT 0,
  cooldown_until TEXT,
  cooldown_reason TEXT
);
