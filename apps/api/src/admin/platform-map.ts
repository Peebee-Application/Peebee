import { Hono } from "hono";
import { db } from "../db/client.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { getPlatformEnvironment } from "../lib/settings.js";
import { hasTable } from "../lib/schema.js";
import { demoPeopleFilter, primeDemoAccounts } from "../practice/people.js";
import { requirePermission } from "./permissions.js";

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
    people: PEOPLE.map((p, i) => ({ key: p.key, group: p.group, label: p.label, what: p.what, href: p.href ?? null, ...counts[i]! })),
  });
});

/**
 * Every way Peebee earns. `purpose` links a stream to the platform ledger account it is posted to; streams with no
 * ledger posting yet are still listed (with how they work and where to set them) so nothing is invisible.
 */
type IncomeKind = "commission" | "fee" | "subscription" | "ads" | "deposit" | "other";
type IncomeDef = { key: string; group: PersonGroup; label: string; kind: IncomeKind; how: string; purposes?: string[]; href?: string };

const INCOME: IncomeDef[] = [
  { key: "ride_boda", group: "ride", label: "Boda rides", kind: "commission", how: "A commission on each ride fare, plus the service fee.", href: "/money-flow" },
  { key: "ride_car", group: "ride", label: "Car rides and rentals", kind: "commission", how: "A share of each car fare, carpool seat and rental.", href: "/settings/car" },
  { key: "rental_forfeit", group: "ride", label: "Rental deposits kept", kind: "deposit", how: "Damage or overtime taken from a self-drive deposit.", purposes: ["rental_deposit_forfeiture"], href: "/settings/car" },
  { key: "taxipress", group: "ride", label: "Taxipress seats", kind: "commission", how: "A commission on seats, luggage and assistance.", href: "/settings/taxipress" },
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

  { key: "learn_fees", group: "learn", label: "Course and class sales", kind: "commission", how: "A commission on paid courses, masterclasses and school fees.", href: "/settings/learn" },
  { key: "learn_plans", group: "learn", label: "Educator plans and learner passes", kind: "subscription", how: "Educators pay for more room; learners pay for subscription passes.", href: "/settings/learn" },

  { key: "work", group: "hive", label: "Work jobs (Clean, Laundry, Fix)", kind: "commission", how: "A commission on each job, and a worker commission for companies.", href: "/work/settings" },
  { key: "services", group: "hive", label: "Service bookings", kind: "commission", how: "A commission on each standalone service booking.", purposes: ["service_commission"], href: "/settings/services-platform" },
  { key: "talent", group: "hive", label: "Hire fees, plans and unlocks", kind: "fee", how: "Job fees, contact unlocks, featured posts and employer plans.", href: "/talent/money" },

  { key: "channel_fees", group: "channels", label: "Channel fees", kind: "fee", how: "The platform's cut of memberships, tips, gifts, pay-per-view and donations.", purposes: ["channel_fees"], href: "/settings/channels" },

  { key: "rider_pro", group: "money", label: "Peebee Pro (riders)", kind: "subscription", how: "Riders pay monthly for Pro tools.", href: "/settings/monetization" },
  { key: "wallet_fees", group: "money", label: "Wallet and withdrawal fees", kind: "fee", how: "Fees on top-ups and cash-outs.", href: "/settings/payments" },
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
  return c.json({
    environment,
    range: range ?? "all",
    groups: (Object.keys(GROUP_LABEL) as PersonGroup[]).filter((g) => INCOME.some((s) => s.group === g)).map((id) => ({ id, label: GROUP_LABEL[id] })),
    streams: INCOME.map((s) => {
      const posted = s.purposes?.map((p) => byPurpose.get(p)).filter((x): x is { amount: number; count: number } => !!x) ?? [];
      const tracked = !!s.purposes && ledgerOk;
      return {
        key: s.key, group: s.group, label: s.label, kind: s.kind, how: s.how, href: s.href ?? null,
        // null = this stream is not posted to the platform ledger yet, so Admin can't total it here.
        amount: tracked ? posted.reduce((n, x) => n + x.amount, 0) : null,
        count: tracked ? posted.reduce((n, x) => n + x.count, 0) : null,
      };
    }),
  });
});
