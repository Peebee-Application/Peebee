-- A single Peebee identity can explicitly hold customer and rider app profiles.
-- `users.role` remains the legacy/default role for older clients and records.
CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('customer', 'rider', 'admin')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_role_user ON user_roles(role, user_id);

INSERT OR IGNORE INTO user_roles (user_id, role)
SELECT id, role FROM users;
