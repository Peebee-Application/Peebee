-- Wallet accounts: freeze, saved contacts, payment requests, and a
-- server-side idempotency key for transfers. Additive. Every new column
-- and table is optional at runtime (hasColumn / hasTable) until this file
-- is applied by hand to the live D1 database.

ALTER TABLE users ADD COLUMN primary_wallet_frozen_at TEXT;
ALTER TABLE wallets ADD COLUMN frozen_at TEXT;

-- One key per transfer_out, so a retry after an unclear result can see
-- that the debit already happened and will not send the money twice.
ALTER TABLE wallet_ledger ADD COLUMN idempotency_key TEXT;
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_idempotency ON wallet_ledger(user_id, idempotency_key);

CREATE TABLE IF NOT EXISTS wallet_contacts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  contact_user_id TEXT NOT NULL REFERENCES users(id),
  nickname TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (owner_id != contact_user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_contacts_pair ON wallet_contacts(owner_id, contact_user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_contacts_owner ON wallet_contacts(owner_id, created_at DESC);

-- A request for money that stays inside Peebee. The payer reviews and
-- swipes, the same way a send does. "later" is a snooze, not a refusal.
CREATE TABLE IF NOT EXISTS wallet_requests (
  id TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL REFERENCES users(id),
  payer_id TEXT NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  note TEXT,
  into_wallet_id TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'later', 'paid', 'declined', 'cancelled', 'expired')),
  expires_at TEXT NOT NULL,
  snooze_until TEXT,
  idempotency_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT,
  CHECK (requester_id != payer_id)
);

CREATE INDEX IF NOT EXISTS idx_wallet_requests_payer ON wallet_requests(payer_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_requests_requester ON wallet_requests(requester_id, status, created_at DESC);

-- Remembers the outcome of a transfer so the same key never moves money twice.
CREATE TABLE IF NOT EXISTS wallet_idempotency (
  user_id TEXT NOT NULL REFERENCES users(id),
  idem_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'done')),
  http_status INTEGER,
  body_json TEXT,
  intent_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, idem_key)
);
