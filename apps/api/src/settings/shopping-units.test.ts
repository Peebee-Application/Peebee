import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { DEFAULT_SHOPPING_UNIT_SETTINGS as defaults, shoppingNamePatch, shoppingItemTotal, serializeShoppingItem, suggestShoppingUnits } from "@peebee/shared";
import { shoppingUnitSettingsSchema, getShoppingUnitSettings } from "./shopping-units.js";
import { settingsRoutes } from "./routes.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { resetSchemaCache } from "../lib/schema.js";
import { setSetting } from "../lib/settings.js";
import { signToken } from "../auth/jwt.js";

test("shopping unit ranking uses names, phrases, packaging and administrator settings", () => {
  for (const [name, unit] of [["Matooke", "bunch"], ["AMATOOKE", "bunch"], ["Rice", "kg"], ["Cooking oil", "l"], ["Shoes", "pair"], ["Nails", "packet"], ["Charcoal", "sack"], ["Matooke flour", "kg"], ["Matooke chips", "packet"], ["Bag of rice", "bag"], ["Rice 5kg", "kg"], ["Charcoal worth UGX 10000", "budget"]]) {
    assert.equal(suggestShoppingUnits(name, defaults)[0], unit, name);
  }
  assert.equal(suggestShoppingUnits("mat", defaults)[0], "bunch");
  assert.equal(suggestShoppingUnits("basketball", defaults)[0], "pcs", "unrelated substrings do not match");
  assert.equal(suggestShoppingUnits("oilcloth", defaults)[0], "pcs", "oil is not a substring match");
  assert.ok(suggestShoppingUnits("matooke", defaults).length <= defaults.suggestedCount);
  assert.deepEqual(suggestShoppingUnits("rice", { ...defaults, enabled: false }), defaults.fallbackUnits);
  assert.deepEqual(suggestShoppingUnits("rice", { ...defaults, suggestedCount: 1 }), ["kg"]);
  assert.equal(suggestShoppingUnits("charcoal worth UGX 10000", { ...defaults, allowBudget: false })[0], "sack");
  assert.equal(suggestShoppingUnits("coffee", { ...defaults, rules: [{ keywords: ["coffee"], units: ["packet", "bag"], priority: 0 }] })[0], "packet");
});

test("automatic units preserve manual and custom choices and clear prices when the unit changes", () => {
  const item = { name: "rice", quantity: "2", unitCost: "5000", unit: "kg" as const };
  assert.equal(shoppingNamePatch(item, "matooke", defaults).unit, "bunch");
  assert.equal(shoppingNamePatch(item, "matooke", defaults).unitCost, "");
  assert.deepEqual(shoppingNamePatch({ ...item, unitSource: "manual" }, "matooke", defaults), { name: "matooke" });
  assert.deepEqual(shoppingNamePatch({ ...item, unit: "other", customUnit: "medium bunch", unitSource: "manual" }, "rice", defaults), { name: "rice" });
  assert.deepEqual(shoppingNamePatch(item, "matooke", { ...defaults, autoSelect: false }), { name: "matooke" });
});

test("buying by amount charges the budget once and preserves the shopper instruction", () => {
  const item = { name: "Charcoal", quantity: "50", unitCost: "10000", unit: "budget" as const };
  assert.equal(shoppingItemTotal(item), 10000);
  assert.deepEqual(serializeShoppingItem(item), { name: "Charcoal (buy for UGX 10,000)", quantity: 1, unitCost: 10000 });
  assert.equal(shoppingItemTotal({ ...item, unit: "bag" }), 500000);
  assert.deepEqual(serializeShoppingItem({ ...item, unit: "other", customUnit: " half sack ", quantity: "2" }), { name: "Charcoal (half sack)", quantity: 2, unitCost: 10000 });
  assert.throws(() => serializeShoppingItem({ ...item, unitCost: "" }));
  assert.throws(() => serializeShoppingItem({ ...item, unit: "other", customUnit: " " }));
});

function bindDatabase(client: Client) {
  const prepare = (sql: string) => ({
    sql, args: [] as unknown[],
    bind(...args: unknown[]) { this.args = args; return this; },
    async all() { const result = await client.execute({ sql: this.sql, args: this.args as InArgs }); return { results: result.rows, success: true, meta: { changes: result.rowsAffected, last_row_id: Number(result.lastInsertRowid ?? 0) } }; },
  });
  setD1Binding({ prepare, async batch(statements: ReturnType<typeof prepare>[]) {
    const results = await client.batch(statements.map(({ sql, args }) => ({ sql, args: args as InArgs })), "write");
    return results.map((r) => ({ results: r.rows, success: true, meta: { changes: r.rowsAffected, last_row_id: Number(r.lastInsertRowid ?? 0) } }));
  } } as unknown as D1Database);
}

test("shopping units: admin authorization, validation, persistence, client exposure and activity log", async () => {
  process.env.JWT_SECRET = "local-shopping-unit-tests-only";
  resetSchemaCache();
  const client = createClient({ url: "file::memory:" });
  try {
    const migrations = join(process.cwd(), "src/db/migrations");
    for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
      for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
    }
    bindDatabase(client);
    await client.execute("INSERT INTO users (id,phone,name,password_hash,role,admin_role) VALUES ('admin','unit-admin','Admin','h','admin','super_admin'),('cust','unit-cust','Customer','h','customer',NULL)");
    const app = new Hono().route("/v1", settingsRoutes);
    const admin = await signToken({ sub: "admin", role: "admin" });
    const customer = await signToken({ sub: "cust", role: "customer" });
    const request = (token: string, body: unknown) => app.request("/v1/admin/settings", { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.deepEqual(await getShoppingUnitSettings(), defaults);
    assert.equal((await request(customer, { shoppingUnits: defaults })).status, 403);
    assert.equal((await request(admin, { shoppingUnits: { ...defaults, suggestedCount: 99 } })).status, 400);
    assert.equal((await request(admin, { shoppingUnits: { ...defaults, rules: [{ keywords: ["rice"], units: ["invalid"], priority: 0 }] } })).status, 400);
    assert.equal(shoppingUnitSettingsSchema.safeParse({ ...defaults, allowBudget: false, fallbackUnits: ["budget"] }).success, false);
    const changed = { ...defaults, suggestedCount: 2, autoSelect: false, rules: [{ keywords: ["coffee"], units: ["packet" as const, "bag" as const], priority: 1 }] };
    const saved = await request(admin, { shoppingUnits: changed });
    assert.equal(saved.status, 200, await saved.clone().text());
    assert.deepEqual(await getShoppingUnitSettings(), changed);
    const exposed = await app.request("/v1/settings", { headers: { Authorization: `Bearer ${customer}` } });
    const data = await exposed.json() as { settings: { shoppingUnits: unknown } };
    assert.deepEqual(data.settings.shoppingUnits, changed);
    assert.ok((await client.execute("SELECT * FROM admin_activity_log")).rows.length > 0);
    await setSetting("shopping_units_config", "bad-json");
    assert.deepEqual(await getShoppingUnitSettings(), defaults, "bad saved settings safely fall back");
  } finally { setD1Binding(undefined); client.close(); }
});
