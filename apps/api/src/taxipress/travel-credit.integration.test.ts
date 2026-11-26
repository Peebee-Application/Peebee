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
import {orderRoutes} from '../orders/routes.js';
import {relayRoutes} from '../relay/routes.js';
import {publicTaxipressRoutes,taxipressRoutes} from './routes.js';
import {kampalaDate} from './returns.js';
import {travelCreditRoutes} from '../travel-credit/routes.js';
import {reconcilePayment} from '../payments/reconciliation.js';
import {refundToWallet} from '../wallet/service.js';

test('corporate receivables and wallet-backed travel vouchers settle and refund their actual sources',async t=>{
  const client=createClient({url:'file::memory:'}),oldSecret=process.env.JWT_SECRET;
  process.env.JWT_SECRET='return-package-test-only';
  for(const f of readdirSync('src/db/migrations').filter(f=>f.endsWith('.sql')).sort()) for(const sql of splitSqlStatements(readFileSync('src/db/migrations/'+f,'utf8'))) await client.execute(sql);
  const prepare=(sql:string)=>({sql,args:[] as unknown[],bind(...args:unknown[]){this.args=args;return this;},async all(){const r=await client.execute({sql:this.sql,args:this.args as InArgs});return {results:r.rows,success:true,meta:{changes:r.rowsAffected,last_row_id:Number(r.lastInsertRowid??0)}};}});
  setD1Binding({prepare,async batch(s:ReturnType<typeof prepare>[]){return (await client.batch(s.map(x=>({sql:x.sql,args:x.args as InArgs})),'write')).map(r=>({results:r.rows,success:true,meta:{changes:r.rowsAffected,last_row_id:Number(r.lastInsertRowid??0)}}));}} as unknown as D1Database);resetSchemaCache();
  try{
    const tokens:Record<string,string>={};
    for(const id of ['staff','d1','d2','d3','a','b']){
      const role=id==='staff'?'admin':'customer';
      await client.execute({sql:"INSERT INTO users(id,name,phone,password_hash,role,admin_role) VALUES(?,?,?,'hash',?,?)",args:[id,id,id,role,id==='staff'?'super_admin':null]});
      tokens[id]=await signToken({sub:id,role} as never);
    }
    await client.execute("INSERT INTO personal_wallets (user_id) SELECT id FROM users WHERE role='customer'");
    const app=new Hono().route('/v1',publicTaxipressRoutes).route('/v1',orderRoutes).route('/v1',relayRoutes).route('/v1',taxipressRoutes).route('/v1',travelCreditRoutes);
    const call=(who:string,path:string,body?:object,method=body?'POST':'GET')=>app.request('/v1/'+path,{method,headers:{...(tokens[who]?{Authorization:`Bearer ${tokens[who]}`}:{}) ,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const json=async(r:Response)=>await r.json() as any;
    await setSetting('taxipress_enabled','1');await setSetting('taxipress_return_packages_enabled','1');await setSetting('taxipress_return_discount_percent','10');await setSetting('taxipress_stage_radius_m','0');await setSetting('taxipress_departure_rule','driver_choice');
    const relay=await json(await call('staff','admin/relay/routes',{name:'Return route',stageAName:'Stage A',stageALat:0,stageALng:32,stageBName:'Stage B',stageBLat:1,stageBLng:32,parcelFare:5000}));
    const outRoute=await json(await call('staff','admin/taxipress/routes',{relayRouteId:relay.id,direction:'a_to_b',farePerSeat:5000,active:true}));
    const backRoute=await json(await call('staff','admin/taxipress/routes',{relayRouteId:relay.id,direction:'b_to_a',farePerSeat:6000,active:true}));
    for(const who of ['d1','d2']) assert.equal((await call(who,'taxipress/taxi/apply',{relayRouteId:relay.id,plate:'UBM '+who+'00',seatLayout:'14'})).status,201);
    for(const taxi of (await json(await call('staff','admin/taxipress/taxis'))).taxis) await call('staff',`admin/taxipress/taxis/${taxi.id}`,{status:'approved'});
    let qOut=(await json(await call('d1','taxipress/driver/join',{routeId:outRoute.id}))).entry.id;
    const qBack=(await json(await call('d2','taxipress/driver/join',{routeId:backRoute.id}))).entry.id;
    const quote=async(who='a',extra={})=>{
      const r=await call(who,'taxipress/return-quotes',{queueId:qOut,adults:1,children:0,mode:'open',...extra});
      assert.equal(r.status,201,JSON.stringify(await r.clone().json()));return (await json(r)).package;
    };
    const create=async(id:string,who='a')=>{const r=await call(who,'taxipress/return-packages',{quoteId:id});assert.equal(r.status,201,JSON.stringify(await r.clone().json()));return (await json(r)).package;};
    const view=async(id:string,who='a')=>(await json(await call(who,`taxipress/return-packages/${id}`))).package;
    const fund=async(p:any,who='a')=>call(who,`orders/${p.orderId}/fund`,{paymentMethod:'wallet',useWallet:true,acceptedAmount:p.checkout.wallet});
    const balance=async()=>Number((await client.execute("SELECT wallet_balance FROM users WHERE id = 'a'")).rows[0].wallet_balance);
    await client.execute("UPDATE users SET email=id||'@example.test',wallet_balance=100000");
    const accountResponse=await call('staff','admin/travel-credit/accounts',{name:'Approved employer',owner:'b@example.test',creditLimit:20000});assert.equal(accountResponse.status,201);
    const accountId=(await json(accountResponse)).id;
    const source={accountId};
    const seat=async()=>{const r=await call('a','taxipress/bookings',{queueId:qOut,adults:1});assert.equal(r.status,201,JSON.stringify(await r.clone().json()));return (await json(r)).booking;};
    const price=(orderId:string,s=source)=>call('a',`travel-credit/orders/${orderId}/quote`,s);
    const pay=async(orderId:string,s:object,total:number)=>{const q=await json(await call('a',`travel-credit/orders/${orderId}/quote`,s));return call('a',`travel-credit/orders/${orderId}/fund`,{...s,acceptedAmount:total,acceptedSponsored:q.sponsored??total});};
    const account=async()=>(await json(await call('b',`travel-credit/accounts/${accountId}`))).account;
    const enable=async()=>{assert.equal((await call('staff','admin/travel-credit/settings',{corporateEnabled:true,vouchersEnabled:true,voucherMax:100000,voucherDays:30},'PUT')).status,200);await call('staff',`admin/travel-credit/accounts/${accountId}`,{active:true,creditLimit:20000},'PUT');await call('staff',`admin/travel-credit/accounts/${accountId}/members`,{customer:'a@example.test',active:true,perBooking:20000,monthlyLimit:100000},'PUT');};
    await t.test('staff approval, membership, switches and statement ownership are enforced',async()=>{
      const b=await seat();assert.equal((await price(b.orderId)).status,409);
      assert.equal((await call('a','admin/travel-credit')).status,403);
      assert.equal((await call('', 'travel-credit/me')).status,401);
      await enable();assert.equal((await price(b.orderId)).status,200);
      const employee=(await json(await call('a','travel-credit/me'))).accounts[0];
      assert.equal('outstanding' in employee,false);assert.equal('credit_limit' in employee,false);assert.equal(employee.available,20000);
      assert.equal((await call('b',`travel-credit/orders/${b.orderId}/quote`,source)).status,404);
      assert.equal((await call('a',`travel-credit/accounts/${accountId}`)).status,404);
      await call('a',`taxipress/bookings/${b.id}/cancel`,{});
    });
    await t.test('one corporate authorization funds a return bundle without taking the traveller wallet',async()=>{
      const p=await create((await quote()).id),before=await balance();
      assert.equal((await price(p.orderId)).status,200);
      const paid=await Promise.all([pay(p.orderId,source,9900),pay(p.orderId,source,9900)]);
      assert.deepEqual(paid.map(r=>r.status).sort(),[200,409]);assert.equal(await balance(),before);
      assert.equal(Number((await account()).outstanding),9900);
      const v=await view(p.id);assert.equal(v.returnPaid,5400);assert.equal(v.outboundPaid,4500);
      assert.equal((await call('a',`taxipress/return-packages/${p.id}/cancel-return`,{})).status,200);
      assert.equal(Number((await account()).outstanding),4500);assert.equal(await balance(),before);
      const repayment={amount:3500,requestId:'repay-test-one'};
      assert.equal((await call('b',`travel-credit/accounts/${accountId}/repay`,repayment)).status,200);
      assert.equal((await call('b',`travel-credit/accounts/${accountId}/repay`,repayment)).status,200);
      assert.equal(Number((await client.execute("SELECT wallet_balance FROM users WHERE id='b'")).rows[0].wallet_balance),96500);
      assert.equal((await call('a',`taxipress/bookings/${p.outboundBookingId}/cancel`,{})).status,200);
      assert.equal(Number((await account()).outstanding),-3500,'Refund after repayment stays as company credit, never traveller cash');
      assert.equal(await balance(),before);
    });
    await t.test('per-booking limits cover both legs and racing charges cannot exceed account credit',async()=>{
      const p=await create((await quote()).id);
      await call('staff',`admin/travel-credit/accounts/${accountId}/members`,{customer:'a@example.test',active:true,perBooking:6000,monthlyLimit:100000},'PUT');
      assert.equal((await price(p.orderId)).status,409);await call('a',`taxipress/bookings/${p.outboundBookingId}/cancel`,{});
      await call('staff',`admin/travel-credit/accounts/${accountId}`,{active:true,creditLimit:6000},'PUT');
      const a=await seat(),b=await seat();const results=await Promise.all([pay(a.orderId,source,5000),pay(b.orderId,source,5000)]);
      assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.ok(Number((await account()).outstanding)<=6000);
      await call('a',`taxipress/bookings/${a.id}/cancel`,{});await call('a',`taxipress/bookings/${b.id}/cancel`,{});
    });
    const voucher=async(amount:number,key=crypto.randomUUID())=>{const r=await call('b','travel-credit/vouchers',{recipient:'a@example.test',amount,requestId:key});assert.equal(r.status,201,JSON.stringify(await r.clone().json()));return await json(r);};
    const voucherBalance=async(id:string)=>Number((await client.execute({sql:'SELECT balance FROM travel_vouchers WHERE id=?',args:[id]})).rows[0].balance);
    await t.test('vouchers hold actual issuer funds, are named, idempotent and pay a wallet remainder atomically',async()=>{
      const before=await balance(),ownerBefore=Number((await client.execute("SELECT wallet_balance FROM users WHERE id='b'")).rows[0].wallet_balance);
      const key=crypto.randomUUID(),v=await voucher(3000,key);assert.equal((await voucher(3000,key)).id,v.id);
      assert.equal(Number((await client.execute("SELECT wallet_balance FROM users WHERE id='b'")).rows[0].wallet_balance),ownerBefore-3000);
      const b=await seat();assert.equal((await call('b',`travel-credit/orders/${b.orderId}/quote`,{voucherCode:v.code})).status,404);
      await client.execute("UPDATE users SET primary_wallet_frozen_at=datetime('now') WHERE id='a'");
      assert.equal((await pay(b.orderId,{voucherId:v.id},5000)).status,409);assert.equal(await voucherBalance(v.id),3000);assert.equal(await balance(),before);
      await client.execute("UPDATE users SET primary_wallet_frozen_at=NULL WHERE id='a'");
      assert.equal((await pay(b.orderId,{voucherCode:v.code},5000)).status,200);assert.equal(await balance(),before-2000);assert.equal(await voucherBalance(v.id),0);
      await call('a',`taxipress/bookings/${b.id}/cancel`,{});assert.equal(await balance(),before);assert.equal(await voucherBalance(v.id),3000);
      await call('b',`travel-credit/vouchers/${v.id}/cancel`,{});await call('b',`travel-credit/vouchers/${v.id}/cancel`,{});
      assert.equal(Number((await client.execute("SELECT wallet_balance FROM users WHERE id='b'")).rows[0].wallet_balance),ownerBefore);
    });
    await t.test('return refunds split voucher and cash allocations and late refunds return to the original issuer',async()=>{
      const before=await balance(),v=await voucher(5000),p=await create((await quote()).id);
      assert.equal((await pay(p.orderId,{voucherId:v.id},9900)).status,200);assert.equal(await balance(),before-4900);
      await call('a',`taxipress/return-packages/${p.id}/cancel-return`,{});
      assert.equal(await balance(),before);assert.equal(await voucherBalance(v.id),500);
      await call('b',`travel-credit/vouchers/${v.id}/cancel`,{});
      const ownerBefore=Number((await client.execute("SELECT wallet_balance FROM users WHERE id='b'")).rows[0].wallet_balance);
      await call('a',`taxipress/bookings/${p.outboundBookingId}/cancel`,{});
      assert.equal(await balance(),before);assert.equal(await voucherBalance(v.id),0);
      assert.equal(Number((await client.execute("SELECT wallet_balance FROM users WHERE id='b'")).rows[0].wallet_balance),ownerBefore+4500);
    });
    await t.test('boarding settles the full fare to the driver with normal commission, not a fictional discount',async()=>{
      await enable();const b=await seat();assert.equal((await pay(b.orderId,source,5000)).status,200);
      await call('d1','taxipress/driver/boarding',{});const r=await call('d1','taxipress/driver/board',{code:b.ticketCode});assert.equal(r.status,200,JSON.stringify(await r.clone().json()));
      const settlement=(await client.execute({sql:'SELECT fare,driver_amount,commission FROM taxipress_settlements WHERE booking_id=?',args:[b.id]})).rows[0];
      assert.equal(Number(settlement.fare),5000);assert.equal(Number(settlement.driver_amount)+Number(settlement.commission),5000);
    });
    await t.test('shared parcel/hire cancellation restores sources once without the old wallet refund duplicating them',async()=>{
      for(const isRide of [0,1]){
        const id=`travel-shared-${isRide}`,listId=`travel-shared-list-${isRide}`;
        await client.execute({sql:"INSERT INTO lists(id,customer_id,title,status) VALUES(?,'a','Transport','active')",args:[listId]});
        await client.execute({sql:"INSERT INTO orders(id,list_id,customer_id,rider_id,type,stage,payment_rail,estimated_total,delivery_fee,is_ride) VALUES(?,?,'a','d3','parcel','Match','escrow',6000,6000,?)",args:[id,listId,isRide]});
        const before=await balance(),outstanding=Number((await account()).outstanding);
        assert.equal((await pay(id,source,6000)).status,200);
        assert.equal((await call('a',`orders/${id}/customer-cancel`,{acceptedFee:0})).status,200);
        assert.equal(await balance(),before);assert.equal(Number((await account()).outstanding),outstanding);
        assert.equal((await client.execute({sql:"SELECT COUNT(*) n FROM payments WHERE order_id=? AND type='refund'",args:[id]})).rows[0].n,1);
      }
    });
    await t.test('a changed voucher split is rejected and expiry restores only the issuer once',async()=>{
      const v=await voucher(3000),before=Number((await client.execute("SELECT wallet_balance FROM users WHERE id='b'")).rows[0].wallet_balance);
      const id='travel-stale',listId='travel-stale-list';await client.execute({sql:"INSERT INTO lists(id,customer_id,title,status) VALUES(?,'a','Transport','active')",args:[listId]});
      await client.execute({sql:"INSERT INTO orders(id,list_id,customer_id,rider_id,type,stage,estimated_total,delivery_fee) VALUES(?,?,'a','d3','parcel','Match',5000,5000)",args:[id,listId]});
      assert.equal((await call('a',`travel-credit/orders/${id}/fund`,{voucherId:v.id,acceptedAmount:5000,acceptedSponsored:2000})).status,409);
      assert.equal(await voucherBalance(v.id),3000);
      await client.execute({sql:"UPDATE travel_vouchers SET expires_at=datetime('now','-1 second') WHERE id=?",args:[v.id]});
      await call('a','travel-credit/me');await call('b','travel-credit/me');assert.equal(await voucherBalance(v.id),0);
      assert.equal(Number((await client.execute("SELECT wallet_balance FROM users WHERE id='b'")).rows[0].wallet_balance),before+3000);
    });
    await t.test('sandbox vouchers never spend live money and live account statements stay outside sandbox',async()=>{
      const live=Number((await client.execute("SELECT wallet_balance FROM users WHERE id='b'")).rows[0].wallet_balance);
      await client.execute("UPDATE users SET wallet_balance_sandbox=10000 WHERE id='b'");await setSetting('platform_environment','sandbox');
      assert.equal((await call('b',`travel-credit/accounts/${accountId}`)).status,404);
      assert.equal((await json(await call('a','travel-credit/me'))).accounts.length,0);
      const v=await voucher(3000);assert.equal(Number((await client.execute("SELECT wallet_balance_sandbox FROM users WHERE id='b'")).rows[0].wallet_balance_sandbox),7000);
      assert.equal(Number((await client.execute("SELECT wallet_balance FROM users WHERE id='b'")).rows[0].wallet_balance),live);
      await call('b',`travel-credit/vouchers/${v.id}/cancel`,{});assert.equal(Number((await client.execute("SELECT wallet_balance_sandbox FROM users WHERE id='b'")).rows[0].wallet_balance_sandbox),10000);
      await setSetting('platform_environment','live');
      await call('staff',`admin/travel-credit/accounts/${accountId}/members`,{customer:'a@example.test',active:false,perBooking:20000,monthlyLimit:100000},'PUT');
      const id='travel-stale';assert.equal((await price(id)).status,404,'A revoked traveller cannot use an approved account');
    });
  }finally{setD1Binding(undefined);resetSchemaCache();client.close();if(oldSecret==null)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;}
});

test('before migration 0170 the new methods stay off and legacy checkout/refunds remain usable',async()=>{
 const client=createClient({url:'file::memory:'}),oldSecret=process.env.JWT_SECRET;process.env.JWT_SECRET='pre-credit-migration-test';
 for(const f of readdirSync('src/db/migrations').filter(f=>f.endsWith('.sql')&&!f.startsWith('0170_')).sort())for(const sql of splitSqlStatements(readFileSync('src/db/migrations/'+f,'utf8')))await client.execute(sql);
 const prepare=(sql:string)=>({sql,args:[] as unknown[],bind(...args:unknown[]){this.args=args;return this;},async all(){const r=await client.execute({sql:this.sql,args:this.args as InArgs});return {results:r.rows,success:true,meta:{changes:r.rowsAffected,last_row_id:Number(r.lastInsertRowid??0)}};}});
 setD1Binding({prepare,async batch(s:ReturnType<typeof prepare>[]){return(await client.batch(s.map(x=>({sql:x.sql,args:x.args as InArgs})),'write')).map(r=>({results:r.rows,success:true,meta:{changes:r.rowsAffected,last_row_id:Number(r.lastInsertRowid??0)}}));}} as unknown as D1Database);resetSchemaCache();
 try{
  await client.execute("INSERT INTO users(id,name,phone,password_hash,role) VALUES('a','A','a','hash','customer')");
  await client.execute("INSERT INTO lists(id,customer_id,title,status) VALUES('old-list','a','Existing','active')");
  await client.execute("INSERT INTO orders(id,list_id,customer_id,type,stage,estimated_total) VALUES('old-order','old-list','a','parcel','Match',5000)");
  const token=await signToken({sub:'a',role:'customer'} as never),app=new Hono().route('/v1',orderRoutes).route('/v1',travelCreditRoutes),headers={Authorization:`Bearer ${token}`};
  const result=await app.request('/v1/travel-credit/me',{headers});assert.equal(result.status,200);const overview=await result.json() as any;assert.equal(overview.ready,false);assert.equal(overview.corporateEnabled,false);assert.deepEqual(overview.vouchers,[]);
  assert.equal((await app.request('/v1/orders/old-order/checkout',{headers})).status,200);
  await refundToWallet('a',500,{orderId:'old-order',environment:'live'});
  assert.equal(Number((await client.execute("SELECT wallet_balance FROM users WHERE id='a'")).rows[0].wallet_balance),500);
 }finally{setD1Binding(undefined);resetSchemaCache();client.close();if(oldSecret==null)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;}
});
