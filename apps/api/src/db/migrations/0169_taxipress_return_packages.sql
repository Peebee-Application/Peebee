-- One payment group, two independent settlement allocations. Existing tickets
-- are untouched. Feature remains off until explicitly enabled by staff.
CREATE TABLE taxipress_return_packages (
  id TEXT PRIMARY KEY,
  passenger_id TEXT NOT NULL REFERENCES users(id),
  environment TEXT NOT NULL CHECK(environment IN ('live','sandbox')),
  outbound_route_id TEXT NOT NULL REFERENCES taxipress_routes(id),
  return_route_id TEXT NOT NULL REFERENCES taxipress_routes(id),
  queue_id TEXT NOT NULL REFERENCES taxipress_queue(id),
  input_json TEXT NOT NULL CHECK(json_valid(input_json)),
  mode TEXT NOT NULL CHECK(mode IN ('open','same-day','date-specific')),
  return_date TEXT,
  valid_until TEXT NOT NULL,
  quote_until TEXT NOT NULL,
  outbound_amount INTEGER NOT NULL CHECK(outbound_amount > 0),
  return_amount INTEGER NOT NULL CHECK(return_amount > 0),
  discount_percent REAL NOT NULL CHECK(discount_percent BETWEEN 0 AND 100),
  refund_percent REAL NOT NULL CHECK(refund_percent BETWEEN 0 AND 100),
  state TEXT NOT NULL DEFAULT 'quoted' CHECK(state IN ('quoted','preparing','ready','failed')),
  return_state TEXT NOT NULL DEFAULT 'pending' CHECK(return_state IN ('pending','redeeming','redeemed','cancelled','expired')),
  outbound_booking_id TEXT UNIQUE REFERENCES taxipress_bookings(id),
  outbound_order_id TEXT UNIQUE REFERENCES orders(id),
  return_order_id TEXT UNIQUE REFERENCES orders(id),
  return_booking_id TEXT UNIQUE REFERENCES taxipress_bookings(id),
  redeem_token TEXT,
  redeem_until TEXT,
  refunded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX idx_taxipress_returns_customer ON taxipress_return_packages(passenger_id,created_at);
ALTER TABLE taxipress_bookings ADD COLUMN return_package_id TEXT REFERENCES taxipress_return_packages(id);
ALTER TABLE taxipress_bookings ADD COLUMN return_leg TEXT CHECK(return_leg IN ('outbound','return'));

-- An unredeemed entitlement is never an unassigned ride in matching queues.
CREATE TRIGGER taxipress_return_order_wait AFTER UPDATE OF stage ON orders
WHEN NEW.stage NOT IN ('Return','Fund','Cancelled') AND EXISTS
 (SELECT 1 FROM taxipress_return_packages p WHERE p.return_order_id = NEW.id AND p.return_state IN ('pending','redeeming'))
BEGIN
  UPDATE orders SET stage = 'Return' WHERE id = NEW.id;
END;

-- Publishing either booking reference and claiming an entitlement is part of
-- the booking insertion itself, including seat claims on numbered departures.
CREATE TRIGGER taxipress_return_booking_link AFTER INSERT ON taxipress_bookings
WHEN NEW.return_package_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM taxipress_return_packages p WHERE p.id = NEW.return_package_id
    AND p.passenger_id = NEW.passenger_id AND p.environment = NEW.environment
    AND ((NEW.return_leg = 'outbound' AND p.state = 'preparing' AND p.outbound_booking_id IS NULL
      AND NEW.taxipress_route_id = p.outbound_route_id AND NEW.amount = p.outbound_amount)
      OR (NEW.return_leg = 'return' AND p.state = 'ready' AND p.return_state = 'redeeming' AND p.redeem_until > datetime('now')
        AND p.valid_until > datetime('now') AND (p.return_date IS NULL OR p.return_date = date('now','+3 hours'))
        AND p.return_booking_id IS NULL AND NEW.order_id = p.return_order_id
        AND NEW.taxipress_route_id = p.return_route_id AND NEW.amount = p.return_amount)))
    THEN RAISE(ABORT,'taxipress_return_conflict') END;
  UPDATE taxipress_return_packages SET outbound_booking_id = NEW.id,outbound_order_id = NEW.order_id
    WHERE id = NEW.return_package_id AND NEW.return_leg = 'outbound';
  UPDATE taxipress_return_packages SET return_booking_id = NEW.id,return_state = 'redeemed'
    WHERE id = NEW.return_package_id AND NEW.return_leg = 'return';
END;

-- Refund an unused return allocation and its ledger in the same transaction.
-- Already redeemed journeys use the normal TaxiPress cancellation/settlement.
CREATE TRIGGER taxipress_return_refund AFTER UPDATE OF return_state ON taxipress_return_packages
WHEN OLD.return_state = 'pending' AND NEW.return_state IN ('cancelled','expired') AND NEW.return_order_id IS NOT NULL
BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM payments WHERE order_id = NEW.return_order_id AND type = 'collection' AND status IN ('pending','unknown'))
    THEN RAISE(ABORT,'taxipress_payment_pending') END;
  UPDATE taxipress_return_packages SET refunded = CAST(ROUND(MAX(0,
    (SELECT COALESCE(SUM(amount),0) FROM payments WHERE order_id = NEW.return_order_id AND type = 'collection' AND status = 'successful')
    - (SELECT COALESCE(SUM(amount),0) FROM payments WHERE order_id = NEW.return_order_id AND type = 'refund' AND status = 'successful')) * NEW.refund_percent / 100.0) AS INTEGER)
    WHERE id = NEW.id;
  INSERT INTO payments(id,order_id,type,provider,amount,currency,status)
    SELECT 'pay_return_refund_' || id,return_order_id,'refund','wallet',refunded,'UGX','successful'
    FROM taxipress_return_packages WHERE id = NEW.id AND refunded > 0;
  UPDATE users SET wallet_balance = wallet_balance + CASE WHEN NEW.environment = 'live' THEN (SELECT refunded FROM taxipress_return_packages WHERE id = NEW.id) ELSE 0 END,
    wallet_balance_sandbox = wallet_balance_sandbox + CASE WHEN NEW.environment = 'sandbox' THEN (SELECT refunded FROM taxipress_return_packages WHERE id = NEW.id) ELSE 0 END
    WHERE id = NEW.passenger_id;
  INSERT INTO wallet_ledger(id,user_id,type,amount,balance_after,order_id,note,environment)
    SELECT 'wl_return_refund_' || p.id,p.passenger_id,'refund',p.refunded,
      CASE WHEN p.environment = 'sandbox' THEN u.wallet_balance_sandbox ELSE u.wallet_balance END,p.return_order_id,'Unused TaxiPress return refunded',p.environment
      FROM taxipress_return_packages p JOIN users u ON u.id = p.passenger_id WHERE p.id = NEW.id AND p.refunded > 0;
  UPDATE orders SET stage = 'Cancelled',updated_at = datetime('now') WHERE id = NEW.return_order_id;
END;
