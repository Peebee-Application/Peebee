import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient, type InArgs } from "@libsql/client/node";
import { Hono } from "hono";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { resetSchemaCache } from "../lib/schema.js";
import { setPlatformEnvironment, setServiceSwitches } from "../lib/settings.js";
import { restaurantRoutes } from "./routes.js";
import { customerRestaurantRoutes } from "./customer.js";

test("food types persist, approval gates discovery, and missing migration stays safe", async () => {
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
    await setPlatformEnvironment("live");
    await setServiceSwitches({food:true});
    const app=new Hono().route("/v1",restaurantRoutes).route("/v1",customerRestaurantRoutes);
    for (const [index,type] of ["restaurant","kitchen","street_food","bakery"].entries()) {
      const id=`owner-${index}`;
      await client.execute({sql:"INSERT INTO users (id,name,password_hash,role) VALUES (?,?,?,?)",args:[id,id,"h","customer"]});
      const token=await signToken({sub:id,role:"customer"});
      const call=(path:string,method="GET",body?:unknown)=>app.request(`/v1${path}`,{method,headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});
      const created=await call("/restaurants/apply","POST",{name:id,businessType:type});
      assert.equal(created.status,201);const data=await created.json() as {restaurant:{id:string;business_type:string;status:string}};
      assert.equal(data.restaurant.business_type,type);assert.equal(data.restaurant.status,"pending_approval");
      const pending=await (await call("/restaurants")).json() as {restaurants:Array<{id:string}>};assert(!pending.restaurants.some(r=>r.id===data.restaurant.id));
      await client.execute({sql:"UPDATE restaurants SET status='active' WHERE id=?",args:[data.restaurant.id]});
      const updated=await call("/restaurants/me","PATCH",{businessType:"bakery"});assert.equal(updated.status,200);
      assert.equal((await updated.json() as {restaurant:{business_type:string}}).restaurant.business_type,"bakery");
      const invalid=await call("/restaurants/me","PATCH",{businessType:"not-food"});assert.equal(invalid.status,400);
    }
    await client.execute("DROP INDEX idx_restaurants_business_type");
    await client.execute("ALTER TABLE restaurants DROP COLUMN business_type");resetSchemaCache();
    const token=await signToken({sub:"owner-0",role:"customer"});
    const response=await app.request('/v1/restaurants/me',{method:'PATCH',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({businessType:'kitchen'})});
    assert.equal(response.status,503);
    assert.equal((await app.request('/v1/restaurants/me',{headers:{Authorization:`Bearer ${token}`}})).status,200);
  } finally { setD1Binding(undefined);resetSchemaCache();client.close(); }
});
