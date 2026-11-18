import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import app from "../app.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { resetSchemaCache } from "../lib/schema.js";
import { invalidateSettingsCache } from "../lib/settings.js";
import { signToken } from "../auth/jwt.js";

function bindDatabase(client: Client) {
  const prepare = (sql: string) => ({
    sql, args: [] as unknown[],
    bind(...args: unknown[]) { this.args = args; return this; },
    async all() {
      const r = await client.execute({ sql: this.sql, args: this.args as InArgs });
      return { results: r.rows, success: true, meta: { changes: r.rowsAffected, last_row_id: Number(r.lastInsertRowid ?? 0) } };
    },
  });
  setD1Binding({
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      const rs = await client.batch(statements.map(({ sql, args }) => ({ sql, args: args as InArgs })), "write");
      return rs.map((r) => ({ results: r.rows, success: true, meta: { changes: r.rowsAffected, last_row_id: Number(r.lastInsertRowid ?? 0) } }));
    },
  } as unknown as D1Database);
}

async function setup() {
  resetSchemaCache();
  invalidateSettingsCache();
  const client = createClient({ url: "file::memory:" });
  const dir = existsSync(join(process.cwd(), "apps/api/src/db/migrations")) ? join(process.cwd(), "apps/api/src/db/migrations") : join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) for (const sql of splitSqlStatements(readFileSync(join(dir, file), "utf8"))) await client.execute(sql);
  bindDatabase(client);
  const hash = bcrypt.hashSync("owner-pass-1", 4);
  await client.execute({ sql: "INSERT INTO users (id, phone, name, password_hash, role, status, wallet_balance) VALUES ('pc_1', '+256700333444', 'Owner', ?, 'customer', 'active', 500000)", args: [hash] });
  await client.execute("INSERT INTO merchants (id, legal_name, display_name, business_kind, status, environment) VALUES ('pc_m1', 'Shop Ltd', 'Shop', 'business', 'active', 'sandbox')");
  await client.execute("INSERT INTO merchant_members (merchant_id, user_id, role, status) VALUES ('pc_m1', 'pc_1', 'owner', 'active')");
  const token = await signToken({ sub: "pc_1", role: "customer" });
  const req = (path: string, method = "GET", body?: object) => app.request(`/v1${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const store = await req("/merchants/me/store", "POST", { name: "Plan Shop", category: "stores", sub_category: "fashion", address: "Kampala" });
  assert.equal(store.status, 200);
  const setSetting = async (key: string, value: string) => {
    await client.execute({ sql: "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [key, value] });
    invalidateSettingsCache();
  };
  const wallet = async () => Number((await client.execute("SELECT wallet_balance FROM users WHERE id = 'pc_1'")).rows[0].wallet_balance);
  return { client, req, setSetting, wallet };
}

test("plan changes go review → pay → verify → done, with proration, scheduled downgrades and a PIN fallback", async (t) => {
  const prev = { jwt: process.env.JWT_SECRET, env: process.env.ENVIRONMENT };
  process.env.JWT_SECRET = "plan-checkout-tests-only";
  delete process.env.ENVIRONMENT;
  const { client, req, setSetting, wallet } = await setup();
  try {
    await setSetting("marketplace_pro_pricing_mode", "paid");
    // End the welcome trial so the store starts on Merchant.
    await client.execute("UPDATE stores SET pro_tier = 'free', pro_expires_at = NULL WHERE merchant_id = 'pc_m1'");

    await t.test("the plans list follows the admin prices and hides Pro Store", async () => {
      const plans = (await (await req("/merchants/me/store/plans")).json()) as any;
      assert.equal(plans.pricingMode, "paid");
      assert.equal(plans.current.plan, "merchant");
      assert.deepEqual(plans.plans.map((p: any) => p.tier), ["merchant", "pro_live", "elite"]);
      assert.equal(plans.plans.find((p: any) => p.tier === "pro_live").monthly, 75000);
      assert.equal(plans.verify.channel, "sms");
      assert.equal(plans.methods.wallet, true);
    });

    let proPaidAt = 0;
    await t.test("a paid upgrade only switches the plan after the code is verified, and is paid from the wallet", async () => {
      const quote = (await (await req("/merchants/me/store/plan-quote", "POST", { tier: "pro_live", billingCycle: "monthly" })).json()) as any;
      assert.equal(quote.quote.amount, 75000);
      assert.equal(quote.quote.kind, "upgrade");
      const created = await req("/merchants/me/store/plan-checkouts", "POST", { tier: "pro_live", billingCycle: "monthly", method: "wallet" });
      assert.equal(created.status, 201);
      const body = (await created.json()) as any;
      assert.match(body.checkout.reference, /^PB-SUB-/);
      assert.equal(body.checkout.status, "awaiting_code");
      assert.match(body.devCode, /^\d{6}$/);
      // Nothing changes before verification.
      assert.equal(await wallet(), 500000);
      const wrong = body.devCode === "000000" ? "111111" : "000000";
      assert.equal((await req(`/merchants/me/store/plan-checkouts/${body.checkout.id}/verify`, "POST", { code: wrong })).status, 400);
      const ok = (await (await req(`/merchants/me/store/plan-checkouts/${body.checkout.id}/verify`, "POST", { code: body.devCode })).json()) as any;
      assert.equal(ok.checkout.status, "active");
      assert.equal(await wallet(), 425000);
      proPaidAt = Date.now();
      const plans = (await (await req("/merchants/me/store/plans")).json()) as any;
      assert.equal(plans.current.plan, "pro_live");
      const receipts = (await (await req("/merchants/me/store/plan-checkouts")).json()) as any;
      assert.ok(receipts.checkouts.some((r: any) => r.reference === body.checkout.reference && r.status === "active"));
    });

    await t.test("moving up gives credit for the unused days of the plan in force", async () => {
      assert.ok(proPaidAt > 0);
      const quote = (await (await req("/merchants/me/store/plan-quote", "POST", { tier: "elite", billingCycle: "monthly" })).json()) as any;
      assert.equal(quote.quote.listPrice, 150000);
      assert.ok(quote.quote.credit > 70000 && quote.quote.credit <= 75000, `credit ${quote.quote.credit}`);
      assert.equal(quote.quote.amount, 150000 - quote.quote.credit);
    });

    await t.test("a move down is scheduled for the end of the period and can be cancelled", async () => {
      const created = (await (await req("/merchants/me/store/plan-checkouts", "POST", { tier: "merchant", billingCycle: "monthly", method: "free" })).json()) as any;
      assert.equal(created.checkout.kind, "downgrade");
      const verified = (await (await req(`/merchants/me/store/plan-checkouts/${created.checkout.id}/verify`, "POST", { code: created.devCode })).json()) as any;
      assert.equal(verified.checkout.status, "scheduled");
      const plans = (await (await req("/merchants/me/store/plans")).json()) as any;
      assert.equal(plans.current.plan, "pro_live");
      assert.equal(plans.scheduled.id, created.checkout.id);
      const cancelled = await req(`/merchants/me/store/plan-checkouts/${created.checkout.id}/cancel`, "POST", {});
      assert.equal(cancelled.status, 200);
      const after = (await (await req("/merchants/me/store/plans")).json()) as any;
      assert.equal(after.scheduled, null);
    });

    await t.test("in free mode the same steps run at UGX 0", async () => {
      await setSetting("marketplace_pro_pricing_mode", "free");
      const created = (await (await req("/merchants/me/store/plan-checkouts", "POST", { tier: "elite", billingCycle: "monthly", method: "wallet" })).json()) as any;
      assert.equal(created.checkout.amount, 0);
      assert.equal(created.checkout.method, "free");
      const before = await wallet();
      const ok = (await (await req(`/merchants/me/store/plan-checkouts/${created.checkout.id}/verify`, "POST", { code: created.devCode })).json()) as any;
      assert.equal(ok.checkout.status, "active");
      assert.equal(await wallet(), before);
      await setSetting("marketplace_pro_pricing_mode", "paid");
    });

    await t.test("without text messages the owner confirms with a PIN, which is hashed and locks after wrong tries", async () => {
      process.env.ENVIRONMENT = "production";
      try {
        const plans = (await (await req("/merchants/me/store/plans")).json()) as any;
        assert.deepEqual(plans.verify, { channel: "pin", pinSet: false });
        assert.equal((await req("/merchants/me/store/plan-checkouts", "POST", { tier: "pro_live", billingCycle: "monthly", method: "wallet" })).status, 409);
        assert.equal((await req("/merchants/me/store/plan-pin", "POST", { pin: "1234", password: "owner-pass-1" })).status, 400);
        assert.equal((await req("/merchants/me/store/plan-pin", "POST", { pin: "4826", password: "wrong" })).status, 400);
        assert.equal((await req("/merchants/me/store/plan-pin", "POST", { pin: "4826", password: "owner-pass-1" })).status, 200);
        const stored = String((await client.execute("SELECT pin_hash FROM owner_pins WHERE user_id = 'pc_1'")).rows[0].pin_hash);
        assert.ok(!stored.includes("4826"));
        // Changing it needs the current PIN.
        assert.equal((await req("/merchants/me/store/plan-pin", "POST", { pin: "5937" })).status, 400);

        const created = await req("/merchants/me/store/plan-checkouts", "POST", { tier: "pro_live", billingCycle: "monthly", method: "wallet" });
        assert.equal(created.status, 201);
        const body = (await created.json()) as any;
        assert.equal(body.checkout.verifyMethod, "pin");
        assert.equal(body.devCode, undefined);
        const bad = await req(`/merchants/me/store/plan-checkouts/${body.checkout.id}/verify`, "POST", { code: "9999" });
        assert.equal(bad.status, 400);
        assert.equal(((await bad.json()) as any).error, "wrong_pin");
        const ok = (await (await req(`/merchants/me/store/plan-checkouts/${body.checkout.id}/verify`, "POST", { code: "4826" })).json()) as any;
        assert.equal(ok.checkout.kind, "downgrade");
        assert.equal(ok.checkout.status, "scheduled");

        // Five wrong PINs lock it.
        let last = 0;
        for (let i = 0; i < 5; i++) last = (await req("/merchants/me/store/plan-pin", "POST", { pin: "5937", currentPin: "1111" })).status;
        assert.equal(last, 429);
        assert.equal((await req("/merchants/me/store/plan-pin", "POST", { pin: "5937", currentPin: "4826" })).status, 429);
      } finally {
        delete process.env.ENVIRONMENT;
      }
    });

    await t.test("the one-tap tier change is closed outside development", async () => {
      process.env.ENVIRONMENT = "production";
      try {
        const res = await req("/merchants/me/store/tier", "POST", { tier: "elite", billingCycle: "monthly" });
        assert.equal(res.status, 409);
        assert.equal(((await res.json()) as any).error, "verification_required");
      } finally {
        delete process.env.ENVIRONMENT;
      }
    });
  } finally {
    process.env.JWT_SECRET = prev.jwt;
    if (prev.env === undefined) delete process.env.ENVIRONMENT;
    else process.env.ENVIRONMENT = prev.env;
  }
});

test("the add-item wizard publishes a product with photos, channels and delivery; outlet stock is Elite only", async () => {
  const prevJwt = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "store-items-tests-only";
  delete process.env.ENVIRONMENT;
  const { client, req } = await setup();
  try {
    const storeRow = (await client.execute("SELECT id, slug FROM stores WHERE merchant_id = 'pc_m1'")).rows[0];
    await client.execute("UPDATE stores SET status = 'active' WHERE merchant_id = 'pc_m1'");
    const env = (await client.execute("SELECT environment FROM stores WHERE merchant_id = 'pc_m1'")).rows[0].environment;
    await client.execute({ sql: "INSERT INTO settings (key, value) VALUES ('platform_environment', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [String(env)] });
    invalidateSettingsCache();

    const img = (n: number) => `https://cdn.example.com/p${n}.jpg`;
    const created = await req("/merchants/me/store/items", "POST", {
      title: "Kitenge dress", description: "Hand made", category_name: "Fashion", price: 85000, compare_at_price: 95000,
      images: [img(1), img(2), img(3)], inventory_quantity: 12,
      delivery: { delivery: true, pickup: true, sameDay: true, readyInDays: 0 },
      show_in_app: true, show_on_web: false, status: "active",
    });
    assert.equal(created.status, 201, await created.clone().text());
    const { productId } = (await created.json()) as any;

    const inApp = (await (await app.request(`/v1/marketplace/stores/${String(storeRow.id)}/products`)).json()) as any;
    const product = inApp.products.find((p: any) => p.id === productId);
    assert.ok(product, "shows in Buy");
    assert.deepEqual(product.images, [img(1), img(2), img(3)]);
    assert.equal(product.image_url, img(1));
    assert.equal(product.delivery.sameDay, true);
    assert.equal(product.cost_price, undefined);

    const onWeb = (await (await app.request(`/v1/marketplace/stores/${String(storeRow.id)}/products?channel=web`)).json()) as any;
    assert.equal(onWeb.products.some((p: any) => p.id === productId), false, "hidden from the website");

    const draft = await req("/merchants/me/store/items", "POST", { title: "Draft tee", price: 20000, status: "draft" });
    assert.equal(draft.status, 201);
    const again = (await (await app.request(`/v1/marketplace/stores/${String(storeRow.id)}/products`)).json()) as any;
    assert.equal(again.products.some((p: any) => p.title === "Draft tee"), false, "drafts stay private");

    const outlet = await req("/merchants/me/store/items", "POST", { title: "Shoes", price: 50000, outlets: [{ outletId: "out_1", quantity: 4 }] });
    assert.equal(outlet.status, 403);
    assert.equal(((await outlet.json()) as any).error, "elite_required");

    const nowhere = await req("/merchants/me/store/items", "POST", { title: "Hat", price: 5000, show_in_app: false, show_on_web: false });
    assert.equal(nowhere.status, 400);
  } finally {
    process.env.JWT_SECRET = prevJwt;
  }
});
