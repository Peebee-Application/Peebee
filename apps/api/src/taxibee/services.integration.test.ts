import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {createClient,type InArgs} from '@libsql/client/node';
import {Hono} from 'hono';
import {setD1Binding,type D1Database} from '../db/client.js';
import {splitSqlStatements} from '../db/split-sql.js';
import {resetSchemaCache} from '../lib/schema.js';
import {setSetting} from '../lib/settings.js';
import {signToken} from '../auth/jwt.js';
import {taxibeeServiceRoutes} from './services.js';
import {orderRoutes} from '../orders/routes.js';

test('Taxibee service browsing and quotes respect shared settings and history ownership',async t=>{
 const client=createClient({url:'file::memory:'});const secret=process.env.JWT_SECRET;process.env.JWT_SECRET='services-integration-test-only';
 for(const f of readdirSync('src/db/migrations').filter(f=>f.endsWith('.sql')).sort())for(const sql of splitSqlStatements(readFileSync('src/db/migrations/'+f,'utf8')))await client.execute(sql);
 const prepare=(sql:string)=>({sql,args:[] as unknown[],bind(...args:unknown[]){this.args=args;return this;},async all(){const r=await client.execute({sql:this.sql,args:this.args as InArgs});return{results:r.rows,success:true,meta:{changes:r.rowsAffected,last_row_id:Number(r.lastInsertRowid??0)}};}});
 setD1Binding({prepare,async batch(statements:ReturnType<typeof prepare>[]){return(await client.batch(statements.map(s=>({sql:s.sql,args:s.args as InArgs})),'write')).map(r=>({results:r.rows,success:true,meta:{changes:r.rowsAffected,last_row_id:Number(r.lastInsertRowid??0)}}));}} as unknown as D1Database);resetSchemaCache();
 try{
  for(const id of ['a','b','owner','demo-car-driver-owner'])await client.execute({sql:"INSERT INTO users(id,phone,name,password_hash,role) VALUES(?,?,?,'hash','customer')",args:[id,id,id]});
  const app=new Hono().route('/v1',taxibeeServiceRoutes).route('/v1',orderRoutes),tokens:Record<string,string>={};for(const sub of ['a','b'])tokens[sub]=await signToken({sub,role:'customer'});
  const call=(path:string,who?:string,body?:object)=>app.request('/v1/taxibee-services/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(who?{Authorization:'Bearer '+tokens[who]}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const json=async(r:Response)=>await r.json() as any;
  await setSetting('routing_server_url','');
  await t.test('public catalogue needs no login and stays closed under admin switches',async()=>{
   const r=await call('catalog');assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal((await json(r)).charterEnabled,false);
   assert.equal((await call('orders')).status,401);
   await setSetting('service_parcel_enabled','0');assert.equal((await call('parcel-quote?pickupLat=0&pickupLng=32&destinationLat=1&destinationLng=32')).status,403);
   await setSetting('service_parcel_enabled','1');
  });
  await client.execute("UPDATE vehicle_categories SET active=0");
  await client.execute("INSERT INTO vehicle_categories(id,name,kind,seats,rate_per_km,minimum_fare,service_group,rate_per_hour) VALUES('lux','Chauffeur','passenger',4,1000,5000,'luxury',6000),('hidden','Demo only','passenger',4,1000,5000,'standard',0),('cargo','Cargo','cargo',2,1000,5000,'standard',0)");
  await client.execute("INSERT INTO vehicles(id,owner_id,category_id,plate,status) VALUES('v','owner','lux','UBA001','approved'),('demo','demo-car-driver-owner','hidden','DEMO001','approved'),('c','owner','cargo','UBA002','approved')");
  await setSetting('car_enabled','1');
  await t.test('public categories expose approved passenger inventory without driver identities or demo-only stock',async()=>{
   const data=await json(await call('catalog'));assert.ok(data.charterEnabled);assert.deepEqual(data.categories.map((c:any)=>c.id),['lux']);
   assert.doesNotMatch(JSON.stringify(data.categories),/owner|UBA001|driver_id|last_lat/);
  });
  const route={categoryId:'lux',pickupLat:0.3,pickupLng:32.58,destinationLat:0.35,destinationLng:32.58};
  await t.test('charter prices come from the shared category formula, with server hourly limits and no fabricated daily price',async()=>{
   const trip=await json(await call('charter-quote',undefined,route));const hourly=await json(await call('charter-quote',undefined,{...route,hireHours:2}));assert.equal(hourly.fare-trip.fare,12000);
   assert.equal((await call('charter-quote',undefined,{...route,hireHours:100000})).status,400);assert.equal((await call('charter-quote',undefined,{...route,categoryId:'hidden'})).status,409);
   await setSetting('service_ride_enabled','0');assert.equal((await call('charter-quote',undefined,route)).status,409);await setSetting('service_ride_enabled','1');
  });
  await t.test('public parcel quote validates coordinates and offers a real direct-delivery fallback',async()=>{
   assert.equal((await call('parcel-quote?pickupLat=1000&pickupLng=32&destinationLat=1&destinationLng=32')).status,400);
   const response=await call('parcel-quote?pickupLat=0.3&pickupLng=32.58&destinationLat=0.35&destinationLng=32.58');assert.equal(response.status,200);const q=await json(response);assert.equal(q.relay,null);assert.ok(q.boda.fee>0);
  });
  await t.test('shared history includes only the signed-in customer, correct environment and supported services',async()=>{
   for(const [id,user,environment,ride] of [['parcel-a','a','live',0],['parcel-b','b','live',0],['sandbox-a','a','sandbox',0],['hire-a','a','live',1],['boda-a','a','live',1]]){
    await client.execute({sql:"INSERT INTO lists(id,customer_id,title,environment) VALUES(?,?,?,?)",args:['list-'+id,user,id,environment]});
    await client.execute({sql:"INSERT INTO orders(id,list_id,customer_id,type,stage,is_ride,environment) VALUES(?,?,?,'parcel','Create',?,?)",args:[id,'list-'+id,user,ride,environment]});
   }
   await client.execute("INSERT INTO car_bookings(id,order_id,customer_id,category_id) VALUES('book','hire-a','a','lux')");
   const rows=(await json(await call('orders','a'))).orders;assert.deepEqual(rows.map((r:any)=>r.id).sort(),['hire-a','parcel-a']);assert.equal(rows.find((r:any)=>r.id==='hire-a').service,'charter');
   assert.equal((await json(await call('orders','b'))).orders.length,1);
  });
 }finally{setD1Binding(undefined);resetSchemaCache();client.close();if(secret==null)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=secret;}
});
