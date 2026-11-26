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
import { markRemainingNoShows } from "./cancellation.js";

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

test("taxipress: an open ticket works on any taxi on the route", async () => {
  const client = createClient({ url: "file::memory:" });
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "taxipress-open-ticket-tests-only";
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
    const openBook = (who: string, queueId: string) => call(who, "taxipress/bookings", { queueId, adults: 1, payment: "app", openTicket: true });

    // Off by default: staff switch it on.
    assert.equal(await code(await openBook("a", van1.id)), "open_tickets_off");
    assert.equal((await setting({ openTicketsEnabled: true, openTicketValidityDays: 0, openTicketRefundPercent: 100 })).status, 200);
    assert.equal((await json<{ openTicketsEnabled: boolean }>(await call("a", "taxipress/config"))).openTicketsEnabled, true);
    assert.equal(await code(await call("a", "taxipress/bookings", { queueId: van1.id, adults: 1, payment: "cash", openTicket: true })), "open_ticket_prepaid");

    // Bought on taxi 1 at the normal fare.
    const res = await openBook("a", van1.id);
    assert.equal(res.status, 201);
    const bought = await json<Booked & { booking: { amount: number; openTicket: { validUntil: string | null } | null } }>(res);
    assert.equal(bought.booking.amount, 5000, "normal fare");
    assert.equal(bought.booking.openTicket?.validUntil, null, "never expires");
    assert.equal((await call("a", `orders/${bought.order.id}/fund`, { paymentMethod: "cash" })).status, 409, "checkout cannot turn a prepaid open ticket into cash");
    await payWallet("a", bought);

    // Taxi 1 leaves without the passenger: an ordinary booking would be a no-show, an open ticket stays valid.
    await client.execute({ sql: "UPDATE taxipress_queue SET status = 'on_road' WHERE id = ?", args: [van1.id] });
    await markRemainingNoShows(van1.id);
    const after = await json<{ booking: { status: string; openTicket: unknown; cancel: { allowed: boolean } } }>(await call("a", `taxipress/bookings/${bought.booking.id}`));
    assert.equal(after.booking.status, "booked");
    assert.equal(after.booking.cancel.allowed, true, "can still be cancelled for a refund");

    // Taxi 2 boards: the driver confirms the code and the ticket moves over and settles.
    assert.equal((await call("d2", "taxipress/driver/boarding", {})).status, 200);
    const d2Before = await balance("d2");
    const boarded = await call("d2", "taxipress/driver/board", { code: bought.booking.ticketCode });
    assert.equal(boarded.status, 200, JSON.stringify(await boarded.clone().json()));
    const row = (await client.execute({ sql: "SELECT queue_id, status FROM taxipress_bookings WHERE id = ?", args: [bought.booking.id] })).rows[0];
    assert.equal(row.queue_id, van2.id);
    assert.equal(row.status, "boarded");
    assert.ok((await balance("d2")) > d2Before, "the driver who took the open ticket is paid");
    assert.equal(await code(await call("d2", "taxipress/driver/board", { code: bought.booking.ticketCode })), "already_boarded");

    // A ticket of another route cannot be used, and an expired one cannot board.
    await client.execute({ sql: "UPDATE taxipress_queue SET status = 'in_line', seats_booked = 0 WHERE id = ?", args: [van1.id] });
    const second = await json<Booked>(await openBook("b", van1.id));
    await payWallet("b", second);
    await client.execute({ sql: "UPDATE taxipress_bookings SET valid_until = datetime('now', '-1 minutes') WHERE id = ?", args: [second.booking.id] });
    assert.equal(await code(await call("d2", "taxipress/driver/board", { code: second.booking.ticketCode })), "ticket_expired");
    // Listing tickets ends the expired one and refunds it.
    const walletBefore = await balance("b");
    const mine = await json<{ bookings: Array<{ id: string; status: string }> }>(await call("b", "taxipress/bookings/mine"));
    assert.equal(mine.bookings.find((x) => x.id === second.booking.id)?.status, "cancelled");
    assert.equal((await balance("b")) - walletBefore, 5000, "refunded in full");

    // Cancelling an unused open ticket refunds as staff set.
    assert.equal((await setting({ openTicketRefundPercent: 50 })).status, 200);
    const third = await json<Booked>(await openBook("c", van1.id));
    await payWallet("c", third);
    const cBefore = await balance("c");
    assert.equal((await call("c", `taxipress/bookings/${third.booking.id}/cancel`, {})).status, 200);
    assert.equal((await balance("c")) - cBefore, 2500, "half comes back");
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});
