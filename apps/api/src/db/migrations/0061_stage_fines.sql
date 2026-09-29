-- Fines engine: named fine types (e.g. "Late repayment") the group admin
-- defines per cycle, each on a flexible schedule — a one-time flat amount,
-- or an amount that repeats daily/weekly/monthly for as long as a loan
-- stays overdue. Applied fines are recorded as ordinary stage_transactions
-- rows (type='fine', related_id=loan id) — the existing ledger/reports
-- already display that type; this table only holds the fine *definitions*.
CREATE TABLE IF NOT EXISTS stage_fine_types (
  id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL REFERENCES stage_cycles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  schedule TEXT NOT NULL CHECK (schedule IN ('flat', 'daily', 'weekly', 'monthly')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stage_fine_types_cycle ON stage_fine_types(cycle_id);
