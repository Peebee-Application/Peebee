-- Migration 0157: school messaging for Peebee Learn.
-- Learners, parents and anyone else (customer accounts) message a school; the school's owner replies. One continuous thread per
-- (school, person), the same shape as restaurant chat (0037). Calls placed from the thread are logged in it, which needs
-- a school_id on calls (the school the call was about).
-- Additive only. Apply by hand to the live D1 database; the deploy does not run it.
-- The code works without it: school messages and calls from a school conversation report "not available yet" and the apps
-- hide the message button, and everything else in Learn is unaffected.
CREATE TABLE IF NOT EXISTS school_chat_messages (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES edu_schools(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES users(id),
  sender_role TEXT NOT NULL CHECK (sender_role IN ('customer', 'school')),
  body TEXT,
  type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'call')),
  call_id TEXT,
  call_status TEXT,
  call_duration_seconds INTEGER,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_school_chat_pair ON school_chat_messages(school_id, customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_school_chat_customer ON school_chat_messages(customer_id, created_at);

ALTER TABLE calls ADD COLUMN school_id TEXT;
