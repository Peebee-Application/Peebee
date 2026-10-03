import { createHash } from "node:crypto";
import { db } from "../db/client.js";
import { decryptSecret, encryptSecret } from "../lib/crypto.js";
import { newId } from "../lib/ids.js";
import { hasTable } from "../lib/schema.js";
import { getSetting, setSetting } from "../lib/settings.js";

/**
 * Google AI Studio (Gemini) API keys managed from the admin app.
 *
 *  - "test" mode: every enabled non-master key is a candidate. Requests go to
 *    the least-recently-used one; when Google says a key is out of quota it is
 *    set aside until its limit resets and the next key takes over, all inside
 *    the same request, so a rider never sees the rotation.
 *  - "paid" mode: only the master key is used, never rotated.
 *
 * With no keys saved (or before the 0074 migration is applied) the
 * GEMINI_API_KEY secret is used as before.
 */

export type KeyMode = "test" | "paid";

export async function getKeyMode(): Promise<KeyMode> {
  return (await getSetting("gemini_key_mode")) === "paid" ? "paid" : "test";
}

export async function setKeyMode(mode: KeyMode): Promise<void> {
  await setSetting("gemini_key_mode", mode);
}

type Row = Record<string, unknown>;

export type AiKey = {
  id: string;
  label: string;
  hint: string;
  enabled: boolean;
  isMaster: boolean;
  /** "ready" can take requests now; "cooling" is waiting for a limit to reset. */
  status: "ready" | "cooling" | "disabled";
  cooldownUntil: string | null;
  cooldownReason: string | null;
  lastError: string | null;
  lastUsedAt: string | null;
  useCount: number;
  failCount: number;
  createdAt: string;
};

function toKey(r: Row, now = Date.now()): AiKey {
  const cooldownUntil = (r.cooldown_until as string | null) ?? null;
  const cooling = !!cooldownUntil && Date.parse(cooldownUntil) > now;
  const enabled = Number(r.enabled) === 1;
  return {
    id: String(r.id),
    label: String(r.label),
    hint: String(r.key_hint),
    enabled,
    isMaster: Number(r.is_master) === 1,
    status: !enabled ? "disabled" : cooling ? "cooling" : "ready",
    cooldownUntil: cooling ? cooldownUntil : null,
    cooldownReason: cooling ? ((r.cooldown_reason as string | null) ?? null) : null,
    lastError: (r.last_error as string | null) ?? null,
    lastUsedAt: (r.last_used_at as string | null) ?? null,
    useCount: Number(r.use_count) || 0,
    failCount: Number(r.fail_count) || 0,
    createdAt: String(r.created_at),
  };
}

export async function listKeys(): Promise<AiKey[]> {
  if (!(await hasTable("ai_api_keys"))) return [];
  const res = await db.execute("SELECT * FROM ai_api_keys WHERE provider = 'gemini' ORDER BY is_master DESC, rowid ASC");
  return (res.rows as Row[]).map((r) => toKey(r));
}

const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");
const hintOf = (key: string) => `…${key.slice(-4)}`;

// ---------------------------------------------------------------------------
// Telling Google's answers apart
// ---------------------------------------------------------------------------

export type KeyFailure = "quota_day" | "quota_minute" | "quota_unknown" | "invalid_key" | "other";

export class GeminiApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    what: string,
  ) {
    super(`Gemini ${what} failed: ${status} ${body}`);
  }
}

/** What an error from Google means for the key that made the request. */
export function classifyFailure(status: number, body: string): KeyFailure {
  if (status === 429) {
    if (/PerDay|per day|daily/i.test(body)) return "quota_day";
    if (/PerMinute|per minute/i.test(body)) return "quota_minute";
    return "quota_unknown";
  }
  if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(body)) return "invalid_key";
  if (status === 401 || status === 403) return /quota|RESOURCE_EXHAUSTED/i.test(body) ? "quota_unknown" : "invalid_key";
  return "other";
}

/** The next midnight in Pacific time — when Google resets daily free-tier quota. */
export function nextPacificMidnight(from = new Date()): Date {
  const parts = (d: Date) =>
    Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric" })
        .formatToParts(d)
        .map((p) => [p.type, Number(p.value)]),
    ) as { year: number; month: number; day: number; hour: number };
  const p = parts(from);
  // Midnight Pacific tomorrow is 07:00 or 08:00 UTC depending on daylight saving; take whichever lands on hour 0 there.
  for (const offset of [7, 8]) {
    const candidate = new Date(Date.UTC(p.year, p.month - 1, p.day + 1, offset, 0, 0));
    if (parts(candidate).hour === 0 && candidate > from) return candidate;
  }
  return new Date(from.getTime() + 24 * 3600_000);
}

