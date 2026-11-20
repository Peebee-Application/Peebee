import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { DEFAULT_HOME_MENU, resolveHomeMenu, type HomeMenuSettings } from "@peebee/shared";
import { getHomeMenuSettings, homeMenuSchema } from "./home-menu.js";
import { settingsRoutes } from "./routes.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { resetSchemaCache } from "../lib/schema.js";
import { setSetting } from "../lib/settings.js";
import { signToken } from "../auth/jwt.js";

const clone = (): HomeMenuSettings => structuredClone(DEFAULT_HOME_MENU);

test("the built-in home menu is valid and has the five clusters", () => {
  assert.equal(homeMenuSchema.safeParse(DEFAULT_HOME_MENU).success, true);
  assert.deepEqual(Object.values(DEFAULT_HOME_MENU.clusters).map((c) => c.label), ["Ride", "Buy", "Eat", "Learn", "Work"]);
});

test("Work has a fixed default name while older alternate-label settings remain valid", () => {
  assert.equal(DEFAULT_HOME_MENU.hive.altLabel, "");
  assert.equal(DEFAULT_HOME_MENU.hive.labelSeconds, 4);
  const none = clone();
  none.hive.altLabel = "";
  assert.equal(homeMenuSchema.safeParse(none).success, true, "an empty second name means one fixed name");
  assert.equal(resolveHomeMenu(none).hive.altLabel, "");
  assert.equal(resolveHomeMenu({ hive: { labelSeconds: 99 } } as never).hive.labelSeconds, 30);
  const fast = clone();
  fast.hive.labelSeconds = 1;
  assert.equal(homeMenuSchema.safeParse(fast).success, false, "too quick a swap is refused");
});

test("a name can be changed and the Hive shortcuts can be reordered or switched off", () => {
  const menu = clone();
  menu.clusters.hive.label = "Express";
  menu.hive.shortcuts = [menu.hive.shortcuts[4]!, { ...menu.hive.shortcuts[0]!, enabled: false }, menu.hive.shortcuts[1]!, menu.hive.shortcuts[2]!, menu.hive.shortcuts[3]!];
  assert.equal(homeMenuSchema.safeParse(menu).success, true);
  const resolved = resolveHomeMenu(menu);
  assert.equal(resolved.clusters.hive.label, "Express");
  assert.deepEqual(resolved.hive.shortcuts.map((s) => s.id), ["hire", "clean", "laundry", "fix", "workers"]);
  assert.equal(resolved.hive.shortcuts[1]!.enabled, false);
});

test("bad values are refused", () => {
  const blank = clone(); blank.clusters.ride.label = "  ";
  assert.equal(homeMenuSchema.safeParse(blank).success, false, "a blank name");
  const long = clone(); long.clusters.ride.label = "x".repeat(21);
  assert.equal(homeMenuSchema.safeParse(long).success, false, "a name that is too long");
  const dup = clone(); dup.hive.shortcuts = [dup.hive.shortcuts[0]!, dup.hive.shortcuts[0]!];
  assert.equal(homeMenuSchema.safeParse(dup).success, false, "the same shortcut twice");
  const empty = clone(); empty.hive.shortcuts = empty.hive.shortcuts.map((s) => ({ ...s, enabled: false })); empty.hive.hireBanner.enabled = false;
  assert.equal(homeMenuSchema.safeParse(empty).success, false, "nothing left to tap");
});

test("navigation settings validate and round-trip without requiring a database migration", () => {
  const menu = clone();
  menu.navigation = { streamLabel: "Stream", exploreLabel: "Discover", spacesLabel: "Places", spacesEnabled: false, confirmPercent: 90 };
  assert.equal(homeMenuSchema.safeParse(menu).success, true);
  assert.deepEqual(resolveHomeMenu(menu).navigation, menu.navigation);
  for (const confirmPercent of [0, 59, 96, 101, 70.5]) {
    assert.equal(homeMenuSchema.safeParse({ ...menu, navigation: { ...menu.navigation, confirmPercent } }).success, false);
  }
  const legacy = { ...menu } as Partial<HomeMenuSettings>;
  delete legacy.navigation;
  assert.equal(homeMenuSchema.safeParse(legacy).success, true);
  assert.equal(resolveHomeMenu(legacy).navigation.confirmPercent, 85);
});

