-- Google's quotas are per Google Cloud PROJECT and per MODEL (not per API key):
-- a key can be out of daily requests for the text-to-speech model and still be
-- fine for translation, and two keys made in the same project share one
-- allowance. So a "limit reached" is recorded per key + model, and keys can be
-- tagged with the project they belong to so one key's limit is applied to its
-- siblings. Additive on top of 0074_ai_api_keys.sql.
ALTER TABLE ai_api_keys ADD COLUMN project_tag TEXT;

CREATE TABLE IF NOT EXISTS ai_key_limits (
  key_id TEXT NOT NULL,
  model TEXT NOT NULL,
  until TEXT NOT NULL,
  reason TEXT NOT NULL,
  PRIMARY KEY (key_id, model)
);
