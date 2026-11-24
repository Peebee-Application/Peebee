import {ApplicationServerKeys,setWebCrypto} from 'webpush-webcrypto';
import {notifyUser} from '../lib/webpush.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {createClient,type InArgs} from '@libsql/client/node';
import {Hono} from 'hono';
import bcrypt from 'bcryptjs';
import {setD1Binding,type D1Database} from '../db/client.js';
import {splitSqlStatements} from '../db/split-sql.js';
import {resetSchemaCache} from '../lib/schema.js';
import {setSetting} from '../lib/settings.js';
import {signToken,verifyToken} from '../auth/jwt.js';
import {accountToolsRoutes} from './routes.js';
import {settingsRoutes} from '../settings/routes.js';
import {pushRoutes} from '../push/routes.js';
import {setR2Binding,type R2Object} from '../storage/r2.js';
import {DEFAULT_CUSTOMER_TOOLS} from './settings.js';
test('customer account security, real-call eligibility and lost-property ownership',async t=>{
 const client=createClient({url:'file::memory:'});const secret=process.env.JWT_SECRET;process.env.JWT_SECRET='services-integration-test-only';
 for(const f of readdirSync('src/db/migrations').filter(f=>f.endsWith('.sql')).sort())for(const sql of splitSqlStatements(readFileSync('src/db/migrations/'+f,'utf8')))await client.execute(sql);
 const prepare=(sql:string)=>({sql,args:[] as unknown[],bind(...args:unknown[]){this.args=args;return this;},async all(){const r=await client.execute({sql:this.sql,args:this.args as InArgs});return{results:r.rows,success:true,meta:{changes:r.rowsAffected,last_row_id:Number(r.lastInsertRowid??0)}};}});
 setD1Binding({prepare,async batch(statements:ReturnType<typeof prepare>[]){return(await client.batch(statements.map(s=>({sql:s.sql,args:s.args as InArgs})),'write')).map(r=>({results:r.rows,success:true,meta:{changes:r.rowsAffected,last_row_id:Number(r.lastInsertRowid??0)}}));}} as unknown as D1Database);resetSchemaCache();

 setWebCrypto(crypto);
 const previousEnvironment=process.env.ENVIRONMENT;process.env.ENVIRONMENT='development';
 const objects=new Map<string,{bytes:Uint8Array;mime:string}>();setR2Binding({async put(k,v,o){objects.set(k,{bytes:new Uint8Array(v as ArrayBuffer),mime:o?.httpMetadata?.contentType||'image/png'});},async get(k){const v=objects.get(k);return v?{body:new Response(new Uint8Array(v.bytes).buffer).body!,httpMetadata:{contentType:v.mime}}:null;},async delete(k){objects.delete(k);}});
 try{
 const password=await bcrypt.hash('old-password',4);for(const id of ['a','b','rider','staff','noaccess'])await client.execute({sql:"INSERT INTO users(id,phone,name,password_hash,role,password_set_at,admin_role) VALUES(?,?,?,?,?,datetime('now'),?)",args:[id,'+25670000000'+['a','b','rider','staff','noaccess'].indexOf(id),id,password,id==='staff'||id==='noaccess'?'admin':id==='rider'?'rider':'customer',id==='staff'?'super_admin':id==='noaccess'?'rider_manager':null]});
 const tokens:Record<string,string>={};for(const id of ['a','b','rider','staff','noaccess','a2'])tokens[id]=await signToken({sub:id==='a2'?'a':id,role:id==='staff'||id==='noaccess'?'admin':id==='rider'?'rider':'customer'});
 const app=new Hono().route('/v1',accountToolsRoutes).route('/v1',settingsRoutes).route('/v1',pushRoutes);
 const call=(path:string,who='a',data?:any,method=data?'POST':'GET')=>app.request('/v1/'+path,{method,headers:{Authorization:'Bearer '+tokens[who],'Content-Type':'application/json','User-Agent':'Browser '+who},...(data?{body:JSON.stringify(data)}:{})});
 const json=async(r:Response)=>await r.json() as any;
 await t.test('sessions are observed, owner-scoped and individually revoked across shared auth',async()=>{
  assert.equal((await call('account-tools/config','a')).status,200);await call('account-tools/config','a2');
  const sessions=(await json(await call('account-tools/sessions'))).sessions;assert.equal(sessions.length,2);assert.equal(sessions.filter((s:any)=>s.current).length,1);const other=sessions.find((s:any)=>!s.current);
  assert.equal((await call('account-tools/sessions/'+other.id+'/revoke','b',{})).status,404);assert.equal((await call('account-tools/sessions/'+other.id+'/revoke','a',{})).status,200);assert.equal((await call('account-tools/config','a2')).status,401);
 });
 await t.test('contact changes require password, a new-contact code, bounded attempts and single-use consumption',async()=>{
  assert.equal((await call('account-tools/contact/request','a',{channel:'email',target:'new@example.test',password:'bad'})).status,400);
  const request=await json(await call('account-tools/contact/request','a',{channel:'email',target:'new@example.test',password:'old-password'}));assert.ok(request.devCode);assert.ok(request.id);
  assert.equal((await call('account-tools/contact/confirm','b',{id:request.id,code:request.devCode})).status,400);
  assert.equal((await call('account-tools/contact/confirm','a',{id:request.id,code:'999999'})).status,400);
  const result=await json(await call('account-tools/contact/confirm','a',{id:request.id,code:request.devCode}));assert.equal(result.user.email,'new@example.test');assert.ok(result.user.emailVerifiedAt);
  assert.equal((await call('account-tools/contact/confirm','a',{id:request.id,code:request.devCode})).status,400);
  process.env.ENVIRONMENT='production';assert.equal((await call('account-tools/contact/request','b',{channel:'sms',target:'+256799000111',password:'old-password'})).status,503);process.env.ENVIRONMENT='development';
 });
 await t.test('notification preferences persist per owner; unsubscribe cannot remove another user’s browser',async()=>{
  const prefs={enabled:true,journeys:false,wallet:true,messages:true,calls:true,marketing:false};assert.equal((await call('account-tools/preferences','a',prefs,'PUT')).status,200);assert.deepEqual((await json(await call('account-tools/preferences'))).push,prefs);assert.equal((await json(await call('account-tools/preferences','b'))).push.journeys,true);
  await call('push/subscribe','a',{endpoint:'https://push.example.test/device',keys:{auth:'auth',p256dh:'key'}});await call('push/unsubscribe','b',{endpoint:'https://push.example.test/device'});assert.equal((await client.execute('SELECT COUNT(*) AS n FROM push_subscriptions')).rows[0].n,1);
 });
 await t.test('push delivery obeys account categories and excludes revoked device sessions',async()=>{
  const oldPublic=process.env.VAPID_PUBLIC_KEY,oldPrivate=process.env.VAPID_PRIVATE_KEY,originalFetch=globalThis.fetch;const keys=await(await ApplicationServerKeys.generate()).toJSON();process.env.VAPID_PUBLIC_KEY=keys.publicKey;process.env.VAPID_PRIVATE_KEY=keys.privateKey;
  const receiver=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);const p256dh=Buffer.from(await crypto.subtle.exportKey('raw',receiver.publicKey)).toString('base64url'),auth=Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');let sent=0;globalThis.fetch=async()=>{sent++;return new Response('',{status:201});};
  try{await call('push/subscribe','a',{endpoint:'https://push.example.test/device',keys:{p256dh,auth}});await client.execute({sql:'INSERT INTO push_subscriptions(id,user_id,endpoint,p256dh,auth,session_jti) VALUES(?,?,?,?,?,?)',args:['revoked-push','a','https://push.example.test/revoked',p256dh,auth,(await verifyToken(tokens.a2)).jti]});
   await notifyUser('a',{title:'Trip',body:'Update',tag:'order-1',url:'/'});assert.equal(sent,0,'Disabled journey notifications must not be sent');await notifyUser('a',{title:'Wallet',body:'Update',tag:'wallet-1',url:'/'});assert.equal(sent,1,'Only the non-revoked subscribed device receives an enabled category');
  }finally{globalThis.fetch=originalFetch;await client.execute("DELETE FROM push_subscriptions WHERE user_id='a'");if(oldPublic==null)delete process.env.VAPID_PUBLIC_KEY;else process.env.VAPID_PUBLIC_KEY=oldPublic;if(oldPrivate==null)delete process.env.VAPID_PRIVATE_KEY;else process.env.VAPID_PRIVATE_KEY=oldPrivate;}
 });
 for(const id of ['order-a','order-b']){const u=id.endsWith('a')?'a':'b';await client.execute({sql:"INSERT INTO lists(id,customer_id,title) VALUES(?,?,?)",args:['l-'+id,u,id]});await client.execute({sql:"INSERT INTO orders(id,list_id,customer_id,rider_id,type,stage,environment) VALUES(?,?,?,'rider','parcel','Complete','live')",args:[id,'l-'+id,u]});}
 const report={id:'report-idempotent',orderId:'order-a',description:'Black bag left in the rear seat',contact:'new@example.test'};
 await t.test('lost-property reports bind to owned bookings, retry without duplicate and restrict case access/status',async()=>{
  assert.equal((await call('account-tools/cases','b',report)).status,404);assert.equal((await call('account-tools/cases','a',report)).status,201);assert.equal((await call('account-tools/cases','a',report)).status,200);assert.equal((await json(await call('account-tools/cases'))).cases.length,1);
  assert.equal((await call('account-tools/cases/'+report.id,'b')).status,404);assert.equal((await call('account-tools/cases/'+report.id+'/message','a',{body:'I found the receipt',status:'returned'})).status,403);
  assert.equal((await call('admin/customer-cases','noaccess')).status,403);assert.equal((await call('admin/customer-cases','staff')).status,200);
  assert.equal((await call('admin/customer-cases/'+report.id+'/message','staff',{body:'We are checking with the driver',status:'investigating',version:1})).status,200);
  assert.equal((await call('admin/customer-cases/'+report.id+'/message','staff',{body:'Stale update',status:'found',version:1})).status,409);assert.equal((await json(await call('account-tools/cases/'+report.id))).report.status,'investigating');
  await setSetting('platform_environment','sandbox');assert.equal((await json(await call('account-tools/cases'))).cases.length,0);assert.equal((await call('account-tools/cases/'+report.id)).status,404);await setSetting('platform_environment','live');
 });
 await t.test('case files reject disguised content and are private to owner/support',async()=>{
  const upload=async(who:string,bytes:Uint8Array)=>{const form=new FormData();form.append('file',new Blob([new Uint8Array(bytes).buffer],{type:'image/png'}),'test.png');return app.request('/v1/account-tools/cases/'+report.id+'/files',{method:'POST',headers:{Authorization:'Bearer '+tokens[who]},body:form});};
  assert.equal((await upload('a',new TextEncoder().encode('<script>'))).status,400);const r=await upload('a',new Uint8Array([137,80,78,71,13,10,26,10]));assert.equal(r.status,201);const file=await json(r);assert.equal((await call('account-tools/cases/'+report.id+'/files/'+file.id,'b')).status,404);assert.equal((await call('account-tools/cases/'+report.id+'/files/'+file.id)).status,200);
 });
 await t.test('real-call wrapper never offers mock audio or permits unowned booking calls',async()=>{
  assert.equal((await call('account-tools/calls','b',{orderId:'order-a'})).status,409);assert.equal((await call('account-tools/calls','a',{orderId:'order-a'})).status,503);await setSetting('calls_active_provider','webrtc_p2p');const started=await call('account-tools/calls','a',{orderId:'order-a'});assert.equal(started.status,201);assert.equal((await json(started)).call.callee_id,'rider');await setSetting('calls_active_provider','mock');
 });
 await t.test('admin policy validation, activity log and migration absence are safe',async()=>{
  assert.equal((await call('admin/customer-tools','staff',{...DEFAULT_CUSTOMER_TOOLS,otpAttempts:100},'PUT')).status,400);
  assert.equal((await call('admin/customer-tools','staff',{...DEFAULT_CUSTOMER_TOOLS,contactChangesEnabled:false},'PUT')).status,200);assert.equal((await call('account-tools/contact/request','a',{channel:'email',target:'other@example.test',password:'old-password'})).status,403);
  await client.execute('DROP TABLE account_sessions');await client.execute('DROP TABLE account_contact_changes');await client.execute('DROP TABLE account_preferences');await client.execute('DROP TABLE customer_case_files');await client.execute('DROP TABLE customer_case_events');await client.execute('DROP TABLE customer_cases');await client.execute('ALTER TABLE push_subscriptions DROP COLUMN session_jti');resetSchemaCache();
  assert.equal((await call('push/subscribe','b',{endpoint:'https://push.example.test/old-schema',keys:{auth:'auth',p256dh:'key'}})).status,200);
  assert.equal((await call('account-tools/config')).status,200);assert.equal((await call('account-tools/sessions')).status,503);assert.equal((await call('account-tools/cases')).status,503);
 });
 }finally{setR2Binding(undefined);setD1Binding(undefined);resetSchemaCache();client.close();if(secret==null)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=secret;if(previousEnvironment==null)delete process.env.ENVIRONMENT;else process.env.ENVIRONMENT=previousEnvironment;}
});
