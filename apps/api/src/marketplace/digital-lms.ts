import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { getMarketplaceSettings } from "../lib/settings.js";
import { hasColumn, hasTable } from "../lib/schema.js";
import { demoCatalogAllowed, findPublicStore } from "./public.js";
import { sendStoreSms } from "./sms.js";
import { digitalDeliveryRoutes } from "./digital-delivery.js";
import { licensePoolCounts, soldOutLicenseProducts, syncLicensePool } from "./digital-sales.js";
import { emailStudent, enrollStudent, resolveStudent, studentWelcome } from "./lms-enroll.js";
import { applyModuleDrip, applyNewCourseDefaults, catalogListingFor, lessonHostProblem } from "./lms-rules.js";
import { courseFinished } from "../education/rewards.js";
import { getPlatformEnvironment } from "../lib/settings.js";
import { normalizePhone } from "../lib/validation.js";
import { migrationPending, publicRateLimit } from "../lib/guards.js";
import { getOptions } from "../lib/option-settings.js";
import { eliteOnly } from "./plans.js";
import { enrollmentSchema, parseCourse, parseDigitalProduct } from "./digital-input.js";
import type {
  StoreDigitalProduct,
  StoreDigitalFulfillment,
  StoreLmsCourse,
  StoreLmsEnrollment,
} from "@peebee/shared";

export const digitalLmsRoutes = new Hono();
// Creation/management tools require Elite; servicing existing purchases must remain possible after expiry.
digitalLmsRoutes.use("/merchants/me/digital-products", requireAuth, eliteOnly);
digitalLmsRoutes.use("/merchants/me/digital-products/*", requireAuth, eliteOnly);
digitalLmsRoutes.use("/merchants/me/lms/*", requireAuth, eliteOnly);
// Purchase, delivery, refunds and file upload live in digital-delivery.ts.
digitalLmsRoutes.route("/", digitalDeliveryRoutes);

type Row = Record<string, unknown>;

