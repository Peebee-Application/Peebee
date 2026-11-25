import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TAXIBEE_TEST_URL || 'http://localhost:3015';
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), headless: true, args: ['--no-sandbox'] });
const evidence = process.env.TAXIBEE_EVIDENCE || '/tmp/taxibee-evidence';
async function assertPaneBleed(page, selector) {
  await page.locator(selector).waitFor();
  await page.waitForFunction(() => !document.querySelector('#main-content').getAnimations()
    .some(animation => animation.id === 'taxibee-page-slide'));
  const media = await page.locator(selector).boundingBox();
  const pane = await page.locator('#app-shell > .workspace').boundingBox();
  for (const edge of ['x', 'y', 'width']) assert.equal(media[edge], pane[edge], `${selector} must fill the pane at ${edge}`);
}
await mkdir(evidence, { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  let previewWrites = 0, previewRequests = 0;
  let mapSettingsReads = 0;
  await page.route('**/api/**', route => {
    if (route.request().url().endsWith('/api/v1/maps/public') && route.request().method() === 'GET') {
      mapSettingsReads++;
      return route.fulfill({ json: { provider: 'jawg', key: 'fixture-map-key', lightStyle: 'light' } });
    }
    previewRequests++;
    if (route.request().method() !== 'GET') previewWrites++;
    return route.abort();
  });
  await page.route('https://tile.jawg.io/**', route => route.abort());
  await page.goto(base + '/?preview=1');
  await page.waitForSelector('.home-redesign');
  assert.equal(await page.locator('#splash-screen, #onboarding, #auth-layer').evaluateAll(
    layers => layers.every(layer => getComputedStyle(layer).display === 'none')), true);
  await page.evaluate(() => { window.dispatchEvent(new Event('blur')); document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(await page.locator('#security-overlay, .secure-blur').count(), 0, 'App switching and screenshots must not hide content');
  assert.notEqual(await page.locator('body').evaluate(el => getComputedStyle(el).userSelect), 'none');
  await page.emulateMedia({ media: 'print' });
  assert.notEqual(await page.locator('body').evaluate(el => getComputedStyle(el).display), 'none', 'Printing must not be blanked');
  await page.emulateMedia({ media: 'screen' });
  await page.waitForTimeout(900);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile shell must not overflow horizontally');
  const header = page.locator('.customer-header');
  const footer = page.locator('#mobile-nav');
  const goBack = footer.getByRole('button', { name: 'Back', exact: true });
  assert.ok(await footer.getByRole('button', { name: 'Home', exact: true }).isVisible());
  const brand = header.locator('.peebee-header-brand');
  const emblem = await brand.locator('img').boundingBox();
  const brandCopy = await brand.locator('.peebee-header-brand-copy').boundingBox();
  assert.equal(emblem.width, 40);
  assert.equal(emblem.height, 40);
  assert.equal(brandCopy.height, emblem.height);
  assert.equal(brandCopy.y, emblem.y);
  assert.equal(await header.getByRole('link', { name: 'Go to home' }).getAttribute('aria-describedby'), 'taxibee-current-location');
  assert.equal(await brand.locator('#taxibee-current-location').textContent(), 'Current location: Kampala');
  const pane = page.locator('#app-shell > .workspace');
  const headerBounds = await header.boundingBox();
  const paneBounds = await pane.boundingBox();
  const headerPaint = () => header.evaluate(el => {
    const { backgroundColor, backgroundImage, boxShadow } = getComputedStyle(el);
    return { backgroundColor, backgroundImage, boxShadow };
  });
  const sharedBackdrop = () => page.evaluate(() => {
    const { backgroundColor, backgroundImage, position, top, left, width, height } = getComputedStyle(document.documentElement, '::before');
    return { backgroundColor, backgroundImage, position, top, left, width, height };
  });
  const transparentHeader = { backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none', boxShadow: 'none' };
  const homeBackdrop = await sharedBackdrop();
  assert.notEqual(homeBackdrop.backgroundColor, 'rgba(0, 0, 0, 0)', 'The viewport backdrop must supply the dark base');
  assert.match(homeBackdrop.backgroundImage, /radial-gradient/);
  assert.equal(homeBackdrop.position, 'fixed');
  assert.equal(homeBackdrop.top, '0px');
  assert.equal(homeBackdrop.left, '0px');
  assert.deepEqual(await headerPaint(), transparentHeader);
  await pane.evaluate(el => el.scrollTo({ top: 300, behavior: 'instant' }));
  assert.ok(await pane.evaluate(el => el.scrollTop > 0), 'The middle pane must scroll independently');
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  assert.equal(headerBounds.y, 0);
  assert.equal(paneBounds.y, headerBounds.height);
  assert.deepEqual(await header.boundingBox(), headerBounds, 'Scrolling must keep the header pinned');
  assert.deepEqual(await pane.boundingBox(), paneBounds, 'Scrolled content must stay below the header');
  await pane.evaluate(el => el.scrollTo({ top: 0, behavior: 'instant' }));
  const badImages = await page.evaluate(async () => {
    const images = [...document.querySelectorAll('#app-shell img')];
    await Promise.all(images.map(i => i.decode().catch(() => undefined)));
    return images.filter(i => !i.naturalWidth).map(i => i.getAttribute('src'));
  });
  assert.deepEqual(badImages, [], 'Replica assets must load');
  await page.screenshot({ path: evidence + '/preview-mobile.png', fullPage: true, animations: 'disabled' });
  const slides = await page.evaluate(() => {
    document.querySelector('#mobile-nav [data-screen="tickets"]').click();
    const names = el => el.getAnimations().map(animation => animation.id);
    return {
      header: names(document.querySelector('.customer-header')),
      page: names(document.querySelector('#main-content')),
    };
  });
  assert.ok(slides.page.includes('taxibee-page-slide'), 'Tickets should slide in beneath the header');
  assert.ok(!slides.header.includes('taxibee-page-slide'));
  assert.deepEqual(await headerPaint(), transparentHeader, 'Tickets must show the shared backdrop through the header');
  assert.equal(await pane.locator('.topbar').evaluate(bar => getComputedStyle(bar, '::after').content), 'none',
    'The Back-button bar must not paint its legacy gradient over the backdrop');
  assert.deepEqual(await sharedBackdrop(), homeBackdrop);
  assert.deepEqual(await header.boundingBox(), headerBounds);
  assert.ok(await goBack.isVisible());
  assert.equal(await page.locator('#app-shell .topbar [data-action="go-back"]').count(), 0);
  await goBack.click();
  await page.locator('body[data-active-screen="home"]').waitFor();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await header.locator('[aria-controls="chat-drawer"]').click();
  await page.waitForSelector('#chat-drawer[data-shown="true"]');
  assert.deepEqual(await headerPaint(), transparentHeader, 'The moving header must not introduce a seam beside chat');
  assert.deepEqual(await sharedBackdrop(), homeBackdrop);
  await page.locator('.chat-drawer__slice').click({ position: { x: 12, y: 25 } });
  await page.waitForSelector('.app-stage[data-lock="false"]');
  await header.locator('[aria-controls="side-drawer"]').click();
  await page.waitForFunction(() => document.body.classList.contains('drawer-open'));
  assert.deepEqual(await sharedBackdrop(), homeBackdrop, 'The sidebar must reveal the same viewport-sized backdrop');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.body.classList.contains('drawer-open'));
  const reducedMotionSlide = await page.evaluate(() => {
    window.navigate('wallet');
    return document.querySelector('#main-content').getAnimations().some(animation => animation.id === 'taxibee-page-slide');
  });
  assert.equal(reducedMotionSlide, false);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const screen of ['book','tickets','trips','wallet','profile','parcel','special-hire','offers','support','about']) {
    await page.evaluate(s => window.navigate(s), screen);
    assert.ok(await page.locator('#main-content').innerText());
    assert.deepEqual(await headerPaint(), transparentHeader, `${screen} must show the shared backdrop through the header`);
  }
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
    window.navigate('trackparcel');
  });
  const parcelMap = page.locator('#parcel-live-map');
  await parcelMap.locator('img[src*="tile.jawg.io/jawg-light"]').first().waitFor({ state: 'attached' });
  assert.equal(mapSettingsReads, 1);
  assert.ok(await goBack.isVisible());
  await assertPaneBleed(page, '#parcel-live-map');
  await goBack.click();
  await page.locator('body[data-active-screen="about"]').waitFor();
  await page.evaluate(() => window.navigate('trip-details'));
  await assertPaneBleed(page, '.smart-review__map-card');
  await page.evaluate(() => window.navigate('tracking', { trackingView: 'single', trackingTab: 'travels' }));
  await assertPaneBleed(page, '#unified-tracking-map');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await assertPaneBleed(page, '#unified-tracking-map');
  await page.setViewportSize({ width: 390, height: 844 });
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
  assert.equal(previewRequests, 0, 'Practice mode must not contact production account APIs');
  assert.deepEqual(errors, [], 'Every source screen should render without exceptions');
  console.log('PASS: mobile/desktop replica screens; preview never writes to API');
  await context.close();

  const live = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await live.newPage(); const liveErrors = []; p.on('pageerror', e => liveErrors.push(e.message));
  await p.route('https://accounts.google.com/gsi/client', r => r.fulfill({ contentType: 'application/javascript', body: `window.google={accounts:{id:{initialize(o){window.googleFixtureCallback=o.callback},renderButton(node){const b=document.createElement('button');b.id='fixture-google-button';b.textContent='Continue with Google';b.onclick=()=>window.googleFixtureCallback({credential:'fixture-google-id-token'});node.append(b)}}}};` }));
  const user = { id: 'existing-peebee-customer', role: 'customer', name: 'Existing Peebee Customer', phone: '+256772000111', email: 'customer@example.test' };
  const routeData = { id: 'shared-route', fromName: 'Entebbe', toName: 'Kampala', directionLabel: 'EBB - KLA', farePerSeat: 5000, stops: ['Entebbe','Kampala'] };
  const cfg = { enabled: true, routes: [routeData], cashEnabled: true, maxSeatsPerBooking: 4, maxLapChildren: 2, childSeatFarePercent: 100, luggageEnabled: true, luggageTypes: ['personal','standard'], luggagePrices: { personal: 0, standard: 2000 }, languages: [{ code: 'en', name: 'English' }], assistanceEnabled: true, languageEnabled: true, ticketSharingEnabled: true, openTicketsEnabled: true };
  const booking = { id: 'shared-booking', orderId: 'shared-order', status: 'booked', seats: 1, farePerSeat: 5000, amount: 5000, paymentMethod: 'app', paymentStatus: 'unpaid', ticketCode: null, createdAt: new Date().toISOString(), cancel: { allowed: true, free: true, fee: 0, refund: 0 }, route: routeData, taxi: { queueId: 'shared-queue', plate: 'UBM 123A', seatLayout: '14', driverName: 'Peebee Driver', status: 'in_line', seatsLeft: 10 } };
  const writes = []; let rejectedLogin = true;
  let balance = 70000, transferAttempt = 0, supportText = '', sentChat = '';
  let savedPassengers = [], savedLocations = [], savedDepartureIds=[];
  let reportedLocation = null;
  let bookingCreated = false;
  let delayedChat = null, releaseChat = null;
  await p.route('**/api/v1/**', async r => {
    const request = r.request(), path = new URL(request.url()).pathname.replace('/api','');
    const method = request.method();
    if (method !== 'GET') writes.push({ path, body: request.postDataJSON() });
    let data = {}, status = 200;
    if (path === '/v1/auth/login') {
      if (rejectedLogin) { rejectedLogin = false; status = 401; data = { error: 'invalid_credentials', message: 'Incorrect password' }; }
      else data = { token: 'fixture-peebee-token', user };
    } else if (path === '/v1/auth/me') data = { user };
    else if (path === '/v1/auth/config') data = { googleClientId: 'fixture-client-id' };
    else if (path === '/v1/auth/google') data = { token: 'google-session-token', user };
    else if (path === '/v1/auth/register') data = { token: 'registered-session-token', user };
    else if (path === '/v1/taxipress/config' || path === '/v1/taxipress-public/config') data = cfg;
    else if (path === '/v1/taxipress/saved-departures' && method === 'GET') data={ready:true,savedIds:savedDepartureIds};
    else if (path.startsWith('/v1/taxipress/saved-departures/')) { const id=decodeURIComponent(path.split('/').at(-1));if(method==='PUT'){if(!savedDepartureIds.includes(id))savedDepartureIds.push(id);data={saved:true};}else if(method==='DELETE'){savedDepartureIds=savedDepartureIds.filter(x=>x!==id);data={saved:false};}else{status=405;data={message:'Unexpected method'};} }
    else if (path.endsWith('/queue')) data = { route: routeData, line: [{ id: 'shared-queue', bookable: true, position: 2, seatsLeft: 10, seatLayout: '14', plate: 'UBM 123A', driverName: 'Peebee Driver', departsAt:new Date(Date.now()+60*60_000).toISOString() }], onRoad: [] };
    else if (path === '/v1/wallet') data = { balance, credit: 0, ledger: [], verified: true };
    else if (path === '/v1/taxipress/bookings/mine') data = { bookings: bookingCreated ? [booking] : [] };
    else if (path === '/v1/taxipress/departures/mine') data = { tickets: [] };
    else if (path === '/v1/taxipress-public/departures') data = { departures: [], ready: true };
    else if (path === '/v1/taxipress/bookings' && method === 'POST') { bookingCreated = true; const b = request.postDataJSON(); booking.seats = b.adults + (b.childSeats || 0); booking.amount = booking.seats * 5000 + (b.luggage?.standard || 0) * 2000; data = { booking, order: { id: booking.orderId } }; }
    else if (path === '/v1/orders/shared-order/fund') { booking.paymentStatus = 'paid'; booking.ticketCode = '654321'; data = { order: { id: booking.orderId }, funded: true }; }
    else if (path === '/v1/taxipress/bookings/shared-booking') data = { booking };
    else if(path==='/v1/travel-credit/me')data={ready:true,corporateEnabled:false,vouchersEnabled:false,voucherMax:0,voucherDays:30,accounts:[],vouchers:[]};
    else if(path==='/v1/taxipress/return-packages')data={packages:[]};
    else if (path === '/v1/taxipress/bookings/shared-booking/tracking') data = { enabled: true, pollAfterSeconds: 30, booking, location: reportedLocation };
    else if (path === '/v1/taxipress/bookings/shared-booking/send') data = { ok: true, code: booking.ticketCode, onPeebee: true, travellerName: request.postDataJSON().name, travellerPhone: request.postDataJSON().phone };
    else if (path === '/v1/taxipress/taxis/shared-queue/profile' || path === '/v1/taxipress-public/taxis/shared-queue/profile') data = { profile: { queueId: 'shared-queue', plate: 'UBM 123A', driverName: 'API Driver', seatLayout: '14', status: 'in_line', position: 2, seatsLeft: 10, reviews: [], rating: null, memberSince: null } };
    else if (path === '/v1/orders/shared-order/chat' && method === 'POST') { sentChat = request.postDataJSON().body; data = { id: 'real-message' }; }
    else if (path === '/v1/orders/shared-order/chat') {
      if (delayedChat) { delayedChat(); await new Promise(resolve => { releaseChat = resolve; }); data = { messages: [{ id: 'old', sender_role: 'rider', body: 'PRIVATE OLD RESPONSE', type: 'text', created_at: 'now' }] }; }
      else data = { messages: [{ id: 'greeting', sender_role: 'rider', body: 'Meet at the stage entrance', type: 'text', created_at: 'now' }, ...(sentChat ? [{ id: 'reply', sender_role: 'customer', body: sentChat, type: 'text', created_at: 'now' }] : [])] };
    }
    else if (path.endsWith('/chat/read')) data = { ok: true };
    else if (path === '/v1/wallet/lookup') data = { recipientId: 'recipient', name: 'Verified Recipient', maskedPhone: '+256***112' };
    else if (path === '/v1/wallet/transfer') { transferAttempt++; balance = 65000; if (transferAttempt === 1) { status = 503; data = { message: 'Response interrupted. Retry with the same transfer reference.' }; } else data = { balance, recipientName: 'Verified Recipient', replay: true }; }
    else if (path === '/v1/wallet/alerts') data = { alerts: [{ id: 'alert', title: 'Funds received', body: 'Your Peebee wallet received funds.', createdAt: 'now' }] };
    else if (path === '/v1/wallet/alerts/read') data = { ok: true };
    else if (path === '/v1/offers/mine') data = { enabled: true, allowCodeEntry: true, credit: 0, offers: [{ id: 'offer', name: 'API commuter offer', description: 'Available to this customer', summary: 'Checked at payment', services: ['taxipress'], endsAt: null }], referral: null };
    else if (path === '/v1/support-chat/config') data = { live: true, aiEnabled: true, humanEnabled: true };
    else if (path === '/v1/support-chat/resume') { status = 404; data = { error: 'none' }; }
    else if (path === '/v1/support-chat') data = { id: 'support-session', secret: 'fixture-support-secret' };
    else if (path.startsWith('/v1/support-chat/support-session')) {
      assert.equal(request.headers()['x-chat-secret'], 'fixture-support-secret');
      if (path.endsWith('/messages')) { supportText = request.postDataJSON().text; data = { ok: true }; }
      else if (method === 'POST') data = { ok: true };
      else data = { status: 'ai', messages: supportText ? [{ id: 1, from: 'user', text: supportText, at: 'now' }] : [] };
    }
    else if (path === '/v1/auth/verify/request') data = { sent: true, channel: 'sms', target: user.phone };
    else if (path === '/v1/auth/verify/confirm') { user.phoneVerifiedAt = new Date().toISOString(); data = { user }; }
    else if (path === '/v1/auth/password/change') data = { user, token: 'rotated-token' };
    else if (path === '/v1/auth/password/reset/request') data = { sent: true, target: user.email };
    else if (path === '/v1/auth/password/reset/confirm') data = { user, token: 'reset-token' };
    else if (path === '/v1/auth/logout') data = { ok: true };
    else if (path === '/v1/passengers' && method === 'POST') { savedPassengers.push({ id: 'saved-person', ...request.postDataJSON() }); data = { passenger: savedPassengers[0] }; }
    else if (path === '/v1/passengers') data = { passengers: savedPassengers, enabled: true };
    else if (path === '/v1/passengers/saved-person' && method === 'DELETE') { savedPassengers = []; data = { ok: true }; }
    else if (path === '/v1/locations' && method === 'POST') { savedLocations.push({ id: 'saved-place', ...request.postDataJSON() }); data = { location: savedLocations[0] }; }
    else if (path === '/v1/locations') data = { locations: savedLocations };
    else if (path === '/v1/locations/saved-place' && method === 'DELETE') { savedLocations = []; data = { ok: true }; }
    else if (path === '/v1/taxipress-ticket/654321') data = { ticket: { code: '654321', status: 'booked', paymentStatus: 'paid', seats: 1, route: routeData, taxi: booking.taxi, travellerName: 'Shared traveller', amountDue: null } };
    else { status = 404; data = { error: 'unexpected_test_request', message: path }; }
    await r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await p.goto(base);
  await p.waitForSelector('.home-redesign');
  assert.equal(await p.locator('#auth-layer').isVisible(), false, 'Browsing must not have an access gate');
  assert.equal(writes.length, 0, 'Opening the app must not create accounts or bookings');
  assert.doesNotMatch(await p.locator('#main-content').innerText(), /Christo/i, 'Public browsing must not display the sample customer');
  assert.equal(await p.locator('#notification-badge').isVisible(), false, 'Public browsing must not display sample unread notifications');
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Live shell must not overflow horizontally');
  assert.match(await p.locator('#main-content').innerText(), /Sign in to view your balance/);
  assert.doesNotMatch(await p.locator('#main-content').innerText(), /FXP-260718|Seat position 04|Confirmed/);
  await p.evaluate(() => { const s = window.TaxibeeSource.state; s.capacityMode = 'capacity'; s.passengerCount = 2; s.childCount = 1; s.reservedChildSeatsCount = 1; s.luggageQuantities.standard = 2; window.navigate('checkout'); });
  await p.fill('#taxibee-offer-code', 'COMMUTE');
  await p.check('#taxibee-open-ticket');
  assert.equal(await p.evaluate(() => JSON.parse(sessionStorage.getItem('taxibee-booking-draft-v1')).values.taxibeeOpenTicket), true);
  await p.reload();
  await p.waitForSelector('#taxibee-offer-code');
  assert.equal(await p.locator('#taxibee-offer-code').inputValue(), 'COMMUTE', 'Anonymous booking survives reload');
  await p.check('#booking-conditions');
  await p.click('[data-action="confirm-booking"]');
  await p.waitForSelector('[data-auth-action="identifier"]');
  assert.equal(await p.locator('#app-shell').isVisible(), false, 'Account screen must own focus while signing in');
  assert.equal(writes.filter(w => w.path === '/v1/taxipress/bookings').length, 0);
  await p.screenshot({ path: evidence + '/peebee-login-mobile.png', fullPage: true });
  await p.click('[data-auth-action="identifier"]');
  await p.fill('#identifier', user.email); await p.click('[data-auth-form="identifier"] button[type="submit"]');
  await p.fill('#password', 'test-password'); await p.click('[data-auth-form="login"] button[type="submit"]');
  await p.waitForFunction(() => document.querySelector('#auth-notice').innerText.includes('password'));
  assert.equal(await p.locator('#password').inputValue(), 'test-password');
  await p.click('[data-auth-form="login"] button[type="submit"]');
  await p.waitForFunction(() => document.querySelector('#auth-layer').classList.contains('is-hidden'));
  assert.equal(await p.locator('#taxibee-offer-code').inputValue(), 'COMMUTE');
  assert.equal(await p.locator('#taxibee-open-ticket').isChecked(), true);
  assert.equal(await p.locator('#booking-conditions').isChecked(), false, 'Login must not preserve payment consent');
  assert.doesNotMatch(await p.locator('#main-content').innerText(), /simulated payment|presentation-state|No money will|Demo mode|payment preview/);
  assert.deepEqual(await p.evaluate(() => { const s = window.TaxibeeSource.state; return [s.passengerCount, s.childCount, s.reservedChildSeatsCount, s.luggageQuantities.standard]; }), [2, 1, 1, 2]);
  const draft = await p.evaluate(() => sessionStorage.getItem('taxibee-booking-draft-v1'));
  assert.doesNotMatch(draft, /test-password|fixture-peebee-token|walletBalance|booking-conditions/);
  assert.equal(writes.filter(w => w.path === '/v1/taxipress/bookings').length, 0, 'Login alone must not submit or pay for a booking');
  await p.evaluate(() => window.navigate('home'));
  await p.click('[data-action="show-search-filters"]');
  await p.selectOption('#taxibee-filter-vehicle','18');await p.selectOption('#taxibee-filter-spaces','2');await p.selectOption('#taxibee-filter-period','afternoon');
  await p.click('[data-action="taxibee-search-filters-save"]');
  assert.equal(await p.evaluate(() => window.getAvailableTrips().length),0,'A search filter must narrow authoritative live departures');
  assert.deepEqual(await p.evaluate(() => JSON.parse(localStorage.getItem('taxibee-search-filters:existing-peebee-customer'))),{vehicle:'18',minSpaces:2,period:'afternoon'});
  await p.click('[data-action="show-search-filters"]');
  await p.selectOption('#taxibee-filter-vehicle','all');await p.selectOption('#taxibee-filter-spaces','1');await p.selectOption('#taxibee-filter-period','any');
  await p.click('[data-action="taxibee-search-filters-save"]');
  const saveDepartureRequest=p.waitForRequest(r=>r.method()==='PUT'&&new URL(r.url()).pathname.endsWith('/v1/taxipress/saved-departures/shared-queue'));
  await p.click('[data-action="toggle-save-departure"]');await saveDepartureRequest;
  assert.deepEqual(savedDepartureIds,['shared-queue'],'A signed-in favorite must persist through the account API');
  await p.waitForFunction(() => document.querySelector('#main-content').innerText.includes('Saved departures'));
  assert.match(await p.locator('#main-content').innerText(),/Saved departures[\s\S]*Entebbe → Kampala/,'Saved live departures must be visible and selectable');
  await p.evaluate(() => window.navigate('checkout'));
  await p.check('#booking-conditions');
  await p.click('[data-action="confirm-booking"]');
  await p.waitForSelector('[data-real-qr] img');
  assert.equal(writes.filter(x => x.path === '/v1/taxipress/bookings').length, 1);
  assert.equal(writes.find(x => x.path === '/v1/taxipress/bookings').body.queueId, 'shared-queue');
  assert.equal(writes.find(x => x.path.endsWith('/fund')).body.paymentMethod, 'wallet');
  assert.equal(writes.find(x => x.path.endsWith('/fund')).body.useWallet, true);
  assert.equal(writes.find(x => x.path.endsWith('/fund')).body.offerCode, 'COMMUTE');
  assert.equal(writes.find(x => x.path === '/v1/taxipress/bookings').body.openTicket, true);
  assert.equal(writes.find(x => x.path === '/v1/taxipress/bookings').body.adults, 2);
  assert.equal(writes.find(x => x.path === '/v1/taxipress/bookings').body.childSeats, 1);
  assert.equal(await p.evaluate(() => sessionStorage.getItem('taxibee-booking-draft-v1')), null, 'A created booking must not remain a resubmittable draft');
  assert.match(await p.locator('#main-content').innerText(), /654321/);
  assert.doesNotMatch(await p.locator('#main-content').innerText(), /482 915|simulated ticket/);
  await p.screenshot({ path: evidence + '/live-ticket-mobile.png', fullPage: true });
  await p.reload();
  await p.waitForSelector('.home-redesign');
  await p.evaluate(() => window.navigate('tickets'));
  assert.match(await p.locator('#main-content').innerText(), /UBM 123A/);
  await p.click('.ticket-qr-trigger');
  const download = p.waitForEvent('download');
  await p.click('[data-action="taxibee-ticket-download"]');
  const ticketHtml = await readFile(await (await download).path(), 'utf8');
  assert.match(ticketHtml, /\?ticket=654321/);
  assert.doesNotMatch(ticketHtml, /482 915|FX-260718/);
  const calendarDownload=p.waitForEvent('download');await p.click('[data-action="taxibee-calendar-export"][data-kind="stage"]');
  const calendarText=await readFile(await (await calendarDownload).path(),'utf8');
  assert.match(calendarText,/BEGIN:VCALENDAR/);assert.match(calendarText,/SUMMARY:Estimated Taxibee departure/);assert.match(calendarText,/may change/);
  await p.click('[data-action="taxibee-ticket-share-form"]');
  await p.fill('#taxibee-share-name', 'Real Traveller'); await p.fill('#taxibee-share-phone', '+256772000222');
  await p.click('[data-action="taxibee-ticket-share"]');
  await p.waitForSelector('#taxibee-share-name', { state: 'detached' });
  assert.equal(writes.find(w => w.path.endsWith('/shared-booking/send')).body.name, 'Real Traveller');
  await p.click('[data-action="taxibee-track-booking"]');
  await p.waitForFunction(() => document.querySelector('#main-content').innerText.includes('fresh vehicle location'));
  reportedLocation = { lat: 0.2, lng: 32.5, updatedAt: new Date().toISOString() };
  await p.click('[data-action="taxibee-feature-refresh"]');
  await p.waitForSelector('#taxibee-location-map .leaflet-marker-icon');
  await assertPaneBleed(p, '#taxibee-location-map');
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await p.click('[data-action="taxibee-open-chat"]');
  await p.waitForFunction(() => document.querySelector('#main-content').innerText.includes('Meet at the stage entrance'));
  await p.fill('#taxibee-message', 'I am at the entrance'); await p.click('[data-action="taxibee-chat-send"]');
  await p.waitForFunction(() => document.querySelector('#main-content').innerText.includes('I am at the entrance'));
  await p.evaluate(() => window.navigate('driver-profile'));
  await p.waitForFunction(() => document.querySelector('#main-content').innerText.includes('API Driver'));
  assert.doesNotMatch(await p.locator('#main-content').innerText(), /Isaac|4\.9|1,250/);
  await p.evaluate(() => window.navigate('offers'));
  await p.waitForFunction(() => document.querySelector('#main-content').innerText.includes('API commuter offer'));
  await p.evaluate(() => window.navigate('notifications'));
  await p.waitForFunction(() => document.querySelector('#main-content').innerText.includes('Funds received'));
  await p.click('[data-action="taxibee-notifications-read"]');
  await p.evaluate(() => window.navigate('support'));
  await p.waitForSelector('#taxibee-message');
  await p.fill('#taxibee-message', 'Please help with my booking'); await p.click('[data-action="taxibee-support-send"]');
  await p.waitForFunction(() => document.querySelector('#main-content').innerText.includes('Please help with my booking'));
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Support controls must fit the mobile screen');
  await p.evaluate(() => window.navigate('wallet'));
  await p.click('[data-action="taxibee-transfer-form"]');
  await p.fill('#taxibee-transfer-recipient', 'recipient@example.test'); await p.fill('#taxibee-transfer-amount', '5000');
  await p.click('[data-action="taxibee-transfer-review"]');
  await p.waitForSelector('[data-action="taxibee-transfer-confirm"]');
  assert.equal(transferAttempt, 0, 'Reviewing a recipient must not move money');
  const failedTransfer = p.waitForResponse(r => r.url().endsWith('/v1/wallet/transfer') && r.status() === 503);
  await p.click('[data-action="taxibee-transfer-confirm"]');
  await failedTransfer;
  await p.waitForSelector('[data-action="taxibee-transfer-confirm"]:not([disabled])');
  await p.click('[data-action="taxibee-transfer-confirm"]');
  await p.waitForSelector('[data-action="taxibee-transfer-confirm"]', { state: 'detached' });
  const transfers = writes.filter(w => w.path === '/v1/wallet/transfer');
  assert.equal(transfers.length, 2);
  assert.equal(transfers[0].body.idempotencyKey, transfers[1].body.idempotencyKey, 'Uncertain transfer retries reuse their reference');
  assert.match(await p.locator('#main-content').innerText(), /65,000/);
  const statement = p.waitForEvent('download');
  await p.click('[data-action="download-demo"]');
  assert.match(await readFile(await (await statement).path(), 'utf8'), /Reference.*Date.*Type.*Amount UGX/);
  await p.evaluate(() => window.navigate('profile'));
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Account controls must fit the mobile screen');
  await p.screenshot({ path: evidence + '/live-profile-mobile.png', fullPage: true });
  await p.click('[data-action="taxibee-passengers"]');
  await p.fill('#taxibee-passenger-name', 'Saved Traveller'); await p.fill('#taxibee-passenger-phone', '+256772000333');
  await p.click('[data-action="taxibee-passenger-save"]');
  await p.waitForSelector('[data-action="taxibee-passenger-delete"]');
  assert.match(await p.locator('#modal-root').innerText(), /Saved Traveller/);
  await p.click('[data-action="taxibee-passenger-delete"]');
  await p.waitForSelector('[data-action="taxibee-passenger-delete"]', { state: 'detached' });
  await p.click('button[data-action="close-modal"]');
  await p.click('[data-action="taxibee-locations"]');
  await p.fill('#taxibee-location-label', 'Home stage'); await p.fill('#taxibee-location-area', 'Entebbe'); await p.fill('#taxibee-location-address', 'Main stage');
  await p.click('[data-action="taxibee-location-save"]');
  await p.waitForSelector('[data-action="taxibee-location-delete"]');
  await p.click('[data-action="taxibee-location-delete"]');
  await p.waitForSelector('[data-action="taxibee-location-delete"]', { state: 'detached' });
  await p.click('button[data-action="close-modal"]');
  await p.click('[data-action="taxibee-display"][data-value="reduce-motion"]');
  assert.equal(await p.locator('body').evaluate(el => el.classList.contains('reduce-motion')), true);
  await p.click('[data-action="taxibee-verify-start"][data-channel="sms"]');
  await p.fill('#taxibee-verify-code', '123456'); await p.click('[data-action="taxibee-verify-confirm"]');
  await p.waitForSelector('#taxibee-verify-code', { state: 'detached' });
  assert.match(await p.locator('#main-content').innerText(), /Phone: Verified/);
  await p.click('[data-action="taxibee-password-form"]');
  await p.fill('#taxibee-current-password', ' old password '); await p.fill('#taxibee-new-password', ' new password ');
  await p.click('[data-action="taxibee-password-change"]');
  await p.waitForSelector('#taxibee-current-password', { state: 'detached' });
  assert.equal(writes.find(w => w.path === '/v1/auth/password/change').body.newPassword, ' new password ', 'Passwords preserve whitespace');
  let chatStarted;
  const chatPending = new Promise(resolve => { chatStarted = resolve; });
  delayedChat = chatStarted;
  await p.evaluate(() => window.navigate('driver-chat')); await chatPending;
  await p.evaluate(() => window.signOut());
  releaseChat(); delayedChat = null;
  await p.waitForSelector('.home-redesign');
  assert.doesNotMatch(await p.locator('body').innerText(), /PRIVATE OLD RESPONSE/);
  assert.equal(await p.evaluate(() => Object.keys(sessionStorage).some(k => k.startsWith('taxibee-support:'))), false);
  await p.evaluate(() => window.Taxibee.login());
  await p.click('[data-auth-action="identifier"]');
  await p.fill('#identifier', user.email); await p.click('[data-auth-form="identifier"] button[type="submit"]');
  await p.click('[data-action="taxibee-password-reset-form"]');
  await p.fill('#taxibee-reset-identifier', user.email); await p.click('[data-action="taxibee-password-reset-request"]');
  await p.fill('#taxibee-reset-code', '123456'); await p.fill('#taxibee-reset-password', 'reset password');
  await p.click('[data-action="taxibee-password-reset-confirm"]');
  await p.waitForFunction(() => document.querySelector('#auth-layer').classList.contains('is-hidden'));
  await p.evaluate(() => window.signOut());
  await p.waitForSelector('.home-redesign');
  await p.evaluate(() => window.Taxibee.login());
  await p.click('#fixture-google-button');
  await p.waitForFunction(() => document.querySelector('#auth-layer').classList.contains('is-hidden'));
  assert.deepEqual(writes.find(w => w.path === '/v1/auth/google').body, { idToken: 'fixture-google-id-token', role: 'customer' });
  await p.evaluate(() => window.signOut());
  await p.waitForSelector('.home-redesign');
  await p.evaluate(() => window.Taxibee.login());
  await p.click('[data-auth-action="identifier"]');
  await p.fill('#identifier', '+256772123456'); await p.click('[data-auth-form="identifier"] button[type="submit"]');
  await p.click('[data-auth-action="signup"]');
  await p.fill('#name', 'New Customer'); await p.fill('#new-password', 'new customer password');
  await p.click('[data-auth-form="signup"] button[type="submit"]');
  await p.waitForFunction(() => document.querySelector('#auth-layer').classList.contains('is-hidden'));
  assert.deepEqual(writes.find(w => w.path === '/v1/auth/register').body, { name: 'New Customer', phone: '+256772123456', password: 'new customer password', role: 'customer' });
  await p.goto(base + '/?ticket=654321');
  await p.waitForFunction(() => document.body.innerText.includes('Shared traveller'));
  assert.match(await p.locator('#auth-content').innerText(), /booked · paid/);
  assert.deepEqual(liveErrors, []);
  console.log('PASS: API fixtures for auth/reset/verification, bookings/open tickets/offers, driver profiles/chat/tracking, ticket export/sharing, support, saved contacts/places, wallet statements, notifications, idempotent transfers and late-response isolation');
  await live.close();
} finally { await browser.close(); }
