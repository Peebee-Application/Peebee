import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import { hasColumn, hasTable } from "../lib/schema.js";
import { getGasSettings } from "../lib/settings.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { requirePermission } from "../admin/permissions.js";
import { logActivity } from "../admin/activity.js";
import { executeBatch } from "../db/client.js";
import { consume } from "../lib/ratelimit.js";
import { randomInt } from "../lib/random.js";
import { getPlatformEnvironment } from "../lib/settings.js";
import { generatePin, hashPin, pinAttemptGuard, pinMatches, requireAttendant, requireManager, signGasToken, validatePinFormat } from "./auth.js";
import { burnPinCheck } from "./auth.js";
import { closeVoucher, expireStaleVouchers, findVoucher, holdForVoucher, normalizeVoucherCode, refundToRider, vouchersReady, voucherEnvironment } from "./vouchers.js";

export const gasRoutes = new Hono();

// Fallback products and outlets metadata
const FALLBACK_PRODUCTS = [
  { id: "prod_petrol", name: "Unleaded Petrol", category: "fuel", unit: "L", defaultPrice: 5450 },
  { id: "prod_diesel", name: "Ultra Low Sulphur Diesel", category: "fuel", unit: "L", defaultPrice: 5150 },
  { id: "prod_vpower", name: "Shell V-Power / Excellium", category: "fuel", unit: "L", defaultPrice: 5850 },
  { id: "prod_oil_2t", name: "2T Two-Stroke Boda Oil", category: "lubricant", unit: "L", defaultPrice: 12000 },
  { id: "prod_oil_4t", name: "4T Motorcycle Engine Oil", category: "lubricant", unit: "L", defaultPrice: 15000 },
];

const FALLBACK_OUTLETS = [
  {
    id: "fout_total_lugogo",
    station_id: "station_total",
    station_name: "TotalEnergies",
    name: "TotalEnergies Lugogo Bypass",
    code: "GAS-TOT-01",
    address: "Lugogo Bypass / Jinja Road, Kampala",
    lat: 0.3275,
    lng: 32.6021,
    phone: "+256700100001",
    active_pumps: 6,
    status: "active",
  },
  {
    id: "fout_shell_bugolobi",
    station_id: "station_shell",
    station_name: "Shell",
    name: "Shell Bugolobi",
    code: "GAS-SHL-02",
    address: "Spring Road, Bugolobi, Kampala",
    lat: 0.3168,
    lng: 32.6184,
    phone: "+256700100002",
    active_pumps: 4,
    status: "active",
  },
  {
    id: "fout_rubis_kibuye",
    station_id: "station_rubis",
    station_name: "Rubis Energy",
    name: "Rubis Kibuye Roundabout",
    code: "GAS-RUB-03",
    address: "Entebbe Road, Kibuye, Kampala",
    lat: 0.2982,
    lng: 32.5714,
    phone: "+256700100003",
    active_pumps: 4,
    status: "active",
  },
  {
    id: "fout_stabex_nansana",
    station_id: "station_stabex",
    station_name: "Stabex International",
    name: "Stabex Nansana",
    code: "GAS-STB-04",
    address: "Hoima Road, Nansana, Wakiso",
    lat: 0.3642,
    lng: 32.5298,
    phone: "+256700100004",
    active_pumps: 6,
    status: "active",
  },
  {
    id: "fout_hass_wandegeya",
    station_id: "station_hass",
    station_name: "Hass Petroleum",
    name: "Hass Wandegeya",
    code: "GAS-HSS-05",
    address: "Bombo Road, Wandegeya, Kampala",
    lat: 0.3341,
    lng: 32.5721,
    phone: "+256700100005",
    active_pumps: 4,
    status: "active",
  },
  {
    id: "fout_cityoil_bombo",
    station_id: "station_cityoil",
    station_name: "CityOil",
    name: "CityOil Bombo Road",
    code: "GAS-CTY-06",
    address: "Bombo Road / Makerere Hill, Kampala",
    lat: 0.3295,
    lng: 32.5694,
    phone: "+256700100006",
    active_pumps: 6,
    status: "active",
  },
];

let schemaEnsured = false;

