/** Core domain DTOs — kept in sync with apps/api's real (non-stub) responses. */

import type { AdminRole } from "./permissions.js";

export type ListStatus = "draft" | "active" | "delivered" | "cancelled";

export type ListSummary = {
  id: string;
  listId: string;
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
  pin_code: string | null;
  eta_minutes: number | null;
  /** Set only for restaurant food orders — type stays 'shopping' (see
   * apps/api/src/db/migrations/0034_order_restaurant.sql). */
  restaurant_id: string | null;
  /** A passenger ride rather than a goods parcel — type stays 'parcel' (see
   * apps/api/src/db/migrations/0039_ride_orders.sql). Pickup = where the
   * rider collects the passenger, destination = where they're going. */
  is_ride: number;
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

/** Admin-tunable delivery pricing/matching numbers (packages/shared/src/api-client.ts: getSettings/adminUpdateSettings). */
export type DeliverySettings = {
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
  /** A passenger ride's own per-km rate and floor — priced the same way as
   * a parcel (distance × rate, never below the floor) but tracked
   * separately since carrying a person is a different real-world fare
   * than carrying a package. */
  rideRatePerKm: number;
  rideMinimumFare: number;
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
  /** Whether the rider app's "Start Navigation" sends riders out to Google
   * Maps ("external", the default) or renders navigation in-app using the
   * active maps provider ("in_app"). Change with PUT /admin/nav-mode. */
  navMode: NavMode;
} & MonetizationSettings;

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
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  national_id_key: string | null;
  profile_photo_key: string | null;
  profile_completed_at: string | null;
};

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
export type MapsProviderIdentity = "streetmaps" | "google" | "mapbox" | "maptiler" | "stadia" | "thunderforest" | "jawg";

export type MapsCredentialFieldStatus = {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder?: string;
  helpText?: string;
  set: boolean;
};

export type MapsAdminSettings = {
  activeProvider: MapsProviderIdentity;
  providers: Record<Exclude<MapsProviderIdentity, "streetmaps">, { configured: boolean; fields: MapsCredentialFieldStatus[] }>;
};

export type UserStatus = "active" | "suspended";

export type AuthUser = {
  id: string;
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
   * is. See @tuma/shared's permissions.ts for what each role can do. */
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
  recentComments: string[];
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
  order: OrderRow;
  items: ListItem[];
  events: OrderEvent[];
  substitutions: Substitution[];
  payments: Payment[];
  rating: OrderRating | null;
  feeProposals: FeeProposal[];
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
