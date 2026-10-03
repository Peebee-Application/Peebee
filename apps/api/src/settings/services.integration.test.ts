import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { getServiceSwitches, setServiceSwitches } from "../lib/settings.js";
import { resetSchemaCache } from "../lib/schema.js";
import { orderRoutes } from "../orders/routes.js";
import { customerRestaurantRoutes } from "../restaurants/customer.js";
import { carRoutes } from "../car/routes.js";

function bindDatabase(client: Client) {
  const prepare = (sql: string) => ({
    sql, args: [] as unknown[],
    bind(...args: unknown[]) { this.args = args; return this; },
    async all() {
      const result = await client.execute({ sql: this.sql, args: this.args as InArgs });
      return { results: result.rows, success: true, meta: { changes: result.rowsAffected, last_row_id: Number(result.lastInsertRowid ?? 0) } };
    },
  });
  setD1Binding({
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      const results = await client.batch(statements.map(({ sql, args }) => ({ sql, args: args as InArgs })), "write");
      return results.map((result) => ({ results: result.rows, success: true, meta: { changes: result.rowsAffected, last_row_id: Number(result.lastInsertRowid ?? 0) } }));
    },
  } as unknown as D1Database);
}

test("switching a service off stops new orders of that kind only", async (t) => {
  process.env.JWT_SECRET = "local-services-test-secret-only";
  resetSchemaCache();
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  await client.execute({ sql: "INSERT INTO users (id, phone, name, password_hash, role) VALUES ('cust', 'cust', 'cust', 'h', 'customer')", args: [] });
  const app = new Hono().route("/v1", orderRoutes).route("/v1", customerRestaurantRoutes).route("/v1", carRoutes);
  const token = await signToken({ sub: "cust", role: "customer" });
  const call = (method: string, path: string, body?: unknown) =>
    app.request(`/v1${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = async (res: Response) => (await res.json()) as Record<string, any>;
  const list = async () => {
    const id = `list_${Math.random().toString(36).slice(2, 10)}`;
    await client.execute({ sql: "INSERT INTO lists (id, customer_id, title, status, environment) VALUES (?, 'cust', 'L', 'draft', 'live')", args: [id] });
    return id;
  };
  const geo = { pickupLat: 0.3, pickupLng: 32.58, destinationLat: 0.35, destinationLng: 32.58 };

  await t.test("everything is on by default", async () => {
    assert.deepEqual(await getServiceSwitches(), { shopping: true, parcel: true, ride: true, food: true });
  });

  await t.test("ride off: rides and car bookings refused, parcels and shopping still work", async () => {
    await setServiceSwitches({ ride: false });
    const ride = await call("POST", "/orders", { listId: await list(), type: "parcel", isRide: true, ...geo });
    assert.equal(ride.status, 403);
    assert.equal((await json(ride)).error, "service_paused");
    assert.equal((await call("POST", "/car/bookings", { categoryId: "x", ...geo })).status, 403);
    assert.equal((await call("POST", "/orders", { listId: await list(), type: "parcel", ...geo })).status, 201);
    assert.equal((await call("POST", "/orders", { listId: await list(), type: "shopping", estimatedTotal: 5000 })).status, 201);
    await setServiceSwitches({ ride: true });
    assert.equal((await call("POST", "/orders", { listId: await list(), type: "parcel", isRide: true, ...geo })).status, 201);
  });

  await t.test("parcel off and shopping off each refuse only their own", async () => {
    await setServiceSwitches({ parcel: false });
    assert.equal((await call("POST", "/orders", { listId: await list(), type: "parcel", ...geo })).status, 403);
    assert.equal((await call("POST", "/orders", { listId: await list(), type: "parcel", isRide: true, ...geo })).status, 201, "rides are their own service");
    await setServiceSwitches({ parcel: true, shopping: false });
    assert.equal((await call("POST", "/orders", { listId: await list(), type: "shopping", estimatedTotal: 5000 })).status, 403);
    await setServiceSwitches({ shopping: true });
  });

  await t.test("food off: no restaurants to browse and checkout refused", async () => {
    await setServiceSwitches({ food: false });
    const res = await json(await call("GET", "/restaurants"));
    assert.deepEqual(res, { restaurants: [], paused: true });
    const order = await call("POST", "/restaurants/any/order", { items: [{ menuItemId: "m", quantity: 1 }] });
    assert.equal(order.status, 403);
    assert.equal((await json(order)).service, "food");
    await setServiceSwitches({ food: true });
    assert.equal((await json(await call("GET", "/restaurants"))).paused, undefined);
  });
});
