/**
 * Verified plan checkout: Plans → Review → Pay → Verify → Done.
 *
 * A plan never changes with one tap. Every change — an upgrade, a renewal, a move down, even while plans are free —
 * is a checkout that the owner confirms with a six-digit code texted to their phone, and (when it costs anything) a
 * payment the server has seen succeed. Only then does the plan change.
 *
 * - Wallet: taken from the owner's Peebee wallet after the code is right.
 * - Mobile money / card: after the code, a collection is started as a wallet top-up (the same provider routing,
 *   webhooks and background settlement every top-up uses). When that top-up succeeds the plan price is taken from the
 *   wallet and the plan switches. A payment that lands after a cancelled checkout simply stays in the wallet.
 * - Free (UGX 0): the code alone confirms it.
 * - Moving down: confirmed with a code now, applied when the current plan ends, cancellable until then.
 *
 * Mid-plan upgrades get the unused part of what was paid for the current plan off the new price (admin option).
 * Verification is a six-digit SMS code; when text messages are unavailable it falls back to the owner's plan PIN
 * (set once, kept only as a keyed hash, locked after five wrong tries).
 * The throttles on codes (ten minutes of life, one a minute, five per checkout, five wrong guesses) are safety rails.
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import { normalizeUgandaMsisdn } from "@peebee/shared";
import { requireAuth } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { getOptions } from "../lib/option-settings.js";
import { hasTable } from "../lib/schema.js";
import { getMarketplaceSettings, getPlatformEnvironment, type MarketplaceSettings } from "../lib/settings.js";
import bcrypt from "bcryptjs";
import { consume } from "../lib/ratelimit.js";
import { initiateCollection, paymentMethodOptions, resolveProvider, paymentProviderErrorResponse, paymentProviderHttpStatus, UnsupportedNetworkError } from "../payments/service.js";
import { generateCode, hashCode, timingSafeEqual } from "../verify/otp.js";
import { isAfricasTalkingConfigured, sendVerificationSms } from "../verify/sms.js";
import { maskPhone } from "../wallet/mask.js";
import { settleCustomerTopup } from "../wallet/topup-settle.js";
import { PLAN_LABEL, PLAN_RANK, applyPlanPurchase, periodDays, planPrice, unusedCredit, type PaidTier } from "./plan-purchase.js";
import { storePlan, type StorePlan } from "./plans.js";

type Row = Record<string, unknown>;
type Tier = "merchant" | "pro_live" | "elite";
type Cycle = "monthly" | "yearly";
type Method = "wallet" | "mobile_money" | "card" | "free";

export const planCheckoutRoutes = new Hono();

const CODE_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_CODES_PER_CHECKOUT = 5;
const MAX_WRONG_ATTEMPTS = 5;
const DAY = 86_400_000;

const isDev = () => (process.env.ENVIRONMENT ?? "development") === "development";

function merchantAppUrl(): string {
  return process.env.MERCHANT_APP_URL ?? (isDev() ? "http://localhost:3005" : "https://merchant.peebee.online");
}

async function available(): Promise<boolean> {
  return hasTable("plan_checkouts");
}

function migrationPending(c: Context) {
  return c.json({ error: "migration_pending", message: "Plan checkout is being set up (0164_plan_checkout_store_items.sql is not applied yet)." }, 503);
}

type Owner = { userId: string; merchantId: string; store: Row; phone: string | null };

/** The owner's own store. Plans are paid from the owner's wallet and confirmed on the owner's phone, so only the owner may act. */
async function ownerOf(c: Context): Promise<Owner | Response> {
  const user = c.get("user") as { sub: string };
  const selected = c.req.header("X-Merchant-Id") ?? null;
  const member = (await db.execute({
    sql: "SELECT merchant_id, role FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, selected, selected],
  })).rows[0] as Row | undefined;
  if (!member) return c.json({ error: "no_merchant_membership" }, 403);
  if (String(member.role) !== "owner") return c.json({ error: "insufficient_role", message: "Only the business owner can change the plan." }, 403);
  const merchantId = String(member.merchant_id);
  const store = (await db.execute({ sql: "SELECT * FROM stores WHERE merchant_id = ? LIMIT 1", args: [merchantId] })).rows[0] as Row | undefined;
  if (!store) return c.json({ error: "no_store", message: "Open your store first, then choose a plan." }, 404);
  const phone = (await db.execute({ sql: "SELECT phone FROM users WHERE id = ?", args: [user.sub] })).rows[0]?.phone;
  return { userId: user.sub, merchantId, store, phone: phone ? String(phone) : null };
}

/** Plans this screen offers. Pro Store stays hidden; a store on it is shown as Pro. */
const visiblePlan = (plan: string): Tier => (plan === "elite" ? "elite" : plan === "merchant" ? "merchant" : "pro_live");


const PIN_MAX_WRONG = 5;
const PIN_LOCK_MINUTES = 15;

/** SMS when a text provider is connected (or local development); otherwise the owner's PIN. */
export function verifyChannel(): "sms" | "pin" {
  return isAfricasTalkingConfigured() || isDev() ? "sms" : "pin";
}

const pinHash = (userId: string, pin: string) => hashCode(`plan-pin:${userId}:${pin}`);

