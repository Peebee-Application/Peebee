import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const base=process.env.TAXIBEE_TEST_URL||'http://localhost:3015';
const corporate=process.argv.includes('--corporate');
const evidence=process.env.TAXIBEE_EVIDENCE||'/tmp/taxibee-evidence';
await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox']});
try{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.addInitScript(()=>localStorage.setItem('taxibee_customer_token','return-test-session'));
  const page=await context.newPage(),errors=[],writes=[];
  page.on('pageerror',e=>errors.push(e.message));
  const routes=[{id:'out',relayRouteId:'relay',direction:'a_to_b',fromName:'Entebbe',toName:'Kampala',farePerSeat:5000},{id:'back',relayRouteId:'relay',direction:'b_to_a',fromName:'Kampala',toName:'Entebbe',farePerSeat:6000}];
  const cfg={enabled:true,routes,maxSeatsPerBooking:4,maxLapChildren:2,childSeatFarePercent:100,luggageEnabled:false,luggageTypes:[],languages:[],returnPackagesEnabled:true,returnDiscountPercent:10,returnValidityDays:7,returnRefundPercent:100};
  const taxi={queueId:'out-queue',plate:'UBM 100A',seatLayout:'14',driverName:'Driver',status:'in_line',seatsLeft:12};
  const booking={id:'out-booking',orderId:'out-order',status:'booked',seats:1,amount:4500,paymentMethod:'app',paymentStatus:'unpaid',ticketCode:'TXP-RET123',createdAt:new Date().toISOString(),route:routes[0],taxi,returnPackage:{id:'tpr_12345678-1234-1234-1234-123456789abc',leg:'outbound'},cancel:{allowed:true,free:true,fee:0,refund:0}};
  const pkg={id:'tpr_12345678-1234-1234-1234-123456789abc',state:'quoted',returnState:'pending',mode:'open',returnDate:null,validUntil:new Date(Date.now()+7*86400000).toISOString(),quoteUntil:new Date(Date.now()+120000).toISOString(),outboundAmount:4500,returnAmount:5400,total:9900,wallet:9900,mobileMoney:9900,discountPercent:10,refundPercent:100,refunded:0,outboundPaid:0,returnPaid:0,returnRouteId:'back',returnRoute:{fromName:'Kampala',toName:'Entebbe'},checkout:null};
  let created=false,returned=null,failedRedeem=true;
  await page.route('**/api/v1/**',async r=>{
    const req=r.request(),path=new URL(req.url()).pathname.replace('/api',''),method=req.method(),body=method==='GET'?null:req.postDataJSON();
    if(method!=='GET')writes.push({path,body});
    let data,status=200;
    if(path==='/v1/auth/me')data={user:{id:'return-customer',name:'Return Customer',role:'customer',phone:'+256772000111',email:'returns@example.test'}};
    else if(path.endsWith('/config')&&path.includes('taxipress'))data=cfg;
    else if(path.endsWith('/queue')){const back=path.includes('/back/');data={route:routes[back?1:0],line:[{...taxi,id:back?'back-queue':'out-queue',bookable:true,position:1,seatsLeft:12}],onRoad:[]};}
    else if(path==='/v1/wallet')data={balance:50000,ledger:[]};
    else if(path==='/v1/taxipress/bookings/mine')data={bookings:created?[booking,...(returned?[returned]:[])]:[]};
    else if(path==='/v1/taxipress/departures/mine')data={tickets:[]};
    else if(path==='/v1/taxipress/return-quotes'){assert.equal(body.mode,'open');assert.equal(body.queueId,'out-queue');data={package:pkg};status=201;}
    else if(path==='/v1/taxipress/return-packages'&&method==='POST'){assert.equal(body.quoteId,pkg.id);created=true;Object.assign(pkg,{state:'ready',outboundBookingId:booking.id,orderId:booking.orderId,checkout:{wallet:9900,mobileMoney:9900}});data={package:pkg};status=201;}
    else if(path==='/v1/travel-credit/me')data={ready:true,corporateEnabled:corporate,vouchersEnabled:false,voucherMax:0,voucherDays:30,accounts:corporate?[{id:'company-return',name:'Approved employer',owner_id:'employer',active:1,member_active:1,available:20000,per_booking:20000,monthly_limit:100000,monthly_used:0}]:[],vouchers:[]};
    else if(path==='/v1/taxipress/return-packages')data={packages:created?[pkg]:[]};
    else if(path===`/v1/taxipress/return-packages/${pkg.id}`)data={package:pkg};
    else if(path==='/v1/orders/out-order/fund'){assert.equal(body.acceptedAmount,9900);assert.equal(body.useWallet,true);booking.paymentStatus='paid';Object.assign(pkg,{outboundPaid:4500,returnPaid:5400});data={order:{id:booking.orderId},payment:{id:'one-payment',status:'successful'}};}
    else if(path==='/v1/travel-credit/orders/out-order/quote')data={total:9900,sponsored:9900,walletAmount:0,label:'Approved employer',allocations:[{orderId:'out-order',amount:4500},{orderId:'back-order',amount:5400}]};
    else if(path==='/v1/travel-credit/orders/out-order/fund'){assert.equal(body.accountId,'company-return');assert.equal(body.acceptedSponsored,9900);booking.paymentStatus='paid';Object.assign(pkg,{outboundPaid:4500,returnPaid:5400});data={payment:{id:'company-payment',status:'successful'},funded:true};}
    else if(path===`/v1/taxipress/return-packages/${pkg.id}/redeem`){
      assert.equal(body.queueId,'back-queue');
      if(failedRedeem){failedRedeem=false;status=409;data={message:'That return departure filled. Choose another departure.'};}
      else{returned={...booking,id:'back-booking',orderId:'back-order',amount:5400,route:routes[1],taxi:{...taxi,queueId:'back-queue'},returnPackage:{id:pkg.id,leg:'return'}};Object.assign(pkg,{returnState:'redeemed',returnBookingId:returned.id});data={package:pkg,booking:returned};}
    }else if(path==='/v1/taxipress/bookings/out-booking')data={booking};
    else if(path==='/v1/taxipress/bookings/back-booking')data={booking:returned};
    else{status=404;data={message:path};}
    await r.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(base);await page.waitForSelector('.home-redesign');await page.waitForLoadState('networkidle');
  await page.evaluate(()=>{const s=window.TaxibeeSource.state;s.childCount=1;s.ticketType='return';s.bookingStep=2;window.navigate('book');});
  await page.waitForFunction(()=>document.body.innerText.includes('final package quote applies the configured child fare'));
  assert.doesNotMatch(await page.locator('#main-content').innerText(),/9,000\s*\/\s*child/);
  await page.evaluate(()=>{const s=window.TaxibeeSource.state;s.passengerCount=1;s.childCount=0;s.ticketType='return';s.returnMode='open';s.paymentMethod='wallet';s.bookingDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Kampala'}).format(new Date());window.navigate('checkout');});
  if(corporate)await page.evaluate(()=>{window.TaxibeeSource.state.paymentMethod='corporate';window.renderCurrentScreen();});
  await page.check('#booking-conditions');await page.click('[data-action="confirm-booking"]');
  await page.waitForSelector('#return-package-consent');
  assert.match(await page.locator('#modal-root').innerText(),/9,900/);
  await page.click('[data-action="return-buy"]');
  await page.waitForFunction(()=>document.body.innerText.includes('Accept the package conditions'));
  assert.equal(writes.filter(w=>w.path.endsWith('/fund')).length,0);
  await page.check('#return-package-consent');await page.click('[data-action="return-buy"]');
  if(corporate){await page.waitForSelector('#travel-payment-consent');assert.match(await page.locator('#modal-root').innerText(),/Company credit charged: UGX 9,900/);await page.check('#travel-payment-consent');await page.click('[data-action="travel-pay"]');}
  await page.waitForSelector('[data-action="return-redeem-form"]');
  assert.equal(writes.filter(w=>w.path.endsWith('/fund')).length,1);
  assert.equal(writes.filter(w=>w.path==='/v1/taxipress/bookings').length,0,'Package checkout must not create unrelated bookings');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:evidence+'/return-package-mobile.png',fullPage:true});
  await page.click('[data-action="return-redeem-form"]');await page.click('[data-action="return-redeem"]');
  await page.waitForFunction(()=>document.body.innerText.includes('That return departure filled'));
  await page.click('[data-action="return-redeem"]');
  await page.waitForFunction(()=>document.body.innerText.includes('View return ticket'));
  assert.equal(writes.filter(w=>w.path.endsWith('/fund')).length,1,'Return redemption never charges again');
  await page.setViewportSize({width:1440,height:1000});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:evidence+'/return-package-desktop.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: prepaid return consent, one combined payment, linked ticket, capacity conflict and redemption without another charge');
}finally{await browser.close();}
