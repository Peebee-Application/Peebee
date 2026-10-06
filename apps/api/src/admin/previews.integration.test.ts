import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {createClient,type InArgs} from '@libsql/client/node';
import {Hono} from 'hono';
import {signToken} from '../auth/jwt.js';
import {setD1Binding,type D1Database} from '../db/client.js';
import {splitSqlStatements} from '../db/split-sql.js';
import {adminRoutes} from './routes.js';
import {setR2Binding,type R2Bucket} from '../storage/r2.js';
test('Admin previews enforce role and per-directory permission, expose submitted data and omit credentials',async()=>{
process.env.JWT_SECRET='preview-tests-only';
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
await client.execute("INSERT INTO users(id,name,password_hash,role,admin_role,email) VALUES('admin','Admin','SECRET_HASH','admin','super_admin','admin@example.test'),('viewer','Finance','h','admin','finance_manager','finance@example.test'),('customer','Alice','PRIVATE_HASH','customer',NULL,'alice@example.test')");
await client.execute("INSERT INTO restaurants(id,owner_id,name,description,address,business_type) VALUES('food','customer','Alice Kitchen','Full submitted description','Full home pickup address','kitchen')");
const token=await signToken({sub:'admin',role:'admin'});
const customer=await signToken({sub:'customer',role:'customer'});
const restricted=await signToken({sub:'viewer',role:'admin'});
const app=new Hono().route('/v1',adminRoutes);
const get=(path:string,bearer=token)=>app.request('/v1'+path,{headers:{Authorization:`Bearer ${bearer}`}});
assert.equal((await app.request('/v1/admin/restaurants/food')).status,401);
assert.equal((await get('/admin/restaurants/food',customer)).status,403);
assert.equal((await get('/admin/restaurants/food',restricted)).status,403);
const food=await get('/admin/restaurants/food');assert.equal(food.status,200);const payload=await food.json() as {restaurant:Record<string,unknown>};assert.equal(payload.restaurant.description,'Full submitted description');assert.equal(payload.restaurant.owner_email,'alice@example.test');assert(!JSON.stringify(payload).includes('PRIVATE_HASH'));
const profile=await get('/admin/customers/customer');assert.equal(profile.status,200);const data=await profile.text();assert(data.includes('alice@example.test'));assert(!data.includes('PRIVATE_HASH'));assert(!data.includes('password_hash'));
assert.equal((await get('/admin/restaurants/missing')).status,404);
for(const kind of ['riders','customers','restaurants','merchants'])assert.equal((await get(`/admin/people/${kind}/missing/photo`,customer)).status,403);
assert.equal((await get('/admin/people/restaurants/food/photo',restricted)).status,403);
assert.equal((await get('/admin/people/restaurants/food/photo')).status,404);
assert.equal((await get('/admin/people/constructor/missing/photo')).status,404);
await client.execute("UPDATE users SET profile_photo_key='users/customer/profile-photo.png' WHERE id='customer'");
setR2Binding({get:async(key:string)=>{assert.equal(key,'users/customer/profile-photo.png');return {body:new Blob(['photo-bytes']).stream(),httpMetadata:{contentType:'image/png'}};}} as unknown as R2Bucket);
const picture=await get('/admin/people/restaurants/food/photo');assert.equal(picture.status,200);assert.equal(picture.headers.get('Content-Type'),'image/png');assert.equal(picture.headers.get('Cache-Control'),'private, no-store');assert.equal(await picture.text(),'photo-bytes');
} finally {setD1Binding(undefined);setR2Binding(undefined);client.close();}
});
