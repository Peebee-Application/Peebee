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
import { relayRoutes } from "../relay/routes.js";
import { isInLine } from "./queue.js";
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

type Entry = { id: string; status: string; position: number | null; seatsTotal: number; seatsTaken: number; seatsLeft: number; walkUpSeats: number; plate: string };
type Me = {
  ready: boolean; taxi: { id: string; status: string; seats: number } | null; routes: Array<{ id: string; fromName: string }>;
  entry: (Entry & { taxipressRouteId: string }) | null; canGoOnRoad: boolean; onRoadReason: string | null; line: Entry[];
};

test("taxipress: the driver queue", async (t) => {
  const client = createClient({ url: "file::memory:" });
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "taxipress-queue-tests-only";
  for (const file of readdirSync(join(process.cwd(), "src/db/migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(process.cwd(), "src/db/migrations", file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  resetSchemaCache();
  try {
    for (const [id, role] of [["cust", "customer"], ["staff", "admin"], ["d1", "customer"], ["d2", "customer"], ["d3", "customer"]]) {
      await client.execute({ sql: "INSERT INTO users (id, phone, name, password_hash, role) VALUES (?, ?, ?, 'hash', ?)", args: [id, id, id, role] });
    }
    await client.execute("UPDATE users SET admin_role = 'super_admin' WHERE id = 'staff'");

    const app = new Hono().route("/v1", relayRoutes).route("/v1", taxipressRoutes);
    const tokens = Object.fromEntries(await Promise.all(
      [["cust", "customer"], ["staff", "admin"], ["d1", "customer"], ["d2", "customer"], ["d3", "customer"]].map(async ([sub, role]) => [sub, await signToken({ sub, role } as never)] as const),
    ));
    const call = (who: string, path: string, body?: object, method?: string) => app.request(`/v1/${path}`, {
      method: method ?? (body ? "POST" : "GET"),
      headers: { Authorization: `Bearer ${tokens[who]}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = async <T = Record<string, unknown>>(res: Response) => (await res.json()) as T;
    const me = async (who: string) => json<Me>(await call(who, "taxipress/taxi/me"));
    const setting = (body: object) => call("staff", "admin/taxipress/settings", body, "PUT");
    const code = async (res: Response) => (await json<{ error?: string }>(res)).error;

    // A route staff have set up in Relay and switched on in Taxipress, both ways.
    const relay = await json<{ id: string }>(await call("staff", "admin/relay/routes", {
      name: "Kampala - Entebbe", stageAName: "Kampala Stage", stageALat: KAMPALA.lat, stageALng: KAMPALA.lng,
      stageBName: "Entebbe Stage", stageBLat: ENTEBBE.lat, stageBLng: ENTEBBE.lng, parcelFare: 5000,
    }));
    const routeIds: Record<string, string> = {};
    for (const direction of ["a_to_b", "b_to_a"]) {
      routeIds[direction] = (await json<{ id: string }>(await call("staff", "admin/taxipress/routes", { relayRouteId: relay.id, direction, farePerSeat: 5000, active: true }))).id;
    }
    const kampalaToEntebbe = routeIds.a_to_b;
    assert.equal((await setting({ enabled: true })).status, 200);

    await t.test("a taxi is approved before it can join", async () => {
      assert.equal(await code(await call("d1", "taxipress/driver/join", { routeId: kampalaToEntebbe, ...KAMPALA })), "taxi_not_approved");
      assert.equal((await call("d1", "taxipress/taxi/apply", { relayRouteId: "nope", plate: "uaz 111a", seatLayout: "14" })).status, 404);
      assert.equal((await call("d1", "taxipress/taxi/apply", { relayRouteId: relay.id, plate: "uaz 111a", seatLayout: "20" })).status, 400);
      for (const [who, plate, layout] of [["d1", "uaz 111a", "14"], ["d2", "ubb 222b", "18"], ["d3", "ucc 333c", "14"]]) {
        assert.equal((await call(who, "taxipress/taxi/apply", { relayRouteId: relay.id, plate, seatLayout: layout })).status, 201);
      }
      assert.equal((await me("d1")).taxi?.status, "pending");
      assert.equal((await call("d1", "admin/taxipress/taxis")).status, 403);
      const taxis = await json<{ taxis: Array<{ id: string; userId: string; plate: string; status: string }> }>(await call("staff", "admin/taxipress/taxis"));
      assert.equal(taxis.taxis.length, 3);
      assert.equal(taxis.taxis.find((x) => x.userId === "d1")!.plate, "UAZ 111A");
      for (const taxi of taxis.taxis.filter((x) => x.userId !== "d3")) {
        assert.equal((await call("staff", `admin/taxipress/taxis/${taxi.id}`, { status: "approved" })).status, 200);
      }
      const view = await me("d1");
      assert.equal(view.taxi?.status, "approved");
      assert.equal(view.taxi?.seats, 14);
      assert.equal(view.routes.length, 2);
      assert.equal(await code(await call("d3", "taxipress/driver/join", { routeId: kampalaToEntebbe, ...KAMPALA })), "taxi_not_approved");
    });

    await t.test("joining needs the driver to be at the start stage", async () => {
      assert.equal(await code(await call("d1", "taxipress/driver/join", { routeId: kampalaToEntebbe })), "location_required");
      assert.equal(await code(await call("d1", "taxipress/driver/join", { routeId: kampalaToEntebbe, ...ENTEBBE })), "not_at_stage");
      assert.equal(await code(await call("d1", "taxipress/driver/join", { routeId: "nope", ...KAMPALA })), "route_not_found");
    });

    await t.test("taxis queue in the order they arrive", async () => {
      assert.equal((await call("d1", "taxipress/driver/join", { routeId: kampalaToEntebbe, ...KAMPALA })).status, 201);
      await client.execute("UPDATE taxipress_queue SET joined_at = datetime('now', '-5 minutes') WHERE driver_id = 'd1'");
      assert.equal((await call("d2", "taxipress/driver/join", { routeId: kampalaToEntebbe, ...KAMPALA })).status, 201);
      assert.equal(await code(await call("d1", "taxipress/driver/join", { routeId: kampalaToEntebbe, ...KAMPALA })), "already_in_line");
      const line = await json<{ line: Entry[] }>(await call("cust", `taxipress/routes/${kampalaToEntebbe}/queue`));
      assert.deepEqual(line.line.map((e) => [e.plate, e.position, e.status]), [["UAZ 111A", 1, "in_line"], ["UBB 222B", 2, "in_line"]]);
      assert.equal((await me("d2")).entry?.position, 2);
    });

    await t.test("only the taxi at the front boards, and only one at a time", async () => {
      assert.equal(await code(await call("d2", "taxipress/driver/boarding", {})), "not_first");
      assert.equal((await call("d1", "taxipress/driver/boarding", {})).status, 200);
      assert.equal(await code(await call("d2", "taxipress/driver/boarding", {})), "not_first");
      assert.equal((await me("d1")).entry?.status, "boarding");
    });

    await t.test("a taxi leaves only when every seat is booked", async () => {
      const early = await call("d1", "taxipress/driver/on-road", {});
      assert.equal(early.status, 409);
      assert.equal((await json<{ error: string }>(early)).error, "not_full");
      assert.equal((await me("d1")).canGoOnRoad, false);
      // Seats sold at the stage count.
      assert.equal((await call("d1", "taxipress/driver/walk-up", { delta: 14 })).status, 200);
      assert.equal(await code(await call("d1", "taxipress/driver/walk-up", { delta: 1 })), "no_seats_left");
      assert.equal((await call("d1", "taxipress/driver/walk-up", { delta: -2 })).status, 200);
      assert.equal(await code(await call("d1", "taxipress/driver/on-road", {})), "not_full");
      assert.equal((await call("d1", "taxipress/driver/walk-up", { delta: 2 })).status, 200);
      assert.equal((await me("d1")).canGoOnRoad, true);
      assert.equal(await code(await call("d1", "taxipress/driver/walk-up", { delta: 1 })), "no_seats_left");
      assert.equal((await call("d1", "taxipress/driver/on-road", {})).status, 200);
    });

    await t.test("the taxis behind move up when one leaves", async () => {
      const view = await me("d2");
      assert.equal(view.entry?.position, 1);
      const line = await json<{ line: Entry[]; onRoad: Entry[] }>(await call("cust", `taxipress/routes/${kampalaToEntebbe}/queue`));
      assert.deepEqual(line.line.map((e) => e.plate), ["UBB 222B"]);
      assert.deepEqual(line.onRoad.map((e) => e.plate), ["UAZ 111A"]);
      assert.equal(await code(await call("d1", "taxipress/driver/leave", {})), "wrong_state");
      assert.equal(await code(await call("d1", "taxipress/driver/walk-up", { delta: 1 })), "wrong_state");
    });

    await t.test("staff can let taxis leave early, or after a wait", async () => {
      assert.equal((await call("d2", "taxipress/driver/boarding", {})).status, 200);
      assert.equal(await code(await call("d2", "taxipress/driver/on-road", {})), "not_full");

      assert.equal((await setting({ departureRule: "after_wait", waitMinutes: 30 })).status, 200);
      assert.equal(await code(await call("d2", "taxipress/driver/on-road", {})), "not_full");
      await client.execute("UPDATE taxipress_queue SET boarding_at = datetime('now', '-40 minutes') WHERE driver_id = 'd2'");
      assert.equal((await me("d2")).canGoOnRoad, true);

      assert.equal((await setting({ departureRule: "driver_choice" })).status, 200);
      assert.equal((await call("d2", "taxipress/driver/on-road", {})).status, 200);
      assert.equal((await setting({ departureRule: "full_only" })).status, 200);
    });

    await t.test("arriving ends the trip, and the driver can join again", async () => {
      assert.equal((await call("d1", "taxipress/driver/arrive", {})).status, 200);
      assert.equal((await me("d1")).entry, null);
      assert.equal(await code(await call("d1", "taxipress/driver/arrive", {})), "not_in_line");
      assert.equal((await call("d1", "taxipress/driver/join", { routeId: kampalaToEntebbe, ...KAMPALA })).status, 201);
      assert.equal((await call("d1", "taxipress/driver/leave", {})).status, 200);
      assert.equal(await isInLine("d1"), false);
      assert.equal(await isInLine("d2"), true);
    });

    await t.test("a driver who owes too much is blocked when staff switch that on", async () => {
      assert.equal((await call("staff", `admin/taxipress/taxis/${(await me("d3")).taxi!.id}`, { status: "approved" })).status, 200);
      await client.execute("INSERT INTO riders (user_id, wallet_balance) VALUES ('d3', -5000) ON CONFLICT(user_id) DO UPDATE SET wallet_balance=excluded.wallet_balance");
      assert.equal((await call("d3", "taxipress/driver/join", { routeId: kampalaToEntebbe, ...KAMPALA })).status, 201, "allowed while the rule is off");
      assert.equal((await call("d3", "taxipress/driver/leave", {})).status, 200);
      assert.equal((await setting({ blockWhenOwing: true, maxOwedUgx: 1000 })).status, 200);
      assert.equal(await code(await call("d3", "taxipress/driver/join", { routeId: kampalaToEntebbe, ...KAMPALA })), "owing_too_much");
      await client.execute("UPDATE riders SET wallet_balance = -500 WHERE user_id = 'd3'");
      assert.equal((await call("d3", "taxipress/driver/join", { routeId: kampalaToEntebbe, ...KAMPALA })).status, 201);
      assert.equal((await call("d3", "taxipress/driver/leave", {})).status, 200);
    });

    await t.test("joining the line pauses car rides", async () => {
      await client.execute("INSERT INTO car_driver_state (driver_id, online) VALUES ('d3', 1)");
      assert.equal((await call("d3", "taxipress/driver/join", { routeId: kampalaToEntebbe, ...KAMPALA })).status, 201);
      const state = await client.execute("SELECT online FROM car_driver_state WHERE driver_id = 'd3'");
      assert.equal(Number(state.rows[0].online), 0);
    });

    await t.test("suspending a taxi, or staff removing it, takes it out of the line", async () => {
      const queue = await json<{ queue: Array<{ id: string; driverId: string }> }>(await call("staff", "admin/taxipress/queue"));
      assert.deepEqual(queue.queue.map((q) => q.driverId).sort(), ["d2", "d3"]);
      const d2 = queue.queue.find((q) => q.driverId === "d2")!;
      assert.equal((await call("staff", `admin/taxipress/queue/${d2.id}/remove`, {})).status, 200);
      assert.equal(await isInLine("d2"), false);
      assert.equal((await call("staff", `admin/taxipress/queue/${d2.id}/remove`, {})).status, 404);
      assert.equal((await call("d3", "admin/taxipress/queue")).status, 403);

      assert.equal((await call("staff", `admin/taxipress/taxis/${(await me("d3")).taxi!.id}`, { status: "suspended" })).status, 200);
      assert.equal(await isInLine("d3"), false);
      assert.equal(await code(await call("d3", "taxipress/driver/join", { routeId: kampalaToEntebbe, ...KAMPALA })), "taxi_not_approved");
    });

    await t.test("a taxi with passengers switched off cannot join; parcels-only is allowed", async () => {
      const taxi = (await me("d1")).taxi!;
      assert.equal((await call("staff", `admin/taxipress/taxis/${taxi.id}`, { passengersEnabled: false })).status, 200);
      assert.equal(await code(await call("d1", "taxipress/driver/join", { routeId: kampalaToEntebbe, ...KAMPALA })), "passengers_off");
      assert.equal((await call("staff", `admin/taxipress/taxis/${taxi.id}`, { passengersEnabled: true })).status, 200);
    });

    await t.test("until migration 0124 is applied it offers nothing and does not fail", async () => {
      await client.execute("DROP TABLE taxipress_queue");
      await client.execute("DROP TABLE taxipress_taxis");
      resetSchemaCache();
      const view = await me("d1");
      assert.equal(view.ready, false);
      assert.equal(view.taxi, null);
      assert.equal(await code(await call("d1", "taxipress/driver/join", { routeId: kampalaToEntebbe, ...KAMPALA })), "taxipress_unavailable");
      assert.equal(await isInLine("d1"), false);
    });
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    client.close();
  }
});
