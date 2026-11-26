import { OFFER_KINDS, OFFER_SERVICES, pickOffers, loyaltyTierFor, DEFAULT_CREDIT_CONFIG, DEFAULT_DISCOUNT_WALLET_CONFIG, DEFAULT_INCENTIVE_CONFIG, DEFAULT_OFFERS_CONFIG } from "@peebee/shared";
import { Hono } from "hono";
import { z } from "zod";
import { logActivity } from "../admin/activity.js";
import { requirePermission } from "../admin/permissions.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { clientIp } from "../lib/ratelimit.js";
import { hasTable } from "../lib/schema.js";
import { getPlatformEnvironment } from "../lib/settings.js";
import { resolveCustomerByIdentifier } from "../wallet/service.js";
import { configKinds, getCreditConfig, getDiscountWalletConfig, getIncentiveConfig, getOffersConfig, saveConfig, type ConfigKind } from "./config.js";
import { creditAvailable, getCreditBalance, grantCredit } from "./credit.js";
import { debitWalletAllowNegative } from "../wallet/service.js";
import { discountWalletAvailable, markPaidExternally, payOutToActiveWallet } from "./discount-wallet.js";
import { holderOf, incentivesAvailable, spentThisMonth } from "./incentives.js";
import { customerProfile, getOffer, listOffers, offersAvailable, sweepStaleReservations } from "./service.js";

type Row = Record<string, unknown>;

/** Admin → Offers. Everything here changes how money moves, so it needs the payments permission and leaves an activity-log entry. */
export const offersAdminRoutes = new Hono();
offersAdminRoutes.use("/admin/offers/*", requireAuth, requireRole("admin"), requirePermission("payments.manage"));

const log = (c: Parameters<typeof clientIp>[0], action: string, summary: string, extra: { entityType?: string; entityId?: string; before?: unknown; after?: unknown } = {}) =>
  logActivity({ actor: c.get("user"), action, summary, ip: clientIp(c), ...extra });

offersAdminRoutes.get("/admin/offers/config", async (c) => {
  const [offers, discountWallet, incentives, credit, a, b, d, e] = await Promise.all([
    getOffersConfig(), getDiscountWalletConfig(), getIncentiveConfig(), getCreditConfig(),
    offersAvailable(), discountWalletAvailable(), incentivesAvailable(), creditAvailable(),
  ]);
  return c.json({
    offers, discountWallet, incentives, credit,
    available: { offers: a, discountWallet: b, incentives: d, credit: e },
    defaults: { offers: DEFAULT_OFFERS_CONFIG, discountWallet: DEFAULT_DISCOUNT_WALLET_CONFIG, incentives: DEFAULT_INCENTIVE_CONFIG, credit: DEFAULT_CREDIT_CONFIG },
  });
});

offersAdminRoutes.put("/admin/offers/config/:kind", async (c) => {
  const kind = c.req.param("kind") as ConfigKind;
  if (!(kind in configKinds)) return c.json({ error: "not_found" }, 404);
  const before = await configKinds[kind].load();
  const saved = await saveConfig(kind, await c.req.json().catch(() => null));
  if (!saved.ok) return c.json({ error: "invalid_body", issues: saved.issues }, 400);
  await log(c, `offers.config.${kind}`, `Changed the ${kind} settings in Offers`, { entityType: "offers_config", entityId: kind, before, after: saved.value });
  return c.json({ [kind]: saved.value });
});

// --- customer offers -----------------------------------------------------------

