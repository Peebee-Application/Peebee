import { Hono, type Context } from "hono";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { hasColumn, hasTable } from "../lib/schema.js";
import { getMarketplaceSettings } from "../lib/settings.js";
import { ChannelsError, fail } from "../channels/common.js";
import { endLive, getLive, goLive, liveReady, myOpenLive, resolveLive, startLive } from "../channels/live.js";
import { getChannelsConfig } from "../channels/settings.js";
import { storeOfUser, storePlan } from "./plans.js";

/**
 * Going live from the merchant's phone camera, on the same pipeline creators use in the customer app
 * (channels/live.ts: the provider's live input, WHIP from the phone, a live post in the Spotlight). The store is the
 * publisher, and a `store_live_sessions` row with the same id carries the items pinned for sale, so Spotlight can
 * show them with a Buy button. Ending the stream, by the merchant or by the server's sweep, ends the listing.
 */
export const storeLiveCameraRoutes = new Hono();

type Row = Record<string, unknown>;
const MAX_PINS = 10;

async function myStore(c: Context): Promise<Row> {
  const store = await storeOfUser(c.get("user").sub, c.req.header("X-Merchant-Id") ?? undefined);
  if (!store) throw new ChannelsError("no_store", "Open your store first.", 404);
  return store;
}

/** Why this store cannot go live right now, or null when it can. */
async function blocker(store: Row): Promise<{ code: string; message: string; status: 403 | 503 } | null> {
  const settings = await getMarketplaceSettings();
  if (!settings.liveEnabled) return { code: "live_disabled", message: "Live selling is switched off for now.", status: 403 };
  const plan = await storePlan(store, settings);
  if (plan.plan !== "pro_live" && !plan.isElite) return { code: "plan_required", message: "Live selling needs Merchant Pro Live or Elite.", status: 403 };
  const cfg = await getChannelsConfig();
  if (!cfg.enabled || !cfg.live.enabled || !(await liveReady())) return { code: "live_unavailable", message: "Going live is not available yet.", status: 503 };
  if (!cfg.publishing.publishers.includes("store")) return { code: "publisher_unavailable", message: "Stores cannot go live yet.", status: 403 };
  return null;
}

async function gate(store: Row) {
  const b = await blocker(store);
  if (b) throw new ChannelsError(b.code, b.message, b.status);
}

/** Keeps only this store's own active items, in the order given, without repeats. */
async function ownItems(storeId: string, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids.map(String))].slice(0, MAX_PINS);
  if (!unique.length) return [];
  const marks = unique.map(() => "?").join(",");
  const rows = (await db.execute({ sql: `SELECT id FROM store_products WHERE store_id = ? AND status = 'active' AND id IN (${marks})`, args: [storeId, ...unique] })).rows as Row[];
  const ok = new Set(rows.map((r) => String(r.id)));
  return unique.filter((id) => ok.has(id));
}

/** The camera stream, if it is this store's and this person's. */
async function myStoreLive(c: Context, store: Row) {
  const s = await getLive(c.req.param("id") as string);
  if (!s || s.host_id !== c.get("user").sub || s.publisher_type !== "store" || s.publisher_id !== String(store.id)) throw new ChannelsError("not_found", "That stream was not found.", 404);
  return s;
}

async function setPins(liveId: string, postId: string, pins: string[]) {
  await db.execute({ sql: "UPDATE store_live_sessions SET featured_product_ids = ? WHERE id = ?", args: [JSON.stringify(pins), liveId] });
  // The live post points at the first pinned item, like any store post that tags a product.
  await db.execute({ sql: "UPDATE posts SET product_ref_type = ?, product_ref_id = ? WHERE id = ?", args: [pins.length ? "product" : null, pins[0] ?? null, postId] });
}

const pinsOf = (row: Row | undefined): string[] => {
  try {
    const v = JSON.parse(String(row?.featured_product_ids ?? "[]")) as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

const startSchema = z.object({ title: z.string().max(140).optional(), productIds: z.array(z.string().max(80)).max(50).optional() });
const pinsSchema = z.object({ productIds: z.array(z.string().max(80)).max(50) });

/** Whether the camera is available for this store, and a stream left open earlier (to pick up or end). */
storeLiveCameraRoutes.get("/merchants/me/store/live/camera", requireAuth, async (c) => {
  try {
    const store = await myStore(c);
    const b = await blocker(store);
    const open = b ? null : await myOpenLive(c.get("user").sub);
    let live = null;
    let productIds: string[] = [];
    if (open) {
      const s = await getLive(open.id);
      if (s && s.publisher_type === "store" && s.publisher_id === String(store.id)) {
        live = open;
        if (await hasTable("store_live_sessions")) productIds = pinsOf((await db.execute({ sql: "SELECT featured_product_ids FROM store_live_sessions WHERE id = ?", args: [s.id] })).rows[0] as Row | undefined);
      }
    }
    return c.json({ available: !b, reason: b?.code ?? null, message: b?.message ?? null, live, productIds });
  } catch (err) {
    return fail(c, err);
  }
});

/** Asks the provider for a live input (the same call creators use). Nothing is public until `go`. */
storeLiveCameraRoutes.post("/merchants/me/store/live/camera/start", requireAuth, async (c) => {
  try {
    const store = await myStore(c);
    await gate(store);
    const body = startSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "invalid_input", message: "Check the title." }, 400);
    const title = (body.data.title ?? "").trim() || `${String(store.name)} is live`;
    const live = await startLive(c.get("user"), { publisherType: "store", publisherId: String(store.id), title });
    const pins = await ownItems(String(store.id), body.data.productIds ?? []);
    if (pins.length) await db.execute({ sql: "UPDATE posts SET product_ref_type = 'product', product_ref_id = ? WHERE id = ?", args: [pins[0]!, live.postId] });
    return c.json({ live, productIds: pins });
  } catch (err) {
    return fail(c, err);
  }
});

