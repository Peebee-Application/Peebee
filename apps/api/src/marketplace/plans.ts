import type { Context, Next } from "hono";
import { db } from "../db/client.js";
import { getOptions } from "../lib/option-settings.js";
import { hasColumn } from "../lib/schema.js";
import { getMarketplaceSettings, type MarketplaceSettings } from "../lib/settings.js";

type Row = Record<string, unknown>;

export type Plan = "merchant" | "pro_store" | "pro_live" | "elite";

export type StorePlan = {
  plan: Plan;
  isElite: boolean;
  isPaidTier: boolean;
  /** The end of the plan that is in force now, or null when it has no end (or the plan is the plain Merchant one). */
  expiresAt: string | null;
  daysLeft: number | null;
  /** Access kept from before plans were enforced. */
  legacy: boolean;
};

const live = (expires: unknown, now: number): boolean => {
  if (expires == null || expires === "") return true;
  const t = Date.parse(String(expires).includes("T") || String(expires).endsWith("Z") ? String(expires) : `${String(expires).replace(" ", "T")}Z`);
  return Number.isFinite(t) ? t > now : false;
};

const iso = (expires: unknown): string | null => {
  if (expires == null || expires === "") return null;
  const raw = String(expires);
  const t = Date.parse(raw.includes("T") || raw.endsWith("Z") ? raw : `${raw.replace(" ", "T")}Z`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/**
 * What a store is entitled to right now, from what it has bought (and when that runs out). The one place this is
 * decided: limits, commission and the Elite-only endpoints all ask here.
 *
 * Until the plans migration is applied, or for a store kept on its legacy access, the old rule holds: with free pricing
 * every store has everything.
 */
export async function storePlan(store: Row, settingsIn?: MarketplaceSettings, now = Date.now()): Promise<StorePlan> {
  const settings = settingsIn ?? (await getMarketplaceSettings());
  const hasPlanCol = await hasColumn("stores", "plan_legacy");
  const hasEliteCol = await hasColumn("stores", "elite_tier");
  const keepLegacy = hasPlanCol && Number(store.plan_legacy) === 1
    ? String((await getOptions(["merchant_plan_legacy_access"])).merchant_plan_legacy_access) === "keep_access"
    : false;

  if (!hasPlanCol || keepLegacy) {
    const free = settings.proPricingMode === "free";
    const elite = free ? Boolean(settings.eliteEnabled) : hasEliteCol && Number(store.elite_tier || 0) === 1;
    return {
      plan: elite ? "elite" : free ? "pro_live" : ((store.pro_tier as Plan) || "merchant"),
      isElite: elite, isPaidTier: true, expiresAt: null, daysLeft: null, legacy: true,
    };
  }

  const elitePaid = hasEliteCol && Number(store.elite_tier || 0) === 1 && live(store.elite_expires_at, now) && Boolean(settings.eliteEnabled);
  const proPaid = (store.pro_tier === "pro_store" || store.pro_tier === "pro_live") && live(store.pro_expires_at, now);
  const plan: Plan = elitePaid ? "elite" : proPaid ? (store.pro_tier as Plan) : "merchant";
  const expiresAt = plan === "elite" ? iso(store.elite_expires_at) : plan === "merchant" ? null : iso(store.pro_expires_at);
  const daysLeft = expiresAt ? Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 86400000)) : null;
  return { plan, isElite: plan === "elite", isPaidTier: plan !== "merchant", expiresAt, daysLeft, legacy: false };
}

export type PlanLimits = { products: number; collections: number; discounts: number; commissionPercent: number };

export async function planLimits(p: StorePlan, settings?: MarketplaceSettings): Promise<PlanLimits> {
  const s = settings ?? (await getMarketplaceSettings());
  if (p.isElite) return { products: s.eliteMaxProducts, collections: s.eliteMaxCollections, discounts: s.eliteMaxDiscounts, commissionPercent: s.eliteCommissionPercent };
  if (p.isPaidTier) return { products: s.proMaxProducts, collections: s.proMaxCollections, discounts: s.proMaxDiscounts, commissionPercent: s.commissionPercent };
  const o = await getOptions(["merchant_plan_free_max_products", "merchant_plan_free_max_collections", "merchant_plan_free_max_discounts"]);
  return {
    products: Number(o.merchant_plan_free_max_products), collections: Number(o.merchant_plan_free_max_collections),
    discounts: Number(o.merchant_plan_free_max_discounts), commissionPercent: s.commissionPercent,
  };
}

/** The signed-in merchant's store, if they have one (the first merchant they belong to). */
export async function storeOfUser(userId: string, merchantId?: string): Promise<Row | null> {
  const res = await db.execute({
    sql: `SELECT s.* FROM merchant_members mm JOIN stores s ON s.merchant_id = mm.merchant_id
          WHERE mm.user_id = ? AND mm.status = 'active' AND (? IS NULL OR mm.merchant_id = ?)
          ORDER BY CASE mm.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1`,
    args: [userId, merchantId ?? null, merchantId ?? null],
  });
  return (res.rows[0] as Row | undefined) ?? null;
}

/** For the Elite-only endpoints: a store without an active Elite plan is told what it needs, not given a vague error. */
export async function eliteOnly(c: Context, next: Next): Promise<Response | void> {
  const user = c.get("user") as { sub: string } | undefined;
  const store = user ? await storeOfUser(user.sub, c.req.header("X-Merchant-Id")) : null;
  if (!store) return next(); // the route itself answers "no store"
  const p = await storePlan(store);
  if (!p.isElite) {
    return c.json({ error: "plan_required", requiredPlan: "elite", plan: p.plan, message: "This is part of Merchant Elite. Upgrade your plan in the Store tab to use it." }, 403);
  }
  return next();
}