const windowSchema = z.object({ days: z.array(z.number().int().min(0).max(6)).max(7), from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) });
const offerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).default(""),
  code: z.string().trim().max(30).regex(/^[A-Za-z0-9_-]*$/).nullable().optional(),
  kind: z.enum(OFFER_KINDS),
  discountType: z.enum(["percent", "flat"]),
  value: z.number().min(0).max(100_000_000),
  maxDiscount: z.number().int().min(0).max(100_000_000).default(0),
  minFare: z.number().int().min(0).max(100_000_000).default(0),
  services: z.array(z.enum(OFFER_SERVICES)).max(4).default([]),
  funder: z.enum(["platform", "rider"]).default("platform"),
  autoApply: z.boolean().default(true),
  stackable: z.boolean().default(false),
  status: z.enum(["active", "paused", "draft"]).default("draft"),
  startsAt: z.string().datetime({ offset: true }).nullable().optional(),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  usageLimitTotal: z.number().int().min(0).max(100_000_000).default(0),
  usageLimitPerUser: z.number().int().min(0).max(100_000).default(0),
  budgetTotal: z.number().int().min(0).max(1_000_000_000).default(0),
  priority: z.number().int().min(-1000).max(1000).default(0),
  conditions: z
    .object({
      windows: z.array(windowSchema).max(14).optional(),
      zones: z.array(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), radiusKm: z.number().min(0.1).max(500), label: z.string().trim().max(80) })).max(50).optional(),
      zoneMatch: z.enum(["pickup", "dropoff", "either"]).optional(),
      nth: z.number().int().min(2).max(1000).optional(),
      carTiers: z.array(z.enum(["convenient", "comfort", "xl"])).max(3).optional(),
      loyaltyTiers: z.array(z.string().trim().max(30)).max(10).optional(),
      groups: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
      inactiveDays: z.number().int().min(1).max(730).optional(),
      dates: z.array(z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)).max(60).optional(),
      birthday: z.boolean().optional(),
      packRides: z.number().int().min(1).max(1000).optional(),
      packPrice: z.number().int().min(0).max(100_000_000).optional(),
    })
    .prefault({}),
}).superRefine((o, ctx) => {
  if (o.discountType === "percent" && o.value > 100) ctx.addIssue({ code: "custom", path: ["value"], message: "A percentage can't be more than 100." });
  if (o.kind === "promo_code" && !o.code) ctx.addIssue({ code: "custom", path: ["code"], message: "A promo code offer needs a code." });
  if (o.kind === "nth_ride" && !o.conditions.nth) ctx.addIssue({ code: "custom", path: ["conditions", "nth"], message: "Say which ride (every 5th, ...)." });
  if ((o.kind === "time_window" || o.kind === "flash") && !o.conditions.windows?.length) ctx.addIssue({ code: "custom", path: ["conditions", "windows"], message: "Add at least one time window." });
  if (o.kind === "route_zone" && !o.conditions.zones?.length) ctx.addIssue({ code: "custom", path: ["conditions", "zones"], message: "Add at least one zone." });
  if (o.kind === "vehicle_type" && !o.conditions.carTiers?.length) ctx.addIssue({ code: "custom", path: ["conditions", "carTiers"], message: "Choose a car type." });
  if (o.kind === "loyalty_tier" && !o.conditions.loyaltyTiers?.length) ctx.addIssue({ code: "custom", path: ["conditions", "loyaltyTiers"], message: "Choose a tier." });
  if (o.kind === "group" && !o.conditions.groups?.length) ctx.addIssue({ code: "custom", path: ["conditions", "groups"], message: "Name at least one group." });
  if (o.kind === "birthday_event" && !o.conditions.birthday && !o.conditions.dates?.length) ctx.addIssue({ code: "custom", path: ["conditions", "dates"], message: "Pick birthdays or add dates." });
  if (o.startsAt && o.endsAt && new Date(o.endsAt) <= new Date(o.startsAt)) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "The end must be after the start." });
});

const offerArgs = (o: z.infer<typeof offerSchema>) => [
  o.name, o.description, o.code ? o.code.toUpperCase() : null, o.kind, o.discountType, Math.round(o.value), o.maxDiscount, o.minFare, JSON.stringify(o.services), o.funder,
  o.autoApply ? 1 : 0, o.stackable ? 1 : 0, o.status, o.startsAt ?? null, o.endsAt ?? null, o.usageLimitTotal, o.usageLimitPerUser, o.budgetTotal, o.priority, JSON.stringify(o.conditions),
];

const needsMigration = (c: Parameters<typeof clientIp>[0]) => c.json({ error: "migration_pending", message: "Apply migration 0147 to use offers." }, 503);

offersAdminRoutes.get("/admin/offers", async (c) => c.json({ offers: await listOffers(), available: await offersAvailable() }));

