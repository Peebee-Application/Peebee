import type { DbStatement } from "../db/client.js";
import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { getOptions } from "../lib/option-settings.js";
import { serviceCollectionIsDirectPushOnly } from "../lib/rails.js";
import { getPlatformEnvironment, type PlatformEnvironment } from "../lib/settings.js";
import { hasColumn, hasTable } from "../lib/schema.js";
import { postLedgerTransaction } from "../ledger/service.js";
import { checkPaymentStatus, initiateCollection, initiateDisbursement } from "../payments/service.js";
import { creditProviderWorkWallet, debitProviderWorkWallet, ensureProviderWorkWallet, providerWalletCreditStatements } from "../wallet/provider-work-wallet.js";
import { paymentStatusFor, splitCollected } from "./engine.js";
import { getServicesPlatformSettings } from "./settings.js";

type Row = Record<string, unknown>;

/** Credits a wallet inside the same atomic batch as a ledger entry, with its own wallet-history line. */
function walletCreditStatements(userId: string, amount: number, environment: PlatformEnvironment, note: string): DbStatement[] {
  const col = environment === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance";
  return [
    { sql: `UPDATE users SET ${col} = ${col} + ?, updated_at = datetime('now') WHERE id = ?`, args: [amount, userId] },
    {
      sql: `INSERT INTO wallet_ledger (id, user_id, type, amount, balance_after, note, environment)
            VALUES (?, ?, 'adjustment', ?, (SELECT ${col} FROM users WHERE id = ?), ?, ?)`,
      args: [newId("wl"), userId, amount, userId, note, environment],
    },
  ];
}

async function business(businessId: string): Promise<Row> {
  return (await db.execute({ sql: "SELECT id, owner_id, name FROM service_businesses WHERE id = ?", args: [businessId] })).rows[0] as Row;
}

async function providerPayout(input: { biz: Row; amount: number; environment: PlatformEnvironment; paymentId: string; note: string }) {
  if (await hasTable("provider_wallets")) {
    const providerId = String(input.biz.id);
    await ensureProviderWorkWallet("service", providerId, input.environment);
    const statements = await providerWalletCreditStatements({
      providerType: "service", providerId, amount: input.amount, environment: input.environment,
      idempotencyKey: `service-work:${input.paymentId}`, referenceType: "service_payment",
      referenceId: input.paymentId, note: input.note,
    });
    if (statements) {
      return {
        posting: { ownerType: "provider" as const, ownerId: providerId, purpose: "service_work_wallet", environment: input.environment, amount: input.amount },
        statements: [
          ...statements,
          ...(await hasColumn("service_payments", "wallet_source") ? [{ sql: "UPDATE service_payments SET wallet_source='provider_work' WHERE id=?", args: [input.paymentId] }] : []),
        ],
      };
    }
  }
  const ownerId = String(input.biz.owner_id);
  return {
    posting: { ownerType: "customer" as const, ownerId, purpose: "wallet_payable", environment: input.environment, amount: input.amount },
    statements: [
      ...walletCreditStatements(ownerId, input.amount, input.environment, input.note),
      ...(await hasColumn("service_payments", "wallet_source") ? [{ sql: "UPDATE service_payments SET wallet_source='legacy_personal' WHERE id=?", args: [input.paymentId] }] : []),
    ],
  };
}

async function restoreServiceProviderWallet(input: { businessId: string; ownerId: string; amount: number; environment: PlatformEnvironment; refundId: string; note: string }) {
  await creditProviderWorkWallet({
    providerType: "service", providerId: input.businessId, amount: input.amount, environment: input.environment,
    kind: "adjustment", referenceType: "service_refund", referenceId: input.refundId,
    idempotencyKey: `service-refund-return:${input.refundId}`, note: input.note, legacyUserId: input.ownerId,
  });
}

export type StartedPayment = { ok: true; paymentId: string; status: "pending" | "successful" | "failed"; redirectUrl: string | null } | { ok: false; error: string; message: string; status: 400 | 502 };

/**
 * Ask the customer's phone to pay. The booking is not "paid" by this; it becomes paid only when the provider says the
 * money arrived (settlePayment). Only direct-push providers are used while the intangibles shield is on.
 */
