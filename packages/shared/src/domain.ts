/** Core domain DTOs — kept in sync with apps/api's real (non-stub) responses. */

import type { AdminRole } from "./permissions.js";
import type { TimeFeeSettings, OrderTimeFees } from "./time-fees.js";

export type ListStatus = "draft" | "active" | "delivered" | "cancelled";

export type ListSummary = {
  id: string;
  listId: string;
  /** A draft whose job expired unserved (admin job expiry) — can be resent. */
  expired?: boolean;
  title: string;
  status: ListStatus;
  itemCount: number;
  updatedAt: string;
  /**
   * Set once this list's order has a rider assigned — the customer home
   * screen prefers "{riderFirstName} · {area}" over the list's own `title`
   * so recent orders read as "who delivered this and where" rather than a
   * generic "New shopping list". Null on a list with no order yet, or one
   * still waiting to be matched.
   */
  riderFirstName: string | null;
  riderId: string | null;
  riderHasPhoto: boolean;
  area: string | null;
  /** The order this list turned into, if any — links to the full order/delivery detail page instead of the bare item list. */
  orderId: string | null;
};

export type ListItem = {
  id: string;
  list_id: string;
  name: string;
  quantity: number;
  note: string | null;
  unit_price: number | null;
};

export type ListRow = {
  id: string;
  customer_id: string;
  title: string;
  status: ListStatus;
  created_at: string;
  updated_at: string;
};

export type ListDetail = {
  list: ListRow;
  items: ListItem[];
  /** The expired order this draft can be resent from, or null. */
  resendOrderId?: string | null;
};

export type OrderType = "shopping" | "parcel";

export type OrderRow = {
  id: string;
  list_id: string;
  customer_id: string;
  customer_name: string | null;
  rider_id: string | null;
  rider_name: string | null;
  matching_mode: MatchingMode;
  stage: string;
  type: OrderType;
  payment_rail: "escrow" | "float" | null;
  funds_model: "legacy_rider_payout" | "merchant_allocations_v1";
  currency: string;
  estimated_total: number | null;
  final_total: number | null;
  delivery_fee: number | null;
  pickup_area: string | null;
  pickup_address: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  destination_area: string | null;
  destination_address: string | null;
  destination_lat: number | null;
  destination_lng: number | null;
  distance_km: number | null;
  matched_out_of_range: number;
  voice_note_key: string | null;
  /** Which voice the cached Luganda list-audio was generated with, its R2
   * object key, and a fingerprint of the list contents used to detect when
   * the cache is stale (list changed, or the rider changed their voice
   * preference) — see GET /orders/:id/list-audio. */
  list_audio_voice: string | null;
  list_audio_key: string | null;
  list_audio_text_hash: string | null;
  pin_code: string | null;
  eta_minutes: number | null;
  /** Set only for restaurant food orders — type stays 'shopping' (see
   * apps/api/src/db/migrations/0034_order_restaurant.sql). */
  restaurant_id: string | null;
  restaurant_name?: string | null;
  /** Available to the assigned rider for a food order so the correct outlet is unambiguous. */
  restaurant_outlet_code?: string | null;
  restaurant_outlet_name?: string | null;
  /** Shared by orders that the customer chose to combine into one rider trip. */
  delivery_bundle_id?: string | null;
  bundle_order_count?: number;
  delivery_bundle_hold?: number;
  /** A passenger ride rather than a goods parcel — type stays 'parcel' (see
   * apps/api/src/db/migrations/0039_ride_orders.sql). Pickup = where the
   * rider collects the passenger, destination = where they're going. */
  is_ride: number;
  /** A ride booked for someone else: who is actually riding. The booker pays;
   * see apps/api/src/db/migrations/0071_ride_for_someone.sql. */
  passenger_name?: string | null;
  passenger_phone?: string | null;
  /** Private link token for the passenger's trip page — customer/admin only. */
  share_token?: string | null;
  /** The rider's most recent live position and when it was reported —
   * only ever populated while the rider has in-app navigation open with
   * nav_mode = "in_app" (see apps/rider/components/InAppNavigation.tsx
   * POST /orders/:id/location). Null once stale/never reported; the
   * customer-facing tracking map treats anything older than a couple
   * minutes as the rider being offline rather than trusting a frozen pin. */
  rider_lat: number | null;
  rider_lng: number | null;
  rider_location_updated_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * An unmatched order as it appears in a rider's available-jobs list — every
 * order eventually reaches every verified/online rider, but the staged
 * radius broadcast means the nearest riders see it first (see
 * apps/api/src/orders/matching.ts): 1km, then 2km, then 3km, then everyone.
 * `distanceKm` is null when it can't be computed (rider or order missing
 * coordinates); `outOfServiceRange` flags a job worth warning the rider
 * (and, once claimed, the customer) may cost more than the normal rate.
 */
export type AvailableJob = Pick<
  OrderRow,
  | "id"
  | "type"
  | "stage"
  | "matching_mode"
  | "payment_rail"
  | "currency"
  | "estimated_total"
  | "final_total"
  | "delivery_fee"
  | "pickup_area"
  | "destination_area"
  | "pickup_lat"
  | "pickup_lng"
  | "destination_lat"
  | "destination_lng"
  | "distance_km"
  | "matched_out_of_range"
  | "created_at"
  | "updated_at"
  | "restaurant_id"
  | "is_ride"
  | "bundle_order_count"
> & {
  /**
   * Deliberately narrower than a full OrderRow. This feed goes to every
   * online rider, including all the ones who never take the job, so it
   * withholds what only the rider who claims it needs: `customer_name` is
   * the first name alone, street addresses are omitted entirely, and the
   * coordinates are rounded to roughly 100m. The full record arrives from
   * GET /v1/orders/:id once the job is claimed.
   */
  customer_name: string | null;
  /** Only set for food orders (restaurant_id != null). */
  restaurant_name: string | null;
  distanceKm: number | null;
  outOfServiceRange: boolean;
  /** Set once this rider has already applied — only meaningful for "nearest_window"/"customer_selects"
   * jobs, where applying doesn't assign the job outright (unlike "first_to_claim"'s Claim button). */
  applied: boolean;
  /** Set when riders may bid on this job: the app's price and the allowed range for a bid. */
  bidding?: { appPrice: number | null; min: number | null; max: number | null } | null;
};

/**
 * How a rider gets assigned to an order — admin picks which of these are on
 * offer at all (packages/shared/src/domain.ts: DeliverySettings.matchingModesEnabled),
 * and when more than one is enabled, the customer's own default preference
 * (see AuthUser-adjacent account settings) decides which applies to their
 * orders. See apps/api/src/orders/matching.ts for the full behavior.
 */
export type MatchingMode = "first_to_claim" | "nearest_window" | "customer_selects";

export const MATCHING_MODE_LABELS: Record<MatchingMode, string> = {
  first_to_claim: "First rider to accept",
  nearest_window: "Nearest available",
  customer_selects: "Let me choose",
};

export const MATCHING_MODE_DESCRIPTIONS: Record<MatchingMode, string> = {
  first_to_claim: "Whichever rider taps \"Claim\" first gets your order — usually the fastest option.",
  nearest_window: "The app collects nearby riders for a short window, then auto-assigns whoever's closest.",
  customer_selects: "See who's offered to take your order — their ratings, reviews, and recommendations — and pick one yourself.",
};

/** Which dataset the whole platform currently reads/writes — see
 * PATCH .../admin/platform-environment and
 * apps/api/src/lib/settings.ts's platform_environment. */
export type PlatformEnvironment = "live" | "sandbox";

/** How long a job may sit unserved (no rider took it) before it is
 * automatically expired — set by the admin in minutes or hours. */
export type JobExpiryUnit = "minutes" | "hours";

/** Price bidding on rides/parcels: applicants may name their own price, the
 * customer picks. Needs "customer selects" to be an enabled matching mode. */
/** Peebee Car work modes + the default owner/driver/platform split of a settled ride (totals 100). */
export type CarSettings = {
  enabled: boolean;
  onDemandEnabled: boolean;
  matchingMode: "customer_selects" | "first_to_claim";
  shares: { owner: number; driver: number; platform: number };
  /** A driver further than this from the pickup isn't offered the ride. */
  maxPickupKm: number;
  /** Owners and drivers may cash their ride earnings out to mobile money. */
  withdrawalsEnabled: boolean;
  /** Smallest withdrawal in UGX; 0 = none. */
  withdrawalMinAmount: number;
  /** Photos of a vehicle: the most an owner can add (at least 6) and how many an admin needs before approving. */
  vehiclePhotos: { max: number; minRequired: number };
  /** Documents an admin needs on file before approving an owner or driver. */
  kyc: { ownerIdRequired: boolean; driverIdRequired: boolean; driverLicenceRequired: boolean };
  /** Drivers apply to owners' cars on agreed terms. */
  deals: {
    enabled: boolean;
    shareEnabled: boolean;
    rentEnabled: boolean;
    /** Range of the owner's agreed share of what is left after Peebee's cut (%). */
    minOwnerSharePercent: number;
    maxOwnerSharePercent: number;
    /** Highest fixed rent per day (UGX); 0 = no limit. */
    maxRentPerDay: number;
  };
  selfDrive: {
    enabled: boolean;
    /** Peebee's share of the rent (%); null = not decided, so self-drive stays off. */
    platformPercent: number | null;
    maxDays: number;
    /** Lowest deposit an owner may ask for (UGX). */
    minDeposit: number;
    /** An owner who hasn't answered a request in this many hours loses it, and the money is returned. */
    approveWithinHours: number;
    /** Return grace period before overtime starts accruing. */
    overtimeGraceHours: number;
  };
  carpool: {
    enabled: boolean;
    /** Most seats one passenger can book on a trip. */
    maxSeatsPerBooking: number;
    /** A driver may repeat a trip weekly for this many weeks (0 = single trips only). */
    maxRepeatWeeks: number;
    /** Seats can't be booked within this many minutes of departure. */
    cutoffMinutes: number;
    /** A booked seat not paid within this many minutes is released. */
    payWithinMinutes: number;
    /** A passenger's start and end must be within this distance of the trip's. */
    matchRadiusKm: number;
  };
  scheduled: {
    enabled: boolean;
    /** How far ahead a ride can be booked; null = not set, so scheduled rides stay off. */
    maxAdvanceHours: number | null;
    /** Shortest notice for a booking. */
    minLeadMinutes: number;
    /** The job opens to drivers this long before pickup. */
    openMinutes: number;
    /** Within this long of pickup, the assigned driver is watched. */
    watchMinutes: number;
    /** No location update for this long counts as "no signal". */
    noSignalMinutes: number;
    /** Average speed used to judge whether the driver will arrive in time. */
    avgSpeedKmh: number;
  };
};

