-- Stable identifiers for people and businesses. These are display/reference
-- codes only; authentication and payment authorization still use internal IDs.
ALTER TABLE users ADD COLUMN account_code TEXT;
ALTER TABLE riders ADD COLUMN rider_code TEXT;
ALTER TABLE merchants ADD COLUMN merchant_code TEXT;

UPDATE users
SET account_code = 'PB-' || upper(substr(replace(id, '-', ''), -16))
WHERE account_code IS NULL OR account_code = '';

UPDATE riders
SET rider_code = 'RDR-' || upper(substr(replace(user_id, '-', ''), -16))
WHERE rider_code IS NULL OR rider_code = '';

UPDATE merchants
SET merchant_code = 'MER-' || upper(substr(replace(id, '-', ''), -16))
WHERE merchant_code IS NULL OR merchant_code = '';

CREATE UNIQUE INDEX idx_users_account_code ON users(account_code);
CREATE UNIQUE INDEX idx_riders_rider_code ON riders(rider_code);
CREATE UNIQUE INDEX idx_merchants_merchant_code ON merchants(merchant_code);
