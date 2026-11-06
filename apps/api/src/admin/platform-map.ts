import { Hono } from "hono";
import { db } from "../db/client.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { getPlatformEnvironment } from "../lib/settings.js";
import { hasTable } from "../lib/schema.js";
import { demoPeopleFilter, primeDemoAccounts } from "../practice/people.js";
import { clientIp } from "../lib/ratelimit.js";
import { logActivity } from "./activity.js";
import { hasPermission, requirePermission, type Permission } from "./permissions.js";

/**
 * Two read-only maps of the platform for Admin: every kind of person on it, and every way it earns.
 *
 * The platform grew module by module, so these lists live here (one place) rather than being rebuilt in each admin page.
 * Every count runs on its own and is allowed to fail: migrations are applied by hand, so a table can be missing in
 * production for a while. A figure that can't be read comes back as null and Admin shows "—", never a wrong number.
 */
export const platformMapRoutes = new Hono();
platformMapRoutes.use("/admin/platform/*", requireAuth, requireRole("admin"));

type PersonGroup = "customers" | "ride" | "buy" | "learn" | "hive" | "channels" | "money" | "staff";

type PersonDef = {
  key: string;
  group: PersonGroup;
  label: string;
  /** What this person does on the platform, in plain words. */
  what: string;
  table: string;
  /** SQL after FROM <table> that selects the people counted (default: all rows). */
  where?: string;
  /** The column holding the person's user id, so demo and practice people are left out of live counts like everywhere else. */
  who?: string;
  /** Count distinct values of this column instead of rows (a person can hold many rows). */
  distinct?: string;
  /** The created-at column, for "new in 30 days". */
  created?: string;
  /** SQL condition (on the same table) for people waiting for approval. */
  pending?: string;
  /** Admin page to manage them, if there is one. */
  href?: string;
};

