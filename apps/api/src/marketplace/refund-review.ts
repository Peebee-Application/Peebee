import { db } from "../db/client.js";
import { hasColumn, tablesExist } from "../lib/schema.js";

type Row = Record<string, unknown>;
export async function refundReviewReady() {
  return await tablesExist(["store_digital_fulfillments", "ledger_transactions", "ledger_entries", "ledger_accounts", "wallet_ledger"])
    && await hasColumn("store_digital_fulfillments", "refunded_at")
    && await hasColumn("store_digital_fulfillments", "buyer_user_id");
}

// Deliberately select evidence, never access tokens, licence keys or download URLs.
const selectPurchase = `SELECT f.id, f.store_id, s.merchant_id, s.name AS store_name,
  f.digital_product_id, f.buyer_user_id, f.price_paid_ugx, f.commission_ugx,
  f.refunded_at, f.status, f.created_at, f.edu_enrollment_id,
  sale.id AS sale_transaction_id, sale.environment AS sale_environment,
  refund.id AS refund_transaction_id, refund.environment AS refund_environment,
  w.id AS refund_wallet_entry_id, w.user_id AS credited_user_id, w.amount AS credited_amount,
  w.environment AS credited_environment, w.type AS credit_type
  FROM store_digital_fulfillments f JOIN stores s ON s.id=f.store_id
  LEFT JOIN ledger_transactions sale ON sale.idempotency_key='digital-sale:'||f.id
  LEFT JOIN ledger_transactions refund ON refund.idempotency_key='digital-refund:'||f.id
  LEFT JOIN wallet_ledger w ON w.id='wl_digital_refund_'||f.id`;

function classification(row: Row) {
  if (!row.refunded_at) return row.refund_wallet_entry_id || row.refund_transaction_id ? "inconsistent" : "not_refunded";
  if (Number(row.price_paid_ugx) === 0) return "free_access_revoked";
  // A matching wallet receipt alone does not prove that the merchant/commission reversal completed.
  if (row.refund_transaction_id && row.refund_wallet_entry_id
    && row.credited_user_id === row.buyer_user_id && row.credit_type === "refund"
    && Number(row.credited_amount) === Number(row.price_paid_ugx)
    && row.credited_environment === row.refund_environment
    && (!row.sale_environment || row.sale_environment === row.refund_environment)) return "evidence_present";
  return "review_required";
}

export async function listRefundReviews(input: { after?: string; storeId?: string; limit: number }) {
  const conditions = ["f.refunded_at IS NOT NULL"];
  const args: (string | number)[] = [];
  if (input.after) { conditions.push("f.id > ?"); args.push(input.after); }
  if (input.storeId) { conditions.push("f.store_id = ?"); args.push(input.storeId); }
  args.push(input.limit + 1);
  const result = await db.execute({sql: `${selectPurchase} WHERE ${conditions.join(" AND ")} ORDER BY f.id LIMIT ?`, args});
  const rows = result.rows as Row[];
  const page = rows.slice(0, input.limit);
  return {items: page.map(row => ({...row, classification: classification(row)})), nextCursor: rows.length > input.limit ? String(page.at(-1)!.id) : null};
}

export async function refundReviewEvidence(id: string) {
  const purchase = (await db.execute({sql: `${selectPurchase} WHERE f.id=?`, args: [id]})).rows[0] as Row | undefined;
  if (!purchase) return null;
  const transactions = (await db.execute({sql: `SELECT t.id, t.kind, t.environment, t.reference_type, t.reference_id,
    t.idempotency_key, t.created_at, a.owner_type, a.owner_id, a.purpose, a.environment AS account_environment, e.amount
    FROM ledger_transactions t LEFT JOIN ledger_entries e ON e.transaction_id=t.id
    LEFT JOIN ledger_accounts a ON a.id=e.account_id
    WHERE t.id IN (?, ?) ORDER BY t.id, a.id, e.id`, args: [purchase.sale_transaction_id ? String(purchase.sale_transaction_id) : null, purchase.refund_transaction_id ? String(purchase.refund_transaction_id) : null]})).rows as Row[];
  // Legacy credits have no fulfillment reference. Show candidates but never infer that one is this refund.
  const candidates = purchase.buyer_user_id ? (await db.execute({sql: `SELECT id, type, amount, environment, created_at, note
    FROM wallet_ledger WHERE user_id=? AND type='refund' AND amount=? AND id!=?
    ORDER BY created_at DESC, id DESC LIMIT 51`, args: [String(purchase.buyer_user_id), Number(purchase.price_paid_ugx), `wl_digital_refund_${id}`]})).rows as Row[] : [];
  const reviews = (await db.execute({sql: `SELECT id, actor_name, action, summary, after_json, created_at
    FROM admin_activity_log WHERE entity_type='digital_refund_review' AND entity_id=? ORDER BY created_at DESC, id DESC LIMIT 20`, args: [id]})).rows;
  const evidence = {purchase, classification: classification(purchase), transactions, legacyCreditCandidates: candidates.slice(0, 50), candidatesTruncated: candidates.length > 50};
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(evidence)));
  const fingerprint = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, "0")).join("");
  return {...evidence, fingerprint, reviews, moneyMovement: false as const};
}
