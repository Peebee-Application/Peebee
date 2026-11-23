import { getSetting, setSetting } from "../lib/settings.js";

/**
 * Taxipress (scheduled shared-taxi seats on fixed routes) is controlled from Admin:
 * whether it runs, when a taxi may leave, how Peebee's cut is worked out, the seat
 * rules and what a taxi may carry as a relay parcel. Everything here has a safe default.
 */
export type TaxipressSettings = {
  enabled: boolean;
  /** full_only: a taxi leaves only when every seat is booked. The others let the driver go sooner. */
  departureRule: "full_only" | "driver_choice" | "after_wait";
  /** Seats still free on a taxi that is On Road may be sold in the app. */
  sellFreeSeatsOnRoad: boolean;
  commissionType: "percent" | "flat";
  commissionDigitalPercent: number;
  commissionCashPercent: number;
  commissionFlatUgx: number;
  /** Block a driver from joining the line while they owe Peebee more than maxOwedUgx. */
  blockWhenOwing: boolean;
  maxOwedUgx: number;
  cashEnabled: boolean;
  seatChoiceFeeUgx: number;
  numberedSeatsEnabled: boolean;
  seatHoldSeconds: number;
  returnDiscountPercent: number;
  returnPackagesEnabled: boolean;
  returnValidityDays: number;
  returnRefundPercent: number;
  maxSeatsPerBooking: number;
  /** Which taxi may take a relay parcel: only the one Boarding Now, or any taxi in the line. */
  parcelAcceptRule: "boarding_now" | "any_in_line";
  /** Most parcels one taxi takes per trip, by seat count. 0 means none until staff set it. */
  maxParcels14: number;
  maxParcels18: number;
  parcelFitText: string;
  parcelNotAllowed: string[];
  /** Minutes Boarding Now before a driver may leave with free seats (departure rule "after wait"). */
  waitMinutes: number;
  /** How close (metres) a driver must be to the start stage to join the line. 0 turns the check off. */
  stageRadiusM: number;
  /** Minutes to pay for a seat in the app before it is given back. */
  payWithinMinutes: number;
  /** Most cash bookings one passenger may hold at a time. */
  maxCashBookings: number;
  /** Minutes after booking a passenger may cancel for a full refund. */
  freeCancelMinutes: number;
  /** After that, the share of the fare kept from a paid seat that is cancelled. */
  cancelRetentionPercent: number;
  /** Who receives a kept cancellation or no-show fee. */
  feeTo: "driver" | "peebee";
  /** Minutes Boarding Now before a driver may mark an absent passenger a no-show. */
  noShowMinutes: number;
  /** Share of the fare kept from a paid seat when the passenger does not board. */
  noShowFeePercent: number;
  /** Move a removed taxi's passengers to the next taxi with room, instead of refunding them. */
  rebookOnRemoval: boolean;
  /** Taxis waiting in the line, after the one Boarding Now, that passengers may book. The boarding taxi is never bookable. */
  bookableTaxis: number;
  /** Children who may ride on an adult's lap without a seat, per booking. */
  maxLapChildren: number;
  /** A child's seat costs this share of the adult fare. */
  childSeatFarePercent: number;
  luggageEnabled: boolean;
  /** How many luggage options passengers are shown: the first this many of LUGGAGE_TYPES. */
  luggageOptionsShown: number;
  /** Price per item by luggage type; null = assessed at the stage. */
  luggagePrices: Record<LuggageType, number | null>;
  assistanceEnabled: boolean;
  languageEnabled: boolean;
  /** The languages a passenger may ask the driver to use. Staff add and remove them and choose which are displayed. */
  languages: LanguageOption[];
  bookForOthersEnabled: boolean;
  /** A passenger may send a ticket to someone else, and a ticket code opens the ticket's details for anyone who has it. */
  ticketSharingEnabled: boolean;
  /** A passenger may buy an open ticket: normal fare, valid on any taxi on the route. Needs migration 0145. */
  openTicketsEnabled: boolean;
  /** Days an open ticket stays valid after it is bought. 0 means it never expires. */
  openTicketValidityDays: number;
  /** Share of the fare given back when an open ticket is cancelled before use. */
  openTicketRefundPercent: number;
  showStops: boolean;
};

