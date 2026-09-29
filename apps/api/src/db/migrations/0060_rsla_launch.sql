-- RSLA launch gate: a stage's RSLA isn't "live" until the group admin has
-- worked through the guided setup (cycle, approval workflow, members,
-- roles) and explicitly launches it — see POST /stages/:id/launch. Null
-- means still in setup.
ALTER TABLE stages ADD COLUMN rsla_launched_at TEXT;

-- Backfill: any stage that already has a savings cycle predates the
-- launch-wizard gate and was already operating — treat it as already
-- launched rather than suddenly locking out contributions/loans for an
-- existing, working circle.
UPDATE stages SET rsla_launched_at = datetime('now')
  WHERE id IN (SELECT DISTINCT stage_id FROM stage_cycles);
