-- Migration 0156: support chat alerts, and staff availability (who is online, messages left while the team is away).
-- Additive only (new nullable/default columns and one new table). Apply by hand to the live D1 database; the deploy does not run it.
-- Needs 0150 and 0151 first. The code works without it: chats still work, but staff are told only once about a waiting chat
-- (no reminders), visitors are not pushed a reply, and "who is online" cannot be told.
ALTER TABLE support_chats ADD COLUMN alerted_at TEXT;
ALTER TABLE support_chats ADD COLUMN alert_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE support_chats ADD COLUMN visitor_seen_at TEXT;
ALTER TABLE support_chats ADD COLUMN contact TEXT;
-- 1 when the visitor asked for a person while the team was offline, so the message is kept until someone is back.
ALTER TABLE support_chats ADD COLUMN left_offline INTEGER NOT NULL DEFAULT 0;

-- Staff who have the admin app open, so visitors can be told honestly whether anyone is there.
CREATE TABLE IF NOT EXISTS support_agent_presence (
  user_id TEXT PRIMARY KEY,
  name TEXT,
  last_seen_at TEXT NOT NULL
);
