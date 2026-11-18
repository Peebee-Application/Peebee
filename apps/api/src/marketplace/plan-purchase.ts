/**
 * Turning a paid (or free) plan purchase into the store's plan: the money, the ledger entry, the new plan and the
 * subscription receipt are written together or not at all. Shared by the verified plan checkout (./plan-checkout.ts)
 * and the older direct route kept for local development.
 */

import { db, executeBatch, type DbStatement } from "../db/client.js";
import { postLedgerTransaction } from "../ledger/service.js";
import { newId } from "../lib/ids.js";
import { hasColumn } from "../lib/schema.js";
import type { MarketplaceSettings, PlatformEnvironment } from "../lib/settings.js";
import { creditWallet, debitWallet } from "../wallet/service.js";

type Row = Record<string, unknown>;

export type PaidTier = "pro_store" | "pro_live" | "elite";
export type PlanTier = "merchant" | PaidTier;

export const PLAN_RANK: Record<string, number> = { merchant: 0, pro_store: 1, pro_live: 2, elite: 3 };
export const PLAN_LABEL: Record<string, string> = {
  merchant: "Merchant", pro_store: "Merchant Pro (Store)", pro_live: "Merchant Pro (Live)", elite: "Merchant Elite",
};

export const periodDays = (cycle: "monthly" | "yearly") => (cycle === "yearly" ? 365 : 30);

/** The admin's price for a plan and billing period; 0 while plan pricing is in its free mode. */
export function planPrice(settings: MarketplaceSettings, tier: PlanTier, cycle: "monthly" | "yearly"): number {
  if (tier === "merchant") return 0;
  if (settings.proPricingMode === "free") return 0;
  const base = tier === "elite" ? settings.elitePriceUgx : tier === "pro_live" ? settings.proLivePriceUgx : settings.proStorePriceUgx;
  return cycle === "yearly" ? base * 10 : base;
}

const toMs = (value: unknown): number => {
  if (value == null || value === "") return NaN;
  const raw = String(value);
  return Date.parse(raw.includes("T") || raw.endsWith("Z") ? raw : `${raw.replace(" ", "T")}Z`);
};

/**
 * What the unused part of the plan in force is worth: the money actually paid for it, spread evenly over the time it
 * covers. A free period is worth nothing, so while plans are free there is never a credit.
 */
export async function unusedCredit(storeId: string, currentPlan: string, now = Date.now()): Promise<{ credit: number; days: number }> {
  const planCol = await hasColumn("store_subscriptions", "plan");
  const res = await db.execute({
    sql: `SELECT amount_paid, starts_at, expires_at, ${planCol ? "plan" : "tier AS plan"} FROM store_subscriptions
          WHERE store_id = ? AND status = 'active'`,
    args: [storeId],
  });
  const rows = (res.rows as Row[]).filter((r) => (String(r.plan ?? "") || "pro_live") === currentPlan && toMs(r.expires_at) > now);
  if (rows.length === 0) return { credit: 0, days: 0 };
  const paid = rows.reduce((sum, r) => sum + (Number(r.amount_paid) || 0), 0);
  const start = Math.min(...rows.map((r) => toMs(r.starts_at)).filter(Number.isFinite));
  const end = Math.max(...rows.map((r) => toMs(r.expires_at)));
  const span = end - start;
  const remaining = Math.max(0, end - now);
  const days = Math.floor(remaining / 86_400_000);
  if (!(span > 0) || paid <= 0) return { credit: 0, days };
  return { credit: Math.max(0, Math.floor((paid * remaining) / span)), days };
}

export type PurchaseResult =
  | { ok: true; subscriptionId: string; balance: number | null }
  | { ok: false; error: "insufficient_wallet" | "plan_change_failed"; neededUgx?: number };

/**
 * Takes `amount` from the owner's wallet (when above zero) and switches the store to `tier` until `expiresAt`.
 * `extra` statements (the checkout row's own update) are committed in the same batch as the plan change.
 */
