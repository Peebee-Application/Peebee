import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {createClient,type InArgs} from '@libsql/client/node';
import {Hono} from 'hono';
import {signToken} from '../auth/jwt.js';
import {setD1Binding,type D1Database} from '../db/client.js';
import {splitSqlStatements} from '../db/split-sql.js';
import {setR2Binding,type R2Bucket} from '../storage/r2.js';
import {coverRoutes} from './covers.js';
import {setPlatformEnvironment} from '../lib/settings.js';
test('Food covers are owner-managed, permission/environment-gated and preserve working hours',async()=>{
process.env.JWT_SECRET='cover-tests-only';
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
await setPlatformEnvironment('live');
await client.execute("INSERT INTO users(id,name,password_hash,role,admin_role) VALUES('owner','Owner','h','customer',NULL),('other','Other','h','customer',NULL),('admin','Admin','h','admin','super_admin'),('finance','Finance','h','admin','finance_manager')");
await client.execute("INSERT INTO restaurants(id,owner_id,name,status,environment,updated_at) VALUES('food','owner','Kitchen','pending_approval','live','2026-10-06 08:00:00')");
const owner=await signToken({sub:'owner',role:'customer'}),other=await signToken({sub:'other',role:'customer'}),admin=await signToken({sub:'admin',role:'admin'}),finance=await signToken({sub:'finance',role:'admin'});
const objects=new Map<string,ArrayBuffer>();
setR2Binding({put:async(key:string,value:ArrayBuffer)=>{objects.set(key,value);},get:async(key:string)=>{const data=objects.get(key);return data?{body:new Blob([data]).stream(),httpMetadata:{contentType:'image/png'}}:null;},delete:async()=>{}} as unknown as R2Bucket);
const app=new Hono().route('/v1',coverRoutes);
const upload=(token=owner,type='image/png',contents='photo-bytes')=>{const form=new FormData();form.append('file',new File([contents],'cover.png',{type}));return app.request('/v1/restaurants/me/cover',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:form});};
assert.equal((await app.request('/v1/restaurants/me/cover',{method:'POST'})).status,401);
assert.equal((await upload(other)).status,404);assert.equal(objects.size,0);
assert.equal((await upload(owner,'text/plain')).status,400);assert.equal(objects.size,0);
assert.equal((await upload(owner,'image/png','x'.repeat(4*1024*1024+1))).status,400);assert.equal(objects.size,0);
assert.equal((await upload(owner,'image/png','x'.repeat(5*1024*1024))).status,413);assert.equal(objects.size,0);
const saved=await upload();assert.equal(saved.status,200);const first=await saved.json() as {coverKey:string};assert(first.coverKey.startsWith('restaurants/food/covers/'));
const state=(await client.execute("SELECT cover_key,updated_at FROM restaurants WHERE id='food'")).rows[0];assert.equal(state.cover_key,first.coverKey);assert.equal(state.updated_at,'2026-10-06 08:00:00');
const get=(token:string)=>app.request('/v1/restaurants/food/cover',{headers:{Authorization:`Bearer ${token}`}});
assert.equal((await get(other)).status,403);assert.equal((await get(finance)).status,403);assert.equal((await get(admin)).status,200);assert.equal((await get(owner)).status,200);
await client.execute("UPDATE restaurants SET status='active' WHERE id='food'");const publicCover=await get(other);assert.equal(publicCover.status,200);assert.equal(publicCover.headers.get('Cache-Control'),'private, no-store');assert.equal(await publicCover.text(),'photo-bytes');
await client.execute("UPDATE restaurants SET environment='sandbox' WHERE id='food'");assert.equal((await get(other)).status,403);assert.equal((await get(owner)).status,200);
const second=await (await upload()).json() as {coverKey:string};assert.notEqual(second.coverKey,first.coverKey);
} finally {setD1Binding(undefined);setR2Binding(undefined);client.close();}
});
