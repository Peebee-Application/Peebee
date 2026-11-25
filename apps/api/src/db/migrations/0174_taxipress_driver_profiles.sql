-- Driver-owned Taxipress van profiles and passenger capacity for the VIP layout.
-- Existing queue rows keep their seats_total snapshot; new departures use the corrected taxi capacity.
ALTER TABLE taxipress_taxis ADD COLUMN driver_bio TEXT NOT NULL DEFAULT '';
ALTER TABLE taxipress_taxis ADD COLUMN vehicle_features_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(vehicle_features_json));

-- The 14-place VIP layout has 13 passenger places plus the driver's position.
UPDATE taxipress_taxis SET seats = 13, updated_at = datetime('now') WHERE seat_layout = '14' AND seats > 13;

-- Tighten still-published future trips when existing bookings fit the corrected capacity.
UPDATE taxipress_departures SET capacity = 13 WHERE state = 'published' AND capacity > 13 AND seats_reserved <= 13
  AND taxi_id IN (SELECT id FROM taxipress_taxis WHERE seat_layout = '14');