export async function startOnlinePayment(input: {
  bookingId: string; businessId: string; kind: "deposit" | "full"; amount: number; rail: string; msisdn: string;
}): Promise<StartedPayment> {
  const environment = await getPlatformEnvironment();
  const paymentId = newId("spy");
  let initiated;
  try {
    initiated = await initiateCollection({
      referenceId: paymentId,
      msisdn: input.msisdn,
      amount: input.amount,
      narrative: "Peebee service booking",
      forceMock: environment === "sandbox",
      directPushOnly: await serviceCollectionIsDirectPushOnly(),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    return {
      ok: false, status: name === "UnsupportedNetworkError" ? 400 : 502,
      error: name === "UnsupportedNetworkError" ? "unsupported_number" : "payment_unavailable",
      message: name === "UnsupportedNetworkError" ? "That number isn't an MTN or Airtel mobile-money number." : "Mobile-money payments are unavailable right now. You have not been charged.",
    };
  }
  await db.execute({
    sql: `INSERT INTO service_payments (id, booking_id, business_id, kind, amount_ugx, rail, provider, provider_ref, msisdn, redirect_url, status, environment)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    args: [paymentId, input.bookingId, input.businessId, input.kind, input.amount, input.rail, initiated.provider, initiated.providerRef, input.msisdn, initiated.redirectUrl ?? null, environment],
  });
  // Direct-push providers often answer straight away; ask once.
  const status = await pollPayment(paymentId);
  return { ok: true, paymentId, status, redirectUrl: initiated.redirectUrl ?? null };
}

/** Ask the provider where a payment stands, and act on the answer. Safe to call as often as you like. */
export async function pollPayment(paymentId: string): Promise<"pending" | "successful" | "failed"> {
  const p = (await db.execute({ sql: "SELECT * FROM service_payments WHERE id = ?", args: [paymentId] })).rows[0] as Row | undefined;
  if (!p) return "failed";
  if (p.status !== "pending") return p.status as "successful" | "failed";
  const state = await checkPaymentStatus({ provider: String(p.provider), provider_ref: p.provider_ref ? String(p.provider_ref) : null, created_at: String(p.created_at), expectedAmount: Number(p.amount_ugx), expectedCurrency: "UGX" });
  if (state === "successful") {
    if (p.kind === "refund") await finalizeRefund(paymentId);
    else await settlePayment(paymentId);
    return "successful";
  }
  if (state === "failed") {
    const failed = await db.execute({ sql: "UPDATE service_payments SET status = 'failed', updated_at = datetime('now') WHERE id = ? AND status = 'pending'", args: [paymentId] });
    if (failed.rowsAffected && p.kind === "refund") await undoRefundDebit(p);
    return "failed";
  }
  return "pending";
}

/**
 * The money arrived. Exactly once: the payment row is claimed with a conditional update, so a poll and a callback
 * racing cannot both book it. In escrow mode the money waits in the booking's escrow account; in direct mode it goes
 * to the provider straight away (less Peebee's share).
 */
export async function settlePayment(paymentId: string): Promise<void> {
  const claim = await db.execute({ sql: "UPDATE service_payments SET status = 'successful', updated_at = datetime('now') WHERE id = ? AND status = 'pending' AND kind != 'refund'", args: [paymentId] });
  if (!claim.rowsAffected) return;
  const p = (await db.execute({ sql: "SELECT * FROM service_payments WHERE id = ?", args: [paymentId] })).rows[0] as Row;
  const environment = String(p.environment) as PlatformEnvironment;
  const amount = Number(p.amount_ugx);
  const bookingId = String(p.booking_id);

  await db.execute({ sql: "UPDATE service_bookings SET paid_ugx = paid_ugx + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", args: [amount, bookingId] });
  const booking = (await db.execute({ sql: "SELECT * FROM service_bookings WHERE id = ?", args: [bookingId] })).rows[0] as Row;
  await db.execute({
    sql: "UPDATE service_bookings SET payment_status = ? WHERE id = ?",
    args: [paymentStatusFor(Number(booking.total_price_ugx), Number(booking.paid_ugx)), bookingId],
  });

  const o = await getOptions(["services_online_collection_mode", "services_booking_confirmation"]);
  const direct = o.services_online_collection_mode === "momo_direct";
  const biz = await business(String(p.business_id));
  const { commission, payout } = splitCollected(amount, (await getServicesPlatformSettings()).commissionPercent);
  if (direct) {
    const providerCredit = payout > 0 ? await providerPayout({
      biz, amount: payout, environment, paymentId,
      note: `Service booking ${String(booking.booking_code ?? bookingId)}`,
    }) : null;
    await postLedgerTransaction({
      kind: "service_paid_direct", idempotencyKey: `service-direct:${paymentId}`, environment,
      referenceType: "service_booking", referenceId: bookingId, description: "Service paid by mobile money, released to the provider",
      postings: [
        { ownerType: "platform", ownerId: "peebee", purpose: "momo_collections", environment, amount: -amount },
        ...(providerCredit ? [providerCredit.posting] : []),
        ...(commission > 0 ? [{ ownerType: "platform" as const, ownerId: "peebee", purpose: "service_commission", environment, amount: commission }] : []),
      ],
      additionalStatements: [
        ...(providerCredit?.statements ?? []),
        { sql: "UPDATE service_payments SET released = 1 WHERE id = ?", args: [paymentId] },
      ],
    });
  } else {
    await postLedgerTransaction({
      kind: "service_paid_escrow", idempotencyKey: `service-escrow:${paymentId}`, environment,
      referenceType: "service_booking", referenceId: bookingId, description: "Service paid by mobile money, held until the service is done",
      postings: [
        { ownerType: "platform", ownerId: "peebee", purpose: "momo_collections", environment, amount: -amount },
        { ownerType: "order", ownerId: bookingId, purpose: "service_escrow", environment, amount },
      ],
    });
  }

  if (o.services_booking_confirmation === "auto_confirm_when_paid") {
    await db.execute({ sql: "UPDATE service_bookings SET status = 'confirmed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'", args: [bookingId] });
  }
}

/** The service is done: money held in escrow goes to the provider, less Peebee's share. Once per payment. */
export async function releaseEscrow(bookingId: string): Promise<number> {
  const rows = (await db.execute({
    sql: "SELECT * FROM service_payments WHERE booking_id = ? AND status = 'successful' AND kind IN ('deposit', 'full') AND released = 0 AND rail IN ('momo_mtn', 'momo_airtel')",
    args: [bookingId],
  })).rows as Row[];
  let released = 0;
  for (const p of rows) {
    const claim = await db.execute({ sql: "UPDATE service_payments SET released = 1 WHERE id = ? AND released = 0", args: [String(p.id)] });
    if (!claim.rowsAffected) continue;
    const environment = String(p.environment) as PlatformEnvironment;
    const amount = Number(p.amount_ugx);
    const biz = await business(String(p.business_id));
    const { commission, payout } = splitCollected(amount, (await getServicesPlatformSettings()).commissionPercent);
    try {
      const providerCredit = payout > 0 ? await providerPayout({
        biz, amount: payout, environment, paymentId: String(p.id), note: `Service booking ${bookingId}`,
      }) : null;
      await postLedgerTransaction({
        kind: "service_released", idempotencyKey: `service-release:${String(p.id)}`, environment,
        referenceType: "service_booking", referenceId: bookingId, description: "Service completed, escrow released",
        postings: [
          { ownerType: "order", ownerId: bookingId, purpose: "service_escrow", environment, amount: -amount },
          ...(providerCredit ? [providerCredit.posting] : []),
          ...(commission > 0 ? [{ ownerType: "platform" as const, ownerId: "peebee", purpose: "service_commission", environment, amount: commission }] : []),
        ],
        additionalStatements: providerCredit?.statements ?? [],
      });
      released += payout;
    } catch (err) {
      await db.execute({ sql: "UPDATE service_payments SET released = 0 WHERE id = ?", args: [String(p.id)] });
      throw err;
    }
  }
  return released;
}

export type RefundResult = { ok: true; refunded: number; pending: boolean } | { ok: false; status: 409 | 502; error: string; message: string };

/**
 * Give the customer their online payments back by mobile money. Money still in escrow simply goes back; money already
 * released to the provider comes out of the provider's wallet first (the refund is refused if it isn't there).
 */
export async function refundOnlinePayments(bookingId: string, actorNote: string): Promise<RefundResult> {
  const payments = (await db.execute({
    sql: `SELECT p.* FROM service_payments p
          WHERE p.booking_id = ? AND p.status = 'successful' AND p.kind IN ('deposit', 'full')
            AND NOT EXISTS (SELECT 1 FROM service_payments r WHERE r.refund_of = p.id AND r.status != 'failed')`,
    args: [bookingId],
  })).rows as Row[];
  let refunded = 0;
  let pending = false;
  for (const p of payments) {
    const amount = Number(p.amount_ugx);
    const environment = String(p.environment) as PlatformEnvironment;
    const refundId = newId("spy");
    let initiated;
    let takenBack = 0;
    let takenFrom = "";
    let takenFromWorkWallet = false;
    try {
      if (Number(p.released) === 1) {
        // The provider already has this money; take their share back before sending anything to the customer.
        const biz = await business(String(p.business_id));
        const { payout } = splitCollected(amount, (await getServicesPlatformSettings()).commissionPercent);
        takenFromWorkWallet = String(p.wallet_source ?? "") === "provider_work";
        if (payout > 0 && takenFromWorkWallet) {
          const debit = await debitProviderWorkWallet({
            providerType: "service", providerId: String(biz.id), amount: payout, environment,
            kind: "adjustment", referenceType: "service_refund", referenceId: refundId,
            idempotencyKey: `service-refund-out:${refundId}`, note: "Service refund from provider work wallet",
            legacyUserId: String(biz.owner_id),
          });
          if (debit === null) return { ok: false, status: 409, error: "provider_balance_low", message: "The provider's work wallet doesn't cover this refund yet." };
        } else if (payout > 0) {
          const col = environment === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance";
          const debit = await db.execute({ sql: `UPDATE users SET ${col} = ${col} - ?, updated_at = datetime('now') WHERE id = ? AND ${col} >= ?`, args: [payout, String(biz.owner_id), payout] });
          if (!debit.rowsAffected) return { ok: false, status: 409, error: "provider_balance_low", message: "The provider's wallet doesn't cover this refund yet." };
        }
        takenBack = payout;
        takenFrom = String(biz.owner_id);
      }
      initiated = await initiateDisbursement({ referenceId: refundId, msisdn: String(p.msisdn), amount, narrative: "Peebee service refund", forceMock: environment === "sandbox", directPushOnly: await serviceCollectionIsDirectPushOnly() });
    } catch {
      if (takenBack > 0) {
        if (takenFromWorkWallet) {
          await restoreServiceProviderWallet({ businessId: String(p.business_id), ownerId: takenFrom, amount: takenBack, environment, refundId, note: "Service refund initiation failed; work funds restored" });
        } else {
          const col = environment === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance";
          await db.execute({ sql: `UPDATE users SET ${col} = ${col} + ?, updated_at = datetime('now') WHERE id = ?`, args: [takenBack, takenFrom] });
        }
      }
      return { ok: false, status: 502, error: "refund_unavailable", message: "The refund could not be sent right now. Nothing was changed; try again shortly." };
    }
    await db.execute({
      sql: `INSERT INTO service_payments (id, booking_id, business_id, kind, amount_ugx, rail, provider, provider_ref, msisdn, status, environment, refund_of)
            VALUES (?, ?, ?, 'refund', ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      args: [refundId, bookingId, String(p.business_id), amount, String(p.rail), initiated.provider, initiated.providerRef, String(p.msisdn), environment, String(p.id)],
    });
    const state = await pollPayment(refundId);
    if (state === "successful") refunded += amount;
    else pending = true;
  }
  await db.execute({ sql: "UPDATE service_bookings SET refund_ugx = refund_ugx + ?, refund_state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", args: [refunded, pending ? "pending" : "refunded", bookingId] });
  void actorNote;
  return { ok: true, refunded, pending };
}

/** A refund that never reached the customer: give the provider back what was taken from their wallet for it. */
async function undoRefundDebit(refund: Row): Promise<void> {
  const orig = (await db.execute({ sql: "SELECT * FROM service_payments WHERE id = ?", args: [String(refund.refund_of)] })).rows[0] as Row | undefined;
  if (!orig || Number(orig.released) !== 1) return;
  const environment = String(refund.environment) as PlatformEnvironment;
  const biz = await business(String(refund.business_id));
  const { payout } = splitCollected(Number(refund.amount_ugx), (await getServicesPlatformSettings()).commissionPercent);
  if (payout <= 0) return;
  if (String(orig.wallet_source ?? "") === "provider_work") {
    await restoreServiceProviderWallet({ businessId: String(biz.id), ownerId: String(biz.owner_id), amount: payout, environment, refundId: String(refund.id), note: "Service refund failed; provider work funds restored" });
  } else {
    const col = environment === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance";
    await db.execute({ sql: `UPDATE users SET ${col} = ${col} + ?, updated_at = datetime('now') WHERE id = ?`, args: [payout, String(biz.owner_id)] });
  }
  await db.execute({ sql: "UPDATE service_bookings SET refund_state = 'review' WHERE id = ?", args: [String(refund.booking_id)] });
}

/** A refund the provider confirmed: book it in the ledger (and take the provider's wallet share if it had been released). */
export async function finalizeRefund(refundId: string): Promise<void> {
  const claim = await db.execute({ sql: "UPDATE service_payments SET status = 'successful', updated_at = datetime('now') WHERE id = ? AND status = 'pending' AND kind = 'refund'", args: [refundId] });
  if (!claim.rowsAffected) return;
  const r = (await db.execute({ sql: "SELECT * FROM service_payments WHERE id = ?", args: [refundId] })).rows[0] as Row;
  const orig = (await db.execute({ sql: "SELECT * FROM service_payments WHERE id = ?", args: [String(r.refund_of)] })).rows[0] as Row;
  const environment = String(r.environment) as PlatformEnvironment;
  const amount = Number(r.amount_ugx);
  const bookingId = String(r.booking_id);
  const biz = await business(String(r.business_id));
  const { commission, payout } = splitCollected(amount, (await getServicesPlatformSettings()).commissionPercent);
  if (Number(orig.released) === 1) {
    const providerWorkSource = String(orig.wallet_source ?? "") === "provider_work";
    await postLedgerTransaction({
      kind: "service_refund_released", idempotencyKey: `service-refund:${refundId}`, environment,
      referenceType: "service_booking", referenceId: bookingId, description: "Service refunded after release",
      postings: [
        ...(payout > 0 ? [providerWorkSource
          ? { ownerType: "provider" as const, ownerId: String(biz.id), purpose: "service_work_wallet", environment, amount: -payout }
          : { ownerType: "customer" as const, ownerId: String(biz.owner_id), purpose: "wallet_payable", environment, amount: -payout }] : []),
        ...(commission > 0 ? [{ ownerType: "platform" as const, ownerId: "peebee", purpose: "service_commission", environment, amount: -commission }] : []),
        { ownerType: "platform", ownerId: "peebee", purpose: "momo_collections", environment, amount },
      ],
    });
  } else {
    await postLedgerTransaction({
      kind: "service_refund_escrow", idempotencyKey: `service-refund:${refundId}`, environment,
      referenceType: "service_booking", referenceId: bookingId, description: "Service refunded from escrow",
      postings: [
        { ownerType: "order", ownerId: bookingId, purpose: "service_escrow", environment, amount: -amount },
        { ownerType: "platform", ownerId: "peebee", purpose: "momo_collections", environment, amount },
      ],
    });
    await db.execute({ sql: "UPDATE service_payments SET released = 1 WHERE id = ?", args: [String(orig.id)] }); // returned, never to be released
  }
  await db.execute({
    sql: "UPDATE service_bookings SET paid_ugx = MAX(0, paid_ugx - ?), refund_state = 'refunded', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    args: [amount, bookingId],
  });
  const b = (await db.execute({ sql: "SELECT total_price_ugx, paid_ugx FROM service_bookings WHERE id = ?", args: [bookingId] })).rows[0] as Row;
  await db.execute({ sql: "UPDATE service_bookings SET payment_status = ? WHERE id = ?", args: [paymentStatusFor(Number(b.total_price_ugx), Number(b.paid_ugx)), bookingId] });
}

/** Re-ask the provider about anything still waiting on this booking (payments and refunds). */
export async function pollBookingPayments(bookingId: string): Promise<void> {
  const pending = (await db.execute({ sql: "SELECT id FROM service_payments WHERE booking_id = ? AND status = 'pending'", args: [bookingId] })).rows as Row[];
  for (const p of pending) await pollPayment(String(p.id));
}

/** Scheduled: re-ask the provider about service payments and refunds nobody has looked at lately. */
export async function sweepServicePayments(limit = 50): Promise<number> {
  if (!(await hasTable("service_payments"))) return 0;
  const rows = (await db.execute({
    sql: "SELECT id FROM service_payments WHERE status = 'pending' AND created_at < datetime('now', '-1 minute') ORDER BY created_at LIMIT ?",
    args: [limit],
  })).rows as Row[];
  for (const r of rows) await pollPayment(String(r.id));
  return rows.length;
}
