-- Scheduled car rides: book now for a pickup later. The job opens to drivers
-- shortly before pickup (admin setting), so nobody is blocked for days; a
-- two-minute check then watches an assigned driver and warns the customer if
-- they look late. Additive: three columns on the (new) car_bookings table and
-- one new audit table. The code works without them (scheduled rides stay
-- unavailable) until this is applied.
ALTER TABLE car_bookings ADD COLUMN scheduled_for TEXT;
ALTER TABLE car_bookings ADD COLUMN scheduled_notified_at TEXT;
ALTER TABLE car_bookings ADD COLUMN scheduled_opened_at TEXT;

CREATE TABLE IF NOT EXISTS scheduled_checks (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  driver_lat REAL,
  driver_lng REAL,
  distance_to_pickup_km REAL,
  eta_minutes REAL,
  minutes_to_pickup REAL,
  verdict TEXT NOT NULL CHECK (verdict IN ('on_track', 'late_risk', 'no_signal'))
);
CREATE INDEX IF NOT EXISTS idx_scheduled_checks_order ON scheduled_checks(order_id, checked_at);