/** Automatically provision gas tables and base seed data if not yet present in D1 */
async function ensureGasSchema() {
  if (schemaEnsured) return;
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS fuel_stations (
        id TEXT PRIMARY KEY,
        brand_name TEXT NOT NULL,
        company_name TEXT NOT NULL,
        logo_url TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS fuel_station_outlets (
        id TEXT PRIMARY KEY,
        station_id TEXT NOT NULL REFERENCES fuel_stations(id),
        name TEXT NOT NULL,
        code TEXT UNIQUE NOT NULL,
        address TEXT,
        lat REAL,
        lng REAL,
        phone TEXT,
        active_pumps INTEGER NOT NULL DEFAULT 4,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS fuel_products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        unit TEXT NOT NULL DEFAULT 'L',
        sort_order INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS fuel_station_prices (
        outlet_id TEXT NOT NULL REFERENCES fuel_station_outlets(id),
        product_id TEXT NOT NULL REFERENCES fuel_products(id),
        price_per_unit INTEGER NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (outlet_id, product_id)
      );
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS fuel_pump_attendants (
        id TEXT PRIMARY KEY,
        outlet_id TEXT NOT NULL REFERENCES fuel_station_outlets(id),
        user_id TEXT,
        attendant_code TEXT UNIQUE NOT NULL,
        full_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        pump_lane TEXT,
        status TEXT NOT NULL DEFAULT 'on_duty',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS fuel_codes (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        rider_id TEXT NOT NULL,
        vehicle_plate TEXT NOT NULL,
        authorized_amount_ugx INTEGER NOT NULL,
        fuel_product_id TEXT,
        outlet_id TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        source TEXT NOT NULL DEFAULT 'rider_wallet',
        expires_at TEXT NOT NULL,
        dispensed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS fuel_dispenses (
        id TEXT PRIMARY KEY,
        code_id TEXT,
        outlet_id TEXT NOT NULL,
        attendant_id TEXT,
        rider_id TEXT NOT NULL,
        vehicle_plate TEXT NOT NULL,
        product_id TEXT NOT NULL,
        price_per_litre INTEGER NOT NULL,
        litres_dispensed REAL NOT NULL,
        total_ugx INTEGER NOT NULL,
        pump_number INTEGER,
        receipt_ref TEXT UNIQUE NOT NULL,
        environment TEXT NOT NULL DEFAULT 'live',
        status TEXT NOT NULL DEFAULT 'completed',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS fuel_attendant_shifts (
        id TEXT PRIMARY KEY,
        attendant_id TEXT NOT NULL,
        outlet_id TEXT NOT NULL,
        opened_at TEXT NOT NULL DEFAULT (datetime('now')),
        closed_at TEXT,
        start_pump_meter REAL DEFAULT 0,
        end_pump_meter REAL,
        total_dispenses INTEGER NOT NULL DEFAULT 0,
        total_litres REAL NOT NULL DEFAULT 0,
        total_amount_ugx INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // Seed fuel products
    await db.execute(`
      INSERT OR IGNORE INTO fuel_products (id, name, category, unit, sort_order, active) VALUES
        ('prod_petrol', 'Unleaded Petrol', 'fuel', 'L', 10, 1),
        ('prod_diesel', 'Ultra Low Sulphur Diesel', 'fuel', 'L', 20, 1),
        ('prod_vpower', 'Shell V-Power / Excellium', 'fuel', 'L', 30, 1),
        ('prod_oil_2t', '2T Two-Stroke Boda Oil', 'lubricant', 'L', 40, 1),
        ('prod_oil_4t', '4T Motorcycle Engine Oil', 'lubricant', 'L', 50, 1);
    `);

    // Seed stations
    await db.execute(`
      INSERT OR IGNORE INTO fuel_stations (id, brand_name, company_name, status) VALUES
        ('station_total', 'TotalEnergies', 'TotalEnergies Marketing Uganda Ltd', 'active'),
        ('station_shell', 'Shell', 'Vivo Energy Uganda Ltd', 'active'),
        ('station_rubis', 'Rubis Energy', 'Rubis Energy Uganda Ltd', 'active'),
        ('station_stabex', 'Stabex International', 'Stabex International Ltd', 'active'),
        ('station_hass', 'Hass Petroleum', 'Hass Petroleum Uganda Ltd', 'active'),
        ('station_cityoil', 'CityOil', 'CityOil Uganda Ltd', 'active');
    `);

    // Seed outlets
    await db.execute(`
      INSERT OR IGNORE INTO fuel_station_outlets (id, station_id, name, code, address, lat, lng, phone, active_pumps, status) VALUES
        ('fout_total_lugogo', 'station_total', 'TotalEnergies Lugogo Bypass', 'GAS-TOT-01', 'Lugogo Bypass / Jinja Road, Kampala', 0.3275, 32.6021, '+256700100001', 6, 'active'),
        ('fout_shell_bugolobi', 'station_shell', 'Shell Bugolobi', 'GAS-SHL-02', 'Spring Road, Bugolobi, Kampala', 0.3168, 32.6184, '+256700100002', 4, 'active'),
        ('fout_rubis_kibuye', 'station_rubis', 'Rubis Kibuye Roundabout', 'GAS-RUB-03', 'Entebbe Road, Kibuye, Kampala', 0.2982, 32.5714, '+256700100003', 4, 'active'),
        ('fout_stabex_nansana', 'station_stabex', 'Stabex Nansana', 'GAS-STB-04', 'Hoima Road, Nansana, Wakiso', 0.3642, 32.5298, '+256700100004', 6, 'active'),
        ('fout_hass_wandegeya', 'station_hass', 'Hass Wandegeya', 'GAS-HSS-05', 'Bombo Road, Wandegeya, Kampala', 0.3341, 32.5721, '+256700100005', 4, 'active'),
        ('fout_cityoil_bombo', 'station_cityoil', 'CityOil Bombo Road', 'GAS-CTY-06', 'Bombo Road / Makerere Hill, Kampala', 0.3295, 32.5694, '+256700100006', 6, 'active');
    `);

    // Seed prices
    await db.execute(`
      INSERT OR IGNORE INTO fuel_station_prices (outlet_id, product_id, price_per_unit) VALUES
        ('fout_total_lugogo', 'prod_petrol', 5450),
        ('fout_total_lugogo', 'prod_diesel', 5150),
        ('fout_total_lugogo', 'prod_vpower', 5850),
        ('fout_total_lugogo', 'prod_oil_2t', 12000),
        ('fout_total_lugogo', 'prod_oil_4t', 15000),
        ('fout_shell_bugolobi', 'prod_petrol', 5470),
        ('fout_shell_bugolobi', 'prod_diesel', 5170),
        ('fout_shell_bugolobi', 'prod_vpower', 5890),
        ('fout_shell_bugolobi', 'prod_oil_2t', 12500),
        ('fout_shell_bugolobi', 'prod_oil_4t', 15500),
        ('fout_rubis_kibuye', 'prod_petrol', 5430),
        ('fout_rubis_kibuye', 'prod_diesel', 5130),
        ('fout_rubis_kibuye', 'prod_oil_2t', 11800),
        ('fout_rubis_kibuye', 'prod_oil_4t', 14800),
        ('fout_stabex_nansana', 'prod_petrol', 5390),
        ('fout_stabex_nansana', 'prod_diesel', 5090),
        ('fout_stabex_nansana', 'prod_oil_2t', 11500),
        ('fout_stabex_nansana', 'prod_oil_4t', 14500),
        ('fout_hass_wandegeya', 'prod_petrol', 5420),
        ('fout_hass_wandegeya', 'prod_diesel', 5120),
        ('fout_hass_wandegeya', 'prod_oil_2t', 11900),
        ('fout_hass_wandegeya', 'prod_oil_4t', 14900),
        ('fout_cityoil_bombo', 'prod_petrol', 5440),
        ('fout_cityoil_bombo', 'prod_diesel', 5140),
        ('fout_cityoil_bombo', 'prod_oil_2t', 12000),
        ('fout_cityoil_bombo', 'prod_oil_4t', 15000);
    `);

    // Manager and payout tables
    await db.execute(`
      CREATE TABLE IF NOT EXISTS fuel_station_managers (
        id TEXT PRIMARY KEY,
        outlet_id TEXT NOT NULL REFERENCES fuel_station_outlets(id),
        user_id TEXT REFERENCES users(id),
        manager_code TEXT UNIQUE NOT NULL,
        full_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        pin TEXT NOT NULL DEFAULT '1234',
        role TEXT NOT NULL DEFAULT 'station_manager' CHECK (role IN ('station_manager', 'supervisor', 'dealer')),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS fuel_station_withdrawals (
        id TEXT PRIMARY KEY,
        outlet_id TEXT NOT NULL REFERENCES fuel_station_outlets(id),
        manager_id TEXT NOT NULL,
        amount_ugx INTEGER NOT NULL CHECK (amount_ugx > 0),
        fee_ugx INTEGER NOT NULL DEFAULT 0,
        destination_type TEXT NOT NULL CHECK (destination_type IN ('momo', 'bank')),
        destination_details TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
        reference TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS fuel_station_payout_accounts (
        id TEXT PRIMARY KEY,
        outlet_id TEXT NOT NULL REFERENCES fuel_station_outlets(id),
        type TEXT NOT NULL CHECK (type IN ('momo', 'bank')),
        account_ref TEXT NOT NULL,
        account_name TEXT NOT NULL,
        network_or_bank TEXT NOT NULL,
        is_primary INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // Safe column additions on fuel_pump_attendants
    try { await db.execute("ALTER TABLE fuel_pump_attendants ADD COLUMN commission_status TEXT DEFAULT 'approved'"); } catch {}
    try { await db.execute("ALTER TABLE fuel_pump_attendants ADD COLUMN commissioned_by TEXT"); } catch {}
    try { await db.execute("ALTER TABLE fuel_pump_attendants ADD COLUMN commissioned_at TEXT"); } catch {}
    try { await db.execute("ALTER TABLE fuel_pump_attendants ADD COLUMN pin TEXT DEFAULT '1234'"); } catch {}

    // Demo staff and payout accounts exist only in local development, with a
    // known development PIN. They are never created on a deployed API.
    if ((process.env.ENVIRONMENT ?? "development") === "development") {
      const devPin = await hashPin("2468");
      await db.execute({
        sql: `INSERT OR IGNORE INTO fuel_pump_attendants (id, outlet_id, attendant_code, full_name, phone, pump_lane, status, pin) VALUES
          ('fatt_lugogo_1', 'fout_total_lugogo', 'ATT-1001', 'Kato Dennis', '+256701111001', 'Pump 2 (Boda Lane)', 'on_duty', ?)`,
        args: [devPin],
      });
      await db.execute({
        sql: `INSERT OR IGNORE INTO fuel_station_managers (id, outlet_id, manager_code, full_name, phone, pin, role, status) VALUES
          ('fmgr_tot_01', 'fout_total_lugogo', 'MGR-TOT-01', 'Patrick Semakula', '+256701999001', ?, 'dealer', 'active')`,
        args: [devPin],
      });
      // Migrations seed these accounts without a usable PIN; give the dev ones a known PIN.
      await db.execute({ sql: "UPDATE fuel_pump_attendants SET pin = ? WHERE id = 'fatt_lugogo_1' AND (pin IS NULL OR pin NOT LIKE '$2%')", args: [devPin] });
      await db.execute({ sql: "UPDATE fuel_station_managers SET pin = ? WHERE id = 'fmgr_tot_01' AND (pin IS NULL OR pin NOT LIKE '$2%')", args: [devPin] });
      await db.execute(`
        INSERT OR IGNORE INTO fuel_station_payout_accounts (id, outlet_id, type, account_ref, account_name, network_or_bank, is_primary) VALUES
          ('fpay_tot_momo', 'fout_total_lugogo', 'momo', '+256772100001', 'TotalEnergies Lugogo Bypass Settlement', 'MTN', 1)
      `);
    }

    schemaEnsured = true;
  } catch (e) {
    console.warn("Gas schema provision note:", e);
  }
}
type Row = Record<string, any>;

// Every gas request makes sure the tables exist first.
gasRoutes.use("*", async (_c, next) => {
  await ensureGasSchema();
  await next();
});

// Admin kill switch: while fuel payments are off, no voucher can be created,
// scanned or redeemed. Station listings and sign-in stay up.
const SWITCHED_OFF_ROUTES = ["/rider/generate-code", "/verify-code", "/dispense"];
gasRoutes.use("*", async (c, next) => {
  if (c.req.method === "POST" && SWITCHED_OFF_ROUTES.some((p) => c.req.path.endsWith(p))) {
    const { enabled } = await getGasSettings();
    if (!enabled) return c.json({ error: "service_disabled", message: "Fuel payments are switched off right now." }, 503);
  }
  await next();
});

const nowIso = () => new Date().toISOString();
const idParam = (c: { req: { param: (k: string) => string | undefined } }) => c.req.param("id") ?? "";

/** Public service status: only what the apps need to display. */
gasRoutes.get("/status", async (c) => {
  const s = await getGasSettings();
  return c.json({
    ok: true,
    settings: {
      enabled: s.enabled,
      dailyLimitUgx: s.dailyLimitUgx,
      voucherExpiryMinutes: s.voucherExpiryMinutes,
      platformDiscountPercent: s.platformDiscountPercent,
    },
  });
});

/** List all partner stations & outlets with current prices */
gasRoutes.get("/stations", async (c) => {
  try {
    const query = `
      SELECT 
        o.id, o.station_id, s.brand_name AS station_name, o.name, o.code,
        o.address, o.lat, o.lng, o.phone, o.active_pumps, o.status
      FROM fuel_station_outlets o
      JOIN fuel_stations s ON s.id = o.station_id
      WHERE o.status = 'active'
      ORDER BY s.brand_name, o.name
    `;
    const res = await db.execute(query);
    const outlets = res.rows as any[];

    const pricesRes = await db.execute(`
      SELECT p.outlet_id, p.product_id, prod.name as product_name, prod.category, prod.unit, p.price_per_unit
      FROM fuel_station_prices p
      JOIN fuel_products prod ON prod.id = p.product_id
      WHERE prod.active = 1
    `);
    const prices = pricesRes.rows as any[];

    const pricesByOutlet = new Map<string, any[]>();
    for (const p of prices) {
      const list = pricesByOutlet.get(p.outlet_id) ?? [];
      list.push(p);
      pricesByOutlet.set(p.outlet_id, list);
    }

    const result = outlets.map((o) => ({
      ...o,
      prices: pricesByOutlet.get(o.id) ?? FALLBACK_PRODUCTS.map((prod) => ({
        product_id: prod.id,
        product_name: prod.name,
        category: prod.category,
        unit: prod.unit,
        price_per_unit: prod.defaultPrice,
      })),
    }));

    return c.json({ outlets: result });
  } catch {
    const outletsWithPrices = FALLBACK_OUTLETS.map((outlet) => ({
      ...outlet,
      prices: FALLBACK_PRODUCTS.map((p) => ({
        product_id: p.id,
        product_name: p.name,
        category: p.category,
        unit: p.unit,
        price_per_unit: p.defaultPrice,
      })),
    }));
    return c.json({ outlets: outletsWithPrices });
  }
});

/** List fuel products */
gasRoutes.get("/products", async (c) => {
  try {
    const res = await db.execute("SELECT id, name, category, unit FROM fuel_products WHERE active = 1 ORDER BY sort_order");
    return c.json({ products: res.rows.length > 0 ? res.rows : FALLBACK_PRODUCTS });
  } catch {
    return c.json({ products: FALLBACK_PRODUCTS });
  }
});

/** Get pump prices for a specific outlet */
gasRoutes.get("/outlets/:outletId/prices", async (c) => {
  const outletId = c.req.param("outletId");
  try {
    const res = await db.execute({
      sql: `
        SELECT p.product_id, prod.name as product_name, prod.category, prod.unit, p.price_per_unit, p.updated_at
        FROM fuel_station_prices p
        JOIN fuel_products prod ON prod.id = p.product_id
        WHERE p.outlet_id = ?
      `,
      args: [outletId],
    });
    if (res.rows.length > 0) {
      return c.json({ outlet_id: outletId, prices: res.rows });
    }
  } catch {}

  const defaultPrices = FALLBACK_PRODUCTS.map((prod) => ({
    product_id: prod.id,
    product_name: prod.name,
    category: prod.category,
    unit: prod.unit,
    price_per_unit: prod.defaultPrice,
  }));
  return c.json({ outlet_id: outletId, prices: defaultPrices });
});

/** Update pump prices for the signed-in manager's own outlet. */
gasRoutes.put("/outlets/:outletId/prices", requireManager, async (c) => {
  const actor = c.get("gasActor");
  if (c.req.param("outletId") !== actor.outletId) {
    return c.json({ error: "forbidden", message: "You can only change prices at your own station." }, 403);
  }
  const parsed = z
    .object({
      prices: z
        .array(z.object({ product_id: z.string().min(1).max(60), price_per_unit: z.number().int().positive().max(1_000_000) }))
        .min(1)
        .max(20),
    })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "bad_request", message: "Invalid prices payload" }, 400);

  const known = await db.execute("SELECT id FROM fuel_products WHERE active = 1");
  const knownIds = new Set((known.rows as Row[]).map((r) => String(r.id)));
  if (parsed.data.prices.some((p) => !knownIds.has(p.product_id))) {
    return c.json({ error: "unknown_product", message: "One of those products isn't sold through Peebee Gas." }, 400);
  }

  await executeBatch(
    parsed.data.prices.map((item) => ({
      sql: `INSERT INTO fuel_station_prices (outlet_id, product_id, price_per_unit, updated_at)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(outlet_id, product_id) DO UPDATE SET price_per_unit = excluded.price_per_unit, updated_at = datetime('now')`,
      args: [actor.outletId, item.product_id, item.price_per_unit],
    })),
  );
  return c.json({ ok: true, updated: parsed.data.prices.length });
});

const ATTENDANT_SELECT = `
  SELECT a.id, a.attendant_code, a.full_name, a.phone, a.pump_lane, a.status, a.pin,
         COALESCE(a.commission_status, 'approved') AS commission_status,
         o.id AS outlet_id, o.name AS outlet_name, o.code AS outlet_code, o.address AS outlet_address,
         o.active_pumps, o.status AS outlet_status, s.id AS station_id, s.brand_name AS station_name
  FROM fuel_pump_attendants a
  JOIN fuel_station_outlets o ON o.id = a.outlet_id
  JOIN fuel_stations s ON s.id = o.station_id`;

function attendantPayload(a: Row) {
  return {
    attendant: {
      id: a.id,
      code: a.attendant_code,
      name: a.full_name,
      phone: a.phone,
      pump_lane: a.pump_lane ?? "Pump 1",
      on_duty: a.status === "on_duty",
    },
    outlet: {
      id: a.outlet_id,
      station_id: a.station_id,
      station_name: a.station_name,
      name: a.outlet_name,
      code: a.outlet_code,
      address: a.outlet_address,
      active_pumps: a.active_pumps,
      status: "active",
    },
  };
}

/** Attendant sign-in: badge code and PIN. Wrong codes and wrong PINs look identical. */
gasRoutes.post("/attendants/login", async (c) => {
  const parsed = z
    .object({ code: z.string().min(2).max(40), pin: z.string().min(4).max(8) })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "bad_request", message: "Enter your badge code and PIN." }, 400);

  const code = parsed.data.code.trim().toUpperCase();
  const guard = await pinAttemptGuard(c, "attendant", code);
  if (guard.blocked) return guard.blocked;

  const found = (await db.execute({ sql: `${ATTENDANT_SELECT} WHERE UPPER(a.attendant_code) = ? LIMIT 1`, args: [code] })).rows[0] as Row | undefined;
  const ok = found ? await pinMatches(found.pin, parsed.data.pin) : (await burnPinCheck(parsed.data.pin), false);
  if (!found || !ok) {
    await guard.fail();
    return c.json({ error: "invalid_credentials", message: "Wrong badge code or PIN." }, 401);
  }
  await guard.succeed();

  if (found.commission_status === "pending") {
    return c.json({ error: "pending_approval", message: "Your pump attendant account is pending approval by your station manager." }, 403);
  }
  if (found.commission_status !== "approved" || found.status === "suspended" || found.outlet_status !== "active") {
    return c.json({ error: "suspended", message: "Your pump attendant account is not active. Please see your station manager." }, 403);
  }

  const shift = await db.execute({
    sql: `SELECT id FROM fuel_attendant_shifts WHERE attendant_id = ? AND outlet_id = ? AND status = 'open' AND date(opened_at) = date('now') LIMIT 1`,
    args: [found.id, found.outlet_id],
  });
  if (shift.rows.length === 0) {
    await db.execute({
      sql: "INSERT INTO fuel_attendant_shifts (id, attendant_id, outlet_id, status) VALUES (?, ?, ?, 'open')",
      args: [`fshift_${crypto.randomUUID()}`, found.id, found.outlet_id],
    });
  }

  const token = await signGasToken({ kind: "attendant", id: String(found.id), outletId: String(found.outlet_id) });
  return c.json({ ok: true, token, ...attendantPayload(found) });
});

/** The signed-in attendant's profile and outlet. */
gasRoutes.get("/me", requireAttendant, async (c) => {
  const actor = c.get("gasActor");
  const row = (await db.execute({ sql: `${ATTENDANT_SELECT} WHERE a.id = ?`, args: [actor.id] })).rows[0] as Row;
  return c.json({ ok: true, ...attendantPayload(row) });
});

gasRoutes.post("/attendants/toggle-duty", requireAttendant, async (c) => {
  const actor = c.get("gasActor");
  const body = await c.req.json().catch(() => ({}));
  const onDuty = Boolean((body as Row).onDuty);
  await db.execute({
    sql: "UPDATE fuel_pump_attendants SET status = ?, updated_at = datetime('now') WHERE id = ? AND outlet_id = ?",
    args: [onDuty ? "on_duty" : "off_duty", actor.id, actor.outletId],
  });
  return c.json({ ok: true, on_duty: onDuty });
});

const changePinSchema = z.object({ currentPin: z.string().min(4).max(8), newPin: z.string().min(4).max(8) });

gasRoutes.post("/attendants/change-pin", requireAttendant, async (c) => {
  const actor = c.get("gasActor");
  const parsed = changePinSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "bad_request", message: "Enter your current PIN and a new one." }, 400);
  const formatError = validatePinFormat(parsed.data.newPin);
  if (formatError) return c.json({ error: "weak_pin", message: formatError }, 400);

  const guard = await pinAttemptGuard(c, "attendant", actor.id);
  if (guard.blocked) return guard.blocked;
  const row = (await db.execute({ sql: "SELECT pin FROM fuel_pump_attendants WHERE id = ?", args: [actor.id] })).rows[0] as Row;
  if (!(await pinMatches(row.pin, parsed.data.currentPin))) {
    await guard.fail();
    return c.json({ error: "invalid_pin", message: "Your current PIN is wrong." }, 401);
  }
  await guard.succeed();
  await db.execute({ sql: "UPDATE fuel_pump_attendants SET pin = ?, updated_at = datetime('now') WHERE id = ?", args: [await hashPin(parsed.data.newPin), actor.id] });
  return c.json({ ok: true });
});

/** Looks up a voucher the customer is showing. Only a signed-in attendant can do this, and only for their own outlet. */
gasRoutes.post("/verify-code", requireAttendant, async (c) => {
  const actor = c.get("gasActor");
  const body = (await c.req.json().catch(() => ({}))) as Row;
  if (!(await vouchersReady())) return c.json({ error: "gas_upgrade_pending", message: "Fuel vouchers are being upgraded. Try again shortly." }, 503);

  const { voucherLookupsPer5Min } = await getGasSettings();
  const lookups = await consume(`gas-lookup:${actor.id}`, voucherLookupsPer5Min, 300);
  if (!lookups.allowed) {
    return c.json({ error: "too_many_attempts", message: "Too many code lookups. Wait a moment.", retryAfterSeconds: lookups.retryAfterSeconds }, 429);
  }

  const code = normalizeVoucherCode(String(body.code ?? ""));
  if (!code) return c.json({ error: "invalid_code", message: "Voucher codes are six digits." }, 400);

  let voucher = await findVoucher(code);
  if (!voucher) return c.json({ error: "not_found", message: "Invalid or unknown fuel voucher code. Please check the code with the customer." }, 404);

  if (voucher.status === "active" && String(voucher.expires_at) <= nowIso()) {
    await closeVoucher(String(voucher.id), "expired", "Fuel voucher expired — hold released");
    voucher = (await findVoucher(code)) as Row;
  }
  if (voucher.status === "dispensed") return c.json({ error: "already_used", message: "This voucher has already been redeemed and fuel dispensed." }, 400);
  if (voucher.status === "cancelled") return c.json({ error: "cancelled", message: "This fuel voucher was cancelled by the customer." }, 400);
  if (voucher.status !== "active") return c.json({ error: "expired", message: "This fuel voucher has expired. Please ask customer to generate a fresh code." }, 400);
  if (voucher.outlet_id && voucher.outlet_id !== actor.outletId) {
    return c.json({ error: "wrong_outlet", message: "This voucher is for a different station." }, 403);
  }
  if (Number(voucher.held) !== 1) return c.json({ error: "unfunded_voucher", message: "This voucher was not paid for. Ask the customer to generate a new one." }, 409);

  const prices = (
    await db.execute({
      sql: `SELECT p.product_id, prod.name AS product_name, prod.category, prod.unit, p.price_per_unit
            FROM fuel_station_prices p JOIN fuel_products prod ON prod.id = p.product_id
            WHERE p.outlet_id = ? AND prod.active = 1`,
      args: [actor.outletId],
    })
  ).rows as Row[];

  const plate = String(voucher.vehicle_plate ?? "").toUpperCase();
  let vehicleType: "car" | "motorcycle" = plate.startsWith("UB") || plate.startsWith("UA") || plate.startsWith("PRACTICE") ? "car" : "motorcycle";
  let vehicleDesc = vehicleType === "car" ? "Peebee Fleet Car" : "Peebee Rider";
  const vehicle = (await db.execute({ sql: "SELECT make, model FROM vehicles WHERE UPPER(plate) = ? LIMIT 1", args: [plate] }).catch(() => ({ rows: [] as Row[] }))).rows[0] as Row | undefined;
  if (vehicle) {
    vehicleType = "car";
    vehicleDesc = `${vehicle.make ?? ""} ${vehicle.model ?? ""}`.trim() || "Peebee Fleet Car";
  }

  const user = (await db.execute({ sql: "SELECT name, phone FROM users WHERE id = ?", args: [voucher.rider_id] })).rows[0] as Row | undefined;
  const phone = user?.phone ? String(user.phone) : "";
  return c.json({
    valid: true,
    code: {
      id: voucher.id,
      code: voucher.code,
      rider_id: voucher.rider_id,
      rider_name: user?.name ?? (vehicleType === "car" ? "Verified Car Driver" : "Verified Motorcycle Rider"),
      rider_phone: phone ? `${"•".repeat(Math.max(0, phone.length - 4))}${phone.slice(-4)}` : "",
      rider_stage: vehicleType === "car" ? "Peebee Car Fleet" : "Kampala Central Stage",
      vehicle_plate: voucher.vehicle_plate,
      vehicle_type: vehicleType,
      vehicle_desc: vehicleDesc,
      authorized_amount_ugx: Number(voucher.authorized_amount_ugx),
      fuel_product_id: voucher.fuel_product_id,
      status: voucher.status,
      expires_at: voucher.expires_at,
    },
    outlet_prices: prices,
  });
});

/**
 * Redeems a voucher. The sequence that makes this safe to repeat or race:
 *  1. price comes from this outlet's price list, never from the request;
 *  2. the voucher is claimed with one conditional UPDATE — only one request can win;
 *  3. the sale and shift totals are written together in one batch (undone by re-opening the voucher if it fails);
 *  4. whatever was held but not pumped goes back to the rider's wallet.
 */
gasRoutes.post("/dispense", requireAttendant, async (c) => {
  const actor = c.get("gasActor");
  if (!(await vouchersReady())) return c.json({ error: "gas_upgrade_pending", message: "Fuel vouchers are being upgraded. Try again shortly." }, 503);

  const parsed = z
    .object({
      code: z.string().min(1).max(20),
      productId: z.string().min(1).max(60).default("prod_petrol"),
      pumpNumber: z.number().int().min(1).max(50).default(1),
      litres: z.number().positive().max(1000).optional(),
      totalUgx: z.number().int().positive().max(100_000_000).optional(),
    })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "bad_request", message: "Invalid dispense parameters" }, 400);
  const { productId, pumpNumber } = parsed.data;

  const code = normalizeVoucherCode(parsed.data.code);
  if (!code) return c.json({ error: "invalid_code", message: "Voucher codes are six digits." }, 400);
  const voucher = await findVoucher(code);
  if (!voucher) return c.json({ error: "not_found", message: "Fuel voucher code not found." }, 404);

  if (voucher.outlet_id && voucher.outlet_id !== actor.outletId) return c.json({ error: "wrong_outlet", message: "This voucher is for a different station." }, 403);
  if (voucher.fuel_product_id && voucher.fuel_product_id !== productId) {
    return c.json({ error: "product_mismatch", message: "This voucher was issued for a different fuel type." }, 400);
  }
  if (Number(voucher.held) !== 1) return c.json({ error: "unfunded_voucher", message: "This voucher was not paid for." }, 409);

  const outlet = (
    await db.execute({
      sql: `SELECT o.name AS outlet_name, o.active_pumps, o.status, s.brand_name AS station_name
            FROM fuel_station_outlets o JOIN fuel_stations s ON s.id = o.station_id WHERE o.id = ?`,
      args: [actor.outletId],
    })
  ).rows[0] as Row | undefined;
  if (!outlet || outlet.status !== "active") return c.json({ error: "outlet_inactive", message: "This station is not active." }, 403);
  if (pumpNumber > Number(outlet.active_pumps)) return c.json({ error: "bad_request", message: `This station has ${outlet.active_pumps} pumps.` }, 400);

  const priced = (
    await db.execute({
      sql: `SELECT p.price_per_unit, prod.name FROM fuel_station_prices p JOIN fuel_products prod ON prod.id = p.product_id
            WHERE p.outlet_id = ? AND p.product_id = ? AND prod.active = 1`,
      args: [actor.outletId, productId],
    })
  ).rows[0] as Row | undefined;
  if (!priced) return c.json({ error: "product_not_sold", message: "This station has no price set for that product." }, 400);
  const pricePerLitre = Number(priced.price_per_unit);

  let { litres, totalUgx } = parsed.data;
  if (litres == null && totalUgx == null) return c.json({ error: "bad_request", message: "Specify either litres or total UGX" }, 400);
  if (litres != null) {
    const computed = Math.round(litres * pricePerLitre);
    if (totalUgx != null && Math.abs(totalUgx - computed) > Math.max(50, computed * 0.01)) {
      return c.json({ error: "bad_request", message: "Litres and amount don't match the pump price." }, 400);
    }
    totalUgx = computed;
  } else {
    litres = Math.round((totalUgx! / pricePerLitre) * 100) / 100;
  }
  if (!totalUgx || totalUgx <= 0 || !litres || litres <= 0) return c.json({ error: "bad_request", message: "Nothing to dispense." }, 400);

  const authorized = Number(voucher.authorized_amount_ugx);
  if (totalUgx > authorized) {
    return c.json({
      error: "limit_exceeded",
      message: `Amount UGX ${totalUgx.toLocaleString()} exceeds customer authorized limit of UGX ${authorized.toLocaleString()}`,
    }, 400);
  }

  // Claim. Exactly one concurrent request can change active -> dispensed.
  const claim = await db.execute({
    sql: "UPDATE fuel_codes SET status = 'dispensed', dispensed_at = datetime('now') WHERE id = ? AND status = 'active' AND expires_at > ?",
    args: [voucher.id, nowIso()],
  });
  if ((claim.rowsAffected ?? 0) !== 1) {
    return c.json({ error: "already_used", message: "This voucher is no longer valid (used, cancelled or expired)." }, 409);
  }

  const dispenseId = `fdisp_${crypto.randomUUID()}`;
  const receiptRef = `RCP-GAS-${Date.now().toString(36).toUpperCase()}-${1000 + randomInt(9000)}`;
  try {
    await executeBatch([
      {
        sql: `INSERT INTO fuel_dispenses (id, code_id, outlet_id, attendant_id, rider_id, vehicle_plate, product_id, price_per_litre,
                litres_dispensed, total_ugx, pump_number, receipt_ref, environment, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        args: [dispenseId, voucher.id, actor.outletId, actor.id, voucher.rider_id, voucher.vehicle_plate, productId, pricePerLitre, litres, totalUgx, pumpNumber, receiptRef, voucherEnvironment(voucher)],
      },
      {
        sql: `UPDATE fuel_attendant_shifts SET total_dispenses = total_dispenses + 1, total_litres = total_litres + ?, total_amount_ugx = total_amount_ugx + ?
              WHERE attendant_id = ? AND outlet_id = ? AND status = 'open' AND date(opened_at) = date('now')`,
        args: [litres, totalUgx, actor.id, actor.outletId],
      },
    ]);
  } catch (err) {
    // The sale was not recorded, so the voucher goes back to being usable.
    await db.execute({ sql: "UPDATE fuel_codes SET status = 'active', dispensed_at = NULL WHERE id = ?", args: [voucher.id] }).catch(() => {});
    console.error("[gas] dispense failed, voucher re-opened:", err);
    return c.json({ error: "dispense_failed", message: "Couldn't record the sale. Nothing was charged — try again." }, 500);
  }

  // Held money that wasn't pumped goes back to the rider.
  const refundOk = await refundToRider(voucher, authorized - totalUgx, `Unused fuel voucher balance (${voucher.code})`);

  const rider = (await db.execute({ sql: "SELECT name FROM users WHERE id = ?", args: [voucher.rider_id] })).rows[0] as Row | undefined;
  return c.json({
    ok: true,
    ...(refundOk ? {} : { refund_pending: true }),
    receipt: {
      id: dispenseId,
      receipt_ref: receiptRef,
      code_id: voucher.id,
      outlet_id: actor.outletId,
      outlet_name: outlet.outlet_name,
      station_name: outlet.station_name,
      attendant_id: actor.id,
      attendant_name: actor.name,
      rider_id: voucher.rider_id,
      rider_name: rider?.name ?? "Peebee Customer",
      vehicle_plate: voucher.vehicle_plate,
      product_id: productId,
      product_name: priced.name,
      price_per_litre: pricePerLitre,
      litres_dispensed: litres,
      total_ugx: totalUgx,
      pump_number: pumpNumber,
      status: "completed",
      created_at: nowIso(),
    },
  });
});

/** Recent dispenses at the attendant's own outlet. */
gasRoutes.get("/dispenses", requireAttendant, async (c) => {
  const actor = c.get("gasActor");
  const res = await db.execute({
    sql: `SELECT d.*, o.name AS outlet_name, s.brand_name AS station_name, p.name AS product_name, u.name AS rider_name
          FROM fuel_dispenses d
          JOIN fuel_station_outlets o ON o.id = d.outlet_id
          JOIN fuel_stations s ON s.id = o.station_id
          JOIN fuel_products p ON p.id = d.product_id
          LEFT JOIN users u ON u.id = d.rider_id
          WHERE d.outlet_id = ? ORDER BY d.created_at DESC LIMIT 50`,
    args: [actor.outletId],
  });
  return c.json({ dispenses: res.rows });
});

/** Today's totals at the attendant's own outlet. */
gasRoutes.get("/shift/summary", requireAttendant, async (c) => {
  const actor = c.get("gasActor");
  const totals = (
    await db.execute({
      sql: `SELECT COUNT(*) AS total_dispenses, COALESCE(SUM(litres_dispensed), 0) AS total_litres, COALESCE(SUM(total_ugx), 0) AS total_ugx
            FROM fuel_dispenses WHERE outlet_id = ? AND date(created_at) = date('now')`,
      args: [actor.outletId],
    })
  ).rows[0] as Row;
  const recent = await db.execute({
    sql: `SELECT d.*, p.name AS product_name, u.name AS rider_name
          FROM fuel_dispenses d JOIN fuel_products p ON p.id = d.product_id LEFT JOIN users u ON u.id = d.rider_id
          WHERE d.outlet_id = ? AND date(d.created_at) = date('now') ORDER BY d.created_at DESC LIMIT 10`,
    args: [actor.outletId],
  });
  return c.json({
    summary: {
      outlet_id: actor.outletId,
      total_dispenses: Number(totals.total_dispenses),
      total_litres: Math.round(Number(totals.total_litres) * 100) / 100,
      total_ugx: Number(totals.total_ugx),
      recent: recent.rows,
    },
  });
});

// =========================================================================
// RIDER / DRIVER VOUCHERS — money is held from the wallet when a voucher is made
// =========================================================================

const generateSchema = z.object({
  vehiclePlate: z.string().max(16).optional(),
  amountUgx: z.number().int().min(5000).max(500000).default(20000),
  productId: z.string().min(1).max(60).default("prod_petrol"),
  outletId: z.string().max(60).optional(),
  vehicleType: z.enum(["motorcycle", "car"]).optional(),
});

function isUniqueError(err: unknown, needle: string): boolean {
  const msg = String((err as Error)?.message ?? err);
  return /unique|constraint/i.test(msg) && msg.includes(needle);
}

/** Makes a fuel voucher and holds its amount from the signed-in customer's wallet. */
gasRoutes.post("/rider/generate-code", requireAuth, async (c) => {
  const user = c.get("user");
  if (user.role === "admin") return c.json({ error: "forbidden", message: "Staff accounts can't buy fuel." }, 403);
  if (!(await vouchersReady())) return c.json({ error: "gas_upgrade_pending", message: "Fuel vouchers are being upgraded. Try again shortly." }, 503);

  const burst = await consume(`gas-generate:${user.sub}`, 10, 60);
  if (!burst.allowed) return c.json({ error: "too_many_requests", message: "Slow down a little.", retryAfterSeconds: burst.retryAfterSeconds }, 429);

  const parsed = generateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "bad_request", message: "Invalid code generation parameters" }, 400);
  const { amountUgx, productId, outletId } = parsed.data;

  let plate = parsed.data.vehiclePlate?.trim().toUpperCase() ?? "";
  if (!plate) {
    const v = await db.execute({ sql: "SELECT plate FROM vehicles WHERE user_id = ? OR driver_id = ? LIMIT 1", args: [user.sub, user.sub] }).catch(() => ({ rows: [] as Row[] }));
    plate = v.rows[0]?.plate ? String(v.rows[0].plate).toUpperCase() : "";
  }
  if (!/^[A-Z0-9][A-Z0-9 -]{2,14}$/.test(plate)) {
    return c.json({ error: "plate_required", message: "Add your vehicle's number plate to get a fuel voucher." }, 400);
  }

  const product = await db.execute({ sql: "SELECT id FROM fuel_products WHERE id = ? AND active = 1", args: [productId] });
  if (product.rows.length === 0) return c.json({ error: "unknown_product", message: "That fuel type isn't available." }, 400);
  if (outletId) {
    const priced = await db.execute({
      sql: `SELECT 1 FROM fuel_station_outlets o JOIN fuel_station_prices p ON p.outlet_id = o.id
            WHERE o.id = ? AND o.status = 'active' AND p.product_id = ?`,
      args: [outletId, productId],
    });
    if (priced.rows.length === 0) return c.json({ error: "outlet_unavailable", message: "That station doesn't sell this fuel." }, 400);
  }

  const settings = await getGasSettings();
  const environment = await getPlatformEnvironment();

  // Release anything stale or superseded first, so its hold is back in the wallet.
  await expireStaleVouchers(user.sub);
  const open = await db.execute({ sql: "SELECT id FROM fuel_codes WHERE rider_id = ? AND status = 'active'", args: [user.sub] });
  for (const r of open.rows as Row[]) await closeVoucher(String(r.id), "cancelled", "Replaced by a new fuel voucher — hold released");

  if (settings.dailyLimitUgx > 0) {
    const used = (
      await db.execute({
        sql: `SELECT
                COALESCE((SELECT SUM(total_ugx) FROM fuel_dispenses WHERE rider_id = ? AND environment = ? AND date(created_at) = date('now')), 0)
              + COALESCE((SELECT SUM(authorized_amount_ugx) FROM fuel_codes WHERE rider_id = ? AND status = 'active'), 0) AS used`,
        args: [user.sub, environment, user.sub],
      })
    ).rows[0] as Row;
    if (Number(used.used) + amountUgx > settings.dailyLimitUgx) {
      return c.json({
        error: "daily_limit_exceeded",
        message: `Daily fuel limit is UGX ${settings.dailyLimitUgx.toLocaleString()}. You have UGX ${Math.max(0, settings.dailyLimitUgx - Number(used.used)).toLocaleString()} left today.`,
      }, 400);
    }
  }

  if (!(await holdForVoucher(user.sub, amountUgx, environment))) {
    return c.json({ error: "insufficient_wallet", message: `You need UGX ${amountUgx.toLocaleString()} in your wallet for this voucher. Top up and try again.` }, 402);
  }

  const expiresAt = new Date(Date.now() + settings.voucherExpiryMinutes * 60_000).toISOString();
  const giveBack = (note: string) => refundToRider({ held: 1, rider_id: user.sub, environment }, amountUgx, note);

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const sixDigit = String(100000 + randomInt(900000));
    const id = `fcode_${crypto.randomUUID()}`;
    try {
      await db.execute({
        sql: `INSERT INTO fuel_codes (id, code, rider_id, vehicle_plate, authorized_amount_ugx, fuel_product_id, outlet_id, status, source, expires_at, held, environment, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 'rider_wallet', ?, 1, ?, datetime('now'))`,
        args: [id, `PBGAS-${sixDigit}`, user.sub, plate, amountUgx, productId, outletId ?? null, expiresAt, environment],
      });
      return c.json({
        ok: true,
        code: {
          id,
          code: `PBGAS-${sixDigit}`,
          short_code: sixDigit,
          rider_id: user.sub,
          rider_name: user.name,
          vehicle_plate: plate,
          authorized_amount_ugx: amountUgx,
          fuel_product_id: productId,
          outlet_id: outletId ?? null,
          status: "active",
          source: "rider_wallet",
          expires_at: expiresAt,
          created_at: nowIso(),
        },
      });
    } catch (err) {
      if (isUniqueError(err, "rider_id")) {
        await giveBack("Fuel voucher request repeated — hold released");
        return c.json({ error: "voucher_in_progress", message: "You already have a fuel voucher being created." }, 409);
      }
      if (isUniqueError(err, "code")) continue; // six digits collided; draw again
      await giveBack("Fuel voucher could not be created — hold released");
      console.error("[gas] voucher insert failed:", err);
      return c.json({ error: "voucher_failed", message: "Couldn't create the voucher. You were not charged." }, 500);
    }
  }
  await giveBack("Fuel voucher could not be created — hold released");
  return c.json({ error: "voucher_failed", message: "Couldn't create the voucher. You were not charged." }, 503);
});

