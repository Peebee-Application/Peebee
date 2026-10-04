import { Hono } from "hono";
import { z } from "zod";
import { logActivity } from "../admin/activity.js";
import { requirePermission } from "../admin/permissions.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { isCredentialsEncryptionConfigured } from "../lib/crypto.js";
import { clientIp } from "../lib/ratelimit.js";
import { hasTable } from "../lib/schema.js";
import { nextRotationAt } from "../lib/key-rotation.js";
import { getSetting, setSetting } from "../lib/settings.js";
import { addKeys, getKeyMode, getKeyRow, listKeys, removeKey, resetKey, setKeyMode, setMaster, setProjectTag, testKey } from "./ai-keys.js";

/** Admin management of the Google AI Studio keys — see ./ai-keys.ts. Gated like
 * the other credential screens (settings.manage); secrets never leave the server. */
export const aiKeyRoutes = new Hono();
const gate = [requireAuth, requireRole("admin"), requirePermission("settings.manage")] as const;

async function overview() {
  const mode = await getKeyMode();
  const rotationSeconds = Number(await getSetting("gemini_rotation_seconds"));
  return {
    mode,
    rotationSeconds,
    nextRotationAt: mode === "test" ? nextRotationAt(rotationSeconds) : null,
    keys: await listKeys(),
    tableReady: await hasTable("ai_api_keys"),
    encryptionConfigured: isCredentialsEncryptionConfigured(),
    envKeyPresent: !!process.env.GEMINI_API_KEY,
  };
}

aiKeyRoutes.get("/admin/ai-keys", ...gate, async (c) => c.json(await overview()));

