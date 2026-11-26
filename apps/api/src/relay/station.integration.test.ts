import assert from "node:assert/strict";
import { turnOffIncentives } from "../test-support/no-incentives.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { orderRoutes } from "../orders/routes.js";
import { relayRoutes } from "./routes.js";
import { relayStationRoutes } from "./station-routes.js";
import { signGasToken } from "../gas/auth.js";

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
const STATION = { lat: 0.058, lng: 32.468 };

test("relay to a petrol station: collect in person, door delivery, or send a rider later", async (t) => {
  const client = createClient({ url: "file::memory:" });
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "relay-station-tests-only";
  for (const file of readdirSync(join(process.cwd(), "src/db/migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(process.cwd(), "src/db/migrations", file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  await turnOffIncentives();
  try {
    for (const [id, role] of [["customer", "customer"], ["first", "rider"], ["last", "rider"], ["op", "customer"], ["staff", "admin"], ["stranger", "customer"]]) {
      await client.execute({ sql: "INSERT INTO users (id, phone, name, password_hash, role, wallet_balance) VALUES (?, ?, ?, 'hash', ?, 0)", args: [id, id, id, role] });
    }
    await client.execute("INSERT INTO personal_wallets (user_id) VALUES ('customer')");
    await client.execute("UPDATE users SET admin_role = 'super_admin' WHERE id = 'staff'");
    await client.execute({ sql: "INSERT INTO riders (user_id, verified, is_online, stage_lat, stage_lng) VALUES ('first', 1, 1, ?, ?), ('last', 1, 1, ?, ?)", args: [PICKUP.lat, PICKUP.lng, STATION.lat, STATION.lng] });
    for (const [key, value] of Object.entries({ delivery_rate_per_km: "2000", minimum_delivery_fee: "2000", relay_enabled: "1", relay_last_mile_choice: "order" })) {
      await client.execute({ sql: "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", args: [key, value] });
    }
    await client.execute("INSERT INTO fuel_stations (id, brand_name, company_name) VALUES ('st', 'Shell', 'Shell Uganda')");
    await client.execute({ sql: "INSERT INTO fuel_station_outlets (id, station_id, name, code, lat, lng, relay_drop) VALUES ('out', 'st', 'Kitoro', 'KIT1', ?, ?, 1)", args: [STATION.lat, STATION.lng] });
    await client.execute("INSERT INTO fuel_pump_attendants (id, outlet_id, attendant_code, full_name, phone) VALUES ('att', 'out', 'A1', 'Pump Attendant', '0700')");

    // Same order as app.ts: the gas routes come before the order routes' catch-all sign-in.
    const app = new Hono().route("/v1/gas", relayStationRoutes).route("/v1", orderRoutes).route("/v1", relayRoutes);
    const tokens: Record<string, string> = Object.fromEntries(await Promise.all(
      [["customer", "customer"], ["first", "rider"], ["last", "rider"], ["op", "customer"], ["staff", "admin"], ["stranger", "customer"]].map(async ([sub, role]) => [sub, await signToken({ sub, role } as never)] as const),
    ));
    tokens.att = await signGasToken({ kind: "attendant", id: "att", outletId: "out" });
    const call = (who: string, path: string, body?: object, method?: string) => app.request(`/v1/${path}`, {
      method: method ?? (body ? "POST" : "GET"),
      headers: { Authorization: `Bearer ${tokens[who]}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = async <T>(res: Response | Promise<Response>) => (await (await res).json()) as T;
    const wallet = async (table: string, id: string) => Number((await client.execute({ sql: `SELECT wallet_balance FROM ${table} WHERE ${table === "riders" ? "user_id" : "id"} = ?`, args: [id] })).rows[0].wallet_balance);
    const operatorEarnings = async () => Number((await client.execute("SELECT COALESCE(SUM(balance),0) AS b FROM provider_wallets WHERE provider_type='relay' AND provider_id='op' AND environment='live'")).rows[0].b);

    const route = await call("staff", "admin/relay/routes", {
      name: "Kampala - Entebbe", stageAName: "Kampala taxi park", stageALat: KAMPALA.lat, stageALng: KAMPALA.lng,
      stageBName: "Entebbe stage", stageBLat: ENTEBBE.lat, stageBLng: ENTEBBE.lng, parcelFare: 5000, dropMode: "station",
    });
    assert.equal(route.status, 201);
    const routeId = (await json<{ id: string }>(route)).id;
    // A station serves a route only once it is one of the route's stages.
    const quoteDrop = async () => (await json<{ relay: { dropMode: string } }>(
      call("customer", `relay/quote?pickupLat=${PICKUP.lat}&pickupLng=${PICKUP.lng}&destinationLat=${DOOR.lat}&destinationLng=${DOOR.lng}`))).relay.dropMode;
    assert.equal(await quoteDrop(), "stage", "a station not on the route is not used");
    assert.equal((await call("staff", `admin/relay/routes/${routeId}/stages`, { outletId: "out", seq: 2 })).status, 201, "a petrol station can be a stage");
    assert.equal(await quoteDrop(), "station");
    await call("op", "relay/operator/apply", { routeId, vehiclePlate: "UAZ 123K" });
    await call("staff", "admin/relay/operators/op/status", { status: "approved" });

    let n = 0;
    /** Places a parcel, pays it, and runs it to the station. */
    const toStation = async (lastMile: "door" | "collect") => {
      const listId = `list${++n}`;
      await client.execute({ sql: "INSERT INTO lists (id, customer_id, title) VALUES (?, 'customer', 'Parcel')", args: [listId] });
      const created = await json<{ order: { id: string; estimated_total: number } }>(call("customer", "orders", {
        listId, type: "parcel", paymentRail: "escrow", relayLastMile: lastMile,
        pickupArea: "Nakasero", pickupLat: PICKUP.lat, pickupLng: PICKUP.lng, destinationArea: "Entebbe", destinationLat: DOOR.lat, destinationLng: DOOR.lng,
      }));
      const id = created.order.id;
      await client.execute({ sql: "UPDATE orders SET rider_id = 'first', stage = 'Deliver', pin_code = '4321' WHERE id = ?", args: [id] });
      await client.execute({ sql: "INSERT INTO payments (id, order_id, type, provider, amount, currency, status) VALUES (?, ?, 'collection', 'wallet', ?, 'UGX', 'successful')", args: [`pay-${id}`, id, created.order.estimated_total] });
      const code1 = (await json<{ relay: { legs: { handoffCode?: string }[] } }>(call("first", `orders/${id}`))).relay.legs[0].handoffCode!;
      assert.equal((await call("op", "relay/operator/receive", { code: code1 })).status, 200);
      const openBefore = await json<{ legs: { order_id: string }[] }>(call("last", "relay/legs/open"));
      assert.ok(!openBefore.legs.some((leg) => leg.order_id === id), "no rider is called before the station has it");
      const parcelsRes = await call("att", "gas/relay/parcels");
      const incoming = (await parcelsRes.json()) as { incoming: { order_id: string }[] };
      assert.ok(incoming.incoming.some((p) => p.order_id === id));
      const carrying = (await json<{ carrying: { order_id: string; handoff_code: string }[] }>(call("op", "relay/operator/parcels"))).carrying.find((p) => p.order_id === id)!;
      assert.equal((await call("att", "gas/relay/receive", { code: "000000" })).status, 404);
      assert.equal((await call("att", "gas/relay/receive", { code: carrying.handoff_code })).status, 200);
      return { id, total: created.order.estimated_total };
    };

    await t.test("quote offers door delivery or collection at the station nearest the customer", async () => {
      const quote = await json<{ relay: { dropMode: string; station: { name: string }; total: number; collectTotal: number; choiceAtOrder: boolean; legs: { fee: number }[] } }>(
        call("customer", `relay/quote?pickupLat=${PICKUP.lat}&pickupLng=${PICKUP.lng}&destinationLat=${DOOR.lat}&destinationLng=${DOOR.lng}`));
      assert.equal(quote.relay.dropMode, "station");
      assert.equal(quote.relay.station.name, "Shell Kitoro");
      assert.equal(quote.relay.collectTotal, quote.relay.legs[0].fee + quote.relay.legs[1].fee);
      assert.equal(quote.relay.total, quote.relay.collectTotal + quote.relay.legs[2].fee);
      assert.equal(quote.relay.choiceAtOrder, true);
      // Dropping at a station that is a stop: its place in the stop order gives the direction.
      assert.equal((await call("staff", `admin/relay/routes/${routeId}`, { stageACode: "KLA", stageBCode: "EBB" }, "PATCH")).status, 200);
      const coded = await json<{ relay: { direction: string; routeCode: string } }>(
        call("customer", `relay/quote?pickupLat=${PICKUP.lat}&pickupLng=${PICKUP.lng}&destinationLat=${DOOR.lat}&destinationLng=${DOOR.lng}`));
      assert.deepEqual([coded.relay.direction, coded.relay.routeCode], ["KLA - EBB", "KLA ⇄ EBB"]);
    });

    await t.test("a sandbox-only station takes parcels in sandbox but not live", async () => {
      const quote = () => json<{ relay: { dropMode: string } }>(
        call("customer", `relay/quote?pickupLat=${PICKUP.lat}&pickupLng=${PICKUP.lng}&destinationLat=${DOOR.lat}&destinationLng=${DOOR.lng}`));
      assert.equal((await call("staff", "admin/relay/stations/out", { mode: "sandbox" })).status, 200);
      assert.equal((await client.execute("SELECT relay_drop FROM fuel_station_outlets WHERE id = 'out'")).rows[0].relay_drop, 2);
      assert.equal((await quote()).relay.dropMode, "stage", "live orders don't use a trial station");
      await client.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('platform_environment', 'sandbox')");
      assert.equal((await quote()).relay.dropMode, "station");
      await client.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('platform_environment', 'live')");
      assert.equal((await call("staff", "admin/relay/stations/out", { relayDrop: true })).status, 200, "older admin builds still work");
      assert.equal((await quote()).relay.dropMode, "station");
    });

    await t.test("collect in person: the attendant enters the customer's code and the order is done", async () => {
      const { id, total } = await toStation("collect");
      const view = await json<{ relay: { collectCode: string; sendRiderFee: number; heldAt: string } }>(call("customer", `orders/${id}`));
      assert.ok(view.relay.heldAt);
      assert.match(view.relay.collectCode, /^\d{6}$/);
      assert.equal((await call("att", "gas/relay/release", { code: "000000" })).status, 404);
      assert.equal((await call("att", "gas/relay/release", { code: view.relay.collectCode })).status, 200);
      assert.equal((await client.execute({ sql: "SELECT stage FROM orders WHERE id = ?", args: [id] })).rows[0].stage, "Settle");
      assert.equal((await wallet("riders", "first")) + (await operatorEarnings()), total, "the rider and matatu share exactly what was paid");
      // Everyone involved can follow it; nobody else can.
      assert.equal((await call("op", `relay/orders/${id}/track`)).status, 200);
      assert.equal((await call("stranger", `relay/orders/${id}/track`)).status, 403);
    });

    await t.test("door delivery: the station has the rider called, the rider takes it with the station's code", async () => {
      const before = (await wallet("riders", "first")) + (await operatorEarnings());
      const { id, total } = await toStation("door");
      const open = await json<{ legs: { id: string; order_id: string }[] }>(call("last", "relay/legs/open"));
      const leg = open.legs.find((l) => l.order_id === id)!;
      assert.ok(leg, "riders near the station are called as soon as it arrives");
      assert.equal((await call("last", `relay/legs/${leg.id}/claim`, {})).status, 200);
      const held = (await json<{ held: { order_id: string; release_code: string | null }[] }>(call("att", "gas/relay/parcels"))).held.find((p) => p.order_id === id)!;
      assert.match(String(held.release_code), /^\d{6}$/);
      assert.equal((await call("last", `relay/legs/${leg.id}/collect`, { code: "999999" })).status, 400);
      assert.equal((await call("last", `relay/legs/${leg.id}/collect`, { code: held.release_code })).status, 200);
      assert.equal((await call("last", `orders/${id}/arrived`, {})).status, 200);
      assert.equal((await call("customer", `orders/${id}/handover`, { pin: "4321" })).status, 200);
      assert.equal((await call("last", `orders/${id}/settle`, {})).status, 200);
      const after = (await wallet("riders", "first")) + (await operatorEarnings()) + (await wallet("riders", "last"));
      assert.equal(after - before, total);
    });

    await t.test("send a rider later: the customer pays the last leg from their wallet", async () => {
      const { id, total } = await toStation("collect");
      const fee = (await json<{ relay: { sendRiderFee: number } }>(call("customer", `orders/${id}`))).relay.sendRiderFee;
      assert.equal((await call("customer", `relay/orders/${id}/send-rider`, {})).status, 409, "needs wallet money");
      await client.execute({ sql: "UPDATE users SET wallet_balance = ? WHERE id = 'customer'", args: [fee] });
      assert.equal((await call("customer", `relay/orders/${id}/send-rider`, {})).status, 200);
      assert.equal(await wallet("users", "customer"), 0);
      const order = (await client.execute({ sql: "SELECT estimated_total FROM orders WHERE id = ?", args: [id] })).rows[0];
      assert.equal(Number(order.estimated_total), total + fee);
      const open = await json<{ legs: { order_id: string }[] }>(call("last", "relay/legs/open"));
      assert.ok(open.legs.some((l) => l.order_id === id), "a rider is called once they pay");
    });
    await t.test("admin can make the customer choose once it arrives: they pay to the station first", async () => {
      await client.execute("UPDATE settings SET value = 'arrival' WHERE key = 'relay_last_mile_choice'");
      const quote = await json<{ relay: { collectTotal: number; choiceAtOrder: boolean } }>(
        call("customer", `relay/quote?pickupLat=${PICKUP.lat}&pickupLng=${PICKUP.lng}&destinationLat=${DOOR.lat}&destinationLng=${DOOR.lng}`));
      assert.equal(quote.relay.choiceAtOrder, false);
      const { id, total } = await toStation("door");
      assert.equal(total, quote.relay.collectTotal, "door can't be bought up front in this mode");
      const view = await json<{ relay: { lastMile: string; collectCode: string; sendRiderFee: number } }>(call("customer", `orders/${id}`));
      assert.equal(view.relay.lastMile, "pending");
      assert.ok(view.relay.collectCode && view.relay.sendRiderFee > 0, "they can collect or send a rider");
      await client.execute("UPDATE settings SET value = 'order' WHERE key = 'relay_last_mile_choice'");
    });
    // Meeting the matatu at a stage on its route.
    const ABAYITA = { lat: 0.07, lng: 32.48 };
    let stageId = "";
    const toMatatu = async (meetStageId: string) => {
      const listId = `list${++n}`;
      await client.execute({ sql: "INSERT INTO lists (id, customer_id, title) VALUES (?, 'customer', 'Parcel')", args: [listId] });
      const created = await json<{ order: { id: string; estimated_total: number } }>(call("customer", "orders", {
        listId, type: "parcel", paymentRail: "escrow", relayLastMile: "meet", relayMeetStageId: meetStageId,
        pickupArea: "Nakasero", pickupLat: PICKUP.lat, pickupLng: PICKUP.lng, destinationArea: "Entebbe", destinationLat: DOOR.lat, destinationLng: DOOR.lng,
      }));
      const id = created.order.id;
      await client.execute({ sql: "UPDATE orders SET rider_id = 'first', stage = 'Deliver' WHERE id = ?", args: [id] });
      await client.execute({ sql: "INSERT INTO payments (id, order_id, type, provider, amount, currency, status) VALUES (?, ?, 'collection', 'wallet', ?, 'UGX', 'successful')", args: [`pay-${id}`, id, created.order.estimated_total] });
      const code1 = (await json<{ relay: { legs: { handoffCode?: string }[] } }>(call("first", `orders/${id}`))).relay.legs[0].handoffCode!;
      assert.equal((await call("op", "relay/operator/receive", { code: code1 })).status, 200);
      return { id, total: created.order.estimated_total };
    };

    await t.test("admin defines stages; the customer can choose to meet the matatu at one", async () => {
      assert.equal((await call("staff", `admin/relay/routes/${routeId}/stages`, { name: "Abayita Ababiri", seq: 1, lat: ABAYITA.lat, lng: ABAYITA.lng })).status, 201);
      // The station became a stage when it joined the route (above).
      const stages = await json<{ stages: { id: string; name: string }[] }>(call("staff", `admin/relay/routes/${routeId}/stages`));
      assert.deepEqual(stages.stages.map((stage) => stage.name), ["Abayita Ababiri", "Shell Kitoro"]);
      stageId = stages.stages[0].id;
      const off = await json<{ relay: { meetStages: unknown[] } }>(call("customer", `relay/quote?pickupLat=${PICKUP.lat}&pickupLng=${PICKUP.lng}&destinationLat=${DOOR.lat}&destinationLng=${DOOR.lng}`));
      assert.equal(off.relay.meetStages.length, 0, "off until admin allows it");
      await client.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('relay_stage_pickup', '1')");
      const on = await json<{ relay: { meetStages: { id: string; isStation: boolean }[]; collectTotal: number } }>(call("customer", `relay/quote?pickupLat=${PICKUP.lat}&pickupLng=${PICKUP.lng}&destinationLat=${DOOR.lat}&destinationLng=${DOOR.lng}`));
      assert.ok(on.relay.meetStages.some((stage) => stage.id === stageId));
      assert.ok(on.relay.meetStages.some((stage) => stage.isStation));
    });

    await t.test("the matatu hands the parcel to the customer at their stage, with their code", async () => {
      const before = (await wallet("riders", "first")) + (await operatorEarnings());
      const { id, total } = await toMatatu(stageId);
      const carrying = (await json<{ carrying: { id: string; order_id: string; meet_stage_name: string | null; to_name: string }[] }>(call("op", "relay/operator/parcels"))).carrying.find((p) => p.order_id === id)!;
      assert.equal(carrying.meet_stage_name, "Abayita Ababiri");
      assert.equal((carrying as unknown as { customer_id: string }).customer_id, "customer", "the conductor can call the customer in the app");
      assert.equal(carrying.to_name, "Abayita Ababiri");
      // The matatu is a few minutes away: the customer is told once.
      assert.equal((await call("op", `relay/operator/legs/${carrying.id}/location`, { lat: 0.075, lng: 32.485 })).status, 200);
      assert.ok((await client.execute({ sql: "SELECT soon_notified_at FROM order_relay WHERE order_id = ?", args: [id] })).rows[0].soon_notified_at);
      const view = await json<{ relay: { collectCode: string; etaMinutes: number | null; meetStage: { name: string } } }>(call("customer", `orders/${id}`));
      assert.equal(view.relay.meetStage.name, "Abayita Ababiri");
      assert.ok(view.relay.etaMinutes != null && view.relay.etaMinutes <= 10);
      // The station can't take a parcel the customer is meeting.
      const leg2 = (await client.execute({ sql: "SELECT handoff_code FROM order_relay_legs WHERE order_id = ? AND leg = 2", args: [id] })).rows[0];
      assert.equal((await call("att", "gas/relay/receive", { code: String(leg2.handoff_code) })).status, 409);
      assert.equal((await call("op", "relay/operator/handover", { code: "000000" })).status, 404);
      assert.equal((await call("op", "relay/operator/handover", { code: view.relay.collectCode })).status, 200);
      assert.equal((await client.execute({ sql: "SELECT stage FROM orders WHERE id = ?", args: [id] })).rows[0].stage, "Settle");
      assert.equal((await wallet("riders", "first")) + (await operatorEarnings()) - before, total);
    });

    await t.test("a customer who misses the matatu gets the parcel at the petrol station instead", async () => {
      const { id } = await toMatatu(stageId);
      const carrying = (await json<{ carrying: { id: string; order_id: string; handoff_code: string }[] }>(call("op", "relay/operator/parcels"))).carrying.find((p) => p.order_id === id)!;
      await client.execute("UPDATE settings SET value = '0' WHERE key = 'relay_stage_fallback'").then(async (r) => {
        if (!r.rowsAffected) await client.execute("INSERT INTO settings (key, value) VALUES ('relay_stage_fallback', '0')");
      });
      assert.equal((await call("op", `relay/operator/legs/${carrying.id}/missed`, {})).status, 409, "only when admin allows the fallback");
      await client.execute("UPDATE settings SET value = '1' WHERE key = 'relay_stage_fallback'");
      assert.equal((await call("op", `relay/operator/legs/${carrying.id}/missed`, {})).status, 200);
      const after = (await json<{ carrying: { order_id: string; to_name: string }[] }>(call("op", "relay/operator/parcels"))).carrying.find((p) => p.order_id === id)!;
      assert.equal(after.to_name, "Shell Kitoro");
      assert.equal((await call("att", "gas/relay/receive", { code: carrying.handoff_code })).status, 200);
      const view = await json<{ relay: { collectCode: string; missedAt: string } }>(call("customer", `orders/${id}`));
      assert.ok(view.relay.missedAt);
      assert.equal((await call("att", "gas/relay/release", { code: view.relay.collectCode })).status, 200);
    });
  } finally {
    process.env.JWT_SECRET = previousSecret;
    client.close();
  }
});
