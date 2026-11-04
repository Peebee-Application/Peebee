import assert from "node:assert/strict";
import test from "node:test";
import { setPracticeD1Binding } from "../db/client.js";
import { runInPractice } from "../db/practice-context.js";
import { getSetting, invalidateSettingsCache } from "../lib/settings.js";
import { freshDatabase, practiceHarness, shim } from "./world-test-helpers.js";

test("with a separate practice database, practice people and orders never reach the main database", async (t) => {
  const { db: main, tokens, call, json, start } = await practiceHarness();
  const practiceDb = await freshDatabase();
  setPracticeD1Binding(shim(practiceDb));
  t.after(() => setPracticeD1Binding(undefined));
  invalidateSettingsCache();

  const customer = await start("customer");
  assert.ok(customer.user.id.startsWith("prac_"));
  const count = async (db: typeof main, table: string, col: string) => Number((await db.execute(`SELECT COUNT(*) n FROM ${table} WHERE ${col} LIKE 'prac\\_%' ESCAPE '\\'`)).rows[0]!.n);
  assert.ok((await count(practiceDb, "users", "id")) > 0, "demo people are in the practice database");
  assert.equal(await count(main, "users", "id"), 0, "none of them are in the main database");

  // The practice customer can use the app: the session works against the practice database.
  const me = await call(customer.token, "/auth/me");
  assert.equal(me.status, 200);
  assert.equal((await json<{ user: { id: string } }>(me)).user.id, customer.user.id);

  // Demo customers' orders land in the practice database only.
  const placed = await json<{ placed: number }>(await call(tokens.admin, "/admin/practice/orders", { method: "POST" }));
  assert.ok(placed.placed > 0);
  assert.ok((await count(practiceDb, "orders", "customer_id")) > 0);
  assert.equal(await count(main, "orders", "customer_id"), 0);

  // Settings stay the platform's: practice reads the switches set in the main database.
  assert.equal(await runInPractice(() => getSetting("practice_shared_world")), "1");
  assert.equal(Number((await practiceDb.execute("SELECT COUNT(*) n FROM settings WHERE key = 'practice_shared_world'")).rows[0]!.n), 0, "the practice database has no copy of the settings");

  // Admin sees the practice world's numbers, and that it has its own database.
  const status = await json<{ seeded: boolean; separateDatabase: boolean; counts: { orders: number } }>(await call(tokens.admin, "/admin/practice"));
  assert.equal(status.seeded, true);
  assert.equal(status.separateDatabase, true);
  assert.ok(status.counts.orders > 0);
});
