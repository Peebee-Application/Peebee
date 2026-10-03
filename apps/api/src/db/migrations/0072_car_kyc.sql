-- Driver/owner identity documents (national ID, driving licence) and the
-- "I don't have a car" flag on a driver's application. The photos are stored
-- privately in R2; this table only holds their object keys. The column is
-- added to the (new) car_partners table; the code works without either until
-- this is applied (documents can't be uploaded, the flag isn't saved).
ALTER TABLE car_partners ADD COLUMN needs_vehicle INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS car_partner_documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('national_id', 'licence')),
  object_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_car_partner_documents_user ON car_partner_documents(user_id, kind, created_at);
