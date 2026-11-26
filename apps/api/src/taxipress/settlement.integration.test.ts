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
import { taxipressRoutes } from "./routes.js";
import { commissionFor } from "./settlement.js";

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

test("commissionFor: a percentage or a flat amount per seat, never more than the fare", () => {
  const base = { commissionType: "percent" as const, commissionDigitalPercent: 10, commissionCashPercent: 20, commissionFlatUgx: 300 };
  assert.deepEqual(commissionFor(base, "app", 10_000, 2), { amount: 1000, rule: "percent" });
  assert.deepEqual(commissionFor(base, "cash", 10_000, 2), { amount: 2000, rule: "percent" });
  assert.equal(commissionFor({ ...base, commissionDigitalPercent: 0, commissionCashPercent: 0 }, "app", 10_000, 2).amount, 0);
  assert.deepEqual(commissionFor({ ...base, commissionType: "flat" }, "cash", 10_000, 2), { amount: 600, rule: "flat" });
  assert.equal(commissionFor({ ...base, commissionType: "flat", commissionFlatUgx: 99_999 }, "app", 10_000, 2).amount, 10_000, "never more than the fare");
  assert.equal(commissionFor({ ...base, commissionDigitalPercent: 12.5 }, "app", 5_000, 1).amount, 625);
});

type Board = { bookingId: string; fare: number; commission: number; driverAmount: number; takenFromDriver: number; driverBalance: number | null; paymentMethod: string };

