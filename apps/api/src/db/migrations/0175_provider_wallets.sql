-- Provider earnings are held in a provider work wallet, separately from a
-- person's optional customer/personal wallet. Existing provider earnings that
-- were paid into users.wallet_balance are intentionally not reclassified here:
-- their remaining source cannot be inferred safely.

CREATE TABLE IF NOT EXISTS personal_wallets (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  activated_at TEXT NOT NULL DEFAULT (datetime('now')),
  activated_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Taxipress taxi operators earn into the same rider work-wallet balance.
INSERT OR IGNORE INTO riders (user_id, verified, is_online)
SELECT user_id, 0, 0 FROM taxipress_taxis;

-- Preserve current personal wallets for customer-only accounts. Accounts
-- already registered as a provider keep their work wallet and may opt into a
-- personal wallet separately; their existing users.wallet_balance is left
-- untouched until they choose to activate it.
INSERT OR IGNORE INTO personal_wallets (user_id, activated_by)
SELECT u.id, u.id FROM users u
 WHERE (u.role='customer'
   OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id=u.id AND ur.role='customer'))
AND NOT EXISTS (
  SELECT 1 FROM user_roles ur WHERE ur.user_id=u.id AND ur.role='rider'
)
AND NOT EXISTS (SELECT 1 FROM riders r WHERE r.user_id=u.id)
AND NOT EXISTS (
  SELECT 1 FROM merchant_members mm
  WHERE mm.user_id=u.id AND mm.role='owner'
)
AND NOT EXISTS (
  SELECT 1 FROM car_partners cp WHERE cp.user_id=u.id
)
AND NOT EXISTS (
  SELECT 1 FROM work_provider_members wm
  WHERE wm.user_id=u.id AND wm.role='owner'
)
AND NOT EXISTS (
  SELECT 1 FROM relay_operators ro WHERE ro.user_id=u.id
)
AND NOT EXISTS (SELECT 1 FROM channels ch WHERE ch.owner_id=u.id)
AND NOT EXISTS (SELECT 1 FROM edu_schools es WHERE es.owner_id=u.id)
AND NOT EXISTS (SELECT 1 FROM service_businesses sb WHERE sb.owner_id=u.id)
AND NOT EXISTS (SELECT 1 FROM talent_profiles tp WHERE tp.user_id=u.id)
AND NOT EXISTS (SELECT 1 FROM taxipress_taxis tt WHERE tt.user_id=u.id)
);

CREATE TABLE IF NOT EXISTS provider_wallets (
  provider_type TEXT NOT NULL CHECK (provider_type IN ('car', 'work', 'relay', 'education', 'service', 'talent')),
  provider_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('live', 'sandbox')),
  -- Car cash commissions can exceed the current payout balance; the debt is
  -- carried here and netted against future Car earnings, never the personal wallet.
  balance INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider_type, provider_id, environment)
);

INSERT OR IGNORE INTO provider_wallets (provider_type, provider_id, environment)
SELECT 'car', cp.user_id, environment
FROM car_partners cp
CROSS JOIN (SELECT 'live' AS environment UNION ALL SELECT 'sandbox');

INSERT OR IGNORE INTO provider_wallets (provider_type, provider_id, environment)
SELECT 'work', wp.id, environment
FROM work_providers wp
CROSS JOIN (SELECT 'live' AS environment UNION ALL SELECT 'sandbox');

-- Matatu operators use Peebee Car. Their parcel earnings are work funds, not
-- personal-wallet deposits, and their work wallet exists as soon as they apply.
INSERT OR IGNORE INTO provider_wallets (provider_type, provider_id, environment)
SELECT 'relay', ro.user_id, environment
FROM relay_operators ro
CROSS JOIN (SELECT 'live' AS environment UNION ALL SELECT 'sandbox');

INSERT OR IGNORE INTO provider_wallets (provider_type, provider_id, environment)
SELECT 'education', s.id, environment
FROM edu_schools s
CROSS JOIN (SELECT 'live' AS environment UNION ALL SELECT 'sandbox');

INSERT OR IGNORE INTO provider_wallets (provider_type, provider_id, environment)
SELECT 'service', b.id, environment
FROM service_businesses b
CROSS JOIN (SELECT 'live' AS environment UNION ALL SELECT 'sandbox');

INSERT OR IGNORE INTO provider_wallets (provider_type, provider_id, environment)
SELECT 'talent', p.user_id, environment
FROM talent_profiles p
CROSS JOIN (SELECT 'live' AS environment UNION ALL SELECT 'sandbox');