export type BiddingSettings = { enabled: boolean; minPercent: number; maxPercent: number };
export type JobExpirySettings = { enabled: boolean; value: number; unit: JobExpiryUnit };

/** Admin-tunable delivery pricing/matching numbers (packages/shared/src/api-client.ts: getSettings/adminUpdateSettings). */
export type DeliverySettings = {
  timeFees: TimeFeeSettings;
  jobExpiry: JobExpirySettings;
  bidding: BiddingSettings;
  car: CarSettings;
  /** Which environment's orders/wallets/lists everyone currently sees —
   * read-only here (GET /settings); change it with
   * adminSetPlatformEnvironment. */
  platformEnvironment: PlatformEnvironment;
  /** Whether signed-in users may launch isolated, browser-local guided
   * practice journeys. This does not change platformEnvironment. */
  practiceModeEnabled: boolean;
  deliveryRatePerKm: number;
  /** Floor on a parcel ride's distance-priced fee (UGX) — never lets a very
   * short ride round down toward a near-free delivery. */
  minimumDeliveryFee: number;
  serviceRangeKm: number;
  /** Flat delivery fee (UGX) added on top of a shopping order's item costs
   * — see apps/api/src/lib/settings.ts for why shopping can't be priced by
   * distance the way a parcel ride is. */
  shoppingDeliveryFee: number;
  shoppingUnits?: import("./shopping-units.js").ShoppingUnitSettings;
  rideTracking?: import("./ride-tracking.js").RideTrackingSettings;
  /** A passenger ride's own per-km rate and floor — priced the same way as
   * a parcel (distance × rate, never below the floor) but tracked
   * separately since carrying a person is a different real-world fare
   * than carrying a package. */
  rideRatePerKm: number;
  rideMinimumFare: number;
  /** Whether customers may book a ride for someone else, and how far (metres)
   * the pickup may be from where the customer is before the app asks. */
  rideForOtherEnabled: boolean;
  rideForOtherDistanceM: number;
  /** Whole-service switches (admin → Settings → Services). Off = no new orders of
   * that kind; anything already in flight finishes. Shopping, parcels, rides
   * (incl. Peebee Car bookings) and food. */
  services: ServiceSwitches;
  enabledModes: MatchingMode[];
  nearestWindowSeconds: number;
  maxAssignmentMinutes: number;
  paymentsActiveProviders: PaymentProviderIdentity[];
  /** Demo/sandbox mode — every payment runs through the mock adapters
   * regardless of saved credentials. See PaymentProviderInfo/IntegrationsStatus. */
  paymentsDemoMode: boolean;
  /** Dark-launch switch for the merchant allocation flow. Live enablement is
   * additionally gated by an active regulated-custody approval server-side. */
  merchantPaymentsEnabled: boolean;
  merchantLiveCustodyApproved: boolean;
  merchantWithdrawalsFrozen: boolean;
  walletUnverifiedCap: number;
  walletVerifiedCap: number;
  walletMaxTopup: number;
  /** How long any voice recording may run before it auto-stops — a shopping
   * list, an order note, a fee-proposal reason, or a chat voice message. */
  voiceNoteMaxSeconds: number;
  /** Floor a rider's own withdrawal always leaves behind in their wallet
   * (UGX) when enabled — doesn't apply to closing the account, which pays
   * out everything. See POST /riders/me/wallet/withdraw. */
  riderMinimumBalanceEnabled: boolean;
  riderMinimumBalanceAmount: number;
  /** Which voice-calling backend "call" buttons currently use — see
   * apps/api/src/calls/. Read-only here; change with PUT /admin/calls-settings. */
  callsActiveProvider: CallProviderIdentity;
  /** Which map backend location pickers/geocoding currently use — see
   * apps/api/src/maps/. Read-only here; change with PUT /admin/maps-settings. */
  mapsActiveProvider: MapsProviderIdentity;
  /** The active provider's own browser-embeddable key, only non-null once
   * that provider is actually configured — apps/*\/components/LocationMapPicker.tsx
   * falls back to "streetmaps" whenever the one it wants is null. */
  mapsGoogleApiKey: string | null;
  mapsMapboxAccessToken: string | null;
  mapsMaptilerApiKey: string | null;
  mapsStadiaApiKey: string | null;
  mapsThunderforestApiKey: string | null;
  mapsJawgAccessToken: string | null;
  mapsTomtomApiKey: string | null;
  /** Which Jawg style light mode uses by default (dark mode is always
   * Jawg Dark); each user can still override it in Appearance settings. */
  mapsJawgLightStyle: JawgLightStyle;
  /** Whether the rider app's "Start Navigation" sends riders out to Google
   * Maps ("external", the default) or renders navigation in-app using the
   * active maps provider ("in_app"). Change with PUT /admin/nav-mode. */
  navMode: NavMode;
  /** Reads a rider's shopping list aloud in Luganda (see
   * apps/api/src/speech/gemini.ts) — off by default, since it needs a
   * working Google AI Studio API key (GEMINI_API_KEY). `lugandaAudioVoices` is the admin-curated
   * catalog a rider picks from in their own settings. */
  lugandaAudioEnabled: boolean;
  lugandaAudioVoices: LugandaVoice[];
  lugandaAudioDefaultVoice: string;
  /** When on, listening to a list's audio requires the rider to have an
   * active Pro subscription (see ProSettings below). Off by default. */
  lugandaAudioRequiresPro: boolean;
  /** "per_item": one translation request per list item (original behaviour).
   * "whole_list": the whole list in one request — far fewer requests, so the
   * free daily limits last much longer. */
  lugandaTranslateMode: "per_item" | "whole_list";
} & MonetizationSettings &
  VslaSettings &
  ProSettings;

/** Rider "Pro" — a separate, optional paid tier from MonetizationSettings'
 * own subscriptionEnabled/Mode/Amount/Cadence, which gate job matching
 * itself. Admin may enable either pricing mode or both; when both are on,
 * a rider picks which to buy. See apps/api/src/riders/pro-subscription.ts. */
export type ProSettings = {
  proSubscriptionEnabled: boolean;
  proRecurringEnabled: boolean;
  proRecurringAmount: number;
  proRecurringCadence: SubscriptionCadence;
  proOnetimeEnabled: boolean;
  proOnetimeAmount: number;
};

/** The prebuilt voices Google AI Studio's text-to-speech offers; a catalog
 * entry's `id` is one of these names (see apps/api/src/speech/gemini.ts). */
export const GEMINI_TTS_VOICES = [
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe",
  "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
  "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
] as const;
export const DEFAULT_GEMINI_VOICE = "Kore";

export type LugandaVoice = { id: string; label: string };

/** A Google AI Studio API key as the admin app sees it — never the secret itself. */
export type AiKey = {
  id: string;
  label: string;
  hint: string;
  enabled: boolean;
  isMaster: boolean;
  /** ready = can take requests now; cooling = waiting for its limit to reset. */
  status: "ready" | "cooling" | "disabled";
  cooldownUntil: string | null;
  cooldownReason: string | null;
  /** The Google Cloud project this key was made in. Keys sharing a project share one quota. */
  projectTag: string | null;
  /** Models this key is currently out of quota for, and when each comes back. */
  limits: Array<{ model: string; until: string; reason: string }>;
  lastError: string | null;
  lastUsedAt: string | null;
  useCount: number;
  failCount: number;
  createdAt: string;
};
export type AiKeyMode = "test" | "paid";
export type AiKeysOverview = {
  mode: AiKeyMode;
  rotationSeconds: number;
  nextRotationAt: string | null;
  keys: AiKey[];
  /** False until migration 0074_ai_api_keys.sql is applied. */
  tableReady: boolean;
  encryptionConfigured: boolean;
  /** The GEMINI_API_KEY secret, used while no keys are saved here. */
  envKeyPresent: boolean;
};
export type AiKeyAddResult = { label: string; hint: string; status: "added" | "duplicate" | "rejected"; detail?: string };

export type EmailKey = {
  id: string;
  label: string;
  hint: string;
  accountTag: string;
  fromAddress: string;
  enabled: boolean;
  isLive: boolean;
  status: "ready" | "cooling" | "disabled";
  cooldownUntil: string | null;
  cooldownReason: string | null;
  windowUsed: number;
  useCount: number;
  failCount: number;
  lastUsedAt: string | null;
  lastError: string | null;
};
export type EmailKeySettings = {
  mode: "live" | "test";
  rotationSeconds: number;
  windowRequests: number;
  windowSeconds: number;
  quotaRetrySeconds: number;
};
export type EmailKeysOverview = EmailKeySettings & {
  keys: EmailKey[];
  tableReady: boolean;
  encryptionConfigured: boolean;
  envKeyPresent: boolean;
  activeKeyId: string | null;
  nextRotationAt: string | null;
};

/** Rider Stage Savings Circles — a VSLA-style group savings/loans feature.
 * See apps/api/src/stages/routes.ts and apps/api/src/lib/settings.ts
 * getVslaSettings for how each of these is enforced. */
export type VslaContributionRecorderRole = "any_officer" | "treasurer_only";
export type VslaAdminLedgerVisibility = "read_only_all" | "private_per_stage";
export type VslaFeaturePlacement = "home_card_and_screen" | "bottom_nav_tab" | "account_only" | "wallet_card";

