import { DEMO_FOOD_RESTAURANTS, demoFoodMenu } from "@peebee/shared/demo-food";
import { PRACTICE_ENTEBBE, PRACTICE_ENTEBBE_PRODUCTS, PRACTICE_ENTEBBE_STORES, PRACTICE_FOOD_RESTAURANTS, PRACTICE_RIDERS } from "@peebee/shared/practice-entebbe";
import { db, executeBatch, type DbStatement } from "../db/client.js";
import { hasTable } from "../lib/schema.js";
import { runSeed } from "./batch.js";
import { merchantBusinessStatements } from "../merchants/service.js";
import { PRACTICE_CUSTOMERS } from "./personas.js";
import { seedBuyExtras } from "./seed-buy.js";
import { seedElite } from "./seed-elite.js";
import { seedHive } from "./seed-hive.js";
import { seedLearn } from "./seed-learn.js";
import { seedMoney } from "./seed-money.js";
import { seedPartners } from "./seed-partners.js";
import { seedRide } from "./seed-ride.js";
import { seedWorkers } from "./seed-workers.js";

/** Practice accounts cannot be signed into with a password: a session token is the only way in. */
const NO_PASSWORD = "practice-account-no-password";

export type PracticeCounts = { customers: number; riders: number; merchants: number; stores: number; products: number; restaurants: number; menuItems: number; orders: number };

