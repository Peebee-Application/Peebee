import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';
import {createClient,type InArgs} from '@libsql/client/node';
import {setD1Binding,type D1Database} from '../db/client.js';
import {splitSqlStatements} from '../db/split-sql.js';
import {resetSchemaCache} from '../lib/schema.js';
import {signToken} from '../auth/jwt.js';
import app from '../app.js';
import {activate,activationPreview,enroll,enrollmentSchema,invite,sweepActivationMessages,tokenHash} from './service.js';
import {saveOnboardingSettings} from './messaging.js';
import {isRiderProfileComplete,type Rider} from '@peebee/shared';

test('sales onboarding: access, atomic profiles, messaging and one-time activation',async t=>{
  const client=createClient({url:'file::memory:'}),environment={...process.env},realFetch=globalThis.fetch;
  const state=new WeakMap<object,{sql:string;args:InArgs}>();
  const prepare=(sql:string)=>{
    const data={sql,args:[] as InArgs};
    const statement={bind(...args:unknown[]){data.args=args as InArgs;return statement;},async all<T>(){const r=await client.execute(data);return {results:r.rows as T[],success:true,meta:{changes:r.rowsAffected,last_row_id:0}};}};
    state.set(statement,data);return statement;
  };
  const binding:D1Database={prepare,async batch<T>(statements:Parameters<D1Database['batch']>[0]){const requests=statements.map(s=>{const r=state.get(s);assert.ok(r);return r;});const results=await client.batch(requests,'write');return results.map(r=>({results:r.rows as T[],success:true,meta:{changes:r.rowsAffected,last_row_id:0}}));}};
  setD1Binding(binding);resetSchemaCache();
  process.env.JWT_SECRET='onboarding-test-only-secret';process.env.ENVIRONMENT='development';process.env.RESEND_API_KEY='re_onboarding_test';process.env.CREDENTIALS_ENCRYPTION_KEY='onboarding-test-encryption';
  for(const file of readdirSync(join(process.cwd(),'src/db/migrations')).filter(f=>f.endsWith('.sql')).sort())for(const sql of splitSqlStatements(readFileSync(join(process.cwd(),'src/db/migrations',file),'utf8')))await client.execute(sql);
  await client.execute("INSERT INTO users (id,phone,email,name,password_hash,role,admin_role) VALUES ('admin','+256700000003','admin@example.invalid','Admin','h','admin','super_admin'),('agent','+256700000004','agent@example.invalid','Agent','h','customer',NULL),('other','+256700000005','other@example.invalid','Other','h','customer',NULL),('plain','+256700000006','plain@example.invalid','Plain','h','customer',NULL)");
  await client.execute("INSERT INTO sales_agents (user_id,created_by) VALUES ('agent','admin'),('other','admin')");
  const tokens:Record<string,string>={};for(const who of ['admin','agent','other','plain'])tokens[who]=await signToken({sub:who,role:who==='admin'?'admin':'customer'});
  const outbox:Array<{to:string;link:string}>=[];let mode:'success'|'reject'|'unknown'='success';
  globalThis.fetch=async(url,options)=>{
    assert.match(String(url),/^https:\/\/(api\.resend\.com|graph\.facebook\.com|api\.africastalking\.com)/);
    if(mode==='unknown')throw new Error('network outcome unknown');
    if(mode==='reject')return new Response(JSON.stringify({name:'provider_error'}),{status:400,headers:{'Content-Type':'application/json'}});
    const body=JSON.parse(String(options?.body)) as {to:string[];text:string};
    const match=body.text?.match(/https?:\/\/\S+\/activate#token=([\w-]+)/);
    if(match)outbox.push({to:body.to[0],link:match[0]});
    return new Response(JSON.stringify({id:'test-email'}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const call=(method:string,path:string,body?:unknown,who='agent')=>app.request(`http://test/v1${path}`,{method,headers:{'Content-Type':'application/json',...(tokens[who]?{Authorization:`Bearer ${tokens[who]}`}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const input=(type:'customer'|'rider'|'restaurant'|'merchant',suffix:string,profile:Record<string,string|number>={})=>enrollmentSchema.parse({requestId:crypto.randomUUID(),accountType:type,name:`Test ${suffix}`,email:`${suffix}@example.invalid`,phone:`+256700${suffix.length.toString().padStart(6,'0')}`,consent:true,preferredChannel:'email',profile});
  const emailOnly=(type:'customer'|'rider'|'restaurant'|'merchant',suffix:string,profile:Record<string,string|number>={})=>{const d=input(type,suffix,profile);delete d.phone;return d;};
  try {
    await t.test('agent access is narrow and enforced by the API',async()=>{
      assert.equal((await call('GET','/sales/me',undefined,'plain')).status,403);
      assert.equal((await call('GET','/sales/me',undefined,'agent')).status,200);
      assert.equal((await call('GET','/admin/onboarding/settings',undefined,'agent')).status,403);
      assert.equal((await call('GET','/admin/staff',undefined,'agent')).status,403);
    });
    let accountId='',userId='',activationToken='';
    await t.test('customer is saved once and automatically gets an activation email',async()=>{
      const data=emailOnly('customer','customer');
      const first=await call('POST','/sales/onboarding',data);assert.equal(first.status,201);
      accountId=(await first.json() as {id:string}).id;
      userId=String((await client.execute({sql:'SELECT user_id FROM onboarding_accounts WHERE id=?',args:[accountId]})).rows[0].user_id);
      assert.equal(outbox.at(-1)?.to,'customer@example.invalid');
      activationToken=new URL(outbox.at(-1)!.link).hash.slice('#token='.length);
      assert.equal((await call('POST','/sales/onboarding',data)).status,200);
      assert.equal(outbox.length,1);
      assert.equal((await call('POST','/sales/onboarding',{...data,requestId:crypto.randomUUID()})).status,409);
      assert.equal((await client.execute("SELECT COUNT(*) AS n FROM users WHERE email='customer@example.invalid'")).rows[0].n,1);
      assert.equal((await call('POST',`/sales/onboarding/${accountId}/resend`,undefined,'other')).status,404);
      const otherList=await (await call('GET','/sales/onboarding',undefined,'other')).json() as {records:unknown[]};assert.equal(otherList.records.length,0);
    });
    await t.test('inactive accounts cannot use a signed session before activation',async()=>{
      const token=await signToken({sub:userId,role:'customer'});
      const result=await app.request('http://test/v1/auth/me',{headers:{Authorization:`Bearer ${token}`}});
      assert.equal(result.status,403);assert.equal((await result.json() as {error:string}).error,'activation_required');
    });
    await t.test('activation sets the password and verified contact without a second user',async()=>{
      const preview=await activationPreview(activationToken);assert.equal(preview.name,'Test customer');
      const session=await activate(activationToken,'CustomerPassword123');assert.equal(session.user.id,userId);assert.ok(session.user.emailVerifiedAt);assert.ok(session.user.passwordSet);
      const check=await app.request('http://test/v1/auth/me',{headers:{Authorization:`Bearer ${session.token}`}});assert.equal(check.status,200);
      await assert.rejects(()=>activate(activationToken,'AnotherPassword123'),/already used/);
      assert.equal((await client.execute("SELECT COUNT(*) AS n FROM users WHERE email='customer@example.invalid'")).rows[0].n,1);
      assert.equal((await call('POST','/auth/login',{identifier:'customer@example.invalid',password:'CustomerPassword123'},'none')).status,200);
    });
    await t.test('switching the active type creates the matching business records',async()=>{
      const category=String((await client.execute('SELECT id FROM merchant_categories WHERE active=1 LIMIT 1')).rows[0].id);
      for(const type of ['restaurant','merchant'] as const){
        const data=emailOnly(type,type,{businessName:`Test ${type}`,legalName:'Test business ltd',outletName:'Main outlet',categoryId:category,address:'Test address',lat:0.3,lng:32.5});
        const created=await enroll(data,'agent');await invite(created.id);
        const token=new URL(outbox.at(-1)!.link).hash.slice('#token='.length);assert.equal(new URL(outbox.at(-1)!.link).port,type==='restaurant'?'3003':'3005');
        const session=await activate(token,'BusinessPassword123');
        const path=type==='restaurant'?'/restaurants/me':'/merchants/me';
        const response=await app.request(`http://test/v1${path}`,{headers:{Authorization:`Bearer ${session.token}`}});assert.equal(response.status,200);
        const body=await response.json() as {restaurant?:{name:string};merchants?:Array<{display_name:string}>};assert.equal(type==='restaurant'?body.restaurant?.name:body.merchants?.[0].display_name,`Test ${type}`);
      }
    });
    await t.test('complete rider details and uploads are retained; approval is separate',async()=>{
      const data=emailOnly('rider','rider',{firstName:'Test',lastName:'Rider',vehicleInfo:'TEST 1',stageAddress:'Stage road',homeAddress:'Home road',lat:0.3,lng:32.5,stageName:'Test stage',stageChairmanName:'Chairman',stageChairmanContact:'+256700000010',emergencyContactName:'Contact',emergencyContactPhone:'+256700000011'});
      const created=await enroll(data,'agent',{riderId:'private/test-id',photo:'private/test-photo'});await invite(created.id);
      const session=await activate(new URL(outbox.at(-1)!.link).hash.slice('#token='.length),'RiderPassword123');
      const rider=(await client.execute({sql:'SELECT * FROM riders WHERE user_id=?',args:[session.user.id]})).rows[0];
      assert.equal(isRiderProfileComplete(rider as unknown as Rider),true);assert.equal(rider.verified,0);assert.ok(rider.profile_completed_at);assert.equal(rider.national_id_key,'private/test-id');
    });
    await t.test('invalid business data leaves no orphan account',async()=>{
      const data=emailOnly('merchant','badcategory',{businessName:'Bad category',legalName:'Business',outletName:'Outlet',categoryId:'does-not-exist',lat:0.3,lng:32.5});
      await assert.rejects(()=>enroll(data,'agent'),/category/);
      assert.equal((await client.execute("SELECT COUNT(*) AS n FROM users WHERE email='badcategory@example.invalid'")).rows[0].n,0);
    });
    await t.test('expired links and suspended accounts are rejected',async()=>{
      const data=emailOnly('customer','expired'),created=await enroll(data,'agent');await invite(created.id);const token=new URL(outbox.at(-1)!.link).hash.slice('#token='.length);
      await client.execute({sql:"UPDATE onboarding_invitations SET expires_at='2000-01-01' WHERE token_hash=?",args:[tokenHash(token)]});await assert.rejects(()=>activate(token,'NewPassword123'),/expired/);
      const fresh=await enroll(emailOnly('customer','suspended'),'agent');await invite(fresh.id);const second=new URL(outbox.at(-1)!.link).hash.slice('#token='.length);
      await client.execute("UPDATE users SET status='suspended' WHERE email='suspended@example.invalid'");await assert.rejects(()=>activate(second,'NewPassword123'),/suspended/);
    });
    await t.test('two simultaneous activations cannot both change the password',async()=>{
      const created=await enroll(emailOnly('customer','concurrent'),'agent');await invite(created.id);const token=new URL(outbox.at(-1)!.link).hash.slice('#token='.length);
      const results=await Promise.allSettled([activate(token,'PasswordOne123'),activate(token,'PasswordTwo123')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    });
    await t.test('provider rejection preserves registration and uncertain sends are not retried',async()=>{
      mode='reject';const created=await enroll(emailOnly('customer','providerfailed'),'agent');assert.equal((await invite(created.id)).sent,false);
      assert.equal((await client.execute({sql:'SELECT status FROM onboarding_deliveries WHERE account_id=?',args:[created.id]})).rows[0].status,'failed');
      mode='unknown';const uncertain=await enroll(emailOnly('customer','unknown'),'agent');assert.equal((await invite(uncertain.id)).sent,false);
      await client.execute("UPDATE onboarding_accounts SET last_invited_at='2000-01-01'");mode='success';await sweepActivationMessages();
      assert.ok(outbox.some(m=>m.to==='providerfailed@example.invalid'));assert.equal(outbox.some(m=>m.to==='unknown@example.invalid'),false);
    });
    await t.test('credentials are encrypted, masked and administrator-controlled',async()=>{
      const data={enabled:true,activationHours:48,resendSeconds:60,maxAttempts:3,channels:['email','sms'] as ('email'|'sms'|'whatsapp')[],whatsappPhoneId:'123',whatsappTemplate:'activate_account',whatsappLanguage:'en',whatsappVersion:'v25.0',whatsappToken:'secret-whatsapp',smsUsername:'test-user',smsKey:'secret-sms'};
      await saveOnboardingSettings(data);
      const stored=(await client.execute("SELECT value FROM settings WHERE key='onboarding_whatsapp_token'")).rows[0].value;assert.notEqual(stored,'secret-whatsapp');
      const response=await call('GET','/admin/onboarding/settings',undefined,'admin');const body=await response.text();assert.equal(body.includes('secret-whatsapp'),false);assert.equal(body.includes('secret-sms'),false);
      const denied=await call('PUT','/admin/onboarding/settings',data,'agent');assert.equal(denied.status,403);
    });
    await t.test('disabling an agent immediately removes their access',async()=>{
      await client.execute("UPDATE sales_agents SET enabled=0 WHERE user_id='agent'");assert.equal((await call('GET','/sales/onboarding')).status,403);
    });
  }finally{globalThis.fetch=realFetch;process.env=environment;setD1Binding(undefined);resetSchemaCache();client.close();}
});
