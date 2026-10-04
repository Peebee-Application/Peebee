-- Richer per-member profile fields for RSLA purposes specifically — kept on
-- stage_members rather than the riders table, since these are membership
-- details for the savings association (mirroring the reference VSLA
-- platform's "Create member" form), not part of Peebee's own rider
-- verification/onboarding flow. All nullable: a member can join without
-- filling these in, and complete them later via the profile prompt.
ALTER TABLE stage_members ADD COLUMN nationality TEXT;
ALTER TABLE stage_members ADD COLUMN district TEXT;
ALTER TABLE stage_members ADD COLUMN gender TEXT CHECK (gender IS NULL OR gender IN ('male', 'female', 'other'));
ALTER TABLE stage_members ADD COLUMN date_of_birth TEXT;
ALTER TABLE stage_members ADD COLUMN household_size INTEGER;
ALTER TABLE stage_members ADD COLUMN literate INTEGER CHECK (literate IS NULL OR literate IN (0, 1));
ALTER TABLE stage_members ADD COLUMN profile_completed_at TEXT;
