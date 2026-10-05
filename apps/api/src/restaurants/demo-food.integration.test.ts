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
import { orderRoutes } from "../orders/routes.js";
import { riderRoutes } from "../riders/routes.js";
import { paymentRoutes } from "../payments/routes.js";

test("demo food supports sandbox payment and rider fulfillment without affecting live funds", async () => {
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
  setD1Binding({ prepare, async batch(statements: ReturnType<typeof prepare>[]) {
    const results = await client.batch(statements.map(({sql,args})=>({sql,args:args as InArgs})), "write");
    return results.map((result)=>({results:result.rows,success:true,meta:{changes:result.rowsAffected,last_row_id:Number(result.lastInsertRowid??0)}}));
  } } as unknown as D1Database);
  try {
    await client.execute("INSERT INTO users (id, phone, name, password_hash, role) VALUES ('cust', 'cust', 'Customer', 'h', 'customer')");
    await client.execute("INSERT INTO restaurants (id, owner_id, name, status, environment) VALUES ('real-sandbox', 'cust', 'Sandbox test venue', 'active', 'sandbox')");
    await client.execute("UPDATE users SET wallet_balance = 765432, wallet_balance_sandbox = 1000000 WHERE id = 'cust'");
    await client.execute("INSERT INTO users (id,phone,name,password_hash,role) VALUES ('rider','rider','Rider','h','rider')");
    await client.execute("INSERT INTO riders (user_id,verified,is_online,stage_lat,stage_lng,wallet_balance,wallet_balance_sandbox) VALUES ('rider',1,1,0.0645,32.4594,4321,50000)");
    const app = new Hono().route("/v1", customerRestaurantRoutes).route("/v1", menuRoutes).route("/v1", orderRoutes).route("/v1", riderRoutes).route("/v1", paymentRoutes);
    const token = await signToken({ sub: "cust", role: "customer" });
    const riderToken = await signToken({sub:"rider",role:"rider"});
    const call = (path: string, method = "GET", body?: unknown, auth=token) => app.request(`/v1${path}`, { method, headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
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
    assert.equal(checkout.status,400,"Required meal options still apply");
    assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM orders")).rows[0].n),0);
    assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM restaurants")).rows[0].n),1);

    const input={items:[{menuItemId:`${first}-item-1`,quantity:2,choiceIds:[`${first}-item-1-size-large`,`${first}-item-1-extra-avocado`]}],destinationArea:"Sandbox delivery",destinationAddress:"Sandbox customer pickup point"};
    const created=await call(`/restaurants/${first}/order`,"POST",input);
    assert.equal(created.status,201,await created.clone().text());
    const order=(await created.json() as {order:Record<string,any>}).order;
    assert.equal(order.environment,"sandbox");assert.equal(order.restaurant_id,first);
    assert.equal(order.estimated_total,55000,"Menu price plus selected options, quantities and delivery fee");
    assert.equal(order.pickup_lat,0.0645);assert.equal(order.pickup_lng,32.4594);
    assert.equal((await (await call(`/restaurants/${first}`)).json() as {restaurant:{demo_checkout_enabled:boolean}}).restaurant.demo_checkout_enabled,true);
    const fakeOwnerToken=await signToken({sub:"demo-food-owner",role:"customer"});
    assert.equal((await call(`/restaurants/${first}`,"GET",undefined,fakeOwnerToken)).status,403,"Suspended fixture owner cannot sign in");
    const directory=await (await call("/restaurants")).json() as {restaurants:Array<{id:string}>};
    assert.equal(directory.restaurants.filter(r=>r.id===first).length,1,"Persisted demo references must not duplicate catalogue entries");
    const jobs=await (await call("/riders/jobs/available","GET",undefined,riderToken)).json() as {jobs:Array<Record<string,any>>};
    assert(jobs.jobs.some(job=>job.id===order.id&&job.restaurant_name==="Lakeview Kitchen"));
    assert.equal((await call(`/orders/${order.id}/claim`,"POST",{},riderToken)).status,200);
    const quote=await (await call(`/orders/${order.id}/checkout`)).json() as {wallet:number};
    const funded=await call(`/orders/${order.id}/fund`,"POST",{paymentMethod:"wallet",useWallet:true,acceptedAmount:quote.wallet});
    assert.equal(funded.status,200,await funded.clone().text());
    assert.equal((await funded.json() as {order:{stage:string}}).order.stage,"Shop");
    assert.equal(Number((await client.execute({sql:"SELECT principal_allocated FROM order_budgets WHERE order_id=?",args:[order.id]})).rows[0].principal_allocated),52000);
    assert.equal(Number((await client.execute({sql:"SELECT available FROM merchant_balances WHERE merchant_id=? AND environment='sandbox'",args:[`${first}-merchant`]})).rows[0].available),52000);
    assert.equal((await call(`/orders/${order.id}/fund`,"POST",{paymentMethod:"wallet",useWallet:true,acceptedAmount:quote.wallet})).status,409,"Funding cannot debit twice");
    assert.equal(Number((await client.execute("SELECT wallet_balance FROM users WHERE id='cust'")).rows[0].wallet_balance),765432);
    assert.equal(Number((await client.execute("SELECT wallet_balance_sandbox FROM users WHERE id='cust'")).rows[0].wallet_balance_sandbox),1000000-quote.wallet);
    assert.equal((await call(`/orders/${order.id}/deliver`,"POST",{etaMinutes:10},riderToken)).status,200,"Rider can collect the food and start delivery");
    assert.equal((await call(`/orders/${order.id}/arrived`,"POST",{},riderToken)).status,200);
    const detail=await (await call(`/orders/${order.id}`)).json() as {order:{pin_code:string}};
    assert.equal((await call(`/orders/${order.id}/handover`,"POST",{pin:detail.order.pin_code})).status,200);
    assert.equal((await call(`/orders/${order.id}/settle`,"POST",{},riderToken)).status,200);
    assert.equal(Number((await client.execute("SELECT wallet_balance FROM riders WHERE user_id='rider'")).rows[0].wallet_balance),4321);
    assert(Number((await client.execute("SELECT wallet_balance_sandbox FROM riders WHERE user_id='rider'")).rows[0].wallet_balance_sandbox)>50000);
    assert.equal((await client.execute({sql:"SELECT stage,environment FROM orders WHERE id=?",args:[order.id]})).rows[0].stage,"Settle");

    // A second shared order exercises simulated Mobile Money, including after
    // an admin changes modes: the stored sandbox environment still wins.
    const mobileCreated=await call(`/restaurants/${first}/order`,"POST",input);
    assert.equal(mobileCreated.status,201);
    const mobileOrder=(await mobileCreated.json() as {order:{id:string}}).order;
    assert.equal((await call(`/orders/${mobileOrder.id}/claim`,"POST",{},riderToken)).status,200);
    const mobileFunded=await call(`/orders/${mobileOrder.id}/fund`,"POST",{paymentMethod:"mobile_money",msisdn:"0772345678"});
    assert.equal(mobileFunded.status,200,await mobileFunded.clone().text());
    const payment=(await mobileFunded.json() as {payment:{id:string}}).payment;
    const storedPayment=(await client.execute({sql:"SELECT provider FROM payments WHERE id=?",args:[payment.id]})).rows[0];
    assert.match(String(storedPayment.provider),/_mock$/);
    await client.execute({sql:"UPDATE payments SET provider_ref='sandbox-demo-success',created_at=datetime('now','-30 seconds') WHERE id=?",args:[payment.id]});
    await setPlatformEnvironment("live");
    assert.equal((await (await call("/riders/jobs/available","GET",undefined,riderToken)).json() as {jobs:unknown[]}).jobs.length,0);
    const refreshed=await call(`/payments/${payment.id}/refresh`);
    assert.equal(refreshed.status,200);
    assert.equal((await refreshed.json() as {payment:{status:string}}).payment.status,"successful");
    assert.equal(Number((await client.execute("SELECT wallet_balance FROM users WHERE id='cust'")).rows[0].wallet_balance),765432);
    assert.equal((await call(`/restaurants/${first}/order`,"POST",input)).status,404,"Demo checkout cannot start in live mode");
    assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM orders WHERE environment='live'")).rows[0].n),0);
    assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM ledger_transactions WHERE environment='live'")).rows[0].n),0);
    await setPlatformEnvironment("sandbox");
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
