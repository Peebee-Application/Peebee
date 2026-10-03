import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { setSetting } from "../lib/settings.js";
import { resetSchemaCache } from "../lib/schema.js";
import { orderRoutes } from "../orders/routes.js";
import { cleanPhone, passengerRoutes } from "./routes.js";
import { tripRoutes } from "./trips.js";

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

test("phone numbers are cleaned and bad ones refused", () => {
  assert.equal(cleanPhone("0772 123 456"), "0772123456");
  assert.equal(cleanPhone("+256 772-123-456"), "+256772123456");
  assert.equal(cleanPhone("123"), null);
  assert.equal(cleanPhone("not a number"), null);
});

test("ride for someone else: passengers, the order, and the passenger's trip link", async (t) => {
  process.env.JWT_SECRET = "local-passenger-test-secret-only";
  resetSchemaCache();
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  for (const [id, role] of [["cust", "customer"], ["other", "customer"], ["boda", "rider"]]) {
    await client.execute({ sql: "INSERT INTO users (id, phone, name, password_hash, role) VALUES (?, ?, ?, 'h', ?)", args: [id, id, id, role] });
  }
  const app = new Hono().route("/v1/trips", tripRoutes).route("/v1", orderRoutes).route("/v1", passengerRoutes);
  const tokens: Record<string, string> = {};
  for (const [id, role] of [["cust", "customer"], ["other", "customer"], ["boda", "rider"]] as const) tokens[id] = await signToken({ sub: id, role });
  const call = (method: string, path: string, who?: string, body?: unknown) =>
    app.request(`/v1${path}`, {
      method,
      headers: { ...(who ? { Authorization: `Bearer ${tokens[who]}` } : {}), "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const json = async (res: Response) => (await res.json()) as Record<string, any>;
  const trip = { pickupLat: 0.3, pickupLng: 32.58, destinationLat: 0.35, destinationLng: 32.58, pickupAddress: "A", destinationAddress: "B", isRide: true, type: "parcel" };
  const newList = async (owner: string) => {
    const id = `list_${owner}_${Math.random().toString(36).slice(2, 8)}`;
    await client.execute({ sql: "INSERT INTO lists (id, customer_id, title, status, environment) VALUES (?, ?, 'Ride', 'draft', 'live')", args: [id, owner] });
    return id;
  };

  let passengerId = "";
  await t.test("saved passengers are per customer, de-duplicated by number and validated", async () => {
    assert.equal((await call("GET", "/passengers")).status, 401);
    assert.equal((await call("POST", "/passengers", "cust", { name: "Mum", phone: "12" })).status, 400);
    const saved = await call("POST", "/passengers", "cust", { name: "Mum", phone: "0772 123 456" });
    assert.equal(saved.status, 201);
    passengerId = (await json(saved)).passenger.id;
    await call("POST", "/passengers", "cust", { name: "Mama", phone: "0772123456" });
    const list = (await json(await call("GET", "/passengers", "cust"))).passengers;
    assert.equal(list.length, 1, "same number is the same person");
    assert.equal(list[0].name, "Mama");
    assert.equal((await json(await call("GET", "/passengers", "other"))).passengers.length, 0);
    await call("DELETE", `/passengers/${passengerId}`, "other");
    assert.equal((await json(await call("GET", "/passengers", "cust"))).passengers.length, 1, "someone else can't delete it");
  });

  let token = "";
  let orderId = "";
  await t.test("a ride booked for someone else records the passenger and a private link", async () => {
    const res = await call("POST", "/orders", "cust", { listId: await newList("cust"), ...trip, passenger: { name: "Brian", phone: "0701 000 111" } });
    assert.equal(res.status, 201);
    const order = (await json(res)).order;
    orderId = order.id;
    assert.equal(order.passenger_name, "Brian");
    assert.equal(order.passenger_phone, "0701000111");
    token = order.share_token;
    assert.ok(token && token.length >= 24);
  });

  await t.test("a goods parcel ignores a passenger; a normal ride has none", async () => {
    const parcel = (await json(await call("POST", "/orders", "cust", { listId: await newList("cust"), ...trip, isRide: false, passenger: { name: "Brian", phone: "0701000111" } }))).order;
    assert.equal(parcel.passenger_name, null);
    const own = (await json(await call("POST", "/orders", "cust", { listId: await newList("cust"), ...trip }))).order;
    assert.equal(own.passenger_name, null);
    assert.equal(own.share_token, null);
  });

  await t.test("the admin switch turns it off", async () => {
    await setSetting("ride_for_other_enabled", "0");
    const off = (await json(await call("POST", "/orders", "cust", { listId: await newList("cust"), ...trip, passenger: { name: "Brian", phone: "0701000111" } }))).order;
    assert.equal(off.passenger_name, null);
    await setSetting("ride_for_other_enabled", "1");
  });

  await t.test("the trip link works without an account and shows the passenger only what they need", async () => {
    assert.equal((await call("GET", "/trips/short")).status, 404);
    assert.equal((await call("GET", `/trips/${"x".repeat(40)}`)).status, 404);
    const res = await call("GET", `/trips/${token}`);
    assert.equal(res.status, 200);
    const shared = (await json(res)).trip;
    assert.equal(shared.passengerName, "Brian");
    assert.equal(shared.stage, "Create");
    assert.ok(!("pin" in shared), "the handover PIN stays with the booker");
    for (const secret of ["customer_id", "estimated_total", "payment_rail", "share_token"]) assert.ok(!(secret in shared), `${secret} must not leak`);
  });

  await t.test("a driver sees the passenger but never the share link", async () => {
    await client.execute({ sql: "UPDATE orders SET rider_id = 'boda', stage = 'Match' WHERE id = ?", args: [orderId] });
    const seen = (await json(await call("GET", `/orders/${orderId}`, "boda"))).order;
    assert.equal(seen.passenger_name, "Brian");
    assert.equal(seen.passenger_phone, "0701000111");
    assert.ok(!("share_token" in seen), "driver must not get the link");
    const owner = (await json(await call("GET", `/orders/${orderId}`, "cust"))).order;
    assert.equal(owner.share_token, token);
  });
});
