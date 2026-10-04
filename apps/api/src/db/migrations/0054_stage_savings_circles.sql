-- Rider "Stage Savings Circles" — a VSLA-style group savings and loans
-- feature, one circle per boda stage. Deliberately cash-first and
-- non-custodial: Peebee never collects, holds, or moves real money here.
-- A contribution or repayment is a two-step "intent" (declared) then
-- "confirmed" (an officer attests the cash/MoMo actually arrived) —
-- the app is a ledger and workflow tool, not a payment processor.
--
-- Simplified from the reference VSLA design this was adapted from:
-- amounts are tracked directly in UGX rather than an abstract "shares"
-- unit, since that concept doesn't map to how riders already think
-- about saving.

CREATE TABLE IF NOT EXISTS stages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  area TEXT,
  address TEXT,
  description TEXT,
  -- Free-text rules the group has agreed to (meeting day, fines, etc.) —
  -- optional, editable by officers.
  constitution TEXT,
  -- Null when admin-created (the default mode); set when a rider
  -- self-created it, once that mode is enabled.
  created_by TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stage_members (
  id TEXT PRIMARY KEY,
  stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  rider_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'member' CHECK (
    role IN ('member', 'chairman', 'vice_chairman', 'secretary', 'treasurer', 'money_counter', 'mobilizer')
  ),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'left')),
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  left_at TEXT,
  UNIQUE (stage_id, rider_id)
);

CREATE INDEX IF NOT EXISTS idx_stage_members_stage ON stage_members(stage_id);
CREATE INDEX IF NOT EXISTS idx_stage_members_rider ON stage_members(rider_id);

-- An in-app election for one officer role — members nominate and vote;
-- once resolved the winner's stage_members.role is updated and this row
-- closes. One open election per (stage, role) at a time.
CREATE TABLE IF NOT EXISTS stage_officer_elections (
  id TEXT PRIMARY KEY,
  stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (
    role IN ('chairman', 'vice_chairman', 'secretary', 'treasurer', 'money_counter', 'mobilizer')
  ),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'cancelled')),
  winner_rider_id TEXT REFERENCES users(id),
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS stage_officer_nominations (
  id TEXT PRIMARY KEY,
  election_id TEXT NOT NULL REFERENCES stage_officer_elections(id) ON DELETE CASCADE,
  candidate_rider_id TEXT NOT NULL REFERENCES users(id),
  nominated_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (election_id, candidate_rider_id)
);

CREATE TABLE IF NOT EXISTS stage_officer_votes (
  id TEXT PRIMARY KEY,
  election_id TEXT NOT NULL REFERENCES stage_officer_elections(id) ON DELETE CASCADE,
  candidate_rider_id TEXT NOT NULL REFERENCES users(id),
  voter_rider_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (election_id, voter_rider_id)
);

-- One savings cycle at a time per stage. Numbers default from admin
-- settings but officers can adjust for their own circle when starting
-- a new cycle (see settings keys vslaDefault* in the settings table).
CREATE TABLE IF NOT EXISTS stage_cycles (
  id TEXT PRIMARY KEY,
  stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  interest_rate REAL NOT NULL DEFAULT 0,
  loanable_contribution_multiple REAL NOT NULL DEFAULT 2,
  max_loan_duration_months INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_stage_cycles_stage ON stage_cycles(stage_id, status);

-- Which officer roles must vote on a loan for this cycle, and the
-- approve/reject threshold. Configurable per stage per cycle.
CREATE TABLE IF NOT EXISTS stage_loan_approval_workflow (
  id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL REFERENCES stage_cycles(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  approvals_required INTEGER NOT NULL DEFAULT 1,
  rejections_required INTEGER NOT NULL DEFAULT 1,
  UNIQUE (cycle_id, role)
);

-- A declared saving — starts as "pending" the moment a member submits
-- it, before any money has necessarily moved. An officer (whichever
-- role the admin setting allows) flips it to "confirmed" only once the
-- cash or MoMo transfer has actually arrived.
CREATE TABLE IF NOT EXISTS stage_contributions (
  id TEXT PRIMARY KEY,
  stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  cycle_id TEXT NOT NULL REFERENCES stage_cycles(id),
  member_id TEXT NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('cash', 'momo')),
  -- Snapshot of who the MoMo send-shortcut targeted, if method = momo —
  -- purely informational, Peebee never processes this transfer.
  momo_recipient_msisdn TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'disputed')),
  proof_photo_key TEXT,
  proof_reminder_dismissed INTEGER NOT NULL DEFAULT 0,
  confirmed_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT,
  cancelled_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_stage_contributions_cycle ON stage_contributions(cycle_id, status);
