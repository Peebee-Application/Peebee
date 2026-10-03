-- Google AI Studio (Gemini) API keys managed from the admin app. Many keys can
-- be added; in "test" mode the app rotates through them automatically, setting
-- one aside when it hits its daily/per-minute limit and bringing it back when
-- the limit resets. One key can be marked the master key, which is the only
-- one used in "paid" mode. Keys are stored encrypted (same AES-GCM helper as
-- the payment/maps credentials); only a short hint is ever shown.
-- New table only: until this is applied the app keeps using the
-- GEMINI_API_KEY secret exactly as before.
CREATE TABLE IF NOT EXISTS ai_api_keys (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'gemini',
  label TEXT NOT NULL,
  key_encrypted TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_hint TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  is_master INTEGER NOT NULL DEFAULT 0,
  cooldown_until TEXT,
  cooldown_reason TEXT,
  last_error TEXT,
  last_used_at TEXT,
  use_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_api_keys_hash ON ai_api_keys(provider, key_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_api_keys_master ON ai_api_keys(provider) WHERE is_master = 1;
