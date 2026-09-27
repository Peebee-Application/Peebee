CREATE TABLE IF NOT EXISTS user_practice_preferences (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  experience TEXT NOT NULL CHECK (experience IN ('customer', 'rider', 'restaurant', 'merchant')),
  completed_at TEXT,
  opted_out_at TEXT,
  last_prompted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, experience)
);

CREATE INDEX IF NOT EXISTS idx_user_practice_preferences_prompt
  ON user_practice_preferences (experience, completed_at, opted_out_at, last_prompted_at);
