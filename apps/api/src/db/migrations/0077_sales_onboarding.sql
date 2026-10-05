-- Agent access is separate from administrator roles. No existing user gains access.
CREATE TABLE IF NOT EXISTS sales_agents (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS onboarding_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  agent_id TEXT NOT NULL REFERENCES users(id),
  account_type TEXT NOT NULL CHECK (account_type IN ('customer','rider','restaurant','merchant','agent')),
  request_id TEXT NOT NULL,
  consent_at TEXT NOT NULL,
  preferred_channel TEXT NOT NULL DEFAULT 'auto',
  activated_at TEXT,
  last_invited_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(agent_id, request_id)
);
CREATE INDEX IF NOT EXISTS idx_onboarding_agent ON onboarding_accounts(agent_id, created_at);
CREATE TABLE IF NOT EXISTS onboarding_invitations (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES onboarding_accounts(id),
  token_hash TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL CHECK (channel IN ('email','sms','whatsapp')),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  claim_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS onboarding_deliveries (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES onboarding_accounts(id),
  channel TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sending','sent','failed','unavailable')),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_onboarding_deliveries ON onboarding_deliveries(account_id, created_at);
