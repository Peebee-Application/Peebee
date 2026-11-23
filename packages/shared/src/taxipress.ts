/** Taxipress: scheduled shared-taxi seats on fixed routes. See apps/api/src/taxipress. */

export type TaxipressSettings = {
  enabled: boolean;
  /** full_only: a taxi leaves only when every seat is booked. The others let the driver go sooner. */
  departureRule: "full_only" | "driver_choice" | "after_wait";
  sellFreeSeatsOnRoad: boolean;
  commissionType: "percent" | "flat";
  commissionDigitalPercent: number;
  commissionCashPercent: number;
  commissionFlatUgx: number;
  blockWhenOwing: boolean;
  maxOwedUgx: number;
  cashEnabled: boolean;
  seatChoiceFeeUgx: number;
  numberedSeatsEnabled: boolean;
  seatHoldSeconds: number;
  returnDiscountPercent: number;
  returnPackagesEnabled:boolean;
  returnValidityDays:number;
  returnRefundPercent:number;
  maxSeatsPerBooking: number;
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
  /** How many taxis waiting in the line (after the one Boarding Now) passengers may book. The boarding taxi is never bookable. */
  bookableTaxis: number;
  /** Children who may ride on an adult's lap without a seat, per booking (Fly Express: 2). Any more need a seat. */
  maxLapChildren: number;
  /** A child's seat costs this share of the adult fare. */
  childSeatFarePercent: number;
  luggageEnabled: boolean;
  /** How many luggage options passengers are shown: the first this many of TAXIPRESS_LUGGAGE_TYPES. */
  luggageOptionsShown: number;
  /** Price per item, by luggage type. null means it is assessed at the stage. */
  luggagePrices: Record<TaxipressLuggageType, number | null>;
  assistanceEnabled: boolean;
  languageEnabled: boolean;
  /** The languages passengers may ask for. Staff add and remove them and choose which are displayed. */
  languages: TaxipressLanguageOption[];
  /** A passenger may book a seat for someone else (their name, phone and an emergency contact). */
  bookForOthersEnabled: boolean;
  /** A passenger may send a ticket to someone else, and a ticket code opens the ticket's details for anyone who has it. */
  ticketSharingEnabled: boolean;
  /** A passenger may buy an open ticket: the normal fare, valid on any taxi on the route. */
  openTicketsEnabled: boolean;
  /** Days an open ticket stays valid after it is bought. 0 means it never expires. */
  openTicketValidityDays: number;
  /** Share of the fare given back when an open ticket is cancelled or expires unused. */
  openTicketRefundPercent: number;
  /** Show a route's stops (the Relay stages along it) to passengers. */
  showStops: boolean;
};

export type TaxipressLuggageType = "personal" | "standard" | "large" | "excess" | "fragile" | "commercial";
export const TAXIPRESS_LUGGAGE_TYPES: TaxipressLuggageType[] = ["personal", "standard", "large", "excess", "fragile", "commercial"];
/** Fly Express defaults, used whenever the config does not carry prices. Commercial is assessed at the stage. */
export const TAXIPRESS_DEFAULT_LUGGAGE_PRICES: Record<TaxipressLuggageType, number | null> = { personal: 0, standard: 2000, large: 4000, excess: 6000, fragile: 7000, commercial: null };
export const TAXIPRESS_LUGGAGE_LABELS: Record<TaxipressLuggageType, { name: string; note: string }> = {
  personal: { name: "Personal bag", note: "On your lap" },
  standard: { name: "Standard", note: "Up to 15 kg" },
  large: { name: "Large", note: "Up to 25 kg" },
  excess: { name: "Excess", note: "Stage approval" },
  fragile: { name: "Fragile", note: "Handled with care" },
  commercial: { name: "Commercial", note: "Priced at the stage" },
};
export type TaxipressAssistance = "none" | "boarding" | "priority" | "mobility";
/** A language code staff have set up (en, lg and sw to begin with; staff can add more). */
export type TaxipressLanguage = string;
export type TaxipressLanguageOption = { code: string; name: string; enabled: boolean };
export const TAXIPRESS_DEFAULT_LANGUAGES: Array<{ code: string; name: string }> = [{ code: "en", name: "English" }, { code: "lg", name: "Luganda" }, { code: "sw", name: "Swahili" }];

