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
import {orderRoutes} from '../orders/routes.js';
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
  const state=new WeakMap<object,{sql:string;args:InArgs}>();
  const prepare = (sql: string) => {
    const data={sql,args:[] as InArgs};
    const statement={bind(...args:unknown[]){data.args=args as InArgs;return statement;},async all(){const result=await client.execute(data);return {results:result.rows,success:true,meta:{changes:result.rowsAffected}};}};
    state.set(statement,data);return statement;
  };
  setD1Binding({
    prepare,
    async batch(statements:Parameters<D1Database['batch']>[0]){
      const requests=statements.map(statement=>{const request=state.get(statement);assert.ok(request);return request;});
      const results=await client.batch(requests,'write');
      return results.map(result=>({results:result.rows,success:true,meta:{changes:result.rowsAffected}}));
    },
  } as unknown as D1Database);
try {
await setPlatformEnvironment('live');await setServiceSwitches({food:true});
await client.execute("INSERT INTO users(id,name,password_hash,role,email) VALUES('owner','Owner','h','customer','owner@example.test'),('buyer','Amina Nakitto','h','customer','buyer@example.test'),('other','Other Buyer','h','customer','other@example.test'),('rider','Rider','h','rider','rider@example.test')");
await client.execute("INSERT INTO restaurants(id,owner_id,name,status,is_open,environment,lat,lng,updated_at) VALUES('food','owner','Kitchen','active',1,'live',0.3,32.5,'2026-10-06 08:00:00'),('food2','owner','Second Kitchen','active',1,'live',0.3,32.55,'2026-10-06 08:00:00')");
await client.execute("INSERT INTO menu_items(id,restaurant_id,name,price) VALUES('dish','food','Chicken and rice',8000)");
await client.execute("INSERT INTO menu_items(id,restaurant_id,name,price) VALUES('dish2','food2','Rolex',5000)");
const owner=await signToken({sub:'owner',role:'customer'}),buyer=await signToken({sub:'buyer',role:'customer'}),other=await signToken({sub:'other',role:'customer'}),rider=await signToken({sub:'rider',role:'rider'});
const app=new Hono().route('/v1',restaurantRoutes).route('/v1',menuRoutes).route('/v1',orderRoutes).route('/v1',customerRestaurantRoutes).route('/v1',foodFeedbackRoutes);
const call=(path:string,token=buyer,method='GET',body?:unknown)=>app.request('/v1'+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
assert.equal((await call('/restaurants/me/menu/items/dish',other,'PATCH',{featured:true})).status,404);
assert.equal((await call('/restaurants/me/menu/items/dish',owner,'PATCH',{featured:true})).status,200);
assert.equal((await client.execute("SELECT is_featured FROM menu_items WHERE id='dish'")).rows[0].is_featured,1);
assert.equal((await call('/restaurants/me',owner,'PATCH',{themeScene:'forest',themeMode:'dark'})).status,200);
const business=(await client.execute("SELECT theme_scene,theme_mode,updated_at FROM restaurants WHERE id='food'")).rows[0];assert.equal(business.theme_scene,'forest');assert.equal(business.theme_mode,'dark');assert.equal(business.updated_at,'2026-10-06 08:00:00');
assert.equal((await call('/restaurants/me',owner,'PATCH',{themeScene:'invented-colour'})).status,400);
const newFood=await call('/restaurants/apply',other,'POST',{name:'Code Linked Kitchen',businessType:'kitchen',phone:'+256700000099',address:'Kampala',lat:0.3,lng:32.5});assert.equal(newFood.status,201);
const newFoodBody=await newFood.json() as {restaurant:{id:string;merchant_id:string;outlet_id:string;outlet_code:string;merchant_code:string}};
assert.match(newFoodBody.restaurant.outlet_code,/^PEEBEE-/);assert.match(newFoodBody.restaurant.merchant_code,/^MER-/);
const linkedFood=await client.execute({sql:'SELECT r.merchant_id,r.outlet_id,o.code,m.merchant_code FROM restaurants r JOIN merchant_outlets o ON o.id=r.outlet_id JOIN merchants m ON m.id=r.merchant_id WHERE r.id=?',args:[newFoodBody.restaurant.id]});
assert.equal(linkedFood.rows[0]?.merchant_id,newFoodBody.restaurant.merchant_id);assert.equal(linkedFood.rows[0]?.outlet_id,newFoodBody.restaurant.outlet_id);assert.equal(linkedFood.rows[0]?.code,newFoodBody.restaurant.outlet_code);
const created=await call('/restaurants/food/order',buyer,'POST',{items:[{menuItemId:'dish',quantity:2}],destinationArea:'Kampala',destinationAddress:'Home',destinationLat:0.4,destinationLng:32.5,paymentRail:'escrow'});assert.equal(created.status,201);
const order=(await created.json() as {order:{id:string;list_id:string}}).order;
assert.equal((await client.execute({sql:'SELECT source_menu_item_id FROM list_items WHERE list_id=?',args:[order.list_id]})).rows[0].source_menu_item_id,'dish');
assert.equal((await call(`/orders/${order.id}/match`,buyer,'POST',{})).status,409,'a new order stays unmatched until the customer chooses one or two pickups');
const candidates=await (await call('/orders/bundle-candidates')).json() as {orders:Array<{id:string}>};assert.equal(candidates.orders[0]?.id,order.id);
const bundledResponse=await call('/restaurants/food2/order',buyer,'POST',{items:[{menuItemId:'dish2',quantity:1}],destinationArea:'Kampala',destinationAddress:'Home',destinationLat:0.4,destinationLng:32.5,bundleWithOrderId:order.id});assert.equal(bundledResponse.status,201);
const bundledOrder=(await bundledResponse.json() as {order:{id:string;delivery_fee:number;delivery_bundle_id:string}}).order;
const linked=await client.execute({sql:'SELECT id,delivery_fee,delivery_bundle_id FROM orders WHERE id IN (?,?) ORDER BY id',args:[order.id,bundledOrder.id]});assert.equal(linked.rows.length,2);assert.equal(linked.rows[0]?.delivery_bundle_id,bundledOrder.delivery_bundle_id);assert.ok(Number(linked.rows.find(row=>row.id===bundledOrder.id)?.delivery_fee)>0);
const stops=await call(`/orders/${bundledOrder.id}`);assert.equal(stops.status,200);assert.equal(((await stops.json()) as {bundleStops:Array<unknown>}).bundleStops.length,2);
await client.execute("UPDATE users SET default_matching_mode='first_to_claim' WHERE id='buyer'");
await client.execute("INSERT INTO riders(user_id,verified,is_online,stage_lat,stage_lng,area,subscription_status,subscription_paid_through) VALUES('rider',1,1,0.4,32.5,'Kampala','active','2099-01-01')");
const matchResponse=await call(`/orders/${order.id}/match`,buyer,'POST',{});assert.equal(matchResponse.status,200,JSON.stringify(await matchResponse.json()));
const assignment=await client.execute({sql:'SELECT rider_id FROM orders WHERE id IN (?,?)',args:[order.id,bundledOrder.id]});assert.equal(assignment.rows.length,2);assert(assignment.rows.every((row)=>row.rider_id==='rider'),'dispatch assigns one rider to both seller orders');
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
