import { db, executeBatch, requireChangedRow, type DbStatement } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { getOptions } from "../lib/option-settings.js";
import { hasColumn, hasTable } from "../lib/schema.js";
import { getMarketplaceSettings, getPlatformEnvironment } from "../lib/settings.js";
import { storePlan } from "./plans.js";
import { sendSms } from "../lib/sms-gateway.js";
import { postLedgerTransaction } from "../ledger/service.js";
import { enrollStudent } from "./lms-enroll.js";
import { creditWallet, debitWallet } from "../wallet/service.js";
import { chargeAndPayOut } from "../education/payments.js";
import { getLearnSettings } from "../education/settings.js";

type Row = Record<string, unknown>;

/* ------------------------------------------------------------------ tokens */

export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 256 random bits. Only its hash is stored, so neither the merchant nor a database reader can use a buyer's link. */
export function newAccessToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function downloadPageUrl(token: string): string {
  const base = process.env.WEB_APP_URL ?? ((process.env.ENVIRONMENT ?? "development") !== "development" ? "https://peebee.online" : "http://localhost:3004");
  return `${base}/d/${token}`;
}

/* ------------------------------------------------------- signed file links */

function signingSecret(): string {
  const base = process.env.OTP_PEPPER ?? process.env.JWT_SECRET;
  if (!base) throw new Error("No signing secret is set");
  return `digital-file:${base}`;
}
async function hmacHex(text: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(signingSecret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A link to one purchase's file that stops working after `seconds`. The download was counted when it was issued. */
export async function signFileLink(fulfillmentId: string, seconds = 60): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + seconds;
  return `${fulfillmentId}.${exp}.${await hmacHex(`${fulfillmentId}|${exp}`)}`;
}

export async function verifyFileLink(link: string): Promise<string | null> {
  const [id, exp, mac] = link.split(".");
  if (!id || !exp || !mac || Number(exp) < Math.floor(Date.now() / 1000)) return null;
  const expected = await hmacHex(`${id}|${exp}`);
  if (expected.length !== mac.length) return null;
  let diff = 0;
  for (let i = 0; i < mac.length; i++) diff |= expected.charCodeAt(i) ^ mac.charCodeAt(i);
  return diff === 0 ? id : null;
}

/* ----------------------------------------------------------- licence pool */

/**
 * Make the pool in the database match the list the merchant gave: new keys are added, keys that are still available
 * but no longer listed are removed. A key already issued to a buyer is never touched.
 */
export async function syncLicensePool(storeId: string, productId: string, keys: string[]): Promise<void> {
  if (!(await hasTable("store_license_keys"))) return;
  const wanted = new Set(keys);
  const existing = await db.execute({ sql: "SELECT license_key, status FROM store_license_keys WHERE product_id = ?", args: [productId] });
  const have = new Set((existing.rows as Row[]).map((r) => String(r.license_key)));
  for (const key of wanted) {
    if (!have.has(key)) {
      await db.execute({
        sql: "INSERT OR IGNORE INTO store_license_keys (id, store_id, product_id, license_key) VALUES (?, ?, ?, ?)",
        args: [newId("lic"), storeId, productId, key],
      });
    }
  }
  for (const row of existing.rows as Row[]) {
    if (row.status === "available" && !wanted.has(String(row.license_key))) {
      await db.execute({ sql: "DELETE FROM store_license_keys WHERE product_id = ? AND license_key = ? AND status = 'available'", args: [productId, String(row.license_key)] });
    }
  }
}

export async function licensePoolCounts(productId: string): Promise<{ available: number; issued: number }> {
  if (!(await hasTable("store_license_keys"))) return { available: 0, issued: 0 };
  const res = await db.execute({
    sql: "SELECT status, COUNT(*) AS n FROM store_license_keys WHERE product_id = ? GROUP BY status",
    args: [productId],
  });
  const by = Object.fromEntries((res.rows as Row[]).map((r) => [String(r.status), Number(r.n)]));
  return { available: by.available ?? 0, issued: by.issued ?? 0 };
}

/** Take one key for a purchase. One conditional update, so two buyers can never be given the same key. */
async function claimLicenseKey(productId: string, fulfillmentId: string): Promise<string | null> {
  const res = await db.execute({
    sql: `UPDATE store_license_keys SET status = 'issued', fulfillment_id = ?, issued_at = datetime('now')
          WHERE id = (SELECT id FROM store_license_keys WHERE product_id = ? AND status = 'available' ORDER BY rowid LIMIT 1)
            AND status = 'available'`,
    args: [fulfillmentId, productId],
  });
  if (!res.rowsAffected) return null;
  const row = await db.execute({ sql: "SELECT license_key FROM store_license_keys WHERE fulfillment_id = ? LIMIT 1", args: [fulfillmentId] });
  return row.rows[0] ? String(row.rows[0].license_key) : null;
}

async function releaseLicenseKey(fulfillmentId: string): Promise<void> {
  await db.execute({ sql: "UPDATE store_license_keys SET status = 'available', fulfillment_id = NULL, issued_at = NULL WHERE fulfillment_id = ? AND status = 'issued'", args: [fulfillmentId] });
}

/* ----------------------------------------------------------------- purchase */

export type PurchaseFailure = { ok: false; status: 400 | 402 | 403 | 404 | 409 | 503; error: string; message: string };
export type PurchaseSuccess = {
  ok: true;
  fulfillmentId: string;
  /** The only time the plain token exists. */
  token: string;
  accessUrl: string;
  licenseKey: string | null;
  expiresAt: string | null;
  maxDownloads: number;
  pricePaidUgx: number;
  sms: { status: string } | null;
  needsManualFulfilment: boolean;
  enrollmentId: string | null;
};

export async function purchaseDigitalProduct(input: {
  buyer: { id: string; phone: string | null; name: string | null };
  productId: string;
  /** The store row already resolved by the caller as live. */
  store: Row;
}): Promise<PurchaseFailure | PurchaseSuccess> {
  const fail = (status: PurchaseFailure["status"], error: string, message: string): PurchaseFailure => ({ ok: false, status, error, message });
  if (!(await hasTable("store_digital_fulfillments")) || !(await hasColumn("store_digital_fulfillments", "buyer_user_id")) || !(await hasTable("store_license_keys"))) {
    return fail(503, "migration_pending", "Digital purchases are being set up (0138_digital_fulfillment.sql is not applied yet).");
  }
  const found = await db.execute({ sql: "SELECT * FROM store_digital_products WHERE id = ? AND store_id = ? AND status = 'published'", args: [input.productId, String(input.store.id)] });
  const product = found.rows[0] as Row | undefined;
  if (!product) return fail(404, "product_not_found", "That product isn't for sale.");
  const marketplace = await getMarketplaceSettings();
  if (!marketplace.eliteDigitalProductsEnabled) return fail(403, "digital_disabled", "Digital sales are paused by the platform.");
  if (!(await storePlan(input.store, marketplace)).isElite) return fail(403, "plan_required", "The store needs an active Merchant Elite plan to accept new digital purchases.");

  const price = Number(product.price_ugx) || 0;
  const kind = String(product.kind);
  const environment = await getPlatformEnvironment();
  const opts = await getOptions(["digital_commission_percent", "digital_license_exhausted_action", "digital_delivery_channels", "digital_license_reveal", "lms_payment_path"]);
  const storeId = String(input.store.id);
  const merchantId = String(input.store.merchant_id);

  if (kind === "course" && !product.linked_course_id) return fail(409, "course_missing", "This course isn't ready yet.");

  const owned = await db.execute({
    sql: "SELECT id FROM store_digital_fulfillments WHERE buyer_user_id = ? AND digital_product_id = ? AND status = 'active' LIMIT 1",
    args: [input.buyer.id, input.productId],
  });
  if (owned.rows[0]) return fail(409, "already_owned", "You already own this. Open it from your purchase link.");

  const fulfillmentId = newId("ful");
  const token = newAccessToken();
  const tokenHash = await sha256Hex(token);
  const maxDownloads = Number(product.max_downloads ?? 5);
  const expiryDays = Number(product.expiry_days ?? 30);
  const expiresAt = expiryDays > 0 ? new Date(Date.now() + expiryDays * 86400000).toISOString() : null;

  await db.execute({
    sql: `INSERT INTO store_digital_fulfillments
            (id, store_id, digital_product_id, customer_name, customer_phone, access_token, token_hint, max_downloads, expires_at, status, buyer_user_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    args: [fulfillmentId, storeId, input.productId, input.buyer.name ?? "", input.buyer.phone ?? "", tokenHash, token.slice(-4), maxDownloads, expiresAt, input.buyer.id],
  });
  const abandon = async () => {
    await releaseLicenseKey(fulfillmentId);
    await db.execute({ sql: "DELETE FROM store_digital_fulfillments WHERE id = ? AND status = 'pending'", args: [fulfillmentId] });
  };

  // 1. The key, before any money moves.
  let licenseKey: string | null = null;
  let needsManual = false;
  if (kind === "license_key") {
    licenseKey = await claimLicenseKey(input.productId, fulfillmentId);
    if (!licenseKey) {
      const action = String(opts.digital_license_exhausted_action);
      if (action === "allow_backorder_manual_fulfil") {
        needsManual = true;
      } else {
        if (action === "auto_hide_product") await db.execute({ sql: "UPDATE store_digital_products SET status = 'draft', updated_at = datetime('now') WHERE id = ?", args: [input.productId] });
        await abandon();
        return fail(409, "out_of_stock", "This licence is sold out right now.");
      }
    }
  }

  // 2. The money. A course can be paid the way every Peebee Learn course is (wallet to the school owner, Learn's
  // commission) or like any other digital sale (wallet to the merchant's balance, in the double-entry ledger).
  const learnPath = kind === "course" && opts.lms_payment_path === "learn_payments_commission";
  const commissionPercent = learnPath ? (await getLearnSettings()).commissionPercent : Number(opts.digital_commission_percent);
  const commission = Math.floor((price * commissionPercent) / 100);
  const payout = price - commission;
  let ledgerId: string | null = null;
  if (price > 0 && learnPath) {
    const school = (await db.execute({ sql: "SELECT s.owner_id FROM edu_courses c JOIN edu_schools s ON s.id = c.school_id WHERE c.id = ?", args: [String(product.linked_course_id)] })).rows[0] as Row | undefined;
    if (!school) {
      await abandon();
      return fail(409, "course_missing", "This course isn't ready yet.");
    }
    const paid = await chargeAndPayOut({ payerId: input.buyer.id, ownerId: String(school.owner_id), amount: price, commissionPercent, environment, note: `Peebee Learn: ${String(product.title)}` }).catch(() => null);
    if (!paid || !paid.ok) {
      await abandon();
      return fail(402, "insufficient_wallet", `Add UGX ${price.toLocaleString("en-UG")} to your Peebee wallet to buy this.`);
    }
  } else if (price > 0) {
    const balance = await debitWallet(input.buyer.id, price, { type: "order_payment", environment, note: `Digital purchase: ${String(product.title)}` });
    if (balance === null) {
      await abandon();
      return fail(402, "insufficient_wallet", `Add UGX ${price.toLocaleString("en-UG")} to your Peebee wallet to buy this.`);
    }
    try {
      const postings = [
        { ownerType: "customer" as const, ownerId: input.buyer.id, purpose: "wallet_payable", environment, amount: -price },
        ...(payout > 0 ? [{ ownerType: "merchant" as const, ownerId: merchantId, purpose: "payable_available", environment, amount: payout }] : []),
        ...(commission > 0 ? [{ ownerType: "platform" as const, ownerId: "peebee", purpose: "digital_sales_commission", environment, amount: commission }] : []),
      ];
      const tx = await postLedgerTransaction({
        kind: "digital_sale",
        idempotencyKey: `digital-sale:${fulfillmentId}`,
        environment,
        referenceType: "digital_fulfillment",
        referenceId: fulfillmentId,
        description: `Digital sale: ${String(product.title)}`,
        actorId: input.buyer.id,
        postings,
        additionalStatements: payout > 0 ? [
          { sql: "INSERT OR IGNORE INTO merchant_balances (merchant_id, environment) VALUES (?, ?)", args: [merchantId, environment] },
          { sql: "UPDATE merchant_balances SET available = available + ?, updated_at = datetime('now') WHERE merchant_id = ? AND environment = ?", args: [payout, merchantId, environment] },
        ] : [],
      });
      ledgerId = tx.id;
    } catch (err) {
      await creditWallet(input.buyer.id, price, { type: "refund", environment, note: `Refund: ${String(product.title)}` });
      await abandon();
      console.error("digital sale ledger failed", err);
      return fail(503, "payment_failed", "We couldn't complete the payment, and you were not charged. Please try again.");
    }
  }

  // 3. Open the purchase.
  await db.execute({
    sql: `UPDATE store_digital_fulfillments
          SET status = 'active', price_paid_ugx = ?, commission_ugx = ?, license_key_issued = ?, needs_manual_fulfilment = ?
          WHERE id = ?`,
    args: [price, commission, licenseKey ?? "", needsManual ? 1 : 0, fulfillmentId],
  });
  await db.execute({ sql: "UPDATE store_digital_products SET sales_count = sales_count + 1, updated_at = datetime('now') WHERE id = ?", args: [input.productId] });
  void ledgerId;

  // 4. A course purchase is a seat in the course.
  let enrollmentId: string | null = null;
  if (kind === "course") {
    const seat = await enrollStudent({
      storeId, courseId: String(product.linked_course_id), userId: input.buyer.id,
      name: input.buyer.name ?? "", phone: input.buyer.phone ?? "", email: "",
      pricePaid: price, commission, environment,
    });
    enrollmentId = seat?.enrollmentId ?? null;
    if (enrollmentId) await db.execute({ sql: "UPDATE store_digital_fulfillments SET edu_enrollment_id = ? WHERE id = ?", args: [enrollmentId, fulfillmentId] });
  }

  // 5. Tell the buyer, by the channels admin has switched on. What is recorded is what the provider really said.
  const accessUrl = downloadPageUrl(token);
  let sms: { status: string } | null = null;
  const channels = opts.digital_delivery_channels as string[];
  if (channels.includes("sms_link") && input.buyer.phone) {
    const keyInSms = licenseKey && opts.digital_license_reveal === "sms_only" ? ` Your licence key: ${licenseKey}.` : "";
    const sent = await sendSms(input.buyer.phone, `${String(product.title)}: your purchase is ready. Open it here: ${accessUrl}.${keyInSms}`);
    sms = { status: sent.status };
    await db.execute({ sql: "UPDATE store_digital_fulfillments SET sms_status = ? WHERE id = ?", args: [sent.status, fulfillmentId] });
  }

  return {
    ok: true, fulfillmentId, token, accessUrl,
    licenseKey: opts.digital_license_reveal === "sms_only" ? null : licenseKey,
    expiresAt, maxDownloads, pricePaidUgx: price, sms, needsManualFulfilment: needsManual, enrollmentId,
  };
}

/* ------------------------------------------------------------ revoke/refund */

/**
 * Give a buyer their money back and (admin option) stop their access. The ledger entry reverses the sale, the licence
 * key is voided rather than reissued, and doing it twice does nothing.
 */
export async function refundFulfillment(input: { fulfillmentId: string; storeId: string; actorId: string }): Promise<{ ok: true } | { ok: false; error: string; message: string }> {
  const row = (await db.execute({ sql: "SELECT * FROM store_digital_fulfillments WHERE id = ? AND store_id = ?", args: [input.fulfillmentId, input.storeId] })).rows[0] as Row | undefined;
  if (!row) return { ok: false, error: "not_found", message: "That purchase doesn't exist." };
  const price = Number(row.price_paid_ugx) || 0;
  const refundWalletEntryId = `wl_digital_refund_${input.fulfillmentId}`;
  if (row.refunded_at) {
    if (price === 0 || (await db.execute({sql: "SELECT 1 FROM wallet_ledger WHERE id = ? AND user_id = ? AND type = 'refund' AND amount = ?", args: [refundWalletEntryId, String(row.buyer_user_id), price]})).rows.length) return {ok: true};
    return {ok: false, error: "refund_review_required", message: "This historical refund is marked complete but its buyer credit cannot be verified. Ask support to reconcile it; do not refund again manually."};
  }
  const commission = Number(row.commission_ugx) || 0;
  const payout = price - commission;
  if (!Number.isSafeInteger(price) || !Number.isSafeInteger(commission) || price < 0 || commission < 0 || payout < 0) throw new Error("Invalid refund amounts");
  const sale = (await db.execute({sql: "SELECT environment FROM ledger_transactions WHERE idempotency_key = ?", args: [`digital-sale:${input.fulfillmentId}`]})).rows[0];
  const enrollment = row.edu_enrollment_id && await hasTable("edu_enrollments")
    ? (await db.execute({sql: "SELECT environment FROM edu_enrollments WHERE id = ?", args: [String(row.edu_enrollment_id)]})).rows[0] : null;
  // Never choose a refund's money world from today's platform switch.
  const originalEnvironment = sale?.environment ?? enrollment?.environment;
  if (price > 0 && originalEnvironment !== "live" && originalEnvironment !== "sandbox") return {ok: false, error: "refund_review_required", message: "The original payment environment could not be verified. Ask support to reconcile this purchase."};
  const environment: "live" | "sandbox" = originalEnvironment === "sandbox" ? "sandbox" : "live";
  if (price > 0 && !row.buyer_user_id) return {ok: false, error: "refund_review_required", message: "This purchase has no verified buyer wallet. Ask support to reconcile it."};
  const merchantId = String((await db.execute({sql: "SELECT merchant_id FROM stores WHERE id = ?", args: [input.storeId]})).rows[0]?.merchant_id);
  const school = !sale && price > 0 ? (await db.execute({sql: "SELECT s.owner_id FROM store_digital_products p JOIN edu_courses c ON c.id = p.linked_course_id JOIN edu_schools s ON s.id = c.school_id WHERE p.id = ?", args: [String(row.digital_product_id)]})).rows[0] : null;
  if (!sale && price > 0 && !school) return {ok: false, error: "refund_review_required", message: "The original payout owner could not be verified. Ask support to reconcile it."};
  const column = environment === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance";
  const {digital_refund_revokes_access: revoke} = await getOptions(["digital_refund_revokes_access"]);
  const writes: DbStatement[] = [
    {sql: "UPDATE store_digital_fulfillments SET refunded_at = datetime('now') WHERE id = ? AND store_id = ? AND refunded_at IS NULL", args: [input.fulfillmentId, input.storeId]},
    requireChangedRow,
  ];
  if (payout > 0) {
    writes.push(sale
      ? {sql: "UPDATE merchant_balances SET available = available - ?, updated_at = datetime('now') WHERE merchant_id = ? AND environment = ? AND available >= ?", args: [payout, merchantId, environment, payout]}
      : {sql: `UPDATE users SET ${column} = ${column} - ?, updated_at = datetime('now') WHERE id = ? AND ${column} >= ?`, args: [payout, String(school!.owner_id), payout]}, requireChangedRow);
    if (!sale) writes.push({sql: `INSERT INTO wallet_ledger (id, user_id, type, amount, balance_after, note, actor_id, environment) SELECT ?, id, 'adjustment', ?, ${column}, 'Refund of a course sale', ?, ? FROM users WHERE id = ?`, args: [newId("wl"), -payout, input.actorId, environment, String(school!.owner_id)]});
  }
  if (price > 0) writes.push(
    {sql: `UPDATE users SET ${column} = ${column} + ?, updated_at = datetime('now') WHERE id = ?`, args: [price, String(row.buyer_user_id)]}, requireChangedRow,
    {sql: `INSERT INTO wallet_ledger (id, user_id, type, amount, balance_after, note, actor_id, environment) SELECT ?, id, 'refund', ?, ${column}, 'Refund: digital purchase', ?, ? FROM users WHERE id = ?`, args: [refundWalletEntryId, price, input.actorId, environment, String(row.buyer_user_id)]}, requireChangedRow,
  );
  if (revoke) {
    writes.push({sql: "UPDATE store_digital_fulfillments SET status = 'revoked' WHERE id = ?", args: [input.fulfillmentId]});
    if (await hasTable("store_license_keys")) writes.push({sql: "UPDATE store_license_keys SET status = 'void' WHERE fulfillment_id = ?", args: [input.fulfillmentId]});
    if (row.edu_enrollment_id && await hasTable("edu_enrollments")) writes.push({sql: "UPDATE edu_enrollments SET status = 'revoked' WHERE id = ?", args: [String(row.edu_enrollment_id)]});
  }
  try {
    if (price > 0) await postLedgerTransaction({
      kind: "digital_refund", idempotencyKey: `digital-refund:${input.fulfillmentId}`, environment,
      referenceType: "digital_fulfillment", referenceId: input.fulfillmentId, description: "Digital sale refunded", actorId: input.actorId,
      postings: [
        {ownerType: "customer", ownerId: String(row.buyer_user_id), purpose: "wallet_payable", environment, amount: price},
        ...(payout > 0 ? [{ownerType: (sale ? "merchant" : "customer") as "merchant" | "customer", ownerId: sale ? merchantId : String(school!.owner_id), purpose: sale ? "payable_available" : "wallet_payable", environment, amount: -payout}] : []),
        ...(commission > 0 ? [{ownerType: "platform" as const, ownerId: "peebee", purpose: "digital_sales_commission", environment, amount: -commission}] : []),
      ], additionalStatements: writes,
    });
    else await executeBatch(writes);
  } catch (error) {
    const refunded = (await db.execute({sql: "SELECT refunded_at FROM store_digital_fulfillments WHERE id = ?", args: [input.fulfillmentId]})).rows[0]?.refunded_at;
    if (refunded) return refundFulfillment(input); // Verify the winning refund's buyer-credit proof too.
    if (/JSON path|bad path|malformed JSON/i.test(String(error))) return {ok: false, error: "refund_balance_changed", message: "The payout balance no longer covers this refund. Refresh and try again."};
    throw error;
  }
  return {ok: true};
}

/** Licence products with no key left to sell, so the store can say "sold out" instead of taking a payment that will fail. */
export async function soldOutLicenseProducts(storeId: string): Promise<Set<string>> {
  if (!(await hasTable("store_license_keys"))) return new Set();
  const res = await db.execute({
    sql: `SELECT p.id FROM store_digital_products p
          WHERE p.store_id = ? AND p.kind = 'license_key' AND p.status = 'published'
            AND NOT EXISTS (SELECT 1 FROM store_license_keys k WHERE k.product_id = p.id AND k.status = 'available')`,
    args: [storeId],
  });
  const { digital_license_exhausted_action: action } = await getOptions(["digital_license_exhausted_action"]);
  if (action === "allow_backorder_manual_fulfil") return new Set();
  return new Set((res.rows as Row[]).map((r) => String(r.id)));
}
