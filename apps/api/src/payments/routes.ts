import { Hono, type Context } from "hono";
import { db } from "../db/client.js";
import { requireAuth } from "../auth/middleware.js";
import { verifyWebhookSignature } from "./flutterwave/wire.js";
import { reconcileMerchantSettlement, reconcilePayment } from "./reconciliation.js";

export const paymentRoutes = new Hono();

type Row = Record<string, unknown>;

/**
 * Poll a payment's status against the mobile money provider (mock or live
 * Yo! Payments). Sandbox/mock testing has no public webhook target, so the
 * client polls this instead of relying solely on /payments/yo/callback.
 */
paymentRoutes.get("/payments/:id/refresh", requireAuth, async (c) => {
  const id = c.req.param("id") as string;
  const user = c.get("user");
  const res = await db.execute({ sql: "SELECT * FROM payments WHERE id = ?", args: [id] });
  const payment = res.rows[0] as Row | undefined;
  if (!payment) return c.json({ error: "not_found" }, 404);

  const orderRes = await db.execute({ sql: "SELECT * FROM orders WHERE id = ?", args: [payment.order_id as string] });
  const order = orderRes.rows[0] as Row | undefined;
  if (!order) return c.json({ error: "order_not_found" }, 404);
  if (order.customer_id !== user.sub && order.rider_id !== user.sub && user.role !== "admin") {
    return c.json({ error: "forbidden" }, 403);
  }

  if (payment.status !== "pending") {
    return c.json({ payment });
  }

  try {
    await reconcilePayment(id, user.sub);
    const updated = await db.execute({ sql: "SELECT * FROM payments WHERE id = ?", args: [id] });
    return c.json({ payment: updated.rows[0] });
  } catch (err) {
    console.error("Payment status check failed:", err);
    return c.json(
      { error: "payment_status_check_failed", message: "Couldn't check the payment status just now. Please try again." },
      502,
    );
  }
});

/**
 * Real Yo! Payments webhook target (requires YO_CALLBACK_URL to be a public
 * HTTPS endpoint).
 *
 * Two rules here, and both matter:
 *
 * 1. **The caller has to prove it's Yo!.** The callback URL you register
 *    with them carries a secret (`?token=…`, or an `X-Peebee-Callback-Token`
 *    header), and anything without it is refused. Without this the endpoint
 *    is an open door for anyone who wants to move payments around or just
 *    flood the logs.
 *
 * 2. **The body is a hint, never the truth.** Even a correctly
 *    authenticated payload only tells us *which* transaction changed — the
 *    new status is then read back from Yo!'s own API. So a forged or
 *    replayed callback can at worst make us re-check a payment we already
 *    know about, which is harmless.
 */
function callbackAuthorized(c: Context): boolean {
  const expected = process.env.YO_CALLBACK_SECRET;
  // Refuse rather than wave everything through when unconfigured — an
  // endpoint that moves money shouldn't be open because a var is missing.
  if (!expected) return false;
  const provided = c.req.header("x-peebee-callback-token") ?? c.req.query("token") ?? "";
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i += 1) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function reconcileSettlementCallback(provider: "yo" | "flutterwave", reference: string): Promise<boolean> {
  const operation = await db.execute({
    sql: `SELECT business_id FROM provider_operations
          WHERE provider = ? AND business_type = 'merchant_settlement'
            AND (provider_ref = ? OR business_id = ?)
          ORDER BY created_at DESC LIMIT 1`,
    args: [provider, reference, reference],
  });
  const settlementId = (operation.rows[0] as Row | undefined)?.business_id;
  if (!settlementId) return false;
  await reconcileMerchantSettlement(String(settlementId));
  return true;
}

paymentRoutes.post("/payments/yo/callback", async (c) => {
  if (!callbackAuthorized(c)) {
    console.warn("Rejected unauthenticated Yo! callback from", c.req.header("cf-connecting-ip") ?? "unknown");
    return c.json({ error: "unauthorized" }, 401);
  }

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const reference = String(
    body.TransactionReference ?? body.transaction_reference ?? body.ExternalReference ?? body.external_reference ?? "",
  ).trim();
  if (!reference) return c.json({ received: true, matched: false });

  const res = await db.execute({
    sql: "SELECT * FROM payments WHERE provider_ref = ? OR id = ? LIMIT 1",
    args: [reference, reference],
  });
  const payment = res.rows[0] as Row | undefined;
  if (!payment) {
    try {
      return c.json({ received: true, matched: await reconcileSettlementCallback("yo", reference) });
    } catch (err) {
      console.error("Yo! settlement callback status check failed:", err);
      return c.json({ received: true, matched: true, changed: false });
    }
  }
  if (payment.status !== "pending") return c.json({ received: true, matched: true, changed: false });

  try {
    const before = String(payment.status);
    const status = await reconcilePayment(String(payment.id), "yo-callback");
    return c.json({ received: true, matched: true, changed: before !== status });
  } catch (err) {
    console.error("Yo! callback status check failed:", err);
    return c.json({ received: true, matched: true, changed: false });
  }
});

/**
 * Real Flutterwave webhook target (`https://api.peebee.online/v1/payments/flutterwave/callback`
 * registered in the Flutterwave dashboard, not a request param). Same two
 * rules as the Yo! callback above: the `verif-hash` header has to match
 * the configured secret, and the body only tells us *which* transaction to
 * re-check — the status itself is always read back from Flutterwave's own
 * verify endpoint, never trusted from the webhook payload directly.
 */
paymentRoutes.post("/payments/flutterwave/callback", async (c) => {
  if (!(await verifyWebhookSignature(c.req.header("verif-hash")))) {
    console.warn("Rejected unauthenticated Flutterwave callback from", c.req.header("cf-connecting-ip") ?? "unknown");
    return c.json({ error: "unauthorized" }, 401);
  }

  const body = (await c.req.json().catch(() => ({}))) as { data?: { tx_ref?: string } };
  const reference = (body.data?.tx_ref ?? "").trim();
  if (!reference) return c.json({ received: true, matched: false });

  const res = await db.execute({
    sql: "SELECT * FROM payments WHERE provider_ref = ? OR id = ? LIMIT 1",
    args: [reference, reference],
  });
  const payment = res.rows[0] as Row | undefined;
  if (!payment) {
    try {
      return c.json({ received: true, matched: await reconcileSettlementCallback("flutterwave", reference) });
    } catch (err) {
      console.error("Flutterwave settlement callback status check failed:", err);
      return c.json({ received: true, matched: true, changed: false });
    }
  }
  if (payment.status !== "pending") return c.json({ received: true, matched: true, changed: false });

  try {
    const before = String(payment.status);
    const status = await reconcilePayment(String(payment.id), "flutterwave-callback");
    return c.json({ received: true, matched: true, changed: before !== status });
  } catch (err) {
    console.error("Flutterwave callback status check failed:", err);
    return c.json({ received: true, matched: true, changed: false });
  }
});
