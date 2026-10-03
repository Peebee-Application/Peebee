-- Drivers who need a car apply to owners' cars; the owner accepts and they are
-- connected on agreed terms: a share of each ride or a fixed rent (per day or
-- week). New tables, plus columns on the (new) vehicle_assignments table that
-- carry the agreed terms. The code works without any of this (connections stay
-- on the admin-assigned/own-car split) until it is applied.
CREATE TABLE IF NOT EXISTS vehicle_terms (
  vehicle_id TEXT PRIMARY KEY REFERENCES vehicles(id),
  open_to_drivers INTEGER NOT NULL DEFAULT 0,
  fee_type TEXT NOT NULL DEFAULT 'share' CHECK (fee_type IN ('share', 'rent')),
  owner_share_percent INTEGER,
  rent_amount INTEGER,
  rent_period TEXT CHECK (rent_period IN ('day', 'week')),
  notes TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS driver_requests (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  driver_id TEXT NOT NULL REFERENCES users(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn')),
  fee_type TEXT NOT NULL,
  owner_share_percent INTEGER,
  rent_amount INTEGER,
  rent_period TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_requests_pending ON driver_requests(vehicle_id, driver_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_driver_requests_owner ON driver_requests(owner_id, status);
CREATE INDEX IF NOT EXISTS idx_driver_requests_driver ON driver_requests(driver_id, status);

ALTER TABLE vehicle_assignments ADD COLUMN fee_type TEXT;
ALTER TABLE vehicle_assignments ADD COLUMN owner_share_percent INTEGER;
ALTER TABLE vehicle_assignments ADD COLUMN rent_amount INTEGER;
ALTER TABLE vehicle_assignments ADD COLUMN rent_period TEXT;
ALTER TABLE vehicle_assignments ADD COLUMN rent_paid_total INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vehicle_assignments ADD COLUMN rent_unpaid_at_end INTEGER;