const PEOPLE: PersonDef[] = [
  { key: "customers", who: "id", group: "customers", label: "Customers", what: "Order rides, parcels, food and shopping; use wallets and Learn.", table: "users", where: "role = 'customer'", created: "created_at", href: "/people" },
  { key: "guests", who: "user_id", group: "customers", label: "Guest buyers", what: "Order without an account through a shared link.", table: "guest_orders", distinct: "user_id", created: "created_at" },
  { key: "tv", who: "owner_id", group: "customers", label: "TV devices", what: "Paired TVs that play Learn and browse.", table: "tv_devices", where: "status = 'paired'", created: "created_at" },

  { key: "boda_riders", who: "user_id", group: "ride", label: "Boda riders", what: "Ride motorcycles, deliver parcels and shop lists.", table: "riders", created: "created_at", pending: "verified = 0", href: "/people" },
  { key: "car_owners", who: "user_id", group: "ride", label: "Car owners", what: "Own cars and vehicles listed on Peebee Car.", table: "car_partners", where: "owner_status IN ('pending','approved','suspended')", created: "created_at", pending: "owner_status = 'pending'", href: "/settings/car" },
  { key: "car_drivers", who: "user_id", group: "ride", label: "Car drivers", what: "Drive cars for riders, carpools and owner deals.", table: "car_partners", where: "driver_status IN ('pending','approved','suspended')", created: "created_at", pending: "driver_status = 'pending'", href: "/settings/car" },
  { key: "taxipress", who: "user_id", group: "ride", label: "Taxipress drivers", what: "Run shared taxis along fixed routes.", table: "taxipress_taxis", created: "created_at", pending: "status = 'pending'", href: "/settings/taxipress" },
  { key: "relay", who: "user_id", group: "ride", label: "Relay operators", what: "Boda and matatu operators on relay delivery legs.", table: "relay_operators", created: "created_at", pending: "status = 'pending'", href: "/settings/relay" },
  { key: "stages", group: "ride", label: "Boda stages", what: "Rider groups with savings, loans and elected officers.", table: "stages", where: "status = 'active'", created: "created_at", href: "/stages" },
  { key: "stage_members", who: "rider_id", group: "ride", label: "Stage members", what: "Riders who belong to a stage.", table: "stage_members", where: "status = 'active'", distinct: "rider_id", created: "joined_at", href: "/stages" },

  { key: "restaurants", who: "owner_id", group: "buy", label: "Restaurants", what: "Kitchens and food sellers with menus.", table: "restaurants", created: "created_at", pending: "status = 'pending_approval'", href: "/people" },
  { key: "merchants", group: "buy", label: "Merchants", what: "Businesses and personal sellers who sell through Peebee.", table: "merchants", created: "created_at", pending: "status IN ('pending_approval','provisional')", href: "/people" },
  { key: "merchant_staff", who: "user_id", group: "buy", label: "Merchant staff", what: "Finance, managers and cashiers on a merchant account.", table: "merchant_members", where: "role <> 'owner' AND status = 'active'", distinct: "user_id", created: "created_at" },
  { key: "pharmacies", group: "buy", label: "Pharmacies", what: "Licensed stores that fill prescriptions.", table: "pharmacy_approvals", where: "status = 'approved'", created: "approved_at" },
  { key: "fuel_stations", group: "buy", label: "Fuel stations", what: "Stations that redeem fuel vouchers.", table: "fuel_stations", created: "created_at", pending: "status = 'pending_approval'" },
  { key: "fuel_managers", who: "user_id", group: "buy", label: "Station managers", what: "Managers, supervisors and dealers at a station.", table: "fuel_station_managers", where: "status = 'active'", distinct: "user_id", created: "created_at" },
  { key: "fuel_attendants", who: "user_id", group: "buy", label: "Pump attendants", what: "Serve fuel and scan vouchers.", table: "fuel_pump_attendants", where: "status <> 'suspended'", distinct: "user_id", created: "created_at" },

  { key: "schools", who: "owner_id", group: "learn", label: "Schools and educators", what: "Schools, academies, colleges and independent tutors.", table: "edu_schools", created: "created_at", href: "/settings/learn" },
  { key: "learners", who: "user_id", group: "learn", label: "Learners", what: "People enrolled in a course or class.", table: "edu_enrollments", where: "status = 'active'", distinct: "user_id", created: "created_at" },
  { key: "educator_plans", who: "user_id", group: "learn", label: "Educators on a paid plan", what: "Educators who pay for more room.", table: "edu_educator_plans", distinct: "user_id" },

  { key: "work_providers", who: "user_id", group: "hive", label: "Work providers", what: "Clean, Laundry and Fix companies and individuals.", table: "work_providers", created: "created_at", pending: "status = 'pending'", href: "/work/providers" },
  { key: "workers", who: "user_id", group: "hive", label: "Hire workers", what: "People who take gigs and projects.", table: "talent_profiles", created: "created_at", pending: "status = 'pending'", href: "/talent/workers" },
  { key: "employers", who: "user_id", group: "hive", label: "Hire employers", what: "People and businesses who post gigs, projects and roles.", table: "talent_employers", created: "created_at", href: "/talent" },
  { key: "service_businesses", who: "owner_id", group: "hive", label: "Service businesses", what: "Standalone service providers taking bookings.", table: "service_businesses", created: "created_at", pending: "status = 'pending_review'", href: "/settings/services-platform" },

  { key: "channels", who: "owner_id", group: "channels", label: "Channel creators", what: "Post, go live and earn from audiences.", table: "channels", created: "created_at", href: "/settings/channels" },
  { key: "subscribers", who: "user_id", group: "channels", label: "Channel members", what: "Paying members of a creator.", table: "channel_subscriptions", distinct: "user_id", created: "created_at" },

  { key: "sales_agents", who: "user_id", group: "money", label: "Sales agents", what: "Onboard riders, restaurants and merchants.", table: "sales_agents", created: "created_at", href: "/onboarding" },
  { key: "wallet_holders", who: "owner_id", group: "money", label: "Shared-wallet owners", what: "People who opened a wallet to share with family or a team.", table: "wallets", distinct: "owner_id", created: "created_at" },

  { key: "admins", who: "id", group: "staff", label: "Admin staff", what: "Peebee team members with an admin role.", table: "users", where: "role = 'admin'", created: "created_at", href: "/staff" },
  { key: "support_agents", who: "user_id", group: "staff", label: "Support agents", what: "Staff answering website chat.", table: "support_agent_presence", distinct: "user_id", href: "/support-chat" },
];

const GROUP_LABEL: Record<PersonGroup, string> = {
  customers: "Customers", ride: "Ride & delivery", buy: "Buy", learn: "Learn", hive: "Hive", channels: "Channels", money: "Money and growth", staff: "Peebee team",
};

