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
import { withOptions } from "./variations.js";
import { resolveProductVariations } from "@peebee/shared";

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

async function merchantClient() {
  resetSchemaCache();
  invalidateSettingsCache();
  const client = createClient({ url: "file::memory:" });
  const dir = existsSync(join(process.cwd(), "apps/api/src/db/migrations")) ? join(process.cwd(), "apps/api/src/db/migrations") : join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) for (const sql of splitSqlStatements(readFileSync(join(dir, file), "utf8"))) await client.execute(sql);
  bindDatabase(client);
  await client.execute("INSERT INTO users (id, phone, name, password_hash, role, status) VALUES ('mv_1', '+256700111222', 'Owner', 'hash', 'customer', 'active')");
  await client.execute("INSERT INTO merchants (id, legal_name, display_name, business_kind, status, environment) VALUES ('mv_m1', 'Shop Ltd', 'Shop', 'business', 'active', 'sandbox')");
  await client.execute("INSERT INTO merchant_members (merchant_id, user_id, role, status) VALUES ('mv_m1', 'mv_1', 'owner', 'active')");
  const token = await signToken({ sub: "mv_1", role: "customer" });
  const req = (path: string, method = "GET", body?: object) => app.request(`/v1${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const store = await req("/merchants/me/store", "POST", { name: "Tee Shop", category: "stores", sub_category: "fashion", address: "Kampala" });
  assert.equal(store.status, 200);
  return { client, req };
}

test("a product can be created with options, edited later, and variants keep their ids", async () => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "product-variations-tests-only";
  const { client, req } = await merchantClient();
  try {
    const created = await req("/merchants/me/products", "POST", {
      title: "Logo tee", price: 30000, has_variants: true,
      options: [{ name: "Colour", values: [{ value: "Black" }, { value: "Red", hex: "#d92d20" }] }, { name: "Size", values: [{ value: "M" }, { value: "L" }] }],
      variants: [
        { values: ["Black", "M"], price: 30000, inventory_quantity: 5, sku: "T-BM", barcode: "123" },
        { values: ["Black", "L"], price: 30000, inventory_quantity: 0 },
        { values: ["Red", "M"], price: 32000, inventory_quantity: 2 },
        { values: ["Red", "L"], price: 32000, inventory_quantity: 2 },
      ],
    });
    assert.equal(created.status, 200);
    const { productId } = (await created.json()) as { productId: string };

    const list = (await (await req("/merchants/me/products")).json()) as any;
    const product = list.products.find((p: any) => p.id === productId);
    assert.deepEqual(product.options.map((o: any) => o.key), ["color", "size"]);
    assert.equal(product.options[0].values.find((v: any) => v.value === "Red").hex, "#d92d20");
    assert.equal(product.options[0].values.find((v: any) => v.value === "Black").hex, "#111111");
    assert.equal(product.variants.length, 4);
    assert.equal(product.variants[0].title, "Black / M");
    assert.equal(product.variants[0].barcode, "123");
    assert.ok(list.variationSettings.types.length > 0);

    const first = product.variants.find((v: any) => v.title === "Black / M");
    const edit = await req(`/merchants/me/products/${productId}/variations`, "PUT", {
      options: [{ name: "Colour", values: [{ value: "Black" }, { value: "Red" }] }, { name: "Size", values: [{ value: "M" }, { value: "L" }, { value: "XL" }] }],
      variants: [
        { id: first.id, values: ["Black", "M"], price: 31000, inventory_quantity: 9 },
        { values: ["Black", "XL"], price: 31000, inventory_quantity: 4 },
      ],
    });
    assert.equal(edit.status, 200);
    const after = ((await (await req("/merchants/me/products")).json()) as any).products.find((p: any) => p.id === productId);
    assert.equal(after.variants.length, 2);
    assert.equal(after.variants.find((v: any) => v.title === "Black / M").id, first.id);
    assert.equal(after.variants.find((v: any) => v.title === "Black / M").price, 31000);
    assert.deepEqual(after.options[1].values.map((v: any) => v.value), ["M", "XL"]);

    const stranger = await req("/merchants/me/products/prod_missing/variations", "PUT", { options: [], variants: [] });
    assert.equal(stranger.status, 404);
  } finally {
    process.env.JWT_SECRET = previous;
    client.close();
  }
});

test("admin rules are enforced when a merchant saves variations", async () => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "product-variations-tests-only";
  const { client, req } = await merchantClient();
  try {
    await client.execute({ sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('product_variations', ?)", args: [JSON.stringify({ allowCustomOptions: false, maxOptionsPerProduct: 2, maxVariantsPerProduct: 3 })] });
    invalidateSettingsCache();
    const custom = await req("/merchants/me/products", "POST", { title: "Mug", price: 5000, has_variants: true, options: [{ name: "Engraving", values: [{ value: "Yes" }] }], variants: [{ values: ["Yes"], price: 5000 }] });
    assert.equal(custom.status, 400);
    assert.equal(((await custom.json()) as any).error, "option_not_allowed");
    const tooMany = await req("/merchants/me/products", "POST", { title: "Mug 2", price: 5000, has_variants: true, options: [{ name: "Colour", values: [{ value: "A" }, { value: "B" }] }, { name: "Size", values: [{ value: "S" }, { value: "M" }] }], variants: [
      { values: ["A", "S"], price: 5000 }, { values: ["A", "M"], price: 5000 }, { values: ["B", "S"], price: 5000 }, { values: ["B", "M"], price: 5000 }] });
    assert.equal(tooMany.status, 400);
    assert.equal(((await tooMany.json()) as any).error, "too_many_variants");
    const left = await client.execute("SELECT COUNT(*) AS n FROM store_products WHERE title IN ('Mug', 'Mug 2')");
    assert.equal(Number(left.rows[0].n), 0, "a rejected product is not left behind");
  } finally {
    process.env.JWT_SECRET = previous;
    client.close();
  }
});

test("public product fields hide the internal barcode and expose options", () => {
  const settings = resolveProductVariations(null);
  const out = withOptions({ id: "p", options_json: "{}" }, [{ option1_name: "Colour", option1_value: "Red", price: 1, barcode: "999", position: 1 } as never], settings, true) as any;
  assert.equal(out.variants[0].barcode, undefined);
  assert.equal(out.options_json, undefined);
  assert.equal(out.options[0].key, "color");
});
