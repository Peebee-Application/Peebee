-- VIP is a TaxiPress vehicle class. Booking, orders, payment and ticketing keep
-- using the shared TaxiPress tables and services.
ALTER TABLE taxipress_taxis ADD COLUMN service_class TEXT NOT NULL DEFAULT 'standard'
  CHECK(service_class IN ('standard','vip'));
ALTER TABLE taxipress_departures ADD COLUMN service_class TEXT NOT NULL DEFAULT 'standard'
  CHECK(service_class IN ('standard','vip'));
