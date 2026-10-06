import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { setR2Binding } from "../storage/r2.js";
import { setBiddingSettings, setCarSettings, setMatchingModesEnabled, setPlatformEnvironment } from "../lib/settings.js";
import { resetSchemaCache } from "../lib/schema.js";
import { orderRoutes } from "../orders/routes.js";
import { riderRoutes } from "../riders/routes.js";
import { carAdminRoutes } from "./admin-routes.js";
import { carRoutes } from "./routes.js";
import { carpoolRoutes, releaseStaleSeats } from "./carpool.js";
import { rentalDays, settleRental, sweepRentalRequests } from "./selfdrive.js";
import { selfDriveRoutes } from "./selfdrive.js";
import { sweepScheduledRides, judgeDriver, validateScheduledFor } from "./scheduled.js";
import { dealRoutes } from "./deals.js";
import { rentDue, resolveShares, settleCarBooking, splitPool, splitWithDeal } from "./service.js";

const SCHEDULED = { enabled: true, maxAdvanceHours: 72, minLeadMinutes: 30, openMinutes: 60, watchMinutes: 30, noSignalMinutes: 10, avgSpeedKmh: 25 };

const CARPOOL = { enabled: true, maxSeatsPerBooking: 3, maxRepeatWeeks: 2, cutoffMinutes: 15, payWithinMinutes: 15, matchRadiusKm: 10 };

const SELFDRIVE = { enabled: true, platformPercent: 10, maxDays: 7, minDeposit: 50000, approveWithinHours: 12 };

const DEALS = { enabled: true, shareEnabled: true, rentEnabled: true, minOwnerSharePercent: 40, maxOwnerSharePercent: 80, maxRentPerDay: 0 };
const KYC = { ownerIdRequired: false, driverIdRequired: false, driverLicenceRequired: false };
const PHOTOS = { max: 8, minRequired: 0 };

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

test("agreed-deal money rules", () => {
  const shares = { owner: 60, driver: 30, platform: 10 };
  const share = { feeType: "share" as const, ownerSharePercent: 70, rentAmount: null, rentPeriod: null };
  const rent = { feeType: "rent" as const, ownerSharePercent: null, rentAmount: 1000, rentPeriod: "day" as const };
  assert.deepEqual(splitWithDeal(5000, shares, null, 0), { owner: 3000, driver: 1500, platform: 500, rentCollected: 0 }, "no agreement: the default split");
  assert.deepEqual(splitWithDeal(5000, shares, share, 0), { owner: 3150, driver: 1350, platform: 500, rentCollected: 0 }, "70% of what's left after Peebee's 10%");
  assert.deepEqual(splitWithDeal(5000, shares, rent, 1000), { owner: 1000, driver: 3500, platform: 500, rentCollected: 1000 });
  assert.deepEqual(splitWithDeal(5000, shares, rent, 0), { owner: 0, driver: 4500, platform: 500, rentCollected: 0 }, "rent already paid: the driver keeps it all");
  assert.deepEqual(splitWithDeal(900, shares, rent, 5000), { owner: 810, driver: 0, platform: 90, rentCollected: 810 }, "rent is capped at what the ride leaves");
  const odd = splitWithDeal(1001, shares, share, 0);
  assert.equal(odd.owner + odd.driver + odd.platform, 1001, "always adds up");
  const start = new Date("2026-10-01T10:00:00Z");
  assert.equal(rentDue(rent, start, 0, new Date("2026-10-01T12:00:00Z")), 1000, "the first day is charged from the start");
  assert.equal(rentDue(rent, start, 0, new Date("2026-10-03T11:00:00Z")), 3000, "three started days");
  assert.equal(rentDue(rent, start, 3000, new Date("2026-10-03T11:00:00Z")), 0);
  assert.equal(rentDue(share, start, 0, new Date("2026-10-09T09:00:00Z")), 0, "a share deal never owes rent");
});

