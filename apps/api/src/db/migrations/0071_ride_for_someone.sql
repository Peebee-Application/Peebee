-- Booking a ride for someone else (like Uber's "Ride for someone else"): the
-- booker pays and stays in charge, the passenger is just a name and a phone
-- number on the order. A private share token lets the booker send the
-- passenger a trip link (driver, live progress) without the passenger
-- needing an account. Saved passengers are the booker's reusable contacts.
-- Additive only: the app keeps working until this is applied (see hasColumn /
-- hasTable in apps/api/src/lib/schema.ts); "ride for someone else" stays off
-- until it is.
ALTER TABLE orders ADD COLUMN passenger_name TEXT;
ALTER TABLE orders ADD COLUMN passenger_phone TEXT;
ALTER TABLE orders ADD COLUMN share_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_share_token ON orders(share_token) WHERE share_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS saved_passengers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_saved_passengers_user ON saved_passengers(user_id);
