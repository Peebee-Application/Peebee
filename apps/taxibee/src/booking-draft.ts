import { TAXIPRESS_LUGGAGE_TYPES } from '../../../packages/shared/src/taxipress';

export const BOOKING_DRAFT_KEY = 'taxibee-booking-draft-v1';
const screens = new Set(['book', 'trip-details', 'passengers', 'returns', 'luggage', 'checkout']);
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type BookingDraft = {
  version: 1; owner: string | null; screen: string; queueId: string; routeId: string;
  values: Record<string, string | number | boolean | string[] | Record<string, number>>;
};
const text = (value: unknown, max = 160) => typeof value === 'string' ? value.slice(0, max) : '';
const count = (value: unknown, min: number, max: number) => Number.isInteger(value) ? Math.min(max, Math.max(min, Number(value))) : min;

/** Deliberate allowlist: no passwords, session tokens, balances, payment authorizations or consent. */
export function captureDraft(state: Record<string, any>, owner: string | null): BookingDraft | null {
  if (!screens.has(state.screen) || !state.activeTrip?.id) return null;
  return {
    version: 1, owner, screen: state.screen, queueId: text(state.activeTrip.id), routeId: text(state.activeTrip.routeId),
    values: {
      searchFrom: text(state.searchFrom), searchTo: text(state.searchTo), bookingDate: text(state.bookingDate, 10),
      bookingStep: typeof state.bookingStep === 'number' ? count(state.bookingStep, 1, 6) : text(state.bookingStep, 4),
      passengerCount: count(state.passengerCount, 1, 18), childCount: count(state.childCount, 0, 17), reservedChildSeatsCount: count(state.reservedChildSeatsCount, 0, 17),
      luggageQuantities: Object.fromEntries(TAXIPRESS_LUGGAGE_TYPES.map(k => [k, count(state.luggageQuantities?.[k], 0, 10)])),
      assistance: text(state.assistance, 80), language: text(state.language, 80), paymentMethod: ['wallet', 'cash', 'mobile'].includes(state.paymentMethod) ? state.paymentMethod : 'wallet',
      isBookingForSomeoneElse: state.isBookingForSomeoneElse === true, otherTravelerName: text(state.otherTravelerName, 80), otherTravelerPhone: text(state.otherTravelerPhone, 20), emergencyContact: text(state.emergencyContact, 20),
      capacityMode: state.capacityMode === 'seats' ? 'seats' : 'capacity', ticketType: state.ticketType === 'return' ? 'return' : 'oneway',
      returnMode:['open','same-day','date-specific'].includes(state.returnMode)?state.returnMode:'open',returnDate:text(state.returnDate,10),
      selectedSeats: Array.isArray(state.selectedSeats) ? [...new Set<string>(state.selectedSeats.filter((s: unknown): s is string => typeof s === 'string' && /^[1-5][A-D]$/.test(s)))].slice(0,18) : [],
      taxibeeOpenTicket: state.taxibeeOpenTicket === true, taxibeeOfferCode: text(state.taxibeeOfferCode, 30),
    },
  };
}
export function saveDraft(storage: StorageLike, state: Record<string, any>, owner: string | null) {
  const draft = captureDraft(state, owner);
  if (draft) storage.setItem(BOOKING_DRAFT_KEY, JSON.stringify(draft));
}
export function readDraft(storage: StorageLike, owner: string | null): BookingDraft | null {
  try {
    const saved = JSON.parse(storage.getItem(BOOKING_DRAFT_KEY) || 'null');
    if (!saved || saved.version !== 1 || (saved.owner != null && saved.owner !== owner) || !screens.has(saved.screen)) return null;
    // Sanitize stored data through the same allowlist; storage is never trusted as a quote.
    return captureDraft({ ...saved.values, screen: saved.screen, activeTrip: { id: saved.queueId, routeId: saved.routeId } }, saved.owner ?? null);
  } catch { return null; }
}
export function isBookingScreen(screen: string) { return screens.has(screen); }
