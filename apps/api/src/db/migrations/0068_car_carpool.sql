-- Carpool: a driver publishes a trip (route, departure, seats, seat price);
-- passengers book seats. Each seat booking carries its own linked `orders` row
-- and `car_bookings` row, so payment, chat, tracking and the owner/driver
-- split work exactly as for any car ride. New tables only; carpool stays off
-- (admin setting) and dormant until this is applied.
CREATE TABLE IF NOT EXISTS carpool_trips (
  id TEXT PRIMARY KEY,
  driver_id TEXT NOT NULL REFERENCES users(id),
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  category_id TEXT NOT NULL REFERENCES vehicle_categories(id),
  origin_label TEXT NOT NULL,
  origin_lat REAL NOT NULL,
  origin_lng REAL NOT NULL,
  dest_label TEXT NOT NULL,
  dest_lat REAL NOT NULL,
  dest_lng REAL NOT NULL,
  distance_km REAL,
  depart_at TEXT NOT NULL,
  seats_total INTEGER NOT NULL,
  seats_taken INTEGER NOT NULL DEFAULT 0,
  seat_price INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'full', 'departed', 'completed', 'cancelled')),
  environment TEXT NOT NULL DEFAULT 'live' CHECK (environment IN ('live', 'sandbox')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_carpool_trips_open ON carpool_trips(status, depart_at);
CREATE INDEX IF NOT EXISTS idx_carpool_trips_driver ON carpool_trips(driver_id, depart_at);

CREATE TABLE IF NOT EXISTS carpool_seats (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES carpool_trips(id),
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
  passenger_id TEXT NOT NULL REFERENCES users(id),
  seats INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_carpool_seats_trip ON carpool_seats(trip_id, status);