/** The signed-in customer's current voucher, if any. */
gasRoutes.get("/rider/active-code", requireAuth, async (c) => {
  const user = c.get("user");
  if (!(await vouchersReady())) return c.json({ code: null });
  await expireStaleVouchers(user.sub);
  const row = (
    await db.execute({
      sql: `SELECT c.*, u.name AS rider_name FROM fuel_codes c LEFT JOIN users u ON u.id = c.rider_id
            WHERE c.rider_id = ? AND c.status = 'active' AND c.expires_at > ? ORDER BY c.created_at DESC LIMIT 1`,
      args: [user.sub, nowIso()],
    })
  ).rows[0] as Row | undefined;
  return c.json({ code: row ? { ...row, short_code: String(row.code).replace(/^PBGAS-/, "") } : null });
});

/** The signed-in customer's own fuel receipts. */
gasRoutes.get("/rider/dispenses", requireAuth, async (c) => {
  const user = c.get("user");
  const res = await db.execute({
    sql: `SELECT d.*, o.name AS outlet_name, s.brand_name AS station_name, p.name AS product_name
          FROM fuel_dispenses d
          JOIN fuel_station_outlets o ON o.id = d.outlet_id
          JOIN fuel_stations s ON s.id = o.station_id
          JOIN fuel_products p ON p.id = d.product_id
          WHERE d.rider_id = ? ORDER BY d.created_at DESC LIMIT 30`,
    args: [user.sub],
  });
  return c.json({ dispenses: res.rows });
});

