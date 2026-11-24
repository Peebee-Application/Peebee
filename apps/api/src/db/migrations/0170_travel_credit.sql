-- Approved corporate receivables and wallet-backed, named travel vouchers.
-- No accounts, limits, grants, money or service switches are created here.
CREATE TABLE travel_accounts (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id),
 environment TEXT NOT NULL CHECK(environment IN ('live','sandbox')),
 active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
 credit_limit INTEGER NOT NULL DEFAULT 0 CHECK(credit_limit >= 0), outstanding INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT(datetime('now')), CHECK(outstanding <= credit_limit)
);
CREATE TABLE travel_members (
 account_id TEXT NOT NULL REFERENCES travel_accounts(id), user_id TEXT NOT NULL REFERENCES users(id),
 active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
 per_booking INTEGER NOT NULL DEFAULT 0 CHECK(per_booking >= 0), monthly_limit INTEGER NOT NULL DEFAULT 0 CHECK(monthly_limit >= 0),
 PRIMARY KEY(account_id,user_id)
);
CREATE TABLE travel_vouchers (
 id TEXT PRIMARY KEY, issuer_id TEXT NOT NULL REFERENCES users(id), recipient_id TEXT NOT NULL REFERENCES users(id),
 environment TEXT NOT NULL CHECK(environment IN ('live','sandbox')), code_hash TEXT NOT NULL UNIQUE,
 amount INTEGER NOT NULL CHECK(amount > 0), balance INTEGER NOT NULL CHECK(balance >= 0),
 state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','cancelled','expired')),
 expires_at TEXT NOT NULL, request_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT(datetime('now')),
 UNIQUE(issuer_id,environment,request_id), CHECK(balance <= amount)
);
CREATE TABLE travel_charges (
 order_id TEXT PRIMARY KEY REFERENCES orders(id), payment_id TEXT NOT NULL UNIQUE REFERENCES payments(id),
 customer_id TEXT NOT NULL REFERENCES users(id), environment TEXT NOT NULL CHECK(environment IN ('live','sandbox')),
 account_id TEXT REFERENCES travel_accounts(id), voucher_id TEXT REFERENCES travel_vouchers(id),
 total INTEGER NOT NULL CHECK(total > 0), group_total INTEGER NOT NULL CHECK(group_total >= total), sponsored INTEGER NOT NULL CHECK(sponsored >= 0),
 wallet_amount INTEGER NOT NULL CHECK(wallet_amount >= 0), refunded INTEGER NOT NULL DEFAULT 0,
 sponsor_refunded INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT(datetime('now')),
 CHECK((account_id IS NULL) <> (voucher_id IS NULL)), CHECK(sponsored + wallet_amount = total),
 CHECK(refunded BETWEEN 0 AND total), CHECK(sponsor_refunded BETWEEN 0 AND sponsored)
);
CREATE INDEX idx_travel_charges_member ON travel_charges(account_id,customer_id,created_at);
CREATE TABLE travel_ledger (
 id TEXT PRIMARY KEY, account_id TEXT REFERENCES travel_accounts(id), voucher_id TEXT REFERENCES travel_vouchers(id),
 actor_id TEXT NOT NULL REFERENCES users(id), environment TEXT NOT NULL CHECK(environment IN ('live','sandbox')),
 kind TEXT NOT NULL, amount INTEGER NOT NULL, order_id TEXT REFERENCES orders(id),
 reference TEXT, created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE UNIQUE INDEX idx_travel_repayment_request ON travel_ledger(account_id,reference) WHERE kind = 'repayment';

-- The membership and both credit limits are checked again inside the transaction.
CREATE TRIGGER travel_charge_debit BEFORE INSERT ON travel_charges BEGIN
 SELECT CASE WHEN NEW.account_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM travel_accounts a JOIN travel_members m ON m.account_id=a.id
  WHERE a.id=NEW.account_id AND a.active=1 AND a.environment=NEW.environment
   AND m.user_id=NEW.customer_id AND m.active=1 AND NEW.group_total <= m.per_booking
   AND a.outstanding + NEW.total <= a.credit_limit AND NEW.wallet_amount=0
   AND NEW.total + (SELECT COALESCE(SUM(total-refunded),0) FROM travel_charges
    WHERE account_id=a.id AND customer_id=NEW.customer_id AND created_at>=datetime('now','+3 hours','start of month','-3 hours')) <= m.monthly_limit
 ) THEN RAISE(ABORT,'travel_credit_limit') END;
 UPDATE travel_accounts SET outstanding=outstanding+NEW.sponsored WHERE id=NEW.account_id;
 SELECT CASE WHEN NEW.voucher_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM travel_vouchers WHERE id=NEW.voucher_id AND recipient_id=NEW.customer_id
   AND environment=NEW.environment AND state='active' AND expires_at>datetime('now') AND balance>=NEW.sponsored
 ) THEN RAISE(ABORT,'travel_voucher_unavailable') END;
 UPDATE travel_vouchers SET balance=balance-NEW.sponsored WHERE id=NEW.voucher_id;
 SELECT CASE WHEN NEW.wallet_amount>0 AND NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.customer_id
  AND primary_wallet_frozen_at IS NULL AND CASE WHEN NEW.environment='sandbox' THEN wallet_balance_sandbox ELSE wallet_balance END>=NEW.wallet_amount)
  THEN RAISE(ABORT,'travel_wallet_unavailable') END;
 UPDATE users SET wallet_balance=wallet_balance-CASE WHEN NEW.environment='live' THEN NEW.wallet_amount ELSE 0 END,
  wallet_balance_sandbox=wallet_balance_sandbox-CASE WHEN NEW.environment='sandbox' THEN NEW.wallet_amount ELSE 0 END WHERE id=NEW.customer_id;
