import { Hono } from "hono";
import { db } from "../db/client.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { getPlatformEnvironment, type PlatformEnvironment } from "../lib/settings.js";
import { hasTable } from "../lib/schema.js";
import { demoPeopleFilter, primeDemoAccounts } from "../practice/people.js";
import { requirePermission } from "./permissions.js";

/**
 * Who is on the platform, cut the way staff think about them: students, shoppers, creators, pharmacies, boda riders and so
 * on, each with how many exist, how many were active in the last 30 days, and how many are new.
 *
 * "Active" means the person did the thing that makes them that kind of user in the last 30 days (a shopper placed a
 * marketplace order, a student finished a lesson, a creator posted). Every number is its own query and may fail: migrations are
 * applied by hand, so a missing table gives a null that Admin shows as a dash, never a wrong number.
 */
export const segmentRoutes = new Hono();
segmentRoutes.use("/admin/platform/segments", requireAuth, requireRole("admin"));

export type SegmentGroup = "customers" | "learn" | "creators" | "merchants" | "riders" | "hive";

type Seg = {
  key: string;
  group: SegmentGroup;
  label: string;
  what: string;
  /** Tables the queries read; the segment is skipped as "not set up" if the first is missing. */
  needs: string;
  /** Each of these is a full `SELECT COUNT(...) AS n ...`. */
  total: string;
  active?: string;
  fresh?: string;
  pending?: string;
  /** Right now (for example riders online). */
  now?: string;
  /** The admin page that lists and manages this segment. */
  href?: string;
};

const GROUP_LABEL: Record<SegmentGroup, string> = {
  customers: "Customers and buyers",
  learn: "Learn",
  creators: "Creators",
  merchants: "Merchants and stores",
  riders: "Riders and drivers",
  hive: "Hire and Work",
};

