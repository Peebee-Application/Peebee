-- Photos a customer attaches to a shopping (or parcel) order so the rider can
-- buy exactly the right thing: the empty pack, a label, a screenshot. Each row
-- points at an image in R2 (uploaded first under order-photos/<customer>/...,
-- then attached to the order). Visible to whoever can already see the order:
-- the customer, the assigned rider and admin.
--
-- note:         optional short caption from the customer (max 80 chars, enforced by the API)
-- list_item_id: optional link to the list item the photo shows
-- position:     display order, 0-based

CREATE TABLE IF NOT EXISTS order_photos (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  r2_key TEXT NOT NULL,
  note TEXT,
  list_item_id TEXT REFERENCES list_items(id),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_order_photos_order ON order_photos(order_id, position);
CREATE INDEX IF NOT EXISTS idx_order_photos_item ON order_photos(list_item_id);
