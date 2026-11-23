import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TAXIBEE_TEST_URL || 'http://localhost:3015';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const evidence = process.env.TAXIBEE_EVIDENCE || '/tmp/taxibee-evidence';
await mkdir(evidence, { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  let previewWrites = 0;
  await page.route('**/api/**', route => { if (route.request().method() !== 'GET') previewWrites++; return route.abort(); });
  await page.goto(base + '/?preview=1');
  await page.click('[data-action="taxibee-preview"]');
  await page.waitForSelector('.home-redesign');
  await page.waitForTimeout(900);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile shell must not overflow horizontally');
  const badImages = await page.evaluate(async () => {
    const images = [...document.querySelectorAll('#app-shell img')];
    await Promise.all(images.map(i => i.decode().catch(() => undefined)));
    return images.filter(i => !i.naturalWidth).map(i => i.getAttribute('src'));
  });
  assert.deepEqual(badImages, [], 'Replica assets must load');
  await page.screenshot({ path: evidence + '/preview-mobile.png', fullPage: true, animations: 'disabled' });
  for (const screen of ['book','tickets','trips','wallet','profile','parcel','special-hire','offers','support','about']) {
    await page.evaluate(s => window.navigate(s), screen);
    assert.ok(await page.locator('#main-content').innerText());
  }
  await page.evaluate(() => {
    const s = window.TaxibeeSource.state;
    s.activeTrip.vehicle = 'Commuter (14)'; s.activeTrip.seats = 14;
    s.capacityMode = 'seats'; s.passengerCount = 1; s.childCount = 0; s.selectedSeats = [];
    window.navigate('passengers');
  });
  assert.equal(await page.locator('.photo-seat:not(.photo-seat--driver)').count(), 14);
  assert.equal(await page.locator('.photo-seat--driver').isDisabled(), true);
  await page.locator('.photo-seat[data-seat="1A"]').click();
  assert.equal(await page.locator('.photo-seat[data-seat="1A"]').getAttribute('aria-pressed'), 'true');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.navigate('home'));
  await page.waitForTimeout(900);
  await page.screenshot({ path: evidence + '/preview-desktop.png', fullPage: true, animations: 'disabled' });
  assert.equal(previewWrites, 0, 'Design preview must never create real records');
  assert.deepEqual(errors, [], 'Every source screen should render without exceptions');
  console.log('PASS: mobile/desktop replica screens; preview never writes to API');
  await context.close();

  const live = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await live.newPage(); const liveErrors = []; p.on('pageerror', e => liveErrors.push(e.message));
  const user = { id: 'existing-peebee-customer', role: 'customer', name: 'Existing Peebee Customer', phone: '+256772000111', email: 'customer@example.test' };
  const routeData = { id: 'shared-route', fromName: 'Entebbe', toName: 'Kampala', directionLabel: 'EBB - KLA', farePerSeat: 5000, stops: ['Entebbe','Kampala'] };
  const cfg = { enabled: true, routes: [routeData], cashEnabled: true, maxSeatsPerBooking: 4, maxLapChildren: 2, childSeatFarePercent: 100, luggageEnabled: true, luggageTypes: ['personal','standard'], luggagePrices: { personal: 0, standard: 2000 }, languages: [{ code: 'en', name: 'English' }], assistanceEnabled: true, languageEnabled: true };
  const booking = { id: 'shared-booking', orderId: 'shared-order', status: 'booked', seats: 1, farePerSeat: 5000, amount: 5000, paymentMethod: 'app', paymentStatus: 'unpaid', ticketCode: null, createdAt: new Date().toISOString(), cancel: { allowed: true, free: true, fee: 0, refund: 0 }, route: routeData, taxi: { queueId: 'shared-queue', plate: 'UBM 123A', seatLayout: '14', driverName: 'Peebee Driver', status: 'in_line', seatsLeft: 10 } };
  const writes = []; let rejectedLogin = true;
  await p.route('**/api/v1/**', async r => {
    const request = r.request(), path = new URL(request.url()).pathname.replace('/api','');
    const method = request.method();
    if (method !== 'GET') writes.push({ path, body: request.postDataJSON() });
    let data = {}, status = 200;
    if (path === '/v1/auth/login') {
      if (rejectedLogin) { rejectedLogin = false; status = 401; data = { error: 'invalid_credentials', message: 'Incorrect password' }; }
      else data = { token: 'fixture-peebee-token', user };
    } else if (path === '/v1/auth/me') data = { user };
    else if (path === '/v1/taxipress/config') data = cfg;
    else if (path.endsWith('/queue')) data = { route: routeData, line: [{ id: 'shared-queue', bookable: true, position: 2, seatsLeft: 10, seatLayout: '14', plate: 'UBM 123A', driverName: 'Peebee Driver' }], onRoad: [] };
    else if (path === '/v1/wallet') data = { balance: 70000, credit: 0, ledger: [], verified: true };
    else if (path === '/v1/taxipress/bookings/mine') data = { bookings: [booking] };
    else if (path === '/v1/taxipress/bookings' && method === 'POST') data = { booking, order: { id: booking.orderId } };
    else if (path === '/v1/orders/shared-order/fund') { booking.paymentStatus = 'paid'; booking.ticketCode = '654321'; data = { order: { id: booking.orderId }, funded: true }; }
    else if (path === '/v1/taxipress/bookings/shared-booking') data = { booking };
    else { status = 404; data = { error: 'unexpected_test_request', message: path }; }
    await r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await p.goto(base);
  await p.fill('#signin-username', user.email); await p.fill('#signin-passcode', 'test-password');
  await p.click('#signin-form button[type="submit"]');
  await p.waitForFunction(() => !document.querySelector('#signin-error').classList.contains('is-hidden'));
  assert.match(await p.locator('#signin-error').innerText(), /password/);
  await p.fill('#signin-username', user.email); await p.fill('#signin-passcode', 'test-password');
  await p.click('#signin-form button[type="submit"]');
  await p.waitForSelector('.home-redesign');
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Live shell must not overflow horizontally');
  assert.match(await p.locator('#main-content').innerText(), /70,000/);
  assert.doesNotMatch(await p.locator('#main-content').innerText(), /FXP-260718|Seat position 04|Confirmed/);
  await p.evaluate(() => { window.TaxibeeSource.state.capacityMode = 'capacity'; window.navigate('checkout'); });
  await p.check('#booking-conditions');
  await p.click('[data-action="confirm-booking"]');
  await p.waitForSelector('[data-real-qr] img');
  assert.equal(writes.filter(x => x.path === '/v1/taxipress/bookings').length, 1);
  assert.equal(writes.find(x => x.path === '/v1/taxipress/bookings').body.queueId, 'shared-queue');
  assert.equal(writes.find(x => x.path.endsWith('/fund')).body.paymentMethod, 'wallet');
  assert.match(await p.locator('#main-content').innerText(), /654321/);
  assert.doesNotMatch(await p.locator('#main-content').innerText(), /482 915|simulated ticket/);
  await p.screenshot({ path: evidence + '/live-ticket-mobile.png', fullPage: true });
  await p.reload();
  await p.waitForSelector('.home-redesign');
  await p.evaluate(() => window.navigate('tickets'));
  assert.match(await p.locator('#main-content').innerText(), /UBM 123A/);
  assert.deepEqual(liveErrors, []);
  console.log('PASS: real API contract, failed login, shared account and booking, wallet payment, server boarding code, reload');
  await live.close();
} finally { await browser.close(); }