export type LanguageOption = { code: string; name: string; enabled: boolean };
export const DEFAULT_LANGUAGES: LanguageOption[] = [
  { code: "en", name: "English", enabled: true },
  { code: "lg", name: "Luganda", enabled: true },
  { code: "sw", name: "Swahili", enabled: true },
];
export const LANGUAGE_CODE = /^[a-z]{2,8}(-[A-Za-z0-9]{2,8})?$/;
export const MAX_LANGUAGES = 20;

/** The list staff saved, cleaned: valid unique codes, named, at most MAX_LANGUAGES. A missing or broken list is the default. */
export function cleanLanguages(value: unknown): LanguageOption[] {
  if (!Array.isArray(value)) return DEFAULT_LANGUAGES.map((l) => ({ ...l }));
  const seen = new Set<string>();
  const out: LanguageOption[] = [];
  for (const item of value as Array<Record<string, unknown>>) {
    const code = typeof item?.code === "string" ? item.code.trim().toLowerCase() : "";
    const name = typeof item?.name === "string" ? item.name.trim().slice(0, 40) : "";
    if (!LANGUAGE_CODE.test(code) || !name || seen.has(code)) continue;
    seen.add(code);
    out.push({ code, name, enabled: item.enabled !== false });
    if (out.length >= MAX_LANGUAGES) break;
  }
  return out;
}

export type LuggageType = "personal" | "standard" | "large" | "excess" | "fragile" | "commercial";
export const LUGGAGE_TYPES: LuggageType[] = ["personal", "standard", "large", "excess", "fragile", "commercial"];
/** Fly Express defaults (xristo7/flyexpress script.js, luggage options). */
export const DEFAULT_LUGGAGE_PRICES: Record<LuggageType, number | null> = { personal: 0, standard: 2000, large: 4000, excess: 6000, fragile: 7000, commercial: null };

/** The luggage types passengers are offered right now: none when luggage is off, otherwise the first `luggageOptionsShown`. */
export const offeredLuggageTypes = (settings: Pick<TaxipressSettings, "luggageEnabled" | "luggageOptionsShown">): LuggageType[] =>
  settings.luggageEnabled ? LUGGAGE_TYPES.slice(0, Math.max(1, Math.min(LUGGAGE_TYPES.length, settings.luggageOptionsShown))) : [];

/** The languages shown to passengers. */
export const offeredLanguages = (settings: Pick<TaxipressSettings, "languageEnabled" | "languages">): LanguageOption[] =>
  settings.languageEnabled ? settings.languages.filter((l) => l.enabled) : [];

function luggagePrices(value: string | null): Record<LuggageType, number | null> {
  const out = { ...DEFAULT_LUGGAGE_PRICES };
  try {
    const parsed = JSON.parse(value ?? "{}") as Record<string, unknown>;
    for (const type of LUGGAGE_TYPES) {
      const v = parsed?.[type];
      if (v === null) out[type] = null;
      else if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1_000_000) out[type] = Math.round(v);
    }
  } catch { /* defaults */ }
  return out;
}

const bool = (value: string | null, fallback: boolean) => (value == null ? fallback : value === "1");
const whole = (value: string | null, fallback: number, max: number) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 0 && n <= max ? n : fallback;
};
const percent = (value: string | null) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 0;
};

function items(value: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(value ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim().slice(0, 60)).slice(0, 50);
  } catch {
    return [];
  }
}

