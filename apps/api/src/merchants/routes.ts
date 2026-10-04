import { Hono } from "hono";
import { z } from "zod";
import { logActivity } from "../admin/activity.js";
import { isAdminRole, requirePermission } from "../admin/permissions.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { db, executeBatch } from "../db/client.js";
import { ledgerBalance, postLedgerTransaction } from "../ledger/service.js";
import { newId } from "../lib/ids.js";
import { baseMimeType, extensionForMime } from "../lib/mime.js";
import { clientIp } from "../lib/ratelimit.js";
import { decryptSecret, encryptSecret, isCredentialsEncryptionConfigured } from "../lib/crypto.js";
import { getPlatformEnvironment } from "../lib/settings.js";
import {
  initiateDisbursement,
  paymentProviderErrorResponse,
  paymentProviderHttpStatus,
} from "../payments/service.js";
import { reconcileMerchantSettlement } from "../payments/reconciliation.js";
import { getR2Bucket, uploadResponseHeaders } from "../storage/r2.js";
import {
  assessPurchaseLocation,
  createMerchantBusiness,
  ensureOrderBudget,
  finalizeMerchantPayment,
  merchantPaymentsEnabled,
} from "./service.js";
import { resolveMerchantPolicy } from "./policy.js";

export const merchantRoutes = new Hono();
type Row = Record<string, unknown>;