async function countOne(def: PersonDef, environment: "live" | "sandbox"): Promise<{ total: number | null; last30: number | null; pending: number | null }> {
  if (!/^[a-z0-9_]+$/.test(def.table) || !(await hasTable(def.table))) return { total: null, last30: null, pending: null };
  const run = async (extra?: string): Promise<number | null> => {
    const conds = [def.where, extra, def.who ? demoPeopleFilter(environment, def.who) : ""].filter(Boolean).join(" AND ");
    try {
      const res = await db.execute(`SELECT COUNT(${def.distinct ? `DISTINCT ${def.distinct}` : "*"}) AS n FROM ${def.table}${conds ? ` WHERE ${conds}` : ""}`);
      return Number((res.rows[0] as Record<string, unknown>)?.n ?? 0);
    } catch {
      return null;
    }
  };
  const [total, last30, pending] = await Promise.all([
    run(),
    def.created ? run(`${def.created} >= datetime('now','-30 days')`) : Promise.resolve(null),
    def.pending ? run(def.pending) : Promise.resolve(null),
  ]);
  return { total, last30, pending };
}

platformMapRoutes.get("/admin/platform/people", requirePermission("stats.view"), async (c) => {
  const environment = await getPlatformEnvironment();
  await primeDemoAccounts();
  const counts = await Promise.all(PEOPLE.map((p) => countOne(p, environment)));
  return c.json({
    groups: (Object.keys(GROUP_LABEL) as PersonGroup[]).map((id) => ({ id, label: GROUP_LABEL[id] })),
    people: PEOPLE.map((p, i) => ({ key: p.key, group: p.group, label: p.label, what: p.what, href: p.href ?? null, reviewable: Object.hasOwn(REVIEW, p.key), ...counts[i]! })),
  });
});

/**
 * Every way Peebee earns. `purpose` links a stream to the platform ledger account it is posted to; streams with no
 * ledger posting yet are still listed (with how they work and where to set them) so nothing is invisible.
 */
type IncomeKind = "commission" | "fee" | "subscription" | "ads" | "deposit" | "other";
/** A table that records what Peebee kept on each sale, summed over a period (and one environment where the table has one). */
type IncomeSource = { table: string; sum: string; where?: string; at: string; env?: string };
type IncomeDef = { key: string; group: PersonGroup; label: string; kind: IncomeKind; how: string; purposes?: string[]; sources?: IncomeSource[]; href?: string };

