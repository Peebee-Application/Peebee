import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { setBiddingSettings, setCarSettings, setMatchingModesEnabled, setPlatformEnvironment } from "../lib/settings.js";
import { resetSchemaCache } from "../lib/schema.js";
import { orderRoutes } from "../orders/routes.js";
import { riderRoutes } from "../riders/routes.js";
import { carAdminRoutes } from "./admin-routes.js";
import { carRoutes } from "./routes.js";
import { sweepScheduledRides, judgeDriver, validateScheduledFor } from "./scheduled.js";
import { resolveShares, splitPool } from "./service.js";

const SCHEDULED = { enabled: true, maxAdvanceHours: 72, minLeadMinutes: 30, openMinutes: 60, watchMinutes: 30, noSignalMinutes: 10, avgSpeedKmh: 25 };

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

test("profit split and share resolution", () => {
  assert.deepEqual(splitPool(5000, { owner: 60, driver: 30, platform: 10 }), { owner: 3000, driver: 1500, platform: 500 });
  // Rounding never loses or invents money: the platform keeps the remainder.
  const odd = splitPool(1001, { owner: 60, driver: 30, platform: 10 });
  assert.equal(odd.owner + odd.driver + odd.platform, 1001);
  const defaults = { owner: 60, driver: 30, platform: 10 };
  assert.deepEqual(resolveShares({ owner_share_percent: 50, driver_share_percent: 40, platform_share_percent: 10 }, defaults), { owner: 50, driver: 40, platform: 10 });
  assert.deepEqual(resolveShares({ owner_share_percent: 50, driver_share_percent: 40, platform_share_percent: 20 }, defaults), defaults, "a split not totalling 100 is ignored");
  assert.deepEqual(resolveShares({ owner_share_percent: 50, driver_share_percent: null, platform_share_percent: null }, defaults), defaults);
});

test("scheduled ride rules", () => {
  const now = new Date("2026-10-03T10:00:00Z");
  assert.ok("error" in validateScheduledFor("2026-10-03T10:10:00Z", SCHEDULED, now), "too soon");
  assert.ok("error" in validateScheduledFor("2026-10-07T10:00:00Z", SCHEDULED, now), "beyond the 72h window");
  assert.deepEqual(validateScheduledFor("2026-10-03T14:00:00Z", SCHEDULED, now), { at: "2026-10-03 14:00:00" });
  assert.ok("error" in validateScheduledFor("not a date", SCHEDULED, now));
  assert.equal(judgeDriver({ distanceKm: 2, minutesToPickup: 20, avgSpeedKmh: 25, lastPingAgeMinutes: 1, noSignalMinutes: 10 }).verdict, "on_track");
  assert.equal(judgeDriver({ distanceKm: 40, minutesToPickup: 20, avgSpeedKmh: 25, lastPingAgeMinutes: 1, noSignalMinutes: 10 }).verdict, "late_risk");
  assert.equal(judgeDriver({ distanceKm: 2, minutesToPickup: 20, avgSpeedKmh: 25, lastPingAgeMinutes: 30, noSignalMinutes: 10 }).verdict, "no_signal");
  assert.equal(judgeDriver({ distanceKm: null, minutesToPickup: 20, avgSpeedKmh: 25, lastPingAgeMinutes: null, noSignalMinutes: 10 }).verdict, "no_signal");
});

