-- Published future services are separate from the physical stage queue.
CREATE TABLE taxipress_departures (
 id TEXT PRIMARY KEY, taxipress_route_id TEXT NOT NULL REFERENCES taxipress_routes(id),
 taxi_id TEXT NOT NULL REFERENCES taxipress_taxis(id), environment TEXT NOT NULL CHECK(environment IN ('live','sandbox')),
 departs_at TEXT NOT NULL, capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 18),
 fare_per_seat INTEGER NOT NULL CHECK(fare_per_seat>0), seats_reserved INTEGER NOT NULL DEFAULT 0 CHECK(seats_reserved BETWEEN 0 AND capacity),
 state TEXT NOT NULL DEFAULT 'published' CHECK(state IN ('published','active','cancelled','completed')),
 queue_id TEXT UNIQUE REFERENCES taxipress_queue(id),
 cutoff_minutes INTEGER NOT NULL, checkin_minutes INTEGER NOT NULL, grace_minutes INTEGER NOT NULL,
 spacing_minutes INTEGER NOT NULL, free_cancel_minutes INTEGER NOT NULL, retention_percent REAL NOT NULL CHECK(retention_percent BETWEEN 0 AND 100),
 fee_to TEXT NOT NULL CHECK(fee_to IN ('platform','driver')),
 created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX idx_taxipress_departures_date ON taxipress_departures(environment,state,departs_at);
CREATE UNIQUE INDEX idx_taxipress_departures_slot ON taxipress_departures(environment,taxi_id,departs_at) WHERE state IN ('published','active');
CREATE TRIGGER taxipress_departure_spacing BEFORE INSERT ON taxipress_departures BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM taxipress_departures d WHERE d.taxi_id=NEW.taxi_id AND d.environment=NEW.environment AND d.state IN ('published','active')
  AND ABS(julianday(d.departs_at)-julianday(NEW.departs_at))*1440<MAX(d.spacing_minutes,NEW.spacing_minutes))
  THEN RAISE(ABORT,'taxipress_schedule_overlap') END;
END;
CREATE TABLE taxipress_future_tickets (
 id TEXT PRIMARY KEY, departure_id TEXT NOT NULL REFERENCES taxipress_departures(id),
 passenger_id TEXT NOT NULL REFERENCES users(id), environment TEXT NOT NULL CHECK(environment IN ('live','sandbox')),
 order_id TEXT NOT NULL UNIQUE REFERENCES orders(id), seats INTEGER NOT NULL CHECK(seats BETWEEN 1 AND 18), fare_per_seat INTEGER NOT NULL CHECK(fare_per_seat>=0),
 amount INTEGER NOT NULL CHECK(amount>0), details_json TEXT NOT NULL CHECK(json_valid(details_json)),
 pay_by TEXT NOT NULL, ticket_code TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','converted','cancelled')),
 booking_id TEXT UNIQUE REFERENCES taxipress_bookings(id), cancel_fee INTEGER NOT NULL DEFAULT 0 CHECK(cancel_fee>=0),
 settle_nonce INTEGER NOT NULL DEFAULT 0,
 cancel_reason TEXT, request_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT(datetime('now')),
 UNIQUE(passenger_id,environment,request_id)
);
CREATE TRIGGER taxipress_departure_arrived AFTER UPDATE OF status ON taxipress_queue
WHEN NEW.status='arrived' BEGIN
 UPDATE taxipress_departures SET state='completed' WHERE queue_id=NEW.id AND state='active';
END;
CREATE TRIGGER taxipress_departure_queue_cancelled AFTER UPDATE OF status ON taxipress_queue
WHEN NEW.status='cancelled' BEGIN
 UPDATE taxipress_departures SET state='cancelled' WHERE queue_id=NEW.id AND state='active';
END;
CREATE INDEX idx_taxipress_future_customer ON taxipress_future_tickets(passenger_id,environment,created_at);
CREATE TRIGGER taxipress_future_capacity BEFORE INSERT ON taxipress_future_tickets BEGIN
 UPDATE taxipress_departures SET seats_reserved=seats_reserved+NEW.seats WHERE id=NEW.departure_id AND environment=NEW.environment AND state='published'
  AND datetime(departs_at,'-'||cutoff_minutes||' minutes')>datetime('now') AND seats_reserved+NEW.seats<=capacity;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'taxipress_future_capacity') END;
END;
ALTER TABLE taxipress_bookings ADD COLUMN future_ticket_id TEXT REFERENCES taxipress_future_tickets(id);
CREATE UNIQUE INDEX idx_taxipress_future_booking ON taxipress_bookings(future_ticket_id) WHERE future_ticket_id IS NOT NULL;
CREATE TRIGGER taxipress_future_link AFTER INSERT ON taxipress_bookings WHEN NEW.future_ticket_id IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM taxipress_future_tickets t JOIN taxipress_departures d ON d.id=t.departure_id
  WHERE t.id=NEW.future_ticket_id AND t.state='reserved' AND t.passenger_id=NEW.passenger_id AND t.environment=NEW.environment
   AND t.order_id=NEW.order_id AND t.amount=NEW.amount AND t.seats=NEW.seats AND d.queue_id=NEW.queue_id AND d.state='active')
  THEN RAISE(ABORT,'taxipress_future_claim') END;
 UPDATE taxipress_future_tickets SET state='converted',booking_id=NEW.id WHERE id=NEW.future_ticket_id;
END;
-- Future orders never enter matching or look like a trip already underway.
CREATE TRIGGER taxipress_future_order_wait AFTER UPDATE OF stage ON orders
WHEN EXISTS(SELECT 1 FROM taxipress_future_tickets t JOIN taxipress_departures d ON d.id=t.departure_id WHERE t.order_id=NEW.id
 AND ((t.state='reserved' AND d.queue_id IS NULL AND NEW.stage NOT IN ('Scheduled','Match','Fund','Shop','Cancelled'))
  OR (t.state='cancelled' AND NEW.stage!='Cancelled')))
BEGIN
 UPDATE orders SET stage=CASE WHEN EXISTS(SELECT 1 FROM taxipress_future_tickets WHERE order_id=NEW.id AND state='cancelled') THEN 'Cancelled' ELSE 'Scheduled' END WHERE id=NEW.id;
END;
CREATE TRIGGER taxipress_future_cancel AFTER UPDATE OF state ON taxipress_future_tickets
WHEN OLD.state='reserved' AND NEW.state='cancelled' BEGIN
 UPDATE taxipress_departures SET seats_reserved=MAX(0,seats_reserved-NEW.seats) WHERE id=NEW.departure_id;
 UPDATE orders SET stage='Cancelled',updated_at=datetime('now') WHERE id=NEW.order_id;
END;
-- Refunds and any cancellation fee are recorded by the existing order and wallet
-- services. A successful cancellation consumes schedule capacity exactly once.
CREATE TRIGGER taxipress_future_customer_cancel AFTER UPDATE OF stage ON orders
WHEN NEW.stage='Cancelled' AND OLD.stage!='Cancelled' BEGIN
 UPDATE taxipress_future_tickets SET state='cancelled',cancel_reason=COALESCE(cancel_reason,'order_cancelled')
  WHERE order_id=NEW.id AND state='reserved';
END;
