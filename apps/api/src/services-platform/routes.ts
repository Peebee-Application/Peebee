import { patchSchema } from "../lib/patch-schema.js";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { logActivity } from "../admin/activity.js";
import { requirePermission } from "../admin/permissions.js";
import { clientIp } from "../lib/ratelimit.js";
import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { hasColumn, hasTable } from "../lib/schema.js";
import { getOptions } from "../lib/option-settings.js";
import { migrationPending, publicRateLimit } from "../lib/guards.js";
import { proofIsValid } from "../lib/phone-proof.js";
import { dateString, eatInstant, httpsUrl, phoneString, timeString } from "../lib/validation.js";
import { demoCatalogAllowed } from "../marketplace/public.js";
import { serviceBookingRoutes } from "./booking-routes.js";
import { getServicesPlatformSettings, setServicesPlatformSettings } from "./settings.js";
import type {
  ServiceBusinessProfile,
  ServiceOffering,
  ServiceStaffMember,
  ServiceBookingRecord,
  ServiceBusinessCategory,
  ServicePricingModel,
  ServiceLocationModel,
  ServicePaymentRail,
} from "@peebee/shared";

export const servicesPlatformRoutes = new Hono();

// Slots, booking, payment, cancellation and refunds live in their own router; mounted first so its paths win.
servicesPlatformRoutes.route("/", serviceBookingRoutes);

type Row = Record<string, unknown>;

// Demo fallback business for sandbox and immediate exploration
export const DEMO_SERVICE_BUSINESS: ServiceBusinessProfile = {
  id: "sbiz_demo_apex_consulting",
  owner_id: "usr_demo_service_pro",
  name: "Apex Engineering & Strategy Advisory",
  slug: "apex-engineering-advisory",
  tagline: "Certified Civil, Solar, and Commercial Facility Engineering Services",
  description: "Specialized engineering audits, cold-room refrigeration design, structural site inspections, and commercial solar commissioning across Uganda.",
  category: "consultation",
  phone: "+256 701 556 778",
  whatsapp: "+256 701 556 778",
  email: "contact@apexadvisory.ug",
  address: "Plot 42, Lumumba Avenue, Nakasero",
  city: "Kampala",
  service_area: "Greater Kampala, Entebbe, Jinja, Wakiso",
  logo_url: "https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=300&q=80",
  banner_url: "https://images.unsplash.com/photo-1541888946425-d0fbb186f5f7?auto=format&fit=crop&w=1200&q=80",
  cancellation_policy: "Free cancellation or rescheduling up to 24 hours prior to appointment time.",
  allowed_payment_rails: ["momo_mtn", "momo_airtel", "cash_at_venue", "bank_wire"],
  custom_domain: null,
  is_open: true,
  status: "active",
  created_at: new Date(Date.now() - 30 * 86400000).toISOString(),
  updated_at: new Date().toISOString(),
};

