import assert from 'node:assert/strict';
import { mkdir,readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const base = process.env.TAXIBEE_TEST_URL || 'http://localhost:3015';
const evidence = process.env.TAXIBEE_EVIDENCE || '/tmp/taxibee-evidence';
await mkdir(evidence,{ recursive: true });
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),headless: true,args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ viewport: { width: 390,height: 844 } });
  await context.addInitScript(() => localStorage.setItem('taxibee_customer_token','numbered-test-session'));
  const page = await context.newPage(),errors = [],writes = [];
  page.on('pageerror',e => errors.push(e.message));
  const user = { id: 'seat-customer',name: 'Seat Customer',role: 'customer',email: 'seats@example.test',phone: '+256772000111' };
  const route = { id: 'seat-route',fromName: 'Entebbe',toName: 'Kampala',directionLabel: 'EBB-KLA',farePerSeat: 5000 };
  const labels = ['1A','1B','2A','2B','2C','2D','3A','3B','3C','3D','4A','4B','4C','4D','5A','5B','5C','5D'];
  let hold = null,conflict = false,created = null,paid = false,feePerSeat = 500;
  const cfg = { enabled: true,routes: [route],maxSeatsPerBooking: 4,maxLapChildren: 2,childSeatFarePercent: 100,luggageEnabled: false,luggageTypes: [],languages: [],seatChoiceFeeUgx: 500,numberedSeatsEnabled: true,seatHoldSeconds: 120 };
  function map() { return { enabled: true,queueId: 'seat-queue',layout: '18',feePerSeat,holdSeconds: 120,hold,
    seats: labels.map(id => ({ id,status: created?.seatNumbers.includes(id) ? 'occupied' : hold?.seats.includes(id) ? 'mine' : id === '1A' ? 'occupied' : id === '1B' ? 'held' : 'available' })) }; }
  await page.route('**/api/v1/**',async r => {
    const request = r.request(),path = new URL(request.url()).pathname.replace('/api',''),method = request.method();
    if (method !== 'GET') writes.push({ path,body: request.postDataJSON() });
    let data,status = 200;
    if (path === '/v1/auth/me') data = { user };
    else if (path.endsWith('/config') && path.includes('taxipress')) data = cfg;
    else if (path.endsWith('/queue')) data = { route,line: [{ id: 'seat-queue',bookable: true,position: 2,seatsLeft: 16,seatLayout: '18',plate: 'UBM 818A',driverName: 'Seat Driver' }],onRoad: [] };
    else if (path.endsWith('/seat-queue/seats')) data = map();
    else if (path.endsWith('/seat-queue/seat-holds')) {
      if (conflict) { conflict = false; status = 409; data = { error: 'seat_conflict',message: 'A selected seat is no longer available. Refresh and choose again.' }; }
      else { const seats = request.postDataJSON().seats; hold = { id: 'owned-seat-hold',seats,fee: seats.length*feePerSeat,expiresAt: new Date(Date.now()+120000).toISOString() }; data = { hold: { ...hold,quantity: seats.length } }; }
    } else if (path.includes('/seat-holds/') && method === 'DELETE') { hold = null; data = { ok: true }; }
    else if (path === '/v1/wallet') data = { balance: 70000,ledger: [] };
    else if (path === '/v1/taxipress/bookings/mine') data = { bookings: created ? [{ ...created,paymentStatus: paid ? 'paid' : 'unpaid' }] : [] };
    else if (path === '/v1/taxipress/bookings') {
      assert.equal(request.postDataJSON().seatHoldId,'owned-seat-hold');
      created = { id: 'numbered-booking',orderId: 'numbered-order',status: 'booked',seats: 2,seatNumbers: [...hold.seats],seatChoiceFee: hold.fee,
        farePerSeat: 5000,amount: 10000+hold.fee,paymentMethod: 'app',paymentStatus: 'unpaid',ticketCode: 'TXP-ABC123',createdAt: new Date().toISOString(),cancel: { allowed: true,free: true,fee: 0,refund: 0 },route,
        taxi: { queueId: 'seat-queue',plate: 'UBM 818A',seatLayout: '18',driverName: 'Seat Driver',status: 'in_line',seatsLeft: 14 } };
      hold = null; status = 201; data = { booking: created,order: { id: 'numbered-order' } };
    } else if (path === '/v1/orders/numbered-order/fund') { paid = true; data = { order: { id: 'numbered-order' },payment: { id: 'payment',status: 'successful' } }; }
    else if (path === '/v1/taxipress/bookings/numbered-booking') data = { booking: { ...created,paymentStatus: paid ? 'paid' : 'unpaid' } };
    else { status = 404; data = { message: path }; }
    await r.fulfill({status,contentType: 'application/json',body: JSON.stringify(data)});
  });
  await page.goto(base); await page.waitForSelector('.home-redesign');
  await page.evaluate(() => {
    const s = window.TaxibeeSource.state;
    s.passengerCount = 2; s.childCount = 0; s.capacityMode = 'seats'; s.bookingStep = '3b'; s.selectedSeats = [];
    window.navigate('book');
  });
  await page.waitForSelector('.photo-seat[data-seat="5D"]');
  assert.equal(await page.locator('.photo-seat:not(.photo-seat--driver)').count(),18);
  assert.equal(await page.locator('.photo-seat--driver').isDisabled(),true);
  assert.equal(await page.locator('.photo-seat[data-seat="1A"]').isDisabled(),true);
  assert.equal(await page.locator('.photo-seat[data-seat="1B"]').isDisabled(),true);
  await page.click('.photo-seat[data-seat="2A"]'); await page.click('.photo-seat[data-seat="2B"]');
  await page.click('[data-action="taxibee-hold-seats"]');
  await page.waitForFunction(() => document.body.innerText.includes('Seats 2A, 2B held until'));
  assert.deepEqual(writes.find(w => w.path.endsWith('/seat-holds')).body.seats,['2A','2B']);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
  await page.screenshot({path: evidence+'/numbered-seats-mobile.png',fullPage: true});
  // A failed replacement must not silently replace a customer's original hold.
  await page.click('.photo-seat[data-seat="2B"]'); await page.click('.photo-seat[data-seat="2C"]');
  conflict = true; await page.click('[data-action="taxibee-hold-seats"]');
  await page.waitForFunction(() => document.body.innerText.includes('A selected seat is no longer available'));
  assert.deepEqual(hold.seats,['2A','2B']);
  await page.click('.photo-seat[data-seat="2C"]'); await page.click('.photo-seat[data-seat="2B"]');
  await page.evaluate(() => window.navigate('checkout'));
  await page.waitForSelector('#booking-conditions');
  assert.match(await page.locator('#main-content').innerText(),/11,000/);
  await page.reload(); await page.waitForSelector('.photo-seat[data-seat="5D"]');
  assert.deepEqual(await page.evaluate(() => window.TaxibeeSource.state.selectedSeats),['2A','2B']);
  assert.doesNotMatch(await page.evaluate(() => sessionStorage.getItem('taxibee-booking-draft-v1')),/owned-seat-hold|numbered-test-session/);
  await page.setViewportSize({width: 1440,height: 1000});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
  await page.screenshot({path: evidence+'/numbered-seats-desktop.png',fullPage: true});
  hold.expiresAt = new Date(Date.now()+1000).toISOString();
  await page.evaluate(() => document.querySelector('[data-action="taxibee-seat-refresh"]')?.click());
  // Force a fresh inventory read with a visibility event, then let the hold expire.
  const refreshed = page.waitForResponse(r => r.url().endsWith('/seat-queue/seats'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await refreshed;
  feePerSeat = 750; await page.waitForTimeout(1100);
  await page.check('#booking-conditions'); await page.click('[data-action="confirm-booking"]');
  await page.waitForFunction(() => document.body.innerText.includes('seat-choice fee changed'));
  assert.equal(writes.filter(w => w.path === '/v1/taxipress/bookings').length,0,'A changed quote requires a new confirmation');
  assert.equal(await page.locator('#booking-conditions').isChecked(),false);
  assert.match(await page.locator('#main-content').innerText(),/11,500/);
  await page.check('#booking-conditions'); await page.click('[data-action="confirm-booking"]');
  await page.waitForSelector('[data-real-qr] img');
  assert.match(await page.locator('#main-content').innerText(),/2A, 2B/);
  assert.equal(writes.filter(w => w.path === '/v1/taxipress/bookings').length,1);
  assert.equal(writes.find(w => w.path.endsWith('/fund')).body.useWallet,true);
  const saved = page.waitForEvent('download'); await page.click('[data-action="taxibee-ticket-download"]');
  assert.match(await readFile(await (await saved).path(),'utf8'),/Seat numbers: 2A, 2B/);
  assert.deepEqual(errors,[]);
  console.log('PASS: 18-seat inventory, unavailable seats, hold/conflict recovery, saved choices, fees, one booking and numbered ticket on mobile/desktop');
} finally { await browser.close(); }
