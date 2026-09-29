-- Stage approval workflow: a stage is now either proposed (pending admin
-- review) or approved (canonical, usable). Replaces the old
-- "admin_only" / "self_service" creation-mode setting with a single
-- review-gated flow — every stage a rider proposes goes through approval;
-- admin-originated stages are approved immediately.
ALTER TABLE stages ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved'
  CHECK (approval_status IN ('pending', 'approved', 'rejected'));
ALTER TABLE stages ADD COLUMN rejection_reason TEXT;
ALTER TABLE stages ADD COLUMN reviewed_by TEXT REFERENCES users(id);
ALTER TABLE stages ADD COLUMN reviewed_at TEXT;

-- Canonical name uniqueness (case/whitespace-insensitive) so "Airport
-- Stage" and "airport stage " can't both exist as separate approved
-- records. Scoped to approved rows only — a rejected/superseded proposal
-- shouldn't block a later, better-formed proposal of the same name.
CREATE UNIQUE INDEX idx_stages_name_canonical ON stages (LOWER(TRIM(name)))
  WHERE approval_status = 'approved';

-- Links a rider's profile to the canonical stage registry, replacing the
-- old free-text stage_name/stage_address/stage_chairman_* fields as the
-- source of truth. Nullable: existing riders keep their free-text fields
-- until they re-link through the new stage picker.
ALTER TABLE riders ADD COLUMN stage_id TEXT REFERENCES stages(id);