export const DEMO_SERVICE_OFFERINGS: ServiceOffering[] = [
  {
    id: "sofr_demo_site_audit",
    business_id: "sbiz_demo_apex_consulting",
    title: "Commercial Solar & Inverter Efficiency Site Audit",
    slug: "commercial-solar-site-audit",
    category: "home_trades",
    description: "On-site engineering inspection using thermal imaging to detect battery bank hotspots, inverter clipping, and AC cable losses.",
    pricing_type: "fixed",
    price_ugx: 120000,
    deposit_ugx: 40000,
    compare_at_price_ugx: 180000,
    duration_minutes: 90,
    buffer_minutes: 30,
    location_type: "client_site",
    virtual_meeting_url: null,
    deliverables: [
      "Thermal infrared terminal scan",
      "Inverter harmonic and surge capacity benchmark",
      "Executive PDF report with payback projections",
    ],
    is_active: true,
    bookings_count: 38,
    created_at: new Date(Date.now() - 20 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "sofr_demo_virtual_advisory",
    business_id: "sbiz_demo_apex_consulting",
    title: "1-on-1 Commercial Facility Architecture Strategy Call",
    slug: "facility-architecture-strategy-call",
    category: "consultation",
    description: "Live 60-minute virtual consultation with a senior registered engineer to review architectural plans and MEP schematics.",
    pricing_type: "hourly",
    price_ugx: 65000,
    deposit_ugx: 30000,
    compare_at_price_ugx: 100000,
    duration_minutes: 60,
    buffer_minutes: 15,
    location_type: "virtual",
    virtual_meeting_url: "https://meet.google.com/peebee-apex-demo",
    deliverables: [
      "60-minute Google Meet consultation",
      "Blueprint & compliance checklist review",
      "Written summary with recommended revisions",
    ],
    is_active: true,
    bookings_count: 54,
    created_at: new Date(Date.now() - 18 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "sofr_demo_turnkey_quote",
    business_id: "sbiz_demo_apex_consulting",
    title: "Full Turnkey Commercial Refrigeration Fit-Out (Custom Quote)",
    slug: "commercial-refrigeration-fitout-quote",
    category: "tech_creative",
    description: "Custom turnkey project quote for supermarkets, food processors, and cold hubs requiring end-to-end installation and maintenance SLA.",
    pricing_type: "custom_quote",
    price_ugx: 0,
    deposit_ugx: null,
    compare_at_price_ugx: null,
    duration_minutes: 120,
    buffer_minutes: 30,
    location_type: "in_facility",
    virtual_meeting_url: null,
    deliverables: [
      "Dedicated senior project manager assigned",
      "Complete bill of quantities (BOQ) preparation",
      "Binding commercial proposal within 48 business hours",
    ],
    is_active: true,
    bookings_count: 19,
    created_at: new Date(Date.now() - 14 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export const DEMO_SERVICE_STAFF: ServiceStaffMember[] = [
  {
    id: "stf_demo_lead_eng",
    business_id: "sbiz_demo_apex_consulting",
    name: "Eng. David Kigozi, PE",
    role: "Lead Electrical & Renewable Energy Consultant",
    phone: "+256 701 556 778",
    email: "david.kigozi@apexadvisory.ug",
    is_active: true,
    created_at: new Date(Date.now() - 25 * 86400000).toISOString(),
  },
  {
    id: "stf_demo_mep_expert",
    business_id: "sbiz_demo_apex_consulting",
    name: "Arch. Fiona Namatovu",
    role: "Senior HVAC & Commercial Architecture Specialist",
    phone: "+256 772 112 233",
    email: "fiona.namatovu@apexadvisory.ug",
    is_active: true,
    created_at: new Date(Date.now() - 22 * 86400000).toISOString(),
  },
];

export const DEMO_SERVICE_BOOKINGS: ServiceBookingRecord[] = [
  {
    id: "sbk_demo_901",
    business_id: "sbiz_demo_apex_consulting",
    service_id: "sofr_demo_site_audit",
    service_title: "Commercial Solar & Inverter Efficiency Site Audit",
    customer_name: "Victoria Logistics Warehouse",
    customer_phone: "+256 702 444 888",
    customer_email: "maintenance@victoriagroup.ug",
    scheduled_date: new Date(Date.now() + 86400000).toISOString().split("T")[0],
    scheduled_time: "10:00",
    duration_minutes: 90,
    location_type: "client_site",
    address: "Plot 12, Old Port Bell Road, Luzira, Kampala",
    virtual_meeting_url: null,
    notes: "Main warehouse rooftop PV array tripping during 12:00 PM peak generation.",
    pricing_type: "fixed",
    total_price_ugx: 120000,
    deposit_ugx: 40000,
    payment_rail: "momo_mtn",
    payment_status: "deposit_paid",
    status: "confirmed",
    staff_id: "stf_demo_lead_eng",
    staff_name: "Eng. David Kigozi, PE",
    created_at: new Date(Date.now() - 40000000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "sbk_demo_902",
    business_id: "sbiz_demo_apex_consulting",
    service_id: "sofr_demo_virtual_advisory",
    service_title: "1-on-1 Commercial Facility Architecture Strategy Call",
    customer_name: "Kagera Agro Ventures",
    customer_phone: "+256 782 999 111",
    customer_email: "projects@kageraagro.com",
    scheduled_date: new Date(Date.now() + 2 * 86400000).toISOString().split("T")[0],
    scheduled_time: "15:30",
    duration_minutes: 60,
    location_type: "virtual",
    address: null,
    virtual_meeting_url: "https://meet.google.com/peebee-apex-demo",
    notes: "Need guidance on insulation R-values for fruit storage facility in Mbarara.",
    pricing_type: "hourly",
    total_price_ugx: 65000,
    deposit_ugx: 30000,
    payment_rail: "momo_airtel",
    payment_status: "deposit_paid",
    status: "confirmed",
    staff_id: "stf_demo_mep_expert",
    staff_name: "Arch. Fiona Namatovu",
    created_at: new Date(Date.now() - 20000000).toISOString(),
    updated_at: new Date().toISOString(),
  },
];

/** Structural rail: the public site is an allow-list. `owner_id`, `custom_domain` and review state stay private. */
const PUBLIC_SERVICE_BUSINESS_FIELDS = [
  "id", "name", "slug", "tagline", "description", "category", "phone", "whatsapp", "email", "address", "city",
  "service_area", "logo_url", "banner_url", "cancellation_policy", "allowed_payment_rails", "is_open",
] as const;

function toPublicServiceBusiness(biz: Row): Row {
  const out: Row = {};
  for (const key of PUBLIC_SERVICE_BUSINESS_FIELDS) if (key in biz) out[key] = biz[key];
  return out;
}

async function getServiceBusinessForUser(userId: string): Promise<Row | null> {
  if (!(await hasTable("service_businesses"))) return null;
  const res = await db.execute({
    sql: "SELECT * FROM service_businesses WHERE owner_id = ? LIMIT 1",
    args: [userId],
  });
  return (res.rows[0] as Row | undefined) ?? null;
}

// -----------------------------------------------------------------
// 1. BUSINESS PROFILE MANAGEMENT
// -----------------------------------------------------------------

// GET /v1/services-platform/my-business
servicesPlatformRoutes.get("/my-business", requireAuth, async (c) => {
  const user = c.get("user");
  const biz = await getServiceBusinessForUser(user.sub);

  if (!biz) {
    return c.json({ business: null });
  }

  let rails: ServicePaymentRail[] = ["momo_mtn", "momo_airtel", "cash_at_venue"];
  try {
    rails = JSON.parse(String(biz.allowed_payment_rails || "[]"));
  } catch {}

  return c.json({
    business: {
      ...biz,
      allowed_payment_rails: rails,
      is_open: Boolean(biz.is_open),
    },
  });
});

// POST /v1/services-platform/my-business (Launch Service Business)
const createBusinessSchema = z.object({
  name: z.string().min(2).max(120),
  category: z.enum([
    "consultation",
    "health_wellness",
    "home_trades",
    "tech_creative",
    "beauty_salon",
    "events_hospitality",
    "education_coaching",
    "automotive_repairs",
  ]),
  tagline: z.string().max(200).optional().default(""),
  description: z.string().max(2000).optional().default(""),
  phone: phoneString,
  whatsapp: z.string().max(30).optional().default(""),
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().max(200).optional().default(""),
  city: z.string().max(80).default("Kampala"),
  service_area: z.string().max(200).default("Greater Kampala"),
  logo_url: httpsUrl().optional().default(""),
  banner_url: httpsUrl().optional().default(""),
  cancellation_policy: z.string().max(500).optional().default("Free cancellation up to 24 hours prior to appointment"),
  allowed_payment_rails: z.array(z.enum(["momo_mtn", "momo_airtel", "cash_at_venue", "bank_wire"])).default(["momo_mtn", "momo_airtel", "cash_at_venue"]),
});

servicesPlatformRoutes.post("/my-business", requireAuth, async (c) => {
  const user = c.get("user");
  const pending = await migrationPending(c, "0134_standalone_services_platform.sql", "service_businesses");
  if (pending) return pending;
  const existing = await getServiceBusinessForUser(user.sub);
  if (existing) {
    return c.json({ error: "already_exists", message: "You already have an active service business profile." }, 400);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = createBusinessSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body", details: parsed.error.issues }, 400);
  }

  const data = parsed.data;
  const businessId = newId("sbiz");
  const { services_business_approval: approval } = await getOptions(["services_business_approval"]);
  let verifiedUser = false;
  if (await hasColumn("users", "phone_verified_at")) {
    const u = await db.execute({ sql: "SELECT phone_verified_at FROM users WHERE id = ?", args: [user.sub] });
    verifiedUser = Boolean(u.rows[0]?.phone_verified_at);
  }
  const businessStatus = approval === "auto_approve_all" || (approval === "auto_approve_verified_users" && verifiedUser) ? "active" : "pending_review";
  const slug = data.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80) + "-" + Math.random().toString(36).substring(2, 6);

  if (await hasTable("service_businesses")) {
    await db.execute({
      sql: `INSERT INTO service_businesses (
        id, owner_id, name, slug, tagline, description, category,
        phone, whatsapp, email, address, city, service_area,
        logo_url, banner_url, cancellation_policy, allowed_payment_rails,
        is_open, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      args: [
        businessId,
        user.sub,
        data.name,
        slug,
        data.tagline || "",
        data.description || "",
        data.category,
        data.phone,
        data.whatsapp || "",
        data.email || "",
        data.address || "",
        data.city,
        data.service_area,
        data.logo_url || "",
        data.banner_url || "",
        data.cancellation_policy,
        JSON.stringify(data.allowed_payment_rails),
        businessStatus,
      ],
    });
  }

  return c.json({
    ok: true,
    business: {
      id: businessId,
      owner_id: user.sub,
      slug,
      ...data,
      is_open: true,
      status: businessStatus,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  });
});

// PUT /v1/services-platform/my-business
servicesPlatformRoutes.put("/my-business", requireAuth, async (c) => {
  const user = c.get("user");
  const biz = await getServiceBusinessForUser(user.sub);
  if (!biz) return c.json({ error: "no_business", message: "Service business not found" }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = patchSchema(createBusinessSchema).safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body", details: parsed.error.issues }, 400);
  }

  const data = parsed.data;
  const updates: string[] = ["updated_at = CURRENT_TIMESTAMP"];
  const args: any[] = [];

  if (data.name != null) { updates.push("name = ?"); args.push(data.name); }
  if (data.tagline != null) { updates.push("tagline = ?"); args.push(data.tagline); }
  if (data.description != null) { updates.push("description = ?"); args.push(data.description); }
  if (data.category != null) { updates.push("category = ?"); args.push(data.category); }
  if (data.phone != null) { updates.push("phone = ?"); args.push(data.phone); }
  if (data.whatsapp != null) { updates.push("whatsapp = ?"); args.push(data.whatsapp); }
  if (data.email != null) { updates.push("email = ?"); args.push(data.email); }
  if (data.address != null) { updates.push("address = ?"); args.push(data.address); }
  if (data.city != null) { updates.push("city = ?"); args.push(data.city); }
  if (data.service_area != null) { updates.push("service_area = ?"); args.push(data.service_area); }
  if (data.logo_url != null) { updates.push("logo_url = ?"); args.push(data.logo_url); }
  if (data.banner_url != null) { updates.push("banner_url = ?"); args.push(data.banner_url); }
  if (data.cancellation_policy != null) { updates.push("cancellation_policy = ?"); args.push(data.cancellation_policy); }
  if (data.allowed_payment_rails != null) { updates.push("allowed_payment_rails = ?"); args.push(JSON.stringify(data.allowed_payment_rails)); }

  args.push(String(biz.id));
  await db.execute({
    sql: `UPDATE service_businesses SET ${updates.join(", ")} WHERE id = ?`,
    args,
  });

  return c.json({ ok: true, updated: true });
});

// -----------------------------------------------------------------
// 2. SERVICE OFFERINGS
// -----------------------------------------------------------------

// GET /v1/services-platform/offerings
servicesPlatformRoutes.get("/offerings", requireAuth, async (c) => {
  const user = c.get("user");
  const biz = await getServiceBusinessForUser(user.sub);
  const demoOk = await demoCatalogAllowed();
  if (!biz || !(await hasTable("service_offerings"))) {
    return c.json({ offerings: demoOk ? DEMO_SERVICE_OFFERINGS : [] });
  }

  const res = await db.execute({
    sql: "SELECT * FROM service_offerings WHERE business_id = ? ORDER BY is_active DESC, created_at DESC",
    args: [String(biz.id)],
  });

  let offerings = res.rows as Row[];
  if (offerings.length === 0 && demoOk && String(biz.id).includes("demo")) {
    offerings = DEMO_SERVICE_OFFERINGS as unknown as Row[];
  }

  const parsed = offerings.map((o) => {
    let deliv: string[] = [];
    try { deliv = JSON.parse(String(o.deliverables_json || "[]")); } catch {}
    return {
      ...o,
      deliverables: deliv,
      is_active: Boolean(o.is_active),
    };
  });

  return c.json({ offerings: parsed });
});

// POST /v1/services-platform/offerings
const createOfferingSchema = z.object({
  title: z.string().min(2).max(180),
  category: z.string().default("appointment"),
  description: z.string().max(2500).optional().default(""),
  pricing_type: z.enum(["fixed", "hourly", "custom_quote", "deposit"]).default("fixed"),
  price_ugx: z.number().int().nonnegative().default(0),
  deposit_ugx: z.number().int().nonnegative().optional().nullable(),
  compare_at_price_ugx: z.number().int().nonnegative().optional().nullable(),
  duration_minutes: z.number().int().positive().default(60),
  buffer_minutes: z.number().int().nonnegative().default(15),
  location_type: z.enum(["in_facility", "client_site", "virtual"]).default("in_facility"),
  virtual_meeting_url: httpsUrl(500).optional().default(""),
  deliverables: z.array(z.string().max(200)).max(20).default([]),
  /** A photo for the service (migration 0164), shown in Buy next to the store's products. */
  image_url: httpsUrl(500).optional().default(""),
});

servicesPlatformRoutes.post("/offerings", requireAuth, async (c) => {
  const user = c.get("user");
  const pending = await migrationPending(c, "0134_standalone_services_platform.sql", "service_businesses", "service_offerings");
  if (pending) return pending;
  const biz = await getServiceBusinessForUser(user.sub);
  if (!biz) return c.json({ error: "no_business", message: "Launch a service business first." }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = createOfferingSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body", details: parsed.error.issues }, 400);
  }

  const data = parsed.data;
  const platform = await getServicesPlatformSettings();
  if (data.location_type === "virtual" && !platform.virtualConsultationsEnabled) {
    return c.json({ error: "virtual_disabled", message: "Virtual consultations are switched off on this platform." }, 403);
  }
  const countRes = await db.execute({ sql: "SELECT COUNT(*) AS n FROM service_offerings WHERE business_id = ? AND is_active = 1", args: [String(biz.id)] });
  if (Number(countRes.rows[0]?.n) >= platform.maxServicesPerBusiness) {
    return c.json({ error: "service_limit", message: `A business can list up to ${platform.maxServicesPerBusiness} services.` }, 403);
  }
  const offeringId = newId("sofr");
  const slug = data.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80) + "-" + Math.random().toString(36).substring(2, 6);

  if (await hasTable("service_offerings")) {
    await db.execute({
      sql: `INSERT INTO service_offerings (
        id, business_id, title, slug, category, description,
        pricing_type, price_ugx, deposit_ugx, compare_at_price_ugx,
        duration_minutes, buffer_minutes, location_type, virtual_meeting_url,
        deliverables_json, is_active, bookings_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      args: [
        offeringId,
        String(biz.id),
        data.title,
        slug,
        data.category,
        data.description || "",
        data.pricing_type,
        data.price_ugx,
        data.deposit_ugx ?? null,
        data.compare_at_price_ugx ?? null,
        data.duration_minutes,
        data.buffer_minutes,
        data.location_type,
        data.virtual_meeting_url || "",
        JSON.stringify(data.deliverables || []),
      ],
    });
    if (data.image_url && (await hasColumn("service_offerings", "image_url"))) {
      await db.execute({ sql: "UPDATE service_offerings SET image_url = ? WHERE id = ?", args: [data.image_url, offeringId] });
    }
  }

  return c.json({
    ok: true,
    offering: {
      id: offeringId,
      business_id: String(biz.id),
      slug,
      ...data,
      is_active: true,
      bookings_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  });
});

// DELETE /v1/services-platform/offerings/:id
servicesPlatformRoutes.delete("/offerings/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const biz = await getServiceBusinessForUser(user.sub);
  if (!biz) return c.json({ error: "no_business" }, 404);

  const offeringId = c.req.param("id")!;
  if (await hasTable("service_offerings")) {
    // Archive rather than delete: past bookings keep pointing at the service they were made for.
    await db.execute({
      sql: "UPDATE service_offerings SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND business_id = ?",
      args: [offeringId, String(biz.id)],
    });
  }

  return c.json({ ok: true, deleted: offeringId });
});

// -----------------------------------------------------------------
// 3. STAFF & SPECIALISTS
// -----------------------------------------------------------------

// GET /v1/services-platform/staff
servicesPlatformRoutes.get("/staff", requireAuth, async (c) => {
  const user = c.get("user");
  const biz = await getServiceBusinessForUser(user.sub);
  const demoOk = await demoCatalogAllowed();
  if (!biz || !(await hasTable("service_staff_members"))) return c.json({ staff: demoOk ? DEMO_SERVICE_STAFF : [] });

  const res = await db.execute({
    sql: "SELECT * FROM service_staff_members WHERE business_id = ? AND is_active = 1 ORDER BY created_at DESC",
    args: [String(biz.id)],
  });

  return c.json({ staff: res.rows });
});

// POST /v1/services-platform/staff
const createStaffMemberSchema = z.object({
  name: z.string().min(2).max(100),
  role: z.string().min(2).max(100).default("Specialist"),
  phone: phoneString,
  email: z.string().email().optional().or(z.literal("")),
});

servicesPlatformRoutes.post("/staff", requireAuth, async (c) => {
  const user = c.get("user");
  const pending = await migrationPending(c, "0134_standalone_services_platform.sql", "service_businesses", "service_staff_members");
  if (pending) return pending;
  const biz = await getServiceBusinessForUser(user.sub);
  if (!biz) return c.json({ error: "no_business" }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = createStaffMemberSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body", details: parsed.error.issues }, 400);
  }

  const staffId = newId("stf");
  if (await hasTable("service_staff_members")) {
    await db.execute({
      sql: "INSERT INTO service_staff_members (id, business_id, name, role, phone, email, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)",
      args: [staffId, String(biz.id), parsed.data.name, parsed.data.role, parsed.data.phone, parsed.data.email || ""],
    });
  }

  return c.json({
    ok: true,
    staff: {
      id: staffId,
      business_id: String(biz.id),
      ...parsed.data,
      is_active: true,
      created_at: new Date().toISOString(),
    },
  });
});

// -----------------------------------------------------------------
// 4. BOOKING & APPOINTMENT CRM
// -----------------------------------------------------------------

// GET /v1/services-platform/bookings
servicesPlatformRoutes.get("/bookings", requireAuth, async (c) => {
  const user = c.get("user");
  const biz = await getServiceBusinessForUser(user.sub);
  const demoOk = await demoCatalogAllowed();
  if (!biz) return c.json({ bookings: demoOk ? DEMO_SERVICE_BOOKINGS : [] });

  const statusFilter = c.req.query("status");

  if (!(await hasTable("service_bookings"))) {
    let list = demoOk ? DEMO_SERVICE_BOOKINGS : [];
    if (statusFilter && statusFilter !== "all") {
      list = list.filter((b) => b.status === statusFilter);
    }
    return c.json({ bookings: list });
  }

  let sql = `
    SELECT b.*, o.title as service_title
    FROM service_bookings b
    LEFT JOIN service_offerings o ON b.service_id = o.id
    WHERE b.business_id = ?
  `;
  const args: any[] = [String(biz.id)];

  if (statusFilter && statusFilter !== "all") {
    sql += " AND b.status = ?";
    args.push(statusFilter);
  }

  sql += " ORDER BY b.scheduled_date ASC, b.scheduled_time ASC, b.created_at DESC";

  const res = await db.execute({ sql, args });
  let rows = res.rows as Row[];
  if (rows.length === 0 && demoOk && String(biz.id).includes("demo")) {
    rows = DEMO_SERVICE_BOOKINGS as unknown as Row[];
  }

  return c.json({ bookings: rows });
});

// POST /v1/services-platform/bookings (Manual Walk-In Entry)
const createManualBookingSchema = z.object({
  service_id: z.string(),
  customer_name: z.string().min(2).max(120),
  customer_phone: phoneString,
  customer_email: z.string().email().optional().or(z.literal("")),
  scheduled_date: dateString,
  scheduled_time: timeString,
  location_type: z.enum(["in_facility", "client_site", "virtual"]).default("in_facility"),
  address: z.string().max(300).optional().default(""),
  notes: z.string().max(1000).optional().default(""),
  payment_rail: z.enum(["momo_mtn", "momo_airtel", "cash_at_venue", "bank_wire"]).default("cash_at_venue"),
  staff_id: z.string().optional().nullable(),
});

servicesPlatformRoutes.post("/bookings", requireAuth, async (c) => {
  const user = c.get("user");
  const pending = await migrationPending(c, "0134_standalone_services_platform.sql", "service_businesses", "service_offerings", "service_bookings");
  if (pending) return pending;
  const biz = await getServiceBusinessForUser(user.sub);
  if (!biz) return c.json({ error: "no_business" }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = createManualBookingSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body", details: parsed.error.issues }, 400);
  }

  const data = parsed.data;
  let serviceTitle = "Specialist Service";
  let priceUgx = 0;
  let depositUgx = 0;
  let durationMins = 60;
  let pricingType = "fixed";

  if (await hasTable("service_offerings")) {
    const oRes = await db.execute({
      sql: "SELECT title, price_ugx, deposit_ugx, duration_minutes, pricing_type FROM service_offerings WHERE id = ? AND business_id = ?",
      args: [data.service_id, String(biz.id)],
    });
    if (oRes.rows.length === 0) {
      return c.json({ error: "unknown_service", message: "That service is not one of yours." }, 400);
    }
    const o = oRes.rows[0];
    serviceTitle = String(o.title);
    priceUgx = Number(o.price_ugx) || 0;
    depositUgx = Number(o.deposit_ugx) || 0;
    durationMins = Number(o.duration_minutes) || 60;
    pricingType = String(o.pricing_type || "fixed");
  }

  let staffName = "";
  if (data.staff_id && (await hasTable("service_staff_members"))) {
    const sRes = await db.execute({
      sql: "SELECT name FROM service_staff_members WHERE id = ? AND business_id = ? AND is_active = 1",
      args: [data.staff_id, String(biz.id)],
    });
    if (sRes.rows.length === 0) {
      return c.json({ error: "unknown_staff", message: "That team member is not on your roster." }, 400);
    }
    staffName = String(sRes.rows[0].name);
  }

  const bookingId = newId("sbk");

  if (await hasTable("service_bookings")) {
    await db.execute({
      sql: `INSERT INTO service_bookings (
        id, business_id, service_id, customer_name, customer_phone, customer_email,
        scheduled_date, scheduled_time, duration_minutes, location_type,
        address, notes, pricing_type, total_price_ugx, deposit_ugx,
        payment_rail, payment_status, status, staff_id, staff_name,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', 'confirmed', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      args: [
        bookingId,
        String(biz.id),
        data.service_id,
        data.customer_name,
        data.customer_phone,
        data.customer_email || "",
        data.scheduled_date,
        data.scheduled_time,
        durationMins,
        data.location_type,
        data.address || "",
        data.notes || "",
        pricingType,
        priceUgx,
        depositUgx,
        data.payment_rail,
        data.staff_id ?? null,
        staffName,
      ],
    });

    await db.execute({
      sql: "UPDATE service_offerings SET bookings_count = bookings_count + 1 WHERE id = ?",
      args: [data.service_id],
    });
  }

  return c.json({
    ok: true,
    booking: {
      id: bookingId,
      service_title: serviceTitle,
      ...data,
      total_price_ugx: priceUgx,
      staff_name: staffName,
      status: "confirmed",
      created_at: new Date().toISOString(),
    },
  });
});

// -----------------------------------------------------------------
// 5. PUBLIC DEDICATED SERVICE SITE (Standalone Customer Experience)
// -----------------------------------------------------------------

// GET /v1/services-platform/public/:slug
servicesPlatformRoutes.get("/public/:slug", async (c) => {
  const slug = c.req.param("slug")!;

  let biz: Row | null = null;
  if (await hasTable("service_businesses")) {
    const res = await db.execute({
      sql: `SELECT * FROM service_businesses WHERE status = 'active'
            AND (slug = ? OR id = ?) LIMIT 1`,
      args: [slug, slug],
    });
    biz = (res.rows[0] as Row | undefined) ?? null;
  }

  const demoSite = await demoCatalogAllowed();
  if (!biz && demoSite && (slug.includes("demo") || slug.includes("apex"))) {
    biz = DEMO_SERVICE_BUSINESS as unknown as Row;
  }

  if (!biz) {
    return c.json({ error: "not_found", message: "Service provider site not found" }, 404);
  }

  const bizId = String(biz.id);
  let offerings: Row[] = [];
  if (await hasTable("service_offerings")) {
    const oRes = await db.execute({
      sql: "SELECT * FROM service_offerings WHERE business_id = ? AND is_active = 1 ORDER BY bookings_count DESC, created_at DESC",
      args: [bizId],
    });
    offerings = oRes.rows as Row[];
  }
  if (offerings.length === 0 && demoSite && bizId.includes("demo")) {
    offerings = DEMO_SERVICE_OFFERINGS as unknown as Row[];
  }

  let staff: Row[] = [];
  if (await hasTable("service_staff_members")) {
    const sRes = await db.execute({
      sql: "SELECT id, name, role FROM service_staff_members WHERE business_id = ? AND is_active = 1",
      args: [bizId],
    });
    staff = sRes.rows as Row[];
  }
  if (staff.length === 0 && demoSite && bizId.includes("demo")) {
    staff = DEMO_SERVICE_STAFF as unknown as Row[];
  }

  let rails: ServicePaymentRail[] = ["momo_mtn", "momo_airtel", "cash_at_venue"];
  try {
    rails = JSON.parse(String(biz.allowed_payment_rails || "[]"));
  } catch {}

  const parsedOfferings = offerings.map((o) => {
    let deliv: string[] = [];
    try { deliv = JSON.parse(String(o.deliverables_json || "[]")); } catch {}
    return {
      ...o,
      deliverables: deliv,
      is_active: Boolean(o.is_active),
    };
  });

  return c.json({
    business: toPublicServiceBusiness({
      ...biz,
      allowed_payment_rails: rails,
      is_open: Boolean(biz.is_open),
    }),
    offerings: parsedOfferings,
    staff,
  });
});

// -----------------------------------------------------------------
// 6. ADMIN PLATFORM SETTINGS
// -----------------------------------------------------------------

servicesPlatformRoutes.get("/admin/settings", requireAuth, requireRole("admin"), requirePermission("settings.view"), async (c) => {
  const settings = await getServicesPlatformSettings();
  return c.json({ settings });
});

const adminSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  commissionPercent: z.number().min(0).max(100).optional(),
  leadTimeHours: z.number().int().min(0).max(72).optional(),
  maxServicesPerBusiness: z.number().int().min(1).max(500).optional(),
  disallowAggregatorForIntangibles: z.boolean().optional(),
  virtualConsultationsEnabled: z.boolean().optional(),
});

servicesPlatformRoutes.put("/admin/settings", requireAuth, requireRole("admin"), requirePermission("settings.manage"), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = adminSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body", details: parsed.error.issues }, 400);
  }

  const before = await getServicesPlatformSettings();
  await setServicesPlatformSettings(parsed.data);
  const updated = await getServicesPlatformSettings();
  await logActivity({
    actor: c.get("user"), action: "settings.update", entityType: "settings",
    summary: "Updated Services Platform settings", before: { services: before }, after: { services: updated }, ip: clientIp(c),
  });
  return c.json({ ok: true, settings: updated });
});

// Reviewing service businesses (see the `services_business_approval` option).
servicesPlatformRoutes.get("/admin/businesses", requireAuth, requireRole("admin"), requirePermission("settings.view"), async (c) => {
  if (!(await hasTable("service_businesses"))) return c.json({ businesses: [] });
  const status = c.req.query("status");
  const res = await db.execute({
    sql: `SELECT id, owner_id, name, slug, category, phone, city, status, created_at FROM service_businesses
          ${status ? "WHERE status = ?" : ""} ORDER BY created_at DESC LIMIT 200`,
    args: status ? [status] : [],
  });
  return c.json({ businesses: res.rows });
});

const reviewBusinessSchema = z.object({ decision: z.enum(["approve", "pause", "reactivate"]), note: z.string().max(500).optional() });

servicesPlatformRoutes.post("/admin/businesses/:id/review", requireAuth, requireRole("admin"), requirePermission("settings.manage"), async (c) => {
  const parsed = reviewBusinessSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body", details: parsed.error.issues }, 400);
  if (!(await hasTable("service_businesses"))) return c.json({ error: "not_found" }, 404);
  const id = c.req.param("id")!;
  const found = await db.execute({ sql: "SELECT id, name, status FROM service_businesses WHERE id = ?", args: [id] });
  const biz = found.rows[0];
  if (!biz) return c.json({ error: "not_found" }, 404);
  const next = parsed.data.decision === "pause" ? "paused" : "active";
  await db.execute({ sql: "UPDATE service_businesses SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", args: [next, id] });
  await logActivity({
    actor: c.get("user"), action: `services.business_${parsed.data.decision}`, entityType: "service_business", entityId: id,
    summary: `${parsed.data.decision === "pause" ? "Paused" : "Approved"} service business ${String(biz.name)}${parsed.data.note ? ` — ${parsed.data.note}` : ""}`,
    before: { status: biz.status }, after: { status: next }, ip: clientIp(c),
  });
  return c.json({ ok: true, id, status: next });
});