export async function getTaxipressSettings(): Promise<TaxipressSettings> {
  const [
    enabled, rule, sellRoad, type, digital, cash, flat, block, owed, cashOn, seatFee, discount, maxSeats, accept, p14, p18, fit, notAllowed, wait, radius, payWithin, maxCash, freeCancel, retention, feeTo, noShowMin, noShowFee, rebook,
  ] = await Promise.all([
    getSetting("taxipress_enabled"),
    getSetting("taxipress_departure_rule"),
    getSetting("taxipress_sell_free_seats_on_road"),
    getSetting("taxipress_commission_type"),
    getSetting("taxipress_commission_digital_percent"),
    getSetting("taxipress_commission_cash_percent"),
    getSetting("taxipress_commission_flat_ugx"),
    getSetting("taxipress_block_when_owing"),
    getSetting("taxipress_max_owed_ugx"),
    getSetting("taxipress_cash_enabled"),
    getSetting("taxipress_seat_choice_fee_ugx"),
    getSetting("taxipress_return_discount_percent"),
    getSetting("taxipress_max_seats_per_booking"),
    getSetting("taxipress_parcel_accept_rule"),
    getSetting("taxipress_max_parcels_14"),
    getSetting("taxipress_max_parcels_18"),
    getSetting("taxipress_parcel_fit_text"),
    getSetting("taxipress_parcel_not_allowed"),
    getSetting("taxipress_wait_minutes"),
    getSetting("taxipress_stage_radius_m"),
    getSetting("taxipress_pay_within_minutes"),
    getSetting("taxipress_max_cash_bookings"),
    getSetting("taxipress_free_cancel_minutes"),
    getSetting("taxipress_cancel_retention_percent"),
    getSetting("taxipress_fee_to"),
    getSetting("taxipress_no_show_minutes"),
    getSetting("taxipress_no_show_fee_percent"),
    getSetting("taxipress_rebook_on_removal"),
  ]);
  const [bookable, lap, childPct, luggageOn, prices, assistOn, langOn, othersOn, stopsOn, luggageShown, languageList, sharingOn, openOn, openDays, openRefund] = await Promise.all([
    getSetting("taxipress_bookable_taxis"),
    getSetting("taxipress_max_lap_children"),
    getSetting("taxipress_child_seat_fare_percent"),
    getSetting("taxipress_luggage_enabled"),
    getSetting("taxipress_luggage_prices"),
    getSetting("taxipress_assistance_enabled"),
    getSetting("taxipress_language_enabled"),
    getSetting("taxipress_book_for_others_enabled"),
    getSetting("taxipress_show_stops"),
    getSetting("taxipress_luggage_options_shown"),
    getSetting("taxipress_languages"),
    getSetting("taxipress_ticket_sharing_enabled"),
    getSetting("taxipress_open_tickets_enabled"),
    getSetting("taxipress_open_ticket_validity_days"),
    getSetting("taxipress_open_ticket_refund_percent"),
  ]);
  return {
    enabled: enabled === "1",
    departureRule: rule === "driver_choice" || rule === "after_wait" ? rule : "full_only",
    sellFreeSeatsOnRoad: bool(sellRoad, false),
    commissionType: type === "flat" ? "flat" : "percent",
    commissionDigitalPercent: percent(digital),
    commissionCashPercent: percent(cash),
    commissionFlatUgx: whole(flat, 0, 1_000_000),
    blockWhenOwing: bool(block, false),
    maxOwedUgx: whole(owed, 0, 100_000_000),
    cashEnabled: bool(cashOn, true),
    seatChoiceFeeUgx: whole(seatFee, 0, 100_000),
    numberedSeatsEnabled: (await getSetting('taxipress_numbered_seats_enabled')) === '1',
    seatHoldSeconds: Math.max(30,whole(await getSetting('taxipress_seat_hold_seconds'),120,900)),
    returnDiscountPercent: percent(discount),
    returnPackagesEnabled: (await getSetting('taxipress_return_packages_enabled')) === '1',
    returnValidityDays: Math.max(1,whole(await getSetting('taxipress_return_validity_days'),7,365)),
    returnRefundPercent: percent(await getSetting('taxipress_return_refund_percent')),
    maxSeatsPerBooking: Math.max(1, whole(maxSeats, 4, 30)),
    parcelAcceptRule: accept === "any_in_line" ? "any_in_line" : "boarding_now",
    maxParcels14: whole(p14, 0, 50),
    maxParcels18: whole(p18, 0, 50),
    parcelFitText: fit.slice(0, 200),
    parcelNotAllowed: items(notAllowed),
    waitMinutes: whole(wait, 30, 600),
    stageRadiusM: whole(radius, 300, 5000),
    payWithinMinutes: Math.max(1, whole(payWithin, 10, 1440)),
    maxCashBookings: whole(maxCash, 2, 50),
    freeCancelMinutes: whole(freeCancel, 10, 1440),
    cancelRetentionPercent: percent(retention),
    feeTo: feeTo === "peebee" ? "peebee" : "driver",
    noShowMinutes: whole(noShowMin, 10, 240),
    noShowFeePercent: percent(noShowFee),
    rebookOnRemoval: bool(rebook, true),
    bookableTaxis: Math.max(1, whole(bookable, 3, 20)),
    maxLapChildren: whole(lap, 2, 10),
    childSeatFarePercent: childPct == null ? 100 : percent(childPct),
    luggageEnabled: bool(luggageOn, true),
    luggageOptionsShown: luggageShown == null ? LUGGAGE_TYPES.length : Math.max(1, whole(luggageShown, LUGGAGE_TYPES.length, LUGGAGE_TYPES.length)),
    luggagePrices: luggagePrices(prices),
    assistanceEnabled: bool(assistOn, true),
    languageEnabled: bool(langOn, true),
    languages: languageList == null ? DEFAULT_LANGUAGES.map((l) => ({ ...l })) : cleanLanguages((() => { try { return JSON.parse(languageList); } catch { return null; } })()),
    bookForOthersEnabled: bool(othersOn, true),
    showStops: bool(stopsOn, true),
    ticketSharingEnabled: bool(sharingOn, true),
    openTicketsEnabled: bool(openOn, false),
    openTicketValidityDays: whole(openDays, 0, 3650),
    openTicketRefundPercent: openRefund == null ? 100 : percent(openRefund),
  };
}

