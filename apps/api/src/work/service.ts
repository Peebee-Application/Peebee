import { db, executeBatch, type DbStatement } from "../db/client.js";
import { tablesExist } from "../lib/schema.js";
import { newId } from "../lib/ids.js";
import { haversineKm } from "../lib/geo.js";
import type { PlatformEnvironment } from "../lib/settings.js";
import { notifyUser } from "../lib/webpush.js";
import { creditProviderWorkWallet } from "../wallet/provider-work-wallet.js";
import type { WorkSettings } from "./settings.js";

export type Row = Record<string, any>;

// ---------------------------------------------------------------------------
// Time. Stored as SQLite's "YYYY-MM-DD HH:MM:SS" (UTC) so it sorts and compares
// with datetime('now') in SQL.
// ---------------------------------------------------------------------------

export const toDb = (d: Date = new Date()) => d.toISOString().slice(0, 19).replace("T", " ");
export const fromDb = (s: string) => new Date(`${s.replace(" ", "T")}Z`);
export const inMinutes = (m: number) => toDb(new Date(Date.now() + m * 60_000));
export const inHours = (h: number) => inMinutes(h * 60);

// ---------------------------------------------------------------------------
// Is the Work schema there yet? Everything answers "upgrade pending" until
// migration 0098 is applied. Cached briefly; tests reset it.
// ---------------------------------------------------------------------------

let readyCache: { at: number; ok: boolean } | null = null;
let extrasCache: { at: number; ok: boolean } | null = null;
let onsiteCache: { at: number; ok: boolean } | null = null;
export function resetWorkSchemaCache() {
  readyCache = null;
  extrasCache = null;
  onsiteCache = null;
}
export async function workReady(): Promise<boolean> {
  if (readyCache && (readyCache.ok || Date.now() - readyCache.at < 30_000)) return readyCache.ok;
  const ok = await tablesExist(["work_services", "work_providers", "work_jobs", "work_offers", "work_money", "work_events", "work_provider_members", "work_provider_services"]);
  readyCache = { at: Date.now(), ok };
  return ok;
}

/** Migration 0099 (re-matching, photos, chat, tracking). Those features switch on once it is applied; until then the engine behaves as before. */
export async function workExtrasReady(): Promise<boolean> {
  if (extrasCache && (extrasCache.ok || Date.now() - extrasCache.at < 30_000)) return extrasCache.ok;
  let ok = false;
  try {
    const tables = (await tablesExist(["work_job_photos", "work_messages"])) ? 2 : 0;
    const col = (await db.execute({ sql: "SELECT 1 FROM pragma_table_info('work_jobs') WHERE name = 'rematch_count'", args: [] })).rows.length > 0;
    ok = tables === 2 && col;
  } catch {
    ok = false;
  }
  extrasCache = { at: Date.now(), ok };
  return ok;
}

/** Migration 0100 (location trail and on-site review queue). Until it is applied nothing is recorded or flagged. */
export async function workOnsiteReady(): Promise<boolean> {
  if (onsiteCache && (onsiteCache.ok || Date.now() - onsiteCache.at < 30_000)) return onsiteCache.ok;
  let ok = false;
  try {
    ok = await tablesExist(["work_job_locations", "work_flags"]);
  } catch {
    ok = false;
  }
  onsiteCache = { at: Date.now(), ok };
  return ok;
}

// ---------------------------------------------------------------------------
// Pricing and splits (pure, so they can be tested without a database)
// ---------------------------------------------------------------------------

export const percentOf = (amount: number, percent: number) => Math.round((amount * percent) / 100);

/** The commission that applies to a service: its own override, else the platform default. */
export function commissionFor(service: Row, settings: WorkSettings): number {
  const own = service.commission_percent;
  return own === null || own === undefined ? settings.commissionPercent : Number(own);
}

/**
 * Splits money held for a job. `refundUgx` goes back to the customer; the rest
 * is the provider's side, of which Peebee keeps its commission. The three parts
 * always add up to `held` exactly.
 */
