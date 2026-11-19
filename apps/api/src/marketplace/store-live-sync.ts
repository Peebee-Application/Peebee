import { db } from "../db/client.js";
import { hasTable } from "../lib/schema.js";

/**
 * A store's camera live is one row in the shared `live_sessions` (the creator pipeline) plus a `store_live_sessions`
 * row with the same id that carries the items pinned for sale. When the stream closes for any reason (the merchant
 * ends it, the time limit, a lost phone), this switches the store's live listing off too.
 */
export async function endStoreCameraLive(liveId: string, storeId: string): Promise<void> {
  if (!(await hasTable("store_live_sessions"))) return;
  await db.execute({ sql: "UPDATE store_live_sessions SET status = 'ended', ended_at = datetime('now') WHERE id = ? AND status = 'live'", args: [liveId] });
  // Only clear the store's live flag if no other live listing (e.g. a newer one) is still on.
  const other = await db.execute({ sql: "SELECT 1 FROM store_live_sessions WHERE store_id = ? AND status = 'live' LIMIT 1", args: [storeId] });
  if (!other.rows.length) await db.execute({ sql: "UPDATE stores SET is_live = 0, live_viewer_count = 0 WHERE id = ?", args: [storeId] });
}
