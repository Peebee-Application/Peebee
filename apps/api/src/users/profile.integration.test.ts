import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {createClient,type InArgs} from '@libsql/client/node';
import {Hono} from 'hono';
import {signToken} from '../auth/jwt.js';
import {setD1Binding,type D1Database} from '../db/client.js';
import {splitSqlStatements} from '../db/split-sql.js';
import {resetSchemaCache} from '../lib/schema.js';
import {userRoutes} from './routes.js';
test('Display-name updates are authenticated, self-only and validated',async()=>{
process.env.JWT_SECRET='food-storefront-tests-only';resetSchemaCache();
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations)
    .filter((file) => file.endsWith(".sql"))
    .sort())
    for (const sql of splitSqlStatements(
      readFileSync(join(migrations, file), "utf8"),
    ))
      await client.execute(sql);
  const prepare = (sql: string) => ({
    sql,
    args: [] as unknown[],
    bind(...args: unknown[]) {
      this.args = args;
      return this;
    },
    async all() {
      const result = await client.execute({
        sql: this.sql,
        args: this.args as InArgs,
      });
      return {
        results: result.rows,
        success: true,
        meta: { changes: result.rowsAffected },
      };
    },
  });
  setD1Binding({ prepare } as unknown as D1Database);
try {
await client.execute("INSERT INTO users(id,name,password_hash,role) VALUES('buyer','Amina','h','customer'),('other','Sarah','h','customer')");
const token=await signToken({sub:'buyer',role:'customer'});
const app=new Hono().route('/v1',userRoutes);
const call=(body:unknown)=>app.request('/v1/users/me/profile',{method:'PATCH',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
assert.equal((await app.request('/v1/users/me/profile',{method:'PATCH'})).status,401);
assert.equal((await call({name:'   '})).status,400);
assert.equal((await call({name:'x'.repeat(81)})).status,400);
const response=await call({name:'  John Okello  ',id:'other',role:'admin',phone:'+256700000000'});
assert.equal(response.status,200);assert.deepEqual(await response.json(),{name:'John Okello'});
const rows=(await client.execute("SELECT id,name,role,phone FROM users ORDER BY id")).rows;
assert.equal(rows[0].name,'John Okello');assert.equal(rows[0].role,'customer');assert.equal(rows[0].phone,null);assert.equal(rows[1].name,'Sarah');
} finally {setD1Binding(undefined);client.close();resetSchemaCache();}
});
