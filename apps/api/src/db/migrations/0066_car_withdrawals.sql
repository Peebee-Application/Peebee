-- Cash-out of Peebee Car earnings (owners and drivers) to mobile money. New
-- table only. Withdrawals are off until an admin enables them (car settings);
-- the code that reads this table stays dormant until this is applied.
CREATE TABLE IF NOT EXISTS car_withdrawals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  provider TEXT NOT NULL DEFAULT 'momo',
  provider_ref TEXT,
  msisdn TEXT,
  network TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'successful', 'failed')),
  environment TEXT NOT NULL DEFAULT 'live' CHECK (environment IN ('live', 'sandbox')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_car_withdrawals_user ON car_withdrawals(user_id, status);
