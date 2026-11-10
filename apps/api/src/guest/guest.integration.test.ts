import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { DEMO_MARKETPLACE_PRODUCTS, marketplaceRoutes } from "../marketplace/routes.js";
import { allowDemoCatalog } from "../test-support/db.js";
import { orderRoutes } from "../orders/routes.js";
import { guestRoutes } from "./routes.js";

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("a guest buys from a shared product link, pays first, and is told about it", async () => {
  const client = createClient({ url: "file::memory:" });
  process.env.JWT_SECRET = "guest-checkout-tests-only";
  for (const file of readdirSync(join(process.cwd(), "src/db/migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(process.cwd(), "src/db/migrations", file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  await allowDemoCatalog(client);
  await client.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('payments_demo_mode', '1')");
  const app = new Hono().route("/v1", guestRoutes).route("/v1", marketplaceRoutes).route("/v1", orderRoutes);
  const json = (path: string, init: { method?: string; token?: string; body?: object } = {}) =>
    app.request(`/v1${path}`, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers: { "Content-Type": "application/json", ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    });

  const config = await (await json("/guest/config")).json() as { enabled: boolean; cardAvailable: boolean; browsingEnabled: boolean };
  assert.equal(config.enabled, true);
  assert.equal(config.cardAvailable, false);
  assert.equal(config.browsingEnabled, false, "guest browsing stays off until an admin turns it on");

  const demo = Object.values(DEMO_MARKETPLACE_PRODUCTS).flat().find((p) => !p.has_variants && Number(p.price) >= 5000);
  assert.ok(demo, "a demo product to buy");
  const details = { productId: demo.id, quantity: 2, name: "Grace Akello", phone: "0772123456", email: "grace@example.com", address: "Plot 4, Ntinda", lat: 0.35, lng: 32.6, createAccount: false };

  // The browser cannot name the price: anything it sends beyond the product is ignored.
  const placed = await json("/guest/checkout", { body: { ...details, price: 1 } });
  assert.equal(placed.status, 201);
  const guest = await placed.json() as { orderId: string; trackingCode: string; token: string; total: number; accountCreated: boolean };
  assert.match(guest.trackingCode, /^PB-[A-Z0-9]{8}$/);
  assert.ok(guest.total >= Number(demo.price) * 2, "total is priced from the catalogue");
  assert.equal(guest.accountCreated, false);

  const user = (await client.execute("SELECT id, phone, role FROM users WHERE phone = '+256772123456'")).rows[0];
  assert.ok(user && user.role === "customer");

  // The guest token reaches only its own order.
  assert.equal((await json(`/orders/${guest.orderId}`, { token: guest.token })).status, 200);
  assert.equal((await json("/orders", { token: guest.token })).status, 403);
  assert.equal((await json("/orders/other-order", { token: guest.token })).status, 403);

  // Wallet is never offered to a guest; mobile money works before any rider exists.
  const wallet = await json(`/orders/${guest.orderId}/fund`, { token: guest.token, body: { paymentMethod: "wallet", useWallet: true } });
  assert.equal(wallet.status, 403);
  const fund = await json(`/orders/${guest.orderId}/fund`, { token: guest.token, body: { paymentMethod: "mobile_money", msisdn: "+256772123456" } });
  assert.ok(fund.status < 300, `fund answered ${fund.status}: ${await fund.clone().text()}`);

  // Tracking: needs a sign-in until the admin lets the code show a status.
  const hidden = await (await json(`/guest/track/${guest.trackingCode.toLowerCase()}`)).json() as { status?: string; canCreateAccount: boolean };
  assert.equal(hidden.status, undefined);
  assert.equal(hidden.canCreateAccount, true);

  // Notifications: chat message sent once, only on the channels the admin turned on.
  for (let i = 0; i < 20; i++) {
    const rows = (await client.execute({ sql: "SELECT channel, status FROM guest_notifications WHERE order_id = ? AND event = 'placed'", args: [guest.orderId] })).rows;
    if (rows.length && rows.every((r) => r.status !== "sending")) break;
    await sleep(50);
  }
  const channels = (await client.execute({ sql: "SELECT channel FROM guest_notifications WHERE order_id = ? AND event = 'placed' ORDER BY channel", args: [guest.orderId] })).rows.map((r) => r.channel);
  assert.deepEqual(channels, ["chat", "push"]);
  const chat = (await client.execute({ sql: "SELECT body, sender_role FROM chat_messages WHERE order_id = ?", args: [guest.orderId] })).rows;
  assert.equal(chat.length, 1);
  assert.match(String(chat[0].body), new RegExp(guest.trackingCode));

  // Making an account later needs the code and the phone used.
  const wrong = await json(`/guest/track/${guest.trackingCode}/account`, { body: { phone: "0700000000", password: "longenough1" } });
  assert.equal(wrong.status, 404);
  const account = await json(`/guest/track/${guest.trackingCode}/account`, { body: { phone: "0772 123 456", password: "longenough1" } });
  assert.equal(account.status, 200);
  assert.equal((await json(`/guest/track/${guest.trackingCode}/account`, { body: { phone: "0772123456", password: "longenough1" } })).status, 409);
  const login = await (await json("/guest/track/" + guest.trackingCode)).json() as { hasAccount: boolean };
  assert.equal(login.hasAccount, true);

  // Signed-in users can follow any code in the app, even while the public status is off.
  const { signToken } = await import("../auth/jwt.js");
  await client.execute("INSERT INTO users (id, phone, name, password_hash, role) VALUES ('someone', '+256700555111', 'Someone', 'x', 'customer')");
  const viewer = await signToken({ sub: "someone", role: "customer" });
  const seen = await (await json(`/guest/track/${guest.trackingCode}`, { token: viewer })).json() as { status?: string; orderId?: string };
  assert.equal(seen.status, "received");
  assert.equal(seen.orderId, undefined, "someone else's order is not opened for them");
  const owner = await signToken({ sub: String(user.id), role: "customer" });
  assert.equal(((await (await json(`/guest/track/${guest.trackingCode}`, { token: owner })).json()) as { orderId?: string }).orderId, guest.orderId);
  assert.equal(((await (await json(`/guest/track/${guest.trackingCode}`, { token: guest.token })).json()) as { status?: string }).status, undefined, "a guest token is not a sign-in");

  // Admin switches: the code now shows a status, and turning guest checkout off refuses new guests.
  await client.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('guest_checkout_code_status', '1')");
  const { invalidateSettingsCache } = await import("../lib/settings.js");
  invalidateSettingsCache();
  const visible = await (await json(`/guest/track/${guest.trackingCode}`)).json() as { status: string };
  assert.equal(visible.status, "received");
  await client.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('guest_checkout_enabled', '0')");
  invalidateSettingsCache();
  assert.equal((await json("/guest/checkout", { body: details })).status, 403);
  await client.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('guest_browsing_enabled', '1')");
  invalidateSettingsCache();
  assert.equal(((await (await json("/guest/config")).json()) as { browsingEnabled: boolean }).browsingEnabled, true);
  assert.equal((await json("/guest/checkout", { body: details })).status, 403, "browsing does not turn checkout back on");

  // A password chosen at checkout makes the account straight away.
  await client.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('guest_checkout_enabled', '1')");
  invalidateSettingsCache();
  const second = await json("/guest/checkout", { body: { ...details, phone: "0701234567", createAccount: true, password: "anotherpass1" } });
  assert.equal(second.status, 201);
  assert.equal(((await second.json()) as { accountCreated: boolean }).accountCreated, true);
  const bad = await json("/guest/checkout", { body: { ...details, phone: "0709999999", createAccount: true } });
  assert.equal(bad.status, 400);
});
