import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const base=process.env.TAXIBEE_TEST_URL||'http://localhost:3015';
const evidence=process.env.TAXIBEE_EVIDENCE||'/tmp/taxibee-evidence';await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox']});
try{
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[],writes=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('https://accounts.google.com/gsi/client',r=>r.fulfill({contentType:'application/javascript',body:'window.google={accounts:{id:{initialize(){},renderButton(){}}}};'}));
 const user={id:'service-customer',role:'customer',name:'Service Customer',phone:'+256772111222',email:'service@example.test'};
 const catalog={parcelEnabled:true,relayEnabled:true,charterEnabled:true,onDemandEnabled:true,maxHireHours:72,scheduled:{minLeadMinutes:30,maxAdvanceHours:168},tracking:{enabled:true,pollAfterSeconds:300,staleAfterSeconds:60},
 routes:[{id:'r1',name:'Kampala - Entebbe',stage_a_name:'Kampala Stage',stage_a_lat:0.3,stage_a_lng:32.58,stage_b_name:'Entebbe Stage',stage_b_lat:0.05,stage_b_lng:32.46}],categories:[{id:'luxury-real',name:'Approved luxury',seats:4,service_group:'luxury',rate_per_hour:5000}]};
 const quotes={boda:{fee:18000,distanceKm:35},relay:{direction:'KLA - EBB',total:12000,collectTotal:9000,dropMode:'station',choiceAtOrder:false,station:{name:'Real Station'},meetStages:[],legs:[{kind:'boda',fromName:'Pickup',toName:'Kampala Stage'},{kind:'matatu',fromName:'Kampala Stage',toName:'Real Station'}]}};
 const orders=[],payments=new Map(),items=new Map();let listNo=0,parcelCreated=0,charterCreated=0,postedPhoto=false,chat='',pending=false,interruptCreation=false,delayed=null,release=null;
 await page.route('**/api/v1/**',async r=>{
  const request=r.request(),path=new URL(request.url()).pathname.replace('/api',''),method=request.method();let data={},status=200,body;
  if(method!=='GET'){if(request.headers()['content-type']?.includes('application/json'))body=request.postDataJSON();writes.push({path,body,method});}
  if(path==='/v1/auth/config')data={googleClientId:null};
  else if(path==='/v1/auth/me')data={user};
  else if(path==='/v1/auth/login')data={user,token:'service-test-token'};
  else if(path==='/v1/auth/logout')data={ok:true};
  else if(path.includes('/taxipress')&&path.endsWith('/config'))data={enabled:false,routes:[],luggageTypes:[],languages:[]};
  else if(path==='/v1/taxipress/bookings/mine')data={bookings:[]};
  else if(path==='/v1/wallet')data={balance:100000,ledger:[]};
  else if(path==='/v1/taxibee-services/catalog')data=catalog;
  else if(path==='/v1/taxibee-services/parcel-quote')data=quotes;
  else if(path==='/v1/taxibee-services/charter-quote')data={fare:35000,distanceKm:35};
  else if(path==='/v1/taxibee-services/orders')data={orders:orders.map(o=>({...o,service:o.is_ride?'charter':'parcel'}))};
  else if(path==='/v1/lists'){const id='parcel-list-'+ ++listNo;items.set(id,body.items);data={listId:id};status=201;}
  else if(path==='/v1/orders'||path==='/v1/car/bookings'){
    const car=path.includes('car'),id=car?'charter-order':parcelCreated?'parcel-order-2':'parcel-order';car?charterCreated++:parcelCreated++;
    const o={id,list_id:body.listId||'hire-list',stage:'Match',is_ride:car?1:0,rider_id:null,rider_name:null,estimated_total:car?35000:9000,pin_code:car?null:'4321',pickup_address:body.pickupAddress,destination_address:body.destinationAddress,created_at:new Date().toISOString()};orders.push(o);data={order:o};status=201;if(interruptCreation){interruptCreation=false;status=503;data={message:'Booking response interrupted; check history.'};}
  }
  else if(path.match(/^\/v1\/orders\/(parcel-order(?:-2)?|charter-order)$/)){
    const o=orders.find(o=>path.endsWith(o.id));if(delayed){delayed();await new Promise(resolve=>{release=resolve;});}
    data={order:o,items:items.get(o.list_id)||[],events:[{stage:o.stage,note:'REAL PRIVATE SERVICE STATUS',created_at:'now'}],payments:payments.get(o.id)||[],relay:o.is_ride?null:{station:{name:'Real Station'},heldAt:'now',releasedAt:null,collectCode:'SERVER-COLLECT-123',legs:[{kind:'matatu',fromName:'Kampala Stage',toName:'Real Station',status:'arrived',vehiclePlate:'UBA 123A'}]}};
  }
  else if(path.endsWith('/checkout')){const id=path.split('/')[3],car=id==='charter-order';data={wallet:car?35000:9000,mobileMoney:car?36500:9500,payBeforeRider:true};}
  else if(path.endsWith('/fund')){const id=path.split('/')[3];payments.set(id,[{type:'collection',status:pending?'pending':'successful'}]);data={payment:{id:'provider-collection',status:pending?'pending':'successful'}};}
  else if(path.endsWith('/applicants'))data={applicants:[]};
  else if(path.endsWith('/photos')&&method==='POST'){postedPhoto=true;data={photos:[{id:'photo',note:'Actual parcel photo'}]};}
  else if(path.endsWith('/photos'))data={photos:postedPhoto?[{id:'photo',note:'Actual parcel photo'}]:[],available:true};
  else if(path.endsWith('/photos/photo')){await r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGncAAAAASUVORK5CYII=','base64')});return;}
  else if(path.endsWith('/chat')&&method==='POST'){chat=body.body;data={id:'message'};}
  else if(path.endsWith('/chat'))data={messages:chat?[{body:chat}]:[]};
  else if(path.endsWith('/chat/read'))data={ok:true};
  else if(path==='/v1/car/bookings/charter-order/info')data={car:true,categoryName:'Approved luxury',scheduledFor:'2026-11-25 10:00:00',plate:'UBB 999A',vehicleName:'Assigned server vehicle'};
  else if(path.endsWith('/customer-cancel')){orders.find(o=>path.includes(o.id)).stage='Cancelled';data={ok:true};}
  else{status=404;data={message:'Unexpected fixture request: '+path};}
  await r.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto(base);await page.waitForSelector('.home-redesign');await page.evaluate(()=>window.navigate('parcel'));
 await page.waitForSelector('#svc-senderName');await page.fill('#svc-senderName','Real Sender');await page.fill('#svc-senderPhone','+256772555666');
 await page.click('[data-action="svc-place"]');await page.click('[data-action="svc-pick-place"][data-index="0"]');await page.click('[data-action="svc-next"]');
 await page.fill('#svc-recipientName','Real Receiver');await page.fill('#svc-recipientPhone','+256772888999');await page.click('[data-action="svc-place"]');await page.click('[data-action="svc-pick-place"][data-index="1"]');await page.click('[data-action="svc-next"]');
 await page.fill('#svc-description','Documents for recipient');await page.fill('#svc-instructions','Handle carefully');await page.click('[data-action="svc-next"]');await page.click('[data-action="svc-quote"]');
 await page.waitForFunction(()=>document.querySelector('#main-content').innerText.includes('paid rider after the parcel arrives'));assert.match(await page.locator('#main-content').innerText(),/9,000/);quotes.relay.choiceAtOrder=true;await page.click('[data-action="svc-quote"]');
 await page.waitForSelector('#svc-lastMile');await page.selectOption('#svc-lastMile','collect');await page.click('[data-action="svc-next"]');await page.check('#svc-consent');await page.click('[data-action="svc-confirm"]');
 await page.waitForSelector('[data-auth-action="identifier"]');assert.equal(parcelCreated,0);assert.equal(listNo,0,'Guest confirmation must not create a production record');
 await page.click('[data-auth-action="identifier"]');await page.fill('#identifier',user.email);await page.click('[data-auth-form="identifier"] button[type="submit"]');await page.fill('#password','test-password');await page.click('[data-auth-form="login"] button[type="submit"]');
 await page.waitForSelector('#svc-consent');assert.equal(await page.locator('#svc-consent').isChecked(),false);
 await page.click('[data-action="svc-quote"]');assert.equal(await page.locator('#svc-consent').isChecked(),false);
 await page.check('#svc-consent');await page.click('[data-action="svc-confirm"]');
 await page.waitForFunction(()=>document.querySelector('#main-content').innerText.includes('Delivery confirmation code:'));
 assert.equal(parcelCreated,1);assert.equal(listNo,1);assert.equal(writes.find(w=>w.path==='/v1/orders').body.deliveryMode,'relay');assert.equal(writes.find(w=>w.path==='/v1/orders').body.relayLastMile,'collect');
 assert.match(writes.find(w=>w.path==='/v1/lists').body.items[0].note,/Real Receiver \+256772888999/);
 assert.match(await page.locator('#main-content').innerText(),/4321|SERVER-COLLECT-123/);
 await page.check('#svc-payment-consent');await page.click('[data-action="svc-pay"]');await page.waitForFunction(()=>document.querySelector('#main-content').innerText.includes('Payment: Collected'));
 assert.equal(writes.find(w=>w.path==='/v1/orders/parcel-order/fund').body.useWallet,true);
 await page.setInputFiles('#svc-photo',{name:'parcel.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGncAAAAASUVORK5CYII=','base64')});await page.waitForSelector('img[alt="Order photograph"]');
 await page.fill('#svc-message','Please meet the named recipient');await page.click('[data-action="svc-message"]');await page.waitForFunction(()=>document.querySelector('#main-content').innerText.includes('Please meet the named recipient'));
 await page.screenshot({path:evidence+'/parcel-live-mobile.png',fullPage:true});
 await page.reload();await page.evaluate(()=>window.navigate('parcel'));await page.waitForFunction(()=>document.querySelector('#main-content').innerText.includes('Peebee reference: parcel-order'));assert.equal(parcelCreated,1,'Reload must restore the existing request');
 // A write may commit before the response is lost: never create it again automatically.
 const saved=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('taxibee-service-progress-v1')));
 saved.drafts.parcel.orderId='';saved.drafts.parcel.listId='';saved.drafts.parcel.uncertain=false;saved.drafts.parcel.step=5;
 await page.evaluate(value=>sessionStorage.setItem('taxibee-service-progress-v1',JSON.stringify(value)),saved);await page.reload();await page.evaluate(()=>window.navigate('parcel'));
 await page.click('[data-action="svc-quote"]');interruptCreation=true;await page.check('#svc-consent');await page.click('[data-action="svc-confirm"]');
 await page.waitForFunction(()=>document.querySelector('#main-content').innerText.includes('Booking response interrupted'));assert.equal(parcelCreated,2);assert.equal(await page.locator('[data-action="svc-confirm"]').isDisabled(),true);
 await page.reload();await page.evaluate(()=>window.navigate('parcel'));await page.waitForSelector('[data-action="svc-confirm"][disabled]');assert.equal(parcelCreated,2);
 await page.click('[data-action="svc-history"]');await page.click('[data-action="svc-open-order"][data-id="parcel-order-2"]');await page.waitForFunction(()=>document.querySelector('#main-content').innerText.includes('Peebee reference: parcel-order-2'));assert.equal(parcelCreated,2);
 await page.evaluate(()=>window.navigate('special-hire'));await page.waitForSelector('[data-action="svc-category"]');await page.click('[data-action="svc-category"]');await page.click('[data-action="svc-next"]');
 await page.click('[data-action="svc-place"][data-point="pickup"]');await page.click('[data-action="svc-pick-place"][data-index="0"]');await page.click('[data-action="svc-place"][data-point="destination"]');await page.click('[data-action="svc-pick-place"][data-index="1"]');
 await page.fill('#svc-hours','2');await page.fill('#svc-scheduledFor','2026-11-25T13:00');await page.click('[data-action="svc-next"]');await page.click('[data-action="svc-quote"]');await page.click('[data-action="svc-next"]');await page.check('#svc-consent');await page.click('[data-action="svc-confirm"]');
 await page.waitForFunction(()=>document.querySelector('#main-content').innerText.includes('Assigned server vehicle'));assert.equal(charterCreated,1);
 const booking=writes.find(w=>w.path==='/v1/car/bookings').body;assert.equal(booking.categoryId,'luxury-real');assert.equal(booking.hireHours,2);assert.equal(booking.scheduledFor,'2026-11-25T10:00:00.000Z');
 pending=true;await page.check('input[name="svc-payment"][value="mobile"]');await page.fill('#svc-msisdn','+256772111222');await page.check('#svc-payment-consent');await page.click('[data-action="svc-pay"]');await page.waitForFunction(()=>document.querySelector('#main-content').innerText.includes('Provider approval pending'));assert.equal(await page.locator('[data-action="svc-pay"]').count(),0,'Pending approval must not be reported as collected or paid twice');
 await page.setViewportSize({width:1440,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:evidence+'/charter-live-desktop.png',fullPage:true});
 let started;const wait=new Promise(resolve=>{started=resolve;});delayed=started;await page.evaluate(()=>document.querySelector('[data-action="svc-refresh-order"]').click());await wait;await page.evaluate(()=>window.signOut());release();delayed=null;
 await page.waitForSelector('.home-redesign');assert.doesNotMatch(await page.locator('#main-content').innerText(),/REAL PRIVATE SERVICE STATUS|SERVER-COLLECT/);assert.equal(await page.evaluate(()=>sessionStorage.getItem('taxibee-service-progress-v1')),null);
 assert.deepEqual(errors,[]);console.log('PASS: public parcel/charter preparation, login progress, relay creation, wallet payment, real photos/chat, reload recovery, scheduled hourly hire, pending mobile money and sign-out isolation');
}finally{await browser.close();}
