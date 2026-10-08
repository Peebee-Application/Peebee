-- Vehicle-specific profile fields used by Self-drive listings.
ALTER TABLE vehicles ADD COLUMN model_catalog_id TEXT;
ALTER TABLE vehicles ADD COLUMN service_class TEXT NOT NULL DEFAULT 'convenient' CHECK (service_class IN ('convenient', 'comfort'));
ALTER TABLE vehicles ADD COLUMN condition_grade TEXT NOT NULL DEFAULT 'good' CHECK (condition_grade IN ('excellent', 'good', 'fair'));
ALTER TABLE vehicles ADD COLUMN seat_capacity INTEGER;
ALTER TABLE vehicles ADD COLUMN features_json TEXT NOT NULL DEFAULT '[]';

-- Give Sandbox renters a broader, varied fleet based on the Uganda model catalog.
-- These are non-login demo owners created by migration 0083; every listing stays sandbox-only.
UPDATE vehicles SET model_catalog_id = 'toyota-corolla', service_class = 'convenient', condition_grade = 'good', seat_capacity = 5, features_json = '["Air conditioning","Bluetooth"]' WHERE id = 'demo-rent-sedan';
UPDATE vehicles SET model_catalog_id = 'toyota-noah-hybrid', service_class = 'comfort', condition_grade = 'excellent', seat_capacity = 8, features_json = '["Air conditioning","Bluetooth","USB charging"]' WHERE id = 'demo-rent-noah';
INSERT OR IGNORE INTO vehicle_categories (id, kind, name, seats, rate_per_km, minimum_fare, active, sort) VALUES
 ('demo-rent-hatch-cat', 'passenger', 'Compact hatchback', 5, 2000, 8000, 1, 904),
 ('demo-rent-estate-cat', 'passenger', 'Family estate', 5, 2200, 9000, 1, 905);
INSERT OR IGNORE INTO vehicles (id, owner_id, category_id, plate, make, model, year, colour, status, notes, model_catalog_id, service_class, condition_grade, seat_capacity, features_json) VALUES
 ('demo-rent-alto', 'demo-rental-owner-1', 'demo-rent-hatch-cat', 'DEMO SD 005', 'Suzuki', 'Alto', 2021, 'Red', 'approved', 'Sandbox demo listing', 'suzuki-alto', 'convenient', 'good', 4, '["Automatic"]'),
 ('demo-rent-aqua', 'demo-rental-owner-2', 'demo-rent-sedan-cat', 'DEMO SD 006', 'Toyota', 'Aqua Hybrid', 2022, 'White', 'approved', 'Sandbox demo listing', 'toyota-aqua', 'comfort', 'excellent', 5, '["Air conditioning","Bluetooth","USB charging"]'),
 ('demo-rent-fielder', 'demo-rental-owner-3', 'demo-rent-estate-cat', 'DEMO SD 007', 'Toyota', 'Fielder Hybrid', 2021, 'Silver', 'approved', 'Sandbox demo listing', 'toyota-fielder-hybrid', 'convenient', 'good', 5, '["Air conditioning","Bluetooth"]'),
 ('demo-rent-wish', 'demo-rental-owner-1', 'demo-rent-noah-cat', 'DEMO SD 008', 'Toyota', 'Wish', 2020, 'Blue', 'approved', 'Sandbox demo listing', 'toyota-wish', 'convenient', 'good', 7, '["Air conditioning"]'),
 ('demo-rent-voxy', 'demo-rental-owner-2', 'demo-rent-noah-cat', 'DEMO SD 009', 'Toyota', 'Voxy 1.8L Hybrid', 2023, 'Black', 'approved', 'Sandbox demo listing', 'toyota-voxy-hybrid', 'comfort', 'excellent', 8, '["Air conditioning","Bluetooth","USB charging"]'),
 ('demo-rent-demio', 'demo-rental-owner-3', 'demo-rent-hatch-cat', 'DEMO SD 010', 'Mazda', 'Demio SkyActiv-D', 2021, 'Grey', 'approved', 'Sandbox demo listing', 'mazda-demio-diesel', 'convenient', 'good', 5, '["Air conditioning","Bluetooth"]'),
 ('demo-rent-raize', 'demo-rental-owner-1', 'demo-rent-suv-cat', 'DEMO SD 011', 'Toyota', 'Raize 1.0L Turbo', 2023, 'Green', 'approved', 'Sandbox demo listing', 'toyota-raize', 'comfort', 'excellent', 5, '["Air conditioning","Bluetooth","4WD"]'),
 ('demo-rent-epower', 'demo-rental-owner-2', 'demo-rent-hatch-cat', 'DEMO SD 012', 'Nissan', 'Note e-Power', 2022, 'Orange', 'approved', 'Sandbox demo listing', 'nissan-note-epower', 'comfort', 'excellent', 5, '["Air conditioning","Bluetooth","USB charging"]');
INSERT OR IGNORE INTO rental_listings (vehicle_id, daily_price, deposit_amount, notes, active, hourly_enabled, half_day_enabled, full_day_enabled, environment) VALUES
 ('demo-rent-alto', 100000, 50000, 'Convenient compact · Sandbox demo owner', 1, 1, 1, 1, 'sandbox'),
 ('demo-rent-aqua', 110000, 55000, 'Comfort hybrid · Sandbox demo owner', 1, 1, 1, 1, 'sandbox'),
 ('demo-rent-fielder', 120000, 60000, 'Family estate hybrid · Sandbox demo owner', 1, 0, 1, 1, 'sandbox'),
 ('demo-rent-wish', 150000, 75000, 'Seven-seat family car · Sandbox demo owner', 1, 0, 1, 1, 'sandbox'),
 ('demo-rent-voxy', 160000, 80000, 'Comfort hybrid MPV · Sandbox demo owner', 1, 1, 1, 1, 'sandbox'),
 ('demo-rent-demio', 110000, 55000, 'Fuel-saving diesel hatchback · Sandbox demo owner', 1, 1, 1, 1, 'sandbox'),
 ('demo-rent-raize', 150000, 75000, 'Comfort compact SUV · Sandbox demo owner', 1, 1, 1, 1, 'sandbox'),
 ('demo-rent-epower', 120000, 60000, 'Serial hybrid hatchback · Sandbox demo owner', 1, 1, 1, 1, 'sandbox');
