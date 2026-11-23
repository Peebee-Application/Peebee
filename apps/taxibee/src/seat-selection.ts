import type { ApiClient } from '../../../packages/shared/src/api-client';
import type { AuthUser } from '../../../packages/shared/src/domain';
import type { TaxipressSeatMap } from '../../../packages/shared/src/taxipress';

type Context = { ui: Record<string,any>; api: ApiClient; user: () => AuthUser | null; quantity: () => number;
  requestLogin: (screen: string) => void; remember: () => void };
/** The existing seat diagram backed by Peebee inventory. No sample occupancy. */
export function installSeatSelection(c: Context) {
  const { ui,api } = c, state = ui.TaxibeeSource.state;
  const esc = (v: unknown) => ui.escapeHtml(String(v ?? ''));
  const originalSeatMode = ui.renderSeatMode;
  const originalOptions = ui.reviewSeatOptions;
  let map: TaxipressSeatMap | null = null, queue = '', owner = '', epoch = 0;
  let loading: Promise<void> | null = null, busy = false, error = '', actionSequence = 0;
  let poll: ReturnType<typeof setTimeout> | null = null;
  const selected = () => [...(state.selectedSeats || [])].sort() as string[];
  const same = (a: string[],b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const validHold = () => map?.hold && Date.parse(map.hold.expiresAt) > Date.now()
    && same(map.hold.seats,selected()) && map.hold.seats.length === c.quantity() ? map.hold : null;
  const fee = () => state.capacityMode === 'seats' ? validHold()?.fee ?? (map?.feePerSeat || 0) * c.quantity() : 0;
  const visible = () => ['book','passengers','checkout'].includes(state.screen) && state.capacityMode === 'seats';
  function current() { return state.activeTrip?.id || ''; }
  function redraw() { ui.renderCurrentScreen(); c.remember(); }
  function schedule() {
    if (poll) clearTimeout(poll);
    poll = null;
    if (!document.hidden && visible()) poll = setTimeout(() => { void load(true); },5000);
  }
  async function load(force = false): Promise<void> {
    const id = current(), user = c.user()?.id || '';
    if (id !== queue || user !== owner) { ++epoch; queue = id; owner = user; map = null; loading = null; error = ''; }
    if (!id || (!force && map)) return;
    if (loading) return loading;
    const run = epoch;
    let changed = false;
    loading = (async () => {
      try {
        const next = await api.getTaxipressSeatMap(id,!!user);
        if (run !== epoch || id !== current() || user !== (c.user()?.id || '')) return;
        changed = JSON.stringify(next) !== JSON.stringify(map) || !!error;
        map = next; error = '';
        if (next.hold && state.capacityMode === 'seats' && !selected().length) state.selectedSeats = [...next.hold.seats];
        const available = selected().filter(id => next.seats.some(s => s.id === id && ['available','mine'].includes(s.status)));
        if (next.enabled && !same(available,selected())) { state.selectedSeats = available; changed = true; ui.toast('Seat availability changed. Review your selection.','info'); }
      } catch (e) { if (run === epoch) error = e instanceof Error ? e.message : 'Unable to load seats.'; }
      finally {
        if (run === epoch) { loading = null; if (visible() && (changed || error)) redraw(); schedule(); }
      }
    })();
    return loading;
  }
  async function release() {
    const id = map?.hold?.id;
    if (map) map.hold = null;
    if (id && c.user()) await api.releaseTaxipressSeatHold(id).catch(() => undefined);
  }
  async function holdSelection() {
    await load();
    if (!map?.enabled) throw new Error('Numbered seats are not offered on this departure. Choose best available.');
    if (selected().length !== c.quantity()) throw new Error(`Choose exactly ${c.quantity()} passenger seats.`);
    if (!c.user()) { c.requestLogin(state.screen); return null; }
    if (validHold()) return validHold()!.id;
    const id = current(), user = c.user()!.id, seats = selected(), run = epoch;
    const { hold } = await api.holdTaxipressSeats(id,seats);
    if (run !== epoch || id !== current() || user !== c.user()?.id) throw new Error('The booking session changed. Review your seats again.');
    ++epoch; loading = null; map.hold = { ...hold,seats }; schedule();
    return hold.id;
  }
  function status() {
    if (error) return `<p role="alert">${esc(error)}</p><button type="button" class="button button--ghost" data-action="taxibee-seat-refresh">Refresh seats</button>`;
    const h = validHold();
    return `<div class="compact-note" role="status">${h ? `Seats ${esc(h.seats.join(', '))} held until ${esc(new Date(h.expiresAt).toLocaleTimeString('en-UG',{hour:'2-digit',minute:'2-digit',second:'2-digit'}))}. Confirm before expiry. Seat-choice fee: ${ui.formatUGX(h.fee)}.`
      : !c.user() ? 'Your choices are saved. Sign in to hold seats; availability may change.'
      : 'Selected seats are not held yet. Hold them before completing your booking.'}</div>
      <button type="button" class="button button--primary" data-action="taxibee-hold-seats" ${busy || !!h ? 'disabled' : ''}>${busy ? 'Holding seats…' : h ? 'Seats held' : c.user() ? 'Hold selected seats' : 'Sign in to hold seats'}</button>`;
  }
  ui.getOccupiedSeatsForTrip = () => map?.seats.filter(s => !['available','mine'].includes(s.status)).map(s => s.id) || [];
  ui.renderSeatMode = () => {
    if (!map && error && current() === queue && owner === (c.user()?.id || '')) return status();
    if (!map || current() !== queue || owner !== (c.user()?.id || '')) { void load(); return '<p role="status">Loading seat availability…</p>'; }
    if (!map.enabled) return '<p>Numbered seats are not offered on this departure. Choose best available.</p>';
    // Reuse the source diagram and hotspots for the actual approved layout.
    const trip = state.activeTrip, previous = trip.vehicle;
    trip.vehicle = map.layout === '18' ? 'highroof' : 'commuter';
    try { return originalSeatMode() + status(); } finally { trip.vehicle = previous; }
  };
  ui.reviewSeatOptions = () => originalOptions().replace('UGX 1,000 per seat',`${ui.formatUGX(map?.feePerSeat || 0)} per seat`);
  const renderCheckout = ui.renderCheckout;
  ui.renderCheckout = () => renderCheckout() + (state.capacityMode === 'seats' ? `<article class="card"><h3>Selected passenger seats</h3>${ui.renderSeatMode()}</article>` : '');
  document.addEventListener('click',event => {
    const el = (event.target as Element).closest<HTMLElement>('[data-action]');
    const action = el?.dataset.action;
    if (!['capacity-mode','book-preferred-seat','toggle-seat','taxibee-hold-seats','taxibee-seat-refresh','booking-skip-seat'].includes(action || '')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (busy) return;
    if (action === 'capacity-mode' || action === 'book-preferred-seat' || action === 'booking-skip-seat') {
      const mode = action === 'book-preferred-seat' ? 'seats' : action === 'booking-skip-seat' ? 'capacity' : el!.dataset.value;
      state.capacityMode = mode === 'seats' ? 'seats' : 'capacity';
      if (action === 'book-preferred-seat') state.bookingStep = '3b';
      if (action === 'booking-skip-seat') state.bookingStep = 4;
      if (state.capacityMode !== 'seats') { void release(); state.selectedSeats = []; }
      else void load();
      redraw(); return;
    }
    if (action === 'toggle-seat') {
      const id = el!.dataset.seat || '', seat = map?.seats.find(s => s.id === id);
      if (!seat || !['available','mine'].includes(seat.status)) return;
      if (selected().includes(id)) state.selectedSeats = selected().filter(s => s !== id);
      else if (selected().length < c.quantity()) state.selectedSeats = [...selected(),id];
      else return ui.toast(`Choose up to ${c.quantity()} passenger seats.`,'info');
      redraw(); return;
    }
    if (action === 'taxibee-seat-refresh') { void load(true); return; }
    const actionRun = ++actionSequence;
    busy = true; error = ''; redraw();
    void holdSelection().catch(e => { if (actionRun === actionSequence) { error = e.message; ui.toast(error,'danger'); } }).finally(() => { if (actionRun === actionSequence) { busy = false; redraw(); } });
  },true);
  document.addEventListener('visibilitychange',() => { if (document.hidden && poll) clearTimeout(poll); else if (visible()) void load(true); });
  return {
    fee,
    prepare: async () => {
      if (state.capacityMode !== 'seats') return undefined;
      const quoted = fee(), id = await holdSelection();
      if (fee() !== quoted) { redraw(); throw new Error('The seat-choice fee changed. Review the updated total and confirm again.'); }
      return id || undefined;
    },
    release,
    consumed() { if (map) map.hold = null; },
    reset() { ++epoch; ++actionSequence; busy = false; map = null; loading = null; queue = ''; owner = ''; error = ''; if (poll) clearTimeout(poll); },
  };
}