/** The camera is connected: the stream goes public in the Spotlight, and the store shows as live with its pinned items. */
storeLiveCameraRoutes.post("/merchants/me/store/live/camera/:id/go", requireAuth, async (c) => {
  try {
    const store = await myStore(c);
    await gate(store);
    const s = await myStoreLive(c, store);
    const body = pinsSchema.partial().safeParse(await c.req.json().catch(() => ({})));
    const pins = await ownItems(String(store.id), body.success ? body.data.productIds ?? [] : []);
    const live = await goLive(c.get("user"), s.id);
    const storeId = String(store.id);
    const title = s.title || `${String(store.name)} is live`;
    // One live listing per store: a hosted-link listing (or an older stream) gives way to the camera.
    await db.execute({ sql: "UPDATE store_live_sessions SET status = 'ended', ended_at = datetime('now') WHERE store_id = ? AND status = 'live' AND id != ?", args: [storeId, s.id] });
    await db.execute({
      sql: `INSERT INTO store_live_sessions (id, store_id, title, status, stream_url, featured_product_ids, started_at)
            VALUES (?, ?, ?, 'live', ?, ?, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET status = 'live', stream_url = excluded.stream_url, featured_product_ids = excluded.featured_product_ids, ended_at = NULL`,
      args: [s.id, storeId, title, s.hls_url, JSON.stringify(pins)],
    });
    await setPins(s.id, s.post_id, pins);
    await db.execute({
      sql: "UPDATE stores SET is_live = 1, live_channel_title = ?, live_stream_url = ?, live_started_at = datetime('now'), live_viewer_count = 0 WHERE id = ?",
      args: [title, s.hls_url, storeId],
    });
    return c.json({ live, productIds: pins });
  } catch (err) {
    return fail(c, err);
  }
});

/** Changes the items for sale while live. The first one is shown first. */
storeLiveCameraRoutes.put("/merchants/me/store/live/camera/:id/items", requireAuth, async (c) => {
  try {
    const store = await myStore(c);
    const s = await myStoreLive(c, store);
    if (s.status === "ended") throw new ChannelsError("live_ended", "This stream has ended.", 409);
    const body = pinsSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_input", message: "Choose the items to sell." }, 400);
    const pins = await ownItems(String(store.id), body.data.productIds);
    if (s.status === "live") await setPins(s.id, s.post_id, pins);
    return c.json({ productIds: pins });
  } catch (err) {
    return fail(c, err);
  }
});

storeLiveCameraRoutes.post("/merchants/me/store/live/camera/:id/end", requireAuth, async (c) => {
  try {
    const store = await myStore(c);
    const s = await myStoreLive(c, store);
    return c.json(await endLive(c.get("user"), s.id));
  } catch (err) {
    return fail(c, err);
  }
});

/**
 * Public: the items a store is selling on a live stream, for the Spotlight's Buy strip. `ref` is the stream id or its
 * post's id. An ended stream returns no items.
 */
storeLiveCameraRoutes.get("/marketplace/live/:ref/items", async (c) => {
  try {
    if (!(await liveReady()) || !(await hasTable("store_live_sessions"))) return c.json({ status: "ended", store: null, items: [] });
    const s = await resolveLive(c.req.param("ref") as string);
    if (!s || s.publisher_type !== "store" || s.status === "ready") return c.json({ error: "not_found", message: "That stream was not found." }, 404);
    c.header("Cache-Control", "no-store");
    const store = (await db.execute({ sql: "SELECT id, name, slug, logo_url, category FROM stores WHERE id = ?", args: [s.publisher_id] })).rows[0] as Row | undefined;
    if (s.status !== "live" || !store) return c.json({ status: "ended", store: null, items: [] });
    const pins = pinsOf((await db.execute({ sql: "SELECT featured_product_ids FROM store_live_sessions WHERE id = ?", args: [s.id] })).rows[0] as Row | undefined);
    let items: Row[] = [];
    if (pins.length) {
      const showInApp = (await hasColumn("store_products", "show_in_app")) ? " AND COALESCE(show_in_app, 1) = 1" : "";
      const hasVariants = (await hasColumn("store_products", "has_variants")) ? "has_variants" : "0 AS has_variants";
      const rows = (await db.execute({
        sql: `SELECT id, title, price, compare_at_price, image_url, inventory_quantity, ${hasVariants} FROM store_products
              WHERE store_id = ? AND status = 'active'${showInApp} AND id IN (${pins.map(() => "?").join(",")})`,
        args: [String(store.id), ...pins],
      })).rows as Row[];
      const byId = new Map(rows.map((r) => [String(r.id), r]));
      items = pins.map((id) => byId.get(id)).filter((r): r is Row => !!r);
    }
    return c.json({
      status: "live",
      store: { id: String(store.id), name: String(store.name), slug: String(store.slug ?? ""), logo_url: store.logo_url ? String(store.logo_url) : "", category: String(store.category ?? "") },
      items: items.map((r) => ({
        id: String(r.id), title: String(r.title), price: Number(r.price) || 0,
        compare_at_price: r.compare_at_price == null ? null : Number(r.compare_at_price),
        image_url: r.image_url ? String(r.image_url) : "", in_stock: Number(r.inventory_quantity) > 0, has_variants: Number(r.has_variants) === 1,
      })),
    });
  } catch (err) {
    return fail(c, err);
  }
});
