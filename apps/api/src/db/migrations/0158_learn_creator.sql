-- Apply by hand. New routes stay off until this and the existing Learn migrations are ready.
-- Personal creators use a real independent-tutor profile in the canonical Learn hierarchy;
-- this explicit association is never eligible for automatic merchant import.
CREATE TABLE IF NOT EXISTS edu_creator_profiles (
 user_id TEXT PRIMARY KEY REFERENCES users(id), school_id TEXT NOT NULL REFERENCES edu_schools(id),
 class_id TEXT NOT NULL REFERENCES edu_classes(id)
);
CREATE TABLE IF NOT EXISTS edu_learning_profiles (
 user_id TEXT PRIMARY KEY REFERENCES users(id), goals TEXT NOT NULL DEFAULT '', level TEXT NOT NULL DEFAULT '',
 language TEXT NOT NULL DEFAULT 'English', minutes_per_day INTEGER NOT NULL DEFAULT 20
);
CREATE TABLE IF NOT EXISTS edu_course_drafts (
 course_id TEXT PRIMARY KEY REFERENCES edu_courses(id), context TEXT NOT NULL CHECK(context IN ('personal','school','store')),
 store_id TEXT, created_by TEXT NOT NULL REFERENCES users(id), last_edited_by TEXT NOT NULL REFERENCES users(id), revision INTEGER NOT NULL DEFAULT 1, body_json TEXT NOT NULL,
 published_version TEXT, private_version TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS edu_course_publications (
 id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES edu_courses(id), version INTEGER NOT NULL,
 revision INTEGER NOT NULL, purpose TEXT NOT NULL DEFAULT 'publication', body_json TEXT NOT NULL, labels_json TEXT NOT NULL DEFAULT '[]',
 published_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(course_id, version), UNIQUE(course_id, revision, purpose)
);
CREATE TABLE IF NOT EXISTS edu_creator_permissions (
 user_id TEXT NOT NULL REFERENCES users(id), permission TEXT NOT NULL CHECK(permission IN ('publish','sell','review','school_approve')),
 school_id TEXT NOT NULL DEFAULT '', granted_by TEXT NOT NULL REFERENCES users(id), active INTEGER NOT NULL DEFAULT 1, evidence TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(user_id,permission,school_id)
);
CREATE TABLE IF NOT EXISTS edu_course_reviewers (
 course_id TEXT NOT NULL REFERENCES edu_courses(id), user_id TEXT NOT NULL REFERENCES users(id),
 invited_by TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(course_id,user_id)
);
CREATE TABLE IF NOT EXISTS edu_course_reviews (
 id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES edu_courses(id), reviewer_id TEXT NOT NULL REFERENCES users(id),
 revision INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('approved','changes_requested')), comments TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(course_id,reviewer_id,revision)
);
CREATE TABLE IF NOT EXISTS edu_learning_invites (
 token_hash TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES edu_courses(id), publication_id TEXT NOT NULL REFERENCES edu_course_publications(id),
 recipient_id TEXT NOT NULL REFERENCES users(id), created_by TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL,
 cohort_id TEXT REFERENCES edu_cohorts(id), accepted_at TEXT, revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS edu_publication_access (
 user_id TEXT NOT NULL REFERENCES users(id), course_id TEXT NOT NULL REFERENCES edu_courses(id),
 publication_id TEXT NOT NULL REFERENCES edu_course_publications(id), source TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(user_id,course_id)
);
CREATE TABLE IF NOT EXISTS edu_generation_jobs (
 id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES edu_courses(id), user_id TEXT NOT NULL REFERENCES users(id),
 request_id TEXT NOT NULL, stage TEXT NOT NULL, resource_id TEXT, base_revision INTEGER NOT NULL, input_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued', result_json TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0,
 lease_until TEXT, claim_token TEXT, model TEXT, usage_json TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(user_id,request_id)
);
CREATE INDEX IF NOT EXISTS idx_edu_generation_pending ON edu_generation_jobs(status,created_at);
CREATE TABLE IF NOT EXISTS edu_creator_resources (
 id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES edu_courses(id), r2_key TEXT NOT NULL,
 name TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, kind TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS edu_tutor_messages (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), publication_id TEXT NOT NULL REFERENCES edu_course_publications(id),
 request_id TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(user_id,publication_id,request_id,role)
);
CREATE INDEX IF NOT EXISTS idx_edu_tutor_history ON edu_tutor_messages(user_id,publication_id,created_at);
CREATE TABLE IF NOT EXISTS edu_objective_evidence (
 user_id TEXT NOT NULL REFERENCES users(id), publication_id TEXT NOT NULL REFERENCES edu_course_publications(id),
 lesson_id TEXT NOT NULL, question_id TEXT NOT NULL, objective_id TEXT NOT NULL,
 correct INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(user_id,publication_id,lesson_id,question_id)
);
CREATE TABLE IF NOT EXISTS edu_learning_shares (
 id TEXT PRIMARY KEY, sender_id TEXT NOT NULL REFERENCES users(id), recipient_id TEXT NOT NULL REFERENCES users(id),
 course_id TEXT NOT NULL REFERENCES edu_courses(id), publication_id TEXT NOT NULL REFERENCES edu_course_publications(id),
 note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_edu_learning_shares_recipient ON edu_learning_shares(recipient_id,created_at);
CREATE TABLE IF NOT EXISTS edu_creator_purchases (
 id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES edu_courses(id), publication_id TEXT NOT NULL REFERENCES edu_course_publications(id),
 buyer_id TEXT NOT NULL REFERENCES users(id), store_id TEXT, fulfillment_id TEXT, enrollment_id TEXT NOT NULL,
 beneficiary_type TEXT NOT NULL, beneficiary_id TEXT NOT NULL, price_ugx INTEGER NOT NULL, commission_ugx INTEGER NOT NULL,
 environment TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'settled', request_id TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')), refunded_at TEXT,
 UNIQUE(buyer_id,request_id,environment)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_edu_creator_active_purchase ON edu_creator_purchases(buyer_id,course_id,environment) WHERE status='settled';
