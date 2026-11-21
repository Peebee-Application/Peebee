import { Hono } from "hono";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { getHomeTemplatesSettings } from "../settings/home-templates.js";
import { getPlatformEnvironment } from "../lib/settings.js";
import { hasColumn, hasTable } from "../lib/schema.js";
import type { HomeHistoryEntry } from "@peebee/shared";

export const homeRoutes = new Hono();
/** One bounded, account-scoped read, rather than an order-detail request per recommendation. */
homeRoutes.get("/home/context", requireAuth, requireRole("customer"), async c => {
  c.header("Cache-Control", "private, no-store");
  const rules = (await getHomeTemplatesSettings()).personalization;
  if (!rules.enabled || !rules.historyEnabled) return c.json({ history: [] });
  const [ride, food, restaurantTable, environment] = await Promise.all([
    hasColumn("orders", "is_ride"), hasColumn("orders", "restaurant_id"), hasTable("restaurants"), hasColumn("orders", "environment"),
  ]);
  const join = food && restaurantTable;
  const result = await db.execute({
    sql: `SELECT o.id, o.created_at, o.type, o.destination_area,
      ${ride ? "o.is_ride" : "0"} AS is_ride,
      ${food ? "o.restaurant_id" : "NULL"} AS restaurant_id,
      ${join ? "r.name" : "NULL"} AS restaurant_name
      FROM orders o ${join ? "LEFT JOIN restaurants r ON r.id=o.restaurant_id" : ""}
      WHERE o.customer_id=? AND o.stage='Settle'
      AND datetime(o.created_at)>=datetime('now', ?)
      ${environment ? "AND o.environment=?" : ""}
      ORDER BY o.created_at DESC LIMIT ?`,
    args: [c.get("user").sub, `-${rules.historyDays} days`, ...(environment ? [await getPlatformEnvironment()] : []), rules.historyLimit],
  });
  const history: HomeHistoryEntry[] = result.rows.map(row => ({
    id: String(row.id), createdAt: String(row.created_at),
    kind: Number(row.is_ride) ? "ride" : row.restaurant_id ? "food" : row.type === "parcel" ? "parcel" : "shopping",
    destination: row.destination_area ? String(row.destination_area) : null,
    restaurantId: row.restaurant_id ? String(row.restaurant_id) : null,
    restaurantName: row.restaurant_name ? String(row.restaurant_name) : null,
  }));
  return c.json({ history });
});
