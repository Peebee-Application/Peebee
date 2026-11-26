import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { resetSchemaCache } from "../lib/schema.js";
import { setSetting } from "../lib/settings.js";
import { DEFAULT_RIDE_TRACKING_SETTINGS } from "@peebee/shared";
import { orderRoutes } from "../orders/routes.js";
import { relayRoutes } from "../relay/routes.js";
import { releaseStaleBookings } from "./bookings.js";
import { publicTaxipressRoutes, taxipressRoutes } from "./routes.js";

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

type Booking = {
  id: string; orderId: string; status: string; seats: number; amount: number; farePerSeat: number; paymentMethod: string; paymentStatus: string;
  ticketCode: string | null; payBy: string | null;
  route: { fromName: string; toName: string; directionLabel: string }; taxi: { queueId: string; plate: string; position: number | null; seatsLeft: number; driverName: string | null };
};

test("taxipress: passengers book seats", async (t) => {
  const client = createClient({ url: "file::memory:" });
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "taxipress-booking-tests-only";
  for (const file of readdirSync(join(process.cwd(), "src/db/migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(process.cwd(), "src/db/migrations", file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  resetSchemaCache();
  try {
    const people = [["staff", "admin"], ["d1", "customer"], ["d2", "customer"], ["a", "customer"], ["b", "customer"], ["c", "customer"]];
    for (const [id, role] of people) {
      await client.execute({ sql: "INSERT INTO users (id, phone, name, password_hash, role) VALUES (?, ?, ?, 'hash', ?)", args: [id, id, id, role] });
    }
    await client.execute("INSERT INTO personal_wallets (user_id) VALUES ('a'), ('b'), ('c')");
    await client.execute("UPDATE users SET admin_role = 'super_admin' WHERE id = 'staff'");

    const app = new Hono().route("/v1", publicTaxipressRoutes).route("/v1", orderRoutes).route("/v1", relayRoutes).route("/v1", taxipressRoutes);
    const tokens = Object.fromEntries(await Promise.all(people.map(async ([sub, role]) => [sub, await signToken({ sub, role } as never)] as const)));
    const call = (who: string, path: string, body?: object, method?: string) => app.request(`/v1/${path}`, {
      method: method ?? (body ? "POST" : "GET"),
      headers: { Authorization: `Bearer ${tokens[who]}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = async <T = Record<string, unknown>>(res: Response) => (await res.json()) as T;
    const code = async (res: Response) => (await json<{ error?: string }>(res)).error;
    const setting = (body: object) => call("staff", "admin/taxipress/settings", body, "PUT");

    const relay = await json<{ id: string }>(await call("staff", "admin/relay/routes", {
      name: "Kampala - Entebbe", stageAName: "Kampala Stage", stageALat: KAMPALA.lat, stageALng: KAMPALA.lng,
      stageBName: "Entebbe Stage", stageBLat: ENTEBBE.lat, stageBLng: ENTEBBE.lng, parcelFare: 5000,
    }));
    const route = await json<{ id: string }>(await call("staff", "admin/taxipress/routes", { relayRouteId: relay.id, direction: "a_to_b", farePerSeat: 5000, active: true }));
    assert.equal((await setting({ enabled: true })).status, 200);

    // Two approved taxis in the line: a 14-seater first, an 18-seater behind it.
    for (const [who, plate, layout] of [["d1", "uaz 111a", "14"], ["d2", "ubb 222b", "18"]]) {
      assert.equal((await call(who, "taxipress/taxi/apply", { relayRouteId: relay.id, plate, seatLayout: layout })).status, 201);
    }
    const taxis = await json<{ taxis: Array<{ id: string }> }>(await call("staff", "admin/taxipress/taxis"));
    for (const taxi of taxis.taxis) assert.equal((await call("staff", `admin/taxipress/taxis/${taxi.id}`, { status: "approved" })).status, 200);
    assert.equal((await call("d1", "taxipress/driver/join", { routeId: route.id, ...KAMPALA })).status, 201);
    await client.execute("UPDATE taxipress_queue SET joined_at = datetime('now', '-5 minutes') WHERE driver_id = 'd1'");
    assert.equal((await call("d2", "taxipress/driver/join", { routeId: route.id, ...KAMPALA })).status, 201);
    const line = await json<{ line: Array<{ id: string; plate: string }>; route: { farePerSeat: number; fromName: string } }>(await call("a", `taxipress/routes/${route.id}/queue`));
    const [van1, van2] = line.line;
    await t.test('anyone may browse current routes and aggregate availability, but cannot book anonymously', async () => {
      const configResponse = await app.request('/v1/taxipress-public/config');
      assert.equal(configResponse.status, 200);
      assert.equal((await json<{ enabled: boolean }>(configResponse)).enabled, true);
      const response = await app.request(`/v1/taxipress-public/routes/${route.id}/queue`);
      assert.equal(response.status, 200);
      const available = await json<{ line: Record<string, unknown>[] }>(response);
      assert.equal(available.line.length, 2);
      assert.ok(available.line.some(v => v.id === van1.id));
      for (const entry of available.line) {
        for (const privateField of ['driverId', 'taxiId', 'last_lat', 'last_lng', 'lastLat', 'lastLng', 'driverPhone', 'bookings', 'ticketCode']) assert.equal(privateField in entry, false);
      }
      assert.equal((await app.request(`/v1/taxipress-public/taxis/${van1.id}/profile`)).status, 200);
      await client.execute({ sql: 'UPDATE taxipress_routes SET active = 0 WHERE id = ?', args: [route.id] });
      assert.deepEqual((await json<{ line: unknown[] }>(await app.request(`/v1/taxipress-public/routes/${route.id}/queue`))).line, []);
      assert.equal((await app.request(`/v1/taxipress-public/taxis/${van1.id}/profile`)).status, 404);
      await client.execute({ sql: 'UPDATE taxipress_routes SET active = 1 WHERE id = ?', args: [route.id] });
      assert.equal((await app.request('/v1/taxipress/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queueId: van1.id, adults: 1 }) })).status, 401);
      assert.equal((await client.execute('SELECT COUNT(*) AS n FROM taxipress_bookings')).rows[0].n, 0);
    });
    assert.equal(line.route.farePerSeat, 5000);
    const book = (who: string, queueId: string, seats: number, payment: "app" | "cash") => call(who, "taxipress/bookings", { queueId, seats, payment });

    let first!: Booking;
    await t.test("a passenger books seats and pays next", async () => {
      const res = await book("a", van1.id, 2, "app");
      assert.equal(res.status, 201);
      const body = await json<{ booking: Booking; order: { id: string; rider_id: string; stage: string } }>(res);
      first = body.booking;
      assert.equal(first.seats, 2);
      assert.equal(first.farePerSeat, 5000);
      assert.equal(first.amount, 10000);
      assert.equal(first.paymentStatus, "unpaid");
      assert.match(first.ticketCode ?? "", /^TXP-[A-Z0-9]{6}$/);
      assert.ok(first.payBy, "an unpaid app booking says when it must be paid by");
      assert.equal(first.route.fromName, "Kampala Stage");
      assert.equal(first.taxi.plate, "UAZ 111A");
      assert.equal(first.taxi.position, 1);
      assert.equal(first.taxi.seatsLeft, 12);
      assert.equal(body.order.rider_id, "d1");
      assert.equal(body.order.stage, "Match");
      const order = await client.execute({ sql: "SELECT total_amount, estimated_total, is_ride, customer_id FROM orders WHERE id = ?", args: [first.orderId] }).catch(() => null);
      if (order) assert.equal(order.rows[0].customer_id, "a");
    });

    await t.test("tracking is private, admin controlled, fresh and limited to active trips", async () => {
      const path = `taxipress/bookings/${first.id}/tracking`;
      assert.equal((await app.request(`/v1/${path}`)).status, 401);
      assert.equal((await call("b", path)).status, 404, "another customer cannot locate this passenger's taxi");
      assert.equal((await call("d2", path)).status, 404, "an unrelated driver cannot locate the trip");
      await call("d1", "taxipress/driver/location", { lat: 0.2, lng: 32.5 });
      const response = await call("a", path);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const fresh = await json<{ enabled: boolean; location: { lat: number; lng: number }; pollAfterSeconds: number }>(response);
      assert.deepEqual({ lat: fresh.location.lat, lng: fresh.location.lng }, { lat: 0.2, lng: 32.5 });
      assert.equal(fresh.pollAfterSeconds, DEFAULT_RIDE_TRACKING_SETTINGS.routeRefreshSeconds);
      await client.execute({ sql: "UPDATE taxipress_queue SET last_location_at = datetime('now', '-10 minutes') WHERE id = ?", args: [van1.id] });
      assert.equal((await json<{ location: unknown }>(await call("a", path))).location, null, "stale coordinates are withheld");
      await call("d1", "taxipress/driver/location", { lat: 0.2, lng: 32.5 });
      await setSetting("ride_tracking", JSON.stringify({ ...DEFAULT_RIDE_TRACKING_SETTINGS, enabled: false, routeRefreshSeconds: 45 }));
      const disabled = await json<{ enabled: boolean; location: unknown; pollAfterSeconds: number }>(await call("a", path));
      assert.equal(disabled.enabled, false);
      assert.equal(disabled.location, null);
      assert.equal(disabled.pollAfterSeconds, 45);
      await setSetting("ride_tracking", JSON.stringify(DEFAULT_RIDE_TRACKING_SETTINGS));
      await client.execute({ sql: "UPDATE taxipress_bookings SET status = 'completed' WHERE id = ?", args: [first.id] });
      assert.equal((await json<{ location: unknown }>(await call("a", path))).location, null, "completed bookings grant no ongoing location access");
      await client.execute({ sql: "UPDATE taxipress_bookings SET status = 'booked' WHERE id = ?", args: [first.id] });
    });

    await t.test("a booking is checked", async () => {
      assert.equal(await code(await book("a", van1.id, 5, "app")), "too_many_seats");
      assert.equal(await code(await book("d1", van1.id, 1, "app")), "own_taxi");
      assert.equal(await code(await book("a", "nope", 1, "app")), "not_found");
      assert.equal((await call("a", "taxipress/bookings", { queueId: van1.id, seats: 0, payment: "app" })).status, 400);
      assert.equal((await setting({ cashEnabled: false })).status, 200);
      assert.equal(await code(await book("a", van1.id, 1, "cash")), "cash_off");
      assert.equal((await setting({ cashEnabled: true })).status, 200);
    });

    await t.test("seats cannot be sold twice", async () => {
      assert.equal((await book("b", van1.id, 4, "app")).status, 201);
      assert.equal((await book("c", van1.id, 4, "app")).status, 201);
      const left = await json<{ line: Array<{ id: string; seatsLeft: number; seatsBooked: number }> }>(await call("a", `taxipress/routes/${route.id}/queue`));
      assert.deepEqual([left.line[0].seatsBooked, left.line[0].seatsLeft], [10, 4]);
      // Seats sold at the stage count against the same total.
      assert.equal((await call("d1", "taxipress/driver/walk-up", { delta: 3 })).status, 200);
      assert.equal(await code(await book("a", van1.id, 2, "app")), "not_available");
      assert.equal((await book("a", van1.id, 1, "app")).status, 201);
    });

    await t.test("the driver sees who is booked, without their ticket codes", async () => {
      const view = await json<{ entry: { seatsTaken: number; fullyBooked: boolean }; bookings: Array<Record<string, unknown>>; canGoOnRoad: boolean }>(await call("d1", "taxipress/taxi/me"));
      assert.equal(view.entry.seatsTaken, 14);
      assert.equal(view.entry.fullyBooked, true);
      assert.equal(view.bookings.length, 4);
      assert.ok(view.bookings.every((b) => !("ticketCode" in b) || b.ticketCode == null));
      assert.equal(view.bookings[0].passengerName, "a");
      assert.equal(view.bookings[0].paymentStatus, "unpaid");
    });

    await t.test("a passenger sees their own bookings and tickets only", async () => {
      const mine = await json<{ bookings: Booking[] }>(await call("a", "taxipress/bookings/mine"));
      assert.equal(mine.bookings.length, 2);
      assert.ok(mine.bookings.every((b) => b.ticketCode));
      assert.equal((await call("a", `taxipress/bookings/${first.id}`)).status, 200);
      assert.equal((await call("b", `taxipress/bookings/${first.id}`)).status, 404);
    });

    await t.test("cash is confirmed on the order, and a passenger can hold only so many cash bookings", async () => {
      assert.equal((await setting({ maxCashBookings: 1 })).status, 200);
      const res = await book("b", van2.id, 1, "cash");
      assert.equal(res.status, 201);
      const cash = (await json<{ booking: Booking }>(res)).booking;
      assert.equal(cash.paymentStatus, "unpaid");
      assert.equal(await code(await book("b", van2.id, 1, "cash")), "too_many_cash_bookings");
      const fund = await call("b", `orders/${cash.orderId}/fund`, { paymentMethod: "cash" });
      assert.equal(fund.status, 200, JSON.stringify(await fund.clone().json()));
      const after = await json<{ booking: Booking }>(await call("b", `taxipress/bookings/${cash.id}`));
      assert.equal(after.booking.paymentStatus, "pay_driver");
      assert.equal(after.booking.amount, 5000);
    });

    await t.test("paying from the wallet marks the booking paid and it is never given back", async () => {
      await client.execute("UPDATE users SET wallet_balance = 100000 WHERE id = 'a'");
      const booked = (await json<{ booking: Booking }>(await book("a", van2.id, 2, "app"))).booking;
      assert.equal(booked.paymentStatus, "unpaid");
      const paid = await call("a", `orders/${booked.orderId}/fund`, { paymentMethod: "wallet", useWallet: true });
      assert.equal(paid.status, 200, JSON.stringify(await paid.clone().json()));
      const after = await json<{ booking: Booking }>(await call("a", `taxipress/bookings/${booked.id}`));
      assert.equal(after.booking.paymentStatus, "paid");
      assert.equal(after.booking.payBy, null);
      await client.execute({ sql: "UPDATE taxipress_bookings SET created_at = datetime('now', '-30 minutes') WHERE id = ?", args: [booked.id] });
      assert.equal(await releaseStaleBookings(), 0, "a paid booking keeps its seats");
      assert.equal((await json<{ booking: Booking }>(await call("a", `taxipress/bookings/${booked.id}`))).booking.status, "booked");
    });

    await t.test("unpaid seats are given back after the pay window", async () => {
      assert.equal(await releaseStaleBookings(), 0, "nothing is stale yet");
      await client.execute({ sql: "UPDATE taxipress_bookings SET created_at = datetime('now', '-30 minutes') WHERE passenger_id = 'c' AND queue_id = ?", args: [van1.id] });
      assert.equal(await releaseStaleBookings(), 4);
      const mine = await json<{ bookings: Booking[] }>(await call("c", "taxipress/bookings/mine"));
      assert.equal(mine.bookings[0].status, "cancelled");
      assert.equal(mine.bookings[0].paymentStatus, "cancelled");
      const left = await json<{ line: Array<{ seatsLeft: number }> }>(await call("a", `taxipress/routes/${route.id}/queue`));
      assert.equal(left.line[0].seatsLeft, 4);
      // The same seats cannot be given back twice.
      assert.equal(await releaseStaleBookings(), 0);
    });

    await t.test("a cancelled order gives its seats back", async () => {
      await client.execute({ sql: "UPDATE orders SET stage = 'Cancelled' WHERE id = ?", args: [first.orderId] });
      assert.equal(await releaseStaleBookings(), 2);
      const left = await json<{ line: Array<{ seatsLeft: number }> }>(await call("a", `taxipress/routes/${route.id}/queue`));
      assert.equal(left.line[0].seatsLeft, 6);
    });

    await t.test("a taxi that has left cannot be booked", async () => {
      assert.equal((await call("d1", "taxipress/driver/boarding", {})).status, 200);
      assert.equal((await call("d1", "taxipress/driver/walk-up", { delta: 3 })).status, 200);
      assert.equal(await code(await call("d1", "taxipress/driver/on-road", {})), "not_full");
      assert.equal(await code(await book("a", van1.id, 3, "app")), "boarding_now", "the taxi Boarding Now is never bookable");
      assert.equal((await call("d1", "taxipress/driver/walk-up", { delta: 3 })).status, 200);
      assert.equal((await call("d1", "taxipress/driver/on-road", {})).status, 200, "walk-ups fill the taxi");
      assert.equal(await code(await book("a", van1.id, 1, "app")), "not_available");
    });

    await t.test("booking is off with Taxipress, and until migration 0125 is applied", async () => {
      assert.equal((await setting({ enabled: false })).status, 200);
      assert.equal(await code(await book("a", van2.id, 1, "app")), "taxipress_off");
      assert.equal((await setting({ enabled: true })).status, 200);
      await client.execute("DROP TABLE taxipress_refunds");
      await client.execute("DROP TABLE taxipress_bookings");
      resetSchemaCache();
      assert.equal(await code(await book("a", van2.id, 1, "app")), "taxipress_unavailable");
      assert.deepEqual((await json<{ bookings: unknown[] }>(await call("a", "taxipress/bookings/mine"))).bookings, []);
      assert.equal(await releaseStaleBookings(), 0);
    });
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    client.close();
  }
});