END;
CREATE TRIGGER travel_charge_ledger AFTER INSERT ON travel_charges BEGIN
 INSERT INTO travel_ledger(id,account_id,voucher_id,actor_id,environment,kind,amount,order_id)
  VALUES('tl_'||NEW.payment_id,NEW.account_id,NEW.voucher_id,NEW.customer_id,NEW.environment,'charge',NEW.sponsored,NEW.order_id);
 INSERT INTO wallet_ledger(id,user_id,type,amount,balance_after,order_id,note,environment)
  SELECT 'wl_'||NEW.payment_id,NEW.customer_id,'order_payment',-NEW.wallet_amount,
   CASE WHEN NEW.environment='sandbox' THEN wallet_balance_sandbox ELSE wallet_balance END,NEW.order_id,'Travel voucher balance payment',NEW.environment
  FROM users WHERE id=NEW.customer_id AND NEW.wallet_amount>0;
END;

-- Refund each source proportionally, using cumulative rounding. Never turn
-- a company's credit or a named voucher into the traveller's withdrawable cash.
CREATE TRIGGER travel_payment_refund AFTER INSERT ON payments
WHEN NEW.type='refund' AND NEW.status='successful' AND EXISTS(SELECT 1 FROM travel_charges WHERE order_id=NEW.order_id)
BEGIN
 SELECT CASE WHEN NEW.amount>(SELECT total-refunded FROM travel_charges WHERE order_id=NEW.order_id)
  THEN RAISE(ABORT,'travel_refund_exceeds_collection') END;
 UPDATE travel_accounts SET outstanding=outstanding-(SELECT CAST((refunded+NEW.amount)*sponsored/total AS INTEGER)-sponsor_refunded FROM travel_charges WHERE order_id=NEW.order_id)
  WHERE id=(SELECT account_id FROM travel_charges WHERE order_id=NEW.order_id);
 UPDATE travel_vouchers SET balance=balance+(SELECT CAST((refunded+NEW.amount)*sponsored/total AS INTEGER)-sponsor_refunded FROM travel_charges WHERE order_id=NEW.order_id)
  WHERE id=(SELECT voucher_id FROM travel_charges WHERE order_id=NEW.order_id);
 UPDATE users SET wallet_balance=wallet_balance+CASE WHEN (SELECT environment FROM travel_charges WHERE order_id=NEW.order_id)='live'
  THEN NEW.amount-(SELECT CAST((refunded+NEW.amount)*sponsored/total AS INTEGER)-sponsor_refunded FROM travel_charges WHERE order_id=NEW.order_id) ELSE 0 END,
  wallet_balance_sandbox=wallet_balance_sandbox+CASE WHEN (SELECT environment FROM travel_charges WHERE order_id=NEW.order_id)='sandbox'
  THEN NEW.amount-(SELECT CAST((refunded+NEW.amount)*sponsored/total AS INTEGER)-sponsor_refunded FROM travel_charges WHERE order_id=NEW.order_id) ELSE 0 END
  WHERE id=(SELECT customer_id FROM travel_charges WHERE order_id=NEW.order_id);
 INSERT INTO wallet_ledger(id,user_id,type,amount,balance_after,order_id,note,environment)
  SELECT 'wl_'||NEW.id,c.customer_id,'refund',NEW.amount-(CAST((c.refunded+NEW.amount)*c.sponsored/c.total AS INTEGER)-c.sponsor_refunded),
   CASE WHEN c.environment='sandbox' THEN u.wallet_balance_sandbox ELSE u.wallet_balance END,c.order_id,'Travel payment wallet portion refunded',c.environment
  FROM travel_charges c JOIN users u ON u.id=c.customer_id WHERE c.order_id=NEW.order_id
   AND NEW.amount-(CAST((c.refunded+NEW.amount)*c.sponsored/c.total AS INTEGER)-c.sponsor_refunded)>0;
 INSERT INTO travel_ledger(id,account_id,voucher_id,actor_id,environment,kind,amount,order_id)
  SELECT 'tl_'||NEW.id,account_id,voucher_id,customer_id,environment,'refund',-(CAST((refunded+NEW.amount)*sponsored/total AS INTEGER)-sponsor_refunded),order_id
  FROM travel_charges WHERE order_id=NEW.order_id;
 UPDATE travel_charges SET sponsor_refunded=CAST((refunded+NEW.amount)*sponsored/total AS INTEGER),refunded=refunded+NEW.amount WHERE order_id=NEW.order_id;