test("a partial or older stored value is filled from the defaults", () => {
  const resolved = resolveHomeMenu({ clusters: { hive: { label: "Sawa" } } } as Partial<HomeMenuSettings>);
  assert.equal(resolved.clusters.hive.label, "Sawa");
  assert.equal(resolved.clusters.ride.label, "Ride");
  assert.deepEqual(resolved.hive.shortcuts.map((s) => s.id), ["clean", "laundry", "fix", "workers", "hire"]);
  assert.equal(resolveHomeMenu(null).clusters.learn.label, "Learn");
  assert.equal(resolved.navigation.streamLabel, "Stream");
  assert.equal(resolved.navigation.spacesEnabled, true);
  // A shortcut id we do not know is dropped, not shown.
  const odd = resolveHomeMenu({ hive: { shortcuts: [{ id: "bogus", label: "x", enabled: true }] } } as unknown as Partial<HomeMenuSettings>);
  assert.deepEqual(odd.hive.shortcuts.map((s) => s.id), ["clean", "laundry", "fix", "workers", "hire"]);
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

test("home menu: only admins change it, bad values are refused, customers see the saved names, and the change is logged", async () => {
  process.env.JWT_SECRET = "local-home-menu-tests-only";
  resetSchemaCache();
  const client = createClient({ url: "file::memory:" });
  try {
    const migrations = join(process.cwd(), "src/db/migrations");
    for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
      for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
    }
    bindDatabase(client);
    await client.execute("INSERT INTO users (id,phone,name,password_hash,role,admin_role) VALUES ('admin','menu-admin','Admin','h','admin','super_admin'),('cust','menu-cust','Customer','h','customer',NULL)");
    const app = new Hono().route("/v1", settingsRoutes);
    const admin = await signToken({ sub: "admin", role: "admin" });
    const customer = await signToken({ sub: "cust", role: "customer" });
    const put = (token: string, body: unknown) => app.request("/v1/admin/settings", { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });

    assert.deepEqual(await getHomeMenuSettings(), DEFAULT_HOME_MENU, "nothing saved yet uses the built-in names");
    assert.equal((await put(customer, { homeMenu: DEFAULT_HOME_MENU })).status, 403, "customers cannot change it");
    const blank = clone(); blank.clusters.hive.label = "";
    assert.equal((await put(admin, { homeMenu: blank })).status, 400, "a blank name is refused");

    const changed = clone();
    changed.clusters.hive.label = "Sawa";
    changed.hive.shortcuts = [changed.hive.shortcuts[1]!, changed.hive.shortcuts[0]!, { ...changed.hive.shortcuts[2]!, enabled: false }, changed.hive.shortcuts[3]!, changed.hive.shortcuts[4]!];
    changed.hive.hireBanner.title = "Looking for a person?";
    changed.navigation = { ...changed.navigation, spacesEnabled: false, confirmPercent: 90, streamLabel: "Watch" };
    const saved = await put(admin, { homeMenu: changed });
    assert.equal(saved.status, 200, await saved.clone().text());
    assert.deepEqual(await getHomeMenuSettings(), changed);

    const seen = await app.request("/v1/settings", { headers: { Authorization: `Bearer ${customer}` } });
    const data = await seen.json() as { settings: { homeMenu: HomeMenuSettings } };
    assert.equal(data.settings.homeMenu.clusters.hive.label, "Sawa");
    assert.equal(data.settings.homeMenu.navigation.streamLabel, "Watch");
    assert.equal(data.settings.homeMenu.navigation.spacesEnabled, false);
    assert.equal(data.settings.homeMenu.navigation.confirmPercent, 90);
    assert.deepEqual(data.settings.homeMenu.hive.shortcuts.map((s) => [s.id, s.enabled]), [["laundry", true], ["clean", true], ["fix", false], ["workers", true], ["hire", true]]);
    assert.ok((await client.execute("SELECT * FROM admin_activity_log")).rows.length > 0, "the change is in the activity log");

    await setSetting("home_menu_config", "bad-json");
    assert.deepEqual(await getHomeMenuSettings(), DEFAULT_HOME_MENU, "a damaged saved value falls back to the built-in names");
  } finally { setD1Binding(undefined); client.close(); }
});
