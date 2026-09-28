-- Tracks whether an unconfirmed contribution/repayment intent has already
-- triggered its one-time "call/message the treasurer" nudge, so the
-- scheduled sweep never re-notifies the same intent twice.
ALTER TABLE stage_contributions ADD COLUMN escalated_at TEXT;
ALTER TABLE stage_repayments ADD COLUMN escalated_at TEXT;
