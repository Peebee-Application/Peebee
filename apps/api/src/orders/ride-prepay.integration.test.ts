import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { setSetting } from "../lib/settings.js";
import { orderRoutes } from "./routes.js";

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

test("A first-come ride can be paid before a rider is found, only when the admin switch is on", async (t) => {
  const client = createClient({ url: "file::memory:" });
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "ride-prepay-tests-only";
  for (const file of readdirSync(join(process.cwd(), "src/db/migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(process.cwd(), "src/db/migrations", file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  try {
    await client.execute("INSERT INTO users (id, phone, name, password_hash, role, wallet_balance) VALUES ('customer', 'c', 'Customer', 'h', 'customer', 50000), ('rider', 'r', 'Rider', 'h', 'rider', 0)");
    await client.execute("INSERT INTO riders (user_id, verified) VALUES ('rider', 1)");
    await client.execute("INSERT INTO lists (id, customer_id, title) VALUES ('list', 'customer', 'Ride')");
    const ride = (id: string, mode: string, rider: string | null = null, isRide = 1) => client.execute({
      sql: "INSERT INTO orders (id, list_id, customer_id, rider_id, stage, estimated_total, delivery_fee, environment, type, is_ride, payment_rail, matching_mode) VALUES (?, 'list', 'customer', ?, 'Match', 8000, 8000, 'live', 'parcel', ?, 'escrow', ?)",
      args: [id, rider, isRide, mode],
    });
    const app = new Hono().route("/v1", orderRoutes);
    const token = await signToken({ sub: "customer", role: "customer" });
    const call = (path: string, body?: object) => app.request(`/v1/orders/${path}`, {
      method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const payBefore = async (id: string) => ((await (await call(`${id}/checkout`)).json()) as { payBeforeRider: boolean }).payBeforeRider;
    await ride("fcfs", "first_to_claim");
    await ride("nearest", "nearest_window");
    await ride("picks", "customer_selects");
    await ride("matched", "first_to_claim", "rider");
    await ride("parcel", "first_to_claim", null, 0);

    await t.test("off by default: the customer pays after a rider is matched", async () => {
      assert.equal(await payBefore("fcfs"), false);
      const early = await call("fcfs/fund", { paymentMethod: "wallet", useWallet: true });
      assert.equal(early.status, 409);
    });

    await t.test("on: first-come rides are paid first, rides the customer picks and parcels are not", async () => {
      await setSetting("ride_pay_first", "1");
      assert.equal(await payBefore("fcfs"), true);
      assert.equal(await payBefore("nearest"), true);
      assert.equal(await payBefore("picks"), false, "the customer pays after picking a rider");
      assert.equal(await payBefore("matched"), false, "a ride that already has its rider is paid the usual way");
      assert.equal(await payBefore("parcel"), false, "only rides");
    });

    await t.test("paying first holds the money and leaves the ride waiting for a rider; cash is refused", async () => {
      const cash = await call("fcfs/fund", { paymentMethod: "cash" });
      assert.equal(cash.status, 409);
      assert.equal(((await cash.json()) as { error: string }).error, "ride_requires_prepay");

      const paid = await call("fcfs/fund", { paymentMethod: "wallet", useWallet: true });
      assert.equal(paid.status, 200);
      const row = (await client.execute("SELECT stage, rider_id FROM orders WHERE id = 'fcfs'")).rows[0]!;
      assert.equal(row.stage, "Match", "held, still looking for a rider");
      assert.equal(row.rider_id, null);
      assert.equal((await client.execute("SELECT status FROM payments WHERE order_id = 'fcfs' AND type = 'collection'")).rows[0]!.status, "successful");
      assert.ok(Number((await client.execute("SELECT wallet_balance AS b FROM users WHERE id = 'customer'")).rows[0]!.b) < 50000, "the fare left the wallet");
    });
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret;
  }
});