/** Cancels the customer's unused voucher and returns the held amount to their wallet. */
gasRoutes.post("/rider/cancel-code", requireAuth, async (c) => {
  const user = c.get("user");
  if (!(await vouchersReady())) return c.json({ error: "gas_upgrade_pending", message: "Fuel vouchers are being upgraded." }, 503);
  const row = (await db.execute({ sql: "SELECT id, authorized_amount_ugx FROM fuel_codes WHERE rider_id = ? AND status = 'active' LIMIT 1", args: [user.sub] })).rows[0] as Row | undefined;
  if (!row) return c.json({ error: "not_found", message: "You have no active fuel voucher." }, 404);
  const closed = await closeVoucher(String(row.id), "cancelled", "Fuel voucher cancelled — hold released");
  if (!closed) return c.json({ error: "already_used", message: "That voucher was just used." }, 409);
  return c.json({ ok: true, refunded_ugx: Number(row.authorized_amount_ugx) });
});

// =========================================================================
// STATION MANAGER PORTAL — every route is limited to the manager's own outlet
// =========================================================================

const MANAGER_SELECT = `
  SELECT m.id, m.outlet_id, m.manager_code, m.full_name, m.phone, m.pin, m.role, m.status,
         o.name AS outlet_name, o.code AS outlet_code, o.address AS outlet_address, o.active_pumps,
         s.id AS station_id, s.brand_name AS station_name
  FROM fuel_station_managers m
  JOIN fuel_station_outlets o ON o.id = m.outlet_id
  JOIN fuel_stations s ON s.id = o.station_id`;

