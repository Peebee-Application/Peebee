import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { cashPaidEventId, paymentMethodEventId, rideArrivalPayment, type OrderDetail, type OrderRow, type Payment } from "@peebee/shared";
import { orderRoutes } from "./routes.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { resetSchemaCache } from "../lib/schema.js";
import { signToken } from "../auth/jwt.js";

const order = { id: "o", customer_id: "c", payment_rail: "escrow", stage: "Handover", final_total: 5500, currency: "UGX" } as OrderRow;
const payment = (patch: Partial<Payment> = {}): Payment => ({ id: "p", order_id: "o", type: "collection", status: "successful", amount: 5500, currency: "UGX", provider: "flutterwave", provider_ref: null, msisdn: null, network: null, created_at: "2026-11-22", ...patch });
test("arrival never treats pending, failed, disbursement, refunded, partial or foreign collections as fully paid", () => {
  const detail = { order, events: [], payments: [] as Payment[] };
  for (const p of [payment({status:"pending"}),payment({status:"failed"}),payment({type:"disbursement"}),payment({amount:500}),payment({order_id:"other"}),payment({currency:"USD"})]) assert.equal(rideArrivalPayment({...detail,payments:[p]}).digitalPaid,false);
  assert.equal(rideArrivalPayment({...detail,payments:[payment()]}).digitalPaid,true);
  assert.equal(rideArrivalPayment({...detail,payments:[payment(),payment({id:"refund",type:"refund",amount:5500})]}).digitalPaid,false);
  assert.equal(rideArrivalPayment({...detail,order:{...order,stage:"Settle"}}).digitalPaid,false,"stage alone is not payment proof");
});
test("digital methods are recorded per payment, old ambiguous gateways stay generic, and cash acknowledgement is not settlement", () => {
  const base = {order,events:[],payments:[payment()]};
  assert.equal(rideArrivalPayment(base).method,"Digital payment");
  const card={id:paymentMethodEventId("p"),note:"card"} as OrderDetail["events"][number];
  assert.equal(rideArrivalPayment({...base,events:[card]}).method,"Card");
  assert.equal(rideArrivalPayment({...base,payments:[payment({msisdn:"0770000000"})]}).method,"Mobile money");
  assert.equal(rideArrivalPayment({...base,payments:[payment({provider:"wallet"})]}).method,"Peebee wallet");
  const cash={...base,order:{...order,payment_rail:"float" as const},payments:[]};
  const acknowledged=rideArrivalPayment({...cash,events:[{id:cashPaidEventId("o"),actor_id:"c"} as OrderDetail["events"][number]]});
  assert.equal(acknowledged.cashReported,true); assert.equal(acknowledged.receiptAvailable,false);
  assert.equal(rideArrivalPayment({...cash,order:{...cash.order,stage:"Settle"}}).receiptAvailable,true);
  assert.equal(rideArrivalPayment({...cash,order:{...cash.order,final_total:0}}).noCharge,true);
});

test("cash acknowledgement is customer-owned, arrival-only, idempotent and never changes funds or settlement", async () => {
  process.env.JWT_SECRET = "local-ride-arrival-tests-only";
  resetSchemaCache();
  const client = createClient({ url: "file::memory:" });
  const prepare = (sql: string) => ({ sql,args:[] as unknown[],bind(...args: unknown[]) {this.args=args;return this;},async all() {const r=await client.execute({sql:this.sql,args:this.args as InArgs});return {results:r.rows,success:true,meta:{changes:r.rowsAffected,last_row_id:Number(r.lastInsertRowid??0)}};} });
  try {
    for(const file of readdirSync(join(process.cwd(),"src/db/migrations")).filter(f=>f.endsWith(".sql")).sort()) for(const sql of splitSqlStatements(readFileSync(join(process.cwd(),"src/db/migrations",file),"utf8"))) await client.execute(sql);
    setD1Binding({prepare,async batch(statements:ReturnType<typeof prepare>[]) {const results=await client.batch(statements.map(({sql,args})=>({sql,args:args as InArgs})),"write");return results.map(r=>({results:r.rows,success:true,meta:{changes:r.rowsAffected,last_row_id:Number(r.lastInsertRowid??0)}}));}} as unknown as D1Database);
    await client.execute("INSERT INTO users (id,phone,name,password_hash,role) VALUES ('c','c','Customer','h','customer'),('c2','c2','Other','h','customer'),('r','r','Rider','h','rider')");
    await client.execute("INSERT INTO lists (id,customer_id,title) VALUES ('l','c','Ride')");
    await client.execute("INSERT INTO orders (id,list_id,customer_id,rider_id,stage,is_ride,payment_rail,environment) VALUES ('o','l','c','r','PickedUp',1,'float','live')");
    const app=new Hono().route("/v1",orderRoutes);
    const tokens={customer:await signToken({sub:"c",role:"customer"}),other:await signToken({sub:"c2",role:"customer"}),rider:await signToken({sub:"r",role:"rider"})};
    const request=(token?:string)=>app.request("/v1/orders/o/cash-paid",{method:"POST",headers:token?{Authorization:`Bearer ${token}`}:{}});
    assert.equal((await request()).status,401); assert.equal((await request(tokens.other)).status,403); assert.equal((await request(tokens.rider)).status,403);
    assert.equal((await request(tokens.customer)).status,409);
    await client.execute("UPDATE orders SET stage='Handover',payment_rail='escrow' WHERE id='o'");
    assert.equal((await request(tokens.customer)).status,409);
    await client.execute("UPDATE orders SET payment_rail='float',is_ride=0 WHERE id='o'");
    assert.equal((await request(tokens.customer)).status,409);
    await client.execute("UPDATE orders SET is_ride=1 WHERE id='o'");
    for(const result of await Promise.all([request(tokens.customer),request(tokens.customer)])) assert.equal(result.status,200,await result.clone().text());
    assert.equal((await client.execute({sql:"SELECT COUNT(*) AS n FROM order_events WHERE id=?",args:[cashPaidEventId("o")]})).rows[0].n,1);
    assert.equal((await client.execute("SELECT stage FROM orders WHERE id='o'")).rows[0].stage,"Handover");
    assert.equal((await client.execute("SELECT COUNT(*) AS n FROM payments")).rows[0].n,0);
    await client.execute("UPDATE orders SET stage='Settle' WHERE id='o'");
    assert.equal((await request(tokens.customer)).status,200);
    assert.equal((await client.execute("SELECT COUNT(*) AS n FROM order_events")).rows[0].n,1);
  } finally {setD1Binding(undefined);client.close();}
});