async function pinRow(userId: string): Promise<Row | undefined> {
  if (!(await hasTable("owner_pins"))) return undefined;
  return (await db.execute({ sql: "SELECT * FROM owner_pins WHERE user_id = ?", args: [userId] })).rows[0] as Row | undefined;
}

/** Checks a PIN, counting wrong guesses and locking after too many. */
async function checkPin(userId: string, pin: string): Promise<{ ok: true } | { ok: false; status: 400 | 409 | 429; error: string; message: string; attemptsLeft?: number }> {
  const row = await pinRow(userId);
  if (!row) return { ok: false, status: 409, error: "pin_required", message: "Set your plan PIN first." };
  if (row.locked_until && Date.parse(String(row.locked_until)) > Date.now()) {
    return { ok: false, status: 429, error: "pin_locked", message: "Too many wrong PINs. Try again later." };
  }
  if (!timingSafeEqual(await pinHash(userId, pin), String(row.pin_hash))) {
    const wrong = Number(row.failed_attempts) + 1;
    const lock = wrong >= PIN_MAX_WRONG ? new Date(Date.now() + PIN_LOCK_MINUTES * 60_000).toISOString() : null;
    await db.execute({ sql: "UPDATE owner_pins SET failed_attempts = ?, locked_until = ?, updated_at = datetime('now') WHERE user_id = ?", args: [lock ? 0 : wrong, lock, userId] });
    return lock
      ? { ok: false, status: 429, error: "pin_locked", message: "Too many wrong PINs. Try again later." }
      : { ok: false, status: 400, error: "wrong_pin", message: "That PIN isn't right.", attemptsLeft: PIN_MAX_WRONG - wrong };
  }
  if (Number(row.failed_attempts) > 0) await db.execute({ sql: "UPDATE owner_pins SET failed_attempts = 0, locked_until = NULL WHERE user_id = ?", args: [userId] });
  return { ok: true };
}

/** The payment modes the platform has switched on, read live, so plan payments offer exactly what other payments do. */
export async function activeMethods(): Promise<{ wallet: boolean; mobileMoney: boolean; card: boolean }> {
  const options = await paymentMethodOptions().catch(() => ({ card: { available: false, direct: false }, mobileMoney: { direct: false } }));
  let mobileMoney = true;
  try {
    await resolveProvider("collection");
  } catch {
    mobileMoney = false;
  }
  return { wallet: true, mobileMoney, card: Boolean(options.card.available) };
}

export type Quote = {
  kind: "upgrade" | "renew" | "downgrade";
  fromPlan: Tier | "legacy";
  tier: Tier;
  billingCycle: Cycle;
  listPrice: number;
  credit: number;
  creditDays: number;
  amount: number;
  /** For a move down: what the new plan will cost when it starts. */
  laterAmount: number;
  startsAt: string;
  expiresAt: string | null;
  free: boolean;
};

type QuoteError = { error: string; message: string; status: 400 | 403 | 409 };

export async function quoteFor(store: Row, settings: MarketplaceSettings, tier: Tier, cycle: Cycle, now = Date.now()): Promise<Quote | QuoteError> {
  if (tier === "elite" && !settings.eliteEnabled) return { error: "elite_tier_disabled", message: "Merchant Elite is paused by the platform for now.", status: 403 };
  const current: StorePlan = await storePlan(store, settings, now);
  const from = current.legacy ? "legacy" : visiblePlan(current.plan);
  const price = planPrice(settings, tier, cycle);
  const days = periodDays(cycle);
  const free = settings.proPricingMode === "free";
  const opts = await getOptions(["merchant_plan_upgrade_credit", "merchant_plan_downgrades"]);
  const base = { fromPlan: from, tier, billingCycle: cycle, listPrice: price, free } as const;

  // A store on its legacy access has no end date: whatever it picks starts now and replaces that access.
  if (current.legacy) {
    if (tier === "merchant") {
      return { ...base, kind: "downgrade", credit: 0, creditDays: 0, amount: 0, laterAmount: 0, startsAt: new Date(now).toISOString(), expiresAt: null };
    }
    return { ...base, kind: "upgrade", credit: 0, creditDays: 0, amount: price, laterAmount: 0, startsAt: new Date(now).toISOString(), expiresAt: new Date(now + days * DAY).toISOString() };
  }

  const curRank = PLAN_RANK[current.plan] ?? 0;
  const newRank = PLAN_RANK[tier];
  if (tier === "merchant" && current.plan === "merchant") return { error: "already_on_plan", message: "You're already on Merchant.", status: 409 };

  // Same plan: a renewal that adds a period to the end of the one in force.
  if (tier !== "merchant" && visiblePlan(current.plan) === tier && current.plan !== "pro_store") {
    const startMs = current.expiresAt && Date.parse(current.expiresAt) > now ? Date.parse(current.expiresAt) : now;
    return { ...base, kind: "renew", credit: 0, creditDays: 0, amount: price, laterAmount: 0, startsAt: new Date(startMs).toISOString(), expiresAt: new Date(startMs + days * DAY).toISOString() };
  }

  if (newRank > curRank) {
    const unused = opts.merchant_plan_upgrade_credit === false ? { credit: 0, days: 0 } : await unusedCredit(String(store.id), current.plan, now);
    const credit = Math.min(price, unused.credit);
    return { ...base, kind: "upgrade", credit, creditDays: unused.days, amount: price - credit, laterAmount: 0, startsAt: new Date(now).toISOString(), expiresAt: new Date(now + days * DAY).toISOString() };
  }

  if (opts.merchant_plan_downgrades === false) return { error: "downgrades_off", message: "Moving down a plan isn't available right now.", status: 403 };
  const startMs = current.expiresAt ? Math.max(now, Date.parse(current.expiresAt)) : now;
  return {
    ...base, kind: "downgrade", credit: 0, creditDays: 0, amount: 0, laterAmount: price,
    startsAt: new Date(startMs).toISOString(), expiresAt: tier === "merchant" ? null : new Date(startMs + days * DAY).toISOString(),
  };
}