END;

-- Unspent prepaid funds return only to their issuer, including any later
-- booking refund restored onto an already expired/cancelled voucher.
CREATE TRIGGER travel_voucher_close AFTER UPDATE OF balance,state ON travel_vouchers
WHEN NEW.balance>0 AND (NEW.state!='active' OR NEW.expires_at<=datetime('now')) BEGIN
 UPDATE travel_vouchers SET balance=0,state=CASE WHEN state='active' THEN 'expired' ELSE state END WHERE id=NEW.id;
 UPDATE users SET wallet_balance=wallet_balance+CASE WHEN NEW.environment='live' THEN NEW.balance ELSE 0 END,
  wallet_balance_sandbox=wallet_balance_sandbox+CASE WHEN NEW.environment='sandbox' THEN NEW.balance ELSE 0 END WHERE id=NEW.issuer_id;
 INSERT INTO wallet_ledger(id,user_id,type,amount,balance_after,note,environment)
  SELECT 'wl_'||lower(hex(randomblob(16))),id,'refund',NEW.balance,
   CASE WHEN NEW.environment='sandbox' THEN wallet_balance_sandbox ELSE wallet_balance END,'Unused travel voucher returned to issuer',NEW.environment FROM users WHERE id=NEW.issuer_id;
 INSERT INTO travel_ledger(id,voucher_id,actor_id,environment,kind,amount)
  VALUES('tl_'||lower(hex(randomblob(16))),NEW.id,NEW.issuer_id,NEW.environment,'voucher_close',-NEW.balance);
END;

-- Sponsored refunds are handled by travel_payment_refund, including wallet remainders.
DROP TRIGGER taxipress_return_refund;
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
    WHERE id = NEW.passenger_id AND NOT EXISTS (SELECT 1 FROM travel_charges WHERE order_id = NEW.return_order_id);
  INSERT INTO wallet_ledger(id,user_id,type,amount,balance_after,order_id,note,environment)
    SELECT 'wl_return_refund_' || p.id,p.passenger_id,'refund',p.refunded,
      CASE WHEN p.environment = 'sandbox' THEN u.wallet_balance_sandbox ELSE u.wallet_balance END,p.return_order_id,'Unused TaxiPress return refunded',p.environment
      FROM taxipress_return_packages p JOIN users u ON u.id = p.passenger_id WHERE p.id = NEW.id AND p.refunded > 0 AND NOT EXISTS (SELECT 1 FROM travel_charges WHERE order_id = NEW.return_order_id);
  UPDATE orders SET stage = 'Cancelled',updated_at = datetime('now') WHERE id = NEW.return_order_id;
END;

