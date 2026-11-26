import { Hono } from "hono";
import { z } from "zod";
import type { LearnSettings } from "@peebee/shared";
import { db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { consume, tooManyRequests } from "../lib/ratelimit.js";
import { hasTable } from "../lib/schema.js";
import { getPlatformEnvironment } from "../lib/settings.js";
import { creditWallet } from "../wallet/service.js";
import { chargeAndPayOut } from "./payments.js";
import { getLearnSettings } from "./settings.js";
import { body as readBody, count, fail, gate, isResponse, notFound, one, ownedCourse, ownedSchool, suspended } from "./studio.js";

type Row = Record<string, unknown>;

/** Coupons, bundles and school passes come with migration 0119; until then none of it exists. */
export const salesReady = () => hasTable("edu_coupons");

// ---------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------

export type Coupon = { id: string; schoolId: string; code: string; percentOff: number | null; amountOffUgx: number | null; courseId: string | null; maxUses: number | null; usedCount: number };

const couponOf = (r: Row): Coupon => ({
  id: String(r.id),
  schoolId: String(r.school_id),
  code: String(r.code),
  percentOff: r.percent_off === null ? null : Number(r.percent_off),
  amountOffUgx: r.amount_off_ugx === null ? null : Number(r.amount_off_ugx),
  courseId: r.course_id ? String(r.course_id) : null,
  maxUses: r.max_uses === null ? null : Number(r.max_uses),
  usedCount: Number(r.used_count),
});

/** What a valid coupon takes off a price. Never more than Admin's cap, and never more than the price. */
export function discountFor(coupon: Pick<Coupon, "percentOff" | "amountOffUgx">, price: number, settings: Pick<LearnSettings, "maxCouponPercent">): number {
  const raw = coupon.percentOff !== null ? Math.floor((price * coupon.percentOff) / 100) : (coupon.amountOffUgx ?? 0);
  return Math.max(0, Math.min(raw, Math.floor((price * settings.maxCouponPercent) / 100), price));
}

export async function quoteCoupon(
  code: string,
  course: Row,
  userId: string,
  price: number,
  settings: LearnSettings,
): Promise<{ ok: true; coupon: Coupon; discount: number } | { ok: false; message: string }> {
  if (!settings.couponsEnabled) return { ok: false, message: "Coupons are switched off right now." };
  if (!(await salesReady())) return { ok: false, message: "That coupon code isn't valid." };
  const row = (await db.execute({ sql: "SELECT * FROM edu_coupons WHERE code = ?", args: [code.trim().toUpperCase().slice(0, 40)] })).rows[0] as Row | undefined;
  const bad = (message = "That coupon code isn't valid for this course.") => ({ ok: false as const, message });
  if (!row || Number(row.active) !== 1) return bad();
  if (row.school_id !== course.school_id) return bad();
  if (row.course_id && row.course_id !== course.id) return bad();
  if (row.expires_at && Date.parse(String(row.expires_at)) < Date.now()) return bad("That coupon has expired.");
  if (row.max_uses !== null && Number(row.used_count) >= Number(row.max_uses)) return bad("That coupon has been used up.");
  const used = await one("SELECT 1 AS y FROM edu_coupon_redemptions WHERE coupon_id = ? AND user_id = ?", [row.id, userId]);
  if (used) return bad("You've already used that coupon.");
  const coupon = couponOf(row);
  const discount = discountFor(coupon, price, settings);
  if (discount <= 0) return bad("That coupon doesn't take anything off this course.");
  return { ok: true, coupon, discount };
}

/** Claims one use of a coupon for this learner. False means somebody else took the last use or they used it already. */
export async function reserveCoupon(coupon: Coupon, userId: string, courseId: string, discount: number): Promise<boolean> {
  const taken = await db.execute({
    sql: `UPDATE edu_coupons SET used_count = used_count + 1
          WHERE id = ? AND active = 1 AND (max_uses IS NULL OR used_count < max_uses) AND (expires_at IS NULL OR expires_at > ?)`,
    args: [coupon.id, new Date().toISOString()],
  });
  if ((taken.rowsAffected ?? 0) === 0) return false;
  const row = await db.execute({ sql: "INSERT OR IGNORE INTO edu_coupon_redemptions (coupon_id, user_id, course_id, discount_ugx) VALUES (?, ?, ?, ?)", args: [coupon.id, userId, courseId, discount] });
  if ((row.rowsAffected ?? 0) === 0) {
    await db.execute({ sql: "UPDATE edu_coupons SET used_count = used_count - 1 WHERE id = ? AND used_count > 0", args: [coupon.id] });
    return false;
  }
  return true;
}

export async function releaseCoupon(coupon: Coupon, userId: string): Promise<void> {
  const gone = await db.execute({ sql: "DELETE FROM edu_coupon_redemptions WHERE coupon_id = ? AND user_id = ?", args: [coupon.id, userId] });
  if ((gone.rowsAffected ?? 0) > 0) await db.execute({ sql: "UPDATE edu_coupons SET used_count = used_count - 1 WHERE id = ? AND used_count > 0", args: [coupon.id] });
}

// ---------------------------------------------------------------------------
// School passes
// ---------------------------------------------------------------------------

export async function activeSubscription(userId: string, schoolId: string): Promise<{ id: string; startedAt: string; expiresAt: string } | null> {
  if (!(await salesReady())) return null;
  const r = (
    await db.execute({
      sql: "SELECT id, started_at, expires_at FROM edu_subscriptions WHERE user_id = ? AND school_id = ? AND expires_at > datetime('now') ORDER BY expires_at DESC LIMIT 1",
      args: [userId, schoolId],
    })
  ).rows[0] as Row | undefined;
  return r ? { id: String(r.id), startedAt: String(r.started_at), expiresAt: String(r.expires_at) } : null;
}

/** The bundles and passes that include a course, for its page. Only published ones from a school in good standing. */
export async function offersForCourse(courseId: string, schoolId: string): Promise<{ bundles: { id: string; title: string; priceUgx: number; courseCount: number }[]; plans: { id: string; title: string; priceUgx: number; days: number }[] }> {
  if (!(await salesReady())) return { bundles: [], plans: [] };
  const bundles = (
    await db.execute({
      sql: `SELECT b.id, b.title, b.price_ugx, (SELECT COUNT(*) FROM edu_bundle_courses x WHERE x.bundle_id = b.id) AS n
            FROM edu_bundles b JOIN edu_bundle_courses bc ON bc.bundle_id = b.id
            WHERE bc.course_id = ? AND b.status = 'published' ORDER BY b.price_ugx ASC LIMIT 10`,
      args: [courseId],
    })
  ).rows as Row[];
  const plans = (await db.execute({ sql: "SELECT id, title, price_ugx, days FROM edu_plans WHERE school_id = ? AND status = 'published' ORDER BY price_ugx ASC LIMIT 10", args: [schoolId] })).rows as Row[];
  return {
    bundles: bundles.map((b) => ({ id: String(b.id), title: String(b.title), priceUgx: Number(b.price_ugx), courseCount: Number(b.n) })),
    plans: plans.map((p) => ({ id: String(p.id), title: String(p.title), priceUgx: Number(p.price_ugx), days: Number(p.days) })),
  };
}

// ---------------------------------------------------------------------------
// Learner routes
// ---------------------------------------------------------------------------

export const salesLearnRoutes = new Hono();

const notReady = (c: Parameters<typeof fail>[0]) => fail(c, { status: 503, error: "upgrade_pending", message: "This isn't available yet. Try again shortly." });

salesLearnRoutes.post("/courses/:id/quote", async (c) => {
  const user = c.get("user");
  const settings = await getLearnSettings();
  const parsed = await readBody(c, z.object({ coupon: z.string().max(40) }));
  if (!parsed.ok) return parsed.res;
  const course = await one("SELECT * FROM edu_courses WHERE id = ? AND status = 'published'", [c.req.param("id")]);
  if (!course) return notFound(c, "course");
  const quota = await consume(`learn-coupon:${user.sub}`, 30, 60 * 60);
  if (!quota.allowed) return tooManyRequests(c, quota, "Too many coupon tries. Try again in a little while.");
  const price = Number(course.price_ugx);
  const q = await quoteCoupon((parsed.data as { coupon: string }).coupon, course, user.sub, price, settings);
  if (!q.ok) return c.json({ ok: true, valid: false, message: q.message, priceUgx: price, discountUgx: 0, finalUgx: price });
  return c.json({ ok: true, valid: true, priceUgx: price, discountUgx: q.discount, finalUgx: price - q.discount });
});

async function enrolInBundle(userId: string, schoolId: string, courseIds: string[], environment: string): Promise<void> {
  for (const courseId of courseIds) {
    await db.execute({
      sql: "INSERT OR IGNORE INTO edu_enrollments (id, course_id, school_id, user_id, status, price_paid_ugx, commission_ugx, environment) VALUES (?, ?, ?, ?, 'active', 0, 0, ?)",
      args: [newId("enr"), courseId, schoolId, userId, environment],
    });
    await db.execute({ sql: "UPDATE edu_enrollments SET status = 'active' WHERE course_id = ? AND user_id = ? AND status = 'pending'", args: [courseId, userId] });
  }
}

salesLearnRoutes.post("/bundles/:id/buy", async (c) => {
  const user = c.get("user");
  const settings = await getLearnSettings();
  if (!settings.bundlesEnabled || !settings.enrolmentsEnabled) return fail(c, { status: 503, error: "bundles_off", message: "Bundles are switched off right now." });
  if (!(await salesReady())) return notReady(c);
  const quota = await consume(`learn-buy:${user.sub}`, 20, 60 * 60);
  if (!quota.allowed) return tooManyRequests(c, quota, "You're buying very quickly. Try again in a little while.");

  const bundle = await one("SELECT b.*, s.owner_id, s.status AS school_status FROM edu_bundles b JOIN edu_schools s ON s.id = b.school_id WHERE b.id = ? AND b.status = 'published'", [c.req.param("id")]);
  if (!bundle || bundle.school_status !== "active") return notFound(c, "bundle");
  if (bundle.owner_id === user.sub) return fail(c, { status: 400, error: "own_bundle", message: "This is your own bundle." });
  const price = Number(bundle.price_ugx);
  if (price > 0 && !settings.paidCoursesEnabled) return fail(c, { status: 503, error: "paid_courses_off", message: "Paid courses aren't available right now." });
  const courses = (await db.execute({ sql: "SELECT c.id FROM edu_bundle_courses bc JOIN edu_courses c ON c.id = bc.course_id WHERE bc.bundle_id = ? AND c.status = 'published' AND c.school_id = ?", args: [bundle.id as string, bundle.school_id as string] })).rows as Row[];
  if (courses.length === 0) return fail(c, { status: 409, error: "empty_bundle", message: "This bundle has no courses you can join right now." });
  const environment = await getPlatformEnvironment();

  // Claim the purchase first, so a double tap or a race can only pay once.
  const claim = await db.execute({ sql: "INSERT OR IGNORE INTO edu_bundle_purchases (id, bundle_id, user_id, price_paid_ugx, commission_ugx, environment) VALUES (?, ?, ?, ?, 0, ?)", args: [newId("bpu"), bundle.id as string, user.sub, price, environment] });
  if ((claim.rowsAffected ?? 0) === 0) return fail(c, { status: 409, error: "already_bought", message: "You already have this bundle." });

  let commission = 0;
  if (price > 0) {
    const paid = await chargeAndPayOut({ payerId: user.sub, ownerId: String(bundle.owner_id), schoolId: String(bundle.school_id), amount: price, commissionPercent: settings.commissionPercent, environment, note: `Peebee Learn bundle: ${String(bundle.title)}` }).catch(() => null);
    if (!paid || !paid.ok) {
      await db.execute({ sql: "DELETE FROM edu_bundle_purchases WHERE bundle_id = ? AND user_id = ?", args: [bundle.id as string, user.sub] });
      return c.json({ error: "insufficient_wallet", message: `Add UGX ${price.toLocaleString("en-UG")} to your Peebee wallet to buy this.` }, 402);
    }
    commission = paid.commission;
    await db.execute({ sql: "UPDATE edu_bundle_purchases SET commission_ugx = ? WHERE bundle_id = ? AND user_id = ?", args: [commission, bundle.id as string, user.sub] });
  }
  await enrolInBundle(user.sub, String(bundle.school_id), courses.map((r) => String(r.id)), environment);
  return c.json({ ok: true, enrolledIn: courses.length, paidUgx: price });
});

salesLearnRoutes.post("/plans/:id/subscribe", async (c) => {
  const user = c.get("user");
  const settings = await getLearnSettings();
  if (!settings.subscriptionsEnabled || !settings.enrolmentsEnabled) return fail(c, { status: 503, error: "passes_off", message: "School passes are switched off right now." });
  if (!(await salesReady())) return notReady(c);
  const quota = await consume(`learn-buy:${user.sub}`, 20, 60 * 60);
  if (!quota.allowed) return tooManyRequests(c, quota, "You're buying very quickly. Try again in a little while.");

  const plan = await one("SELECT p.*, s.owner_id, s.status AS school_status FROM edu_plans p JOIN edu_schools s ON s.id = p.school_id WHERE p.id = ? AND p.status = 'published'", [c.req.param("id")]);
  if (!plan || plan.school_status !== "active") return notFound(c, "pass");
  if (plan.owner_id === user.sub) return fail(c, { status: 400, error: "own_plan", message: "This is your own school." });
  const price = Number(plan.price_ugx);
  if (price > 0 && !settings.paidCoursesEnabled) return fail(c, { status: 503, error: "paid_courses_off", message: "Paid courses aren't available right now." });
  const environment = await getPlatformEnvironment();
  const current = await activeSubscription(user.sub, String(plan.school_id));

  let commission = 0;
  if (price > 0) {
    const paid = await chargeAndPayOut({ payerId: user.sub, ownerId: String(plan.owner_id), schoolId: String(plan.school_id), amount: price, commissionPercent: settings.commissionPercent, environment, note: `Peebee Learn pass: ${String(plan.title)}` }).catch(() => null);
    if (!paid || !paid.ok) return c.json({ error: "insufficient_wallet", message: `Add UGX ${price.toLocaleString("en-UG")} to your Peebee wallet to buy this.` }, 402);
    commission = paid.commission;
  }
  try {
    // Buying again while a pass is running adds the days on to the end of it.
    await db.execute({
      sql: `INSERT INTO edu_subscriptions (id, plan_id, school_id, user_id, price_paid_ugx, commission_ugx, environment, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime(COALESCE(?, datetime('now')), '+' || ? || ' days'))`,
      args: [newId("sub"), plan.id as string, plan.school_id as string, user.sub, price, commission, environment, current?.expiresAt ?? null, Number(plan.days)],
    });
  } catch (err) {
    // The payment went through but the pass wasn't saved: give the money back rather than leave it half done.
    if (price > 0) await creditWallet(user.sub, price, { type: "refund", environment, note: `Refund: ${String(plan.title)}` }).catch(() => undefined);
    throw err;
  }
  const fresh = await activeSubscription(user.sub, String(plan.school_id));
  return c.json({ ok: true, expiresAt: fresh?.expiresAt ?? null, paidUgx: price });
});

salesLearnRoutes.get("/subscriptions", async (c) => {
  if (!(await salesReady())) return c.json({ ok: true, subscriptions: [] });
  const rows = (
    await db.execute({
      sql: `SELECT s.id, s.expires_at, p.title, sc.name AS school_name, sc.id AS school_id FROM edu_subscriptions s JOIN edu_plans p ON p.id = s.plan_id JOIN edu_schools sc ON sc.id = s.school_id
            WHERE s.user_id = ? AND s.expires_at > datetime('now') ORDER BY s.expires_at DESC LIMIT 50`,
      args: [c.get("user").sub],
    })
  ).rows as Row[];
  return c.json({ ok: true, subscriptions: rows.map((r) => ({ id: String(r.id), title: String(r.title), schoolId: String(r.school_id), schoolName: String(r.school_name), expiresAt: String(r.expires_at) })) });
});

// ---------------------------------------------------------------------------
// Educator routes (mounted under /studio)
// ---------------------------------------------------------------------------

export const salesStudioRoutes = new Hono();

const text = (max: number, min = 0) => z.string().transform((v) => v.trim()).pipe(z.string().min(min).max(max));

async function ownedSchoolOr404(c: Parameters<typeof fail>[0], userId: string, id: string) {
  const school = await ownedSchool(userId, id);
  return school ?? null;
}

salesStudioRoutes.get("/schools/:id/sales", async (c) => {
  const school = await ownedSchoolOr404(c, c.get("user").sub, c.req.param("id"));
  if (!school) return notFound(c, "school");
  if (!(await salesReady())) return c.json({ ok: true, ready: false, coupons: [], bundles: [], plans: [] });
  const sid = String(school.id);
  const coupons = (await db.execute({ sql: "SELECT * FROM edu_coupons WHERE school_id = ? ORDER BY created_at DESC LIMIT 200", args: [sid] })).rows as Row[];
  const bundles = (await db.execute({ sql: "SELECT b.*, (SELECT COUNT(*) FROM edu_bundle_purchases p WHERE p.bundle_id = b.id) AS sold FROM edu_bundles b WHERE b.school_id = ? ORDER BY b.created_at DESC LIMIT 200", args: [sid] })).rows as Row[];
  const links = (await db.execute({ sql: "SELECT bc.bundle_id, bc.course_id FROM edu_bundle_courses bc JOIN edu_bundles b ON b.id = bc.bundle_id WHERE b.school_id = ?", args: [sid] })).rows as Row[];
  const plans = (await db.execute({ sql: "SELECT p.*, (SELECT COUNT(*) FROM edu_subscriptions s WHERE s.plan_id = p.id) AS sold FROM edu_plans p WHERE p.school_id = ? ORDER BY p.created_at DESC LIMIT 100", args: [sid] })).rows as Row[];
  return c.json({
    ok: true,
    ready: true,
    coupons: coupons.map((r) => ({ ...couponOf(r), expiresAt: r.expires_at ? String(r.expires_at) : null, active: Number(r.active) === 1 })),
    bundles: bundles.map((r) => ({ id: String(r.id), title: String(r.title), summary: String(r.summary ?? ""), priceUgx: Number(r.price_ugx), status: String(r.status), sold: Number(r.sold), courseIds: links.filter((l) => l.bundle_id === r.id).map((l) => String(l.course_id)) })),
    plans: plans.map((r) => ({ id: String(r.id), title: String(r.title), summary: String(r.summary ?? ""), priceUgx: Number(r.price_ugx), days: Number(r.days), status: String(r.status), sold: Number(r.sold) })),
  });
});

const couponBody = z
  .object({
    code: text(40, 3).transform((v) => v.toUpperCase()).pipe(z.string().regex(/^[A-Z0-9_-]+$/, "Use letters, numbers, - or _")),
    percentOff: z.number().int().min(1).max(100).nullable().default(null),
    amountOffUgx: z.number().int().min(1).max(1_000_000_000).nullable().default(null),
    courseId: z.string().max(80).nullable().default(null),
    maxUses: z.number().int().min(1).max(1_000_000).nullable().default(null),
    expiresAt: z.string().datetime({ offset: true }).nullable().default(null),
  })
  .refine((d) => (d.percentOff === null) !== (d.amountOffUgx === null), { message: "Set either a percentage or an amount off, not both." });

salesStudioRoutes.post("/schools/:id/coupons", async (c) => {
  const g = await gate(c);
  if (isResponse(g)) return g;
  const school = await ownedSchoolOr404(c, g.userId, c.req.param("id"));
  if (!school) return notFound(c, "school");
  if (school.status === "suspended") return suspended(c);
  if (!g.settings.couponsEnabled) return fail(c, { status: 403, error: "coupons_off", message: "Coupons are switched off right now." });
  if (!(await salesReady())) return fail(c, { status: 503, error: "upgrade_pending", message: "Coupons need a platform update that hasn't finished yet. Try again shortly." });
  const parsed = await readBody(c, couponBody);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data as z.infer<typeof couponBody>;
  if (d.percentOff !== null && d.percentOff > g.settings.maxCouponPercent) return fail(c, { status: 400, error: "coupon_too_big", message: `A coupon can take off at most ${g.settings.maxCouponPercent}%.` });
  if (d.courseId) {
    const course = await ownedCourse(g.userId, d.courseId);
    if (!course || course.school_id !== school.id) return fail(c, { status: 400, error: "bad_course", message: "Choose a course from this school." });
  }
  const dupe = await one("SELECT 1 AS y FROM edu_coupons WHERE code = ?", [d.code]);
  if (dupe) return fail(c, { status: 409, error: "code_taken", message: "That code is already taken. Try another." });
  const id = newId("cpn");
  await db.execute({
    sql: "INSERT INTO edu_coupons (id, school_id, code, percent_off, amount_off_ugx, course_id, max_uses, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: [id, school.id as string, d.code, d.percentOff, d.amountOffUgx, d.courseId, d.maxUses, d.expiresAt],
  });
  return c.json({ ok: true, id }, 201);
});

async function ownedCoupon(userId: string, id: string) {
  return one("SELECT c.* FROM edu_coupons c JOIN edu_schools s ON s.id = c.school_id WHERE c.id = ? AND s.owner_id = ?", [id, userId]);
}

salesStudioRoutes.patch("/coupons/:id", async (c) => {
  const coupon = await ownedCoupon(c.get("user").sub, c.req.param("id"));
  if (!coupon) return notFound(c, "coupon");
  const parsed = await readBody(c, z.object({ active: z.boolean() }));
  if (!parsed.ok) return parsed.res;
  await db.execute({ sql: "UPDATE edu_coupons SET active = ? WHERE id = ?", args: [(parsed.data as { active: boolean }).active ? 1 : 0, coupon.id as string] });
  return c.json({ ok: true });
});

salesStudioRoutes.delete("/coupons/:id", async (c) => {
  const coupon = await ownedCoupon(c.get("user").sub, c.req.param("id"));
  if (!coupon) return notFound(c, "coupon");
  if (Number(coupon.used_count) > 0) {
    await db.execute({ sql: "UPDATE edu_coupons SET active = 0 WHERE id = ?", args: [coupon.id as string] });
    return c.json({ ok: true, deactivated: true });
  }
  await db.execute({ sql: "DELETE FROM edu_coupons WHERE id = ?", args: [coupon.id as string] });
  return c.json({ ok: true });
});

const bundleBody = z.object({
  title: text(120, 2),
  summary: text(2000).default(""),
  priceUgx: z.number().int().min(0).max(1_000_000_000),
  courseIds: z.array(z.string().max(80)).min(2).max(100),
  status: z.enum(["draft", "published"]).default("draft"),
});

salesStudioRoutes.post("/schools/:id/bundles", async (c) => {
  const g = await gate(c);
  if (isResponse(g)) return g;
  const school = await ownedSchoolOr404(c, g.userId, c.req.param("id"));
  if (!school) return notFound(c, "school");
  if (school.status === "suspended") return suspended(c);
  if (!g.settings.bundlesEnabled) return fail(c, { status: 403, error: "bundles_off", message: "Bundles are switched off right now." });
  if (!(await salesReady())) return fail(c, { status: 503, error: "upgrade_pending", message: "Bundles need a platform update that hasn't finished yet. Try again shortly." });
  const parsed = await readBody(c, bundleBody);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data as z.infer<typeof bundleBody>;
  const problem = await bundleProblem(g.userId, String(school.id), d, g.settings);
  if (problem) return fail(c, problem);
  const id = newId("bnd");
  await db.execute({ sql: "INSERT INTO edu_bundles (id, school_id, title, summary, price_ugx, status) VALUES (?, ?, ?, ?, ?, ?)", args: [id, school.id as string, d.title, d.summary, d.priceUgx, d.status] });
  for (const courseId of new Set(d.courseIds)) await db.execute({ sql: "INSERT INTO edu_bundle_courses (bundle_id, course_id) VALUES (?, ?)", args: [id, courseId] });
  return c.json({ ok: true, id }, 201);
});

async function bundleProblem(userId: string, schoolId: string, d: z.infer<typeof bundleBody>, settings: LearnSettings) {
  const ids = [...new Set(d.courseIds)];
  if (ids.length < 2) return { status: 400 as const, error: "bundle_small", message: "A bundle needs at least two different courses." };
  if (ids.length > settings.maxBundleCourses) return { status: 400 as const, error: "bundle_big", message: `A bundle can have up to ${settings.maxBundleCourses} courses.` };
  if (d.priceUgx > settings.maxCoursePriceUgx) return { status: 400 as const, error: "price_too_high", message: `The highest price is UGX ${settings.maxCoursePriceUgx.toLocaleString("en-UG")}.` };
  if (d.priceUgx > 0 && !settings.paidCoursesEnabled) return { status: 400 as const, error: "paid_off", message: "Paid courses are switched off, so a bundle must be free." };
  for (const courseId of ids) {
    const course = await ownedCourse(userId, courseId);
    if (!course || course.school_id !== schoolId) return { status: 400 as const, error: "bad_course", message: "Every course must be one of this school's." };
  }
  return null;
}

async function ownedBundle(userId: string, id: string) {
  return one("SELECT b.* FROM edu_bundles b JOIN edu_schools s ON s.id = b.school_id WHERE b.id = ? AND s.owner_id = ?", [id, userId]);
}

salesStudioRoutes.put("/bundles/:id", async (c) => {
  const g = await gate(c);
  if (isResponse(g)) return g;
  const bundle = await ownedBundle(g.userId, c.req.param("id"));
  if (!bundle) return notFound(c, "bundle");
  const parsed = await readBody(c, bundleBody);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data as z.infer<typeof bundleBody>;
  const problem = await bundleProblem(g.userId, String(bundle.school_id), d, g.settings);
  if (problem) return fail(c, problem);
  await db.execute({ sql: "UPDATE edu_bundles SET title = ?, summary = ?, price_ugx = ?, status = ? WHERE id = ?", args: [d.title, d.summary, d.priceUgx, d.status, bundle.id as string] });
  await db.execute({ sql: "DELETE FROM edu_bundle_courses WHERE bundle_id = ?", args: [bundle.id as string] });
  for (const courseId of new Set(d.courseIds)) await db.execute({ sql: "INSERT INTO edu_bundle_courses (bundle_id, course_id) VALUES (?, ?)", args: [bundle.id as string, courseId] });
  return c.json({ ok: true });
});

salesStudioRoutes.delete("/bundles/:id", async (c) => {
  const bundle = await ownedBundle(c.get("user").sub, c.req.param("id"));
  if (!bundle) return notFound(c, "bundle");
  const sold = await count("SELECT COUNT(*) AS n FROM edu_bundle_purchases WHERE bundle_id = ?", [bundle.id]);
  if (sold > 0) {
    await db.execute({ sql: "UPDATE edu_bundles SET status = 'draft' WHERE id = ?", args: [bundle.id as string] });
    return c.json({ ok: true, unpublished: true });
  }
  await db.execute({ sql: "DELETE FROM edu_bundle_courses WHERE bundle_id = ?", args: [bundle.id as string] });
  await db.execute({ sql: "DELETE FROM edu_bundles WHERE id = ?", args: [bundle.id as string] });
  return c.json({ ok: true });
});

const planBody = z.object({
  title: text(120, 2),
  summary: text(2000).default(""),
  priceUgx: z.number().int().min(0).max(1_000_000_000),
  days: z.number().int().min(1).max(3650),
  status: z.enum(["draft", "published"]).default("draft"),
});

function planProblem(d: z.infer<typeof planBody>, settings: LearnSettings) {
  if (d.days > settings.maxPlanDays) return { status: 400 as const, error: "plan_too_long", message: `A pass can last up to ${settings.maxPlanDays} days.` };
  if (d.priceUgx > settings.maxCoursePriceUgx) return { status: 400 as const, error: "price_too_high", message: `The highest price is UGX ${settings.maxCoursePriceUgx.toLocaleString("en-UG")}.` };
  if (d.priceUgx > 0 && !settings.paidCoursesEnabled) return { status: 400 as const, error: "paid_off", message: "Paid courses are switched off, so a pass must be free." };
  return null;
}

salesStudioRoutes.post("/schools/:id/plans", async (c) => {
  const g = await gate(c);
  if (isResponse(g)) return g;
  const school = await ownedSchoolOr404(c, g.userId, c.req.param("id"));
  if (!school) return notFound(c, "school");
  if (school.status === "suspended") return suspended(c);
  if (!g.settings.subscriptionsEnabled) return fail(c, { status: 403, error: "passes_off", message: "School passes are switched off right now." });
  if (!(await salesReady())) return fail(c, { status: 503, error: "upgrade_pending", message: "School passes need a platform update that hasn't finished yet. Try again shortly." });
  const parsed = await readBody(c, planBody);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data as z.infer<typeof planBody>;
  const problem = planProblem(d, g.settings);
  if (problem) return fail(c, problem);
  const existing = await count("SELECT COUNT(*) AS n FROM edu_plans WHERE school_id = ?", [school.id]);
  if (existing >= g.settings.maxPlansPerSchool) return fail(c, { status: 409, error: "limit_reached", message: `A school can offer up to ${g.settings.maxPlansPerSchool} passes.` });
  const id = newId("pln");
  await db.execute({ sql: "INSERT INTO edu_plans (id, school_id, title, summary, price_ugx, days, status) VALUES (?, ?, ?, ?, ?, ?, ?)", args: [id, school.id as string, d.title, d.summary, d.priceUgx, d.days, d.status] });
  return c.json({ ok: true, id }, 201);
});

async function ownedPlan(userId: string, id: string) {
  return one("SELECT p.* FROM edu_plans p JOIN edu_schools s ON s.id = p.school_id WHERE p.id = ? AND s.owner_id = ?", [id, userId]);
}

salesStudioRoutes.put("/plans/:id", async (c) => {
  const g = await gate(c);
  if (isResponse(g)) return g;
  const plan = await ownedPlan(g.userId, c.req.param("id"));
  if (!plan) return notFound(c, "pass");
  const parsed = await readBody(c, planBody);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data as z.infer<typeof planBody>;
  const problem = planProblem(d, g.settings);
  if (problem) return fail(c, problem);
  await db.execute({ sql: "UPDATE edu_plans SET title = ?, summary = ?, price_ugx = ?, days = ?, status = ? WHERE id = ?", args: [d.title, d.summary, d.priceUgx, d.days, d.status, plan.id as string] });
  return c.json({ ok: true });
});

salesStudioRoutes.delete("/plans/:id", async (c) => {
  const plan = await ownedPlan(c.get("user").sub, c.req.param("id"));
  if (!plan) return notFound(c, "pass");
  const sold = await count("SELECT COUNT(*) AS n FROM edu_subscriptions WHERE plan_id = ?", [plan.id]);
  if (sold > 0) {
    await db.execute({ sql: "UPDATE edu_plans SET status = 'draft' WHERE id = ?", args: [plan.id as string] });
    return c.json({ ok: true, unpublished: true });
  }
  await db.execute({ sql: "DELETE FROM edu_plans WHERE id = ?", args: [plan.id as string] });
  return c.json({ ok: true });
});
