-- Snapshot the disclosed fees for new orders. Existing orders remain exempt.
ALTER TABLE orders ADD COLUMN time_fee_policy TEXT;
ALTER TABLE orders ADD COLUMN rider_departed_at TEXT;
ALTER TABLE orders ADD COLUMN rider_arrived_at TEXT;
ALTER TABLE orders ADD COLUMN waiting_closed_at TEXT;
ALTER TABLE orders ADD COLUMN time_action_token TEXT;

CREATE TABLE order_time_fees (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  customer_id TEXT NOT NULL REFERENCES users(id),
  rider_id TEXT REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('cancellation', 'waiting')),
  amount INTEGER NOT NULL CHECK (amount >= 500 AND amount % 500 = 0),
  note TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('live', 'sandbox')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(order_id, kind)
);
