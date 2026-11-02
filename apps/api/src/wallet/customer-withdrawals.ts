/**
 * A customer cashing out deposited cash to mobile money. Off until an admin turns it on (Admin → Wallet credit), and then
 * guarded: money deposited in the last N days can't leave, one request can take only a share of the cash, there is a daily
 * limit, and a withdrawal that follows a recent bonus waits for an admin. Credit (bonuses, cashback, covered fees) is never
 * withdrawable — it isn't part of the cash balance this works from.
 */
import { withdrawableCash } from "@peebee/shared";
import { Hono } from "hono";
import { z } from "zod";
import { logActivity } from "../admin/activity.js";
import { requirePermission } from "../admin/permissions.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { clientIp } from "../lib/ratelimit.js";
import { hasTable } from "../lib/schema.js";
import { getPlatformEnvironment, type PlatformEnvironment } from "../lib/settings.js";
import { getCreditConfig } from "../offers/config.js";
import { checkPaymentStatus, initiateDisbursement, paymentProviderErrorResponse, paymentProviderHttpStatus, UnsupportedNetworkError } from "../payments/service.js";
import { creditWallet, debitWallet } from "./service.js";

type Row = Record<string, unknown>;

export const customerWithdrawalRoutes = new Hono();

const colFor = (env: PlatformEnvironment) => (env === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance");

/** What this customer could take out right now, and why not if it is nothing. */
export async function withdrawalAllowance(userId: string, env: PlatformEnvironment): Promise<{ cash: number; locked: number; withdrawnToday: number; allowed: number; enabled: boolean; lockDays: number }> {
  const cfg = await getCreditConfig();
  const w = cfg.withdrawal;
  const cash = Number(((await db.execute({ sql: `SELECT ${colFor(env)} AS b FROM users WHERE id = ?`, args: [userId] })).rows[0] as Row | undefined)?.b ?? 0);
  const lockedRes = await db.execute({
    sql: `SELECT COALESCE(SUM(COALESCE(cash_credited, amount)), 0) AS s FROM wallet_topups
          WHERE user_id = ? AND status = 'successful' AND environment = ? AND created_at > datetime('now', ?)`,
    args: [userId, env, `-${Math.max(0, w.lockDays)} days`],
  }).catch(() => ({ rows: [{ s: 0 }] as Row[] }));
  const todayRes = await db.execute({
    sql: `SELECT COALESCE(SUM(amount), 0) AS s FROM customer_withdrawals WHERE user_id = ? AND environment = ? AND status IN ('review', 'pending', 'successful') AND created_at >= datetime('now', 'start of day')`,
    args: [userId, env],
  });
  const locked = Math.min(Math.max(0, cash), Number((lockedRes.rows[0] as Row).s));
  const withdrawnToday = Number((todayRes.rows[0] as Row).s);
  return { cash, locked, withdrawnToday, allowed: withdrawableCash(cfg, { cashBalance: Math.max(0, cash), lockedCash: locked, withdrawnToday }), enabled: cfg.enabled && w.enabled, lockDays: w.lockDays };
}

customerWithdrawalRoutes.get("/wallet/withdrawals", requireAuth, requireRole("customer"), async (c) => {
  const user = c.get("user");
  const env = await getPlatformEnvironment();
  if (!(await hasTable("customer_withdrawals"))) return c.json({ enabled: false, withdrawals: [], allowed: 0 });
  const [allowance, list] = await Promise.all([
    withdrawalAllowance(user.sub, env),
    db.execute({ sql: "SELECT id, amount, status, msisdn, review_reason, created_at FROM customer_withdrawals WHERE user_id = ? AND environment = ? ORDER BY created_at DESC LIMIT 20", args: [user.sub, env] }),
  ]);
  const cfg = await getCreditConfig();
  return c.json({ ...allowance, minAmount: cfg.withdrawal.minAmount, withdrawals: list.rows });
});

const withdrawSchema = z.object({ amount: z.number().int().positive().max(100_000_000), msisdn: z.string().trim().min(6).max(20) });

customerWithdrawalRoutes.post("/wallet/withdraw", requireAuth, requireRole("customer"), async (c) => {
  const user = c.get("user");
  if (!(await hasTable("customer_withdrawals"))) return c.json({ error: "migration_pending", message: "Withdrawals aren't available yet." }, 503);
  const parsed = withdrawSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const env = await getPlatformEnvironment();
  const cfg = await getCreditConfig();
  const w = cfg.withdrawal;
  if (!cfg.enabled || !w.enabled) return c.json({ error: "not_available", message: "Cashing out isn't available. Your wallet balance can be spent on Peebee." }, 403);
  if (user.guestOrderId) return c.json({ error: "guest_scope" }, 403);

  const allowance = await withdrawalAllowance(user.sub, env);
  const { amount, msisdn } = parsed.data;
  if (amount < w.minAmount) return c.json({ error: "below_minimum", message: `The smallest withdrawal is UGX ${w.minAmount.toLocaleString("en-UG")}.` }, 409);
  if (amount > allowance.allowed) {
    const why = allowance.locked > 0 && allowance.cash - allowance.locked < amount
      ? `Money you added in the last ${w.lockDays} day${w.lockDays === 1 ? "" : "s"} can't be withdrawn yet. You can take out up to UGX ${allowance.allowed.toLocaleString("en-UG")} now.`
      : `You can withdraw up to UGX ${allowance.allowed.toLocaleString("en-UG")} right now.`;
    return c.json({ error: "amount_too_high", message: why, allowed: allowance.allowed }, 409);
  }

  // A withdrawal soon after a bonus waits for an admin to look at it.
  let review = false;
  if (w.reviewIfWithinDays > 0 && (await hasTable("credit_ledger"))) {
    const bonus = await db.execute({ sql: "SELECT 1 FROM credit_ledger WHERE user_id = ? AND type = 'bonus' AND environment = ? AND created_at > datetime('now', ?) LIMIT 1", args: [user.sub, env, `-${w.reviewIfWithinDays} days`] });
    review = bonus.rows.length > 0;
  }

  // Take the money first, atomically, so two requests can't spend the same balance.
  const balance = await debitWallet(user.sub, amount, { type: "adjustment", environment: env, note: review ? "Withdrawal (awaiting review)" : "Withdrawal to mobile money" });
  if (balance === null) return c.json({ error: "insufficient_wallet_balance" }, 409);
  const id = newId("cwd");
  await db.execute({
    sql: `INSERT INTO customer_withdrawals (id, user_id, amount, msisdn, status, review_reason, environment) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, user.sub, amount, msisdn, review ? "review" : "pending", review ? `Bonus received in the last ${w.reviewIfWithinDays} days` : null, env],
  });
  if (review) return c.json({ id, status: "review", message: "Your withdrawal is being checked. It usually takes a short while.", balance }, 202);
  return disburse(c, id, user.sub, amount, msisdn, env, balance);
});

async function disburse(c: { json: (b: unknown, s?: 200 | 202 | 400 | 409 | 422 | 502) => Response }, id: string, userId: string, amount: number, msisdn: string, env: PlatformEnvironment, balance: number) {
  try {
    const initiated = await initiateDisbursement({ referenceId: id, msisdn, amount, forceMock: env === "sandbox" });
    await db.execute({
      sql: "UPDATE customer_withdrawals SET provider = ?, provider_ref = ?, network = ?, updated_at = datetime('now') WHERE id = ?",
      args: [initiated.provider, initiated.providerRef, initiated.network, id],
    });
    return c.json({ id, status: "pending", balance }, 202);
  } catch (err) {
    // The provider refused before taking the money: it goes straight back.
    await db.execute({ sql: "UPDATE customer_withdrawals SET status = 'failed', updated_at = datetime('now') WHERE id = ? AND status = 'pending'", args: [id] });
    await creditWallet(userId, amount, { type: "adjustment", environment: env, note: "Withdrawal could not be sent" });
    if (err instanceof UnsupportedNetworkError) return c.json({ error: "unsupported_network", message: err.message }, 400);
    console.error("Customer withdrawal failed to start:", err);
    return c.json(paymentProviderErrorResponse(err, "Couldn't reach mobile money just now. Please try again."), paymentProviderHttpStatus(err));
  }
}

customerWithdrawalRoutes.get("/wallet/withdrawals/:id/refresh", requireAuth, requireRole("customer"), async (c) => {
  const user = c.get("user");
  const row = (await db.execute({ sql: "SELECT * FROM customer_withdrawals WHERE id = ? AND user_id = ?", args: [c.req.param("id") as string, user.sub] })).rows[0] as Row | undefined;
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ withdrawal: await settleWithdrawalStatus(row) });
});

/** Looks at the provider and finishes a pending withdrawal: success is final, failure puts the money back once. */
export async function settleWithdrawalStatus(row: Row): Promise<Row> {
  if (row.status !== "pending" || !row.provider_ref) return row;
  const status = await checkPaymentStatus({ provider: String(row.provider), provider_ref: String(row.provider_ref), created_at: String(row.created_at), type: "disbursement" });
  if (status === "pending") return row;
  const next = status === "failed" ? "failed" : "successful";
  const flipped = await db.execute({ sql: "UPDATE customer_withdrawals SET status = ?, updated_at = datetime('now') WHERE id = ? AND status = 'pending'", args: [next, String(row.id)] });
  if (flipped.rowsAffected && next === "failed") {
    await creditWallet(String(row.user_id), Number(row.amount), { type: "adjustment", environment: row.environment === "sandbox" ? "sandbox" : "live", note: "Withdrawal failed — returned to your wallet" });
  }
  return { ...row, status: next };
}

// --- admin review ----------------------------------------------------------------------------

export const customerWithdrawalAdminRoutes = new Hono();
customerWithdrawalAdminRoutes.use("/admin/wallet-withdrawals/*", requireAuth, requireRole("admin"), requirePermission("payments.manage"));
customerWithdrawalAdminRoutes.use("/admin/wallet-withdrawals", requireAuth, requireRole("admin"), requirePermission("payments.manage"));

customerWithdrawalAdminRoutes.get("/admin/wallet-withdrawals", async (c) => {
  if (!(await hasTable("customer_withdrawals"))) return c.json({ available: false, withdrawals: [] });
  const status = c.req.query("status") ?? "review";
  const res = await db.execute({
    sql: `SELECT w.*, u.name FROM customer_withdrawals w LEFT JOIN users u ON u.id = w.user_id WHERE w.status = ? ORDER BY w.created_at ASC LIMIT 100`,
    args: [status],
  });
  return c.json({ available: true, withdrawals: res.rows });
});

customerWithdrawalAdminRoutes.post("/admin/wallet-withdrawals/:id/approve", async (c) => {
  const row = (await db.execute({ sql: "SELECT * FROM customer_withdrawals WHERE id = ? AND status = 'review'", args: [c.req.param("id") as string] })).rows[0] as Row | undefined;
  if (!row) return c.json({ error: "not_found" }, 404);
  const claimed = await db.execute({ sql: "UPDATE customer_withdrawals SET status = 'pending', reviewed_by = ?, updated_at = datetime('now') WHERE id = ? AND status = 'review'", args: [c.get("user").sub, String(row.id)] });
  if (!claimed.rowsAffected) return c.json({ error: "already_handled" }, 409);
  await logActivity({ actor: c.get("user"), action: "wallet.withdrawal.approve", summary: `Approved a customer withdrawal of UGX ${Number(row.amount).toLocaleString("en-UG")}`, entityType: "customer_withdrawal", entityId: String(row.id), ip: clientIp(c) });
  const env: PlatformEnvironment = row.environment === "sandbox" ? "sandbox" : "live";
  return disburse(c, String(row.id), String(row.user_id), Number(row.amount), String(row.msisdn), env, 0);
});

customerWithdrawalAdminRoutes.post("/admin/wallet-withdrawals/:id/reject", async (c) => {
  const row = (await db.execute({ sql: "SELECT * FROM customer_withdrawals WHERE id = ? AND status = 'review'", args: [c.req.param("id") as string] })).rows[0] as Row | undefined;
  if (!row) return c.json({ error: "not_found" }, 404);
  const claimed = await db.execute({ sql: "UPDATE customer_withdrawals SET status = 'rejected', reviewed_by = ?, updated_at = datetime('now') WHERE id = ? AND status = 'review'", args: [c.get("user").sub, String(row.id)] });
  if (!claimed.rowsAffected) return c.json({ error: "already_handled" }, 409);
  await creditWallet(String(row.user_id), Number(row.amount), { type: "adjustment", environment: row.environment === "sandbox" ? "sandbox" : "live", note: "Withdrawal declined — returned to your wallet" });
  await logActivity({ actor: c.get("user"), action: "wallet.withdrawal.reject", summary: `Declined a customer withdrawal of UGX ${Number(row.amount).toLocaleString("en-UG")}`, entityType: "customer_withdrawal", entityId: String(row.id), ip: clientIp(c) });
  return c.json({ ok: true });
});
