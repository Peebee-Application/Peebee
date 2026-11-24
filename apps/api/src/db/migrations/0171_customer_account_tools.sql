-- Additive. Apply manually before enabling customer account tools; old paths tolerate absence.
CREATE TABLE IF NOT EXISTS account_sessions (
 jti TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), user_agent TEXT NOT NULL DEFAULT '',
 issued_at TEXT NOT NULL, expires_at TEXT NOT NULL, first_seen_at TEXT NOT NULL DEFAULT (datetime('now')), last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS account_sessions_user ON account_sessions(user_id,last_seen_at);
CREATE TABLE IF NOT EXISTS account_preferences(user_id TEXT PRIMARY KEY REFERENCES users(id),push_json TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT(datetime('now')));
CREATE TABLE IF NOT EXISTS account_contact_changes(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),channel TEXT NOT NULL CHECK(channel IN ('sms','email')),target TEXT NOT NULL,code_hash TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,expires_at TEXT NOT NULL,consumed_at TEXT,created_at TEXT NOT NULL DEFAULT(datetime('now')));
CREATE INDEX IF NOT EXISTS account_contact_owner ON account_contact_changes(user_id,created_at);
CREATE TABLE IF NOT EXISTS customer_cases(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL REFERENCES users(id),order_id TEXT NOT NULL REFERENCES orders(id),environment TEXT NOT NULL,description TEXT NOT NULL,contact TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','investigating','found','returned','closed')),version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT(datetime('now')),updated_at TEXT NOT NULL DEFAULT(datetime('now')),UNIQUE(customer_id,order_id,id));
CREATE INDEX IF NOT EXISTS customer_cases_owner ON customer_cases(customer_id,environment,created_at);
CREATE TABLE IF NOT EXISTS customer_case_events(id TEXT PRIMARY KEY,case_id TEXT NOT NULL REFERENCES customer_cases(id),actor_id TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL,status TEXT,created_at TEXT NOT NULL DEFAULT(datetime('now')));
CREATE TABLE IF NOT EXISTS customer_case_files(id TEXT PRIMARY KEY,case_id TEXT NOT NULL REFERENCES customer_cases(id),uploader_id TEXT NOT NULL REFERENCES users(id),storage_key TEXT NOT NULL,mime TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT(datetime('now')));

ALTER TABLE push_subscriptions ADD COLUMN session_jti TEXT;
