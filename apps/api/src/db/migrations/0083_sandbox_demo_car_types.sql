-- Sample car types for sandbox rides. They share the normal category table so
-- the full quote and booking flow can use them, but are hidden from live
-- customers and rejected by live booking endpoints.
ALTER TABLE vehicle_categories ADD COLUMN demo_only INTEGER NOT NULL DEFAULT 0;

INSERT OR IGNORE INTO vehicle_categories
  (id, kind, name, seats, cargo_type, size_label, rate_per_km, minimum_fare, active, sort, demo_only)
VALUES
  ('demo-car-city', 'passenger', 'City compact', 4, NULL, 'Easy city trips', 1500, 6000, 1, 100, 1),
  ('demo-car-comfort', 'passenger', 'Comfort sedan', 4, NULL, 'Everyday comfort', 2000, 8000, 1, 101, 1),
  ('demo-car-family', 'passenger', 'Family SUV', 6, NULL, 'Extra room', 2800, 12000, 1, 102, 1),
  ('demo-car-executive', 'passenger', 'Executive SUV', 4, NULL, 'Premium ride', 3500, 15000, 1, 103, 1),
  ('demo-car-van', 'passenger', 'Passenger van', 8, NULL, 'Group travel', 3000, 18000, 1, 104, 1),
  ('demo-car-pickup', 'cargo', 'Pickup truck', NULL, 'Light cargo', 'Small loads', 2500, 10000, 1, 105, 1),
  ('demo-car-truck', 'cargo', '3-ton truck', NULL, 'Heavy cargo', 'Moving and freight', 4500, 25000, 1, 106, 1);
