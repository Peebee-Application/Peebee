import { Hono } from "hono";
import { z } from "zod";
import { creatorDb as db } from "./creator-db.js";
import {
  executeBatch,
  requireChangedRow,
  type DbStatement,
} from "../db/client.js";
import {
  postLedgerTransaction,
  type LedgerPosting,
} from "../ledger/service.js";
import { getOptions } from "../lib/option-settings.js";
import {
  getPlatformEnvironment,
  getMarketplaceSettings,
  type PlatformEnvironment,
} from "../lib/settings.js";
import { newId } from "../lib/ids.js";
import { one, body as readBody, ownedCourse } from "./studio.js";
import { getLearnSettings } from "./settings.js";
import { storePlan } from "../marketplace/plans.js";
import {
  creatorOptions,
  CreatorError,
  authorizeDraft,
} from "./creator-service.js";
import { learningEnrollmentStatements } from "./creator-enrollment.js";
import { publicationFor } from "./creator-study.js";

type PurchaseInput = {
  buyerId: string;
  courseId: string;
  publicationId: string;
  price: number;
  requestId: string;
  cohortId?: string;
};
export async function purchaseLearningCourse(input: PurchaseInput) {
  const environment = await getPlatformEnvironment();
  const old = await one(
    "SELECT * FROM edu_creator_purchases WHERE buyer_id=? AND course_id=? AND environment=? AND status='settled'",
    [input.buyerId, input.courseId, environment],
  );
  if (old)
    return {
      purchaseId: String(old.id),
      enrollmentId: String(old.enrollment_id),
      fulfillmentId: old.fulfillment_id ? String(old.fulfillment_id) : null,
      token: "",
      pricePaidUgx: Number(old.price_ugx),
    };
  const p = await publicationFor(input.buyerId, input.courseId, false);
  if (p.owner)
    throw new CreatorError(400, "You already own this course as its creator.");
  const seat = await one(
    "SELECT id FROM edu_enrollments WHERE user_id=? AND course_id=? AND status='active' AND environment=?",
    [input.buyerId, input.courseId, environment],
  );
  if (seat)
    return {
      purchaseId: "",
      enrollmentId: String(seat.id),
      fulfillmentId: null,
      token: "",
      pricePaidUgx: 0,
    };
  if (
    String(p.publication.id) !== input.publicationId ||
    p.draft.priceUgx !== input.price
  )
    throw new CreatorError(
      409,
      "The offer changed. Reload and review the current version and price before paying.",
    );
  const o = await creatorOptions(),
    ls = await getLearnSettings();
  if (
    !ls.enrolmentsEnabled ||
    !ls.paidCoursesEnabled ||
    !o.learn_creator_selling_enabled
  )
    throw new CreatorError(403, "Course purchases are paused.");
  const course = await one(
    "SELECT c.*,s.owner_id FROM edu_courses c JOIN edu_schools s ON s.id=c.school_id WHERE c.id=?",
    [input.courseId],
  );
  const draft = await one(
    "SELECT context,store_id FROM edu_course_drafts WHERE course_id=?",
    [input.courseId],
  );
  if (!course || !draft)
    throw new CreatorError(404, "That course wasn't found.");
  const opts = await getOptions([
    "lms_payment_path",
    "digital_commission_percent",
  ]);
  let beneficiaryType: "customer" | "merchant" = "customer",
    beneficiaryId = String(course.owner_id),
    commissionPercent = ls.commissionPercent,
    storeId: string | null = null,
    merchantId: string | null = null;
  if (draft.context === "store") {
    const store = await one(
      "SELECT * FROM stores WHERE id=? AND status='active'",
      [draft.store_id],
    );
    if (!store)
      throw new CreatorError(403, "This business is not accepting purchases.");
    const marketplace = await getMarketplaceSettings();
    if (
      !marketplace.eliteDigitalProductsEnabled ||
      !(await storePlan(store, marketplace)).isElite
    )
      throw new CreatorError(
        403,
        "This store needs active Merchant Elite access for new sales.",
      );
    storeId = String(store.id);
    merchantId = String(store.merchant_id);
    if (opts.lms_payment_path === "store_checkout_direct") {
      beneficiaryType = "merchant";
      beneficiaryId = merchantId;
      commissionPercent = Number(opts.digital_commission_percent);
    }
  }
  const price = p.draft.priceUgx,
    commission = Math.floor((price * commissionPercent) / 100),
    payout = price - commission;
  if (
    !Number.isSafeInteger(price) ||
    price <= 0 ||
    price > ls.maxCoursePriceUgx ||
    commission < 0 ||
    payout < 0
  )
    throw new CreatorError(400, "This offer has an invalid price.");
  const purchaseId = newId("purchase"),
    enrollmentId = newId("enr"),
    fulfillmentId = storeId ? newId("ful") : null,
    token = storeId ? crypto.randomUUID() + crypto.randomUUID() : "";
  const column =
    environment === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance";
  const existingSeat = await one(
    "SELECT id FROM edu_enrollments WHERE user_id=? AND course_id=?",
    [input.buyerId, input.courseId],
  );
  const seatId = existingSeat ? String(existingSeat.id) : enrollmentId;
  const writes: DbStatement[] = [
    ...(await learningEnrollmentStatements(
      input.buyerId,
      input.courseId,
      ls,
      input.cohortId,
    )),
    {
      sql: "INSERT INTO edu_creator_purchases(id,course_id,publication_id,buyer_id,store_id,fulfillment_id,enrollment_id,beneficiary_type,beneficiary_id,price_ugx,commission_ugx,environment,request_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
      args: [
        purchaseId,
        input.courseId,
        p.publication.id,
        input.buyerId,
        storeId,
        fulfillmentId,
        seatId,
        beneficiaryType,
        beneficiaryId,
        price,
        commission,
        environment,
        input.requestId,
      ],
    },
    {
      sql: `UPDATE users SET ${column}=${column}-?,updated_at=datetime('now') WHERE id=? AND ${column}>=?`,
      args: [price, input.buyerId, price],
    },
    requireChangedRow,
    {
      sql: `INSERT INTO wallet_ledger(id,user_id,type,amount,balance_after,note,environment) SELECT ?,id,'order_payment',?,${column},?,? FROM users WHERE id=?`,
      args: [
        newId("wl"),
        -price,
        `Learn purchase ${purchaseId}`,
        environment,
        input.buyerId,
      ],
    },
    {
      sql: "INSERT INTO edu_enrollments(id,course_id,school_id,user_id,status,price_paid_ugx,commission_ugx,environment) VALUES(?,?,?,?,'active',?,?,?) ON CONFLICT(course_id,user_id) DO UPDATE SET status='active',price_paid_ugx=excluded.price_paid_ugx,commission_ugx=excluded.commission_ugx,environment=excluded.environment",
      args: [
        seatId,
        input.courseId,
        course.school_id,
        input.buyerId,
        price,
        commission,
        environment,
      ],
    },
    {
      sql: "INSERT INTO edu_publication_access(user_id,course_id,publication_id,source) VALUES(?,?,?,?) ON CONFLICT(user_id,course_id) DO UPDATE SET publication_id=excluded.publication_id,source=excluded.source",
      args: [
        input.buyerId,
        input.courseId,
        p.publication.id,
        `purchase:${purchaseId}`,
      ],
    },
  ];
  if (payout > 0) {
    if (beneficiaryType === "customer")
      writes.push(
        {
          sql: `UPDATE users SET ${column}=${column}+?,updated_at=datetime('now') WHERE id=?`,
          args: [payout, beneficiaryId],
        },
        requireChangedRow,
        {
          sql: `INSERT INTO wallet_ledger(id,user_id,type,amount,balance_after,note,environment) SELECT ?,id,'adjustment',?,${column},?,? FROM users WHERE id=?`,
          args: [
            newId("wl"),
            payout,
            `Learn sale ${purchaseId}`,
            environment,
            beneficiaryId,
          ],
        },
      );
    else
      writes.push(
        {
          sql: "INSERT OR IGNORE INTO merchant_balances(merchant_id,environment) VALUES(?,?)",
          args: [beneficiaryId, environment],
        },
        {
          sql: "UPDATE merchant_balances SET available=available+?,updated_at=datetime('now') WHERE merchant_id=? AND environment=?",
          args: [payout, beneficiaryId, environment],
        },
        requireChangedRow,
      );
  }
  if (storeId && fulfillmentId) {
    const tokenHash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
      ),
    )
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
    writes.push(
      {
        sql: "INSERT INTO store_digital_fulfillments(id,store_id,digital_product_id,customer_name,customer_phone,access_token,token_hint,max_downloads,status,buyer_user_id,price_paid_ugx,commission_ugx,edu_enrollment_id) SELECT ?,?,?,name,phone,?,?,0,'active',id,?,?,? FROM users WHERE id=?",
        args: [
          fulfillmentId,
          storeId,
          `dig_crs_${input.courseId}`,
          tokenHash,
          token.slice(-4),
          price,
          commission,
          seatId,
          input.buyerId,
        ],
      },
      {
        sql: "INSERT OR IGNORE INTO store_lms_enrollments(id,store_id,course_id,student_name,student_phone,student_email,user_id,total_lessons) SELECT ?,?,?,name,phone,COALESCE(email,''),id,? FROM users WHERE id=?",
        args: [
          newId("storeseat"),
          storeId,
          input.courseId,
          p.draft.modules.reduce((n, m) => n + m.lessons.length, 0),
          input.buyerId,
        ],
      },
      {
        sql: "UPDATE store_lms_enrollments SET access_status='active',total_lessons=? WHERE store_id=? AND course_id=? AND user_id=?",
        args: [
          p.draft.modules.reduce((n, m) => n + m.lessons.length, 0),
          storeId,
          input.courseId,
          input.buyerId,
        ],
      },
      {
        sql: "UPDATE store_digital_products SET sales_count=sales_count+1 WHERE id=?",
        args: [`dig_crs_${input.courseId}`],
      },
    );
  }
  const postings: LedgerPosting[] = [
    {
      ownerType: "customer",
      ownerId: input.buyerId,
      purpose: "wallet_payable",
      environment,
      amount: -price,
    },
    ...(payout > 0
      ? [
          {
            ownerType: beneficiaryType,
            ownerId: beneficiaryId,
            purpose:
              beneficiaryType === "merchant"
                ? "payable_available"
                : "wallet_payable",
            environment,
            amount: payout,
          },
        ]
      : []),
    ...(commission > 0
      ? [
          {
            ownerType: "platform" as const,
            ownerId: "peebee",
            purpose: "digital_sales_commission",
            environment,
            amount: commission,
          },
        ]
      : []),
  ];
  try {
    await postLedgerTransaction({
      kind: "learn_course_sale",
      idempotencyKey: `learn-purchase:${purchaseId}`,
      environment,
      referenceType: "learn_purchase",
      referenceId: purchaseId,
      actorId: input.buyerId,
      postings,
      additionalStatements: writes,
    });
  } catch (err) {
    const won = await one(
      "SELECT * FROM edu_creator_purchases WHERE buyer_id=? AND course_id=? AND environment=? AND status='settled'",
      [input.buyerId, input.courseId, environment],
    );
    if (won)
      return {
        purchaseId: String(won.id),
        enrollmentId: String(won.enrollment_id),
        fulfillmentId: won.fulfillment_id ? String(won.fulfillment_id) : null,
        token: "",
        pricePaidUgx: Number(won.price_ugx),
      };
    const buyer = await one(
      `SELECT ${column} AS balance FROM users WHERE id=?`,
      [input.buyerId],
    );
    if (Number(buyer?.balance) < price)
      throw new CreatorError(
        403,
        "Your wallet does not cover this purchase. Add funds and try again.",
      );
    throw err;
  }
  return {
    purchaseId,
    enrollmentId: seatId,
    fulfillmentId,
    token,
    pricePaidUgx: price,
  };
}

