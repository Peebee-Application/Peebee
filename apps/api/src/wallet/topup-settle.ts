/**
 * Settling a wallet top-up: ask the provider, then credit the wallet or fail the top-up.
 *
 * A top-up used to be credited only when the customer's own screen asked for the result. If they paid on a page that did
 * not send them back (Flutterwave's mobile money page ends on "Thanks for your payment!"), or closed the app, the money
 * was taken and nothing ever credited it. Now the same code also runs from a background sweep (sweepPendingTopups) and
 * from the provider webhooks, and the screen's check calls it too, so one place decides what a top-up result means.
 *
 * Only a provider answer of "successful" credits. "unknown" is treated as still pending, never as paid.
 */

import { db } from "../db/client.js";
import { hasColumn } from "../lib/schema.js";
import { grantCredit } from "../offers/credit.js";
import { applyDepositBonus } from "../offers/deposit-bonus.js";
import { planTopupFor } from "../offers/topup.js";
import { checkPaymentStatus } from "../payments/service.js";
import { creditWallet } from "./service.js";

type Row = Record<string, unknown>;
export type TopupResult = "pending" | "failed" | "successful";

async function providerStatus(topup: Row): Promise<TopupResult> {
  const status = await checkPaymentStatus({
    provider: String(topup.provider),
    provider_ref: (topup.provider_ref as string | null) ?? null,
    created_at: String(topup.created_at),
  });
  if (status === "successful") return "successful";
  if (status === "failed") return "failed";
  return "pending";
}

/** A customer wallet top-up (table wallet_topups). Safe to call any number of times: only the call that flips pending to
 * successful credits the wallet. */
export async function settleCustomerTopup(topup: Row): Promise<TopupResult> {
  if (topup.status === "successful" || topup.status === "failed") return topup.status;
  const id = String(topup.id);
  const userId = String(topup.user_id);

  const result = await providerStatus(topup);
  if (result === "pending") {
    // Remember when it was last checked, so the sweep can back off on top-ups that stay pending.
    await db.execute({ sql: "UPDATE wallet_topups SET updated_at = datetime('now') WHERE id = ? AND status = 'pending'", args: [id] });
    return "pending";
  }
  if (result === "failed") {
    await db.execute({ sql: "UPDATE wallet_topups SET status = 'failed', updated_at = datetime('now') WHERE id = ? AND status = 'pending'", args: [id] });
    return "failed";
  }

  // Race-guarded: a screen poll, the sweep and a webhook can arrive together, but only the one that actually flips
  // pending to successful credits the wallet.
  const updated = await db.execute({
    sql: "UPDATE wallet_topups SET status = 'successful', updated_at = datetime('now') WHERE id = ? AND status = 'pending'",
    args: [id],
  });
  if ((updated.rowsAffected ?? 0) > 0) {
    const env = topup.environment === "sandbox" ? "sandbox" : "live";
    // What the gateway took, and how much of it Peebee covers as credit (Admin → Wallet credit). With no gateway rate set up,
    // or before migration 0148, the wallet gets the whole amount exactly as it always has.
    const plan = (await hasColumn("wallet_topups", "gateway_fee")) ? await planTopupFor({ ...topup, user_id: userId }, env).catch(() => null) : null;
    await creditWallet(userId, plan ? plan.cash : Number(topup.amount), {
      type: "topup",
      environment: env,
      topupId: id,
      note: plan && plan.gatewayFee > 0 ? `Wallet top-up (gateway fee ${plan.gatewayFee + plan.taxOnFee} deducted)` : "Wallet top-up",
    });
    if (plan) {
      await db.execute({
        sql: "UPDATE wallet_topups SET gateway_fee = ?, tax_on_fee = ?, fee_cover = ?, cash_credited = ? WHERE id = ?",
        args: [plan.gatewayFee, plan.taxOnFee, plan.feeCover, plan.cash, id],
      });
      if (plan.feeCover > 0) await grantCredit({ userId, amount: plan.feeCover, kind: "fee_cover", env, topupId: id, expiryDays: 0, campaign: "fee_cover", note: "Fee on your top-up covered by Peebee" });
    }
    await applyDepositBonus({ userId, topupId: id, amount: Number(topup.amount), env });
  }
  return "successful";
}