function managerPayload(m: Row) {
  return {
    manager: {
      id: m.id,
      outlet_id: m.outlet_id,
      manager_code: m.manager_code,
      full_name: m.full_name,
      phone: m.phone,
      role: m.role,
      status: m.status,
    },
    outlet: {
      id: m.outlet_id,
      station_id: m.station_id,
      station_name: m.station_name,
      name: m.outlet_name,
      code: m.outlet_code,
      address: m.outlet_address,
      active_pumps: m.active_pumps,
      status: "active",
    },
  };
}

gasRoutes.post("/manager/login", async (c) => {
  const parsed = z
    .object({ code: z.string().min(2).max(40), pin: z.string().min(4).max(8) })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "bad_request", message: "Enter your manager code and PIN." }, 400);

  const code = parsed.data.code.trim().toUpperCase();
  const guard = await pinAttemptGuard(c, "manager", code);
  if (guard.blocked) return guard.blocked;

  const found = (await db.execute({ sql: `${MANAGER_SELECT} WHERE UPPER(m.manager_code) = ? AND m.status = 'active' LIMIT 1`, args: [code] })).rows[0] as Row | undefined;
  const ok = found ? await pinMatches(found.pin, parsed.data.pin) : (await burnPinCheck(parsed.data.pin), false);
  if (!found || !ok) {
    await guard.fail();
    return c.json({ error: "invalid_credentials", message: "Wrong manager code or PIN." }, 401);
  }
  await guard.succeed();

  const token = await signGasToken({ kind: "manager", id: String(found.id), outletId: String(found.outlet_id) });
  return c.json({ ok: true, token, ...managerPayload(found) });
});