const INCOME: IncomeDef[] = [
  { key: "ride_boda", group: "ride", label: "Boda rides", kind: "commission", how: "A commission on each ride fare, plus the service fee.", href: "/money-flow" },
  { key: "ride_car", group: "ride", label: "Car rides and rentals", kind: "commission", how: "Peebee's share of each completed car ride, carpool seat and self-drive rental.", href: "/settings/car", sources: [
    { table: "car_bookings", sum: "COALESCE(SUM(platform_amount),0)", where: "status = 'completed'", at: "created_at", env: "environment" },
    { table: "rentals", sum: "COALESCE(SUM(platform_amount),0)", where: "platform_amount IS NOT NULL", at: "created_at" },
  ] },
  { key: "rental_forfeit", group: "ride", label: "Rental deposits kept", kind: "deposit", how: "Damage or overtime taken from a self-drive deposit.", purposes: ["rental_deposit_forfeiture"], href: "/settings/car" },
  { key: "taxipress", group: "ride", label: "Taxipress seats", kind: "commission", how: "A commission on seats, luggage and assistance, plus any general fees.", href: "/settings/taxipress", sources: [
    { table: "taxipress_settlements", sum: "COALESCE(SUM(commission + platform_fees),0)", at: "created_at", env: "environment" },
  ] },
  { key: "delivery", group: "ride", label: "Parcel and shopping delivery", kind: "commission", how: "A commission and service fee on each delivery.", href: "/settings/delivery" },
  { key: "relay", group: "ride", label: "Relay delivery", kind: "fee", how: "What is left of the delivery price after every leg is paid.", purposes: ["order_revenue"], href: "/settings/relay" },
  { key: "cancel_time", group: "ride", label: "Cancel, waiting and rush-hour fees", kind: "fee", how: "Late-cancel fees, waiting time and busy-hour surcharges.", href: "/pricing" },
  { key: "stage_fines", group: "ride", label: "Stage fines", kind: "fee", how: "Fines and loan charges collected through stages.", href: "/settings/stage-savings" },

  { key: "food", group: "buy", label: "Restaurants and food", kind: "commission", how: "A commission on each food order.", href: "/money-flow" },
  { key: "marketplace", group: "buy", label: "Marketplace sales", kind: "commission", how: "A commission on store orders.", href: "/settings/marketplace" },
  { key: "merchant_plans", group: "buy", label: "Store plans (Pro and Elite)", kind: "subscription", how: "Monthly plans stores pay for more tools.", purposes: ["merchant_plan_revenue"], href: "/settings/marketplace" },
  { key: "digital_sales", group: "buy", label: "Digital product sales", kind: "commission", how: "A commission on downloads, licence keys and course sales.", purposes: ["digital_sales_commission"], href: "/settings/commerce-options" },
  { key: "merchant_instant", group: "buy", label: "Merchant instant payouts", kind: "fee", how: "A fee when a merchant asks to be paid at once.", purposes: ["settlement_fee_revenue"], href: "/settings/merchant-payments" },
  { key: "pharmacy", group: "buy", label: "Pharmacy orders", kind: "commission", how: "A commission on medicine orders.", href: "/money-flow" },
  { key: "gas", group: "buy", label: "Fuel vouchers", kind: "commission", how: "A margin on fuel redeemed at stations.", href: "/money-flow" },
  { key: "ads", group: "buy", label: "Ads and Spotlight", kind: "ads", how: "Stores and brands pay to be shown.", href: "/settings/video-ads" },

  { key: "learn_courses", group: "learn", label: "Course, class and bundle sales", kind: "commission", how: "The commission kept on every paid course, masterclass and course bundle.", href: "/settings/learn", sources: [
    { table: "edu_enrollments", sum: "COALESCE(SUM(commission_ugx),0)", where: "status = 'active'", at: "created_at", env: "environment" },
    { table: "edu_bundle_purchases", sum: "COALESCE(SUM(commission_ugx),0)", at: "created_at", env: "environment" },
  ] },
  { key: "learn_fees", group: "learn", label: "School fees", kind: "commission", how: "The commission kept when learners pay tuition and other school invoices.", href: "/settings/learn", sources: [
    { table: "edu_fee_payments", sum: "COALESCE(SUM(commission_ugx),0)", at: "created_at", env: "environment" },
  ] },
  { key: "learn_plans", group: "learn", label: "Learner passes and educator plans", kind: "subscription", how: "Commission on learner subscription passes, and what educators pay for a paid plan.", href: "/settings/learn", sources: [
    { table: "edu_subscriptions", sum: "COALESCE(SUM(commission_ugx),0)", at: "starts_at", env: "environment" },
    { table: "edu_educator_plans", sum: "COALESCE(SUM(price_paid_ugx),0)", where: "source = 'purchase'", at: "started_at" },
  ] },

  { key: "work", group: "hive", label: "Work jobs (Clean, Laundry, Fix)", kind: "commission", how: "The commission kept on each finished job.", href: "/work/settings", sources: [
    { table: "work_jobs", sum: "COALESCE(SUM(commission_ugx),0)", where: "status IN ('completed','settled')", at: "created_at", env: "environment" },
  ] },
  { key: "services", group: "hive", label: "Service bookings", kind: "commission", how: "A commission on each standalone service booking.", purposes: ["service_commission"], href: "/settings/services-platform" },
  { key: "talent", group: "hive", label: "Hire fees, plans and unlocks", kind: "fee", how: "Job fees, contact unlocks, featured posts and Hire plans that were paid.", href: "/talent/money", sources: [
    { table: "talent_charges", sum: "COALESCE(SUM(amount_ugx),0)", where: "status = 'paid'", at: "created_at", env: "environment" },
    { table: "talent_subscriptions", sum: "COALESCE(SUM(price_paid_ugx),0)", at: "created_at", env: "environment" },
  ] },

  { key: "channel_fees", group: "channels", label: "Channel fees", kind: "fee", how: "The platform's cut of memberships, tips, gifts, pay-per-view and donations.", purposes: ["channel_fees"], href: "/settings/channels" },

  { key: "rider_pro", group: "money", label: "Rider subscriptions and Pro", kind: "subscription", how: "What riders pay for Peebee Pro and their subscription.", href: "/settings/monetization", sources: [
    { table: "rider_pro_subscription_payments", sum: "COALESCE(SUM(amount),0)", where: "status = 'successful'", at: "created_at", env: "environment" },
    { table: "rider_subscription_payments", sum: "COALESCE(SUM(amount),0)", where: "status = 'successful'", at: "created_at", env: "environment" },
  ] },
  { key: "wallet_fees", group: "money", label: "Withdrawal fees", kind: "fee", how: "Fees taken when customers and fuel stations cash out.", href: "/settings/payments", sources: [
    { table: "customer_withdrawals", sum: "COALESCE(SUM(fee),0)", where: "status = 'successful'", at: "created_at", env: "environment" },
    { table: "fuel_station_withdrawals", sum: "COALESCE(SUM(fee_ugx),0)", where: "status = 'completed'", at: "created_at" },
  ] },
];