// Demo fallback data
export const DEMO_DIGITAL_PRODUCTS: StoreDigitalProduct[] = [
  {
    id: "dig_demo_ebook",
    store_id: "store_demo_fresh_mart",
    title: "Organic Urban Farming Guide & Seasonal Harvest Calendar",
    kind: "download",
    description: "Complete 85-page PDF guide to balcony gardening, composting in Kampala, and indigenous vegetable calendars.",
    price_ugx: 25000,
    compare_at_price_ugx: 40000,
    file_url: "https://peebee.online/downloads/urban-farming-guide-2026.pdf",
    file_name: "urban-farming-guide-2026.pdf",
    file_size_bytes: 14200000,
    mime_type: "application/pdf",
    max_downloads: 5,
    expiry_days: 60,
    license_keys_pool: null,
    delivery_instructions: "Click the secure download button or access via your SMS confirmation receipt.",
    cover_image_url: "https://images.unsplash.com/photo-1592417817098-8f3d6eb22509?auto=format&fit=crop&w=800&q=80",
    linked_course_id: null,
    status: "published",
    downloads_count: 84,
    sales_count: 36,
    created_at: new Date(Date.now() - 14 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "dig_demo_pos_license",
    store_id: "store_demo_fresh_mart",
    title: "Smart Inventory & Barcode POS Desktop Tool",
    kind: "license_key",
    description: "Single-device activation license key for offline thermal receipt printing and barcode scanner syncing.",
    price_ugx: 75000,
    compare_at_price_ugx: 120000,
    file_url: "https://peebee.online/downloads/pos-printer-sync-v2.zip",
    file_name: "pos-printer-sync-v2.zip",
    file_size_bytes: 48000000,
    mime_type: "application/zip",
    max_downloads: 3,
    expiry_days: 365,
    license_keys_pool: ["KEY-PB-8841-A91X", "KEY-PB-9922-C44Z", "KEY-PB-3310-M77Q"],
    delivery_instructions: "Your unique activation key will be shown immediately upon purchase and dispatched to your phone.",
    cover_image_url: "https://images.unsplash.com/photo-1556742049-0a67c5574f73?auto=format&fit=crop&w=800&q=80",
    linked_course_id: null,
    status: "published",
    downloads_count: 19,
    sales_count: 14,
    created_at: new Date(Date.now() - 7 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export const DEMO_LMS_COURSES: StoreLmsCourse[] = [
  {
    id: "crs_demo_agribusiness",
    store_id: "store_demo_fresh_mart",
    learn_course_id: "crs_demo_agribusiness",
    learn_school_id: "sch_freshmart_academy",
    title: "Commercial Agribusiness & Cold-Chain Logistics Masterclass",
    slug: "commercial-agribusiness-masterclass",
    stream: "skills",
    summary: "Comprehensive 6-module certification course on wholesale farm-to-door distribution, MoMo payment escrow, and zero-waste storage in East Africa.",
    price_ugx: 85000,
    cover_url: "https://images.unsplash.com/photo-1586771107445-d3ca888129ff?auto=format&fit=crop&w=800&q=80",
    certificate_enabled: true,
    drip_schedule: "all_at_once",
    status: "published",
    total_lessons: 12,
    total_duration_minutes: 180,
    enrolled_students_count: 52,
    completion_rate_percent: 78,
    learn_synced: true,
    created_at: new Date(Date.now() - 20 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
    modules: [
      {
        id: "mod_1",
        title: "Module 1: Sourcing & Post-Harvest Quality Grading",
        description: "Standards for fresh fruit and vegetable grading in Luweero and Mbale districts.",
        position: 1,
        lessons: [
          {
            id: "les_1_1",
            title: "Standardizing Grade-A Produce for Supermarkets",
            content_type: "video",
            duration_minutes: 18,
            content_url: "https://app.peebee.online/demo-video/produce-grading.mp4",
            summary: "How to identify shelf-life indicators and reject damaged stock before transit.",
            quiz_questions_count: 4,
          },
          {
            id: "les_1_2",
            title: "Cold-Chain Handling Without Expensive Refrigeration",
            content_type: "video",
            duration_minutes: 22,
            content_url: "https://app.peebee.online/demo-video/cold-chain.mp4",
            summary: "Evaporative cooling chambers, insulated charcoal crates, and morning transit windows.",
          },
        ],
      },
      {
        id: "mod_2",
        title: "Module 2: Pricing, P&L and Margin Protection",
        description: "Managing spoilage buffer, transport costs, and B2B hotel contracts.",
        position: 2,
        lessons: [
          {
            id: "les_2_1",
            title: "Cost of Goods Sold (COGS) Formula for Perishables",
            content_type: "article",
            duration_minutes: 15,
            summary: "Interactive financial worksheet to factor in 4% transit shrinkage.",
          },
          {
            id: "les_2_2",
            title: "Module 2 Mastery Quiz & Certification Assessment",
            content_type: "quiz",
            duration_minutes: 20,
            summary: "Passing score: 80% to unlock Module 3.",
            quiz_questions_count: 10,
          },
        ],
      },
    ],
  },
];

export async function getMerchantStore(userId: string, selectedMerchantId?: string): Promise<Row | null> {
  if (!(await hasTable("stores"))) return null;
  let merchantId = userId;
  if (await hasTable("merchant_members")) {
    const memRes = await db.execute({
      sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
      args: [userId, selectedMerchantId ?? null, selectedMerchantId ?? null],
    });
    if (!memRes.rows[0]?.merchant_id) return null;
    if (memRes.rows[0]?.merchant_id) {
      merchantId = String(memRes.rows[0].merchant_id);
    }
  }
  const res = await db.execute({
    sql: "SELECT * FROM stores WHERE merchant_id = ? LIMIT 1",
    args: [merchantId],
  });
  return (res.rows[0] as Row) || null;
}

// ---------------------------------------------------------------------------
// Merchant Tier 3: Digital Products Management
// ---------------------------------------------------------------------------

digitalLmsRoutes.get("/merchants/me/digital-products", requireAuth, async (c) => {
  const user = c.get("user");
  const store = await getMerchantStore(user.sub, c.req.header("X-Merchant-Id"));
  if (!store) {
    return c.json({ error: "no_store", message: "You don't have a registered store." }, 404);
  }

  if (!(await hasTable("store_digital_products"))) {
    return c.json({ error: "migration_pending", message: "Digital products are being set up. Try again shortly." }, 503);
  }

  const res = await db.execute({
    sql: "SELECT * FROM store_digital_products WHERE store_id = ? ORDER BY created_at DESC",
    args: [String(store.id)],
  });

  const poolFor = new Map<string, { available: number; issued: number; keys: string[] }>();
  if (await hasTable("store_license_keys")) {
    const keyRows = await db.execute({ sql: "SELECT product_id, license_key, status FROM store_license_keys WHERE store_id = ? AND status IN ('available', 'issued') ORDER BY created_at", args: [String(store.id)] });
    for (const k of keyRows.rows as Row[]) {
      const entry = poolFor.get(String(k.product_id)) ?? { available: 0, issued: 0, keys: [] };
      if (k.status === "available") { entry.available++; entry.keys.push(String(k.license_key)); } else entry.issued++;
      poolFor.set(String(k.product_id), entry);
    }
  }
  const products = (res.rows as Row[]).map((r) => ({
    id: String(r.id),
    store_id: String(r.store_id),
    title: String(r.title),
    kind: (r.kind as any) || "download",
    description: r.description ? String(r.description) : null,
    price_ugx: Number(r.price_ugx) || 0,
    compare_at_price_ugx: r.compare_at_price_ugx != null ? Number(r.compare_at_price_ugx) : null,
    file_url: r.file_url ? String(r.file_url) : null,
    file_name: r.file_name ? String(r.file_name) : null,
    file_size_bytes: r.file_size_bytes != null ? Number(r.file_size_bytes) : null,
    mime_type: r.mime_type ? String(r.mime_type) : null,
    max_downloads: Number(r.max_downloads ?? 5),
    expiry_days: Number(r.expiry_days ?? 30),
    license_keys_pool: null, // Secret keys are only returned by the permission-protected pool endpoint.
    license_keys_available: poolFor.get(String(r.id))?.available ?? 0,
    license_keys_issued: poolFor.get(String(r.id))?.issued ?? 0,
    delivery_instructions: r.delivery_instructions ? String(r.delivery_instructions) : null,
    cover_image_url: r.cover_image_url ? String(r.cover_image_url) : null,
    linked_course_id: r.linked_course_id ? String(r.linked_course_id) : null,
    status: (r.status as any) || "published",
    downloads_count: Number(r.downloads_count) || 0,
    sales_count: Number(r.sales_count) || 0,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  }));

  const resultList = products;
  return c.json({
    products: resultList,
    digitalProducts: resultList,
  });
});

digitalLmsRoutes.post("/merchants/me/digital-products", requireAuth, async (c) => {
  const user = c.get("user");
  const store = await getMerchantStore(user.sub, c.req.header("X-Merchant-Id"));
  if (!store) {
    return c.json({ error: "no_store", message: "You don't have a registered store." }, 404);
  }

  const settings = await getMarketplaceSettings();
  if (!settings.eliteDigitalProductsEnabled) {
    return c.json({ error: "feature_disabled", message: "Digital products feature is currently disabled by admin." }, 403);
  }
  const pending = await migrationPending(c, "0133_merchant_tier3_digital_products_lms.sql", "store_digital_products");
  if (pending) return pending;

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = parseDigitalProduct(body);
  if (!parsed.ok) return c.json({ error: "invalid_body", message: parsed.issues[0]?.message ?? "Check the product details.", issues: parsed.issues }, 400);
  const d = parsed.data;

  const id = body.id ? String(body.id) : newId("dig");
  const existing = await db.execute({ sql: "SELECT store_id FROM store_digital_products WHERE id = ?", args: [id] });
  if (existing.rows[0] && String(existing.rows[0].store_id) !== String(store.id)) {
    return c.json({ error: "forbidden", message: "That product belongs to another store." }, 403);
  }
  if (!existing.rows[0]) {
    const { digital_max_products: cap } = await getOptions(["digital_max_products"]);
    const count = await db.execute({ sql: "SELECT COUNT(*) AS n FROM store_digital_products WHERE store_id = ? AND status != 'archived'", args: [String(store.id)] });
    if (Number(count.rows[0]?.n) >= Number(cap)) {
      return c.json({ error: "product_limit", message: `A store can list up to ${cap} digital products.` }, 403);
    }
  }

  const defaults = await getOptions(["digital_default_max_downloads", "digital_default_expiry_days"]);
  const maxDownloads = d.max_downloads ?? Number(defaults.digital_default_max_downloads);
  const expiryDays = d.expiry_days ?? Number(defaults.digital_default_expiry_days);
  const fileName = d.file_name || (d.file_url ? d.file_url.split("/").pop() || "download" : "");

  await db.execute({
    sql: `INSERT INTO store_digital_products (
            id, store_id, title, kind, description, price_ugx, compare_at_price_ugx,
            file_url, file_name, file_size_bytes, mime_type, max_downloads, expiry_days,
            license_keys_pool, delivery_instructions, cover_image_url, linked_course_id,
            status, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            kind = excluded.kind,
            description = excluded.description,
            price_ugx = excluded.price_ugx,
            compare_at_price_ugx = excluded.compare_at_price_ugx,
            file_url = excluded.file_url,
            file_name = excluded.file_name,
            file_size_bytes = excluded.file_size_bytes,
            mime_type = excluded.mime_type,
            max_downloads = excluded.max_downloads,
            expiry_days = excluded.expiry_days,
            license_keys_pool = excluded.license_keys_pool,
            delivery_instructions = excluded.delivery_instructions,
            cover_image_url = excluded.cover_image_url,
            linked_course_id = excluded.linked_course_id,
            status = excluded.status,
            updated_at = datetime('now')
          WHERE store_digital_products.store_id = excluded.store_id`,
    args: [
      id, String(store.id), d.title, d.kind, d.description, d.price_ugx, d.compare_at_price_ugx,
      d.file_url, fileName, d.file_size_bytes, d.mime_type, maxDownloads, expiryDays,
      "[]", d.delivery_instructions, d.cover_image_url, d.linked_course_id, d.status,
    ],
  });

  // Keys live one-per-row so a key can be issued to exactly one buyer; the product row's JSON stays empty.
  if (body.license_keys_pool !== undefined) await syncLicensePool(String(store.id), id, d.license_keys_pool);
  const pool = await licensePoolCounts(id);

  return c.json({
    ok: true,
    product: {
      id,
      store_id: String(store.id),
      title: d.title,
      kind: d.kind,
      description: d.description,
      price_ugx: d.price_ugx,
      compare_at_price_ugx: d.compare_at_price_ugx,
      file_url: d.file_url,
      file_name: fileName,
      file_size_bytes: d.file_size_bytes,
      mime_type: d.mime_type,
      max_downloads: maxDownloads,
      expiry_days: expiryDays,
      license_keys_pool: d.license_keys_pool,
      license_keys_available: pool.available,
      license_keys_issued: pool.issued,
      delivery_instructions: d.delivery_instructions,
      cover_image_url: d.cover_image_url,
      linked_course_id: d.linked_course_id,
      status: d.status,
      downloads_count: 0,
      sales_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  });
});

digitalLmsRoutes.delete("/merchants/me/digital-products/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const store = await getMerchantStore(user.sub, c.req.header("X-Merchant-Id"));
  if (!store) return c.json({ error: "no_store" }, 404);

  const id = String(c.req.param("id") || "");
  if (await hasTable("store_digital_products")) {
    // A product that has been bought stays on file (buyers keep their access); it is just taken off sale.
    const sold = (await hasTable("store_digital_fulfillments"))
      ? (await db.execute({ sql: "SELECT 1 FROM store_digital_fulfillments WHERE digital_product_id = ? LIMIT 1", args: [id] })).rows.length > 0
      : false;
    if (sold) {
      await db.execute({ sql: "UPDATE store_digital_products SET status = 'archived', updated_at = datetime('now') WHERE id = ? AND store_id = ?", args: [id, String(store.id)] });
    } else {
      await db.execute({ sql: "DELETE FROM store_digital_products WHERE id = ? AND store_id = ?", args: [id, String(store.id)] });
    }
  }
  return c.json({ ok: true });
});

digitalLmsRoutes.get("/merchants/me/digital-fulfillments", requireAuth, async (c) => {
  const user = c.get("user");
  const store = await getMerchantStore(user.sub, c.req.header("X-Merchant-Id"));
  if (!store) return c.json({ error: "no_store" }, 404);

  if (!(await hasTable("store_digital_fulfillments"))) return c.json({ fulfillments: [] });

  const res = await db.execute({
    sql: `SELECT f.*, p.title as digital_product_title
          FROM store_digital_fulfillments f
          LEFT JOIN store_digital_products p ON p.id = f.digital_product_id
          WHERE f.store_id = ? AND f.status != 'pending'
          ORDER BY f.created_at DESC LIMIT 500`,
    args: [String(store.id)],
  });

  // The buyer's link is theirs alone: the merchant sees the last four characters, never a working token.
  const fulfillments = (res.rows as Row[]).map((r) => ({
    id: String(r.id),
    store_id: String(r.store_id),
    digital_product_id: String(r.digital_product_id),
    digital_product_title: r.digital_product_title ? String(r.digital_product_title) : "Digital Product",
    order_id: r.order_id ? String(r.order_id) : null,
    customer_name: r.customer_name ? String(r.customer_name) : null,
    customer_phone: String(r.customer_phone),
    customer_email: r.customer_email ? String(r.customer_email) : null,
    token_hint: r.token_hint ? String(r.token_hint) : null,
    license_key_issued: r.license_key_issued ? String(r.license_key_issued) : null,
    download_count: Number(r.download_count) || 0,
    max_downloads: Number(r.max_downloads ?? 0),
    price_paid_ugx: Number(r.price_paid_ugx) || 0,
    commission_ugx: Number(r.commission_ugx) || 0,
    sms_status: r.sms_status ? String(r.sms_status) : null,
    needs_manual_fulfilment: Number(r.needs_manual_fulfilment) === 1,
    refunded_at: r.refunded_at ? String(r.refunded_at) : null,
    expires_at: r.expires_at ? String(r.expires_at) : null,
    edu_enrollment_id: r.edu_enrollment_id ? String(r.edu_enrollment_id) : null,
    status: (r.status as string) || "active",
    created_at: String(r.created_at),
  }));

  return c.json({ fulfillments });
});

digitalLmsRoutes.post("/merchants/me/digital-fulfillments/:id/revoke", requireAuth, async (c) => {
  const user = c.get("user");
  const store = await getMerchantStore(user.sub, c.req.header("X-Merchant-Id"));
  if (!store) return c.json({ error: "no_store" }, 404);

  const id = String(c.req.param("id") || "");
  if (await hasTable("store_digital_fulfillments")) {
    await db.execute({
      sql: "UPDATE store_digital_fulfillments SET status = 'revoked' WHERE id = ? AND store_id = ?",
      args: [id, String(store.id)],
    });
  }
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Merchant Tier 3: LMS Courses (Synchronised with Peebee Learn edu_* tables)
// ---------------------------------------------------------------------------

/**
 * Link every course of this merchant's Learn school to the store (and put it on sale), without touching a course that
 * belongs to another store. Returns how many courses were newly linked.
 */
async function linkLearnCourses(userId: string, store: Row, onlyUnlinked: boolean): Promise<number> {
  if (!(await hasTable("edu_courses")) || !(await hasTable("edu_schools")) || !(await hasColumn("edu_courses", "store_id"))) return 0;
  const storeId = String(store.id);
  const res = await db.execute({
    sql: `SELECT c.id, c.title, c.summary, c.price_ugx, c.status, c.store_id
          FROM edu_courses c JOIN edu_schools s ON s.id = c.school_id
          WHERE s.owner_id = ? AND (c.store_id IS NULL ${onlyUnlinked ? "" : "OR c.store_id = ?"})`,
    args: onlyUnlinked ? [userId] : [userId, storeId],
  });
  let linked = 0;
  for (const r of res.rows as Row[]) {
    const courseId = String(r.id);
    if (r.store_id == null) {
      await db.execute({ sql: "UPDATE edu_courses SET store_id = ? WHERE id = ? AND store_id IS NULL", args: [storeId, courseId] });
      linked++;
    }
    if (await hasTable("store_digital_products")) {
      await db.execute({
        sql: `INSERT INTO store_digital_products (id, store_id, title, kind, description, price_ugx, max_downloads, expiry_days, linked_course_id, status, updated_at)
              VALUES (?, ?, ?, 'course', ?, ?, 0, 0, ?, ?, datetime('now'))
              ON CONFLICT(id) DO UPDATE SET title = excluded.title, price_ugx = excluded.price_ugx, description = excluded.description,
                linked_course_id = excluded.linked_course_id, status = excluded.status
              WHERE store_digital_products.store_id = excluded.store_id`,
        args: [`dig_crs_${courseId}`, storeId, String(r.title), String(r.summary || ""), Number(r.price_ugx) || 0, courseId, r.status === "published" ? "published" : "draft"],
      });
    }
  }
  return linked;
}

digitalLmsRoutes.get("/merchants/me/lms/courses", requireAuth, async (c) => {
  const user = c.get("user");
  const store = await getMerchantStore(user.sub, c.req.header("X-Merchant-Id"));
  if (!store) return c.json({ error: "no_store" }, 404);
  if (!(await hasTable("edu_courses"))) return c.json({ courses: [] });

  const storeId = String(store.id);
  const learnSchoolId = store.learn_school_id ? String(store.learn_school_id) : null;
  const hasStoreCol = await hasColumn("edu_courses", "store_id");
  const o = await getOptions(["lms_learn_sync_mode", "lms_certificates"]);

  // Two-way sync: what the merchant builds in Peebee Learn shows up here without pressing anything.
  if (o.lms_learn_sync_mode === "two_way_auto") await linkLearnCourses(user.sub, store, true).catch(() => 0);

  const where = hasStoreCol ? "c.store_id = ?" : "c.school_id = ?";
  const courseRes = await db.execute({
    sql: `SELECT c.* FROM edu_courses c WHERE ${where} ${hasStoreCol && learnSchoolId ? "OR (c.school_id = ? AND c.store_id IS NULL)" : ""} ORDER BY c.created_at DESC LIMIT 200`,
    args: hasStoreCol ? (learnSchoolId ? [storeId, learnSchoolId] : [storeId]) : [learnSchoolId ?? ""],
  });
  const courseRows = courseRes.rows as Row[];
  if (courseRows.length === 0) return c.json({ courses: [] });
  const ids = courseRows.map((r) => String(r.id));
  const marks = ids.map(() => "?").join(",");

  const modules = (await hasTable("edu_modules"))
    ? ((await db.execute({ sql: `SELECT * FROM edu_modules WHERE course_id IN (${marks}) ORDER BY position ASC`, args: ids })).rows as Row[])
    : [];
  const lessons = (await hasTable("edu_lessons"))
    ? ((await db.execute({ sql: `SELECT * FROM edu_lessons WHERE course_id IN (${marks}) ORDER BY position ASC`, args: ids })).rows as Row[])
    : [];
  const drip = new Map<string, number>();
  if (await hasTable("edu_module_drip")) {
    for (const d of (await db.execute({ sql: `SELECT d.module_id, d.drip_days FROM edu_module_drip d JOIN edu_modules m ON m.id = d.module_id WHERE m.course_id IN (${marks})`, args: ids })).rows as Row[]) {
      drip.set(String(d.module_id), Number(d.drip_days));
    }
  }
  const seats = new Map<string, number>();
  const finished = new Map<string, number>();
  if (await hasTable("edu_enrollments")) {
    for (const r of (await db.execute({ sql: `SELECT course_id, COUNT(*) AS n FROM edu_enrollments WHERE course_id IN (${marks}) AND status = 'active' GROUP BY course_id`, args: ids })).rows as Row[]) {
      seats.set(String(r.course_id), Number(r.n));
    }
    if (await hasTable("edu_lesson_progress")) {
      for (const r of (await db.execute({
        sql: `SELECT e.course_id, COUNT(*) AS n FROM edu_enrollments e
              WHERE e.course_id IN (${marks}) AND e.status = 'active'
                AND (SELECT COUNT(*) FROM edu_lessons l WHERE l.course_id = e.course_id) > 0
                AND (SELECT COUNT(*) FROM edu_lessons l WHERE l.course_id = e.course_id) <= (SELECT COUNT(*) FROM edu_lesson_progress p WHERE p.user_id = e.user_id AND p.course_id = e.course_id)
              GROUP BY e.course_id`,
        args: ids,
      })).rows as Row[]) finished.set(String(r.course_id), Number(r.n));
    }
  }
  const rules = new Map<string, boolean>();
  if (await hasTable("edu_course_rules")) {
    for (const r of (await db.execute({ sql: `SELECT course_id, certificate_enabled FROM edu_course_rules WHERE course_id IN (${marks})`, args: ids })).rows as Row[]) {
      rules.set(String(r.course_id), Number(r.certificate_enabled) !== 0);
    }
  }
  const quizCount = (raw: unknown): number | undefined => {
    if (typeof raw !== "string" || !raw) return undefined;
    try {
      const q = JSON.parse(raw) as { questions?: unknown[] };
      return Array.isArray(q.questions) ? q.questions.length : undefined;
    } catch {
      return undefined;
    }
  };

  const courses: StoreLmsCourse[] = courseRows.map((row) => {
    const courseId = String(row.id);
    const mods = modules.filter((m) => String(m.course_id) === courseId).map((m) => ({
      id: String(m.id),
      title: String(m.title),
      description: m.description ? String(m.description) : undefined,
      position: Number(m.position) || 0,
      drip_days: drip.get(String(m.id)) ?? 0,
      lessons: lessons.filter((l) => String(l.module_id) === String(m.id)).map((l) => ({
        id: String(l.id),
        title: String(l.title),
        content_type: (l.content_type as any) || "video",
        duration_minutes: Number(l.duration_minutes) || 0,
        content_url: l.content_url ? String(l.content_url) : undefined,
        summary: l.summary ? String(l.summary) : undefined,
        quiz_questions_count: quizCount(l.quiz_json),
      })),
    }));
    const totalLessons = mods.reduce((sum, m) => sum + m.lessons.length, 0);
    const totalDuration = mods.reduce((sum, m) => sum + m.lessons.reduce((t, l) => t + l.duration_minutes, 0), 0);
    const enrolled = seats.get(courseId) ?? 0;
    const listed = row.catalog_listed === undefined ? true : Number(row.catalog_listed) === 1;
    return {
      id: courseId,
      store_id: storeId,
      learn_course_id: courseId,
      learn_school_id: row.school_id ? String(row.school_id) : undefined,
      title: String(row.title),
      slug: String(row.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
      stream: (row.stream as any) || "skills",
      summary: row.summary ? String(row.summary) : "",
      price_ugx: Number(row.price_ugx) || 0,
      certificate_enabled: o.lms_certificates !== "off" && (rules.get(courseId) ?? true),
      drip_schedule: mods.some((m) => (m.drip_days ?? 0) > 0) ? "weekly" : "all_at_once",
      status: (row.status as any) || "published",
      modules: mods,
      total_lessons: totalLessons,
      total_duration_minutes: totalDuration,
      enrolled_students_count: enrolled,
      completion_rate_percent: enrolled > 0 ? Math.round(((finished.get(courseId) ?? 0) / enrolled) * 100) : 0,
      // True only when learners can actually find the course in Peebee Learn.
      learn_synced: listed && row.status === "published",
      created_at: String(row.created_at || new Date().toISOString()),
      updated_at: String(row.updated_at || new Date().toISOString()),
    } as StoreLmsCourse;
  });

  return c.json({ courses });
});

digitalLmsRoutes.post("/merchants/me/lms/courses", requireAuth, async (c) => {
  const user = c.get("user");
  const store = await getMerchantStore(user.sub, c.req.header("X-Merchant-Id"));
  if (!store) return c.json({ error: "no_store" }, 404);

  const settings = await getMarketplaceSettings();
  if (!settings.eliteLmsSyncEnabled) {
    return c.json({ error: "feature_disabled", message: "LMS course management is currently disabled by admin." }, 403);
  }
  const pending = await migrationPending(c, "0109_education_studio.sql", "edu_schools", "edu_classes", "edu_courses", "edu_modules", "edu_lessons");
  if (pending) return pending;

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = parseCourse(body);
  if (!parsed.ok) return c.json({ error: "invalid_body", message: parsed.issues[0]?.message ?? "Check the course details.", issues: parsed.issues }, 400);
  const d = parsed.data;
  const hostProblem = await lessonHostProblem(d.modules);
  if (hostProblem) return c.json({ error: "lesson_host_not_allowed", message: hostProblem }, 400);

  const storeId = String(store.id);
  const courseId = d.id ?? newId("crs");
  const modulesInput = d.modules ?? [];

  // An id the client supplies may only update something this store already owns.
  const existingCourse = d.id ? (await db.execute({ sql: "SELECT school_id FROM edu_courses WHERE id = ?", args: [courseId] })).rows[0] : undefined;
  if (!existingCourse) {
    const { lms_max_courses: cap } = await getOptions(["lms_max_courses"]);
    const count = await db.execute({
      sql: "SELECT COUNT(*) AS n FROM edu_courses WHERE store_id = ?",
      args: [storeId],
    }).catch(() => null);
    if (count && Number(count.rows[0]?.n) >= Number(cap)) {
      return c.json({ error: "course_limit", message: `A store can offer up to ${cap} courses.` }, 403);
    }
  }

  // 1. Ensure Learn school exists for this store
  let schoolId = store.learn_school_id ? String(store.learn_school_id) : null;
  if (existingCourse && schoolId && String(existingCourse.school_id) !== schoolId) {
    return c.json({ error: "forbidden", message: "That course belongs to another school." }, 403);
  }
  if (!schoolId) {
    schoolId = newId("sch");
    const schoolSlug = `${String(store.slug || "store")}-academy-${Date.now().toString(36)}`;
    if (existingCourse) {
      // A course that already exists must sit in a school this account owns.
      const own = await db.execute({ sql: "SELECT id FROM edu_schools WHERE id = ? AND owner_id = ?", args: [String(existingCourse.school_id), user.sub] });
      if (!own.rows[0]) return c.json({ error: "forbidden", message: "That course belongs to another school." }, 403);
      schoolId = String(existingCourse.school_id);
    } else {
      await db.execute({
        sql: `INSERT INTO edu_schools (id, owner_id, name, slug, kind, streams, tagline, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, 'training_centre', 'skills,academy', ?, 'active', datetime('now'), datetime('now'))`,
        args: [schoolId, user.sub, `${String(store.name || "Store")} Academy`, schoolSlug, `Official Training & LMS Portal for ${String(store.name)}`],
      });
      if (await hasColumn("stores", "learn_school_id")) {
        await db.execute({ sql: "UPDATE stores SET learn_school_id = ? WHERE id = ?", args: [schoolId, storeId] });
      }
    }
  }

  // Every module and lesson id the client sends must already belong to this course (or be new).
  for (const mod of modulesInput) {
    if (mod.id) {
      const owned = await db.execute({ sql: "SELECT course_id FROM edu_modules WHERE id = ?", args: [mod.id] });
      if (owned.rows[0] && String(owned.rows[0].course_id) !== courseId) {
        return c.json({ error: "forbidden", message: "That module belongs to another course." }, 403);
      }
    }
    for (const les of mod.lessons) {
      if (les.id) {
        const owned = await db.execute({ sql: "SELECT course_id FROM edu_lessons WHERE id = ?", args: [les.id] });
        if (owned.rows[0] && String(owned.rows[0].course_id) !== courseId) {
          return c.json({ error: "forbidden", message: "That lesson belongs to another course." }, 403);
        }
      }
    }
  }

  // 2. Ensure default class exists
  let classId = newId("cls");
  const clsRes = await db.execute({ sql: "SELECT id FROM edu_classes WHERE school_id = ? LIMIT 1", args: [schoolId] });
  if (clsRes.rows.length > 0) {
    classId = String(clsRes.rows[0].id);
  } else {
    await db.execute({
      sql: `INSERT INTO edu_classes (id, school_id, stream, kind, name, teacher_name, status, created_at, updated_at)
            VALUES (?, ?, ?, 'masterclass', 'Professional Certification Class', ?, 'published', datetime('now'), datetime('now'))`,
      args: [classId, schoolId, d.stream, String(store.name || "Lead Instructor")],
    });
  }

  // A brand-new course with no syllabus yet stays a draft: nothing is invented for the public catalogue.
  const status = !existingCourse && modulesInput.length === 0 && !body.status ? "draft" : d.status;

  // 3. Insert or update the course in edu_courses (the Learn catalogue's own table)
  const hasStoreCol = await hasColumn("edu_courses", "store_id");
  const hasListedCol = await hasColumn("edu_courses", "catalog_listed");
  const listed = await catalogListingFor(status);
  await db.execute({
    sql: `INSERT INTO edu_courses (id, school_id, class_id, stream, title, summary, price_ugx, ${hasStoreCol ? "store_id, " : ""}${hasListedCol ? "catalog_listed, " : ""}status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ${hasStoreCol ? "?, " : ""}${hasListedCol ? "?, " : ""}?, datetime('now'), datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            summary = excluded.summary,
            price_ugx = excluded.price_ugx,
            stream = excluded.stream,
            status = excluded.status,
            ${hasStoreCol ? "store_id = excluded.store_id," : ""}
            ${hasListedCol ? "catalog_listed = CASE WHEN excluded.status != 'published' THEN 0 WHEN edu_courses.status != 'published' THEN excluded.catalog_listed ELSE edu_courses.catalog_listed END," : ""}
            updated_at = datetime('now')
          WHERE edu_courses.school_id = excluded.school_id`,
    args: [courseId, schoolId, classId, d.stream, d.title, d.summary, d.price_ugx, ...(hasStoreCol ? [storeId] : []), ...(hasListedCol ? [listed] : []), status],
  });

  // 4. Save modules and lessons
  const moduleIds: string[] = [];
  for (const [mIndex, mod] of modulesInput.entries()) {
    const modId = mod.id ?? newId("mod");
    moduleIds.push(modId);
    await db.execute({
      sql: `INSERT INTO edu_modules (id, course_id, title, description, position, created_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET title = excluded.title, description = excluded.description, position = excluded.position
            WHERE edu_modules.course_id = excluded.course_id`,
      args: [modId, courseId, mod.title, mod.description, mIndex + 1],
    });
    await applyModuleDrip(modId, mod.drip_days);
    for (const [lIndex, les] of mod.lessons.entries()) {
      await db.execute({
        sql: `INSERT INTO edu_lessons (id, module_id, course_id, title, content_type, duration_minutes, summary, content_url, position, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
              ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                content_type = excluded.content_type,
                duration_minutes = excluded.duration_minutes,
                summary = excluded.summary,
                content_url = excluded.content_url,
                position = excluded.position
              WHERE edu_lessons.course_id = excluded.course_id`,
        args: [les.id ?? newId("les"), modId, courseId, les.title, les.content_type, les.duration_minutes, les.summary, les.content_url, lIndex + 1],
      });
    }
  }

  // A brand-new course starts with the platform's choices for certificates and lesson release.
  if (!existingCourse) await applyNewCourseDefaults(courseId, moduleIds);

  // 5. Create or sync the matching digital product so the course can be bought on the store
  if (await hasTable("store_digital_products")) {
    await db.execute({
      sql: `INSERT INTO store_digital_products (
              id, store_id, title, kind, description, price_ugx, max_downloads,
              expiry_days, linked_course_id, status, updated_at
            ) VALUES (?, ?, ?, 'course', ?, ?, 0, 0, ?, ?, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
              title = excluded.title,
              price_ugx = excluded.price_ugx,
              description = excluded.description,
              linked_course_id = excluded.linked_course_id,
              status = excluded.status,
              updated_at = datetime('now')
            WHERE store_digital_products.store_id = excluded.store_id`,
      args: [`dig_crs_${courseId}`, storeId, d.title, d.summary, d.price_ugx, courseId, status === "published" ? "published" : "draft"],
    });
  }

  const totalLessons = modulesInput.reduce((sum, m) => sum + m.lessons.length, 0);
  const totalMinutes = modulesInput.reduce((sum, m) => sum + m.lessons.reduce((t, l) => t + l.duration_minutes, 0), 0);
  return c.json({
    ok: true,
    course: {
      id: courseId,
      store_id: storeId,
      learn_course_id: courseId,
      learn_school_id: schoolId,
      title: d.title,
      stream: d.stream,
      summary: d.summary,
      price_ugx: d.price_ugx,
      certificate_enabled: true,
      drip_schedule: "all_at_once",
      status,
      modules: modulesInput,
      total_lessons: totalLessons,
      total_duration_minutes: totalMinutes,
      enrolled_students_count: 0,
      completion_rate_percent: 0,
      learn_synced: hasListedCol && listed === 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  });
});

digitalLmsRoutes.post("/merchants/me/lms/sync-from-learn", requireAuth, async (c) => {
  const user = c.get("user");
  const store = await getMerchantStore(user.sub, c.req.header("X-Merchant-Id"));
  if (!store) return c.json({ error: "no_store" }, 404);
  const pending = await migrationPending(c, "0133_merchant_tier3_digital_products_lms.sql", "edu_courses", "edu_schools");
  if (pending) return pending;
  const importedCount = await linkLearnCourses(user.sub, store, true);
  return c.json({ ok: true, importedCount });
});

/** Put a store's course in (or take it out of) the Peebee Learn catalogue. A sale from the store works either way. */
async function setListing(c: any, listed: boolean) {
  const user = c.get("user");
  const store = await getMerchantStore(user.sub, c.req.header("X-Merchant-Id"));
  if (!store) return c.json({ error: "no_store" }, 404);
  if (!(await hasColumn("edu_courses", "catalog_listed"))) {
    return c.json({ error: "migration_pending", message: "Catalogue listing is being set up (0139_lms_hardening.sql is not applied yet)." }, 503);
  }
  const { lms_learn_sync_mode: mode } = await getOptions(["lms_learn_sync_mode"]);
  if (listed && mode === "store_only") return c.json({ error: "store_only", message: "This platform keeps store courses out of the Peebee Learn catalogue." }, 409);
  const course = (await db.execute({ sql: "SELECT id, status FROM edu_courses WHERE id = ? AND store_id = ?", args: [c.req.param("id"), String(store.id)] })).rows[0] as Row | undefined;
  if (!course) return c.json({ error: "not_found", message: "That isn't one of your courses." }, 404);
  if (listed && course.status !== "published") return c.json({ error: "not_published", message: "Publish the course before listing it." }, 409);
  await db.execute({ sql: "UPDATE edu_courses SET catalog_listed = ?, updated_at = datetime('now') WHERE id = ?", args: [listed ? 1 : 0, String(course.id)] });
  return c.json({ ok: true, listed });
}
digitalLmsRoutes.post("/merchants/me/lms/courses/:id/publish-to-learn", requireAuth, (c) => setListing(c, true));
digitalLmsRoutes.post("/merchants/me/lms/courses/:id/unlist-from-learn", requireAuth, (c) => setListing(c, false));

digitalLmsRoutes.get("/merchants/me/lms/enrollments", requireAuth, async (c) => {
  const user = c.get("user");
  const store = await getMerchantStore(user.sub, c.req.header("X-Merchant-Id"));
  if (!store) return c.json({ error: "no_store" }, 404);
  if (!(await hasTable("store_lms_enrollments"))) return c.json({ enrollments: [] });

  const hasUser = await hasColumn("store_lms_enrollments", "user_id");
  const res = await db.execute({
    sql: `SELECT e.*, c.title AS course_title
          FROM store_lms_enrollments e LEFT JOIN edu_courses c ON c.id = e.course_id
          WHERE e.store_id = ? ORDER BY e.enrolled_at DESC LIMIT 500`,
    args: [String(store.id)],
  });
  const rows = res.rows as Row[];
  // Progress is what the learner has really done in Peebee Learn, not a number typed in once.
  const progress = new Map<string, { done: number; avg: number | null }>();
  const seatStatus = new Map<string, string>();
  const certified = new Set<string>();
  const totals = new Map<string, number>();
  if (hasUser && rows.length > 0) {
    const courseIds = [...new Set(rows.map((r) => String(r.course_id)))];
    const cm = courseIds.map(() => "?").join(",");
    if (await hasTable("edu_lessons")) {
      for (const r of (await db.execute({ sql: `SELECT course_id, COUNT(*) AS n FROM edu_lessons WHERE course_id IN (${cm}) GROUP BY course_id`, args: courseIds })).rows as Row[]) totals.set(String(r.course_id), Number(r.n));
    }
    if (await hasTable("edu_lesson_progress")) {
      for (const r of (await db.execute({ sql: `SELECT user_id, course_id, COUNT(*) AS n, AVG(best_score_percent) AS a FROM edu_lesson_progress WHERE course_id IN (${cm}) GROUP BY user_id, course_id`, args: courseIds })).rows as Row[]) {
        progress.set(`${r.course_id}:${r.user_id}`, { done: Number(r.n), avg: r.a == null ? null : Math.round(Number(r.a)) });
      }
    }
    if (await hasTable("edu_enrollments")) {
      for (const r of (await db.execute({ sql: `SELECT course_id, user_id, status FROM edu_enrollments WHERE course_id IN (${cm})`, args: courseIds })).rows as Row[]) seatStatus.set(`${r.course_id}:${r.user_id}`, String(r.status));
    }
    if (await hasTable("edu_certificates")) {
      for (const r of (await db.execute({ sql: `SELECT course_id, user_id FROM edu_certificates WHERE course_id IN (${cm})`, args: courseIds })).rows as Row[]) certified.add(`${r.course_id}:${r.user_id}`);
    }
  }

  const enrollments = rows.map((r) => {
    const key = `${r.course_id}:${r.user_id}`;
    const total = hasUser && r.user_id ? totals.get(String(r.course_id)) ?? Number(r.total_lessons) ?? 0 : Number(r.total_lessons) || 0;
    const p = hasUser && r.user_id ? progress.get(key) : undefined;
    const done = p?.done ?? Number(r.completed_lessons) ?? 0;
    const seat = hasUser && r.user_id ? seatStatus.get(key) : undefined;
    return {
      id: String(r.id),
      store_id: String(r.store_id),
      course_id: String(r.course_id),
      course_title: r.course_title ? String(r.course_title) : "Course",
      student_name: String(r.student_name),
      student_phone: String(r.student_phone),
      student_email: r.student_email ? String(r.student_email) : undefined,
      progress_percent: total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0,
      completed_lessons: done,
      total_lessons: total,
      quiz_average_score: p?.avg ?? (r.quiz_average_score != null ? Number(r.quiz_average_score) : null),
      certificate_issued: certified.has(key) || Boolean(r.certificate_issued),
      certificate_url: r.certificate_url ? String(r.certificate_url) : null,
      enrolled_at: String(r.enrolled_at),
      last_active_at: String(r.last_active_at),
      access_status: seat && seat !== "active" ? "suspended" : total > 0 && done >= total ? "completed" : ((r.access_status as any) || "active"),
      learn_portal_url: `https://app.peebee.online/learn/course/${String(r.course_id)}`,
    };
  });
  return c.json({ enrollments });
});

digitalLmsRoutes.post("/merchants/me/lms/enrollments", requireAuth, async (c) => {
  const user = c.get("user");
  const store = await getMerchantStore(user.sub, c.req.header("X-Merchant-Id"));
  if (!store) return c.json({ error: "no_store" }, 404);

  const parsedEnrol = enrollmentSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsedEnrol.success) {
    return c.json({ error: "invalid_input", message: "Course, student name and a valid phone are required.", issues: parsedEnrol.error.issues }, 400);
  }
  const { courseId, studentName, studentPhone } = parsedEnrol.data;
  const studentEmail = parsedEnrol.data.studentEmail ?? "";
  const pendingEnrol = await migrationPending(c, "0133_merchant_tier3_digital_products_lms.sql", "store_lms_enrollments", "edu_enrollments", "edu_courses");
  if (pendingEnrol) return pendingEnrol;
  const storeId = String(store.id);

  // Only the merchant's own courses, and only in a school this account owns.
  const own = await db.execute({
    sql: `SELECT c.id, c.title, c.status FROM edu_courses c LEFT JOIN edu_schools s ON s.id = c.school_id
          WHERE c.id = ? AND (s.owner_id = ? OR (? IS NOT NULL AND c.school_id = ?))`,
    args: [courseId, user.sub, store.learn_school_id ? String(store.learn_school_id) : null, store.learn_school_id ? String(store.learn_school_id) : null],
  });
  const course = own.rows[0] as Row | undefined;
  if (!course) return c.json({ error: "forbidden", message: "You can only enrol students on your own courses." }, 403);

  const student = await resolveStudent({ name: studentName, phone: studentPhone, email: studentEmail });
  if (!student.ok) return c.json({ error: student.error, message: student.message }, student.status);

  const environment = await getPlatformEnvironment();
  const phone = normalizePhone(studentPhone)!;
  const seat = await enrollStudent({ storeId, courseId, userId: student.userId, name: studentName, phone, email: studentEmail, pricePaid: 0, commission: 0, environment });
  if (!seat) return c.json({ error: "enrolment_failed", message: "We couldn't enrol the student. Please try again." }, 500);
  if (!seat.created) return c.json({ error: "already_enrolled", message: `${studentName} is already enrolled in this course.` }, 409);

  // Tell the student by the channel that matches how their account was made, and report what really happened.
  const welcome = studentWelcome({ name: studentName, courseTitle: String(course.title), storeName: String(store.name), courseId, created: student.created });
  let notice: { channel: string; status: string; error?: string } | null = null;
  if (student.invite === "email" && studentEmail) {
    notice = { channel: "email", ...(await emailStudent(studentEmail, welcome.email)) };
  } else if (parsedEnrol.data.sendSmsNotice || student.created) {
    const sent = await sendStoreSms({ storeId, phone, name: studentName, type: "order_confirmation", body: welcome.sms });
    notice = { channel: "sms", status: sent.status, ...(sent.error ? { error: sent.error } : {}) };
  }

  const portalUrl = `https://app.peebee.online/learn/course/${courseId}`;
  return c.json({
    ok: true,
    enrollment: {
      id: seat.storeRecordId ?? seat.enrollmentId,
      store_id: storeId,
      course_id: courseId,
      student_name: studentName,
      student_phone: phone,
      student_email: studentEmail,
      progress_percent: 0,
      completed_lessons: 0,
      total_lessons: Number((await db.execute({ sql: "SELECT COUNT(*) AS n FROM edu_lessons WHERE course_id = ?", args: [courseId] })).rows[0]?.n) || 0,
      certificate_issued: false,
      certificate_url: null,
      enrolled_at: new Date().toISOString(),
      last_active_at: new Date().toISOString(),
      access_status: "active",
      learn_portal_url: portalUrl,
    },
    accountCreated: student.created,
    notice,
    learnPortalUrl: portalUrl,
  });
});

const CERT_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** Issue a certificate by hand (admin option "manual_issue"), once the student has finished every lesson. */
digitalLmsRoutes.post("/merchants/me/lms/enrollments/:id/certificate", requireAuth, async (c) => {
  const user = c.get("user");
  const store = await getMerchantStore(user.sub, c.req.header("X-Merchant-Id"));
  if (!store) return c.json({ error: "no_store" }, 404);
  const { lms_certificates: mode } = await getOptions(["lms_certificates"]);
  if (mode !== "manual_issue") return c.json({ error: "not_manual", message: mode === "off" ? "Certificates are switched off on this platform." : "Certificates are issued automatically when a student finishes." }, 409);
  if (!(await hasColumn("store_lms_enrollments", "user_id"))) return c.json({ error: "migration_pending", message: "Needs 0139_lms_hardening.sql." }, 503);
  const row = (await db.execute({ sql: "SELECT * FROM store_lms_enrollments WHERE id = ? AND store_id = ?", args: [c.req.param("id")!, String(store.id)] })).rows[0] as Row | undefined;
  if (!row || !row.user_id) return c.json({ error: "not_found", message: "That student isn't in your records." }, 404);
  if (!(await courseFinished(String(row.user_id), String(row.course_id)))) return c.json({ error: "not_finished", message: "The student hasn't finished every lesson yet." }, 409);
  const info = (await db.execute({
    sql: "SELECT c.title AS course_title, s.name AS school_name FROM edu_courses c JOIN edu_schools s ON s.id = c.school_id WHERE c.id = ?",
    args: [String(row.course_id)],
  })).rows[0] as Row | undefined;
  if (!info) return c.json({ error: "not_found" }, 404);
  const avg = (await db.execute({ sql: "SELECT AVG(best_score_percent) AS a FROM edu_lesson_progress WHERE user_id = ? AND course_id = ? AND best_score_percent IS NOT NULL", args: [String(row.user_id), String(row.course_id)] })).rows[0]?.a;
  const code = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => CERT_CHARS[b % CERT_CHARS.length]).join("");
  await db.execute({
    sql: "INSERT OR IGNORE INTO edu_certificates (id, code, course_id, user_id, learner_name, course_title, school_name, score_percent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: [newId("crt"), code, String(row.course_id), String(row.user_id), String(row.student_name), String(info.course_title), String(info.school_name), avg == null ? null : Math.round(Number(avg))],
  });
  await db.execute({ sql: "UPDATE store_lms_enrollments SET certificate_issued = 1 WHERE id = ?", args: [String(row.id)] });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Customer Public Storefront: Digital Products & Fulfillment Endpoints
// ---------------------------------------------------------------------------

digitalLmsRoutes.get("/marketplace/stores/:id/digital-products", async (c) => {
  const requested = c.req.param("id")!;
  const publicStore = await findPublicStore(requested);
  const demoStore = !publicStore && (await demoCatalogAllowed()) && DEMO_DIGITAL_PRODUCTS.some((p) => p.store_id === requested);
  if (!publicStore && !demoStore) return c.json({ digitalProducts: [], courses: [] });
  const storeId = publicStore ? String(publicStore.id) : requested;

  let digitalProducts: StoreDigitalProduct[] = [];
  if (publicStore && (await hasTable("store_digital_products"))) {
    const res = await db.execute({
      sql: "SELECT * FROM store_digital_products WHERE store_id = ? AND status = 'published' ORDER BY created_at DESC",
      args: [storeId],
    });
    const soldOut = await soldOutLicenseProducts(storeId);
    digitalProducts = (res.rows as Row[]).map((r) => ({
      sold_out: soldOut.has(String(r.id)),
      id: String(r.id),
      store_id: String(r.store_id),
      title: String(r.title),
      kind: (r.kind as any) || "download",
      description: r.description ? String(r.description) : null,
      price_ugx: Number(r.price_ugx) || 0,
      compare_at_price_ugx: r.compare_at_price_ugx != null ? Number(r.compare_at_price_ugx) : null,
      file_url: null, // the file is only ever reached through a purchase token
      file_name: r.file_name ? String(r.file_name) : null,
      file_size_bytes: r.file_size_bytes != null ? Number(r.file_size_bytes) : null,
      mime_type: r.mime_type ? String(r.mime_type) : null,
      max_downloads: Number(r.max_downloads ?? 5),
      expiry_days: Number(r.expiry_days ?? 30),
      license_keys_pool: null, // do not leak license pool publicly
      delivery_instructions: null, // shown with the purchase, not before it
      cover_image_url: r.cover_image_url ? String(r.cover_image_url) : null,
      linked_course_id: r.linked_course_id ? String(r.linked_course_id) : null,
      status: "published",
      downloads_count: Number(r.downloads_count) || 0,
      sales_count: Number(r.sales_count) || 0,
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
    }));
  }

  // Only the platform's own demo store shows demo items; a real store shows what it really sells.
  if (demoStore) {
    digitalProducts = DEMO_DIGITAL_PRODUCTS.filter((p) => p.store_id === requested).map((p) => ({ ...p, file_url: null, license_keys_pool: null, delivery_instructions: null }));
  }

  let courses: Row[] = [];
  if (publicStore && (await hasTable("edu_courses")) && (await hasColumn("edu_courses", "store_id"))) {
    const crsRes = await db.execute({
      sql: "SELECT id, school_id, title, summary, stream, price_ugx, status, created_at FROM edu_courses WHERE store_id = ? AND status = 'published' ORDER BY created_at DESC",
      args: [storeId],
    });
    courses = crsRes.rows as Row[];
  }

  return c.json({
    digitalProducts,
    courses: demoStore ? DEMO_LMS_COURSES : courses,
  });
});