gasRoutes.get("/manager/me", requireManager, async (c) => {
  const actor = c.get("gasActor");
  const row = (await db.execute({ sql: `${MANAGER_SELECT} WHERE m.id = ?`, args: [actor.id] })).rows[0] as Row;
  return c.json({ ok: true, ...managerPayload(row) });
});

gasRoutes.post("/manager/change-pin", requireManager, async (c) => {
  const actor = c.get("gasActor");
  const parsed = changePinSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "bad_request", message: "Enter your current PIN and a new one." }, 400);
  const formatError = validatePinFormat(parsed.data.newPin);
  if (formatError) return c.json({ error: "weak_pin", message: formatError }, 400);

  const guard = await pinAttemptGuard(c, "manager", actor.id);
  if (guard.blocked) return guard.blocked;
  const row = (await db.execute({ sql: "SELECT pin FROM fuel_station_managers WHERE id = ?", args: [actor.id] })).rows[0] as Row;
  if (!(await pinMatches(row.pin, parsed.data.currentPin))) {
    await guard.fail();
    return c.json({ error: "invalid_pin", message: "Your current PIN is wrong." }, 401);
  }
  await guard.succeed();
  await db.execute({ sql: "UPDATE fuel_station_managers SET pin = ?, updated_at = datetime('now') WHERE id = ?", args: [await hashPin(parsed.data.newPin), actor.id] });
  return c.json({ ok: true });
});

/** Attendant rows without the PIN hash. */
const ATTENDANT_PUBLIC = `a.id, a.outlet_id, a.attendant_code, a.full_name, a.phone, a.pump_lane, a.status,
  COALESCE(a.commission_status, 'approved') AS commission_status, a.commissioned_by, a.commissioned_at, a.created_at`;

async function attendantAtOutlet(id: string, outletId: string): Promise<Row | null> {
  const res = await db.execute({
    sql: `SELECT ${ATTENDANT_PUBLIC} FROM fuel_pump_attendants a WHERE a.id = ? AND a.outlet_id = ? AND COALESCE(a.commission_status, 'approved') != 'removed'`,
    args: [id, outletId],
  });
  return (res.rows[0] as Row | undefined) ?? null;
}

gasRoutes.get("/manager/attendants", requireManager, async (c) => {
  const actor = c.get("gasActor");
  const status = c.req.query("status");
  const res = await db.execute({
    sql: `SELECT ${ATTENDANT_PUBLIC} FROM fuel_pump_attendants a
          WHERE a.outlet_id = ? AND COALESCE(a.commission_status, 'approved') != 'removed' ${status ? "AND a.status = ?" : ""}
          ORDER BY a.created_at DESC`,
    args: status ? [actor.outletId, status] : [actor.outletId],
  });
  const attendants = res.rows as Row[];
  const stats = await db.execute({
    sql: `SELECT attendant_id, COUNT(*) AS total_dispenses, COALESCE(SUM(litres_dispensed), 0) AS total_litres, COALESCE(SUM(total_ugx), 0) AS total_ugx
          FROM fuel_dispenses WHERE outlet_id = ? AND date(created_at) = date('now') GROUP BY attendant_id`,
    args: [actor.outletId],
  });
  const byId = new Map((stats.rows as Row[]).map((r) => [String(r.attendant_id), r]));
  for (const a of attendants) {
    const s = byId.get(String(a.id));
    a.total_dispenses_today = Number(s?.total_dispenses ?? 0);
    a.total_litres_today = Math.round(Number(s?.total_litres ?? 0) * 100) / 100;
    a.total_ugx_today = Number(s?.total_ugx ?? 0);
  }
  return c.json({ ok: true, attendants });
});

