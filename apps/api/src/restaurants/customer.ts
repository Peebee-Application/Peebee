/**
 * Customer-facing restaurant browsing + checkout — Phase 3 of food
 * ordering (see ./routes.ts for Phase 1's account context and ./menu.ts
 * for Phase 2's owner-side menu CRUD, which this reads from).
 *
 * A food order is a normal `type='shopping'` order with `restaurant_id`
 * set — see migrations/0034_order_restaurant.sql for why that's not a new
 * orders.type value. Prices are always computed server-side from the
 * menu, never trusted from the client, since a menu item's price is the
 * restaurant's to set, not the customer's.
 */

import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { haversineKm } from "../lib/geo.js";
import { newId } from "../lib/ids.js";
import { getDeliverySettings, getMatchingSettings, getMaxOrderValue, getPlatformEnvironment } from "../lib/settings.js";
import type { MatchingMode } from "@tuma/shared";
import { roundFare } from "@tuma/shared";
import { snapshotTimeFees } from "../orders/time-fees.js";

export const customerRestaurantRoutes = new Hono();

type Row = Record<string, unknown>;

function formatAmount(n: number): string {
  return `UGX ${n.toLocaleString("en-UG")}`;
}

/** Restaurants a customer can actually order from right now: approved,
 * open, and in the currently active platform environment. */
customerRestaurantRoutes.get("/restaurants", requireAuth, async (c) => {
  const environment = await getPlatformEnvironment();
  const res = await db.execute({
    sql: "SELECT * FROM restaurants WHERE status = 'active' AND environment = ? ORDER BY is_open DESC, name",
    args: [environment],
  });
  return c.json({ restaurants: res.rows });
});

customerRestaurantRoutes.get("/restaurants/:id", requireAuth, async (c) => {
  const id = c.req.param("id") as string;
  const environment = await getPlatformEnvironment();
  const res = await db.execute({
    sql: "SELECT * FROM restaurants WHERE id = ? AND status = 'active' AND environment = ?",
    args: [id, environment],
  });
  const restaurant = res.rows[0] as Row | undefined;
  if (!restaurant) return c.json({ error: "not_found" }, 404);
  return c.json({ restaurant });
});

/** Same tree shape as the owner's GET /restaurants/me/menu, filtered down
 * to only what a customer should see: available items only, and empty
 * categories are dropped rather than shown with nothing in them. */
customerRestaurantRoutes.get("/restaurants/:id/menu", requireAuth, async (c) => {
  const id = c.req.param("id") as string;
  const environment = await getPlatformEnvironment();
  const restaurantRes = await db.execute({
    sql: "SELECT id FROM restaurants WHERE id = ? AND status = 'active' AND environment = ?",
    args: [id, environment],
  });
  if (restaurantRes.rows.length === 0) return c.json({ error: "not_found" }, 404);

  const [categoriesRes, itemsRes, optionsRes, choicesRes] = await Promise.all([
    db.execute({ sql: "SELECT * FROM menu_categories WHERE restaurant_id = ? ORDER BY sort_order, name", args: [id] }),
    db.execute({
      sql: "SELECT * FROM menu_items WHERE restaurant_id = ? AND available = 1 ORDER BY sort_order, name",
      args: [id],
    }),
    db.execute({
      sql: `SELECT o.* FROM menu_item_options o JOIN menu_items i ON i.id = o.menu_item_id
            WHERE i.restaurant_id = ? AND i.available = 1 ORDER BY o.sort_order`,
      args: [id],
    }),
    db.execute({
      sql: `SELECT ch.* FROM menu_item_option_choices ch
            JOIN menu_item_options o ON o.id = ch.option_id
            JOIN menu_items i ON i.id = o.menu_item_id
            WHERE i.restaurant_id = ? AND i.available = 1 ORDER BY ch.sort_order`,
      args: [id],
    }),
  ]);

  const choicesByOption = new Map<string, Row[]>();
  for (const choice of choicesRes.rows as Row[]) {
    const list = choicesByOption.get(choice.option_id as string) ?? [];
    list.push(choice);
    choicesByOption.set(choice.option_id as string, list);
  }
  const optionsByItem = new Map<string, Row[]>();
  for (const option of optionsRes.rows as Row[]) {
    const list = optionsByItem.get(option.menu_item_id as string) ?? [];
    list.push({ ...option, choices: choicesByOption.get(option.id as string) ?? [] });
    optionsByItem.set(option.menu_item_id as string, list);
  }
  const items: Row[] = (itemsRes.rows as Row[]).map((item) => ({ ...item, options: optionsByItem.get(item.id as string) ?? [] }));
  const itemsByCategory = new Map<string | null, Row[]>();
  for (const item of items) {
    const key = (item.category_id as string | null | undefined) ?? null;
    const list = itemsByCategory.get(key) ?? [];
    list.push(item);
    itemsByCategory.set(key, list);
  }

  const categories = (categoriesRes.rows as Row[])
    .map((cat) => ({ ...cat, items: itemsByCategory.get(cat.id as string) ?? [] }))
    .filter((cat) => (cat.items as Row[]).length > 0);
  const uncategorized = itemsByCategory.get(null) ?? [];

  return c.json({ categories, uncategorizedItems: uncategorized });
});