const applicationSchema = z.object({
  legalName: z.string().min(2).max(160),
  displayName: z.string().min(2).max(120),
  businessKind: z.enum(["business", "personal_seller"]).default("business"),
  categoryId: z.string().min(1),
  outletName: z.string().min(2).max(120),
  phone: z.string().min(6).max(20).optional(),
  address: z.string().max(240).optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

async function membership(userId: string, merchantId: string): Promise<Row | undefined> {
  const result = await db.execute({
    sql: `SELECT mm.*, m.status AS merchant_status, m.trust_tier, m.environment
          FROM merchant_members mm JOIN merchants m ON m.id = mm.merchant_id
          WHERE mm.user_id = ? AND mm.merchant_id = ? AND mm.status = 'active'`,
    args: [userId, merchantId],
  });
  return result.rows[0] as Row | undefined;
}

function mayManage(role: unknown): boolean {
  return role === "owner" || role === "finance" || role === "manager";
}

function maySettle(role: unknown): boolean {
  return role === "owner" || role === "finance";
}

function mayManageStaff(role: unknown): boolean {
  return role === "owner";
}

async function merchantWithdrawalsFrozen(): Promise<boolean> {
  const result = await db.execute("SELECT value FROM settings WHERE key = 'merchant_withdrawals_frozen'");
  return String((result.rows[0] as Row | undefined)?.value ?? "0") === "1";
}

merchantRoutes.get("/merchant-categories", requireAuth, async (c) => {
  const result = await db.execute("SELECT * FROM merchant_categories WHERE active = 1 ORDER BY sort_order, name");
  return c.json({ categories: result.rows });
});

merchantRoutes.post("/merchants/apply", requireAuth, requireRole("customer"), async (c) => {
  const user = c.get("user");
  const parsed = applicationSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  if (parsed.data.businessKind !== "business") {
    return c.json({ error: "merchant_lite_not_launched", message: "Personal and informal sellers are not in the first merchant cohort." }, 409);
  }
  const category = await db.execute({
    sql: "SELECT id FROM merchant_categories WHERE id = ? AND active = 1",
    args: [parsed.data.categoryId],
  });
  if (!category.rows[0]) return c.json({ error: "invalid_category" }, 400);

  const environment = await getPlatformEnvironment();
  const created = await createMerchantBusiness({
    ownerId: user.sub,
    legalName: parsed.data.legalName,
    displayName: parsed.data.displayName,
    businessKind: parsed.data.businessKind,
    categoryId: parsed.data.categoryId,
    outletName: parsed.data.outletName,
    phone: parsed.data.phone,
    address: parsed.data.address,
    lat: parsed.data.lat,
    lng: parsed.data.lng,
    environment,
  });
  const result = await db.execute({ sql: "SELECT * FROM merchants WHERE id = ?", args: [created.merchantId] });
  return c.json({ merchant: result.rows[0], outlet: created }, 201);
});

merchantRoutes.get("/merchants/me", requireAuth, async (c) => {
  const user = c.get("user");
  const result = await db.execute({
    sql: `SELECT m.*, mm.role AS member_role,
                 k.status AS kyc_status,
                 CASE WHEN k.owner_id_key IS NULL THEN 0 ELSE 1 END AS has_owner_id_document,
                 CASE WHEN k.business_document_key IS NULL THEN 0 ELSE 1 END AS has_business_document
          FROM merchant_members mm
          JOIN merchants m ON m.id = mm.merchant_id
          LEFT JOIN merchant_kyc_cases k ON k.merchant_id = m.id
          WHERE mm.user_id = ? AND mm.status = 'active'
          ORDER BY m.created_at`,
    args: [user.sub],
  });
  return c.json({ merchants: result.rows });
});

const merchantProfileSchema = z.object({
  legalName: z.string().min(2).max(160).optional(),
  displayName: z.string().min(2).max(120).optional(),
});

merchantRoutes.patch("/merchants/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const merchantId = String(c.req.param("id"));
  const member = await membership(user.sub, merchantId);
  if (!member || !mayManage(member.role)) return c.json({ error: "forbidden" }, 403);
  const parsed = merchantProfileSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  await db.execute({
    sql: `UPDATE merchants SET legal_name=COALESCE(?, legal_name), display_name=COALESCE(?, display_name),
          updated_at=datetime('now') WHERE id=?`,
    args: [parsed.data.legalName ?? null, parsed.data.displayName ?? null, merchantId],
  });
  const result = await db.execute({ sql: "SELECT * FROM merchants WHERE id=?", args: [merchantId] });
  return c.json({ merchant: result.rows[0] });
});

const kycSubmissionSchema = z.object({
  registrationNumber: z.string().trim().min(3).max(80),
  taxId: z.string().trim().min(3).max(80),
  declarationAccepted: z.literal(true),
});

merchantRoutes.post("/merchants/:id/kyc", requireAuth, async (c) => {
  const user = c.get("user");
  const merchantId = String(c.req.param("id"));
  const member = await membership(user.sub, merchantId);
  if (!member || !mayManage(member.role)) return c.json({ error: "forbidden" }, 403);
  const parsed = kycSubmissionSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  await executeBatch([
    {
      sql: "UPDATE merchants SET registration_number=?, tax_id=?, updated_at=datetime('now') WHERE id=?",
      args: [parsed.data.registrationNumber, parsed.data.taxId, merchantId],
    },
    {
      sql: `UPDATE merchant_kyc_cases SET status='in_review', business_verified=0,
            risk_notes=NULL, updated_at=datetime('now') WHERE merchant_id=?`,
      args: [merchantId],
    },
  ]);
  return c.json({ kyc: { status: "in_review" } });
});

const KYC_DOCUMENT_TYPES = ["owner-id", "business-registration"] as const;
const KYC_DOCUMENT_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_KYC_DOCUMENT_BYTES = 8 * 1024 * 1024;

merchantRoutes.post("/merchants/:id/kyc-documents/:type", requireAuth, async (c) => {
  const user = c.get("user");
  const merchantId = String(c.req.param("id"));
  const type = String(c.req.param("type"));
  if (!(KYC_DOCUMENT_TYPES as readonly string[]).includes(type)) return c.json({ error: "invalid_document_type" }, 400);
  const member = await membership(user.sub, merchantId);
  if (!member || !mayManage(member.role)) return c.json({ error: "forbidden" }, 403);
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return c.json({ error: "missing_file" }, 400);
  if (!KYC_DOCUMENT_MIME.has(baseMimeType(file.type))) return c.json({ error: "unsupported_file_type" }, 400);
  if (file.size > MAX_KYC_DOCUMENT_BYTES) return c.json({ error: "file_too_large" }, 400);
  const ext = extensionForMime(file.type, "bin");
  const key = `merchants/${merchantId}/kyc/${type}.${ext}`;
  await getR2Bucket().put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  const column = type === "owner-id" ? "owner_id_key" : "business_document_key";
  await db.execute({
    sql: `UPDATE merchant_kyc_cases SET ${column}=?, status=CASE
            WHEN EXISTS (SELECT 1 FROM merchants m WHERE m.id=merchant_id AND m.registration_number IS NOT NULL AND m.tax_id IS NOT NULL)
             AND COALESCE(?, ${column}) IS NOT NULL
             AND ${type === "owner-id" ? "business_document_key" : "owner_id_key"} IS NOT NULL
            THEN 'in_review' ELSE status END, updated_at=datetime('now') WHERE merchant_id=?`,
    args: [key, key, merchantId],
  });
  return c.json({ document: { type, uploaded: true } });
});

merchantRoutes.get("/merchants/:id/outlets", requireAuth, async (c) => {
  const user = c.get("user");
  const merchantId = String(c.req.param("id"));
  const member = await membership(user.sub, merchantId);
  if (!member) return c.json({ error: "forbidden" }, 403);
  const result = await db.execute({
    sql: `SELECT o.*, c.name AS category_name, c.slug AS category_slug
          FROM merchant_outlets o JOIN merchant_categories c ON c.id = o.category_id
          WHERE o.merchant_id = ? AND (? != 'cashier' OR o.id = ?) ORDER BY o.created_at`,
    args: [merchantId, String(member.role), member.outlet_id == null ? "" : String(member.outlet_id)],
  });
  return c.json({ outlets: result.rows });
});

const outletSchema = z.object({
  categoryId: z.string(),
  name: z.string().min(2).max(120),
  phone: z.string().min(6).max(20).optional(),
  address: z.string().max(240).optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

merchantRoutes.post("/merchants/:id/outlets", requireAuth, async (c) => {
  const user = c.get("user");
  const merchantId = String(c.req.param("id"));
  const member = await membership(user.sub, merchantId);
  if (!member || !mayManage(member.role)) return c.json({ error: "forbidden" }, 403);
  const parsed = outletSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const policy = await resolveMerchantPolicy(merchantId, String(member.trust_tier));
  const count = await db.execute({ sql: "SELECT COUNT(*) AS n FROM merchant_outlets WHERE merchant_id = ?", args: [merchantId] });
  if (policy.maxOutlets != null && Number((count.rows[0] as Row).n) >= policy.maxOutlets) {
    return c.json({ error: "outlet_limit_reached" }, 409);
  }
  const id = newId("out");
  const code = `PEEBEE-${id.slice(-8).toUpperCase()}`;
  await db.execute({
    sql: `INSERT INTO merchant_outlets
          (id, merchant_id, category_id, name, code, phone, address, lat, lng)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, merchantId, parsed.data.categoryId, parsed.data.name, code, parsed.data.phone ?? null,
      parsed.data.address ?? null, parsed.data.lat ?? null, parsed.data.lng ?? null],
  });
  const result = await db.execute({ sql: "SELECT * FROM merchant_outlets WHERE id = ?", args: [id] });
  return c.json({ outlet: result.rows[0] }, 201);
});

const outletUpdateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  phone: z.string().min(6).max(20).nullable().optional(),
  address: z.string().max(240).nullable().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  status: z.enum(["active", "suspended", "closed"]).optional(),
});

merchantRoutes.patch("/merchants/:id/outlets/:outletId", requireAuth, async (c) => {
  const user = c.get("user");
  const merchantId = String(c.req.param("id"));
  const outletId = String(c.req.param("outletId"));
  const member = await membership(user.sub, merchantId);
  if (!member || !mayManage(member.role)) return c.json({ error: "forbidden" }, 403);
  const parsed = outletUpdateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const d = parsed.data;
  await db.execute({
    sql: `UPDATE merchant_outlets SET name=COALESCE(?, name), phone=CASE WHEN ? THEN ? ELSE phone END,
          address=CASE WHEN ? THEN ? ELSE address END, lat=COALESCE(?, lat), lng=COALESCE(?, lng),
          status=COALESCE(?, status), updated_at=datetime('now') WHERE id=? AND merchant_id=?`,
    args: [d.name ?? null, d.phone !== undefined ? 1 : 0, d.phone ?? null,
      d.address !== undefined ? 1 : 0, d.address ?? null, d.lat ?? null, d.lng ?? null,
      d.status ?? null, outletId, merchantId],
  });
  const result = await db.execute({ sql: "SELECT * FROM merchant_outlets WHERE id=? AND merchant_id=?", args: [outletId, merchantId] });
  if (!result.rows[0]) return c.json({ error: "not_found" }, 404);
  return c.json({ outlet: result.rows[0] });
});

merchantRoutes.get("/merchants/:id/members", requireAuth, async (c) => {
  const user = c.get("user");
  const merchantId = String(c.req.param("id"));
  const member = await membership(user.sub, merchantId);
  if (!member || member.role === "cashier") return c.json({ error: "forbidden" }, 403);
  const result = await db.execute({
    sql: `SELECT mm.user_id, mm.role, mm.status, mm.outlet_id, mm.created_at,
                 u.name, u.email, u.phone
          FROM merchant_members mm JOIN users u ON u.id=mm.user_id
          WHERE mm.merchant_id=? ORDER BY CASE mm.role WHEN 'owner' THEN 0 ELSE 1 END, u.name`,
    args: [merchantId],
  });
  return c.json({ members: result.rows });
});

const memberSchema = z.object({
  identifier: z.string().trim().min(3).max(160),
  role: z.enum(["finance", "manager", "cashier"]),
  outletId: z.string().nullable().optional(),
});

merchantRoutes.post("/merchants/:id/members", requireAuth, async (c) => {
  const user = c.get("user");
  const merchantId = String(c.req.param("id"));
  const member = await membership(user.sub, merchantId);
  if (!member || !mayManageStaff(member.role)) return c.json({ error: "forbidden" }, 403);
  const parsed = memberSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const target = await db.execute({
    sql: "SELECT id, role FROM users WHERE lower(email)=lower(?) OR phone=? LIMIT 1",
    args: [parsed.data.identifier, parsed.data.identifier],
  });
  const targetUser = target.rows[0] as Row | undefined;
  if (!targetUser || targetUser.role !== "customer") {
    return c.json({ error: "merchant_member_not_found", message: "That person must first create a customer account with this email or phone." }, 404);
  }
  if (parsed.data.outletId) {
    const outlet = await db.execute({ sql: "SELECT 1 FROM merchant_outlets WHERE id=? AND merchant_id=?", args: [parsed.data.outletId, merchantId] });
    if (!outlet.rows[0]) return c.json({ error: "invalid_outlet" }, 400);
  }
  await db.execute({
    sql: `INSERT INTO merchant_members (merchant_id, user_id, role, status, outlet_id)
          VALUES (?, ?, ?, 'active', ?)
          ON CONFLICT(merchant_id, user_id) DO UPDATE SET role=excluded.role, status='active',
            outlet_id=excluded.outlet_id, updated_at=datetime('now')`,
    args: [merchantId, String(targetUser.id), parsed.data.role, parsed.data.outletId ?? null],
  });
  return c.json({ member: { userId: targetUser.id, role: parsed.data.role, status: "active" } }, 201);
});

merchantRoutes.delete("/merchants/:id/members/:userId", requireAuth, async (c) => {
  const user = c.get("user");
  const merchantId = String(c.req.param("id"));
  const member = await membership(user.sub, merchantId);
  if (!member || !mayManageStaff(member.role)) return c.json({ error: "forbidden" }, 403);
  const targetUserId = String(c.req.param("userId"));
  const target = await db.execute({ sql: "SELECT role FROM merchant_members WHERE merchant_id=? AND user_id=?", args: [merchantId, targetUserId] });
  if (!target.rows[0]) return c.json({ error: "not_found" }, 404);
  if ((target.rows[0] as Row).role === "owner") return c.json({ error: "owner_cannot_be_removed" }, 409);
  await db.execute({
    sql: "UPDATE merchant_members SET status='revoked', updated_at=datetime('now') WHERE merchant_id=? AND user_id=?",
    args: [merchantId, targetUserId],
  });
  return c.json({ ok: true });
});

merchantRoutes.get("/merchant-outlets/code/:code", requireAuth, async (c) => {
  const result = await db.execute({
    sql: `SELECT o.id, o.merchant_id, o.name, o.code, o.address, o.status,
                 m.display_name, m.status AS merchant_status, c.name AS category_name
          FROM merchant_outlets o
          JOIN merchants m ON m.id = o.merchant_id
          JOIN merchant_categories c ON c.id = o.category_id
          WHERE upper(o.code) = upper(?)`,
    args: [String(c.req.param("code"))],
  });
  const outlet = result.rows[0] as Row | undefined;
  if (!outlet || outlet.status !== "active" || outlet.merchant_status !== "active") {
    return c.json({ error: "merchant_not_available" }, 404);
  }
  return c.json({ outlet });
});

merchantRoutes.get("/merchants/:id/balance", requireAuth, async (c) => {
  const user = c.get("user");
  const merchantId = String(c.req.param("id"));
  const member = await membership(user.sub, merchantId);
  if (!member || member.role === "cashier") return c.json({ error: "forbidden" }, 403);
  const environment = member.environment as "live" | "sandbox";
  const balances = await db.execute({
    sql: "SELECT held, available, settling, updated_at FROM merchant_balances WHERE merchant_id = ? AND environment = ?",
    args: [merchantId, environment],
  });
  return c.json({ balance: balances.rows[0] ?? { held: 0, available: 0, settling: 0 }, currency: "UGX", environment });
});

merchantRoutes.get("/merchants/:id/transactions", requireAuth, async (c) => {
  const user = c.get("user");
  const merchantId = String(c.req.param("id"));
  const member = await membership(user.sub, merchantId);
  if (!member || member.role === "cashier") return c.json({ error: "forbidden" }, 403);
  const result = await db.execute({
    sql: `SELECT t.id, t.kind, t.reference_type, t.reference_id, t.description, t.created_at,
                 e.amount, a.purpose, a.currency, a.environment
          FROM ledger_accounts a
          JOIN ledger_entries e ON e.account_id = a.id
          JOIN ledger_transactions t ON t.id = e.transaction_id
          WHERE a.owner_type = 'merchant' AND a.owner_id = ?
          ORDER BY t.created_at DESC LIMIT 100`,
    args: [merchantId],
  });
  return c.json({ transactions: result.rows });
});

merchantRoutes.get("/merchants/:id/payments", requireAuth, async (c) => {
  const user = c.get("user");
  const merchantId = String(c.req.param("id"));
  const member = await membership(user.sub, merchantId);
  if (!member) return c.json({ error: "forbidden" }, 403);
  const result = await db.execute({
    sql: `SELECT mp.id, mp.order_id, mp.outlet_id, o.name AS outlet_name, mp.amount, mp.status,
                 mp.confirmation_mode, mp.risk_state, mp.receipt_reference, mp.rider_id,
                 u.name AS rider_name, mp.created_at, mp.updated_at
          FROM merchant_payments mp
          JOIN merchant_outlets o ON o.id=mp.outlet_id
          JOIN users u ON u.id=mp.rider_id
          WHERE mp.merchant_id=? AND (? != 'cashier' OR mp.outlet_id=?)
          ORDER BY mp.created_at DESC LIMIT 200`,
    args: [merchantId, String(member.role), member.outlet_id == null ? "" : String(member.outlet_id)],
  });
  return c.json({ payments: result.rows });
});

merchantRoutes.get("/merchants/:id/disputes", requireAuth, async (c) => {
  const user = c.get("user");
  const merchantId = String(c.req.param("id"));
  const member = await membership(user.sub, merchantId);
  if (!member || member.role === "cashier") return c.json({ error: "forbidden" }, 403);
  const result = await db.execute({
    sql: `SELECT d.* FROM merchant_disputes d
          JOIN merchant_payments mp ON mp.id=d.merchant_payment_id
          WHERE mp.merchant_id=? ORDER BY d.created_at DESC LIMIT 100`,
    args: [merchantId],
  });
  return c.json({ disputes: result.rows });
});

const disputeSchema = z.object({
  merchantPaymentId: z.string(),
  reason: z.string().trim().min(10).max(1000),
});

merchantRoutes.post("/merchants/:id/disputes", requireAuth, async (c) => {
  const user = c.get("user");
  const merchantId = String(c.req.param("id"));
  const member = await membership(user.sub, merchantId);
  if (!member || member.role === "cashier") return c.json({ error: "forbidden" }, 403);
  const parsed = disputeSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const paymentResult = await db.execute({
    sql: "SELECT id, order_id, amount FROM merchant_payments WHERE id=? AND merchant_id=?",
    args: [parsed.data.merchantPaymentId, merchantId],
  });
  const payment = paymentResult.rows[0] as Row | undefined;
  if (!payment) return c.json({ error: "not_found" }, 404);
  const existing = await db.execute({
    sql: "SELECT * FROM merchant_disputes WHERE merchant_payment_id=? AND status IN ('open','under_review') LIMIT 1",
    args: [String(payment.id)],
  });
  if (existing.rows[0]) return c.json({ dispute: existing.rows[0] });
  const id = newId("mdp");
  await executeBatch([
    {
      sql: `INSERT INTO merchant_disputes
            (id, order_id, merchant_payment_id, opened_by, amount, reason)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [id, String(payment.order_id), String(payment.id), user.sub, Number(payment.amount), parsed.data.reason],
    },
    {
      sql: `UPDATE merchant_payments SET status='disputed', updated_at=datetime('now')
            WHERE id=? AND status IN ('awaiting_confirmation','held')`,
      args: [String(payment.id)],
    },
  ]);
  const result = await db.execute({ sql: "SELECT * FROM merchant_disputes WHERE id=?", args: [id] });
  return c.json({ dispute: result.rows[0] }, 201);
});

const riderPaymentSchema = z.object({
  orderId: z.string(),
  outletCode: z.string().min(4).max(40),
  amount: z.number().int().positive(),
  riderLat: z.number().min(-90).max(90).optional(),
  riderLng: z.number().min(-180).max(180).optional(),
  accuracyM: z.number().nonnegative().max(10_000).optional(),
  capturedAt: z.string().datetime().optional(),
  evidenceMode: z.enum(["gps", "dynamic_request", "merchant_reauth_receipt"]).optional(),
  receiptReference: z.string().trim().min(3).max(160).optional(),
});

merchantRoutes.post("/merchant-payments", requireAuth, requireRole("rider"), async (c) => {
  const user = c.get("user");
  const idempotencyKey = c.req.header("Idempotency-Key")?.trim();
  if (!idempotencyKey) return c.json({ error: "idempotency_key_required" }, 400);
  const parsed = riderPaymentSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const orderResult = await db.execute({ sql: "SELECT * FROM orders WHERE id = ?", args: [parsed.data.orderId] });
  const order = orderResult.rows[0] as Row | undefined;
  if (!order) return c.json({ error: "not_found" }, 404);
  if (order.rider_id !== user.sub) return c.json({ error: "forbidden" }, 403);
  if (order.funds_model !== "merchant_allocations_v1" || !["Shop", "Substitute", "Approve"].includes(String(order.stage))) {
    return c.json({ error: "merchant_payment_not_available" }, 409);
  }
  if (!(await merchantPaymentsEnabled(order.environment as "live" | "sandbox"))) {
    return c.json({ error: "merchant_payments_not_ready", message: "Merchant payments are not approved for this environment." }, 409);
  }
  const outletResult = await db.execute({
    sql: `SELECT o.*, m.status AS merchant_status, m.trust_tier, m.environment
          FROM merchant_outlets o JOIN merchants m ON m.id = o.merchant_id
          WHERE upper(o.code) = upper(?)`,
    args: [parsed.data.outletCode],
  });
  const outlet = outletResult.rows[0] as Row | undefined;
  if (!outlet || outlet.status !== "active" || outlet.merchant_status !== "active") {
    return c.json({ error: "merchant_not_available" }, 409);
  }
  if (outlet.environment !== order.environment) return c.json({ error: "environment_mismatch" }, 409);
  const related = await db.execute({
    sql: "SELECT 1 FROM merchant_members WHERE merchant_id = ? AND user_id = ? AND status = 'active' LIMIT 1",
    args: [String(outlet.merchant_id), user.sub],
  });
  if (related.rows.length > 0) return c.json({ error: "related_party_payment_forbidden" }, 409);

  const risk = assessPurchaseLocation({
    riderLat: parsed.data.riderLat,
    riderLng: parsed.data.riderLng,
    accuracyM: parsed.data.accuracyM,
    capturedAt: parsed.data.capturedAt,
    outletLat: outlet.lat == null ? undefined : Number(outlet.lat),
    outletLng: outlet.lng == null ? undefined : Number(outlet.lng),
    evidenceMode: parsed.data.evidenceMode,
    receiptReference: parsed.data.receiptReference,
  });
  if (risk.decision === "reject") {
    return c.json({ error: "merchant_location_rejected", message: "The rider is too far from this outlet to confirm the purchase.", risk }, 409);
  }
  if (risk.decision === "step_up") {
    return c.json({
      error: "merchant_location_step_up_required",
      message: "Merchant re-confirmation and receipt evidence are required for this location reading.",
      risk,
    }, 409);
  }
  const policy = await resolveMerchantPolicy(String(outlet.merchant_id), String(outlet.trust_tier));
  if (policy.paymentConfirmationMode === "merchant_request") {
    return c.json({ error: "merchant_request_required", message: "Ask the merchant to create the payment request." }, 409);
  }
  await ensureOrderBudget(parsed.data.orderId);
  const existing = await db.execute({
    sql: "SELECT * FROM merchant_payments WHERE environment = ? AND idempotency_key = ?",
    args: [String(order.environment), idempotencyKey],
  });
  if (existing.rows[0]) return c.json({ payment: existing.rows[0] });

  const id = newId("mpay");
  const immediate = policy.paymentConfirmationMode === "rider_only";
  const paymentRiskState = policy.settlementReleaseMode === "manual_hold" ? "held" : "passed";
  const paymentRiskReason = paymentRiskState === "held" ? "merchant_policy_manual_hold" : risk.reason;
  await executeBatch([
    {
      sql: `INSERT INTO merchant_payments
          (id, order_id, merchant_id, outlet_id, amount, confirmation_mode, rider_id, initiated_by,
           rider_confirmed_at, merchant_confirmed_at, risk_state, rider_lat, rider_lng, rider_accuracy_m,
           location_captured_at, outlet_distance_m, evidence_mode, receipt_reference, risk_reason,
           policy_version, idempotency_key, environment)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, order.id, outlet.merchant_id, outlet.id, parsed.data.amount, policy.paymentConfirmationMode,
        user.sub, user.sub, immediate ? new Date().toISOString() : null, paymentRiskState,
        parsed.data.riderLat ?? null, parsed.data.riderLng ?? null, parsed.data.accuracyM ?? null,
        parsed.data.capturedAt ?? null, risk.distanceM, parsed.data.evidenceMode ?? "gps",
        parsed.data.receiptReference ?? null, paymentRiskReason, policy.version, idempotencyKey, order.environment],
    },
    {
      sql: `INSERT INTO merchant_risk_decisions
            (id, merchant_payment_id, decision, distance_m, gps_accuracy_m, reasons_json, evidence_json, decided_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'system')`,
      args: [newId("mrd"), id, paymentRiskState === "held" ? "hold" : "pass", risk.distanceM, parsed.data.accuracyM ?? null,
        JSON.stringify([paymentRiskReason]), JSON.stringify({ mode: parsed.data.evidenceMode ?? "gps", receiptReference: parsed.data.receiptReference ?? null })],
    },
  ]);
  const payment = immediate ? await finalizeMerchantPayment(id, user.sub) : (await db.execute({ sql: "SELECT * FROM merchant_payments WHERE id = ?", args: [id] })).rows[0];
  return c.json({ payment }, 201);
});

merchantRoutes.get("/merchant-payments/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const id = String(c.req.param("id"));
  const result = await db.execute({
    sql: `SELECT mp.id, mp.order_id, mp.merchant_id, mp.outlet_id, mp.amount, mp.status,
                 mp.confirmation_mode, mp.rider_id, mp.rider_confirmed_at, mp.merchant_confirmed_at,
                 mp.risk_state, mp.environment, mp.created_at, o.name AS outlet_name, m.display_name
          FROM merchant_payments mp
          JOIN merchant_outlets o ON o.id = mp.outlet_id
          JOIN merchants m ON m.id = mp.merchant_id
          WHERE mp.id = ?`,
    args: [id],
  });
  const payment = result.rows[0] as Row | undefined;
  if (!payment) return c.json({ error: "not_found" }, 404);
  const member = await membership(user.sub, String(payment.merchant_id));
  if (!member && payment.rider_id !== user.sub && user.role !== "admin") return c.json({ error: "forbidden" }, 403);
  if (member?.role === "cashier" && String(member.outlet_id ?? "") !== String(payment.outlet_id)) {
    return c.json({ error: "forbidden" }, 403);
  }
  return c.json({ payment });
});

const merchantConfirmationSchema = z.object({ amount: z.number().int().positive() });
merchantRoutes.post("/merchant-payments/:id/merchant-confirm", requireAuth, async (c) => {
  const user = c.get("user");
  const id = String(c.req.param("id"));
  const parsed = merchantConfirmationSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const result = await db.execute({ sql: "SELECT * FROM merchant_payments WHERE id = ?", args: [id] });
  const payment = result.rows[0] as Row | undefined;
  if (!payment) return c.json({ error: "not_found" }, 404);
  const member = await membership(user.sub, String(payment.merchant_id));
  if (!member) return c.json({ error: "forbidden" }, 403);
  if (member.role === "cashier" && String(member.outlet_id ?? "") !== String(payment.outlet_id)) {
    return c.json({ error: "forbidden" }, 403);
  }
  if (Number(payment.amount) !== parsed.data.amount) {
    return c.json({ error: "merchant_amount_mismatch", message: "The confirmed amount does not match the rider's request." }, 409);
  }
  await db.execute({ sql: "UPDATE merchant_payments SET merchant_confirmed_at = datetime('now') WHERE id = ?", args: [id] });
  try {
    return c.json({ payment: await finalizeMerchantPayment(id, user.sub) });
  } catch (error) {
    return c.json({ error: "payment_confirmation_failed", message: error instanceof Error ? error.message : "Unable to confirm" }, 409);
  }
});

const destinationSchema = z.object({
  type: z.enum(["momo", "bank"]),
  provider: z.string().min(2).max(40),
  accountRef: z.string().min(6).max(80),
  accountName: z.string().min(2).max(120).optional(),
  networkOrBank: z.string().min(2).max(80).optional(),
});

merchantRoutes.post("/merchants/:id/settlement-accounts", requireAuth, async (c) => {
  const user = c.get("user");
  const merchantId = String(c.req.param("id"));
  const member = await membership(user.sub, merchantId);
  if (!member || !maySettle(member.role)) return c.json({ error: "forbidden" }, 403);
  const parsed = destinationSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  if (!isCredentialsEncryptionConfigured()) {
    return c.json({ error: "encryption_not_configured", message: "Settlement destinations cannot be stored until encryption is configured." }, 503);
  }
  const id = newId("msa");
  const coolingHours = String(member.environment) === "sandbox" ? 0 : 24;
  const encryptedAccountRef = await encryptSecret(parsed.data.accountRef);
  await db.execute({
    sql: `INSERT INTO merchant_settlement_accounts
          (id, merchant_id, type, provider, account_ref, account_ref_last4, account_name, network_or_bank, cooling_until)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))`,
    args: [id, merchantId, parsed.data.type, parsed.data.provider, encryptedAccountRef, parsed.data.accountRef.slice(-4),
      parsed.data.accountName ?? null, parsed.data.networkOrBank ?? null, `+${coolingHours} hours`],
  });
  return c.json({ settlementAccount: { id, status: "pending_verification", coolingHours } }, 201);
});

merchantRoutes.get("/merchants/:id/settlement-accounts", requireAuth, async (c) => {
  const user = c.get("user");
  const merchantId = String(c.req.param("id"));
  const member = await membership(user.sub, merchantId);
  if (!member || !maySettle(member.role)) return c.json({ error: "forbidden" }, 403);
  const result = await db.execute({
    sql: `SELECT id, type, provider, account_name, network_or_bank, status, is_primary, verified_at, cooling_until,
                 '••••' || account_ref_last4 AS masked_account_ref
          FROM merchant_settlement_accounts WHERE merchant_id = ? ORDER BY is_primary DESC, created_at`,
    args: [merchantId],
  });
  return c.json({ settlementAccounts: result.rows });
});

const quoteSchema = z.object({
  settlementAccountId: z.string(),
  amount: z.number().int().positive(),
  mode: z.enum(["instant", "scheduled"]),
});

merchantRoutes.post("/merchants/:id/settlement-quotes", requireAuth, async (c) => {
  const user = c.get("user");
  const merchantId = String(c.req.param("id"));
  const member = await membership(user.sub, merchantId);
  if (!member || !maySettle(member.role)) return c.json({ error: "forbidden" }, 403);
  if (member.merchant_status !== "active") return c.json({ error: "merchant_not_active" }, 409);
  if (!(await merchantPaymentsEnabled(member.environment as "live" | "sandbox"))) {
    return c.json({ error: "merchant_payments_not_ready" }, 409);
  }
  if (await merchantWithdrawalsFrozen()) {
    return c.json({ error: "merchant_withdrawals_frozen", message: "Merchant withdrawals are temporarily paused for reconciliation." }, 409);
  }
  const parsed = quoteSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const account = await db.execute({
    sql: `SELECT * FROM merchant_settlement_accounts
          WHERE id = ? AND merchant_id = ? AND status = 'verified' AND (cooling_until IS NULL OR cooling_until <= datetime('now'))`,
    args: [parsed.data.settlementAccountId, merchantId],
  });
  if (!account.rows[0]) return c.json({ error: "settlement_account_not_ready" }, 409);
  const policy = await resolveMerchantPolicy(merchantId, String(member.trust_tier));
  if (parsed.data.mode === "scheduled" && policy.scheduledFeeMode === "disabled") return c.json({ error: "scheduled_settlement_disabled" }, 409);
  const feeSetting = await db.execute("SELECT value FROM settings WHERE key = 'merchant_instant_fee_flat'");
  const providerFee = parsed.data.mode === "instant" ? Number((feeSetting.rows[0] as Row | undefined)?.value ?? 0) : 0;
  const fee = parsed.data.mode === "instant" && policy.instantFeeMode === "merchant" ? providerFee
    : parsed.data.mode === "scheduled" && policy.scheduledFeeMode === "merchant" ? providerFee : 0;
  const id = newId("msq");
  const totalDebit = parsed.data.amount + fee;
  await db.execute({
    sql: `INSERT INTO merchant_settlement_quotes
          (id, merchant_id, settlement_account_id, amount, fee, total_debit, mode, expires_at, environment)
          VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+5 minutes'), ?)`,
    args: [id, merchantId, parsed.data.settlementAccountId, parsed.data.amount, fee, totalDebit,
      parsed.data.mode, String(member.environment)],
  });
  return c.json({ quote: { id, amount: parsed.data.amount, fee, totalDebit, currency: "UGX", expiresInSeconds: 300 } }, 201);
});

const settlementSchema = z.object({ quoteId: z.string() });

merchantRoutes.get("/merchants/:id/settlements", requireAuth, async (c) => {
  const user = c.get("user");
  const merchantId = String(c.req.param("id"));
  const member = await membership(user.sub, merchantId);
  if (!member || !maySettle(member.role)) return c.json({ error: "forbidden" }, 403);
  const result = await db.execute({
    sql: `SELECT id, merchant_id, settlement_account_id, amount, fee, total_debit, mode,
                 provider, provider_ref, status, failure_code, environment, created_at, updated_at
          FROM merchant_settlements WHERE merchant_id=? ORDER BY created_at DESC LIMIT 100`,
    args: [merchantId],
  });
  return c.json({ settlements: result.rows });
});

merchantRoutes.post("/merchants/:id/settlements", requireAuth, async (c) => {
  const user = c.get("user");
  const merchantId = String(c.req.param("id"));
  const idempotencyKey = c.req.header("Idempotency-Key")?.trim();
  if (!idempotencyKey) return c.json({ error: "idempotency_key_required" }, 400);
  const member = await membership(user.sub, merchantId);
  if (!member || !maySettle(member.role)) return c.json({ error: "forbidden" }, 403);
  if (member.merchant_status !== "active") return c.json({ error: "merchant_not_active" }, 409);
  if (!(await merchantPaymentsEnabled(member.environment as "live" | "sandbox"))) {
    return c.json({ error: "merchant_payments_not_ready" }, 409);
  }
  if (await merchantWithdrawalsFrozen()) {
    return c.json({ error: "merchant_withdrawals_frozen", message: "Merchant withdrawals are temporarily paused for reconciliation." }, 409);
  }
  const existingSettlement = await db.execute({
    sql: "SELECT * FROM merchant_settlements WHERE merchant_id = ? AND environment = ? AND idempotency_key = ? LIMIT 1",
    args: [merchantId, String(member.environment), idempotencyKey],
  });
  if (existingSettlement.rows[0]) return c.json({ settlement: existingSettlement.rows[0] });
  const parsed = settlementSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const quoteResult = await db.execute({
    sql: `SELECT q.*, a.type, a.provider AS destination_provider, a.account_ref, a.network_or_bank
          FROM merchant_settlement_quotes q
          JOIN merchant_settlement_accounts a ON a.id = q.settlement_account_id
          WHERE q.id = ? AND q.merchant_id = ? AND q.used_at IS NULL AND q.expires_at > datetime('now')`,
    args: [parsed.data.quoteId, merchantId],
  });
  const quote = quoteResult.rows[0] as Row | undefined;
  if (!quote) return c.json({ error: "quote_expired_or_used" }, 409);
  if (quote.type === "bank") {
    return c.json({ error: "bank_settlement_not_configured", message: "No certified live bank payout provider is configured." }, 422);
  }
  const settlementId = newId("mst");
  const environment = member.environment as "live" | "sandbox";
  try {
    await postLedgerTransaction({
      kind: "merchant_settlement_reserved",
      idempotencyKey: `merchant-settlement:${idempotencyKey}:reserve`,
      environment,
      referenceType: "merchant_settlement",
      referenceId: settlementId,
      actorId: user.sub,
      postings: [
        { ownerType: "merchant", ownerId: merchantId, purpose: "payable_available", environment, amount: -Number(quote.total_debit) },
        { ownerType: "merchant", ownerId: merchantId, purpose: "settlement_in_transit", environment, amount: Number(quote.total_debit) },
      ],
      additionalStatements: [
        {
          sql: `UPDATE merchant_balances SET available = available - ?, settling = settling + ?, updated_at = datetime('now')
                WHERE merchant_id = ? AND environment = ?`,
          args: [quote.total_debit, quote.total_debit, merchantId, environment],
        },
        {
          sql: `INSERT INTO merchant_settlements
                (id, merchant_id, settlement_account_id, amount, fee, total_debit, mode, status, idempotency_key, environment)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?)`,
          args: [settlementId, merchantId, quote.settlement_account_id, quote.amount, quote.fee,
            quote.total_debit, quote.mode, idempotencyKey, environment],
        },
        { sql: "UPDATE merchant_settlement_quotes SET used_at = datetime('now') WHERE id = ?", args: [quote.id] },
      ],
    });
  } catch {
    return c.json({ error: "insufficient_available_balance" }, 409);
  }
  let initiated: Awaited<ReturnType<typeof initiateDisbursement>>;
  try {
    const destination = await decryptSecret(String(quote.account_ref));
    initiated = await initiateDisbursement({
      referenceId: settlementId,
      msisdn: destination,
      amount: Number(quote.amount),
      narrative: "Peebee merchant settlement",
      forceMock: environment === "sandbox",
    });
  } catch (error) {
    await postLedgerTransaction({
      kind: "merchant_settlement_reservation_released",
      idempotencyKey: `merchant-settlement:${settlementId}:initiation-failed`,
      environment,
      referenceType: "merchant_settlement",
      referenceId: settlementId,
      postings: [
        { ownerType: "merchant", ownerId: merchantId, purpose: "settlement_in_transit", environment, amount: -Number(quote.total_debit) },
        { ownerType: "merchant", ownerId: merchantId, purpose: "payable_available", environment, amount: Number(quote.total_debit) },
      ],
      additionalStatements: [
        {
          sql: `UPDATE merchant_balances SET settling = settling - ?, available = available + ?, updated_at = datetime('now')
                WHERE merchant_id = ? AND environment = ?`,
          args: [quote.total_debit, quote.total_debit, merchantId, environment],
        },
        { sql: "UPDATE merchant_settlements SET status = 'failed', failure_code = 'initiation_failed', updated_at = datetime('now') WHERE id = ?", args: [settlementId] },
      ],
    });
    return c.json(paymentProviderErrorResponse(error, "Settlement could not be started."), paymentProviderHttpStatus(error));
  }

  try {
    await executeBatch([
      {
        sql: "UPDATE merchant_settlements SET provider = ?, provider_ref = ?, status = 'submitted', updated_at = datetime('now') WHERE id = ?",
        args: [initiated.provider, initiated.providerRef, settlementId],
      },
      {
        sql: `INSERT INTO provider_operations
              (id, operation_type, business_type, business_id, provider, provider_ref,
               idempotency_key, amount, environment, status, next_check_at)
              VALUES (?, 'disbursement', 'merchant_settlement', ?, ?, ?, ?, ?, ?, 'submitted', datetime('now', '+2 minutes'))`,
        args: [newId("pop"), settlementId, initiated.provider, initiated.providerRef,
          `merchant-settlement:${settlementId}:disbursement`, Number(quote.amount), environment],
      },
    ]);
  } catch (error) {
    // The provider accepted the request. Never restore the balance here:
    // doing so could let the merchant withdraw twice while the first payout
    // is still moving. Keep the reservation quarantined for reconciliation.
    console.error("Settlement accepted by provider but persistence failed", settlementId, initiated, error);
    await db.execute({
      sql: "UPDATE merchant_settlements SET provider = ?, provider_ref = ?, status = 'unknown', failure_code = 'persistence_uncertain', updated_at = datetime('now') WHERE id = ?",
      args: [initiated.provider, initiated.providerRef, settlementId],
    }).catch(() => undefined);
    await db.execute({
      sql: `INSERT OR IGNORE INTO provider_operations
            (id, operation_type, business_type, business_id, provider, provider_ref,
             idempotency_key, amount, environment, status, next_check_at)
            VALUES (?, 'disbursement', 'merchant_settlement', ?, ?, ?, ?, ?, ?, 'unknown', datetime('now', '+2 minutes'))`,
      args: [newId("pop"), settlementId, initiated.provider, initiated.providerRef,
        `merchant-settlement:${settlementId}:disbursement`, Number(quote.amount), environment],
    }).catch(() => undefined);
    return c.json({ error: "settlement_status_uncertain", message: "The payout was submitted and is being reconciled. Do not retry it." }, 502);
  }
  return c.json({ settlement: { id: settlementId, status: "submitted", amount: quote.amount, fee: quote.fee } }, 201);
});

merchantRoutes.post("/merchants/:merchantId/settlements/:id/refresh", requireAuth, async (c) => {
  const user = c.get("user");
  const merchantId = String(c.req.param("merchantId"));
  const member = await membership(user.sub, merchantId);
  if (!member || !maySettle(member.role)) return c.json({ error: "forbidden" }, 403);
  const result = await db.execute({
    sql: "SELECT * FROM merchant_settlements WHERE id = ? AND merchant_id = ?",
    args: [String(c.req.param("id")), merchantId],
  });
  const settlement = result.rows[0] as Row | undefined;
  if (!settlement) return c.json({ error: "not_found" }, 404);
  if (!["reserved", "submitted", "pending", "unknown"].includes(String(settlement.status))) return c.json({ settlement });
  await reconcileMerchantSettlement(String(settlement.id));
  const updated = await db.execute({ sql: "SELECT * FROM merchant_settlements WHERE id = ?", args: [String(settlement.id)] });
  return c.json({ settlement: updated.rows[0] });
});

// Admin operations ---------------------------------------------------------

const activationSchema = z.object({ enabled: z.boolean() });
merchantRoutes.post("/admin/merchant-payments/activation", requireAuth, requireRole("admin"), requirePermission("merchant_finance.manage"), async (c) => {
  const admin = c.get("user");
  const parsed = activationSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const environment = await getPlatformEnvironment();
  if (parsed.data.enabled && environment === "live") {
    const approval = await db.execute({
      sql: `SELECT id FROM merchant_custody_approvals
            WHERE environment='live' AND currency='UGX' AND status='active'
              AND effective_at <= datetime('now')
              AND (expires_at IS NULL OR expires_at > datetime('now')) LIMIT 1`,
      args: [],
    });
    if (!approval.rows[0]) {
      return c.json({
        error: "merchant_custody_approval_required",
        message: "Record an active regulated custody and safeguarding approval before enabling live merchant payments.",
      }, 409);
    }
  }
  const settingKey = environment === "sandbox" ? "merchant_sandbox_enabled" : "merchant_payments_enabled";
  await db.execute({
    sql: `INSERT INTO settings (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    args: [settingKey, parsed.data.enabled ? "1" : "0"],
  });
  await logActivity({
    actor: { sub: admin.sub, name: admin.name, adminRole: isAdminRole(admin.adminRole) ? admin.adminRole : null },
    action: "merchant.activation", entityType: "merchant_payments", entityId: environment,
    summary: `${parsed.data.enabled ? "Enabled" : "Disabled"} ${environment} merchant payments`,
    after: { enabled: parsed.data.enabled, environment }, ip: clientIp(c),
  });
  return c.json({ enabled: parsed.data.enabled, environment });
});

merchantRoutes.get("/admin/merchants", requireAuth, requireRole("admin"), requirePermission("merchants.view"), async (c) => {
  const result = await db.execute({
    sql: `SELECT m.*, k.status AS kyc_status,
                 CASE WHEN k.owner_id_key IS NULL THEN 0 ELSE 1 END AS has_owner_id_document,
                 CASE WHEN k.business_document_key IS NULL THEN 0 ELSE 1 END AS has_business_document,
                 (SELECT COUNT(*) FROM merchant_outlets o WHERE o.merchant_id = m.id) AS outlet_count,
                 b.held, b.available, b.settling
          FROM merchants m
          LEFT JOIN merchant_kyc_cases k ON k.merchant_id = m.id
          LEFT JOIN merchant_balances b ON b.merchant_id = m.id AND b.environment = m.environment
          WHERE NOT EXISTS (SELECT 1 FROM restaurants r WHERE r.merchant_id = m.id)
           ORDER BY m.created_at DESC`,
    args: [],
  });
  return c.json({ merchants: result.rows });
});

const adminMerchantRangeSchema = z.enum(["day", "week", "month", "year"]);
const ADMIN_MERCHANT_RANGE_MODIFIER = {
  day: "-1 day",
  week: "-7 days",
  month: "-1 month",
  year: "-1 year",
} as const;

merchantRoutes.get("/admin/merchants/:id", requireAuth, requireRole("admin"), requirePermission("merchants.view"), async (c) => {
  const merchantId = String(c.req.param("id"));
  const parsedRange = adminMerchantRangeSchema.safeParse(c.req.query("range") ?? "month");
  if (!parsedRange.success) return c.json({ error: "invalid_range" }, 400);
  const range = parsedRange.data;
  const rangeModifier = ADMIN_MERCHANT_RANGE_MODIFIER[range];

  const merchantResult = await db.execute({
    sql: `SELECT m.*, k.status AS kyc_status,
                 COALESCE(k.phone_verified, 0) AS phone_verified,
                 COALESCE(k.identity_verified, 0) AS identity_verified,
                 COALESCE(k.business_verified, 0) AS business_verified,
                 k.risk_notes, k.reviewed_at,
                 CASE WHEN k.owner_id_key IS NULL THEN 0 ELSE 1 END AS has_owner_id_document,
                 CASE WHEN k.business_document_key IS NULL THEN 0 ELSE 1 END AS has_business_document,
                 (SELECT COUNT(*) FROM merchant_outlets o WHERE o.merchant_id = m.id) AS outlet_count,
                 b.held, b.available, b.settling,
                 approver.name AS approved_by_name, reviewer.name AS reviewed_by_name
          FROM merchants m
          LEFT JOIN merchant_kyc_cases k ON k.merchant_id = m.id
          LEFT JOIN merchant_balances b ON b.merchant_id = m.id AND b.environment = m.environment
          LEFT JOIN users approver ON approver.id = m.approved_by
          LEFT JOIN users reviewer ON reviewer.id = k.reviewed_by
          WHERE m.id = ?
            AND NOT EXISTS (SELECT 1 FROM restaurants r WHERE r.merchant_id = m.id)`,
    args: [merchantId],
  });
  const merchant = merchantResult.rows[0] as Row | undefined;
  if (!merchant) return c.json({ error: "not_found" }, 404);

  const [outletResult, memberResult, settlementAccountResult] = await Promise.all([
    db.execute({
      sql: `SELECT o.*, c.name AS category_name, c.slug AS category_slug
            FROM merchant_outlets o
            JOIN merchant_categories c ON c.id = o.category_id
            WHERE o.merchant_id = ? ORDER BY o.created_at`,
      args: [merchantId],
    }),
    db.execute({
      sql: `SELECT mm.user_id, mm.role, mm.status, mm.outlet_id, mm.created_at,
                   u.name, u.email, u.phone
            FROM merchant_members mm JOIN users u ON u.id = mm.user_id
            WHERE mm.merchant_id = ?
            ORDER BY CASE mm.role WHEN 'owner' THEN 0 WHEN 'finance' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END,
                     mm.created_at`,
      args: [merchantId],
    }),
    db.execute({
      sql: `SELECT a.id, a.merchant_id, m.display_name, a.type, a.provider, a.account_name,
                   a.network_or_bank, a.status, a.is_primary, a.verified_at, a.cooling_until,
                   '••••' || a.account_ref_last4 AS masked_account_ref, a.created_at
            FROM merchant_settlement_accounts a
            JOIN merchants m ON m.id = a.merchant_id
            WHERE a.merchant_id = ? ORDER BY a.created_at DESC`,
      args: [merchantId],
    }),
  ]);

  let payments: Row[] = [];
  let transactions: Row[] = [];
  let settlements: Row[] = [];
  if (merchant.status === "active") {
    const [paymentResult, transactionResult, settlementResult] = await Promise.all([
      db.execute({
        sql: `SELECT mp.id, mp.order_id, mp.outlet_id, o.name AS outlet_name, mp.amount, mp.status,
                     mp.confirmation_mode, mp.risk_state, mp.receipt_reference, mp.rider_id,
                     u.name AS rider_name, mp.created_at, mp.updated_at
              FROM merchant_payments mp
              JOIN merchant_outlets o ON o.id = mp.outlet_id
              JOIN users u ON u.id = mp.rider_id
              WHERE mp.merchant_id = ? AND mp.created_at >= datetime('now', ?)
              ORDER BY mp.created_at DESC LIMIT 500`,
        args: [merchantId, rangeModifier],
      }),
      db.execute({
        sql: `SELECT t.id, t.kind, t.reference_type, t.reference_id, t.description, t.created_at,
                     e.amount, a.purpose, a.currency, a.environment
              FROM ledger_accounts a
              JOIN ledger_entries e ON e.account_id = a.id
              JOIN ledger_transactions t ON t.id = e.transaction_id
              WHERE a.owner_type = 'merchant' AND a.owner_id = ?
                AND t.created_at >= datetime('now', ?)
              ORDER BY t.created_at DESC LIMIT 500`,
        args: [merchantId, rangeModifier],
      }),
      db.execute({
        sql: `SELECT s.id, s.amount, s.fee, s.total_debit, s.mode, s.status, s.provider,
                     s.provider_ref, s.failure_code, s.created_at, s.updated_at,
                     a.account_name, a.network_or_bank,
                     '••••' || a.account_ref_last4 AS masked_account_ref
              FROM merchant_settlements s
              JOIN merchant_settlement_accounts a ON a.id = s.settlement_account_id
              WHERE s.merchant_id = ? AND s.created_at >= datetime('now', ?)
              ORDER BY s.created_at DESC LIMIT 500`,
        args: [merchantId, rangeModifier],
      }),
    ]);
    payments = paymentResult.rows as Row[];
    transactions = transactionResult.rows as Row[];
    settlements = settlementResult.rows as Row[];
  }

  return c.json({
    merchant,
    outlets: outletResult.rows,
    members: memberResult.rows,
    settlementAccounts: settlementAccountResult.rows,
    payments,
    transactions,
    settlements,
    range,
  });
});

merchantRoutes.get("/admin/merchants/:id/kyc-documents/:type", requireAuth, requireRole("admin"), requirePermission("merchants.view"), async (c) => {
  const merchantId = String(c.req.param("id"));
  const type = String(c.req.param("type"));
  if (!(KYC_DOCUMENT_TYPES as readonly string[]).includes(type)) return c.json({ error: "invalid_document_type" }, 400);
  const column = type === "owner-id" ? "owner_id_key" : "business_document_key";
  const result = await db.execute({ sql: `SELECT ${column} AS object_key FROM merchant_kyc_cases WHERE merchant_id=?`, args: [merchantId] });
  const key = (result.rows[0] as Row | undefined)?.object_key;
  if (!key) return c.json({ error: "not_found" }, 404);
  const object = await getR2Bucket().get(String(key));
  if (!object) return c.json({ error: "not_found" }, 404);
  return new Response(object.body, { headers: uploadResponseHeaders(object.httpMetadata?.contentType, "application/octet-stream") });
});

merchantRoutes.get("/admin/merchant-settlement-accounts", requireAuth, requireRole("admin"), requirePermission("merchant_finance.manage"), async (c) => {
  const status = c.req.query("status");
  if (status && !["pending_verification", "verified", "disabled"].includes(status)) {
    return c.json({ error: "invalid_status" }, 400);
  }
  const result = await db.execute({
    sql: `SELECT a.id, a.merchant_id, m.display_name, a.type, a.provider, a.account_name,
                 a.network_or_bank, a.status, a.is_primary, a.verified_at, a.cooling_until,
                 '••••' || a.account_ref_last4 AS masked_account_ref, a.created_at
          FROM merchant_settlement_accounts a
          JOIN merchants m ON m.id = a.merchant_id
          WHERE (? IS NULL OR a.status = ?)
          ORDER BY CASE a.status WHEN 'pending_verification' THEN 0 ELSE 1 END, a.created_at DESC
          LIMIT 200`,
    args: [status ?? null, status ?? null],
  });
  return c.json({ settlementAccounts: result.rows });
});

const merchantStatusSchema = z.object({ status: z.enum(["pending_approval", "provisional", "active", "suspended", "rejected"]) });
merchantRoutes.post("/admin/merchants/:id/status", requireAuth, requireRole("admin"), requirePermission("merchants.manage"), async (c) => {
  const admin = c.get("user");
  const id = String(c.req.param("id"));
  const parsed = merchantStatusSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const before = await db.execute({ sql: "SELECT * FROM merchants WHERE id = ?", args: [id] });
  const merchant = before.rows[0] as Row | undefined;
  if (!merchant) return c.json({ error: "not_found" }, 404);
  if (parsed.data.status === "active") {
    const kyc = await db.execute({
      sql: `SELECT 1 FROM merchant_kyc_cases k JOIN merchants m ON m.id=k.merchant_id
            WHERE k.merchant_id=? AND m.registration_number IS NOT NULL AND m.tax_id IS NOT NULL
              AND k.owner_id_key IS NOT NULL AND k.business_document_key IS NOT NULL`,
      args: [id],
    });
    if (!kyc.rows[0]) {
      return c.json({ error: "merchant_kyc_incomplete", message: "Registration, tax ID, owner ID and business registration document are required before activation." }, 409);
    }
  }
  await executeBatch([
    {
      sql: `UPDATE merchants SET status = ?, approved_at = CASE WHEN ? = 'active' THEN datetime('now') ELSE approved_at END,
            approved_by = CASE WHEN ? = 'active' THEN ? ELSE approved_by END, updated_at = datetime('now') WHERE id = ?`,
      args: [parsed.data.status, parsed.data.status, parsed.data.status, admin.sub, id],
    },
    {
      sql: `UPDATE merchant_kyc_cases SET status = CASE WHEN ? = 'active' THEN 'approved' ELSE status END,
            reviewed_by = ?, reviewed_at = datetime('now'), updated_at = datetime('now') WHERE merchant_id = ?`,
      args: [parsed.data.status, admin.sub, id],
    },
  ]);
  await logActivity({
    actor: { sub: admin.sub, name: admin.name, adminRole: isAdminRole(admin.adminRole) ? admin.adminRole : null },
    action: "merchant.status", entityType: "merchant", entityId: id,
    summary: `${merchant.display_name} — status changed from ${merchant.status} to ${parsed.data.status}`,
    before: { status: merchant.status }, after: { status: parsed.data.status }, ip: clientIp(c),
  });
  const updated = await db.execute({ sql: "SELECT * FROM merchants WHERE id = ?", args: [id] });
  return c.json({ merchant: updated.rows[0] });
});

const settlementAccountStatusSchema = z.object({ status: z.enum(["verified", "disabled"]) });
merchantRoutes.post("/admin/merchant-settlement-accounts/:id/status", requireAuth, requireRole("admin"), requirePermission("merchant_finance.manage"), async (c) => {
  const admin = c.get("user");
  const id = String(c.req.param("id"));
  const parsed = settlementAccountStatusSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const before = await db.execute({ sql: "SELECT * FROM merchant_settlement_accounts WHERE id = ?", args: [id] });
  const account = before.rows[0] as Row | undefined;
  if (!account) return c.json({ error: "not_found" }, 404);
  await db.execute({
    sql: `UPDATE merchant_settlement_accounts
          SET status = ?, verified_at = CASE WHEN ? = 'verified' THEN datetime('now') ELSE verified_at END,
              updated_at = datetime('now') WHERE id = ?`,
    args: [parsed.data.status, parsed.data.status, id],
  });
  await logActivity({
    actor: { sub: admin.sub, name: admin.name, adminRole: isAdminRole(admin.adminRole) ? admin.adminRole : null },
    action: "merchant.settlement_account_status", entityType: "merchant_settlement_account", entityId: id,
    summary: `Settlement destination marked ${parsed.data.status}`,
    before: { status: account.status }, after: { status: parsed.data.status }, ip: clientIp(c),
  });
  return c.json({ settlementAccount: { id, status: parsed.data.status } });
});

merchantRoutes.get("/admin/merchant-policies", requireAuth, requireRole("admin"), requirePermission("merchants.view"), async (c) => {
  const result = await db.execute("SELECT * FROM merchant_policies ORDER BY scope_type, scope_id");
  return c.json({ policies: result.rows });
});

const policySchema = z.object({
  scopeType: z.enum(["global", "tier", "merchant"]), scopeId: z.string().min(1),
  settlementReleaseMode: z.enum(["risk_based_immediate", "manual_hold"]),
  unconfirmedReleaseHours: z.number().int().positive().nullable(),
  paymentConfirmationMode: z.literal("dual_confirm"),
  kycGate: z.enum(["approved_before_receiving", "provisional_limits", "before_withdrawal"]),
  orderBudgetMode: z.enum(["prefunded_cap", "approve_each_purchase", "rider_exception"]),
  unusedFundsMode: z.enum(["wallet", "original_source", "customer_choice"]),
  riderUnlockMode: z.enum(["verified_handover", "rider_marked", "dispute_window"]),
  instantFeeMode: z.enum(["merchant", "platform"]),
  scheduledFeeMode: z.enum(["merchant", "platform", "disabled"]),
  scheduledCadence: z.enum(["next_business_day", "weekly", "manual"]),
  merchantCommissionType: z.enum(["none", "percent", "subscription"]),
  merchantCommissionValue: z.number().min(0), rolloutMode: z.enum(["cohort", "category", "open"]),
  maxOutlets: z.number().int().positive().nullable(), enabled: z.boolean().default(true),
});

merchantRoutes.put("/admin/merchant-policies", requireAuth, requireRole("admin"), requirePermission("merchants.manage"), async (c) => {
  const admin = c.get("user");
  const parsed = policySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const d = parsed.data;
  const id = `mpol_${d.scopeType}_${d.scopeId}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  await db.execute({
    sql: `INSERT INTO merchant_policies
          (id, scope_type, scope_id, settlement_release_mode, unconfirmed_release_hours, payment_confirmation_mode,
           kyc_gate, order_budget_mode, unused_funds_mode, rider_unlock_mode, instant_fee_mode, scheduled_fee_mode,
           scheduled_cadence, merchant_commission_type, merchant_commission_value, rollout_mode, max_outlets, enabled, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(scope_type, scope_id) DO UPDATE SET
            settlement_release_mode=excluded.settlement_release_mode, unconfirmed_release_hours=excluded.unconfirmed_release_hours,
            payment_confirmation_mode=excluded.payment_confirmation_mode, kyc_gate=excluded.kyc_gate,
            order_budget_mode=excluded.order_budget_mode, unused_funds_mode=excluded.unused_funds_mode,
            rider_unlock_mode=excluded.rider_unlock_mode, instant_fee_mode=excluded.instant_fee_mode,
            scheduled_fee_mode=excluded.scheduled_fee_mode, scheduled_cadence=excluded.scheduled_cadence,
            merchant_commission_type=excluded.merchant_commission_type, merchant_commission_value=excluded.merchant_commission_value,
            rollout_mode=excluded.rollout_mode, max_outlets=excluded.max_outlets, enabled=excluded.enabled,
            version=merchant_policies.version+1, updated_by=excluded.updated_by, updated_at=datetime('now')`,
    args: [id, d.scopeType, d.scopeId, d.settlementReleaseMode, d.unconfirmedReleaseHours, d.paymentConfirmationMode,
      d.kycGate, d.orderBudgetMode, d.unusedFundsMode, d.riderUnlockMode, d.instantFeeMode, d.scheduledFeeMode,
      d.scheduledCadence, d.merchantCommissionType, d.merchantCommissionValue, d.rolloutMode, d.maxOutlets,
      d.enabled ? 1 : 0, admin.sub],
  });
  await logActivity({
    actor: { sub: admin.sub, name: admin.name, adminRole: isAdminRole(admin.adminRole) ? admin.adminRole : null },
    action: "merchant.policy", entityType: "merchant_policy", entityId: id,
    summary: `Updated merchant policy ${d.scopeType}:${d.scopeId}`, after: d, ip: clientIp(c),
  });
  const result = await db.execute({ sql: "SELECT * FROM merchant_policies WHERE id = ?", args: [id] });
  return c.json({ policy: result.rows[0] });
});

const custodyApprovalSchema = z.object({
  custodyProvider: z.string().min(2).max(80),
  payoutProvider: z.string().min(2).max(80),
  safeguardingReference: z.string().min(4).max(240),
  effectiveAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable().optional(),
});

merchantRoutes.get("/admin/merchant-custody", requireAuth, requireRole("admin"), requirePermission("merchant_finance.manage"), async (c) => {
  const result = await db.execute("SELECT * FROM merchant_custody_approvals ORDER BY created_at DESC");
  return c.json({ approvals: result.rows });
});

merchantRoutes.post("/admin/merchant-custody", requireAuth, requireRole("admin"), requirePermission("merchant_finance.manage"), async (c) => {
  const admin = c.get("user");
  const parsed = custodyApprovalSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const id = newId("mca");
  await executeBatch([
    { sql: "UPDATE merchant_custody_approvals SET status = 'revoked' WHERE environment = 'live' AND status = 'active'" },
    {
      sql: `INSERT INTO merchant_custody_approvals
            (id, custody_provider, payout_provider, environment, safeguarding_reference,
             approved_by, effective_at, expires_at)
            VALUES (?, ?, ?, 'live', ?, ?, ?, ?)`,
      args: [id, parsed.data.custodyProvider, parsed.data.payoutProvider, parsed.data.safeguardingReference,
        admin.sub, parsed.data.effectiveAt, parsed.data.expiresAt ?? null],
    },
    {
      sql: `INSERT INTO settings (key, value) VALUES ('merchant_live_custody_approved', '1')
            ON CONFLICT(key) DO UPDATE SET value = '1'`,
    },
  ]);
  await logActivity({
    actor: { sub: admin.sub, name: admin.name, adminRole: isAdminRole(admin.adminRole) ? admin.adminRole : null },
    action: "merchant.custody_approved", entityType: "merchant_custody", entityId: id,
    summary: `Approved ${parsed.data.custodyProvider} custody with ${parsed.data.payoutProvider} payouts`,
    after: { ...parsed.data, safeguardingReference: "recorded" }, ip: clientIp(c),
  });
  return c.json({ approval: { id, status: "active" } }, 201);
});

merchantRoutes.post("/admin/merchant-custody/:id/revoke", requireAuth, requireRole("admin"), requirePermission("merchant_finance.manage"), async (c) => {
  const admin = c.get("user");
  const id = String(c.req.param("id"));
  await executeBatch([
    { sql: "UPDATE merchant_custody_approvals SET status = 'revoked' WHERE id = ?", args: [id] },
    { sql: "UPDATE settings SET value = '0' WHERE key = 'merchant_live_custody_approved'" },
    { sql: "UPDATE settings SET value = '0' WHERE key = 'merchant_payments_enabled'" },
  ]);
  await logActivity({
    actor: { sub: admin.sub, name: admin.name, adminRole: isAdminRole(admin.adminRole) ? admin.adminRole : null },
    action: "merchant.custody_revoked", entityType: "merchant_custody", entityId: id,
    summary: "Revoked merchant custody approval", ip: clientIp(c),
  });
  return c.json({ ok: true });
});

merchantRoutes.post("/admin/merchant-payments/:id/release", requireAuth, requireRole("admin"), requirePermission("merchant_finance.manage"), async (c) => {
  const admin = c.get("user");
  const result = await db.execute({ sql: "SELECT * FROM merchant_payments WHERE id = ?", args: [String(c.req.param("id"))] });
  const payment = result.rows[0] as Row | undefined;
  if (!payment) return c.json({ error: "not_found" }, 404);
  if (payment.status !== "held") return c.json({ error: "payment_not_held" }, 409);
  const amount = Number(payment.amount);
  const environment = payment.environment as "live" | "sandbox";
  await postLedgerTransaction({
    kind: "merchant_risk_hold_released",
    idempotencyKey: `merchant-payment:${String(payment.id)}:risk-release`,
    environment,
    referenceType: "merchant_payment",
    referenceId: String(payment.id),
    actorId: admin.sub,
    postings: [
      { ownerType: "merchant", ownerId: String(payment.merchant_id), purpose: "payable_held", environment, amount: -amount },
      { ownerType: "merchant", ownerId: String(payment.merchant_id), purpose: "payable_available", environment, amount },
    ],
    additionalStatements: [
      {
        sql: `UPDATE merchant_balances SET held = held - ?, available = available + ?, updated_at = datetime('now')
              WHERE merchant_id = ? AND environment = ?`,
        args: [amount, amount, payment.merchant_id, environment],
      },
      { sql: "UPDATE merchant_payments SET status = 'available', risk_state = 'passed', available_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = 'held'", args: [payment.id] },
      { sql: `INSERT INTO merchant_risk_decisions (id, merchant_payment_id, decision, reasons_json, decided_by)
              VALUES (?, ?, 'release', '[\"manual_review\"]', ?)`, args: [newId("mrd"), payment.id, admin.sub] },
    ],
  });
  return c.json({ payment: { id: payment.id, status: "available" } });
});

merchantRoutes.get("/admin/merchant-reconciliation", requireAuth, requireRole("admin"), requirePermission("merchant_finance.manage"), async (c) => {
  const result = await db.execute({
    sql: `SELECT b.merchant_id, m.display_name, b.environment,
                 b.held, b.available, b.settling,
                 COALESCE(SUM(CASE a.purpose WHEN 'payable_held' THEN e.amount ELSE 0 END), 0) AS ledger_held,
                 COALESCE(SUM(CASE a.purpose WHEN 'payable_available' THEN e.amount ELSE 0 END), 0) AS ledger_available,
                 COALESCE(SUM(CASE a.purpose WHEN 'settlement_in_transit' THEN e.amount ELSE 0 END), 0) AS ledger_settling
          FROM merchant_balances b JOIN merchants m ON m.id = b.merchant_id
          LEFT JOIN ledger_accounts a ON a.owner_type='merchant' AND a.owner_id=b.merchant_id AND a.environment=b.environment
          LEFT JOIN ledger_entries e ON e.account_id=a.id
          GROUP BY b.merchant_id, m.display_name, b.environment, b.held, b.available, b.settling`,
    args: [],
  });
  const rows = result.rows.map((raw) => {
    const row = raw as Row;
    return { ...row, reconciled: Number(row.held) === Number(row.ledger_held)
      && Number(row.available) === Number(row.ledger_available) && Number(row.settling) === Number(row.ledger_settling) };
  });
  const operations = await db.execute({
    sql: `SELECT id, operation_type, business_type, business_id, provider, provider_ref, amount, currency,
                 environment, status, attempt_count, last_checked_at, next_check_at, failure_code, created_at
          FROM provider_operations
          WHERE status IN ('submitted', 'pending', 'unknown')
          ORDER BY created_at LIMIT 200`,
    args: [],
  });
  return c.json({
    merchants: rows,
    reconciled: rows.every((row) => row.reconciled),
    withdrawalsFrozen: await merchantWithdrawalsFrozen(),
    providerOperations: operations.rows,
  });
});

const reconciliationFreezeSchema = z.object({ frozen: z.boolean() });
merchantRoutes.post("/admin/merchant-reconciliation/freeze", requireAuth, requireRole("admin"), requirePermission("merchant_finance.manage"), async (c) => {
  const admin = c.get("user");
  const parsed = reconciliationFreezeSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  if (!parsed.data.frozen) {
    const mismatch = await db.execute({
      sql: `SELECT 1 FROM merchant_balances b
            WHERE b.held != COALESCE((SELECT SUM(e.amount) FROM ledger_accounts a JOIN ledger_entries e ON e.account_id=a.id
                                      WHERE a.owner_type='merchant' AND a.owner_id=b.merchant_id AND a.environment=b.environment AND a.purpose='payable_held'), 0)
               OR b.available != COALESCE((SELECT SUM(e.amount) FROM ledger_accounts a JOIN ledger_entries e ON e.account_id=a.id
                                           WHERE a.owner_type='merchant' AND a.owner_id=b.merchant_id AND a.environment=b.environment AND a.purpose='payable_available'), 0)
               OR b.settling != COALESCE((SELECT SUM(e.amount) FROM ledger_accounts a JOIN ledger_entries e ON e.account_id=a.id
                                          WHERE a.owner_type='merchant' AND a.owner_id=b.merchant_id AND a.environment=b.environment AND a.purpose='settlement_in_transit'), 0)
            LIMIT 1`,
      args: [],
    });
    if (mismatch.rows.length > 0) return c.json({ error: "reconciliation_mismatch" }, 409);
  }
  await db.execute({
    sql: "UPDATE settings SET value = ? WHERE key = 'merchant_withdrawals_frozen'",
    args: [parsed.data.frozen ? "1" : "0"],
  });
  await logActivity({
    actor: { sub: admin.sub, name: admin.name, adminRole: isAdminRole(admin.adminRole) ? admin.adminRole : null },
    action: "merchant.withdrawal_freeze", entityType: "merchant_finance", entityId: "global",
    summary: `${parsed.data.frozen ? "Froze" : "Resumed"} merchant withdrawals`,
    after: { frozen: parsed.data.frozen }, ip: clientIp(c),
  });
  return c.json({ frozen: parsed.data.frozen });
});