offersAdminRoutes.post("/admin/offers", async (c) => {
  if (!(await offersAvailable())) return needsMigration(c);
  const parsed = offerSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const id = newId("off");
  try {
    await db.execute({
      sql: `INSERT INTO offers (id, name, description, code, kind, discount_type, value, max_discount, min_fare, services, funder, auto_apply, stackable, status, starts_at, ends_at,
              usage_limit_total, usage_limit_per_user, budget_total, priority, conditions, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, ...offerArgs(parsed.data), c.get("user").sub],
    });
  } catch (err) {
    if (String(err).includes("UNIQUE")) return c.json({ error: "code_taken", message: "That code is already used by another offer." }, 409);
    throw err;
  }
  await log(c, "offers.create", `Created the offer “${parsed.data.name}”`, { entityType: "offer", entityId: id, after: parsed.data });
  return c.json({ offer: await getOffer(id) }, 201);
});

offersAdminRoutes.patch("/admin/offers/:id", async (c) => {
  if (!(await offersAvailable())) return needsMigration(c);
  const id = c.req.param("id");
  const before = await getOffer(id);
  if (!before) return c.json({ error: "not_found" }, 404);
  const parsed = offerSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  try {
    await db.execute({
      sql: `UPDATE offers SET name = ?, description = ?, code = ?, kind = ?, discount_type = ?, value = ?, max_discount = ?, min_fare = ?, services = ?, funder = ?, auto_apply = ?, stackable = ?,
              status = ?, starts_at = ?, ends_at = ?, usage_limit_total = ?, usage_limit_per_user = ?, budget_total = ?, priority = ?, conditions = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [...offerArgs(parsed.data), id],
    });
  } catch (err) {
    if (String(err).includes("UNIQUE")) return c.json({ error: "code_taken", message: "That code is already used by another offer." }, 409);
    throw err;
  }
  await log(c, "offers.update", `Changed the offer “${parsed.data.name}”`, { entityType: "offer", entityId: id, before, after: parsed.data });
  return c.json({ offer: await getOffer(id) });
});