export type VslaSettings = {
  vslaLoanInterestEnabled: boolean;
  vslaDefaultInterestRate: number;
  vslaDefaultLoanableMultiple: number;
  vslaDefaultCycleMonths: number;
  vslaDefaultMaxLoanMonths: number;
  /** UGX per share when a stage's officers don't set their own. */
  vslaDefaultSharePrice: number;
  /** Who's allowed to confirm a declared contribution/repayment as
   * actually received. */
  vslaContributionRecorderRole: VslaContributionRecorderRole;
  /** Whether a second officer must also confirm a cash amount before it
   * counts, on top of the one who recorded it. */
  vslaCashDoubleCheckRequired: boolean;
  vslaAdminLedgerVisibility: VslaAdminLedgerVisibility;
  /** Hours an unconfirmed contribution/repayment intent sits before the
   * rider app prompts the member to call/message the treasurer. */
  vslaUnconfirmedIntentEscalationHours: number;
  vslaFeaturePlacement: VslaFeaturePlacement;
  /** When on, joining or creating a new stage requires an active Pro
   * subscription — except a rider who already has a stage membership,
   * grandfathered so nothing is taken away from existing members. */
  vslaRequiresPro: boolean;
  /** Architecture hook for after Peebee is BOU-licensed to hold funds
   * directly. Off (non-custodial) by default and today — every RSLA
   * money-moving step stays a two-part intent/officer-confirmed record
   * between members' own phones/hands, never through a Peebee-controlled
   * account. This flag doesn't change that behavior yet. */
  vslaCustodialMode: boolean;
};

export type NavMode = "external" | "in_app";

export type ServiceFeeType = "flat" | "percent";
export type ProcessingFeeMode = "customer" | "rider" | "split";
export type SubscriptionCadence = "daily" | "weekly" | "monthly";
export type SubscriptionMode = "recurring" | "once";
/** Which pool absorbs a cash-order platform-fee deduction at Settle —
 * "wallet" comes out of the rider's normal earnings balance (can go
 * negative, nets against the next payout, no work restriction); "deposit"
 * treats the rider minimum-balance reserve as a hard floor they must keep
 * topped up to take new jobs at all. See apps/api/src/orders/routes.ts. */
export type CashFeeSource = "wallet" | "deposit";

/** Every monetization mechanism an admin can independently turn on and
 * price, from Settings → Monetization. See
 * apps/api/src/lib/monetization.ts for how these combine at Fund/Settle
 * time, and apps/api/src/riders/subscription.ts for how the subscription
 * fields drive rider billing/enforcement. */
export type MonetizationSettings = {
  /** % of the delivery fee (never item cost) withheld from the rider's
   * payout, set per order type since a parcel's whole total is its
   * delivery fee. */
  deliveryCommissionEnabled: boolean;
  deliveryCommissionParcelPercent: number;
  deliveryCommissionShoppingPercent: number;
  /** Flat or % surcharge added on top of the customer's total at Fund —
   * 100% platform revenue. */
  serviceFeeEnabled: boolean;
  serviceFeeType: ServiceFeeType;
  serviceFeeValue: number;
  /** The service fee can never exceed this % of the fare (1–99, so it is always less than the fare). Admin-set. */
  serviceFeeMaxSharePercent: number;
  /** Models the real cost of moving money through a payment rail — charged
   * to the customer, withheld from the rider, or split between both.
   * Skipped for wallet-funded and float-rail orders. */
  processingFeeEnabled: boolean;
  processingFeePercent: number;
  processingFeeMode: ProcessingFeeMode;
  /** Only used when processingFeeMode is "split" — customer's share 0-100. */
  processingFeeSplitCustomerPercent: number;
  cashFeeSource: CashFeeSource;
  subscriptionEnabled: boolean;
  /** "recurring" bills every subscriptionCadence; "once" charges a single
   * lifetime fee at activation and never bills that rider again. */
  subscriptionMode: SubscriptionMode;
  subscriptionAmount: number;
  subscriptionCadence: SubscriptionCadence;
};

/** A rider's own subscription state — see GET /riders/me/subscription. */
export type RiderSubscriptionView = {
  required: boolean;
  mode: SubscriptionMode;
  amount: number;
  cadence: SubscriptionCadence;
  status: "inactive" | "active" | "past_due";
  /** True once they're paid up (for "once" mode, this stays true forever
   * after the first successful payment). */
  current: boolean;
  /** Null for a lifetime ("once") subscriber or anyone who's never paid —
   * there's no real expiry date to show either way. */
  paidThrough: string | null;
};

export type RiderSubscriptionPayment = {
  id: string;
  rider_id: string;
  mode: SubscriptionMode;
  amount: number;
  provider: string;
  provider_ref: string | null;
  msisdn: string | null;
  status: "pending" | "successful" | "failed";
  period_start: string | null;
  period_end: string | null;
  created_at: string;
  updated_at: string;
};

/** Rider "Pro" — a separate, optional paid tier from RiderSubscriptionView
 * above, which gates job matching itself. Pro instead unlocks whichever
 * premium features individually opt into requiring it (Luganda list-audio,
 * Stage Savings). Unlike the base subscription, both pricing modes may be
 * offered at once — the rider then picks which to buy (`mode` is null
 * until they've bought either). See apps/api/src/riders/pro-subscription.ts. */
export type RiderProSubscriptionView = {
  enabled: boolean;
  recurringEnabled: boolean;
  recurringAmount: number;
  recurringCadence: SubscriptionCadence;
  onetimeEnabled: boolean;
  onetimeAmount: number;
  status: "inactive" | "active" | "past_due";
  current: boolean;
  mode: SubscriptionMode | null;
  paidThrough: string | null;
};

export type RiderProSubscriptionPayment = {
  id: string;
  rider_id: string;
  mode: SubscriptionMode;
  amount: number;
  provider: string;
  provider_ref: string | null;
  msisdn: string | null;
  status: "pending" | "successful" | "failed";
  period_start: string | null;
  period_end: string | null;
  created_at: string;
  updated_at: string;
};

export type OrderEvent = {
  id: string;
  order_id: string;
  stage: string;
  note: string | null;
  actor_id: string | null;
  created_at: string;
};

export type Substitution = {
  id: string;
  order_id: string;
  item_id: string | null;
  original_name: string;
  substitute_name: string;
  price_delta: number;
  status: "pending" | "approved" | "rejected";
  batch_id: string | null;
  created_at: string;
};

export type Payment = {
  id: string;
  order_id: string;
  type: "collection" | "disbursement" | "refund";
  provider: string;
  provider_ref: string | null;
  msisdn: string | null;
  network: string | null;
  amount: number;
  currency: string;
  status: "pending" | "successful" | "failed";
  created_at: string;
};

export type ChatMessage = {
  id: string;
  /** Null for a call-log entry logged outside any specific order's chat —
   * see call_id below. Every other message type still always has one. */
  order_id: string | null;
  sender_id: string;
  sender_role: "customer" | "rider" | "admin";
  body: string;
  type: "text" | "image" | "voice" | "call";
  media_key: string | null;
  created_at: string;
  /** Set once the recipient's client has fetched this message. */
  delivered_at: string | null;
  /** Set once the recipient has actually played a voice message — not
   * meaningful for other message types. */
  played_at: string | null;
  /** Whether the recipient has read up to this message — only meaningful
   * on a message the viewer themself sent (drives their own tick color). */
  read: boolean;
  /** Only set on a `type: "call"` message — see apps/api/src/calls/routes.ts
   * logCallToChat. `sender_id` is the call's caller, so the viewer can tell
   * outgoing vs incoming (WhatsApp-style "Missed call" vs "Call declined"). */
  call_id: string | null;
  call_status: "declined" | "missed" | "ended" | null;
  call_duration_seconds: number | null;
  /** Set once "delete for everyone" clears the content — body/media_key
   * are already emptied by then, so a client renders a tombstone off this
   * instead. Never set by "delete for me" (hidden_for_*), which the
   * server just filters out of the response entirely. */
  deleted_at: string | null;
  deleted_by: string | null;
  /** The message this one quotes, and a snapshot of it (joined server-side
   * — see THREAD_SELECT in apps/api/src/orders/routes.ts) so a client can
   * render the quoted preview without a second fetch. All null together
   * when this message isn't a reply. */
  reply_to_id: string | null;
  reply_to_body: string | null;
  reply_to_type: "text" | "image" | "voice" | "call" | null;
  reply_to_sender_role: "customer" | "rider" | "admin" | null;
  reply_to_deleted_at: string | null;
};

/** One row in the Chat tab's conversation list — the other party in a customer/rider pair, and their last message. */
export type ChatThread = {
  counterpartId: string;
  counterpartName: string;
  counterpartHasPhoto: boolean;
  lastMessagePreview: string;
  lastMessageAt: string;
  unread: boolean;
};

/** Opening a conversation by counterpart (not by a specific order) — the whole shared history, plus which order a new message attaches to. */
export type ChatThreadDetail = {
  orderId: string;
  counterpartName: string;
  counterpartHasPhoto: boolean;
  messages: ChatMessage[];
};

export type Rider = {
  user_id: string;
  /** Stable rider reference for support and order handoff. */
  rider_code?: string | null;
  verified: number;
  is_online: number;
  area: string | null;
  created_at: string;
  vehicle_info: string | null;
  rating: number;
  momo_msisdn: string | null;
  first_name: string | null;
  last_name: string | null;
  alt_phone: string | null;
  stage_address: string | null;
  home_address: string | null;
  stage_lat: number | null;
  stage_lng: number | null;
  stage_name: string | null;
  stage_chairman_name: string | null;
  stage_chairman_contact: string | null;
  /** The rider's canonical stage — set when they join/register an RSLA
   * (see linkRiderToStage in apps/api/src/stages/routes.ts). This is
   * replacing the free-text stage_name/stage_address/stage_chairman_*
   * fields above as the source of truth; those stay for riders who
   * haven't re-linked yet. */
  stage_id: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  national_id_key: string | null;
  profile_photo_key: string | null;
  profile_completed_at: string | null;
  /** This rider's own standing Luganda-voice choice — applies to every
   * list/order they listen to (see PUT /riders/me/voice-preference). Null
   * until they pick one, falling back to the admin's default voice. */
  preferred_lug_voice: string | null;
  /** Rider "Pro" state — a separate, optional paid tier from
   * subscription_status/subscription_paid_through above, which gate job
   * matching itself. See RiderProSubscriptionView and
   * apps/api/src/riders/pro-subscription.ts. */
  pro_status: "inactive" | "active" | "past_due";
  pro_paid_through: string | null;
  pro_mode: SubscriptionMode | null;
};

