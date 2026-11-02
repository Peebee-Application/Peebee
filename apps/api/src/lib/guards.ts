import type { Context, Next } from "hono";
import { verifyToken } from "../auth/jwt.js";
import { db } from "../db/client.js";
import { clientIp, consume, hashKey } from "./ratelimit.js";
import { getOptions } from "./option-settings.js";
import { hasTable } from "./schema.js";

/**
 * Structural rail: a write to a feature whose migration is not applied yet must say so. Answering `ok: true` while
 * silently saving nothing (what `if (await hasTable(...)) { ... }` did) loses the merchant's work.
 * Returns a 503 response when any table is missing, otherwise null.
 */
export async function migrationPending(c: Context, migration: string, ...tables: string[]): Promise<Response | null> {
  for (const table of tables) {
    if (!(await hasTable(table))) {
      return c.json({ error: "migration_pending", message: `This feature is being set up (${migration} is not applied yet). Try again shortly.` }, 503);
    }
  }
  return null;
}

/**
 * Public (signed-out) writes are limited per network address and per subject (a phone number, a link), with the
 * ceilings set by admin. Returns a 429 response when over the limit, otherwise null.
 */
export async function publicRateLimit(
  c: Context,
  bucket: string,
  subject: string | null,
  setting: string,
  windowSeconds: number,
): Promise<Response | null> {
  const limit = Number((await getOptions([setting]))[setting]);
  const keys = [`pub:${bucket}:ip:${await hashKey(clientIp(c))}`];
  if (subject) keys.push(`pub:${bucket}:subject:${await hashKey(subject)}`);
  for (const key of keys) {
    const result = await consume(key, limit, windowSeconds);
    if (!result.allowed) {
      c.header("Retry-After", String(result.retryAfterSeconds));
      return c.json({ error: "rate_limited", message: "Too many requests. Please wait a little and try again.", retryAfterSeconds: result.retryAfterSeconds }, 429);
    }
  }
  return null;
}

export type MerchantPermission = "manage_catalog" | "manage_store_settings" | "manage_digital" | "refund_revoke" | "manage_billing";

const RULES: Array<{ methods: string[]; pattern: RegExp; permission: MerchantPermission }> = [
  { methods: ["POST"], pattern: /^\/merchants\/me\/store\/tier$/, permission: "manage_billing" },
  { methods: ["PUT", "POST"], pattern: /^\/merchants\/me\/store$/, permission: "manage_store_settings" },
  { methods: ["PUT"], pattern: /^\/merchants\/me\/storefront-sections$/, permission: "manage_store_settings" },
  { methods: ["POST"], pattern: /^\/merchants\/me\/store\/live\/(start|end)$/, permission: "manage_store_settings" },
  { methods: ["POST"], pattern: /^\/merchants\/me\/(send-sms|winback-campaigns)$/, permission: "manage_store_settings" },
  { methods: ["POST", "PUT", "DELETE"], pattern: /^\/merchants\/me\/(products|products\/starter-pack|collections|collections\/[^/]+|discounts|discounts\/[^/]+|bundles|bundles\/[^/]+|outlet-inventory|stock-transfers|suppliers|purchase-orders|purchase-orders\/[^/]+\/receive)$/, permission: "manage_catalog" },
  { methods: ["POST", "DELETE"], pattern: /^\/merchants\/me\/(digital-products|digital-products\/[^/]+|lms\/courses|lms\/sync-from-learn|lms\/enrollments)$/, permission: "manage_digital" },
  { methods: ["POST"], pattern: /^\/merchants\/me\/digital-fulfillments\/[^/]+\/revoke$/, permission: "refund_revoke" },
];

export function requiredPermission(method: string, path: string): MerchantPermission | null {
  const clean = path.replace(/^\/v1/, "").replace(/\/+$/, "");
  if (!clean.startsWith("/merchants/me/")) return null;
  // Sensitive reads and all descendants share their resource's policy, so
  // adding an upload/licence/course subroute cannot silently skip the gate.
  if (/^\/merchants\/me\/digital-products\/[^/]+\/license-pool$/.test(clean)) return "manage_digital";
  if (/^\/merchants\/me\/(digital-products|digital-fulfillments|lms)(\/|$)/.test(clean) && ["GET", "HEAD"].includes(method)) return "manage_digital";
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return null;
  if (/^\/merchants\/me\/digital-fulfillments\/[^/]+\/(refund|revoke)$/.test(clean)) return "refund_revoke";
  if (/^\/merchants\/me\/(digital-products|digital-fulfillments|lms)(\/|$)/.test(clean)) return "manage_digital";
  const matched = RULES.find((r) => r.methods.includes(method) && r.pattern.test(clean));
  if (matched) return matched.permission;
  // Operational sales remain available to cashiers. Other new writes fail
  // closed to the store-management policy until assigned a narrower one.
  if (method === "POST" && /^\/merchants\/me\/(pos-sales|draft-orders)$/.test(clean)) return null;
  return "manage_store_settings";
}

/** The team roles the caller holds, best first (owner > manager > finance > cashier). */
async function memberRoles(userId: string, merchantId?: string): Promise<string[]> {
  if (!(await hasTable("merchant_members"))) return [];
  const res = await db.execute({
    sql: "SELECT role FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END",
    args: [userId, merchantId ?? null, merchantId ?? null],
  });
  return res.rows.map((r) => String(r.role));
}

/**
 * Merchant team roles: which roles may change catalogue, store settings, digital goods, refunds and billing is an
 * admin setting. Reads stay open to every member. A caller with no membership falls through to the route, which
 * answers for itself.
 */
export async function merchantRoleGuard(c: Context, next: Next) {
  const permission = requiredPermission(c.req.method, new URL(c.req.url).pathname);
  if (!permission) return next();

  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next();
  let userId: string;
  try {
    userId = (await verifyToken(token)).sub;
  } catch {
    return next();
  }

  const roles = await memberRoles(userId, c.req.header("X-Merchant-Id"));
  if (roles.length === 0) return next();
  const key = `member_roles_${permission}`;
  const allowed = (await getOptions([key]))[key] as string[];
  // The routes act for the caller's best membership, so that is the role that must be allowed.
  if (!allowed.includes(roles[0])) {
    return c.json({ error: "insufficient_role", permission, message: "Your role on this store's team cannot do that. Ask the owner." }, 403);
  }
  return next();
}
