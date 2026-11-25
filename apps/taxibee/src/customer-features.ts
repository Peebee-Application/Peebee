import type { ApiClient } from '../../../packages/shared/src/api-client';
import type { AuthUser, ChatMessage, SavedPassenger, WalletAlert } from '../../../packages/shared/src/domain';
import type { TaxipressBooking, TaxipressConfig, TaxipressTaxiProfile, TaxipressTracking } from '../../../packages/shared/src/taxipress';
import QRCode from 'qrcode';

type Context = {
  ui: Record<string, any>;
  api: ApiClient;
  token: () => string | null;
  user: () => AuthUser | null;
  config: () => TaxipressConfig | null;
  bookings: () => TaxipressBooking[];
  selected: () => TaxipressBooking | null;
  select: (booking: TaxipressBooking) => void;
  applyUser: (user: AuthUser) => void;
  saveToken: (token: string) => void;
  refresh: () => Promise<void>;
  requestLogin: (screen: string) => void;
  finishSession: (result: { token: string; user: AuthUser }) => Promise<void>;
};
type SupportMessage = { id: number; from: string; text: string; at: string; agentName?: string };
type SupportSession = { id: string; secret: string };
type SupportView = { status: string; agentName?: string; position?: number; messages: SupportMessage[] };

/** Installs only in live mode. Practice never constructs this controller or sends requests. */
export function installCustomerFeatures(c: Context) {
  const { ui, api } = c;
  const state = ui.TaxibeeSource.state;
  const esc = (value: unknown) => ui.escapeHtml(String(value ?? ''));
  const money = (value: number) => ui.formatUGX(value);
  const input = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() || '';
  const button = (action: string, label: string, extra = '') => `<button type="button" class="button button--primary" data-action="${action}" ${extra}>${label}</button>\n`;
  const field = (id: string, label: string, type = 'text', extra = '') => `<label for="${id}">${label}</label><input id="${id}" type="${type}" ${extra}>`;
  const notice = (title: string, copy: string) => `<section class="card" role="status"><h2>${esc(title)}</h2><p>${esc(copy)}</p></section>`;
  const booking = () => c.selected() || c.bookings()[0] || null;
  const requireBooking = () => { const b = booking(); if (!b) throw new Error('Choose a booking in My Travels first.'); return b; };
  const errorText = (e: unknown) => e instanceof Error ? e.message : 'Please try again.';
  const nowUser = () => c.user()?.id || 'guest';
  const signInPrompt = (title: string) => `<section class="card taxibee-guest-card"><h2>${esc(title)}</h2><p>Sign in with your Peebee account to see your personal information.</p><button type="button" class="button button--primary" data-auth-action="open" data-screen-after="${esc(state.screen)}">Sign in or create account</button></section>`;
  let pending = false, epoch = 0, loadError = '', loaded = '';
  let profile: TaxipressTaxiProfile | null = null;
  let tracking: TaxipressTracking | null = null;
  let messages: ChatMessage[] = [];
  let offers: Awaited<ReturnType<ApiClient['getMyOffers']>> | null = null;
  let alerts: WalletAlert[] = [];
  let support: SupportSession | null = null, supportOwner = '', supportView: SupportView | null = null;
  let supportConfig: { live: boolean; aiEnabled: boolean; humanEnabled: boolean } | null = null;
  let transfer: { recipientId: string; name: string; amount: number; note: string; key: string } | null = null;
  let poll: ReturnType<typeof setTimeout> | null = null, map: any = null;
  let resetIdentifier = '';
  let passengers: SavedPassenger[] = [];
  const displayOptions = ['large-text', 'high-contrast', 'reduce-motion'];
  const featureScreens = new Set(['driver-profile', 'driver-chat', 'driver-call', 'offers', 'support', 'notifications', 'tracking', 'live']);
  const originalNavigate = ui.navigate;
  const originalRender = ui.renderCurrentScreen;
  const originalProfile = ui.renderProfile;
  const originalTicket = ui.renderTicket;
  const originalWallet = ui.renderWallet;
  const loading = () => loadError ? notice('Unable to load', loadError) + button('taxibee-feature-refresh', 'Try again') : notice('Loading', 'Getting the latest information from Peebee…');
  const selectedId = () => booking()?.id || '';
  const ticketUrl = (b: TaxipressBooking) => `${location.origin}/?ticket=${encodeURIComponent(b.ticketCode || '')}`;

  async function supportRequest<T>(path: string, body?: object, secret?: string): Promise<T> {
    const response = await fetch('/api/v1/support-chat' + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(c.token() ? { Authorization: `Bearer ${c.token()}` } : {}), ...(secret ? { 'X-Chat-Secret': secret } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || `Support request failed (${response.status}).`);
    return data;
  }
  async function loadSupport(valid: () => boolean) {
    const owner = nowUser();
    if (supportOwner !== owner) { support = null; supportView = null; supportOwner = owner; }
    const nextConfig = await supportRequest<NonNullable<typeof supportConfig>>('/config?app=customer');
    if (!valid()) return;
    supportConfig = nextConfig;
    if (!supportConfig.live) return;
    if (!support) {
      try { support = JSON.parse(sessionStorage.getItem(`taxibee-support:${owner}`) || 'null'); } catch { support = null; }
    }
    const read = async () => supportRequest<SupportView>(`/${encodeURIComponent(support!.id)}`, undefined, support!.secret);
    if (support) {
      try { const view = await read(); if (valid()) supportView = view; return; } catch { if (!valid()) return; support = null; }
    }
    // Resume is tied to this authenticated customer by the existing support API.
    let next: SupportSession;
    try { next = await supportRequest<SupportSession>('/resume', { app: 'customer' }); }
    catch { if (!valid()) return; next = await supportRequest<SupportSession>('', { app: 'customer', page: 'Taxibee Help & Support' }); }
    if (!valid()) return;
    support = next;
    sessionStorage.setItem(`taxibee-support:${owner}`, JSON.stringify(support));
    const view = await read(); if (valid()) supportView = view;
  }
  async function hydrate(screen: string, valid: () => boolean) {
    const id = selectedId();
    if (screen === 'driver-profile') {
      const queueId = state.activeTrip?.id || booking()?.taxi.queueId;
      if (!queueId) throw new Error('Choose a departure first.');
      const result = await (c.user() ? api.getTaxipressTaxiProfile(queueId) : api.getPublicTaxipressTaxiProfile(queueId));
      if (!result.profile) throw new Error('Peebee did not return a driver profile. Please refresh.');
      if (valid()) profile = result.profile;
    } else if (screen === 'driver-chat') {
      const orderId = requireBooking().orderId;
      const result = await api.getChat(orderId);
      if (valid()) { messages = result.messages; await api.markChatRead(orderId); }
    } else if (screen === 'tracking' || screen === 'live') {
      if (id) { const result = await api.getTaxipressTracking(id); if (valid()) { tracking = result; c.select(result.booking); } }
      else tracking = null;
    } else if (screen === 'driver-call') { requireBooking(); }
    else if (screen === 'offers') { const result = await api.getMyOffers(); if (valid()) offers = result; }
    else if (screen === 'notifications') { const result = await api.getWalletAlerts(); if (valid()) alerts = result.alerts; }
    else if (screen === 'support') await loadSupport(valid);
  }
  function schedulePoll(screen: string) {
    if (poll) clearTimeout(poll);
    poll = null;
    const interval = ['tracking', 'live'].includes(screen) && tracking?.enabled ? tracking.pollAfterSeconds * 1000
      : ['driver-chat', 'support'].includes(screen) ? 5000 : 0;
    if (interval <= 0 || document.hidden || (!c.user() && screen !== 'support')) return;
    poll = setTimeout(async () => {
      const owner = nowUser(), id = selectedId(), run = epoch;
      const valid = () => run === epoch && owner === nowUser() && id === selectedId() && state.screen === screen;
      try {
        await hydrate(screen, valid);
        if (valid()) {
          // Preserve unsent text while refreshing messages.
          const draft = input('taxibee-message');
          ui.renderCurrentScreen();
          const el = document.getElementById('taxibee-message') as HTMLInputElement | null;
          if (el) el.value = draft;
        }
      } catch (e) { if (valid()) { loadError = errorText(e); loaded = ''; tracking = null; ui.renderCurrentScreen(); } }
      if (valid()) schedulePoll(screen);
    }, interval);
  }
  async function load(screen: string) {
    const run = ++epoch, owner = nowUser();
    loadError = ''; loaded = '';
    try {
      await hydrate(screen, () => run === epoch && owner === nowUser() && state.screen === screen);
      if (run !== epoch || owner !== nowUser() || state.screen !== screen) return;
      loaded = screen;
    } catch (e) { if (run !== epoch || owner !== nowUser()) return; loadError = errorText(e); }
    if (state.screen === screen) { ui.renderCurrentScreen(); schedulePoll(screen); }
  }
  const reloadScreen = (screen: string) => state.screen === screen ? load(screen) : Promise.resolve();
  ui.navigate = (screen: string, ...args: any[]) => {
    if (poll) clearTimeout(poll);
    ++epoch; loaded = ''; loadError = ''; profile = null; tracking = null; messages = [];
    const supported = new Set(['home', 'book', 'available-vans', 'trip-details', 'passengers', 'returns', 'luggage', 'checkout', 'success', 'ticket', 'tickets', 'trips', 'wallet', 'profile', 'about', 'login-logs','search-results','parcel','parcel-receipt','trackparcel','trackparcel-list','parcel-status','special-hire', ...featureScreens]);
    if (!supported.has(screen)) {
      originalNavigate('home');
      ui.openModal('Continue in Peebee', '<p>This service is not connected in live Taxibee yet. Use your Peebee account in the customer app, or try the sample flow in practice mode.</p>', '<a class="button button--primary" href="https://app.peebee.online/ride">Open Peebee</a><a class="button button--ghost" href="/?preview=1">Practice mode</a>'); return;
    }
    originalNavigate(screen, ...args);
    if (featureScreens.has(screen) && (c.user() || ['support', 'driver-profile'].includes(screen))) void load(screen);
  };
  ui.renderCurrentScreen = (...args: any[]) => {
    if (map) { map.remove(); map = null; }
    originalRender(...args);
    if (['tracking', 'live'].includes(state.screen) && tracking?.location && document.getElementById('taxibee-location-map') && ui.L) {
      const p = tracking.location;
      map = ui.L.map('taxibee-location-map').setView([p.lat, p.lng], 15);
      ui.addTaxibeeMapTiles(map);
      ui.L.marker([p.lat, p.lng]).addTo(map).bindPopup(esc(tracking.booking.taxi.plate));
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (poll) clearTimeout(poll);
    if (!document.hidden && featureScreens.has(state.screen) && (c.user() || ['support', 'driver-profile'].includes(state.screen))) void load(state.screen);
  });

  ui.renderDriverProfile = () => {
    if (loaded !== 'driver-profile' || !profile) return loading();
    const p = profile;
    return `${ui.screenHead('Driver profile', `${esc(p.plate)} · ${esc(p.status)}`)}<article class="card"><h2>${esc(p.driverName || 'Driver')}</h2><div class="detail-list">${ui.ticketField('Vehicle', esc(p.vehicleType || p.plate))}${ui.ticketField('Capacity', esc(p.seatLayout))}${ui.ticketField('Available spaces', p.seatsLeft)}${p.memberSince ? ui.ticketField('Member since', esc(p.memberSince)) : ''}${p.tripsCount != null ? ui.ticketField('Completed trips', p.tripsCount) : ''}${p.rating != null ? ui.ticketField('Passenger rating', `${p.rating} (${p.ratingCount || 0})`) : ''}</div>${p.reviews.map(r => `<p>${esc(r.rating)} / 5 · ${esc(r.comment || '')}</p>`).join('')}</article>`;
  };
  ui.showDriverProfileModal = () => ui.navigate('driver-profile');
  ui.showTicketDetailsModal = (id: string) => {
    const b = c.bookings().find(value => value.id === id);
    if (!b) return ui.toast('This ticket is no longer available. Refresh My Tickets.', 'danger');
    c.select(b); ui.navigate('ticket');
  };
  ui.renderDriverCall = () => {
    if (!c.user()) return signInPrompt('Your driver');
    const b = booking();
    return `${ui.screenHead('Call driver', 'Call the driver assigned to your booking.')}<article class="card"><h2>${esc(b?.taxi.driverName || 'Driver')}</h2>${b?.taxi.driverPhone ? `<a class="button button--primary" href="tel:${esc(b.taxi.driverPhone.replace(/[^+0-9]/g, ''))}">Call ${esc(b.taxi.driverPhone)}</a>` : '<p>The driver has not shared a phone number for this booking.</p>'}</article>`;
  };
  ui.renderDriverChat = () => !c.user() ? signInPrompt('Your booking messages') : loaded !== 'driver-chat' ? loading() : `${ui.screenHead('Chat with driver', 'Messages are saved on your Peebee booking.')}<article class="card"><div aria-live="polite">${messages.map(m => `<p><strong>${esc(m.sender_role)}</strong> · ${esc(m.created_at)}<br>${esc(m.type === 'text' ? m.body : `[${m.type} message]`)}</p>`).join('') || '<p>No messages yet.</p>'}</div>${field('taxibee-message', 'Message', 'text', 'maxlength="2000"')}${button('taxibee-chat-send', 'Send message')}</article>`;
  const renderTracking = () => {
    if (!c.user()) return signInPrompt('Your journeys');
    if (!booking()) return notice('Your journeys', 'Choose a booking in My Travels to track it.');
    if (loaded !== state.screen || !tracking) return loading();
    const b = tracking.booking;
    return `${ui.screenHead('Live travel', `${esc(b.route.fromName)} → ${esc(b.route.toName)}`)}<article class="card"><div class="detail-list">${ui.ticketField('Vehicle', esc(b.taxi.plate))}${ui.ticketField('Journey', esc(b.status))}${ui.ticketField('Taxi status', esc(b.taxi.status))}${ui.ticketField('Queue position', b.taxi.position ?? '—')}</div>${tracking.location ? `<div id="taxibee-location-map" style="height:300px" aria-label="Reported vehicle location"></div><p>Location reported: ${esc(tracking.location.updatedAt)}</p>` : `<p>${tracking.enabled ? 'A fresh vehicle location is not available. The marker appears when the driver reports a current location.' : 'Live location is switched off by Peebee administrators.'}</p>`}${button('taxibee-feature-refresh', 'Refresh status')}${button('taxibee-open-chat', 'Chat with driver')}${button('taxibee-open-call', 'Call driver')}</article>`;
  };
  ui.renderTracking = renderTracking;
  ui.renderAbout = () => `${ui.screenHead('Taxibee by Peebee', 'Customer travel using your shared Peebee account.')}<article class="card"><p>Your TaxiPress journeys, wallet, payments and support are managed by Peebee. Practice mode uses sample data and makes no production account requests.</p><div class="button-row"><a class="button button--ghost" href="https://peebee.online/about">About Peebee</a><a class="button button--ghost" href="https://peebee.online/privacy">Privacy policy</a><a class="button button--ghost" href="https://peebee.online/terms">Terms and conditions</a></div></article>`;
  ui.renderOffers = () => !c.user() ? signInPrompt('Your eligible offers') : loaded !== 'offers' || !offers ? loading() : `${ui.screenHead('Offers and promotions', 'Eligibility and discounts are confirmed by Peebee at payment.')}<section class="grid grid--2">${offers.offers.map(o => `<article class="card"><h2>${esc(o.name)}</h2><p>${esc(o.description)}</p><p>${esc(o.summary)}</p><p>${esc(o.services.join(', '))}</p>${o.endsAt ? `<small>Ends ${esc(o.endsAt)}</small>` : ''}</article>`).join('') || notice('No offers available', 'Offers will appear here when Peebee makes them available to your account.')}</section>`;
  ui.renderNotifications = () => !c.user() ? signInPrompt('Your notifications') : loaded !== 'notifications' ? loading() : `${ui.screenHead('Notifications', 'Your Peebee wallet alerts and booking status.')}<section class="grid">${alerts.map(a => `<article class="card"><h3>${esc(a.title)}</h3><p>${esc(a.body)}</p><small>${esc(a.createdAt)}</small></article>`).join('')}${c.bookings().map(b => `<article class="card"><h3>${esc(b.route.fromName)} → ${esc(b.route.toName)}</h3><p>${esc(b.status)} · ${esc(b.paymentStatus)}</p>${button('taxibee-ticket', 'View ticket', `data-id="${esc(b.id)}"`)}</article>`).join('')}${!alerts.length && !c.bookings().length ? '<p>No notifications yet.</p>' : ''}${button('taxibee-notifications-read', 'Mark wallet alerts read')}</section>`;
  ui.renderSupport = () => {
    if (loaded !== 'support' || !supportConfig) return loading();
    if (!supportConfig.live) return notice('Help and support', 'Peebee administrators have switched off customer support chat. Please check again later.');
    return `${ui.screenHead('Help and support', 'Your conversation with Peebee support.')}<article class="card"><p role="status">${esc(supportView?.status || '')}${supportView?.agentName ? ` · ${esc(supportView.agentName)}` : ''}${supportView?.position ? ` · Queue ${supportView.position}` : ''}</p><div aria-live="polite">${(supportView?.messages || []).map(m => `<p><strong>${esc(m.agentName || m.from)}</strong> · ${esc(m.at)}<br>${esc(m.text)}</p>`).join('')}</div>${supportView?.status !== 'closed' ? `${field('taxibee-message', 'Message', 'text', 'maxlength="1000"')}${button('taxibee-support-send', 'Send message')}${supportConfig.humanEnabled && supportView?.status === 'ai' ? button('taxibee-support-handoff', 'Talk to a person') : ''}${button('taxibee-support-end', 'End conversation')}` : button('taxibee-support-new', 'Start a new conversation')}</article>`;
  };
  ui.renderProfile = () => originalProfile() + `<article class="card"><h3>Account security</h3><p>Phone: ${c.user()?.phoneVerifiedAt ? 'Verified' : 'Not verified'} · Email: ${c.user()?.emailVerifiedAt ? 'Verified' : 'Not verified'}</p>${c.user()?.phone ? button('taxibee-verify-start', 'Verify phone', 'data-channel="sms"') : ''}${c.user()?.email ? button('taxibee-verify-start', 'Verify email', 'data-channel="email"') : ''}${button('taxibee-password-form', 'Change password')}${button('taxibee-passengers', 'Saved passengers')}${button('taxibee-locations', 'Saved pickup points')}<a class="button button--ghost" href="/?preview=1">Enter practice mode</a></article><article class="card"><h3>Display options on this device</h3>${displayOptions.map((value, i) => button('taxibee-display', `${['Larger text', 'High contrast', 'Reduce motion'][i]}: ${document.body.classList.contains(value) ? 'On' : 'Off'}`, `data-value="${value}"`)).join('')}</article>`;
  ui.renderWallet = () => originalWallet() + `<article class="card"><h3>Send to another Peebee customer</h3><p>Review the recipient and amount before confirming.</p>${button('taxibee-transfer-form', 'Send money')}</article>`;
  ui.renderTicket = () => {
    if (!c.user()) return signInPrompt('Your ticket');
    const b = booking();
    return originalTicket() + (b ? `<article class="card"><div class="button-row">${button('taxibee-track-booking', 'Track journey')}${button('taxibee-open-chat', 'Chat with driver')}${button('taxibee-open-call', 'Call driver')}${b.ticketCode ? button('taxibee-ticket-download', 'Download ticket') : ''}${b.ticketCode && c.config()?.ticketSharingEnabled ? button('taxibee-ticket-share-form', 'Send ticket') : ''}${b.status === 'completed' ? button('taxibee-rating-form', 'Rate journey') : ''}${b.receiptRef ? `<a class="button button--ghost" href="https://app.peebee.online/receipt/${encodeURIComponent(b.receiptRef)}">View receipt</a>` : ''}</div></article>` : '');
  };
  const liveProfile = ui.renderProfile, liveWallet = ui.renderWallet, liveTickets = ui.renderTickets;
  ui.renderProfile = () => c.user() ? liveProfile() : signInPrompt('Your Peebee account');
  ui.renderWallet = () => c.user() ? liveWallet() : signInPrompt('Your Peebee wallet');
  ui.renderTickets = () => c.user() ? liveTickets() : signInPrompt('Your tickets');
  const download = (name: string, data: string, type: string) => {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  async function act(action: string, el: HTMLElement) {
    const owner = nowUser();
    const owned = async <T>(request: Promise<T>): Promise<T> => {
      const result = await request;
      if (owner !== nowUser()) throw new Error('The signed-in account changed.');
      return result;
    };
    if (action === 'taxibee-passengers') {
      const result = await owned(api.getPassengers()); passengers = result.passengers;
      return ui.openModal('Saved passengers', result.enabled ? passengers.map(p => `<article class="card"><strong>${esc(p.name)}</strong><p>${esc(p.phone)}</p>${c.config()?.bookForOthersEnabled ? button('taxibee-passenger-use', 'Book for this person', `data-id="${esc(p.id)}"`) : ''}${button('taxibee-passenger-delete', 'Remove', `data-id="${esc(p.id)}"`)}</article>`).join('') + field('taxibee-passenger-name', 'Passenger name') + field('taxibee-passenger-phone', 'Passenger phone', 'tel') : '<p>Saved passengers are switched off by Peebee administrators.</p>', result.enabled ? button('taxibee-passenger-save', 'Save passenger') : '');
    }
    if (action === 'taxibee-passenger-save') {
      await owned(api.savePassenger({ name: input('taxibee-passenger-name'), phone: input('taxibee-passenger-phone') }));
      return act('taxibee-passengers', el);
    }
    if (action === 'taxibee-passenger-delete') { await owned(api.deletePassenger(el.dataset.id || '')); return act('taxibee-passengers', el); }
    if (action === 'taxibee-passenger-use') {
      const p = passengers.find(p => p.id === el.dataset.id); if (!p || !c.config()?.bookForOthersEnabled) throw new Error('Booking for other passengers is not available.');
      state.isBookingForSomeoneElse = true; state.otherTravelerName = p.name; state.otherTravelerPhone = p.phone;
      ui.closeModal(); ui.navigate('book'); return;
    }
    if (action === 'taxibee-locations') {
      const result = await owned(api.getLocations());
      return ui.openModal('Saved pickup points', result.locations.map(l => `<article class="card"><strong>${esc(l.label)}</strong><p>${esc(l.area)} ${esc(l.address)}</p>${button('taxibee-location-delete', 'Remove', `data-id="${esc(l.id)}"`)}</article>`).join('') + field('taxibee-location-label', 'Label') + field('taxibee-location-area', 'Area') + field('taxibee-location-address', 'Address'), button('taxibee-location-save', 'Save pickup point'));
    }
    if (action === 'taxibee-location-save') { await owned(api.saveLocation({ label: input('taxibee-location-label'), area: input('taxibee-location-area'), address: input('taxibee-location-address') })); return act('taxibee-locations', el); }
    if (action === 'taxibee-location-delete') { await owned(api.deleteLocation(el.dataset.id || '')); return act('taxibee-locations', el); }
    if (action === 'taxibee-rating-form') return ui.openModal('Rate your journey', field('taxibee-rating', 'Rating (1 to 5)', 'number', 'min="1" max="5" step="1"') + field('taxibee-rating-comment', 'Comments (optional)'), button('taxibee-rating-save', 'Save rating'));
    if (action === 'taxibee-rating-save') { await owned(api.rateOrder(requireBooking().orderId, { rating: Number(input('taxibee-rating')), comment: input('taxibee-rating-comment') })); ui.closeModal(); ui.toast('Your rating was saved in Peebee.', 'success'); return; }
    if (action === 'taxibee-display') {
      const value = el.dataset.value || ''; if (!displayOptions.includes(value)) return;
      document.body.classList.toggle(value);
      localStorage.setItem(`taxibee-display:${nowUser()}`, JSON.stringify(Object.fromEntries(displayOptions.map(k => [k, document.body.classList.contains(k)]))));
      ui.renderCurrentScreen(); return;
    }
    if (action === 'taxibee-password-reset-form') return ui.openModal('Reset your Peebee password', field('taxibee-reset-identifier', 'Phone or email'), button('taxibee-password-reset-request', 'Send reset code'));
    if (action === 'taxibee-password-reset-request') {
      resetIdentifier = input('taxibee-reset-identifier');
      const result = await owned(api.requestPasswordReset(resetIdentifier));
      return ui.openModal('Enter password reset code', `<p>${result.target ? `Enter the code sent to ${esc(result.target)}.` : 'If this account can receive a reset code, one has been sent.'}</p>` + field('taxibee-reset-code', 'Reset code', 'text', 'autocomplete="one-time-code" inputmode="numeric"') + field('taxibee-reset-password', 'New password', 'password', 'autocomplete="new-password"'), button('taxibee-password-reset-confirm', 'Reset password and sign in'));
    }
    if (action === 'taxibee-password-reset-confirm') {
      if (!resetIdentifier) throw new Error('Request a reset code first.');
      const password = (document.getElementById('taxibee-reset-password') as HTMLInputElement).value;
      const result = await owned(api.confirmPasswordReset(resetIdentifier, input('taxibee-reset-code'), password));
      if (result.user.role !== 'customer') throw new Error('Please use a Peebee customer account.');
      resetIdentifier = '';
      await c.finishSession(result); return;
    }
    if (action === 'taxibee-feature-refresh') return load(state.screen);
    if (action === 'taxibee-track-booking') { requireBooking(); return ui.navigate('tracking'); }
    if (action === 'taxibee-open-chat') { requireBooking(); return ui.navigate('driver-chat'); }
    if (action === 'taxibee-open-call') { requireBooking(); return ui.navigate('driver-call'); }
    if (action === 'taxibee-chat-send') {
      const text = input('taxibee-message'); if (!text) throw new Error('Enter a message.');
      await owned(api.sendChat(requireBooking().orderId, text));
      const field = document.getElementById('taxibee-message') as HTMLInputElement; field.value = '';
      return reloadScreen('driver-chat');
    }
    if (action === 'taxibee-ticket-download') {
      const b = requireBooking(); if (!b.ticketCode) throw new Error('This ticket has no boarding code yet.');
      const qr = await owned(QRCode.toDataURL(ticketUrl(b), { width: 240, margin: 1 }));
      download(`Taxibee-${b.id.replace(/[^a-z0-9_-]/gi, '')}.html`, `<!doctype html><html><head><meta charset="utf-8"><title>Taxibee ticket</title><style>body{font:18px system-ui;max-width:560px;margin:40px auto;padding:24px;color:#1a1a1a;background:#faf8ef}img{width:240px}h1{border-bottom:4px solid #c9a227}</style></head><body><h1>Taxibee by Peebee</h1><h2>${esc(b.route.fromName)} → ${esc(b.route.toName)}</h2><p>Passenger: ${esc(b.details?.travellerName || c.user()?.name)}</p><p>Reference: ${esc(b.id)}</p><p>${esc(b.taxi.plate)} · ${b.seats} space(s)</p>${b.seatNumbers?.length ? `<p>Seat numbers: ${esc(b.seatNumbers.join(', '))}</p>` : ''}<p>Booking: ${esc(b.status)} · Payment: ${esc(b.paymentStatus)}</p><p>Amount: ${money(b.amount)}</p><img src="${qr}" alt="Boarding QR"><h2>${esc(b.ticketCode)}</h2><p><a href="${esc(ticketUrl(b))}">Check current ticket status</a></p><p>Saved ${esc(new Date().toISOString())}. Current server status determines boarding eligibility.</p></body></html>`, 'text/html');
      return;
    }
    if (action === 'taxibee-wallet-statement') {
      const wallet = await owned(api.getWallet());
      const csv = (value: unknown) => {
        let text = String(value ?? ''); if (typeof value === 'string' && /^[=+@\-\t\r]/.test(text)) text = "'" + text;
        return '"' + text.replaceAll('"', '""') + '"';
      };
      const rows = [['Reference', 'Date', 'Type', 'Amount UGX', 'Note'], ...wallet.ledger.map(l => [l.id, l.created_at, l.type, l.amount, l.note])];
      download('Taxibee-wallet.csv', rows.map(row => row.map(csv).join(',')).join('\r\n'), 'text/csv;charset=utf-8'); return;
    }
    if (action === 'taxibee-ticket-share-form') {
      if (!c.config()?.ticketSharingEnabled) throw new Error('Ticket sharing is switched off.');
      return ui.openModal('Send your ticket', field('taxibee-share-name', 'Traveller name') + field('taxibee-share-phone', 'Traveller phone', 'tel'), button('taxibee-ticket-share', 'Send ticket'));
    }
    if (action === 'taxibee-ticket-share') {
      const b = requireBooking();
      await owned(api.sendTaxipressTicket(b.id, { name: input('taxibee-share-name'), phone: input('taxibee-share-phone') }));
      await owned(c.refresh()); ui.closeModal(); ui.toast('Peebee saved the ticket recipient.', 'success'); return;
    }
    if (action === 'taxibee-notifications-read') { await owned(api.markWalletAlertsRead()); return reloadScreen('notifications'); }
    if (action.startsWith('taxibee-support-')) {
      if (action === 'taxibee-support-new') { support = null; supportView = null; sessionStorage.removeItem(`taxibee-support:${nowUser()}`); support = await owned(supportRequest<SupportSession>('', { app: 'customer', page: 'Taxibee Help & Support' })); sessionStorage.setItem(`taxibee-support:${nowUser()}`, JSON.stringify(support)); }
      else {
        if (!support) throw new Error('Open Help and Support to start a conversation.');
        const endpoint = action === 'taxibee-support-send' ? '/messages' : action === 'taxibee-support-handoff' ? '/handoff' : '/end';
        const text = input('taxibee-message');
        if (endpoint === '/messages' && !text) throw new Error('Enter a message.');
        await owned(supportRequest(`/${encodeURIComponent(support.id)}${endpoint}`, endpoint === '/messages' ? { text } : {}, support.secret));
      }
      return reloadScreen('support');
    }
    if (action === 'taxibee-transfer-form') {
      transfer = null;
      return ui.openModal('Send Peebee wallet funds', field('taxibee-transfer-recipient', 'Recipient phone or email') + field('taxibee-transfer-amount', 'Amount (UGX)', 'number', 'min="1" step="1"') + field('taxibee-transfer-note', 'Note (optional)'), button('taxibee-transfer-review', 'Review transfer'));
    }
    if (action === 'taxibee-transfer-review') {
      const amount = Number(input('taxibee-transfer-amount'));
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Enter an amount in whole UGX.');
      const recipient = await owned(api.lookupRecipient(input('taxibee-transfer-recipient')));
      transfer = { recipientId: recipient.recipientId, name: recipient.name, amount, note: input('taxibee-transfer-note'), key: crypto.randomUUID() };
      return ui.openModal('Confirm wallet transfer', `<p>Send <strong>${money(amount)}</strong> to <strong>${esc(recipient.name)}</strong> (${esc(recipient.maskedPhone)})?</p><p>${esc(transfer.note)}</p>`, button('taxibee-transfer-confirm', 'Confirm transfer'));
    }
    if (action === 'taxibee-transfer-confirm') {
      if (!transfer) throw new Error('Review the recipient and amount first.');
      const result = await owned(api.transferWallet({ recipientId: transfer.recipientId, amount: transfer.amount, note: transfer.note, idempotencyKey: transfer.key }));
      transfer = null; await owned(c.refresh()); ui.closeModal(); ui.navigate('wallet'); ui.toast(`Transfer saved for ${result.recipientName}.`, 'success'); return;
    }
    if (action === 'taxibee-verify-start') {
      const channel = el.dataset.channel === 'sms' ? 'sms' : 'email';
      const result = await owned(api.requestVerification(channel));
      return ui.openModal('Verify your account', `<p>Enter the code sent to ${esc(result.target)}.</p>` + field('taxibee-verify-code', 'Verification code', 'text', 'inputmode="numeric" autocomplete="one-time-code"'), button('taxibee-verify-confirm', 'Verify', `data-channel="${channel}"`));
    }
    if (action === 'taxibee-verify-confirm') {
      const result = await owned(api.confirmVerification(el.dataset.channel === 'sms' ? 'sms' : 'email', input('taxibee-verify-code')));
      c.applyUser(result.user); ui.closeModal(); ui.renderCurrentScreen(); return;
    }
    if (action === 'taxibee-password-form') return ui.openModal('Change your Peebee password', field('taxibee-current-password', 'Current password', 'password', 'autocomplete="current-password"') + field('taxibee-new-password', 'New password', 'password', 'autocomplete="new-password"'), button('taxibee-password-change', 'Change password'));
    if (action === 'taxibee-password-change') {
      const current = (document.getElementById('taxibee-current-password') as HTMLInputElement).value;
      const next = (document.getElementById('taxibee-new-password') as HTMLInputElement).value;
      const result = await owned(api.changePassword(current, next));
      c.saveToken(result.token); c.applyUser(result.user); ui.closeModal(); ui.toast('Password changed. Other Peebee sessions have been ended.', 'success'); return;
    }
  }
  const resetActions = new Set(['taxibee-password-reset-form', 'taxibee-password-reset-request', 'taxibee-password-reset-confirm']);
  const ownActions = new Set([...resetActions, 'taxibee-wallet-statement', 'taxibee-passengers', 'taxibee-passenger-save', 'taxibee-passenger-delete', 'taxibee-passenger-use', 'taxibee-locations', 'taxibee-location-save', 'taxibee-location-delete', 'taxibee-display', 'taxibee-rating-form', 'taxibee-rating-save', 'taxibee-feature-refresh', 'taxibee-track-booking', 'taxibee-open-chat', 'taxibee-open-call', 'taxibee-chat-send', 'taxibee-ticket-download', 'taxibee-ticket-share-form', 'taxibee-ticket-share', 'taxibee-notifications-read', 'taxibee-support-send', 'taxibee-support-handoff', 'taxibee-support-end', 'taxibee-support-new', 'taxibee-transfer-form', 'taxibee-transfer-review', 'taxibee-transfer-confirm', 'taxibee-verify-start', 'taxibee-verify-confirm', 'taxibee-password-form', 'taxibee-password-change']);
  const aliases: Record<string, string> = { 'chat-driver': 'taxibee-open-chat', 'review-chat-driver': 'taxibee-open-chat', 'modal-chat-driver': 'taxibee-open-chat', 'call-driver': 'taxibee-open-call', 'review-call-driver': 'taxibee-open-call', 'modal-call-driver': 'taxibee-open-call', 'download-demo': 'taxibee-ticket-download', 'share-demo': 'taxibee-ticket-share-form', 'share-trip': 'taxibee-ticket-share-form', 'send-passenger': 'taxibee-transfer-form', 'transfer-wallet': 'taxibee-transfer-form', 'mark-all-read': 'taxibee-notifications-read', 'chat-support': 'taxibee-feature-refresh' };
  document.addEventListener('click', event => {
    const target = event.target as Element;
    const screen = target.closest<HTMLElement>('[data-screen]')?.dataset.screen;
    if (screen && featureScreens.has(screen)) {
      event.preventDefault(); event.stopImmediatePropagation(); ui.closeModal(); ui.closeSideDrawer(); ui.closeSheet(); ui.navigate(screen); return;
    }
    const el = target.closest<HTMLElement>('[data-action]');
    const raw = el?.dataset.action || '', action = raw === 'download-demo' && state.screen === 'wallet' ? 'taxibee-wallet-statement' : aliases[raw] || raw;
    if (!el || !ownActions.has(action)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!c.user() && !resetActions.has(action) && !action.startsWith('taxibee-support-')) { c.requestLogin(state.screen); return; }
    if (pending) return;
    const owner = nowUser();
    pending = true; el.setAttribute('disabled', '');
    void act(action, el).catch(e => { if (owner === nowUser()) ui.toast(errorText(e), 'danger'); }).finally(() => { pending = false; el.removeAttribute('disabled'); });
  }, true);
  return {
    restorePreferences() {
      let saved: Record<string, boolean> = {};
      try { saved = JSON.parse(localStorage.getItem(`taxibee-display:${nowUser()}`) || '{}'); } catch { /* Defaults. */ }
      for (const key of displayOptions) document.body.classList.toggle(key, saved?.[key] === true);
    },
    reset() {
      ++epoch; if (poll) clearTimeout(poll); if (map) map.remove(); map = null;
      if (supportOwner) sessionStorage.removeItem(`taxibee-support:${supportOwner}`);
      support = null; supportView = null; supportOwner = ''; transfer = null; profile = null; tracking = null; messages = []; alerts = []; offers = null; loaded = ''; loadError = ''; resetIdentifier = '';
      passengers = []; for (const value of displayOptions) document.body.classList.remove(value);
    },
  };
}