offersAdminRoutes.post("/admin/offers/:id/status", async (c) => {
  if (!(await offersAvailable())) return needsMigration(c);
  const id = c.req.param("id");
  const parsed = z.object({ status: z.enum(["active", "paused", "draft"]) }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const before = await getOffer(id);
  if (!before) return c.json({ error: "not_found" }, 404);
  await db.execute({ sql: "UPDATE offers SET status = ?, updated_at = datetime('now') WHERE id = ?", args: [parsed.data.status, id] });
  await log(c, "offers.status", `Set the offer “${before.name}” to ${parsed.data.status}`, { entityType: "offer", entityId: id, before: { status: before.status }, after: { status: parsed.data.status } });
  return c.json({ offer: await getOffer(id) });
});

offersAdminRoutes.delete("/admin/offers/:id", async (c) => {
  if (!(await offersAvailable())) return needsMigration(c);
  const id = c.req.param("id");
  const offer = await getOffer(id);
  if (!offer) return c.json({ error: "not_found" }, 404);
  // An offer that was ever used stays on record (the books refer to it); it can only be paused.
  if (offer.redemptions > 0) return c.json({ error: "in_use", message: "This offer has been used, so it can't be deleted. Pause it instead." }, 409);
  await db.execute({ sql: "DELETE FROM offer_grants WHERE offer_id = ?", args: [id] });
  await db.execute({ sql: "DELETE FROM offers WHERE id = ?", args: [id] });
  await log(c, "offers.delete", `Deleted the offer “${offer.name}”`, { entityType: "offer", entityId: id, before: offer });
  return c.json({ ok: true });
});

offersAdminRoutes.get("/admin/offers/:id/redemptions", async (c) => {
  if (!(await offersAvailable())) return c.json({ redemptions: [] });
  const res = await db.execute({
    sql: `SELECT r.*, u.name AS customer_name FROM offer_redemptions r LEFT JOIN users u ON u.id = r.user_id WHERE r.offer_id = ? ORDER BY r.created_at DESC LIMIT 100`,
    args: [c.req.param("id")],
  });
  return c.json({ redemptions: res.rows });
});

/** Gives a customer ride-pack uses or a voucher for an offer. */
offersAdminRoutes.post("/admin/offers/:id/grants", async (c) => {
  if (!(await hasTable("offer_grants"))) return needsMigration(c);
  const offer = await getOffer(c.req.param("id"));
  if (!offer) return c.json({ error: "not_found" }, 404);
  const parsed = z.object({ customer: z.string().min(3).max(200), uses: z.number().int().min(1).max(1000), expiresAt: z.string().datetime({ offset: true }).nullable().optional() }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const user = await resolveCustomerByIdentifier(parsed.data.customer);
  if (!user) return c.json({ error: "customer_not_found", message: "No customer has that phone number or email." }, 404);
  await db.execute({ sql: "INSERT INTO offer_grants (id, offer_id, user_id, uses_left, source, expires_at) VALUES (?, ?, ?, ?, 'admin', ?)", args: [newId("grt"), offer.id, user.id, parsed.data.uses, parsed.data.expiresAt ?? null] });
  await log(c, "offers.grant", `Gave ${user.name} ${parsed.data.uses} use(s) of “${offer.name}”`, { entityType: "offer", entityId: offer.id, after: parsed.data });
  return c.json({ ok: true, customer: user });
});

/** What offers know about a customer beyond their rides: groups (student, corporate), tier override and birthday. */
offersAdminRoutes.put("/admin/offers/customers/:userId/profile", async (c) => {
  if (!(await hasTable("customer_offer_profiles"))) return needsMigration(c);
  const parsed = z.object({
    groups: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    loyaltyTierOverride: z.string().trim().max(30).nullable().optional(),
    birthday: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/).nullable().optional(),
  }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const userId = c.req.param("userId");
  await db.execute({
    sql: `INSERT INTO customer_offer_profiles (user_id, groups, loyalty_tier_override, birthday) VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET groups = excluded.groups, loyalty_tier_override = excluded.loyalty_tier_override, birthday = excluded.birthday, updated_at = datetime('now')`,
    args: [userId, JSON.stringify(parsed.data.groups), parsed.data.loyaltyTierOverride ?? null, parsed.data.birthday ?? null],
  });
  await log(c, "offers.customer_profile", `Changed offer groups for a customer`, { entityType: "user", entityId: userId, after: parsed.data });
  return c.json({ ok: true });
});

offersAdminRoutes.get("/admin/offers/customers/lookup", async (c) => {
  const user = await resolveCustomerByIdentifier(c.req.query("q") ?? "");
  if (!user) return c.json({ error: "customer_not_found" }, 404);
  const cfg = await getOffersConfig();
  const env = await getPlatformEnvironment();
  const profile = await customerProfile(user.id, env, cfg);
  return c.json({ customer: user, profile: { ...profile, lastRideAt: profile.lastRideAt?.toISOString() ?? null }, tiers: cfg.loyaltyTiers.map((t) => t.id), computedTier: loyaltyTierFor(profile.rideCount, cfg.loyaltyTiers) });
});

/** The admin's calculator: what would a ride cost with the offers that are live right now? */
offersAdminRoutes.post("/admin/offers/preview", async (c) => {
  const parsed = z.object({
    service: z.enum(OFFER_SERVICES),
    fare: z.number().int().min(0).max(100_000_000),
    carTier: z.enum(["convenient", "comfort", "xl"]).nullable().optional(),
    code: z.string().max(30).nullable().optional(),
    rideCount: z.number().int().min(0).default(0),
    daysSinceLastRide: z.number().min(0).nullable().optional(),
    groups: z.array(z.string()).default([]),
    at: z.string().datetime({ offset: true }).optional(),
    pickup: z.object({ lat: z.number(), lng: z.number() }).nullable().optional(),
    dropoff: z.object({ lat: z.number(), lng: z.number() }).nullable().optional(),
    referred: z.boolean().default(false),
  }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const d = parsed.data;
  const cfg = await getOffersConfig();
  const now = d.at ? new Date(d.at) : new Date();
  const result = pickOffers(
    await listOffers({ status: "active" }),
    {
      service: d.service, carTier: d.carTier ?? null, fare: d.fare, now, code: d.code, pickup: d.pickup, dropoff: d.dropoff, tzOffsetMinutes: cfg.tzOffsetMinutes,
      customer: {
        rideCount: d.rideCount, lastRideAt: d.daysSinceLastRide != null ? new Date(now.getTime() - d.daysSinceLastRide * 86_400_000) : d.rideCount > 0 ? now : null,
        loyaltyTier: loyaltyTierFor(d.rideCount, cfg.loyaltyTiers), groups: d.groups, birthday: null, referredBy: d.referred ? "preview" : null, usedByOffer: {}, grants: {},
      },
    },
    cfg.stacking,
  );
  return c.json({ ...result, fare: d.fare, payable: Math.max(0, d.fare - result.discount) });
});

// --- rider discount wallet ----------------------------------------------------------

offersAdminRoutes.get("/admin/offers/discount-wallet", async (c) => {
  if (!(await discountWalletAvailable())) return c.json({ available: false, totals: { riders: 0, outstanding: 0 }, top: [], requests: [], recent: [] });
  const [riders, drivers, requests, recent] = await Promise.all([
    db.execute({ sql: "SELECT r.user_id AS id, u.name, r.discount_wallet_balance AS live, r.discount_wallet_balance_sandbox AS sandbox FROM riders r JOIN users u ON u.id = r.user_id WHERE r.discount_wallet_balance > 0 OR r.discount_wallet_balance_sandbox > 0 ORDER BY r.discount_wallet_balance DESC LIMIT 50", args: [] }),
    db.execute({ sql: "SELECT id, name, discount_wallet_balance AS live, discount_wallet_balance_sandbox AS sandbox FROM users WHERE discount_wallet_balance > 0 OR discount_wallet_balance_sandbox > 0 ORDER BY discount_wallet_balance DESC LIMIT 50", args: [] }),
    db.execute({
      sql: `SELECT q.*, u.name FROM rider_discount_requests q LEFT JOIN users u ON u.id = q.rider_id WHERE q.status = 'pending' ORDER BY q.created_at ASC LIMIT 100`,
      args: [],
    }),
    db.execute({ sql: "SELECT l.*, u.name FROM rider_discount_ledger l LEFT JOIN users u ON u.id = l.rider_id ORDER BY l.created_at DESC LIMIT 40", args: [] }),
  ]);
  const top: Row[] = [...(riders.rows as Row[]).map((r): Row => ({ ...r, holder: "rider" })), ...(drivers.rows as Row[]).map((r): Row => ({ ...r, holder: "driver" }))].sort((a, b) => Number(b.live) - Number(a.live)).slice(0, 50);
  const outstanding = top.reduce((s, r) => s + Number(r.live), 0);
  return c.json({ available: true, totals: { riders: top.length, outstanding }, top, requests: requests.rows, recent: recent.rows });
});

/** A queued mobile-money payout has been sent by hand: take it off the rider's balance and close the request. */
offersAdminRoutes.post("/admin/offers/discount-wallet/requests/:id/paid", async (c) => {
  if (!(await discountWalletAvailable())) return needsMigration(c);
  const req = (await db.execute({ sql: "SELECT * FROM rider_discount_requests WHERE id = ? AND status = 'pending'", args: [c.req.param("id")] })).rows[0] as Row | undefined;
  if (!req) return c.json({ error: "not_found" }, 404);
  const riderId = String(req.rider_id);
  const env = req.environment === "sandbox" ? "sandbox" : "live";
  const holder = await holderOf(riderId);
  const col = env === "sandbox" ? "discount_wallet_balance_sandbox" : "discount_wallet_balance";
  const table = holder === "rider" ? "riders" : "users";
  const idCol = holder === "rider" ? "user_id" : "id";
  const bal = Number(((await db.execute({ sql: `SELECT ${col} AS b FROM ${table} WHERE ${idCol} = ?`, args: [riderId] })).rows[0] as Row | undefined)?.b ?? 0);
  const paid = await markPaidExternally({ holder, id: riderId, amount: bal, env, note: "Paid out by mobile money" });
  await db.execute({ sql: "UPDATE rider_discount_requests SET status = 'paid', updated_at = datetime('now') WHERE id = ?", args: [String(req.id)] });
  await log(c, "offers.discount_wallet.paid", `Marked a discount-wallet mobile-money payout of UGX ${paid.toLocaleString("en-UG")} as sent`, { entityType: "user", entityId: riderId, after: { paid } });
  return c.json({ paid });
});

/** Pay a rider's whole discount balance into their active wallet now. */
offersAdminRoutes.post("/admin/offers/discount-wallet/:riderId/pay-out", async (c) => {
  if (!(await discountWalletAvailable())) return needsMigration(c);
  const riderId = c.req.param("riderId");
  const env = await getPlatformEnvironment();
  const holder = await holderOf(riderId);
  const col = env === "sandbox" ? "discount_wallet_balance_sandbox" : "discount_wallet_balance";
  const table = holder === "rider" ? "riders" : "users";
  const idCol = holder === "rider" ? "user_id" : "id";
  const bal = Number(((await db.execute({ sql: `SELECT ${col} AS b FROM ${table} WHERE ${idCol} = ?`, args: [riderId] })).rows[0] as Row | undefined)?.b ?? 0);
  const paid = await payOutToActiveWallet({ holder, id: riderId, amount: bal, env, note: "Paid out by Peebee" });
  await log(c, "offers.discount_wallet.payout", `Paid UGX ${paid.toLocaleString("en-UG")} from a rider's discount wallet to their active wallet`, { entityType: "user", entityId: riderId, after: { paid } });
  return c.json({ paid });
});

// --- incentives and credit summaries ------------------------------------------------------

offersAdminRoutes.get("/admin/offers/incentives/summary", async (c) => {
  if (!(await incentivesAvailable())) return c.json({ available: false, spentThisMonth: 0, budget: 0, byKind: [], recent: [] });
  const cfg = await getIncentiveConfig();
  const env = await getPlatformEnvironment();
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 19).replace("T", " ");
  const [byKind, recent, spent] = await Promise.all([
    db.execute({ sql: "SELECT kind, COUNT(*) AS n, SUM(amount) AS total FROM rider_incentive_awards WHERE environment = ? AND kind <> 'sweep' AND created_at >= ? GROUP BY kind ORDER BY total DESC", args: [env, monthStart] }),
    db.execute({ sql: "SELECT a.*, u.name FROM rider_incentive_awards a LEFT JOIN users u ON u.id = a.rider_id WHERE a.kind <> 'sweep' AND a.environment = ? ORDER BY a.created_at DESC LIMIT 40", args: [env] }),
    spentThisMonth(env, new Date(), cfg.tzOffsetMinutes),
  ]);
  return c.json({ available: true, spentThisMonth: spent, budget: cfg.monthlyBudget, byKind: byKind.rows, recent: recent.rows });
});

offersAdminRoutes.get("/admin/offers/credit/summary", async (c) => {
  if (!(await creditAvailable())) return c.json({ available: false, outstanding: 0, holders: 0, recent: [] });
  const env = await getPlatformEnvironment();
  const col = env === "sandbox" ? "credit_balance_sandbox" : "credit_balance";
  const [totals, recent] = await Promise.all([
    db.execute({ sql: `SELECT COALESCE(SUM(${col}), 0) AS total, COUNT(*) AS n FROM users WHERE ${col} > 0`, args: [] }),
    db.execute({ sql: "SELECT l.*, u.name FROM credit_ledger l LEFT JOIN users u ON u.id = l.user_id WHERE l.environment = ? ORDER BY l.created_at DESC LIMIT 40", args: [env] }),
  ]);
  const t = totals.rows[0] as Row;
  return c.json({ available: true, outstanding: Number(t.total), holders: Number(t.n), recent: recent.rows });
});

offersAdminRoutes.post("/admin/offers/credit/grant", async (c) => {
  if (!(await creditAvailable())) return needsMigration(c);
  const parsed = z.object({
    customer: z.string().min(3).max(200),
    amount: z.number().int().min(100).max(10_000_000),
    note: z.string().trim().max(140).default("Credit from Peebee"),
    partnerId: z.string().trim().max(80).nullable().optional(),
    expiryDays: z.number().int().min(0).max(3650).optional(),
  }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const user = await resolveCustomerByIdentifier(parsed.data.customer);
  if (!user) return c.json({ error: "customer_not_found", message: "No customer has that phone number or email." }, 404);
  const env = await getPlatformEnvironment();
  const lot = await grantCredit({ userId: user.id, amount: parsed.data.amount, kind: "admin", env, partnerId: parsed.data.partnerId ?? null, note: parsed.data.note, expiryDays: parsed.data.expiryDays });
  if (!lot) return c.json({ error: "credit_off", message: "Wallet credit is switched off." }, 409);
  await log(c, "offers.credit.grant", `Gave ${user.name} UGX ${parsed.data.amount.toLocaleString("en-UG")} of wallet credit`, { entityType: "user", entityId: user.id, after: parsed.data });
  return c.json({ ok: true, customer: user });
});

/**
 * A top-up that turns out to be bad (charged back, paid twice, fraud): the cash comes back out of the wallet — which may go
 * below zero — and, if the admin has chosen so (Wallet credit → abuse protection), the bonus and fee cover it earned too.
 */
offersAdminRoutes.post("/admin/offers/credit/reverse-topup", async (c) => {
  const parsed = z.object({ topupId: z.string().min(3).max(80), reason: z.string().trim().max(140).default("Top-up reversed") }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const topup = (await db.execute({ sql: "SELECT * FROM wallet_topups WHERE id = ? AND status = 'successful'", args: [parsed.data.topupId] })).rows[0] as Row | undefined;
  if (!topup) return c.json({ error: "not_found", message: "No successful top-up with that id." }, 404);
  // The status flip is the lock: only one request can reverse a top-up.
  const claimed = await db.execute({ sql: "UPDATE wallet_topups SET status = 'failed', updated_at = datetime('now') WHERE id = ? AND status = 'successful'", args: [String(topup.id)] });
  if (!claimed.rowsAffected) return c.json({ error: "already_reversed" }, 409);
  const env = topup.environment === "sandbox" ? "sandbox" : "live";
  const userId = String(topup.user_id);
  const cash = Number(topup.cash_credited ?? topup.amount);
  await debitWalletAllowNegative(userId, cash, { type: "adjustment", environment: env, note: parsed.data.reason, actorId: c.get("user").sub, allowInactivePersonalWallet: true });
  let clawed = 0;
  const cfg = await getCreditConfig();
  if (cfg.withdrawal.clawbackOnReversal && (await creditAvailable())) {
    const lots = await db.execute({
      sql: `SELECT DISTINCT l.id, l.remaining FROM credit_lots l JOIN credit_ledger g ON g.lot_id = l.id WHERE g.topup_id = ? AND l.remaining > 0`,
      args: [String(topup.id)],
    });
    for (const lot of lots.rows as Row[]) {
      const left = Number(lot.remaining);
      const res = await db.execute({ sql: "UPDATE credit_lots SET remaining = 0 WHERE id = ? AND remaining = ?", args: [String(lot.id), left] });
      if (!res.rowsAffected) continue;
      const col = env === "sandbox" ? "credit_balance_sandbox" : "credit_balance";
      await db.execute({ sql: `UPDATE users SET ${col} = MAX(0, ${col} - ?) WHERE id = ?`, args: [left, userId] });
      await db.execute({
        sql: "INSERT INTO credit_ledger (id, user_id, type, amount, balance_after, lot_id, topup_id, note, environment) VALUES (?, ?, 'clawback', ?, ?, ?, ?, ?, ?)",
        args: [newId("cl"), userId, -left, await getCreditBalance(userId, env), String(lot.id), String(topup.id), parsed.data.reason, env],
      });
      clawed += left;
    }
  }
  await log(c, "offers.credit.reverse_topup", `Reversed a top-up of UGX ${Number(topup.amount).toLocaleString("en-UG")}${clawed ? ` and took back UGX ${clawed.toLocaleString("en-UG")} of bonus credit` : ""}`, { entityType: "wallet_topup", entityId: String(topup.id), after: { cash, clawed } });
  return c.json({ ok: true, cashReversed: cash, creditClawedBack: clawed });
});

offersAdminRoutes.post("/admin/offers/sweep", async (c) => {
  const released = await sweepStaleReservations();
  return c.json({ released });
});
