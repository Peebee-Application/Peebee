import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { requirePermission } from "./permissions.js";
import { logActivity } from "./activity.js";
import { listRefundReviews, refundReviewEvidence, refundReviewReady } from "../marketplace/refund-review.js";

export const refundReviewRoutes = new Hono();
refundReviewRoutes.use("/admin/refund-reconciliation/*", requireAuth, requireRole("admin"), requirePermission("merchant_finance.manage"));
refundReviewRoutes.use("/admin/refund-reconciliation", requireAuth, requireRole("admin"), requirePermission("merchant_finance.manage"));
const unavailable = {error: "unavailable", message: "Digital refund reconciliation needs the existing digital-sales and ledger migrations."};

refundReviewRoutes.get("/admin/refund-reconciliation", async c => {
  if (!await refundReviewReady()) return c.json(unavailable, 503);
  const query = z.object({after: z.string().max(200).optional(), storeId: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).default(25)}).safeParse(c.req.query());
  if (!query.success) return c.json({error: "invalid_query"}, 400);
  c.header("Cache-Control", "private, no-store");
  return c.json(await listRefundReviews(query.data));
});

refundReviewRoutes.get("/admin/refund-reconciliation/:id", async c => {
  if (!await refundReviewReady()) return c.json(unavailable, 503);
  const evidence = await refundReviewEvidence(c.req.param("id"));
  c.header("Cache-Control", "private, no-store");
  return evidence ? c.json(evidence) : c.json({error: "not_found"}, 404);
});

// Record a human decision against the exact evidence reviewed. This endpoint never moves money
// or clears a refunded marker; unlinked historical credits must not be silently paid a second time.
refundReviewRoutes.post("/admin/refund-reconciliation/:id/reviews", async c => {
  if (!await refundReviewReady()) return c.json(unavailable, 503);
  const body = z.object({fingerprint: z.string().regex(/^[a-f0-9]{64}$/), decision: z.enum(["investigate", "correction_required", "externally_reconciled"]), note: z.string().trim().min(10).max(2000), reference: z.string().trim().max(300).optional()}).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({error: "invalid_body", message: "Provide the evidence fingerprint and a review note of at least 10 characters."}, 400);
  if (body.data.decision === "externally_reconciled" && !body.data.reference) return c.json({error: "reference_required", message: "Provide the reconciled transaction or support-case reference."}, 400);
  const evidence = await refundReviewEvidence(c.req.param("id"));
  if (!evidence) return c.json({error: "not_found"}, 404);
  if (evidence.fingerprint !== body.data.fingerprint) return c.json({error: "evidence_changed", message: "The financial evidence changed. Reload and review it again."}, 409);
  await logActivity({actor: c.get("user"), action: `digital_refund.review.${body.data.decision}`, entityType: "digital_refund_review", entityId: String(c.req.param("id")), summary: body.data.note, after: body.data});
  return c.json({ok: true, moneyMovement: false});
});
