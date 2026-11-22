import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync,readdirSync} from "node:fs";
import {join} from "node:path";
import {createClient,type InArgs} from "@libsql/client/node";
import {Hono} from "hono";
import {orderRoutes} from "./routes.js";
import {setD1Binding,type D1Database} from "../db/client.js";
import {splitSqlStatements} from "../db/split-sql.js";
import {resetSchemaCache} from "../lib/schema.js";
import {signToken} from "../auth/jwt.js";
test("active home card gets owned rider/business facts and indexed item count; absent optional tables do not break the feed",async()=>{
  process.env.JWT_SECRET="local-active-home-tests-only";resetSchemaCache();
  const client=createClient({url:"file::memory:"});
  const prepare=(sql:string)=>({sql,args:[] as unknown[],bind(...args:unknown[]){this.args=args;return this;},async all(){const r=await client.execute({sql:this.sql,args:this.args as InArgs});return{results:r.rows,success:true,meta:{changes:r.rowsAffected,last_row_id:Number(r.lastInsertRowid??0)}};}});
  try{
    for(const file of readdirSync(join(process.cwd(),"src/db/migrations")).filter(f=>f.endsWith(".sql")).sort())for(const sql of splitSqlStatements(readFileSync(join(process.cwd(),"src/db/migrations",file),"utf8")))await client.execute(sql);
    setD1Binding({prepare,async batch(statements:ReturnType<typeof prepare>[]){const res=await client.batch(statements.map(({sql,args})=>({sql,args:args as InArgs})),"write");return res.map(r=>({results:r.rows,success:true,meta:{changes:r.rowsAffected,last_row_id:Number(r.lastInsertRowid??0)}}));}} as unknown as D1Database);
    await client.execute("INSERT INTO users (id,phone,name,password_hash,role) VALUES ('c','c','Customer','h','customer'),('c2','c2','Other','h','customer'),('r','r','Kato M.','h','rider')");
    await client.execute("INSERT INTO lists (id,customer_id,title) VALUES ('l','c','Shopping'),('l2','c2','Private')");
    await client.execute("INSERT INTO list_items (id,list_id,name) VALUES ('i1','l','Milk'),('i2','l','Bread'),('i3','l2','Private item')");
    await client.execute("INSERT INTO merchants (id,legal_name,display_name) VALUES ('m','City Electronics Ltd','City Electronics')");
    await client.execute("INSERT INTO stores (id,merchant_id,name,slug,category) VALUES ('s','m','City Electronics','city-electronics','stores')");
    await client.execute("INSERT INTO restaurants (id,owner_id,name) VALUES ('f','c','Pearl Kitchen')");
    await client.execute("INSERT INTO orders (id,list_id,customer_id,rider_id,stage,environment,store_id) VALUES ('o','l','c','r','Shop','live','s'),('private','l2','c2','r','Shop','live',NULL)");
    const app=new Hono().route("/v1",orderRoutes),token=await signToken({sub:"c",role:"customer"});
    const load=async()=>{const r=await app.request("/v1/orders/active",{headers:{Authorization:`Bearer ${token}`}});assert.equal(r.status,200,await r.clone().text());return await r.json() as {activeOrder:Record<string,unknown>|null};};
    const first=(await load()).activeOrder!;assert.equal(first.id,"o");assert.equal(first.rider_name,"Kato M.");assert.equal(first.store_name,"City Electronics");assert.equal(first.item_count,2);
    await client.execute("UPDATE orders SET store_id=NULL,restaurant_id='f' WHERE id='o'");assert.equal((await load()).activeOrder!.restaurant_name,"Pearl Kitchen");
    await client.execute("DROP TABLE stores");resetSchemaCache();assert.equal((await load()).activeOrder!.id,"o");
    await client.execute("UPDATE orders SET stage='Settle' WHERE id='o'");assert.equal((await load()).activeOrder,null,"does not fall through to another customer's order");
  }finally{setD1Binding(undefined);client.close();}
});