platformMapRoutes.get("/admin/platform/income", requirePermission("stats.view"), async (c) => {
  const environment = await getPlatformEnvironment();
  const range = c.req.query("range");
  const days = range === "today" ? 1 : range === "week" ? 7 : range === "month" ? 30 : null;
  const purposes = Array.from(new Set(INCOME.flatMap((s) => s.purposes ?? [])));
  const byPurpose = new Map<string, { amount: number; count: number }>();
  let ledgerOk = false;
  if (purposes.length && (await hasTable("ledger_entries")) && (await hasTable("ledger_accounts"))) {
    try {
      const res = await db.execute({
        sql: `SELECT a.purpose AS purpose, COALESCE(SUM(e.amount), 0) AS amount, COUNT(*) AS n
              FROM ledger_entries e
              JOIN ledger_accounts a ON a.id = e.account_id
              WHERE a.owner_type = 'platform' AND a.environment = ? AND a.purpose IN (${purposes.map(() => "?").join(",")})
                ${days ? `AND e.created_at >= datetime('now', '-${days} days')` : ""}
              GROUP BY a.purpose`,
        args: [environment, ...purposes],
      });
      for (const row of res.rows as Record<string, unknown>[]) byPurpose.set(String(row.purpose), { amount: Number(row.amount ?? 0), count: Number(row.n ?? 0) });
      ledgerOk = true;
    } catch {
      ledgerOk = false;
    }
  }
  // Streams recorded in their own tables. Each table is read on its own; one that is missing leaves that part out and the
  // stream shows what could be read, and a stream with nothing readable stays "not totalled".
  const fromTables = new Map<string, { amount: number; readable: number; total: number }>();
  await Promise.all(INCOME.filter((x) => x.sources?.length).map(async (def) => {
    let amount = 0, readable = 0;
    for (const src of def.sources!) {
      if (!/^[a-z0-9_]+$/.test(src.table) || !(await hasTable(src.table))) continue;
      const conds = [src.where, src.env ? `${src.env} = ?` : "", days ? `${src.at} >= datetime('now', '-${days} days')` : ""].filter(Boolean);
      try {
        const res = await db.execute({ sql: `SELECT ${src.sum} AS n FROM ${src.table}${conds.length ? ` WHERE ${conds.join(" AND ")}` : ""}`, args: src.env ? [environment] : [] });
        amount += Number((res.rows[0] as Record<string, unknown>)?.n ?? 0);
        readable += 1;
      } catch (err) {
        console.error(`Income source ${src.table} failed:`, err);
      }
    }
    fromTables.set(def.key, { amount, readable, total: def.sources!.length });
  }));
  return c.json({
    environment,
    range: range ?? "all",
    groups: (Object.keys(GROUP_LABEL) as PersonGroup[]).filter((g) => INCOME.some((s) => s.group === g)).map((id) => ({ id, label: GROUP_LABEL[id] })),
    streams: INCOME.map((s) => {
      const posted = s.purposes?.map((p) => byPurpose.get(p)).filter((x): x is { amount: number; count: number } => !!x) ?? [];
      const tracked = !!s.purposes && ledgerOk;
      const table = fromTables.get(s.key);
      return {
        key: s.key, group: s.group, label: s.label, kind: s.kind, how: s.how, href: s.href ?? null,
        // null = this stream is not posted to the platform ledger yet, so Admin can't total it here.
        amount: tracked ? posted.reduce((n, x) => n + x.amount, 0) : table && table.readable > 0 ? table.amount : null,
        count: tracked ? posted.reduce((n, x) => n + x.count, 0) : null,
        // "partial" = some of this stream's tables couldn't be read, so the figure may be low.
        partial: table ? table.readable < table.total && table.readable > 0 : false,
      };
    }),
  });
});


// ---------------------------------------------------------------------------
// Review: the people of one kind, with where each stands, so Admin can approve, suspend or reinstate them.
// ---------------------------------------------------------------------------

/**
 * What Admin does to change one kind of person. Almost every kind already has its own approve/suspend endpoint (each
 * with its own rules and notices), so Admin calls those; only the kinds that had none are changed by the endpoint
 * below. "user" means the person's account itself, which is the only lever for kinds with no status of their own.
 */
export type ReviewAction =
  | "user" | "rider" | "car_owner" | "car_driver" | "taxipress" | "relay" | "restaurant" | "merchant"
  | "work_provider" | "worker" | "service_business" | "channel" | "school" | "platform";

