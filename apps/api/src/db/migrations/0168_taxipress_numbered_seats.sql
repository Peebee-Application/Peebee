-- Numbering is snapshotted only for departures joining after staff enable it.
-- Existing departures/bookings are untouched. All claims are protected by a
-- unique physical seat key and transactional validation, including old clients.
ALTER TABLE taxipress_taxis ADD COLUMN numbered_seats_enabled INTEGER NOT NULL DEFAULT 0 CHECK (numbered_seats_enabled IN (0,1));
CREATE TABLE taxipress_seat_maps (
  queue_id TEXT PRIMARY KEY REFERENCES taxipress_queue(id),
  layout TEXT NOT NULL CHECK (layout IN ('14','18')),
  labels TEXT NOT NULL CHECK (json_valid(labels))
);
CREATE TABLE taxipress_seat_reservations (
  id TEXT PRIMARY KEY,
  queue_id TEXT NOT NULL REFERENCES taxipress_queue(id),
  passenger_id TEXT NOT NULL REFERENCES users(id),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 18),
  chosen INTEGER NOT NULL DEFAULT 0 CHECK (chosen IN (0,1)),
  fee INTEGER NOT NULL DEFAULT 0 CHECK (fee >= 0),
  state TEXT NOT NULL CHECK (state IN ('draft','held','reserved','booked','released')),
  expires_at TEXT NOT NULL,
  booking_id TEXT UNIQUE REFERENCES taxipress_bookings(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_taxipress_seat_holds ON taxipress_seat_reservations(queue_id,state,expires_at);
CREATE UNIQUE INDEX idx_taxipress_one_seat_hold ON taxipress_seat_reservations(passenger_id) WHERE state = 'held';
CREATE TABLE taxipress_seat_claims (
  queue_id TEXT NOT NULL REFERENCES taxipress_queue(id),
  seat TEXT NOT NULL,
  reservation_id TEXT REFERENCES taxipress_seat_reservations(id) ON DELETE CASCADE,
  walk_up INTEGER NOT NULL DEFAULT 0 CHECK (walk_up IN (0,1)),
  CHECK ((reservation_id IS NULL AND walk_up = 1) OR (reservation_id IS NOT NULL AND walk_up = 0)),
  PRIMARY KEY(queue_id,seat)
);
ALTER TABLE taxipress_bookings ADD COLUMN seat_reservation_id TEXT REFERENCES taxipress_seat_reservations(id);

-- A hold is usable only when the complete requested set was claimed and there
-- is aggregate capacity. A failure rolls the entire D1/libSQL batch back.
CREATE TRIGGER taxipress_hold_validate BEFORE UPDATE OF state ON taxipress_seat_reservations
WHEN NEW.state = 'held' AND OLD.state = 'draft'
BEGIN
  SELECT CASE WHEN (SELECT COUNT(*) FROM taxipress_seat_claims WHERE reservation_id = NEW.id) <> NEW.quantity
    THEN RAISE(ABORT,'taxipress_seat_conflict') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM taxipress_queue q WHERE q.id = NEW.queue_id AND q.status = 'in_line'
    AND q.seats_booked + q.walk_up_seats + NEW.quantity + COALESCE((SELECT SUM(r.quantity) FROM taxipress_seat_reservations r
      WHERE r.queue_id = q.id AND r.state = 'held' AND r.expires_at > datetime('now')),0) <= q.seats_total)
    THEN RAISE(ABORT,'taxipress_seat_conflict') END;
END;

CREATE TRIGGER taxipress_legacy_booking_seats_move AFTER UPDATE OF queue_id ON taxipress_bookings
WHEN NEW.queue_id <> OLD.queue_id AND NEW.seat_reservation_id IS NULL
 AND EXISTS (SELECT 1 FROM taxipress_seat_maps WHERE queue_id = NEW.queue_id)