/** Same lifetime-sentinel-aware "is this rider currently Pro" check the API
 * uses server-side (apps/api/src/riders/pro-subscription.ts), exposed here
 * so a client can decide whether to show a Pro upsell without waiting on a
 * network round trip — the server endpoint remains the actual enforcement. */
export function isProSubscriptionCurrent(rider: Pick<Rider, "pro_status" | "pro_paid_through"> | null | undefined): boolean {
  if (!rider || rider.pro_status !== "active" || !rider.pro_paid_through) return false;
  const raw = rider.pro_paid_through;
  const normalized = /Z|[+-]\d\d:\d\d$/.test(raw) ? raw : `${raw.replace(" ", "T")}Z`;
  return new Date(normalized).getTime() >= Date.now();
}

/** The fields a rider must fill in (incl. their motorcycle reg. via `vehicle_info`,
 * a National ID scan, a face photo, and a stage location picked on the map)
 * before they're eligible for admin verification/approval to take jobs. */
export function isRiderProfileComplete(rider: Rider | null | undefined): boolean {
  if (!rider) return false;
  return Boolean(
    rider.first_name &&
      rider.last_name &&
      rider.vehicle_info &&
      rider.stage_address &&
      rider.stage_lat != null &&
      rider.stage_lng != null &&
      rider.home_address &&
      rider.stage_name &&
      rider.stage_chairman_name &&
      rider.stage_chairman_contact &&
      rider.emergency_contact_name &&
      rider.emergency_contact_phone &&
      rider.national_id_key &&
      rider.profile_photo_key,
  );
}

/** Shape returned by the admin rider-listing endpoints: a `Rider` row joined with its user record. */
export type AdminRider = Rider & {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  status: UserStatus;
};

/** pending_approval: signed up, admin hasn't reviewed yet — invisible to
 * customers. active: approved, visible (subject to is_open). suspended:
 * admin pulled it from the platform. */
export type RestaurantStatus = "pending_approval" | "active" | "suspended";

/** A restaurant business — not yet a first-class users.role (see
 * apps/api/src/db/migrations/0032_restaurants.sql for why); owner_id
 * points at a normal customer-role account that manages it. */
export type Restaurant = {
  theme_scene?: import("./colour-scenes.js").ColourScene | null;
  theme_mode?: "auto" | "light" | "dark" | null;
  business_type?: import("./food-business.js").FoodBusinessType;
  /** Fictional catalogue entry. Shared ordering is enabled only by the sandbox API. */
  is_demo?: boolean;
  demo_checkout_enabled?: boolean;
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  cuisine: string | null;
  phone: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  logo_key: string | null;
  cover_key: string | null;
  status: RestaurantStatus;
  is_open: number;
  /** Scheduled opening hours, "HH:MM" 24-hour local time. Both null means
   * no schedule — is_open is a pure manual toggle. */
  open_time: string | null;
  close_time: string | null;
  /** Shared financial identity introduced by the merchant ledger. */
  merchant_id: string | null;
  outlet_id: string | null;
  created_at: string;
  updated_at: string;
};

export type MerchantBalance = {
  held: number;
  available: number;
  settling: number;
  updated_at?: string;
};

export type Merchant = {
  id: string;
  merchant_code?: string | null;
  legal_name: string;
  display_name: string;
  business_kind: "business" | "personal_seller";
  status: "pending_approval" | "provisional" | "active" | "suspended" | "rejected";
  trust_tier: "new" | "standard" | "trusted" | "restricted";
  registration_number: string | null;
  tax_id: string | null;
  environment: PlatformEnvironment;
  member_role?: "owner" | "finance" | "manager" | "cashier";
  kyc_status?: "pending" | "in_review" | "approved" | "rejected" | "expired";
  has_owner_id_document?: number;
  has_business_document?: number;
  created_at: string;
  updated_at: string;
};

export type AdminMerchant = Merchant & {
  kyc_status: string | null;
  has_owner_id_document: number;
  has_business_document: number;
  outlet_count: number;
  held: number | null;
  available: number | null;
  settling: number | null;
};

export type AdminMerchantRange = "day" | "week" | "month" | "year";

export type AdminMerchantProfile = AdminMerchant & {
  phone_verified: number;
  identity_verified: number;
  business_verified: number;
  risk_notes: string | null;
  approved_at: string | null;
  approved_by_name: string | null;
  reviewed_at: string | null;
  reviewed_by_name: string | null;
};

export type MerchantCategory = {
  id: string;
  slug: string;
  name: string;
};

export type MerchantOutlet = {
  id: string;
  merchant_id: string;
  category_id: string;
  category_name?: string;
  category_slug?: string;
  name: string;
  code: string;
  phone: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  status: "active" | "suspended" | "closed";
  created_at: string;
  updated_at: string;
};

export type MerchantMember = {
  user_id: string;
  role: "owner" | "finance" | "manager" | "cashier";
  status: "invited" | "active" | "revoked";
  outlet_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  created_at: string;
};

export type MerchantTransaction = {
  id: string;
  kind: string;
  reference_type: string | null;
  reference_id: string | null;
  description: string | null;
  created_at: string;
  amount: number;
  purpose: string;
  currency: string;
  environment: PlatformEnvironment;
};

export type MerchantPaymentSummary = {
  id: string;
  order_id: string;
  outlet_id: string;
  outlet_name: string;
  amount: number;
  status: MerchantPayment["status"];
  confirmation_mode: MerchantPayment["confirmation_mode"];
  risk_state: MerchantPayment["risk_state"];
  receipt_reference: string | null;
  rider_id: string;
  rider_name: string;
  created_at: string;
  updated_at: string;
};

export type MerchantDispute = {
  id: string;
  order_id: string;
  merchant_payment_id: string;
  opened_by: string;
  amount: number | null;
  reason: string;
  status: "open" | "under_review" | "resolved_merchant" | "resolved_customer" | "cancelled";
  created_at: string;
  updated_at: string;
};

export type MerchantSettlementAccount = {
  id: string;
  type: "momo" | "bank";
  provider: string;
  account_name: string | null;
  network_or_bank: string | null;
  status: "pending_verification" | "verified" | "disabled";
  is_primary: number;
  verified_at: string | null;
  cooling_until: string | null;
  masked_account_ref: string;
};

export type MerchantSettlement = {
  id: string;
  amount: number;
  fee: number;
  total_debit?: number;
  mode?: "instant" | "scheduled";
  status: "reserved" | "submitted" | "pending" | "unknown" | "successful" | "failed" | "reversed" | "cancelled";
  provider?: string | null;
  provider_ref?: string | null;
  failure_code?: string | null;
};

export type AdminMerchantSettlement = MerchantSettlement & {
  total_debit: number;
  mode: "instant" | "scheduled";
  provider: string | null;
  provider_ref: string | null;
  failure_code: string | null;
  account_name: string | null;
  network_or_bank: string | null;
  masked_account_ref: string;
  created_at: string;
  updated_at: string;
};

export type AdminMerchantProfileResponse = {
  merchant: AdminMerchantProfile;
  outlets: MerchantOutlet[];
  members: MerchantMember[];
  settlementAccounts: AdminMerchantSettlementAccount[];
  payments: MerchantPaymentSummary[];
  transactions: MerchantTransaction[];
  settlements: AdminMerchantSettlement[];
  range: AdminMerchantRange;
};

export type MerchantPayment = {
  id: string;
  order_id: string;
  merchant_id: string;
  outlet_id: string;
  amount: number;
  status: "awaiting_confirmation" | "available" | "held" | "settlement_pending" | "paid" | "declined" | "expired" | "reversed" | "disputed" | "failed";
  confirmation_mode: "dual_confirm" | "merchant_request" | "rider_only";
  rider_id: string;
  rider_confirmed_at: string | null;
  merchant_confirmed_at: string | null;
  risk_state: "pending" | "passed" | "step_up" | "held" | "rejected";
  environment: PlatformEnvironment;
  outlet_name?: string;
  display_name?: string;
  created_at: string;
};

export type MerchantCustodyApproval = {
  id: string;
  custody_provider: string;
  payout_provider: string;
  environment: "live";
  currency: "UGX";
  safeguarding_reference: string;
  status: "active" | "expired" | "revoked";
  effective_at: string;
  expires_at: string | null;
  created_at: string;
};

export type AdminMerchantSettlementAccount = MerchantSettlementAccount & {
  merchant_id: string;
  display_name: string;
  created_at: string;
};

export type MerchantReconciliationRow = {
  merchant_id: string;
  display_name: string;
  environment: PlatformEnvironment;
  held: number;
  available: number;
  settling: number;
  ledger_held: number;
  ledger_available: number;
  ledger_settling: number;
  reconciled: boolean;
};

export type MerchantProviderOperation = {
  id: string;
  operation_type: "collection" | "disbursement";
  business_type: string;
  business_id: string;
  provider: string;
  provider_ref: string | null;
  amount: number;
  currency: string;
  environment: PlatformEnvironment;
  status: "submitted" | "pending" | "unknown";
  attempt_count: number;
  last_checked_at: string | null;
  next_check_at: string | null;
  failure_code: string | null;
  created_at: string;
};

/** Shape returned by the admin restaurant directory: a `Restaurant` row joined with its owner's account. */
export type AdminRestaurant = Restaurant & {
  owner_name: string;
  owner_phone: string | null;
  owner_email: string | null;
};

// ---------------------------------------------------------------------------
// Menu — Phase 2 of food ordering (see apps/api/src/restaurants/menu.ts).
// ---------------------------------------------------------------------------

export type MenuItemOptionChoice = {
  id: string;
  name: string;
  price_delta: number;
  sort_order: number;
};

/** One customization group on an item — e.g. "Size" (required, pick one)
 * or "Extras" (optional, pick several): required + multi_select together
 * describe every real-world shape. */
