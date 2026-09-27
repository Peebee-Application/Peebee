-- Ordinary users may launch guided, client-local practice journeys while
-- the existing platform_environment remains exclusively admin-controlled.
INSERT OR IGNORE INTO settings (key, value) VALUES ('user_practice_mode_enabled', '1');
