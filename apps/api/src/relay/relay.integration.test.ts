import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { turnOffIncentives } from "../test-support/no-incentives.js";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { orderRoutes } from "../orders/routes.js";
import { relayRoutes } from "./routes.js";
import { resetSchemaCache } from "../lib/schema.js";
import { reconcilePayment } from "../payments/reconciliation.js";

// The payment mocks settle from a hash of the provider reference; pick references that do / don't succeed.
function refWithOutcome(succeeds: boolean): string {
  const hash = (input: string) => { let h = 0; for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0; return h; };
  for (let i = 0; i < 1000; i++) if ((hash(`relay-pay-first-${i}`) % 100 < 8) !== succeeds) return `relay-pay-first-${i}`;
  throw new Error("no reference found");
}

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

// Kampala taxi park <-> Entebbe stage, with a pickup and a door near each end.
const KAMPALA = { lat: 0.3136, lng: 32.5811 };
const ENTEBBE = { lat: 0.0512, lng: 32.4637 };
const PICKUP = { lat: 0.33, lng: 32.59 };
const DOOR = { lat: 0.06, lng: 32.47 };

test("relay delivery: boda -> matatu -> boda with coded handoffs and split payouts", async (t) => {
  const client = createClient({ url: "file::memory:" });
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "relay-tests-only";
  for (const file of readdirSync(join(process.cwd(), "src/db/migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(process.cwd(), "src/db/migrations", file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  await turnOffIncentives();
  try {
    for (const [id, role] of [["customer", "customer"], ["first", "rider"], ["last", "rider"], ["op", "customer"], ["staff", "admin"]]) {
      await client.execute({ sql: "INSERT INTO users (id, phone, name, password_hash, role) VALUES (?, ?, ?, 'hash', ?)", args: [id, id, id, role] });
    }
    await client.execute("INSERT INTO personal_wallets (user_id) VALUES ('customer')");
    await client.execute("UPDATE users SET admin_role = 'super_admin' WHERE id = 'staff'");
    await client.execute({ sql: "INSERT INTO riders (user_id, verified, is_online, stage_lat, stage_lng) VALUES ('first', 1, 1, ?, ?), ('last', 1, 1, ?, ?)", args: [PICKUP.lat, PICKUP.lng, ENTEBBE.lat, ENTEBBE.lng] });
    await client.execute("INSERT INTO lists (id, customer_id, title) VALUES ('list', 'customer', 'Parcel'), ('short', 'customer', 'Short'), ('cash', 'customer', 'Cash')");
    for (const [key, value] of Object.entries({ delivery_rate_per_km: "2000", minimum_delivery_fee: "2000", relay_enabled: "1", relay_release_per_leg: "1" })) {
      await client.execute({ sql: "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", args: [key, value] });
    }

    const app = new Hono().route("/v1", orderRoutes).route("/v1", relayRoutes);
    const tokens = Object.fromEntries(await Promise.all(
      [["customer", "customer"], ["first", "rider"], ["last", "rider"], ["op", "customer"], ["staff", "admin"]].map(async ([sub, role]) => [sub, await signToken({ sub, role } as never)] as const),
    ));
    const call = (who: string, path: string, body?: object, method?: string) => app.request(`/v1/${path}`, {
      method: method ?? (body ? "POST" : "GET"),
      headers: { Authorization: `Bearer ${tokens[who]}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const parcel = (listId: string, from: typeof PICKUP, to: typeof DOOR, paymentRail = "escrow") => call("customer", "orders", {
      listId, type: "parcel", paymentRail,
      pickupArea: "Nakasero", pickupLat: from.lat, pickupLng: from.lng,
      destinationArea: "Entebbe", destinationLat: to.lat, destinationLng: to.lng,
    });
    const wallet = async (table: string, id: string) => Number((await client.execute({ sql: `SELECT wallet_balance FROM ${table} WHERE ${table === "riders" ? "user_id" : "id"} = ?`, args: [id] })).rows[0].wallet_balance);
    const operatorEarnings = async () => Number((await client.execute("SELECT COALESCE(SUM(balance),0) AS b FROM provider_wallets WHERE provider_type='relay' AND provider_id='op' AND environment='live'")).rows[0].b);

    let routeId = "";
    await t.test("staff add a route and approve an operator", async () => {
      const created = await call("staff", "admin/relay/routes", {
        name: "Kampala - Entebbe", stageAName: "Kampala taxi park", stageALat: KAMPALA.lat, stageALng: KAMPALA.lng,
        stageBName: "Entebbe stage", stageBLat: ENTEBBE.lat, stageBLng: ENTEBBE.lng, parcelFare: 5000,
      });
      assert.equal(created.status, 201);
      routeId = ((await created.json()) as { id: string }).id;
      assert.equal((await call("op", "relay/operator/apply", { routeId, vehiclePlate: "uaz 123k" })).status, 201);
      assert.equal((await call("op", "relay/operator/parcels")).status, 403);
      assert.equal((await call("staff", "admin/relay/operators/op/status", { status: "approved" })).status, 200);
    });

    type Quote = { relay: { direction: string; routeCode: string; routeName: string; legs: { fromName: string; toName: string; kind: string }[] } | null };
    const quoteFor = async (from: typeof PICKUP, to: typeof DOOR) =>
      (await (await call("customer", `relay/quote?pickupLat=${from.lat}&pickupLng=${from.lng}&destinationLat=${to.lat}&destinationLng=${to.lng}`)).json()) as Quote;

    await t.test("without stage codes, the route is written with the stage names' first letters", async () => {
      const there = await quoteFor(PICKUP, DOOR);
      assert.equal(there.relay?.direction, "KAM - ENT");
      assert.equal(there.relay?.routeCode, "KAM ⇄ ENT");
      assert.equal(there.relay?.routeName, "Kampala - Entebbe", "the full name is kept for older clients");
      assert.equal((await quoteFor(DOOR, PICKUP)).relay?.direction, "ENT - KAM");
    });

    await t.test("staff set ticket codes; the route runs both ways, KLA - EBB and EBB - KLA", async () => {
      assert.equal((await call("staff", `admin/relay/routes/${routeId}`, { stageACode: "K1" }, "PATCH")).status, 400);
      assert.equal((await call("staff", `admin/relay/routes/${routeId}`, { stageACode: "TOOLONG" }, "PATCH")).status, 400);
      assert.equal((await call("staff", `admin/relay/routes/${routeId}`, { stageACode: "kla", stageBCode: " ebb " }, "PATCH")).status, 200);
      const stored = (await client.execute({ sql: "SELECT stage_a_code, stage_b_code FROM relay_routes WHERE id = ?", args: [routeId] })).rows[0];
      assert.deepEqual([stored.stage_a_code, stored.stage_b_code], ["KLA", "EBB"]);
      const logged = (await client.execute({ sql: "SELECT COUNT(*) AS n FROM admin_activity_log WHERE entity_id = ? AND action = 'relay.route.update'", args: [routeId] })).rows[0];
      assert.ok(Number(logged.n) >= 1, "the change is in the activity log");

      const list = (await (await call("staff", "admin/relay/routes")).json()) as { codesReady: boolean; routes: { id: string; route_code: string; directions: string[] }[] };
      assert.equal(list.codesReady, true);
      const listed = list.routes.find((r) => r.id === routeId)!;
      assert.equal(listed.route_code, "KLA ⇄ EBB");
      assert.deepEqual(listed.directions, ["KLA - EBB", "EBB - KLA"]);

      const there = await quoteFor(PICKUP, DOOR);
      assert.equal(there.relay?.direction, "KLA - EBB");
      assert.equal(there.relay?.routeCode, "KLA ⇄ EBB");
      assert.deepEqual([there.relay?.legs[1].fromName, there.relay?.legs[1].toName], ["Kampala taxi park", "Entebbe stage"]);

      // Entebbe to Kampala: the same route the other way, boarding near Entebbe and alighting near Kampala.
      const back = await quoteFor(DOOR, PICKUP);
      assert.equal(back.relay?.direction, "EBB - KLA");
      assert.equal(back.relay?.routeCode, "KLA ⇄ EBB");
      assert.deepEqual(back.relay?.legs.map((leg) => leg.kind), ["boda", "matatu", "boda"]);
      assert.deepEqual([back.relay?.legs[1].fromName, back.relay?.legs[1].toName], ["Entebbe stage", "Kampala taxi park"]);

      const me = (await (await call("op", "relay/operator/me")).json()) as { operator: { route_code: string }; routes: { route_code: string }[] };
      assert.equal(me.operator.route_code, "KLA ⇄ EBB");
      assert.equal(me.routes[0].route_code, "KLA ⇄ EBB");

      // Clearing a code falls back to the stage name again.
      assert.equal((await call("staff", `admin/relay/routes/${routeId}`, { stageBCode: "" }, "PATCH")).status, 200);
      assert.equal((await quoteFor(PICKUP, DOOR)).relay?.direction, "KLA - ENT");
      assert.equal((await call("staff", `admin/relay/routes/${routeId}`, { stageBCode: "EBB" }, "PATCH")).status, 200);
    });

    let orderId = "";
    let total = 0;
    await t.test("a long parcel is relayed and priced as the sum of its legs", async () => {
      const quote = (await (await call("customer", `relay/quote?pickupLat=${PICKUP.lat}&pickupLng=${PICKUP.lng}&destinationLat=${DOOR.lat}&destinationLng=${DOOR.lng}`)).json()) as { relay: { total: number; legs: { fee: number; kind: string }[] } };
      assert.deepEqual(quote.relay.legs.map((leg) => leg.kind), ["boda", "matatu", "boda"]);
      assert.equal(quote.relay.legs[1].fee, 5000);
      assert.equal(quote.relay.total, quote.relay.legs.reduce((sum, leg) => sum + leg.fee, 0));

      const res = await parcel("list", PICKUP, DOOR);
      assert.equal(res.status, 201);
      const order = ((await res.json()) as { order: { id: string; estimated_total: number; delivery_fee: number } }).order;
      orderId = order.id;
      total = order.estimated_total;
      assert.equal(total, quote.relay.total);
      assert.equal(order.delivery_fee, total);
      const legs = (await client.execute({ sql: "SELECT leg, status FROM order_relay_legs WHERE order_id = ? ORDER BY leg", args: [orderId] })).rows;
      assert.deepEqual(legs.map((l) => [l.leg, l.status]), [[1, "waiting"], [2, "waiting"], [3, "waiting"]]);
      const event = (await client.execute({ sql: "SELECT note FROM order_events WHERE order_id = ? AND note LIKE 'Relay delivery%'", args: [orderId] })).rows[0];
      assert.match(String(event.note), /\(KLA - EBB\)/);
      const view = (await (await call("customer", `orders/${orderId}`)).json()) as { relay: { direction: string; routeCode: string } };
      assert.deepEqual([view.relay.direction, view.relay.routeCode], ["KLA - EBB", "KLA ⇄ EBB"]);
    });

    await t.test("short parcels go on one boda and relays can't be paid in cash", async () => {
      const short = await parcel("short", PICKUP, KAMPALA);
      assert.equal(short.status, 201);
      const shortId = ((await short.json()) as { order: { id: string } }).order.id;
      assert.equal((await client.execute({ sql: "SELECT COUNT(*) AS n FROM order_relay_legs WHERE order_id = ?", args: [shortId] })).rows[0].n, 0);
      assert.equal((await parcel("cash", PICKUP, DOOR, "float")).status, 409);
    });

    let leg1Code = "";
    await t.test("the first rider hands the parcel to the matatu with their code", async () => {
      // Paid from the wallet with merchant payments on: a parcel has no shopping principal and must still fund.
      // (Sandbox, where merchant payments need no custody approval.)
      await client.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('merchant_sandbox_enabled', '1')");
      await client.execute({ sql: "UPDATE users SET wallet_balance_sandbox = ? WHERE id = 'customer'", args: [total] });
      await client.execute({ sql: "UPDATE orders SET rider_id = 'first', stage = 'Match', environment = 'sandbox' WHERE id = ?", args: [orderId] });
      assert.equal((await call("customer", `orders/${orderId}/fund`, { paymentMethod: "wallet", useWallet: true, acceptedAmount: total })).status, 200);
      await client.execute({ sql: "UPDATE orders SET stage = 'Deliver', pin_code = '4321', environment = 'live' WHERE id = ?", args: [orderId] });
      const view = (await (await call("first", `orders/${orderId}`)).json()) as { relay: { legs: { handoffCode?: string }[] } };
      leg1Code = view.relay.legs[0].handoffCode!;
      assert.match(leg1Code, /^\d{6}$/);
      const customerView = (await (await call("customer", `orders/${orderId}`)).json()) as { relay: { legs: { handoffCode?: string }[] } };
      assert.equal(customerView.relay.legs[0].handoffCode, undefined);

      assert.equal((await call("first", `orders/${orderId}/arrived`, {})).status, 409);
      assert.equal((await call("op", "relay/operator/receive", { code: "000000" })).status, 404);
      assert.equal((await call("op", "relay/operator/receive", { code: leg1Code })).status, 200);
      assert.equal((await call("op", "relay/operator/receive", { code: leg1Code })).status, 404);
      const order = (await client.execute({ sql: "SELECT rider_id, stage FROM orders WHERE id = ?", args: [orderId] })).rows[0];
      assert.deepEqual([order.rider_id, order.stage], [null, "Deliver"]);
      assert.ok((await wallet("riders", "first")) > 0, "leg 1 is paid at its handoff");
    });

    await t.test("the last rider claims, collects with the operator's code and delivers", async () => {
      const open = (await (await call("last", "relay/legs/open")).json()) as { legs: { id: string }[] };
      assert.equal(open.legs.length, 1);
      const legId = open.legs[0].id;
      assert.equal((await call("last", `relay/legs/${legId}/claim`, {})).status, 200);
      assert.equal((await call("first", `relay/legs/${legId}/claim`, {})).status, 409);
      assert.equal((await call("last", `orders/${orderId}/arrived`, {})).status, 409);
      assert.equal((await call("customer", `orders/${orderId}/handover`, { pin: "4321" })).status, 409);

      const parcels = (await (await call("op", "relay/operator/parcels")).json()) as { carrying: { id: string; handoff_code: string; direction: string }[] };
      assert.equal(parcels.carrying.length, 1);
      assert.equal(parcels.carrying[0].direction, "KLA - EBB");
      assert.equal((await call("op", `relay/operator/legs/${parcels.carrying[0].id}/arrived`, {})).status, 200);
      assert.equal((await call("last", `relay/legs/${legId}/collect`, { code: "999999" })).status, 400);
      assert.equal((await call("last", `relay/legs/${legId}/collect`, { code: parcels.carrying[0].handoff_code })).status, 200);
      assert.ok((await operatorEarnings()) > 0, "the matatu leg is paid at its handoff");

      assert.equal((await call("last", `orders/${orderId}/arrived`, {})).status, 200);
      assert.equal((await call("customer", `orders/${orderId}/handover`, { pin: "4321" })).status, 200);
      assert.equal((await call("last", `orders/${orderId}/settle`, {})).status, 200);

      const paid = (await wallet("riders", "first")) + (await operatorEarnings()) + (await wallet("riders", "last"));
      assert.equal(paid, total, "the three legs share exactly what one rider would have been paid");
      const legs = (await client.execute({ sql: "SELECT leg, status, paid_amount FROM order_relay_legs WHERE order_id = ? ORDER BY leg", args: [orderId] })).rows;
      assert.deepEqual(legs.map((l) => l.status), ["done", "done", "done"]);
      const view = (await (await call("customer", `orders/${orderId}`)).json()) as { relay: { legs: { handedOverAt: string | null }[] } };
      assert.ok(view.relay.legs.every((leg) => leg.handedOverAt), "every handoff is timestamped");
    });

    // ---- Relay is paid before any rider; Direct waits for one --------------------------------
    let lists = 0;
    const relayParcel = async () => {
      const listId = `pf-${++lists}`;
      await client.execute({ sql: "INSERT INTO lists (id, customer_id, title) VALUES (?, 'customer', 'Pay first')", args: [listId] });
      const res = await parcel(listId, PICKUP, DOOR);
      assert.equal(res.status, 201);
      const order = ((await res.json()) as { order: { id: string; estimated_total: number; stage: string; rider_id: string | null } }).order;
      assert.deepEqual([order.stage, order.rider_id], ["Create", null]);
      return order;
    };
    const orderRow = async (id: string) => {
      const row = (await client.execute({ sql: "SELECT stage, rider_id FROM orders WHERE id = ?", args: [id] })).rows[0];
      return [row.stage, row.rider_id];
    };
    const payWallet = (id: string, amount: number) => call("customer", `orders/${id}/fund`, { paymentMethod: "wallet", useWallet: true, acceptedAmount: amount });
    const claimable = (id: string) => client.execute({ sql: "UPDATE orders SET matching_mode = 'first_to_claim', updated_at = datetime('now', '-1 hour') WHERE id = ?", args: [id] });
    const checkout = async (id: string) => (await (await call("customer", `orders/${id}/checkout`)).json()) as { wallet: number; payBeforeRider: boolean };

    await t.test("relay paid before a rider: the rider is assigned straight into Shop and the legs share what was paid", async () => {
      const order = await relayParcel();
      const quote = await checkout(order.id);
      assert.equal(quote.payBeforeRider, true, "the pay screen offers Pay now");
      await client.execute({ sql: "UPDATE users SET wallet_balance = ? WHERE id = 'customer'", args: [quote.wallet] });
      const paid = await payWallet(order.id, quote.wallet);
      assert.equal(paid.status, 200, await paid.clone().text());
      assert.deepEqual(await orderRow(order.id), ["Match", null], "paid and held in escrow, waiting for a rider");
      assert.equal(await wallet("users", "customer"), 0);
      assert.equal((await payWallet(order.id, quote.wallet)).status, 409, "never paid twice");
      assert.equal((await checkout(order.id)).payBeforeRider, false, "nothing left to pay");
      assert.equal((await call("customer", `orders/${order.id}/customer-delete`, {})).status, 409, "a paid order is cancelled, never just deleted");

      const before = { first: await wallet("riders", "first"), op: await operatorEarnings(), last: await wallet("riders", "last") };
      await claimable(order.id);
      const claim = await call("first", `orders/${order.id}/claim`, {});
      assert.equal(claim.status, 200, await claim.clone().text());
      assert.deepEqual(await orderRow(order.id), ["Shop", "first"], "straight to Shop, no payment wait");
      assert.equal((await client.execute({ sql: "SELECT COUNT(*) AS n FROM payments WHERE order_id = ?", args: [order.id] })).rows[0].n, 1, "one payment only");

      assert.equal((await call("first", `orders/${order.id}/deliver`, {})).status, 200);
      await client.execute({ sql: "UPDATE orders SET pin_code = '2468' WHERE id = ?", args: [order.id] });
      const code = ((await (await call("first", `orders/${order.id}`)).json()) as { relay: { legs: { handoffCode?: string }[] } }).relay.legs[0].handoffCode!;
      assert.equal((await call("op", "relay/operator/receive", { code })).status, 200);
      const carrying = ((await (await call("op", "relay/operator/parcels")).json()) as { carrying: { id: string; order_id: string; handoff_code: string }[] }).carrying.find((p) => p.order_id === order.id)!;
      assert.equal((await call("op", `relay/operator/legs/${carrying.id}/arrived`, {})).status, 200);
      const open = ((await (await call("last", "relay/legs/open")).json()) as { legs: { id: string; order_id: string }[] }).legs.find((l) => l.order_id === order.id)!;
      assert.equal((await call("last", `relay/legs/${open.id}/claim`, {})).status, 200);
      assert.equal((await call("last", `relay/legs/${open.id}/collect`, { code: carrying.handoff_code })).status, 200);
      assert.equal((await call("last", `orders/${order.id}/arrived`, {})).status, 200);
      assert.equal((await call("customer", `orders/${order.id}/handover`, { pin: "2468" })).status, 200);
      assert.equal((await call("last", `orders/${order.id}/settle`, {})).status, 200);
      assert.equal((await orderRow(order.id))[0], "Settle");
      const payouts = (await wallet("riders", "first")) - before.first + (await operatorEarnings()) - before.op + (await wallet("riders", "last")) - before.last;
      assert.equal(payouts, quote.wallet, "the leg payouts sum to what the customer paid");
    });

    await t.test("relay paid and cancelled before any rider is refunded in full", async () => {
      const order = await relayParcel();
      const quote = await checkout(order.id);
      await client.execute({ sql: "UPDATE users SET wallet_balance = ? WHERE id = 'customer'", args: [quote.wallet + 700] });
      assert.equal((await payWallet(order.id, quote.wallet)).status, 200);
      assert.equal(await wallet("users", "customer"), 700);
      const cancel = await call("customer", `orders/${order.id}/customer-cancel`, { acceptedFee: 0 });
      assert.equal(cancel.status, 200, await cancel.clone().text());
      assert.equal((await orderRow(order.id))[0], "Cancelled");
      assert.equal(await wallet("users", "customer"), quote.wallet + 700, "every shilling is back in the wallet");
      const refund = (await client.execute({ sql: "SELECT amount FROM payments WHERE order_id = ? AND type = 'refund' AND status = 'successful'", args: [order.id] })).rows;
      assert.deepEqual(refund.map((r) => Number(r.amount)), [quote.wallet]);
    });

    await t.test("the no-rider expiry sweep refunds a relay paid before any rider", async () => {
      const order = await relayParcel();
      const quote = await checkout(order.id);
      await client.execute({ sql: "UPDATE users SET wallet_balance = ? WHERE id = 'customer'", args: [quote.wallet] });
      assert.equal((await payWallet(order.id, quote.wallet)).status, 200);
      for (const [key, value] of Object.entries({ job_expiry_enabled: "1", job_expiry_value: "30", job_expiry_unit: "minutes" })) {
        await client.execute({ sql: "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", args: [key, value] });
      }
      try {
        await client.execute({ sql: "UPDATE orders SET created_at = datetime('now', '-2 hours') WHERE id = ?", args: [order.id] });
        const { sweepExpiredOrders } = await import("../orders/expiry.js");
        assert.ok((await sweepExpiredOrders()).expired >= 1);
        assert.equal((await orderRow(order.id))[0], "Cancelled");
        assert.equal(await wallet("users", "customer"), quote.wallet, "refunded to the wallet");
      } finally {
        await client.execute("DELETE FROM settings WHERE key LIKE 'job_expiry_%'");
      }
    });

    await t.test("Mobile Money paid before a rider: pending holds the order, success waits in Match, failure returns it", async () => {
      await client.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('payments_demo_mode', '1')");
      try {
        for (const succeeds of [false, true]) {
          const order = await relayParcel();
          const res = await call("customer", `orders/${order.id}/fund`, { paymentMethod: "mobile_money", msisdn: "256772123456" });
          assert.equal(res.status, 200, await res.clone().text());
          const payment = ((await res.json()) as { payment: { id: string; status: string } }).payment;
          assert.equal(payment.status, "pending");
          assert.equal((await orderRow(order.id))[0], "Fund");
          await claimable(order.id);
          assert.notEqual((await call("first", `orders/${order.id}/claim`, {})).status, 200, "no rider while the payment is pending");
          await client.execute({ sql: "UPDATE payments SET provider_ref = ?, created_at = datetime('now', '-1 hour') WHERE id = ?", args: [refWithOutcome(succeeds), payment.id] });
          assert.equal(await reconcilePayment(payment.id, "test"), succeeds ? "successful" : "failed");
          assert.deepEqual(await orderRow(order.id), [succeeds ? "Match" : "Create", null]);
          if (!succeeds) {
            assert.equal((await checkout(order.id)).payBeforeRider, true, "a failed payment can be tried again");
            await client.execute({ sql: "UPDATE orders SET stage = 'Cancelled' WHERE id = ?", args: [order.id] });
            continue;
          }
          await claimable(order.id);
          assert.equal((await call("first", `orders/${order.id}/claim`, {})).status, 200);
          assert.deepEqual(await orderRow(order.id), ["Shop", "first"]);
          await client.execute({ sql: "UPDATE orders SET stage = 'Settle' WHERE id = ?", args: [order.id] });
        }
      } finally {
        await client.execute("DELETE FROM settings WHERE key = 'payments_demo_mode'");
      }
    });

    await t.test("with relay_pay_before_rider off, a relay waits for its rider before payment, as before", async () => {
      const put = await call("staff", "admin/relay/settings", { payBeforeRider: false, directMaxHours: 4 }, "PUT");
      assert.equal(put.status, 200);
      const saved = ((await put.json()) as { settings: { payBeforeRider: boolean; directMaxHours: number } }).settings;
      assert.deepEqual([saved.payBeforeRider, saved.directMaxHours], [false, 4]);
      assert.equal((await call("staff", "admin/relay/settings", { directMaxHours: 0 }, "PUT")).status, 400);
      assert.equal((await call("staff", "admin/relay/settings", { directMaxHours: 2.5 }, "PUT")).status, 400);
      const logged = (await client.execute("SELECT after_json FROM admin_activity_log WHERE action = 'settings.relay' ORDER BY created_at DESC LIMIT 1")).rows[0];
      assert.match(String(logged.after_json), /"payBeforeRider":false/, "the switch is in the activity log");
      try {
        const order = await relayParcel();
        const quote = await checkout(order.id);
        assert.equal(quote.payBeforeRider, false);
        await client.execute({ sql: "UPDATE users SET wallet_balance = ? WHERE id = 'customer'", args: [quote.wallet] });
        const early = await payWallet(order.id, quote.wallet);
        assert.equal(early.status, 409);
        assert.equal(((await early.json()) as { error: string }).error, "invalid_stage", "as before: no payment until a rider has accepted");
        await claimable(order.id);
        assert.equal((await call("first", `orders/${order.id}/claim`, {})).status, 200);
        assert.deepEqual(await orderRow(order.id), ["Match", "first"], "waits for payment");
        assert.equal((await payWallet(order.id, quote.wallet)).status, 200);
        assert.equal((await orderRow(order.id))[0], "Shop");
        await client.execute({ sql: "UPDATE orders SET stage = 'Settle' WHERE id = ?", args: [order.id] });
      } finally {
        assert.equal((await call("staff", "admin/relay/settings", { payBeforeRider: true, directMaxHours: 3 }, "PUT")).status, 200);
      }
    });

    await t.test("before migration 0107: codes come from the stage names and saving codes asks for the migration", async () => {
      await client.execute("ALTER TABLE relay_routes DROP COLUMN stage_a_code");
      await client.execute("ALTER TABLE relay_routes DROP COLUMN stage_b_code");
      resetSchemaCache();
      try {
        const res = await call("staff", `admin/relay/routes/${routeId}`, { stageACode: "KLA" }, "PATCH");
        assert.equal(res.status, 503);
        assert.match(((await res.json()) as { message: string }).message, /0107/);
        assert.equal((await call("staff", `admin/relay/routes/${routeId}`, { parcelFare: 5000 }, "PATCH")).status, 200, "other edits still save");
        assert.equal(((await (await call("staff", "admin/relay/routes")).json()) as { codesReady: boolean }).codesReady, false);
        assert.equal((await quoteFor(PICKUP, DOOR)).relay?.direction, "KAM - ENT");
        assert.equal((await quoteFor(DOOR, PICKUP)).relay?.direction, "ENT - KAM");
      } finally {
        resetSchemaCache();
      }
    });
  } finally {
    process.env.JWT_SECRET = previousSecret;
    client.close();
  }
});
