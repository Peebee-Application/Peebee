-- Wallet money alerts. Applied by hand to the live D1 database.
-- Until this lands, hasTable keeps transfers working and skips the
-- stored claim and the notifications inbox. Email, SMS, chat and push
-- still try, and an in-memory claim stops a retry in the same isolate.

CREATE TABLE IF NOT EXISTS wallet_alert_sends (
  transfer_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (transfer_id, user_id, channel)
);

CREATE TABLE IF NOT EXISTS wallet_alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  transfer_id TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('sent', 'received')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  amount INTEGER NOT NULL,
  counterpart_name TEXT NOT NULL,
  account_name TEXT NOT NULL,
  reference TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_alerts_once ON wallet_alerts(user_id, transfer_id, event);
CREATE INDEX IF NOT EXISTS idx_wallet_alerts_user ON wallet_alerts(user_id, created_at DESC);
