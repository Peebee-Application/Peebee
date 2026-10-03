-- Self-drive hire: an owner lists an approved vehicle for rent by the day; a
-- customer requests dates (with their driving licence details), the owner
-- approves, hands the car over and takes it back. The renter's rent + deposit
-- are held from their wallet and released at the end (deposit back unless the
-- owner claims damage, which an admin resolves if claimed). New tables only;
-- self-drive stays off (admin setting, needs a platform percentage) and
-- dormant until this is applied.
CREATE TABLE IF NOT EXISTS rental_listings (
  vehicle_id TEXT PRIMARY KEY REFERENCES vehicles(id),
  daily_price INTEGER NOT NULL,
  deposit_amount INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rentals (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  renter_id TEXT NOT NULL REFERENCES users(id),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  days INTEGER NOT NULL,
  daily_price INTEGER NOT NULL,
  rent_amount INTEGER NOT NULL,
  deposit_amount INTEGER NOT NULL,
  platform_percent INTEGER NOT NULL,
  licence_number TEXT NOT NULL,
  licence_expiry TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'active', 'disputed', 'completed', 'declined', 'cancelled')),
  damage_claim INTEGER NOT NULL DEFAULT 0,
  damage_final INTEGER,
  owner_amount INTEGER,
  platform_amount INTEGER,
  refund_amount INTEGER,
  handed_over_at TEXT,
  returned_at TEXT,
  settled_at TEXT,
  environment TEXT NOT NULL DEFAULT 'live' CHECK (environment IN ('live', 'sandbox')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rentals_vehicle ON rentals(vehicle_id, status);
CREATE INDEX IF NOT EXISTS idx_rentals_renter ON rentals(renter_id);
CREATE INDEX IF NOT EXISTS idx_rentals_owner ON rentals(owner_id);
