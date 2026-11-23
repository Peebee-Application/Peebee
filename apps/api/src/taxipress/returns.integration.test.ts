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
import {reconcilePayment} from '../payments/reconciliation.js';

test('prepaid returns: one payment, two entitlements, redemption and partial refunds',async t=>{
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
    const app=new Hono().route('/v1',publicTaxipressRoutes).route('/v1',orderRoutes).route('/v1',relayRoutes).route('/v1',taxipressRoutes);
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
    let first:any;
    await t.test('quote uses both real direction fares and admin discount, never client prices',async()=>{
      first=await quote('a',{amount:1,discountPercent:100});
      assert.equal(first.outboundAmount,4500);assert.equal(first.returnAmount,5400);assert.equal(first.total,9900);
      assert.equal(first.returnRouteId,backRoute.id);
      assert.equal((await call('','taxipress/return-quotes',{queueId:qOut,adults:1,mode:'open'})).status,401);
      assert.equal((await call('b',`taxipress/return-packages/${first.id}`)).status,404);
      assert.equal((await call('b','taxipress/return-packages',{quoteId:first.id})).status,404);
    });
    await t.test('creation is idempotent and publishes both allocations with a single outbound booking',async()=>{
      first=await create(first.id);const again=await create(first.id);
      assert.equal(again.outboundBookingId,first.outboundBookingId);
      assert.equal((await client.execute('SELECT COUNT(*) AS n FROM taxipress_bookings')).rows[0].n,1);
      const back=(await client.execute({sql:'SELECT o.* FROM orders o JOIN taxipress_return_packages p ON p.return_order_id=o.id WHERE p.id=?',args:[first.id]})).rows[0];
      assert.equal(back.stage,'Return');assert.equal(back.rider_id,null);
      assert.equal((await call('a',`orders/${back.id}/fund`,{paymentMethod:'wallet',useWallet:true})).status,409);
      assert.equal((await call('a',`orders/${first.orderId}/fund`,{paymentMethod:'cash'})).status,409);
      assert.equal((await call('a',`orders/${first.orderId}/fund`,{paymentMethod:'wallet',useWallet:true,offerCode:'STACK'})).status,409);
    });
    await t.test('insufficient funds leave neither leg part-paid; retry charges each allocation exactly once',async()=>{
      assert.equal((await fund(first)).status,409);assert.equal((await balance()),0);
      await client.execute("UPDATE users SET wallet_balance=100000 WHERE id='a'");
      assert.equal((await fund(first)).status,200);
      assert.equal(await balance(),100000-first.checkout.wallet);
      assert.equal((await fund(first)).status,409);
      const paid=await view(first.id);assert.equal(paid.outboundPaid,4500);assert.equal(paid.returnPaid,5400);
      assert.equal((await call('a',`taxipress/return-packages/${first.id}/redeem`,{queueId:qBack})).status,409,'Outbound must board before return use');
    });
    await t.test('outbound boarding settles only its allocation; concurrent return redemption yields one booking',async()=>{
      const b=(await json(await call('a',`taxipress/bookings/${first.outboundBookingId}`))).booking;
      assert.equal(b.amount,4500);assert.equal(b.paymentStatus,'paid');
      await call('d1','taxipress/driver/boarding',{});
      const boarded=await call('d1','taxipress/driver/board',{code:b.ticketCode});assert.equal(boarded.status,200,JSON.stringify(await boarded.clone().json()));
      assert.equal((await client.execute({sql:'SELECT fare FROM taxipress_settlements WHERE booking_id=?',args:[b.id]})).rows[0].fare,4500);
      assert.equal((await call('a',`taxipress/return-packages/${first.id}/redeem`,{queueId:qOut})).status,409);
      const rs=await Promise.all([call('a',`taxipress/return-packages/${first.id}/redeem`,{queueId:qBack}),call('a',`taxipress/return-packages/${first.id}/redeem`,{queueId:qBack})]);
      assert.ok(rs.some(r=>r.status===200));
      const used=await view(first.id);assert.equal(used.returnState,'redeemed');assert.ok(used.returnBookingId);
      const ret=(await json(await call('a',`taxipress/bookings/${used.returnBookingId}`))).booking;
      assert.equal(ret.amount,5400);assert.equal(ret.paymentStatus,'paid');assert.equal(ret.returnPackage.id,first.id);
      assert.equal((await client.execute({sql:'SELECT COUNT(*) AS n FROM taxipress_bookings WHERE return_package_id=? AND return_leg=\'return\'',args:[first.id]})).rows[0].n,1);
      assert.equal(await balance(),100000-first.checkout.wallet,'Redemption must not charge again');
      assert.equal((await call('a',`taxipress/bookings/${ret.id}/cancel`,{})).status,200);
      assert.equal(await balance(),100000-first.checkout.wallet+5400,'Cancelling the unused redeemed return refunds only that leg');
      await call('d1','taxipress/driver/on-road',{});await call('d1','taxipress/driver/arrive',{});
      qOut=(await json(await call('d1','taxipress/driver/join',{routeId:outRoute.id}))).entry.id;
    });
    await t.test('unused-return cancellation is atomic and idempotent, preserving outbound payment',async()=>{
      const p=await create((await quote()).id);assert.equal((await fund(p)).status,200);
      const before=await balance();
      const rs=await Promise.all([call('a',`taxipress/return-packages/${p.id}/cancel-return`,{}),call('a',`taxipress/return-packages/${p.id}/cancel-return`,{})]);
      assert.ok(rs.every(r=>r.status===200));assert.equal(await balance(),before+5400);
      const ended=await view(p.id);assert.equal(ended.refunded,5400);assert.equal(ended.outboundPaid,4500);
    });
    await t.test('date conditions reject past/outside dates and allow a valid change without extending expiry',async()=>{
      assert.equal((await call('a','taxipress/return-quotes',{queueId:qOut,adults:1,mode:'date-specific',date:'2020-01-01'})).status,400);
      const p=await create((await quote()).id);
      const changed=await call('a',`taxipress/return-packages/${p.id}/date`,{mode:'date-specific',date:kampalaDate()},'PUT');
      assert.equal(changed.status,200);assert.equal((await json(changed)).package.returnDate,kampalaDate());
      assert.equal((await call('b',`taxipress/return-packages/${p.id}/date`,{mode:'open'},'PUT')).status,404);
    });
    await t.test('expiry refunds the unused return allocation once and never restores eligibility',async()=>{
      const p=await create((await quote()).id);assert.equal((await fund(p)).status,200);const before=await balance();
      await client.execute({sql:"UPDATE taxipress_return_packages SET valid_until=datetime('now','-1 second') WHERE id=?",args:[p.id]});
      await call('a','taxipress/return-packages');await call('a','taxipress/return-packages');
      const expired=await view(p.id);assert.equal(expired.returnState,'expired');assert.equal(await balance(),before+5400);
    });
    await t.test('abandoned redemption leases recover without losing the entitlement',async()=>{
      const p=await create((await quote()).id);assert.equal((await fund(p)).status,200);
      await client.execute({sql:"UPDATE taxipress_return_packages SET return_state='redeeming',redeem_token='abandoned',redeem_until=datetime('now','-1 second') WHERE id=?",args:[p.id]});
      await call('a','taxipress/return-packages');
      assert.equal((await view(p.id)).returnState,'pending');
      await call('a',`taxipress/bookings/${p.outboundBookingId}/cancel`,{});
    });
    await t.test('a database failure rolls back the whole wallet debit and both allocations, then allows retry',async()=>{
      const p=await create((await quote()).id),before=await balance();
      const back=(await client.execute({sql:'SELECT return_order_id FROM taxipress_return_packages WHERE id=?',args:[p.id]})).rows[0].return_order_id;
      await client.execute(`CREATE TRIGGER fail_return_payment BEFORE INSERT ON payments WHEN NEW.order_id = '${back}' AND NEW.type = 'collection' BEGIN SELECT RAISE(ABORT,'injected payment failure'); END`);
      assert.equal((await fund(p)).status,503);assert.equal(await balance(),before);
      assert.equal((await client.execute({sql:"SELECT COUNT(*) n FROM payments WHERE order_id IN (?,?)",args:[p.orderId,String(back)]})).rows[0].n,0);
      await client.execute('DROP TRIGGER fail_return_payment');
      assert.equal((await fund(p)).status,200);assert.equal(await balance(),before-p.checkout.wallet);
      await call('a',`taxipress/bookings/${p.outboundBookingId}/cancel`,{});
    });
    await t.test('one provider request funds both allocations; pending collection blocks cancellation atomically',async()=>{
      // Sandbox uses the existing provider adapter. No external money is moved.
      await setSetting('platform_environment','sandbox');
      const p=await create((await quote()).id);
      const res=await call('a',`orders/${p.orderId}/fund`,{paymentMethod:'mobile_money',msisdn:'256772123456',acceptedAmount:p.checkout.mobileMoney});
      assert.equal(res.status,200,JSON.stringify(await res.clone().json()));const {payment}=await json(res);
      const op=(await client.execute({sql:"SELECT amount FROM provider_operations WHERE business_id=?",args:[payment.id]})).rows;
      assert.equal(op.length,1);assert.equal(op[0].amount,p.checkout.mobileMoney);
      assert.equal((await call('a',`taxipress/bookings/${p.outboundBookingId}/cancel`,{})).status,409);
      assert.equal((await client.execute({sql:'SELECT status FROM taxipress_bookings WHERE id=?',args:[p.outboundBookingId]})).rows[0].status,'booked');
      let ref='';for(let i=0;i<1000;i++){const s=`return-test-${i}`;let h=0;for(const ch of s)h=(h*31+ch.charCodeAt(0))>>>0;if(h%100>=8){ref=s;break;}}
      await client.execute({sql:"UPDATE payments SET provider_ref=?,created_at=datetime('now','-1 hour') WHERE id=?",args:[ref,payment.id]});
      assert.equal(await reconcilePayment(payment.id,'test'),'successful');
      const paid=await view(p.id);assert.equal(paid.outboundPaid,4500);assert.equal(paid.returnPaid,5400);
      assert.equal((await client.execute({sql:'SELECT stage FROM orders WHERE id=(SELECT return_order_id FROM taxipress_return_packages WHERE id=?)',args:[p.id]})).rows[0].stage,'Return');
      assert.equal((await call('a',`taxipress/bookings/${p.outboundBookingId}/cancel`,{})).status,200);
      assert.equal((await view(p.id)).returnState,'cancelled');
      await setSetting('platform_environment','live');
    });
    await t.test('refund policy is snapshotted and only applies to the unused allocation',async()=>{
      await setSetting('taxipress_return_refund_percent','50');
      const p=await create((await quote()).id);assert.equal((await fund(p)).status,200);const before=await balance();
      await setSetting('taxipress_return_refund_percent','100');
      assert.equal((await call('a',`taxipress/return-packages/${p.id}/cancel-return`,{})).status,200);
      assert.equal(await balance(),before+2700);assert.equal((await view(p.id)).outboundPaid,4500);
      await call('a',`taxipress/bookings/${p.outboundBookingId}/cancel`,{});
    });
    await t.test('a numbered outbound hold is consumed once and its choice fee is charged only outbound',async()=>{
      await setSetting('taxipress_numbered_seats_enabled','1');await setSetting('taxipress_seat_choice_fee_ugx','500');
      await call('d3','taxipress/taxi/apply',{relayRouteId:relay.id,plate:'UBM d300',seatLayout:'14'});
      const taxi=(await json(await call('staff','admin/taxipress/taxis'))).taxis.find((x:any)=>x.userId==='d3');
      assert.ok(taxi);
      await call('staff',`admin/taxipress/taxis/${taxi.id}`,{status:'approved',numberedSeatsEnabled:true});
      const q=(await json(await call('d3','taxipress/driver/join',{routeId:outRoute.id}))).entry.id;
      const hold=(await json(await call('a',`taxipress/queue/${q}/seat-holds`,{seats:['1A']}))).hold;
      const p=await create((await quote('a',{queueId:q,seatHoldId:hold.id})).id);
      assert.equal(p.outboundAmount,5000);assert.equal(p.returnAmount,5400);
      const b=(await json(await call('a',`taxipress/bookings/${p.outboundBookingId}`))).booking;
      assert.deepEqual(b.seatNumbers,['1A']);assert.equal(b.seatChoiceFee,500);
      assert.equal((await fund(p)).status,200);
      await call('a',`taxipress/bookings/${p.outboundBookingId}/cancel`,{});
      await setSetting('taxipress_numbered_seats_enabled','0');
    });
    await t.test('switch off prevents new package sales, while existing entitlements remain visible',async()=>{
      await setSetting('taxipress_return_packages_enabled','0');
      assert.equal((await call('a','taxipress/return-quotes',{queueId:qOut,adults:1,mode:'open'})).status,409);
      assert.ok((await json(await call('a','taxipress/return-packages'))).packages.length);
    });
  }finally{setD1Binding(undefined);resetSchemaCache();client.close();if(oldSecret==null)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;}
});
