import {installAccountTools} from './account-tools';
import { createApiClient,type TaxipressBookingInput } from '../../../packages/shared/src/api-client';
import type { AuthUser, CustomerWallet } from '../../../packages/shared/src/domain';
import type { TaxipressBooking, TaxipressConfig } from '../../../packages/shared/src/taxipress';
import QRCode from 'qrcode';
import { installCustomerFeatures } from './customer-features';
import { installCustomerAuth } from './customer-auth';
import { installSeatSelection } from './seat-selection';
import { installParcelCharter } from './parcel-charter';
import {installReturnPackages} from './return-packages';
import {installTravelCredit} from './travel-credit';

// The presentation is intentionally retained verbatim. This boundary is the only
// place that translates Peebee records into the source interface's view model.
const ui = window as unknown as Record<string, any>;
const { appData, state, driversData } = ui.TaxibeeSource;
const luggageCatalog = appData.luggage.map((item: any) => ({ ...item }));
const preview = new URLSearchParams(location.search).get('preview') === '1';
const TOKEN = 'taxibee_customer_token';
let user: AuthUser | null = null;
let config: TaxipressConfig | null = null;
let bookings: TaxipressBooking[] = [];
let trips: any[] = [];
let queueDepartureTimes = new Map<string,string>();
let savedDepartureServerReady=false;
let scheduledDepartures: Array<{id:string;routeId:string;departsAt:string;seatsLeft:number;farePerSeat:number;plate:string;seatLayout:string;fromName:string;toName:string}> = [];
let selectedSchedule: (typeof scheduledDepartures)[number] | null = null;
let scheduledTickets: Record<string,any>[] = [];
let selectedScheduledTicket: Record<string,any> | null = null;
let scheduledPending: {ticketId:string;orderId:string} | null = null;
let scheduleDate = '';
let loading = false;
let sessionVersion = 0;
let refreshSequence = 0;
let error = '';
let busy = false;
let uncertainBooking = false;
let selectedBooking: TaxipressBooking | null = null;
let searchFilters:{vehicle:'all'|'14'|'18';minSpaces:number;period:'any'|'morning'|'afternoon'|'evening'}={vehicle:'all',minSpaces:1,period:'any'};
let pendingOrder: { booking: TaxipressBooking; order: { id: string } } | null = null;
let pendingPayment: string | null = null;
let wallet: CustomerWallet | null = null;
let previewEntered = false;
let features: ReturnType<typeof installCustomerFeatures> | undefined;
let account: ReturnType<typeof installCustomerAuth> | undefined;
let booting = true;
let seating: ReturnType<typeof installSeatSelection> | undefined;
let services: ReturnType<typeof installParcelCharter> | undefined;
let accountTools:ReturnType<typeof installAccountTools>|undefined;
let returnPackages:ReturnType<typeof installReturnPackages>|undefined;
let travelCredit:ReturnType<typeof installTravelCredit>|undefined;
const original = Object.fromEntries(['renderAuth', 'renderHome', 'renderBook', 'renderCurrentScreen', 'navigate', 'renderWallet', 'renderProfile', 'renderDigitalTicketCard', 'getTicketsData', 'confirmBooking', 'renderTracking'].map(k => [k, ui[k]]));
const $ = (s: string) => document.querySelector(s) as HTMLInputElement | null;
const escape = (s: unknown) => ui.escapeHtml(String(s ?? ''));
const money = (n: number) => ui.formatUGX(n);
const kampalaDate = (d: Date) => new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Kampala'}).format(d);
const message = (e: unknown) => e instanceof Error ? e.message : 'Please try again.';
const api = createApiClient({
  baseUrl: location.origin + '/api',
  getToken: () => sessionStorage.getItem(TOKEN) || localStorage.getItem(TOKEN),
  onUnauthorized: () => { if (!user && !sessionStorage.getItem(TOKEN) && !localStorage.getItem(TOKEN)) return; account?.rememberBooking(); clearSession(false); if (!booting) account?.open(state.screen, false); },
  fetchImpl: async (input, init) => {
    const version = sessionVersion;
    const response = await fetch(input, init);
    if (version !== sessionVersion) {
      await response.body?.cancel();
      throw new Error('The signed-in session changed.');
    }
    return response;
  },
});
// Compatibility for the source's QR constructor, bundled locally for offline use.
ui.QRCode = class {
  static CorrectLevel = { M: 'M' };
  constructor(target: HTMLElement, options: { text: string; width: number }) {
    void QRCode.toDataURL(options.text, { width: options.width, margin: 1 }).then(src => {
      const img = new Image(); img.src = src; img.alt = 'Ticket QR code'; target.replaceChildren(img);
    });
  }
};
const empty = (title: string, copy: string) => `<section class="taxibee-empty" role="status"><h2>${escape(title)}</h2><p>${escape(copy)}</p><button class="button button--primary" type="button" data-action="taxibee-refresh">Refresh</button></section>`;
const report = (e: unknown) => ui.toast(message(e), 'danger');
ui.emptyState = (_icon: string, title: string, copy: string) => `<div class="empty-state"><h3>${escape(title)}</h3><p>${escape(copy)}</p></div>`;
async function savedDepartureRequest(method:'GET'|'PUT'|'DELETE',queueId?:string) {
  const version=sessionVersion,token=sessionStorage.getItem(TOKEN)||localStorage.getItem(TOKEN);
  const response=await fetch(`/api/v1/taxipress/saved-departures${queueId?`/${encodeURIComponent(queueId)}`:''}`,{method,headers:{...(token?{Authorization:`Bearer ${token}`}:{})}});
  if(version!==sessionVersion){await response.body?.cancel();throw new Error('The signed-in session changed.');}
  const result=await response.json();
  if(!response.ok)throw new Error(result.message||'Saved departures could not be updated.');
  return result as {ready:boolean;savedIds:string[];saved:boolean};
}

