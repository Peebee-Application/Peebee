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
import { db, executeBatch } from "../db/client.js";
import { haversineKm } from "../lib/geo.js";
import { newId } from "../lib/ids.js";
import { getDeliverySettings, getMatchingSettings, getMaxOrderValue, getPlatformEnvironment, isServiceEnabled } from "../lib/settings.js";
import { servicePaused } from "../lib/service-gate.js";
import type { MatchingMode } from "@peebee/shared";
import { roundFare } from "@peebee/shared";
import { DEMO_FOOD_RESTAURANTS, demoFoodMenu, demoFoodRestaurant } from "@peebee/shared/demo-food";
import { snapshotTimeFees } from "../orders/time-fees.js";
import { ensureSandboxDemoRestaurant } from "./demo-orders.js";
import { reconcileFoodHours } from "./hours.js";
import { hasColumn } from "../lib/schema.js";

export const customerRestaurantRoutes = new Hono();

type Row = Record<string, unknown>;

function formatAmount(n: number): string {
  return `UGX ${n.toLocaleString("en-UG")}`;
}

/** Restaurants a customer can actually order from right now: approved,
 * open, and in the currently active platform environment. */
customerRestaurantRoutes.get("/restaurants", requireAuth, async (c) => {
  // Food switched off by an admin: nothing to browse, and the app says why.
  if (!(await isServiceEnabled("food"))) return c.json({ restaurants: [], paused: true });
  const environment = await getPlatformEnvironment();
  const res = await db.execute({
    sql: "SELECT * FROM restaurants WHERE status = 'active' AND environment = ? ORDER BY is_open DESC, name",
    args: [environment],
  });
  const scheduled = await Promise.all(res.rows.map((row) => reconcileFoodHours(row)));
  const restaurants = environment === "sandbox"
    ? [...scheduled.filter((row) => !demoFoodRestaurant(String(row.id))), ...DEMO_FOOD_RESTAURANTS.map((restaurant) => ({ ...restaurant, demo_checkout_enabled: true }))].sort((a, b) => Number(b.is_open) - Number(a.is_open) || String(a.name).localeCompare(String(b.name)))
    : scheduled.sort((a, b) => Number(b.is_open) - Number(a.is_open) || String(a.name).localeCompare(String(b.name)));
  return c.json({ restaurants });
});

customerRestaurantRoutes.get("/restaurants/:id", requireAuth, async (c) => {
  const id = c.req.param("id") as string;
  const environment = await getPlatformEnvironment();
  const demo = environment === "sandbox" ? demoFoodRestaurant(id) : undefined;
  if (demo) return c.json({ restaurant: { ...demo, demo_checkout_enabled: true } });
  const res = await db.execute({
    sql: "SELECT * FROM restaurants WHERE id = ? AND status = 'active' AND environment = ?",
    args: [id, environment],
  });
  const restaurant = res.rows[0] as Row | undefined;
  if (!restaurant) return c.json({ error: "not_found" }, 404);
  return c.json({ restaurant: await reconcileFoodHours(restaurant) });
});

/** Same tree shape as the owner's GET /restaurants/me/menu, filtered down
 * to only what a customer should see: available items only, and empty
 * categories are dropped rather than shown with nothing in them. */
customerRestaurantRoutes.get("/restaurants/:id/menu", requireAuth, async (c) => {
  const id = c.req.param("id") as string;
  const environment = await getPlatformEnvironment();
  const demoMenu = environment === "sandbox" ? demoFoodMenu(id) : undefined;
  if (demoMenu) return c.json(demoMenu);
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
  bundleWithOrderId: z.string().min(1).optional(),
});

