import { Hono } from "hono";
import { z } from "zod";
import {
  FOOD_ORDER_HISTORY_STAGES,
  type FoodSellerOrder,
} from "@peebee/shared";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { getPlatformEnvironment } from "../lib/settings.js";

export const sellerOrderRoutes = new Hono();
const querySchema = z.object({
  view: z.enum(["active", "history"]).default("active"),
  cursor: z.string().max(400).optional(),
});
const cursorSchema = z.object({
  createdAt: z.string().min(1).max(64),
  id: z.string().min(1).max(120),
});
type Row = Record<string, unknown>;

sellerOrderRoutes.get(
  "/restaurants/me/orders",
  requireAuth,
  requireRole("customer"),
  async (c) => {
    const parsed = querySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
    let cursor: z.infer<typeof cursorSchema> | undefined;
    if (parsed.data.cursor) {
      try {
        const value = cursorSchema.safeParse(JSON.parse(parsed.data.cursor));
        if (!value.success) return c.json({ error: "invalid_cursor" }, 400);
        cursor = value.data;
      } catch {
        return c.json({ error: "invalid_cursor" }, 400);
      }
    }
    const owned = await db.execute({
      sql: "SELECT id FROM restaurants WHERE owner_id = ?",
      args: [c.get("user").sub],
    });
    const restaurantId = owned.rows[0]?.id;
    if (!restaurantId) return c.json({ error: "not_found" }, 404);
    const environment = await getPlatformEnvironment();
    const terminal = FOOD_ORDER_HISTORY_STAGES;
    const [result, totals] = await Promise.all([
      db.execute({
        sql: `SELECT o.id,o.stage,o.list_id,o.customer_id,o.created_at,o.updated_at,c.name AS customer_name,r.name AS rider_name
            FROM orders o JOIN users c ON c.id=o.customer_id LEFT JOIN users r ON r.id=o.rider_id
            WHERE o.restaurant_id=? AND o.environment=?
            AND o.stage ${parsed.data.view === "history" ? "IN" : "NOT IN"} (?,?,?)
            ${cursor ? "AND (o.created_at < ? OR (o.created_at = ? AND o.id < ?))" : ""}
            ORDER BY o.created_at DESC,o.id DESC LIMIT 51`,
        args: [
          String(restaurantId),
          environment,
          ...terminal,
          ...(cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : []),
        ],
      }),
      db.execute({
        sql: `SELECT SUM(CASE WHEN stage IN (?,?,?) THEN 0 ELSE 1 END) AS active,SUM(CASE WHEN stage IN (?,?,?) THEN 1 ELSE 0 END) AS history FROM orders WHERE restaurant_id=? AND environment=?`,
        args: [...terminal, ...terminal, String(restaurantId), environment],
      }),
    ]);
    const page = (result.rows as Row[]).slice(0, 50);
    const listIds = [...new Set(page.map((order) => String(order.list_id)))];
    const itemRows = listIds.length
      ? ((
          await db.execute({
            sql: `SELECT list_id,name,quantity,unit_price FROM list_items WHERE list_id IN (${listIds.map(() => "?").join(",")}) ORDER BY created_at,id`,
            args: listIds,
          })
        ).rows as Row[])
      : [];
    const byList = new Map<string, FoodSellerOrder["items"]>();
    for (const item of itemRows) {
      const listId = String(item.list_id);
      const items = byList.get(listId) ?? [];
      items.push({
        name: String(item.name),
        quantity: Number(item.quantity),
        unitPrice: item.unit_price == null ? null : Number(item.unit_price),
      });
      byList.set(listId, items);
    }
    const orders: FoodSellerOrder[] = page.map((order) => {
      const items = byList.get(String(order.list_id)) ?? [];
      return {
        id: String(order.id),
        stage: String(order.stage),
        customerId: String(order.customer_id),
        customerName: String(order.customer_name),
        riderName: order.rider_name == null ? null : String(order.rider_name),
        createdAt: String(order.created_at),
        updatedAt: String(order.updated_at),
        items,
        itemsTotal:
          items.length && items.every((item) => item.unitPrice != null)
            ? items.reduce(
                (sum, item) => sum + item.quantity * (item.unitPrice ?? 0),
                0,
              )
            : null,
      };
    });
    const last = page.at(-1);
    return c.json({
      orders,
      counts: {
        active: Number(totals.rows[0]?.active ?? 0),
        history: Number(totals.rows[0]?.history ?? 0),
      },
      nextCursor:
        result.rows.length > 50 && last
          ? JSON.stringify({ createdAt: last.created_at, id: last.id })
          : null,
    });
  },
);
