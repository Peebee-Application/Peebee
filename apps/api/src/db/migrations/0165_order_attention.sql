-- Apply manually before enabling order attention calls. Existing order endpoints do not depend on this table.
CREATE TABLE IF NOT EXISTS order_attention (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  sender_id TEXT NOT NULL REFERENCES users(id),
  recipient_id TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('tap', 'hold')),
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  stopped_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_order_attention_incoming ON order_attention(recipient_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_order_attention_sender ON order_attention(sender_id, started_at);
CREATE TABLE IF NOT EXISTS order_follow_up_messages (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  sender_id TEXT NOT NULL REFERENCES users(id),
  recipient_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_follow_up_messages_thread ON order_follow_up_messages(order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_follow_up_messages_unread ON order_follow_up_messages(recipient_id, read_at);