type ReviewDef = {
  kind: ReviewAction;
  /** SQL for the id the action endpoint wants. */
  id: string;
  /** SQL for the person's user id, for their name and account actions. */
  user?: string;
  name: string;
  phone?: string;
  /** SQL giving one of waiting | active | suspended | rejected. */
  status: string;
  detail?: string;
  created?: string;
  /** One row per person even if the table holds several. */
  group?: boolean;
  view: Permission;
  manage: Permission;
  /** For kind "platform": how this table is changed. */
  write?: { table: string; idCol: string; active: string; suspended: string; label: string };
};

const OWNER_PHONE = "(SELECT u.phone FROM merchant_members m JOIN users u ON u.id = m.user_id WHERE m.merchant_id = t.id AND m.role = 'owner' LIMIT 1)";
const USER_NAME = (col: string) => `(SELECT name FROM users WHERE id = t.${col})`;
const USER_PHONE = (col: string) => `(SELECT phone FROM users WHERE id = t.${col})`;
const STD = (col = "status") => `CASE t.${col} WHEN 'pending' THEN 'waiting' WHEN 'approved' THEN 'active' WHEN 'suspended' THEN 'suspended' WHEN 'rejected' THEN 'rejected' ELSE 'active' END`;
const ACCOUNT_STATUS = (col: string) => `CASE (SELECT status FROM users WHERE id = t.${col}) WHEN 'suspended' THEN 'suspended' ELSE 'active' END`;
const accountOf = (col: string, label: string, view: Permission, created?: string, group = false): ReviewDef => ({
  kind: "user", id: col, user: col, name: USER_NAME(col), phone: USER_PHONE(col), status: ACCOUNT_STATUS(col), created, group, view, manage: "customers.manage",
  detail: `'${label}'`,
});