/** Adds an attendant to this outlet. If no PIN is given a random one is generated and shown once. */
gasRoutes.post("/manager/attendants/commission", requireManager, async (c) => {
  const actor = c.get("gasActor");
  const parsed = z
    .object({
      fullName: z.string().min(2).max(80),
      phone: z.string().min(7).max(20),
      attendantCode: z.string().min(3).max(20).optional(),
      pumpLane: z.string().max(40).optional(),
      pin: z.string().optional(),
      approveImmediately: z.boolean().optional(),
    })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "bad_request", message: "Invalid attendant commissioning details" }, 400);

  let pin = parsed.data.pin?.trim();
  let temporaryPin: string | undefined;
  if (pin) {
    const formatError = validatePinFormat(pin);
    if (formatError) return c.json({ error: "weak_pin", message: formatError }, 400);
  } else {
    pin = temporaryPin = generatePin();
  }

  const approve = parsed.data.approveImmediately ?? true;
  const id = `fatt_${crypto.randomUUID()}`;
  const attendantCode = parsed.data.attendantCode?.trim().toUpperCase() || `ATT-${1000 + randomInt(9000)}`;
  const now = nowIso();
  try {
    await db.execute({
      sql: `INSERT INTO fuel_pump_attendants (id, outlet_id, attendant_code, full_name, phone, pump_lane, status, commission_status, commissioned_by, commissioned_at, pin, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      args: [id, actor.outletId, attendantCode, parsed.data.fullName, parsed.data.phone, parsed.data.pumpLane ?? "Pump 1", approve ? "on_duty" : "off_duty", approve ? "approved" : "pending", actor.id, now, await hashPin(pin)],
    });
  } catch (err) {
    if (isUniqueError(err, "attendant_code")) return c.json({ error: "code_taken", message: "That badge code is already in use." }, 409);
    throw err;
  }
  const attendant = await attendantAtOutlet(id, actor.outletId);
  return c.json({ ok: true, attendant: { ...attendant, total_dispenses_today: 0, total_ugx_today: 0, total_litres_today: 0 }, ...(temporaryPin ? { temporary_pin: temporaryPin } : {}) });
});

/** approve / suspend / reactivate share one shape: a state change limited to this outlet. */
function attendantStateRoute(action: "approve" | "suspend" | "reactivate", commission: string, status: string) {
  gasRoutes.post(`/manager/attendants/:id/${action}`, requireManager, async (c) => {
    const actor = c.get("gasActor");
    const res = await db.execute({
      sql: `UPDATE fuel_pump_attendants SET commission_status = ?, status = ?, updated_at = datetime('now')
            WHERE id = ? AND outlet_id = ? AND COALESCE(commission_status, 'approved') != 'removed'`,
      args: [commission, status, idParam(c), actor.outletId],
    });
    if ((res.rowsAffected ?? 0) === 0) return c.json({ error: "not_found", message: "Attendant not found at your station." }, 404);
    return c.json({ ok: true, attendant: await attendantAtOutlet(idParam(c), actor.outletId) });
  });
}
attendantStateRoute("approve", "approved", "on_duty");
attendantStateRoute("suspend", "suspended", "suspended");
attendantStateRoute("reactivate", "approved", "on_duty");

gasRoutes.post("/manager/attendants/:id/reassign-pump", requireManager, async (c) => {
  const actor = c.get("gasActor");
  const body = (await c.req.json().catch(() => ({}))) as Row;
  const pumpLane = String(body.pumpLane || "Pump 1").trim().slice(0, 40);
  const res = await db.execute({
    sql: "UPDATE fuel_pump_attendants SET pump_lane = ?, updated_at = datetime('now') WHERE id = ? AND outlet_id = ?",
    args: [pumpLane, idParam(c), actor.outletId],
  });
  if ((res.rowsAffected ?? 0) === 0) return c.json({ error: "not_found", message: "Attendant not found at your station." }, 404);
  return c.json({ ok: true, attendant: await attendantAtOutlet(idParam(c), actor.outletId) });
});

/** Sets a new PIN for one of this outlet's attendants. Leave `pin` out to generate one, shown once. */
gasRoutes.post("/manager/attendants/:id/reset-pin", requireManager, async (c) => {
  const actor = c.get("gasActor");
  const body = (await c.req.json().catch(() => ({}))) as Row;
  let pin = typeof body.pin === "string" ? body.pin.trim() : "";
  let temporaryPin: string | undefined;
  if (pin) {
    const formatError = validatePinFormat(pin);
    if (formatError) return c.json({ error: "weak_pin", message: formatError }, 400);
  } else {
    pin = temporaryPin = generatePin();
  }
  const res = await db.execute({
    sql: "UPDATE fuel_pump_attendants SET pin = ?, updated_at = datetime('now') WHERE id = ? AND outlet_id = ?",
    args: [await hashPin(pin), idParam(c), actor.outletId],
  });
  if ((res.rowsAffected ?? 0) === 0) return c.json({ error: "not_found", message: "Attendant not found at your station." }, 404);
  return c.json({ ok: true, ...(temporaryPin ? { temporary_pin: temporaryPin } : {}) });
});

/** Removes an attendant. Their sales history stays; they can no longer sign in. */
gasRoutes.delete("/manager/attendants/:id", requireManager, async (c) => {
  const actor = c.get("gasActor");
  const res = await db.execute({
    sql: `UPDATE fuel_pump_attendants SET commission_status = 'removed', status = 'suspended', updated_at = datetime('now')
          WHERE id = ? AND outlet_id = ? AND COALESCE(commission_status, 'approved') != 'removed'`,
    args: [idParam(c), actor.outletId],
  });
  if ((res.rowsAffected ?? 0) === 0) return c.json({ error: "not_found", message: "Attendant not found at your station." }, 404);
  return c.json({ ok: true });
});

const WITHDRAWAL_HELD = "('pending', 'processing', 'completed')";

/** Migration 0108 tags each withdrawal live or sandbox. */
const withdrawalEnvReady = () => hasColumn("fuel_station_withdrawals", "environment");

/** What the station is owed: pumped sales minus withdrawals that are paid out or waiting to be. */
async function availableBalance(outletId: string, environment: string): Promise<{ revenue: number; withdrawn: number; available: number }> {
  const rev = (await db.execute({
    sql: "SELECT COALESCE(SUM(total_ugx), 0) AS v FROM fuel_dispenses WHERE outlet_id = ? AND environment = ? AND status = 'completed'",
    args: [outletId, environment],
  })).rows[0] as Row;
  const byEnv = await withdrawalEnvReady();
  const wd = (await db.execute({
    sql: `SELECT COALESCE(SUM(amount_ugx + fee_ugx), 0) AS v FROM fuel_station_withdrawals WHERE outlet_id = ? AND status IN ${WITHDRAWAL_HELD}${byEnv ? " AND environment = ?" : ""}`,
    args: byEnv ? [outletId, environment] : [outletId],
  })).rows[0] as Row;
  const revenue = Number(rev.v);
  const withdrawn = Number(wd.v);
  return { revenue, withdrawn, available: Math.max(0, revenue - withdrawn) };
}

gasRoutes.get("/manager/sales-summary", requireManager, async (c) => {
  const actor = c.get("gasActor");
  const period = c.req.query("period") || "today";
  const environment = await getPlatformEnvironment();
  const dateFilter =
    period === "week" ? "datetime(d.created_at) >= datetime('now', '-7 days')"
    : period === "month" ? "datetime(d.created_at) >= datetime('now', '-30 days')"
    : period === "all" ? "1=1"
    : "date(d.created_at) = date('now')";

  const outlet = (await db.execute({ sql: "SELECT name FROM fuel_station_outlets WHERE id = ?", args: [actor.outletId] })).rows[0] as Row | undefined;
  const totals = (await db.execute({
    sql: `SELECT COUNT(*) AS count, COALESCE(SUM(total_ugx), 0) AS revenue, COALESCE(SUM(litres_dispensed), 0) AS litres
          FROM fuel_dispenses d WHERE d.outlet_id = ? AND d.environment = ? AND ${dateFilter}`,
    args: [actor.outletId, environment],
  })).rows[0] as Row;
  const balance = await availableBalance(actor.outletId, environment);

  const products = (await db.execute({
    sql: `SELECT d.product_id, p.name AS product_name, COALESCE(SUM(d.litres_dispensed), 0) AS total_litres, COALESCE(SUM(d.total_ugx), 0) AS total_ugx
          FROM fuel_dispenses d JOIN fuel_products p ON p.id = d.product_id
          WHERE d.outlet_id = ? AND d.environment = ? AND ${dateFilter} GROUP BY d.product_id ORDER BY total_ugx DESC`,
    args: [actor.outletId, environment],
  })).rows as Row[];
  const attendants = (await db.execute({
    sql: `SELECT d.attendant_id, COALESCE(a.full_name, 'Pump Attendant') AS attendant_name, COALESCE(a.attendant_code, 'ATT-000') AS attendant_code,
                 COUNT(*) AS total_dispenses, COALESCE(SUM(d.litres_dispensed), 0) AS total_litres, COALESCE(SUM(d.total_ugx), 0) AS total_ugx
          FROM fuel_dispenses d LEFT JOIN fuel_pump_attendants a ON a.id = d.attendant_id
          WHERE d.outlet_id = ? AND d.environment = ? AND ${dateFilter} GROUP BY d.attendant_id ORDER BY total_ugx DESC`,
    args: [actor.outletId, environment],
  })).rows as Row[];

  return c.json({
    ok: true,
    summary: {
      outlet_id: actor.outletId,
      outlet_name: outlet?.name ?? "",
      period,
      totalRevenueUgx: Number(totals.revenue),
      totalLitres: Math.round(Number(totals.litres) * 100) / 100,
      totalTransactions: Number(totals.count),
      withdrawnTotalUgx: balance.withdrawn,
      availableBalanceUgx: balance.available,
      productBreakdown: products.map((r) => ({ product_id: r.product_id, product_name: r.product_name, total_litres: Math.round(Number(r.total_litres) * 100) / 100, total_ugx: Number(r.total_ugx) })),
      attendantBreakdown: attendants.map((r) => ({
        attendant_id: r.attendant_id ?? "unknown",
        attendant_name: r.attendant_name,
        attendant_code: r.attendant_code,
        total_dispenses: Number(r.total_dispenses),
        total_litres: Math.round(Number(r.total_litres) * 100) / 100,
        total_ugx: Number(r.total_ugx),
      })),
    },
  });
});

gasRoutes.get("/manager/transactions", requireManager, async (c) => {
  const actor = c.get("gasActor");
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 50));
  const offset = Math.max(0, Number(c.req.query("offset")) || 0);
  const res = await db.execute({
    sql: `SELECT d.*, o.name AS outlet_name, s.brand_name AS station_name, p.name AS product_name,
                 COALESCE(u.name, 'Peebee Customer') AS rider_name, COALESCE(a.full_name, 'Pump Attendant') AS attendant_name
          FROM fuel_dispenses d
          JOIN fuel_station_outlets o ON o.id = d.outlet_id
          JOIN fuel_stations s ON s.id = o.station_id
          JOIN fuel_products p ON p.id = d.product_id
          LEFT JOIN users u ON u.id = d.rider_id
          LEFT JOIN fuel_pump_attendants a ON a.id = d.attendant_id
          WHERE d.outlet_id = ? ORDER BY d.created_at DESC LIMIT ? OFFSET ?`,
    args: [actor.outletId, limit, offset],
  });
  return c.json({ ok: true, transactions: res.rows });
});

gasRoutes.get("/manager/payout-accounts", requireManager, async (c) => {
  const actor = c.get("gasActor");
  const res = await db.execute({
    sql: "SELECT * FROM fuel_station_payout_accounts WHERE outlet_id = ? ORDER BY is_primary DESC, created_at DESC",
    args: [actor.outletId],
  });
  return c.json({ ok: true, accounts: (res.rows as Row[]).map((r) => ({ ...r, is_primary: Boolean(r.is_primary) })) });
});

gasRoutes.post("/manager/payout-accounts", requireManager, async (c) => {
  const actor = c.get("gasActor");
  const parsed = z
    .object({
      type: z.enum(["momo", "bank"]),
      accountRef: z.string().min(5).max(40),
      accountName: z.string().min(2).max(80),
      networkOrBank: z.string().min(2).max(60),
      isPrimary: z.boolean().optional(),
    })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "bad_request", message: "Invalid payout account details" }, 400);

  const { type, accountRef, accountName, networkOrBank } = parsed.data;
  const isPrimary = parsed.data.isPrimary ? 1 : 0;
  const id = `fpay_${crypto.randomUUID()}`;
  await executeBatch([
    ...(isPrimary ? [{ sql: "UPDATE fuel_station_payout_accounts SET is_primary = 0 WHERE outlet_id = ?", args: [actor.outletId] }] : []),
    {
      sql: `INSERT INTO fuel_station_payout_accounts (id, outlet_id, type, account_ref, account_name, network_or_bank, is_primary, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      args: [id, actor.outletId, type, accountRef, accountName, networkOrBank, isPrimary],
    },
  ]);
  return c.json({
    ok: true,
    account: { id, outlet_id: actor.outletId, type, account_ref: accountRef, account_name: accountName, network_or_bank: networkOrBank, is_primary: isPrimary === 1, created_at: nowIso() },
  });
});

