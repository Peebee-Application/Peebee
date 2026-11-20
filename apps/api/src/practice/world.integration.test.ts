import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import app from "../app.js";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { runInPractice } from "../db/practice-context.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { resetSchemaCache } from "../lib/schema.js";
import { invalidateSettingsCache } from "../lib/settings.js";
import { actAs, parcel, runDemoCustomerAutopilot, topUpDemoOrders } from "./demo-customers.js";
import { PRACTICE_CUSTOMERS } from "./personas.js";
import { ridersForThisWorld } from "./people.js";
import { practiceCounts, resetPracticeWorld, seedPracticeWorld } from "./seed.js";

function shim(client: Client): D1Database {
  const prepare = (sql: string) => ({
    sql, args: [] as unknown[],
    bind(...args: unknown[]) { this.args = args; return this; },
    async all() {
      const result = await client.execute({ sql: this.sql, args: this.args as InArgs });
      return { results: result.rows, success: true, meta: { changes: result.rowsAffected, last_row_id: Number(result.lastInsertRowid ?? 0) } };
    },
  });
  return {
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      const results = await client.batch(statements.map(({ sql, args }) => ({ sql, args: args as InArgs })), "write");
      return results.map((result) => ({ results: result.rows, success: true, meta: { changes: result.rowsAffected, last_row_id: Number(result.lastInsertRowid ?? 0) } }));
    },
  } as unknown as D1Database;
}