/** What the customer app needs to decide whether to show Taxipress, and what to say. */
export type TaxipressConfig = {
  returnPackagesEnabled?:boolean;
  returnValidityDays?:number;
  returnRefundPercent?:number;
  numberedSeatsEnabled?: boolean;
  seatHoldSeconds?: number;
  /** True only when staff switched it on and at least one route is running. */
  enabled: boolean;
  routes: Array<{
    id: string;
    /** The way along the route, written like a ticket: "KLA - EBB". */
    directionLabel: string;
    routeCode: string;
    fromName: string;
    toName: string;
    farePerSeat: number;
    relayRouteId?: string;
    /** The route the other way, for the swap button. */
    reverseId?: string | null;
    /** Stops along the way, in order, when staff show them. */
    stops?: string[];
  }>;
  cashEnabled: boolean;
  seatChoiceFeeUgx: number;
  returnDiscountPercent: number;
  maxSeatsPerBooking: number;
  /** Minutes to pay for a seat in the app before it is given back. */
  payWithinMinutes: number;
  parcelFitText: string;
  parcelNotAllowed: string[];
  /** False until the passengers, luggage and options migration (0128) is applied: the app then books seats only. */
  detailsReady?: boolean;
  maxLapChildren?: number;
  childSeatFarePercent?: number;
  luggageEnabled?: boolean;
  /** The luggage types to show, in order. Absent from an older server: show them all. */
  luggageTypes?: TaxipressLuggageType[];
  luggagePrices?: Record<TaxipressLuggageType, number | null>;
  assistanceEnabled?: boolean;
  languageEnabled?: boolean;
  /** The languages to show. Absent from an older server: English, Luganda and Swahili. */
  languages?: Array<{ code: string; name: string }>;
  bookForOthersEnabled?: boolean;
  ticketSharingEnabled?: boolean;
  openTicketsEnabled?: boolean;
};

export type TaxipressAdminRoute = {
  id: string;
  relayRouteId: string;
  direction: "a_to_b" | "b_to_a";
  directionLabel: string;
  routeCode: string;
  fromName: string;
  toName: string;
  farePerSeat: number;
  stopPricingEnabled: boolean;
  active: boolean;
  /** The relay route underneath is itself on. */
  relayActive: boolean;
};

/** A route set up in Relay delivery that Taxipress can run on. */
export type TaxipressRelayRoute = { id: string; name: string; stageAName: string; stageBName: string; active: boolean };

/** A taxi (matatu, minibus) approved to run on a route. One approval, two switches. */
export type TaxipressTaxi = {
  numberedSeatsEnabled?: boolean;
  id: string;
  userId: string;
  relayRouteId: string;
  routeName: string | null;
  plate: string;
  seatLayout: "14" | "18";
  seats: number;
  /** The taxi may join the line and take seats. */
  passengersEnabled: boolean;
  /** The taxi may carry relay parcels. */
  parcelsEnabled: boolean;
  status: "pending" | "approved" | "suspended";
  driverName?: string | null;
  driverPhone?: string | null;
};

export type TaxipressLineEntry = {
  /** API path for the driver's face photo (auth needed), or null for an initials avatar. */
  driverPhotoUrl?: string | null;
  id: string;
  taxiId: string;
  driverId: string;
  status: "in_line" | "boarding" | "on_road" | "arrived" | "cancelled";
  /** 1 for the taxi at the front. Only taxis still waiting have one. */
  position: number | null;
  plate: string;
  seatLayout: "14" | "18";
  seatsTotal: number;
  seatsBooked: number;
  walkUpSeats: number;
  seatsTaken: number;
  seatsLeft: number;
  fullyBooked: boolean;
  joinedAt: string;
  boardingAt: string | null;
  departedAt: string | null;
  driverName: string | null;
  /** Passengers may book this taxi now: one of the first taxis waiting behind the boarding one, with seats left. */
  bookable?: boolean;
  /** Estimated departure (ISO), or null when there isn't enough to go on. */
  departsAt?: string | null;
};

/** A taxi's public profile. Fields with no real data are null and are hidden, never made up. */
export type TaxipressTaxiProfile = {
  queueId: string;
  plate: string;
  seatLayout: "14" | "18";
  vehicleType: string | null;
  colour: string | null;
  photoUrl: string | null;
  driverName: string | null;
  driverPhotoUrl: string | null;
  memberSince: string | null;
  tripsCount: number | null;
  rating: number | null;
  ratingCount: number | null;
  reviews: Array<{ rating: number; comment: string | null; createdAt: string }>;
  status: TaxipressLineEntry["status"];
  position: number | null;
  seatsLeft: number;
  bookable: boolean;
  departsAt: string | null;
  route: { id: string; fromName: string; toName: string; stops: string[] };
};