gasRoutes.get("/manager/withdrawals", requireManager, async (c) => {
  const actor = c.get("gasActor");
  const byEnv = await withdrawalEnvReady();
  const res = await db.execute({
    sql: `SELECT * FROM fuel_station_withdrawals WHERE outlet_id = ?${byEnv ? " AND environment = ?" : ""} ORDER BY created_at DESC LIMIT 50`,
    args: byEnv ? [actor.outletId, await getPlatformEnvironment()] : [actor.outletId],
  });
  const withdrawals = (res.rows as Row[]).map((r) => {
    let details: unknown = r.destination_details;
    if (typeof details === "string") {
      try { details = JSON.parse(details); } catch { /* keep as text */ }
    }
    return { ...r, destination_details: details };
  });
  return c.json({ ok: true, withdrawals });
});

const digitsOnly = (v: unknown) => String(v ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();

/**
 * Asks Peebee to pay the station. The request is recorded as `pending` for an
 * admin to pay out; it can only go to a payout account already registered on
 * this outlet, and the balance check and the insert are one statement, so two
 * requests at once can't spend the same money twice.
 */
gasRoutes.post("/manager/withdrawals", requireManager, async (c) => {
  const actor = c.get("gasActor");
  const { withdrawalMinUgx } = await getGasSettings();
  const parsed = z
    .object({
      amountUgx: z.number().int().positive().max(1_000_000_000),
      destinationType: z.enum(["momo", "bank"]),
      destinationDetails: z.record(z.string(), z.unknown()),
    })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "bad_request", message: "Invalid withdrawal parameters." }, 400);
  const { amountUgx, destinationType, destinationDetails } = parsed.data;
  if (amountUgx < withdrawalMinUgx) {
    return c.json({ error: "below_minimum", message: `Minimum withdrawal is UGX ${withdrawalMinUgx.toLocaleString()}.` }, 400);
  }

  const wanted = digitsOnly(destinationDetails.phone ?? destinationDetails.accountNumber ?? destinationDetails.accountRef);
  const accounts = (await db.execute({ sql: "SELECT account_ref FROM fuel_station_payout_accounts WHERE outlet_id = ? AND type = ?", args: [actor.outletId, destinationType] })).rows as Row[];
  if (!wanted || !accounts.some((a) => digitsOnly(a.account_ref) === wanted)) {
    return c.json({ error: "unregistered_destination", message: "Withdrawals can only go to a payout account saved for this station." }, 400);
  }

  const environment = await getPlatformEnvironment();
  const byEnv = await withdrawalEnvReady();
  // Sandbox sales are test money: never queue them for a real payout.
  if (environment === "sandbox" && !byEnv) {
    return c.json({ error: "withdrawals_unavailable", message: "Sandbox withdrawals need database migration 0108." }, 503);
  }
  const sandbox = environment === "sandbox";
  const id = `fwd_${crypto.randomUUID()}`;
  const reference = `WD-GAS-${Date.now().toString(36).toUpperCase()}-${1000 + randomInt(9000)}`;
  const status = sandbox ? "completed" : "pending";
  const insert = await db.execute({
    sql: `INSERT INTO fuel_station_withdrawals (id, outlet_id, manager_id, amount_ugx, fee_ugx, destination_type, destination_details, status, reference, created_at${byEnv ? ", environment" : ""}${sandbox ? ", processed_at, provider_ref" : ""})
          SELECT ?, ?, ?, ?, 0, ?, ?, ?, ?, datetime('now')${byEnv ? ", ?" : ""}${sandbox ? ", datetime('now'), 'sandbox-simulated'" : ""}
          WHERE (SELECT COALESCE(SUM(total_ugx), 0) FROM fuel_dispenses WHERE outlet_id = ? AND environment = ? AND status = 'completed')
              - (SELECT COALESCE(SUM(amount_ugx + fee_ugx), 0) FROM fuel_station_withdrawals WHERE outlet_id = ? AND status IN ${WITHDRAWAL_HELD}${byEnv ? " AND environment = ?" : ""}) >= ?`,
    args: [
      id, actor.outletId, actor.id, amountUgx, destinationType, JSON.stringify(destinationDetails), status, reference,
      ...(byEnv ? [environment] : []),
      actor.outletId, environment, actor.outletId, ...(byEnv ? [environment] : []), amountUgx,
    ],
  });
  if ((insert.rowsAffected ?? 0) !== 1) {
    const { available } = await availableBalance(actor.outletId, environment);
    return c.json({ error: "insufficient_balance", message: `Requested withdrawal UGX ${amountUgx.toLocaleString()} exceeds available balance of UGX ${available.toLocaleString()}` }, 409);
  }
  return c.json({
    ok: true,
    withdrawal: {
      id, outlet_id: actor.outletId, manager_id: actor.id, amount_ugx: amountUgx, fee_ugx: 0, destination_type: destinationType, destination_details: destinationDetails,
      status, reference, created_at: nowIso(), environment,
      ...(sandbox ? { note: "Sandbox: simulated payout, no real money moves." } : {}),
    },
  });
});

// =========================================================================
// ADMIN — payouts and PIN resets (Peebee staff only)
// =========================================================================

gasRoutes.use("/admin/*", requireAuth, requireRole("admin"));

gasRoutes.get("/admin/withdrawals", requirePermission("merchant_finance.manage"), async (c) => {
  const status = c.req.query("status") ?? "pending";
  // Only live withdrawals are real money to pay out; sandbox ones are listed only when asked for.
  const environment = c.req.query("environment") === "sandbox" ? "sandbox" : "live";
  const byEnv = await withdrawalEnvReady();
  const res = await db.execute({
    sql: `SELECT w.*, o.name AS outlet_name FROM fuel_station_withdrawals w JOIN fuel_station_outlets o ON o.id = w.outlet_id
          WHERE w.status = ?${byEnv ? " AND w.environment = ?" : ""} ORDER BY w.created_at ASC LIMIT 100`,
    args: byEnv ? [status, environment] : [status],
  });
  return c.json({ ok: true, withdrawals: res.rows });
});

/** pending/processing -> completed or failed, once. A failed request frees the money back to the station's balance. */
async function settleWithdrawal(c: any, to: "completed" | "failed") {
  const user = c.get("user");
  const id = idParam(c);
  const body = (await c.req.json().catch(() => ({}))) as Row;
  const hasAudit = await hasColumn("fuel_station_withdrawals", "processed_by");
  const note = String(body.providerRef ?? body.reason ?? "").slice(0, 120);
  const sql = hasAudit
    ? `UPDATE fuel_station_withdrawals SET status = ?, processed_by = ?, processed_at = datetime('now'),
         provider_ref = CASE WHEN ? = 'completed' THEN ? ELSE provider_ref END,
         failure_reason = CASE WHEN ? = 'failed' THEN ? ELSE failure_reason END
       WHERE id = ? AND status IN ('pending', 'processing')`
    : "UPDATE fuel_station_withdrawals SET status = ? WHERE id = ? AND status IN ('pending', 'processing')";
  const args = hasAudit ? [to, user.sub, to, note, to, note, id] : [to, id];
  const res = await db.execute({ sql, args });
  if ((res.rowsAffected ?? 0) !== 1) return c.json({ error: "not_pending", message: "That withdrawal isn't waiting to be processed." }, 409);
  await logActivity({
    actor: user,
    action: `gas.withdrawal.${to}`,
    summary: `Marked fuel station withdrawal ${id} as ${to}`,
    entityType: "fuel_station_withdrawal",
    entityId: id,
    after: { status: to, note },
    ip: c.req.header("cf-connecting-ip") ?? null,
  });
  return c.json({ ok: true });
}
gasRoutes.post("/admin/withdrawals/:id/complete", requirePermission("merchant_finance.manage"), (c) => settleWithdrawal(c, "completed"));
gasRoutes.post("/admin/withdrawals/:id/fail", requirePermission("merchant_finance.manage"), (c) => settleWithdrawal(c, "failed"));

/** Sets a station manager's PIN (they can't sign in until one is set). Leave `pin` out to generate one, shown once. */
gasRoutes.post("/admin/managers/:id/pin", requirePermission("merchants.manage"), async (c) => {
  const user = c.get("user");
  const body = (await c.req.json().catch(() => ({}))) as Row;
  let pin = typeof body.pin === "string" ? body.pin.trim() : "";
  let temporaryPin: string | undefined;
  if (pin) {
    const formatError = validatePinFormat(pin);
    if (formatError) return c.json({ error: "weak_pin", message: formatError }, 400);
  } else {
    pin = temporaryPin = generatePin();
  }
  const res = await db.execute({ sql: "UPDATE fuel_station_managers SET pin = ?, updated_at = datetime('now') WHERE id = ?", args: [await hashPin(pin), idParam(c)] });
  if ((res.rowsAffected ?? 0) === 0) return c.json({ error: "not_found", message: "Manager not found." }, 404);
  await logActivity({
    actor: user,
    action: "gas.manager.pin_set",
    summary: `Set a new PIN for fuel station manager ${idParam(c)}`,
    entityType: "fuel_station_manager",
    entityId: idParam(c),
    ip: c.req.header("cf-connecting-ip") ?? null,
  });
  return c.json({ ok: true, ...(temporaryPin ? { temporary_pin: temporaryPin } : {}) });
});