export function splitHeld(held: number, commissionPercent: number, refundUgx: number) {
  const refund = Math.max(0, Math.min(held, Math.round(refundUgx)));
  const providerSide = held - refund;
  const commission = percentOf(providerSide, commissionPercent);
  return { refund, commission, payout: providerSide - commission };
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type ActorKind = "customer" | "provider" | "worker" | "admin" | "system";

export async function logEvent(jobId: string, actorId: string | null, kind: ActorKind, action: string, detail?: unknown) {
  await db.execute({
    sql: "INSERT INTO work_events (id, job_id, actor_id, actor_kind, action, detail) VALUES (?, ?, ?, ?, ?, ?)",
    args: [newId("wev"), jobId, actorId, kind, action, detail === undefined ? null : JSON.stringify(detail)],
  });
}

// ---------------------------------------------------------------------------
// Money. The wallet is the customer's payment. Every movement is a work_money
// row applied by ONE atomic batch that only acts while the row is still
// 'pending', so applying it twice (a retry, a crash, two workers) has no effect.
// ---------------------------------------------------------------------------

const balanceColumn = (env: PlatformEnvironment) => (env === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance");
const PENDING = "EXISTS (SELECT 1 FROM work_money WHERE id = ? AND status = 'pending')";

/** Pays a pending refund/payout into the user's wallet, exactly once. */
export async function applyMoney(moneyId: string): Promise<boolean> {
  const row = (await db.execute({ sql: "SELECT * FROM work_money WHERE id = ?", args: [moneyId] })).rows[0] as Row | undefined;
  if (!row || row.status !== "pending" || row.kind === "hold") return false;
  const col = balanceColumn(row.environment === "sandbox" ? "sandbox" : "live");
  if (row.kind === "payout" && await tablesExist(["provider_wallets"])) {
    const job = (await db.execute({ sql: "SELECT provider_id FROM work_jobs WHERE id = ?", args: [row.job_id] })).rows[0] as Row | undefined;
    if (!job?.provider_id) return false;
    await creditProviderWorkWallet({
      providerType: "work",
      providerId: String(job.provider_id),
      amount: Number(row.amount_ugx),
      environment: row.environment === "sandbox" ? "sandbox" : "live",
      referenceType: "work_money",
      referenceId: moneyId,
      idempotencyKey: `work-payout:${moneyId}`,
      actorId: String(row.user_id),
      note: row.note || "Peebee Work earnings",
    });
    const completed = await db.execute({
      sql: "UPDATE work_money SET status='done', done_at=datetime('now') WHERE id=? AND status='pending'",
      args: [moneyId],
    });
    return completed.rowsAffected === 1;
  }
  const ledgerType = row.kind === "refund" ? "refund" : "adjustment";
  const changes = await executeBatch([
    { sql: `UPDATE users SET ${col} = ${col} + ?, updated_at = datetime('now') WHERE id = ? AND ${PENDING}`, args: [row.amount_ugx, row.user_id, moneyId] },
    {
      sql: `INSERT INTO wallet_ledger (id, user_id, type, amount, balance_after, note, environment)
            SELECT ?, ?, ?, ?, (SELECT ${col} FROM users WHERE id = ?), ?, ? WHERE ${PENDING}`,
      args: [newId("wl"), row.user_id, ledgerType, row.amount_ugx, row.user_id, row.note || `Peebee Work ${row.kind}`, row.environment, moneyId],
    },
    { sql: "UPDATE work_money SET status = 'done', done_at = datetime('now') WHERE id = ? AND status = 'pending'", args: [moneyId] },
  ]);
  return changes[2] === 1;
}

/** Applies every pending refund/payout (optionally just one job's). Failures are logged and retried by the sweep. */
export async function applyPendingMoney(jobId?: string): Promise<number> {
  const rows = (
    await db.execute({
      sql: `SELECT id FROM work_money WHERE status = 'pending' AND kind != 'hold' ${jobId ? "AND job_id = ?" : ""} ORDER BY created_at LIMIT 100`,
      args: jobId ? [jobId] : [],
    })
  ).rows as Row[];
  let done = 0;
  for (const r of rows) {
    try {
      if (await applyMoney(String(r.id))) done += 1;
    } catch (err) {
      console.error(`[work] could not apply money ${r.id}:`, err);
    }
  }
  return done;
}

/**
 * Takes `amount` from the customer's wallet for a job and, in the same atomic
 * batch, runs `then` (the job update that depends on being paid). Insufficient
 * balance changes nothing. Repeating it after success is a no-op.
 * Returns `charged` (the money is held, by this call or an earlier identical
 * one), `debited` (THIS call took it — only then may it ever give it back) and
 * `applied` (`then` took effect).
 */
export async function chargeCustomer(input: {
  jobId: string;
  key: string;
  customerId: string;
  amount: number;
  environment: PlatformEnvironment;
  note: string;
  then: DbStatement;
}): Promise<{ charged: boolean; debited: boolean; applied: boolean }> {
  const moneyId = `hold:${input.jobId}:${input.key}`;
  const col = balanceColumn(input.environment);
  await db.execute({
    sql: `INSERT OR IGNORE INTO work_money (id, job_id, user_id, kind, amount_ugx, status, note, environment) VALUES (?, ?, ?, 'hold', ?, 'pending', ?, ?)`,
    args: [moneyId, input.jobId, input.customerId, input.amount, input.note, input.environment],
  });
  const changes = await executeBatch([
    { sql: `UPDATE users SET ${col} = ${col} - ?, updated_at = datetime('now') WHERE id = ? AND ${col} >= ? AND ${PENDING}`, args: [input.amount, input.customerId, input.amount, moneyId] },
    { sql: "UPDATE work_money SET status = 'done', done_at = datetime('now') WHERE id = ? AND status = 'pending' AND changes() > 0", args: [moneyId] },
    {
      sql: `INSERT INTO wallet_ledger (id, user_id, type, amount, balance_after, note, environment)
            SELECT ?, ?, 'adjustment', ?, (SELECT ${col} FROM users WHERE id = ?), ?, ? WHERE changes() > 0`,
      args: [newId("wl"), input.customerId, -input.amount, input.customerId, input.note, input.environment],
    },
    // Only if the payment above really happened (it is not 'pending' any more).
    {
      sql: `${input.then.sql.replace(/;?\s*$/, "")} AND EXISTS (SELECT 1 FROM work_money WHERE id = ? AND status = 'done')`,
      args: [...(input.then.args ?? []), moneyId],
    },
  ]);
  const paid = (await db.execute({ sql: "SELECT status FROM work_money WHERE id = ?", args: [moneyId] })).rows[0] as Row | undefined;
  return { charged: paid?.status === "done", debited: changes[0] === 1, applied: changes[3] === 1 };
}

/** Forgets a charge attempt that never took money (insufficient balance). */
export async function dropUnpaidHold(jobId: string, key: string) {
  await db.execute({ sql: "DELETE FROM work_money WHERE id = ? AND status = 'pending' AND kind = 'hold'", args: [`hold:${jobId}:${key}`] });
}

// ---------------------------------------------------------------------------
// Status changes. One conditional UPDATE decides which request wins; the event
// and any refund/payout rows are written in the same batch, so a change and its
// money can never be separated.
// ---------------------------------------------------------------------------

export type MoneyPlan = { kind: "refund" | "payout"; userId: string; amount: number; note: string };

export async function transition(input: {
  jobId: string;
  from: string[];
  to: string;
  /** Extra columns to set (literal SQL fragments with ? placeholders) and their values. */
  set?: Record<string, unknown>;
  /** Extra conditions on the row, e.g. `provider_id = ?`. */
  where?: { sql: string; args: unknown[] };
  money?: MoneyPlan[];
  environment: PlatformEnvironment;
  actor: { id: string | null; kind: ActorKind };
  action: string;
  detail?: unknown;
}): Promise<boolean> {
  const sets = Object.keys(input.set ?? {});
  const statements: DbStatement[] = [
    {
      sql: `UPDATE work_jobs SET status = ?, ${sets.map((k) => `${k} = ?`).join(", ")}${sets.length ? ", " : ""}updated_at = datetime('now')
            WHERE id = ? AND status IN (${input.from.map(() => "?").join(", ")})${input.where ? ` AND ${input.where.sql}` : ""}`,
      args: [input.to, ...sets.map((k) => (input.set as Record<string, unknown>)[k]), input.jobId, ...input.from, ...(input.where?.args ?? [])],
    },
    {
      sql: `INSERT INTO work_events (id, job_id, actor_id, actor_kind, action, detail) SELECT ?, ?, ?, ?, ?, ? WHERE changes() > 0`,
      args: [newId("wev"), input.jobId, input.actor.id, input.actor.kind, input.action, input.detail === undefined ? null : JSON.stringify(input.detail)],
    },
  ];
  for (const m of input.money ?? []) {
    if (m.amount <= 0) continue;
    statements.push({
      // A fixed id per job and kind: a repeat of the same outcome is ignored.
      sql: `INSERT OR IGNORE INTO work_money (id, job_id, user_id, kind, amount_ugx, status, note, environment)
            SELECT ?, ?, ?, ?, ?, 'pending', ?, ? WHERE EXISTS (SELECT 1 FROM work_jobs WHERE id = ? AND status = ?)`,
      args: [`${m.kind}:${input.jobId}`, input.jobId, m.userId, m.kind, m.amount, m.note, input.environment, input.jobId, input.to],
    });
  }
  const changes = await executeBatch(statements);
  if (changes[0] !== 1) return false;
  if (input.money?.length) await applyPendingMoney(input.jobId);
  return true;
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/** The provider this user works for (as owner or staff), if any. */
export async function providerFor(userId: string): Promise<{ provider: Row; role: "owner" | "staff" } | null> {
  const row = (
    await db.execute({
      sql: `SELECT p.*, m.role AS member_role FROM work_provider_members m JOIN work_providers p ON p.id = m.provider_id
            WHERE m.user_id = ? AND m.status = 'active' ORDER BY (m.role = 'owner') DESC LIMIT 1`,
      args: [userId],
    })
  ).rows[0] as Row | undefined;
  return row ? { provider: row, role: row.member_role === "owner" ? "owner" : "staff" } : null;
}

/** May this provider take jobs right now? */
export function canWork(provider: Row, settings: WorkSettings): boolean {
  if (settings.requireApproval && provider.status !== "approved") return false;
  if (provider.status === "suspended" || provider.status === "rejected") return false;
  return (settings.providerKinds as string[]).includes(provider.kind);
}

/** Open jobs a provider can see: their services, in range, still within the offer window. */
export async function openJobsFor(provider: Row, settings: WorkSettings): Promise<Row[]> {
  const rows = (
    await db.execute({
      sql: `SELECT j.* FROM work_jobs j
            WHERE j.status = 'open' AND j.matching_mode IN ('broadcast', 'customer_picks') AND j.environment = ?
              AND (j.expires_at IS NULL OR j.expires_at > datetime('now'))
              AND j.service_id IN (SELECT service_id FROM work_provider_services WHERE provider_id = ?)
              AND NOT EXISTS (SELECT 1 FROM work_events e WHERE e.job_id = j.id AND e.action = 'provider_cancelled' AND json_extract(e.detail, '$.providerId') = ?)
            ORDER BY j.created_at DESC LIMIT 100`,
      args: [provider.environment, provider.id, provider.id],
    })
  ).rows as Row[];
  return rows.filter((j) => {
    if (j.lat == null || j.lng == null || provider.lat == null || provider.lng == null) return true;
    return haversineKm(Number(provider.lat), Number(provider.lng), Number(j.lat), Number(j.lng)) <= settings.radiusKm;
  });
}

/** Tells nearby online providers about a new job. Best effort, never blocks booking. */
export async function notifyProviders(job: Row, settings: WorkSettings): Promise<number> {
  try {
    const candidates = (
      await db.execute({
        sql: `SELECT p.id, p.user_id, p.lat, p.lng FROM work_providers p
              JOIN work_provider_services s ON s.provider_id = p.id AND s.service_id = ?
              WHERE p.online = 1 AND p.environment = ? ${settings.requireApproval ? "AND p.status = 'approved'" : "AND p.status NOT IN ('suspended', 'rejected')"}`,
        args: [job.service_id, job.environment],
      })
    ).rows as Row[];
    const near = candidates
      .map((p) => ({ p, km: p.lat == null || job.lat == null ? 0 : haversineKm(Number(p.lat), Number(p.lng), Number(job.lat), Number(job.lng)) }))
      .filter((c) => c.km <= settings.radiusKm)
      .sort((a, b) => a.km - b.km)
      .slice(0, settings.maxNotified);
    for (const { p } of near) {
      notifyUser(String(p.user_id), {
        title: `New ${job.service_type} job: ${job.service_name}`,
        body: `${job.area ?? job.address}`,
        url: "/jobs",
        tag: `work-${job.id}`,
      }).catch(() => {});
    }
    return near.length;
  } catch (err) {
    console.error("[work] provider notification failed:", err);
    return 0;
  }
}

export async function notifyCustomer(job: Row, title: string, body: string) {
  notifyUser(String(job.customer_id), { title, body, url: `/services/work/${job.id}`, tag: `work-${job.id}` }).catch(() => {});
}

/** What a customer sees about their provider. */
export function publicProvider(p: Row | null | undefined) {
  if (!p) return null;
  const count = Number(p.rating_count ?? 0);
  return {
    id: p.id,
    kind: p.kind,
    name: p.kind === "company" ? p.company_name || p.display_name : p.display_name,
    bio: p.bio ?? "",
    rating: count ? Math.round((Number(p.rating_sum) / count) * 10) / 10 : null,
    ratingCount: count,
    jobsCompleted: Number(p.jobs_completed ?? 0),
  };
}