export async function applyPlanPurchase(input: {
  store: Row;
  merchantId: string;
  userId: string;
  tier: PaidTier;
  billingCycle: "monthly" | "yearly";
  amount: number;
  expiresAt: string;
  environment: PlatformEnvironment;
  idempotencyKey?: string;
  /** Close earlier subscriptions (an upgrade replaces the plan in force; a renewal adds to it). */
  replaceExisting?: boolean;
  extra?: (subscriptionId: string) => DbStatement[];
}): Promise<PurchaseResult> {
  const { store, merchantId, userId, tier, billingCycle, amount, expiresAt, environment } = input;
  const hasEliteCol = await hasColumn("stores", "elite_tier");
  const hasLegacyCol = await hasColumn("stores", "plan_legacy");
  const subId = newId("sub");
  const label = PLAN_LABEL[tier];

  let balance: number | null = null;
  if (amount > 0) {
    balance = await debitWallet(userId, amount, { type: "order_payment", environment, note: `Peebee plan: ${label} (${billingCycle})` });
    if (balance === null) return { ok: false, error: "insufficient_wallet", neededUgx: amount };
  }

  const statements: DbStatement[] = [];
  if (input.replaceExisting) {
    statements.push({ sql: "UPDATE store_subscriptions SET status = 'canceled' WHERE store_id = ? AND status = 'active'", args: [String(store.id)] });
  }
  // A store that chooses a plan leaves its legacy access behind: from now on it follows what it bought.
  const legacy = hasLegacyCol ? ", plan_legacy = 0" : "";
  if (tier === "elite") {
    statements.push(hasEliteCol
      ? { sql: `UPDATE stores SET pro_tier = 'pro_live', pro_expires_at = ?, elite_tier = 1, elite_expires_at = ?${legacy}, updated_at = datetime('now') WHERE id = ?`, args: [expiresAt, expiresAt, String(store.id)] }
      : { sql: `UPDATE stores SET pro_tier = 'pro_live', pro_expires_at = ?${legacy}, updated_at = datetime('now') WHERE id = ?`, args: [expiresAt, String(store.id)] });
  } else {
    statements.push(hasEliteCol
      ? { sql: `UPDATE stores SET pro_tier = ?, pro_expires_at = ?, elite_tier = 0${legacy}, updated_at = datetime('now') WHERE id = ?`, args: [tier, expiresAt, String(store.id)] }
      : { sql: `UPDATE stores SET pro_tier = ?, pro_expires_at = ?${legacy}, updated_at = datetime('now') WHERE id = ?`, args: [tier, expiresAt, String(store.id)] });
  }
  // store_subscriptions.tier can only hold the two Pro tiers, so Elite is filed under pro_live and named in `plan`.
  const subTier = tier === "elite" ? "pro_live" : tier;
  statements.push((await hasColumn("store_subscriptions", "plan"))
    ? { sql: "INSERT INTO store_subscriptions (id, store_id, merchant_id, tier, plan, amount_paid, billing_cycle, status, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)", args: [subId, String(store.id), merchantId, subTier, tier, amount, billingCycle, expiresAt] }
    : { sql: "INSERT INTO store_subscriptions (id, store_id, merchant_id, tier, amount_paid, billing_cycle, status, expires_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)", args: [subId, String(store.id), merchantId, subTier, amount, billingCycle, expiresAt] });
  statements.push(...(input.extra?.(subId) ?? []));

  try {
    if (amount > 0) {
      await postLedgerTransaction({
        kind: "merchant_plan", idempotencyKey: input.idempotencyKey ?? `merchant-plan:${subId}`, environment,
        referenceType: "store_subscription", referenceId: subId, description: `Peebee plan: ${label}`, actorId: userId,
        postings: [
          { ownerType: "customer", ownerId: userId, purpose: "wallet_payable", environment, amount: -amount },
          { ownerType: "platform", ownerId: "peebee", purpose: "merchant_plan_revenue", environment, amount },
        ],
        additionalStatements: statements,
      });
    } else {
      await executeBatch(statements);
    }
  } catch (err) {
    if (amount > 0) await creditWallet(userId, amount, { type: "refund", environment, note: `Refund: ${label}` }).catch(() => undefined);
    console.error("plan purchase failed", err);
    return { ok: false, error: "plan_change_failed" };
  }
  return { ok: true, subscriptionId: subId, balance };
}