const checkoutSchema = z.object({
  items: z
    .array(
      z.object({
        menuItemId: z.string(),
        quantity: z.number().int().positive().max(50),
        choiceIds: z.array(z.string()).optional(),
      }),
    )
    .min(1),
  destinationArea: z.string().max(120).optional(),
  destinationAddress: z.string().max(240).optional(),
  destinationLat: z.number().optional(),
  destinationLng: z.number().optional(),
  paymentRail: z.enum(["escrow", "float"]).default("escrow"),
});

customerRestaurantRoutes.post("/restaurants/:id/order", requireAuth, requireRole("customer"), async (c) => {
  const user = c.get("user");
  const restaurantId = c.req.param("id") as string;
  const parsed = checkoutSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const d = parsed.data;

  const environment = await getPlatformEnvironment();
  const restaurantRes = await db.execute({
    sql: "SELECT * FROM restaurants WHERE id = ? AND status = 'active' AND environment = ?",
    args: [restaurantId, environment],
  });
  const restaurant = restaurantRes.rows[0] as Row | undefined;
  if (!restaurant) return c.json({ error: "not_found" }, 404);
  if (!restaurant.is_open) {
    return c.json({ error: "restaurant_closed", message: `${restaurant.name} is currently closed` }, 409);
  }

  // Server-computed line by line — a menu item's price (and its options'
  // price deltas) are the restaurant's to set, never trusted from the
  // client, which only ever sends *which* item/choices, not what they cost.
  const lineItems: { name: string; quantity: number; unitPrice: number }[] = [];
  for (const line of d.items) {
    const itemRes = await db.execute({
      sql: "SELECT * FROM menu_items WHERE id = ? AND restaurant_id = ? AND available = 1",
      args: [line.menuItemId, restaurantId],
    });
    const item = itemRes.rows[0] as Row | undefined;
    if (!item) return c.json({ error: "item_unavailable", message: "One of the items in your cart is no longer available" }, 409);

    const optionsRes = await db.execute({
      sql: "SELECT * FROM menu_item_options WHERE menu_item_id = ? ORDER BY sort_order",
      args: [item.id as string],
    });
    const options = optionsRes.rows as Row[];
    const requestedChoiceIds = new Set(line.choiceIds ?? []);
    let unitPrice = item.price as number;
    const chosenNames: string[] = [];

    for (const option of options) {
      const choicesRes = await db.execute({
        sql: "SELECT * FROM menu_item_option_choices WHERE option_id = ? ORDER BY sort_order",
        args: [option.id as string],
      });
      const choices = choicesRes.rows as Row[];
      const selected = choices.filter((ch) => requestedChoiceIds.has(ch.id as string));
      if (option.required && selected.length === 0) {
        return c.json({ error: "missing_required_option", message: `"${option.name}" is required on ${item.name}` }, 400);
      }
      if (!option.multi_select && selected.length > 1) {
        return c.json({ error: "too_many_choices", message: `Only one choice allowed for "${option.name}" on ${item.name}` }, 400);
      }
      for (const choice of selected) {
        unitPrice += choice.price_delta as number;
        chosenNames.push(choice.name as string);
        requestedChoiceIds.delete(choice.id as string);
      }
    }
    if (requestedChoiceIds.size > 0) {
      return c.json({ error: "invalid_choice", message: "One of the selected options doesn't belong to this item" }, 400);
    }

    lineItems.push({
      name: chosenNames.length > 0 ? `${item.name as string} (${chosenNames.join(", ")})` : (item.name as string),
      quantity: line.quantity,
      unitPrice,
    });
  }

  const itemsTotal = lineItems.reduce((sum, li) => sum + li.quantity * li.unitPrice, 0);

  // Distance-priced when the restaurant has a pinned pickup location (the
  // usual case) — more accurate than the flat shopping fee, and possible
  // here specifically because a restaurant's location is known upfront,
  // unlike a freeform shopping order's "wherever the rider ends up
  // shopping" pickup. Falls back to the flat fee if it somehow isn't set.
  const { deliveryRatePerKm, minimumDeliveryFee, shoppingDeliveryFee } = await getDeliverySettings();
  const restaurantLat = restaurant.lat as number | null;
  const restaurantLng = restaurant.lng as number | null;
  let distanceKm: number | null = null;
  let deliveryFee: number;
  if (restaurantLat != null && restaurantLng != null && d.destinationLat != null && d.destinationLng != null) {
    distanceKm = haversineKm(restaurantLat, restaurantLng, d.destinationLat, d.destinationLng);
    deliveryFee = roundFare(distanceKm * deliveryRatePerKm, minimumDeliveryFee);
  } else {
    deliveryFee = roundFare(shoppingDeliveryFee);
  }
  const estimatedTotal = itemsTotal + deliveryFee;

  const maxOrderValue = await getMaxOrderValue();
  if (estimatedTotal > maxOrderValue) {
    return c.json(
      { error: "order_value_too_high", message: `Orders are capped at ${formatAmount(maxOrderValue)}. Please split this into smaller orders.` },
      400,
    );
  }

  const { enabledModes, nearestWindowSeconds, maxAssignmentMinutes } = await getMatchingSettings();
  const userRow = await db.execute({ sql: "SELECT default_matching_mode FROM users WHERE id = ?", args: [user.sub] });
  const preferredMode = userRow.rows[0]?.default_matching_mode as MatchingMode | null | undefined;
  const matchingMode: MatchingMode = preferredMode && enabledModes.includes(preferredMode) ? preferredMode : enabledModes[0];
  const matchingDeadlineAt =
    matchingMode === "nearest_window"
      ? new Date(Date.now() + nearestWindowSeconds * 1000).toISOString()
      : matchingMode === "customer_selects"
        ? new Date(Date.now() + maxAssignmentMinutes * 60 * 1000).toISOString()
        : null;

  const listId = newId("list");
  await db.execute({
    sql: "INSERT INTO lists (id, customer_id, title, status, environment) VALUES (?, ?, ?, 'active', ?)",
    args: [listId, user.sub, restaurant.name as string, environment],
  });
  for (const li of lineItems) {
    await db.execute({
      sql: "INSERT INTO list_items (id, list_id, name, quantity, unit_price) VALUES (?, ?, ?, ?, ?)",
      args: [newId("item"), listId, li.name, li.quantity, li.unitPrice],
    });
  }

  const orderId = newId("ord");
  await db.execute({
    sql: `INSERT INTO orders (
            id, list_id, customer_id, stage, type, payment_rail, estimated_total, delivery_fee,
            pickup_area, pickup_address, pickup_lat, pickup_lng,
            destination_area, destination_address, destination_lat, destination_lng, distance_km,
            matching_mode, matching_deadline_at, environment, restaurant_id
          )
          VALUES (?, ?, ?, 'Create', 'shopping', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      orderId,
      listId,
      user.sub,
      d.paymentRail,
      estimatedTotal,
      deliveryFee,
      (restaurant.address as string | null) ?? null,
      (restaurant.address as string | null) ?? null,
      restaurantLat,
      restaurantLng,
      d.destinationArea ?? null,
      d.destinationAddress ?? null,
      d.destinationLat ?? null,
      d.destinationLng ?? null,
      distanceKm,
      matchingMode,
      matchingDeadlineAt,
      environment,
      restaurantId,
    ],
  });
  await db.execute({
    sql: "INSERT INTO order_events (id, order_id, stage, note, actor_id) VALUES (?, ?, 'Create', ?, ?)",
    args: [newId("evt"), orderId, `Food order created from ${restaurant.name}`, user.sub],
  });

  await snapshotTimeFees(orderId, deliveryFee);
  const orderRes = await db.execute({
    sql: `SELECT o.*, c.name as customer_name, r.name as rider_name FROM orders o
          LEFT JOIN users c ON c.id = o.customer_id
          LEFT JOIN users r ON r.id = o.rider_id
          WHERE o.id = ?`,
    args: [orderId],
  });
  return c.json({ order: orderRes.rows[0] }, 201);
});