/** Who is travelling and what they bring, on one booking. */
export type TaxipressBookingDetails = {
  adults: number;
  children: number;
  childSeats: number;
  luggage: Partial<Record<TaxipressLuggageType, number>>;
  luggageAmount: number;
  assistance: TaxipressAssistance | null;
  language: TaxipressLanguage | null;
  forSomeoneElse: boolean;
  travellerName: string | null;
  travellerPhone: string | null;
  emergencyPhone: string | null;
};

/** Everything the driver's Taxipress screen needs. */
export type TaxipressDriverView = {
  walkUpSeatNumbers?: string[];
  /** False until the Taxipress taxi and line tables exist. */
  ready: boolean;
  enabled: boolean;
  taxi: TaxipressTaxi | null;
  /** Routes a driver can apply to run a taxi on. */
  applyRoutes: Array<{ id: string; name: string }>;
  /** The directions this taxi's route runs, to join the line for. */
  routes: Array<{ id: string; fromName: string; toName: string }>;
  entry: (TaxipressLineEntry & { taxipressRouteId: string }) | null;
  /** The line the driver is in. */
  line: TaxipressLineEntry[];
  canGoOnRoad: boolean;
  onRoadReason: string | null;
  departureRule: "full_only" | "driver_choice" | "after_wait";
  waitMinutes: number;
  /** Staff's rule is on and the driver owes too much to join the line. */
  owingBlocked: boolean;
  /** The passengers booked on the driver's taxi. */
  bookings: TaxipressManifestPassenger[];
  /** Minutes Boarding Now before an absent passenger can be marked a no-show. */
  noShowMinutes: number;
};

export type TaxipressAdminQueueEntry = TaxipressLineEntry & { taxipressRouteId: string; driverPhone: string | null };

export type TaxipressBookingStatus = "booked" | "boarded" | "no_show" | "cancelled" | "completed";
/** Location is disclosed only to the booking's buyer or recipient, while their trip is active. */
export type TaxipressTracking = {
  enabled: boolean;
  pollAfterSeconds: number;
  booking: TaxipressBooking;
  location: { lat: number; lng: number; updatedAt: string } | null;
};
/** unpaid: an app payment is still due. paid: collected in the app. pay_driver: cash, to be paid to the driver. */
export type TaxipressPaymentStatus = "unpaid" | "paid" | "pay_driver" | "cancelled";

/** What a cancelled, no-show or removed-taxi booking ended with. */
export type TaxipressOutcome = {
  kind: "cancelled" | "no_show" | "taxi_removed";
  /** Returned to the passenger's wallet. */
  refunded: number;
  /** Kept from a paid seat. */
  fee: number;
};

export type TaxipressBooking = {
  returnPackage?:{id:string;leg:'outbound'|'return'}|null;
  seatNumbers?: string[];
  seatChoiceFee?: number;
  id: string;
  /** The order behind the booking: payment, chat, calls and tracking use it. */
  orderId: string;
  status: TaxipressBookingStatus;
  seats: number;
  farePerSeat: number;
  amount: number;
  paymentMethod: "app" | "cash";
  paymentStatus: TaxipressPaymentStatus;
  /** What the driver checks at boarding (also shown as a QR code). */
  ticketCode: string | null;
  createdAt: string;
  /** An app payment still due must be made by this time or the seats are given back. */
  payBy: string | null;
  /** Whether the passenger can cancel now, and what it would cost. */
  cancel: { allowed: boolean; reason: string | null; free: boolean; fee: number; refund: number };
  outcome: TaxipressOutcome | null;
  /** The receipt for a seat that boarded and was settled; its QR opens the verification page. */
  receiptRef: string | null;
  /** Present once migration 0128 is applied. */
  details?: TaxipressBookingDetails | null;
  /** True when someone else bought this ticket and sent it to the signed-in traveller. */
  /** Set for an open ticket: valid on any taxi on this route until validUntil (null = never expires). */
  openTicket?: { validUntil: string | null; expired: boolean } | null;
  sharedWithMe?: boolean;
  /** First name of the person who bought and sent the ticket. */
  sentBy?: string | null;
  route: { id: string; fromName: string; toName: string; directionLabel: string };
  taxi: { queueId: string; plate: string; seatLayout: "14" | "18"; driverName: string | null; driverPhone: string | null; status: string; position: number | null; seatsLeft: number };
};

