-- Peebee Car (on-demand car/van/truck rides). New tables only — nothing here
-- alters an existing table, so applying it can't disturb boda traffic, and the
-- code that reads these tables stays dormant behind the `car_enabled` admin
-- switch (default off) until it is applied.
--
-- Supply flow: an owner puts a vehicle up for service -> a Peebee manager
-- approves it and ASSIGNS a driver -> the driver goes online with it in the
-- driver app -> customers' requests reach drivers whose vehicle is in the
-- requested category. When a ride settles, the fare pool is split between
-- owner, driver and platform by percentages set in Admin.

-- What can be booked: passenger cars by seat count, or cargo vans/trucks by
-- type/size. Fares are calculated in the app (distance x rate, never below the
-- minimum). Profit shares may be overridden per category; NULL = admin default.
CREATE TABLE IF NOT EXISTS vehicle_categories (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'passenger' CHECK (kind IN ('passenger', 'cargo')),
  name TEXT NOT NULL,
  seats INTEGER,
  cargo_type TEXT,
  size_label TEXT,
  reference_image_key TEXT,
  rate_per_km INTEGER NOT NULL DEFAULT 0,
  minimum_fare INTEGER NOT NULL DEFAULT 0,
  owner_share_percent INTEGER,
  driver_share_percent INTEGER,
  platform_share_percent INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per person who has applied to be a car owner and/or a driver. A
-- user stays role='customer' (users.role is CHECK-constrained); these statuses
-- are what unlock the owner and driver apps. One person can be both.
CREATE TABLE IF NOT EXISTS car_partners (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  owner_status TEXT NOT NULL DEFAULT 'none' CHECK (owner_status IN ('none', 'pending', 'approved', 'rejected', 'suspended')),
  driver_status TEXT NOT NULL DEFAULT 'none' CHECK (driver_status IN ('none', 'pending', 'approved', 'rejected', 'suspended')),
  id_document_key TEXT,
  licence_key TEXT,
  licence_expiry TEXT,
  notes TEXT,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  category_id TEXT NOT NULL REFERENCES vehicle_categories(id),
  plate TEXT NOT NULL UNIQUE,
  make TEXT,
  model TEXT,
  year INTEGER,
  colour TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
  notes TEXT,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vehicles_owner ON vehicles(owner_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_category ON vehicles(category_id, status);

-- A manager gives an approved driver an approved vehicle. At most one active
-- driver per vehicle (a driver may hold several vehicles but runs one at a time).
CREATE TABLE IF NOT EXISTS vehicle_assignments (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  driver_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  assigned_by TEXT REFERENCES users(id),
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_assignments_active ON vehicle_assignments(vehicle_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_vehicle_assignments_driver ON vehicle_assignments(driver_id, status);

-- Which vehicle a driver is out with right now, and whether they take jobs.
CREATE TABLE IF NOT EXISTS car_driver_state (
  driver_id TEXT PRIMARY KEY REFERENCES users(id),
  vehicle_id TEXT REFERENCES vehicles(id),
  online INTEGER NOT NULL DEFAULT 0,
  lat REAL,
  lng REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The commercial record behind a car ride. Every booking has exactly one
-- linked `orders` row, so payment, chat, calls, tracking, ratings and fees all
-- run through the existing ride machinery unchanged. The split is stamped
-- when the ride settles.
CREATE TABLE IF NOT EXISTS car_bookings (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
  customer_id TEXT NOT NULL REFERENCES users(id),
  category_id TEXT NOT NULL REFERENCES vehicle_categories(id),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'completed', 'cancelled')),
  vehicle_id TEXT REFERENCES vehicles(id),
  owner_id TEXT REFERENCES users(id),
  driver_id TEXT REFERENCES users(id),
  share_owner_percent INTEGER,
  share_driver_percent INTEGER,
  share_platform_percent INTEGER,
  pool_amount INTEGER,
  owner_amount INTEGER,
  driver_amount INTEGER,
  platform_amount INTEGER,
  settled_at TEXT,
  environment TEXT NOT NULL DEFAULT 'live' CHECK (environment IN ('live', 'sandbox')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_car_bookings_category ON car_bookings(category_id, status);
CREATE INDEX IF NOT EXISTS idx_car_bookings_owner ON car_bookings(owner_id);
CREATE INDEX IF NOT EXISTS idx_car_bookings_driver ON car_bookings(driver_id);