const REVIEW: Record<string, ReviewDef> = {
  customers: { kind: "user", id: "t.id", user: "t.id", name: "t.name", phone: "t.phone", status: "CASE t.status WHEN 'suspended' THEN 'suspended' ELSE 'active' END", created: "t.created_at", view: "customers.view", manage: "customers.manage" },
  boda_riders: { kind: "rider", id: "t.user_id", user: "t.user_id", name: USER_NAME("user_id"), phone: USER_PHONE("user_id"), status: `CASE WHEN (SELECT status FROM users WHERE id = t.user_id) = 'suspended' THEN 'suspended' WHEN t.verified = 1 THEN 'active' ELSE 'waiting' END`, created: "t.created_at", view: "riders.view", manage: "riders.verify" },
  car_owners: { kind: "car_owner", id: "t.user_id", user: "t.user_id", name: USER_NAME("user_id"), phone: USER_PHONE("user_id"), status: STD("owner_status"), created: "t.created_at", view: "car.view", manage: "car.manage" },
  car_drivers: { kind: "car_driver", id: "t.user_id", user: "t.user_id", name: USER_NAME("user_id"), phone: USER_PHONE("user_id"), status: STD("driver_status"), created: "t.created_at", view: "car.view", manage: "car.manage" },
  taxipress: { kind: "taxipress", id: "t.id", user: "t.user_id", name: USER_NAME("user_id"), phone: USER_PHONE("user_id"), status: STD(), detail: "t.plate", created: "t.created_at", view: "riders.view", manage: "riders.verify" },
  relay: { kind: "relay", id: "t.user_id", user: "t.user_id", name: USER_NAME("user_id"), phone: USER_PHONE("user_id"), status: STD(), detail: "t.vehicle_plate", created: "t.created_at", view: "riders.view", manage: "riders.verify" },
  restaurants: { kind: "restaurant", id: "t.id", user: "t.owner_id", name: "t.name", phone: USER_PHONE("owner_id"), status: "CASE t.status WHEN 'pending_approval' THEN 'waiting' WHEN 'suspended' THEN 'suspended' ELSE 'active' END", created: "t.created_at", view: "restaurants.view", manage: "restaurants.manage" },
  merchants: { kind: "merchant", id: "t.id", name: "t.display_name", phone: OWNER_PHONE, status: "CASE t.status WHEN 'pending_approval' THEN 'waiting' WHEN 'provisional' THEN 'waiting' WHEN 'suspended' THEN 'suspended' WHEN 'rejected' THEN 'rejected' ELSE 'active' END", detail: "t.business_kind", created: "t.created_at", view: "merchants.view", manage: "merchants.manage" },
  work_providers: { kind: "work_provider", id: "t.id", user: "t.user_id", name: "t.display_name", phone: USER_PHONE("user_id"), status: STD(), detail: "t.kind", created: "t.created_at", view: "work.view", manage: "work.manage" },
  workers: { kind: "worker", id: "t.user_id", user: "t.user_id", name: USER_NAME("user_id"), phone: USER_PHONE("user_id"), status: STD(), created: "t.created_at", view: "talent.view", manage: "talent.manage" },
  service_businesses: { kind: "service_business", id: "t.id", user: "t.owner_id", name: "t.name", phone: USER_PHONE("owner_id"), status: "CASE t.status WHEN 'pending_review' THEN 'waiting' WHEN 'paused' THEN 'suspended' ELSE 'active' END", created: "t.created_at", view: "settings.view", manage: "settings.manage" },
  channels: { kind: "channel", id: "t.id", user: "t.owner_id", name: "t.display_name", phone: USER_PHONE("owner_id"), status: "CASE t.status WHEN 'suspended' THEN 'suspended' ELSE 'active' END", detail: "'@' || t.handle", created: "t.created_at", view: "channels.view", manage: "settings.manage" },
  schools: { kind: "school", id: "t.id", user: "t.owner_id", name: "t.name", phone: USER_PHONE("owner_id"), status: "CASE t.status WHEN 'suspended' THEN 'suspended' ELSE 'active' END", detail: "t.kind", created: "t.created_at", view: "settings.view", manage: "settings.manage" },
  // These four had no approve or suspend of their own.
  fuel_stations: { kind: "platform", id: "t.id", name: "t.brand_name", status: "CASE t.status WHEN 'pending_approval' THEN 'waiting' WHEN 'suspended' THEN 'suspended' ELSE 'active' END", detail: "t.company_name", created: "t.created_at", view: "merchants.view", manage: "merchants.manage", write: { table: "fuel_stations", idCol: "id", active: "active", suspended: "suspended", label: "fuel station" } },
  fuel_managers: { kind: "platform", id: "t.id", user: "t.user_id", name: USER_NAME("user_id"), phone: USER_PHONE("user_id"), status: "CASE t.status WHEN 'suspended' THEN 'suspended' ELSE 'active' END", detail: "t.role", created: "t.created_at", view: "merchants.view", manage: "merchants.manage", write: { table: "fuel_station_managers", idCol: "id", active: "active", suspended: "suspended", label: "station manager" } },
  fuel_attendants: { kind: "platform", id: "t.id", user: "t.user_id", name: USER_NAME("user_id"), phone: USER_PHONE("user_id"), status: "CASE t.status WHEN 'suspended' THEN 'suspended' ELSE 'active' END", created: "t.created_at", view: "merchants.view", manage: "merchants.manage", write: { table: "fuel_pump_attendants", idCol: "id", active: "off_duty", suspended: "suspended", label: "pump attendant" } },
  employers: { kind: "platform", id: "t.user_id", user: "t.user_id", name: USER_NAME("user_id"), phone: USER_PHONE("user_id"), status: "CASE t.status WHEN 'suspended' THEN 'suspended' ELSE 'active' END", created: "t.created_at", view: "talent.view", manage: "talent.manage", write: { table: "talent_employers", idCol: "user_id", active: "active", suspended: "suspended", label: "employer" } },
  // No status of their own: the only lever is the person's account, which Admin labels clearly.
  sales_agents: accountOf("user_id", "Sales agent", "customers.view", "t.created_at"),
  learners: accountOf("user_id", "Learner", "customers.view", "MIN(t.created_at)", true),
  subscribers: accountOf("user_id", "Channel member", "customers.view", "MIN(t.created_at)", true),
  stage_members: accountOf("rider_id", "Stage member", "riders.view", "MIN(t.joined_at)", true),
  merchant_staff: accountOf("user_id", "Merchant staff", "merchants.view", "MIN(t.created_at)", true),
};

const reviewOf = (key: string): { def: PersonDef; rv: ReviewDef } | null => {
  const def = PEOPLE.find((p) => p.key === key);
  const rv = Object.hasOwn(REVIEW, key) ? REVIEW[key] : undefined;
  return def && rv ? { def, rv } : null;
};