aiKeyRoutes.put("/admin/ai-keys-rotation", ...gate, async (c) => {
  const parsed = z.object({ rotationSeconds: z.number().int().min(0).max(86400) }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const before = Number(await getSetting("gemini_rotation_seconds"));
  await setSetting("gemini_rotation_seconds", String(parsed.data.rotationSeconds));
  await logActivity({ actor: c.get("user"), action: "ai_keys.rotation", entityType: "settings", summary: `Google AI rotation interval: ${parsed.data.rotationSeconds} seconds`, before: { rotationSeconds: before }, after: parsed.data, ip: clientIp(c) });
  return c.json(await overview());
});

const addSchema = z.object({
  keys: z.array(z.object({ label: z.string().trim().max(60).optional(), key: z.string().max(200), projectTag: z.string().trim().max(60).optional() })).min(1).max(100),
});

aiKeyRoutes.post("/admin/ai-keys", ...gate, async (c) => {
  const user = c.get("user");
  if (!(await hasTable("ai_api_keys"))) return c.json({ error: "unavailable", message: "Apply migration 0074_ai_api_keys.sql first." }, 503);
  if (!isCredentialsEncryptionConfigured()) return c.json({ error: "no_encryption", message: "CREDENTIALS_ENCRYPTION_KEY isn't set, so keys can't be stored safely." }, 503);
  const parsed = addSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const results = await addKeys(parsed.data.keys, user.sub);
  const added = results.filter((r) => r.status === "added");
  if (added.length > 0) {
    await logActivity({ actor: user, action: "ai_keys.add", entityType: "ai_api_keys", summary: `Added ${added.length} Google AI key${added.length > 1 ? "s" : ""}: ${added.map((r) => `${r.label} (${r.hint})`).join(", ")}`, ip: clientIp(c) });
  }
  return c.json({ results, ...(await overview()) }, 201);
});

const patchSchema = z.object({ enabled: z.boolean().optional(), label: z.string().trim().min(1).max(60).optional(), projectTag: z.string().trim().max(60).nullable().optional() });

aiKeyRoutes.patch("/admin/ai-keys/:id", ...gate, async (c) => {
  const user = c.get("user");
  const id = (c.req.param("id") as string);
  const row = await getKeyRow(id);
  if (!row) return c.json({ error: "not_found" }, 404);
  const parsed = patchSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  if (parsed.data.enabled === false && Number(row.is_master) === 1 && (await getKeyMode()) === "paid") {
    return c.json({ error: "master_in_use", message: "Paid mode is on — switch to test mode or pick another master key first." }, 409);
  }
  if (parsed.data.enabled != null) await db.execute({ sql: "UPDATE ai_api_keys SET enabled = ? WHERE id = ?", args: [parsed.data.enabled ? 1 : 0, id] });
  if (parsed.data.label) await db.execute({ sql: "UPDATE ai_api_keys SET label = ? WHERE id = ?", args: [parsed.data.label, id] });
  if (parsed.data.projectTag !== undefined) await setProjectTag(id, parsed.data.projectTag);
  await logActivity({ actor: user, action: "ai_keys.update", entityType: "ai_api_keys", entityId: id, summary: `Updated Google AI key ${String(row.label)} (${String(row.key_hint)})${parsed.data.enabled != null ? (parsed.data.enabled ? " — enabled" : " — disabled") : ""}`, ip: clientIp(c) });
  return c.json(await overview());
});

aiKeyRoutes.post("/admin/ai-keys/:id/reset", ...gate, async (c) => {
  const id = (c.req.param("id") as string);
  if (!(await getKeyRow(id))) return c.json({ error: "not_found" }, 404);
  await resetKey(id);
  return c.json(await overview());
});

aiKeyRoutes.post("/admin/ai-keys/:id/test", ...gate, async (c) => {
  const result = await testKey((c.req.param("id") as string));
  if (!result) return c.json({ error: "not_found" }, 404);
  return c.json({ result, ...(await overview()) });
});

aiKeyRoutes.put("/admin/ai-keys/:id/master", ...gate, async (c) => {
  const user = c.get("user");
  const id = (c.req.param("id") as string);
  const row = await getKeyRow(id);
  if (!row) return c.json({ error: "not_found" }, 404);
  await setMaster(id);
  await logActivity({ actor: user, action: "ai_keys.master", entityType: "ai_api_keys", entityId: id, summary: `Made Google AI key ${String(row.label)} (${String(row.key_hint)}) the master key`, ip: clientIp(c) });
  return c.json(await overview());
});

aiKeyRoutes.delete("/admin/ai-keys/:id/master", ...gate, async (c) => {
  const user = c.get("user");
  if ((await getKeyMode()) === "paid") return c.json({ error: "master_in_use", message: "Paid mode is on — switch to test mode first." }, 409);
  await setMaster(null);
  await logActivity({ actor: user, action: "ai_keys.master.clear", entityType: "ai_api_keys", summary: "Cleared the master Google AI key", ip: clientIp(c) });
  return c.json(await overview());
});

aiKeyRoutes.delete("/admin/ai-keys/:id", ...gate, async (c) => {
  const user = c.get("user");
  const id = (c.req.param("id") as string);
  const row = await getKeyRow(id);
  if (!row) return c.json({ error: "not_found" }, 404);
  if (Number(row.is_master) === 1 && (await getKeyMode()) === "paid") {
    return c.json({ error: "master_in_use", message: "Paid mode is on — switch to test mode or pick another master key first." }, 409);
  }
  await removeKey(id);
  await logActivity({ actor: user, action: "ai_keys.remove", entityType: "ai_api_keys", entityId: id, summary: `Removed Google AI key ${String(row.label)} (${String(row.key_hint)})`, ip: clientIp(c) });
  return c.json(await overview());
});

aiKeyRoutes.put("/admin/ai-keys-mode", ...gate, async (c) => {
  const user = c.get("user");
  const parsed = z.object({ mode: z.enum(["test", "paid"]) }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  if (parsed.data.mode === "paid") {
    const master = (await listKeys()).find((k) => k.isMaster && k.enabled);
    if (!master) return c.json({ error: "no_master", message: "Pick an enabled master key before switching to paid mode." }, 409);
  }
  const before = await getKeyMode();
  await setKeyMode(parsed.data.mode);
  await logActivity({ actor: user, action: "ai_keys.mode", entityType: "settings", summary: `Google AI keys: ${before} mode → ${parsed.data.mode} mode`, before: { mode: before }, after: { mode: parsed.data.mode }, ip: clientIp(c) });
  return c.json(await overview());
});
