-- Luganda voice reading of shopping lists: a rider sets one standing voice
-- preference (riders table — a rider's role-specific profile lives there,
-- not on users), used to generate and cache a spoken Luganda version of
-- every order's list on demand. See apps/api/src/speech/gemini.ts and
-- apps/api/src/orders/list-narration.ts.
--
-- Plain ADD COLUMN throughout — none of these are CHECK-constrained or
-- NOT NULL-without-a-default, so no table rebuild is needed here.

ALTER TABLE riders ADD COLUMN preferred_lug_voice TEXT;

-- Cache of the generated audio for one order: which voice it was rendered
-- with and a fingerprint of the list contents, so a later request can tell
-- whether the cached object is still valid or needs regenerating (the list
-- changed, or the rider changed their voice preference since).
ALTER TABLE orders ADD COLUMN list_audio_voice TEXT;
ALTER TABLE orders ADD COLUMN list_audio_key TEXT;
ALTER TABLE orders ADD COLUMN list_audio_text_hash TEXT;
