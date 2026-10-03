-- Photos of a vehicle, submitted by its owner (stored privately in R2; the
-- rows only hold the object key). New table only: the car endpoints work
-- without it (no photos can be added) until this is applied.
CREATE TABLE IF NOT EXISTS vehicle_photos (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  object_key TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vehicle_photos_vehicle ON vehicle_photos(vehicle_id, sort);
