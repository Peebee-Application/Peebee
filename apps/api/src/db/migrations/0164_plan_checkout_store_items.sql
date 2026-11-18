-- Merchant plan checkout and the add-item wizard.
--
-- plan_checkouts: every plan change (upgrade, renewal, scheduled downgrade) goes through a checkout that is confirmed
-- with a six-digit SMS code sent to the store owner's phone (or the owner's PIN when SMS is unavailable), then paid (wallet, mobile money or card, or UGX 0 while
-- plans are free). The plan only changes after the code AND the payment succeed. Each row is the receipt: reference,
-- amount, credit for unused days, method and the subscription it created.
--   kind:    upgrade | renew | downgrade
--   method:  wallet | mobile_money | card | free
--   status:  awaiting_code | paying | active | scheduled | applied | failed | cancelled
--   verify_method: sms (a code texted to the owner) | pin (the owner's plan PIN, used when text messages are unavailable)
--   topup_id: the wallet top-up that collected a mobile money or card payment (the money lands in the owner's wallet and
--             is taken from there for the plan, so a payment that succeeds after a cancelled checkout is never lost).
CREATE TABLE IF NOT EXISTS plan_checkouts (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  store_id TEXT NOT NULL REFERENCES stores(id),
  merchant_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  from_plan TEXT NOT NULL,
  tier TEXT NOT NULL,
  billing_cycle TEXT NOT NULL DEFAULT 'monthly',
  list_price INTEGER NOT NULL DEFAULT 0,
  credit INTEGER NOT NULL DEFAULT 0,
  amount INTEGER NOT NULL DEFAULT 0,
  method TEXT NOT NULL,
  msisdn TEXT,
  status TEXT NOT NULL DEFAULT 'awaiting_code',
  verify_method TEXT NOT NULL DEFAULT 'sms',
  code_hash TEXT,
  code_phone TEXT,
  code_expires_at TEXT,
  code_attempts INTEGER NOT NULL DEFAULT 0,
  code_sent_at TEXT,
  codes_sent INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT,
  topup_id TEXT,
  subscription_id TEXT,
  starts_at TEXT,
  expires_at TEXT,
  failure TEXT,
  environment TEXT NOT NULL DEFAULT 'live',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_plan_checkouts_store ON plan_checkouts(store_id, created_at);
CREATE INDEX IF NOT EXISTS idx_plan_checkouts_due ON plan_checkouts(status, starts_at);
CREATE INDEX IF NOT EXISTS idx_plan_checkouts_topup ON plan_checkouts(topup_id);

-- The owner's plan PIN: the fallback confirmation when text messages are unavailable. Only a keyed hash is kept;
-- wrong guesses are counted and lock the PIN for a while.
CREATE TABLE IF NOT EXISTS owner_pins (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  pin_hash TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Add-item wizard: more than one photo, where the item is shown, and how it is delivered.
--   images_json:   JSON array of image URLs (the first is also kept in image_url, so older screens keep working)
--   show_in_app:   listed in Peebee Buy (customer app)
--   show_on_web:   listed on the store's own website
--   delivery_json: {"delivery":bool,"pickup":bool,"sameDay":bool,"readyInDays":int,"readyIn":"now|1h|same_day|2_days","size":"small|medium|large","returnsDays":int}
ALTER TABLE store_products ADD COLUMN images_json TEXT;
ALTER TABLE store_products ADD COLUMN show_in_app INTEGER NOT NULL DEFAULT 1;
ALTER TABLE store_products ADD COLUMN show_on_web INTEGER NOT NULL DEFAULT 1;
ALTER TABLE store_products ADD COLUMN delivery_json TEXT;

-- A picture for a service, shown on its card in Buy and in the Services module.
ALTER TABLE service_offerings ADD COLUMN image_url TEXT DEFAULT '';
