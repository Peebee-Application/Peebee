-- A customer can combine one existing, unpaid delivery with a second pickup.
-- Each order keeps its own items, merchant settlement, and status while the
-- shared ID tells dispatch that the same rider must collect both.
ALTER TABLE orders ADD COLUMN delivery_bundle_id TEXT;
ALTER TABLE orders ADD COLUMN delivery_bundle_hold INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_orders_delivery_bundle ON orders(delivery_bundle_id);