customerRestaurantRoutes.post("/restaurants/:id/order", requireAuth, requireRole("customer"), async (c) => {
  const user = c.get("user");
  if (!(await isServiceEnabled("food"))) return servicePaused(c, "food");
  const restaurantId = c.req.param("id") as string;
  const parsed = checkoutSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const d = parsed.data;

  const environment = await getPlatformEnvironment();
  const demoRestaurant = environment === "sandbox" ? demoFoodRestaurant(restaurantId) : undefined;
  const demoItems = demoRestaurant ? demoFoodMenu(restaurantId)!.categories.flatMap((category) => category.items) : undefined;
  const restaurantRes = demoRestaurant ? { rows: [{ ...demoRestaurant }] } : await db.execute({
    sql: "SELECT * FROM restaurants WHERE id = ? AND status = 'active' AND environment = ?",
    args: [restaurantId, environment],
  });
  let restaurant = restaurantRes.rows[0] as Row | undefined;
  if (!restaurant) return c.json({ error: "not_found" }, 404);
  if (!demoRestaurant) restaurant = await reconcileFoodHours(restaurant);
  if (!restaurant.is_open) {
    return c.json({ error: "restaurant_closed", message: `${restaurant.name} is currently closed` }, 409);
  }

  let bundleWith: Row | undefined;
  let deliveryBundleId: string | null = null;
  let bundleExtraFee = 0;
  if (d.bundleWithOrderId) {
    if (!await hasColumn("orders", "delivery_bundle_id") || !await hasColumn("orders", "delivery_bundle_hold")) {
      return c.json({ error: "bundles_unavailable", message: "Combined delivery is being prepared. Place this order separately for now." }, 409);
    }
    const prior = await db.execute({
      sql: `SELECT o.* FROM orders o WHERE o.id=? AND o.customer_id=? AND o.environment=? AND o.type='shopping'
            AND o.stage='Create' AND o.rider_id IS NULL AND o.delivery_bundle_id IS NULL AND o.delivery_bundle_hold=1 AND o.created_at>datetime('now','-30 minutes')
            AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id=o.id)`,
      args: [d.bundleWithOrderId, user.sub, environment],
    });
    bundleWith = prior.rows[0] as Row | undefined;
    if (!bundleWith || bundleWith.pickup_lat == null || bundleWith.pickup_lng == null) {
      return c.json({ error: "bundle_order_unavailable", message: "That order has already moved forward. Please check it out separately." }, 409);
    }
    if (bundleWith.destination_lat == null || bundleWith.destination_lng == null || d.destinationLat == null || d.destinationLng == null ||
        haversineKm(Number(bundleWith.destination_lat), Number(bundleWith.destination_lng), d.destinationLat, d.destinationLng) > 0.2) {
      return c.json({ error: "bundle_destination_mismatch", message: "Both orders need the same saved delivery location to share one rider trip." }, 400);
    }
  }

  // Server-computed line by line — a menu item's price (and its options'
  // price deltas) are the restaurant's to set, never trusted from the
  // client, which only ever sends *which* item/choices, not what they cost.
  const lineItems: { name: string; quantity: number; unitPrice: number; menuItemId:string }[] = [];
  for (const line of d.items) {
    const itemRes = demoItems ? { rows: demoItems.filter((item) => item.id === line.menuItemId) } : await db.execute({
      sql: "SELECT * FROM menu_items WHERE id = ? AND restaurant_id = ? AND available = 1",
      args: [line.menuItemId, restaurantId],
    });
    const item = itemRes.rows[0] as Row | undefined;
    if (!item) return c.json({ error: "item_unavailable", message: "One of the items in your cart is no longer available" }, 409);

    const optionsRes = demoItems ? { rows: demoItems.find((item) => item.id === line.menuItemId)!.options } : await db.execute({
      sql: "SELECT * FROM menu_item_options WHERE menu_item_id = ? ORDER BY sort_order",
      args: [item.id as string],
    });
    const options = optionsRes.rows as Row[];
    const requestedChoiceIds = new Set(line.choiceIds ?? []);
    let unitPrice = item.price as number;
    const chosenNames: string[] = [];

    for (const option of options) {
      const choicesRes = demoItems ? { rows: (option.choices as Row[]) } : await db.execute({
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
      menuItemId:line.menuItemId,
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
    if (bundleWith) {
      const firstPickupKm = haversineKm(Number(bundleWith.pickup_lat), Number(bundleWith.pickup_lng), restaurantLat, restaurantLng);
      const finalLegKm = haversineKm(restaurantLat, restaurantLng, d.destinationLat, d.destinationLng);
      distanceKm = firstPickupKm + finalLegKm;
      const routeFee = roundFare(distanceKm * deliveryRatePerKm, minimumDeliveryFee);
      bundleExtraFee = Math.max(0, routeFee - Number(bundleWith.delivery_fee ?? 0));
      deliveryFee = bundleExtraFee;
      // Keep the existing unpaid order as the deterministic bundle lead.
      deliveryBundleId = String(bundleWith.id);
    } else {
      distanceKm = haversineKm(restaurantLat, restaurantLng, d.destinationLat, d.destinationLng);
      deliveryFee = roundFare(distanceKm * deliveryRatePerKm, minimumDeliveryFee);
    }
  } else {
    if (bundleWith) return c.json({ error: "bundle_location_required", message: "Both pickup locations and your delivery location need map coordinates to calculate the added route fee." }, 400);
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
  if (demoRestaurant && !await ensureSandboxDemoRestaurant(demoRestaurant)) {
    return c.json({ error: "demo_restaurant_unavailable", message: "This sandbox restaurant is unavailable. Try another demo menu." }, 409);
  }
  await db.execute({
    sql: "INSERT INTO lists (id, customer_id, title, status, environment) VALUES (?, ?, ?, 'active', ?)",
    args: [listId, user.sub, restaurant.name as string, environment],
  });

  const tracksMenuItems=await hasColumn("list_items","source_menu_item_id");
  for (const li of lineItems) {
    await db.execute({
      sql: `INSERT INTO list_items (id, list_id, name, quantity, unit_price${tracksMenuItems?",source_menu_item_id":""}) VALUES (?, ?, ?, ?, ?${tracksMenuItems?",?":""})`,
      args: [newId("item"), listId, li.name, li.quantity, li.unitPrice,...(tracksMenuItems?[li.menuItemId]:[])],
    });
  }

  const orderId = newId("ord");
  const supportsBundleHold = await hasColumn("orders", "delivery_bundle_hold");
  const holdForPickupChoice = supportsBundleHold && restaurantLat != null && restaurantLng != null && d.destinationLat != null && d.destinationLng != null ? 1 : 0;
  await db.execute({
    sql: `INSERT INTO orders (
            id, list_id, customer_id, stage, type, payment_rail, estimated_total, delivery_fee,
            pickup_area, pickup_address, pickup_lat, pickup_lng,
            destination_area, destination_address, destination_lat, destination_lng, distance_km,
            matching_mode, matching_deadline_at, environment, restaurant_id${supportsBundleHold ? ",delivery_bundle_hold" : ""}
          )
          VALUES (?, ?, ?, 'Create', 'shopping', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${supportsBundleHold ? ",?" : ""})`,
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
      ...(supportsBundleHold ? [holdForPickupChoice] : []),
    ],
  });
  if (bundleWith && deliveryBundleId) {
    // Link both seller orders together only while the first is still unpaid
    // and available. A rider cannot be split across the two pickups.
    const changes = await executeBatch([
      { sql: "UPDATE orders SET delivery_bundle_id=?,delivery_bundle_hold=0,updated_at=datetime('now') WHERE id=? AND customer_id=? AND stage='Create' AND rider_id IS NULL AND delivery_bundle_id IS NULL AND delivery_bundle_hold=1 AND created_at>datetime('now','-30 minutes') AND NOT EXISTS(SELECT 1 FROM payments WHERE order_id=?)", args: [deliveryBundleId, bundleWith.id, user.sub, bundleWith.id] },
      { sql: "UPDATE orders SET delivery_bundle_id=?,delivery_bundle_hold=0 WHERE id=? AND EXISTS(SELECT 1 FROM orders WHERE id=? AND delivery_bundle_id=?)", args: [deliveryBundleId, orderId, bundleWith.id, deliveryBundleId] },
    ]);
    if (changes[0] === 0 || changes[1] === 0) {
      await db.execute({ sql: "UPDATE orders SET stage='Cancelled',updated_at=datetime('now') WHERE id=? AND rider_id IS NULL", args: [orderId] });
      return c.json({ error: "bundle_order_unavailable", message: "That order has already moved forward. Please check out separately." }, 409);
    }
  }
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