/** A rider's wallet top-up (table rider_wallet_topups). Same guarantees as above. */
export async function settleRiderTopup(topup: Row): Promise<TopupResult> {
  if (topup.status === "successful" || topup.status === "failed") return topup.status;
  const id = String(topup.id);

  const result = await providerStatus(topup);
  if (result === "pending") {
    await db.execute({ sql: "UPDATE rider_wallet_topups SET updated_at = datetime('now') WHERE id = ? AND status = 'pending'", args: [id] });
    return "pending";
  }
  if (result === "failed") {
    await db.execute({ sql: "UPDATE rider_wallet_topups SET status = 'failed', updated_at = datetime('now') WHERE id = ? AND status = 'pending'", args: [id] });
    return "failed";
  }
  const updated = await db.execute({
    sql: "UPDATE rider_wallet_topups SET status = 'successful', updated_at = datetime('now') WHERE id = ? AND status = 'pending'",
    args: [id],
  });
  if ((updated.rowsAffected ?? 0) > 0) {
    const balanceColumn = topup.environment === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance";
    await db.execute({
      sql: `UPDATE riders SET ${balanceColumn} = ${balanceColumn} + ?, updated_at = datetime('now') WHERE user_id = ?`,
      args: [Number(topup.amount), String(topup.rider_id)],
    });
  }
  return "successful";
}

/**
 * Background check of top-ups still pending. Looks at everything from the last 3 days, and backs off as a top-up ages:
 * every run for the first hour, about every 10 minutes for the first day, then hourly, so an abandoned top-up does not
 * cost a provider call every two minutes. Never marks a top-up failed on its own; only the provider's answer does.
 */
export async function sweepPendingTopups(limit = 50): Promise<{ checked: number; credited: number; failed: number; errors: number }> {
  const out = { checked: 0, credited: 0, failed: 0, errors: 0 };
  const due = (table: "wallet_topups" | "rider_wallet_topups") => db.execute({
    sql: `SELECT * FROM ${table}
          WHERE status = 'pending' AND provider_ref IS NOT NULL
            AND created_at <= datetime('now', '-1 minutes')
            AND (created_at > datetime('now', '-60 minutes')
                 OR (created_at > datetime('now', '-1 days') AND updated_at <= datetime('now', '-10 minutes'))
                 OR (created_at > datetime('now', '-3 days') AND updated_at <= datetime('now', '-60 minutes')))
          ORDER BY created_at LIMIT ?`,
    args: [limit],
  }).catch(() => ({ rows: [] as Row[] })); // the rider table or column may not exist on an older database

  for (const [table, settle] of [["wallet_topups", settleCustomerTopup], ["rider_wallet_topups", settleRiderTopup]] as const) {
    for (const raw of (await due(table)).rows as Row[]) {
      out.checked += 1;
      try {
        const result = await settle(raw);
        if (result === "successful") out.credited += 1;
        else if (result === "failed") out.failed += 1;
      } catch (err) {
        out.errors += 1;
        console.error("Top-up sweep failed for", raw.id, err);
      }
    }
  }
  return out;
}

/** A provider webhook names a transaction reference; settle the wallet top-up it belongs to, if there is one.
 * Returns whether a top-up matched. */
export async function settleTopupByReference(reference: string): Promise<boolean> {
  for (const [table, settle] of [["wallet_topups", settleCustomerTopup], ["rider_wallet_topups", settleRiderTopup]] as const) {
    const res = await db.execute({ sql: `SELECT * FROM ${table} WHERE id = ? OR provider_ref = ? LIMIT 1`, args: [reference, reference] }).catch(() => null);
    const row = res?.rows[0] as Row | undefined;
    if (row) {
      await settle(row);
      return true;
    }
  }
  return false;
}
