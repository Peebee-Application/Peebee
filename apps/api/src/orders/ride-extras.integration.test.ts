import assert from "node:assert/strict";
import { allowManyRides } from "../test-support/no-ride-limit.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { setMatchingModesEnabled } from "../lib/settings.js";
import { resetSchemaCache } from "../lib/schema.js";
import { orderRoutes } from "./routes.js";
import { riderRoutes } from "../riders/routes.js";
import { tripRoutes } from "../passengers/trips.js";

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

const pickup = { pickupLat: 0.3136, pickupLng: 32.5811, pickupArea: "Kololo" };
const destination = { destinationLat: 0.3476, destinationLng: 32.6, destinationArea: "Ntinda" };
const stop = { area: "Garden City", lat: 0.33, lng: 32.59 };

test("name your fare + multi-stop rides", async (t) => {
  process.env.JWT_SECRET = "local-ride-extras-test-secret-only";
  resetSchemaCache();
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  await allowManyRides();
  for (const [id, role] of [["cust", "customer"], ["r1", "rider"], ["r2", "rider"]]) {
    await client.execute({ sql: "INSERT INTO users (id, phone, name, password_hash, role) VALUES (?, ?, ?, 'h', ?)", args: [id, id, `${id} Rider`, role] });
  }
  await client.execute("INSERT INTO riders (user_id, verified, is_online, stage_lat, stage_lng) VALUES ('r1', 1, 1, 0.3136, 32.5811), ('r2', 1, 1, 0.3137, 32.5812)");
  for (const id of ["l1", "l2", "l3", "l4"]) await client.execute({ sql: "INSERT INTO lists (id, customer_id, title) VALUES (?, 'cust', 'ride')", args: [id] });
  await setMatchingModesEnabled(["first_to_claim"]);

  const app = new Hono().route("/v1", orderRoutes).route("/v1", riderRoutes);
  // Mounted ahead of the authenticated routers in app.ts, as in production.
  const publicApp = new Hono().route("/v1/trips", tripRoutes);
  const tokens = {
    cust: await signToken({ sub: "cust", role: "customer" }),
    r1: await signToken({ sub: "r1", role: "rider", name: "r1 Rider" } as never),
    r2: await signToken({ sub: "r2", role: "rider" }),
  };
  const call = async (method: string, path: string, who: keyof typeof tokens, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.request(`/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${tokens[who]}`, "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
  };
  const rideBody = (listId: string, extra: Record<string, unknown> = {}) => ({ listId, type: "parcel", isRide: true, ...pickup, ...destination, ...extra });

  let quoteWithStop = 0;
  let quoteDirect = 0;
  await t.test("quote includes the route through stops plus the per-stop fee, and the offer band", async () => {
    const q = (s = "") => `/rides/quote?pickupLat=${pickup.pickupLat}&pickupLng=${pickup.pickupLng}&destinationLat=${destination.destinationLat}&destinationLng=${destination.destinationLng}${s}`;
    const direct = await call("GET", q(), "cust");
    assert.equal(direct.status, 200);
    quoteDirect = direct.body.quote;
    assert.equal(direct.body.stopFees, 0);
    assert.equal(direct.body.maxStops, 3);
    const via = await call("GET", q(`&stops=${stop.lat},${stop.lng}`), "cust");
    assert.equal(via.status, 200);
    quoteWithStop = via.body.quote;
    assert.equal(via.body.stopFees, 1000);
    assert.equal(via.body.quote, via.body.base + 1000);
    assert.ok(via.body.quote >= quoteDirect + 1000);
    assert.ok(via.body.offers.min < via.body.quote && via.body.offers.max > via.body.quote);
    assert.equal((await call("GET", q(`&stops=1,2;1,2;1,2;1,2`), "cust")).status, 400, "max 3 stops");
  });

  await t.test("a single-destination ride is unchanged", async () => {
    const res = await call("POST", "/orders", "cust", rideBody("l1"));
    assert.equal(res.status, 201);
    assert.equal(res.body.order.estimated_total, quoteDirect);
    assert.equal(res.body.order.fare_offer, null);
    assert.equal(res.body.order.stop_count, 0);
    await client.execute("UPDATE orders SET stage = 'Cancelled' WHERE list_id = 'l1'");
  });

  await t.test("offers outside the band and invalid stops are refused", async () => {
    assert.equal((await call("POST", "/orders", "cust", rideBody("l2", { fareOffer: 500 }))).status, 400);
    assert.equal((await call("POST", "/orders", "cust", rideBody("l2", { stops: [{ lat: pickup.pickupLat, lng: pickup.pickupLng }] }))).status, 400);
    assert.equal((await call("POST", "/orders", "cust", { listId: "l2", type: "shopping", stops: [stop] })).status, 400);
  });

  let orderId = "";
  let offer = 0;
  await t.test("a multi-stop ride with an offer is priced on the multi-stop quote", async () => {
    offer = Math.ceil((quoteWithStop * 0.8) / 500) * 500;
    const res = await call("POST", "/orders", "cust", rideBody("l2", { stops: [stop], fareOffer: offer }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    orderId = res.body.order.id;
    assert.equal(res.body.order.fare_offer, offer);
    assert.equal(res.body.order.fare_offer_quote, quoteWithStop);
    assert.equal(res.body.order.estimated_total, offer);
    assert.equal(res.body.order.delivery_fee, offer);
    assert.equal(res.body.order.stop_count, 1);
    const stops = await call("GET", `/orders/${orderId}/stops`, "cust");
    assert.equal(stops.body.stops.length, 1);
    assert.equal(stops.body.stops[0].area, "Garden City");
  });

  await t.test("riders see the offer and stop count on the job card", async () => {
    const res = await call("GET", "/riders/jobs/available", "r1");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const job = res.body.jobs.find((j: { id: string }) => j.id === orderId);
    assert.ok(job, "job visible");
    assert.equal(job.stop_count, 1);
    assert.equal(job.fareOffer.amount, offer);
    assert.equal(job.fareOffer.quote, quoteWithStop);
    assert.equal(job.fareOffer.myCounter, null);
    assert.equal(job.bidding, null);
  });

  let counterId = "";
  await t.test("riders counter within the band, idempotently; counters at/below the offer are refused", async () => {
    assert.equal((await call("POST", `/orders/${orderId}/fare-counters`, "r1", { amount: offer })).status, 400);
    assert.equal((await call("POST", `/orders/${orderId}/fare-counters`, "cust", { amount: offer + 1000 })).status, 403);
    const first = await call("POST", `/orders/${orderId}/fare-counters`, "r1", { amount: offer + 1000 }, { "Idempotency-Key": "k1" });
    assert.equal(first.status, 201);
    const replay = await call("POST", `/orders/${orderId}/fare-counters`, "r1", { amount: offer + 1000 }, { "Idempotency-Key": "k1" });
    assert.equal(replay.status, 201);
    assert.equal(replay.body.counter.id, first.body.counter.id);
    await call("POST", `/orders/${orderId}/fare-counters`, "r2", { amount: offer + 2000 });
    const list = await call("GET", `/orders/${orderId}/fare-counters`, "cust");
    assert.equal(list.body.counters.length, 2);
    assert.equal(list.body.counters[0].amount, offer + 1000, "cheapest first");
    counterId = list.body.counters[0].id;
    const active = await call("GET", "/orders/active", "cust");
    assert.equal(active.body.pendingFeeProposal, null, "counters aren't shown as fee proposals");
    assert.equal(active.body.fareCounters.length, 2);
    assert.equal(active.body.rideStops.length, 1);
    const feed = await call("GET", "/riders/jobs/available", "r1");
    assert.equal(feed.body.jobs.find((j: { id: string }) => j.id === orderId).fareOffer.myCounter.amount, offer + 1000);
  });

  await t.test("customer raises the offer; counters at or below it close", async () => {
    assert.equal((await call("POST", `/orders/${orderId}/fare-offer`, "cust", { amount: offer - 500 })).status, 400, "can't lower");
    const raised = await call("POST", `/orders/${orderId}/fare-offer`, "cust", { amount: offer + 1000 }, { "Idempotency-Key": "raise-1" });
    assert.equal(raised.status, 200, JSON.stringify(raised.body));
    assert.equal(raised.body.order.estimated_total, offer + 1000);
    assert.equal(raised.body.fareOffer.raises, 1);
    assert.equal(raised.body.fareCounters.length, 1, "r1's counter at the new offer is superseded");
    counterId = raised.body.fareCounters[0].id;
    const again = await call("POST", `/orders/${orderId}/fare-offer`, "cust", { amount: offer + 1000 }, { "Idempotency-Key": "raise-1" });
    assert.equal(again.status, 200);
    assert.equal(again.body.fareOffer.raises, 1, "replayed, not raised twice");
  });

  await t.test("an expired counter can't be accepted", async () => {
    await client.execute({ sql: "UPDATE fee_proposals SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?", args: [counterId] });
    const res = await call("POST", `/orders/${orderId}/fee-proposals/${counterId}/decision`, "cust", { approve: true });
    assert.equal(res.status, 410);
    const fresh = await call("POST", `/orders/${orderId}/fare-counters`, "r2", { amount: offer + 2000 });
    counterId = fresh.body.counter.id;
  });

  await t.test("accepting a counter assigns that rider at the agreed fare (what escrow will charge)", async () => {
    const res = await call("POST", `/orders/${orderId}/fee-proposals/${counterId}/decision`, "cust", { approve: true });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.order.rider_id, "r2");
    assert.equal(res.body.order.stage, "Match");
    assert.equal(res.body.order.estimated_total, offer + 2000);
    assert.equal(res.body.order.delivery_fee, offer + 2000);
    assert.equal(res.body.order.fare_offer, offer + 2000);
    assert.equal((await call("POST", `/orders/${orderId}/fare-offer`, "cust", { amount: offer + 3000 })).status, 409, "no raising after a match");
  });

  await t.test("the rider works through stops in order, only once the passenger is aboard", async () => {
    assert.equal((await call("POST", `/orders/${orderId}/stops/1/arrived`, "r2")).status, 409, "not picked up yet");
    await client.execute({ sql: "UPDATE orders SET stage = 'PickedUp', share_token = 'tok-0123456789abcdef0123456789' WHERE id = ?", args: [orderId] });
    assert.equal((await call("POST", `/orders/${orderId}/stops/1/arrived`, "r1")).status, 403, "only the assigned rider");
    assert.equal((await call("POST", `/orders/${orderId}/stops/1/continue`, "r2")).status, 409, "arrive first");
    const arrived = await call("POST", `/orders/${orderId}/stops/1/arrived`, "r2");
    assert.equal(arrived.status, 200);
    assert.equal(arrived.body.stops[0].status, "arrived");
    const shared = await publicApp.request(`/v1/trips/tok-0123456789abcdef0123456789`);
    assert.equal(shared.status, 200);
    const trip = ((await shared.json()) as { trip: { stops: Array<{ status: string; area: string }> } }).trip;
    assert.equal(trip.stops[0].area, "Garden City");
    assert.equal(trip.stops[0].status, "arrived");
    const done = await call("POST", `/orders/${orderId}/stops/1/continue`, "r2");
    assert.equal(done.body.stops[0].status, "done");
    assert.equal((await call("POST", `/orders/${orderId}/stops/1/arrived`, "r2")).status, 409, "all stops done");
    const detail = await call("GET", `/orders/${orderId}`, "r2");
    assert.equal(detail.body.rideStops.length, 1);
    assert.ok(detail.body.events.some((e: { note: string }) => e.note.startsWith("Arrived at stop 1")));
  });

  await t.test("nobody is auto-assigned to a fare offer they didn't accept", async () => {
    const res = await call("POST", "/orders", "cust", rideBody("l3", { fareOffer: Math.ceil((quoteDirect * 0.8) / 500) * 500 }));
    assert.equal(res.status, 201);
    const matched = await call("POST", `/orders/${res.body.order.id}/match`, "cust");
    assert.notEqual(matched.body.order?.rider_id ?? null, "r1");
  });
});
