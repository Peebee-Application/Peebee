-- Fictional sandbox-only rideshare hosts. They have no login identifier and
-- cannot receive live dispatches. Trips are generated for upcoming dates by
-- the sandbox search endpoint so the demo never expires.
INSERT OR IGNORE INTO users (id, phone, email, name, password_hash, role)
VALUES
  ('demo-rideshare-driver-1', NULL, NULL, 'Daniel Kato (Demo)', 'disabled-demo-login', 'rider'),
  ('demo-rideshare-driver-2', NULL, NULL, 'Sarah Namusoke (Demo)', 'disabled-demo-login', 'rider'),
  ('demo-rideshare-driver-3', NULL, NULL, 'Peter Okello (Demo)', 'disabled-demo-login', 'rider'),
  ('demo-rideshare-driver-4', NULL, NULL, 'Amina Nankya (Demo)', 'disabled-demo-login', 'rider');

INSERT OR IGNORE INTO vehicles (id, owner_id, category_id, plate, make, model, year, colour, status)
VALUES
  ('demo-rideshare-car-1', 'demo-rideshare-driver-1', 'peebee-car-normal', 'DEMO RIDE 01', 'Toyota', 'Corolla', 2013, 'Silver', 'approved'),
  ('demo-rideshare-car-2', 'demo-rideshare-driver-2', 'peebee-car-normal', 'DEMO RIDE 02', 'Toyota', 'Wish', 2014, 'White', 'approved'),
  ('demo-rideshare-car-3', 'demo-rideshare-driver-3', 'peebee-car-large', 'DEMO RIDE 03', 'Toyota', 'Noah', 2012, 'Black', 'approved'),
  ('demo-rideshare-car-4', 'demo-rideshare-driver-4', 'peebee-car-normal', 'DEMO RIDE 04', 'Honda', 'Fit', 2015, 'Blue', 'approved');
