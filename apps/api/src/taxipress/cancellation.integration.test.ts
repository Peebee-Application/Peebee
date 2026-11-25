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
import { orderRoutes } from "../orders/routes.js";
import { relayRoutes } from "../relay/routes.js";
import { cancelTermsFor, feeOf } from "./cancel-terms.js";
import { taxipressRoutes } from "./routes.js";

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

test("cancelTermsFor: a full refund inside the window, a share kept after it, nothing to keep on cash", () => {
  const settings = { freeCancelMinutes: 10, cancelRetentionPercent: 20 };
  const now = Date.parse("2026-01-01T10:30:00Z");
  const base = { status: "booked", queueStatus: "in_line", method: "app" as const, amount: 10_000, collected: 10_000 };
  assert.deepEqual(cancelTermsFor({ ...base, createdAt: "2026-01-01 10:25:00" }, settings, now), { allowed: true, reason: null, free: true, fee: 0, refund: 10_000 });
  assert.deepEqual(cancelTermsFor({ ...base, createdAt: "2026-01-01 10:10:00" }, settings, now), { allowed: true, reason: null, free: false, fee: 2_000, refund: 8_000 });
  assert.equal(cancelTermsFor({ ...base, createdAt: "2026-01-01 10:10:00" }, { ...settings, cancelRetentionPercent: 0 }, now).refund, 10_000, "0% kept is always a full refund");
  assert.equal(cancelTermsFor({ ...base, method: "cash", collected: 0, createdAt: "2026-01-01 09:00:00" }, settings, now).fee, 0);
  assert.equal(cancelTermsFor({ ...base, collected: 0, createdAt: "2026-01-01 09:00:00" }, settings, now).fee, 0, "an unpaid seat has nothing to keep");
  assert.equal(cancelTermsFor({ ...base, queueStatus: "on_road", createdAt: "2026-01-01 10:25:00" }, settings, now).allowed, false);
  assert.equal(cancelTermsFor({ ...base, status: "boarded", createdAt: "2026-01-01 10:25:00" }, settings, now).allowed, false);
  assert.equal(feeOf(10_000, 50, 4_000), 4_000, "never more than was collected");
});

