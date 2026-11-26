import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import app from "../app.js";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { ensureDemoStations, stepSandboxRelay } from "./sandbox-demo.js";

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

const KAMPALA = { lat: 0.3136, lng: 32.5811 };
const ENTEBBE = { lat: 0.0512, lng: 32.4637 };
const PICKUP = { lat: 0.33, lng: 32.59 };
const DOOR = { lat: 0.06, lng: 32.47 };

test("sandbox relay demo: demo riders, matatu and petrol station carry a parcel while the tester only orders, pays and confirms", async (t) => {
  const client = createClient({ url: "file::memory:" });
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "relay-demo-tests-only";
  for (const file of readdirSync(join(process.cwd(), "src/db/migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(process.cwd(), "src/db/migrations", file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  try {
    for (const [id, role] of [["customer", "customer"], ["staff", "admin"]]) {
      await client.execute({ sql: "INSERT INTO users (id, phone, name, password_hash, role, wallet_balance_sandbox) VALUES (?, ?, ?, 'hash', ?, 1000000)", args: [id, id, id, role] });
    }
    await client.execute("INSERT INTO personal_wallets (user_id) VALUES ('customer')");
    await client.execute("UPDATE users SET admin_role = 'super_admin' WHERE id = 'staff'");
    for (const [key, value] of Object.entries({
      platform_environment: "sandbox", merchant_sandbox_enabled: "1", delivery_rate_per_km: "2000", minimum_delivery_fee: "2000",
      relay_enabled: "1", relay_last_mile_choice: "order",
    })) await client.execute({ sql: "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", args: [key, value] });

    const tokens: Record<string, string> = {
      customer: await signToken({ sub: "customer", role: "customer" }),
      staff: await signToken({ sub: "staff", role: "admin" }),
    };
    const call = (who: string, path: string, body?: object) => app.request(`/v1/${path}`, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${tokens[who]}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = async <T>(res: Response | Promise<Response>) => (await (await res).json()) as T;

    // Staff add a station-drop route; nobody real works it.
    const route = await call("staff", "admin/relay/routes", {
      name: "Kampala - Entebbe", stageAName: "Kampala taxi park", stageALat: KAMPALA.lat, stageALng: KAMPALA.lng,
      stageBName: "Entebbe stage", stageBLat: ENTEBBE.lat, stageBLng: ENTEBBE.lng, parcelFare: 5000, dropMode: "station",
    });
    assert.equal(route.status, 201);

    await t.test("demo petrol stations sit at the route's ends, out of every live list", async () => {
      assert.equal(await ensureDemoStations(), 2);
      const outlets = (await client.execute("SELECT status, relay_drop FROM fuel_station_outlets WHERE id LIKE 'demo-relay-out-%'")).rows;
      assert.deepEqual(outlets.map((o) => [o.status, o.relay_drop]), [["closed", 2], ["closed", 2]]);
      assert.equal(await ensureDemoStations(), 2, "safe to run on every heartbeat");
      assert.equal((await client.execute("SELECT COUNT(*) AS n FROM fuel_station_outlets WHERE id LIKE 'demo-relay-out-%'")).rows[0].n, 2);
    });

    let n = 0;
    const parcel = async (lastMile: "door" | "collect") => {
      const list = await json<{ id: string }>(call("customer", "lists", { title: `Parcel ${++n}`, items: [] }));
      const res = await call("customer", "orders", {
        listId: list.id, type: "parcel", paymentRail: "escrow", relayLastMile: lastMile,
        pickupArea: "Nakasero", pickupLat: PICKUP.lat, pickupLng: PICKUP.lng, destinationArea: "Entebbe", destinationLat: DOOR.lat, destinationLng: DOOR.lng,
      });
      assert.equal(res.status, 201, await res.clone().text());
      return (await json<{ order: { id: string; estimated_total: number } }>(res)).order;
    };
    /** Runs demo steps until it waits on the customer; returns what it did. */
    const runDemo = async (orderId: string) => {
      const done: string[] = [];
      for (let i = 0; i < 20; i++) {
        const step = await stepSandboxRelay(orderId, { force: true });
        if (!step) break;
        done.push(step);
      }
      return done;
    };
    const stageOf = async (id: string) => String((await client.execute({ sql: "SELECT stage FROM orders WHERE id = ?", args: [id] })).rows[0].stage);

    await t.test("door delivery: every role but the customer is played by the demo", async () => {
      const order = await parcel("door");
      const relay = (await client.execute({ sql: "SELECT drop_mode, outlet_id FROM order_relay WHERE order_id = ?", args: [order.id] })).rows[0];
      assert.equal(relay.drop_mode, "station");
      assert.match(String(relay.outlet_id), /^demo-relay-out-/, "the demo station near the customer is the drop");

      assert.deepEqual(await runDemo(order.id), ["first rider assigned"], "then it waits for the customer to pay");
      assert.equal((await call("customer", `orders/${order.id}/fund`, { paymentMethod: "wallet", useWallet: true, acceptedAmount: order.estimated_total })).status, 200);
      assert.deepEqual(await runDemo(order.id), [
        "first rider set off", "matatu received", "matatu nearly there", "matatu arrived", "station received",
        "last rider assigned", "last rider collected at the station", "last rider at the door",
      ]);
      assert.equal(await stageOf(order.id), "Arrived");
      const soon = (await client.execute({ sql: "SELECT soon_notified_at FROM order_relay WHERE order_id = ?", args: [order.id] })).rows[0];
      assert.ok(soon.soon_notified_at, "the customer got the 'arriving soon' alert");

      const pin = String((await client.execute({ sql: "SELECT pin_code FROM orders WHERE id = ?", args: [order.id] })).rows[0].pin_code);
      assert.equal((await call("customer", `orders/${order.id}/handover`, { pin })).status, 200);
      assert.deepEqual(await runDemo(order.id), ["settled"]);
      assert.equal(await stageOf(order.id), "Settle");
      const legs = (await client.execute({ sql: "SELECT status, provider_id FROM order_relay_legs WHERE order_id = ? ORDER BY leg", args: [order.id] })).rows;
      assert.deepEqual(legs.map((l) => l.status), ["done", "done", "done"]);
      assert.match(String(legs[1].provider_id), /^demo-relay-op-/);
    });

    await t.test("collect at the station: the demo attendant hands it over and the order closes", async () => {
      const order = await parcel("collect");
      await runDemo(order.id);
      assert.equal((await call("customer", `orders/${order.id}/fund`, { paymentMethod: "wallet", useWallet: true, acceptedAmount: order.estimated_total })).status, 200);
      const steps = await runDemo(order.id);
      assert.deepEqual(steps.slice(-2), ["station received", "customer collected at the station"]);
      assert.equal(await stageOf(order.id), "Settle");
    });

    await t.test("paid before any rider: the demo assigns its rider straight into Shop and carries the parcel to the end", async () => {
      const order = await parcel("door");
      const quote = await json<{ wallet: number; payBeforeRider: boolean }>(call("customer", `orders/${order.id}/checkout`));
      assert.equal(quote.payBeforeRider, true);
      assert.equal((await call("customer", `orders/${order.id}/fund`, { paymentMethod: "wallet", useWallet: true, acceptedAmount: quote.wallet })).status, 200);
      assert.equal(await stageOf(order.id), "Match", "paid, no rider yet");
      assert.deepEqual(await runDemo(order.id), [
        "first rider assigned", "first rider set off", "matatu received", "matatu nearly there", "matatu arrived", "station received",
        "last rider assigned", "last rider collected at the station", "last rider at the door",
      ], "no wait for payment after the rider is assigned");
      const pin = String((await client.execute({ sql: "SELECT pin_code FROM orders WHERE id = ?", args: [order.id] })).rows[0].pin_code);
      assert.equal((await call("customer", `orders/${order.id}/handover`, { pin })).status, 200);
      assert.deepEqual(await runDemo(order.id), ["settled"]);
      assert.equal(await stageOf(order.id), "Settle");
      const payments = (await client.execute({ sql: "SELECT type, amount FROM payments WHERE order_id = ? ORDER BY created_at", args: [order.id] })).rows;
      assert.deepEqual(payments.filter((p) => p.type === "collection").map((p) => Number(p.amount)), [quote.wallet], "paid once");
      const legs = (await client.execute({ sql: "SELECT COALESCE(SUM(paid_amount), 0) AS paid FROM order_relay_legs WHERE order_id = ?", args: [order.id] })).rows[0];
      assert.equal(Number(legs.paid), quote.wallet, "the legs are paid what was collected");
    });

    await t.test("a real tester acting first is never overridden, and live orders are never touched", async () => {
      const order = await parcel("door");
      assert.equal(await stepSandboxRelay(order.id), null, "inside the step delay the demo waits");
      await client.execute({ sql: "UPDATE orders SET environment = 'live' WHERE id = ?", args: [order.id] });
      assert.equal(await stepSandboxRelay(order.id, { force: true }), null);
      await client.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('relay_sandbox_demo', '0')");
      await client.execute({ sql: "UPDATE orders SET environment = 'sandbox' WHERE id = ?", args: [order.id] });
      assert.equal(await stepSandboxRelay(order.id, { force: true }), null, "admin can switch the demo off");
      const riders = (await client.execute("SELECT is_online FROM riders WHERE user_id LIKE 'demo-relay-rider-%'")).rows;
      assert.ok(riders.length > 0 && riders.every((r) => r.is_online === 0), "demo riders never go online, so live matching never sees them");
    });
  } finally {
    process.env.JWT_SECRET = previousSecret;
    client.close();
  }
});