async function freshDatabase(): Promise<Client> {
  const client = createClient({ url: "file::memory:" });
  const migrations = existsSync(join(process.cwd(), "src/db/migrations")) ? join(process.cwd(), "src/db/migrations") : join(process.cwd(), "apps/api/src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  return client;
}

test("practice and sandbox share one database; real people and demo people never meet", async (t) => {
  process.env.JWT_SECRET = "local-practice-world-test-secret-only";
  resetSchemaCache();
  const db = await freshDatabase();
  setD1Binding(shim(db));
  await db.execute({ sql: "INSERT INTO users (id, phone, name, password_hash, role) VALUES ('real_rider', '0771', 'Real Rider', 'h', 'rider'), ('real_cust', '0772', 'Real Customer', 'h', 'customer'), ('real_admin', '0773', 'Real Admin', 'h', 'admin')", args: [] });
  await db.execute({ sql: "UPDATE users SET admin_role = 'super_admin' WHERE id = 'real_admin'", args: [] });
  await db.execute({ sql: "INSERT INTO riders (user_id, verified, is_online, stage_lat, stage_lng) VALUES ('real_rider', 1, 1, 0.0612, 32.4637)", args: [] });
  await db.execute({ sql: "INSERT INTO settings (key, value) VALUES ('user_practice_mode_enabled', '1') ON CONFLICT(key) DO UPDATE SET value='1'", args: [] });
  await db.execute({ sql: "INSERT INTO settings (key, value) VALUES ('practice_shared_world', '1') ON CONFLICT(key) DO UPDATE SET value='1'", args: [] });
  invalidateSettingsCache();
  const rider = await signToken({ sub: "real_rider", role: "rider" });
  const customer = await signToken({ sub: "real_cust", role: "customer" });
  const admin = await signToken({ sub: "real_admin", role: "admin" });
  const call = (token: string, path: string, init: RequestInit = {}) => app.request(`/v1${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const json = async <T = Record<string, any>>(res: Response) => (await res.json()) as T;
  const start = async (token: string, role: string) => json<{ token: string; user: { id: string } }>(await call(token, "/practice/session", { method: "POST", body: JSON.stringify({ role }) }));

  await t.test("the first session lays the world down in the same database, signed in as a persona", async () => {
    const session = await start(rider, "rider");
    assert.equal(session.user.id, "prac_rider_1");
    const counts = await runInPractice(practiceCounts);
    assert.deepEqual([counts.customers, counts.riders, counts.stores, counts.restaurants], [6, 6, 10, 12]);
    assert.ok(counts.products > 30 && counts.menuItems > 50);
    assert.equal(Number((await db.execute("SELECT COUNT(*) n FROM users WHERE id = 'real_rider'")).rows[0]!.n), 1, "real people are untouched");
  });

  await t.test("demo businesses are sandbox rows: a real customer's lists stay free of them", async () => {
    assert.equal((await json<{ restaurants: unknown[] }>(await call(customer, "/restaurants"))).restaurants.length, 0);
    const liveStores = (await json<{ stores: { id: string }[] }>(await call(customer, "/marketplace/stores"))).stores;
    assert.ok(liveStores.every((s) => !s.id.startsWith("pe_")), "an empty live marketplace shows its own samples, never the practice shops");
    const demo = await start(customer, "customer");
    const restaurants = (await json<{ restaurants: { id: string }[] }>(await call(demo.token, "/restaurants"))).restaurants;
    assert.equal(restaurants.length, 12);
    assert.ok(restaurants.every((r) => r.id.startsWith("prac_rest_")));
    const stores = (await json<{ stores: { id: string; pro_tier: string }[] }>(await call(demo.token, "/marketplace/stores"))).stores;
    assert.ok(stores.some(s => s.id === "pe_lakeside_mart"), "eligible practice stores are listed");
    assert.ok(stores.every(s => s.pro_tier !== "free"), "payments-only practice merchants have no online catalog");
  });

  await t.test("merchant and restaurant personas own the same businesses the customer shops at", async () => {
    const merchant = await start(customer, "merchant");
    assert.ok(JSON.stringify(await json(await call(merchant.token, "/merchants/me"))).includes("prac_m_pe_lakeside_mart"));
    const restaurant = await start(customer, "restaurant");
    assert.equal(restaurant.user.id, "prac_ro_lakeview");
  });

  await t.test("demo customers order, and only the demo riders see it", async () => {
    await runInPractice(() => topUpDemoOrders(4));
    const waiting = async (clause: string) => Number((await db.execute(`SELECT COUNT(*) n FROM orders WHERE customer_id LIKE 'prac\\_%' ESCAPE '\\' AND rider_id IS NULL AND ${clause}`)).rows[0]!.n);
    assert.ok((await waiting("restaurant_id IS NULL")) >= 4, "orders are waiting for riders");
    assert.ok((await waiting("restaurant_id IS NOT NULL")) >= 2, "food orders are waiting for restaurants");
    const demoRider = await start(rider, "rider");
    const demoJobs = (await json<{ jobs: unknown[] }>(await call(demoRider.token, "/riders/jobs/available"))).jobs;
    assert.ok(demoJobs.length >= 1, "a practising rider sees what the demo customers ordered");
    const realJobs = (await json<{ jobs: unknown[] }>(await call(rider, "/riders/jobs/available"))).jobs;
    assert.equal(realJobs.length, 0, "a real rider on the live platform sees none of it");
  });

  await t.test("a practising rider's whole job finishes: take, be paid for, deliver, hand over, settle, be rated", async () => {
    const demoRider = await start(rider, "rider");
    // Earlier steps left demo riders on jobs; clear them so this one starts from a quiet world.
    await db.execute("UPDATE orders SET stage = 'Cancelled' WHERE customer_id LIKE 'prac\\_%' ESCAPE '\\' AND stage NOT IN ('Settle', 'Cancelled')");
    await runInPractice(async () => { const who = PRACTICE_CUSTOMERS[0]!; await parcel(who, await actAs(who)); });
    const open = await db.execute(`SELECT id, rider_id FROM orders WHERE customer_id LIKE 'prac\\_%' ESCAPE '\\' AND customer_id = '${PRACTICE_CUSTOMERS[0]!.id}' AND type = 'parcel' ORDER BY created_at DESC, rowid DESC LIMIT 1`);
    const id = String(open.rows[0]?.id ?? "");
    assert.ok(id, "a demo parcel was placed");
    // Matching may already have handed it to a nearby demo rider; either way a demo rider takes it.
    let assigned = open.rows[0]!.rider_id ? String(open.rows[0]!.rider_id) : null;
    // The persona rider may already be on a job of their own; a demo rider who is free takes it instead.
    const free = await db.execute(`SELECT user_id FROM riders WHERE user_id LIKE 'prac\\_%' ESCAPE '\\' AND verified = 1 AND is_online = 1 AND user_id NOT IN (SELECT rider_id FROM orders WHERE rider_id IS NOT NULL AND stage NOT IN ('Settle', 'Cancelled')) LIMIT 1`);
    const taker = assigned ?? String(free.rows[0]?.user_id ?? "");
    assert.ok(taker, "a demo rider is free");
    const riderToken = await signToken({ sub: taker, role: "rider", practice: true });
    const stageOf = async () => String((await db.execute({ sql: "SELECT stage FROM orders WHERE id = ?", args: [id] })).rows[0]!.stage);
    const act = (path: string, body: unknown = {}) => call(riderToken, `/orders/${id}/${path}`, { method: "POST", body: JSON.stringify(body) });
    if (!assigned) {
      const claimed = await act("claim");
      assert.ok(claimed.status < 300, `claim ${claimed.status} ${JSON.stringify(await claimed.clone().json().catch(() => ({})))}`);
    }
    assert.equal(await stageOf(), "Match");
    assert.ok((await runInPractice(() => runDemoCustomerAutopilot())) >= 1, "the demo customer pays");
    assert.equal(await stageOf(), "Shop");
    const delivering = await act("deliver", { etaMinutes: 10 });
    assert.ok(delivering.status < 300, `deliver ${delivering.status}`);
    assert.ok((await runInPractice(() => runDemoCustomerAutopilot())) >= 1, "the demo customer hands over with the PIN");
    assert.equal(await stageOf(), "Handover");
    const settled = await act("settle");
    assert.ok(settled.status < 300, `settle ${settled.status} ${JSON.stringify(await settled.clone().json().catch(() => ({})))}`);
    assert.equal(await stageOf(), "Settle");
    assert.ok((await runInPractice(() => runDemoCustomerAutopilot())) >= 1, "the demo customer rates");
    assert.equal(Number((await db.execute({ sql: "SELECT COUNT(*) n FROM order_ratings WHERE order_id = ?", args: [id] })).rows[0]!.n), 1);
  });

  await t.test("rider pools: practice offers demo riders only, live offers real riders only", async () => {
    const pool = async () => (await db.execute(`SELECT user_id FROM riders WHERE verified = 1 AND is_online = 1 AND ${ridersForThisWorld("user_id")}`)).rows.map((r) => String(r.user_id));
    const inLive = await pool();
    const inPractice = await runInPractice(pool);
    assert.deepEqual(inLive, ["real_rider"]);
    assert.ok(inPractice.length === 6 && inPractice.every((id) => id.startsWith("prac_")));
  });

  await t.test("admin lists hide demo people on the live view and show them on the sandbox view", async () => {
    const ids = async (path: string, key: string) => (await json<Record<string, { id?: string }[]>>(await call(admin, path)))[key]!.map((r) => String(r.id));
    assert.ok(!(await ids("/admin/riders?environment=live", "riders")).some((id) => id.startsWith("prac_")));
    assert.ok((await ids("/admin/riders?environment=sandbox", "riders")).some((id) => id.startsWith("prac_")));
    assert.ok(!(await ids("/admin/customers?environment=live", "customers")).some((id) => id.startsWith("prac_")));
    assert.ok((await ids("/admin/customers?environment=sandbox", "customers")).some((id) => id.startsWith("prac_")));
    const stats = await json<{ users: Record<string, number> }>(await call(admin, "/admin/stats?environment=live"));
    assert.ok(JSON.stringify(stats).length > 0);
  });

  await t.test("a practice persona cannot start another session or reach admin", async () => {
    const demo = await start(customer, "customer");
    assert.equal((await call(demo.token, "/practice/session", { method: "POST", body: JSON.stringify({ role: "rider" }) })).status, 409);
    assert.equal((await call(demo.token, "/admin/practice")).status, 403);
  });

  await t.test("reset clears demo orders and money, keeps the shops, and leaves real data alone", async () => {
    await db.execute({ sql: "INSERT INTO lists (id, customer_id, title, status, environment) VALUES ('real_list', 'real_cust', 'Mine', 'draft', 'live')", args: [] });
    await db.execute({ sql: "INSERT INTO orders (id, list_id, customer_id, environment) VALUES ('real_order', 'real_list', 'real_cust', 'live')", args: [] });
    await db.execute({ sql: "UPDATE users SET wallet_balance_sandbox = 1 WHERE id = 'prac_cust_amina'", args: [] });
    const before = await runInPractice(practiceCounts);
    assert.ok(before.orders > 0);
    await runInPractice(async () => { await resetPracticeWorld(); await seedPracticeWorld(); });
    const after = await runInPractice(practiceCounts);
    assert.equal(after.orders, 0);
    assert.deepEqual([after.stores, after.restaurants, after.menuItems], [before.stores, before.restaurants, before.menuItems]);
    assert.equal(Number((await db.execute("SELECT wallet_balance_sandbox v FROM users WHERE id = 'prac_cust_amina'")).rows[0]!.v), 250_000);
    assert.equal(Number((await db.execute("SELECT COUNT(*) n FROM orders WHERE id = 'real_order'")).rows[0]!.n), 1);
    const seeded = Number((await db.execute("SELECT COUNT(*) n FROM merchant_kyc_cases WHERE merchant_id LIKE 'prac\\_%' ESCAPE '\\'")).rows[0]!.n);
    await runInPractice(seedPracticeWorld);
    assert.equal(Number((await db.execute("SELECT COUNT(*) n FROM merchant_kyc_cases WHERE merchant_id LIKE 'prac\\_%' ESCAPE '\\'")).rows[0]!.n), seeded, "seeding again adds nothing");
  });
});

test("every module Practice covers has demo data in the practice world", async () => {
  const { PRACTICE_MODULES: MODULES } = await import("@peebee/shared");
  const { practiceHarness } = await import("./world-test-helpers.js");
  const { moduleCoverage, MODULE_PROBES } = await import("./coverage.js");
  const { seedPracticeWorld } = await import("./seed.js");
  const { placeStarterOrders } = await import("./demo-customers.js");
  await practiceHarness();
  const counts = await runInPractice(async () => {
    await seedPracticeWorld();
    await placeStarterOrders();
    return moduleCoverage();
  });
  assert.equal(MODULES.length, Object.keys(MODULE_PROBES).length, "every module Practice covers has a probe");
  const empty = MODULES.filter((m) => !(counts[m.key]! > 0)).map((m) => m.key);
  assert.deepEqual(empty, [], `modules with no demo data: ${empty.join(", ")}`);
});
