-- Ride service is independent of the owner's vehicle body type.
ALTER TABLE car_bookings ADD COLUMN service_tier TEXT CHECK (service_tier IN ('convenient', 'comfort', 'xl'));
ALTER TABLE vehicles ADD COLUMN accepts_convenient INTEGER NOT NULL DEFAULT 0 CHECK (accepts_convenient IN (0, 1));
CREATE INDEX IF NOT EXISTS idx_car_bookings_service_tier ON car_bookings(service_tier, status);
