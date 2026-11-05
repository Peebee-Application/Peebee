-- Proof that a saved mobile money number belongs to the person who saved it.
-- A code is sent by SMS to the number itself; entering it marks the number verified. Changing a number's digits clears
-- the proof (the API does that). Whether a withdrawal REQUIRES a verified number is an Admin setting
-- (withdrawal_numbers_require_verification, off by default), so applying this migration changes nothing by itself.

ALTER TABLE saved_mobile_numbers ADD COLUMN verified_at TEXT;

CREATE TABLE IF NOT EXISTS number_verification_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  number_id TEXT NOT NULL REFERENCES saved_mobile_numbers(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_number_verification_codes_number ON number_verification_codes (number_id, created_at);
CREATE INDEX IF NOT EXISTS idx_number_verification_codes_user ON number_verification_codes (user_id, created_at);
