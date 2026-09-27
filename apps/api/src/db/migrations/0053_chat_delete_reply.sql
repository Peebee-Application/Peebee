-- Long-press message actions (Delete, Reply — Copy/Info/Share are
-- client-only and need no schema): "delete for everyone" clears the
-- content for both parties, "delete for me" only hides it from the
-- deleter's own view, and reply-to lets a message quote an earlier one.
--
-- Plain ADD COLUMN throughout — none of these are CHECK-constrained or
-- NOT NULL-without-a-default, so no table rebuild is needed here (unlike
-- the wallet_ledger/users migrations that widened a CHECK constraint).

-- Order chat (chat_messages) — hidden_for_customer/hidden_for_rider use
-- the table's own denormalized customer_id/rider_id columns (0019) rather
-- than a join table, since a conversation here only ever has two sides.
ALTER TABLE chat_messages ADD COLUMN deleted_at TEXT;
ALTER TABLE chat_messages ADD COLUMN deleted_by TEXT REFERENCES users(id);
ALTER TABLE chat_messages ADD COLUMN hidden_for_customer INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_messages ADD COLUMN hidden_for_rider INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_messages ADD COLUMN reply_to_id TEXT REFERENCES chat_messages(id);

-- Restaurant chat (restaurant_chat_messages) — same shape, mirrored for
-- its own two sides (customer / restaurant).
ALTER TABLE restaurant_chat_messages ADD COLUMN deleted_at TEXT;
ALTER TABLE restaurant_chat_messages ADD COLUMN deleted_by TEXT REFERENCES users(id);
ALTER TABLE restaurant_chat_messages ADD COLUMN hidden_for_customer INTEGER NOT NULL DEFAULT 0;
ALTER TABLE restaurant_chat_messages ADD COLUMN hidden_for_restaurant INTEGER NOT NULL DEFAULT 0;
ALTER TABLE restaurant_chat_messages ADD COLUMN reply_to_id TEXT REFERENCES restaurant_chat_messages(id);