test("self-drive money rules", () => {
  assert.equal(rentalDays(new Date("2026-10-05T10:00:00Z"), new Date("2026-10-05T18:00:00Z")), 1);
  assert.equal(rentalDays(new Date("2026-10-05T10:00:00Z"), new Date("2026-10-07T10:00:01Z")), 3);
  const clean = settleRental({ rent: 100000, deposit: 50000, platformPercent: 10, damage: 0 });
  assert.deepEqual(clean, { damage: 0, platform: 10000, owner: 90000, refund: 50000 });
  const damaged = settleRental({ rent: 100000, deposit: 50000, platformPercent: 10, damage: 20000 });
  assert.equal(damaged.owner + damaged.platform + damaged.refund, 150000, "held money is fully accounted for");
  assert.equal(settleRental({ rent: 100000, deposit: 50000, platformPercent: 10, damage: 99999 }).damage, 50000, "damage can't exceed the deposit");
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

test("peebee car: category -> approvals -> assignment -> booking -> bid -> settle split", async (t) => {
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

  const app = new Hono().route("/v1", orderRoutes).route("/v1", carRoutes).route("/v1", carpoolRoutes).route("/v1", selfDriveRoutes).route("/v1", dealRoutes).route("/v1", carAdminRoutes).route("/v1", riderRoutes);
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
    await setCarSettings({ enabled: true, onDemandEnabled: true, matchingMode: "customer_selects", shares: { owner: 60, driver: 30, platform: 10 }, maxPickupKm: 10, withdrawalsEnabled: true, withdrawalMinAmount: 1000, scheduled: SCHEDULED, carpool: CARPOOL, selfDrive: SELFDRIVE, vehiclePhotos: PHOTOS, kyc: KYC, deals: DEALS });
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

    await setCarSettings({ enabled: true, onDemandEnabled: true, matchingMode: "customer_selects", shares: { owner: 60, driver: 30, platform: 10 }, maxPickupKm: 10, withdrawalsEnabled: false, withdrawalMinAmount: 1000, scheduled: SCHEDULED, carpool: CARPOOL, selfDrive: SELFDRIVE, vehiclePhotos: PHOTOS, kyc: KYC, deals: DEALS });
    assert.equal((await call("POST", "/car/wallet/withdraw", "owner", { amount: 1000 })).status, 403, "closed when the admin switches it off");
  });

  await t.test("scheduled rides open to drivers near pickup, are watched, and can be re-matched", async () => {
    await setPlatformEnvironment("live");
    await setCarSettings({ enabled: true, onDemandEnabled: true, matchingMode: "customer_selects", shares: { owner: 60, driver: 30, platform: 10 }, maxPickupKm: 10, withdrawalsEnabled: false, withdrawalMinAmount: 0, scheduled: SCHEDULED, carpool: CARPOOL, selfDrive: SELFDRIVE, vehiclePhotos: PHOTOS, kyc: KYC, deals: DEALS });
    const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

    assert.equal((await call("POST", "/car/bookings", "cust", { categoryId, ...trip, scheduledFor: inHours(0.1) })).status, 400, "less than the minimum notice");
    assert.equal((await call("POST", "/car/bookings", "cust", { categoryId, ...trip, scheduledFor: inHours(200) })).status, 400, "beyond the window");
    await setCarSettings({ enabled: true, onDemandEnabled: true, matchingMode: "customer_selects", shares: { owner: 60, driver: 30, platform: 10 }, maxPickupKm: 10, withdrawalsEnabled: false, withdrawalMinAmount: 0, scheduled: { ...SCHEDULED, maxAdvanceHours: null }, carpool: CARPOOL, selfDrive: SELFDRIVE, vehiclePhotos: PHOTOS, kyc: KYC, deals: DEALS });
    assert.equal((await call("POST", "/car/bookings", "cust", { categoryId, ...trip, scheduledFor: inHours(3) })).status, 403, "off until the admin sets a window");
    const config = await json(await call("GET", "/car/config", "cust"));
    assert.equal(config.scheduled, null);
    await setCarSettings({ enabled: true, onDemandEnabled: true, matchingMode: "customer_selects", shares: { owner: 60, driver: 30, platform: 10 }, maxPickupKm: 10, withdrawalsEnabled: false, withdrawalMinAmount: 0, scheduled: SCHEDULED, carpool: CARPOOL, selfDrive: SELFDRIVE, vehiclePhotos: PHOTOS, kyc: KYC, deals: DEALS });
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

  await t.test("carpool: publish a trip, book seats without overselling, pay window and cancellation release seats", async () => {
    await setPlatformEnvironment("live");
    await setCarSettings({ enabled: true, onDemandEnabled: true, matchingMode: "customer_selects", shares: { owner: 60, driver: 30, platform: 10 }, maxPickupKm: 10, withdrawalsEnabled: false, withdrawalMinAmount: 0, scheduled: SCHEDULED, carpool: { ...CARPOOL, enabled: false }, selfDrive: SELFDRIVE, vehiclePhotos: PHOTOS, kyc: KYC, deals: DEALS });
    await client.execute("INSERT INTO users (id, phone, name, password_hash, role) VALUES ('p2', 'p2', 'p2', 'h', 'customer')");
    tokens.p2 = await signToken({ sub: "p2", role: "customer" });
    const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
    const trip = { originLabel: "Kampala", originLat: 0.3136, originLng: 32.5811, destLabel: "Jinja", destLat: 0.4479, destLng: 33.2026, departAt: inHours(24), seats: 3, seatPrice: 15000 };

    assert.equal((await call("POST", "/car/carpool/trips", "drv", trip)).status, 403, "closed until the admin enables carpool");
    await setCarSettings({ enabled: true, onDemandEnabled: true, matchingMode: "customer_selects", shares: { owner: 60, driver: 30, platform: 10 }, maxPickupKm: 10, withdrawalsEnabled: false, withdrawalMinAmount: 0, scheduled: SCHEDULED, carpool: CARPOOL, selfDrive: SELFDRIVE, vehiclePhotos: PHOTOS, kyc: KYC, deals: DEALS });

    assert.equal((await call("POST", "/car/carpool/trips", "cust", trip)).status, 409, "only drivers with a vehicle");
    assert.equal((await call("POST", "/car/carpool/trips", "drv", { ...trip, seats: 9 })).status, 400, "the car holds 4 seats at most");
    assert.equal((await call("POST", "/car/carpool/trips", "drv", { ...trip, departAt: inHours(0.05) })).status, 400, "too soon");
    assert.equal((await call("POST", "/car/carpool/trips", "drv", { ...trip, repeatWeeks: 3 })).status, 400, "beyond the admin's repeat limit");
    const made = await call("POST", "/car/carpool/trips", "drv", { ...trip, repeatWeeks: 1 });
    assert.equal(made.status, 201);
    const ids = (await json(made)).ids as string[];
    assert.equal(ids.length, 2, "weekly repeat creates a trip per week");
    const tripId = ids[0];

    const q = "fromLat=0.32&fromLng=32.59&toLat=0.45&toLng=33.2";
    const found = await json(await call("GET", `/car/carpool/trips?${q}`, "cust"));
    assert.equal(found.trips.length, 2);
    assert.equal(found.trips[0].seatsLeft, 3);
    assert.equal((await json(await call("GET", "/car/carpool/trips?fromLat=1.7&fromLng=31.4&toLat=1.8&toLng=31.5", "cust"))).trips.length, 0, "other routes don't match");

    assert.equal((await call("POST", `/car/carpool/trips/${tripId}/seats`, "cust", { seats: 4 })).status, 400, "above the per-booking limit");
    assert.equal((await call("POST", `/car/carpool/trips/${tripId}/seats`, "drv", { seats: 1 })).status, 409, "not your own trip");
    const booked = await call("POST", `/car/carpool/trips/${tripId}/seats`, "cust", { seats: 2 });
    assert.equal(booked.status, 201);
    const bookedOrder = (await json(booked)).order;
    assert.equal(bookedOrder.estimated_total, 30000);
    assert.equal(bookedOrder.rider_id, "drv", "the seat belongs to the trip's driver");
    assert.equal((await call("POST", `/car/carpool/trips/${tripId}/seats`, "p2", { seats: 2 })).status, 409, "only one seat left: no overselling");
    const last = await call("POST", `/car/carpool/trips/${tripId}/seats`, "p2", { seats: 1 });
    assert.equal(last.status, 201);
    assert.equal((await client.execute({ sql: "SELECT status FROM carpool_trips WHERE id = ?", args: [tripId] })).rows[0].status, "full");
    assert.equal((await json(await call("GET", `/car/carpool/trips?${q}`, "cust"))).trips.length, 1, "a full trip leaves the search");

    const mine = await json(await call("GET", "/car/carpool/my-trips", "drv"));
    assert.equal(mine.trips[0].passengers.length, 2);

    // The booking is a car booking: not in the boda feed, and it settles with the owner/driver split.
    assert.equal((await json(await call("GET", "/riders/jobs/available", "boda"))).jobs.length, 0);

    // A passenger cancels: the seats come back.
    const secondOrder = (await json(last)).order.id as string;
    await client.execute({ sql: "UPDATE orders SET stage = 'Cancelled' WHERE id = ?", args: [secondOrder] });
    assert.equal(await releaseStaleSeats(), 1);
    assert.equal((await client.execute({ sql: "SELECT status, seats_taken FROM carpool_trips WHERE id = ?", args: [tripId] })).rows[0].seats_taken, 2);
    assert.equal((await client.execute({ sql: "SELECT status FROM carpool_trips WHERE id = ?", args: [tripId] })).rows[0].status, "open");

    // Not paid within the window: the seat is released too.
    await client.execute({ sql: "UPDATE carpool_seats SET created_at = datetime('now', '-30 minutes') WHERE order_id = ?", args: [String(bookedOrder.id)] });
    assert.equal(await releaseStaleSeats(), 2);
    assert.equal((await client.execute({ sql: "SELECT seats_taken FROM carpool_trips WHERE id = ?", args: [tripId] })).rows[0].seats_taken, 0);

    // A trip with passengers can't just be cancelled; an empty one can.
    assert.equal((await call("POST", `/car/carpool/trips/${tripId}/status`, "drv", { status: "cancelled" })).status, 200);
    assert.equal((await call("POST", `/car/carpool/trips/${tripId}/status`, "drv", { status: "departed" })).status, 409);
  });

  await t.test("self-drive: list, request (money held), approve, hand over, return; damage goes to an admin", async () => {
    await setPlatformEnvironment("live");
    const settings = (selfDrive: unknown) => setCarSettings({ enabled: true, onDemandEnabled: true, matchingMode: "customer_selects", shares: { owner: 60, driver: 30, platform: 10 }, maxPickupKm: 10, withdrawalsEnabled: false, withdrawalMinAmount: 0, scheduled: SCHEDULED, carpool: CARPOOL, selfDrive: selfDrive as typeof SELFDRIVE, vehiclePhotos: PHOTOS, kyc: KYC, deals: DEALS });
    const day = 86400_000;
    const rentalClock = Date.now();
    const at = (d: number) => new Date(rentalClock + d * day).toISOString();
    const balance = async (id: string) => Number((await client.execute({ sql: "SELECT wallet_balance AS b FROM users WHERE id = ?", args: [id] })).rows[0].b);
    await client.execute("UPDATE users SET wallet_balance = 0 WHERE id IN ('owner', 'cust', 'p2')");

    await settings({ ...SELFDRIVE, platformPercent: null });
    assert.equal((await call("GET", "/car/rentals/my-vehicles", "owner")).status, 403, "off until Peebee's percentage is decided");
    await settings(SELFDRIVE);

    assert.equal((await call("PUT", `/car/rentals/listings/${vehicleId}`, "cust", { dailyPrice: 100000, depositAmount: 50000 })).status, 404, "only the owner lists a vehicle");
    assert.equal((await call("PUT", `/car/rentals/listings/${vehicleId}`, "owner", { dailyPrice: 100000, depositAmount: 1000 })).status, 400, "below the admin's minimum deposit");
    assert.equal((await call("PUT", `/car/rentals/listings/${vehicleId}`, "owner", { dailyPrice: 100000, depositAmount: 50000 })).status, 200);

    const q = `startsAt=${encodeURIComponent(at(2))}&endsAt=${encodeURIComponent(at(4))}`;
    const listed = await json(await call("GET", `/car/rentals/listings?${q}`, "cust"));
    assert.equal(listed.days, 2);
    assert.equal(listed.vehicles[0].rent, 200000);
    assert.equal((await json(await call("GET", `/car/rentals/listings?${q}`, "owner"))).vehicles.length, 0, "not your own vehicle");

    const body = { vehicleId, startsAt: at(2), endsAt: at(4), licenceNumber: "DL123456", licenceExpiry: "2099-01-01" };
    assert.equal((await call("POST", "/car/rentals", "cust", { ...body, licenceExpiry: "2020-01-01" })).status, 400, "licence must cover the rental");
    assert.equal((await call("POST", "/car/rentals", "cust", { ...body, endsAt: at(20) })).status, 400, "longer than the admin's maximum");
    assert.equal((await call("POST", "/car/rentals", "cust", body)).status, 402, "needs the money in the wallet");

    await client.execute("UPDATE users SET wallet_balance = 300000 WHERE id = 'cust'");
    const made = await call("POST", "/car/rentals", "cust", body);
    assert.equal(made.status, 201);
    const rentalId = (await json(made)).id as string;
    assert.equal(await balance("cust"), 50000, "rent 200,000 and deposit 50,000 are held");
    assert.equal((await json(await call("GET", `/car/rentals/listings?${q}`, "p2"))).vehicles.length, 0, "those dates are taken");
    await client.execute("UPDATE users SET wallet_balance = 300000 WHERE id = 'p2'");
    assert.equal((await call("POST", "/car/rentals", "p2", body)).status, 409, "no double booking");

    assert.equal((await call("POST", `/car/rentals/${rentalId}/handover`, "owner")).status, 409, "approve first");
    assert.equal((await call("POST", `/car/rentals/${rentalId}/decision`, "cust", { approve: true })).status, 404, "only the owner answers");
    assert.equal((await call("POST", `/car/rentals/${rentalId}/decision`, "owner", { approve: true })).status, 200);
    assert.equal((await call("POST", `/car/rentals/${rentalId}/decision`, "owner", { approve: true })).status, 409, "answered once");
    assert.equal((await call("POST", `/car/rentals/${rentalId}/handover`, "owner")).status, 200);
    assert.equal((await call("POST", `/car/rentals/${rentalId}/cancel`, "cust")).status, 409, "can't cancel once handed over");

    const ownerBefore = await balance("owner");
    const returned = await call("POST", `/car/rentals/${rentalId}/return`, "owner", {});
    assert.equal((await json(returned)).status, "completed");
    assert.equal(await balance("owner") - ownerBefore, 180000, "rent minus Peebee's 10%");
    assert.equal(await balance("cust"), 100000, "deposit back");
    assert.equal((await call("POST", `/car/rentals/${rentalId}/return`, "owner", {})).status, 409, "paid out once");
    const ownerWallet = await json(await call("GET", "/car/wallet", "owner"));
    assert.ok(ownerWallet.withdrawable >= 180000 || ownerWallet.balance >= 180000, "rental payouts are owner earnings");

    // Decline and timeout both return everything.
    await client.execute("UPDATE users SET wallet_balance = 300000 WHERE id = 'cust'");
    const second = await json(await call("POST", "/car/rentals", "cust", { ...body, startsAt: at(10), endsAt: at(11) }));
    assert.equal(await balance("cust"), 300000 - 100000 - 50000);
    await call("POST", `/car/rentals/${second.id}/decision`, "owner", { approve: false });
    assert.equal(await balance("cust"), 300000, "declined: fully returned");
    const third = await json(await call("POST", "/car/rentals", "cust", { ...body, startsAt: at(12), endsAt: at(13) }));
    await client.execute({ sql: "UPDATE rentals SET created_at = datetime('now', '-13 hours') WHERE id = ?", args: [third.id] });
    assert.equal(await sweepRentalRequests(), 1);
    assert.equal(await balance("cust"), 300000, "unanswered: fully returned");

    // Damage: held until an admin rules.
    const fourth = await json(await call("POST", "/car/rentals", "cust", { ...body, startsAt: at(14), endsAt: at(15) }));
    await call("POST", `/car/rentals/${fourth.id}/decision`, "owner", { approve: true });
    await call("POST", `/car/rentals/${fourth.id}/handover`, "owner");
    const claimed = await json(await call("POST", `/car/rentals/${fourth.id}/return`, "owner", { damageClaim: 30000 }));
    assert.equal(claimed.status, "disputed");
    const custHeld = await balance("cust");
    assert.equal((await call("POST", `/admin/car/rentals/${fourth.id}/resolve`, "cust", { damageAmount: 10000 })).status, 403);
    assert.equal((await call("POST", `/admin/car/rentals/${fourth.id}/resolve`, "admin", { damageAmount: 40000 })).status, 400, "above what was claimed");
    const ownerMid = await balance("owner");
    assert.equal((await call("POST", `/admin/car/rentals/${fourth.id}/resolve`, "admin", { damageAmount: 10000 })).status, 200);
    assert.equal(await balance("cust") - custHeld, 40000, "deposit 50,000 minus 10,000 damage");
    assert.equal(await balance("owner") - ownerMid, 90000 + 10000, "rent after Peebee's cut plus the damage awarded");
    assert.equal((await call("POST", `/admin/car/rentals/${fourth.id}/resolve`, "admin", { damageAmount: 10000 })).status, 404, "settled once");
  });

  await t.test("owners add vehicle photos (at least 6), only they and staff can see them, and approval can require a minimum", async () => {
    const store = new Map<string, { bytes: ArrayBuffer; type: string }>();
    setR2Binding({
      async put(key, value, options) { store.set(key, { bytes: value as ArrayBuffer, type: options?.httpMetadata?.contentType ?? "" }); },
      async get(key) { const o = store.get(key); return o ? { body: new Blob([o.bytes]).stream(), httpMetadata: { contentType: o.type } } : null; },
      async delete(key) { store.delete(key); },
    });
    const settings = (vehiclePhotos: { max: number; minRequired: number }) => setCarSettings({ enabled: true, onDemandEnabled: true, matchingMode: "customer_selects", shares: { owner: 60, driver: 30, platform: 10 }, maxPickupKm: 10, withdrawalsEnabled: false, withdrawalMinAmount: 0, scheduled: SCHEDULED, carpool: CARPOOL, selfDrive: SELFDRIVE, vehiclePhotos, kyc: KYC, deals: DEALS });
    await settings({ max: 8, minRequired: 6 });

    const second = await call("POST", "/car/vehicles", "owner", { categoryId, plate: "UBB 777B", make: "Toyota", model: "Ipsum" });
    assert.equal(second.status, 201);
    const vid = (await json(second)).id as string;
    const upload = (who: string, type = "image/jpeg", size = 100) => {
      const form = new FormData();
      form.append("file", new File([new Uint8Array(size)], "p.jpg", { type }));
      return app.request(`/v1/car/vehicles/${vid}/photos`, { method: "POST", headers: { Authorization: `Bearer ${tokens[who]}` }, body: form });
    };

    assert.equal((await upload("cust")).status, 404, "only the owner adds photos");
    assert.equal((await upload("owner", "application/pdf")).status, 400, "images only");
    assert.equal((await upload("owner", "image/jpeg", 7 * 1024 * 1024)).status, 400, "too large");

    const ids: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await upload("owner");
      assert.equal(res.status, 201, `photo ${i + 1} is accepted`);
      ids.push((await json(res)).id);
    }
    assert.equal((await call("POST", `/admin/car/vehicles/${vid}/decision`, "admin", { status: "approved" })).status, 200, "six photos meet the minimum");

    assert.equal((await upload("owner")).status, 201);
    assert.equal((await upload("owner")).status, 201);
    assert.equal((await upload("owner")).status, 409, "the 9th is over the admin's maximum of 8");
    assert.equal((await json(await call("GET", "/car/me", "owner"))).vehicles.find((v: { id: string }) => v.id === vid).photos.length, 8);

    assert.equal((await call("GET", `/car/vehicles/${vid}/photos/${ids[0]}`, "owner")).status, 200);
    assert.equal((await call("GET", `/car/vehicles/${vid}/photos/${ids[0]}`, "admin")).status, 200, "staff can review them");
    assert.equal((await call("GET", `/car/vehicles/${vid}/photos/${ids[0]}`, "cust")).status, 403, "other people can't");

    assert.equal((await call("DELETE", `/car/vehicles/${vid}/photos/${ids[0]}`, "cust")).status, 404);
    assert.equal((await call("DELETE", `/car/vehicles/${vid}/photos/${ids[0]}`, "owner")).status, 200);
    assert.equal(store.size, 7, "the file is removed too");

    // A vehicle without enough photos can't be approved.
    const third = await json(await call("POST", "/car/vehicles", "owner", { categoryId, plate: "UCC 888C" }));
    await upload("owner");
    assert.equal((await call("POST", `/admin/car/vehicles/${third.id}/decision`, "admin", { status: "approved" })).status, 409);
    await settings(PHOTOS);
  });

  await t.test("a driver can bring their own car; documents gate approval; a driver with no car says so", async () => {
    const store = new Map<string, { bytes: ArrayBuffer; type: string }>();
    setR2Binding({
      async put(key, value, options) { store.set(key, { bytes: value as ArrayBuffer, type: options?.httpMetadata?.contentType ?? "" }); },
      async get(key) { const o = store.get(key); return o ? { body: new Blob([o.bytes]).stream(), httpMetadata: { contentType: o.type } } : null; },
      async delete(key) { store.delete(key); },
    });
    const settings = (kyc: typeof KYC) => setCarSettings({ enabled: true, onDemandEnabled: true, matchingMode: "customer_selects", shares: { owner: 60, driver: 30, platform: 10 }, maxPickupKm: 10, withdrawalsEnabled: false, withdrawalMinAmount: 0, scheduled: SCHEDULED, carpool: CARPOOL, selfDrive: SELFDRIVE, vehiclePhotos: PHOTOS, kyc, deals: DEALS });
    await settings({ ownerIdRequired: true, driverIdRequired: true, driverLicenceRequired: true });
    for (const id of ["dd", "nocar"]) {
      await client.execute({ sql: "INSERT INTO users (id, phone, name, password_hash, role) VALUES (?, ?, ?, 'h', 'customer')", args: [id, id, id] });
      tokens[id] = await signToken({ sub: id, role: "customer" });
    }
    const doc = (who: string, kind: string, type = "image/jpeg") => {
      const form = new FormData();
      form.append("kind", kind);
      form.append("file", new File([new Uint8Array(50)], "d.jpg", { type }));
      return app.request("/v1/car/partner/documents", { method: "POST", headers: { Authorization: `Bearer ${tokens[who]}` }, body: form });
    };

    assert.equal((await doc("dd", "licence")).status, 403, "apply first");
    assert.equal((await call("POST", "/car/partner/apply", "dd", { as: "driver", licenceExpiry: "2030-01-01", needsVehicle: false })).status, 201);
    assert.equal((await call("POST", "/car/partner/apply", "nocar", { as: "driver", needsVehicle: true })).status, 201);
    assert.equal((await json(await call("GET", "/car/me", "nocar"))).needsVehicle, true, "no car is recorded on the application");
    const listed = (await json(await call("GET", "/admin/car/partners", "admin"))).partners as Array<{ user_id: string; needs_vehicle: number }>;
    assert.equal(listed.find((p) => p.user_id === "nocar")?.needs_vehicle, 1, "admins can see who needs a car");

    assert.equal((await doc("dd", "passport")).status, 400);
    assert.equal((await doc("dd", "licence", "application/pdf")).status, 400);
    assert.equal((await call("POST", "/admin/car/partners/dd/decision", "admin", { role: "driver", status: "approved" })).status, 409, "documents are required first");
    assert.equal((await doc("dd", "national_id")).status, 201);
    assert.equal((await call("POST", "/admin/car/partners/dd/decision", "admin", { role: "driver", status: "approved" })).status, 409, "the licence is still missing");
    assert.equal((await doc("dd", "licence")).status, 201);
    assert.equal((await doc("dd", "licence")).status, 201, "re-uploading replaces the old one");
    assert.equal([...store.keys()].filter((k) => k.startsWith("partners/dd/licence")).length, 1, "the old file is removed");
    assert.equal((await call("GET", "/car/partner/documents/dd/licence", "nocar")).status, 403, "private to the owner of the document");
    assert.equal((await call("GET", "/car/partner/documents/dd/licence", "admin")).status, 200);
    assert.equal((await call("POST", "/admin/car/partners/dd/decision", "admin", { role: "driver", status: "approved" })).status, 200);

    // Their own car: they become an owner (pending), the car is vetted separately, then they drive it themselves.
    assert.equal((await call("POST", "/car/vehicles", "nocar", { categoryId, plate: "UDD 100D" })).status, 201, "a pending driver may add a car");
    const mine = await json(await call("POST", "/car/vehicles", "dd", { categoryId, plate: "UDD 200D", make: "Honda" }));
    assert.equal((await json(await call("GET", "/car/me", "dd"))).ownerStatus, "pending", "adding a car creates the owner profile, pending");
    assert.equal((await call("POST", `/car/vehicles/${mine.id}/drive`, "dd")).status, 409, "the car must be approved first");
    assert.equal((await call("POST", `/admin/car/vehicles/${mine.id}/decision`, "admin", { status: "approved" })).status, 200);
    assert.equal((await call("POST", `/car/vehicles/${mine.id}/drive`, "nocar")).status, 403, "only a driver drives");
    assert.equal((await call("POST", `/car/vehicles/${mine.id}/drive`, "dd")).status, 200);
    const online = await call("POST", "/car/driver/online", "dd", { online: true, lat: 0.3, lng: 32.58 });
    assert.equal(online.status, 200);
    assert.equal((await json(online)).vehicleId, mine.id, "they go online in their own car");
    assert.equal((await call("POST", `/car/vehicles/${mine.id}/release`, "dd")).status, 200);
    assert.equal((await call("POST", "/car/driver/online", "dd", { online: true })).status, 409, "no car in the seat any more");
    await settings(KYC);
  });

  await t.test("drivers apply to owners' cars; the owner accepts on an agreed share or rent; earnings show on the owner's app", async () => {
    await setPlatformEnvironment("live");
    const settings = (deals: typeof DEALS) => setCarSettings({ enabled: true, onDemandEnabled: true, matchingMode: "customer_selects", shares: { owner: 60, driver: 30, platform: 10 }, maxPickupKm: 10, withdrawalsEnabled: false, withdrawalMinAmount: 0, scheduled: SCHEDULED, carpool: CARPOOL, selfDrive: SELFDRIVE, vehiclePhotos: PHOTOS, kyc: KYC, deals });
    for (const id of ["oc", "d1", "d2", "d3"]) {
      await client.execute({ sql: "INSERT INTO users (id, phone, name, password_hash, role) VALUES (?, ?, ?, 'h', 'customer')", args: [id, id, id] });
      tokens[id] = await signToken({ sub: id, role: "customer" });
    }
    const balance = async (id: string) => Number((await client.execute({ sql: "SELECT wallet_balance AS b FROM users WHERE id = ?", args: [id] })).rows[0].b);

    await settings({ ...DEALS, enabled: false });
    assert.equal((await call("GET", "/car/deals/owner", "oc")).status, 403, "closed until the admin switches it on");
    await settings(DEALS);

    // Set up: an owner with two approved cars; two approved drivers who need a car; one still unapproved.
    await call("POST", "/car/partner/apply", "oc", { as: "owner" });
    await call("POST", "/admin/car/partners/oc/decision", "admin", { role: "owner", status: "approved" });
    const carA = (await json(await call("POST", "/car/vehicles", "oc", { categoryId, plate: "UOC 001A", make: "Toyota", model: "Premio" }))).id as string;
    const carB = (await json(await call("POST", "/car/vehicles", "oc", { categoryId, plate: "UOC 002B", make: "Honda", model: "Fit" }))).id as string;
    for (const v of [carA, carB]) await call("POST", `/admin/car/vehicles/${v}/decision`, "admin", { status: "approved" });
    for (const id of ["d1", "d2"]) {
      await call("POST", "/car/partner/apply", id, { as: "driver", needsVehicle: true });
      await call("POST", `/admin/car/partners/${id}/decision`, "admin", { role: "driver", status: "approved" });
    }
    await call("POST", "/car/partner/apply", "d3", { as: "driver", needsVehicle: true });

    // The owner's terms must sit inside the admin's limits.
    const put = (vehicle: string, body: object, who = "oc") => call("PUT", `/car/deals/terms/${vehicle}`, who, body);
    assert.equal((await put(carA, { open: true, feeType: "share", ownerSharePercent: 90 })).status, 400, "above the admin's highest owner share");
    assert.equal((await put(carA, { open: true, feeType: "share", ownerSharePercent: 30 })).status, 400, "below the lowest");
    assert.equal((await put(carA, { open: true, feeType: "rent" })).status, 400, "rent needs an amount and a period");
    await settings({ ...DEALS, maxRentPerDay: 10000 });
    assert.equal((await put(carB, { open: true, feeType: "rent", rentAmount: 20000, rentPeriod: "day" })).status, 400, "above the admin's rent limit");
    assert.equal((await put(carB, { open: true, feeType: "rent", rentAmount: 70000, rentPeriod: "week" })).status, 200, "UGX 10,000 a day is within it");
    await settings({ ...DEALS, rentEnabled: false });
    assert.equal((await put(carB, { open: true, feeType: "rent", rentAmount: 1000, rentPeriod: "day" })).status, 400, "rent switched off by the admin");
    await settings(DEALS);
    assert.equal((await put(carA, { open: true, feeType: "share", ownerSharePercent: 70 }, "d1")).status, 404, "only the owner sets terms");
    assert.equal((await put(carA, { open: true, feeType: "share", ownerSharePercent: 70 })).status, 200);
    assert.equal((await put(carB, { open: true, feeType: "rent", rentAmount: 1000, rentPeriod: "day" })).status, 200);

    // Drivers browse and apply.
    assert.equal((await call("POST", `/car/deals/cars/${carA}/request`, "d3")).status, 403, "an unapproved driver can't apply");
    assert.equal((await call("POST", `/car/deals/cars/${carA}/request`, "oc")).status, 403, "owners who aren't drivers can't");
    const open = (await json(await call("GET", "/car/deals/cars", "d1"))).cars as Array<{ id: string; terms: { feeType: string } }>;
    assert.deepEqual(open.map((x) => x.terms.feeType).sort(), ["rent", "share"]);
    assert.equal((await call("POST", `/car/deals/cars/${carA}/request`, "d1")).status, 201);
    assert.equal((await call("POST", `/car/deals/cars/${carA}/request`, "d1")).status, 409, "once per car");
    assert.equal((await call("POST", `/car/deals/cars/${carA}/request`, "d2")).status, 201);
    assert.equal((await call("POST", `/car/deals/cars/${carB}/request`, "d2")).status, 201);

    // The owner answers; accepting connects straight away.
    const pending = (await json(await call("GET", "/car/deals/owner", "oc"))).requests as Array<{ id: string; vehicleId: string; driverName: string }>;
    assert.equal(pending.length, 3);
    const reqA1 = pending.find((r) => r.vehicleId === carA && r.driverName === "d1")!.id;
    const reqA2 = pending.find((r) => r.vehicleId === carA && r.driverName === "d2")!.id;
    const reqB2 = pending.find((r) => r.vehicleId === carB)!.id;
    assert.equal((await call("POST", `/car/deals/requests/${reqA1}/decision`, "d1", { accept: true })).status, 404, "only the owner answers");
    assert.equal((await call("POST", `/car/deals/requests/${reqA1}/decision`, "oc", { accept: true })).status, 200);
    assert.equal((await call("POST", `/car/deals/requests/${reqA1}/decision`, "oc", { accept: true })).status, 409, "answered once");
    assert.equal((await client.execute({ sql: "SELECT status FROM driver_requests WHERE id = ?", args: [reqA2] })).rows[0].status, "declined", "others for the same car are declined");
    assert.equal((await call("POST", `/car/deals/requests/${reqB2}/decision`, "oc", { accept: true })).status, 200);
    const mine = (await json(await call("GET", "/car/deals/my", "d1"))).connections as Array<{ terms: { feeType: string; ownerSharePercent: number } }>;
    assert.equal(mine[0].terms.ownerSharePercent, 70, "the agreed terms are on the connection");
    assert.equal((await call("POST", "/car/driver/online", "d1", { online: true, lat: 0.3, lng: 32.58 })).status, 200, "the driver can pick the car and work");
    assert.equal((await json(await call("GET", "/car/deals/cars", "d2"))).cars.length, 0, "cars with a driver leave the list");

    // Money: a settled ride is split by the agreed share; Peebee's cut comes off first.
    let n = 0;
    const settle = async (driver: string, vehicle: string, pool: number) => {
      n += 1;
      await client.execute({ sql: "INSERT INTO lists (id, customer_id, title) VALUES (?, 'cust', 'deal')", args: [`ld${n}`] });
      await client.execute({ sql: "INSERT INTO orders (id, list_id, customer_id, type, rider_id, environment) VALUES (?, ?, 'cust', 'parcel', ?, 'live')", args: [`od${n}`, `ld${n}`, driver] });
      await client.execute({ sql: "INSERT INTO car_bookings (id, order_id, customer_id, category_id, vehicle_id, owner_id, driver_id) VALUES (?, ?, 'cust', ?, ?, 'oc', ?)", args: [`cbd${n}`, `od${n}`, categoryId, vehicle, driver] });
      await settleCarBooking({ id: `od${n}`, rider_id: driver, environment: "live" }, pool, "admin");
      await client.execute({ sql: "UPDATE orders SET stage = 'Settle' WHERE id = ?", args: [`od${n}`] });
    };
    await client.execute("UPDATE users SET wallet_balance = 0 WHERE id IN ('oc', 'd1', 'd2')");
    await settle("d1", carA, 5000);
    assert.equal(await balance("oc"), 3150);
    assert.equal(await balance("d1"), 1350);

    // Rent: the first day's rent comes out of the driver's first ride; later rides that day are theirs.
    await settle("d2", carB, 5000);
    assert.equal(await balance("oc"), 3150 + 1000);
    assert.equal(await balance("d2"), 3500);
    await settle("d2", carB, 5000);
    assert.equal(await balance("oc"), 3150 + 1000, "no more rent due that day");
    assert.equal(await balance("d2"), 3500 + 4500);

    // The owner sees what the driver earned, per ride and in total.
    const rides = await json(await call("GET", "/car/owner/rides", "oc"));
    const d1row = rides.drivers.find((d: { name: string }) => d.name === "d1");
    assert.equal(d1row.driverEarned, 1350);
    assert.equal(d1row.ownerEarned, 3150);
    assert.equal(rides.rides.find((r: { driver_amount: number | null; driver_name: string }) => r.driver_name === "d1" && r.driver_amount === 1350)?.platform_amount, 500);

    // Rent can also be paid from the wallet; two days on, more is owed.
    await client.execute({ sql: "UPDATE vehicle_assignments SET assigned_at = datetime('now', '-2 days') WHERE vehicle_id = ? AND status = 'active'", args: [carB] });
    const conn = (await json(await call("GET", "/car/deals/my", "d2"))).connections[0] as { assignmentId: string; rentOwed: number };
    assert.equal(conn.rentOwed, 2000, "three started days (3,000) less the 1,000 already paid");
    await client.execute("UPDATE users SET wallet_balance = 0 WHERE id = 'd2'");
    assert.equal((await call("POST", "/car/deals/rent/pay", "d2", { assignmentId: conn.assignmentId })).status, 402, "needs the money in the wallet");
    await client.execute("UPDATE users SET wallet_balance = 5000 WHERE id = 'd2'");
    const ownerBefore = await balance("oc");
    assert.equal((await call("POST", "/car/deals/rent/pay", "d2", { assignmentId: conn.assignmentId })).status, 200);
    assert.equal(await balance("oc") - ownerBefore, 2000);
    assert.equal((await call("POST", "/car/deals/rent/pay", "d2", { assignmentId: conn.assignmentId })).status, 409, "nothing left to pay");

    // Ending: the driver leaves; rent owed that can't be covered is recorded for the owner.
    await client.execute({ sql: "UPDATE vehicle_assignments SET assigned_at = datetime('now', '-5 days') WHERE vehicle_id = ? AND status = 'active'", args: [carB] });
    await client.execute("UPDATE users SET wallet_balance = 500 WHERE id = 'd2'");
    assert.equal((await call("POST", `/car/deals/vehicles/${carB}/end`, "d1")).status, 404, "only the owner ends it for the driver");
    assert.equal((await call("POST", `/car/deals/vehicles/${carB}/end`, "oc")).status, 200);
    const ended = (await client.execute({ sql: "SELECT status, rent_unpaid_at_end FROM vehicle_assignments WHERE vehicle_id = ? ORDER BY assigned_at DESC LIMIT 1", args: [carB] })).rows[0];
    assert.equal(ended.status, "ended");
    assert.equal(ended.rent_unpaid_at_end, 2500, "6 started days (6,000) less the 3,000 already paid leaves 3,000; the driver's 500 wallet covers some of it");
    assert.equal((await json(await call("GET", "/car/deals/cars", "d1"))).cars.some((x: { id: string }) => x.id === carB), true, "the car is open for drivers again");
  });
});