async function count(table: string, where = "1=1"): Promise<number> {
  const res = await db.execute(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`);
  return Number(res.rows[0]?.n ?? 0);
}

const PRAC = "'prac\\_%' ESCAPE '\\'";

/** What the practice world holds right now (only the demo people and the things they own). */
export async function practiceCounts(): Promise<PracticeCounts> {
  const [customers, riders, merchants, stores, products, restaurants, menuItems, orders] = await Promise.all([
    count("users", `id LIKE 'prac\\_cust\\_%' ESCAPE '\\'`), count("riders", `user_id LIKE ${PRAC}`), count("merchants", `id LIKE ${PRAC}`),
    count("stores", `merchant_id LIKE ${PRAC}`), count("store_products", `store_id IN (SELECT id FROM stores WHERE merchant_id LIKE ${PRAC})`),
    count("restaurants", `id LIKE ${PRAC}`), count("menu_items", `restaurant_id LIKE ${PRAC}`), count("orders", `customer_id LIKE ${PRAC}`),
  ]);
  return { customers, riders, merchants, stores, products, restaurants, menuItems, orders };
}

export async function isPracticeSeeded(): Promise<boolean> {
  return (await count("users", "id = 'prac_cust_amina'")) > 0;
}

const user = (id: string, name: string, phone: string, role: "customer" | "rider", walletUgx: number): DbStatement => ({
  sql: `INSERT OR IGNORE INTO users (id, phone, name, password_hash, role, status, phone_verified_at, wallet_balance, wallet_balance_sandbox)
        VALUES (?, ?, ?, ?, ?, 'active', datetime('now'), 0, ?)`,
  args: [id, phone, name, NO_PASSWORD, role, walletUgx],
});

/**
 * Lays the practice world down in the practice database: customers, riders, merchants with stores and products, and
 * restaurants with menus. Safe to run again: anything already there is left alone. Must be called inside runInPractice.
 */
export async function seedPracticeWorld(): Promise<PracticeCounts> {
  const statements: DbStatement[] = [];
  const knownMerchants = new Set((await db.execute(`SELECT id FROM merchants WHERE id LIKE ${PRAC}`)).rows.map((r) => String(r.id)));
  /** A business is made once (its KYC case gets a fresh id each time); its balance row is always put back. */
  const businessOnce = (merchantId: string, make: () => DbStatement[]) => {
    if (!knownMerchants.has(merchantId)) for (const st of make()) statements.push({ ...st, sql: st.sql.replace(/^INSERT INTO/, "INSERT OR IGNORE INTO") });
    statements.push({ sql: "INSERT OR IGNORE INTO merchant_balances (merchant_id, environment) VALUES (?, 'sandbox')", args: [merchantId] });
  };

  const personalWalletsReady = await hasTable("personal_wallets");
  for (const c of PRACTICE_CUSTOMERS) {
    statements.push(user(c.id, c.name, c.phone, "customer", c.walletUgx));
    if (personalWalletsReady) {
      statements.push({ sql: "INSERT OR IGNORE INTO personal_wallets (user_id) VALUES (?)", args: [c.id] });
    }
  }

  PRACTICE_RIDERS.forEach((r, i) => {
    const id = `prac_rider_${i + 1}`;
    statements.push(user(id, r.name, r.phone.replace(/\s/g, ""), "rider", 60_000 + i * 15_000));
    const [first, ...rest] = r.name.split(" ");
    statements.push({
      sql: `INSERT OR IGNORE INTO riders (user_id, verified, is_online, area, vehicle_info, rating, momo_msisdn, first_name, last_name, stage_name, stage_address,
                                           stage_lat, stage_lng, profile_completed_at, wallet_balance_sandbox, rider_code)
            VALUES (?, 1, 1, 'Entebbe', ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)`,
      args: [id, `Boda boda · ${r.plate}`, 4.6 + (i % 4) / 10, `00000002${String(i + 1).padStart(2, "0")}`, first ?? r.name, rest.join(" "), r.stage, `${r.stage}, Entebbe`,
        PRACTICE_ENTEBBE.lat + (i - 3) * 0.004, PRACTICE_ENTEBBE.lng + ((i * 7) % 5 - 2) * 0.004, 60_000 + i * 15_000, `RDR-${String(1000 + i)}`],
    });
  });

  // Practice businesses use a category that already exists, so nothing new appears in the lists real merchants choose from.
  // If there is none yet, an inactive one is made: it is never offered to anyone.
  const existing = await db.execute("SELECT id FROM merchant_categories ORDER BY active DESC, sort_order, id LIMIT 1");
  const categoryId = String(existing.rows[0]?.id ?? "prac_cat_general");
  if (!existing.rows[0]) statements.push({ sql: "INSERT OR IGNORE INTO merchant_categories (id, slug, name, active) VALUES ('prac_cat_general', 'practice-general', 'Practice', 0)", args: [] });

  PRACTICE_ENTEBBE_STORES.forEach((s, i) => {
    const ownerId = `prac_mu_${s.id}`;
    statements.push(user(ownerId, `${s.name} owner`, `00000011${String(10 + i).padStart(2, "0")}`, "customer", 0));
    businessOnce(`prac_m_${s.id}`, () => merchantBusinessStatements({
      ownerId, legalName: `${s.name} Ltd`, displayName: s.name, businessKind: "business", categoryId, outletName: s.name,
      phone: s.phone, address: s.address, lat: s.lat, lng: s.lng, environment: "sandbox", merchantId: `prac_m_${s.id}`, outletId: `prac_out_${i + 1}`,
    }).statements);
    statements.push({ sql: "UPDATE merchants SET status='active', trust_tier='standard', approved_at=datetime('now'), merchant_code=? WHERE id=?", args: [`MER-PRAC${i + 1}`, `prac_m_${s.id}`] });
    statements.push({
      sql: `INSERT OR IGNORE INTO stores (id, merchant_id, outlet_id, name, slug, category, sub_category, description, announcement, logo_url, banner_url, phone, whatsapp_number,
                                          address, lat, lng, is_open, delivery_enabled, pickup_enabled, min_order_amount, pro_tier, is_live, live_channel_title, live_stream_url,
                                          live_viewer_count, status, environment)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?, 'active', 'sandbox')`,
      args: [s.id, `prac_m_${s.id}`, `prac_out_${i + 1}`, s.name, s.slug, s.category === "pharmacy" ? "stores" : s.category, s.category === "pharmacy" ? "pharmacy" : (s.sub_category ?? null), s.description, s.announcement ?? null, s.logo_url, s.banner_url, s.phone,
        s.whatsapp_number, s.address, s.lat ?? PRACTICE_ENTEBBE.lat, s.lng ?? PRACTICE_ENTEBBE.lng, s.is_open, s.min_order_amount, s.pro_tier, s.is_live, s.live_channel_title,
        s.live_stream_url, s.live_viewer_count],
    });
    (PRACTICE_ENTEBBE_PRODUCTS[s.id] ?? []).forEach((p, n) => statements.push({
      sql: `INSERT OR IGNORE INTO store_products (id, store_id, title, slug, description, price, compare_at_price, inventory_quantity, category_name, badge, image_url, status, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      args: [p.id, s.id, p.title, p.slug, p.description, p.price, p.compare_at_price ?? null, p.inventory_quantity, p.category_name, p.badge ?? null, p.image_url, n],
    }));
  });

  PRACTICE_FOOD_RESTAURANTS.forEach((r, i) => {
    const slug = r.id.replace("demo-food-", "");
    const id = `prac_rest_${slug}`;
    const ownerId = `prac_ro_${slug}`;
    statements.push(user(ownerId, `${r.name} owner`, `00000012${String(10 + i).padStart(2, "0")}`, "customer", 0));
    businessOnce(`prac_m_${slug}`, () => merchantBusinessStatements({
      ownerId, legalName: `${r.name} Ltd`, displayName: r.name, businessKind: "business", categoryId, outletName: r.name,
      phone: r.phone ?? undefined, address: r.address ?? undefined, lat: r.lat ?? undefined, lng: r.lng ?? undefined, environment: "sandbox",
      merchantId: `prac_m_${slug}`, outletId: `prac_outr_${i + 1}`,
    }).statements);
    statements.push({ sql: "UPDATE merchants SET status='active', trust_tier='standard', approved_at=datetime('now'), merchant_code=? WHERE id=?", args: [`MER-PRFD${i + 1}`, `prac_m_${slug}`] });
    statements.push({
      sql: `INSERT OR IGNORE INTO restaurants (id, owner_id, name, description, cuisine, phone, address, lat, lng, status, is_open, environment, merchant_id, outlet_id, business_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 'sandbox', ?, ?, ?)`,
      args: [id, ownerId, r.name, r.description, r.cuisine, r.phone, r.address, r.lat, r.lng, r.is_open, `prac_m_${slug}`, `prac_outr_${i + 1}`, r.business_type ?? "restaurant"],
    });
    const menu = demoFoodMenu(r.id);
    const rename = (value: string) => value.replace(/^demo-food-/, "prac_rest_");
    for (const category of menu?.categories ?? []) {
      statements.push({ sql: "INSERT OR IGNORE INTO menu_categories (id, restaurant_id, name, sort_order) VALUES (?, ?, ?, ?)", args: [rename(category.id), id, category.name, category.sort_order] });
      for (const item of category.items) {
        statements.push({
          sql: `INSERT OR IGNORE INTO menu_items (id, restaurant_id, category_id, name, description, price, photo_key, available, prep_time_minutes, sort_order, badge, is_featured)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
          args: [rename(item.id), id, rename(category.id), item.name, item.description, item.price, item.photo_key, item.prep_time_minutes, item.sort_order, item.badge ?? null, item.is_featured ?? 0],
        });
        for (const option of item.options ?? []) {
          statements.push({ sql: "INSERT OR IGNORE INTO menu_item_options (id, menu_item_id, name, required, multi_select, sort_order) VALUES (?, ?, ?, ?, ?, ?)", args: [rename(option.id), rename(item.id), option.name, option.required, option.multi_select, option.sort_order] });
          for (const choice of option.choices) {
            statements.push({ sql: "INSERT OR IGNORE INTO menu_item_option_choices (id, option_id, name, price_delta, sort_order) VALUES (?, ?, ?, ?, ?)", args: [rename(choice.id), rename(option.id), choice.name, choice.price_delta, choice.sort_order] });
          }
        }
      }
    }
  });

  // D1 caps a batch; send it in slices so a seed of a few thousand statements never trips it.
  await runSeed(statements);
  await seedRide();
  await seedBuyExtras();
  await seedLearn();
  await seedHive();
  await seedMoney();
  await seedElite();
  await seedPartners();
  await seedWorkers();
  return practiceCounts();
}

const COUNTERS = `rider_cash_dues rider_wallet_topups wallet_withdrawals`.split(" ");

/**
 * Puts the demo world back to its starting state: demo orders, chats, payments and the money they moved are cleared, and
 * every demo person's balance is what it was. Stores, menus and the people themselves stay. Only rows that belong to demo
 * people are touched, so real data is safe. Run inside runInPractice.
 */
export async function resetPracticeWorld(): Promise<void> {
  const withColumn = async (column: string, except: string[] = []): Promise<string[]> => {
    const res = await db.execute({ sql: "SELECT m.name AS name FROM sqlite_master m, pragma_table_info(m.name) p WHERE m.type = 'table' AND p.name = ?", args: [column] });
    return res.rows.map((r) => String(r.name)).filter((n) => !except.includes(n));
  };
  const demoOrders = `SELECT id FROM orders WHERE customer_id LIKE ${PRAC}`;
  const demoLists = `SELECT id FROM lists WHERE customer_id LIKE ${PRAC}`;
  const statements: DbStatement[] = [{ sql: "PRAGMA defer_foreign_keys = ON", args: [] }];
  for (const table of await withColumn("order_id")) statements.push({ sql: `DELETE FROM "${table}" WHERE order_id IN (${demoOrders})`, args: [] });
  for (const table of await withColumn("list_id", ["orders"])) statements.push({ sql: `DELETE FROM "${table}" WHERE list_id IN (${demoLists})`, args: [] });
  statements.push({ sql: `DELETE FROM orders WHERE customer_id LIKE ${PRAC}`, args: [] }, { sql: `DELETE FROM lists WHERE customer_id LIKE ${PRAC}`, args: [] });
  for (const table of ["wallet_ledger", "wallet_topups", "push_subscriptions", "saved_locations", "saved_passengers", "chat_reads"]) statements.push({ sql: `DELETE FROM "${table}" WHERE user_id LIKE ${PRAC}`, args: [] });
  for (const table of COUNTERS) statements.push({ sql: `DELETE FROM "${table}" WHERE rider_id LIKE ${PRAC}`, args: [] });
  // Merchant money lives beside the business rows; the seed puts the empty ones back.
  for (const table of ["merchant_payments", "merchant_settlements", "merchant_settlement_quotes", "merchant_balances"]) statements.push({ sql: `DELETE FROM "${table}" WHERE merchant_id LIKE ${PRAC}`, args: [] });
  // Work booked and Hire jobs posted while practising go too (the seeded ones have `prac_` ids and stay).
  const bookedWork = `SELECT id FROM work_jobs WHERE customer_id LIKE ${PRAC} AND id NOT LIKE ${PRAC}`;
  for (const table of (await withColumn("job_id")).filter((t) => t.startsWith("work_") && t !== "work_jobs")) statements.push({ sql: `DELETE FROM "${table}" WHERE job_id IN (${bookedWork})`, args: [] });
  statements.push({ sql: `DELETE FROM work_jobs WHERE customer_id LIKE ${PRAC} AND id NOT LIKE ${PRAC}`, args: [] });
  const postedJobs = `SELECT id FROM talent_jobs WHERE employer_id LIKE ${PRAC} AND id NOT LIKE ${PRAC}`;
  const postedContracts = `SELECT id FROM talent_contracts WHERE job_id IN (${postedJobs})`;
  const postedApplications = `SELECT id FROM talent_applications WHERE job_id IN (${postedJobs})`;
  const talentTables = (await withColumn("job_id")).filter((t) => t.startsWith("talent_"));
  for (const table of talentTables.filter((t) => !["talent_jobs", "talent_contracts", "talent_applications"].includes(t))) statements.push({ sql: `DELETE FROM "${table}" WHERE job_id IN (${postedJobs})`, args: [] });
  for (const table of (await withColumn("contract_id")).filter((t) => t.startsWith("talent_") && t !== "talent_contracts")) statements.push({ sql: `DELETE FROM "${table}" WHERE contract_id IN (${postedContracts})`, args: [] });
  for (const table of (await withColumn("application_id")).filter((t) => t.startsWith("talent_") && t !== "talent_applications")) statements.push({ sql: `DELETE FROM "${table}" WHERE application_id IN (${postedApplications})`, args: [] });
  statements.push(
    { sql: `DELETE FROM talent_contracts WHERE job_id IN (${postedJobs})`, args: [] },
    { sql: `DELETE FROM talent_applications WHERE job_id IN (${postedJobs})`, args: [] },
    { sql: `DELETE FROM talent_jobs WHERE employer_id LIKE ${PRAC} AND id NOT LIKE ${PRAC}`, args: [] },
    { sql: "UPDATE users SET wallet_balance_sandbox = 0 WHERE id LIKE 'prac\\_wk\\_%' ESCAPE '\\'", args: [] },
  );
  PRACTICE_CUSTOMERS.forEach((c) => statements.push({ sql: "UPDATE users SET wallet_balance_sandbox = ? WHERE id = ?", args: [c.walletUgx, c.id] }));
  PRACTICE_RIDERS.forEach((_r, i) => {
    statements.push({ sql: "UPDATE users SET wallet_balance_sandbox = ? WHERE id = ?", args: [60_000 + i * 15_000, `prac_rider_${i + 1}`] });
    statements.push({ sql: "UPDATE riders SET wallet_balance_sandbox = ?, cash_owed_sandbox = 0, is_online = 1 WHERE user_id = ?", args: [60_000 + i * 15_000, `prac_rider_${i + 1}`] });
  });
  await executeBatch(statements);
}