export async function refundLearningPurchase(
  purchaseId: string,
  actorId: string,
): Promise<{ ok: true }> {
  const r = await one("SELECT * FROM edu_creator_purchases WHERE id=?", [
    purchaseId,
  ]);
  if (!r) throw new CreatorError(404, "That purchase wasn't found.");
  if (r.status === "refunded") return { ok: true };
  const environment = r.environment as PlatformEnvironment,
    column =
      environment === "sandbox" ? "wallet_balance_sandbox" : "wallet_balance",
    price = Number(r.price_ugx),
    commission = Number(r.commission_ugx),
    payout = price - commission;
  const writes: DbStatement[] = [
    {
      sql: "UPDATE edu_creator_purchases SET status='refunded',refunded_at=datetime('now') WHERE id=? AND status='settled'",
      args: [purchaseId],
    },
    requireChangedRow,
  ];
  if (payout > 0) {
    writes.push(
      r.beneficiary_type === "merchant"
        ? {
            sql: "UPDATE merchant_balances SET available=available-? WHERE merchant_id=? AND environment=? AND available>=?",
            args: [payout, r.beneficiary_id, environment, payout],
          }
        : {
            sql: `UPDATE users SET ${column}=${column}-? WHERE id=? AND ${column}>=?`,
            args: [payout, r.beneficiary_id, payout],
          },
      requireChangedRow,
    );
    if (r.beneficiary_type !== "merchant")
      writes.push({
        sql: `INSERT INTO wallet_ledger(id,user_id,type,amount,balance_after,note,actor_id,environment) SELECT ?,id,'adjustment',?,${column},?,?,? FROM users WHERE id=?`,
        args: [
          newId("wl"),
          -payout,
          `Refund ${purchaseId}`,
          actorId,
          environment,
          r.beneficiary_id,
        ],
      });
  }
  writes.push(
    {
      sql: `UPDATE users SET ${column}=${column}+? WHERE id=?`,
      args: [price, r.buyer_id],
    },
    requireChangedRow,
    {
      sql: `INSERT INTO wallet_ledger(id,user_id,type,amount,balance_after,note,actor_id,environment) SELECT ?,id,'refund',?,${column},?,?,? FROM users WHERE id=?`,
      args: [
        `wl_creator_refund_${purchaseId}`,
        price,
        `Refund ${purchaseId}`,
        actorId,
        environment,
        r.buyer_id,
      ],
    },
  );
  const { digital_refund_revokes_access: revoke } = await getOptions([
    "digital_refund_revokes_access",
  ]);
  if (revoke) {
    writes.push({
      sql: "DELETE FROM edu_cohort_members WHERE user_id=? AND course_id=? AND EXISTS(SELECT 1 FROM edu_publication_access WHERE user_id=? AND course_id=? AND source=?)",
      args: [
        r.buyer_id,
        r.course_id,
        r.buyer_id,
        r.course_id,
        `purchase:${purchaseId}`,
      ],
    });
    if (r.store_id)
      writes.push({
        sql: "UPDATE store_lms_enrollments SET access_status='revoked' WHERE store_id=? AND user_id=? AND course_id=? AND EXISTS(SELECT 1 FROM edu_publication_access WHERE user_id=? AND course_id=? AND source=?)",
        args: [
          r.store_id,
          r.buyer_id,
          r.course_id,
          r.buyer_id,
          r.course_id,
          `purchase:${purchaseId}`,
        ],
      });
    writes.push({
      sql: "UPDATE edu_enrollments SET status='revoked' WHERE id=? AND user_id=? AND EXISTS(SELECT 1 FROM edu_publication_access WHERE user_id=? AND course_id=? AND source=?)",
      args: [
        r.enrollment_id,
        r.buyer_id,
        r.buyer_id,
        r.course_id,
        `purchase:${purchaseId}`,
      ],
    });
    if (r.fulfillment_id)
      writes.push({
        sql: "UPDATE store_digital_fulfillments SET status='revoked',refunded_at=datetime('now') WHERE id=?",
        args: [r.fulfillment_id],
      });
  } else if (r.fulfillment_id)
    writes.push({
      sql: "UPDATE store_digital_fulfillments SET refunded_at=datetime('now') WHERE id=?",
      args: [r.fulfillment_id],
    });
  try {
    await postLedgerTransaction({
      kind: "learn_course_refund",
      idempotencyKey: `learn-refund:${purchaseId}`,
      environment,
      referenceType: "learn_purchase",
      referenceId: purchaseId,
      actorId,
      postings: [
        {
          ownerType: "customer",
          ownerId: String(r.buyer_id),
          purpose: "wallet_payable",
          environment,
          amount: price,
        },
        ...(payout > 0
          ? [
              {
                ownerType: r.beneficiary_type as "customer" | "merchant",
                ownerId: String(r.beneficiary_id),
                purpose:
                  r.beneficiary_type === "merchant"
                    ? "payable_available"
                    : "wallet_payable",
                environment,
                amount: -payout,
              },
            ]
          : []),
        ...(commission > 0
          ? [
              {
                ownerType: "platform" as const,
                ownerId: "peebee",
                purpose: "digital_sales_commission",
                environment,
                amount: -commission,
              },
            ]
          : []),
      ],
      additionalStatements: writes,
    });
  } catch (err) {
    if (
      (
        await one("SELECT status FROM edu_creator_purchases WHERE id=?", [
          purchaseId,
        ])
      )?.status === "refunded"
    )
      return { ok: true };
    throw new CreatorError(
      409,
      "The payout balance cannot cover this refund. No partial refund was applied; contact support for reconciliation.",
    );
  }
  return { ok: true };
}