const MINUTE_COOLDOWN_MS = 90_000;
const UNKNOWN_QUOTA_COOLDOWN_MS = 60 * 60_000;
const INVALID_KEY_COOLDOWN_MS = 24 * 3600_000;

export function cooldownFor(kind: KeyFailure, now = new Date()): { until: Date; reason: string } | null {
  switch (kind) {
    case "quota_day":
      return { until: nextPacificMidnight(now), reason: "Daily limit reached — back after the reset" };
    case "quota_minute":
      return { until: new Date(now.getTime() + MINUTE_COOLDOWN_MS), reason: "Per-minute limit reached — back in a moment" };
    case "quota_unknown":
      // Could be a weekly/monthly cap we can't read the reset of — try again in an hour.
      return { until: new Date(now.getTime() + UNKNOWN_QUOTA_COOLDOWN_MS), reason: "Limit reached — will retry in an hour" };
    case "invalid_key":
      return { until: new Date(now.getTime() + INVALID_KEY_COOLDOWN_MS), reason: "Google rejected this key" };
    default:
      return null;
  }
}

async function markFailure(id: string, kind: KeyFailure, detail: string): Promise<void> {
  const cd = cooldownFor(kind);
  await db.execute({
    sql: `UPDATE ai_api_keys SET fail_count = fail_count + 1, last_error = ?, cooldown_until = ?, cooldown_reason = ? WHERE id = ?`,
    args: [detail.slice(0, 300), cd ? cd.until.toISOString() : null, cd?.reason ?? null, id],
  });
}

async function markSuccess(id: string): Promise<void> {
  await db.execute({
    sql: `UPDATE ai_api_keys SET use_count = use_count + 1, last_used_at = ?, last_error = NULL, cooldown_until = NULL, cooldown_reason = NULL WHERE id = ?`,
    args: [new Date().toISOString(), id],
  });
}

// ---------------------------------------------------------------------------
// Using a key
// ---------------------------------------------------------------------------

export class NoUsableKeyError extends Error {}

async function decrypted(id: string, encrypted: string): Promise<{ id: string; secret: string }> {
  return { id, secret: await decryptSecret(encrypted) };
}

/**
 * Runs `use` with an API key, rotating when a key is out of quota (test
 * mode) or using only the master key (paid mode). `use` should throw a
 * GeminiApiError for any non-OK reply from Google so the failure can be read.
 */
export async function withGeminiKey<T>(use: (apiKey: string) => Promise<T>): Promise<T> {
  const envKey = process.env.GEMINI_API_KEY;
  if (!(await hasTable("ai_api_keys"))) {
    if (!envKey) throw new NoUsableKeyError("GEMINI_API_KEY is not set");
    return use(envKey);
  }
  const rows = ((await db.execute("SELECT * FROM ai_api_keys WHERE provider = 'gemini' AND enabled = 1 ORDER BY rowid")).rows as Row[]);
  // Nothing saved in the admin app yet: behave exactly as before.
  const anySaved = rows.length > 0 || ((await db.execute("SELECT 1 FROM ai_api_keys WHERE provider = 'gemini' LIMIT 1")).rows.length > 0);
  if (!anySaved) {
    if (!envKey) throw new NoUsableKeyError("No Google AI key is set. Add one in Settings → Google AI keys.");
    return use(envKey);
  }

  const mode = await getKeyMode();
  const now = Date.now();
  const ready = (r: Row) => !r.cooldown_until || Date.parse(String(r.cooldown_until)) <= now;

  if (mode === "paid") {
    const master = rows.find((r) => Number(r.is_master) === 1);
    if (!master) throw new NoUsableKeyError("Paid mode is on but there is no enabled master key. Pick one in Settings → Google AI keys.");
    const { id, secret } = await decrypted(String(master.id), String(master.key_encrypted));
    try {
      const out = await use(secret);
      await markSuccess(id);
      return out;
    } catch (err) {
      if (err instanceof GeminiApiError) await markFailure(id, classifyFailure(err.status, err.body), err.message);
      throw err;
    }
  }

  // Test mode: the master key is kept for paid mode and never burned here.
  const pool = rows
    .filter((r) => Number(r.is_master) !== 1 && ready(r))
    .sort((a, b) => String(a.last_used_at ?? "").localeCompare(String(b.last_used_at ?? "")));
  if (pool.length === 0) {
    const next = (await listKeys()).filter((k) => !k.isMaster && k.enabled && k.cooldownUntil).map((k) => k.cooldownUntil as string).sort()[0];
    throw new NoUsableKeyError(
      next
        ? `Every test key is at its limit. The next one is back at ${next}. Add more keys in Settings → Google AI keys.`
        : "No enabled test keys. Add one in Settings → Google AI keys.",
    );
  }

  let lastError: unknown;
  for (const row of pool) {
    const { id, secret } = await decrypted(String(row.id), String(row.key_encrypted));
    try {
      const out = await use(secret);
      await markSuccess(id);
      return out;
    } catch (err) {
      lastError = err;
      if (!(err instanceof GeminiApiError)) throw err;
      const kind = classifyFailure(err.status, err.body);
      if (kind === "other") throw err; // not this key's fault (e.g. Google is busy) — don't burn through the rest
      await markFailure(id, kind, err.message);
    }
  }
  throw new NoUsableKeyError(`Every test key is at its limit right now (last error: ${lastError instanceof Error ? lastError.message.slice(0, 200) : "unknown"}). Add more keys in Settings → Google AI keys.`);
}

