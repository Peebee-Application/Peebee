-- Rider "Pro" — a separate, optional paid tier from the existing job-
-- activation subscription (0031_rider_subscription.sql). Unlocks whichever
-- premium features an admin individually flips to require it (Luganda
-- list-audio, Stage Savings Circles) rather than gating job matching.
-- See apps/api/src/riders/pro-subscription.ts.
--
-- Plain ADD COLUMN/new table throughout — no CHECK-constraint widening, so
-- no rebuild needed, consistent with every recent migration here.

ALTER TABLE riders ADD COLUMN pro_status TEXT NOT NULL DEFAULT 'inactive' CHECK (pro_status IN ('inactive', 'active', 'past_due'));
ALTER TABLE riders ADD COLUMN pro_paid_through TEXT;
ALTER TABLE riders ADD COLUMN pro_mode TEXT CHECK (pro_mode IN ('recurring', 'once'));

CREATE TABLE IF NOT EXISTS rider_pro_subscription_payments (
  id TEXT PRIMARY KEY,
  rider_id TEXT NOT NULL REFERENCES users(id),
  mode TEXT NOT NULL CHECK (mode IN ('recurring', 'once')),
  amount INTEGER NOT NULL,
  provider TEXT NOT NULL,
  provider_ref TEXT,
  msisdn TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'successful', 'failed')),
  period_start TEXT,
  period_end TEXT,
  environment TEXT NOT NULL DEFAULT 'live' CHECK (environment IN ('live', 'sandbox')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