/** Which kinds Admin can review, and what it does to each. */
platformMapRoutes.get("/admin/platform/people/:key/list", async (c) => {
  const found = reviewOf(c.req.param("key"));
  if (!found) return c.json({ error: "not_found", message: "That kind of person has no approval step." }, 404);
  const { def, rv } = found;
  const user = c.get("user") as { adminRole?: string | null };
  if (!hasPermission(user?.adminRole as never, rv.view)) return c.json({ error: "forbidden", message: "Your role doesn't include this." }, 403);
  if (!(await hasTable(def.table))) return c.json({ kind: rv.kind, label: def.label, what: def.what, canManage: false, counts: {}, items: [], notReady: true });

  const environment = await getPlatformEnvironment();
  await primeDemoAccounts();
  const status = c.req.query("status") ?? "all";
  const q = (c.req.query("q") ?? "").trim().slice(0, 60);
  const baseWhere = [def.where, def.who ? demoPeopleFilter(environment, `t.${def.who}`) : ""].filter(Boolean);
  // The kind's own filter uses bare column names; they all belong to this table, so aliasing the table as "t" is safe.
  const where = baseWhere.length ? `WHERE ${baseWhere.join(" AND ")}` : "";
  const grouped = rv.group ? `GROUP BY ${rv.id}` : "";
  const inner = `SELECT ${rv.id} AS id, ${rv.user ?? "NULL"} AS user_id, ${rv.name} AS name, ${rv.phone ?? "NULL"} AS phone, ${rv.status} AS st, ${rv.detail ?? "NULL"} AS detail, ${rv.created ?? "NULL"} AS created FROM ${def.table} t ${where} ${grouped}`;
  try {
    const counts: Record<string, number> = {};
    const cres = await db.execute(`SELECT st, COUNT(*) AS n FROM (${inner}) GROUP BY st`);
    for (const row of cres.rows as Record<string, unknown>[]) counts[String(row.st)] = Number(row.n ?? 0);
    const args: (string | number)[] = [];
    const conds: string[] = [];
    if (status !== "all") { conds.push("st = ?"); args.push(status); }
    if (q) { conds.push("(LOWER(COALESCE(name,'')) LIKE ? OR COALESCE(phone,'') LIKE ?)"); args.push(`%${q.toLowerCase()}%`, `%${q}%`); }
    const res = await db.execute({ sql: `SELECT * FROM (${inner}) ${conds.length ? `WHERE ${conds.join(" AND ")}` : ""} ORDER BY created DESC LIMIT 100`, args });
    return c.json({
      kind: rv.kind, label: def.label, what: def.what, href: def.href ?? null, canManage: hasPermission(user?.adminRole as never, rv.manage), counts,
      accountOnly: rv.kind === "user" && rv.id !== "t.id",
      items: (res.rows as Record<string, unknown>[]).map((r) => ({
        id: String(r.id), userId: r.user_id ? String(r.user_id) : null, name: r.name ? String(r.name) : "Unnamed", phone: r.phone ? String(r.phone) : null,
        status: String(r.st), detail: r.detail ? String(r.detail) : null, createdAt: r.created ? String(r.created) : null,
      })),
    });
  } catch (err) {
    console.error(`Admin people list failed for ${def.key}:`, err);
    return c.json({ error: "list_failed", message: "This list could not be read right now." }, 500);
  }
});

/** Approve/suspend for the kinds that had no endpoint of their own. Everything else is done through that kind's existing endpoint. */
platformMapRoutes.post("/admin/platform/people/:key/:id/status", async (c) => {
  const found = reviewOf(c.req.param("key"));
  const w = found?.rv.write;
  if (!found || found.rv.kind !== "platform" || !w) return c.json({ error: "not_found", message: "This kind is changed elsewhere." }, 404);
  const { def, rv } = found;
  const user = c.get("user") as { sub: string; adminRole?: string | null };
  if (!hasPermission(user?.adminRole as never, rv.manage)) return c.json({ error: "forbidden", message: "Your role doesn't include this action." }, 403);
  const body = (await c.req.json().catch(() => ({}))) as { status?: string };
  if (body.status !== "active" && body.status !== "suspended") return c.json({ error: "invalid_body", message: "Choose active or suspended." }, 400);
  const id = c.req.param("id");
  if (!(await hasTable(w.table))) return c.json({ error: "not_found" }, 404);
  const next = body.status === "active" ? w.active : w.suspended;
  const before = await db.execute({ sql: `SELECT status FROM ${w.table} WHERE ${w.idCol} = ?`, args: [id] });
  if (!before.rows[0]) return c.json({ error: "not_found", message: "Not found." }, 404);
  await db.execute({ sql: `UPDATE ${w.table} SET status = ? WHERE ${w.idCol} = ?`, args: [next, id] });
  await logActivity({
    actor: user as never, action: `people.${def.key}.${body.status}`, entityType: def.key, entityId: id,
    summary: `${body.status === "active" ? "Reinstated" : "Suspended"} ${w.label} ${id}`,
    before: { status: (before.rows[0] as Record<string, unknown>).status }, after: { status: next }, ip: clientIp(c),
  });
  return c.json({ ok: true, status: body.status });
});