export type MenuItemOption = {
  id: string;
  menu_item_id: string;
  name: string;
  required: number;
  multi_select: number;
  sort_order: number;
  choices: MenuItemOptionChoice[];
};

/** Promotional pill shown on the customer-facing card — see
 * apps/customer/app/restaurants/[id]/page.tsx. */
export type MenuItemBadge = "sale" | "new" | "trending";

export type MenuItem = {
  is_featured?: number;
  id: string;
  restaurant_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price: number;
  photo_key: string | null;
  /** The owner's own 86-a-dish toggle — distinct from the whole
   * restaurant being open/closed (Restaurant.is_open). */
  available: number;
  prep_time_minutes: number | null;
  sort_order: number;
  badge: MenuItemBadge | null;
  created_at: string;
  updated_at: string;
  options: MenuItemOption[];
};

export type MenuCategory = {
  id: string;
  restaurant_id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  items: MenuItem[];
};

/** The full owner-facing menu tree — categories with their items nested,
 * plus a bucket for items that aren't in any category. */
export type RestaurantMenu = {
  categories: MenuCategory[];
  uncategorizedItems: MenuItem[];
};

// ---------------------------------------------------------------------------
// Restaurant chat — customer <-> restaurant messaging, separate from
// order-level chat_messages (customer/rider only). See
// apps/api/src/restaurants/chat.ts and migrations/0037_restaurant_chat.sql.
// ---------------------------------------------------------------------------

export type RestaurantChatMessage = {
  id: string;
  restaurant_id: string;
  customer_id: string;
  sender_role: "customer" | "restaurant";
  body: string | null;
  type: "text" | "image" | "voice" | "call";
  media_key: string | null;
  menu_item_id: string | null;
  menu_item_name: string | null;
  read: number;
  created_at: string;
  /** Only set on a `type: "call"` message — see apps/api/src/calls/routes.ts logCallToChat. */
  call_id: string | null;
  call_status: "declined" | "missed" | "ended" | null;
  call_duration_seconds: number | null;
  /** Set once "delete for everyone" clears the content — body/media_key
   * are already emptied by then. Never set by "delete for me", which the
   * server just filters out of the response entirely. */
  deleted_at: string | null;
  deleted_by: string | null;
  /** The message this one quotes, and a snapshot of it (joined server-side
   * — see THREAD_SELECT in apps/api/src/restaurants/chat.ts). */
  reply_to_id: string | null;
  reply_to_body: string | null;
  reply_to_type: "text" | "image" | "voice" | "call" | null;
  reply_to_sender_role: "customer" | "restaurant" | null;
  reply_to_deleted_at: string | null;
};

/** One row per customer who's messaged a restaurant — the owner's inbox list. */
export type RestaurantChatThread = {
  customer_id: string;
  customer_name: string;
  last_message_at: string;
  unread_count: number;
};

/** One row per restaurant a customer has messaged — the customer-side
 * counterpart to RestaurantChatThread, mirroring ChatThread's shape so the
 * Chat tab can merge both kinds into one list. */
export type CustomerRestaurantChatThread = {
  restaurantId: string;
  restaurantName: string;
  lastMessagePreview: string;
  lastMessageAt: string;
  unread: boolean;
};

export type ServiceKey = "shopping" | "parcel" | "ride" | "food";
export type ServiceSwitches = Record<ServiceKey, boolean>;

/** Who is actually riding when the booker isn't. */
export type RidePassenger = { name: string; phone: string };

export type SavedPassenger = { id: string; user_id: string; name: string; phone: string; created_at: string };

/** What the passenger's private trip link shows — no account needed. */
export type SharedTrip = {
  stage: string;
  passengerName: string | null;
  driverName: string | null;
  pickupArea: string | null;
  pickupAddress: string | null;
  destinationArea: string | null;
  destinationAddress: string | null;
  pickupLat: number | null;
  pickupLng: number | null;
  riderLat: number | null;
  riderLng: number | null;
  etaMinutes: number | null;
};

export type SavedLocation = {
  id: string;
  user_id: string;
  label: string;
  area: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  created_at: string;
};

/** 'payment': a customer funding an order or topping up their wallet.
 * 'withdrawal': a rider (and, once it exists, a restaurant) cashing out.
 * Keyed on the signed-in account generically, not a role-specific table —
 * see apps/api/src/db/migrations/0036_saved_mobile_numbers.sql. */
export type MobileNumberPurpose = "payment" | "withdrawal";

export type SavedMobileNumber = {
  id: string;
  owner_id: string;
  purpose: MobileNumberPurpose;
  phone: string;
  label: string | null;
  is_primary: number;
  created_at: string;
  updated_at: string;
};

/** "mock" is the safe default (full ring/accept/decline flow, no real
 * audio); "cloudflare" and "webrtc_p2p" are real, working adapters —
 * "cloudflare" relays audio through Realtime SFU, "webrtc_p2p" connects
 * the two browsers directly (free STUN + optional TURN, no per-minute
 * cost); "twilio" and "agora" are selectable in admin but not wired to a
 * real SDK yet. See apps/api/src/calls/. */
export type CallProviderIdentity = "mock" | "cloudflare" | "webrtc_p2p" | "twilio" | "agora";

export type CallStatus = "ringing" | "accepted" | "declined" | "missed" | "ended" | "failed";

export type Call = {
  id: string;
  caller_id: string;
  callee_id: string;
  /** Only set when the caller app passed context — informational only. */
  order_id: string | null;
  restaurant_id: string | null;
  provider: CallProviderIdentity;
  status: CallStatus;
  caller_session_id: string | null;
  callee_session_id: string | null;
  /** "webrtc_p2p" only — non-trickle ICE, so each side's full SDP (offer or
   * answer) lands here in one shot once its own candidate gathering
   * finishes. See apps/api/src/calls/routes.ts POST .../offer|/answer. */
  offer_sdp: string | null;
  answer_sdp: string | null;
  created_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
};

/** The GET /calls/incoming shape — a Call row plus the caller's name, so
 * the callee's ringing screen doesn't need a second lookup. */
export type IncomingCall = Call & { caller_name: string | null };

export type SdpDescription = { type: "offer" | "answer"; sdp: string };

/** RTCIceServer's own shape, re-declared so this package doesn't need DOM
 * lib types just for the field names — see GET /calls/ice-servers. */
export type IceServer = { urls: string | string[]; username?: string; credential?: string };

export type CallCredentialFieldStatus = {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder?: string;
  helpText?: string;
  set: boolean;
};

export type CallsAdminSettings = {
  activeProvider: CallProviderIdentity;
  providers: Record<
    Exclude<CallProviderIdentity, "mock">,
    { configured: boolean; fields: CallCredentialFieldStatus[] }
  >;
};

/** "streetmaps" (OpenStreetMap tiles + Nominatim geocoding, no API key)
 * is the safe default and needs nothing configured; "google" and "mapbox"
 * are selectable in admin and fully wired to their real SDKs, but only
 * actually take over once an admin saves a working key — see
 * apps/api/src/maps/credentials.ts and apps/*\/components/LocationMapPicker.tsx. */
export type MapsProviderIdentity = "streetmaps" | "google" | "mapbox" | "maptiler" | "stadia" | "thunderforest" | "jawg" | "tomtom";

export type MapsCredentialFieldStatus = {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder?: string;
  helpText?: string;
  set: boolean;
};

/** Jawg's two light-mode styles: "normal" is Jawg Sunny, "light" is Jawg Light. */
export type JawgLightStyle = "normal" | "light";

export type MapsAdminSettings = {
  activeProvider: MapsProviderIdentity;
  jawgLightStyle: JawgLightStyle;
  providers: Record<Exclude<MapsProviderIdentity, "streetmaps">, { configured: boolean; fields: MapsCredentialFieldStatus[] }>;
};

export type UserStatus = "active" | "suspended";

export type AuthUser = {
  id: string;
  /** Stable public account reference. This code is an identifier, never a credential. */
  accountCode: string | null;
  phone: string | null;
  email: string | null;
  name: string;
  role: "customer" | "rider" | "admin";
  status: UserStatus;
  phoneVerifiedAt: string | null;
  emailVerifiedAt: string | null;
  defaultMatchingMode: MatchingMode | null;
  /** False only for a Google-only account that has never reset its password
   * — its password_hash is a random value nobody was ever shown, so a
   * "change password" form has nothing valid to check the current one
   * against. Such an account gains one through "forgot password" instead
   * (an OTP to its verified email, same as any other reset). */
  passwordSet: boolean;
  /** Non-null only for role === "admin" — which kind of staff member this
   * is. See @peebee/shared's permissions.ts for what each role can do. */
  adminRole: AdminRole | null;
  /** True right after a staff account is invited or has its password reset
   * by another admin. The API rejects nearly everything else while this is
   * true — the admin app should route straight to a "set your password"
   * screen rather than let a request fail first. */
  forcePasswordChange: boolean;
  /** A customer's own photo, shown to the rider assigned to their order —
   * the same trust signal riders already give customers, the other way
   * round. Also used for a staff member's own avatar. */
  hasProfilePhoto: boolean;
};

/** True once either phone or email has been confirmed via OTP — the two
 * channels are interchangeable, only one needs to succeed. */
export function isUserVerified(user: AuthUser | null | undefined): boolean {
  return !!user && (!!user.phoneVerifiedAt || !!user.emailVerifiedAt);
}

export type AdminCustomer = {
  profile_photo_key?: string | null;
  phone_verified_at?: string | null;
  email_verified_at?: string | null;
  default_matching_mode?: string | null;
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  status: UserStatus;
  created_at: string;
  order_count: number;
  /** Approximated from the customer's most recent order's pickup point —
   * there's no dedicated city field on a customer account. Null if they've
   * never placed an order. */
  city: string | null;
};

export type AdminStats = {
  totalCustomers: number;
  totalRiders: number;
  totalRestaurants: number;
  verifiedRiders: number;
  onlineRiders: number;
  ordersByStage: Record<string, number>;
  paymentsByStatus: Record<string, number>;
  settledGmv: number;
};

