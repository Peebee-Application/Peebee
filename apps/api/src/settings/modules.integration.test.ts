import assert from "node:assert/strict";
import { allowManyRides } from "../test-support/no-ride-limit.js";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { MODULES, MODULE_KEYS, channelModuleOn, getModule } from "@peebee/shared";
import { getChannelsConfig, saveChannelsConfig } from "../channels/settings.js";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { getModuleFlags, getModuleSettings, isModuleLive, setModuleFlags } from "../lib/modules.js";
import { getServiceSwitches, getSetting, getSettingRaw, setSetting } from "../lib/settings.js";
import { resetSchemaCache } from "../lib/schema.js";
import { orderRoutes } from "../orders/routes.js";

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

test("the registry is consistent", () => {
  assert.equal(new Set(MODULE_KEYS).size, MODULE_KEYS.length, "keys are unique");
  for (const def of MODULES) {
    if (def.parent) assert.ok(getModule(def.parent), `${def.key} has a real parent`);
    if (def.parent) assert.equal(getModule(def.parent)!.cluster, def.cluster, `${def.key} sits in its parent's cluster`);
  }
});

test("Live and Practice switches are independent, and a module obeys the ones above it", async (t) => {
  process.env.JWT_SECRET = "local-modules-test-secret-only";
  resetSchemaCache();
  const client = createClient({ url: "file::memory:" });
  const migrations = existsSync(join(process.cwd(), "src/db/migrations")) ? join(process.cwd(), "src/db/migrations") : join(process.cwd(), "apps/api/src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  await allowManyRides();
  await client.execute({ sql: "INSERT INTO users (id, phone, name, password_hash, role) VALUES ('cust', 'cust', 'cust', 'h', 'customer')", args: [] });
  const app = new Hono().route("/v1", orderRoutes);
  const token = await signToken({ sub: "cust", role: "customer" });
  const call = (body: unknown) => app.request("/v1/orders", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const list = async () => {
    const id = `list_${Math.random().toString(36).slice(2, 10)}`;
    await client.execute({ sql: "INSERT INTO lists (id, customer_id, title, status, environment) VALUES (?, 'cust', 'L', 'draft', 'live')", args: [id] });
    return id;
  };
  const geo = { pickupLat: 0.3, pickupLng: 32.58, destinationLat: 0.35, destinationLng: 32.58 };

  await t.test("defaults: Live mirrors the older switches, Practice is on everywhere", async () => {
    const flags = await getModuleFlags();
    for (const def of MODULES) {
      assert.equal(flags[def.key]!.practice, true, `${def.key} practice`);
      const expected = def.channel ? channelModuleOn(def, "{}") : (def.defaultOn ?? true);
      assert.equal(flags[def.key]!.live, expected, `${def.key} live default matches its older setting`);
    }
  });

  await t.test("a Channels module is a switch inside the Channels config, one value for both screens", async () => {
    await setModuleFlags({ live: { channels: true, "channels.posts.video": false, "channels.posts.audio": true, "channels.live": true } });
    const cfg = await getChannelsConfig();
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.live.enabled, true);
    assert.deepEqual([...cfg.publishing.postTypes].sort(), ["audio", "carousel", "image", "text"], "video left the list, audio joined, the rest stayed");
    const { flags, available } = await getModuleSettings();
    assert.equal(flags["channels.posts.video"]!.live, false);
    assert.equal(available["channels.posts.audio"]!.live, true);
    await setModuleFlags({ live: { channels: false } });
    assert.equal((await getModuleSettings()).available["channels.live"]!.live, false, "turning Channels off pauses everything under it");
    assert.equal((await getModuleSettings()).flags["channels.live"]!.live, true, "…without losing the switches below");
    await saveChannelsConfig({ enabled: false, live: { enabled: false }, publishing: { postTypes: ["video", "image", "carousel", "text"] } });
  });

  await t.test("a notice is kept for a module that is off, hidden once it is on, and cleared with null", async () => {
    await setModuleFlags({ live: { "ride.taxipress": false }, notices: { "ride.taxipress": { reason: "coming_soon", message: " We are adding taxis ", returnAt: "2026-12-01" } } });
    assert.deepEqual((await getModuleSettings()).notices?.["ride.taxipress"], { reason: "coming_soon", message: "We are adding taxis", returnAt: "2026-12-01" });
    await setModuleFlags({ live: { "ride.taxipress": true } });
    assert.equal((await getModuleSettings()).notices?.["ride.taxipress"], undefined, "a note on a module that is on is not served");
    await setModuleFlags({ live: { "ride.taxipress": false } });
    assert.equal((await getModuleSettings()).notices?.["ride.taxipress"]?.reason, "coming_soon", "…but it is remembered for next time");
    await setModuleFlags({ notices: { "ride.taxipress": null } });
    assert.equal((await getModuleSettings()).notices?.["ride.taxipress"], undefined);
    await setModuleFlags({ live: { "ride.taxipress": true } });
  });

  await t.test("kept the same: off in either world is off in both, and a switch in one sets both", async () => {
    await setModuleFlags({ live: { "ride.luxury": false }, practice: { "ride.luxury": true, "ride.ambulance": false } });
    assert.equal((await getModuleSettings()).sync, false, "off by default: each world keeps its own switches");
    assert.equal((await getModuleSettings()).available["ride.luxury"]!.practice, true);

    await setModuleFlags({ sync: true });
    const first = await getModuleSettings();
    assert.equal(first.sync, true);
    assert.deepEqual(first.flags["ride.luxury"], { live: false, practice: false }, "off in Live, so Practice goes off too");
    assert.deepEqual(first.flags["ride.ambulance"], { live: false, practice: false }, "off in Practice, so Live goes off too");
    assert.equal(await isModuleLive("ride.ambulance"), false);
    assert.equal(await isModuleLive("ride.boda"), true);

    await setModuleFlags({ practice: { "ride.luxury": true } });
    assert.deepEqual((await getModuleSettings()).flags["ride.luxury"], { live: true, practice: true }, "a switch in Practice sets Live as well");
    await setModuleFlags({ live: { "ride.boda": false } });
    assert.deepEqual((await getModuleSettings()).flags["ride.boda"], { live: false, practice: false });
    assert.equal(await isModuleLive("ride.boda"), false);

    await setModuleFlags({ sync: false });
    await setModuleFlags({ live: { "ride.boda": true } });
    assert.deepEqual((await getModuleSettings()).flags["ride.boda"], { live: true, practice: false }, "once not kept the same, worlds drift apart again");
    await setModuleFlags({ live: { "ride.ambulance": true, "ride.luxury": true }, practice: { "ride.boda": true, "ride.ambulance": true } });
  });

  await t.test("kept the same does not touch Channels, which has no Practice", async () => {
    await setModuleFlags({ sync: true });
    await setModuleFlags({ live: { "channels.comments": false } });
    const { flags } = await getModuleSettings();
    assert.equal(flags["channels.comments"]!.live, false);
    assert.equal(flags["channels.comments"]!.practice, true, "Practice side is not compared");
    await setModuleFlags({ live: { "channels.comments": true }, sync: false });
  });

  await t.test("a module can be on in Practice and off in Live", async () => {
    await setModuleFlags({ practice: { "ride.taxipress": true }, live: { "ride.taxipress": false } });
    const { flags, available } = await getModuleSettings();
    assert.deepEqual(flags["ride.taxipress"], { live: false, practice: true });
    assert.deepEqual(available["ride.taxipress"], { live: false, practice: true });
    assert.equal(await getSetting("taxipress_enabled"), "0");
    await setModuleFlags({ live: { "ride.taxipress": true } });
    assert.equal(await getSetting("taxipress_enabled"), "1", "the older setting is the same switch");
  });

  await t.test("Boda is its own switch under Rides", async () => {
    await setModuleFlags({ live: { "ride.boda": false } });
    assert.equal((await call({ listId: await list(), type: "parcel", isRide: true, ...geo })).status, 403);
    assert.equal((await call({ listId: await list(), type: "parcel", ...geo })).status, 201, "parcels are unaffected");
    await setModuleFlags({ live: { "ride.boda": true } });
    assert.equal((await call({ listId: await list(), type: "parcel", isRide: true, ...geo })).status, 201);
  });

  await t.test("a cluster off pauses what is under it, and switching it back restores each one as it was", async () => {
    await setModuleFlags({ live: { "buy.food": false } });
    await setModuleFlags({ live: { buy: false } });
    assert.equal((await getServiceSwitches()).shopping, false);
    assert.equal((await getServiceSwitches()).food, false);
    assert.equal((await call({ listId: await list(), type: "shopping", estimatedTotal: 5000 })).status, 403);
    assert.equal((await call({ listId: await list(), type: "parcel", ...geo })).status, 201, "other clusters keep working");
    await setModuleFlags({ live: { buy: true } });
    assert.equal((await getServiceSwitches()).shopping, true);
    assert.equal((await getServiceSwitches()).food, false, "food stayed off on its own");
    await setModuleFlags({ live: { "buy.food": true } });
  });

  await t.test("an older settings page saving 'off' while a cluster is off does not switch the module off for good", async () => {
    await setModuleFlags({ live: { buy: false } });
    await setSetting("service_shopping_enabled", "0");
    assert.equal(await getSettingRaw("service_shopping_enabled"), "1");
    await setModuleFlags({ live: { buy: true } });
    assert.equal(await isModuleLive("buy.shopping"), true);
  });

  await t.test("Practice flags never touch Live", async () => {
    await setModuleFlags({ practice: { ride: false, "buy.food": false } });
    const { flags, available } = await getModuleSettings();
    assert.equal(flags["ride.boda"]!.live, true);
    assert.equal(available["ride.boda"]!.practice, false, "boda is off in Practice because Rides is");
    assert.equal(available["ride.boda"]!.live, true);
    assert.equal((await call({ listId: await list(), type: "parcel", isRide: true, ...geo })).status, 201);
    await setModuleFlags({ practice: { ride: true, "buy.food": true } });
  });

  await t.test("a car sub-feature needs Peebee Car, which needs Rides", async () => {
    await setModuleFlags({ live: { "ride.car": true, "ride.car.carpool": true } });
    assert.equal(await isModuleLive("ride.car.carpool"), true);
    await setModuleFlags({ live: { ride: false } });
    assert.equal(await isModuleLive("ride.car.carpool"), false);
    assert.equal(await getSetting("car_carpool_enabled"), "0");
    await setModuleFlags({ live: { ride: true } });
    assert.equal(await getSetting("car_carpool_enabled"), "1");
  });
});
