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
import {setPlatformEnvironment,setServiceSwitches} from '../lib/settings.js';
import {restaurantRoutes} from './routes.js';
import {menuRoutes} from './menu.js';
import {customerRestaurantRoutes} from './customer.js';
import {foodFeedbackRoutes} from './feedback.js';
test('Food storefront settings, tracked checkout and verified reviews respect ownership, environment and legacy schema',async()=>{
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
await setPlatformEnvironment('live');await setServiceSwitches({food:true});
await client.execute("INSERT INTO users(id,name,password_hash,role,email) VALUES('owner','Owner','h','customer','owner@example.test'),('buyer','Amina Nakitto','h','customer','buyer@example.test'),('other','Other Buyer','h','customer','other@example.test'),('rider','Rider','h','rider','rider@example.test')");
await client.execute("INSERT INTO restaurants(id,owner_id,name,status,is_open,environment,updated_at) VALUES('food','owner','Kitchen','active',1,'live','2026-10-06 08:00:00')");
await client.execute("INSERT INTO menu_items(id,restaurant_id,name,price) VALUES('dish','food','Chicken and rice',8000)");
const owner=await signToken({sub:'owner',role:'customer'}),buyer=await signToken({sub:'buyer',role:'customer'}),other=await signToken({sub:'other',role:'customer'}),rider=await signToken({sub:'rider',role:'rider'});
const app=new Hono().route('/v1',restaurantRoutes).route('/v1',menuRoutes).route('/v1',customerRestaurantRoutes).route('/v1',foodFeedbackRoutes);
const call=(path:string,token=buyer,method='GET',body?:unknown)=>app.request('/v1'+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
assert.equal((await call('/restaurants/me/menu/items/dish',other,'PATCH',{featured:true})).status,404);
assert.equal((await call('/restaurants/me/menu/items/dish',owner,'PATCH',{featured:true})).status,200);
assert.equal((await client.execute("SELECT is_featured FROM menu_items WHERE id='dish'")).rows[0].is_featured,1);
assert.equal((await call('/restaurants/me',owner,'PATCH',{themeScene:'forest',themeMode:'dark'})).status,200);
const business=(await client.execute("SELECT theme_scene,theme_mode,updated_at FROM restaurants WHERE id='food'")).rows[0];assert.equal(business.theme_scene,'forest');assert.equal(business.theme_mode,'dark');assert.equal(business.updated_at,'2026-10-06 08:00:00');
assert.equal((await call('/restaurants/me',owner,'PATCH',{themeScene:'invented-colour'})).status,400);
const created=await call('/restaurants/food/order',buyer,'POST',{items:[{menuItemId:'dish',quantity:2}],destinationArea:'Kampala',paymentRail:'escrow'});assert.equal(created.status,201);
const order=(await created.json() as {order:{id:string;list_id:string}}).order;
assert.equal((await client.execute({sql:'SELECT source_menu_item_id FROM list_items WHERE list_id=?',args:[order.list_id]})).rows[0].source_menu_item_id,'dish');
const review={orderId:order.id,rating:5,comment:'Delicious and fresh',recommended:true};
assert.equal((await call('/restaurants/food/items/dish/review',buyer,'PUT',review)).status,403);
await client.execute({sql:"UPDATE orders SET stage='Handover' WHERE id=?",args:[order.id]});
assert.equal((await call('/restaurants/food/items/dish/review',other,'PUT',review)).status,403);
assert.equal((await call('/restaurants/food/items/dish/review',rider,'PUT',review)).status,403);
assert.equal((await call('/restaurants/food/items/missing/review',buyer,'PUT',review)).status,403);
assert.equal((await call('/restaurants/food/items/dish/review',buyer,'PUT',{...review,rating:6})).status,400);
assert.equal((await call('/restaurants/food/items/dish/review',buyer,'PUT',review)).status,200);
assert.equal((await call('/restaurants/food/items/dish/review',buyer,'PUT',{...review,rating:4,comment:'Updated review'})).status,200);
const feedback=await (await call('/restaurants/food/items/dish/reviews')).json() as {averageRating:number;ratingCount:number;orderCount:number;recommendCount:number;reviews:Array<{authorName:string;comment:string}>;eligibleOrderId:string};
assert.equal(feedback.averageRating,4);assert.equal(feedback.ratingCount,1);assert.equal(feedback.orderCount,1);assert.equal(feedback.recommendCount,1);assert.equal(feedback.reviews[0].authorName,'Amina');assert.equal(feedback.reviews[0].comment,'Updated review');assert.equal(feedback.eligibleOrderId,order.id);assert(!JSON.stringify(feedback).includes('buyer@example.test'));
const stats=await (await call('/restaurants/food/menu/insights')).json() as {items:Record<string,{orderCount:number;ratingCount:number}>};assert.equal(stats.items.dish.orderCount,1);assert.equal(stats.items.dish.ratingCount,1);
await setPlatformEnvironment('sandbox');assert.equal((await call('/restaurants/food/items/dish/reviews')).status,404);assert.equal((await call('/restaurants/food/items/dish/review',buyer,'PUT',review)).status,403);
await setPlatformEnvironment('live');
await client.execute('DROP TABLE food_item_reviews');await client.execute('DROP INDEX idx_food_source_item');await client.execute('ALTER TABLE list_items DROP COLUMN source_menu_item_id');await client.execute('ALTER TABLE menu_items DROP COLUMN is_featured');await client.execute('ALTER TABLE restaurants DROP COLUMN theme_scene');await client.execute('ALTER TABLE restaurants DROP COLUMN theme_mode');resetSchemaCache();
assert.equal((await call('/restaurants/me/menu/items/dish',owner,'PATCH',{featured:true})).status,503);
assert.equal((await call('/restaurants/me/menu/items/dish',owner,'PATCH',{price:8500})).status,200);
assert.equal((await call('/restaurants/me',owner,'PATCH',{themeScene:'forest'})).status,503);
assert.equal((await call('/restaurants/me',owner,'PATCH',{name:'Renamed kitchen'})).status,200);
const legacy=await (await call('/restaurants/food/items/dish/reviews')).json() as {available:boolean};assert.equal(legacy.available,false);
assert.equal((await call('/restaurants/food/order',buyer,'POST',{items:[{menuItemId:'dish',quantity:1}],destinationArea:'Kampala'})).status,201);
} finally {setD1Binding(undefined);resetSchemaCache();client.close();}
});