function clearSession(discardDraft = true) {
  if (discardDraft) account?.clearDraft();
  ++sessionVersion; loading = false;
  features?.reset();
  savedDepartureServerReady=false;
  seating?.reset();
  accountTools?.reset();
  services?.reset(discardDraft);
  returnPackages?.reset();
  travelCredit?.reset();
  user = null; bookings = []; scheduledTickets=[]; selectedScheduledTicket=null; scheduledPending=null; selectedSchedule=null; wallet = null; selectedBooking = null; pendingOrder = null; pendingPayment = null;
  restoreSavedDepartures();restoreSearchFilters();
  localStorage.removeItem(TOKEN); sessionStorage.removeItem(TOKEN);
  state.tickets = []; state.walletBalance = 0; appData.transactions = [];
  state.taxibeeOfferCode = ''; state.taxibeeOpenTicket = false;
  state.emergencyContact = ''; state.otherTravelerName = ''; state.otherTravelerPhone = ''; state.isBookingForSomeoneElse = false;
  ui.closeModal();
}
function restoreSavedDepartures() {
  try {
    const saved=JSON.parse(localStorage.getItem(`taxibee-saved-departures:${user?.id||'guest'}`)||'[]');
    state.savedDepartures=Array.isArray(saved)?[...new Set(saved.filter((id:unknown)=>typeof id==='string'&&id.length<=100))].slice(0,30):[];
  } catch { state.savedDepartures=[]; }
}
function restoreSearchFilters() {
  try {
    const raw=JSON.parse(localStorage.getItem(`taxibee-search-filters:${user?.id||'guest'}`)||'{}');
    searchFilters={vehicle:['all','14','18'].includes(raw.vehicle)?raw.vehicle:'all',minSpaces:[1,2,3,4,5,6,8,10].includes(raw.minSpaces)?raw.minSpaces:1,period:['any','morning','afternoon','evening'].includes(raw.period)?raw.period:'any'};
  } catch { searchFilters={vehicle:'all',minSpaces:1,period:'any'}; }
}
function filteredTrips(source:any[]) {
  return source.filter(t=>{
    if(searchFilters.vehicle!=='all'&&!String(t.vehicle||'').includes(searchFilters.vehicle)) return false;
    if(Number(t.seats||0)<searchFilters.minSpaces) return false;
    if(searchFilters.period!=='any') {
      if(!t.departsAt) return false;
      const date=new Date(t.departsAt);if(!Number.isFinite(date.getTime())) return false;
      const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Kampala',hour:'2-digit',hourCycle:'h23'}).format(date));
      if(searchFilters.period==='morning'&&(hour<5||hour>=12)) return false;
      if(searchFilters.period==='afternoon'&&(hour<12||hour>=17)) return false;
      if(searchFilters.period==='evening'&&(hour<17||hour>23)) return false;
    }
    return true;
  });
}
function openLiveSearchFilters() {
  ui.openModal('Search filters',`<p class="muted">These filters narrow Peebee’s current live departures. Availability and fares remain controlled by Peebee.</p><div class="form-grid"><div class="field"><label for="taxibee-filter-vehicle">Vehicle type</label><select id="taxibee-filter-vehicle"><option value="all" ${searchFilters.vehicle==='all'?'selected':''}>All vehicles</option><option value="14" ${searchFilters.vehicle==='14'?'selected':''}>Commuter · 14 seats</option><option value="18" ${searchFilters.vehicle==='18'?'selected':''}>Highroof · 18 seats</option></select></div><div class="field"><label for="taxibee-filter-spaces">Minimum available spaces</label><select id="taxibee-filter-spaces">${[1,2,3,4,5,6,8,10].map(n=>`<option value="${n}" ${searchFilters.minSpaces===n?'selected':''}>${n}+ spaces</option>`).join('')}</select></div><div class="field"><label for="taxibee-filter-period">Estimated departure time</label><select id="taxibee-filter-period"><option value="any" ${searchFilters.period==='any'?'selected':''}>Any time</option><option value="morning" ${searchFilters.period==='morning'?'selected':''}>Morning · 05:00–11:59</option><option value="afternoon" ${searchFilters.period==='afternoon'?'selected':''}>Afternoon · 12:00–16:59</option><option value="evening" ${searchFilters.period==='evening'?'selected':''}>Evening · 17:00–23:59</option></select></div></div>`,`<button class="button button--ghost" type="button" data-action="close-modal">Cancel</button><button class="button button--primary" type="button" data-action="taxibee-search-filters-save">Apply filters</button>`);
}
function applyUser(next: AuthUser) {
  user = next;
  restoreSavedDepartures();
  restoreSearchFilters();
  void accountTools?.sync();
  features?.restorePreferences();
  state.userName = escape(next.name); state.userEmail = escape(next.email); state.userPhone = escape(next.phone);
  state.userAvatar = 'assets/peebee-logo.svg';
  state.contactName = next.name;
  state.passengerDetails = [{ name: next.name, phone: next.phone || '', category: 'Adult passenger', assistance: 'None required', emergency: '' }];
  appData.passenger = { name: escape(next.name), phone: escape(next.phone), email: escape(next.email), preferredRoute: '' };
  document.querySelectorAll<HTMLImageElement>('.desktop-profile-btn img, .profile-avatar').forEach(img => { img.src = 'assets/peebee-logo.svg'; img.alt = next.name; });
  const drawerName = document.querySelector('.side-drawer__header h3'); if (drawerName) drawerName.textContent = next.name;
  const drawerPhone = document.querySelector('.side-drawer__header p'); if (drawerPhone) drawerPhone.textContent = next.phone || '';
  document.querySelectorAll('.account-item small').forEach(el => { el.textContent = next.name; });
  $('#notification-badge')?.classList.add('is-hidden');
  const signOut = document.querySelector('.drawer-nav-item--signout span'); if (signOut) signOut.textContent = 'Sign out';
}
function applyGuest() {
  restoreSavedDepartures();
  restoreSearchFilters();
  state.userName = 'Guest'; state.userPhone = ''; state.userEmail = ''; state.userAvatar = 'assets/peebee-logo.svg';
  state.contactName = '';
  state.passengerDetails = [{ name: 'Guest', phone: '', category: 'Adult passenger', assistance: 'None required', emergency: '' }];
  appData.passenger = { name: 'Guest', phone: '', email: '', preferredRoute: '' };
  $('#notification-badge')?.classList.add('is-hidden');
  document.querySelectorAll('.account-item small').forEach(el => { el.textContent = 'Sign in'; });
  document.querySelectorAll<HTMLImageElement>('.desktop-profile-btn img, .profile-avatar').forEach(img => { img.src = 'assets/peebee-logo.svg'; img.alt = 'Sign in to Peebee'; });
  const name = document.querySelector('.side-drawer__header h3'); if (name) name.textContent = 'Guest';
  const phone = document.querySelector('.side-drawer__header p'); if (phone) phone.textContent = 'Browse freely · sign in to book';
  const signOut = document.querySelector('.drawer-nav-item--signout span'); if (signOut) signOut.textContent = 'Sign in';
}
async function apiLogoutToken(token: string) {
  await fetch('/api/v1/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
}

function routeImage(name: string) {
  const n = name.toLowerCase();
  return `assets/${['entebbe', 'kampala', 'masaka', 'mbarara', 'lyantonde', 'nambole'].find(k => n.includes(k)) || 'kampala'}.jpg`;
}
function childSeats() {
  return Math.max(0, state.childCount - (config?.maxLapChildren ?? 0), Math.min(state.childCount, state.reservedChildSeatsCount || 0));
}
function ticket(b: TaxipressBooking) {
  return {
    id: b.id, bookingRef: b.id, route: `${escape(b.route.fromName)} → ${escape(b.route.toName)}`,
    cityA: escape(b.route.fromName), cityB: escape(b.route.toName), stageA: escape(b.route.fromName), stageB: escape(b.route.toName),
    via: escape(b.route.directionLabel), date: new Date(b.createdAt).toLocaleDateString('en-UG', { timeZone: 'Africa/Kampala' }),
    time: b.taxi.status === 'on_road' ? 'On the road' : 'Stage departure', seat: b.seatNumbers?.length ? b.seatNumbers.join(', ') : `${b.seats} reserved space${b.seats === 1 ? '' : 's'}`,
    passenger: escape(user?.name), price: money(b.amount), status: ['booked', 'boarded'].includes(b.status) ? 'active' : 'used',
    vanNumber: escape(b.taxi.plate), driver: escape(b.taxi.driverName || 'Driver'), avatar: 'assets/peebee-logo.svg',
    qrData: b.ticketCode ? `https://app.peebee.online/ticket/${encodeURIComponent(b.ticketCode)}` : '',
  };
}
async function refresh() {
  if (preview) return;
  const run = ++refreshSequence, version = sessionVersion;
  const valid = () => run === refreshSequence && version === sessionVersion;
  loading = true; error = '';
  try {
    const nextConfig = await (user ? api.getTaxipressConfig() : api.getPublicTaxipressConfig());
    if (!valid()) return;
    const scheduleTo = new Date(Date.now() + (nextConfig.scheduleMaxAdvanceDays ?? 60) * 86400_000).toISOString();
    const nextSchedules = nextConfig.scheduledDeparturesEnabled ? await api.getTaxipressPublicDepartures({from:new Date().toISOString(),to:scheduleTo}) : {departures:[],ready:false};
    if (!valid()) return;
    scheduledDepartures = nextSchedules.departures;
    const savedPromise=user?savedDepartureRequest('GET').catch(()=>({ready:false,savedIds:[],saved:false})):Promise.resolve({ready:false,savedIds:[],saved:false});
    const queues = await Promise.all(nextConfig.routes.map(async route => ({ route, queue: await (user ? api.getTaxipressQueue(route.id) : api.getPublicTaxipressQueue(route.id)) })));
    if (!valid()) return;
    const savedState=await savedPromise;
    if (!valid()) return;
    queueDepartureTimes = new Map(queues.flatMap(({queue})=>queue.line.flatMap(entry=>entry.departsAt?[[entry.id,entry.departsAt] as [string,string]]:[])));
    const activeDepartureIds=new Set(queues.flatMap(({queue})=>queue.line.filter(entry=>entry.bookable===true).map(entry=>entry.id)));
    const localSaved=(Array.isArray(state.savedDepartures)?state.savedDepartures:[]).filter((id:string)=>activeDepartureIds.has(id));
    savedDepartureServerReady=!!user&&savedState.ready;
    if(savedDepartureServerReady) {
      const remoteSaved=savedState.savedIds.filter(id=>activeDepartureIds.has(id));
      state.savedDepartures=[...new Set([...remoteSaved,...localSaved])].slice(0,30);
      const localOnly=localSaved.filter(id=>!remoteSaved.includes(id));
      if(localOnly.length) {
        const synced=await Promise.all(localOnly.map(id=>savedDepartureRequest('PUT',id).then(()=>true,()=>false)));
        if(synced.some(ok=>!ok))savedDepartureServerReady=false;
      }
    } else state.savedDepartures=localSaved;
    try { localStorage.setItem(`taxibee-saved-departures:${user?.id||'guest'}`,JSON.stringify(state.savedDepartures)); } catch { /* Keep in-memory choices for this session. */ }
    config = nextConfig;
    appData.routeCards = config.routes.map(r => ({ key: r.id, cityA: escape(r.fromName), cityB: escape(r.toName), stageA: escape(r.fromName), stageB: escape(r.toName), via: escape(r.directionLabel), price: money(r.farePerSeat), imageA: routeImage(r.fromName), imageB: routeImage(r.toName), corridor: (r.stops || []).map(escape).join(' • '), coordA: null, coordB: null }));
    appData.routes = [...new Set(config.routes.flatMap(r => [r.fromName, r.toName, ...(r.stops || [])]))];
    trips = queues.flatMap(({ route, queue }) => queue.line.filter(v => v.bookable === true).map(v => ({
      id: v.id, routeId: route.id, departsAt:v.departsAt||null, depart: v.departsAt ? new Date(v.departsAt).toLocaleTimeString('en-UG', { timeZone: 'Africa/Kampala', hour: 'numeric', minute: '2-digit' }) : 'Stage departure',
      arrive: 'On arrival', seats: v.seatsLeft, status: v.seatsLeft ? 'Available' : 'Full', vehicle: `${v.seatLayout === '18' ? 'Highroof' : 'Commuter'} (${v.seatLayout})`,
      plate: escape(v.plate), duration: 'Stage service', fare: route.farePerSeat, boarding: escape(route.fromName), destination: escape(route.toName),
      currentStage: escape(route.fromName), comingFrom: escape(route.fromName), headingTo: escape(route.toName), markerIndex: 0,
      vansAtStage: queue.line.length, vansApproaching: 0, driverName: escape(v.driverName || 'Driver'), driverPhone: '', driverRating: '—',
      countdown: v.position ? `Queue ${v.position}` : 'Waiting', img: v.seatLayout === '18' ? 'assets/taxibee-highroof-branded.png' : 'assets/taxibee-van.png',
      destThumb: routeImage(route.toName), price: money(route.farePerSeat), via: escape(route.directionLabel),
    })));
    // Never retain a taxi which has left the queue after a refresh.
    state.activeTrip = trips.find(t => t.id === state.activeTrip?.id) || trips[0] || null;
    if (state.activeTrip && !config.routes.some(r => r.fromName === state.searchFrom && r.toName === state.searchTo)) {
      state.searchFrom = state.activeTrip.boarding; state.searchTo = state.activeTrip.destination;
    }
    appData.trips = trips;
    appData.luggage = luggageCatalog.filter((l: any) => config?.luggageEnabled && config.luggageTypes?.includes(l.id)).map((l: any) => ({ ...l, price: config?.luggagePrices?.[l.id as keyof NonNullable<TaxipressConfig['luggagePrices']>] ?? 0 }));
    if (user) {
      const [mine, balance, future] = await Promise.all([api.getMyTaxipressBookings(), api.getWallet(), api.getMyTaxipressScheduledTickets()]);
      if (!valid()) return;
      bookings = mine.bookings; wallet = balance; state.walletBalance = balance.balance;
      scheduledTickets = future.tickets;
      await travelCredit?.load().catch(()=>undefined);
      if (!valid()) return;
      state.tickets = bookings.map(ticket);
      appData.transactions = balance.ledger.map((l: any) => ({ type: l.amount >= 0 ? 'deposit' : 'trip', title: escape(l.note || l.type || 'Wallet activity'), date: escape(l.created_at), amount: Math.abs(l.amount), direction: l.amount >= 0 ? 'in' : 'out', icon: l.amount >= 0 ? 'arrow-down-left' : 'arrow-up-right' }));
    }
  } catch (e) { if (valid()) { error = message(e); throw e; } }
  finally { if (valid()) loading = false; }
}

function renderLiveTicket(b: TaxipressBooking | null = selectedBooking || bookings[0]) {
  if(selectedScheduledTicket) {
    const t=selectedScheduledTicket;
    const paid=Number(t.paid)===1, pending=Number(t.pending)===1, stateText=String(t.state||'reserved');
    const when=new Date(String(t.departsAt).replace(' ','T')+(String(t.departsAt).endsWith('Z')?'':'Z')).toLocaleString('en-UG',{timeZone:'Africa/Kampala',dateStyle:'full',timeStyle:'short'});
    const operatorCancelled=t.departureState==='cancelled'&&stateText==='reserved';
    return `${ui.screenHead('Scheduled departure ticket','Your booking is saved with Peebee.')}
      <article class="card"><h2>${escape(t.fromName)} → ${escape(t.toName)}</h2><p>${escape(when)} · Kampala time</p><p>${escape(t.plate)} · ${Number(t.seats)} seat${Number(t.seats)===1?'':'s'}</p><p>Booking: ${operatorCancelled?'Departure cancelled · refund processing':escape(stateText)} · Payment: ${paid?'Paid':pending?'Provider confirmation pending':'Payment required'}</p><p>Total: ${money(Number(t.amount))}</p>${t.ticketCode?`<p>Boarding code: <strong>${escape(t.ticketCode)}</strong></p>`:''}${stateText==='reserved'&&t.departureState==='published'&&paid&&isFutureDeparture(t.departsAt)?`<button class="button button--ghost" data-action="taxibee-calendar-export" data-kind="scheduled" data-id="${escape(t.id)}">Add departure to calendar</button>`:''}${stateText==='reserved'&&!paid&&!operatorCancelled?`<button class="button button--primary" data-action="taxibee-future-pay" data-id="${escape(t.id)}">Pay ${money(Number(t.amount))}</button>`:''}${stateText==='reserved'&&t.queueId==null&&!operatorCancelled?`<button class="button button--ghost" data-action="taxibee-future-cancel" data-id="${escape(t.id)}">Cancel scheduled booking</button>`:''}<button class="button button--ghost" data-action="taxibee-future-refresh" data-id="${escape(t.id)}">Refresh status</button></article>`;
  }
  if (!b) return empty('No tickets yet', 'Bookings made in either Taxibee or Peebee appear here.');
  const status = b.paymentStatus === 'unpaid' ? 'Payment required' : b.paymentMethod === 'cash' ? 'Cash due at stage' : b.paymentStatus;
  const q = b.ticketCode;
  const estimatedDeparture=queueDepartureTimes.get(b.taxi.queueId);
  return `${ui.screenHead('Digital passenger ticket', 'Your Peebee TaxiPress booking.')}
    ${ui.renderDigitalTicketCard(ticket(b), false)}
    <article class="card"><div class="detail-list">${ui.ticketField('Booking status', escape(b.status))}${ui.ticketField('Payment', escape(status))}${ui.ticketField('Boarding code', escape(q || 'Available after payment'))}</div>
    ${b.status==='booked'&&['paid','pay_driver'].includes(b.paymentStatus)&&estimatedDeparture&&isFutureDeparture(estimatedDeparture)?`<button class="button button--ghost" data-action="taxibee-calendar-export" data-kind="stage" data-id="${escape(b.id)}">Add estimated departure to calendar</button>`:''}
    ${b.paymentStatus === 'unpaid' ? `<button class="button button--primary" data-action="taxibee-pay" data-id="${escape(b.id)}">Pay for this booking</button>` : ''}
    ${b.cancel.allowed ? `<button class="button button--ghost" data-action="taxibee-cancel" data-id="${escape(b.id)}">Cancel · ${b.cancel.free ? 'No fee' : money(b.cancel.fee)}</button>` : ''}
    <button class="button button--ghost" data-action="taxibee-refresh">Refresh status</button></article>`;
}

function calendarText(value: unknown) { return String(value ?? '').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;'); }
function departureInstant(rawValue:unknown) {
  const raw=String(rawValue??'');
  const parsed=new Date(raw.replace(' ','T')+(raw.endsWith('Z')?'':'Z'));
  return Number.isFinite(parsed.getTime())?parsed:null;
}
function isFutureDeparture(rawValue:unknown) { const date=departureInstant(rawValue);return !!date&&date.getTime()>Date.now(); }
function downloadCalendar(ticket: Record<string, any>, estimated=false) {
  const departure=departureInstant(ticket.departsAt);
  if(!departure||departure.getTime()<=Date.now()) throw new Error('Peebee has not provided a future departure time for this ticket.');
  const stamp=(date:Date)=>date.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
  const kind=estimated?'Estimated stage departure':'Scheduled departure';
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Peebee//Taxibee//EN','CALSCALE:GREGORIAN','BEGIN:VEVENT',`UID:taxibee-${calendarText(ticket.id)}@taxibee.peebee.online`,`DTSTAMP:${stamp(new Date())}`,`DTSTART:${stamp(departure)}`,`SUMMARY:${calendarText(`${estimated?'Estimated ':''}Taxibee departure: ${ticket.fromName} to ${ticket.toName}`)}`,`LOCATION:${calendarText(`Peebee stage, ${ticket.fromName}`)}`,`DESCRIPTION:${calendarText(`${kind}. ${estimated?'This time is an estimate from Peebee and may change. ':''}Booking reference: ${ticket.id}. Check the Taxibee ticket for current status.`)}`,'END:VEVENT','END:VCALENDAR'];
  const blob=new Blob([lines.join('\r\n')+'\r\n'],{type:'text/calendar;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=`Taxibee-${String(ticket.id).replace(/[^a-z0-9_-]/gi,'')}.ics`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function bookingInput(seatHoldId?:string):TaxipressBookingInput {
  return {queueId:state.activeTrip.id,adults:state.passengerCount,children:state.childCount,childSeats:childSeats(),
    luggage:config?.luggageEnabled?state.luggageQuantities:undefined,
    assistance:config?.assistanceEnabled?({'None required':'none','Boarding help':'boarding','Priority seating':'priority','Mobility support':'mobility'} as any)[state.assistance]||'none':undefined,
    language:config?.languageEnabled?config.languages?.find(l=>l.name===state.language)?.code:undefined,
    forSomeoneElse:state.isBookingForSomeoneElse,travellerName:state.isBookingForSomeoneElse?state.otherTravelerName:undefined,
    travellerPhone:state.isBookingForSomeoneElse?state.otherTravelerPhone:undefined,emergencyPhone:state.isBookingForSomeoneElse?state.emergencyContact||undefined:undefined,
    openTicket:state.taxibeeOpenTicket===true,seatHoldId};
}
async function confirmBooking() {
  if (preview) return original.confirmBooking();
  if (!user) { account?.open('checkout'); return; }
  if (busy) return;
  if (!$('#booking-conditions')?.checked) return ui.toast('Accept the booking conditions to continue.', 'danger');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kampala' }).format(new Date());
  if (state.bookingDate !== today && !pendingOrder && !selectedSchedule) return ui.toast('Choose a published future departure or choose today for a stage taxi.', 'info');
  if ((!state.activeTrip || (!config?.enabled && !selectedSchedule)) && !pendingOrder) return ui.toast('Choose a currently available taxi.', 'danger');
  if (selectedSchedule && !pendingOrder) {
    if (state.ticketType === 'return' || state.taxibeeOpenTicket) return ui.toast('Return bundles and open tickets are not offered for scheduled departures yet.', 'info');
    if (uncertainBooking) return ui.openModal('Check My Tickets before booking again', '<p>The previous booking response was interrupted. Refresh My Tickets to check whether Peebee saved it before starting a new booking.</p>', '<button class="button button--primary" data-action="taxibee-check-bookings">Check My Tickets</button>');
    busy = true; uncertainBooking = true;
    try {
      const requestKey=`taxibee-scheduled-request-${selectedSchedule.id}`;
      const requestId=sessionStorage.getItem(requestKey)||crypto.randomUUID(); sessionStorage.setItem(requestKey,requestId);
      const assistance=({'None required':'none','Boarding help':'boarding','Priority seating':'priority','Mobility support':'mobility'} as any)[state.assistance]||'none';
      const result=await api.bookTaxipressScheduledDeparture({departureId:selectedSchedule.id,seats:state.passengerCount+childSeats(),requestId,details:{
        adults:state.passengerCount,children:state.childCount,childSeats:childSeats(),luggage:config?.luggageEnabled?state.luggageQuantities:{},
        assistance:config?.assistanceEnabled?assistance:null,language:config?.languageEnabled?config.languages?.find(l=>l.name===state.language)?.code||null:null,
        forSomeoneElse:state.isBookingForSomeoneElse===true,travellerName:state.isBookingForSomeoneElse?state.otherTravelerName:null,
        travellerPhone:state.isBookingForSomeoneElse?state.otherTravelerPhone:null,emergencyPhone:state.isBookingForSomeoneElse?state.emergencyContact:null,
      }});
      scheduledPending={ticketId:result.ticketId,orderId:result.orderId}; sessionStorage.removeItem(requestKey); uncertainBooking=false;
      await payScheduled();
    } catch(e) { report(e); }
    finally { busy=false; }
    return;
  }
  if (pendingOrder && state.activeTrip?.id !== pendingOrder.booking.taxi.queueId) return ui.toast('Finish or cancel the existing unpaid ticket in My Tickets before booking another taxi.', 'danger');
  if(state.ticketType==='return'&&!pendingOrder){try{await returnPackages?.review();}catch(e){report(e);}return;}
  if (uncertainBooking) return ui.openModal('Check My Tickets before booking again', '<p>The previous booking response was interrupted. Refresh My Tickets to check whether Peebee saved it before starting a new booking.</p>', '<button class="button button--primary" data-action="taxibee-check-bookings">Check My Tickets</button>');
  busy = true;
  try {
    const seatHoldId = pendingOrder ? undefined : await seating?.prepare();
    uncertainBooking = !pendingOrder;
    pendingOrder ??= await api.bookTaxipressSeats(bookingInput(seatHoldId));
    account?.clearDraft();
    seating?.consumed();
    uncertainBooking = false;
    await payPending();
  } catch (e) { report(e); }
  finally { busy = false; }
}
async function payScheduled() {
  if(!scheduledPending) return;
  const method=state.paymentMethod;
  if(['corporate','voucher'].includes(method)) { await travelCredit?.review(scheduledPending.orderId,method); }
  else {
    if(!['wallet','mobile'].includes(method)) throw new Error('Scheduled departures are prepaid. Choose Peebee Wallet or mobile money.');
    const result=await api.fundOrder(scheduledPending.orderId,{paymentMethod:method==='mobile'?'mobile_money':'wallet',useWallet:method==='wallet',msisdn:method==='mobile'?$('#taxibee-msisdn')?.value:undefined,offerCode:$('#taxibee-offer-code')?.value.trim()||undefined});
    if(result.payment?.status==='failed') throw new Error('Payment failed. Check your payment details and try again.');
    pendingPayment=result.payment?.id||null;
    if(result.redirectUrl){location.assign(result.redirectUrl);return;}
  }
  const latest=(await api.getTaxipressScheduledTicket(scheduledPending.ticketId)).ticket;
  scheduledTickets=[latest,...scheduledTickets.filter(t=>t.id!==latest.id)];
  selectedScheduledTicket=latest; selectedSchedule=null; scheduledPending=null;
  await refresh(); ui.navigate('ticket');
  ui.toast(Number(latest.paid)===1?'Your scheduled booking is saved.':'Booking saved. Refresh after approving payment.','success');
}
async function payPending() {
  if (!pendingOrder) return;
  const method = state.paymentMethod;
  if (['corporate','voucher'].includes(method)) { await travelCredit?.review(pendingOrder.order.id,method); return; }
  if (!['wallet', 'mobile', 'cash'].includes(method)) throw new Error('Choose wallet, mobile money or cash.');
  if (method === 'cash' && !config?.cashEnabled) throw new Error('Cash is not enabled by the operator.');
  if (method === 'cash' && (state.taxibeeOpenTicket || pendingOrder.booking.openTicket)) throw new Error('An open ticket must be paid in the app.');
  if (pendingOrder.booking.paymentStatus === 'unpaid') {
    const result = await api.fundOrder(pendingOrder.order.id, { paymentMethod: method === 'mobile' ? 'mobile_money' : method, useWallet: method === 'wallet', msisdn: method === 'mobile' ? $('#taxibee-msisdn')?.value : undefined, offerCode: $('#taxibee-offer-code')?.value.trim() || undefined });
    if (result.payment?.status === 'failed') throw new Error('Payment failed. Check your payment details and try again.');
    pendingPayment = result.payment?.id || null;
    if (result.redirectUrl) { location.assign(result.redirectUrl); return; }
  }
  const result = await api.getTaxipressBooking(pendingOrder.booking.id);
  selectedBooking = result.booking;
  pendingOrder = null;
  await refresh(); ui.navigate('ticket');
  if (selectedBooking.paymentStatus === 'unpaid') ui.toast('Payment is pending. Approve the provider prompt, then refresh this ticket.', 'info');
  else ui.toast('Your booking is saved in Peebee.', 'success');
}

ui.Taxibee = {
  session: () => user ? { username: user.id, name: user.name, avatar: 'assets/peebee-logo.svg' } : previewEntered ? { username: 'preview', name: 'Design preview' } : null,
  authenticated: () => !!user || (preview && previewEntered),
  canBrowse: () => !preview || previewEntered,
  login: () => preview ? ui.toast('Practice does not sign in to Peebee.', 'info') : account?.open('profile'),
  register: () => preview ? ui.toast('Return to live Taxibee to create a Peebee account.', 'info') : account?.open('profile'),
};

function cleanHome() {
  const current = state.activeTrip;
  // The source reads an upcoming trip before rendering. An empty view model
  // lets its layout render without inventing an available departure.
  state.activeTrip ||= { boarding: '', destination: '', depart: '', plate: '' };
  const template = document.createElement('template');
  template.innerHTML = original.renderHome(); state.activeTrip = current;
  for (const section of template.content.querySelectorAll('section')) {
    const title = section.querySelector('h2,h3')?.textContent;
    if (title === 'Upcoming travel' || title === 'Active parcel') section.remove();
  }
  template.content.querySelector('.return-promo-card, .return-offer-card')?.remove();
  // Remove the static return promotion, whose deal is not a server quote.
  for (const el of template.content.querySelectorAll('section,article')) {
    if (el.querySelector('[data-screen="returns"]') && !el.querySelector('#servicesTitle')) el.remove();
  }
  for (const el of template.content.querySelectorAll('.wallet-credit')) el.textContent = `${money(wallet?.credit || 0)} promotional credit available`;
  if (!user) {
    const balance = template.content.querySelector('.wallet-card .wallet-balance'); if (balance) balance.textContent = 'Sign in to view your balance';
    const credit = template.content.querySelector('.wallet-credit'); if (credit) credit.textContent = 'Use your existing Peebee account';
  }
  for (const el of template.content.querySelectorAll('.notice')) el.remove();
  const savedTrips=(Array.isArray(state.savedDepartures)?state.savedDepartures:[]).map((id:string)=>trips.find(t=>t.id===id)).filter(Boolean);
  const savedPanel=savedTrips.length?`<section class="card"><h2>Saved departures</h2><p class="muted">Current Peebee availability. Saved departures can leave the queue at any time.</p>${savedTrips.map(t=>`<article class="ticket-list-item"><div><strong>${escape(t.boarding)} → ${escape(t.destination)}</strong><p>${escape(t.depart)} · ${escape(t.plate)} · ${Number(t.seats)} spaces · ${escape(money(t.fare))}</p></div><div class="button-row"><button class="button button--primary" data-action="select-departure-direct" data-trip-id="${escape(t.id)}">Choose</button><button class="button button--ghost" data-action="toggle-save-departure" data-dep-id="${escape(t.id)}" aria-label="Remove saved departure">Remove</button></div></article>`).join('')}</section>`:'';
  return template.innerHTML + savedPanel + (scheduledTickets[0] ? `<section class="card"><h3>Your scheduled journey</h3><p>${escape(scheduledTickets[0].fromName)} → ${escape(scheduledTickets[0].toName)}</p><button class="button button--primary" data-action="taxibee-future-ticket" data-id="${escape(scheduledTickets[0].id)}">View scheduled ticket</button></section>` : '') + (bookings[0] ? `<section class="card"><h3>Your latest journey</h3><p>${escape(bookings[0].route.fromName)} → ${escape(bookings[0].route.toName)}</p><button class="button button--primary" data-action="taxibee-ticket" data-id="${escape(bookings[0].id)}">View ticket</button></section>` : '') + (error ? empty('Unable to refresh departures', error) : !config?.enabled && !scheduledDepartures.length ? empty('TaxiPress is not running right now', 'Peebee administrators control when this service is available.') : !trips.length && !scheduledDepartures.length ? empty('No bookable departures', 'Check again when a taxi joins a running route.') : '');
}

if (!preview) {
  // Public screens must never fabricate stock, people, tickets or money.
  appData.routeCards = []; appData.routes = []; appData.trips = []; appData.transactions = []; appData.notifications = [];
  state.tickets = []; state.walletBalance = 0; state.userName = ''; state.userPhone = ''; state.userEmail = ''; state.activeTrip = null;
  state.unreadNotifications = 0;
  state.emergencyContact = '';
  state.bookingDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kampala' }).format(new Date());
  ui.getAvailableTrips = () => filteredTrips(trips);
  ui.getSearchResults = () => filteredTrips(trips).filter(t => t.boarding === state.searchFrom && t.destination === state.searchTo);
  ui.getTicketsData = () => state.tickets || [];
  ui.getDriverAvatar = () => 'assets/peebee-logo.svg';
  ui.getDriverHeroImage = () => state.activeTrip?.img || 'assets/taxibee-van.png';
  ui.getTripVehicleImage = (vehicle: string) => vehicle?.includes('18') ? 'assets/taxibee-highroof-branded.png' : 'assets/taxibee-van.png';
  ui.detectNearestCity = () => {};
  ui.simulateNavigation = (_message: string, screen: string) => ui.navigate(screen);
  ui.startLiveProgress = () => {}; // Tracking is based on API state, never an animation of a fictional journey.
  ui.checkoutBaseFare = () => {
    const adults = state.passengerCount;
    const fare = state.activeTrip?.fare || 0;
    return fare * adults + Math.round(fare * (config?.childSeatFarePercent ?? 100) / 100) * childSeats();
  };
  ui.passengerTotal = () => state.passengerCount + childSeats();
  ui.luggageTotal = () => config?.luggageEnabled ? appData.luggage.reduce((sum: number, l: any) => sum + (config?.luggagePrices?.[l.id as keyof NonNullable<TaxipressConfig['luggagePrices']>] ?? 0) * (state.luggageQuantities[l.id] || 0), 0) : 0;
  ui.seatReservationFee = () => seating?.fee() || 0;
  ui.checkoutTotal = () => {const p=state.ticketType==='return'?returnPackages?.estimate():null;return pendingOrder?.booking.amount??(p?p.out+p.back:ui.checkoutBaseFare()+ui.luggageTotal()+ui.seatReservationFee());};
  ui.confirmBooking = confirmBooking;
  ui.renderHome = cleanHome;
  ui.renderBook = () => {
    if (!config?.enabled && !scheduledDepartures.length) return empty('No bookable taxis', error || 'There are no taxis accepting bookings right now.');
    const template = document.createElement('template'); template.innerHTML = original.renderBook();
    const childFareHint = [...template.content.querySelectorAll('.stepper-card .muted.text-small')].find(el => el.textContent?.includes('Lap travel is free.'));
    if (childFareHint) childFareHint.textContent = state.ticketType === 'return'
      ? 'Reserved child seats are priced for each direction. The final package quote applies the configured child fare and return discount.'
      : `Reserved child seat: ${money(Math.round((state.activeTrip?.fare || 0) * (config?.childSeatFarePercent ?? 100) / 100))}. Lap travel follows the current child allowance.`;
    const traveller = template.content.querySelector('#other-traveler-phone')?.closest('.field');
    if (traveller && state.isBookingForSomeoneElse) traveller.insertAdjacentHTML('afterend', `<div class="field"><label for="taxibee-traveller-emergency">Traveller emergency contact</label><input id="taxibee-traveller-emergency" type="tel" value="${escape(state.emergencyContact)}"></div>`);
    if (config?.scheduledDeparturesEnabled) {
      if (!scheduleDate) { const next = new Date(); next.setDate(next.getDate()+1); scheduleDate = kampalaDate(next); }
      const slots = scheduledDepartures.filter(d => kampalaDate(new Date(d.departsAt)) === scheduleDate);
      const schedulePanel = `<article class="card"><h2>Future departures</h2><p>Published Peebee taxis with seats reserved for your selected date.</p><div class="field"><label for="taxibee-schedule-date">Departure date</label><input id="taxibee-schedule-date" type="date" min="${kampalaDate(new Date())}" max="${kampalaDate(new Date(Date.now()+(config.scheduleMaxAdvanceDays??60)*86400000))}" value="${escape(scheduleDate)}"></div>${slots.map(d=>`<div class="ticket-list-item"><div><strong>${escape(d.fromName)} → ${escape(d.toName)}</strong><p>${new Date(d.departsAt).toLocaleTimeString('en-UG',{timeZone:'Africa/Kampala',hour:'numeric',minute:'2-digit'})} · ${escape(d.plate)} · ${d.seatsLeft} seats · ${money(d.farePerSeat)}/seat</p></div><button type="button" class="button button--primary" data-action="taxibee-schedule-choose" data-id="${escape(d.id)}">Choose</button></div>`).join('')||`<p class="muted">No published departures for this date. Try another day.</p>`}</article>`;
      template.content.prepend(document.createRange().createContextualFragment(schedulePanel));
    }
    return template.innerHTML;
  };
  ui.renderCheckout = (() => {
    const originalCheckout = ui.renderCheckout;
    return () => {
      const template = document.createElement('template'); template.innerHTML = originalCheckout()
        .replace('Checkout and payment preview', 'Checkout and payment')
        .replace('Review the service total and choose a simulated payment method. No money will be processed.', 'Review your booking and choose how to pay through Peebee.')
        .replace('Demo mode', 'Peebee booking')
        .replace('This confirms only a presentation-state booking and does not create a real reservation.', 'Confirming creates a real booking. Current availability, price and cancellation rules apply.')
        .replace('No backend, gateway, mobile-money service or database will be contacted.', 'Bookings and payments are processed by Peebee. Mobile-money payments require provider approval.');
      template.content.querySelector('#booking-conditions')?.removeAttribute('checked');
      return template.innerHTML;
    };
  })();
  ui.renderPaymentPanel = () => `<div class="payment-panel"><p>${state.paymentMethod === 'wallet' ? `Your Peebee balance: ${money(state.walletBalance)}. The final amount is confirmed by Peebee.` : state.paymentMethod === 'cash' ? 'Pay the driver at the stage. Your ticket will reflect the server payment status.' : 'Approve the mobile-money prompt sent by your payment provider.'}</p>${state.paymentMethod === 'mobile' ? `<label for="taxibee-msisdn">Mobile-money number</label><input id="taxibee-msisdn" autocomplete="tel" inputmode="tel" value="${escape(user?.phone)}">` : ''}<label for="taxibee-offer-code">Peebee offer code (optional)</label><input id="taxibee-offer-code" autocomplete="off" value="${escape(state.taxibeeOfferCode || '')}"><p>Peebee checks eligibility and the final amount when you pay.</p>${config?.openTicketsEnabled ? `<label><input type="checkbox" id="taxibee-open-ticket" ${state.taxibeeOpenTicket ? 'checked' : ''}>Open ticket: valid on any taxi on this route, subject to Peebee's validity rules.</label>` : ''}</div>`;
  ui.renderStandardPaymentOptions = (method: string, name = 'payment-method') => `<div class="radio-cards">${ui.paymentChoiceTile('wallet', 'Peebee Wallet', `Available: ${money(state.walletBalance)}`, 'wallet-cards', method, name)}${ui.paymentChoiceTile('mobile', 'Mobile Money', 'Use your existing Peebee payment providers', 'smartphone', method, name)}${config?.cashEnabled&&!selectedSchedule ? ui.paymentChoiceTile('cash', 'Cash at Stage', 'Pay the driver before boarding', 'banknote', method, name) : ''}</div>`;
  ui.renderTicket = () => renderLiveTicket();
  ui.renderSuccess = () => renderLiveTicket();
  ui.renderDigitalTicketCard = (data: any, modal: boolean) => {
    const b = bookings.find(x => x.id === data?.id) || (selectedBooking?.id === data?.id ? selectedBooking : null);
    if (!b) return empty('Ticket unavailable', 'Refresh your bookings and try again.');
    const template = document.createElement('template'); template.innerHTML = original.renderDigitalTicketCard(data, modal);
    const area = template.content.querySelector('.ticket-code-area');
    if (area) area.innerHTML = b.ticketCode ? `<div data-real-qr="${escape(b.ticketCode)}" aria-label="Boarding QR code"></div><span>Boarding code</span><strong class="verification-code">${escape(b.ticketCode)}</strong>` : '<p>Boarding code will appear after payment.</p>';
    const banner = template.content.querySelector('.ticket-status-banner');
    if (banner) banner.textContent = `${b.status} · ${b.paymentStatus === 'unpaid' ? 'Payment required' : b.paymentMethod === 'cash' ? 'Cash due at stage' : b.paymentStatus}`;
    template.content.querySelector('.ticket-actions')?.remove();
    return template.innerHTML;
  };
  ui.initTicketQr = () => {
    document.querySelectorAll<HTMLElement>('[data-real-qr]').forEach(async el => {
      const src = await QRCode.toDataURL(`https://app.peebee.online/ticket/${encodeURIComponent(el.dataset.realQr!)}`, { width: 160, margin: 1 });
      if (el.isConnected) { const img = new Image(); img.src = src; img.alt = 'Peebee boarding ticket'; el.replaceChildren(img); }
    });
  };
  ui.renderTrips = () => ui.renderTickets();
  ui.renderWallet = () => {
    const template = document.createElement('template'); template.innerHTML = original.renderWallet();
    const account = template.content.querySelector('.wallet-account'); if (account) account.textContent = 'Peebee customer wallet';
    const stats = template.content.querySelector('.balance-grid'); if (stats) stats.innerHTML = `<div class="balance-cell"><small>Promotional credit</small><strong>${money(wallet?.credit || 0)}</strong></div><div class="balance-cell"><small>Wallet status</small><strong>${wallet?.frozen ? 'Frozen' : wallet?.verified ? 'Verified' : 'Standard'}</strong></div>`;
    template.content.querySelector('aside')?.remove();
    const head = template.content.querySelector('.screen-head p'); if (head) head.textContent = 'Your existing Peebee balance and transaction history.';
    return template.innerHTML.replace('Use demonstration funds for trips, parcels and luggage. This preview does not hold or process real money.', 'Your existing Peebee balance and transaction history.');
  };
  ui.renderProfile = () => `${ui.screenHead('Profile & Settings', 'Your shared Peebee customer account.')}<article class="card"><div class="detail-list">${ui.ticketField('Name', escape(user?.name))}${ui.ticketField('Phone', escape(user?.phone))}${ui.ticketField('Email', escape(user?.email))}</div><label for="taxibee-display-name">Display name</label><input id="taxibee-display-name" value="${escape(user?.name)}"><button class="button button--primary" data-action="taxibee-save-name">Save name</button><button class="button button--ghost" data-action="sign-out">Sign out</button></article>`;
  ui.renderSupport = () => `${ui.screenHead('Help and Support', 'Peebee customer support.')}<article class="card"><p>Use Peebee support for your TaxiPress bookings, payments and luggage.</p><a class="button button--primary" href="https://app.peebee.online/help">Open Peebee support</a></article>`;
  ui.renderNotifications = () => empty('Notifications', 'Your booking and payment status is available in My Travels.');
  ui.renderTracking = () => selectedBooking ? renderLiveTicket(selectedBooking) : empty('Your journeys', 'Choose a booking in My Travels to see its latest status.');
  ui.loadTracking = () => ui.navigate('tracking');
  ui.openTicketModal = (id: string) => { selectedBooking = bookings.find(b => b.id === id) || null; ui.navigate('ticket'); };
  // Source maps contain demonstration paths and synthetic live progress.
  for (const name of ['initTripMap', 'initBookingStep2Map', 'initLiveTravelMap', 'initTrackingMap', 'initTrackingCardMaps']) ui[name] = () => {};
  ui.renderTripTabContent = () => [...scheduledTickets.map(t=>`<article class="card"><h3>${escape(t.fromName)} → ${escape(t.toName)} · Scheduled</h3><p>${escape(t.plate)} · ${escape(t.state)} · ${money(Number(t.amount))}</p><button class="button button--primary" data-action="taxibee-future-ticket" data-id="${escape(t.id)}">View ticket</button></article>`),...bookings.map(b => `<article class="card"><h3>${escape(b.route.fromName)} → ${escape(b.route.toName)}</h3><p>${escape(b.taxi.plate)} · ${escape(b.status)} · ${money(b.amount)}</p><button class="button button--primary" data-action="taxibee-ticket" data-id="${escape(b.id)}">View ticket</button></article>`)].join('') || empty('No journeys yet', 'Bookings made in either customer app appear here.');
  ui.signOut = async () => {
    if (!user) { account?.open('profile'); return; }
    try { await accountTools?.beforeSignOut(); await seating?.release(); await api.logout(); } finally { clearSession(); applyGuest(); await refresh().catch(report); account?.browse('home'); }
  };
}

if (!preview) features = installCustomerFeatures({
  ui, api,
  token: () => sessionStorage.getItem(TOKEN) || localStorage.getItem(TOKEN),
  user: () => user, config: () => config, bookings: () => bookings,
  selected: () => selectedBooking, select: b => { selectedBooking = b; },
  applyUser, refresh,
  saveToken: token => { ++sessionVersion; (localStorage.getItem(TOKEN) ? localStorage : sessionStorage).setItem(TOKEN, token); },
  requestLogin: screen => account?.open(screen),
  finishSession: result => account!.finish(result),
});

if (!preview) account = installCustomerAuth({
  ui, api, user: () => user, trips: () => trips,
  scheduledTrips: () => scheduledDepartures.map(d=>({id:d.id,routeId:d.routeId,isScheduled:true,scheduledDepartureId:d.id,boarding:d.fromName,destination:d.toName,seats:d.seatsLeft,fare:d.farePerSeat,plate:d.plate})),
  selectScheduled: id => {selectedSchedule=scheduledDepartures.find(d=>d.id===id)||null;},
  canSaveDraft: () => !pendingOrder && !uncertainBooking,
  discardToken: apiLogoutToken,
  establish: async result => {
    clearSession(false);
    localStorage.setItem(TOKEN, result.token); applyUser(result.user);
    await refresh().catch(report);
    if (user?.id !== result.user.id) throw new Error('Please sign in again.');
  },
});
if (!preview) seating = installSeatSelection({ ui,api,user: () => user,quantity: () => ui.passengerTotal(),
  requestLogin: screen => account?.open(screen),remember: () => account?.rememberBooking() });
if (!preview) services = installParcelCharter({ui,api,user:()=>user,token:()=>sessionStorage.getItem(TOKEN)||localStorage.getItem(TOKEN),login:screen=>account?.open(screen),sponsor:{choices:method=>travelCredit?.choices(method,'svc-payment')||'',fields:()=>travelCredit?.fields('travel-service')||'',review:async(id,method)=>{await travelCredit?.review(id,method);}}});
if(!preview)returnPackages=installReturnPackages({ui,api,user:()=>user,config:()=>config,trips:()=>trips,bookings:()=>bookings,selected:()=>selectedBooking,
  input:bookingInput,prepareSeats:async()=>seating?.prepare(),refresh,select:b=>{selectedBooking=b;},requestLogin:s=>account?.open(s),clearDraft:()=>{account?.clearDraft();seating?.consumed();},sponsor:{options:()=>travelCredit?.options()||'',fields:()=>travelCredit?.fields('travel-return')||'',review:async(id,method)=>{await travelCredit?.review(id,method);}}});
if(!preview)travelCredit=installTravelCredit({ui,api,user:()=>user,complete:async orderId=>{
  const who=user?.id;await refresh();if(!who||who!==user?.id)return;
  const b=bookings.find(b=>b.orderId===orderId);if(!b){await services?.paid(orderId);return;}
  selectedBooking=b;pendingOrder=null;account?.clearDraft();seating?.consumed();returnPackages?.settled();ui.navigate('ticket');
}});

if(!preview)accountTools=installAccountTools({ui,api,token:()=>sessionStorage.getItem(TOKEN)||localStorage.getItem(TOKEN),user:()=>user,order:()=>selectedBooking?.orderId||bookings[0]?.orderId||null,applyUser,login:s=>account?.open(s)});

document.addEventListener('input', event => {
  if (!preview && (event.target as HTMLElement).id === 'taxibee-offer-code') state.taxibeeOfferCode = (event.target as HTMLInputElement).value;
  if (!preview && (event.target as HTMLElement).id === 'taxibee-traveller-emergency') state.emergencyContact = (event.target as HTMLInputElement).value;
});
document.addEventListener('change', event => {
  if (!preview && (event.target as HTMLElement).id === 'taxibee-open-ticket') {
    state.taxibeeOpenTicket = (event.target as HTMLInputElement).checked;
    if (state.taxibeeOpenTicket && state.paymentMethod === 'cash') state.paymentMethod = 'wallet';
  }
});

ui.renderAuth = () => {
  if (!preview) { account?.open(state.intendedScreen || 'profile'); return; }
  original.renderAuth();
  const root = $('#auth-content');
  if (!root) return;
  // Keep the source form geometry while using Peebee's real identifiers.
  root.innerHTML = root.innerHTML.replace(/Enter authorized username and passcode\. No access without credentials\./g, 'Sign in with your existing Peebee customer account.').replace(/Username or Telephone/g, 'Phone or email').replace(/Your authorized platform username\./g, 'The same phone or email you use in Peebee.').replace(/Every sign-in attempt is permanently logged with timestamp for security\./g, 'Your account is managed securely by Peebee.').replace(/e\.g\. admin or christo/g, 'Your Peebee phone or email').replace(/Choose a username/g, 'Phone number').replace(/Your preferred username/g, 'Your phone number').replace(/Register with Passcode/g, 'Create a Peebee account');
  if (state.authView === 'register') {
    for (const id of ['reg-name','reg-username','reg-passcode','reg-email']) { const input = $('#' + id); if (input) input.value = ''; }
    root.querySelector('label[for="reg-username"]')!.textContent = 'Phone number';
  }
  root.insertAdjacentHTML('beforeend', '<p class="center"><a href="?preview=1" class="text-button">Practice using Taxibee</a></p>');
  if (!preview) root.insertAdjacentHTML('beforeend', '<p class="center"><button type="button" class="text-button" data-action="taxibee-password-reset-form">Forgot password?</button></p>');
  if (preview) root.insertAdjacentHTML('beforeend', '<p class="center"><button class="button button--primary" data-action="taxibee-preview">Enter practice mode</button></p>');
  ui.refreshIcons();
};

document.addEventListener('click', async event => {
  const button = (event.target as Element).closest<HTMLElement>('[data-action]');
  const screen = (event.target as Element).closest<HTMLElement>('[data-screen]');
  const action = button?.dataset.action || '';
  if (action === 'taxibee-preview' && preview) {
    event.stopImmediatePropagation(); previewEntered = true; ui.enterApp('Practice mode — no real transactions.'); return;
  }
  if (preview) return;
  const block = () => { event.preventDefault(); event.stopImmediatePropagation(); };
  if(action.startsWith('svc-')||action.startsWith('tools-')) return;
  if(action==='show-search-filters') { block(); openLiveSearchFilters(); return; }
  if(action==='taxibee-search-filters-save') {
    block();
    const vehicle=(document.getElementById('taxibee-filter-vehicle') as HTMLSelectElement|null)?.value||'all';
    const minSpaces=Number((document.getElementById('taxibee-filter-spaces') as HTMLSelectElement|null)?.value||1);
    const period=(document.getElementById('taxibee-filter-period') as HTMLSelectElement|null)?.value||'any';
    if(!['all','14','18'].includes(vehicle)||!Number.isInteger(minSpaces)||minSpaces<1||minSpaces>18||!['any','morning','afternoon','evening'].includes(period)) return ui.toast('Choose valid trip filters.','danger');
    searchFilters={vehicle:vehicle as typeof searchFilters.vehicle,minSpaces,period:period as typeof searchFilters.period};
    try { localStorage.setItem(`taxibee-search-filters:${user?.id||'guest'}`,JSON.stringify(searchFilters)); }
    catch { return ui.toast('Your browser could not save these filters on this device.','danger'); }
    ui.closeModal();ui.renderCurrentScreen();return;
  }
  if(action==='toggle-save-departure') {
    block();
    const id=button?.dataset.depId;
    if(!id) return ui.toast('This departure cannot be saved.', 'danger');
    const saved=new Set<string>(Array.isArray(state.savedDepartures)?state.savedDepartures:[]);
    const removing=saved.has(id);
    if(!removing&&saved.size>=30) return ui.toast('You can save up to 30 active departures.','info');
    if(removing) saved.delete(id); else saved.add(id);
    state.savedDepartures=[...saved].slice(-30);
    let accountSynced=false;
    if(user&&savedDepartureServerReady) {
      try { await savedDepartureRequest(removing?'DELETE':'PUT',id);accountSynced=true; }
      catch { savedDepartureServerReady=false; }
    }
    try { localStorage.setItem(`taxibee-saved-departures:${user?.id||'guest'}`,JSON.stringify(state.savedDepartures)); }
    catch { return ui.toast('Your browser could not save this departure on this device.', 'danger'); }
    ui.renderCurrentScreen();ui.toast(user&&accountSynced?(removing?'Removed from your Peebee account.':'Saved to your Peebee account.'):(removing?'Removed from this device.':'Saved on this device only; account sync is not available.'),user&&accountSynced?'success':'info');return;
  }
  if(action==='taxibee-schedule-choose') {
    block();
    selectedSchedule=scheduledDepartures.find(d=>d.id===button?.dataset.id)||null;
    if(!selectedSchedule) return ui.toast('That published departure is no longer available. Refresh and try again.','info');
    state.activeTrip={id:selectedSchedule.id,routeId:selectedSchedule.routeId,isScheduled:true,scheduledDepartureId:selectedSchedule.id,boarding:selectedSchedule.fromName,destination:selectedSchedule.toName,depart:new Date(selectedSchedule.departsAt).toLocaleTimeString('en-UG',{timeZone:'Africa/Kampala',hour:'numeric',minute:'2-digit'}),plate:selectedSchedule.plate,seats:selectedSchedule.seatsLeft,fare:selectedSchedule.farePerSeat,vehicle:`Commuter (${selectedSchedule.seatLayout})`};
    state.searchFrom=selectedSchedule.fromName;state.searchTo=selectedSchedule.toName;state.bookingDate=kampalaDate(new Date(selectedSchedule.departsAt));state.ticketType='oneway';state.taxibeeOpenTicket=false;state.passengerCount=1;state.childCount=0;state.reservedChildSeatsCount=0;
    ui.navigate('passengers');return;
  }
  if (action === 'open-demo-panel') { block(); account?.rememberBooking(); location.assign('/?preview=1'); return; }
  if (['select-route-card', 'select-route-card-step', 'book-searched-route', 'flip-route-direction', 'swap-home-route', 'swap-route'].includes(action)) {
    block();
    let route = config?.routes.find(r => r.id === button?.dataset.route) || config?.routes.find(r => r.fromName === state.searchFrom && r.toName === state.searchTo);
    if (['flip-route-direction', 'swap-home-route', 'swap-route'].includes(action)) route = config?.routes.find(r => r.id === route?.reverseId) || config?.routes.find(r => r.fromName === state.searchTo && r.toName === state.searchFrom);
    if (!route) return ui.toast('This route is not running in that direction.', 'info');
    state.selectedRoute = route.id; state.searchFrom = route.fromName; state.searchTo = route.toName;
    state.activeTrip = trips.find(t => t.routeId === route.id) || null;
    if (action === 'book-searched-route') { state.bookingStep = 2; ui.navigate('book'); } else ui.renderCurrentScreen();
    return;
  }
  if (['select-departure', 'select-departure-direct', 'choose-trip'].includes(action)) {
    block();
    const trip = button?.dataset.tripId ? trips.find(t => t.id === button.dataset.tripId) : trips.find(t => t.depart === button?.dataset.trip && t.boarding === state.searchFrom && t.destination === state.searchTo);
    if (!trip) return ui.toast('This departure is no longer available. Refresh departures.', 'info');
    state.activeTrip = trip; state.searchFrom = trip.boarding; state.searchTo = trip.destination; ui.navigate('trip-details'); return;
  }
  const countActions: Record<string, [string, number]> = { 'increment-adults': ['passengerCount', 1], 'add-adult': ['passengerCount', 1], 'decrement-adults': ['passengerCount', -1], 'decrease-passengers': ['passengerCount', -1], 'increment-children': ['childCount', 1], 'add-child': ['childCount', 1], 'decrement-children': ['childCount', -1], 'decrease-child': ['childCount', -1], 'increment-child-seats': ['reservedChildSeatsCount', 1], 'decrement-child-seats': ['reservedChildSeatsCount', -1] };
  if (countActions[action]) {
    block(); const [key, delta] = countActions[action], before = state[key];
    state[key] = Math.max(key === 'passengerCount' ? 1 : 0, state[key] + delta);
    const minChild = Math.max(0, state.childCount - (config?.maxLapChildren ?? 0));
    if (key === 'reservedChildSeatsCount' && (state[key] < minChild || state[key] > state.childCount)) state[key] = before;
    if (state.passengerCount + childSeats() > Math.min(config?.maxSeatsPerBooking ?? 0, state.activeTrip?.seats ?? 0) || state.passengerCount + state.childCount > 18) { state[key] = before; ui.toast('This choice exceeds the current Peebee booking limit or available spaces.', 'info'); }
    state.reservedChildSeatsCount = childSeats(); ui.renderCurrentScreen(); return;
  }
  if (action === 'toggle-book-for-someone-else') {
    block(); if (!config?.bookForOthersEnabled) return ui.toast('Booking for someone else is switched off.', 'info');
    state.isBookingForSomeoneElse = !state.isBookingForSomeoneElse;
    state.passengerDetails[0] = { ...state.passengerDetails[0], name: state.isBookingForSomeoneElse ? state.otherTravelerName : user?.name, phone: state.isBookingForSomeoneElse ? state.otherTravelerPhone : user?.phone };
    ui.renderCurrentScreen(); return;
  }
  const safeScreens = new Set(['home', 'book', 'available-vans', 'trip-details', 'passengers', 'returns', 'luggage', 'checkout', 'success', 'ticket', 'tickets', 'trips', 'wallet', 'profile', 'about', 'support', 'notifications', 'tracking', 'live', 'login-logs','search-results','parcel','parcel-receipt','trackparcel','trackparcel-list','parcel-status','special-hire']);
  if (screen && !safeScreens.has(screen.dataset.screen || '')) {
    block(); ui.toast('This service is available in the Peebee customer app.', 'info');
    ui.openModal('Continue in Peebee', '<p>Use your same Peebee account for this service.</p>', '<a class="button button--primary" href="https://app.peebee.online/ride">Open Peebee</a>'); return;
  }
  if (action.startsWith('taxibee-')) {
    block();
    try {
      if (action === 'taxibee-calendar-export') {
        const id=button?.dataset.id;
        if(button?.dataset.kind==='stage') {
          const b=id?bookings.find(booking=>booking.id===id):null;
          if(!b||b.id!==(selectedBooking||bookings[0])?.id) throw new Error('Open this booking again before exporting its calendar event.');
          if(b.status!=='booked'||!['paid','pay_driver'].includes(b.paymentStatus)) throw new Error('Only a confirmed upcoming booking can be added to your calendar.');
          const currentQueue=await api.getTaxipressQueue(b.route.id),currentTaxi=currentQueue.line.find(entry=>entry.id===b.taxi.queueId);
          const departsAt=currentTaxi?.departsAt||null;
          if(!departsAt||!isFutureDeparture(departsAt)) throw new Error('Peebee has no current future departure estimate for this taxi.');
          downloadCalendar({id:b.id,departsAt,fromName:b.route.fromName,toName:b.route.toName},true);
        } else {
          if(!id||String(id)!==String(selectedScheduledTicket?.id)) throw new Error('Open the scheduled ticket again before exporting its calendar event.');
          const t=(await api.getTaxipressScheduledTicket(id)).ticket;
          scheduledTickets=[t,...scheduledTickets.filter(ticket=>String(ticket.id)!==String(t.id))];selectedScheduledTicket=t;
          if(t.departureState!=='published'||t.state!=='reserved'||!isFutureDeparture(t.departsAt)) throw new Error('This ticket is no longer an upcoming published departure.');
          if(Number(t.paid)!==1) throw new Error('The calendar event is available after Peebee confirms payment.');
          downloadCalendar(t);
        }
      } else if (action === 'taxibee-refresh') {
        if (pendingPayment) { await api.refreshPayment(pendingPayment); pendingPayment = null; }
        await refresh();
        if (selectedBooking) selectedBooking = (await api.getTaxipressBooking(selectedBooking.id)).booking;
        if (selectedScheduledTicket) selectedScheduledTicket=(await api.getTaxipressScheduledTicket(String(selectedScheduledTicket.id))).ticket;
        ui.renderCurrentScreen();
      } else if (action === 'taxibee-check-bookings') { await refresh(); uncertainBooking = false; ui.closeModal(); ui.navigate('tickets');
      } else if (action === 'taxibee-ticket') { selectedBooking = bookings.find(b => b.id === button?.dataset.id) || null; ui.navigate('ticket'); }
      else if (action === 'taxibee-future-ticket') { selectedScheduledTicket=scheduledTickets.find(t=>String(t.id)===button?.dataset.id)||null; selectedBooking=null;ui.navigate('ticket'); }
      else if (action === 'taxibee-future-refresh') { const t=(await api.getTaxipressScheduledTicket(button!.dataset.id!)).ticket;scheduledTickets=[t,...scheduledTickets.filter(x=>x.id!==t.id)];if(t.bookingId){selectedBooking=(await api.getTaxipressBooking(String(t.bookingId))).booking;selectedScheduledTicket=null;}else selectedScheduledTicket=t;ui.renderCurrentScreen(); }
      else if (action === 'taxibee-future-pay') { const t=scheduledTickets.find(x=>String(x.id)===button?.dataset.id);if(t){scheduledPending={ticketId:String(t.id),orderId:String(t.orderId)};selectedScheduledTicket=t;await payScheduled();} }
      else if (action === 'taxibee-future-cancel') { const t=scheduledTickets.find(x=>String(x.id)===button?.dataset.id);if(t&&confirm('Cancel this scheduled departure? Any refund will be returned to your Peebee wallet.')){await api.cancelTaxipressScheduledTicket(String(t.id));await refresh();selectedScheduledTicket=(await api.getTaxipressScheduledTicket(String(t.id))).ticket;ui.renderCurrentScreen();ui.toast('Scheduled booking cancelled.','success');} }
      else if (action === 'taxibee-cancel') {
        const b = bookings.find(b => b.id === button?.dataset.id);
        if (b && confirm(`Cancel this booking? Fee: ${money(b.cancel.fee)}. Refund: ${money(b.cancel.refund)}.`)) { await api.cancelTaxipressBooking(b.id); await refresh(); selectedBooking = (await api.getTaxipressBooking(b.id)).booking; ui.renderCurrentScreen(); }
      } else if (action === 'taxibee-pay') { const b = bookings.find(b => b.id === button?.dataset.id); if (b) {
        pendingOrder = { booking: b, order: { id: b.orderId } };
        state.activeTrip = { id: b.taxi.queueId, plate: escape(b.taxi.plate), boarding: escape(b.route.fromName), destination: escape(b.route.toName), depart: 'Stage departure', seats: b.seats, fare: b.farePerSeat, vehicle: `Commuter (${b.taxi.seatLayout})` };
        state.searchFrom = escape(b.route.fromName); state.searchTo = escape(b.route.toName);
        state.passengerCount = b.seats; state.childCount = 0; state.ticketType = 'oneway'; state.capacityMode = 'capacity';
        ui.navigate('checkout');
      } }
      else if (action === 'taxibee-topup') {
        if (busy) return;
        busy = true; button!.setAttribute('disabled', '');
        let result;
        try { result = await api.topUpWallet({ amount: Number($('#taxibee-topup-amount')?.value), msisdn: $('#taxibee-topup-phone')?.value, method: 'mobile_money' }); }
        finally { busy = false; button!.removeAttribute('disabled'); }
        if (result.redirectUrl) location.assign(result.redirectUrl);
        else ui.openModal('Top-up pending', '<p>Approve your provider prompt. Your balance changes only after the payment is confirmed.</p>', `<button class="button button--primary" data-action="taxibee-topup-refresh" data-id="${escape(result.topupId)}">Check payment</button>`);
      } else if (action === 'taxibee-topup-refresh') { const r = await api.refreshTopup(button!.dataset.id!); ui.toast(`Top-up ${r.topup.status}`, 'info'); await refresh(); if (r.topup.status !== 'pending') ui.closeModal(); ui.renderCurrentScreen(); }
      else if (action === 'taxibee-save-name') { await api.updateMyDisplayName($('#taxibee-display-name')?.value.trim() || ''); applyUser((await api.me()).user); ui.renderCurrentScreen(); ui.toast('Your Peebee name is updated.', 'success'); }
    } catch (e) { report(e); }
    return;
  }
  if (['open-add-funds', 'deposit', 'deposit-wallet', 'wallet-deposit', 'wallet-topup'].includes(action)) {
    if (!user) { block(); account?.open('wallet'); return; }
    block(); ui.openModal('Add to your Peebee wallet', `<label for="taxibee-topup-amount">Amount (UGX)</label><input id="taxibee-topup-amount" type="number" min="1" inputmode="numeric"><label for="taxibee-topup-phone">Mobile-money number</label><input id="taxibee-topup-phone" type="tel" value="${escape(user?.phone)}">`, '<button class="button button--primary" data-action="taxibee-topup">Request top-up</button>'); return;
  }
  const blocked = ['continue-guest','continue-google','continue-signin','verify-otp','create-account','resend-otp','proceed-reg-verification','fill-creds','simulate-login-test','deposit-state','ticket-states','send-chat-demo','save-profile','submit-support','submit-lost-property','confirm-hire-payment','parcel-next','complete-parcel','confirm-parcel','confirm-parcel-payment','transfer-wallet','wallet-pin','quick-return-toggle','toggle-return-switch','booking-option','book-preferred-seat','capacity-mode','select-ticket-type','return-mode','apply-voucher','open-demo-panel','demo-state','toggle-connection'];
  const allowed = ['submit-login','toggle-passcode-visibility','show-registration','auth-back','go-back','toggle-side-drawer','close-drawer','close-modal','close-sheet','open-search-shortcuts','select-route-card','select-route-card-step','book-searched-route','flip-route-direction','decrement-adults','increment-adults','decrement-children','increment-children','decrement-child-seats','increment-child-seats','select-date-mode','booking-skip-seat','booking-next-step','booking-prev-step','select-booking-vehicle','select-departure','select-departure-direct','choose-trip','open-luggage-modal','modal-luggage-plus','modal-luggage-minus','toggle-book-for-someone-else','confirm-booking-step','confirm-booking','swap-home-route','swap-route','search-trips','toggle-order-summary','toggle-save-departure','continue-to-checkout','set-assistance','set-language-inline','luggage-plus','luggage-minus','no-luggage','wallet-filter','filter-tickets','trip-tab','sign-out'];
  if (action && (blocked.includes(action) || !allowed.includes(action))) { block(); ui.toast('This option is available in the Peebee customer app or the design preview.', 'info'); }
}, true);

document.addEventListener('DOMContentLoaded', async () => {
  if (preview) {
    document.body.classList.add('taxibee-preview');
    document.body.insertAdjacentHTML('beforeend', '<div class="taxibee-mode">Practice mode · sample data · no real bookings or payments<a href="?preview=1">Restart practice</a><a href="/">Return to live Taxibee</a></div>');
    ui.init(); return;
  }
  const publicCode = new URLSearchParams(location.search).get('ticket');
  if (publicCode) {
    ui.init();
    $('#splash-screen')?.classList.add('is-hidden'); $('#onboarding')?.classList.add('is-hidden');
    $('#app-shell')?.classList.add('is-hidden'); $('#auth-layer')?.classList.remove('is-hidden');
    try {
      const { ticket: t } = await api.getTaxipressTicketByCode(publicCode);
      $('#auth-content')!.innerHTML = `<article class="card"><h1>Taxibee passenger ticket</h1><h2>${escape(t.route.fromName)} → ${escape(t.route.toName)}</h2><p>Traveller: ${escape(t.travellerName || 'Passenger')}</p><p>${escape(t.status)} · ${escape(t.paymentStatus)}</p><p>${t.seats} space(s) · ${escape(t.taxi.plate)}</p>${t.seatNumbers?.length ? `<p>Seat numbers: ${escape(t.seatNumbers.join(', '))}</p>` : ''}${t.amountDue != null ? `<p>Cash due: ${money(t.amountDue)}</p>` : ''}<p>Boarding code: <strong>${escape(t.code)}</strong></p><a class="button button--primary" href="/">Open Taxibee</a></article>`;
    } catch (e) { $('#auth-content')!.innerHTML = `<article class="card"><h1>Ticket unavailable</h1><p>${escape(message(e))}</p><a href="/">Open Taxibee</a></article>`; }
    return;
  }
  if (sessionStorage.getItem(TOKEN) || localStorage.getItem(TOKEN)) {
    try { applyUser((await api.me()).user); } catch { clearSession(false); }
  }
  if (!user) applyGuest();
  await refresh().catch(e => { error = message(e); });
  ui.init();
  const practiceButton = document.querySelector('[data-action="open-demo-panel"]'); if (practiceButton) practiceButton.innerHTML = '<i data-lucide="flask-conical"></i>Practice mode';
  const sidebarStatus = document.querySelector('.sidebar__footer .connection-state'); if (sidebarStatus) sidebarStatus.textContent = 'Peebee account services';
  const sidebarMode = document.querySelector('.sidebar__footer > p'); if (sidebarMode) sidebarMode.textContent = 'Live Taxibee';
  const restored = !location.hash && !new URLSearchParams(location.search).get('screen') ? account?.restoreDraft() : null;
  account?.browse(restored?.screen || state.screen || 'home');
  booting = false;
});

document.addEventListener('change',event=>{
  const target=event.target as HTMLInputElement;
  if(target?.id==='taxibee-schedule-date') { scheduleDate=target.value;ui.renderCurrentScreen(); }
});
