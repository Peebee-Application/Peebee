-- Item-linked list purchases: merchant confirmation holds funds until customer receipt.
CREATE TABLE IF NOT EXISTS list_merchant_purchases (
  payment_id TEXT PRIMARY KEY REFERENCES merchant_payments(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  code TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL CHECK(amount > 0),
  reserved_available INTEGER NOT NULL CHECK(reserved_available >= amount),
  status TEXT NOT NULL DEFAULT 'awaiting_merchant' CHECK(status IN ('awaiting_merchant','pending_delivery','released','cancelled')),
  lock_check INTEGER NOT NULL DEFAULT 1 CHECK(lock_check = 1),
  delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_list_purchases_order ON list_merchant_purchases(order_id,status);
CREATE TABLE IF NOT EXISTS list_merchant_purchase_items (
  payment_id TEXT NOT NULL REFERENCES list_merchant_purchases(payment_id),
  list_item_id TEXT NOT NULL REFERENCES list_items(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  name TEXT NOT NULL,
  quantity REAL NOT NULL CHECK(quantity > 0),
  amount INTEGER NOT NULL CHECK(amount > 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  PRIMARY KEY(payment_id,list_item_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_list_purchase_item_active ON list_merchant_purchase_items(order_id,list_item_id) WHERE active=1;