function view(row: Row) {
  return {
    id: String(row.id),
    reference: String(row.reference),
    kind: String(row.kind),
    fromPlan: String(row.from_plan),
    tier: String(row.tier),
    billingCycle: String(row.billing_cycle),
    listPrice: Number(row.list_price) || 0,
    credit: Number(row.credit) || 0,
    amount: Number(row.amount) || 0,
    method: String(row.method),
    status: String(row.status),
    startsAt: row.starts_at ? String(row.starts_at) : null,
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    failure: row.failure ? String(row.failure) : null,
    verifyMethod: String(row.verify_method ?? "sms"),
    codeSentTo: row.verify_method === "pin" ? null : row.code_phone ? maskPhone(String(row.code_phone)) : null,
    verifiedAt: row.verified_at ? String(row.verified_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

const FAILURE_MESSAGE: Record<string, string> = {
  insufficient_wallet: "Your wallet doesn't have enough for this plan. You were not charged.",
  payment_failed: "The payment didn't go through. You were not charged.",
  short_after_fees: "The payment arrived but fees left it short. The money is in your Peebee wallet; pay from the wallet to finish.",
  plan_change_failed: "We couldn't switch your plan. Any money taken was returned to your wallet.",
  expired: "This checkout timed out. Start again.",
};

async function loadCheckout(id: string, storeId: string): Promise<Row | undefined> {
  return (await db.execute({ sql: "SELECT * FROM plan_checkouts WHERE id = ? AND store_id = ?", args: [id, storeId] })).rows[0] as Row | undefined;
}

async function setStatus(id: string, status: string, extra: Record<string, unknown> = {}) {
  const keys = Object.keys(extra);
  await db.execute({
    sql: `UPDATE plan_checkouts SET status = ?, ${keys.map((k) => `${k} = ?`).join(", ")}${keys.length ? ", " : ""}updated_at = datetime('now') WHERE id = ?`,
    args: [status, ...keys.map((k) => extra[k] as string | number | null), id],
  });
}

/** Claims a checkout for activation so a screen poll, the sweep and a retry can never switch the plan twice. */
async function claim(id: string, from: string): Promise<boolean> {
  const res = await db.execute({ sql: "UPDATE plan_checkouts SET status = 'activating', updated_at = datetime('now') WHERE id = ? AND status = ?", args: [id, from] });
  return (res.rowsAffected ?? 0) > 0;
}

/** Switch the plan for a verified checkout whose payment is in the owner's wallet (or that costs nothing). */
async function activate(row: Row): Promise<Row> {
  const id = String(row.id);
  const store = (await db.execute({ sql: "SELECT * FROM stores WHERE id = ?", args: [String(row.store_id)] })).rows[0] as Row | undefined;
  if (!store) {
    await setStatus(id, "failed", { failure: "plan_change_failed" });
    return (await loadCheckout(id, String(row.store_id)))!;
  }
  const environment = row.environment === "sandbox" ? "sandbox" : "live";
  const tier = String(row.tier);
  const kind = String(row.kind);

  // A move down to Merchant has nothing to buy: the paid plan simply isn't continued.
  if (tier === "merchant") {
    await db.execute({ sql: "UPDATE stores SET pro_tier = 'free', pro_expires_at = NULL, elite_tier = 0, plan_legacy = 0, updated_at = datetime('now') WHERE id = ?", args: [String(store.id)] }).catch(async () => {
      await db.execute({ sql: "UPDATE stores SET pro_tier = 'free', pro_expires_at = NULL, updated_at = datetime('now') WHERE id = ?", args: [String(store.id)] });
    });
    await db.execute({ sql: "UPDATE store_subscriptions SET status = 'canceled' WHERE store_id = ? AND status = 'active'", args: [String(store.id)] });
    await setStatus(id, "applied");
    return (await loadCheckout(id, String(row.store_id)))!;
  }

  const result = await applyPlanPurchase({
    store, merchantId: String(row.merchant_id), userId: String(row.user_id), tier: tier as PaidTier,
    billingCycle: String(row.billing_cycle) === "yearly" ? "yearly" : "monthly",
    amount: Number(row.amount) || 0,
    expiresAt: String(row.expires_at),
    environment,
    idempotencyKey: `merchant-plan-checkout:${id}`,
    replaceExisting: kind !== "renew",
    extra: (subId) => [
      { sql: "UPDATE plan_checkouts SET status = ?, subscription_id = ?, updated_at = datetime('now') WHERE id = ?", args: [kind === "downgrade" ? "applied" : "active", subId, id] },
      // Buying a plan replaces any move down that was waiting.
      ...(kind === "downgrade" ? [] : [{ sql: "UPDATE plan_checkouts SET status = 'cancelled', updated_at = datetime('now') WHERE store_id = ? AND status = 'scheduled' AND id != ?", args: [String(store.id), id] }]),
    ],
  });
  if (!result.ok) {
    const viaTopup = Boolean(row.topup_id) && result.error === "insufficient_wallet";
    await setStatus(id, "failed", { failure: viaTopup ? "short_after_fees" : result.error });
  }
  return (await loadCheckout(id, String(row.store_id)))!;
}

/** A paying checkout: ask the provider through the top-up, then switch the plan once the money is in. */
async function progressPaying(row: Row): Promise<Row> {
  if (row.status !== "paying" || !row.topup_id) return row;
  const topup = (await db.execute({ sql: "SELECT * FROM wallet_topups WHERE id = ?", args: [String(row.topup_id)] })).rows[0] as Row | undefined;
  if (!topup) return row;
  let status = String(topup.status);
  if (status === "pending") status = await settleCustomerTopup(topup).catch(() => "pending");
  if (status === "failed") {
    await setStatus(String(row.id), "failed", { failure: "payment_failed" });
    return (await loadCheckout(String(row.id), String(row.store_id)))!;
  }
  if (status !== "successful") return row;
  if (!(await claim(String(row.id), "paying"))) return (await loadCheckout(String(row.id), String(row.store_id)))!;
  return activate(row);
}

async function sendCode(row: Row): Promise<{ ok: true; devCode?: string } | { ok: false; status: 409 | 429 | 502 | 503; error: string; message: string; retryAfterSeconds?: number }> {
  const phone = row.code_phone ? String(row.code_phone) : "";
  if (!phone) return { ok: false, status: 409, error: "no_phone", message: "Add a phone number to your account to confirm plan changes." };
  if (row.code_sent_at) {
    const remaining = RESEND_COOLDOWN_SECONDS * 1000 - (Date.now() - Date.parse(String(row.code_sent_at)));
    if (remaining > 0) return { ok: false, status: 429, error: "too_soon", message: "Wait a moment before asking for another code.", retryAfterSeconds: Math.ceil(remaining / 1000) };
  }
  if (Number(row.codes_sent) >= MAX_CODES_PER_CHECKOUT) return { ok: false, status: 429, error: "too_many_codes", message: "Too many codes for this checkout. Start again." };
  const configured = isAfricasTalkingConfigured();
  // Never mint a usable code that cannot be delivered, outside explicit local development.
  if (!configured && !isDev()) return { ok: false, status: 503, error: "sms_unavailable", message: "Text messages aren't set up yet, so plan changes can't be confirmed." };
  const code = generateCode();
  await db.execute({
    sql: "UPDATE plan_checkouts SET code_hash = ?, code_expires_at = ?, code_sent_at = ?, codes_sent = codes_sent + 1, code_attempts = 0, updated_at = datetime('now') WHERE id = ?",
    args: [await hashCode(code), new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString(), new Date().toISOString(), String(row.id)],
  });
  if (configured) {
    const to = normalizeUgandaMsisdn(phone);
    try {
      await sendVerificationSms(to ? `+${to}` : phone, code);
    } catch (err) {
      console.error("Plan checkout SMS failed:", err instanceof Error ? err.message : err);
      return { ok: false, status: 502, error: "send_failed", message: "Couldn't send the code. Please try again." };
    }
    return { ok: true };
  }
  console.log(`[plan-checkout] code for ${phone}: ${code}`);
  return { ok: true, devCode: code };
}

// ----------------------------------------------------------------------------------------------------------- routes

/** Everything the Plans screen needs: the plan in force, prices, any change waiting, and any checkout still paying. */
planCheckoutRoutes.get("/merchants/me/store/plans", requireAuth, async (c) => {
  const owner = await ownerOf(c);
  if (owner instanceof Response) return owner;
  const settings = await getMarketplaceSettings();
  const ready = await available();
  if (ready) await sweepStore(String(owner.store.id));
  const store = (await db.execute({ sql: "SELECT * FROM stores WHERE id = ?", args: [String(owner.store.id)] })).rows[0] as Row;
  const current = await storePlan(store, settings);
  const price = (tier: Tier, cycle: Cycle) => planPrice(settings, tier, cycle);
  const scheduled = ready ? (await db.execute({ sql: "SELECT * FROM plan_checkouts WHERE store_id = ? AND status = 'scheduled' ORDER BY created_at DESC LIMIT 1", args: [String(store.id)] })).rows[0] as Row | undefined : undefined;
  const paying = ready ? (await db.execute({ sql: "SELECT * FROM plan_checkouts WHERE store_id = ? AND status = 'paying' ORDER BY created_at DESC LIMIT 1", args: [String(store.id)] })).rows[0] as Row | undefined : undefined;
  const opts = await getOptions(["merchant_plan_downgrades"]);
  return c.json({
    available: ready,
    current: { ...current, visiblePlan: current.legacy ? null : visiblePlan(current.plan) },
    pricingMode: settings.proPricingMode,
    eliteEnabled: settings.eliteEnabled !== false,
    downgradesEnabled: opts.merchant_plan_downgrades !== false,
    plans: (["merchant", "pro_live", "elite"] as Tier[]).map((tier) => ({
      tier,
      label: PLAN_LABEL[tier],
      monthly: price(tier, "monthly"),
      yearly: price(tier, "yearly"),
      listMonthly: tier === "elite" ? settings.elitePriceUgx : tier === "pro_live" ? settings.proLivePriceUgx : 0,
      maxProducts: tier === "elite" ? settings.eliteMaxProducts : tier === "pro_live" ? settings.proMaxProducts : null,
      commissionPercent: tier === "elite" ? settings.eliteCommissionPercent : settings.commissionPercent,
    })),
    scheduled: scheduled ? view(scheduled) : null,
    paying: paying ? view(paying) : null,
    phone: owner.phone ? maskPhone(owner.phone) : null,
    verify: { channel: verifyChannel(), pinSet: Boolean(await pinRow(owner.userId)) },
    methods: await activeMethods(),
  });
});

const pinSchema = z.object({
  pin: z.string().regex(/^\d{4,6}$/, "Use 4 to 6 digits."),
  currentPin: z.string().regex(/^\d{4,6}$/).optional(),
  password: z.string().min(1).max(200).optional(),
});

function weakPin(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true;
  const digits = pin.split("").map(Number);
  const up = digits.every((d, i) => i === 0 || d === (digits[i - 1] + 1) % 10);
  const down = digits.every((d, i) => i === 0 || d === (digits[i - 1] + 9) % 10);
  return up || down;
}

/**
 * Set or change the owner's plan PIN (the fallback when text messages are unavailable). Changing it needs the current
 * PIN; setting the first one needs the account password when the account has one.
 */
planCheckoutRoutes.post("/merchants/me/store/plan-pin", requireAuth, async (c) => {
  if (!(await hasTable("owner_pins"))) return migrationPending(c);
  const owner = await ownerOf(c);
  if (owner instanceof Response) return owner;
  const limit = await consume(`plan-pin:${owner.userId}`, 10, 3600);
  if (!limit.allowed) return c.json({ error: "too_many_attempts", message: "Too many tries. Please wait a while." }, 429);
  const parsed = pinSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_pin", message: "Use 4 to 6 digits." }, 400);
  const { pin, currentPin, password } = parsed.data;
  if (weakPin(pin)) return c.json({ error: "weak_pin", message: "Pick a PIN that's harder to guess." }, 400);
  const existing = await pinRow(owner.userId);
  if (existing) {
    if (!currentPin) return c.json({ error: "current_pin_required", message: "Enter your current PIN." }, 400);
    const ok = await checkPin(owner.userId, currentPin);
    if (!ok.ok) return c.json({ error: ok.error, message: ok.message, attemptsLeft: ok.attemptsLeft }, ok.status);
  } else {
    const user = (await db.execute({ sql: "SELECT password_hash FROM users WHERE id = ?", args: [owner.userId] })).rows[0] as Row | undefined;
    const hash = String(user?.password_hash ?? "");
    if (hash.startsWith("$2")) {
      if (!password || !(await bcrypt.compare(password, hash))) return c.json({ error: "wrong_password", message: "Enter your account password." }, 400);
    }
  }
  await db.execute({
    sql: `INSERT INTO owner_pins (user_id, pin_hash) VALUES (?, ?)
          ON CONFLICT(user_id) DO UPDATE SET pin_hash = excluded.pin_hash, failed_attempts = 0, locked_until = NULL, updated_at = datetime('now')`,
    args: [owner.userId, await pinHash(owner.userId, pin)],
  });
  return c.json({ ok: true });
});

const quoteSchema = z.object({ tier: z.enum(["merchant", "pro_live", "elite"]), billingCycle: z.enum(["monthly", "yearly"]).default("monthly") });

/** Review: what changes, from when, what it costs, and how it can be paid. Nothing is saved. */
planCheckoutRoutes.post("/merchants/me/store/plan-quote", requireAuth, async (c) => {
  const owner = await ownerOf(c);
  if (owner instanceof Response) return owner;
  const parsed = quoteSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const settings = await getMarketplaceSettings();
  const quote = await quoteFor(owner.store, settings, parsed.data.tier, parsed.data.billingCycle);
  if ("error" in quote) return c.json({ error: quote.error, message: quote.message }, quote.status);
  const environment = await getPlatformEnvironment();
  const column = environment === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance";
  const balance = Number((await db.execute({ sql: `SELECT ${column} AS b FROM users WHERE id = ?`, args: [owner.userId] })).rows[0]?.b ?? 0);
  return c.json({
    quote,
    wallet: { balance },
    methods: await activeMethods(),
    phone: owner.phone ? maskPhone(owner.phone) : null,
    verify: { channel: verifyChannel(), pinSet: Boolean(await pinRow(owner.userId)) },
  });
});

const startSchema = quoteSchema.extend({
  method: z.enum(["wallet", "mobile_money", "card", "free"]),
  msisdn: z.string().min(6).max(20).optional(),
});

/** Pay step: saves the checkout and texts the owner a code. Nothing is charged until the code is right. */
planCheckoutRoutes.post("/merchants/me/store/plan-checkouts", requireAuth, async (c) => {
  if (!(await available())) return migrationPending(c);
  const owner = await ownerOf(c);
  if (owner instanceof Response) return owner;
  const parsed = startSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const { tier, billingCycle } = parsed.data;
  const settings = await getMarketplaceSettings();
  const quote = await quoteFor(owner.store, settings, tier, billingCycle);
  if ("error" in quote) return c.json({ error: quote.error, message: quote.message }, quote.status);

  // Nothing to pay today (free plans, a full credit, or a move down): the code alone confirms it.
  let method: Method = quote.amount > 0 ? parsed.data.method : "free";
  if (quote.amount > 0 && method === "free") return c.json({ error: "payment_required", message: "Choose how to pay." }, 400);
  let msisdn: string | null = null;
  const environment = await getPlatformEnvironment();
  if (method === "mobile_money") {
    msisdn = normalizeUgandaMsisdn(parsed.data.msisdn ?? "");
    if (!msisdn) return c.json({ error: "invalid_msisdn", message: "Enter an MTN or Airtel number." }, 400);
  }
  const methods = await activeMethods();
  if ((method === "card" && !methods.card) || (method === "mobile_money" && !methods.mobileMoney) || (method === "wallet" && !methods.wallet)) {
    return c.json({ error: "method_unavailable", message: "That way of paying isn't available right now." }, 409);
  }
  const channel = verifyChannel();
  if (channel === "pin" && !(await pinRow(owner.userId))) return c.json({ error: "pin_required", message: "Set your plan PIN first." }, 409);
  if (method === "wallet") {
    const column = environment === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance";
    const balance = Number((await db.execute({ sql: `SELECT ${column} AS b FROM users WHERE id = ?`, args: [owner.userId] })).rows[0]?.b ?? 0);
    if (balance < quote.amount) return c.json({ error: "insufficient_wallet", neededUgx: quote.amount, balance, message: "Your wallet doesn't have enough. Choose mobile money or card." }, 402);
  }
  method = method as Method;

  // One open checkout per store: a new one replaces any that never got past the code.
  await db.execute({ sql: "UPDATE plan_checkouts SET status = 'cancelled', updated_at = datetime('now') WHERE store_id = ? AND status = 'awaiting_code'", args: [String(owner.store.id)] });

  const id = newId("pco");
  const reference = `PB-SUB-${id.slice(-8).toUpperCase()}`;
  await db.execute({
    sql: `INSERT INTO plan_checkouts (id, reference, store_id, merchant_id, user_id, kind, from_plan, tier, billing_cycle, list_price, credit, amount, method, msisdn, status, verify_method, code_phone, starts_at, expires_at, environment)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_code', ?, ?, ?, ?, ?)`,
    args: [id, reference, String(owner.store.id), owner.merchantId, owner.userId, quote.kind, quote.fromPlan, tier, billingCycle, quote.listPrice, quote.credit, quote.amount, method, msisdn, channel, owner.phone, quote.startsAt, quote.expiresAt, environment],
  });
  const row = (await loadCheckout(id, String(owner.store.id)))!;
  if (channel === "pin") return c.json({ checkout: view(row) }, 201);
  if (!owner.phone) {
    await setStatus(id, "cancelled", { failure: "no_phone" });
    return c.json({ error: "no_phone", message: "Add a phone number to your account to confirm plan changes." }, 409);
  }
  const sent = await sendCode(row);
  if (!sent.ok) {
    await setStatus(id, "cancelled", { failure: sent.error });
    return c.json({ error: sent.error, message: sent.message, retryAfterSeconds: sent.retryAfterSeconds }, sent.status);
  }
  return c.json({ checkout: view((await loadCheckout(id, String(owner.store.id)))!), ...(sent.devCode ? { devCode: sent.devCode } : {}) }, 201);
});

planCheckoutRoutes.post("/merchants/me/store/plan-checkouts/:id/resend", requireAuth, async (c) => {
  if (!(await available())) return migrationPending(c);
  const owner = await ownerOf(c);
  if (owner instanceof Response) return owner;
  const row = await loadCheckout(c.req.param("id")!, String(owner.store.id));
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.status !== "awaiting_code") return c.json({ error: "not_waiting", message: "This checkout isn't waiting for a code." }, 409);
  if (row.verify_method === "pin") return c.json({ error: "pin_checkout", message: "Enter your plan PIN." }, 409);
  const sent = await sendCode(row);
  if (!sent.ok) return c.json({ error: sent.error, message: sent.message, retryAfterSeconds: sent.retryAfterSeconds }, sent.status);
  return c.json({ ok: true, checkout: view((await loadCheckout(String(row.id), String(owner.store.id)))!), ...(sent.devCode ? { devCode: sent.devCode } : {}) });
});

const verifySchema = z.object({ code: z.string().regex(/^\d{4,6}$/, "Enter the code.") });

/** Verify step: the code is checked on the server, then the payment runs (or the change is scheduled). */
planCheckoutRoutes.post("/merchants/me/store/plan-checkouts/:id/verify", requireAuth, async (c) => {
  if (!(await available())) return migrationPending(c);
  const owner = await ownerOf(c);
  if (owner instanceof Response) return owner;
  const parsed = verifySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_code", message: "Enter the 6-digit code." }, 400);
  const row = await loadCheckout(c.req.param("id")!, String(owner.store.id));
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.status !== "awaiting_code") return c.json({ error: "not_waiting", message: "This checkout isn't waiting for a code.", checkout: view(row) }, 409);
  if (row.verify_method === "pin") {
    const pin = await checkPin(owner.userId, parsed.data.code);
    if (!pin.ok) return c.json({ error: pin.error, message: pin.message, attemptsLeft: pin.attemptsLeft }, pin.status);
  } else {
    if (!/^\d{6}$/.test(parsed.data.code)) return c.json({ error: "invalid_code", message: "Enter the 6-digit code." }, 400);
    if (!row.code_hash || !row.code_expires_at || Date.parse(String(row.code_expires_at)) < Date.now()) {
      return c.json({ error: "expired", message: "That code has expired. Ask for a new one." }, 410);
    }
    if (Number(row.code_attempts) >= MAX_WRONG_ATTEMPTS) return c.json({ error: "too_many_attempts", message: "Too many wrong codes. Ask for a new one." }, 429);
    if (!timingSafeEqual(await hashCode(parsed.data.code), String(row.code_hash))) {
      await db.execute({ sql: "UPDATE plan_checkouts SET code_attempts = code_attempts + 1, updated_at = datetime('now') WHERE id = ?", args: [String(row.id)] });
      return c.json({ error: "wrong_code", message: "That code isn't right.", attemptsLeft: Math.max(0, MAX_WRONG_ATTEMPTS - Number(row.code_attempts) - 1) }, 400);
    }
  }

  // The plan in force may have changed since the review; price it again before anything is charged.
  const settings = await getMarketplaceSettings();
  const fresh = await quoteFor(owner.store, settings, String(row.tier) as Tier, String(row.billing_cycle) === "yearly" ? "yearly" : "monthly");
  // The credit for unused days shrinks a little every minute; only a real change (another plan, a new price) stops it.
  const drift = "error" in fresh ? Infinity : Math.abs(fresh.amount - Number(row.amount));
  if ("error" in fresh || fresh.kind !== String(row.kind) || drift > Math.max(1000, Math.round(fresh.listPrice * 0.02))) {
    await setStatus(String(row.id), "cancelled", { failure: "quote_changed", code_hash: null });
    return c.json({ error: "quote_changed", message: "Your plan changed while you were paying. Review it again." }, 409);
  }

  await db.execute({ sql: "UPDATE plan_checkouts SET verified_at = datetime('now'), code_hash = NULL, updated_at = datetime('now') WHERE id = ?", args: [String(row.id)] });
  const verified = (await loadCheckout(String(row.id), String(owner.store.id)))!;
  const kind = String(verified.kind);
  const method = String(verified.method) as Method;

  // A move down waits for the end of the plan in force (a legacy store's starts now).
  if (kind === "downgrade" && Date.parse(String(verified.starts_at)) > Date.now() + 60_000) {
    await db.execute({ sql: "UPDATE plan_checkouts SET status = 'cancelled', updated_at = datetime('now') WHERE store_id = ? AND status = 'scheduled'", args: [String(owner.store.id)] });
    await setStatus(String(verified.id), "scheduled");
    return c.json({ checkout: view((await loadCheckout(String(verified.id), String(owner.store.id)))!) });
  }

  if (method === "free" || method === "wallet") {
    if (!(await claim(String(verified.id), "awaiting_code"))) return c.json({ checkout: view((await loadCheckout(String(verified.id), String(owner.store.id)))!) });
    const done = await activate(verified);
    return c.json({ checkout: view(done), ...(done.failure ? { message: FAILURE_MESSAGE[String(done.failure)] } : {}) });
  }

  // Mobile money or card: collect into the owner's wallet as a top-up, then the plan is paid from there.
  const topupId = newId("wtu");
  const environment = verified.environment === "sandbox" ? "sandbox" : "live";
  try {
    const initiated = await initiateCollection({
      referenceId: topupId,
      msisdn: method === "mobile_money" ? String(verified.msisdn) : undefined,
      amount: Number(verified.amount),
      method: method === "card" ? "card" : "mobile_money",
      narrative: `Peebee plan ${String(verified.reference)}`,
      returnUrl: `${merchantAppUrl()}/store/plans/checkout?checkout=${String(verified.id)}`,
      forceMock: environment === "sandbox",
    });
    await db.execute({
      sql: `INSERT INTO wallet_topups (id, user_id, amount, provider, provider_ref, method, msisdn, network, status, environment)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      args: [topupId, owner.userId, Number(verified.amount), initiated.provider, initiated.providerRef, method, method === "mobile_money" ? String(verified.msisdn) : null, initiated.network, environment],
    });
    await setStatus(String(verified.id), "paying", { topup_id: topupId });
    return c.json({
      checkout: view((await loadCheckout(String(verified.id), String(owner.store.id)))!),
      payment: { network: initiated.network, redirectUrl: initiated.redirectUrl ?? null, nextAction: initiated.nextAction ?? null, topupId },
    });
  } catch (err) {
    await setStatus(String(verified.id), "failed", { failure: "payment_failed" });
    if (err instanceof UnsupportedNetworkError) return c.json({ error: "unsupported_network", message: err.message }, 400);
    console.error("Plan checkout payment request failed:", err);
    return c.json(paymentProviderErrorResponse(err, "Couldn't start that payment just now. You were not charged."), paymentProviderHttpStatus(err));
  }
});

/** Processing step: the screen polls this; the server asks the provider and switches the plan when the money is in. */
planCheckoutRoutes.get("/merchants/me/store/plan-checkouts/:id", requireAuth, async (c) => {
  if (!(await available())) return migrationPending(c);
  const owner = await ownerOf(c);
  if (owner instanceof Response) return owner;
  let row = await loadCheckout(c.req.param("id")!, String(owner.store.id));
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.status === "paying") row = await progressPaying(row);
  const waitedSince = row.code_expires_at ? Date.parse(String(row.code_expires_at)) : Date.parse(`${String(row.created_at).replace(" ", "T")}Z`) + CODE_TTL_MINUTES * 60_000;
  if (row.status === "awaiting_code" && waitedSince + 30 * 60_000 < Date.now()) {
    await setStatus(String(row.id), "cancelled", { failure: "expired" });
    row = (await loadCheckout(String(row.id), String(owner.store.id)))!;
  }
  const out = view(row);
  return c.json({ checkout: out, ...(out.failure ? { message: FAILURE_MESSAGE[out.failure] ?? null } : {}) });
});

/** Cancel a checkout that hasn't switched the plan yet, or a move down that is still waiting. */
planCheckoutRoutes.post("/merchants/me/store/plan-checkouts/:id/cancel", requireAuth, async (c) => {
  if (!(await available())) return migrationPending(c);
  const owner = await ownerOf(c);
  if (owner instanceof Response) return owner;
  const row = await loadCheckout(c.req.param("id")!, String(owner.store.id));
  if (!row) return c.json({ error: "not_found" }, 404);
  if (!["awaiting_code", "paying", "scheduled"].includes(String(row.status))) {
    return c.json({ error: "not_cancellable", message: "This can't be cancelled now.", checkout: view(row) }, 409);
  }
  const res = await db.execute({ sql: "UPDATE plan_checkouts SET status = 'cancelled', code_hash = NULL, updated_at = datetime('now') WHERE id = ? AND status = ?", args: [String(row.id), String(row.status)] });
  if ((res.rowsAffected ?? 0) === 0) return c.json({ error: "not_cancellable", message: "This can't be cancelled now." }, 409);
  return c.json({ checkout: view((await loadCheckout(String(row.id), String(owner.store.id)))!), ...(row.status === "paying" ? { message: "If the payment still goes through, the money will be in your Peebee wallet." } : {}) });
});

/** Receipts: every plan change with its reference. */
planCheckoutRoutes.get("/merchants/me/store/plan-checkouts", requireAuth, async (c) => {
  if (!(await available())) return c.json({ checkouts: [] });
  const owner = await ownerOf(c);
  if (owner instanceof Response) return owner;
  const rows = (await db.execute({
    sql: "SELECT * FROM plan_checkouts WHERE store_id = ? AND status IN ('active', 'applied', 'scheduled', 'failed') ORDER BY created_at DESC LIMIT 30",
    args: [String(owner.store.id)],
  })).rows as Row[];
  return c.json({ checkouts: rows.map(view) });
});

// ----------------------------------------------------------------------------------------------------------- sweep

async function applyScheduled(row: Row) {
  if (!(await claim(String(row.id), "scheduled"))) return;
  const settings = await getMarketplaceSettings();
  const tier = String(row.tier) as Tier;
  const cycle: Cycle = String(row.billing_cycle) === "yearly" ? "yearly" : "monthly";
  // Priced when it starts: whatever the admin's price is then (UGX 0 while plans are free).
  const amount = planPrice(settings, tier, cycle);
  const startMs = Date.now();
  await db.execute({
    sql: "UPDATE plan_checkouts SET amount = ?, list_price = ?, starts_at = ?, expires_at = ? WHERE id = ?",
    args: [amount, amount, new Date(startMs).toISOString(), tier === "merchant" ? null : new Date(startMs + periodDays(cycle) * DAY).toISOString(), String(row.id)],
  });
  const fresh = (await db.execute({ sql: "SELECT * FROM plan_checkouts WHERE id = ?", args: [String(row.id)] })).rows[0] as Row;
  await activate(fresh);
}

async function sweepRows(rows: Row[]) {
  for (const row of rows) {
    try {
      if (row.status === "paying") await progressPaying(row);
      else if (row.status === "scheduled") await applyScheduled(row);
    } catch (err) {
      console.error("Plan checkout sweep failed for", row.id, err);
    }
  }
}

async function sweepStore(storeId: string) {
  const rows = (await db.execute({
    sql: "SELECT * FROM plan_checkouts WHERE store_id = ? AND ((status = 'scheduled' AND starts_at <= ?) OR status = 'paying')",
    args: [storeId, new Date().toISOString()],
  })).rows as Row[];
  await sweepRows(rows);
}

/** Background job: finish checkouts whose payment landed while the app was closed, and start moves down that are due. */
export async function sweepPlanCheckouts(limit = 25): Promise<{ checked: number }> {
  if (!(await available())) return { checked: 0 };
  const rows = (await db.execute({
    sql: "SELECT * FROM plan_checkouts WHERE (status = 'scheduled' AND starts_at <= ?) OR (status = 'paying' AND updated_at < datetime('now', '-1 minute')) ORDER BY updated_at LIMIT ?",
    args: [new Date().toISOString(), limit],
  })).rows as Row[];
  await sweepRows(rows);
  return { checked: rows.length };
}
