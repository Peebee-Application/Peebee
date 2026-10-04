-- SUPERSEDED — kept only because these columns/table are already live in
-- production and dropping them isn't worth the risk for dead schema.
--
-- Originally: a running "amount owed to Peebee from cash orders" counter
-- plus a per-order audit table. Replaced before ever being used by a
-- simpler design (see apps/api/src/orders/routes.ts POST
-- /orders/:id/settle and apps/api/src/lib/monetization.ts
-- isCashDepositOk): the platform's cut of a cash order is deducted
-- directly from the rider's own wallet_balance/_sandbox at Settle
-- (allowed to go negative), which nets against their next payout with no
-- separate debt to track. Do not read or write cash_owed/cash_owed_sandbox
-- or rider_cash_dues from application code.
ALTER TABLE riders ADD COLUMN cash_owed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE riders ADD COLUMN cash_owed_sandbox INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS rider_cash_dues (
  id TEXT PRIMARY KEY,
  rider_id TEXT NOT NULL REFERENCES users(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'owed' CHECK (status IN ('owed', 'paid')),
  environment TEXT NOT NULL DEFAULT 'live' CHECK (environment IN ('live', 'sandbox')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_rider_cash_dues_rider ON rider_cash_dues(rider_id, status);