BEGIN
  INSERT INTO taxipress_seat_reservations(id,queue_id,passenger_id,quantity,state,expires_at,booking_id)
    VALUES ('tpm-' || NEW.id,NEW.queue_id,NEW.passenger_id,NEW.seats,'booked',datetime('now'),NEW.id);
  INSERT INTO taxipress_seat_claims(queue_id,seat,reservation_id)
    SELECT NEW.queue_id,j.value,'tpm-' || NEW.id FROM taxipress_seat_maps m,json_each(m.labels) j
    WHERE m.queue_id = NEW.queue_id AND NOT EXISTS (SELECT 1 FROM taxipress_seat_claims c WHERE c.queue_id = NEW.queue_id AND c.seat = j.value)
    ORDER BY CAST(j.key AS INTEGER) LIMIT NEW.seats;
  SELECT CASE WHEN (SELECT COUNT(*) FROM taxipress_seat_claims WHERE reservation_id = 'tpm-' || NEW.id) <> NEW.seats
    THEN RAISE(ABORT,'taxipress_seat_conflict') END;
  UPDATE taxipress_bookings SET seat_reservation_id = 'tpm-' || NEW.id WHERE id = NEW.id;
END;

CREATE TRIGGER taxipress_queue_hold_release AFTER UPDATE OF status ON taxipress_queue
WHEN NEW.status <> 'in_line'
BEGIN
  SELECT CASE WHEN NEW.status = 'on_road' AND EXISTS (SELECT 1 FROM taxipress_seat_reservations
    WHERE queue_id = NEW.id AND state = 'reserved' AND booking_id IS NULL)
    THEN RAISE(ABORT,'taxipress_booking_in_progress') END;
  DELETE FROM taxipress_seat_reservations WHERE queue_id = NEW.id AND state = 'held';
  DELETE FROM taxipress_seat_reservations WHERE queue_id = NEW.id AND state = 'reserved' AND booking_id IS NULL AND NEW.status = 'cancelled';
END;

-- Convert a hold to booking capacity atomically, without counting it twice.
CREATE TRIGGER taxipress_hold_reserve BEFORE UPDATE OF state ON taxipress_seat_reservations
WHEN NEW.state = 'reserved' AND OLD.state = 'held'
BEGIN
  SELECT CASE WHEN OLD.expires_at <= datetime('now') THEN RAISE(ABORT,'taxipress_hold_expired') END;
  UPDATE taxipress_queue SET seats_booked = seats_booked + NEW.quantity, updated_at = datetime('now')
    WHERE id = NEW.queue_id AND status = 'in_line'
      AND seats_booked + walk_up_seats + NEW.quantity + COALESCE((SELECT SUM(r.quantity)
        FROM taxipress_seat_reservations r WHERE r.queue_id = NEW.queue_id AND r.id <> NEW.id
        AND r.state = 'held' AND r.expires_at > datetime('now')),0) <= seats_total;
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT,'taxipress_seat_conflict') END;
END;

-- A failed/crashed order creation returns its reserved aggregate capacity.
CREATE TRIGGER taxipress_reservation_delete AFTER DELETE ON taxipress_seat_reservations
BEGIN
  DELETE FROM taxipress_seat_claims WHERE reservation_id = OLD.id;
  UPDATE taxipress_queue SET seats_booked = MAX(0,seats_booked - OLD.quantity), updated_at = datetime('now')
    WHERE id = OLD.queue_id AND OLD.state = 'reserved' AND OLD.booking_id IS NULL;
END;

CREATE TRIGGER taxipress_booking_seats AFTER INSERT ON taxipress_bookings
WHEN EXISTS (SELECT 1 FROM taxipress_seat_maps WHERE queue_id = NEW.queue_id)
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM taxipress_seat_reservations r WHERE r.id = NEW.seat_reservation_id
    AND r.queue_id = NEW.queue_id AND r.passenger_id = NEW.passenger_id AND r.quantity = NEW.seats
    AND r.state = 'reserved' AND r.expires_at > datetime('now') AND r.booking_id IS NULL)
    THEN RAISE(ABORT,'taxipress_hold_invalid') END;
  UPDATE taxipress_seat_reservations SET state = 'booked', booking_id = NEW.id WHERE id = NEW.seat_reservation_id;
END;

