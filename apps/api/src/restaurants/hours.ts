import { db } from "../db/client.js";

type Business = Record<string, unknown>;
/** Uganda wall-clock hours. Manual changes last until the next daily boundary. */
export function scheduledOpen(business: Business, now = new Date()): boolean | null {
  const open = String(business.open_time ?? "");
  const close = String(business.close_time ?? "");
  if (!/^\d{2}:\d{2}$/.test(open) || !/^\d{2}:\d{2}$/.test(close) || open === close || business.status !== "active") return null;
  const local = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - 3 * 60 * 60 * 1000;
  const boundary = (hm: string) => {
    const [h, m] = hm.split(":").map(Number);
    const today = day + (h * 60 + m) * 60 * 1000;
    return today <= now.getTime() ? today : today - 24 * 60 * 60 * 1000;
  };
  const opened = boundary(open), closed = boundary(close);
  const raw = String(business.updated_at ?? "");
  const updated = Date.parse(raw.includes("T") ? raw : raw.replace(" ", "T") + "Z");
  if (!Number.isFinite(updated) || updated >= Math.max(opened, closed)) return null;
  return opened > closed;
}

export async function reconcileFoodHours(business: Business, now = new Date()): Promise<Business> {
  const next = scheduledOpen(business, now);
  if (next === null || Number(business.is_open) === Number(next)) return business;
  // Compare the timestamp as well: a concurrent manual toggle wins over this stale read.
  await db.execute({sql: "UPDATE restaurants SET is_open = ?, updated_at = ? WHERE id = ? AND updated_at = ? AND status = 'active'", args: [Number(next), now.toISOString(), String(business.id), String(business.updated_at)]});
  const result = await db.execute({sql:"SELECT * FROM restaurants WHERE id = ?", args:[String(business.id)]});
  return result.rows[0] ?? business;
}

export async function sweepFoodHours(): Promise<void> {
  const result = await db.execute("SELECT * FROM restaurants WHERE status = 'active' AND open_time IS NOT NULL AND close_time IS NOT NULL");
  for (const row of result.rows) await reconcileFoodHours(row);
}