CREATE INDEX IF NOT EXISTS idx_stage_contributions_member ON stage_contributions(member_id, status);

CREATE TABLE IF NOT EXISTS stage_loans (
  id TEXT PRIMARY KEY,
  stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  cycle_id TEXT NOT NULL REFERENCES stage_cycles(id),
  member_id TEXT NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  interest_rate REAL NOT NULL,
  number_of_installments INTEGER NOT NULL DEFAULT 1,
  total_repayment INTEGER NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'rejected', 'disbursed', 'repaid', 'defaulted')
  ),
  due_date TEXT,
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT,
  -- Set once the member themselves confirms they physically received the
  -- loan (cash handover or MoMo) — mirrors the delivery handover pattern
  -- used elsewhere in the app.
  disbursement_confirmed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_stage_loans_cycle ON stage_loans(cycle_id, status);
CREATE INDEX IF NOT EXISTS idx_stage_loans_member ON stage_loans(member_id, status);

CREATE TABLE IF NOT EXISTS stage_loan_votes (
  id TEXT PRIMARY KEY,
  loan_id TEXT NOT NULL REFERENCES stage_loans(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('approved', 'rejected')),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (loan_id, member_id)
);

CREATE TABLE IF NOT EXISTS stage_repayments (
  id TEXT PRIMARY KEY,
  loan_id TEXT NOT NULL REFERENCES stage_loans(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('cash', 'momo')),
  momo_recipient_msisdn TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'disputed')),
  proof_photo_key TEXT,
  proof_reminder_dismissed INTEGER NOT NULL DEFAULT 0,
  confirmed_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT,
  cancelled_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_stage_repayments_loan ON stage_repayments(loan_id, status);

-- Append-only general ledger — the single source of truth for a
-- stage's running balance, populated by confirmed contributions,
-- disbursed/repaid loans, and share-outs.
CREATE TABLE IF NOT EXISTS stage_transactions (
  id TEXT PRIMARY KEY,
  stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  cycle_id TEXT NOT NULL REFERENCES stage_cycles(id),
  member_id TEXT REFERENCES users(id),
  type TEXT NOT NULL CHECK (
    type IN ('contribution', 'loan_disbursement', 'repayment', 'share_out', 'fine', 'expense')
  ),
  amount INTEGER NOT NULL,
  narrative TEXT,
  related_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_stage_transactions_stage ON stage_transactions(stage_id, cycle_id);

CREATE TABLE IF NOT EXISTS stage_share_outs (
  id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL REFERENCES stage_cycles(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Stage association chat — null recipient_id means posted to the whole
-- group; a set recipient_id is a direct message to that one officer or
-- member. system_event_type/related_id let the client render a
-- WhatsApp-style status pill (contribution confirmed, loan approved,
-- etc.) instead of a plain message, same pattern as order_events.
CREATE TABLE IF NOT EXISTS stage_messages (
  id TEXT PRIMARY KEY,
  stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id),
  recipient_id TEXT REFERENCES users(id),
  body TEXT,
  type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'image', 'voice', 'system')),
  media_key TEXT,
  system_event_type TEXT,
  related_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_stage_messages_stage ON stage_messages(stage_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stage_messages_dm ON stage_messages(stage_id, sender_id, recipient_id);