function build(env: PlatformEnvironment): Seg[] {
  const D30 = "datetime('now', '-30 days')";
  const demoUser = (col: string) => demoPeopleFilter(env, col);
  const E = `environment = '${env}'`;
  // Orders are one table; what kind of order it is comes from which columns are set.
  const ordersBy = (cond: string, col = "customer_id") => ({
    total: `SELECT COUNT(DISTINCT ${col}) AS n FROM orders WHERE ${E} AND ${cond}`,
    active: `SELECT COUNT(DISTINCT ${col}) AS n FROM orders WHERE ${E} AND ${cond} AND created_at >= ${D30}`,
  });
  const restaurantType = (t: string): Pick<Seg, "total" | "active" | "fresh" | "pending"> => ({
    total: `SELECT COUNT(*) AS n FROM restaurants WHERE business_type = '${t}' AND ${demoUser("id")}`,
    active: `SELECT COUNT(DISTINCT o.restaurant_id) AS n FROM orders o JOIN restaurants r ON r.id = o.restaurant_id WHERE o.${E} AND r.business_type = '${t}' AND o.created_at >= ${D30}`,
    fresh: `SELECT COUNT(*) AS n FROM restaurants WHERE business_type = '${t}' AND created_at >= ${D30} AND ${demoUser("id")}`,
    pending: `SELECT COUNT(*) AS n FROM restaurants WHERE business_type = '${t}' AND status = 'pending_approval' AND ${demoUser("id")}`,
  });
  const storeFilter = (cond: string): Pick<Seg, "total" | "active" | "fresh"> => ({
    total: `SELECT COUNT(*) AS n FROM stores WHERE ${cond}`,
    active: `SELECT COUNT(DISTINCT o.store_id) AS n FROM orders o JOIN stores s ON s.id = o.store_id WHERE o.${E} AND ${cond.replace(/\b(category|pro_tier)\b/g, "s.$1")} AND o.created_at >= ${D30}`,
    fresh: `SELECT COUNT(*) AS n FROM stores WHERE ${cond} AND created_at >= ${D30}`,
  });
  const schoolKind = (k: string): Pick<Seg, "total" | "active" | "fresh"> => ({
    total: `SELECT COUNT(*) AS n FROM edu_schools WHERE kind = '${k}'`,
    active: `SELECT COUNT(DISTINCT e.school_id) AS n FROM edu_enrollments e JOIN edu_schools s ON s.id = e.school_id WHERE s.kind = '${k}' AND e.created_at >= ${D30}`,
    fresh: `SELECT COUNT(*) AS n FROM edu_schools WHERE kind = '${k}' AND created_at >= ${D30}`,
  });
  const merchantKind = (k: string): Pick<Seg, "total" | "active" | "fresh" | "pending"> => ({
    total: `SELECT COUNT(*) AS n FROM merchants WHERE business_kind = '${k}' AND ${E}`,
    active: `SELECT COUNT(DISTINCT s.merchant_id) AS n FROM orders o JOIN stores s ON s.id = o.store_id JOIN merchants m ON m.id = s.merchant_id WHERE o.${E} AND m.business_kind = '${k}' AND o.created_at >= ${D30}`,
    fresh: `SELECT COUNT(*) AS n FROM merchants WHERE business_kind = '${k}' AND ${E} AND created_at >= ${D30}`,
    pending: `SELECT COUNT(*) AS n FROM merchants WHERE business_kind = '${k}' AND ${E} AND status IN ('pending_approval','provisional')`,
  });

  return [
    // ---- Customers and buyers: one person can be in several.
    { key: "customers", group: "customers", label: "All customers", what: "Everyone with a customer account.", needs: "users", href: "/people?tab=customers",
      total: `SELECT COUNT(*) AS n FROM users WHERE role = 'customer' AND ${demoUser("id")}`,
      active: `SELECT COUNT(DISTINCT customer_id) AS n FROM orders WHERE ${E} AND created_at >= ${D30}`,
      fresh: `SELECT COUNT(*) AS n FROM users WHERE role = 'customer' AND created_at >= ${D30} AND ${demoUser("id")}` },
    { key: "shoppers", group: "customers", label: "Shoppers", what: "Buy from marketplace stores.", needs: "orders", ...ordersBy("store_id IS NOT NULL") },
    { key: "food_customers", group: "customers", label: "Food customers", what: "Order from restaurants and kitchens.", needs: "orders", ...ordersBy("restaurant_id IS NOT NULL") },
    { key: "list_shoppers", group: "customers", label: "Shopping-list customers", what: "Send a rider to shop a list.", needs: "orders", ...ordersBy("type = 'shopping' AND restaurant_id IS NULL AND store_id IS NULL AND is_ride = 0") },
    { key: "parcel_senders", group: "customers", label: "Parcel senders", what: "Send parcels across town.", needs: "orders", ...ordersBy("type = 'parcel'") },
    { key: "passengers", group: "customers", label: "Passengers", what: "Take rides.", needs: "orders", ...ordersBy("is_ride = 1") },
    { key: "guests", group: "customers", label: "Guest buyers", what: "Order without an account, through a shared link.", needs: "guest_orders",
      total: "SELECT COUNT(DISTINCT user_id) AS n FROM guest_orders", active: `SELECT COUNT(DISTINCT user_id) AS n FROM guest_orders WHERE created_at >= ${D30}` },

    // ---- Learn
    { key: "students", group: "learn", label: "Students", what: "Enrolled in a course or class. Active: finished a lesson this month.", needs: "edu_enrollments", href: "/settings/learn",
      total: `SELECT COUNT(DISTINCT user_id) AS n FROM edu_enrollments WHERE status = 'active' AND ${E}`,
      active: `SELECT COUNT(DISTINCT user_id) AS n FROM edu_lesson_progress WHERE completed_at >= ${D30}`,
      fresh: `SELECT COUNT(DISTINCT user_id) AS n FROM edu_enrollments WHERE status = 'active' AND ${E} AND created_at >= ${D30}` },
    { key: "paying_students", group: "learn", label: "Paying students", what: "Bought a course, class or bundle.", needs: "edu_enrollments",
      total: `SELECT COUNT(DISTINCT user_id) AS n FROM edu_enrollments WHERE status = 'active' AND price_paid_ugx > 0 AND ${E}`,
      active: `SELECT COUNT(DISTINCT user_id) AS n FROM edu_enrollments WHERE status = 'active' AND price_paid_ugx > 0 AND ${E} AND created_at >= ${D30}` },
    { key: "educators", group: "learn", label: "Teachers and educators", what: "Run a school or teach on a course.", needs: "edu_schools", href: "/settings/learn",
      total: "SELECT COUNT(*) AS n FROM (SELECT owner_id AS u FROM edu_schools UNION SELECT user_id FROM edu_course_instructors)",
      fresh: `SELECT COUNT(*) AS n FROM edu_schools WHERE created_at >= ${D30}` },
    { key: "parents", group: "learn", label: "Parents", what: "Guardians with a PIN to follow a learner.", needs: "edu_parent_pins",
      total: "SELECT COUNT(*) AS n FROM edu_parent_pins", fresh: `SELECT COUNT(*) AS n FROM edu_parent_pins WHERE updated_at >= ${D30}` },
    { key: "pass_holders", group: "learn", label: "Subscription pass holders", what: "Hold a live learner subscription.", needs: "edu_subscriptions",
      total: "SELECT COUNT(DISTINCT user_id) AS n FROM edu_subscriptions WHERE expires_at > datetime('now')" },
    { key: "schools", group: "learn", label: "Schools", what: "Primary and secondary schools.", needs: "edu_schools", href: "/settings/learn", ...schoolKind("school") },
    { key: "academies", group: "learn", label: "Academies", what: "Academies.", needs: "edu_schools", href: "/settings/learn", ...schoolKind("academy") },
    { key: "colleges", group: "learn", label: "Colleges", what: "Colleges.", needs: "edu_schools", href: "/settings/learn", ...schoolKind("college") },
    { key: "training_centres", group: "learn", label: "Training centres", what: "Training and skills centres.", needs: "edu_schools", href: "/settings/learn", ...schoolKind("training_centre") },
    { key: "tutors", group: "learn", label: "Independent tutors", what: "Teach on their own.", needs: "edu_schools", href: "/settings/learn", ...schoolKind("independent_tutor") },

    // ---- Creators
    { key: "creators", group: "creators", label: "Creators", what: "Own a channel. Active: posted this month.", needs: "channels", href: "/settings/channels",
      total: `SELECT COUNT(*) AS n FROM channels WHERE ${E}`,
      active: `SELECT COUNT(DISTINCT publisher_id) AS n FROM posts WHERE publisher_type = 'channel' AND created_at >= ${D30}`,
      fresh: `SELECT COUNT(*) AS n FROM channels WHERE ${E} AND created_at >= ${D30}` },
    { key: "verified_creators", group: "creators", label: "Verified creators", what: "Channels with a verified badge.", needs: "channels", href: "/settings/channels",
      total: `SELECT COUNT(*) AS n FROM channels WHERE ${E} AND verified_badge = 1` },
    { key: "earning_creators", group: "creators", label: "Creators selling memberships", what: "Have at least one paid tier.", needs: "channel_tiers",
      total: "SELECT COUNT(DISTINCT channel_id) AS n FROM channel_tiers" },
    { key: "followers", group: "creators", label: "Followers", what: "Follow a channel. Active: followed one this month.", needs: "channel_follows",
      total: "SELECT COUNT(DISTINCT user_id) AS n FROM channel_follows", active: `SELECT COUNT(DISTINCT user_id) AS n FROM channel_follows WHERE created_at >= ${D30}` },
    { key: "channel_members", group: "creators", label: "Paying members", what: "Hold an active channel membership.", needs: "channel_subscriptions",
      total: "SELECT COUNT(DISTINCT user_id) AS n FROM channel_subscriptions WHERE status = 'active'" },

    // ---- Merchants and stores
    { key: "merchant_business", group: "merchants", label: "Business merchants", what: "Registered businesses.", needs: "merchants", href: "/people?tab=merchants", ...merchantKind("business") },
    { key: "merchant_personal", group: "merchants", label: "Personal sellers", what: "Individuals selling for themselves.", needs: "merchants", href: "/people?tab=merchants", ...merchantKind("personal_seller") },
    { key: "stores_groceries", group: "merchants", label: "Grocery stores", what: "Marketplace stores selling groceries.", needs: "stores", href: "/settings/marketplace", ...storeFilter("category = 'groceries'") },
    { key: "stores_general", group: "merchants", label: "General stores", what: "Marketplace stores selling goods.", needs: "stores", href: "/settings/marketplace", ...storeFilter("category = 'stores'") },
    { key: "stores_pro", group: "merchants", label: "Pro stores", what: "Paid Pro Store or Pro Live plans.", needs: "stores", href: "/settings/marketplace", ...storeFilter("pro_tier IN ('pro_store','pro_live')") },
    { key: "pharmacies", group: "merchants", label: "Pharmacies", what: "Licensed stores that fill prescriptions.", needs: "pharmacy_approvals",
      total: "SELECT COUNT(*) AS n FROM pharmacy_approvals WHERE status = 'approved'", fresh: `SELECT COUNT(*) AS n FROM pharmacy_approvals WHERE status = 'approved' AND approved_at >= ${D30}` },
    { key: "restaurants", group: "merchants", label: "Restaurants", what: "Sit-down restaurants.", needs: "restaurants", href: "/people?tab=restaurants", ...restaurantType("restaurant") },
    { key: "kitchens", group: "merchants", label: "Kitchens", what: "Home and cloud kitchens.", needs: "restaurants", href: "/people?tab=restaurants", ...restaurantType("kitchen") },
    { key: "street_food", group: "merchants", label: "Street food", what: "Street food sellers.", needs: "restaurants", href: "/people?tab=restaurants", ...restaurantType("street_food") },
    { key: "bakeries", group: "merchants", label: "Bakeries", what: "Bakeries.", needs: "restaurants", href: "/people?tab=restaurants", ...restaurantType("bakery") },
    { key: "juice_bars", group: "merchants", label: "Juice bars", what: "Juices and smoothies.", needs: "restaurants", href: "/people?tab=restaurants", ...restaurantType("juices") },
    { key: "fuel_stations", group: "merchants", label: "Fuel stations", what: "Redeem fuel vouchers.", needs: "fuel_stations", href: "/people/types/fuel_stations",
      total: "SELECT COUNT(*) AS n FROM fuel_stations", fresh: `SELECT COUNT(*) AS n FROM fuel_stations WHERE created_at >= ${D30}`, pending: "SELECT COUNT(*) AS n FROM fuel_stations WHERE status = 'pending_approval'" },

    // ---- Riders and drivers
    { key: "boda_riders", group: "riders", label: "Boda riders", what: "Ride, deliver and shop. Active: completed work this month.", needs: "riders", href: "/people?tab=riders",
      total: `SELECT COUNT(*) AS n FROM riders WHERE ${demoUser("user_id")}`,
      active: `SELECT COUNT(DISTINCT rider_id) AS n FROM orders WHERE ${E} AND rider_id IS NOT NULL AND created_at >= ${D30}`,
      fresh: `SELECT COUNT(*) AS n FROM riders WHERE created_at >= ${D30} AND ${demoUser("user_id")}`,
      pending: `SELECT COUNT(*) AS n FROM riders WHERE verified = 0 AND ${demoUser("user_id")}`,
      now: `SELECT COUNT(*) AS n FROM riders WHERE is_online = 1 AND ${demoUser("user_id")}` },
    { key: "car_drivers", group: "riders", label: "Car drivers", what: "Drive cars on Peebee Car.", needs: "car_partners", href: "/people/types/car_drivers",
      total: `SELECT COUNT(*) AS n FROM car_partners WHERE driver_status IN ('pending','approved','suspended') AND ${demoUser("user_id")}`,
      fresh: `SELECT COUNT(*) AS n FROM car_partners WHERE driver_status IN ('pending','approved','suspended') AND created_at >= ${D30} AND ${demoUser("user_id")}`,
      pending: `SELECT COUNT(*) AS n FROM car_partners WHERE driver_status = 'pending' AND ${demoUser("user_id")}` },
    { key: "car_owners", group: "riders", label: "Car owners", what: "List cars for rides and rental.", needs: "car_partners", href: "/people/types/car_owners",
      total: `SELECT COUNT(*) AS n FROM car_partners WHERE owner_status IN ('pending','approved','suspended') AND ${demoUser("user_id")}`,
      fresh: `SELECT COUNT(*) AS n FROM car_partners WHERE owner_status IN ('pending','approved','suspended') AND created_at >= ${D30} AND ${demoUser("user_id")}`,
      pending: `SELECT COUNT(*) AS n FROM car_partners WHERE owner_status = 'pending' AND ${demoUser("user_id")}` },
    { key: "taxipress", group: "riders", label: "Taxipress drivers", what: "Shared taxis on fixed routes.", needs: "taxipress_taxis", href: "/people/types/taxipress",
      total: `SELECT COUNT(*) AS n FROM taxipress_taxis WHERE ${demoUser("user_id")}`, fresh: `SELECT COUNT(*) AS n FROM taxipress_taxis WHERE created_at >= ${D30} AND ${demoUser("user_id")}`, pending: `SELECT COUNT(*) AS n FROM taxipress_taxis WHERE status = 'pending' AND ${demoUser("user_id")}` },
    { key: "relay", group: "riders", label: "Relay operators", what: "Carry parcels on relay legs.", needs: "relay_operators", href: "/people/types/relay",
      total: `SELECT COUNT(*) AS n FROM relay_operators WHERE ${demoUser("user_id")}`, fresh: `SELECT COUNT(*) AS n FROM relay_operators WHERE created_at >= ${D30} AND ${demoUser("user_id")}`, pending: `SELECT COUNT(*) AS n FROM relay_operators WHERE status = 'pending' AND ${demoUser("user_id")}` },
    { key: "stage_groups", group: "riders", label: "Boda stages", what: "Rider groups with savings and loans.", needs: "stages", href: "/stages",
      total: "SELECT COUNT(*) AS n FROM stages WHERE status = 'active'", fresh: `SELECT COUNT(*) AS n FROM stages WHERE created_at >= ${D30}` },

    // ---- Hire and Work
    { key: "work_individual", group: "hive", label: "Work: individuals", what: "Solo Clean, Laundry and Fix providers.", needs: "work_providers", href: "/work/providers",
      total: `SELECT COUNT(*) AS n FROM work_providers WHERE kind = 'individual' AND ${demoUser("user_id")}`, fresh: `SELECT COUNT(*) AS n FROM work_providers WHERE kind = 'individual' AND created_at >= ${D30} AND ${demoUser("user_id")}`, pending: `SELECT COUNT(*) AS n FROM work_providers WHERE kind = 'individual' AND status = 'pending' AND ${demoUser("user_id")}` },
    { key: "work_companies", group: "hive", label: "Work: companies", what: "Companies with workers.", needs: "work_providers", href: "/work/providers",
      total: `SELECT COUNT(*) AS n FROM work_providers WHERE kind = 'company' AND ${demoUser("user_id")}`, fresh: `SELECT COUNT(*) AS n FROM work_providers WHERE kind = 'company' AND created_at >= ${D30} AND ${demoUser("user_id")}`, pending: `SELECT COUNT(*) AS n FROM work_providers WHERE kind = 'company' AND status = 'pending' AND ${demoUser("user_id")}` },
    { key: "hire_workers", group: "hive", label: "Hire workers", what: "Take gigs and projects.", needs: "talent_profiles", href: "/talent/workers",
      total: `SELECT COUNT(*) AS n FROM talent_profiles WHERE ${demoUser("user_id")}`, fresh: `SELECT COUNT(*) AS n FROM talent_profiles WHERE created_at >= ${D30} AND ${demoUser("user_id")}`, pending: `SELECT COUNT(*) AS n FROM talent_profiles WHERE status = 'pending' AND ${demoUser("user_id")}` },
    { key: "hire_employers", group: "hive", label: "Hire employers", what: "Post gigs, projects and roles.", needs: "talent_employers", href: "/talent",
      total: `SELECT COUNT(*) AS n FROM talent_employers WHERE ${demoUser("user_id")}`, fresh: `SELECT COUNT(*) AS n FROM talent_employers WHERE created_at >= ${D30} AND ${demoUser("user_id")}` },
    { key: "service_businesses", group: "hive", label: "Service businesses", what: "Standalone service providers.", needs: "service_businesses", href: "/settings/services-platform",
      total: `SELECT COUNT(*) AS n FROM service_businesses WHERE ${demoUser("owner_id")}`, fresh: `SELECT COUNT(*) AS n FROM service_businesses WHERE created_at >= ${D30} AND ${demoUser("owner_id")}`, pending: `SELECT COUNT(*) AS n FROM service_businesses WHERE status = 'pending_review' AND ${demoUser("owner_id")}` },
  ];
}