-- Cancellation/no-show paths already own aggregate counters and money. These
-- triggers release only the numbered claims, in the same booking write.
CREATE TRIGGER taxipress_booking_seats_release AFTER UPDATE OF status ON taxipress_bookings
WHEN NEW.status IN ('cancelled','no_show')
BEGIN
  DELETE FROM taxipress_seat_claims WHERE reservation_id = NEW.seat_reservation_id;
  UPDATE taxipress_seat_reservations SET state = 'released' WHERE id = NEW.seat_reservation_id;
END;

-- Drivers' existing +/- walk-up controls claim actual free seats. Holds and app
-- tickets cannot be displaced by a stage sale. A conflict rolls back the count.
CREATE TRIGGER taxipress_walk_up_seats AFTER UPDATE OF walk_up_seats ON taxipress_queue
WHEN EXISTS (SELECT 1 FROM taxipress_seat_maps WHERE queue_id = NEW.id)
BEGIN
  DELETE FROM taxipress_seat_claims WHERE queue_id = NEW.id AND walk_up = 1 AND seat IN
    (SELECT seat FROM taxipress_seat_claims WHERE queue_id = NEW.id AND walk_up = 1 ORDER BY seat DESC LIMIT MAX(0,OLD.walk_up_seats - NEW.walk_up_seats));
  INSERT INTO taxipress_seat_claims(queue_id,seat,walk_up)
    SELECT NEW.id, j.value, 1 FROM taxipress_seat_maps m, json_each(m.labels) j
    WHERE m.queue_id = NEW.id AND NOT EXISTS (SELECT 1 FROM taxipress_seat_claims c WHERE c.queue_id = NEW.id AND c.seat = j.value)
    ORDER BY CAST(j.key AS INTEGER) LIMIT MAX(0,NEW.walk_up_seats - OLD.walk_up_seats);
  SELECT CASE WHEN (SELECT COUNT(*) FROM taxipress_seat_claims WHERE queue_id = NEW.id AND walk_up = 1) <> NEW.walk_up_seats
    THEN RAISE(ABORT,'taxipress_seat_conflict') END;
END;

-- Reassignment keeps numbered labels. If the target cannot honour the set, the
-- move fails and the existing cancellation flow can choose another taxi/refund.
CREATE TRIGGER taxipress_booking_seats_move AFTER UPDATE OF queue_id ON taxipress_bookings
WHEN NEW.queue_id <> OLD.queue_id AND NEW.seat_reservation_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM taxipress_seat_maps WHERE queue_id = NEW.queue_id)
    AND EXISTS (SELECT 1 FROM taxipress_seat_reservations WHERE id = NEW.seat_reservation_id AND chosen = 1)
    THEN RAISE(ABORT,'taxipress_seat_conflict') END;
  INSERT INTO taxipress_seat_claims(queue_id,seat,reservation_id)
    SELECT NEW.queue_id,j.value,NEW.seat_reservation_id FROM taxipress_seat_maps m,json_each(m.labels) j
    WHERE m.queue_id = NEW.queue_id AND NOT EXISTS (SELECT 1 FROM taxipress_seat_claims c WHERE c.queue_id = NEW.queue_id AND c.seat = j.value)
    AND ((SELECT chosen FROM taxipress_seat_reservations WHERE id = NEW.seat_reservation_id) = 0
      OR j.value IN (SELECT seat FROM taxipress_seat_claims WHERE reservation_id = NEW.seat_reservation_id AND queue_id = OLD.queue_id))
    ORDER BY CAST(j.key AS INTEGER) LIMIT NEW.seats;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM taxipress_seat_maps WHERE queue_id = NEW.queue_id)
    AND (SELECT COUNT(*) FROM taxipress_seat_claims WHERE reservation_id = NEW.seat_reservation_id AND queue_id = NEW.queue_id) <> NEW.seats
    THEN RAISE(ABORT,'taxipress_seat_conflict') END;
  DELETE FROM taxipress_seat_claims WHERE reservation_id = NEW.seat_reservation_id AND queue_id = OLD.queue_id;
  UPDATE taxipress_seat_reservations SET queue_id = NEW.queue_id WHERE id = NEW.seat_reservation_id;
END;