test("taxipress: boarding confirmation and settlement", async (t) => {
  const client = createClient({ url: "file::memory:" });
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "taxipress-settlement-tests-only";
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
    await client.execute("INSERT INTO personal_wallets (user_id) SELECT id FROM users WHERE role='customer'");
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
    const driverBalance = async (id: string) => Number((await client.execute({ sql: "SELECT wallet_balance FROM riders WHERE user_id=?", args: [id] })).rows[0]?.wallet_balance ?? 0);

    const relay = await json<{ id: string }>(await call("staff", "admin/relay/routes", {
      name: "Kampala - Entebbe", stageAName: "Kampala Stage", stageALat: KAMPALA.lat, stageALng: KAMPALA.lng,
      stageBName: "Entebbe Stage", stageBLat: ENTEBBE.lat, stageBLng: ENTEBBE.lng, parcelFare: 5000,
    }));
    const route = await json<{ id: string }>(await call("staff", "admin/taxipress/routes", { relayRouteId: relay.id, direction: "a_to_b", farePerSeat: 5000, active: true }));
    assert.equal((await setting({ enabled: true, commissionType: "percent", commissionDigitalPercent: 10, commissionCashPercent: 10, maxCashBookings: 5 })).status, 200);

    for (const [who, plate, layout] of [["d1", "uaz 111a", "14"], ["d2", "ubb 222b", "14"]]) {
      assert.equal((await call(who, "taxipress/taxi/apply", { relayRouteId: relay.id, plate, seatLayout: layout })).status, 201);
    }
    for (const taxi of (await json<{ taxis: Array<{ id: string }> }>(await call("staff", "admin/taxipress/taxis"))).taxis) {
      assert.equal((await call("staff", `admin/taxipress/taxis/${taxi.id}`, { status: "approved" })).status, 200);
    }
    assert.equal((await call("d1", "taxipress/driver/join", { routeId: route.id, ...KAMPALA })).status, 201);
    await client.execute("UPDATE taxipress_queue SET joined_at = datetime('now', '-5 minutes') WHERE driver_id = 'd1'");
    assert.equal((await call("d2", "taxipress/driver/join", { routeId: route.id, ...KAMPALA })).status, 201);
    const { line } = await json<{ line: Array<{ id: string }> }>(await call("a", `taxipress/routes/${route.id}/queue`));
    const [van1, van2] = line;

    type Booked = { booking: { id: string; orderId: string; ticketCode: string }; order: { id: string } };
    // Only taxis waiting in line can be booked (v5). These tests are about settling at boarding, so a seat
    // booked after the taxi started boarding is booked as if just before it did.
    const book = async (who: string, queueId: string, seats: number, payment: "app" | "cash") => {
      const was = (await client.execute({ sql: "SELECT status FROM taxipress_queue WHERE id = ?", args: [queueId] })).rows[0]?.status;
      if (was === "boarding") await client.execute({ sql: "UPDATE taxipress_queue SET status = 'in_line' WHERE id = ?", args: [queueId] });
      try {
        return await json<Booked>(await call(who, "taxipress/bookings", { queueId, seats, payment }));
      } finally {
        if (was === "boarding") await client.execute({ sql: "UPDATE taxipress_queue SET status = 'boarding' WHERE id = ?", args: [queueId] });
      }
    };
    const board = (who: string, codeText: string) => call(who, "taxipress/driver/board", { code: codeText });
    const payWallet = async (who: string, b: Booked) => {
      await client.execute({ sql: "UPDATE users SET wallet_balance = wallet_balance + 100000 WHERE id = ?", args: [who] });
      assert.equal((await call(who, `orders/${b.order.id}/fund`, { paymentMethod: "wallet", useWallet: true })).status, 200);
    };

    const paid = await book("a", van1.id, 2, "app");
    const unpaid = await book("b", van1.id, 1, "app");
    const cash = await book("b", van1.id, 1, "cash");
    const unconfirmedCash = await book("c", van1.id, 1, "cash");
    await payWallet("a", paid);
    assert.equal((await call("b", `orders/${cash.order.id}/fund`, { paymentMethod: "cash" })).status, 200);

    await t.test("only a taxi that is boarding confirms passengers", async () => {
      assert.equal(await code(await board("d1", paid.booking.ticketCode)), "not_boarding");
      assert.equal((await call("d1", "taxipress/driver/boarding", {})).status, 200);
      assert.equal((await call("a", "taxipress/driver/board", { code: paid.booking.ticketCode })).status, 404, "a passenger without a taxi cannot board anyone");
      assert.equal((await call("d1", "taxipress/driver/board", { code: "x" })).status, 400);
    });

    await t.test("a ticket must be for this taxi and be real", async () => {
      assert.equal(await code(await board("d1", "TXP-ZZZZZZ")), "code_not_found");
      const otherTaxi = await book("c", van2.id, 1, "app");
      assert.equal(await code(await board("d1", otherTaxi.booking.ticketCode)), "wrong_taxi");
    });

    await t.test("an app payment is settled: the fare minus Peebee's commission goes to the driver", async () => {
      assert.equal(await driverBalance("d1"), 0);
      const res = await board("d1", paid.booking.ticketCode);
      assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
      const done = await json<Board>(res);
      assert.equal(done.fare, 10000);
      assert.equal(done.commission, 1000);
      assert.equal(done.driverAmount, 9000);
      assert.equal(done.takenFromDriver, 0);
      assert.equal(await driverBalance("d1"), 9000);
      const order = await client.execute({ sql: "SELECT stage, final_total FROM orders WHERE id = ?", args: [paid.order.id] });
      assert.equal(order.rows[0].stage, "Settle");
      const row = await client.execute({ sql: "SELECT commission, driver_amount, payment_method FROM taxipress_settlements WHERE booking_id = ?", args: [paid.booking.id] });
      assert.deepEqual([row.rows[0].commission, row.rows[0].driver_amount, row.rows[0].payment_method], [1000, 9000, "app"]);
      assert.equal(await balance("d1"), 0, "the driver's personal wallet is unchanged");
    });

    await t.test("a passenger can only board once", async () => {
      assert.equal(await code(await board("d1", paid.booking.ticketCode)), "already_boarded");
      assert.equal(await driverBalance("d1"), 9000, "no second payment");
      assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM taxipress_settlements")).rows[0].n), 1);
    });

    await t.test("an unpaid ticket is refused until the passenger pays", async () => {
      assert.equal(await code(await board("d1", unpaid.booking.ticketCode)), "not_paid");
      assert.equal(await driverBalance("d1"), 9000);
      await payWallet("b", unpaid);
      assert.equal((await board("d1", unpaid.booking.ticketCode)).status, 200);
      assert.equal(await driverBalance("d1"), 9000 + 4500, "5,000 less 10% commission");
    });

    await t.test("cash: the driver keeps the cash and Peebee's commission comes out of their wallet", async () => {
      const done = await json<Board>(await board("d1", cash.booking.ticketCode.replace("TXP-", "").toLowerCase()));
      assert.equal(done.paymentMethod, "cash");
      assert.equal(done.commission, 500);
      assert.equal(done.takenFromDriver, 500);
      assert.equal(done.driverAmount, 4500);
      assert.equal(await driverBalance("d1"), 13500 - 500);
      const row = await client.execute({ sql: "SELECT taken_from_driver, driver_amount FROM taxipress_settlements WHERE booking_id = ?", args: [cash.booking.id] });
      assert.deepEqual([row.rows[0].taken_from_driver, row.rows[0].driver_amount], [500, 4500]);
    });

    await t.test("a cash booking the passenger has not confirmed is refused", async () => {
      assert.equal(await code(await board("d1", unconfirmedCash.booking.ticketCode)), "not_confirmed");
    });

    await t.test("a driver with no wallet funds goes negative, and the next payment nets against it", async () => {
      await client.execute("UPDATE riders SET wallet_balance = 100 WHERE user_id = 'd1'");
      const another = await book("a", van1.id, 1, "cash");
      assert.equal((await call("a", `orders/${another.order.id}/fund`, { paymentMethod: "cash" })).status, 200);
      const done = await json<Board>(await board("d1", another.booking.ticketCode));
      assert.equal(done.driverBalance, -400);
      assert.equal(await driverBalance("d1"), -400);
      const paidLater = await book("a", van1.id, 1, "app");
      await payWallet("a", paidLater);
      assert.equal((await board("d1", paidLater.booking.ticketCode)).status, 200);
      assert.equal(await driverBalance("d1"), -400 + 4500, "the payment nets against what the driver owed");
    });

    await t.test("a flat commission is per seat, and never more than the fare", async () => {
      assert.equal((await setting({ commissionType: "flat", commissionFlatUgx: 300 })).status, 200);
      const two = await book("c", van1.id, 2, "app");
      await payWallet("c", two);
      const done = await json<Board>(await board("d1", two.booking.ticketCode));
      assert.deepEqual([done.commission, done.driverAmount], [600, 9400]);
      assert.equal((await setting({ commissionFlatUgx: 1_000_000 })).status, 200);
      const capped = await book("c", van1.id, 1, "app");
      await payWallet("c", capped);
      const cappedDone = await json<Board>(await board("d1", capped.booking.ticketCode));
      assert.deepEqual([cappedDone.commission, cappedDone.driverAmount], [5000, 0]);
      assert.equal((await setting({ commissionType: "percent" })).status, 200);
    });

    await t.test("a cancelled booking cannot board", async () => {
      const gone = await book("a", van1.id, 1, "app");
      await client.execute({ sql: "UPDATE orders SET stage = 'Cancelled' WHERE id = ?", args: [gone.order.id] });
      assert.equal(await code(await board("d1", gone.booking.ticketCode)), "not_valid");
    });

    await t.test("staff see the commission and who owes it", async () => {
      await client.execute("UPDATE riders SET wallet_balance = -1200 WHERE user_id = 'd1'");
      const report = await json<{ ready: boolean; totals: { bookings: number; seats: number; fare: number; commission: number; cashFare: number; appFare: number; takenFromDrivers: number }; recent: Array<{ plate: string }>; owing: Array<{ balance: number; plate: string }> }>(await call("staff", "admin/taxipress/report?days=7"));
      assert.equal(report.ready, true);
      assert.equal(report.totals.bookings, 7);
      assert.equal(report.totals.cashFare, 10000);
      assert.equal(report.totals.appFare, 35000);
      assert.equal(report.totals.fare, report.totals.cashFare + report.totals.appFare);
      assert.equal(report.totals.takenFromDrivers, 1000);
      assert.equal(report.recent[0].plate, "UAZ 111A");
      assert.deepEqual(report.owing.map((o) => [o.balance, o.plate]), [[-1200, "UAZ 111A"]]);
      assert.equal((await call("a", "admin/taxipress/report")).status, 403);
    });

    await t.test("arriving completes the boarded passengers' trips", async () => {
      assert.equal((await call("d1", "taxipress/driver/walk-up", { delta: 2 })).status, 200);
      const queue = await client.execute("SELECT seats_total, seats_booked, walk_up_seats FROM taxipress_queue WHERE driver_id = 'd1'");
      const free = Number(queue.rows[0].seats_total) - Number(queue.rows[0].seats_booked) - Number(queue.rows[0].walk_up_seats);
      await client.execute({ sql: "UPDATE taxipress_queue SET walk_up_seats = walk_up_seats + ? WHERE driver_id = 'd1'", args: [Math.max(0, free)] });
      assert.equal((await call("d1", "taxipress/driver/on-road", {})).status, 200);
      assert.equal((await call("d1", "taxipress/driver/arrive", {})).status, 200);
      const states = await client.execute({ sql: "SELECT status FROM taxipress_bookings WHERE id = ?", args: [paid.booking.id] });
      assert.equal(states.rows[0].status, "completed");
    });

    await t.test("until migration 0126 is applied it offers nothing and does not fail", async () => {
      await client.execute("DROP TABLE taxipress_settlements");
      resetSchemaCache();
      assert.equal((await call("d2", "taxipress/driver/boarding", {})).status, 200);
      assert.equal(await code(await board("d2", "TXP-ABCDEF")), "taxipress_unavailable");
      assert.equal((await json<{ ready: boolean }>(await call("staff", "admin/taxipress/report"))).ready, false);
    });
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    client.close();
  }
});