export type TaxipressReturnPackage = {
  payment?:{id:string;status:string}|null;
  id:string;state:string;returnState:string;mode:string;returnDate:string|null;validUntil:string;quoteUntil:string;
  outboundAmount:number;returnAmount:number;total:number;discountPercent:number;refundPercent:number;refunded:number;
  outboundPaid:number;returnPaid:number;outboundBookingId:string|null;returnBookingId:string|null;orderId:string|null;
  returnRouteId:string;returnRoute:{fromName:string;toName:string}|null;
  checkout:{wallet:number;mobileMoney:number;baseAmount:number}|null;wallet?:number;mobileMoney?:number;
};

/** A passenger on a driver's taxi. */
export type TaxipressManifestPassenger = {
  seatNumbers?: string[];
  id: string;
  passengerName: string | null;
  passengerPhone: string | null;
  seats: number;
  amount: number;
  paymentMethod: "app" | "cash";
  paymentStatus: TaxipressPaymentStatus;
  status: TaxipressBookingStatus;
  adults?: number;
  children?: number;
  bags?: number;
  travellerName?: string | null;
};

/** The taxis waiting on a route, with the route's fare, for the passenger's choice. */
export type TaxipressQueueView = {
  line: TaxipressLineEntry[];
  onRoad: TaxipressLineEntry[];
  route: { id: string; fromName: string; toName: string; directionLabel: string; farePerSeat: number } | null;
};

export type TaxipressSeatMap = {
  enabled: boolean;
  queueId?: string;
  layout?: '14' | '18';
  seats: Array<{ id: string; status: 'available' | 'held' | 'mine' | 'occupied' }>;
  feePerSeat?: number;
  holdSeconds?: number;
  hold: { id: string; seats: string[]; expiresAt: string; fee: number } | null;
};

/** What happened when a driver confirmed a passenger's ticket at boarding. */
export type TaxipressBoardingResult = {
  bookingId: string;
  passengerName: string | null;
  seats: number;
  fare: number;
  paymentMethod: "app" | "cash";
  /** Peebee's Taxipress commission on the fare. */
  commission: number;
  /** App payment: added to the driver's wallet. Cash: what the driver keeps of the cash they collected. */
  driverAmount: number;
  /** Cash only: Peebee's cut, taken from the driver's wallet (which may go below zero). */
  takenFromDriver: number;
  driverBalance: number | null;
};

export type TaxipressReport =
  | { ready: false }
  | {
      ready: true;
      days: number;
      totals: { bookings: number; seats: number; fare: number; commission: number; platformFees: number; driverAmount: number; cashFare: number; appFare: number; takenFromDrivers: number };
      recent: Array<{ id: string; bookingId: string; paymentMethod: "app" | "cash"; seats: number; fare: number; commission: number; platformFees: number; driverAmount: number; takenFromDriver: number; createdAt: string; plate: string; driverName: string | null }>;
      /** Drivers whose wallet is below zero (cash commission taken from a wallet that could not cover it). */
      owing: Array<{ id: string; name: string | null; phone: string | null; balance: number; plate: string }>;
      refunds: { count: number; refunded: number; fees: number; cancelled: number; noShows: number; taxiRemoved: number };
    };

/**
 * The town or city a stage belongs to, for route titles: "Entebbe Taxi Park" → "Entebbe", "Kampala Old Taxi Park" →
 * "Kampala", "Busega Roundabout" → "Busega". The stage's own name is kept for the stops list. A name with nothing
 * to strip (or that would strip to nothing) is returned as it is.
 */
export function taxipressTown(stageName: string): string {
  const name = String(stageName ?? "").trim();
  const town = name.replace(/\s+(?:(?:old|new|main|central)\s+)?(?:(?:taxi|bus|matatu)\s+)?(?:park|stage|stand|stop|station|terminal|roundabout|junction)$/i, "").trim();
  return town || name;
}

/** What a ticket code shows to anyone who has it: the trip and the seat, never who paid or how to reach anyone. */
export type PublicTaxipressTicket = {
  seatNumbers?: string[];
  code: string;
  status: TaxipressBookingStatus;
  paymentStatus: TaxipressPaymentStatus;
  /** What still has to be paid to the driver in cash. */
  amountDue: number | null;
  seats: number;
  adults: number;
  children: number;
  bags: number;
  assistance: string | null;
  language: string | null;
  travellerName: string | null;
  bookedBy: string | null;
  route: { fromName: string; toName: string; directionLabel: string };
  taxi: { plate: string; seatLayout: "14" | "18"; driverName: string | null; status: string; position: number | null };
};

export type TaxipressSendResult = { ok: true; code: string; onPeebee: boolean; travellerName: string; travellerPhone: string };
