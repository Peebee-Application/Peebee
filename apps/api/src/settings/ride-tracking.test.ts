import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { DEFAULT_RIDE_TRACKING_SETTINGS, isFreshLocation, locationTimestamp, rideIsEnRoute, travelMinutes } from "@peebee/shared";
import { rideTrackingSchema } from "./ride-tracking.js";
import { settingsRoutes } from "./routes.js";
import { orderRoutes } from "../orders/routes.js";
import { assignAvailableRider } from "../orders/assignment.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { resetSchemaCache } from "../lib/schema.js";
import { setSetting } from "../lib/settings.js";
import { signToken } from "../auth/jwt.js";

test("location freshness handles D1 timestamps, offsets, missing and stale GPS", () => {
  const now = Date.parse("2026-10-06T12:00:30Z");
  assert.equal(locationTimestamp("2026-10-06 12:00:00"), Date.parse("2026-10-06T12:00:00Z"));
  assert.equal(isFreshLocation("2026-10-06 12:00:00", now, 60), true);
  assert.equal(isFreshLocation("2026-10-06T15:00:00+03:00", now, 60), true);
  assert.equal(isFreshLocation("2026-10-06T11:59:00Z", now, 60), false);
  assert.equal(isFreshLocation("2026-10-06T13:00:00Z", now, 60), false);
  assert.equal(isFreshLocation(null, now, 60), false);
  assert.equal(isFreshLocation("invalid", now, 60), false);
});

test("pickup and destination routing follow ride stages and round travel estimates safely", () => {
  for (const stage of ["Match", "Shop", "Approve"]) assert.equal(rideIsEnRoute(stage), false);
  for (const stage of ["Deliver", "Arrived", "Handover", "Settle"]) assert.equal(rideIsEnRoute(stage), true);
  assert.equal(travelMinutes(61), 2);
  assert.equal(travelMinutes(0), 1);
  assert.equal(travelMinutes(NaN), null);
  assert.equal(travelMinutes(-1), null);
});

test("tracking settings reject excessive request rates and incompatible stale thresholds", () => {
  assert.equal(rideTrackingSchema.safeParse(DEFAULT_RIDE_TRACKING_SETTINGS).success, true);
  assert.equal(rideTrackingSchema.safeParse({ ...DEFAULT_RIDE_TRACKING_SETTINGS, locationIntervalSeconds: 0 }).success, false);
  assert.equal(rideTrackingSchema.safeParse({ ...DEFAULT_RIDE_TRACKING_SETTINGS, routeRefreshSeconds: 1 }).success, false);
  assert.equal(rideTrackingSchema.safeParse({ ...DEFAULT_RIDE_TRACKING_SETTINGS, locationIntervalSeconds: 30, staleAfterSeconds: 15 }).success, false);
});

test("journey location is assigned-rider only, stops on completion/disable, and clears on reassignment", async () => {
  process.env.JWT_SECRET = "local-tracking-tests-only";
  resetSchemaCache();
  const client = createClient({ url: "file::memory:" });
  const prepare = (sql: string) => ({
    sql, args: [] as unknown[],
    bind(...args: unknown[]) { this.args = args; return this; },
    async all() { const r = await client.execute({ sql: this.sql, args: this.args as InArgs }); return { results: r.rows, success: true, meta: { changes: r.rowsAffected, last_row_id: Number(r.lastInsertRowid ?? 0) } }; },
  });
  try {
    const migrations = join(process.cwd(), "src/db/migrations");
    for (const file of readdirSync(migrations).filter((file) => file.endsWith(".sql")).sort()) {
      for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
    }
    setD1Binding({ prepare, async batch(statements: ReturnType<typeof prepare>[]) {
      const results = await client.batch(statements.map(({ sql, args }) => ({ sql, args: args as InArgs })), "write");
      return results.map((r) => ({ results: r.rows, success: true, meta: { changes: r.rowsAffected, last_row_id: Number(r.lastInsertRowid ?? 0) } }));
    } } as unknown as D1Database);
    await client.execute("INSERT INTO users (id,phone,name,password_hash,role,admin_role) VALUES ('a','a','Admin','h','admin','super_admin'),('c','c','Customer','h','customer',NULL),('r','r','Rider','h','rider',NULL),('r2','r2','Rider 2','h','rider',NULL)");
    await client.execute("INSERT INTO lists (id,customer_id,title) VALUES ('l','c','Ride')");
    await client.execute("INSERT INTO orders (id,list_id,customer_id,rider_id,stage,is_ride,environment) VALUES ('o','l','c','r','Match',1,'live')");
    const app = new Hono().route("/v1", settingsRoutes).route("/v1", orderRoutes);
    const tokens = {
      admin: await signToken({ sub: "a", role: "admin" }),
      customer: await signToken({ sub: "c", role: "customer" }),
      rider: await signToken({ sub: "r", role: "rider" }),
      other: await signToken({ sub: "r2", role: "rider" }),
    };
    const request = (token: string, url: string, method: string, body: unknown) => app.request(url, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const location = (token: string, body = { lat: 0.31, lng: 32.58 }) => request(token, "/v1/orders/o/location", "POST", body);
    assert.equal((await location(tokens.customer)).status, 403);
    assert.equal((await location(tokens.other)).status, 403);
    assert.equal((await location(tokens.rider, { lat: 91, lng: 32 })).status, 400);
    assert.equal((await location(tokens.rider)).status, 200);
    assert.equal((await client.execute("SELECT rider_lat FROM orders WHERE id='o'")).rows[0].rider_lat, 0.31);
    assert.equal((await request(tokens.customer, "/v1/admin/settings", "PUT", { rideTracking: DEFAULT_RIDE_TRACKING_SETTINGS })).status, 403);
    assert.equal((await request(tokens.admin, "/v1/admin/settings", "PUT", { rideTracking: { ...DEFAULT_RIDE_TRACKING_SETTINGS, locationIntervalSeconds: 1 } })).status, 400);
    const config = { ...DEFAULT_RIDE_TRACKING_SETTINGS, enabled: false };
    assert.equal((await request(tokens.admin, "/v1/admin/settings", "PUT", { rideTracking: config })).status, 200);
    const response = await app.request("/v1/settings", { headers: { Authorization: `Bearer ${tokens.customer}` } });
    const data = await response.json() as { settings: { rideTracking: unknown } };
    assert.deepEqual(data.settings.rideTracking, config);
    assert.ok((await client.execute("SELECT * FROM admin_activity_log")).rows.length > 0);
    assert.equal((await location(tokens.rider)).status, 409);
    await setSetting("ride_tracking", JSON.stringify(DEFAULT_RIDE_TRACKING_SETTINGS));
    for (const stage of ["Settle", "Cancelled", "Handover"]) {
      await client.execute({ sql: "UPDATE orders SET stage=? WHERE id='o'", args: [stage] });
      assert.equal((await location(tokens.rider)).status, 409);
    }
    await client.execute("UPDATE orders SET rider_id=NULL,stage='Match' WHERE id='o'");
    assert.equal(await assignAvailableRider("o", "r2", "Match", false, "live"), true);
    const row = (await client.execute("SELECT rider_lat,rider_lng,rider_location_updated_at FROM orders WHERE id='o'")).rows[0];
    assert.equal(row.rider_lat, null); assert.equal(row.rider_lng, null); assert.equal(row.rider_location_updated_at, null);
  } finally { setD1Binding(undefined); client.close(); }
});
