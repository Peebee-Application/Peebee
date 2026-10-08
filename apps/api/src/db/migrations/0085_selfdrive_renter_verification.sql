-- Private renter KYC for Self-drive and service-history date for vehicle profiles.
ALTER TABLE vehicles ADD COLUMN last_service_date TEXT;

CREATE TABLE IF NOT EXISTS selfdrive_renter_kyc (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  nin TEXT NOT NULL,
  residential_address TEXT NOT NULL,
  national_id_key TEXT NOT NULL,
  residence_method TEXT NOT NULL CHECK (residence_method IN ('rent_and_landlord_letter', 'bill')),
  rent_receipt_key TEXT,
  landlord_letter_key TEXT,
  residence_bill_key TEXT,
  tenancy_start TEXT,
  tenancy_end TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_notes TEXT,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_selfdrive_renter_kyc_status ON selfdrive_renter_kyc(status, updated_at);