-- Keep work-wallet records automatic for provider profiles created after the
-- migration is applied. Their balances start at zero in each environment.
CREATE TRIGGER IF NOT EXISTS trg_provider_wallet_car_partner_insert
AFTER INSERT ON car_partners BEGIN
  INSERT OR IGNORE INTO provider_wallets (provider_type, provider_id, environment) VALUES ('car', NEW.user_id, 'live');
  INSERT OR IGNORE INTO provider_wallets (provider_type, provider_id, environment) VALUES ('car', NEW.user_id, 'sandbox');
END;

CREATE TRIGGER IF NOT EXISTS trg_provider_wallet_work_provider_insert
AFTER INSERT ON work_providers BEGIN
  INSERT OR IGNORE INTO provider_wallets (provider_type, provider_id, environment) VALUES ('work', NEW.id, 'live');
  INSERT OR IGNORE INTO provider_wallets (provider_type, provider_id, environment) VALUES ('work', NEW.id, 'sandbox');
END;

CREATE TRIGGER IF NOT EXISTS trg_provider_wallet_edu_school_insert
AFTER INSERT ON edu_schools BEGIN
  INSERT OR IGNORE INTO provider_wallets (provider_type, provider_id, environment) VALUES ('education', NEW.id, 'live');
  INSERT OR IGNORE INTO provider_wallets (provider_type, provider_id, environment) VALUES ('education', NEW.id, 'sandbox');
END;

CREATE TRIGGER IF NOT EXISTS trg_provider_wallet_service_business_insert
AFTER INSERT ON service_businesses BEGIN
  INSERT OR IGNORE INTO provider_wallets (provider_type, provider_id, environment) VALUES ('service', NEW.id, 'live');
  INSERT OR IGNORE INTO provider_wallets (provider_type, provider_id, environment) VALUES ('service', NEW.id, 'sandbox');
END;

CREATE TRIGGER IF NOT EXISTS trg_provider_wallet_talent_profile_insert
AFTER INSERT ON talent_profiles BEGIN
  INSERT OR IGNORE INTO provider_wallets (provider_type, provider_id, environment) VALUES ('talent', NEW.user_id, 'live');
  INSERT OR IGNORE INTO provider_wallets (provider_type, provider_id, environment) VALUES ('talent', NEW.user_id, 'sandbox');
END;


CREATE TABLE IF NOT EXISTS provider_wallet_ledger (
  id TEXT PRIMARY KEY,
  provider_type TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('live', 'sandbox')),
  kind TEXT NOT NULL CHECK (kind IN ('earning', 'withdrawal', 'withdrawal_return', 'transfer_out', 'adjustment')),
  amount INTEGER NOT NULL CHECK (amount <> 0),
  balance_after INTEGER NOT NULL,
  reference_type TEXT,
  reference_id TEXT,
  idempotency_key TEXT NOT NULL,
  actor_id TEXT REFERENCES users(id),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider_type, provider_id, environment, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_provider_wallet_ledger_owner
  ON provider_wallet_ledger(provider_type, provider_id, environment, created_at DESC);

-- Older withdrawal requests were taken from the shared legacy customer
-- balance. Mark the source on new car withdrawals so a later failed payout
-- is returned to the same wallet it came from.
ALTER TABLE car_withdrawals ADD COLUMN wallet_source TEXT NOT NULL DEFAULT 'legacy_personal'
  CHECK (wallet_source IN ('legacy_personal', 'provider_work'));

-- Preserve the source of service-provider funds so a refund after deployment
-- can return to the same wallet that received the original payout.
ALTER TABLE service_payments ADD COLUMN wallet_source TEXT NOT NULL DEFAULT 'legacy_personal'
  CHECK (wallet_source IN ('legacy_personal', 'provider_work'));

ALTER TABLE edu_creator_purchases ADD COLUMN wallet_source TEXT NOT NULL DEFAULT 'legacy_personal'
  CHECK (wallet_source IN ('legacy_personal', 'provider_work'));

ALTER TABLE store_digital_fulfillments ADD COLUMN payout_wallet_source TEXT NOT NULL DEFAULT 'legacy_personal'
  CHECK (payout_wallet_source IN ('legacy_personal', 'provider_work'));

CREATE TABLE IF NOT EXISTS provider_wallet_transfers (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  provider_type TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  environment TEXT NOT NULL CHECK (environment IN ('live', 'sandbox')),
  ledger_transaction_id TEXT NOT NULL REFERENCES ledger_transactions(id),
  wallet_ledger_id TEXT NOT NULL REFERENCES wallet_ledger(id),
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (actor_user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_provider_wallet_transfers_owner
  ON provider_wallet_transfers(provider_type, provider_id, created_at DESC);
