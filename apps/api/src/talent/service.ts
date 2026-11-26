import { db, executeBatch, type DbStatement } from "../db/client.js";
import { tablesExist } from "../lib/schema.js";
import { newId } from "../lib/ids.js";
import { hasTable } from "../lib/schema.js";
import type { PlatformEnvironment } from "../lib/settings.js";
import { notifyUser } from "../lib/webpush.js";
import { creditProviderWorkWallet } from "../wallet/provider-work-wallet.js";

export type Row = Record<string, any>;

// ---------------------------------------------------------------------------
// Time. Stored as SQLite's "YYYY-MM-DD HH:MM:SS" (UTC) so it sorts and compares
// with datetime('now') in SQL.
// ---------------------------------------------------------------------------

export const toDb = (d: Date = new Date()) => d.toISOString().slice(0, 19).replace("T", " ");
export const fromDb = (s: string) => new Date(`${s.replace(" ", "T")}Z`);
export const inMinutes = (m: number) => toDb(new Date(Date.now() + m * 60_000));
export const inHours = (h: number) => inMinutes(h * 60);
export const inDays = (d: number) => inHours(d * 24);

export const percentOf = (amount: number, percent: number) => Math.round((amount * percent) / 100);
export const ugx = (n: number) => `UGX ${Math.round(n).toLocaleString("en-UG")}`;

// ---------------------------------------------------------------------------
// Is the Jobs schema there yet? Everything answers "upgrade pending" until
// migration 0110 is applied. Cached briefly; tests reset it.
// ---------------------------------------------------------------------------

const REQUIRED_TABLES = [
  "talent_categories", "talent_profiles", "talent_profile_categories", "talent_employers", "talent_jobs", "talent_applications", "talent_contracts",
  "talent_milestones", "talent_money", "talent_events", "talent_messages", "talent_reviews", "talent_reports", "talent_prohibited_terms",
  "talent_fee_rules", "talent_plans", "talent_subscriptions", "talent_features", "talent_charges", "talent_contact_unlocks", "talent_invites", "talent_recurrences",
];
let readyCache: { at: number; ok: boolean } | null = null;
export function resetTalentSchemaCache() {
  readyCache = null;
}
export async function talentReady(): Promise<boolean> {
  if (readyCache && (readyCache.ok || Date.now() - readyCache.at < 30_000)) return readyCache.ok;
  let ok = false;
  try {
    ok = await tablesExist(REQUIRED_TABLES);
  } catch {
    ok = false;
  }
  readyCache = { at: Date.now(), ok };
  return ok;
}

// ---------------------------------------------------------------------------
// Events: who did what, for support and disputes.
// ---------------------------------------------------------------------------

export type ActorKind = "employer" | "worker" | "admin" | "system";

export async function logEvent(input: { jobId?: string | null; contractId?: string | null; actorId: string | null; kind: ActorKind; action: string; detail?: unknown }) {
  await db.execute({
    sql: "INSERT INTO talent_events (id, job_id, contract_id, actor_id, actor_kind, action, detail) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [newId("tev"), input.jobId ?? null, input.contractId ?? null, input.actorId, input.kind, input.action, input.detail === undefined ? null : JSON.stringify(input.detail)],
  });
}

/** Best-effort push; never blocks the action that caused it. */
export function tell(userId: string, title: string, body: string, url: string, tag?: string) {
  notifyUser(userId, { title, body, url, tag: tag ?? `talent-${url}` }).catch(() => {});
}

