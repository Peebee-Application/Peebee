-- Apply by hand. Reporting and POS keep working before this migration lands.
-- NULL preserves the fact that the environment/cost of an old POS sale was never recorded.
ALTER TABLE store_pos_sales ADD COLUMN environment TEXT CHECK (environment IN ('live','sandbox'));
ALTER TABLE store_pos_sales ADD COLUMN cost_snapshot_json TEXT;

-- Bookkeeping only: these records never charge a wallet or alter a merchant payable.
CREATE TABLE IF NOT EXISTS store_financial_entries (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  outlet_id TEXT REFERENCES merchant_outlets(id),
  environment TEXT NOT NULL CHECK (environment IN ('live','sandbox')),
  category TEXT NOT NULL CHECK (category IN ('operating_expense','cost_of_goods','tax')),
  amount_ugx INTEGER NOT NULL CHECK (amount_ugx>0),
  occurred_at TEXT NOT NULL,
  description TEXT NOT NULL,
  reference TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  voided_at TEXT,
  voided_by TEXT REFERENCES users(id),
  void_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_store_finance_period ON store_financial_entries(store_id,environment,occurred_at);