export type OrderOverviewRange = "today" | "week" | "month" | "all";

export type OrderModuleKey = "parcel" | "shopping" | "ride" | "food";

export type OrderModuleStats = { orderCount: number; revenue: number; profit: number };

/** See apps/api/src/admin/routes.ts GET /admin/stats/orders — profit
 * excludes cash (float-rail) orders' platform cut, which is deducted from
 * the rider's wallet at Settle rather than tracked per order. */
export type OrderOverview = {
  range: OrderOverviewRange;
  totals: OrderModuleStats;
  modules: Record<OrderModuleKey, OrderModuleStats>;
};

export type IntegrationsStatus = {
  mobileMoney: {
    activeProviders: PaymentProviderIdentity[];
    /** Forces every payment through the mock adapters regardless of saved
     * credentials — see apps/api/src/payments/service.ts resolveProvider(). */
    demoMode: boolean;
    providers: PaymentProviderInfo[];
    collection: { provider: string | null; live: boolean; error: string | null };
    disbursement: { provider: string | null; live: boolean; error: string | null };
    networks: string[];
  };
  storage: { configured: boolean };
};

export type FailedPayment = {
  id: string;
  order_id: string;
  type: "collection" | "disbursement" | "refund";
  amount: number;
  currency: string;
  msisdn: string | null;
  created_at: string;
};

/** `OrderRow` joined with the assigned rider's name, as returned by admin listings. */
export type AdminOrderRow = OrderRow & { rider_name: string | null };

export type OrderRating = {
  rating: number;
  comment: string | null;
  recommended: boolean;
};

/** A rider who's offered to take a "customer_selects" order, with enough of their track record
 * (see order_ratings) for the customer to actually compare candidates before picking one. */
export type RiderApplicant = {
  riderId: string;
  riderName: string;
  distanceKm: number | null;
  outOfServiceRange: boolean;
  avgRating: number | null;
  reviewCount: number;
  recommendCount: number;
  commentCount: number;
  recentComments: string[];
  /** What this applicant asks for the job (their bid, else the app's price) —
   * null when bidding is off. `bidAmount` is null when they didn't bid. */
  price?: number | null;
  bidAmount?: number | null;
  appPrice?: number | null;
};

export type RiderApplicantProfile = {
  riderId: string;
  riderName: string;
  joinedAt: string;
  verified: boolean;
  vehicleInfo: string | null;
  area: string | null;
  completed: { total: number; rides: number; parcels: number; food: number; shopping: number };
  reviews: { id: string; rating: number; comment: string | null; recommended: boolean; createdAt: string }[];
  nextOffset: number | null;
};

/** A rider-suggested total (e.g. after an out-of-range match) awaiting the customer's accept/reject. */
export type FeeProposal = {
  id: string;
  order_id: string;
  previous_total: number;
  proposed_total: number;
  reason: string | null;
  reason_voice_key: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  updated_at: string;
};

export type OrderDetail = {
  timeFees?: OrderTimeFees;
  order: OrderRow;
  items: ListItem[];
  events: OrderEvent[];
  substitutions: Substitution[];
  payments: Payment[];
  rating: OrderRating | null;
  feeProposals: FeeProposal[];
  bundleStops?: Array<{ id: string; stage: string; pickup_address: string | null; pickup_lat: number | null; pickup_lng: number | null; restaurant_name: string | null; outlet_name: string | null }>;
};

/** A rider's mobile-money cash-out of their wallet balance. */
export type WalletWithdrawal = {
  id: string;
  rider_id: string;
  amount: number;
  provider: string;
  provider_ref: string | null;
  msisdn: string | null;
  network: string | null;
  status: "pending" | "successful" | "failed";
  created_at: string;
  updated_at: string;
};

export type Wallet = {
  balance: number;
  withdrawals: WalletWithdrawal[];
  /** Only meaningful when the admin's cashFeeSource is "deposit" — see
   * apps/api/src/lib/monetization.ts isCashDepositOk. When true and
   * depositShortfall > 0, the rider can't claim/apply for new jobs until
   * they top back up to requiredDeposit. */
  depositRequired: boolean;
  requiredDeposit: number;
  depositShortfall: number;
};

/** A customer's own top-up/spend history entry — the audit trail behind
 * their wallet_balance (see apps/api/src/wallet/service.ts).
 * `actor_id`/`actor_name` are who actually triggered the entry when
 * that's not the wallet owner (someone spending via a shared-wallet
 * grant); `counterparty_id`/`counterparty_name` are the other side of a
 * transfer_out/transfer_in pair. Both are null for every other type. */
export type WalletLedgerEntry = {
  id: string;
  user_id: string;
  type: "topup" | "order_payment" | "refund" | "adjustment" | "transfer_out" | "transfer_in";
  amount: number;
  balance_after: number;
  order_id: string | null;
  topup_id: string | null;
  counterparty_id: string | null;
  counterparty_name: string | null;
  actor_id: string | null;
  actor_name: string | null;
  note: string | null;
  created_at: string;
};

/** One top-up attempt — mirrors WalletWithdrawal's shape on the rider side. */
export type WalletTopup = {
  id: string;
  user_id: string;
  amount: number;
  provider: string;
  provider_ref: string | null;
  method: "mobile_money" | "card";
  msisdn: string | null;
  network: string | null;
  status: "pending" | "successful" | "failed";
  created_at: string;
  updated_at: string;
};

/** Closed-loop store credit — top up and spend, no cash-out. Balance is
 * capped by verification tier (see PaymentProviderInfo/wallet settings). */
export type CustomerWallet = {
  balance: number;
  cap: number;
  verified: boolean;
  ledger: WalletLedgerEntry[];
};

export type WalletShareStatus = "pending" | "active" | "revoked" | "declined";

/** A wallet-sharing grant this customer extended to someone else — shown
 * on the owner's side so they can see who they've invited/allowed and
 * revoke it. */
export type WalletShareGranted = {
  id: string;
  grantee_id: string;
  grantee_name: string;
  status: WalletShareStatus;
  created_at: string;
  responded_at: string | null;
  /** Null means the owner's primary/original wallet — see
   * apps/api/src/db/migrations/0045_multi_wallet.sql. */
  wallet_id: string | null;
  wallet_name: string;
};

/** A wallet-sharing grant extended to this customer by someone else —
 * `owner_balance` is only populated once `status` is "active" (an owner's
 * balance isn't shown to an invite that hasn't been accepted yet). */
export type WalletShareReceived = {
  id: string;
  owner_id: string;
  owner_name: string;
  status: WalletShareStatus;
  created_at: string;
  responded_at: string | null;
  owner_balance: number | null;
  wallet_id: string | null;
  wallet_name: string;
};

export type WalletShares = {
  granted: WalletShareGranted[];
  received: WalletShareReceived[];
};

/** One of a customer's (up to 5) wallets — "primary" is the sentinel id
 * for their original wallet (users.wallet_balance); every other id is a
 * real row in the `wallets` table. See apps/api/src/wallet/wallets.ts. */
export type CustomerWalletSummary = {
  id: string;
  name: string;
  balance: number;
  isPrimary: boolean;
};

export type CustomerWalletsResponse = {
  wallets: CustomerWalletSummary[];
  suggestedNames: string[];
  maxWallets: number;
};

export type WalletUsageReport = {
  period: "week" | "month" | "all";
  totalIn: number;
  totalOut: number;
  net: number;
  byType: { type: WalletLedgerEntry["type"]; count: number; total: number }[];
};

/** Which payment aggregator identity — the underlying provider a payment
 * settled through, independent of live-vs-simulated. "yo" and
 * "flutterwave" go through those aggregators; "mtn" and "airtel" talk
 * directly to each telco's own API instead (see
 * apps/api/src/payments/{mtn,airtel}/wire.ts). */
export type PaymentProviderIdentity = "yo" | "flutterwave" | "mtn" | "airtel";

/** One credential field's admin-facing status — never the value itself,
 * just enough to render a form and show what's already set. */
export type PaymentCredentialFieldStatus = {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder?: string;
  helpText?: string;
  set: boolean;
};

export type PaymentProviderInfo = {
  key: PaymentProviderIdentity;
  displayName: string;
  configured: boolean;
  supportsDisbursement: boolean;
  active: boolean;
  /** Position in the admin's priority order, or -1 if not active. */
  priority: number;
  /** This provider's real API credential fields (from the provider's own
   * requirements — see apps/api/src/payments/credentials.ts) and whether
   * each is currently set, DB-stored or env-var fallback alike. */
  credentialFields: PaymentCredentialFieldStatus[];
};

export type CreateListBody = {
  title?: string;
  items?: Array<{ name: string; quantity?: number; unitCost?: number; note?: string }>;
};

export type CreateListResponse = {
  id: string;
  listId: string;
  title: string;
  status: "draft";
  itemCount: number;
  createdAt: string;
  nextPath: string;
};

/** A staff account, as listed on the admin Staff page. */
export type StaffMember = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  status: UserStatus;
  admin_role: AdminRole;
  force_password_change: number;
  invited_at: string | null;
  invited_by_name: string | null;
  last_login_at: string | null;
};

/**
 * One row from the admin activity log. before_json/after_json are raw JSON
 * strings (or null, for actions that don't capture a snapshot) — parse them
 * only where a UI actually needs to render the diff.
 */
export type ActivityLogEntry = {
  id: string;
  actor_id: string;
  actor_name: string;
  actor_role: AdminRole | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  summary: string;
  before_json: string | null;
  after_json: string | null;
  revertible: number;
  reverted_at: string | null;
  reverted_by: string | null;
  created_at: string;
};

// ---- Rider Stage Savings Circles -------------------------------------
// See apps/api/src/stages/routes.ts and its migration for the source of
// truth these mirror.

export type StageMemberRole =
  | "member"
  | "chairman"
  | "vice_chairman"
  | "secretary"
  | "treasurer"
  | "money_counter"
  | "mobilizer";