test("taxipress: cancellations, no-shows and refunds", async (t) => {
  const client = createClient({ url: "file::memory:" });
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "taxipress-cancel-tests-only";
  for (const file of readdirSync(join(process.cwd(), "src/db/migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(process.cwd(), "src/db/migrations", file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  resetSchemaCache();
  try {
    const passengers = Array.from({ length: 14 }, (_, i) => `p${i + 1}`);
    const people: Array<[string, string]> = [["staff", "admin"], ["d1", "customer"], ["d2", "customer"], ...passengers.map((p): [string, string] => [p, "customer"])];
    for (const [id, role] of people) {
      await client.execute({ sql: "INSERT INTO users (id, phone, name, password_hash, role) VALUES (?, ?, ?, 'hash', ?)", args: [id, id, id, role] });
    }
    await client.execute("UPDATE users SET admin_role = 'super_admin' WHERE id = 'staff'");

    const app = new Hono().route("/v1", orderRoutes).route("/v1", relayRoutes).route("/v1", taxipressRoutes);
    const tokens = Object.fromEntries(await Promise.all(people.map(async ([sub, role]) => [sub, await signToken({ sub, role } as never)] as const)));
    const call = (who: string, path: string, body?: object, method?: string) => app.request(`/v1/${path}`, {
      method: method ?? (body ? "POST" : "GET"),
      headers: { Authorization: `Bearer ${tokens[who]}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = async <T = Record<string, unknown>>(res: Response) => (await res.json()) as T;
    const code = async (res: Response) => (await json<{ error?: string }>(res)).error;
    const setting = (body: object) => call("staff", "admin/taxipress/settings", body, "PUT");
    const balance = async (id: string) => Number((await client.execute({ sql: "SELECT wallet_balance FROM users WHERE id = ?", args: [id] })).rows[0].wallet_balance);

    const relay = await json<{ id: string }>(await call("staff", "admin/relay/routes", {
      name: "Kampala - Entebbe", stageAName: "Kampala Stage", stageALat: KAMPALA.lat, stageALng: KAMPALA.lng,
      stageBName: "Entebbe Stage", stageBLat: ENTEBBE.lat, stageBLng: ENTEBBE.lng, parcelFare: 5000,
    }));
    const route = await json<{ id: string }>(await call("staff", "admin/taxipress/routes", { relayRouteId: relay.id, direction: "a_to_b", farePerSeat: 5000, active: true }));
    assert.equal((await setting({
      enabled: true, commissionDigitalPercent: 10, commissionCashPercent: 10, maxCashBookings: 20,
      freeCancelMinutes: 10, cancelRetentionPercent: 20, feeTo: "driver", noShowMinutes: 10, noShowFeePercent: 50, rebookOnRemoval: true,
    })).status, 200);
    for (const [who, plate] of [["d1", "uaz 111a"], ["d2", "ubb 222b"]]) {
      assert.equal((await call(who, "taxipress/taxi/apply", { relayRouteId: relay.id, plate, seatLayout: "14" })).status, 201);
    }
    for (const taxi of (await json<{ taxis: Array<{ id: string }> }>(await call("staff", "admin/taxipress/taxis"))).taxis) {
      assert.equal((await call("staff", `admin/taxipress/taxis/${taxi.id}`, { status: "approved" })).status, 200);
    }

    type Booking = { id: string; orderId: string; status: string; ticketCode: string; paymentStatus: string; amount: number; taxi: { plate: string; queueId: string }; cancel: { allowed: boolean; free: boolean; fee: number; refund: number; reason: string | null }; outcome: { kind: string; refunded: number; fee: number } | null };
    type Booked = { booking: Booking; order: { id: string } };
    type Outcome = { outcome: { kind: string; refunded: number; fee: number } };

    /** Empties every line, then puts the named drivers in it in order. */
    const lineUp = async (...drivers: string[]) => {
      await client.execute("UPDATE taxipress_queue SET status = 'cancelled' WHERE status IN ('in_line', 'boarding', 'on_road')");
      const ids: string[] = [];
      for (const [i, driver] of drivers.entries()) {
        assert.equal((await call(driver, "taxipress/driver/join", { routeId: route.id, ...KAMPALA })).status, 201);
        await client.execute({ sql: "UPDATE taxipress_queue SET joined_at = datetime('now', ?) WHERE driver_id = ? AND status = 'in_line'", args: [`-${(drivers.length - i) * 5} minutes`, driver] });
        ids.push(String((await client.execute({ sql: "SELECT id FROM taxipress_queue WHERE driver_id = ? AND status = 'in_line'", args: [driver] })).rows[0].id));
      }
      return ids;
    };
    const book = async (who: string, queueId: string, seats: number, payment: "app" | "cash") => json<Booked>(await call(who, "taxipress/bookings", { queueId, seats, payment }));
    const payWallet = async (who: string, b: Booked) => {
      await client.execute({ sql: "UPDATE users SET wallet_balance = wallet_balance + 100000 WHERE id = ?", args: [who] });
      assert.equal((await call(who, `orders/${b.order.id}/fund`, { paymentMethod: "wallet", useWallet: true })).status, 200);
    };
    const view = async (who: string, id: string) => (await json<{ booking: Booking }>(await call(who, `taxipress/bookings/${id}`))).booking;
    const seatsBooked = async (queueId: string) => Number((await client.execute({ sql: "SELECT seats_booked FROM taxipress_queue WHERE id = ?", args: [queueId] })).rows[0].seats_booked);
    const ageBooking = (id: string, minutes: number) => client.execute({ sql: "UPDATE taxipress_bookings SET created_at = datetime('now', ?) WHERE id = ?", args: [`-${minutes} minutes`, id] });

    await t.test("a passenger cancelling inside the free window gets everything back", async () => {
      const [q1] = await lineUp("d1");
      const b = await book("p1", q1, 2, "app");
      await payWallet("p1", b);
      const before = await balance("p1");
      const quote = await view("p1", b.booking.id);
      assert.deepEqual([quote.cancel.allowed, quote.cancel.free, quote.cancel.fee, quote.cancel.refund], [true, true, 0, 10000]);
      assert.equal(await seatsBooked(q1), 2);

      const res = await call("p1", `taxipress/bookings/${b.booking.id}/cancel`, {});
      assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
      const done = await json<Outcome>(res);
      assert.deepEqual([done.outcome.kind, done.outcome.refunded, done.outcome.fee], ["cancelled", 10000, 0]);
      assert.equal(await balance("p1"), before + 10000);
      assert.equal(await seatsBooked(q1), 0, "the seats are free again");
      const after = await view("p1", b.booking.id);
      assert.equal(after.status, "cancelled");
      assert.deepEqual(after.outcome, { kind: "cancelled", refunded: 10000, fee: 0 });
      assert.equal(after.cancel.allowed, false);
      const order = await client.execute({ sql: "SELECT stage FROM orders WHERE id = ?", args: [b.order.id] });
      assert.equal(order.rows[0].stage, "Cancelled");
      assert.equal(await code(await call("p1", `taxipress/bookings/${b.booking.id}/cancel`, {})), "not_cancellable");
      assert.equal(await balance("p1"), before + 10000, "no second refund");
    });

    await t.test("after the window a share is kept and paid to the driver", async () => {
      const [q1] = await lineUp("d1");
      const b = await book("p2", q1, 2, "app");
      await payWallet("p2", b);
      await ageBooking(b.booking.id, 30);
      const quote = await view("p2", b.booking.id);
      assert.deepEqual([quote.cancel.free, quote.cancel.fee, quote.cancel.refund], [false, 2000, 8000]);
      const [driverBefore, passengerBefore] = [await balance("d1"), await balance("p2")];
      const done = await json<Outcome>(await call("p2", `taxipress/bookings/${b.booking.id}/cancel`, {}));
      assert.deepEqual([done.outcome.refunded, done.outcome.fee], [8000, 2000]);
      assert.equal(await balance("p2"), passengerBefore + 8000);
      assert.equal(await balance("d1"), driverBefore + 2000);
      const row = await client.execute({ sql: "SELECT kind, collected, refunded, fee, fee_to FROM taxipress_refunds WHERE booking_id = ?", args: [b.booking.id] });
      assert.deepEqual([row.rows[0].kind, row.rows[0].collected, row.rows[0].refunded, row.rows[0].fee, row.rows[0].fee_to], ["cancelled", 10000, 8000, 2000, "driver"]);

      // When staff say the fee goes to Peebee, the driver gets nothing.
      assert.equal((await setting({ feeTo: "peebee" })).status, 200);
      const again = await book("p2", q1, 1, "app");
      await payWallet("p2", again);
      await ageBooking(again.booking.id, 30);
      const driverNow = await balance("d1");
      const second = await json<Outcome>(await call("p2", `taxipress/bookings/${again.booking.id}/cancel`, {}));
      assert.deepEqual([second.outcome.refunded, second.outcome.fee], [4000, 1000]);
      assert.equal(await balance("d1"), driverNow);
      assert.equal((await setting({ feeTo: "driver" })).status, 200);
    });

    await t.test("an unpaid seat or a cash seat is just released", async () => {
      const [q1] = await lineUp("d1");
      const unpaid = await book("p3", q1, 1, "app");
      const cash = await book("p3", q1, 2, "cash");
      await ageBooking(unpaid.booking.id, 3);
      const walletBefore = await balance("p3");
      assert.equal(await seatsBooked(q1), 3);
      const a = await json<Outcome>(await call("p3", `taxipress/bookings/${unpaid.booking.id}/cancel`, {}));
      const b = await json<Outcome>(await call("p3", `taxipress/bookings/${cash.booking.id}/cancel`, {}));
      assert.deepEqual([a.outcome.refunded, a.outcome.fee, b.outcome.refunded, b.outcome.fee], [0, 0, 0, 0]);
      assert.equal(await balance("p3"), walletBefore);
      assert.equal(await seatsBooked(q1), 0);
    });

    await t.test("only the passenger can cancel, and not once the taxi has left or they have boarded", async () => {
      const [q1] = await lineUp("d1");
      const b = await book("p4", q1, 1, "app");
      assert.equal((await call("p5", `taxipress/bookings/${b.booking.id}/cancel`, {})).status, 404);
      await client.execute({ sql: "UPDATE taxipress_queue SET status = 'on_road' WHERE id = ?", args: [q1] });
      assert.equal(await code(await call("p4", `taxipress/bookings/${b.booking.id}/cancel`, {})), "not_cancellable");
      await client.execute({ sql: "UPDATE taxipress_queue SET status = 'in_line' WHERE id = ?", args: [q1] });
      await client.execute({ sql: "UPDATE taxipress_bookings SET status = 'boarded' WHERE id = ?", args: [b.booking.id] });
      assert.equal(await code(await call("p4", `taxipress/bookings/${b.booking.id}/cancel`, {})), "not_cancellable");
    });

    await t.test("a driver marks an absent passenger a no-show once the taxi has been boarding long enough", async () => {
      const [q1] = await lineUp("d1");
      const paid = await book("p6", q1, 1, "app");
      const cash = await book("p7", q1, 1, "cash");
      await payWallet("p6", paid);
      assert.equal(await code(await call("d1", "taxipress/driver/no-show", { bookingId: paid.booking.id })), "not_boarding");
      assert.equal((await call("d1", "taxipress/driver/boarding", {})).status, 200);
      assert.equal(await code(await call("d1", "taxipress/driver/no-show", { bookingId: paid.booking.id })), "too_early");
      await client.execute("UPDATE taxipress_queue SET boarding_at = datetime('now', '-20 minutes') WHERE driver_id = 'd1' AND status = 'boarding'");
      assert.equal((await call("p6", "taxipress/driver/no-show", { bookingId: paid.booking.id })).status, 404, "a passenger cannot mark themselves a no-show");

      const [driverBefore, passengerBefore] = [await balance("d1"), await balance("p6")];
      const done = await json<Outcome>(await call("d1", "taxipress/driver/no-show", { bookingId: paid.booking.id }));
      assert.deepEqual([done.outcome.kind, done.outcome.refunded, done.outcome.fee], ["no_show", 2500, 2500]);
      assert.equal(await balance("p6"), passengerBefore + 2500);
      assert.equal(await balance("d1"), driverBefore + 2500);
      assert.equal(await seatsBooked(q1), 1, "only the cash seat is left");
      const after = await view("p6", paid.booking.id);
      assert.deepEqual([after.status, after.outcome?.kind], ["no_show", "no_show"]);

      const cashDone = await json<Outcome>(await call("d1", "taxipress/driver/no-show", { bookingId: cash.booking.id }));
      assert.deepEqual([cashDone.outcome.refunded, cashDone.outcome.fee], [0, 0]);
      assert.equal(await code(await call("d1", "taxipress/driver/no-show", { bookingId: cash.booking.id })), "not_cancellable");
    });

    await t.test("a passenger who has boarded cannot be marked a no-show", async () => {
      const [q1] = await lineUp("d1");
      const b = await book("p8", q1, 1, "app");
      await payWallet("p8", b);
      assert.equal((await call("d1", "taxipress/driver/boarding", {})).status, 200);
      assert.equal((await call("d1", "taxipress/driver/board", { code: b.booking.ticketCode })).status, 200);
      await client.execute("UPDATE taxipress_queue SET boarding_at = datetime('now', '-20 minutes') WHERE driver_id = 'd1' AND status = 'boarding'");
      assert.equal(await code(await call("d1", "taxipress/driver/no-show", { bookingId: b.booking.id })), "not_cancellable");
    });

    await t.test("when the taxi goes on the road, anyone who did not board is a no-show", async () => {
      const [q1] = await lineUp("d1");
      const boards = await book("p9", q1, 1, "app");
      const misses = await book("p10", q1, 1, "app");
      await payWallet("p9", boards);
      await payWallet("p10", misses);
      assert.equal((await call("d1", "taxipress/driver/boarding", {})).status, 200);
      assert.equal((await call("d1", "taxipress/driver/board", { code: boards.booking.ticketCode })).status, 200);
      assert.equal((await call("d1", "taxipress/driver/walk-up", { delta: 12 })).status, 200);
      const before = await balance("p10");
      assert.equal((await call("d1", "taxipress/driver/on-road", {})).status, 200);
      const after = await view("p10", misses.booking.id);
      assert.deepEqual([after.status, after.outcome], ["no_show", { kind: "no_show", refunded: 2500, fee: 2500 }]);
      assert.equal(await balance("p10"), before + 2500);
      assert.equal((await view("p9", boards.booking.id)).status, "boarded", "the passenger who boarded is untouched");
    });

    await t.test("when a taxi leaves the line its passengers move to the next taxi, tickets still valid", async () => {
      const [q1, q2] = await lineUp("d1", "d2");
      const paid = await book("p11", q1, 2, "app");
      const cash = await book("p12", q1, 1, "cash");
      await payWallet("p11", paid);
      assert.equal((await call("p12", `orders/${cash.order.id}/fund`, { paymentMethod: "cash" })).status, 200);

      assert.equal((await call("d1", "taxipress/driver/leave", {})).status, 200);
      const moved = await view("p11", paid.booking.id);
      assert.equal(moved.status, "booked");
      assert.equal(moved.taxi.plate, "UBB 222B");
      assert.equal(moved.taxi.queueId, q2);
      assert.equal(moved.paymentStatus, "paid", "the money stays with the booking");
      assert.equal(await seatsBooked(q1), 0);
      assert.equal(await seatsBooked(q2), 3);
      const order = await client.execute({ sql: "SELECT rider_id FROM orders WHERE id = ?", args: [paid.order.id] });
      assert.equal(order.rows[0].rider_id, "d2");

      // The new driver can board them with the same ticket, and is the one paid.
      assert.equal((await call("d2", "taxipress/driver/boarding", {})).status, 200);
      const d2Before = await balance("d2");
      const board = await call("d2", "taxipress/driver/board", { code: paid.booking.ticketCode });
      assert.equal(board.status, 200, JSON.stringify(await board.clone().json()));
      assert.equal(await balance("d2"), d2Before + 9000);
    });

    await t.test("with no room anywhere, or moving switched off, passengers are refunded in full", async () => {
      const [q1, q2] = await lineUp("d1", "d2");
      const noRoom = await book("p13", q1, 2, "app");
      await payWallet("p13", noRoom);
      await client.execute({ sql: "UPDATE taxipress_queue SET walk_up_seats = 13 WHERE id = ?", args: [q2] });
      const before = await balance("p13");
      assert.equal((await call("d1", "taxipress/driver/leave", {})).status, 200);
      const refunded = await view("p13", noRoom.booking.id);
      assert.deepEqual([refunded.status, refunded.outcome], ["cancelled", { kind: "taxi_removed", refunded: 10000, fee: 0 }]);
      assert.equal(await balance("p13"), before + 10000, "a taxi removed is never the passenger's fault, so no fee");

      assert.equal((await setting({ rebookOnRemoval: false })).status, 200);
      const [r1] = await lineUp("d1", "d2");
      const stays = await book("p14", r1, 1, "app");
      await payWallet("p14", stays);
      const wallet = await balance("p14");
      assert.equal((await call("d1", "taxipress/driver/leave", {})).status, 200);
      assert.equal((await view("p14", stays.booking.id)).outcome?.kind, "taxi_removed");
      assert.equal(await balance("p14"), wallet + 5000);
      assert.equal((await setting({ rebookOnRemoval: true })).status, 200);
    });

    await t.test("a taxi with passengers on board cannot leave the line", async () => {
      const [q1] = await lineUp("d1");
      const b = await book("p1", q1, 1, "app");
      await payWallet("p1", b);
      assert.equal((await call("d1", "taxipress/driver/boarding", {})).status, 200);
      assert.equal((await call("d1", "taxipress/driver/board", { code: b.booking.ticketCode })).status, 200);
      assert.equal(await code(await call("d1", "taxipress/driver/leave", {})), "passengers_on_board");
    });

    await t.test("staff removing or suspending a taxi moves or refunds its passengers too", async () => {
      const [q1, q2] = await lineUp("d1", "d2");
      const b = await book("p2", q1, 1, "app");
      await payWallet("p2", b);
      assert.equal((await call("staff", `admin/taxipress/queue/${q1}/remove`, {})).status, 200);
      assert.equal((await view("p2", b.booking.id)).taxi.queueId, q2);

      const taxiId = (await json<{ taxis: Array<{ id: string; userId: string }> }>(await call("staff", "admin/taxipress/taxis"))).taxis.find((x) => x.userId === "d2")!.id;
      const wallet = await balance("p2");
      assert.equal((await call("staff", `admin/taxipress/taxis/${taxiId}`, { status: "suspended" })).status, 200);
      assert.equal((await view("p2", b.booking.id)).outcome?.kind, "taxi_removed");
      assert.equal(await balance("p2"), wallet + 5000);
      assert.equal((await call("staff", `admin/taxipress/taxis/${taxiId}`, { status: "approved" })).status, 200);
    });

    await t.test("staff see what was refunded and kept", async () => {
      const report = await json<{ ready: boolean; refunds: { count: number; refunded: number; fees: number; cancelled: number; noShows: number; taxiRemoved: number } }>(await call("staff", "admin/taxipress/report?days=7"));
      assert.equal(report.ready, true);
      assert.equal(report.refunds.count, report.refunds.cancelled + report.refunds.noShows + report.refunds.taxiRemoved);
      assert.equal(report.refunds.cancelled, 5);
      assert.equal(report.refunds.noShows, 3);
      assert.equal(report.refunds.taxiRemoved, 3);
      assert.equal(report.refunds.fees, 2000 + 1000 + 2500 + 2500);
    });

    await t.test("until migration 0127 is applied nothing fails, there is just no refund", async () => {
      const [q1] = await lineUp("d1");
      const b = await book("p3", q1, 1, "cash");
      await client.execute("DROP TABLE taxipress_refunds");
      resetSchemaCache();
      assert.equal(await code(await call("p3", `taxipress/bookings/${b.booking.id}/cancel`, {})), "taxipress_unavailable");
      assert.equal((await view("p3", b.booking.id)).outcome, null);
      assert.equal((await call("d1", "taxipress/driver/leave", {})).status, 200, "the driver can still leave the line");
      assert.equal((await json<{ ready: boolean; refunds: { count: number } }>(await call("staff", "admin/taxipress/report"))).refunds.count, 0);
    });
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    client.close();
  }
});
