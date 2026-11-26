import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import app from "../app.js";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { resetSchemaCache } from "../lib/schema.js";
import { ensureSandboxCarDrivers, stepSandboxCar } from "./sandbox-demo.js";

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

const PICKUP = { lat: 0.3136, lng: 32.5811 };
const trip = { pickupLat: PICKUP.lat, pickupLng: PICKUP.lng, destinationLat: 0.3536, destinationLng: 32.6011, pickupAddress: "Kampala", destinationAddress: "Ntinda" };

test("sandbox car demo: demo drivers appear near a pickup, take the ride, answer calls and finish the trip", async (t) => {
  const client = createClient({ url: "file::memory:" });
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "car-demo-tests-only";
  resetSchemaCache();
  for (const file of readdirSync(join(process.cwd(), "src/db/migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(process.cwd(), "src/db/migrations", file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  const setSettings = async (values: Record<string, string>) => {
    for (const [key, value] of Object.entries(values)) await client.execute({ sql: "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", args: [key, value] });
  };
  try {
    await client.execute({ sql: "INSERT INTO users (id, phone, name, password_hash, role, wallet_balance_sandbox) VALUES ('cust', 'cust', 'Cust', 'hash', 'customer', 1000000)", args: [] });
    await client.execute("INSERT INTO personal_wallets (user_id) VALUES ('cust')");
    await setSettings({
      platform_environment: "live", car_enabled: "1", car_ondemand_enabled: "1", car_matching_mode: "first_to_claim",
    });
    const token = await signToken({ sub: "cust", role: "customer" });
    const call = (path: string, body?: object) => app.request(`/v1/${path}`, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = async <T>(res: Response | Promise<Response>) => (await (await res).json()) as T;
    const query = `pickupLat=${trip.pickupLat}&pickupLng=${trip.pickupLng}&destinationLat=${trip.destinationLat}&destinationLng=${trip.destinationLng}`;
    type Options = { options: Array<{ size: string; tier: string; nearby: number }> };

    await t.test("live: nothing is created and no cars show up", async () => {
      assert.equal(await ensureSandboxCarDrivers(PICKUP.lat, PICKUP.lng), false);
      assert.equal((await client.execute("SELECT COUNT(*) AS n FROM users WHERE id LIKE 'demo-car-%'")).rows[0].n, 0);
      assert.ok((await json<Options>(call(`car/service-options?${query}`))).options.every((o) => o.nearby === 0));
    });

    await setSettings({ platform_environment: "sandbox" });

    await t.test("sandbox: every size and tier has a demo car nearby, and the demo can be switched off", async () => {
      const { options } = await json<Options>(call(`car/service-options?${query}`));
      assert.equal(options.length, 4);
      assert.ok(options.every((o) => o.nearby >= 1), JSON.stringify(options));
      assert.equal(await ensureSandboxCarDrivers(PICKUP.lat, PICKUP.lng), true, "safe to run on every request");
      assert.equal((await client.execute("SELECT COUNT(*) AS n FROM users WHERE id LIKE 'demo-car-driver-%'")).rows[0].n, 8);
      // Far from every demo car there is nobody, and with the demo off nobody is moved there.
      await setSettings({ car_sandbox_demo: "0" });
      const far = await json<Options>(call("car/service-options?pickupLat=2.77&pickupLng=32.3&destinationLat=2.8&destinationLng=32.3"));
      assert.ok(far.options.every((o) => o.nearby === 0));
      await setSettings({ car_sandbox_demo: "1" });
    });

    let orderId = "";
    let driverId = "";
    await t.test("a comfort large ride is taken by a matching demo driver once the step delay passes", async () => {
      const res = await call("car/bookings", { serviceTier: "comfort", vehicleSize: "large", ...trip });
      assert.equal(res.status, 201);
      orderId = (await json<{ order: { id: string } }>(res)).order.id;
      assert.equal(await stepSandboxCar(orderId), null, "inside the step delay the demo waits for a real person");
      assert.equal(await stepSandboxCar(orderId, { force: true }), "driver assigned");
      driverId = String((await client.execute({ sql: "SELECT rider_id FROM orders WHERE id = ?", args: [orderId] })).rows[0].rider_id);
      assert.ok(["demo-car-driver-04", "demo-car-driver-08"].includes(driverId), `the large comfort cars, got ${driverId}`);
    });

    await t.test("calling the demo driver is answered at once", async () => {
      const res = await call("calls", { calleeId: driverId, orderId });
      assert.equal(res.status, 201);
      const { call: placed } = await json<{ call: { status: string; provider: string } }>(res);
      assert.deepEqual([placed.status, placed.provider], ["accepted", "mock"]);
    });

    await t.test("after the passenger pays, the driver sets off, arrives and picks up; the passenger confirms; the driver settles", async () => {
      const fund = await call(`orders/${orderId}/fund`, { paymentMethod: "wallet", useWallet: true });
      assert.equal(fund.status, 200, await fund.clone().text());
      const steps: string[] = [];
      for (let i = 0; i < 5; i++) {
        const done = await stepSandboxCar(orderId, { force: true });
        if (done) steps.push(done);
        if (done === "passenger picked up") break;
      }
      assert.ok(steps.includes("driver arrived") && steps.at(-1) === "passenger picked up", steps.join(", "));
      assert.equal((await client.execute({ sql: "SELECT stage FROM orders WHERE id = ?", args: [orderId] })).rows[0].stage, "PickedUp");
      assert.equal(await stepSandboxCar(orderId, { force: true }), null, "the passenger confirms the trip, not the demo");

      const pin = String((await client.execute({ sql: "SELECT pin_code FROM orders WHERE id = ?", args: [orderId] })).rows[0].pin_code);
      assert.equal((await call(`orders/${orderId}/handover`, { pin })).status, 200);
      assert.equal(await stepSandboxCar(orderId, { force: true }), "settled");
      assert.equal((await client.execute({ sql: "SELECT stage FROM orders WHERE id = ?", args: [orderId] })).rows[0].stage, "Settle");
      assert.equal(await stepSandboxCar(orderId, { force: true }), null, "nothing more to do");
    });

    await t.test("a finished ride frees the driver for the next one", async () => {
      const res = await call("car/bookings", { serviceTier: "comfort", vehicleSize: "large", ...trip });
      assert.equal(res.status, 201);
      const next = (await json<{ order: { id: string } }>(res)).order.id;
      assert.equal(await stepSandboxCar(next, { force: true }), "driver assigned");
    });
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    resetSchemaCache();
  }
});