/** undefined: this segment has no such figure. null: it has one but the query failed. */
async function count(sql: string | undefined): Promise<number | null | undefined> {
  if (!sql) return undefined;
  try {
    const res = await db.execute(sql);
    return Number((res.rows[0] as Record<string, unknown>)?.n ?? 0);
  } catch (err) {
    console.error("Segment count failed:", err);
    return null;
  }
}

segmentRoutes.get("/admin/platform/segments", requirePermission("stats.view"), async (c) => {
  const environment = await getPlatformEnvironment();
  await primeDemoAccounts();
  const defs = build(environment);
  const rows = await Promise.all(defs.map(async (s) => {
    if (!(await hasTable(s.needs))) return { key: s.key, group: s.group, label: s.label, what: s.what, href: s.href ?? null, notReady: true, failed: false, total: null, active: null, fresh: null, pending: null, now: null };
    const [total, active, fresh, pending, now] = await Promise.all([count(s.total), count(s.active), count(s.fresh), count(s.pending), count(s.now)]);
    const figures = [total, active, fresh, pending, now];
    return {
      key: s.key, group: s.group, label: s.label, what: s.what, href: s.href ?? null, notReady: false,
      total: total ?? null, active: active ?? null, fresh: fresh ?? null, pending: pending ?? null, now: now ?? null,
      // Some figure of this segment could not be read (a wrong or missing column), so Admin can say so instead of guessing.
      failed: figures.some((f) => f === null),
    };
  }));
  return c.json({
    environment,
    groups: (Object.keys(GROUP_LABEL) as SegmentGroup[]).map((id) => ({ id, label: GROUP_LABEL[id] })),
    segments: rows,
  });
});
