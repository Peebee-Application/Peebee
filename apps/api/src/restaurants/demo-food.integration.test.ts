import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { createPracticeFetch } from "@peebee/shared";
import { DEMO_FOOD_RESTAURANTS } from "@peebee/shared/demo-food";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { resetSchemaCache } from "../lib/schema.js";
import { setPlatformEnvironment, setServiceSwitches } from "../lib/settings.js";
import { customerRestaurantRoutes } from "./customer.js";
import { menuRoutes } from "./menu.js";

test("demo food is available in sandbox only and cannot create orders", async () => {
  process.env.JWT_SECRET = "demo-food-test-secret-only";
  resetSchemaCache();
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((file) => file.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  const prepare = (sql: string) => ({
    sql, args: [] as unknown[],
    bind(...args: unknown[]) { this.args = args; return this; },
    async all() { const result = await client.execute({ sql: this.sql, args: this.args as InArgs }); return { results: result.rows, success: true, meta: { changes: result.rowsAffected, last_row_id: Number(result.lastInsertRowid ?? 0) } }; },
  });
  setD1Binding({ prepare } as unknown as D1Database);
  try {
    await client.execute("INSERT INTO users (id, phone, name, password_hash, role) VALUES ('cust', 'cust', 'Customer', 'h', 'customer')");
    await client.execute("INSERT INTO restaurants (id, owner_id, name, status, environment) VALUES ('real-sandbox', 'cust', 'Sandbox test venue', 'active', 'sandbox')");
    const app = new Hono().route("/v1", customerRestaurantRoutes).route("/v1", menuRoutes);
    const token = await signToken({ sub: "cust", role: "customer" });
    const call = (path: string, method = "GET", body?: unknown) => app.request(`/v1${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const first = DEMO_FOOD_RESTAURANTS[0].id;
    await setPlatformEnvironment("live");
    assert.deepEqual(await (await call("/restaurants")).json(), { restaurants: [] });
    assert.equal((await call(`/restaurants/${first}`)).status, 404);
    await setPlatformEnvironment("sandbox");
    const list = await (await call("/restaurants")).json() as {restaurants: Array<{id:string;is_demo?:boolean}>};
    assert.equal(list.restaurants.length, 5);
    assert.equal(list.restaurants.filter((r) => r.is_demo).length, 4);
    let itemId = "";
    for (const restaurant of DEMO_FOOD_RESTAURANTS) {
      assert.equal((await call(`/restaurants/${restaurant.id}`)).status, 200);
      const menu = await (await call(`/restaurants/${restaurant.id}/menu`)).json() as {categories:Array<{items:Array<{id:string;photo_key:string;options:Array<{choices:unknown[]}>}>}>};
      assert.equal(menu.categories.flatMap((c) => c.items).length, 5);
      for (const item of menu.categories.flatMap((c) => c.items)) {
        itemId = item.id;
        assert(item.photo_key);
        const photo = await call(`/restaurants/menu-items/${item.id}/photo`);
        assert.equal(photo.status, 200); assert.match(photo.headers.get("Content-Type")!, /image\/svg\+xml/);
        assert.match(await photo.text(), /<svg/);
      }
    }
    const checkout = await call(`/restaurants/${first}/order`, "POST", {items:[{menuItemId:`${first}-item-1`,quantity:1}]});
    assert.equal(checkout.status,409);
    assert.equal((await checkout.json() as {error:string}).error,"demo_preview_only");
    assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM orders")).rows[0].n),0);
    assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM restaurants")).rows[0].n),1);
    await setServiceSwitches({food:false});
    assert.deepEqual(await (await call("/restaurants")).json(),{restaurants:[],paused:true});
    await setServiceSwitches({food:true});
    await setPlatformEnvironment("live");
    assert.equal((await call(`/restaurants/${first}/menu`)).status,404);
    assert.equal((await call(`/restaurants/menu-items/${itemId}/photo`)).status,404);
    assert.deepEqual(await (await call("/restaurants")).json(),{restaurants:[]});
  } finally { setD1Binding(undefined); client.close(); resetSchemaCache(); }
});

test("customer Practice Mode can browse the same catalogue without network requests", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis,"window");
  Object.defineProperty(globalThis,"window",{configurable:true,value:{localStorage:{getItem:(key:string)=>key==="peebee_practice_mode"?"1":null,setItem:()=>{}},location:{origin:"https://local.example"}}});
  try {
    const fetcher=createPracticeFetch("customer", (()=>{throw new Error("Unexpected network request");}) as typeof fetch);
    const list=await fetcher("https://local.example/v1/restaurants");assert.equal(list.status,200);
    const id=DEMO_FOOD_RESTAURANTS[0].id;
    assert.equal((await fetcher(`https://local.example/v1/restaurants/${id}/menu`)).status,200);
    assert.equal((await fetcher(`https://local.example/v1/restaurants/menu-items/${id}-item-1/photo`)).status,200);
    assert.equal((await fetcher(`https://local.example/v1/restaurants/${id}/order`,{method:"POST",body:"{}"})).status,409);
  } finally { if(previous)Object.defineProperty(globalThis,"window",previous);else Reflect.deleteProperty(globalThis,"window"); }
});
