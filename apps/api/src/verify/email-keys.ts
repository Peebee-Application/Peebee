import { createHash, randomUUID } from "node:crypto";
import type { EmailKey, EmailKeysOverview } from "@tuma/shared";
import { db } from "../db/client.js";
import { decryptSecret, isCredentialsEncryptionConfigured } from "../lib/crypto.js";
import { nextRotationAt, timedOrder } from "../lib/key-rotation.js";
import { hasTable } from "../lib/schema.js";
import { getSetting } from "../lib/settings.js";

type Row = Record<string, unknown>;
export const emailKeyHash = (key: string) => createHash("sha256").update(key).digest("hex");

export async function emailTablesReady(): Promise<boolean> {
  return (await hasTable("email_api_keys")) && (await hasTable("email_api_usage"));
}

export async function emailKeySettings() {
  const [mode, rotation, limit, window, retry] = await Promise.all([
    getSetting("resend_key_mode"), getSetting("resend_rotation_seconds"),
    getSetting("resend_window_requests"), getSetting("resend_window_seconds"), getSetting("resend_quota_retry_seconds"),
  ]);
  return {
    mode: mode === "test" ? "test" as const : "live" as const,
    rotationSeconds: Number(rotation), windowRequests: Number(limit),
    windowSeconds: Number(window), quotaRetrySeconds: Number(retry),
  };
}

async function rows(): Promise<Row[]> {
  return (await db.execute("SELECT k.*, u.window_start, u.request_count, u.cooldown_until, u.cooldown_reason FROM email_api_keys k LEFT JOIN email_api_usage u ON u.account_tag = k.account_tag ORDER BY k.rowid")).rows as Row[];
}

export async function emailKeysOverview(): Promise<EmailKeysOverview> {
  const settings = await emailKeySettings();
  const tableReady = await emailTablesReady();
  const now = Date.now();
  const windowStart = Math.floor(now / (settings.windowSeconds * 1000)) * settings.windowSeconds;
  const keys: EmailKey[] = (tableReady ? await rows() : []).map((r) => {
    const windowUsed = Number(r.window_start) === windowStart ? Number(r.request_count) || 0 : 0;
    const providerCooling = !!r.cooldown_until && Date.parse(String(r.cooldown_until)) > now;
    const budgetCooling = settings.mode === "test" && settings.windowRequests > 0 && windowUsed >= settings.windowRequests;
    const until = Math.max(providerCooling ? Date.parse(String(r.cooldown_until)) : 0, budgetCooling ? (windowStart + settings.windowSeconds) * 1000 : 0);
    return {
      id: String(r.id), label: String(r.label), hint: String(r.key_hint), accountTag: String(r.account_tag),
      fromAddress: String(r.from_address), enabled: Number(r.enabled) === 1, isLive: Number(r.is_live) === 1,
      status: Number(r.enabled) !== 1 ? "disabled" : until > now ? "cooling" : "ready",
      cooldownUntil: until > now ? new Date(until).toISOString() : null,
      cooldownReason: providerCooling ? String(r.cooldown_reason) : budgetCooling ? "Testing request budget reached" : null,
      windowUsed, useCount: Number(r.use_count), failCount: Number(r.fail_count),
      lastUsedAt: r.last_used_at ? String(r.last_used_at) : null, lastError: r.last_error ? String(r.last_error) : null,
    };
  });
  const testPool = timedOrder(keys.filter((k) => k.enabled && !k.isLive), settings.rotationSeconds, now);
  const active = settings.mode === "live" ? keys.find((k) => k.isLive && k.status === "ready") : testPool.find((k) => k.status === "ready");
  return {
    ...settings, keys, tableReady, encryptionConfigured: isCredentialsEncryptionConfigured(),
    envKeyPresent: !!process.env.RESEND_API_KEY, activeKeyId: active?.id ?? null,
    nextRotationAt: settings.mode === "test" && testPool.length > 1 ? nextRotationAt(settings.rotationSeconds, now) : null,
  };
}

/** True even when saved keys are disabled/exhausted: an unavailable provider
 * must fail delivery rather than exposing a verification code as a dev code. */
export async function emailProviderConfigured(): Promise<boolean> {
  if (process.env.RESEND_API_KEY) return true;
  if (!(await emailTablesReady())) return false;
  return (await db.execute("SELECT 1 FROM email_api_keys LIMIT 1")).rows.length > 0;
}

/** Atomically reserve an attempt for this account. Concurrent Worker requests
 * cannot each consume the last remaining place in the testing budget. */
