import assert from "node:assert/strict";
import test from "node:test";
import { createClient, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { setD1Binding, type D1Database } from "../db/client.js";
import { setActiveMapsProvider, setJawgLightStyle } from "../lib/settings.js";
import { publicMapsRoutes } from "./public-routes.js";

test("guest map configuration returns only the active browser basemap", async t => {
  const client = createClient({ url: "file::memory:" });
  await client.execute("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT)");
  await client.execute("CREATE TABLE maps_credentials (provider TEXT, field TEXT, value TEXT)");
  setD1Binding({
    prepare(sql: string) {
      return {
        args: [] as unknown[],
        bind(...args: unknown[]) { this.args = args; return this; },
        async all() {
          const result = await client.execute({ sql, args: this.args as InArgs });
          return { results: result.rows, success: true, meta: { changes: result.rowsAffected } };
        },
      };
    },
  } as unknown as D1Database);
  t.after(() => { setD1Binding(undefined); client.close(); });

  const originalJawg = process.env.JAWG_ACCESS_TOKEN;
  const originalMapbox = process.env.MAPBOX_ACCESS_TOKEN;
  t.after(() => {
    if (originalJawg === undefined) delete process.env.JAWG_ACCESS_TOKEN;
    else process.env.JAWG_ACCESS_TOKEN = originalJawg;
    if (originalMapbox === undefined) delete process.env.MAPBOX_ACCESS_TOKEN;
    else process.env.MAPBOX_ACCESS_TOKEN = originalMapbox;
  });
  process.env.JAWG_ACCESS_TOKEN = "fixture-browser-key";
  process.env.MAPBOX_ACCESS_TOKEN = "sk.fixture-private-key";

  const app = new Hono().route("/v1", publicMapsRoutes);
  const read = async () => {
    const response = await app.request("/v1/maps/public");
    assert.equal(response.status, 200);
    return response.json();
  };
  await setActiveMapsProvider("jawg");
  await setJawgLightStyle("light");
  assert.deepEqual(await read(), { provider: "jawg", key: "fixture-browser-key", lightStyle: "light" });
  await setActiveMapsProvider("mapbox");
  assert.deepEqual(await read(), { provider: "mapbox", key: null });
  await setActiveMapsProvider("streetmaps");
  assert.deepEqual(await read(), { provider: "streetmaps" });
});
