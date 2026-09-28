-- Reinstates the reference VSLA design's "shares" mechanic (standardized
-- contributions at a fixed price per share, set per cycle) and adds a
-- distinct "group admin" per stage — the person responsible for onboarding
-- fellow members, separate from the elected chairman/secretary/treasurer
-- roles. Whoever creates a stage becomes its group admin by default; the
-- role is transferable to any other active member.

ALTER TABLE stage_cycles ADD COLUMN share_price INTEGER NOT NULL DEFAULT 1000;

-- Nullable: existing contributions predate this column and have no share
-- count to backfill. New contributions always set it.
ALTER TABLE stage_contributions ADD COLUMN shares REAL;

ALTER TABLE stages ADD COLUMN group_admin_id TEXT REFERENCES users(id);