async function reserve(accountTag: string, settings: Awaited<ReturnType<typeof emailKeySettings>>): Promise<boolean> {
  const now = new Date().toISOString();
  const start = Math.floor(Date.now() / (settings.windowSeconds * 1000)) * settings.windowSeconds;
  const cap = settings.mode === "test" ? settings.windowRequests : 0;
  const result = await db.execute({
    sql: `INSERT INTO email_api_usage (account_tag, window_start, request_count) VALUES (?, ?, 1)
      ON CONFLICT(account_tag) DO UPDATE SET window_start = excluded.window_start,
      request_count = CASE WHEN email_api_usage.window_start = excluded.window_start THEN email_api_usage.request_count + 1 ELSE 1 END
      WHERE (email_api_usage.cooldown_until IS NULL OR email_api_usage.cooldown_until <= ?)
      AND (? = 0 OR email_api_usage.window_start != excluded.window_start OR email_api_usage.request_count < ?)
      RETURNING account_tag`,
    args: [accountTag, start, now, cap, cap],
  });
  return result.rows.length > 0;
}

export class ResendDeliveryError extends Error {
  constructor(readonly status: number, readonly kind: string, readonly retryAfter: string | null) {
    super(`Resend delivery failed (${status}, ${kind})`);
  }
}

function quotaCooldown(error: ResendDeliveryError, retrySeconds: number): { until: string; reason: string } {
  const now = new Date();
  if (error.kind === "daily_quota_exceeded") {
    return { until: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString(), reason: "Daily Resend quota reached" };
  }
  // Monthly billing cycles differ by account; never guess their reset date.
  const seconds = error.retryAfter ? Number(error.retryAfter) : NaN;
  const parsedDate = error.retryAfter && !Number.isFinite(seconds) ? Date.parse(error.retryAfter) : NaN;
  const retryAt = Number.isFinite(seconds) ? now.getTime() + Math.max(1, seconds) * 1000 : parsedDate;
  return {
    until: new Date(Number.isFinite(retryAt) && retryAt > now.getTime() ? retryAt : now.getTime() + retrySeconds * 1000).toISOString(),
    reason: error.kind === "monthly_quota_exceeded" ? "Monthly Resend quota reached" : "Resend rate limit reached",
  };
}

export async function sendResendEmail(payload: { to: string[]; subject: string; html: string; text: string }): Promise<void> {
  const send = async (key: string, from: string, idempotency: string) => {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": idempotency },
      body: JSON.stringify({ ...payload, from }), signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { name?: string };
      const kind = ["daily_quota_exceeded", "monthly_quota_exceeded", "rate_limit_exceeded", "invalid_api_key", "restricted_api_key"].includes(body.name ?? "") ? body.name! : "provider_error";
      throw new ResendDeliveryError(response.status, kind, response.headers.get("retry-after"));
    }
  };
  const idempotency = randomUUID();
  const fallback = async () => {
    if (!process.env.RESEND_API_KEY) throw new Error("No live Resend key configured. Add one in Settings → Email API keys.");
    await send(process.env.RESEND_API_KEY, process.env.RESEND_FROM ?? "Tuma <onboarding@resend.dev>", idempotency);
  };
  if (!(await emailTablesReady())) return fallback();
  const settings = await emailKeySettings();
  const all = await rows();
  const live = all.find((r) => Number(r.is_live) === 1);
  if (settings.mode === "live" && !live) return fallback();
  const candidates = settings.mode === "live" ? [live!] : timedOrder(all.filter((r) => Number(r.is_live) !== 1 && Number(r.enabled) === 1), settings.rotationSeconds);
  for (const row of candidates) {
    if (Number(row.enabled) !== 1 || !(await reserve(String(row.account_tag), settings))) continue;
    const secret = await decryptSecret(String(row.key_encrypted));
    try {
      await send(secret, String(row.from_address), idempotency);
    } catch (error) {
      // Unknown network/server outcomes must not be replayed against another
      // account: it could send a second email after the first was accepted.
      if (!(error instanceof ResendDeliveryError)) throw error;
      await db.execute({ sql: "UPDATE email_api_keys SET fail_count = fail_count + 1, last_error = ? WHERE id = ?", args: [error.message, String(row.id)] });
      if (error.status === 429) {
        const cooldown = quotaCooldown(error, settings.quotaRetrySeconds);
        await db.execute({ sql: "UPDATE email_api_usage SET cooldown_until = MAX(COALESCE(cooldown_until, ''), ?), cooldown_reason = ? WHERE account_tag = ?", args: [cooldown.until, cooldown.reason, String(row.account_tag)] });
      } else if (error.status === 401 || error.kind === "invalid_api_key") {
        await db.execute({ sql: "UPDATE email_api_keys SET enabled = 0 WHERE id = ?", args: [String(row.id)] });
      } else {
        throw error;
      }
      if (settings.mode === "live") throw error;
      continue;
    }
    // Recording success is outside the provider catch: a database write error
    // cannot cause an email already accepted by Resend to be sent again.
    await db.execute({ sql: "UPDATE email_api_keys SET use_count = use_count + 1, last_used_at = ?, last_error = NULL WHERE id = ?", args: [new Date().toISOString(), String(row.id)] });
    return;
  }
  throw new Error("No Resend keys available in this mode. Check enabled keys, account quotas and testing budgets in Settings → Email API keys.");
}