test("tuma car: category -> approvals -> assignment -> booking -> bid -> settle split", async (t) => {
  process.env.JWT_SECRET = "local-car-test-secret-only";
  resetSchemaCache();
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);

  for (const [id, role] of [["cust", "customer"], ["owner", "customer"], ["drv", "customer"], ["boda", "rider"], ["admin", "admin"]]) {
    await client.execute({ sql: "INSERT INTO users (id, phone, name, password_hash, role) VALUES (?, ?, ?, 'h', ?)", args: [id, id, id, role] });
  }
  await client.execute("UPDATE users SET admin_role = 'super_admin' WHERE id = 'admin'");
  await client.execute("INSERT INTO riders (user_id, verified, is_online) VALUES ('boda', 1, 1)");

  const app = new Hono().route("/v1", orderRoutes).route("/v1", carRoutes).route("/v1", carAdminRoutes).route("/v1", riderRoutes);
  const tokens: Record<string, string> = {};
  for (const [id, role] of [["cust", "customer"], ["owner", "customer"], ["drv", "customer"], ["boda", "rider"], ["admin", "admin"]] as const) {
    tokens[id] = await signToken({ sub: id, role });
  }
  const call = (method: string, path: string, who: string, body?: unknown) =>
    app.request(`/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${tokens[who]}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const json = async (res: Response) => (await res.json()) as Record<string, any>;

  const trip = { pickupLat: 0.3, pickupLng: 32.58, destinationLat: 0.35, destinationLng: 32.58, pickupAddress: "A", destinationAddress: "B" };
  let categoryId = "";
  let vehicleId = "";
  let orderId = "";

  await t.test("everything is closed until an admin switches Car on", async () => {
    assert.equal((await call("GET", "/car/config", "cust")).status, 403);
    await setCarSettings({ enabled: true, onDemandEnabled: true, matchingMode: "customer_selects", shares: { owner: 60, driver: 30, platform: 10 }, maxPickupKm: 10, withdrawalsEnabled: true, withdrawalMinAmount: 1000, scheduled: SCHEDULED });
    await setBiddingSettings({ enabled: true, minPercent: 50, maxPercent: 150 });
    await setMatchingModesEnabled(["first_to_claim"]); // boda riders' own modes must not matter for cars
    assert.equal((await call("GET", "/car/config", "cust")).status, 200);
  });

  await t.test("admin defines a category; a split that doesn't total 100 is refused", async () => {
    const base = { kind: "passenger", name: "Sedan", seats: 4, ratePerKm: 1000, minimumFare: 3000, active: true, sort: 1 };
    assert.equal((await call("POST", "/admin/car/categories", "admin", { ...base, ownerSharePercent: 50, driverSharePercent: 30, platformSharePercent: 30 })).status, 400);
    assert.equal((await call("POST", "/admin/car/categories", "cust", base)).status, 403);
    const res = await call("POST", "/admin/car/categories", "admin", base);
    assert.equal(res.status, 201);
    categoryId = (await json(res)).id;
  });

  await t.test("owner and driver apply, a manager approves, the vehicle is approved and a driver assigned", async () => {
    assert.equal((await call("POST", "/car/vehicles", "owner", { categoryId, plate: "UAA 001A" })).status, 403, "must be an approved owner first");
    assert.equal((await call("POST", "/car/partner/apply", "owner", { as: "owner" })).status, 201);
    assert.equal((await call("POST", "/car/partner/apply", "drv", { as: "driver", licenceExpiry: "2030-01-01" })).status, 201);
    assert.equal((await call("POST", "/car/partner/apply", "drv", { as: "driver" })).status, 409);
    assert.equal((await call("POST", "/admin/car/partners/owner/decision", "admin", { role: "owner", status: "approved" })).status, 200);
    assert.equal((await call("POST", "/admin/car/partners/drv/decision", "admin", { role: "driver", status: "approved" })).status, 200);

    const added = await call("POST", "/car/vehicles", "owner", { categoryId, plate: "UAA 001A", make: "Toyota", model: "Premio" });
    assert.equal(added.status, 201);
    vehicleId = (await json(added)).id;
    assert.equal((await call("POST", "/car/vehicles", "owner", { categoryId, plate: "UAA 001A" })).status, 409, "plate is unique");

    assert.equal((await call("POST", "/car/driver/online", "drv", { online: true })).status, 409, "no vehicle yet");
    assert.equal((await call("POST", `/admin/car/vehicles/${vehicleId}/assign`, "admin", { driverId: "drv" })).status, 409, "vehicle must be approved first");
    assert.equal((await call("POST", `/admin/car/vehicles/${vehicleId}/decision`, "admin", { status: "approved" })).status, 200);
    assert.equal((await call("POST", `/admin/car/vehicles/${vehicleId}/assign`, "admin", { driverId: "drv" })).status, 200);
    assert.equal((await call("POST", "/car/driver/online", "drv", { online: true, lat: 0.3, lng: 32.58 })).status, 200);
  });

  await t.test("booking prices from the category and never reaches boda riders", async () => {
    const quote = await json(await call("POST", "/car/quote", "cust", { categoryId, ...trip }));
    assert.ok(quote.fare >= 5000 && quote.fare <= 6000, `fare ${quote.fare}`);
    const res = await call("POST", "/car/bookings", "cust", { categoryId, ...trip });
    assert.equal(res.status, 201);
    const order = (await json(res)).order;
    orderId = order.id;
    assert.equal(order.estimated_total, quote.fare);
    assert.equal(order.matching_mode, "customer_selects");
    assert.equal(order.payment_rail, "escrow");
    assert.equal(order.is_ride, 1);

    const feed = await json(await call("GET", "/riders/jobs/available", "boda"));
    assert.equal(feed.jobs.length, 0, "car rides are not in the boda feed");
    assert.equal((await call("POST", `/orders/${orderId}/apply`, "boda", {})).status, 403);
    assert.equal((await call("POST", `/orders/${orderId}/claim`, "boda")).status, 403);
  });

  await t.test("the driver bids, the customer picks, the bid becomes the price and the owner sees the ride", async () => {
    const jobs = await json(await call("GET", "/car/driver/jobs", "drv"));
    assert.equal(jobs.jobs.length, 1);
    assert.ok(jobs.jobs[0].bidding, "bidding is offered");
    assert.equal((await call("POST", `/car/orders/${orderId}/apply`, "drv", { bidAmount: 100 })).status, 400, "outside the admin's limits");
    assert.equal((await call("POST", `/car/orders/${orderId}/apply`, "drv", { bidAmount: 5000 })).status, 200);

    const applicants = await json(await call("GET", `/orders/${orderId}/applicants`, "cust"));
    assert.equal(applicants.applicants.length, 1);
    assert.equal(applicants.applicants[0].price, 5000);

    assert.equal((await call("POST", `/orders/${orderId}/applicants/drv/select`, "cust")).status, 200);
    const order = (await client.execute({ sql: "SELECT rider_id, estimated_total FROM orders WHERE id = ?", args: [orderId] })).rows[0];
    assert.equal(order.rider_id, "drv");
    assert.equal(order.estimated_total, 5000);

    const owner = await json(await call("GET", "/car/owner/rides", "owner"));
    assert.equal(owner.rides.length, 1);
    assert.equal(owner.rides[0].driver_name, "drv");
  });

  await t.test("settling splits the pool between owner, driver and platform", async () => {
    await client.execute({ sql: "INSERT INTO payments (id, order_id, type, amount, status) VALUES ('pay1', ?, 'collection', 5000, 'successful')", args: [orderId] });
    await client.execute({ sql: "UPDATE orders SET stage = 'Handover' WHERE id = ?", args: [orderId] });
    const res = await call("POST", `/orders/${orderId}/settle`, "drv");
    assert.equal(res.status, 200);

    const booking = (await client.execute({ sql: "SELECT * FROM car_bookings WHERE order_id = ?", args: [orderId] })).rows[0];
    assert.equal(booking.status, "completed");
    assert.equal(booking.owner_amount, 3000);
    assert.equal(booking.driver_amount, 1500);
    assert.equal(booking.platform_amount, 500);
    const balances = Object.fromEntries((await client.execute("SELECT id, wallet_balance FROM users WHERE id IN ('owner', 'drv')")).rows.map((r) => [r.id, r.wallet_balance]));
    assert.equal(balances.owner, 3000);
    assert.equal(balances.drv, 1500);

    // A second settle can never pay twice.
    await client.execute({ sql: "UPDATE orders SET stage = 'Handover' WHERE id = ?", args: [orderId] });
    await call("POST", `/orders/${orderId}/settle`, "drv");
    const again = Object.fromEntries((await client.execute("SELECT id, wallet_balance FROM users WHERE id IN ('owner', 'drv')")).rows.map((r) => [r.id, r.wallet_balance]));
    assert.equal(again.owner, 3000);
  });

  await t.test("owners and drivers can cash out only what they earned", async () => {
    // Cash-out runs through the sandbox payout adapter here, so give the owner sandbox earnings:
    // a settled sandbox car ride worth 3,000, plus 10,000 they topped up themselves (store credit, not earnings).
    await setPlatformEnvironment("sandbox");
    await client.execute("INSERT INTO lists (id, customer_id, title) VALUES ('lsbx', 'cust', 'sbx')");
    await client.execute("INSERT INTO orders (id, list_id, customer_id, type, environment) VALUES ('osbx', 'lsbx', 'cust', 'parcel', 'sandbox')");
    await client.execute(`INSERT INTO car_bookings (id, order_id, customer_id, category_id, status, owner_id, driver_id, owner_amount, driver_amount, environment)
                          VALUES ('cbsbx', 'osbx', 'cust', '${categoryId}', 'completed', 'owner', 'drv', 3000, 1500, 'sandbox')`);
    await client.execute("UPDATE users SET wallet_balance_sandbox = 13000 WHERE id = 'owner'");

    const wallet = await json(await call("GET", "/car/wallet", "owner"));
    assert.equal(wallet.balance, 13000);
    assert.equal(wallet.withdrawable, 3000, "only the 3,000 earned from rides");
    assert.equal(wallet.withdrawalsEnabled, true);

    assert.equal((await call("POST", "/car/wallet/withdraw", "owner", { amount: 500 })).status, 400, "below the admin's minimum");
    assert.equal((await call("POST", "/car/wallet/withdraw", "owner", { amount: 5000 })).status, 409, "more than earned");
    assert.equal((await call("POST", "/car/wallet/withdraw", "owner", { amount: 2000 })).status, 409, "needs a saved number");

    await client.execute("INSERT INTO saved_mobile_numbers (id, owner_id, purpose, phone, label, is_primary) VALUES ('n1', 'owner', 'withdrawal', '0772000001', 'mine', 1)");
    const ok = await call("POST", "/car/wallet/withdraw", "owner", { amount: 2000 });
    assert.equal(ok.status, 201);
    const after = await json(await call("GET", "/car/wallet", "owner"));
    assert.equal(after.balance, 11000);
    assert.equal(after.withdrawable, 1000, "the pending withdrawal counts against what's left");
    assert.equal((await call("POST", "/car/wallet/withdraw", "owner", { amount: 2000 })).status, 409);

    await setCarSettings({ enabled: true, onDemandEnabled: true, matchingMode: "customer_selects", shares: { owner: 60, driver: 30, platform: 10 }, maxPickupKm: 10, withdrawalsEnabled: false, withdrawalMinAmount: 1000, scheduled: SCHEDULED });
    assert.equal((await call("POST", "/car/wallet/withdraw", "owner", { amount: 1000 })).status, 403, "closed when the admin switches it off");
  });

  await t.test("scheduled rides open to drivers near pickup, are watched, and can be re-matched", async () => {
    await setPlatformEnvironment("live");
    await setCarSettings({ enabled: true, onDemandEnabled: true, matchingMode: "customer_selects", shares: { owner: 60, driver: 30, platform: 10 }, maxPickupKm: 10, withdrawalsEnabled: false, withdrawalMinAmount: 0, scheduled: SCHEDULED });
    const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

    assert.equal((await call("POST", "/car/bookings", "cust", { categoryId, ...trip, scheduledFor: inHours(0.1) })).status, 400, "less than the minimum notice");
    assert.equal((await call("POST", "/car/bookings", "cust", { categoryId, ...trip, scheduledFor: inHours(200) })).status, 400, "beyond the window");
    await setCarSettings({ enabled: true, onDemandEnabled: true, matchingMode: "customer_selects", shares: { owner: 60, driver: 30, platform: 10 }, maxPickupKm: 10, withdrawalsEnabled: false, withdrawalMinAmount: 0, scheduled: { ...SCHEDULED, maxAdvanceHours: null } });
    assert.equal((await call("POST", "/car/bookings", "cust", { categoryId, ...trip, scheduledFor: inHours(3) })).status, 403, "off until the admin sets a window");
    const config = await json(await call("GET", "/car/config", "cust"));
    assert.equal(config.scheduled, null);
    await setCarSettings({ enabled: true, onDemandEnabled: true, matchingMode: "customer_selects", shares: { owner: 60, driver: 30, platform: 10 }, maxPickupKm: 10, withdrawalsEnabled: false, withdrawalMinAmount: 0, scheduled: SCHEDULED });
    assert.equal((await json(await call("GET", "/car/config", "cust"))).scheduled.maxAdvanceHours, 72);

    const res = await call("POST", "/car/bookings", "cust", { categoryId, ...trip, scheduledFor: inHours(3) });
    assert.equal(res.status, 201);
    const orderId = (await json(res)).order.id as string;
    const stored = (await client.execute({ sql: "SELECT scheduled_for FROM car_bookings WHERE order_id = ?", args: [orderId] })).rows[0];
    assert.ok(stored.scheduled_for, "pickup time stored");

    await client.execute("UPDATE car_driver_state SET online = 1, lat = 0.3, lng = 32.58, updated_at = datetime('now') WHERE driver_id = 'drv'");
    assert.equal((await json(await call("GET", "/car/driver/jobs", "drv"))).jobs.length, 0, "hidden until it opens");
    assert.equal((await call("POST", `/car/orders/${orderId}/apply`, "drv", {})).status, 409);

    // The job also isn't expired while it waits: its clock starts at pickup time.
    await client.execute({ sql: "UPDATE orders SET created_at = datetime('now', '-30 hours') WHERE id = ?", args: [orderId] });
    const { sweepExpiredOrders } = await import("../orders/expiry.js");
    await sweepExpiredOrders();
    assert.equal((await client.execute({ sql: "SELECT stage FROM orders WHERE id = ?", args: [orderId] })).rows[0].stage, "Create", "not expired before pickup time");

    await client.execute({ sql: "UPDATE car_bookings SET scheduled_for = datetime('now', '+40 minutes') WHERE order_id = ?", args: [orderId] });
    assert.equal((await json(await call("GET", "/car/driver/jobs", "drv"))).jobs.length, 1, "open within the opening window");
    assert.equal((await call("POST", `/car/orders/${orderId}/apply`, "drv", {})).status, 200);
    assert.equal((await call("POST", `/orders/${orderId}/applicants/drv/select`, "cust")).status, 200);

    // Driver is 55 km away with 10 minutes to go: the check warns the customer once.
    await client.execute({ sql: "UPDATE car_bookings SET scheduled_for = datetime('now', '+10 minutes') WHERE order_id = ?", args: [orderId] });
    await client.execute("UPDATE car_driver_state SET lat = 0.8, lng = 32.58, updated_at = datetime('now') WHERE driver_id = 'drv'");
    const first = await sweepScheduledRides();
    assert.equal(first.warned, 1);
    const second = await sweepScheduledRides();
    assert.equal(second.warned, 0, "only warned once");
    assert.equal((await client.execute({ sql: "SELECT verdict FROM scheduled_checks WHERE order_id = ?", args: [orderId] })).rows[0].verdict, "late_risk");

    // The customer swaps the driver: ride returns to the pool and that driver can't re-apply.
    assert.equal((await call("POST", `/car/bookings/${orderId}/rematch`, "drv")).status, 403, "only the customer can re-match");
    assert.equal((await call("POST", `/car/bookings/${orderId}/rematch`, "cust")).status, 200);
    const back = (await client.execute({ sql: "SELECT rider_id, stage FROM orders WHERE id = ?", args: [orderId] })).rows[0];
    assert.equal(back.rider_id, null);
    assert.equal(back.stage, "Create");
    assert.equal((await call("POST", `/car/orders/${orderId}/apply`, "drv", {})).status, 403);
  });
});