export type Stage = {
  id: string;
  name: string;
  area: string | null;
  address: string | null;
  description: string | null;
  constitution: string | null;
  created_by: string | null;
  /** The rider responsible for onboarding fellow stage members — distinct
   * from the elected chairman/secretary/treasurer roles. Whoever creates
   * the stage starts as its group admin; transferable to any other active
   * member via POST /stages/:id/transfer-admin. */
  group_admin_id: string | null;
  status: "active" | "archived";
  /** Every stage is a single canonical, admin-reviewed registry entry.
   * "pending" = proposed by a rider, awaiting admin review; "approved" =
   * usable, joinable, canonical; "rejected" = declined (see
   * rejection_reason). Admin-originated stages (POST /admin/stages) are
   * inserted already "approved". */
  approval_status: "pending" | "approved" | "rejected";
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  /** Null while the group admin is still working through the guided setup
   * wizard (cycle, approval workflow, members, roles) — see
   * POST /stages/:id/launch. */
  rsla_launched_at: string | null;
  created_at: string;
  updated_at: string;
  /** Only present on GET /stages/mine. */
  role?: StageMemberRole;
  /** Only present on GET /stages/mine — lets callers show the current pot
   * without a follow-up GET /stages/:id round trip. */
  active_cycle_id?: string | null;
  pot?: number;
};

export type StageMemberSummary = { rider_id: string; role: StageMemberRole; name: string };

/** RSLA-specific membership profile details — kept separate from a
 * member's core Peebee rider profile (see the migration comment on
 * stage_members for why). Read/written only for the requesting member's
 * own row (GET/PUT /stages/:id/members/me/profile), not exposed for other
 * members via the general member list. */
export type StageMemberProfile = {
  nationality: string | null;
  district: string | null;
  gender: "male" | "female" | "other" | null;
  date_of_birth: string | null;
  household_size: number | null;
  literate: 0 | 1 | null;
  profile_completed_at: string | null;
};

export type StageLoanApprovalWorkflowRow = {
  role: StageMemberRole;
  approvals_required: number;
  rejections_required: number;
};

export type StageFineSchedule = "flat" | "daily" | "weekly" | "monthly";

export type StageFineType = {
  id: string;
  cycle_id: string;
  name: string;
  schedule: StageFineSchedule;
  amount: number;
  created_at: string;
};

export type StageCycle = {
  id: string;
  stage_id: string;
  start_date: string;
  end_date: string;
  interest_rate: number;
  loanable_contribution_multiple: number;
  max_loan_duration_months: number;
  /** UGX cost of one share — contributions are bought in whole shares at
   * this fixed price, standardizing savings across members within a cycle. */
  share_price: number;
  status: "active" | "closed";
};

export type StageDetail = {
  stage: Stage;
  members: StageMemberSummary[];
  myRole: StageMemberRole;
  groupAdminId: string | null;
  isGroupAdmin: boolean;
  cycle: StageCycle | null;
  approvalWorkflow: StageLoanApprovalWorkflowRow[];
  pot: number;
  outOnLoan: number;
};

/** A stage circle's savings/loan performance — see GET /stages/:id/reports. */
export type StageReports = {
  cycle: StageCycle | null;
  totalMembers: number;
  totalSaved: number;
  totalDisbursed: number;
  totalRepaid: number;
  /** Realized interest only — repaid loans' total_repayment minus
   * principal. Excludes interest still outstanding on active loans. */
  totalInterestEarned: number;
  outstandingLoans: number;
  loansCount: { pending: number; approved: number; disbursed: number; repaid: number; rejected: number; defaulted: number };
  topSavers: { rider_id: string; name: string; saved: number; shares: number }[];
  cycleHistory: { id: string; start_date: string; end_date: string; status: string; totalSaved: number; sharePrice: number }[];
  /** Last 12 months, oldest first — powers the Contributions/Loans/Repayments
   * trend charts on the rider Reports screen, mirroring the reference VSLA
   * platform's "Contributions Per Month" / "Loans Per Month" charts.
   * activeContributors = distinct members who confirmed a contribution
   * that month, the Member Activity tab's engagement proxy. */
  monthlySeries: { month: string; contributions: number; loans: number; repayments: number; activeContributors: number }[];
};

export type StageContributionStatus = "pending" | "confirmed" | "cancelled" | "disputed";

export type StageContribution = {
  id: string;
  stage_id: string;
  cycle_id: string;
  member_id: string;
  member_name: string;
  amount: number;
  shares: number | null;
  method: "cash" | "momo";
  momo_recipient_msisdn: string | null;
  status: StageContributionStatus;
  proof_photo_key: string | null;
  proof_reminder_dismissed: number;
  confirmed_by: string | null;
  created_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
};

export type StageLoanStatus = "pending" | "approved" | "rejected" | "disbursed" | "repaid" | "defaulted";

export type StageLoan = {
  id: string;
  stage_id: string;
  cycle_id: string;
  member_id: string;
  member_name: string;
  amount: number;
  interest_rate: number;
  number_of_installments: number;
  total_repayment: number;
  reason: string | null;
  status: StageLoanStatus;
  due_date: string | null;
  requested_at: string;
  decided_at: string | null;
  disbursement_confirmed_at: string | null;
};

export type StageTransaction = {
  id: string;
  stage_id: string;
  cycle_id: string;
  member_id: string | null;
  member_name: string | null;
  type: "contribution" | "loan_disbursement" | "repayment" | "share_out" | "fine" | "expense";
  amount: number;
  narrative: string | null;
  related_id: string | null;
  created_at: string;
};

export type StageMessage = {
  id: string;
  stage_id: string;
  sender_id: string;
  recipient_id: string | null;
  body: string | null;
  type: "text" | "image" | "voice" | "system";
  media_key: string | null;
  system_event_type: string | null;
  related_id: string | null;
  created_at: string;
};

export type StageElectionNominee = {
  candidate_rider_id: string;
  name: string;
  profile_photo_key: string | null;
  rating: number | null;
  vehicle_info: string | null;
  member_since: string;
  statement: string | null;
  voice_note_key: string | null;
};

export type StageElectionRoleStatus = {
  id: string;
  role: StageMemberRole;
  status: "open" | "voting" | "resolved" | "cancelled";
  winner_rider_id: string | null;
  nominees: StageElectionNominee[];
  /** The requesting rider's own current vote for this role, if any. */
  myVote: string | null;
  /** Whether they're still within the admin-set grace window to change it. */
  canChangeVote: boolean;
  /** candidate_rider_id -> vote count. Null until the requester is allowed
   * to see counts (group admin/officers any time; everyone else only once
   * the session is published). */
  tallies: Record<string, number> | null;
};

export type StageElectionSessionStatus = "nominating" | "voting" | "closed" | "published";

export type StageElectionSession = {
  id: string;
  stage_id: string;
  roles: StageMemberRole[];
  status: StageElectionSessionStatus;
  nomination_deadline: string;
  voting_deadline: string | null;
  vote_change_grace_seconds: number;
};

export type StageElectionSessionDetail = {
  session: StageElectionSession | null;
  elections: StageElectionRoleStatus[];
  isManager: boolean;
};

export type AdminStageSummary = Stage & { member_count: number };

export type AdminStageDetail = { stage: Stage; members: StageMemberSummary[]; cycle: StageCycle | null };

// ---- Peebee Car (admin) ----------------------------------------------------

export type CarPartnerStatus = "none" | "pending" | "approved" | "rejected" | "suspended";

export type AdminCarCategory = {
  id: string;
  kind: "passenger" | "cargo";
  name: string;
  seats: number | null;
  cargo_type: string | null;
  size_label: string | null;
  rate_per_km: number;
  minimum_fare: number;
  owner_share_percent: number | null;
  driver_share_percent: number | null;
  platform_share_percent: number | null;
  active: number;
  sort: number;
};

export type AdminCarCategoryInput = {
  kind: "passenger" | "cargo";
  name: string;
  seats?: number | null;
  cargoType?: string | null;
  sizeLabel?: string | null;
  ratePerKm: number;
  minimumFare: number;
  ownerSharePercent?: number | null;
  driverSharePercent?: number | null;
  platformSharePercent?: number | null;
  active: boolean;
  sort: number;
};

export type AdminCarPartner = {
  user_id: string;
  name: string;
  phone: string | null;
  owner_status: CarPartnerStatus;
  driver_status: CarPartnerStatus;
  licence_expiry: string | null;
  notes: string | null;
  needs_vehicle?: number;
  documents?: { national_id: boolean; licence: boolean };
};

export type AdminCarVehicle = {
  id: string;
  owner_id: string;
  owner_name: string;
  category_id: string;
  category_name: string;
  plate: string;
  make: string | null;
  model: string | null;
  model_catalog_id?: string | null;
  service_class?: "convenient" | "comfort";
  condition_grade?: "excellent" | "good" | "fair";
  seat_capacity?: number | null;
  last_service_date?: string | null;
  status: "pending" | "approved" | "rejected" | "suspended";
  driver_id: string | null;
  driver_name: string | null;
  photos?: string[];
};

export type AdminCarBooking = {
  id: string;
  order_id: string;
  status: "requested" | "completed" | "cancelled";
  stage: string;
  category_name: string;
  customer_name: string;
  driver_name: string | null;
  owner_name: string | null;
  estimated_total: number | null;
  final_total: number | null;
  owner_amount: number | null;
  driver_amount: number | null;
  platform_amount: number | null;
};

// ---- Peebee Car (customer) ----------------------------------------------------

export type CarCategory = {
  id: string;
  kind: "passenger" | "cargo";
  name: string;
  seats: number | null;
  cargo_type: string | null;
  size_label: string | null;
  rate_per_km: number;
  minimum_fare: number;
};

export type CarConfig = {
  onDemandEnabled: boolean;
  /** Photos per vehicle: the most an owner can add, and how many are needed before approval. */
  vehiclePhotos?: { max: number; minRequired: number };
  /** Which identity documents are needed before approval. */
  kyc?: { ownerIdRequired: boolean; driverIdRequired: boolean; driverLicenceRequired: boolean };
  /** Present only when drivers applying to owners' cars is switched on; the limits an owner's terms must respect. */
  deals?: { shareEnabled: boolean; rentEnabled: boolean; minOwnerSharePercent: number; maxOwnerSharePercent: number; maxRentPerDay: number } | null;
  /** Present only when scheduled rides are switched on and a booking window is set. */
  scheduled: { maxAdvanceHours: number | null; minLeadMinutes: number } | null;
  /** Present only when carpool is switched on. */
  carpool: { maxSeatsPerBooking: number; maxRepeatWeeks: number } | null;
  /** Present only when self-drive hire is switched on and Peebee's percentage is set. */
  selfDrive: { maxDays: number } | null;
  matchingMode: "customer_selects" | "first_to_claim";
  categories: CarCategory[];
};

