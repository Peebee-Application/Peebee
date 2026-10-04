import { Hono } from "hono";
import { z } from "zod";
import { logActivity } from "../admin/activity.js";
import { requirePermission } from "../admin/permissions.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { db, executeBatch } from "../db/client.js";
import { encryptSecret, isCredentialsEncryptionConfigured } from "../lib/crypto.js";
import { newId } from "../lib/ids.js";
import { clientIp } from "../lib/ratelimit.js";
import { emailKeyHash, emailKeysOverview, emailTablesReady } from "./email-keys.js";

export const emailKeyRoutes = new Hono();
const gate = [requireAuth, requireRole("admin"), requirePermission("settings.manage")] as const;
emailKeyRoutes.get("/admin/email-keys", ...gate, async (c) => c.json(await emailKeysOverview()));

const fromAddress = z.string().trim().max(254).refine((v) => /^[^\r\n<>]*<[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>$/.test(v) || /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(v));
const entry = z.object({
  label: z.string().trim().min(1).max(60), key: z.string().trim().regex(/^re_[A-Za-z0-9_-]{20,197}$/),
  accountTag: z.string().trim().min(1).max(60).transform((v) => v.toLowerCase()), fromAddress,
});

emailKeyRoutes.post("/admin/email-keys", ...gate, async (c) => {
  if (!(await emailTablesReady())) return c.json({ error: "unavailable", message: "Email key management is not available yet." }, 503);
  if (!isCredentialsEncryptionConfigured()) return c.json({ error: "no_encryption", message: "Credential encryption must be configured before saving keys." }, 503);
  const parsed = z.object({ keys: z.array(entry).min(1).max(100) }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", message: "Check the key, account name and sender address." }, 400);
  const results: Array<{ label: string; status: "added" | "duplicate" }> = [];
  for (const key of parsed.data.keys) {
    const added = await db.execute({
      sql: "INSERT INTO email_api_keys (id, label, key_encrypted, key_hash, key_hint, account_tag, from_address) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(key_hash) DO NOTHING RETURNING id",
      args: [newId("emk"), key.label, await encryptSecret(key.key), emailKeyHash(key.key), `…${key.key.slice(-4)}`, key.accountTag, key.fromAddress],
    });
    results.push({ label: key.label, status: added.rows.length ? "added" : "duplicate" });
  }
  await logActivity({ actor: c.get("user"), action: "email_keys.add", entityType: "email_api_keys", summary: `Added ${results.filter((r) => r.status === "added").length} Resend keys`, ip: clientIp(c) });
  return c.json({ ...(await emailKeysOverview()), results }, 201);
});

emailKeyRoutes.put("/admin/email-keys/settings", ...gate, async (c) => {
  if (!(await emailTablesReady())) return c.json({ error: "unavailable" }, 503);
  const parsed = z.object({
    mode: z.enum(["live", "test"]), rotationSeconds: z.number().int().min(1).max(86400),
    windowRequests: z.number().int().min(0).max(1_000_000), windowSeconds: z.number().int().min(1).max(2_678_400),
    quotaRetrySeconds: z.number().int().min(1).max(2_678_400),
  }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", message: "Enter positive whole-number timings and a non-negative request budget." }, 400);
  const before = await emailKeysOverview();
  const { mode, rotationSeconds, windowRequests, windowSeconds, quotaRetrySeconds } = parsed.data;
  if (mode === "live" && !before.keys.some((k) => k.isLive && k.enabled) && !before.envKeyPresent) return c.json({ error: "no_live_key", message: "Choose an enabled live key first." }, 409);
  if (mode === "test" && !before.keys.some((k) => !k.isLive && k.enabled)) return c.json({ error: "no_test_keys", message: "Add and enable a testing key first." }, 409);
  await executeBatch([
    ["resend_key_mode", mode], ["resend_rotation_seconds", String(rotationSeconds)],
    ["resend_window_requests", String(windowRequests)], ["resend_window_seconds", String(windowSeconds)],
    ["resend_quota_retry_seconds", String(quotaRetrySeconds)],
  ].map(([key, value]) => ({ sql: "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')", args: [key, value] })));
  await logActivity({ actor: c.get("user"), action: "email_keys.settings", entityType: "settings", summary: `Resend: ${mode} mode, rotate every ${rotationSeconds} seconds`, before: { mode: before.mode, rotationSeconds: before.rotationSeconds, windowRequests: before.windowRequests, windowSeconds: before.windowSeconds, quotaRetrySeconds: before.quotaRetrySeconds }, after: parsed.data, ip: clientIp(c) });
  return c.json(await emailKeysOverview());
});

emailKeyRoutes.put("/admin/email-keys/:id/live", ...gate, async (c) => {
  if (!(await emailTablesReady())) return c.json({ error: "unavailable" }, 503);
  const id = c.req.param("id") as string;
  const result = await executeBatch([
    // Clear the old designation only if the new key exists and is enabled.
    { sql: "UPDATE email_api_keys SET is_live = 0 WHERE is_live = 1 AND EXISTS (SELECT 1 FROM email_api_keys WHERE id = ? AND enabled = 1)", args: [id] },
    { sql: "UPDATE email_api_keys SET is_live = 1 WHERE id = ? AND enabled = 1", args: [id] },
  ]);
  if (result[1] === 0) return c.json({ error: "not_found", message: "Choose an enabled key." }, 404);
  await logActivity({ actor: c.get("user"), action: "email_keys.live", entityType: "email_api_keys", entityId: id, summary: "Changed the live Resend key", ip: clientIp(c) });
  return c.json(await emailKeysOverview());
});

emailKeyRoutes.patch("/admin/email-keys/:id", ...gate, async (c) => {
  if (!(await emailTablesReady())) return c.json({ error: "unavailable" }, 503);
  const parsed = z.object({ enabled: z.boolean() }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const id = c.req.param("id") as string;
  const overview = await emailKeysOverview();
  const key = overview.keys.find((k) => k.id === id);
  if (!key) return c.json({ error: "not_found" }, 404);
  if (!parsed.data.enabled && key.isLive && overview.mode === "live") return c.json({ error: "live_key_in_use", message: "Switch to testing mode or choose a different live key first." }, 409);
  await db.execute({ sql: "UPDATE email_api_keys SET enabled = ? WHERE id = ?", args: [parsed.data.enabled ? 1 : 0, id] });
  await logActivity({ actor: c.get("user"), action: "email_keys.enabled", entityType: "email_api_keys", entityId: id, summary: `${parsed.data.enabled ? "Enabled" : "Disabled"} a Resend key`, ip: clientIp(c) });
  return c.json(await emailKeysOverview());
});

emailKeyRoutes.delete("/admin/email-keys/:id", ...gate, async (c) => {
  if (!(await emailTablesReady())) return c.json({ error: "unavailable" }, 503);
  const id = c.req.param("id") as string;
  const overview = await emailKeysOverview();
  const key = overview.keys.find((k) => k.id === id);
  if (!key) return c.json({ error: "not_found" }, 404);
  if (key.isLive && overview.mode === "live") return c.json({ error: "live_key_in_use", message: "Switch to testing mode or choose a different live key first." }, 409);
  await db.execute({ sql: "DELETE FROM email_api_keys WHERE id = ?", args: [id] });
  await logActivity({ actor: c.get("user"), action: "email_keys.remove", entityType: "email_api_keys", entityId: id, summary: "Removed a Resend key", ip: clientIp(c) });
  return c.json(await emailKeysOverview());
});