export async function setTaxipressSettings(next: Partial<TaxipressSettings>): Promise<void> {
  const flag = (value: boolean) => (value ? "1" : "0");
  if (next.enabled != null) await setSetting("taxipress_enabled", flag(next.enabled));
  if (next.departureRule != null) await setSetting("taxipress_departure_rule", next.departureRule);
  if (next.sellFreeSeatsOnRoad != null) await setSetting("taxipress_sell_free_seats_on_road", flag(next.sellFreeSeatsOnRoad));
  if (next.commissionType != null) await setSetting("taxipress_commission_type", next.commissionType);
  if (next.commissionDigitalPercent != null) await setSetting("taxipress_commission_digital_percent", String(next.commissionDigitalPercent));
  if (next.commissionCashPercent != null) await setSetting("taxipress_commission_cash_percent", String(next.commissionCashPercent));
  if (next.commissionFlatUgx != null) await setSetting("taxipress_commission_flat_ugx", String(next.commissionFlatUgx));
  if (next.blockWhenOwing != null) await setSetting("taxipress_block_when_owing", flag(next.blockWhenOwing));
  if (next.maxOwedUgx != null) await setSetting("taxipress_max_owed_ugx", String(next.maxOwedUgx));
  if (next.cashEnabled != null) await setSetting("taxipress_cash_enabled", flag(next.cashEnabled));
  if (next.seatChoiceFeeUgx != null) await setSetting("taxipress_seat_choice_fee_ugx", String(next.seatChoiceFeeUgx));
  if (next.numberedSeatsEnabled != null) await setSetting('taxipress_numbered_seats_enabled',flag(next.numberedSeatsEnabled));
  if (next.seatHoldSeconds != null) await setSetting('taxipress_seat_hold_seconds',String(next.seatHoldSeconds));
  if (next.returnDiscountPercent != null) await setSetting("taxipress_return_discount_percent", String(next.returnDiscountPercent));
  if (next.returnPackagesEnabled != null) await setSetting('taxipress_return_packages_enabled',flag(next.returnPackagesEnabled));
  if (next.returnValidityDays != null) await setSetting('taxipress_return_validity_days',String(next.returnValidityDays));
  if (next.returnRefundPercent != null) await setSetting('taxipress_return_refund_percent',String(next.returnRefundPercent));
  if (next.maxSeatsPerBooking != null) await setSetting("taxipress_max_seats_per_booking", String(next.maxSeatsPerBooking));
  if (next.parcelAcceptRule != null) await setSetting("taxipress_parcel_accept_rule", next.parcelAcceptRule);
  if (next.maxParcels14 != null) await setSetting("taxipress_max_parcels_14", String(next.maxParcels14));
  if (next.maxParcels18 != null) await setSetting("taxipress_max_parcels_18", String(next.maxParcels18));
  if (next.parcelFitText != null) await setSetting("taxipress_parcel_fit_text", next.parcelFitText);
  if (next.parcelNotAllowed != null) await setSetting("taxipress_parcel_not_allowed", JSON.stringify(next.parcelNotAllowed));
  if (next.waitMinutes != null) await setSetting("taxipress_wait_minutes", String(next.waitMinutes));
  if (next.stageRadiusM != null) await setSetting("taxipress_stage_radius_m", String(next.stageRadiusM));
  if (next.payWithinMinutes != null) await setSetting("taxipress_pay_within_minutes", String(next.payWithinMinutes));
  if (next.maxCashBookings != null) await setSetting("taxipress_max_cash_bookings", String(next.maxCashBookings));
  if (next.freeCancelMinutes != null) await setSetting("taxipress_free_cancel_minutes", String(next.freeCancelMinutes));
  if (next.cancelRetentionPercent != null) await setSetting("taxipress_cancel_retention_percent", String(next.cancelRetentionPercent));
  if (next.feeTo != null) await setSetting("taxipress_fee_to", next.feeTo);
  if (next.noShowMinutes != null) await setSetting("taxipress_no_show_minutes", String(next.noShowMinutes));
  if (next.noShowFeePercent != null) await setSetting("taxipress_no_show_fee_percent", String(next.noShowFeePercent));
  if (next.rebookOnRemoval != null) await setSetting("taxipress_rebook_on_removal", flag(next.rebookOnRemoval));
  if (next.bookableTaxis != null) await setSetting("taxipress_bookable_taxis", String(next.bookableTaxis));
  if (next.maxLapChildren != null) await setSetting("taxipress_max_lap_children", String(next.maxLapChildren));
  if (next.childSeatFarePercent != null) await setSetting("taxipress_child_seat_fare_percent", String(next.childSeatFarePercent));
  if (next.luggageEnabled != null) await setSetting("taxipress_luggage_enabled", flag(next.luggageEnabled));
  if (next.luggageOptionsShown != null) await setSetting("taxipress_luggage_options_shown", String(next.luggageOptionsShown));
  if (next.languages != null) await setSetting("taxipress_languages", JSON.stringify(cleanLanguages(next.languages)));
  if (next.luggagePrices != null) await setSetting("taxipress_luggage_prices", JSON.stringify(next.luggagePrices));
  if (next.assistanceEnabled != null) await setSetting("taxipress_assistance_enabled", flag(next.assistanceEnabled));
  if (next.languageEnabled != null) await setSetting("taxipress_language_enabled", flag(next.languageEnabled));
  if (next.bookForOthersEnabled != null) await setSetting("taxipress_book_for_others_enabled", flag(next.bookForOthersEnabled));
  if (next.openTicketsEnabled != null) await setSetting("taxipress_open_tickets_enabled", flag(next.openTicketsEnabled));
  if (next.openTicketValidityDays != null) await setSetting("taxipress_open_ticket_validity_days", String(next.openTicketValidityDays));
  if (next.openTicketRefundPercent != null) await setSetting("taxipress_open_ticket_refund_percent", String(next.openTicketRefundPercent));
  if (next.ticketSharingEnabled != null) await setSetting("taxipress_ticket_sharing_enabled", flag(next.ticketSharingEnabled));
  if (next.showStops != null) await setSetting("taxipress_show_stops", flag(next.showStops));
}
