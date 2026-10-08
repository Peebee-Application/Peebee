-- Practice-mode car rides use a dedicated roster instead of real driver accounts.
-- The records are sandbox-only and never participate in live order matching.
ALTER TABLE car_bookings ADD COLUMN vehicle_size TEXT NOT NULL DEFAULT 'normal'
  CHECK (vehicle_size IN ('normal', 'large'));

INSERT OR IGNORE INTO vehicle_categories (id, kind, name, seats, rate_per_km, minimum_fare, active, sort)
VALUES
  ('peebee-car-normal', 'passenger', 'Normal saloon', 4, 2000, 8000, 1, 1),
  ('peebee-car-large', 'passenger', 'Large minivan', 7, 3000, 12000, 1, 2);

CREATE TABLE IF NOT EXISTS practice_demo_car_riders (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  vehicle_make TEXT NOT NULL,
  vehicle_model TEXT NOT NULL,
  vehicle_size TEXT NOT NULL CHECK (vehicle_size IN ('normal', 'large')),
  plate TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  any_distance INTEGER NOT NULL DEFAULT 1 CHECK (any_distance IN (0, 1)),
  environment TEXT NOT NULL DEFAULT 'sandbox' CHECK (environment = 'sandbox'),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO practice_demo_car_riders
  (id, display_name, vehicle_make, vehicle_model, vehicle_size, plate, active, any_distance)
VALUES
  ('practice-car-driver-01', 'Daniel Kato', 'Toyota', 'Corolla', 'normal', 'PRACTICE 01', 1, 1),
  ('practice-car-driver-02', 'Sarah Namusoke', 'Honda', 'Civic', 'normal', 'PRACTICE 02', 1, 1),
  ('practice-car-driver-03', 'Peter Okello', 'Toyota', 'Noah', 'large', 'PRACTICE 03', 1, 1),
  ('practice-car-driver-04', 'Amina Nankya', 'Toyota', 'Voxy', 'large', 'PRACTICE 04', 1, 1),
  ('practice-car-driver-05', 'Mark Ssemanda', 'Nissan', 'Sylphy', 'normal', 'PRACTICE 05', 1, 1),
  ('practice-car-driver-06', 'Joyce Akello', 'Mazda', 'Axela', 'normal', 'PRACTICE 06', 1, 1),
  ('practice-car-driver-07', 'Isaac Mugisha', 'Nissan', 'Serena', 'large', 'PRACTICE 07', 1, 1),
  ('practice-car-driver-08', 'Ruth Atim', 'Toyota', 'Noah', 'large', 'PRACTICE 08', 1, 1);

