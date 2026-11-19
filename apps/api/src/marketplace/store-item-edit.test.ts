import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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
  const client = createClient({ url: "file::memory:" });
  const dir = existsSync(join(process.cwd(), "apps/api/src/db/migrations")) ? join(process.cwd(), "apps/api/src/db/migrations") : join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) for (const sql of splitSqlStatements(readFileSync(join(dir, file), "utf8"))) await client.execute(sql);
  return client;
}

test("a wizard item can be edited in place: same id, variants keep their ids, other stores get 404", async () => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "store-item-edit-tests-only";
  resetSchemaCache();
  invalidateSettingsCache();
  const client = await setup();
  bindDatabase(client);
  try {
    for (const [u, m, phone] of [["ed_1", "ed_m1", "+256700111333"], ["ed_2", "ed_m2", "+256700111444"]]) {
      await client.execute({ sql: "INSERT INTO users (id, phone, name, password_hash, role, status) VALUES (?, ?, 'Owner', 'hash', 'customer', 'active')", args: [u, phone] });
      await client.execute({ sql: "INSERT INTO merchants (id, legal_name, display_name, business_kind, status, environment) VALUES (?, 'Shop Ltd', 'Shop', 'business', 'active', 'sandbox')", args: [m] });
      await client.execute({ sql: "INSERT INTO merchant_members (merchant_id, user_id, role, status) VALUES (?, ?, 'owner', 'active')", args: [m, u] });
    }
    const reqAs = async (user: string) => {
      const token = await signToken({ sub: user, role: "customer" });
      return (path: string, method = "GET", body?: object) => app.request(`/v1${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    };
    const req = await reqAs("ed_1");
    const other = await reqAs("ed_2");
    assert.equal((await req("/merchants/me/store", "POST", { name: "Kicks", category: "stores", sub_category: "fashion", address: "Kampala" })).status, 200);
    assert.equal((await other("/merchants/me/store", "POST", { name: "Other", category: "stores", sub_category: "fashion", address: "Kampala" })).status, 200);

    const base = {
      title: "Canvas sneakers", description: "White", category_name: "Shoes", badge: "New", images: ["https://example.com/a.jpg"], price: 85000,
      options: [{ name: "Size", values: [{ value: "40" }, { value: "41" }] }, { name: "Colour", values: [{ value: "Black" }] }],
      variants: [{ values: ["40", "Black"], price: 85000, inventory_quantity: 3 }, { values: ["41", "Black"], price: 85000, inventory_quantity: 4 }],
      show_in_app: true, show_on_web: true, status: "active",
    };
    const made = await req("/merchants/me/store/items", "POST", base);
    assert.equal(made.status, 201);
    const { productId } = (await made.json()) as { productId: string };
    const before = (await client.execute({ sql: "SELECT id, option1_value FROM store_product_variants WHERE product_id = ? ORDER BY option1_value", args: [productId] })).rows;

    const saved = await req(`/merchants/me/store/items/${productId}`, "PUT", {
      ...base, title: "Canvas sneakers v2", category_name: "Sneakers", price: 90000, compare_at_price: 99000,
      variants: [{ values: ["40", "Black"], price: 90000, inventory_quantity: 5 }, { values: ["41", "Black"], price: 90000, inventory_quantity: 1 }],
    });
    assert.equal(saved.status, 200);
    const row = (await client.execute({ sql: "SELECT title, category_name, price, compare_at_price, inventory_quantity, has_variants FROM store_products WHERE id = ?", args: [productId] })).rows[0] as any;
    assert.equal(row.title, "Canvas sneakers v2");
    assert.equal(row.category_name, "Sneakers");
    assert.equal(Number(row.price), 90000);
    assert.equal(Number(row.compare_at_price), 99000);
    assert.equal(Number(row.inventory_quantity), 6);
    const after = (await client.execute({ sql: "SELECT id, option1_value, price FROM store_product_variants WHERE product_id = ? ORDER BY option1_value", args: [productId] })).rows as any[];
    assert.deepEqual(after.map((r) => r.id), before.map((r) => r.id), "variants keep their ids");
    assert.equal(Number(after[0].price), 90000);
    assert.equal(Number((await client.execute({ sql: "SELECT COUNT(*) AS n FROM store_products WHERE store_id = (SELECT store_id FROM store_products WHERE id = ?)", args: [productId] })).rows[0].n), 1, "no copy was made");

    // Leaving variants out keeps them.
    const { variants: _v, options: _o, ...noVariants } = base;
    assert.equal((await req(`/merchants/me/store/items/${productId}`, "PUT", { ...noVariants, title: "Canvas sneakers v3" })).status, 200);
    assert.equal(Number((await client.execute({ sql: "SELECT COUNT(*) AS n FROM store_product_variants WHERE product_id = ?", args: [productId] })).rows[0].n), 2);

    assert.equal((await other(`/merchants/me/store/items/${productId}`, "PUT", base)).status, 404, "not another store's item");
    assert.equal((await req(`/merchants/me/store/items/nope`, "PUT", base)).status, 404);
    assert.equal((await req(`/merchants/me/store/items/${productId}`, "PUT", { ...base, title: "x" })).status, 400);
  } finally {
    if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous;
  }
});
