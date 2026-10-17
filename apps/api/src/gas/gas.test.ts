import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import app from "../app.js";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { resetSchemaCache } from "../lib/schema.js";
import { setSetting } from "../lib/settings.js";
import { hashPin } from "./auth.js";

process.env.JWT_SECRET = "gas-test-only-secret";

function bindDatabase(client: Client) {
  const prepare = (sql: string) => ({
    sql,
    args: [] as unknown[],
    bind(...args: unknown[]) {
      this.args = args;
      return this;
    },
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

type Json = Record<string, any>;

async function setup() {
  resetSchemaCache();
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) {
      await client.execute(sql);
    }
  }
  bindDatabase(client);

  const call = async (path: string, opts: { method?: string; token?: string; body?: unknown } = {}) => {
    const res = await app.request(`/v1/gas${path}`, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: { "Content-Type": "application/json", ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
  };

  const mkUser = async (id: string, role: "customer" | "rider" | "admin", wallet = 0) => {
    await client.execute({
      sql: `INSERT INTO users (id, phone, name, role, password_hash, wallet_balance, admin_role) VALUES (?, ?, ?, ?, 'x', ?, ?)`,
      args: [id, `+2567${Math.floor(10000000 + Math.random() * 89999999)}`, `User ${id}`, role, role === "rider" ? 0 : wallet, role === "admin" ? "super_admin" : null],
    });
    // A rider's money is in their rider wallet (top-ups and earnings), as in the rider app.
    if (role === "rider") await client.execute({ sql: "INSERT INTO riders (user_id, wallet_balance) VALUES (?, ?)", args: [id, wallet] });
    return signToken({ sub: id, role });
  };
  const wallet = async (id: string) => {
    const rider = (await client.execute({ sql: "SELECT wallet_balance AS b FROM riders WHERE user_id = ?", args: [id] })).rows[0];
    return Number((rider ?? (await client.execute({ sql: "SELECT wallet_balance AS b FROM users WHERE id = ?", args: [id] })).rows[0]).b);
  };

  const devPin = await hashPin("2468");
  await client.execute({ sql: "UPDATE fuel_station_managers SET pin = ? WHERE id = 'fmgr_tot_01'", args: [devPin] });
  await client.execute({ sql: "UPDATE fuel_pump_attendants SET pin = ? WHERE id = 'fatt_lugogo_1'", args: [devPin] });
  const pin = await hashPin("7391");
  // A second outlet with its own manager and attendant, for cross-station checks.
  await call("/stations"); // runs schema provisioning
  await client.execute({
    sql: `INSERT OR REPLACE INTO fuel_station_managers (id, outlet_id, manager_code, full_name, phone, pin, role, status)
          VALUES ('fmgr_shl_02', 'fout_shell_bugolobi', 'MGR-SHL-02', 'Grace Akello', '+256701999002', ?, 'station_manager', 'active')`,
    args: [pin],
  });
  await client.execute({
    sql: `INSERT OR REPLACE INTO fuel_pump_attendants (id, outlet_id, attendant_code, full_name, phone, pump_lane, status, pin)
          VALUES ('fatt_shl_1', 'fout_shell_bugolobi', 'ATT-2001', 'Nakato Sarah', '+256701111002', 'Pump 1', 'on_duty', ?)`,
    args: [pin],
  });

  const loginManager = async (code = "MGR-TOT-01", p = "2468") => (await call("/manager/login", { body: { code, pin: p } })).json.token as string;
  const loginAttendant = async (code = "ATT-1001", p = "2468") => (await call("/attendants/login", { body: { code, pin: p } })).json.token as string;

  return { client, call, mkUser, wallet, loginManager, loginAttendant };
}

test("gas: voucher lifecycle charges the wallet, refunds the unused part and pays the station", async () => {
  const { call, mkUser, wallet, loginManager, loginAttendant } = await setup();
  const rider = await mkUser("rider_a", "rider", 100000);

  const gen = await call("/rider/generate-code", { token: rider, body: { vehiclePlate: "UFE 889P", amountUgx: 25000, productId: "prod_petrol" } });
  assert.equal(gen.status, 200);
  assert.match(gen.json.code.code, /^PBGAS-\d{6}$/);
  assert.equal(await wallet("rider_a"), 75000, "amount is held when the voucher is made");

  const attendant = await loginAttendant();
  const verify = await call("/verify-code", { token: attendant, body: { code: gen.json.code.short_code } });
  assert.equal(verify.status, 200);
  assert.equal(verify.json.code.authorized_amount_ugx, 25000);

  const dispense = await call("/dispense", { token: attendant, body: { code: gen.json.code.code, productId: "prod_petrol", totalUgx: 20000, pumpNumber: 2 } });
  assert.equal(dispense.status, 200);
  assert.equal(dispense.json.receipt.total_ugx, 20000);
  assert.equal(dispense.json.receipt.attendant_id, "fatt_lugogo_1");
  assert.equal(await wallet("rider_a"), 80000, "the UGX 5,000 that was not pumped is refunded");

  const again = await call("/dispense", { token: attendant, body: { code: gen.json.code.code, productId: "prod_petrol", totalUgx: 5000 } });
  assert.equal(again.status, 409, "a redeemed voucher cannot be redeemed again");
  assert.equal(await wallet("rider_a"), 80000);
  assert.equal((await call("/verify-code", { token: attendant, body: { code: gen.json.code.code } })).json.error, "already_used");

  const manager = await loginManager();
  const sales = await call("/manager/sales-summary?period=today", { token: manager });
  assert.equal(sales.json.summary.totalRevenueUgx, 20000);
  assert.equal(sales.json.summary.availableBalanceUgx, 20000);

  await call("/manager/payout-accounts", { token: manager, body: { type: "momo", accountRef: "+256782334455", accountName: "Lugogo Payout", networkOrBank: "MTN", isPrimary: true } });
  const details = { phone: "+256782334455", network: "MTN", accountName: "Lugogo Payout" };

  const wd = await call("/manager/withdrawals", { token: manager, body: { amountUgx: 12000, destinationType: "momo", destinationDetails: details } });
  assert.equal(wd.status, 200);
  assert.equal(wd.json.withdrawal.status, "pending", "a request is not a payout");

  const tooMuch = await call("/manager/withdrawals", { token: manager, body: { amountUgx: 9000, destinationType: "momo", destinationDetails: details } });
  assert.equal(tooMuch.status, 409, "pending requests count against the balance");

  const stranger = await call("/manager/withdrawals", { token: manager, body: { amountUgx: 5000, destinationType: "momo", destinationDetails: { phone: "+256700000000" } } });
  assert.equal(stranger.json.error, "unregistered_destination");

  const afterSales = await call("/manager/sales-summary?period=today", { token: manager });
  assert.equal(afterSales.json.summary.availableBalanceUgx, 8000);

  // An admin pays it out, once.
  const admin = await mkUser("admin_a", "admin");
  const settled = await call(`/admin/withdrawals/${wd.json.withdrawal.id}/complete`, { token: admin, body: { providerRef: "MTN-123" } });
  assert.equal(settled.status, 200);
  assert.equal((await call(`/admin/withdrawals/${wd.json.withdrawal.id}/complete`, { token: admin, body: {} })).status, 409);
});

test("gas: sandbox sales pay out as simulated withdrawals that never reach the admin's payout queue", async () => {
  const { client, call, mkUser, loginManager, loginAttendant } = await setup();
  const manager = await loginManager();
  await call("/manager/payout-accounts", { token: manager, body: { type: "momo", accountRef: "+256782334455", accountName: "Lugogo Payout", networkOrBank: "MTN", isPrimary: true } });
  const details = { phone: "+256782334455" };
  const sell = async (rider: string, token: string, amount: number) => {
    const gen = await call("/rider/generate-code", { token, body: { vehiclePlate: "UFE 889P", amountUgx: amount, productId: "prod_petrol" } });
    assert.equal(gen.status, 200, `${rider} gets a voucher`);
    const sold = await call("/dispense", { token: await loginAttendant(), body: { code: gen.json.code.code, productId: "prod_petrol", totalUgx: amount } });
    assert.equal(sold.status, 200);
  };

  // A live sale, then the platform goes into sandbox and sells some test fuel.
  await sell("rider_live", await mkUser("rider_live", "rider", 50000), 20000);
  await setSetting("platform_environment", "sandbox");
  const sandboxRider = await mkUser("rider_sbx", "rider", 0);
  await client.execute("UPDATE riders SET wallet_balance_sandbox = 50000 WHERE user_id = 'rider_sbx'");
  await sell("rider_sbx", sandboxRider, 15000);

  const sandboxSales = await call("/manager/sales-summary?period=today", { token: manager });
  assert.equal(sandboxSales.json.summary.availableBalanceUgx, 15000, "sandbox shows only sandbox sales");
  const wd = await call("/manager/withdrawals", { token: manager, body: { amountUgx: 15000, destinationType: "momo", destinationDetails: details } });
  assert.equal(wd.status, 200);
  assert.equal(wd.json.withdrawal.status, "completed", "a sandbox payout is simulated at once");
  assert.equal(wd.json.withdrawal.environment, "sandbox");

  const admin = await mkUser("admin_s", "admin");
  const queue = await call("/admin/withdrawals?status=pending", { token: admin });
  assert.equal(queue.json.withdrawals.length, 0, "nothing for an admin to pay with real money");
  const sandboxList = await call("/admin/withdrawals?status=completed&environment=sandbox", { token: admin });
  assert.equal(sandboxList.json.withdrawals.length, 1);

  // Back to live: the station's real balance is untouched by the sandbox payout.
  await setSetting("platform_environment", "live");
  const live = await call("/manager/sales-summary?period=today", { token: manager });
  assert.equal(live.json.summary.availableBalanceUgx, 20000);
  assert.equal((await call("/manager/withdrawals", { token: manager })).json.withdrawals.length, 0, "the live list shows no sandbox payouts");
  const liveWd = await call("/manager/withdrawals", { token: manager, body: { amountUgx: 20000, destinationType: "momo", destinationDetails: details } });
  assert.equal(liveWd.json.withdrawal.status, "pending", "a live request waits for an admin to pay it");
});

test("gas: nothing sensitive works without a real signed-in session", async () => {
  const { call, mkUser, loginManager } = await setup();
  const rider = await mkUser("rider_b", "rider", 50000);
  const forgedAttendant = "gatt_fatt_lugogo_1_1700000000000";
  const forgedManager = "gmgr_fmgr_tot_01_1700000000000";

  const protectedCalls: Array<[string, string, unknown?]> = [
    ["PUT", "/outlets/fout_total_lugogo/prices", { prices: [{ product_id: "prod_petrol", price_per_unit: 1 }] }],
    ["POST", "/verify-code", { code: "123456" }],
    ["POST", "/dispense", { code: "123456", totalUgx: 5000 }],
    ["GET", "/dispenses"],
    ["GET", "/shift/summary"],
    ["GET", "/me"],
    ["POST", "/attendants/toggle-duty", { onDuty: false }],
    ["GET", "/manager/me"],
    ["GET", "/manager/attendants"],
    ["POST", "/manager/attendants/commission", { fullName: "Eve Intruder", phone: "+256700000001" }],
    ["GET", "/manager/sales-summary"],
    ["GET", "/manager/transactions"],
    ["GET", "/manager/payout-accounts"],
    ["POST", "/manager/payout-accounts", { type: "momo", accountRef: "+256700000009", accountName: "Eve", networkOrBank: "MTN" }],
    ["GET", "/manager/withdrawals"],
    ["POST", "/manager/withdrawals", { amountUgx: 50000, destinationType: "momo", destinationDetails: { phone: "+256700000009" } }],
    ["POST", "/rider/generate-code", { vehiclePlate: "UFE 1", amountUgx: 5000 }],
    ["GET", "/rider/active-code"],
    ["GET", "/rider/dispenses"],
    ["POST", "/rider/cancel-code", {}],
    ["GET", "/admin/withdrawals"],
  ];
  for (const [method, path, body] of protectedCalls) {
    for (const token of [undefined, forgedAttendant, forgedManager]) {
      const res = await call(path, { method, token, body });
      assert.equal(res.status, 401, `${method} ${path} with ${token ?? "no token"} should be 401, got ${res.status}`);
    }
  }

  // A rider's own session is not a station session, and a manager session is not an admin one.
  assert.equal((await call("/dispenses", { token: rider })).status, 401);
  assert.equal((await call("/manager/me", { token: rider })).status, 401);
  assert.equal((await call("/admin/withdrawals", { token: rider })).status, 403);
  assert.equal((await call("/admin/withdrawals", { token: await loginManager() })).status, 401);
});

test("gas: stations are isolated from each other", async () => {
  const { call, mkUser, loginManager, loginAttendant } = await setup();
  const rider = await mkUser("rider_c", "rider", 100000);
  const totalManager = await loginManager();
  const shellAttendant = await loginAttendant("ATT-2001", "7391");

  // Prices at another station.
  const price = await call("/outlets/fout_shell_bugolobi/prices", { method: "PUT", token: totalManager, body: { prices: [{ product_id: "prod_petrol", price_per_unit: 1 }] } });
  assert.equal(price.status, 403);

  // A voucher bound to one station is refused at another.
  const gen = await call("/rider/generate-code", { token: rider, body: { vehiclePlate: "UFE 123A", amountUgx: 10000, productId: "prod_petrol", outletId: "fout_total_lugogo" } });
  assert.equal(gen.status, 200);
  const wrong = await call("/dispense", { token: shellAttendant, body: { code: gen.json.code.code, productId: "prod_petrol", totalUgx: 5000 } });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.json.error, "wrong_outlet");

  // A manager can't touch another station's attendant.
  const shellAtt = await call("/manager/attendants/fatt_shl_1/suspend", { token: totalManager, body: {} });
  assert.equal(shellAtt.status, 404);
  const list = await call("/manager/attendants", { token: totalManager });
  assert.ok(!list.json.attendants.some((a: Json) => a.id === "fatt_shl_1"));
  assert.ok(!JSON.stringify(list.json).includes("$2"), "PIN hashes are never returned");
});

test("gas: PINs — wrong, default, missing and guessed", async () => {
  const { client, call } = await setup();

  assert.equal((await call("/manager/login", { body: { code: "MGR-TOT-01", pin: "9999" } })).status, 401);
  assert.equal((await call("/manager/login", { body: { code: "NOPE-00", pin: "2468" } })).status, 401, "unknown code looks the same as a wrong PIN");
  assert.equal((await call("/manager/login", { body: { code: "MGR-TOT-01" } })).status, 400, "a PIN is always required");

  // Accounts from the old code (default PIN, or unhashed) can never sign in.
  await client.execute("UPDATE fuel_station_managers SET pin = '1234' WHERE id = 'fmgr_tot_01'");
  assert.equal((await call("/manager/login", { body: { code: "MGR-TOT-01", pin: "1234" } })).status, 401);
  await client.execute("UPDATE fuel_station_managers SET pin = '' WHERE id = 'fmgr_tot_01'");
  assert.equal((await call("/manager/login", { body: { code: "MGR-TOT-01", pin: "2468" } })).status, 401);

  // Unknown attendant codes are not created on the fly.
  assert.equal((await call("/attendants/login", { body: { code: "ATT-9999", pin: "7391" } })).status, 401);
  const rows = await client.execute("SELECT COUNT(*) AS n FROM fuel_pump_attendants WHERE attendant_code = 'ATT-9999'");
  assert.equal(Number(rows.rows[0].n), 0);

  // Repeated wrong guesses lock the account, even for the right PIN.
  let last = 0;
  for (let i = 0; i < 8; i += 1) last = (await call("/attendants/login", { body: { code: "ATT-2001", pin: "0001" } })).status;
  assert.equal(last, 429);
  assert.equal((await call("/attendants/login", { body: { code: "ATT-2001", pin: "7391" } })).status, 429);
});

test("gas: simultaneous redemptions and withdrawals cannot double-spend", async () => {
  const { call, mkUser, wallet, loginManager, loginAttendant } = await setup();
  const rider = await mkUser("rider_d", "rider", 100000);
  const attendant = await loginAttendant();

  const gen = await call("/rider/generate-code", { token: rider, body: { vehiclePlate: "UFE 777Z", amountUgx: 30000, productId: "prod_petrol" } });
  const results = await Promise.all(
    [1, 2, 3, 4].map(() => call("/dispense", { token: attendant, body: { code: gen.json.code.code, productId: "prod_petrol", totalUgx: 30000 } })),
  );
  assert.equal(results.filter((r) => r.status === 200).length, 1, "exactly one redemption wins");
  assert.equal(await wallet("rider_d"), 70000);

  const manager = await loginManager();
  await call("/manager/payout-accounts", { token: manager, body: { type: "momo", accountRef: "+256782334455", accountName: "Payout", networkOrBank: "MTN" } });
  const details = { phone: "+256782334455" };
  const withdrawals = await Promise.all(
    [1, 2, 3].map(() => call("/manager/withdrawals", { token: manager, body: { amountUgx: 20000, destinationType: "momo", destinationDetails: details } })),
  );
  assert.equal(withdrawals.filter((r) => r.status === 200).length, 1, "UGX 30,000 can fund only one UGX 20,000 request");
});

test("gas: vouchers — wallet, replacement, cancel, expiry and limits", async () => {
  const { client, call, mkUser, wallet } = await setup();
  const poor = await mkUser("rider_e", "rider", 1000);
  const none = await call("/rider/generate-code", { token: poor, body: { vehiclePlate: "UFE 1A", amountUgx: 20000 } });
  assert.equal(none.status, 402);
  const noVoucher = await client.execute("SELECT COUNT(*) AS n FROM fuel_codes WHERE rider_id = 'rider_e'");
  assert.equal(Number(noVoucher.rows[0].n), 0, "no voucher without payment");

  const rider = await mkUser("rider_f", "rider", 100000);
  assert.equal((await call("/rider/generate-code", { token: rider, body: { amountUgx: 20000 } })).json.error, "plate_required");

  const first = await call("/rider/generate-code", { token: rider, body: { vehiclePlate: "UFE 2B", amountUgx: 20000 } });
  assert.equal(first.status, 200);
  const second = await call("/rider/generate-code", { token: rider, body: { vehiclePlate: "UFE 2B", amountUgx: 10000 } });
  assert.equal(second.status, 200);
  assert.equal(await wallet("rider_f"), 90000, "the first hold is released when it is replaced");
  const customerWallet = (await client.execute("SELECT wallet_balance AS b FROM users WHERE id = 'rider_f'")).rows[0].b;
  assert.equal(Number(customerWallet), 0, "a rider pays from the rider wallet, not a customer wallet");
  const active = await call("/rider/active-code", { token: rider });
  assert.equal(active.json.code.code, second.json.code.code);

  const cancelled = await call("/rider/cancel-code", { token: rider, body: {} });
  assert.equal(cancelled.json.refunded_ugx, 10000);
  assert.equal(await wallet("rider_f"), 100000);
  assert.equal((await call("/rider/active-code", { token: rider })).json.code, null);

  // Expiry returns the hold.
  const expiring = await call("/rider/generate-code", { token: rider, body: { vehiclePlate: "UFE 2B", amountUgx: 15000 } });
  assert.equal(await wallet("rider_f"), 85000);
  await client.execute({ sql: "UPDATE fuel_codes SET expires_at = ? WHERE code = ?", args: [new Date(Date.now() - 1000).toISOString(), expiring.json.code.code] });
  assert.equal((await call("/rider/active-code", { token: rider })).json.code, null);
  assert.equal(await wallet("rider_f"), 100000);

  // The admin's daily limit applies.
  await setSetting("gas_rider_daily_limit_ugx", "30000");
  const limited = await call("/rider/generate-code", { token: rider, body: { vehiclePlate: "UFE 2B", amountUgx: 40000 } });
  assert.equal(limited.json.error, "daily_limit_exceeded");

  // The admin's switch turns fuel payments off.
  await setSetting("service_gas_enabled", "0");
  assert.equal((await call("/rider/generate-code", { token: rider, body: { vehiclePlate: "UFE 2B", amountUgx: 5000 } })).status, 503);
});

test("gas: dispense uses the pump price and the voucher's own limits", async () => {
  const { call, mkUser, loginAttendant } = await setup();
  const rider = await mkUser("rider_g", "rider", 100000);
  const attendant = await loginAttendant();

  const gen = await call("/rider/generate-code", { token: rider, body: { vehiclePlate: "UFE 3C", amountUgx: 10000, productId: "prod_petrol" } });
  const code = gen.json.code.code;

  assert.equal((await call("/dispense", { token: attendant, body: { code, productId: "prod_diesel", totalUgx: 5000 } })).json.error, "product_mismatch");
  assert.equal((await call("/dispense", { token: attendant, body: { code, productId: "prod_petrol", totalUgx: 10001 } })).json.error, "limit_exceeded");
  assert.equal((await call("/dispense", { token: attendant, body: { code, productId: "prod_petrol", litres: 1, totalUgx: 10 } })).json.error, "bad_request", "amount must match litres × pump price");
  assert.equal((await call("/verify-code", { token: attendant, body: { code: "12" } })).status, 400, "no partial code matching");

  const ok = await call("/dispense", { token: attendant, body: { code, productId: "prod_petrol", litres: 1 } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.receipt.price_per_litre, 5450, "price comes from the outlet's list");
  assert.equal(ok.json.receipt.total_ugx, 5450);
});
