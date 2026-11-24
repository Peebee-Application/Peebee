import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const base=process.env.TAXIBEE_TEST_URL||'http://localhost:3015',evidence=process.env.TAXIBEE_EVIDENCE||'/tmp/taxibee-evidence';
await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox']});
try{
 const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.addInitScript(()=>localStorage.setItem('taxibee_customer_token','credit-test-session'));
 const page=await context.newPage(),errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const user={id:'credit-customer',name:'Credit Customer',role:'customer',phone:'+256772222333',email:'credit@example.test'};
 const route={id:'credit-route',fromName:'Entebbe',toName:'Kampala',farePerSeat:5000};
 const cfg={enabled:true,routes:[route],maxSeatsPerBooking:4,maxLapChildren:2,childSeatFarePercent:100,luggageEnabled:false,luggageTypes:[],languages:[],returnPackagesEnabled:false};
 const account={id:'tc_12345678123456781234',name:'Approved company',owner_id:user.id,active:1,credit_limit:20000,outstanding:0,available:10000,member_active:1,per_booking:10000,monthly_limit:100000,monthly_used:0};
 const voucher={id:'tv_12345678123456781234',issuer_id:'other-issuer',recipient_id:user.id,amount:3000,balance:3000,state:'active',expires_at:new Date(Date.now()+86400000).toISOString()};
 const bookings=[];let wallet=4000;
 await page.route('**/api/v1/**',async r=>{
  const req=r.request(),path=new URL(req.url()).pathname.replace('/api',''),method=req.method(),body=method==='GET'?null:req.postDataJSON();let data,status=200;
  if(method!=='GET')writes.push({path,body});
  if(path==='/v1/auth/me')data={user};else if(path==='/v1/auth/config')data={googleClientId:null};else if(path==='/v1/auth/logout')data={ok:true};
  else if(path==='/v1/travel-credit/me')data={ready:true,corporateEnabled:true,vouchersEnabled:true,voucherMax:50000,voucherDays:30,accounts:[account],vouchers:[voucher]};
  else if(path.includes('taxipress')&&path.endsWith('/config'))data=cfg;
  else if(path.endsWith('/queue'))data={route,line:[{id:'credit-queue',bookable:true,position:1,seatsLeft:12,seatLayout:'14',plate:'UBM 123A',driverName:'Driver'}],onRoad:[]};
  else if(path==='/v1/wallet')data={balance:wallet,ledger:[]};
  else if(path==='/v1/taxipress/return-packages')data={packages:[]};
  else if(path==='/v1/taxipress/bookings/mine')data={bookings};else if(path==='/v1/taxipress/departures/mine')data={tickets:[]};
  else if(path==='/v1/taxipress/bookings'&&method==='POST'){const id='credit-booking-'+bookings.length;const b={id,orderId:'order-'+id,status:'booked',seats:1,amount:5000,farePerSeat:5000,paymentMethod:'app',paymentStatus:'unpaid',ticketCode:'TXP-CRED01',createdAt:new Date().toISOString(),route,taxi:{queueId:'credit-queue',plate:'UBM 123A',seatLayout:'14',driverName:'Driver',status:'in_line',seatsLeft:11},cancel:{allowed:true,free:true,fee:0,refund:5000}};bookings.push(b);data={booking:b,order:{id:b.orderId}};status=201;}
  else if(path.startsWith('/v1/travel-credit/orders/')){
   const id=path.split('/')[4],b=bookings.find(b=>b.orderId===id);assert.ok(b);
   const sponsored=body.accountId?5000:Math.min(5000,voucher.balance),q={total:5000,sponsored,walletAmount:5000-sponsored,label:body.accountId?account.name:'Prepaid travel voucher',allocations:[{orderId:id,amount:5000}]};
   if(path.endsWith('/quote'))data=q;
   else{assert.equal(body.acceptedAmount,5000);assert.equal(body.acceptedSponsored,sponsored);b.paymentStatus='paid';if(body.accountId)account.outstanding+=5000;else{voucher.balance-=sponsored;wallet-=q.walletAmount;}data={payment:{id:'credit-payment',status:'successful'},funded:true};}
  }
  else if(path.match(/\/taxipress\/bookings\/[^/]+\/cancel$/)){const b=bookings.find(b=>path.includes(b.id));b.status='cancelled';account.outstanding=0;data={ok:true};}
  else if(path.startsWith('/v1/taxipress/bookings/'))data={booking:bookings.find(b=>path.endsWith('/'+b.id))};
  else{status=404;data={message:path};}
  await r.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto(base);await page.waitForSelector('.home-redesign');await page.waitForLoadState('networkidle');
 const checkout=method=>page.evaluate(method=>{const s=window.TaxibeeSource.state;s.paymentMethod=method;s.passengerCount=1;s.childCount=0;s.ticketType='oneway';s.capacityMode='capacity';s.bookingDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Kampala'}).format(new Date());window.navigate('checkout');},method);
 await checkout('corporate');await page.waitForSelector('#travel-account');assert.equal(await page.locator('#travel-account').inputValue(),account.id);await page.check('#booking-conditions');await page.click('[data-action="confirm-booking"]');await page.waitForSelector('#travel-payment-consent').catch(async e=>{console.error({text:(await page.locator('body').innerText()).slice(-2200),writes});throw e;});
 assert.match(await page.locator('#modal-root').innerText(),/Company credit charged: UGX 5,000/);
 await page.click('[data-action="travel-pay"]');await page.waitForFunction(()=>document.body.innerText.includes('Accept the funding conditions'));
 assert.equal(writes.filter(w=>w.path.endsWith('/fund')).length,0);
 await page.check('#travel-payment-consent');await page.click('[data-action="travel-pay"]');await page.waitForFunction(()=>document.body.innerText.includes('booked · paid'));
 assert.equal(wallet,4000);assert.equal(account.outstanding,5000);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:evidence+'/corporate-credit-mobile.png',fullPage:true});
 await checkout('voucher');await page.check('#booking-conditions');await page.click('[data-action="confirm-booking"]');await page.waitForSelector('#travel-payment-consent');
 assert.match(await page.locator('#modal-root').innerText(),/Your primary wallet pays: UGX 2,000/);
 voucher.balance=2000;await page.check('#travel-payment-consent');await page.click('[data-action="travel-pay"]');
 await page.waitForFunction(()=>document.body.innerText.includes('Funding changed.'));
 assert.equal(await page.locator('#travel-payment-consent').isChecked(),false,'Changed split requires fresh consent');
 assert.match(await page.locator('#modal-root').innerText(),/Your primary wallet pays: UGX 3,000/);
 await page.check('#travel-payment-consent');await page.click('[data-action="travel-pay"]');await page.waitForFunction(()=>document.body.innerText.includes('booked · paid'));
 assert.equal(wallet,1000);assert.equal(voucher.balance,0);assert.equal(writes.filter(w=>w.path.endsWith('/fund')).length,2);
 assert.equal(writes.filter(w=>w.path.startsWith('/v1/orders/')&&w.path.endsWith('/fund')).length,0,'Corporate/voucher authorization must never enter an ordinary wallet/mobile funding flow');
 await page.setViewportSize({width:1440,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:evidence+'/voucher-credit-desktop.png',fullPage:true});
 await page.evaluate(()=>window.navigate('wallet'));await page.click('[data-action="travel-open"]');await page.waitForFunction(()=>document.body.innerText.includes('Company travel & vouchers'));
 assert.doesNotMatch(await page.locator('#modal-root').innerText(),/TAXIBEE2000|CORP-DEMO/);
 assert.deepEqual(errors,[]);console.log('PASS: corporate authorization, named voucher, wallet split, renewed consent, one payment and account management on mobile/desktop');
}finally{await browser.close();}