export const balanceColumn = (env: PlatformEnvironment) => (env === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance");

// ---------------------------------------------------------------------------
// Escrow money. The employer's wallet pays; every movement is a talent_money
// row applied by ONE atomic batch that only acts while the row is 'pending', so
// applying it twice (a retry, a crash, two workers) has no effect.
// ---------------------------------------------------------------------------

const PENDING = "EXISTS (SELECT 1 FROM talent_money WHERE id = ? AND status = 'pending')";

/** Pays a pending refund/payout into the user's wallet, exactly once. */
export async function applyMoney(moneyId: string): Promise<boolean> {
  const row = (await db.execute({ sql: "SELECT * FROM talent_money WHERE id = ?", args: [moneyId] })).rows[0] as Row | undefined;
  if (!row || row.status !== "pending" || row.kind === "hold") return false;
  if (row.kind === "payout" && await hasTable("talent_profiles")) {
    await creditProviderWorkWallet({
      providerType: "talent",
      providerId: String(row.user_id),
      amount: Number(row.amount_ugx),
      environment: row.environment === "sandbox" ? "sandbox" : "live",
      kind: "earning",
      referenceType: "talent_money",
      referenceId: moneyId,
      idempotencyKey: `talent-money:${moneyId}`,
      note: row.note || "Peebee Hire payout",
      legacyUserId: String(row.user_id),
    });
    const applied = await db.execute({ sql: "UPDATE talent_money SET status='done', done_at=datetime('now') WHERE id=? AND status='pending'", args: [moneyId] });
    return !!applied.rowsAffected;
  }
  const col = balanceColumn(row.environment === "sandbox" ? "sandbox" : "live");
  const ledgerType = row.kind === "refund" ? "refund" : "adjustment";
  const changes = await executeBatch([
    { sql: `UPDATE users SET ${col} = ${col} + ?, updated_at = datetime('now') WHERE id = ? AND ${PENDING}`, args: [row.amount_ugx, row.user_id, moneyId] },
    {
      sql: `INSERT INTO wallet_ledger (id, user_id, type, amount, balance_after, note, environment)
            SELECT ?, ?, ?, ?, (SELECT ${col} FROM users WHERE id = ?), ?, ? WHERE ${PENDING}`,
      args: [newId("wl"), row.user_id, ledgerType, row.amount_ugx, row.user_id, row.note || `Peebee Hire ${row.kind}`, row.environment, moneyId],
    },
    { sql: "UPDATE talent_money SET status = 'done', done_at = datetime('now') WHERE id = ? AND status = 'pending'", args: [moneyId] },
  ]);
  return changes[2] === 1;
}

/** Applies every pending refund/payout (optionally one contract's). Failures are logged and retried by the sweep. */
export async function applyPendingMoney(contractId?: string): Promise<number> {
  const rows = (
    await db.execute({
      sql: `SELECT id FROM talent_money WHERE status = 'pending' AND kind != 'hold' ${contractId ? "AND contract_id = ?" : ""} ORDER BY created_at LIMIT 100`,
      args: contractId ? [contractId] : [],
    })
  ).rows as Row[];
  let done = 0;
  for (const r of rows) {
    try {
      if (await applyMoney(String(r.id))) done += 1;
    } catch (err) {
      console.error(`[talent] could not apply money ${r.id}:`, err);
    }
  }
  return done;
}

/**
 * Takes `amount` from the employer's wallet and, in the SAME atomic batch, runs
 * `then` (the statements that create the contract it pays for). Insufficient
 * balance changes nothing. Each `then` statement must itself check that the hold
 * went through, with: WHERE EXISTS (SELECT 1 FROM talent_money WHERE id = ? AND status = 'done').
 * Returns whether the money is held.
 */
export async function holdFromEmployer(input: {
  moneyId: string;
  contractId: string;
  employerId: string;
  amount: number;
  environment: PlatformEnvironment;
  note: string;
  /** An extra SQL condition that must hold for the debit to happen at all (e.g. the application is still open). */
  guard?: { sql: string; args: unknown[] };
  then: DbStatement[];
}): Promise<{ held: boolean }> {
  const col = balanceColumn(input.environment);
  await db.execute({
    sql: `INSERT OR IGNORE INTO talent_money (id, contract_id, user_id, kind, amount_ugx, status, note, environment) VALUES (?, ?, ?, 'hold', ?, 'pending', ?, ?)`,
    args: [input.moneyId, input.contractId, input.employerId, input.amount, input.note, input.environment],
  });
  try {
    await executeBatch([
      {
        sql: `UPDATE users SET ${col} = ${col} - ?, updated_at = datetime('now') WHERE id = ? AND ${col} >= ? AND ${PENDING}${input.guard ? ` AND (${input.guard.sql})` : ""}`,
        args: [input.amount, input.employerId, input.amount, input.moneyId, ...(input.guard?.args ?? [])],
      },
      { sql: "UPDATE talent_money SET status = 'done', done_at = datetime('now') WHERE id = ? AND status = 'pending' AND changes() > 0", args: [input.moneyId] },
      {
        sql: `INSERT INTO wallet_ledger (id, user_id, type, amount, balance_after, note, environment)
              SELECT ?, ?, 'adjustment', ?, (SELECT ${col} FROM users WHERE id = ?), ?, ? WHERE changes() > 0`,
        args: [newId("wl"), input.employerId, -input.amount, input.employerId, input.note, input.environment],
      },
      ...input.then,
    ]);
  } catch (err) {
    await db.execute({ sql: "DELETE FROM talent_money WHERE id = ? AND status = 'pending' AND kind = 'hold'", args: [input.moneyId] });
    throw err;
  }
  const paid = (await db.execute({ sql: "SELECT status FROM talent_money WHERE id = ?", args: [input.moneyId] })).rows[0] as Row | undefined;
  if (paid?.status !== "done") await db.execute({ sql: "DELETE FROM talent_money WHERE id = ? AND status = 'pending' AND kind = 'hold'", args: [input.moneyId] });
  return { held: paid?.status === "done" };
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export const parseList = (raw: unknown): string[] => {
  try {
    const v = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

export const ratingOf = (sum: unknown, count: unknown) => {
  const n = Number(count ?? 0);
  return n ? Math.round((Number(sum) / n) * 10) / 10 : null;
};