export type CarBookingInput = {
  categoryId: string;
  pickupArea?: string;
  pickupAddress?: string;
  pickupLat: number;
  pickupLng: number;
  destinationArea?: string;
  destinationAddress?: string;
  destinationLat: number;
  destinationLng: number;
  /** Booking for someone else — see RidePassenger. */
  passenger?: RidePassenger;
};

export type CarWallet = {
  balance: number;
  /** The part of the balance earned from car rides that can be cashed out now. */
  withdrawable: number;
  withdrawalsEnabled: boolean;
  minAmount: number;
  history: Array<{ id: string; amount: number; status: "pending" | "successful" | "failed"; msisdn: string | null; created_at: string }>;
};

// ---- Self-drive ----------------------------------------------------------------

export type RentalStatus = "requested" | "approved" | "active" | "disputed" | "completed" | "declined" | "cancelled";

export type SelfDriveRenterKycStatus = "incomplete" | "pending" | "approved" | "rejected";
export type SelfDriveResidenceMethod = "rent_and_landlord_letter" | "bill";
export type SelfDriveRenterKycProfile = {
  status: SelfDriveRenterKycStatus;
  isSimulated?: boolean;
  ninMasked: string | null;
  residenceMethod: SelfDriveResidenceMethod | null;
  residentialAddress: string | null;
  hasNationalId: boolean;
  hasRentReceipt: boolean;
  hasLandlordLetter: boolean;
  hasResidenceBill: boolean;
  tenancyStart: string | null;
  tenancyEnd: string | null;
  reviewNotes: string | null;
};
export type AdminSelfDriveRenterKyc = {
  user_id: string; name: string; phone: string | null; nin: string; residentialAddress: string; residenceMethod: SelfDriveResidenceMethod;
  tenancyStart: string | null; tenancyEnd: string | null; status: Exclude<SelfDriveRenterKycStatus, "incomplete">;
  reviewNotes: string | null; updated_at: string; hasNationalId: boolean; hasRentReceipt: boolean;
  hasLandlordLetter: boolean; hasResidenceBill: boolean;
};

export type RentalVehicle = {
  id: string;
  name: string;
  category: string;
  seats: number | null;
  dailyPrice: number;
  deposit: number;
  rent: number;
  notes: string | null;
  ownerName?: string;
  hourlyPrice?: number;
  halfDayPrice?: number;
  hourlyEnabled?: boolean;
  halfDayEnabled?: boolean;
  fullDayEnabled?: boolean;
  serviceClass?: "convenient" | "comfort";
  condition?: "excellent" | "good" | "fair";
  fuelLitresPerKm?: number | null;
  luggageLitres?: number | null;
  luggageNote?: string | null;
  standardDailyPrice?: number | null;
  features?: string[];
  photos?: string[];
  lastServiceDate?: string | null;
};

export type Rental = {
  id: string;
  vehicle_id: string;
  plate: string | null;
  vehicle?: string | null;
  renter_name: string | null;
  owner_name: string | null;
  starts_at: string;
  ends_at: string;
  days: number;
  rent_amount: number;
  deposit_amount: number;
  status: RentalStatus;
  damage_claim: number;
  licence_number: string;
  licence_expiry: string;
  owner_amount: number | null;
  refund_amount: number | null;
  period_type?: "hourly" | "half_day" | "full_day";
  handed_over_at?: string | null;
  overtime_amount?: number;
  hourly_price?: number;
};

export type OwnerRentalVehicle = {
  id: string;
  plate: string;
  make: string | null;
  model: string | null;
  daily_price: number | null;
  deposit_amount: number | null;
  active: number | null;
  notes: string | null;
  hourly_enabled?: number | null;
  half_day_enabled?: number | null;
  full_day_enabled?: number | null;
  standard_daily_price?: number | null;
  service_class?: "convenient" | "comfort";
  condition_grade?: "excellent" | "good" | "fair";
  seat_capacity?: number | null;
  last_service_date?: string | null;
};

export type AdminRental = {
  id: string;
  status: RentalStatus;
  rent_amount: number;
  deposit_amount: number;
  damage_claim: number;
  damage_final: number | null;
  plate: string;
  owner_name: string;
  renter_name: string;
};

// ---- Carpool ---------------------------------------------------------------

export type CarpoolTrip = {
  id: string;
  driverName: string;
  vehicle: string;
  originLabel: string;
  destLabel: string;
  departAt: string;
  seatsLeft: number;
  seatPrice: number;
};

export type CarpoolPublishInput = {
  originLabel: string;
  originLat: number;
  originLng: number;
  destLabel: string;
  destLat: number;
  destLng: number;
  departAt: string;
  seats: number;
  seatPrice: number;
  repeatWeeks?: number;
};

export type CarpoolMyTrip = {
  id: string;
  origin_label: string;
  dest_label: string;
  depart_at: string;
  seats_total: number;
  seats_taken: number;
  seat_price: number;
  status: "open" | "full" | "departed" | "completed" | "cancelled";
  passengers: Array<{
    order_id: string;
    seats: number;
    amount: number;
    name: string;
    stage: string;
    pickup_address: string | null;
    destination_address: string | null;
    pickup_lat: number | null;
    pickup_lng: number | null;
    destination_lat: number | null;
    destination_lng: number | null;
    estimated_total: number | null;
  }>;
};

// ---- Peebee Car (partner app) -------------------------------------------------

export type CarMe = {
  /** A driver who said they don't have a car and wants one provided. */
  needsVehicle: boolean;
  /** Which identity documents are on file. */
  documents: { national_id: boolean; licence: boolean };
  ownerStatus: CarPartnerStatus;
  driverStatus: CarPartnerStatus;
  vehicles: Array<{ id: string; plate: string; make: string | null; model: string | null; status: string; category_name: string; driver_id: string | null; driver_name: string | null; photos: string[]; service_class?: "convenient" | "comfort"; condition_grade?: "excellent" | "good" | "fair"; seat_capacity?: number | null; last_service_date?: string | null }>;
  assignedVehicles: Array<{ id: string; plate: string; make: string | null; model: string | null; category_name: string }>;
  online: boolean;
  activeVehicleId: string | null;
};

export type CarDriverJob = {
  id: string;
  customerName: string;
  pickupAddress: string | null;
  destinationAddress: string | null;
  distanceKm: number | null;
  fare: number;
  pickupDistanceKm: number | null;
  matchingMode: string;
  /** Pickup time for a scheduled ride, else null. */
  scheduledFor: string | null;
  applied: boolean;
  bidding: { appPrice: number | null; min: number | null; max: number | null } | null;
};

export type CarDriverActive = {
  active: {
    id: string;
    stage: string;
    estimated_total: number | null;
    final_total: number | null;
    pickup_address: string | null;
    pickup_lat: number | null;
    pickup_lng: number | null;
    destination_address: string | null;
    destination_lat: number | null;
    destination_lng: number | null;
    customer_name: string;
    /** Set when the ride was booked for someone else — meet and call this person. */
    passenger_name?: string | null;
    passenger_phone?: string | null;
  } | null;
  recent: Array<{ order_id: string; driver_amount: number; settled_at: string; pickup_address: string | null; destination_address: string | null }>;
  totalEarned: number;
};

export type CarOwnerRides = {
  rides: Array<{
    id: string;
    order_id: string;
    status: string;
    plate: string | null;
    driver_name: string | null;
    stage: string;
    pickup_address: string | null;
    destination_address: string | null;
    estimated_total: number | null;
    owner_amount: number | null;
    driver_amount: number | null;
    platform_amount: number | null;
    pool_amount: number | null;
  }>;
  totalEarned: number;
  /** What each of the owner's drivers has earned in the owner's cars. */
  drivers?: Array<{ driverId: string; name: string; rides: number; driverEarned: number; ownerEarned: number }>;
};

// ---- Driver ↔ owner agreements -----------------------------------------------------

/** What an owner and driver agree for a car: a share of each ride, or a fixed rent. */
export type DealTermsView = {
  feeType: "share" | "rent";
  /** Owner's part of what is left after Peebee's cut (%), for a share deal. */
  ownerSharePercent: number | null;
  rentAmount: number | null;
  rentPeriod: "day" | "week" | null;
};

export type DealTermsInput = {
  open: boolean;
  feeType: "share" | "rent";
  ownerSharePercent?: number;
  rentAmount?: number;
  rentPeriod?: "day" | "week";
  notes?: string;
};

export type OwnerDeals = {
  vehicles: Array<{
    id: string;
    plate: string;
    name: string;
    status: string;
    terms: (DealTermsView & { open: boolean; notes: string | null }) | null;
    driver: { id: string; name: string; since: string | null; deal: DealTermsView | null; rentOwed: number } | null;
  }>;
  requests: Array<{
    id: string;
    vehicleId: string;
    plate: string;
    driverName: string;
    ridesDone: number;
    licenceExpiry: string | null;
    terms: DealTermsView;
    createdAt: string | null;
  }>;
};

export type DriverCar = {
  id: string;
  name: string;
  category: string;
  seats: number | null;
  ownerName: string;
  terms: DealTermsView;
  notes: string | null;
  applied: boolean;
  photos: string[];
};

export type DriverDeals = {
  requests: Array<{ id: string; vehicleId: string; car: string; ownerName: string; status: "pending" | "accepted" | "declined" | "withdrawn"; terms: DealTermsView; createdAt: string | null }>;
  connections: Array<{ assignmentId: string; vehicleId: string; car: string; plate: string; ownerName: string; ownCar: boolean; terms: DealTermsView | null; rentOwed: number }>;
};