export const creatorCommerceRoutes = new Hono();
creatorCommerceRoutes.post("/publications/:id/buy", async (c) => {
  const parsed = await readBody(
    c,
    z.object({
      cohortId: z.string().max(100).optional(),
      publicationId: z.string().max(100),
      price: z.number().int().positive(),
      requestId: z.string().min(8).max(100),
    }),
  );
  if (!parsed.ok) return parsed.res;
  const result = await purchaseLearningCourse({
    buyerId: c.get("user").sub,
    courseId: c.req.param("id"),
    ...parsed.data,
  });
  return c.json({ ok: true, ...result });
});
creatorCommerceRoutes.get("/earnings", async (c) => {
  const user = c.get("user").sub;
  const rows = await db.execute({
    sql: "SELECT p.*,c.title FROM edu_creator_purchases p JOIN edu_courses c ON c.id=p.course_id JOIN edu_schools s ON s.id=c.school_id WHERE s.owner_id=? ORDER BY p.created_at DESC LIMIT 200",
    args: [user],
  });
  return c.json({ purchases: rows.rows });
});
creatorCommerceRoutes.post("/purchases/:id/refund", async (c) => {
  const r = await one(
    "SELECT course_id FROM edu_creator_purchases WHERE id=?",
    [c.req.param("id")],
  );
  if (!r) throw new CreatorError(404, "That purchase wasn't found.");
  const course = await authorizeDraft(c.get("user").sub, String(r.course_id));
  if (course.owner_id !== c.get("user").sub)
    throw new CreatorError(
      403,
      "Only the payout owner can authorize this refund here. Business refund permissions apply in Merchant Elite.",
    );
  return c.json(
    await refundLearningPurchase(c.req.param("id"), c.get("user").sub),
  );
});