// ---------------------------------------------------------------------------
// Admin operations
// ---------------------------------------------------------------------------

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/** A cheap call that proves a key is real without spending generation quota. */
export async function pingKey(apiKey: string): Promise<{ ok: boolean; limited: boolean; detail: string }> {
  try {
    const res = await fetch(`${BASE_URL}/models?pageSize=1`, { headers: { "x-goog-api-key": apiKey } });
    if (res.ok) return { ok: true, limited: false, detail: "Key works" };
    const body = await res.text();
    const kind = classifyFailure(res.status, body);
    if (kind.startsWith("quota")) return { ok: true, limited: true, detail: "Key is valid but currently at its limit" };
    return { ok: false, limited: false, detail: kind === "invalid_key" ? "Google rejected this key" : `Google answered ${res.status}` };
  } catch {
    return { ok: false, limited: false, detail: "Couldn't reach Google to check this key" };
  }
}

export type AddResult = { label: string; hint: string; status: "added" | "duplicate" | "rejected"; detail?: string };

export async function addKeys(entries: Array<{ label?: string; key: string }>, createdBy: string): Promise<AddResult[]> {
  const existingCount = (await listKeys()).length;
  const results: AddResult[] = [];
  let n = existingCount;
  for (const entry of entries) {
    const key = entry.key.trim();
    const label = entry.label?.trim() || `Key ${++n}`;
    const hint = hintOf(key);
    if (key.length < 20 || /\s/.test(key)) {
      results.push({ label, hint, status: "rejected", detail: "That doesn't look like an API key" });
      continue;
    }
    const hash = hashKey(key);
    const dup = await db.execute({ sql: "SELECT 1 FROM ai_api_keys WHERE provider = 'gemini' AND key_hash = ?", args: [hash] });
    if (dup.rows.length > 0) {
      results.push({ label, hint, status: "duplicate", detail: "Already added" });
      continue;
    }
    const check = await pingKey(key);
    if (!check.ok) {
      results.push({ label, hint, status: "rejected", detail: check.detail });
      continue;
    }
    await db.execute({
      sql: `INSERT INTO ai_api_keys (id, label, key_encrypted, key_hash, key_hint, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [newId("aik"), label, await encryptSecret(key), hash, hint, createdBy],
    });
    results.push({ label, hint, status: "added", detail: check.limited ? "Added (currently at its limit — will be used after it resets)" : undefined });
  }
  return results;
}

export async function getKeyRow(id: string): Promise<Row | undefined> {
  return (await db.execute({ sql: "SELECT * FROM ai_api_keys WHERE id = ? AND provider = 'gemini'", args: [id] })).rows[0] as Row | undefined;
}

export async function testKey(id: string): Promise<{ ok: boolean; detail: string } | null> {
  const row = await getKeyRow(id);
  if (!row) return null;
  const check = await pingKey(await decryptSecret(String(row.key_encrypted)));
  if (!check.ok) await markFailure(id, "invalid_key", check.detail);
  else if (!check.limited) await db.execute({ sql: "UPDATE ai_api_keys SET last_error = NULL WHERE id = ?", args: [id] });
  return { ok: check.ok, detail: check.detail };
}

export async function setMaster(id: string | null): Promise<void> {
  await db.execute("UPDATE ai_api_keys SET is_master = 0 WHERE provider = 'gemini'");
  if (id) await db.execute({ sql: "UPDATE ai_api_keys SET is_master = 1, enabled = 1 WHERE id = ?", args: [id] });
}
