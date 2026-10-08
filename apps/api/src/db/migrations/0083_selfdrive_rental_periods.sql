-- Owner-selectable Self-drive rental periods and hourly pricing.
ALTER TABLE rental_listings ADD COLUMN hourly_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE rental_listings ADD COLUMN half_day_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE rental_listings ADD COLUMN full_day_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE rental_listings ADD COLUMN environment TEXT NOT NULL DEFAULT 'live' CHECK (environment IN ('live', 'sandbox'));

ALTER TABLE rentals ADD COLUMN period_type TEXT NOT NULL DEFAULT 'full_day' CHECK (period_type IN ('hourly', 'half_day', 'full_day'));
ALTER TABLE rentals ADD COLUMN hourly_price INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rentals ADD COLUMN overtime_amount INTEGER NOT NULL DEFAULT 0;

-- Four non-login demo owners and Sandbox-only vehicles make the Self-drive
-- catalog usable without exposing sample vehicles to live customers.
INSERT OR IGNORE INTO users (id, phone, name, password_hash, role) VALUES
 ('demo-rental-owner-1', '+000000000091', 'Amina Demo Rentals', 'demo-account-disabled', 'customer'),
 ('demo-rental-owner-2', '+000000000092', 'Entebbe Family Cars', 'demo-account-disabled', 'customer'),
 ('demo-rental-owner-3', '+000000000093', 'Lakeview Van Hire', 'demo-account-disabled', 'customer');
INSERT OR IGNORE INTO car_partners (user_id, owner_status, driver_status) VALUES
 ('demo-rental-owner-1', 'approved', 'none'), ('demo-rental-owner-2', 'approved', 'none'), ('demo-rental-owner-3', 'approved', 'none');
INSERT OR IGNORE INTO vehicle_categories (id, kind, name, seats, rate_per_km, minimum_fare, active, sort) VALUES
 ('demo-rent-sedan-cat', 'passenger', 'Saloon', 4, 2000, 8000, 1, 900),
 ('demo-rent-noah-cat', 'passenger', 'Family MPV', 7, 2500, 10000, 1, 901),
 ('demo-rent-hiace-cat', 'passenger', 'Minibus', 14, 3500, 15000, 1, 902),
 ('demo-rent-suv-cat', 'passenger', 'SUV', 5, 3000, 12000, 1, 903);
INSERT OR IGNORE INTO vehicles (id, owner_id, category_id, plate, make, model, year, colour, status, notes) VALUES
 ('demo-rent-sedan', 'demo-rental-owner-1', 'demo-rent-sedan-cat', 'DEMO SD 001', 'Toyota', 'Corolla', 2021, 'Silver', 'approved', 'Sandbox demo listing'),
 ('demo-rent-noah', 'demo-rental-owner-2', 'demo-rent-noah-cat', 'DEMO SD 002', 'Toyota', 'Noah', 2020, 'Black', 'approved', 'Sandbox demo listing'),
 ('demo-rent-hiace', 'demo-rental-owner-3', 'demo-rent-hiace-cat', 'DEMO SD 003', 'Toyota', 'Hiace', 2019, 'White', 'approved', 'Sandbox demo listing'),
 ('demo-rent-suv', 'demo-rental-owner-2', 'demo-rent-suv-cat', 'DEMO SD 004', 'Nissan', 'X-Trail', 2022, 'Blue', 'approved', 'Sandbox demo listing');
INSERT OR IGNORE INTO rental_listings (vehicle_id, daily_price, deposit_amount, notes, active, hourly_enabled, half_day_enabled, full_day_enabled, environment) VALUES
 ('demo-rent-sedan', 100000, 50000, 'Saloon · Sandbox demo owner', 1, 1, 1, 1, 'sandbox'),
 ('demo-rent-noah', 150000, 75000, 'Family MPV · Owner offers half-day and full-day', 1, 0, 1, 1, 'sandbox'),
 ('demo-rent-hiace', 200000, 100000, '14-seat minibus · Owner offers full-day only', 1, 0, 0, 1, 'sandbox'),
 ('demo-rent-suv', 180000, 90000, 'Comfort SUV · Owner offers hourly hire only', 1, 1, 0, 0, 'sandbox');
