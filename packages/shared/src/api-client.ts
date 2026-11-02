import type { PublicReceipt } from "./receipt.js";
import type { AppUpdatesSettings, AppUpdatesUpdate } from "./app-updates.js";
import { applyModuleAvailability, rememberModuleAvailability, type ModuleSettingsUpdate, type ModuleSettings } from "./modules.js";
import { isPracticeStorageOn } from "./practice.js";
import { endServerPractice, isServerPractice, type PracticeSessionResult, type ServerRole } from "./practice-server.js";
import type { TaxipressAssistance, TaxipressLanguage, TaxipressLuggageType, TaxipressTaxiProfile, TaxipressAdminQueueEntry, TaxipressAdminRoute, TaxipressBoardingResult, TaxipressBooking, TaxipressConfig, TaxipressDriverView, TaxipressLineEntry, TaxipressOutcome, TaxipressQueueView, TaxipressRelayRoute, TaxipressReport, TaxipressSettings, TaxipressTaxi, PublicTaxipressTicket, TaxipressSendResult } from "./taxipress.js";
import type { BagTrip, RelayAdminOrder, RelayRouteStage, RelayMerchantOrder, RelayOpenLeg, RelayOperator, RelayOperatorParcels, RelayQuote, RelayRoute, RelaySettings, RelayStation, RelayStationParcels, RelayTrack } from "./relay.js";
import type { AdminRole } from "./permissions.js";
import { workMethods } from "./work-client.js";
import { workAdminMethods } from "./work-admin-client.js";
import { talentMethods } from "./talent-client.js";
import { talentAdminMethods } from "./talent-admin-client.js";
import { educationMethods } from "./education-client.js";
import { videoAdsMethods } from "./video-ads-client.js";
import { channelsMethods } from "./channels-client.js";
import type { PracticeRole } from "./practice.js";
import type {
  FareCounter,
  FareOffer,
  RideQuote,
  RideStop,
  RideStopInput,
  ActivityLogEntry,
  AdminMerchantSettlementAccount,
  AdminMerchant,
  AdminMerchantProfileResponse,
  AdminMerchantRange,
  AdminCustomer,
  AdminOrderRow,
  AdminRider,
  CarBookingInput,
  RidePassenger,
  AiKeyAddResult,
  AiKeyMode,
  AiKeysOverview,
  EmailKeySettings,
  EmailKeysOverview,
  SavedPassenger,
  SharedTrip,
  CarDriverActive,
  CarDriverJob,
  CarMe,
  CarOwnerRides,
  DealTermsInput,
  DriverCar,
  DriverDeals,
  OwnerDeals,
  AdminRental,
  AdminSelfDriveRenterKyc,
  SelfDriveRenterKycProfile,
  SelfDriveResidenceMethod,
  OwnerRentalVehicle,
  Rental,
  RentalVehicle,
  RentalInspection,
  RentalInspectionSubmitInput,
  CarpoolMyTrip,
  CarpoolPublishInput,
  CarpoolTrip,
  CarWallet,
  CarConfig,
  AdminCarBooking,
  AdminCarCategory,
  AdminCarCategoryInput,
  AdminCarPartner,
  AdminCarVehicle,
  AdminStats,
  AuthUser,
  AvailableJob,
  Call,
  CallProviderIdentity,
  CallsAdminSettings,
  ChatMessage,
  ChatThread,
  ChatThreadDetail,
  CreateListBody,
  CreateListResponse,
  CustomerRestaurantChatThread,
  CustomerWallet,
  CustomerWalletSummary,
  CustomerWalletsResponse,
  DeliverySettings,
  MarketplaceSettings,
  StoreCollection,
  StoreDiscount,
  StoreOutletInventoryRow,
  StoreDraftOrderItem,
  StoreDraftOrder,
  StorePosSaleItem,
  StorePosSale,
  StoreStockTransfer,
  StoreCustomerLoyalty,
  StoreSupplier,
  StorePurchaseOrderItem,
  StorePurchaseOrder,
  StoreBundleItem,
  StoreBundle,
  StoreWinbackCampaign,
  StorefrontSection,
  StoreSmsLog,
  StoreDigitalProduct,
  StoreDigitalFulfillment,
  StoreLmsCourse,
  StoreLmsEnrollment,
  StoreEliteAnalytics,
  GuestSettings,
  GuestConfig,
  GuestCheckoutInput,
  GuestCheckoutResult,
  GuestTrack,
  FailedPayment,
  FeeProposal,
  FuelStationOutlet,
  FuelProduct,
  FuelOutletPrice,
  FuelCode,
  FuelReceipt,
  FuelShiftSummary,
  FuelStationManager,
  FuelPumpAttendant,
  FuelStationSalesSummary,
  FuelStationWithdrawal,
  FuelStationPayoutAccount,
  IntegrationsStatus,
  IceServer,
  IncomingCall,
  ListDetail,
  ListItem,
  ListSummary,
  JawgLightStyle,
  MapsAdminSettings,
  MapsProviderIdentity,
  MerchantBalance,
  Merchant,
  MerchantCategory,
  MerchantDispute,
  MerchantMember,
  MerchantOutlet,
  MerchantPaymentSummary,
  MerchantTransaction,
  MerchantCustodyApproval,
  MerchantProviderOperation,
  MerchantPayment,
  MerchantReconciliationRow,
  MerchantSettlement,
  MerchantSettlementAccount,
  MatchingMode,
  NavMode,
  OrderDetail,
  CheckoutBreakdown,
  OrderEvent,
  OrderRow,
  OrderOverview,
  OrderOverviewRange,
  SdpDescription,
  OrderType,
  Payment,
  PaymentProviderIdentity,
  PlatformEnvironment,
  Restaurant,
  AdminRestaurant,
  RestaurantStatus,
  RestaurantChatMessage,
  RestaurantChatThread,
  RestaurantMenu,
  MenuCategory,
  MenuItem,
  MenuItemBadge,
  MenuItemOption,
  MobileNumberPurpose,
  Rider,
  RiderApplicant,
  RiderApplicantProfile,
  RiderSubscriptionPayment,
  RiderSubscriptionView,
  RiderProSubscriptionPayment,
  RiderProSubscriptionView,
  SavedLocation,
  SavedMobileNumber,
  Stage,
  StageContribution,
  StageDetail,
  AdminStageDetail,
  AdminStageSummary,
  StageElectionSessionDetail,
  StageLoan,
  StageMemberRole,
  StageMessage,
  StageTransaction,
  StageLoanApprovalWorkflowRow,
  StageFineType,
  StageFineSchedule,
  StageMemberProfile,
  StageReports,
  StaffMember,
  UserStatus,
  Wallet,
  WalletLedgerEntry,
  WalletShares,
  WalletTopup,
  WalletUsageReport,
} from "./domain.js";

export type PracticeWorldCounts = { customers: number; riders: number; merchants: number; stores: number; products: number; restaurants: number; menuItems: number; orders: number };
/** `coverage` is how many demo rows each module has, by module key; a module at 0 has nothing to practise with. */
export type PracticeWorldStatus = { seeded: boolean; counts: PracticeWorldCounts; coverage?: Record<string, number>; platformEnvironment?: "live" | "sandbox" };

export type CreateApiClientOptions = {
  baseUrl: string;
  /** The admin app edits the raw settings; every other app gets them narrowed to what the Live or Practice switches allow. */
  rawSettings?: boolean;
  /** Optional fetch override (tests). */
  fetchImpl?: typeof fetch;
  /** Bearer token for authenticated requests. */
  getToken?: () => string | null | undefined;
  /**
   * Called when a request made *with* a token comes back 401 — the session
   * ended somewhere other than this browser. That happens on a normal
   * expiry, but also when the account is suspended, the password is reset,
   * or the session is signed out from another device.
   *
   * Without this the app keeps rendering the cached user while every call
   * behind it fails, which looks like the app is broken rather than like
   * being logged out. Not called for a failed sign-in (no token was sent).
   */
  onUnauthorized?: () => void;
};

/** One zod validation failure, as every route's `safeParse(...).error.issues`
 * already shapes them — kept minimal (just what's needed to point at the
 * field) rather than the full zod issue type, so this file doesn't need to
 * depend on zod itself. */
export type ApiValidationIssue = { path: (string | number)[]; message: string };

/** Thrown by the API client on any non-2xx response. Keeps the raw HTTP
 * status and the server's machine-readable error code (when it sent one)
 * separate from the human-readable message, so callers can map `code` to
 * friendly copy instead of showing "API 400: invalid_category" to users.
 * `issues` is populated whenever the server's 400 came from zod rejecting
 * the request body (every route uses the same `{ error: "invalid_body",
 * issues }` shape) — see friendlyErrorMessage, which turns it into an
 * actual field-level message instead of a generic "something went wrong". */
export class ApiError extends Error {
  status: number;
  code?: string;
  issues?: ApiValidationIssue[];

  constructor(status: number, code: string | undefined, message: string, issues?: ApiValidationIssue[]) {
    super(`API ${status}: ${message}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

/** "deliveryRatePerKm" -> "Delivery rate per km", "0.msisdn" -> "Msisdn". */
function humanizeFieldPath(path: (string | number)[]): string {
  const field = path.filter((p) => typeof p === "string").pop();
  if (!field) return "";
  const spaced = String(field).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Known server error codes mapped to plain-English copy. Anything not
 * listed here falls back to a generic, still-friendly message rather than
 * surfacing the raw code or HTTP status to the user. */
const FRIENDLY_ERROR_MESSAGES: Record<string, string> = {
  not_found: "We couldn't find that. It may have been removed — please refresh and try again.",
  invalid_category: "That category no longer exists. Refresh the page and try again.",
  invalid_choice: "One of the options you picked is no longer available. Please review your order and try again.",
  item_unavailable: "That item is no longer available.",
  restaurant_closed: "This restaurant is currently closed.",
  restaurant_inactive: "This restaurant isn't accepting orders right now.",
  forbidden: "You don't have permission to do that.",
  unauthorized: "Please sign in again to continue.",
  validation_error: "Some information is missing or invalid. Please check the form and try again.",
  invalid_input: "Some information is missing or invalid. Please check the form and try again.",
  network_error: "Couldn't connect. Please check your internet connection and try again.",
  payment_provider_auth_failed:
    "Flutterwave rejected the saved secret key. Ask an admin to re-enter the correct Flutterwave Secret key.",
  payment_provider_account_not_ready:
    "Flutterwave has not enabled this account for live payments. Check account activation and Uganda payment methods in Flutterwave.",
  payment_provider_rejected: "Flutterwave rejected this payment request. Check the Flutterwave payment settings and try again.",
  payment_provider_unavailable: "Flutterwave is temporarily unavailable. Please try again in a moment.",
  payment_provider_not_configured:
    "No live payment provider is configured for this action. Your balance has not been changed.",
  merchant_custody_approval_required:
    "Record an active regulated custody and safeguarding approval before enabling live merchant payments.",
  merchant_withdrawals_frozen:
    "Merchant withdrawals are temporarily paused while balances are reconciled.",
  reconciliation_mismatch:
    "Withdrawals cannot be resumed until every merchant balance matches the immutable ledger.",
  merchant_not_active: "This merchant must be approved and active before requesting a settlement.",
  merchant_amount_mismatch: "The amount you confirmed does not match the rider's payment request.",
  merchant_purchase_required: "Record at least one confirmed merchant purchase before starting delivery.",
  merchant_confirmation_pending: "A merchant payment is still waiting for the shop to confirm the amount.",
  merchant_member_not_found: "That person must create a Peebee customer account with this email or phone before being added to the merchant team.",
  owner_cannot_be_removed: "The merchant owner cannot be removed from the team.",
  merchant_kyc_incomplete: "Registration, tax ID, owner ID and business registration document are required before activation.",
};

/** Turns any error from the API client into a message safe to show a user —
 * never a raw "API 400: xxx" string, and never a bare "something went
 * wrong" when the server actually said what was wrong with the request
 * (a validation failure names the field and the reason; every other 4xx
 * still surfaces the server's own message rather than a generic fallback,
 * as long as that message doesn't look like an internal error code). Use
 * this (or an app's local wrapper around it) at every UI call site instead
 * of `err.message`. */
export function friendlyErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code && FRIENDLY_ERROR_MESSAGES[err.code]) return FRIENDLY_ERROR_MESSAGES[err.code];
    if (err.issues && err.issues.length > 0) {
      const parts = err.issues.slice(0, 3).map((issue) => {
        const field = humanizeFieldPath(issue.path);
        return field ? `${field}: ${issue.message}` : issue.message;
      });
      return `Please check: ${parts.join("; ")}`;
    }
    // A "not available yet" or a provider problem is written for the person, so say it instead of a blanket apology.
    if (err.status === 503 || (err.status === 502 && err.code?.startsWith("provider_"))) {
      const written = err.message.replace(/^API \d+: /, "");
      if (written && written !== err.code && !/^[a-z0-9_]+$/.test(written)) return written;
    }
    if (err.status >= 500 && err.message.includes("Server error (admin only)")) return err.message.replace(/^API \d+: /, "");
    if (err.status >= 500) return "Something went wrong on our end. Please try again in a moment.";
    // The server's own message, when it wrote one — most 4xx handlers in
    // this codebase already pass a plain-English `message` alongside the
    // machine-readable `error` code (see json() below), and a 401/403 in
    // particular often has a specific, useful reason ("This account has
    // been suspended", "Your role doesn't include this action") that a
    // blanket "no permission" line would bury. Only a bare code with no
    // real message left over falls through to a generic line.
    const serverMessage = err.message.replace(/^API \d+: /, "");
    if (serverMessage && serverMessage !== err.code && !/^[a-z0-9_]+$/.test(serverMessage)) {
      return serverMessage;
    }
    if (err.status === 401 || err.status === 403) return "You don't have permission to do that.";
    if (err.status === 404) return FRIENDLY_ERROR_MESSAGES.not_found;
    return "Something went wrong. Please try again.";
  }
  if (err instanceof TypeError) return FRIENDLY_ERROR_MESSAGES.network_error;
  return "Something went wrong. Please try again.";
}

/** API client for peebee-api (apps/api on Render). */
export type PharmacyQuoteItem = { name: string; strength?: string; dosage?: string; quantity: number; unitPrice: number };

export type PharmacyPrescription = {
  id: string;
  customerName: string;
  customerPhone: string | null;
  pharmacyId: string;
  pharmacyName: string;
  hasImage: boolean;
  imagePath: string | null;
  patientNotes: string;
  patientAge: number | null;
  patientGender: string | null;
  status: "pending_review" | "priced_ready" | "dispensed" | "declined" | "cancelled";
  pharmacistNotes: string;
  dosageInstructions: string;
  quotedItems: PharmacyQuoteItem[];
  quotedTotalUgx: number;
  deliveryAddress: string;
  deliveryFeeUgx: number;
  createdAt: string;
  updatedAt: string;
};

/** Raw card details for Peebee's own card form. Sent over TLS for one request, never stored. */
export type CardInput = { number: string; cvv: string; expiryMonth: string; expiryYear: string };

/** What a direct card payment needs from the customer next. `redirect` is the bank's own 3-D Secure page. */
export type PaymentNextAction =
  | { type: "pin" }
  | { type: "avs" }
  | { type: "otp"; flowRef: string; message?: string }
  | { type: "redirect"; url: string };

/** Which methods a payment screen may offer. `card.direct` false = cards go to Flutterwave's hosted page. */
export type PaymentOptions = {
  card: { available: boolean; direct: boolean };
  mobileMoney: { direct: boolean };
};

export type CardContinueInput =
  | { otp: string; flowRef: string; returnUrl?: string }
  | { card: CardInput; authorization: { mode: "pin"; pin: string } | { mode: "avs"; address: string; city: string; state: string; country: string; zipcode: string }; returnUrl?: string };

export function createApiClient({ baseUrl, fetchImpl, getToken, onUnauthorized, rawSettings }: CreateApiClientOptions) {
  const root = baseUrl.replace(/\/$/, "");
  const f = fetchImpl ?? fetch;

  function authHeaders(): Record<string, string> {
    const token = getToken?.();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function json<T>(res: Response): Promise<T> {
    if (!res.ok) {
      // A practice session lasts a day. When it ends, the person goes back to their own session instead of being signed out.
      if (res.status === 401 && isServerPractice() && typeof window !== "undefined") {
        endServerPractice();
        window.location.replace("/");
      } else if (res.status === 401 && getToken?.()) onUnauthorized?.();
      const body = await res.json().catch(() => ({}));
      const code = (body as { error?: string }).error;
      const message = (body as { message?: string }).message ?? code ?? res.statusText;
      const issues = (body as { issues?: ApiValidationIssue[] }).issues;
      throw new ApiError(res.status, code, message, issues);
    }
    return (await res.json()) as T;
  }

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    return json<T>(
      await f(`${root}${path}`, {
        ...init,
        headers: {
          // A file upload (FormData) must not carry a JSON content type; the browser sets the multipart boundary itself.
          ...(typeof FormData !== "undefined" && init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
          ...authHeaders(),
          ...(init?.headers ?? {}),
        },
      }),
    );
  }

  return {
    baseUrl: root,

    async getHealth(): Promise<{ ok: boolean; service?: string }> {
      return json(await f(`${root}/health`));
    },

    // Auth — registration accepts either a phone number or an email (at
    // least one is required); login accepts either as the identifier.
    async register(input: {
      phone?: string;
      email?: string;
      name: string;
      password: string;
      role?: "customer" | "rider";
    }) {
      return request<{ token: string; user: AuthUser; riderStatus?: "pending_verification"; verifyDevCode?: string }>(
        "/v1/auth/register",
        { method: "POST", body: JSON.stringify(input) },
      );
    },
    async login(input: { identifier: string; password: string }) {
      return request<{ token: string; user: AuthUser }>("/v1/auth/login", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    /**
     * Ends the current session server-side. Dropping the token from local
     * storage only hides it from this browser — until the server records it
     * as revoked, a copy taken beforehand still works. Callers should clear
     * local storage regardless of whether this succeeds.
     */
    async logout() {
      return request<{ ok: true }>("/v1/auth/logout", { method: "POST" });
    },
    /** Sign in/up with Google — `idToken` is the credential Google Identity Services hands the client. */
    async googleAuth(idToken: string, role?: "customer" | "rider") {
      return request<{ token: string; user: AuthUser; riderStatus?: "pending_verification" }>("/v1/auth/google", {
        method: "POST",
        body: JSON.stringify({ idToken, role }),
      });
    },
    async me() {
      return request<{ user: AuthUser }>("/v1/auth/me");
    },

    // Onboarding verification (either phone or email confirms the account)
    async requestVerification(channel: "sms" | "email") {
      return request<{ sent: true; channel: "sms" | "email"; target: string; devCode?: string }>(
        "/v1/auth/verify/request",
        { method: "POST", body: JSON.stringify({ channel }) },
      );
    },
    async confirmVerification(channel: "sms" | "email", code: string) {
      return request<{ user: AuthUser }>("/v1/auth/verify/confirm", {
        method: "POST",
        body: JSON.stringify({ channel, code }),
      });
    },

    // Forgot password — public, works while signed out.
    async requestPasswordReset(identifier: string) {
      return request<{ sent: true; channel?: "sms" | "email"; target?: string; devCode?: string; retryAfterSeconds?: number }>(
        "/v1/auth/password/reset/request",
        { method: "POST", body: JSON.stringify({ identifier }) },
      );
    },
    async confirmPasswordReset(identifier: string, code: string, newPassword: string) {
      return request<{ token: string; user: AuthUser }>("/v1/auth/password/reset/confirm", {
        method: "POST",
        body: JSON.stringify({ identifier, code, newPassword }),
      });
    },

    /** Change password while signed in, given the current one — e.g. from an account settings
     * page. Returns a fresh token for this session (unaffected); every other signed-in session
     * is ended. */
    async changePassword(currentPassword: string, newPassword: string) {
      return request<{ token: string; user: AuthUser }>("/v1/auth/password/change", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
    },

    // Lists
    async createList(body: CreateListBody = {}) {
      return request<CreateListResponse>("/v1/lists", { method: "POST", body: JSON.stringify(body) });
    },
    async getRecentLists(limit = 10) {
      return request<{ lists: ListSummary[] }>(`/v1/lists/recent?limit=${limit}`);
    },
    async getRecentPlaces() {
      return request<{ places: Array<{ area: string | null; address: string | null; lat: number | null; lng: number | null; last_at: string }> }>(
        "/v1/orders/recent-places",
      );
    },
    async resendOrder(orderId: string) {
      return request<{ order: OrderRow }>(`/v1/orders/${orderId}/resend`, { method: "POST" });
    },
    async getList(listId: string) {
      return request<ListDetail>(`/v1/lists/${listId}`);
    },

    // Voice notes — transcribes a recorded shopping list into items
    async transcribeVoiceNote(audio: Blob, options: { extractItems?: boolean } = {}) {
      const form = new FormData();
      form.append("audio", audio, "note.webm");
      if (options.extractItems === false) form.append("extractItems", "false");
      const res = await f(`${root}/v1/voice/transcribe`, {
        method: "POST",
        headers: authHeaders(),
        body: form,
      });
      return json<{ transcript: string; items: Array<{ name: string; quantity: number }> }>(res);
    },

    // Orders
    async createOrder(input: {
      listId: string;
      type?: OrderType;
      /** A passenger ride rather than a goods parcel — only meaningful with type: "parcel". */
      isRide?: boolean;
      pickupArea?: string;
      pickupAddress?: string;
      pickupLat?: number;
      pickupLng?: number;
      destinationArea?: string;
      destinationAddress?: string;
      destinationLat?: number;
      destinationLng?: number;
      paymentRail?: "escrow" | "float";
      estimatedTotal?: number;
      /** A ride booked for someone else. */
      passenger?: RidePassenger;
      /** Boda rides: ordered stops between pickup and destination. */
      stops?: RideStopInput[];
      /** Boda rides: Name your fare — the customer's own price, within the quote's band. */
      fareOffer?: number;
      /** A long parcel dropped at a petrol station: bring it to the door, or collect it there. */
      relayLastMile?: "door" | "collect" | "meet";
      /** A long goods parcel: by matatu relay (default when offered) or one boda all the way. */
      deliveryMode?: "rider" | "relay";
      /** With relayLastMile "meet": the stage where the customer meets the matatu. */
      relayMeetStageId?: string;
    }) {
      return request<{ order: OrderRow }>("/v1/orders", { method: "POST", body: JSON.stringify(input) });
    },
    async getActiveOrder() {
      return request<{
        activeOrder: OrderRow | null;
        pendingFeeProposal: FeeProposal | null;
        rideStops?: RideStop[];
        fareOffer?: FareOffer | null;
        fareCounters?: FareCounter[];
      }>("/v1/orders/active");
    },
    /** The app's boda quote through any stops, with the Name-your-fare band. */
    async getRideQuote(input: { pickupLat: number; pickupLng: number; destinationLat: number; destinationLng: number; stops?: Array<{ lat: number; lng: number }> }) {
      const params = new URLSearchParams({
        pickupLat: String(input.pickupLat),
        pickupLng: String(input.pickupLng),
        destinationLat: String(input.destinationLat),
        destinationLng: String(input.destinationLng),
      });
      if (input.stops?.length) params.set("stops", input.stops.map((s) => `${s.lat},${s.lng}`).join(";"));
      return request<RideQuote>(`/v1/rides/quote?${params}`);
    },
    /** Customer raises their offer (amount) or switches to the app's standard fare. */
    async raiseFareOffer(orderId: string, input: { amount: number } | { standard: true }, idempotencyKey?: string) {
      return request<{ order: OrderRow; fareOffer: FareOffer | null; fareCounters: FareCounter[] }>(`/v1/orders/${orderId}/fare-offer`, {
        method: "POST",
        body: JSON.stringify(input),
        headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      });
    },
    async getFareCounters(orderId: string) {
      return request<{ fareOffer: FareOffer | null; counters: FareCounter[] }>(`/v1/orders/${orderId}/fare-counters`);
    },
    /** Rider counters a customer's offer. Accepting the offer itself is the normal claim/apply. */
    async counterFareOffer(orderId: string, amount: number, idempotencyKey?: string) {
      return request<{ counter: { id: string; amount: number; expiresAt: string } }>(`/v1/orders/${orderId}/fare-counters`, {
        method: "POST",
        body: JSON.stringify({ amount }),
        headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      });
    },
    async getRideStops(orderId: string) {
      return request<{ stops: RideStop[] }>(`/v1/orders/${orderId}/stops`);
    },
    /** Rider: arrived at stop N (only the next pending stop, only while the passenger is aboard). */
    async arrivedAtStop(orderId: string, position: number) {
      return request<{ stops: RideStop[]; order: OrderRow }>(`/v1/orders/${orderId}/stops/${position}/arrived`, { method: "POST" });
    },
    /** Rider: leaving stop N for the next stop / the destination. */
    async continueFromStop(orderId: string, position: number) {
      return request<{ stops: RideStop[]; order: OrderRow }>(`/v1/orders/${orderId}/stops/${position}/continue`, { method: "POST" });
    },

    // Restaurant browsing + food checkout — see apps/api/src/restaurants/customer.ts.
    /** Dishes from open food businesses within `radiusKm` (straight line) of the customer,
     * featured first then nearest. Without lat/lng: open businesses' dishes, no distance. */
    async foodNearbyItems(params: { lat?: number | null; lng?: number | null; radiusKm?: number; q?: string } = {}) {
      const qs = new URLSearchParams();
      if (params.lat != null && params.lng != null) { qs.set("lat", String(params.lat)); qs.set("lng", String(params.lng)); }
      if (params.radiusKm != null) qs.set("radiusKm", String(params.radiusKm));
      if (params.q) qs.set("q", params.q);
      const query = qs.toString();
      return request<{ items: FoodNearbyItem[]; located: boolean; radiusKm: number; paused?: boolean }>(`/v1/food/nearby-items${query ? `?${query}` : ""}`);
    },
    async listRestaurants() {
      return request<{ restaurants: Restaurant[]; /** Food ordering is switched off by an admin. */ paused?: boolean }>("/v1/restaurants");
    },
    /**
     * The exact delivery fee for an order from a food business to a location. For one delivery
     * shared with another business (`alsoFrom`, its cart ordered together with this one) or with an
     * unpaid order (`bundleWith`), `shared` splits it into what each order is charged: the first
     * pickup's own delivery, and what this extra stop adds.
     */
    async getRestaurantDeliveryQuote(id: string, input: { lat?: number | null; lng?: number | null; alsoFrom?: string | null; bundleWith?: string | null }) {
      const params = new URLSearchParams();
      if (input.lat != null && input.lng != null) { params.set("lat", String(input.lat)); params.set("lng", String(input.lng)); }
      if (input.alsoFrom) params.set("alsoFrom", input.alsoFrom);
      if (input.bundleWith) params.set("bundleWith", input.bundleWith);
      return request<{
        deliveryFee: number;
        distanceKm: number | null;
        shared?: { firstPickup: { name: string; fee: number }; addedStop: { name: string; fee: number } };
      }>(`/v1/restaurants/${encodeURIComponent(id)}/delivery-quote?${params}`);
    },
    async getRestaurant(id: string) {
      return request<{ restaurant: Restaurant }>(`/v1/restaurants/${id}`);
    },
    async getRestaurantMenu(id: string) {
      return request<RestaurantMenu>(`/v1/restaurants/${id}/menu`);
    },
    /** Server computes every price from the menu — the client only ever
     * says *which* item/choices, never what they cost. */
    async orderFromRestaurant(
      restaurantId: string,
      input: {
        items: Array<{ menuItemId: string; quantity: number; choiceIds?: string[] }>;
        destinationArea?: string;
        destinationAddress?: string;
        destinationLat?: number;
        destinationLng?: number;
        paymentRail?: "escrow" | "float";
        bundleWithOrderId?: string;
      },
    ) {
      return request<{ order: OrderRow }>(`/v1/restaurants/${restaurantId}/order`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async getDeliveryBundleCandidates() {
      return request<{ orders: Array<{ id: string; restaurant_id: string | null; restaurant_name: string | null; pickup_address: string | null; pickup_lat: number; pickup_lng: number; destination_lat: number; destination_lng: number; delivery_fee: number | null; estimated_total: number | null }> }>("/v1/orders/bundle-candidates");
    },
    async closeDeliveryBundleWindow(orderId: string) {
      return request<{ ok: boolean }>(`/v1/orders/${orderId}/bundle-window/close`, { method: "POST" });
    },
    async getOrder(orderId: string) {
      return request<OrderDetail>(`/v1/orders/${orderId}`);
    },
    // Relay delivery (boda -> matatu -> boda for long parcels).
    async getRelayQuote(input: { pickupLat: number; pickupLng: number; destinationLat: number; destinationLng: number; pickupName?: string; destinationName?: string }) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(input)) if (value != null && value !== "") params.set(key, String(value));
      return request<{
        relay: RelayQuote | null;
        /** One boda all the way, along the road. */ boda?: { distanceKm: number; fee: number };
        /** "Direct" is promised in under this many hours (admin setting). */ directMaxHours?: number;
      }>(`/v1/relay/quote?${params}`);
    },
    async trackRelayOrder(orderId: string) {
      return request<RelayTrack>(`/v1/relay/orders/${encodeURIComponent(orderId)}/track`);
    },
    /** Waiting at the petrol station: send a rider to the door, paying the last leg from the wallet. */
    async sendRelayRider(orderId: string) {
      return request<{ orderId: string; charged: number }>(`/v1/relay/orders/${encodeURIComponent(orderId)}/send-rider`, { method: "POST", body: "{}" });
    },
    async listMerchantRelayOrders() {
      return request<{ orders: RelayMerchantOrder[] }>("/v1/relay/merchant/orders");
    },
    // Peebee Gas (pump attendant / station manager session)
    async gasRelayParcels() {
      return request<RelayStationParcels>("/v1/gas/relay/parcels");
    },
    async gasRelayParcel(orderId: string) {
      return request<Omit<RelayTrack, "order"> & { order: { id: string; stage: string; destinationArea: string | null } }>(`/v1/gas/relay/parcels/${encodeURIComponent(orderId)}`);
    },
    async gasRelayReceive(code: string) {
      return request<{ orderId: string }>("/v1/gas/relay/receive", { method: "POST", body: JSON.stringify({ code }) });
    },
    async gasRelayRelease(code: string) {
      return request<{ orderId: string }>("/v1/gas/relay/release", { method: "POST", body: JSON.stringify({ code }) });
    },
    async relayOperatorHandover(code: string) {
      return request<{ orderId: string }>("/v1/relay/operator/handover", { method: "POST", body: JSON.stringify({ code }) });
    },
    async relayOperatorMissed(legId: string) {
      return request<{ orderId: string; station: string }>(`/v1/relay/operator/legs/${encodeURIComponent(legId)}/missed`, { method: "POST", body: "{}" });
    },
    async adminListRelayRouteStages(routeId: string) {
      return request<{ stages: RelayRouteStage[]; ready: boolean }>(`/v1/admin/relay/routes/${encodeURIComponent(routeId)}/stages`);
    },
    async adminCreateRelayRouteStage(routeId: string, input: { name?: string; seq?: number; lat?: number; lng?: number; outletId?: string | null; active?: boolean }) {
      return request<{ id: string }>(`/v1/admin/relay/routes/${encodeURIComponent(routeId)}/stages`, { method: "POST", body: JSON.stringify(input) });
    },
    async adminUpdateRelayRouteStage(stageId: string, input: Partial<{ name: string; seq: number; lat: number; lng: number; outletId: string | null; active: boolean }>) {
      return request<{ ok: boolean }>(`/v1/admin/relay/stages/${encodeURIComponent(stageId)}`, { method: "PATCH", body: JSON.stringify(input) });
    },
    async adminListRelayStations() {
      return request<{ stations: RelayStation[]; ready: boolean }>("/v1/admin/relay/stations");
    },
    /** off, sandbox (sandbox & practice only, for trial stations) or live. */
    async adminSetRelayStation(outletId: string, mode: "off" | "sandbox" | "live") {
      return request<{ ok: boolean }>(`/v1/admin/relay/stations/${encodeURIComponent(outletId)}`, { method: "POST", body: JSON.stringify({ mode }) });
    },
    async listOpenRelayLegs() {
      return request<{ legs: RelayOpenLeg[] }>("/v1/relay/legs/open");
    },
    async claimRelayLeg(legId: string) {
      return request<{ orderId: string }>(`/v1/relay/legs/${encodeURIComponent(legId)}/claim`, { method: "POST", body: "{}" });
    },
    async collectRelayLeg(legId: string, code: string) {
      return request<{ orderId: string }>(`/v1/relay/legs/${encodeURIComponent(legId)}/collect`, { method: "POST", body: JSON.stringify({ code }) });
    },
    async getRelayOperatorMe() {
      return request<{ operator: RelayOperator | null; routes: Array<Pick<RelayRoute, "id" | "name" | "stage_a_name" | "stage_b_name" | "route_code">>; enabled: boolean }>("/v1/relay/operator/me");
    },
    async applyRelayOperator(input: { routeId: string; vehiclePlate: string; phone?: string }) {
      return request<{ ok: boolean }>("/v1/relay/operator/apply", { method: "POST", body: JSON.stringify(input) });
    },
    async getRelayOperatorParcels() {
      return request<RelayOperatorParcels>("/v1/relay/operator/parcels");
    },
    async receiveRelayParcel(code: string) {
      return request<{ orderId: string }>("/v1/relay/operator/receive", { method: "POST", body: JSON.stringify({ code }) });
    },
    async markRelayMatatuArrived(legId: string) {
      return request<{ ok: boolean }>(`/v1/relay/operator/legs/${encodeURIComponent(legId)}/arrived`, { method: "POST", body: "{}" });
    },
    async sendRelayMatatuLocation(legId: string, lat: number, lng: number) {
      return request<{ ok: boolean }>(`/v1/relay/operator/legs/${encodeURIComponent(legId)}/location`, { method: "POST", body: JSON.stringify({ lat, lng }) });
    },
    async adminGetRelaySettings() {
      return request<{ settings: RelaySettings; ready: boolean; stationsReady?: boolean; stagesReady?: boolean }>("/v1/admin/relay/settings");
    },
    async adminUpdateRelaySettings(input: Partial<RelaySettings>) {
      return request<{ settings: RelaySettings }>("/v1/admin/relay/settings", { method: "PUT", body: JSON.stringify(input) });
    },
    async adminListRelayRoutes() {
      return request<{ routes: RelayRoute[]; ready: boolean; /** Migration 0107: stage codes can be saved. */ codesReady?: boolean }>("/v1/admin/relay/routes");
    },
    async adminCreateRelayRoute(input: { name: string; stageAName: string; stageALat: number; stageALng: number; stageBName: string; stageBLat: number; stageBLng: number; parcelFare: number; active?: boolean; dropMode?: "stage" | "station"; stageACode?: string; stageBCode?: string }) {
      return request<{ id: string }>("/v1/admin/relay/routes", { method: "POST", body: JSON.stringify(input) });
    },
    async adminUpdateRelayRoute(id: string, input: Partial<{ name: string; stageAName: string; stageALat: number; stageALng: number; stageBName: string; stageBLat: number; stageBLng: number; parcelFare: number; active: boolean; dropMode: "stage" | "station"; stageACode: string; stageBCode: string }>) {
      return request<{ ok: boolean }>(`/v1/admin/relay/routes/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
    },
    // Taxipress (scheduled shared-taxi seats).
    /** Always answers; `enabled` is false while Taxipress is off, not set up, or has no running route. */
    async getTaxipressConfig() {
      return request<TaxipressConfig>("/v1/taxipress/config");
    },
    async adminGetTaxipressSettings() {
      return request<{ settings: TaxipressSettings; ready: boolean }>("/v1/admin/taxipress/settings");
    },
    async adminUpdateTaxipressSettings(input: Partial<TaxipressSettings>) {
      return request<{ settings: TaxipressSettings }>("/v1/admin/taxipress/settings", { method: "PUT", body: JSON.stringify(input) });
    },
    async adminListTaxipressRoutes() {
      return request<{ routes: TaxipressAdminRoute[]; relayRoutes: TaxipressRelayRoute[]; ready: boolean }>("/v1/admin/taxipress/routes");
    },
    async adminCreateTaxipressRoute(input: { relayRouteId: string; direction: "a_to_b" | "b_to_a"; farePerSeat: number; stopPricingEnabled?: boolean; active?: boolean }) {
      return request<{ id: string }>("/v1/admin/taxipress/routes", { method: "POST", body: JSON.stringify(input) });
    },
    async adminUpdateTaxipressRoute(id: string, input: Partial<{ farePerSeat: number; stopPricingEnabled: boolean; active: boolean }>) {
      return request<{ ok: boolean }>(`/v1/admin/taxipress/routes/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
    },
    // Taxipress: the driver's taxi and the line.
    async getTaxipressTaxiMe() {
      return request<TaxipressDriverView>("/v1/taxipress/taxi/me");
    },
    async applyTaxipressTaxi(input: { relayRouteId: string; plate: string; seatLayout: "14" | "18" }) {
      return request<{ ok: boolean }>("/v1/taxipress/taxi/apply", { method: "POST", body: JSON.stringify(input) });
    },
    async taxipressJoinLine(input: { routeId: string; lat?: number; lng?: number }) {
      return request<{ entry: TaxipressLineEntry }>("/v1/taxipress/driver/join", { method: "POST", body: JSON.stringify(input) });
    },
    async taxipressStartBoarding() {
      return request<{ entry: TaxipressLineEntry }>("/v1/taxipress/driver/boarding", { method: "POST", body: "{}" });
    },
    async taxipressGoOnRoad() {
      return request<{ entry: TaxipressLineEntry }>("/v1/taxipress/driver/on-road", { method: "POST", body: "{}" });
    },
    async taxipressArrive() {
      return request<{ ok: boolean }>("/v1/taxipress/driver/arrive", { method: "POST", body: "{}" });
    },
    /** Confirm a passenger's ticket code at boarding; the seat is settled. */
    async taxipressBoard(code: string) {
      return request<TaxipressBoardingResult>("/v1/taxipress/driver/board", { method: "POST", body: JSON.stringify({ code }) });
    },
    async taxipressLeaveLine() {
      return request<{ ok: boolean }>("/v1/taxipress/driver/leave", { method: "POST", body: "{}" });
    },
    /** Seats sold at the stage without the app (negative gives some back). */
    async taxipressWalkUp(delta: number) {
      return request<{ entry: TaxipressLineEntry }>("/v1/taxipress/driver/walk-up", { method: "POST", body: JSON.stringify({ delta }) });
    },
    async taxipressSendLocation(lat: number, lng: number) {
      return request<{ ok: boolean }>("/v1/taxipress/driver/location", { method: "POST", body: JSON.stringify({ lat, lng }) });
    },
    /** The taxis waiting on a route (the one Boarding Now first) and the ones already on the road. */
    async getTaxipressQueue(routeId: string) {
      return request<TaxipressQueueView>(`/v1/taxipress/routes/${encodeURIComponent(routeId)}/queue`);
    },
    /** Book seats on a taxi in the line. Pay next on the order's pay screen, or hand cash to the driver. */
    async bookTaxipressSeats(input: { queueId: string; seats?: number; payment?: "app" | "cash"; adults?: number; children?: number; luggage?: Partial<Record<TaxipressLuggageType, number>>; assistance?: TaxipressAssistance | null; language?: TaxipressLanguage | null; forSomeoneElse?: boolean; travellerName?: string | null; travellerPhone?: string | null; emergencyPhone?: string | null; openTicket?: boolean }) {
      return request<{ booking: TaxipressBooking; order: { id: string } }>("/v1/taxipress/bookings", { method: "POST", body: JSON.stringify(input) });
    },
    async getTaxipressTaxiProfile(queueId: string) {
      return request<{ profile: TaxipressTaxiProfile }>(`/v1/taxipress/taxis/${encodeURIComponent(queueId)}/profile`);
    },
    async getMyTaxipressBookings() {
      return request<{ bookings: TaxipressBooking[] }>("/v1/taxipress/bookings/mine");
    },
    /** Checks a receipt by its reference (the QR on a receipt holds a link ending in it). Public: no sign-in needed. */
    async verifyReceipt(ref: string) {
      return request<PublicReceipt>(`/v1/public/receipts/${encodeURIComponent(ref)}`);
    },
    async getTaxipressBooking(id: string) {
      return request<{ booking: TaxipressBooking }>(`/v1/taxipress/bookings/${encodeURIComponent(id)}`);
    },
    /** Public: the details behind a ticket code, for a traveller who is not signed in. */
    async getTaxipressTicketByCode(code: string) {
      return request<{ ticket: PublicTaxipressTicket }>(`/v1/taxipress-ticket/${encodeURIComponent(code)}`);
    },
    /** Send a ticket you bought to the person travelling; they get it in My tickets, and you get the code to pass on. */
    async sendTaxipressTicket(id: string, input: { name: string; phone: string }) {
      return request<TaxipressSendResult>(`/v1/taxipress/bookings/${encodeURIComponent(id)}/send`, { method: "POST", body: JSON.stringify(input) });
    },
    /** Cancel a seat that has not boarded; the refund follows staff's cancellation rules. */
    async cancelTaxipressBooking(id: string) {
      return request<{ outcome: TaxipressOutcome }>(`/v1/taxipress/bookings/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" });
    },
    /** Driver: mark a passenger who never turned up. */
    async taxipressNoShow(bookingId: string) {
      return request<{ outcome: TaxipressOutcome }>("/v1/taxipress/driver/no-show", { method: "POST", body: JSON.stringify({ bookingId }) });
    },
    async adminListTaxipressTaxis() {
      return request<{ taxis: TaxipressTaxi[] }>("/v1/admin/taxipress/taxis");
    },
    async adminUpdateTaxipressTaxi(id: string, input: Partial<{ status: "pending" | "approved" | "suspended"; passengersEnabled: boolean; parcelsEnabled: boolean }>) {
      return request<{ taxi: TaxipressTaxi }>(`/v1/admin/taxipress/taxis/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify(input) });
    },
    async adminTaxipressReport(days = 30) {
      return request<TaxipressReport>(`/v1/admin/taxipress/report?days=${days}`);
    },
    async adminTaxipressQueue() {
      return request<{ queue: TaxipressAdminQueueEntry[] }>("/v1/admin/taxipress/queue");
    },
    async adminRemoveTaxipressQueueEntry(id: string) {
      return request<{ ok: boolean }>(`/v1/admin/taxipress/queue/${encodeURIComponent(id)}/remove`, { method: "POST", body: "{}" });
    },
    async adminListRelayOperators() {
      return request<{ operators: RelayOperator[] }>("/v1/admin/relay/operators");
    },
    async adminSetRelayOperatorStatus(userId: string, status: "approved" | "suspended" | "pending") {
      return request<{ ok: boolean }>(`/v1/admin/relay/operators/${encodeURIComponent(userId)}/status`, { method: "POST", body: JSON.stringify({ status }) });
    },
    async adminListRelayOrders() {
      return request<{ orders: RelayAdminOrder[] }>("/v1/admin/relay/orders");
    },
    /** Attaches a spoken note to the order — context a typed list can miss (units, brand, exactly where in the shop). */
    async uploadOrderVoiceNote(orderId: string, audio: Blob) {
      const form = new FormData();
      form.append("audio", audio, "voice-note.webm");
      const res = await f(`${root}/v1/orders/${orderId}/voice-note`, {
        method: "POST",
        headers: authHeaders(),
        body: form,
      });
      return json<{ order: OrderRow }>(res);
    },
    /** Fetches the order's voice note as a Blob (not JSON — raw fetch, mirrors adminRiderIdDocumentBlob). */
    async orderVoiceNoteBlob(orderId: string): Promise<Blob> {
      const res = await f(`${root}/v1/orders/${orderId}/voice-note`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`API ${res.status}: failed to load voice note`);
      return res.blob();
    },
    /** Fetches (generating and caching server-side on first call) the
     * order's shopping list read aloud in Luganda. */
    async orderListAudioBlob(orderId: string): Promise<Blob> {
      const res = await f(`${root}/v1/orders/${orderId}/list-audio`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`API ${res.status}: failed to load list audio`);
      return res.blob();
    },
    /** A short canned phrase spoken in the given catalog voice, so a rider
     * can hear it before picking it in settings. */
    async voicePreviewBlob(voice: string): Promise<Blob> {
      const res = await f(`${root}/v1/speech/voice-preview?voice=${encodeURIComponent(voice)}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`API ${res.status}: failed to load voice preview`);
      return res.blob();
    },
    async matchOrder(orderId: string) {
      return request<{ order: OrderRow }>(`/v1/orders/${orderId}/match`, { method: "POST" });
    },
    /** Rider actively takes an unmatched job from their available-jobs list. */
    async claimOrder(orderId: string) {
      return request<{ order: OrderRow }>(`/v1/orders/${orderId}/claim`, { method: "POST" });
    },
    /** Rider offers for a "nearest_window"/"customer_selects" job — doesn't assign it outright, see claimOrder. */
    async applyForOrder(orderId: string, bidAmount?: number) {
      return request<{ ok: true }>(`/v1/orders/${orderId}/apply`, {
        method: "POST",
        body: bidAmount != null ? JSON.stringify({ bidAmount }) : undefined,
      });
    },
    /** The applicant pool for a "customer_selects" order, for the customer to compare and pick from. */
    async getApplicants(orderId: string) {
      return request<{ applicants: RiderApplicant[] }>(`/v1/orders/${orderId}/applicants`);
    },
    async getApplicantProfile(orderId: string, riderId: string, offset = 0) {
      return request<RiderApplicantProfile>(`/v1/orders/${orderId}/applicants/${riderId}/profile?offset=${offset}`);
    },
    /** Customer's pick from the applicant pool — assigns that rider and turns away the rest. */
    async selectApplicant(orderId: string, riderId: string) {
      return request<{ order: OrderRow }>(`/v1/orders/${orderId}/applicants/${riderId}/select`, { method: "POST" });
    },
    /** Rider backs out of a job they were matched to — it drops back into the matching pool for another rider. */
    async cancelOrder(orderId: string) {
      return request<{ order: OrderRow }>(`/v1/orders/${orderId}/cancel`, { method: "POST" });
    },
    /** Customer backs out of their own order — only while it's still
     * unmatched (no rider, nothing paid). Stays in their order history as
     * "Cancelled". */
    async customerCancelOrder(orderId: string, acceptedFee = 0) {
      return request<{ order: OrderRow }>(`/v1/orders/${orderId}/customer-cancel`, { method: "POST", body: JSON.stringify({ acceptedFee }) });
    },
    /** Same eligibility as customerCancelOrder, but also drops it off the
     * customer's own Lists view — nothing is actually erased server-side. */
    async customerDeleteOrder(orderId: string) {
      return request<{ ok: true }>(`/v1/orders/${orderId}/customer-delete`, { method: "POST" });
    },
    /** `code` is a promo code the customer typed; offers that apply by themselves are already in the amounts. */
    async getOrderCheckout(orderId: string, code?: string | null) {
      return request<{
        baseAmount: number; mobileMoney: number; wallet: number; cash: number;
        /** The fare before any offer, and what the offers took off (null when none applies). */
        fullAmount?: number;
        offer?: { discount: number; cashback: number; applied: Array<{ offerId: string; name: string; discount: number; cashback: number }> } | null;
        /** Present on the first pickup of a combined delivery: the quote covers every pickup. */
        bundle?: { deliveryFee: number; orders: Array<{ id: string; restaurantName: string | null; itemsAndDelivery: number; deliveryFee: number }> };
        /** A relay that can be paid now, before any rider accepts it (admin setting). */
        payBeforeRider?: boolean;
        /** A TaxiPress booking's order: its ticket, and whether cash is allowed (and why not). */
        taxipress?: { bookingId: string; cashAllowed: boolean; cashReason: string | null } | null;
      } & Partial<CheckoutBreakdown>>(`/v1/orders/${orderId}/checkout${code ? `?code=${encodeURIComponent(code)}` : ""}`);
    },
    /** Tries a promo code on this order without paying: what it takes off, or why it doesn't apply. */
    async previewOrderOffer(orderId: string, code: string | null) {
      return request<{
        enabled: boolean; fare: number; discount: number; cashback: number; payable: number;
        applied: Array<{ offerId: string; name: string; discount: number; cashback: number }>;
        codeAccepted: boolean | null; codeMessage: string | null;
      }>(`/v1/orders/${orderId}/offer/preview`, { method: "POST", body: JSON.stringify({ code }) });
    },
    /** Offers a customer can get, their wallet credit and what an invitation is worth. */
    async getMyOffers() {
      return request<{
        enabled: boolean; allowCodeEntry: boolean; credit: number;
        offers: Array<{ id: string; name: string; description: string; kind: string; kindLabel: string; summary: string; services: string[]; endsAt: string | null; remaining: number | null }>;
        referral: { creditForFriend: number } | null;
      }>("/v1/offers/mine");
    },
    async getReferral() {
      return request<{ enabled: boolean; code: string | null; invited?: number; creditForFriend?: number }>("/v1/offers/referral");
    },
    async applyReferral(code: string) {
      return request<{ ok: true }>("/v1/offers/referral/apply", { method: "POST", body: JSON.stringify({ code }) });
    },
    async getCredit() {
      return request<{
        enabled: boolean; balance: number; spendableOn?: string[]; expiryDays?: number;
        lots: Array<{ id: string; remaining: number; source: string; partner_id: string | null; expires_at: string | null }>;
        ledger: Array<{ type: string; amount: number; balance_after: number; note: string | null; created_at: string }>;
      }>("/v1/credit");
    },
    /** A rider's discount wallet: what customers' offers owe them, and how it is cleared. */
    async getRiderDiscountWallet() {
      return request<{
        enabled: boolean; balance: number; offsetsCommission?: boolean; payoutMethod?: string; canRequest?: boolean; minPayout?: number; requestPending?: boolean;
        ledger: Array<{ type: string; amount: number; balance_after: number; note: string | null; created_at: string }>;
      }>("/v1/riders/me/discount-wallet");
    },
    async requestRiderDiscountPayout() {
      return request<{ paid: number; queued: number }>("/v1/riders/me/discount-wallet/request", { method: "POST", body: "{}" });
    },
    async getRiderIncentives() {
      return request<{
        enabled: boolean; earnedThisMonth: number;
        active: Array<{ kind: string; label: string; detail: string }>;
        recent: Array<{ kind: string; amount: number; note: string | null; created_at: string }>;
      }>("/v1/riders/me/incentives");
    },
    async getCustomerWithdrawals() {
      return request<{
        enabled: boolean; cash?: number; locked?: number; allowed: number; lockDays?: number; minAmount?: number;
        withdrawals: Array<{ id: string; amount: number; status: string; msisdn: string; review_reason: string | null; created_at: string }>;
      }>("/v1/wallet/withdrawals");
    },
    async withdrawCustomerWallet(input: { amount: number; msisdn: string }) {
      return request<{ id: string; status: string; message?: string }>("/v1/wallet/withdraw", { method: "POST", body: JSON.stringify(input) });
    },
    /** What the order page shows: items, subtotal and delivery for the whole combined delivery (or the order), at any stage. */
    async getOrderBreakdown(orderId: string) {
      return request<CheckoutBreakdown & { total: number }>(`/v1/orders/${orderId}/breakdown`);
    },
    async fundOrder(
      orderId: string,
      input: { paymentMethod?: "mobile_money" | "card" | "wallet" | "cash"; acceptedAmount?: number; msisdn?: string; card?: CardInput; useWallet?: boolean; walletOwnerId?: string; walletId?: string; offerCode?: string | null } = {},
    ) {
      return request<{
        order: OrderRow;
        payment?: { id: string; status: string; network: string | null };
        redirectUrl?: string;
        nextAction?: PaymentNextAction;
        funded?: boolean;
        rail?: string;
      }>(`/v1/orders/${orderId}/fund`, { method: "POST", body: JSON.stringify(input) });
    },
    async proposeSubstitution(
      orderId: string,
      input: { itemId?: string; originalName: string; substituteName: string; priceDelta?: number },
    ) {
      return request<{ substitution: string }>(`/v1/orders/${orderId}/substitutions`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async decideSubstitution(orderId: string, subId: string, approve: boolean) {
      return request<{ order: OrderRow }>(`/v1/orders/${orderId}/substitutions/${subId}/decision`, {
        method: "POST",
        body: JSON.stringify({ approve }),
      });
    },
    /** Bundles several item changes (unavailable / price change) into one customer approval instead of many. */
    async proposeSubstitutionBatch(
      orderId: string,
      changes: Array<{ itemId?: string; originalName: string; substituteName: string; priceDelta?: number }>,
    ) {
      return request<{ batchId: string; order: OrderRow }>(`/v1/orders/${orderId}/substitutions/batch`, {
        method: "POST",
        body: JSON.stringify({ changes }),
      });
    },
    async decideSubstitutionBatch(orderId: string, batchId: string, approve: boolean) {
      return request<{ order: OrderRow }>(`/v1/orders/${orderId}/substitutions/batch/${batchId}/decision`, {
        method: "POST",
        body: JSON.stringify({ approve }),
      });
    },
    /** Rider suggests a different total than the app's auto-calculated (or customer-entered) one. */
    async proposeFee(orderId: string, input: { proposedTotal: number; reason?: string }) {
      return request<{ proposalId: string; order: OrderRow }>(`/v1/orders/${orderId}/fee-proposals`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    /** Attaches a spoken reason to a fee proposal — deliberately not transcribed (a
     * non-English recording would just come back as gibberish text), so it travels
     * as raw audio instead, alongside whatever the rider typed. */
    async uploadFeeProposalVoiceNote(orderId: string, proposalId: string, audio: Blob) {
      const form = new FormData();
      form.append("audio", audio, "voice-note.webm");
      const res = await f(`${root}/v1/orders/${orderId}/fee-proposals/${proposalId}/voice-note`, {
        method: "POST",
        headers: authHeaders(),
        body: form,
      });
      return json<{ order: OrderRow }>(res);
    },
    async feeProposalVoiceNoteBlob(orderId: string, proposalId: string): Promise<Blob> {
      const res = await f(`${root}/v1/orders/${orderId}/fee-proposals/${proposalId}/voice-note`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`API ${res.status}: failed to load voice note`);
      return res.blob();
    },
    async decideFeeProposal(orderId: string, proposalId: string, approve: boolean) {
      return request<{ order: OrderRow }>(`/v1/orders/${orderId}/fee-proposals/${proposalId}/decision`, {
        method: "POST",
        body: JSON.stringify({ approve }),
      });
    },
    async deliverOrder(orderId: string, etaMinutes?: number) {
      return request<{ order: OrderRow }>(`/v1/orders/${orderId}/deliver`, {
        method: "POST",
        body: JSON.stringify({ etaMinutes }),
      });
    },
    /** Rider's live position while in-app navigation is open — powers the
     * customer's tracking map. Fired every few seconds; deliberately
     * lightweight (no order returned) since it's called far more often
     * than any other order action. */
    async postOrderLocation(orderId: string, lat: number, lng: number) {
      return request<{ ok: true }>(`/v1/orders/${orderId}/location`, {
        method: "POST",
        body: JSON.stringify({ lat, lng }),
      });
    },
    /** Rider's own "I've arrived" tap — notifies the customer. */
    async arrivedOrder(orderId: string) {
      return request<{ order: OrderRow }>(`/v1/orders/${orderId}/arrived`, { method: "POST" });
    },
    /** Ride only: rider confirms the passenger is aboard and they're now heading to the destination. */
    async pickedUpOrder(orderId: string) {
      return request<{ order: OrderRow }>(`/v1/orders/${orderId}/picked-up`, { method: "POST" });
    },
    async handoverOrder(orderId: string, pin: string) {
      return request<{ order: OrderRow }>(`/v1/orders/${orderId}/handover`, {
        method: "POST",
        body: JSON.stringify({ pin }),
      });
    },
    async settleOrder(orderId: string) {
      return request<{ order: OrderRow }>(`/v1/orders/${orderId}/settle`, { method: "POST" });
    },
    async rateOrder(orderId: string, input: { rating: number; comment?: string; recommended?: boolean }) {
      return request<{ ok: true; rating: number; comment: string | null; recommended: boolean }>(
        `/v1/orders/${orderId}/rate`,
        { method: "POST", body: JSON.stringify(input) },
      );
    },
    /** The customer's standing preference for how riders get assigned to their orders — null defers to admin's default. */
    async updateMatchingPreference(defaultMatchingMode: MatchingMode | null) {
      return request<{ defaultMatchingMode: MatchingMode | null }>("/v1/me/matching-preference", {
        method: "PUT",
        body: JSON.stringify({ defaultMatchingMode }),
      });
    },

    // Chat
    async getChat(orderId: string) {
      return request<{ messages: ChatMessage[]; order: OrderRow; events: OrderEvent[]; items: ListItem[] }>(
        `/v1/orders/${orderId}/chat`,
      );
    },
    async sendChat(orderId: string, body: string, replyToId?: string) {
      return request<{ id: string }>(`/v1/orders/${orderId}/chat`, {
        method: "POST",
        body: JSON.stringify({ body, replyToId }),
      });
    },
    /** Sends a photo or voice note as a chat message. `file` is a browser File/Blob. */
    async sendChatMedia(orderId: string, type: "image" | "voice", file: Blob, replyToId?: string) {
      const form = new FormData();
      form.append("type", type);
      form.append("file", file, type === "image" ? "photo.jpg" : "voice.webm");
      if (replyToId) form.append("replyToId", replyToId);
      const res = await f(`${root}/v1/orders/${orderId}/chat`, {
        method: "POST",
        headers: authHeaders(),
        body: form,
      });
      return json<{ id: string }>(res);
    },
    /** Deletes a chat message — "me" hides it from just this account's own
     * view, "everyone" clears its content for both sides (sender only). */
    async deleteChatMessage(messageId: string, scope: "me" | "everyone") {
      return request<{ ok: true; scope: "me" | "everyone" }>(`/v1/chat/${messageId}/delete`, {
        method: "POST",
        body: JSON.stringify({ scope }),
      });
    },
    /** Fetches a chat message's photo/voice note as a Blob (not JSON — raw fetch). */
    async chatMediaBlob(messageId: string): Promise<Blob> {
      const res = await f(`${root}/v1/chat/media/${messageId}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`API ${res.status}: failed to load chat media`);
      return res.blob();
    },
    /** The Chat tab's conversation list — every counterpart this user has ever messaged, most recent first. */
    async getChatThreads() {
      return request<{ threads: ChatThread[] }>("/v1/chat/threads");
    },
    /** The Chat tab's restaurant conversations — every restaurant this customer has ever messaged, most recent first. */
    async getMyRestaurantChatThreads() {
      return request<{ threads: CustomerRestaurantChatThread[] }>("/v1/restaurants/chats/mine");
    },
    /** Opens a conversation by counterpart — resolves the order to send through plus the full shared history. */
    async getChatThread(counterpartId: string) {
      return request<ChatThreadDetail>(`/v1/chat/threads/${counterpartId}`);
    },
    /** Marks this order's conversation as read up to now — clears the unread badge for its counterpart. */
    async markChatRead(orderId: string) {
      return request<{ ok: true }>(`/v1/orders/${orderId}/chat/read`, { method: "POST" });
    },

    // Push notifications
    async subscribePush(subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) {
      return request<{ ok: true }>("/v1/push/subscribe", {
        method: "POST",
        body: JSON.stringify(subscription),
      });
    },
    async unsubscribePush(endpoint: string) {
      return request<{ ok: true }>("/v1/push/unsubscribe", {
        method: "POST",
        body: JSON.stringify({ endpoint }),
      });
    },

    // Payments
    async refreshPayment(paymentId: string) {
      return request<{ payment: Payment }>(`/v1/payments/${paymentId}/refresh`);
    },

    // Riders
    async applyAsRider(input: {
      area?: string;
      vehicleInfo?: string;
      momoMsisdn?: string;
      firstName?: string;
      lastName?: string;
      email?: string;
      altPhone?: string;
      stageAddress?: string;
      homeAddress?: string;
      stageLat?: number;
      stageLng?: number;
      stageName?: string;
      stageChairmanName?: string;
      stageChairmanContact?: string;
      emergencyContactName?: string;
      emergencyContactPhone?: string;
    }) {
      return request<{ rider: Rider }>("/v1/riders/apply", { method: "POST", body: JSON.stringify(input) });
    },
    /** Sets (or clears, with `null`) the rider's own standing Luganda voice —
     * used for every order's list audio from then on. */
    async updateVoicePreference(voice: string | null) {
      return request<{ rider: Rider }>("/v1/riders/me/voice-preference", { method: "PUT", body: JSON.stringify({ voice }) });
    },
    /** Uploads the rider's National ID scan (verification only). `file` is a browser File/Blob. */
    async uploadRiderIdDocument(file: Blob) {
      const form = new FormData();
      form.append("file", file);
      const res = await f(`${root}/v1/riders/id-document`, {
        method: "POST",
        headers: authHeaders(),
        body: form,
      });
      return json<{ rider: Rider }>(res);
    },
    /** Uploads the rider's own face photo — shown to customers once matched, mandatory for profile completion. */
    async uploadRiderProfilePhoto(file: Blob) {
      const form = new FormData();
      form.append("file", file);
      const res = await f(`${root}/v1/riders/profile-photo`, {
        method: "POST",
        headers: authHeaders(),
        body: form,
      });
      return json<{ rider: Rider }>(res);
    },
    /** Fetches a rider's profile photo as a Blob (not JSON — raw fetch; caller builds an object URL). */
    async taxipressDriverPhotoBlob(path: string): Promise<Blob> {
      const res = await f(`${root}${path}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`API ${res.status}: failed to load driver photo`);
      return res.blob();
    },
    async riderPhotoBlob(userId: string): Promise<Blob> {
      const res = await f(`${root}/v1/riders/${userId}/photo`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`API ${res.status}: failed to load rider photo`);
      return res.blob();
    },
    async setRiderOnline(online: boolean) {
      return request<{ rider: Rider }>("/v1/riders/status", { method: "POST", body: JSON.stringify({ online }) });
    },
    async myRiderProfile() {
      return request<{ rider: Rider | null }>("/v1/riders/me");
    },
    async myRiderOrders() {
      return request<{ orders: OrderRow[] }>("/v1/riders/me/orders");
    },
    /** Unmatched orders currently open to this rider — nearest riders see each one first, then it widens. */
    async availableJobs() {
      return request<{ jobs: AvailableJob[] }>("/v1/riders/jobs/available");
    },
    /** Item-level detail for a still-open job — the available-jobs feed itself withholds this until claimed. */
    async previewJob(orderId: string) {
      return request<{ items: ListItem[] }>(`/v1/riders/jobs/${orderId}/preview`);
    },
    async myWallet() {
      return request<Wallet>("/v1/riders/me/wallet");
    },
    /** Funds the rider's own wallet via mobile money — the only way to top
     * back up when "deposit" mode requires a minimum balance to keep
     * taking jobs. */
    async topUpRiderWallet(input: { amount: number; msisdn: string }) {
      return request<{ topupId: string; status: "pending"; network: string | null; redirectUrl?: string }>(
        "/v1/riders/me/wallet/topup",
        { method: "POST", body: JSON.stringify(input) },
      );
    },
    async refreshRiderTopup(id: string) {
      return request<{ topup: { id: string; status: "pending" | "successful" | "failed"; amount: number } }>(
        `/v1/riders/me/wallet/topups/${id}/refresh`,
      );
    },
    /** Omit `amount` to withdraw everything above the reserve (if any); pass
     * one to leave more than that behind — never less. `mobileNumberId` is
     * required once the rider has 2 saved withdrawal numbers (no reasonable
     * default between them), optional with 0 or 1 saved. */
    async withdrawWallet(amount?: number, mobileNumberId?: string) {
      return request<{ withdrawalId: string; amount: number; status: "pending" }>("/v1/riders/me/wallet/withdraw", {
        method: "POST",
        body: JSON.stringify({ ...(amount != null ? { amount } : {}), ...(mobileNumberId ? { mobileNumberId } : {}) }),
      });
    },
    async refreshWithdrawal(id: string) {
      return request<{ withdrawal: Wallet["withdrawals"][number] }>(`/v1/riders/me/wallet/withdrawals/${id}/refresh`);
    },
    /** Pays out the rider's entire balance (reserve included) and locks the
     * account — refused if they've got an order in flight. */
    async closeRiderAccount() {
      return request<{ ok: true; paidOut: number }>("/v1/riders/me/close-account", { method: "POST" });
    },

    // Restaurants — Phase 1 (see apps/api/src/restaurants/routes.ts). Not
    // yet a first-class account role; any signed-in customer can apply.
    async applyAsRestaurant(input: {
      businessType?: import("./food-business.js").FoodBusinessType;
      name: string;
      description?: string;
      cuisine?: string;
      phone?: string;
      address?: string;
      lat?: number;
      lng?: number;
      openTime?: string | null;
      closeTime?: string | null;
    }) {
      return request<{ restaurant: Restaurant }>("/v1/restaurants/apply", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async myRestaurant() {
      return request<{ restaurant: Restaurant }>("/v1/restaurants/me");
    },
    async myFoodOrders(view: 'active' | 'history' = 'active', cursor?: string) {
      const query = new URLSearchParams({ view });
      if (cursor) query.set('cursor', cursor);
      return request<import('./food-orders.js').FoodSellerOrders>(`/v1/restaurants/me/orders?${query}`);
    },
    async updateRestaurant(input: Partial<{
      themeScene: import("./colour-scenes.js").ColourScene;
      themeMode: "auto" | "light" | "dark";
      businessType: import("./food-business.js").FoodBusinessType;
      name: string;
      description: string;
      cuisine: string;
      phone: string;
      address: string;
      lat: number;
      lng: number;
      isOpen: boolean;
      openTime: string | null;
      closeTime: string | null;
    }>) {
      return request<{ restaurant: Restaurant }>("/v1/restaurants/me", {
        method: "PATCH",
        body: JSON.stringify(input),
      });
    },
    async merchantBalance(merchantId: string) {
      return request<{ balance: MerchantBalance; currency: "UGX"; environment: PlatformEnvironment }>(
        `/v1/merchants/${merchantId}/balance`,
      );
    },
    async merchantCategories() {
      return request<{ categories: MerchantCategory[] }>("/v1/merchant-categories");
    },
    async applyAsMerchant(input: {
      legalName: string;
      displayName: string;
      categoryId: string;
      outletName: string;
      phone?: string;
      address?: string;
      lat: number;
      lng: number;
    }) {
      return request<{ merchant: Merchant; outlet: MerchantOutlet }>("/v1/merchants/apply", {
        method: "POST",
        body: JSON.stringify({ ...input, businessKind: "business" }),
      });
    },
    async myMerchants() {
      return request<{ merchants: Merchant[] }>("/v1/merchants/me");
    },
    async updateMerchant(merchantId: string, input: { legalName?: string; displayName?: string }) {
      return request<{ merchant: Merchant }>(`/v1/merchants/${merchantId}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
    },
    async submitMerchantKyc(merchantId: string, input: { registrationNumber: string; taxId: string }) {
      return request<{ kyc: { status: "in_review" } }>(`/v1/merchants/${merchantId}/kyc`, {
        method: "POST",
        body: JSON.stringify({ ...input, declarationAccepted: true }),
      });
    },
    async uploadMerchantKycDocument(merchantId: string, type: "owner-id" | "business-registration", file: Blob) {
      const form = new FormData();
      form.append("file", file);
      const res = await f(`${root}/v1/merchants/${merchantId}/kyc-documents/${type}`, {
        method: "POST",
        headers: authHeaders(),
        body: form,
      });
      return json<{ document: { type: string; uploaded: true } }>(res);
    },
    async merchantOutlets(merchantId: string) {
      return request<{ outlets: MerchantOutlet[] }>(`/v1/merchants/${merchantId}/outlets`);
    },
    async createMerchantOutlet(merchantId: string, input: {
      categoryId: string; name: string; phone?: string; address?: string; lat: number; lng: number;
    }) {
      return request<{ outlet: MerchantOutlet }>(`/v1/merchants/${merchantId}/outlets`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async updateMerchantOutlet(merchantId: string, outletId: string, input: Partial<{
      name: string; phone: string | null; address: string | null; lat: number; lng: number;
      status: "active" | "suspended" | "closed";
    }>) {
      return request<{ outlet: MerchantOutlet }>(`/v1/merchants/${merchantId}/outlets/${outletId}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
    },
    async merchantMembers(merchantId: string) {
      return request<{ members: MerchantMember[] }>(`/v1/merchants/${merchantId}/members`);
    },
    async addMerchantMember(merchantId: string, input: {
      identifier: string; role: "finance" | "manager" | "cashier"; outletId?: string | null;
    }) {
      return request<{ member: { userId: string; role: string; status: "active" } }>(`/v1/merchants/${merchantId}/members`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async removeMerchantMember(merchantId: string, userId: string) {
      return request<{ ok: true }>(`/v1/merchants/${merchantId}/members/${userId}`, { method: "DELETE" });
    },
    async merchantTransactions(merchantId: string) {
      return request<{ transactions: MerchantTransaction[] }>(`/v1/merchants/${merchantId}/transactions`);
    },
    async merchantPayments(merchantId: string) {
      return request<{ payments: MerchantPaymentSummary[] }>(`/v1/merchants/${merchantId}/payments`);
    },
    async merchantSettlements(merchantId: string) {
      return request<{ settlements: MerchantSettlement[] }>(`/v1/merchants/${merchantId}/settlements`);
    },
    async merchantDisputes(merchantId: string) {
      return request<{ disputes: MerchantDispute[] }>(`/v1/merchants/${merchantId}/disputes`);
    },
    async createMerchantDispute(merchantId: string, merchantPaymentId: string, reason: string) {
      return request<{ dispute: MerchantDispute }>(`/v1/merchants/${merchantId}/disputes`, {
        method: "POST",
        body: JSON.stringify({ merchantPaymentId, reason }),
      });
    },
    async merchantSettlementAccounts(merchantId: string) {
      return request<{ settlementAccounts: MerchantSettlementAccount[] }>(
        `/v1/merchants/${merchantId}/settlement-accounts`,
      );
    },
    async addMerchantSettlementAccount(merchantId: string, input: {
      type: "momo" | "bank";
      provider: string;
      accountRef: string;
      accountName?: string;
      networkOrBank?: string;
    }) {
      return request<{ settlementAccount: { id: string; status: "pending_verification"; coolingHours: number } }>(
        `/v1/merchants/${merchantId}/settlement-accounts`,
        { method: "POST", body: JSON.stringify(input) },
      );
    },
    async quoteMerchantSettlement(merchantId: string, input: {
      settlementAccountId: string;
      amount: number;
      mode: "instant" | "scheduled";
    }) {
      return request<{ quote: { id: string; amount: number; fee: number; totalDebit: number; currency: "UGX"; expiresInSeconds: number } }>(
        `/v1/merchants/${merchantId}/settlement-quotes`,
        { method: "POST", body: JSON.stringify(input) },
      );
    },
    async createMerchantSettlement(merchantId: string, quoteId: string, idempotencyKey: string) {
      return request<{ settlement: MerchantSettlement }>(`/v1/merchants/${merchantId}/settlements`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ quoteId }),
      });
    },
    async refreshMerchantSettlement(merchantId: string, settlementId: string) {
      return request<{ settlement: MerchantSettlement }>(
        `/v1/merchants/${merchantId}/settlements/${settlementId}/refresh`,
        { method: "POST" },
      );
    },
    async createMerchantPayment(input: {
      orderId: string;
      outletCode?: string;
      amount: number;
      riderLat?: number;
      riderLng?: number;
      accuracyM?: number;
      capturedAt?: string;
      evidenceMode?: "gps" | "dynamic_request" | "merchant_reauth_receipt";
      receiptReference?: string;
    }, idempotencyKey: string) {
      return request<{ payment: MerchantPayment }>("/v1/merchant-payments", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(input),
      });
    },
    async merchantPayment(id: string) {
      return request<{ payment: MerchantPayment }>(`/v1/merchant-payments/${id}`);
    },
    async confirmMerchantPayment(id: string, amount: number) {
      return request<{ payment: MerchantPayment }>(`/v1/merchant-payments/${id}/merchant-confirm`, {
        method: "POST",
        body: JSON.stringify({ amount }),
      });
    },

    // Menu — see apps/api/src/restaurants/menu.ts.
    async myMenu() {
      return request<RestaurantMenu>("/v1/restaurants/me/menu");
    },
    async createMenuCategory(input: { name: string; sortOrder?: number }) {
      return request<{ category: MenuCategory }>("/v1/restaurants/me/menu/categories", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async updateMenuCategory(id: string, input: Partial<{ name: string; sortOrder: number }>) {
      return request<{ category: MenuCategory }>(`/v1/restaurants/me/menu/categories/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
    },
    async deleteMenuCategory(id: string) {
      return request<{ ok: true }>(`/v1/restaurants/me/menu/categories/${id}`, { method: "DELETE" });
    },
    async createMenuItem(input: {
      name: string;
      description?: string;
      price: number;
      categoryId?: string | null;
      available?: boolean;
      prepTimeMinutes?: number;
      sortOrder?: number;
      badge?: MenuItemBadge | null;
    }) {
      return request<{ item: MenuItem }>("/v1/restaurants/me/menu/items", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async updateMenuItem(
      id: string,
      input: Partial<{
        featured: boolean;
        name: string;
        description: string | null;
        price: number;
        categoryId: string | null;
        available: boolean;
        prepTimeMinutes: number | null;
        sortOrder: number;
        badge: MenuItemBadge | null;
      }>,
    ) {
      return request<{ item: MenuItem }>(`/v1/restaurants/me/menu/items/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
    },
    async deleteMenuItem(id: string) {
      return request<{ ok: true }>(`/v1/restaurants/me/menu/items/${id}`, { method: "DELETE" });
    },
    /** Replaces the item's full option/choice set in one call — see the
     * file doc comment in apps/api/src/restaurants/menu.ts for why. */
    async setMenuItemOptions(
      itemId: string,
      options: Array<{
        name: string;
        required?: boolean;
        multiSelect?: boolean;
        choices: Array<{ name: string; priceDelta?: number }>;
      }>,
    ) {
      return request<{ options: MenuItemOption[] }>(`/v1/restaurants/me/menu/items/${itemId}/options`, {
        method: "PUT",
        body: JSON.stringify({ options }),
      });
    },
    async uploadMenuItemPhoto(itemId: string, file: Blob) {
      const form = new FormData();
      form.append("file", file);
      const res = await f(`${root}/v1/restaurants/me/menu/items/${itemId}/photo`, {
        method: "POST",
        headers: authHeaders(),
        body: form,
      });
      return json<{ ok: true }>(res);
    },
    /** Streams a menu item's photo as a Blob (not JSON — raw fetch, mirrors uploadMenuItemPhoto). */
    async menuItemPhotoBlob(itemId: string, revision?: number): Promise<Blob> {
      const suffix = revision ? `?v=${encodeURIComponent(String(revision))}` : "";
      const res = await f(`${root}/v1/restaurants/menu-items/${itemId}/photo${suffix}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`API ${res.status}: failed to load photo`);
      return res.blob();
    },

    // Restaurant chat — customer <-> restaurant messaging, separate from the
    // order chat (customer/rider). One continuous thread per (restaurant,
    // customer) pair; a message can optionally reference a menu item.
    async getRestaurantChat(restaurantId: string) {
      return request<{ restaurantName: string; restaurantOwnerId: string; messages: RestaurantChatMessage[] }>(
        `/v1/restaurants/${restaurantId}/chat`,
      );
    },
    async sendRestaurantChat(restaurantId: string, body: string, menuItem?: { id: string; name: string }, replyToId?: string) {
      return request<{ id: string }>(`/v1/restaurants/${restaurantId}/chat`, {
        method: "POST",
        body: JSON.stringify({ body, menuItemId: menuItem?.id, menuItemName: menuItem?.name, replyToId }),
      });
    },
    /** Mirrors sendChatMedia's own "type" + "file" multipart shape, so both composers behave identically. */
    async sendRestaurantChatMedia(restaurantId: string, type: "image" | "voice", file: Blob, replyToId?: string) {
      const form = new FormData();
      form.append("type", type);
      form.append("file", file, type === "image" ? "photo.jpg" : "voice.webm");
      if (replyToId) form.append("replyToId", replyToId);
      const res = await f(`${root}/v1/restaurants/${restaurantId}/chat`, {
        method: "POST",
        headers: authHeaders(),
        body: form,
      });
      return json<{ id: string }>(res);
    },
    async markRestaurantChatRead(restaurantId: string) {
      return request<{ ok: true }>(`/v1/restaurants/${restaurantId}/chat/read`, { method: "POST" });
    },
    /** Deletes a restaurant-chat message — "me" hides it from just this
     * account's own view, "everyone" clears its content for both sides. */
    async deleteRestaurantChatMessage(messageId: string, scope: "me" | "everyone") {
      return request<{ ok: true; scope: "me" | "everyone" }>(`/v1/restaurant-chat/${messageId}/delete`, {
        method: "POST",
        body: JSON.stringify({ scope }),
      });
    },
    /** Restaurant-owner side: every customer thread, and replying to one. */
    async myRestaurantChatThreads() {
      return request<{ threads: RestaurantChatThread[] }>("/v1/restaurants/me/chat/threads");
    },
    async myRestaurantChatThread(customerId: string) {
      return request<{ customerName: string | null; messages: RestaurantChatMessage[] }>(
        `/v1/restaurants/me/chat/${customerId}`,
      );
    },
    async replyRestaurantChat(customerId: string, body: string, replyToId?: string) {
      return request<{ id: string }>(`/v1/restaurants/me/chat/${customerId}`, {
        method: "POST",
        body: JSON.stringify({ body, replyToId }),
      });
    },
    async replyRestaurantChatMedia(customerId: string, type: "image" | "voice", file: Blob, replyToId?: string) {
      const form = new FormData();
      form.append("type", type);
      form.append("file", file, type === "image" ? "photo.jpg" : "voice.webm");
      if (replyToId) form.append("replyToId", replyToId);
      const res = await f(`${root}/v1/restaurants/me/chat/${customerId}`, {
        method: "POST",
        headers: authHeaders(),
        body: form,
      });
      return json<{ id: string }>(res);
    },
    async markRestaurantChatReadAsOwner(customerId: string) {
      return request<{ ok: true }>(`/v1/restaurants/me/chat/${customerId}/read`, { method: "POST" });
    },
    async restaurantChatMediaBlob(messageId: string): Promise<Blob> {
      const res = await f(`${root}/v1/restaurant-chat/media/${messageId}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`API ${res.status}: failed to load photo`);
      return res.blob();
    },

    // Rider subscription — see apps/api/src/riders/subscription.ts.
    async myRiderSubscription() {
      return request<{ subscription: RiderSubscriptionView; payments: RiderSubscriptionPayment[] }>(
        "/v1/riders/me/subscription",
      );
    },
    async paySubscription() {
      return request<{ paymentId: string; amount: number; status: "pending"; network: string | null }>(
        "/v1/riders/me/subscription/pay",
        { method: "POST" },
      );
    },
    async refreshSubscriptionPayment(id: string) {
      return request<{ payment: RiderSubscriptionPayment }>(`/v1/riders/me/subscription/payments/${id}/refresh`);
    },

    // Rider "Pro" — a separate, optional paid tier from the subscription
    // above; see apps/api/src/riders/pro-subscription.ts.
    async myRiderProSubscription() {
      return request<{ subscription: RiderProSubscriptionView; payments: RiderProSubscriptionPayment[] }>(
        "/v1/riders/me/pro-subscription",
      );
    },
    /** `mode` is only required when the admin has both recurring and
     * one-time pricing enabled at once; omit it when just one is offered. */
    async payProSubscription(mode?: "recurring" | "once") {
      return request<{ paymentId: string; amount: number; mode: "recurring" | "once"; status: "pending"; network: string | null }>(
        "/v1/riders/me/pro-subscription/pay",
        { method: "POST", body: JSON.stringify({ mode }) },
      );
    },
    async refreshProSubscriptionPayment(id: string) {
      return request<{ payment: RiderProSubscriptionPayment }>(`/v1/riders/me/pro-subscription/payments/${id}/refresh`);
    },

    // Saved locations
    async getLocations() {
      return request<{ locations: SavedLocation[] }>("/v1/locations");
    },
    async saveLocation(input: { label: string; area?: string; address?: string; lat?: number; lng?: number }) {
      return request<{ location: SavedLocation }>("/v1/locations", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async deleteLocation(id: string) {
      return request<{ ok: true }>(`/v1/locations/${id}`, { method: "DELETE" });
    },

    // Google AI Studio keys (admin) — see apps/api/src/speech/ai-keys.ts.
    async adminAiKeys(pool?: string) {
      return request<AiKeysOverview>(`/v1/admin/ai-keys${pool && pool !== "shared" ? `?pool=${encodeURIComponent(pool)}` : ""}`);
    },
    async adminAddAiKeys(keys: Array<{ label?: string; key: string; projectTag?: string }>, pool?: string) {
      return request<AiKeysOverview & { results: AiKeyAddResult[] }>("/v1/admin/ai-keys", { method: "POST", body: JSON.stringify({ keys, ...(pool && pool !== "shared" ? { pool } : {}) }) });
    },
    /** `assignTo` moves the key to a pool: "shared" or an AI feature id. `pool` is the pool the page is showing, so the reply matches it. */
    async adminUpdateAiKey(id: string, input: { enabled?: boolean; label?: string; projectTag?: string | null; assignTo?: string }, pool?: string) {
      return request<AiKeysOverview>(`/v1/admin/ai-keys/${id}${pool && pool !== "shared" ? `?pool=${encodeURIComponent(pool)}` : ""}`, { method: "PATCH", body: JSON.stringify(input) });
    },
    async adminResetAiKey(id: string) {
      return request<AiKeysOverview>(`/v1/admin/ai-keys/${id}/reset`, { method: "POST" });
    },
    async adminTestAiKey(id: string) {
      return request<AiKeysOverview & { result: { ok: boolean; detail: string } }>(`/v1/admin/ai-keys/${id}/test`, { method: "POST" });
    },
    /** Pick a master key; with null, clears the master of `pool` ("shared" or an AI feature id). */
    async adminSetMasterAiKey(id: string | null, pool?: string) {
      return request<AiKeysOverview>(`/v1/admin/ai-keys/${id ?? (pool && pool !== "shared" ? pool : "none")}/master`, { method: id ? "PUT" : "DELETE" });
    },
    async adminDeleteAiKey(id: string) {
      return request<AiKeysOverview>(`/v1/admin/ai-keys/${id}`, { method: "DELETE" });
    },
    async adminSetAiKeyMode(mode: AiKeyMode, pool?: string) {
      return request<AiKeysOverview>(`/v1/admin/ai-keys-mode${pool && pool !== "shared" ? `?pool=${encodeURIComponent(pool)}` : ""}`, { method: "PUT", body: JSON.stringify({ mode }) });
    },
    async adminSetAiKeyRotation(rotationSeconds: number, pool?: string) {
      return request<AiKeysOverview>(`/v1/admin/ai-keys-rotation${pool && pool !== "shared" ? `?pool=${encodeURIComponent(pool)}` : ""}`, { method: "PUT", body: JSON.stringify({ rotationSeconds }) });
    },
    async adminEmailKeys() {
      return request<EmailKeysOverview>("/v1/admin/email-keys");
    },
    async adminAddEmailKeys(keys: Array<{ label: string; key: string; accountTag: string; fromAddress: string }>) {
      return request<EmailKeysOverview & { results: Array<{ label: string; status: "added" | "duplicate" }> }>("/v1/admin/email-keys", { method: "POST", body: JSON.stringify({ keys }) });
    },
    async adminSetEmailKeySettings(settings: EmailKeySettings) {
      return request<EmailKeysOverview>("/v1/admin/email-keys/settings", { method: "PUT", body: JSON.stringify(settings) });
    },
    async adminSetLiveEmailKey(id: string) {
      return request<EmailKeysOverview>(`/v1/admin/email-keys/${id}/live`, { method: "PUT" });
    },
    async adminEnableEmailKey(id: string, enabled: boolean) {
      return request<EmailKeysOverview>(`/v1/admin/email-keys/${id}`, { method: "PATCH", body: JSON.stringify({ enabled }) });
    },
    async adminDeleteEmailKey(id: string) {
      return request<EmailKeysOverview>(`/v1/admin/email-keys/${id}`, { method: "DELETE" });
    },

    // People a customer books rides for — see apps/api/src/passengers/routes.ts.
    async getPassengers() {
      return request<{ passengers: SavedPassenger[]; enabled: boolean }>("/v1/passengers");
    },
    async savePassenger(input: RidePassenger) {
      return request<{ passenger: SavedPassenger }>("/v1/passengers", { method: "POST", body: JSON.stringify(input) });
    },
    async deletePassenger(id: string) {
      return request<{ ok: true }>(`/v1/passengers/${id}`, { method: "DELETE" });
    },
    /** The passenger's trip link — public, the token is the secret. */
    async getSharedTrip(token: string) {
      return request<{ trip: SharedTrip }>(`/v1/trips/${encodeURIComponent(token)}`);
    },

    // Saved mobile money numbers — up to 2 per purpose (see
    // apps/api/src/account/mobile-numbers.ts).
    async getMobileNumbers(purpose: MobileNumberPurpose) {
      return request<{ numbers: SavedMobileNumber[] }>(`/v1/mobile-numbers?purpose=${purpose}`);
    },
    async addMobileNumber(input: { purpose: MobileNumberPurpose; phone: string; label?: string; isPrimary?: boolean }) {
      return request<{ number: SavedMobileNumber }>("/v1/mobile-numbers", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async updateMobileNumber(id: string, input: Partial<{ phone: string; label: string | null; isPrimary: boolean }>) {
      return request<{ number: SavedMobileNumber }>(`/v1/mobile-numbers/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
    },
    async deleteMobileNumber(id: string) {
      return request<{ ok: true }>(`/v1/mobile-numbers/${id}`, { method: "DELETE" });
    },

    // Voice calls — see apps/api/src/calls/routes.ts. Provider-agnostic at
    // this layer; the client picks Cloudflare-specific negotiation calls
    // only once it sees call.provider === "cloudflare".
    async startCall(input: { calleeId: string; orderId?: string; restaurantId?: string }) {
      return request<{ call: Call }>("/v1/calls", { method: "POST", body: JSON.stringify(input) });
    },
    async getIncomingCall() {
      return request<{ call: IncomingCall | null }>("/v1/calls/incoming");
    },
    async getCall(id: string) {
      return request<{ call: Call }>(`/v1/calls/${id}`);
    },
    async acceptCall(id: string) {
      return request<{ call: Call }>(`/v1/calls/${id}/accept`, { method: "POST" });
    },
    async endCall(id: string, reason: "declined" | "missed" | "ended") {
      return request<{ call: Call }>(`/v1/calls/${id}/end`, { method: "POST", body: JSON.stringify({ reason }) });
    },
    async publishCallSession(id: string, offer: SdpDescription) {
      return request<{ sessionId: string; answer: SdpDescription }>(`/v1/calls/${id}/publish`, {
        method: "POST",
        body: JSON.stringify({ sdp: offer.sdp }),
      });
    },
    async pullRemoteCallTrack(id: string) {
      return request<{ requiresRenegotiation: boolean; offer?: SdpDescription }>(`/v1/calls/${id}/pull-remote`, {
        method: "POST",
      });
    },
    async renegotiateCall(id: string, answer: SdpDescription) {
      return request<{ ok: true }>(`/v1/calls/${id}/renegotiate`, { method: "POST", body: JSON.stringify({ sdp: answer.sdp }) });
    },

    // "webrtc_p2p" — direct browser-to-browser, no media relay. Free STUN
    // (+ optional admin-configured TURN) for NAT traversal; offer/answer
    // exchange is just two SDP blobs on the call row (see
    // apps/api/src/calls/routes.ts).
    async getCallIceServers() {
      return request<{ iceServers: IceServer[] }>("/v1/calls/ice-servers");
    },
    async postCallOffer(id: string, offer: SdpDescription) {
      return request<{ ok: true }>(`/v1/calls/${id}/offer`, { method: "POST", body: JSON.stringify({ sdp: offer.sdp }) });
    },
    async postCallAnswer(id: string, answer: SdpDescription) {
      return request<{ ok: true }>(`/v1/calls/${id}/answer`, { method: "POST", body: JSON.stringify({ sdp: answer.sdp }) });
    },

    // Admin — calls provider toggle + credentials (mirrors the payments
    // provider/credentials endpoints just above).
    async adminGetCallsSettings() {
      return request<CallsAdminSettings>("/v1/admin/calls-settings");
    },
    async adminSetCallsProvider(provider: CallProviderIdentity) {
      return request<{ activeProvider: CallProviderIdentity }>("/v1/admin/calls-settings", {
        method: "PUT",
        body: JSON.stringify({ provider }),
      });
    },
    async adminSaveCallCredentials(provider: Exclude<CallProviderIdentity, "mock">, fields: Record<string, string>) {
      return request<{ changed: string[] }>(`/v1/admin/calls/credentials/${provider}`, {
        method: "PUT",
        body: JSON.stringify({ fields }),
      });
    },
    async adminClearCallCredential(provider: Exclude<CallProviderIdentity, "mock">, field: string) {
      return request<{ ok: true }>(`/v1/admin/calls/credentials/${provider}/${field}`, { method: "DELETE" });
    },

    // Admin — maps provider toggle + credentials (mirrors the calls
    // provider/credentials endpoints just above).
    async adminGetMapsSettings() {
      return request<MapsAdminSettings>("/v1/admin/maps-settings");
    },
    async adminSetMapsProvider(provider: MapsProviderIdentity) {
      return request<{ activeProvider: MapsProviderIdentity }>("/v1/admin/maps-settings", {
        method: "PUT",
        body: JSON.stringify({ provider }),
      });
    },
    async adminSetJawgLightStyle(style: JawgLightStyle) {
      return request<{ jawgLightStyle: JawgLightStyle }>("/v1/admin/maps/jawg-style", {
        method: "PUT",
        body: JSON.stringify({ style }),
      });
    },
    async adminSaveMapsCredentials(provider: Exclude<MapsProviderIdentity, "streetmaps">, fields: Record<string, string>) {
      return request<{ changed: string[] }>(`/v1/admin/maps/credentials/${provider}`, {
        method: "PUT",
        body: JSON.stringify({ fields }),
      });
    },
    async adminClearMapsCredential(provider: Exclude<MapsProviderIdentity, "streetmaps">, field: string) {
      return request<{ ok: true }>(`/v1/admin/maps/credentials/${provider}/${field}`, { method: "DELETE" });
    },
    async adminSetNavMode(mode: NavMode) {
      return request<{ navMode: NavMode }>("/v1/admin/nav-mode", {
        method: "PUT",
        body: JSON.stringify({ mode }),
      });
    },

    // Customer wallet — closed-loop store credit (top up, spend, no cash-out).
    async getWallet() {
      return request<CustomerWallet>("/v1/wallet");
    },
    async topUpWallet(input: { amount: number; msisdn?: string; method?: "mobile_money" | "card"; card?: CardInput }) {
      return request<{ topupId: string; status: "pending"; network: string | null; redirectUrl?: string; nextAction?: PaymentNextAction }>(
        "/v1/wallet/topup",
        { method: "POST", body: JSON.stringify(input) },
      );
    },
    /** Whether card entry is Peebee's own form or Flutterwave's hosted page, and whether mobile money is prompted in-app. */
    async getPaymentOptions() {
      return request<PaymentOptions>("/v1/payments/options");
    },
    /** Next step of a direct card payment: the PIN or billing address, or the one-time code. `id` is the payment or top-up id. */
    async continueCardPayment(id: string, input: CardContinueInput) {
      return request<{ status: string; redirectUrl?: string | null; nextAction?: PaymentNextAction | null }>(
        `/v1/payments/${id}/card/continue`,
        { method: "POST", body: JSON.stringify(input) },
      );
    },
    async refreshTopup(id: string) {
      return request<{ topup: WalletTopup }>(`/v1/wallet/topups/${id}/refresh`);
    },
    /** Sends money straight into another customer's wallet by phone/email. */
    async transferWallet(input: { recipient: string; amount: number; note?: string }) {
      return request<{ balance: number; recipientName: string }>("/v1/wallet/transfer", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    /** Invites another customer to spend from this wallet on their own
     * orders. `walletId` omitted (or "primary") shares the original wallet. */
    async shareWallet(input: { recipient: string; walletId?: string }) {
      return request<{ id: string; granteeName: string; status: "pending" }>("/v1/wallet/shares", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async getWalletShares() {
      return request<WalletShares>("/v1/wallet/shares");
    },
    async acceptWalletShare(id: string) {
      return request<{ status: "active" }>(`/v1/wallet/shares/${id}/accept`, { method: "POST" });
    },
    async declineWalletShare(id: string) {
      return request<{ status: "declined" }>(`/v1/wallet/shares/${id}/decline`, { method: "POST" });
    },
    /** Owner revoking a grant, or a grantee giving up one extended to them. */
    async revokeWalletShare(id: string) {
      return request<{ status: "revoked" }>(`/v1/wallet/shares/${id}/revoke`, { method: "POST" });
    },

    // Multiple named wallets — up to 5 total including the primary/
    // original one. See apps/api/src/wallet/wallets.ts.
    async getWallets() {
      return request<CustomerWalletsResponse>("/v1/wallets");
    },
    async createWallet(name: string) {
      return request<{ wallet: CustomerWalletSummary }>("/v1/wallets", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
    },
    async renameWallet(id: string, name: string) {
      return request<{ ok: true }>(`/v1/wallets/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
    },
    async deleteWallet(id: string) {
      return request<{ ok: true }>(`/v1/wallets/${id}`, { method: "DELETE" });
    },
    /** Moves funds between two of your own wallets — "primary" refers to
     * the original wallet on either side. */
    async transferBetweenWallets(input: { fromWalletId: string; toWalletId: string; amount: number }) {
      return request<{ fromBalance: number; toBalance: number }>("/v1/wallets/transfer", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async getWalletLedger(walletId: string) {
      return request<{ ledger: WalletLedgerEntry[] }>(`/v1/wallets/${walletId}/ledger`);
    },
    async getWalletReport(walletId: string, period: "week" | "month" | "all" = "month") {
      return request<WalletUsageReport>(`/v1/wallets/${walletId}/report?period=${period}`);
    },
    /** Admin: refunds an order's collected payment back to the customer's wallet. */
    async adminRefundToWallet(orderId: string) {
      return request<{ ok: true; refunded: number }>(`/v1/admin/orders/${orderId}/refund-to-wallet`, { method: "POST" });
    },

    // Delivery pricing settings (rate per km, service range) — public read, admin write.
    async getSettings() {
      const res = await request<{ settings: DeliverySettings }>("/v1/settings");
      const available = res.settings.modules?.available;
      rememberModuleAvailability(available);
      if (rawSettings || !available) return res;
      return { settings: applyModuleAvailability(res.settings, available, isPracticeStorageOn() ? "practice" : "live") };
    },
    /** Is the shared practice world on offer, and is it laid down yet? */
    async practiceWorld() {
      return request<{ available: boolean; seeded: boolean }>("/v1/practice/world");
    },
    /** Signs in as the demo persona for this app. The returned token makes every following request run as the sandbox. */
    async startPracticeSession(role: ServerRole) {
      return request<PracticeSessionResult>("/v1/practice/session", { method: "POST", body: JSON.stringify({ role }) });
    },
    async adminPracticeWorld() {
      return request<PracticeWorldStatus>("/v1/admin/practice");
    },
    async adminSeedPractice() {
      return request<PracticeWorldStatus>("/v1/admin/practice/seed", { method: "POST" });
    },
    async adminResetPractice() {
      return request<PracticeWorldStatus>("/v1/admin/practice/reset", { method: "POST" });
    },
    async adminPracticeOrders() {
      return request<{ placed: number }>("/v1/admin/practice/orders", { method: "POST" });
    },
    /** Admin: change Live and/or Practice switches for any modules. */
    async adminUpdateModules(input: ModuleSettingsUpdate & { practiceModeEnabled?: boolean; practiceSharedWorld?: boolean }) {
      return request<{ modules: ModuleSettings; practiceModeEnabled: boolean; practiceSharedWorld: boolean }>("/v1/admin/modules", { method: "PUT", body: JSON.stringify(input) });
    },
    /** Admin: over-the-air updates for the mobile apps (which version phones get, on/off). */
    async adminGetAppUpdates() {
      return request<AppUpdatesSettings>("/v1/admin/app-updates");
    },
    async adminUpdateAppUpdates(input: AppUpdatesUpdate) {
      return request<AppUpdatesSettings>("/v1/admin/app-updates", { method: "PUT", body: JSON.stringify(input) });
    },
    async adminGetModules() {
      return request<{ modules: ModuleSettings; practiceModeEnabled: boolean; practiceSharedWorld: boolean }>("/v1/admin/modules");
    },
    async getPracticeStatus(experience: PracticeRole) {
      return request<{ practice: { experience: PracticeRole; available: boolean; completed: boolean; optedOut: boolean; lastPromptedAt: string | null; shouldPrompt: boolean; reminderDays: number } }>(`/v1/practice/${experience}/status`);
    },
    async markPracticePrompted(experience: PracticeRole) {
      return request<{ ok: true }>(`/v1/practice/${experience}/prompted`, { method: "POST" });
    },
    async completePractice(experience: PracticeRole) {
      return request<{ ok: true }>(`/v1/practice/${experience}/completed`, { method: "POST" });
    },
    async dismissPracticeReminder(experience: PracticeRole) {
      return request<{ ok: true }>(`/v1/practice/${experience}/dismiss`, { method: "POST" });
    },
    async adminUpdateSettings(input: Partial<DeliverySettings>) {
      return request<{ settings: DeliverySettings }>("/v1/admin/settings", {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },
    /** The whole-platform live/sandbox switch — its own endpoint, its own
     * activity log entry, separate from the general settings save. See
     * apps/api/src/settings/routes.ts. */
    async adminSetPlatformEnvironment(environment: PlatformEnvironment) {
      return request<{ platformEnvironment: PlatformEnvironment }>("/v1/admin/platform-environment", {
        method: "PUT",
        body: JSON.stringify({ environment }),
      });
    },

    // Marketplace & Live Commerce Admin Settings
    async adminGetMarketplaceSettings() {
      return request<{ marketplace: MarketplaceSettings }>("/v1/admin/marketplace-settings");
    },
    async adminUpdateMarketplaceSettings(marketplace: Partial<MarketplaceSettings>) {
      return request<{ marketplace: MarketplaceSettings }>("/v1/admin/marketplace-settings", {
        method: "PATCH",
        body: JSON.stringify(marketplace),
      });
    },

    // Guest checkout (admin switches, and the guest-facing endpoints that need no sign-in)
    async adminGetGuestSettings() {
      return request<{ guest: GuestSettings }>("/v1/admin/guest-settings");
    },
    async adminUpdateGuestSettings(guest: Partial<GuestSettings>) {
      return request<{ guest: GuestSettings }>("/v1/admin/guest-settings", { method: "PATCH", body: JSON.stringify(guest) });
    },
    async getGuestConfig() {
      return request<GuestConfig>("/v1/guest/config");
    },
    async guestCheckout(input: GuestCheckoutInput) {
      return request<GuestCheckoutResult>("/v1/guest/checkout", { method: "POST", body: JSON.stringify(input) });
    },
    async guestTrack(code: string) {
      return request<GuestTrack>(`/v1/guest/track/${encodeURIComponent(code)}`);
    },
    async guestCreateAccount(code: string, phone: string, password: string) {
      return request<{ token: string; user: AuthUser }>(`/v1/guest/track/${encodeURIComponent(code)}/account`, { method: "POST", body: JSON.stringify({ phone, password }) });
    },

    // Marketplace Customer Endpoints
    async getMarketplaceStores(category?: string, lat?: number | null, lng?: number | null) {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (lat != null && !isNaN(lat)) params.set("lat", String(lat));
      if (lng != null && !isNaN(lng)) params.set("lng", String(lng));
      const q = params.toString() ? `?${params.toString()}` : "";
      return request<{ stores: any[] }>(`/v1/marketplace/stores${q}`);
    },
    async getMarketplaceStore(id: string, lat?: number | null, lng?: number | null) {
      const params = new URLSearchParams();
      if (lat != null && !isNaN(lat)) params.set("lat", String(lat));
      if (lng != null && !isNaN(lng)) params.set("lng", String(lng));
      const q = params.toString() ? `?${params.toString()}` : "";
      return request<{
        store: any;
        collections?: StoreCollection[];
        discounts?: StoreDiscount[];
        outlets?: Array<{ id: string; name: string; code: string; address: string | null; lat?: number | null; lng?: number | null; status: string }>;
        channels?: {
          customerAppUrl: string;
          dedicatedStorefrontUrl: string;
          customDomainUrl: string | null;
        };
      }>(`/v1/marketplace/stores/${encodeURIComponent(id)}${q}`);
    },
    async submitStoreB2bInquiry(
      storeIdOrSlug: string,
      input: {
        customer_name: string;
        customer_phone: string;
        customer_company?: string;
        payment_terms?: "immediate" | "net_7" | "net_14" | "net_30";
        notes?: string;
        items: StoreDraftOrderItem[];
      },
    ) {
      return request<{ ok: true; id: string; total: number }>(`/v1/marketplace/stores/${encodeURIComponent(storeIdOrSlug)}/b2b-inquiry`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async getMarketplaceStoreProducts(id: string) {
      return request<{ products: any[] }>(`/v1/marketplace/stores/${encodeURIComponent(id)}/products`);
    },
    async getMarketplaceProduct(id: string) {
      return request<{ product: any; store?: any }>(`/v1/marketplace/products/${id}`);
    },
    async getMarketplaceLiveChannels() {
      return request<{ liveChannels: any[] }>("/v1/marketplace/live");
    },
    async getMarketplaceSpotlight(category?: string) {
      const q = category ? `?category=${category}` : "";
      return request<{ spotlight: any[] }>(`/v1/marketplace/spotlight${q}`);
    },
    async checkoutMarketplace(input: {
      items: Array<{
        productId: string;
        storeId: string;
        title: string;
        price: number;
        quantity: number;
        variantId?: string;
        variantTitle?: string;
        imageUrl?: string;
      }>;
      paymentRail?: "escrow" | "float";
      paymentMethod?: "momo" | "airtel" | "wallet" | "cod";
      destinationAddress?: string;
      destinationArea?: string;
      destinationLat?: number;
      destinationLng?: number;
      relayLastMile?: "door" | "collect" | "meet";
      relayMeetStageId?: string;
      /** A long trip: by matatu relay (default when offered) or one rider all the way. */
      deliveryMode?: "rider" | "relay";
      promoCode?: string;
      salesChannel?: "customer_app" | "dedicated_storefront";
    }) {
      return request<{ ok: boolean; orders: OrderRow[]; order: OrderRow }>("/v1/marketplace/checkout", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    /** The exact delivery fee for a bag: one rider trip through every store, split by store. */
    async quoteMarketplaceCheckout(input: {
      items: Array<{ productId: string; storeId: string; title: string; price: number; quantity: number; variantId?: string; variantTitle?: string }>;
      destinationLat?: number;
      destinationLng?: number;
      relayLastMile?: "door" | "collect" | "meet";
      relayMeetStageId?: string;
      deliveryMode?: "rider" | "relay";
      promoCode?: string;
      salesChannel?: "customer_app" | "dedicated_storefront";
    }) {
      return request<{
        itemsTotal: number;
        rawItemsTotal?: number;
        discountAmount?: number;
        appliedDiscount?: {
          id: string;
          storeId: string;
          code: string;
          title: string;
          kind: "percent" | "fixed" | "free_delivery" | "bogo";
          discountAmount: number;
          freeDelivery: boolean;
        } | null;
        loyaltyCashbackUgx?: number;
        deliveryFee: number;
        total: number;
        /** How this quote delivers; when a relay is offered the customer chooses (relay by default). */
        deliveryMode?: "rider" | "relay";
        /** The delivery fee each way, so both choices show their price. */
        options?: { rider: number; relay: number | null };
        /** "Direct" (one rider all the way) is promised in under this many hours (admin setting). */
        directMaxHours?: number;
        stores: Array<{ storeId: string; storeName: string; itemsTotal: number; deliveryFee: number }>;
        /** One rider's whole trip along the road; null without a delivery location. */
        trip?: BagTrip | null;
        /** A long trip by matatu relay: the rider collects from every store first. */
        relay?: {
          routeName: string; direction?: string; routeCode?: string; dropMode: "stage" | "station"; station: string | null; lastMile: "door" | "collect" | "pending";
          doorTotal: number; collectTotal: number | null; choiceAtOrder: boolean;
          meetStages?: Array<{ id: string; name: string; distanceKm: number; isStation: boolean }>;
          meetStage?: string | null;
          legs: Array<{ leg: number; kind: "boda" | "matatu"; fromName: string; toName: string; distanceKm?: number; fee: number }>;
        } | null;
      }>("/v1/marketplace/checkout/quote", { method: "POST", body: JSON.stringify(input) });
    },

    // Pharmacy & Prescription Endpoints
    /** The pharmacy the signed-in user works for (403 `not_a_pharmacist` when none). */
    async pharmacyMe() {
      return request<{
        pharmacist: { id: string; name: string; role: string };
        pharmacy: { id: string; name: string; address: string; phone: string; licenceNumber: string };
        pharmacies: { id: string; name: string }[];
      }>("/v1/pharmacy/me");
    },
    async getPharmacies() {
      return request<{ pharmacies: { id: string; name: string; address: string | null; phone: string | null }[] }>("/v1/pharmacy/pharmacies");
    },
    /** Uploads a photo of the doctor's slip to private storage; pass the returned key to submitPrescription. */
    async uploadPrescriptionPhoto(file: Blob) {
      const form = new FormData();
      form.append("file", file, "prescription.jpg");
      const res = await f(`${root}/v1/pharmacy/uploads`, { method: "POST", headers: authHeaders(), body: form });
      return json<{ key: string }>(res);
    },
    /** Uploads a lesson's video or audio. The file is sent as the request body so it streams straight to storage. */
    async studioUploadLessonMedia(lessonId: string, file: Blob) {
      const res = await f(`${root}/v1/education/studio/lessons/${encodeURIComponent(lessonId)}/media`, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      return json<{ ok: true; media: { contentType: string; sizeBytes: number } }>(res);
    },
    /** Where the picture for a school, course, lesson or stream is served. Public; drawn from the title unless the educator set a cover. */
    learnArtUrl(kind: "school" | "course" | "lesson" | "stream", id: string) {
      return `${root}/v1/education/art/${kind}/${encodeURIComponent(id)}`;
    },
    /** Sets the cover picture of a course or school (JPEG, PNG or WebP). */
    async studioSetCover(kind: "course" | "school", id: string, file: Blob) {
      const res = await f(`${root}/v1/education/studio/${kind}s/${encodeURIComponent(id)}/cover`, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      return json<{ ok: true }>(res);
    },
    /** Removes an uploaded cover, so the drawn picture shows again. */
    async studioRemoveCover(kind: "course" | "school", id: string) {
      const res = await f(`${root}/v1/education/studio/${kind}s/${encodeURIComponent(id)}/cover`, { method: "DELETE", headers: authHeaders() });
      return json<{ ok: true }>(res);
    },
    async submitPrescription(input: {
      pharmacyId: string;
      prescriptionImageKey: string;
      patientNotes?: string;
      patientAge?: number;
      patientGender?: "female" | "male" | "other";
      deliveryAddress?: string;
    }) {
      return request<{ ok: boolean; prescription: PharmacyPrescription }>("/v1/pharmacy/prescriptions", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async getCustomerPrescriptions() {
      return request<{ prescriptions: PharmacyPrescription[] }>("/v1/pharmacy/prescriptions");
    },
    async cancelPrescription(id: string) {
      return request<{ ok: boolean }>(`/v1/pharmacy/prescriptions/${encodeURIComponent(id)}/cancel`, { method: "POST", body: JSON.stringify({}) });
    },
    /** The slip photo as a Blob. It needs the sign-in header, so it can't be a plain <img src>. */
    async prescriptionImageBlob(id: string): Promise<Blob> {
      const res = await f(`${root}/v1/pharmacy/prescriptions/${encodeURIComponent(id)}/image`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`API ${res.status}: failed to load the prescription photo`);
      return res.blob();
    },
    async getPharmacistPrescriptions(status?: string) {
      const q = status ? `?status=${encodeURIComponent(status)}` : "";
      return request<{ prescriptions: PharmacyPrescription[] }>(`/v1/pharmacy/pharmacist/prescriptions${q}`);
    },
    async updatePrescriptionReview(id: string, input: {
      status: "priced_ready" | "declined" | "dispensed";
      pharmacistNotes?: string;
      dosageInstructions?: string;
      quotedItems?: PharmacyQuoteItem[];
    }) {
      return request<{ ok: boolean; prescription: PharmacyPrescription }>(`/v1/pharmacy/pharmacist/prescriptions/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
    },

    // Merchant Pro Store Endpoints
    async getMerchantProStore() {
      return request<{ store: any; settings?: MarketplaceSettings; canCreate?: boolean; trialDays?: number; pricing?: any }>("/v1/merchants/me/store");
    },
    async createMerchantProStore(input: {
      name: string;
      category: "groceries" | "stores";
      sub_category?: string;
      description?: string;
      announcement?: string;
      phone?: string;
      whatsapp_number?: string;
      address?: string;
      min_order_amount?: number;
    }) {
      return request<{ store: any; trialActive: boolean }>("/v1/merchants/me/store", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async verifyMerchantStoreDomain() {
      return request<{
        verified: boolean;
        domain: string;
        record: { type: "TXT"; name: string; value: string };
        message: string;
      }>("/v1/merchants/me/store/domain/verify", { method: "POST", body: JSON.stringify({}) });
    },
    async updateMerchantProStore(input: any) {
      return request<{ store: any }>("/v1/merchants/me/store", {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },
    async getMerchantProProducts() {
      return request<{ products: any[] }>("/v1/merchants/me/products");
    },
    async createMerchantProProduct(input: any) {
      return request<{ ok: boolean; productId: string }>("/v1/merchants/me/products", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async triggerMerchantProStarterPack() {
      return request<{ ok: boolean; addedCount: number }>("/v1/merchants/me/products/starter-pack", {
        method: "POST",
      });
    },
    async startMerchantProLive(input?: { title?: string; streamUrl?: string; isRestream?: boolean }) {
      return request<{ ok: boolean; sessionId: string }>("/v1/merchants/me/store/live/start", {
        method: "POST",
        body: JSON.stringify(input || {}),
      });
    },
    async endMerchantProLive() {
      return request<{ ok: boolean }>("/v1/merchants/me/store/live/end", {
        method: "POST",
      });
    },
    async upgradeMerchantStoreTier(input: { tier: "pro_store" | "pro_live" | "elite"; billingCycle?: "monthly" | "yearly" }) {
      return request<{ ok: boolean; tier: string; expiresAt: string; amountPaid: number; store: any }>("/v1/merchants/me/store/tier", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async getMerchantCollections() {
      return request<{ collections: StoreCollection[] }>("/v1/merchants/me/collections");
    },
    async createMerchantCollection(input: {
      title: string;
      description?: string;
      kind?: "manual" | "smart";
      rule_field?: "category" | "price_lte" | "price_gte" | "badge" | "in_stock" | null;
      rule_value?: string | null;
      pinned?: boolean;
    }) {
      return request<{ ok: boolean; id: string }>("/v1/merchants/me/collections", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async deleteMerchantCollection(id: string) {
      return request<{ ok: boolean }>(`/v1/merchants/me/collections/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    },
    async getMerchantDiscounts() {
      return request<{ discounts: StoreDiscount[] }>("/v1/merchants/me/discounts");
    },
    async createMerchantDiscount(input: {
      code: string;
      title: string;
      kind: "percent" | "fixed" | "free_delivery" | "bogo";
      value?: number;
      min_order_amount?: number;
      max_uses?: number | null;
      is_automatic?: boolean;
      is_public?: boolean;
      expires_at?: string | null;
    }) {
      return request<{ ok: boolean; id: string }>("/v1/merchants/me/discounts", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async deleteMerchantDiscount(id: string) {
      return request<{ ok: boolean }>(`/v1/merchants/me/discounts/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    },
    async getMerchantOutletInventory() {
      return request<{ outlets: Array<{ id: string; name: string; code: string; address: string | null; status: string }>; inventory: StoreOutletInventoryRow[] }>("/v1/merchants/me/outlet-inventory");
    },
    async updateMerchantOutletInventory(input: {
      productId: string;
      outletId: string;
      quantity: number;
      lowStockThreshold?: number;
    }) {
      return request<{ ok: boolean; totalQuantity: number }>("/v1/merchants/me/outlet-inventory", {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },
    async getMerchantDraftOrders() {
      return request<{ draftOrders: StoreDraftOrder[] }>("/v1/merchants/me/draft-orders");
    },
    async createMerchantDraftOrder(input: {
      customer_name: string;
      customer_phone?: string;
      customer_company?: string;
      items: StoreDraftOrderItem[];
      discount_amount?: number;
      payment_terms?: "immediate" | "net_7" | "net_14" | "net_30";
      notes?: string;
    }) {
      return request<{ ok: boolean; id: string; total: number }>("/v1/merchants/me/draft-orders", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async getMerchantEliteAnalytics() {
      return request<{ analytics: StoreEliteAnalytics }>("/v1/merchants/me/elite-analytics");
    },
    async getMerchantPosSales() {
      return request<{ sales: StorePosSale[] }>("/v1/merchants/me/pos-sales");
    },
    async createMerchantPosSale(input: {
      requestId?: string;
      outlet_id?: string | null;
      customer_phone?: string;
      customer_name?: string;
      items: StorePosSaleItem[];
      discount_amount?: number;
      redeem_loyalty_ugx?: number;
      payment_method: "peebee_code" | "momo" | "cash";
    }) {
      return request<{
        ok: boolean;
        saleId: string;
        receiptCode: string;
        total: number;
        loyaltyRedeemedUgx: number;
        loyaltyEarnedUgx: number;
        loyaltyBalanceAfterUgx: number;
      }>("/v1/merchants/me/pos-sales", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async getMerchantStockTransfers() {
      return request<{ transfers: StoreStockTransfer[] }>("/v1/merchants/me/stock-transfers");
    },
    async createMerchantStockTransfer(input: {
      requestId?: string;
      productId: string;
      fromOutletId: string;
      toOutletId: string;
      quantity: number;
      note?: string;
    }) {
      return request<{
        ok: boolean;
        transferId: string;
        fromQuantityAfter: number;
        toQuantityAfter: number;
      }>("/v1/merchants/me/stock-transfers", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async getMerchantCrmCustomers() {
      return request<{
        customers: StoreCustomerLoyalty[];
        summary: {
          totalCustomers: number;
          vipCount: number;
          repeatCount: number;
          b2bCount: number;
          totalLoyaltyBalanceUgx: number;
        };
      }>("/v1/merchants/me/crm-customers");
    },
    async getMerchantSuppliers() {
      return request<{ suppliers: StoreSupplier[] }>("/v1/merchants/me/suppliers");
    },
    async createMerchantSupplier(input: {
      name: string;
      contact_person?: string;
      phone?: string;
      email?: string;
      address?: string;
    }) {
      return request<{ ok: boolean; id: string }>("/v1/merchants/me/suppliers", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async getMerchantPurchaseOrders() {
      return request<{ purchaseOrders: StorePurchaseOrder[] }>("/v1/merchants/me/purchase-orders");
    },
    async createMerchantPurchaseOrder(input: {
      supplier_id?: string | null;
      outlet_id?: string | null;
      items: StorePurchaseOrderItem[];
      notes?: string;
    }) {
      return request<{ ok: boolean; id: string; poNumber: string; totalCost: number }>("/v1/merchants/me/purchase-orders", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async receiveMerchantPurchaseOrder(id: string, outlet_id?: string | null) {
      return request<{ ok: boolean; poId: string; status: "received"; itemsReceivedCount: number }>(
        `/v1/merchants/me/purchase-orders/${encodeURIComponent(id)}/receive`,
        {
          method: "POST",
          body: JSON.stringify({ outlet_id }),
        }
      );
    },
    async getMerchantBundles() {
      return request<{ bundles: StoreBundle[] }>("/v1/merchants/me/bundles");
    },
    async createMerchantBundle(input: {
      title: string;
      description?: string;
      price: number;
      compare_at_price?: number;
      items: StoreBundleItem[];
    }) {
      return request<{ ok: boolean; id: string }>("/v1/merchants/me/bundles", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async deleteMerchantBundle(id: string) {
      return request<{ ok: boolean }>(`/v1/merchants/me/bundles/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    },
    async getMerchantWinbackCampaigns() {
      return request<{
        campaigns: StoreWinbackCampaign[];
        inactiveCustomers: StoreCustomerLoyalty[];
      }>("/v1/merchants/me/winback-campaigns");
    },
    async sendMerchantWinbackCampaign(input: {
      customer_phone: string;
      customer_name?: string;
      discount_code?: string;
      channel?: "whatsapp" | "sms" | "push";
      message: string;
    }) {
      return request<{ ok: boolean; campaignId: string; whatsappUrl: string }>("/v1/merchants/me/winback-campaigns", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async getMerchantStorefrontSections() {
      return request<{ sections: StorefrontSection[] }>("/v1/merchants/me/storefront-sections");
    },
    async updateMerchantStorefrontSections(sections: StorefrontSection[]) {
      return request<{ ok: boolean; sections: StorefrontSection[] }>("/v1/merchants/me/storefront-sections", {
        method: "PUT",
        body: JSON.stringify({ sections }),
      });
    },
    async getMerchantSmsLogs() {
      return request<{ logs: StoreSmsLog[] }>("/v1/merchants/me/sms-logs");
    },
    async sendMerchantSms(input: {
      recipient_phone: string;
      recipient_name?: string;
      message_type: "pos_receipt" | "order_confirmation" | "dispatch_alert" | "abandoned_cart";
      body: string;
    }) {
      return request<{ ok: boolean; logId: string; status: "delivered" | "simulated" | "failed"; costUgx: number; whatsappShareUrl?: string }>("/v1/merchants/me/send-sms", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    // Tier 3: Dynamic Digital Products Management
    async getMerchantDigitalProducts() {
      return request<{ products: StoreDigitalProduct[] }>("/v1/merchants/me/digital-products");
    },
    async createMerchantDigitalProduct(input: Partial<StoreDigitalProduct>) {
      return request<{ ok: boolean; product: StoreDigitalProduct }>("/v1/merchants/me/digital-products", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async deleteMerchantDigitalProduct(id: string) {
      return request<{ ok: boolean }>(`/v1/merchants/me/digital-products/${id}`, {
        method: "DELETE",
      });
    },
    async getMerchantDigitalFulfillments() {
      return request<{ fulfillments: StoreDigitalFulfillment[] }>("/v1/merchants/me/digital-fulfillments");
    },
    async revokeMerchantDigitalFulfillment(id: string) {
      return request<{ ok: boolean }>(`/v1/merchants/me/digital-fulfillments/${id}/revoke`, {
        method: "POST",
      });
    },
    async refundMerchantDigitalFulfillment(id: string) {
      return request<{ ok: boolean }>(`/v1/merchants/me/digital-fulfillments/${id}/refund`, { method: "POST", body: JSON.stringify({}) });
    },
    async resendMerchantDigitalFulfillment(id: string) {
      return request<{ ok: boolean; sms: string; error?: string }>(`/v1/merchants/me/digital-fulfillments/${id}/resend`, { method: "POST", body: JSON.stringify({}) });
    },
    async fulfillMerchantDigitalLicense(id: string, licenseKey: string) {
      return request<{ ok: boolean }>(`/v1/merchants/me/digital-fulfillments/${id}/license`, { method: "POST", body: JSON.stringify({ license_key: licenseKey }) });
    },
    /** Sends the file itself (streamed) to the product's private storage. */
    async uploadMerchantDigitalFile(productId: string, file: File) {
      const res = await f(`${root}/v1/merchants/me/digital-products/${encodeURIComponent(productId)}/file`, {
        method: "PUT",
        headers: { ...authHeaders(), "content-type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(file.name) },
        body: file,
      });
      return json<{ ok: boolean; file: { name: string; sizeBytes: number; contentType: string } }>(res);
    },
    /** A shopper buys a digital product or course from their wallet. */
    async buyDigitalProduct(productId: string) {
      return request<{
        ok: boolean; fulfillmentId: string; accessUrl: string; token: string; licenseKey: string | null;
        expiresAt: string | null; maxDownloads: number; pricePaidUgx: number; sms: { status: string } | null; needsManualFulfilment: boolean;
      }>(`/v1/marketplace/digital/${encodeURIComponent(productId)}/buy`, { method: "POST", body: JSON.stringify({}) });
    },
    async getMyDigitalPurchases() {
      return request<{ purchases: Array<{ id: string; status: string; title: string; kind: string; store_name: string; download_count: number; max_downloads: number; expires_at: string | null; price_paid_ugx: number; created_at: string }> }>("/v1/me/digital-purchases");
    },
    async newDigitalPurchaseLink(id: string) {
      return request<{ ok: boolean; accessUrl: string }>(`/v1/me/digital-purchases/${encodeURIComponent(id)}/link`, { method: "POST", body: JSON.stringify({}) });
    },

    // Tier 3: Robust LMS & Course Management (synced with Peebee Learn)
    async getMerchantLmsCourses() {
      return request<{ courses: StoreLmsCourse[] }>("/v1/merchants/me/lms/courses");
    },
    async createMerchantLmsCourse(input: Partial<StoreLmsCourse>) {
      return request<{ ok: boolean; course: StoreLmsCourse }>("/v1/merchants/me/lms/courses", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async syncMerchantLmsFromLearn() {
      return request<{ ok: boolean; importedCount: number }>("/v1/merchants/me/lms/sync-from-learn", {
        method: "POST",
      });
    },
    async listMerchantCourseInLearn(courseId: string, listed: boolean) {
      return request<{ ok: boolean; listed: boolean }>(`/v1/merchants/me/lms/courses/${encodeURIComponent(courseId)}/${listed ? "publish-to-learn" : "unlist-from-learn"}`, { method: "POST", body: JSON.stringify({}) });
    },
    async issueMerchantCertificate(enrollmentId: string) {
      return request<{ ok: boolean }>(`/v1/merchants/me/lms/enrollments/${encodeURIComponent(enrollmentId)}/certificate`, { method: "POST", body: JSON.stringify({}) });
    },
    async getMerchantLmsEnrollments() {
      return request<{ enrollments: StoreLmsEnrollment[] }>("/v1/merchants/me/lms/enrollments");
    },
    async enrollMerchantLmsStudent(input: {
      courseId: string;
      studentName: string;
      studentPhone: string;
      studentEmail?: string;
      sendSmsNotice?: boolean;
    }) {
      return request<{ ok: boolean; enrollment: StoreLmsEnrollment; learnPortalUrl: string; accountCreated?: boolean; notice?: { channel: string; status: string; error?: string } | null }>("/v1/merchants/me/lms/enrollments", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async getStoreDigitalProducts(storeId: string) {
      return request<{ digitalProducts: StoreDigitalProduct[]; courses: StoreLmsCourse[] }>(`/v1/marketplace/stores/${storeId}/digital-products`);
    },
    async getDigitalFulfillment(accessToken: string) {
      return request<{ ok: boolean; fulfillment: StoreDigitalFulfillment; downloadUrl?: string }>(`/v1/marketplace/digital-fulfillments/${accessToken}`);
    },

    // Peebee Car — customer
    /** Rejects (403/503) while Car is off or not set up; callers treat that as "no cars". */
    async getCarConfig() {
      return request<CarConfig>("/v1/car/config");
    },
    async getCarServiceOptions(route: { pickupLat: number; pickupLng: number; destinationLat: number; destinationLng: number }) {
      const params = new URLSearchParams(Object.entries(route).map(([key, value]) => [key, String(value)]));
      return request<{ distanceKm: number; options: Array<{ size: "normal" | "large"; tier: "convenient" | "comfort"; fare: number; roundedFrom?: number | null; nearby: number }> }>(`/v1/car/service-options?${params}`);
    },
    /** Fare for a category (Luxury: pass `hireHours` for hire by the hour). */
    async quoteCarCategory(input: { categoryId: string; hireHours?: number; pickupLat: number; pickupLng: number; destinationLat: number; destinationLng: number }) {
      return request<{ fare: number; roundedFrom?: number | null; distanceKm: number }>("/v1/car/quote", { method: "POST", body: JSON.stringify(input) });
    },
    /** How many cars of one category are online and free near a point. */
    async getCarCategoryNearby(categoryId: string, lat: number, lng: number) {
      const params = new URLSearchParams({ categoryId, lat: String(lat), lng: String(lng) });
      return request<{ nearby: number }>(`/v1/car/category-nearby?${params}`);
    },
    async bookCar(input: CarBookingInput & { scheduledFor?: string }) {
      return request<{ order: OrderRow }>("/v1/car/bookings", { method: "POST", body: JSON.stringify(input) });
    },

    // Peebee Car — partners (owners and drivers)
    async carMe() {
      return request<CarMe>("/v1/car/me");
    },
    async carApply(as: "owner" | "driver", licenceExpiry?: string, needsVehicle?: boolean) {
      return request<{ ok: true }>("/v1/car/partner/apply", { method: "POST", body: JSON.stringify({ as, licenceExpiry, needsVehicle }) });
    },
    /** Uploads a photo of the national ID or driving licence (compress it first). */
    async carUploadDocument(kind: "national_id" | "licence", file: Blob) {
      const form = new FormData();
      form.append("kind", kind);
      form.append("file", file, "document.jpg");
      const res = await f(`${root}/v1/car/partner/documents`, { method: "POST", headers: authHeaders(), body: form });
      return json<{ id: string }>(res);
    },
    /** A partner's document as a Blob (their own, or any for staff). */
    async carDocumentBlob(userId: string, kind: "national_id" | "licence"): Promise<Blob> {
      const res = await f(`${root}/v1/car/partner/documents/${userId}/${kind}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`API ${res.status}: failed to load document`);
      return res.blob();
    },
    async carDriveVehicle(vehicleId: string) {
      return request<{ ok: true }>(`/v1/car/vehicles/${vehicleId}/drive`, { method: "POST" });
    },
    async carReleaseVehicle(vehicleId: string) {
      return request<{ ok: true }>(`/v1/car/vehicles/${vehicleId}/release`, { method: "POST" });
    },
    async carAddVehicle(input: { categoryId: string; plate: string; make?: string; model?: string; year?: number; colour?: string; modelCatalogId?: string; serviceClass?: "convenient" | "comfort"; acceptsConvenient?: boolean; conditionGrade?: "excellent" | "good" | "fair"; seatCapacity?: number; lastServiceDate: string; features?: string[] }) {
      return request<{ id: string }>("/v1/car/vehicles", { method: "POST", body: JSON.stringify(input) });
    },
    async carUpdateRideService(vehicleId: string, serviceClass: "convenient" | "comfort", acceptsConvenient: boolean) {
      return request<{ ok: true }>(`/v1/car/vehicles/${vehicleId}/ride-service`, { method: "PATCH", body: JSON.stringify({ serviceClass, acceptsConvenient }) });
    },
    async carOwnerRides() {
      return request<CarOwnerRides>("/v1/car/owner/rides");
    },
    async carDriverOnline(online: boolean, position?: { lat: number; lng: number }, vehicleId?: string) {
      return request<{ ok: true; online: boolean }>("/v1/car/driver/online", { method: "POST", body: JSON.stringify({ online, vehicleId, ...position }) });
    },
    async carDriverLocation(lat: number, lng: number) {
      return request<{ ok: true }>("/v1/car/driver/location", { method: "POST", body: JSON.stringify({ lat, lng }) });
    },
    async carDriverJobs() {
      return request<{ jobs: CarDriverJob[] }>("/v1/car/driver/jobs");
    },
    async carDriverApply(orderId: string, bidAmount?: number) {
      return request<{ ok: true }>(`/v1/car/orders/${orderId}/apply`, { method: "POST", body: JSON.stringify({ bidAmount }) });
    },
    async carBookingInfo(orderId: string) {
      return request<{ car: true; scheduledFor: string | null; categoryName?: string; plate?: string; vehicleName?: string; ownerName?: string; driverName?: string }>(`/v1/car/bookings/${orderId}/info`);
    },
    async carRematch(orderId: string) {
      return request<{ ok: true }>(`/v1/car/bookings/${orderId}/rematch`, { method: "POST" });
    },
    async carpoolSearch(q: { nearLat: number; nearLng: number; nearLabel?: string; date?: string } | { fromLat: number; fromLng: number; toLat: number; toLng: number; date?: string }) {
      const params = new URLSearchParams("nearLat" in q
        ? { nearLat: String(q.nearLat), nearLng: String(q.nearLng), ...(q.nearLabel ? { nearLabel: q.nearLabel } : {}), ...(q.date ? { date: q.date } : {}) }
        : { fromLat: String(q.fromLat), fromLng: String(q.fromLng), toLat: String(q.toLat), toLng: String(q.toLng), ...(q.date ? { date: q.date } : {}) });
      return request<{ trips: CarpoolTrip[]; maxSeatsPerBooking: number }>(`/v1/car/carpool/trips?${params}`);
    },
    async carpoolBook(tripId: string, seats: number) {
      return request<{ order: OrderRow }>(`/v1/car/carpool/trips/${tripId}/seats`, { method: "POST", body: JSON.stringify({ seats }) });
    },
    async carpoolPublish(input: CarpoolPublishInput) {
      return request<{ ids: string[] }>("/v1/car/carpool/trips", { method: "POST", body: JSON.stringify(input) });
    },
    async carpoolMyTrips() {
      return request<{ trips: CarpoolMyTrip[] }>("/v1/car/carpool/my-trips");
    },
    async carpoolSetStatus(tripId: string, status: "departed" | "completed" | "cancelled") {
      return request<{ ok: true }>(`/v1/car/carpool/trips/${tripId}/status`, { method: "POST", body: JSON.stringify({ status }) });
    },
    async rentalSearch(startsAt: string, endsAt: string) {
      const params = new URLSearchParams({ startsAt, endsAt });
      return request<{ days: number; vehicles: RentalVehicle[] }>(`/v1/car/rentals/listings?${params}`);
    },
    async rentalRequest(input: { vehicleId: string; startsAt: string; endsAt: string; licenceNumber: string; licenceExpiry: string; periodType?: "hourly" | "half_day" | "full_day" }) {
      return request<{ id: string; days: number; rent: number; deposit: number; status?: string; periodType?: string }>("/v1/car/rentals", { method: "POST", body: JSON.stringify(input) });
    },
    async myRentals() {
      return request<{ rentals: Rental[] }>("/v1/car/rentals/mine");
    },
    async cancelRental(id: string) {
      return request<{ ok: true }>(`/v1/car/rentals/${id}/cancel`, { method: "POST" });
    },
    async ownerRentals() {
      return request<{ vehicles: OwnerRentalVehicle[]; rentals: Rental[] }>("/v1/car/rentals/my-vehicles");
    },
    async saveRentalListing(vehicleId: string, input: { dailyPrice: number; depositAmount: number; notes?: string; active: boolean; hourlyEnabled?: boolean; halfDayEnabled?: boolean; fullDayEnabled?: boolean }) {
      return request<{ ok: true }>(`/v1/car/rentals/listings/${vehicleId}`, { method: "PUT", body: JSON.stringify(input) });
    },
    async decideRental(id: string, approve: boolean) {
      return request<{ ok: true }>(`/v1/car/rentals/${id}/decision`, { method: "POST", body: JSON.stringify({ approve }) });
    },
    async handoverRental(id: string) {
      return request<{ ok: true }>(`/v1/car/rentals/${id}/handover`, { method: "POST" });
    },
    async returnRental(id: string, damageClaim?: number) {
      return request<{ ok: true; status: string }>(`/v1/car/rentals/${id}/return`, { method: "POST", body: JSON.stringify({ damageClaim }) });
    },
    async getRentalInspections(rentalId: string) {
      return request<{ pickup: RentalInspection | null; return: RentalInspection | null }>(`/v1/car/rentals/${rentalId}/inspections`);
    },
    async submitRentalInspection(rentalId: string, input: RentalInspectionSubmitInput | FormData) {
      if (input instanceof FormData) {
        const res = await f(`${root}/v1/car/rentals/${rentalId}/inspections`, { method: "POST", headers: authHeaders(), body: input });
        return json<{ ok: true; inspectionId: string }>(res);
      }
      return request<{ ok: true; inspectionId: string }>(`/v1/car/rentals/${rentalId}/inspections`, { method: "POST", body: JSON.stringify(input) });
    },
    async getRentalInspectionPhotoUrl(photoId: string) {
      return `${root}/v1/car/rentals/inspections/photos/${photoId}`;
    },
    async selfDriveRenterProfile() {
      return request<SelfDriveRenterKycProfile>("/v1/car/rentals/renter-profile");
    },
    async submitSelfDriveRenterProfile(input: { nin: string; residentialAddress: string; residenceMethod: SelfDriveResidenceMethod; nationalId: Blob; rentReceipt?: Blob; landlordLetter?: Blob; residenceBill?: Blob; tenancyStart?: string; tenancyEnd?: string }) {
      const form = new FormData();
      form.append("nin", input.nin); form.append("residentialAddress", input.residentialAddress); form.append("residenceMethod", input.residenceMethod); form.append("nationalId", input.nationalId, "national-id-document");
      if (input.rentReceipt) form.append("rentReceipt", input.rentReceipt, "rent-receipt");
      if (input.landlordLetter) form.append("landlordLetter", input.landlordLetter, "landlord-letter");
      if (input.residenceBill) form.append("residenceBill", input.residenceBill, "residence-bill");
      if (input.tenancyStart) form.append("tenancyStart", input.tenancyStart);
      if (input.tenancyEnd) form.append("tenancyEnd", input.tenancyEnd);
      const res = await f(`${root}/v1/car/rentals/renter-profile`, { method: "POST", headers: authHeaders(), body: form });
      return json<{ ok: true; status: "pending" | "approved" }>(res);
    },
    async finishDemoRental(id: string) {
      return request<{ ok: true; status: string }>(`/v1/car/rentals/${id}/demo-return`, { method: "POST" });
    },
    async adminCarRentals() {
      return request<{ rentals: AdminRental[] }>("/v1/admin/car/rentals");
    },
    async adminSelfDriveRenterKyc() {
      return request<{ applicants: AdminSelfDriveRenterKyc[] }>("/v1/admin/car/renters/kyc");
    },
    async adminSelfDriveRenterDocument(userId: string, kind: "national_id" | "rent_receipt" | "landlord_letter" | "residence_bill"): Promise<Blob> {
      const res = await f(`${root}/v1/admin/car/renters/${userId}/kyc/${kind}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`API ${res.status}: failed to load verification document`);
      return res.blob();
    },
    async adminReviewSelfDriveRenter(userId: string, status: "approved" | "rejected", notes?: string) {
      return request<{ ok: true }>(`/v1/admin/car/renters/${userId}/kyc/review`, { method: "POST", body: JSON.stringify({ status, notes }) });
    },
    async adminResolveRental(id: string, damageAmount: number) {
      return request<{ ok: true }>(`/v1/admin/car/rentals/${id}/resolve`, { method: "POST", body: JSON.stringify({ damageAmount }) });
    },
    /** Adds one photo to a vehicle (multipart; compress it first). */
    async carUploadVehiclePhoto(vehicleId: string, file: Blob) {
      const form = new FormData();
      form.append("file", file, "vehicle.jpg");
      const res = await f(`${root}/v1/car/vehicles/${vehicleId}/photos`, { method: "POST", headers: authHeaders(), body: form });
      return json<{ id: string }>(res);
    },
    async carDeleteVehiclePhoto(vehicleId: string, photoId: string) {
      return request<{ ok: true }>(`/v1/car/vehicles/${vehicleId}/photos/${photoId}`, { method: "DELETE" });
    },
    /** A vehicle photo as a Blob (raw fetch — the image needs the auth header). */
    async carVehiclePhotoBlob(vehicleId: string, photoId: string): Promise<Blob> {
      const res = await f(`${root}/v1/car/vehicles/${vehicleId}/photos/${photoId}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`API ${res.status}: failed to load photo`);
      return res.blob();
    },
    // Driver <-> owner agreements
    async dealsOwner() {
      return request<OwnerDeals>("/v1/car/deals/owner");
    },
    async dealsSetTerms(vehicleId: string, input: DealTermsInput) {
      return request<{ ok: true }>(`/v1/car/deals/terms/${vehicleId}`, { method: "PUT", body: JSON.stringify(input) });
    },
    async dealsDecide(requestId: string, accept: boolean) {
      return request<{ ok: true }>(`/v1/car/deals/requests/${requestId}/decision`, { method: "POST", body: JSON.stringify({ accept }) });
    },
    async dealsEnd(vehicleId: string) {
      return request<{ ok: true }>(`/v1/car/deals/vehicles/${vehicleId}/end`, { method: "POST" });
    },
    async dealsCars() {
      return request<{ cars: DriverCar[] }>("/v1/car/deals/cars");
    },
    async dealsApply(vehicleId: string) {
      return request<{ ok: true }>(`/v1/car/deals/cars/${vehicleId}/request`, { method: "POST" });
    },
    async dealsMy() {
      return request<DriverDeals>("/v1/car/deals/my");
    },
    async dealsWithdraw(requestId: string) {
      return request<{ ok: true }>(`/v1/car/deals/requests/${requestId}/withdraw`, { method: "POST" });
    },
    async dealsPayRent(assignmentId: string) {
      return request<{ ok: true; paid: number }>("/v1/car/deals/rent/pay", { method: "POST", body: JSON.stringify({ assignmentId }) });
    },
    async carWallet() {
      return request<CarWallet>("/v1/car/wallet");
    },
    async carWithdraw(amount: number, mobileNumberId?: string) {
      return request<{ withdrawalId: string; amount: number; status: "pending" }>("/v1/car/wallet/withdraw", {
        method: "POST",
        body: JSON.stringify({ amount, mobileNumberId }),
      });
    },
    async carWithdrawalStatus(id: string) {
      return request<{ withdrawal: { id: string; status: "pending" | "successful" | "failed" } }>(`/v1/car/wallet/withdrawals/${id}/refresh`);
    },
    async carDriverActive() {
      return request<CarDriverActive>("/v1/car/driver/active");
    },

    // Admin — Peebee Car
    async adminCarCategories() {
      return request<{ categories: AdminCarCategory[] }>("/v1/admin/car/categories");
    },
    async adminSaveCarCategory(input: AdminCarCategoryInput, id?: string) {
      return request<{ ok?: true; id?: string }>(id ? `/v1/admin/car/categories/${id}` : "/v1/admin/car/categories", {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(input),
      });
    },
    async adminCarPartners() {
      return request<{ partners: AdminCarPartner[] }>("/v1/admin/car/partners");
    },
    async adminDecideCarPartner(userId: string, role: "owner" | "driver", status: "approved" | "rejected" | "suspended") {
      return request<{ ok: true }>(`/v1/admin/car/partners/${userId}/decision`, { method: "POST", body: JSON.stringify({ role, status }) });
    },
    async adminCarVehicles() {
      return request<{ vehicles: AdminCarVehicle[] }>("/v1/admin/car/vehicles");
    },
    async adminDecideCarVehicle(id: string, status: "approved" | "rejected" | "suspended") {
      return request<{ ok: true }>(`/v1/admin/car/vehicles/${id}/decision`, { method: "POST", body: JSON.stringify({ status }) });
    },
    async adminAssignCarDriver(vehicleId: string, driverId: string | null) {
      return request<{ ok: true }>(`/v1/admin/car/vehicles/${vehicleId}/assign`, { method: "POST", body: JSON.stringify({ driverId }) });
    },
    async adminCarBookings() {
      return request<{ bookings: AdminCarBooking[] }>("/v1/admin/car/bookings");
    },

    // Admin
    async adminListRiders() {
      return request<{ riders: AdminRider[] }>("/v1/admin/riders");
    },
    async adminGetRestaurant(id: string) {
      return request<{restaurant: AdminRestaurant}>(`/v1/admin/restaurants/${encodeURIComponent(id)}`);
    },
    async uploadRestaurantCover(file: Blob) {
      const form=new FormData();form.append("file",file,"cover.jpg");
      const response=await f(`${root}/v1/restaurants/me/cover`,{method:"POST",headers:authHeaders(),body:form});
      if(!response.ok)throw new Error("Could not save your cover. Use a JPG, PNG or WebP image under 4 MB.");
      return response.json() as Promise<{ok:true;coverKey:string}>;
    },
    async restaurantCoverBlob(id:string,revision?:string) {
      const response=await f(`${root}/v1/restaurants/${encodeURIComponent(id)}/cover${revision?`?v=${encodeURIComponent(revision)}`:""}`,{headers:authHeaders()});
      if(!response.ok)throw new Error("Cover unavailable");
      return response.blob();
    },
    async uploadRestaurantLogo(file:Blob){const form=new FormData();form.append("file",file,"logo.png");const response=await f(`${root}/v1/restaurants/me/logo`,{method:"POST",headers:authHeaders(),body:form});if(!response.ok)throw new Error("Could not save your logo. Use a JPG, PNG or WebP image under 4 MB.");return response.json() as Promise<{ok:true;logoKey:string}>;},
    async restaurantLogoBlob(id:string,revision?:string){const response=await f(`${root}/v1/restaurants/${encodeURIComponent(id)}/logo${revision?`?v=${encodeURIComponent(revision)}`:""}`,{headers:authHeaders()});if(!response.ok)throw new Error("Logo unavailable");return response.blob();},
    async foodMenuInsights(id:string){return request<{items:Record<string,import("./food-feedback.js").FoodItemInsight>;available:boolean}>(`/v1/restaurants/${encodeURIComponent(id)}/menu/insights`);},
    async foodRestaurantTrust(id:string){return request<import("./food-feedback.js").FoodRestaurantTrust>(`/v1/restaurants/${encodeURIComponent(id)}/trust`);},
    async foodItemFeedback(id:string,itemId:string){return request<import("./food-feedback.js").FoodItemFeedback>(`/v1/restaurants/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}/reviews`);},
    async saveFoodItemReview(id:string,itemId:string,input:{orderId:string;rating:number;comment:string;recommended:boolean}){return request<{ok:true}>(`/v1/restaurants/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}/review`,{method:"PUT",body:JSON.stringify(input)});},
    async adminPersonPhoto(kind: "riders" | "customers" | "restaurants" | "merchants", id: string): Promise<Blob> {
      const res=await f(`${root}/v1/admin/people/${kind}/${encodeURIComponent(id)}/photo`,{headers:authHeaders()});
      if (!res.ok) throw new Error("Photo unavailable");
      return res.blob();
    },
    async adminSetRiderVisibilityRange(userId: string, rangeKm: number | null) {
      return request<{ ok: boolean; rangeKm: number | null }>(`/v1/admin/riders/${encodeURIComponent(userId)}/visibility-range`, {
        method: "POST",
        body: JSON.stringify({ rangeKm }),
      });
    },
    async adminVerifyRider(userId: string, verified: boolean) {
      return request<{ rider: Rider }>(`/v1/admin/riders/${userId}/verify`, {
        method: "POST",
        body: JSON.stringify({ verified }),
      });
    },
    async adminListRestaurants(status?: RestaurantStatus) {
      const qs = status ? `?status=${status}` : "";
      return request<{ restaurants: AdminRestaurant[] }>(`/v1/admin/restaurants${qs}`);
    },
    async adminSetRestaurantStatus(id: string, status: RestaurantStatus) {
      return request<{ restaurant: AdminRestaurant }>(`/v1/admin/restaurants/${id}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
    },
    /** Fetches a rider's National ID scan as a Blob (not JSON — raw fetch, mirrors uploadRiderIdDocument). */
    async adminRiderIdDocumentBlob(userId: string): Promise<Blob> {
      const res = await f(`${root}/v1/admin/riders/${userId}/id-document`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`API ${res.status}: failed to load ID document`);
      return res.blob();
    },
    async adminStats() {
      return request<{ stats: AdminStats }>("/v1/admin/stats");
    },
    async adminOrderOverview(range: OrderOverviewRange = "all") {
      return request<OrderOverview>(`/v1/admin/stats/orders?range=${range}`);
    },
    async adminIntegrations() {
      return request<{ integrations: IntegrationsStatus; recentFailedPayments: FailedPayment[] }>(
        "/v1/admin/integrations",
      );
    },
    /** Saves whichever credential fields are non-blank for one aggregator —
     * a blank field is left untouched, not cleared. See
     * apps/api/src/payments/credentials.ts for the field definitions. */
    async adminSavePaymentCredentials(provider: PaymentProviderIdentity, fields: Record<string, string>) {
      return request<{ changed: string[] }>(`/v1/admin/payments/credentials/${provider}`, {
        method: "PUT",
        body: JSON.stringify({ fields }),
      });
    },
    /** Clears one previously-saved credential field, reverting that field to
     * its env-var fallback (if any). */
    async adminClearPaymentCredential(provider: PaymentProviderIdentity, field: string) {
      return request<{ ok: true }>(`/v1/admin/payments/credentials/${provider}/${field}`, { method: "DELETE" });
    },
    async adminMerchantCustody() {
      return request<{ approvals: MerchantCustodyApproval[] }>("/v1/admin/merchant-custody");
    },
    async adminMerchants() {
      return request<{ merchants: AdminMerchant[] }>("/v1/admin/merchants");
    },
    async adminGetMerchant(id: string, range: AdminMerchantRange = "month") {
      return request<AdminMerchantProfileResponse>(
        `/v1/admin/merchants/${encodeURIComponent(id)}?range=${encodeURIComponent(range)}`,
      );
    },
    async adminSetMerchantStatus(id: string, status: Merchant["status"]) {
      return request<{ merchant: Merchant }>(`/v1/admin/merchants/${id}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
    },
    async adminMerchantKycDocumentBlob(id: string, type: "owner-id" | "business-registration") {
      const res = await f(`${root}/v1/admin/merchants/${id}/kyc-documents/${type}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`API ${res.status}: failed to load merchant KYC document`);
      return res.blob();
    },
    async adminSetMerchantPaymentsEnabled(enabled: boolean) {
      return request<{ enabled: boolean; environment: PlatformEnvironment }>("/v1/admin/merchant-payments/activation", {
        method: "POST",
        body: JSON.stringify({ enabled }),
      });
    },
    async adminApproveMerchantCustody(input: {
      custodyProvider: string;
      payoutProvider: string;
      safeguardingReference: string;
      effectiveAt: string;
      expiresAt?: string | null;
    }) {
      return request<{ approval: { id: string; status: "active" } }>("/v1/admin/merchant-custody", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async adminRevokeMerchantCustody(id: string) {
      return request<{ ok: true }>(`/v1/admin/merchant-custody/${id}/revoke`, { method: "POST" });
    },
    async adminMerchantSettlementAccounts(status?: "pending_verification" | "verified" | "disabled") {
      const query = status ? `?status=${status}` : "";
      return request<{ settlementAccounts: AdminMerchantSettlementAccount[] }>(
        `/v1/admin/merchant-settlement-accounts${query}`,
      );
    },
    async adminSetMerchantSettlementAccountStatus(id: string, status: "verified" | "disabled") {
      return request<{ settlementAccount: { id: string; status: "verified" | "disabled" } }>(
        `/v1/admin/merchant-settlement-accounts/${id}/status`,
        { method: "POST", body: JSON.stringify({ status }) },
      );
    },
    async adminMerchantReconciliation() {
      return request<{
        merchants: MerchantReconciliationRow[];
        reconciled: boolean;
        withdrawalsFrozen: boolean;
        providerOperations: MerchantProviderOperation[];
      }>("/v1/admin/merchant-reconciliation");
    },
    async adminSetMerchantWithdrawalsFrozen(frozen: boolean) {
      return request<{ frozen: boolean }>("/v1/admin/merchant-reconciliation/freeze", {
        method: "POST",
        body: JSON.stringify({ frozen }),
      });
    },
    async adminListCustomers(q?: string) {
      const qs = q ? `?q=${encodeURIComponent(q)}` : "";
      return request<{ customers: AdminCustomer[] }>(`/v1/admin/customers${qs}`);
    },
    async adminGetCustomer(id: string) {
      return request<{ customer: AdminCustomer; orders: AdminOrderRow[] }>(`/v1/admin/customers/${id}`);
    },
    async adminListOrders(filters: { stage?: string; type?: OrderType; limit?: number } = {}) {
      const params = new URLSearchParams();
      if (filters.stage) params.set("stage", filters.stage);
      if (filters.type) params.set("type", filters.type);
      if (filters.limit) params.set("limit", String(filters.limit));
      const qs = params.toString();
      return request<{ orders: AdminOrderRow[] }>(`/v1/admin/orders${qs ? `?${qs}` : ""}`);
    },
    async adminSetUserStatus(userId: string, status: UserStatus) {
      return request<{ user: AuthUser }>(`/v1/admin/users/${userId}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
    },

    // Staff accounts — Super Admin only, enforced server-side.
    async adminListStaff() {
      return request<{ staff: StaffMember[] }>("/v1/admin/staff");
    },
    async adminStaffRoles() {
      return request<{ roles: Array<{ role: AdminRole; label: string; description: string }> }>(
        "/v1/admin/staff/roles",
      );
    },
    async adminInviteStaff(input: { name: string; email: string; phone?: string; adminRole: AdminRole }) {
      return request<{ staff: StaffMember; emailFailed?: boolean; tempPassword?: string; message?: string }>(
        "/v1/admin/staff",
        { method: "POST", body: JSON.stringify(input) },
      );
    },
    async adminChangeStaffRole(userId: string, adminRole: AdminRole) {
      return request<{ ok: true }>(`/v1/admin/staff/${userId}/role`, {
        method: "POST",
        body: JSON.stringify({ adminRole }),
      });
    },
    async adminSetStaffStatus(userId: string, status: UserStatus) {
      return request<{ ok: true }>(`/v1/admin/staff/${userId}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
    },
    async adminResetStaffPassword(userId: string) {
      return request<{ ok: true; emailed: boolean; tempPassword?: string; message?: string }>(
        `/v1/admin/staff/${userId}/reset-password`,
        { method: "POST" },
      );
    },

    // Activity log
    async adminActivityLog(options: { limit?: number; before?: string } = {}) {
      const params = new URLSearchParams();
      if (options.limit) params.set("limit", String(options.limit));
      if (options.before) params.set("before", options.before);
      const qs = params.toString();
      return request<{ entries: ActivityLogEntry[] }>(`/v1/admin/activity${qs ? `?${qs}` : ""}`);
    },
    async adminRevertActivity(id: string) {
      return request<{ ok: true }>(`/v1/admin/activity/${id}/revert`, { method: "POST" });
    },

    // A user's own profile photo (primarily customers) — riders keep their
    // separate uploadRiderProfilePhoto/riderPhotoBlob below.
    async uploadUserProfilePhoto(file: Blob) {
      const form = new FormData();
      form.append("file", file);
      const res = await f(`${root}/v1/users/me/profile-photo`, { method: "POST", headers: authHeaders(), body: form });
      return json<{ hasProfilePhoto: true }>(res);
    },
    async updateMyDisplayName(name: string) {
      return request<{ name: string }>("/v1/users/me/profile", { method: "PATCH", body: JSON.stringify({ name }) });
    },
    async deleteUserProfilePhoto() {
      return request<{ hasProfilePhoto: false }>("/v1/users/me/profile-photo", { method: "DELETE" });
    },
    async userPhotoBlob(userId: string): Promise<Blob> {
      const res = await f(`${root}/v1/users/${userId}/photo`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`API ${res.status}: failed to load photo`);
      return res.blob();
    },

    // Rider Stage Savings Circles — cash-first, non-custodial group
    // savings/loans. See apps/api/src/stages/routes.ts.
    async getMyStages() {
      return request<{ stages: Stage[] }>("/v1/stages/mine");
    },
    async discoverStages() {
      return request<{ stages: AdminStageSummary[] }>("/v1/stages/discover");
    },
    async createStage(input: { name: string; area?: string; address?: string; description?: string }) {
      return request<{ stageId: string }>("/v1/stages", { method: "POST", body: JSON.stringify(input) });
    },
    async getStage(stageId: string) {
      return request<StageDetail>(`/v1/stages/${stageId}`);
    },
    async joinStage(stageId: string) {
      return request<{ ok: true }>(`/v1/stages/${stageId}/join`, { method: "POST" });
    },
    async startElectionSession(stageId: string, input: { roles: StageMemberRole[]; nominationDeadline: string; voteChangeGraceSeconds?: number }) {
      return request<{ sessionId: string }>(`/v1/stages/${stageId}/elections/sessions`, { method: "POST", body: JSON.stringify(input) });
    },
    async getActiveElectionSession(stageId: string) {
      return request<StageElectionSessionDetail>(`/v1/stages/${stageId}/elections/sessions/active`);
    },
    async applyForElection(electionId: string, statement?: string) {
      return request<{ ok: true }>(`/v1/stages/elections/${electionId}/apply`, { method: "POST", body: JSON.stringify({ statement }) });
    },
    async uploadElectionVoiceNote(electionId: string, file: Blob) {
      const form = new FormData();
      form.append("file", file);
      const res = await f(`${root}/v1/stages/elections/${electionId}/apply/voice`, { method: "POST", headers: authHeaders(), body: form });
      return json<{ ok: true }>(res);
    },
    /** Fetches a nominee's voice-note pitch as a Blob (not JSON — raw fetch), same pattern as chatMediaBlob. */
    async electionVoiceNoteBlob(electionId: string, candidateRiderId: string): Promise<Blob> {
      const res = await f(`${root}/v1/stages/elections/${electionId}/voice/${candidateRiderId}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`API ${res.status}: failed to load voice note`);
      return res.blob();
    },
    async startElectionVoting(stageId: string, sessionId: string, votingHours: number) {
      return request<{ ok: true }>(`/v1/stages/${stageId}/elections/sessions/${sessionId}/start-voting`, { method: "POST", body: JSON.stringify({ votingHours }) });
    },
    async voteInElection(electionId: string, candidateRiderId: string) {
      return request<{ ok: true }>(`/v1/stages/elections/${electionId}/vote`, {
        method: "POST",
        body: JSON.stringify({ candidateRiderId }),
      });
    },
    async publishElectionResults(stageId: string, sessionId: string) {
      return request<{ ok: true }>(`/v1/stages/${stageId}/elections/sessions/${sessionId}/publish`, { method: "POST" });
    },
    async startStageCycle(stageId: string, input: { startDate: string; interestRate?: number; loanableContributionMultiple?: number; maxLoanDurationMonths?: number; cycleMonths?: number; sharePrice?: number; election?: { roles: StageMemberRole[]; nominationDeadline: string; voteChangeGraceSeconds?: number } }) {
      return request<{ cycleId: string; sessionId?: string }>(`/v1/stages/${stageId}/cycles`, { method: "POST", body: JSON.stringify(input) });
    },
    async updateStageCycle(stageId: string, cycleId: string, input: { endDate?: string; interestRate?: number; loanableContributionMultiple?: number; maxLoanDurationMonths?: number; sharePrice?: number }) {
      return request<{ ok: true }>(`/v1/stages/${stageId}/cycles/${cycleId}`, { method: "PUT", body: JSON.stringify(input) });
    },
    async createStageFineType(stageId: string, cycleId: string, input: { name: string; schedule: StageFineSchedule; amount: number }) {
      return request<{ fineTypeId: string }>(`/v1/stages/${stageId}/cycles/${cycleId}/fine-types`, { method: "POST", body: JSON.stringify(input) });
    },
    async getStageFineTypes(stageId: string, cycleId: string) {
      return request<{ fineTypes: StageFineType[] }>(`/v1/stages/${stageId}/cycles/${cycleId}/fine-types`);
    },
    async deleteStageFineType(stageId: string, fineTypeId: string) {
      return request<{ ok: true }>(`/v1/stages/${stageId}/fine-types/${fineTypeId}`, { method: "DELETE" });
    },
    async getMyStageMemberProfile(stageId: string) {
      return request<StageMemberProfile>(`/v1/stages/${stageId}/members/me/profile`);
    },
    async updateMyStageMemberProfile(stageId: string, input: Partial<Omit<StageMemberProfile, "profile_completed_at">>) {
      return request<{ ok: true }>(`/v1/stages/${stageId}/members/me/profile`, { method: "PUT", body: JSON.stringify(input) });
    },
    async setStageLoanWorkflow(stageId: string, cycleId: string, workflow: StageLoanApprovalWorkflowRow[]) {
      return request<{ ok: true }>(`/v1/stages/${stageId}/cycles/${cycleId}/workflow`, {
        method: "PUT",
        body: JSON.stringify({
          workflow: workflow.map((w) => ({ role: w.role, approvalsRequired: w.approvals_required, rejectionsRequired: w.rejections_required })),
        }),
      });
    },
    async transferStageAdmin(stageId: string, targetRiderId: string) {
      return request<{ ok: true }>(`/v1/stages/${stageId}/transfer-admin`, { method: "POST", body: JSON.stringify({ targetRiderId }) });
    },
    async setStageMemberRole(stageId: string, riderId: string, role: StageMemberRole) {
      return request<{ ok: true }>(`/v1/stages/${stageId}/members/${riderId}/role`, { method: "PUT", body: JSON.stringify({ role }) });
    },
    async launchStage(stageId: string) {
      return request<{ ok: true }>(`/v1/stages/${stageId}/launch`, { method: "POST" });
    },
    async inviteToStage(stageId: string, phone: string) {
      return request<{ ok: true; riderId: string; name: string }>(`/v1/stages/${stageId}/invite`, { method: "POST", body: JSON.stringify({ phone }) });
    },
    async getStageReports(stageId: string) {
      return request<StageReports>(`/v1/stages/${stageId}/reports`);
    },
    async createStageContribution(stageId: string, input: { shares: number; method: "cash" | "momo" }) {
      return request<{ contributionId: string; amount: number; momoRecipientMsisdn: string | null }>(`/v1/stages/${stageId}/contributions`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async uploadStageContributionProof(contributionId: string, file: Blob) {
      const form = new FormData();
      form.append("file", file);
      const res = await f(`${root}/v1/stages/contributions/${contributionId}/proof`, {
        method: "POST",
        headers: authHeaders(),
        body: form,
      });
      return json<{ ok: true }>(res);
    },
    async confirmStageContribution(contributionId: string) {
      return request<{ ok: true }>(`/v1/stages/contributions/${contributionId}/confirm`, { method: "POST" });
    },
    async cancelStageContribution(contributionId: string) {
      return request<{ ok: true }>(`/v1/stages/contributions/${contributionId}/cancel`, { method: "POST" });
    },
    async getStageContributions(stageId: string) {
      return request<{ contributions: StageContribution[] }>(`/v1/stages/${stageId}/contributions`);
    },
    async requestStageLoan(stageId: string, input: { amount: number; reason?: string; numberOfInstallments?: number }) {
      return request<{ loanId: string }>(`/v1/stages/${stageId}/loans`, { method: "POST", body: JSON.stringify(input) });
    },
    async voteStageLoan(loanId: string, input: { status: "approved" | "rejected"; comment?: string }) {
      return request<{ ok: true }>(`/v1/stages/loans/${loanId}/vote`, { method: "POST", body: JSON.stringify(input) });
    },
    async confirmStageLoanDisbursement(loanId: string) {
      return request<{ ok: true }>(`/v1/stages/loans/${loanId}/disbursement-confirm`, { method: "POST" });
    },
    async getStageLoans(stageId: string) {
      return request<{ loans: StageLoan[] }>(`/v1/stages/${stageId}/loans`);
    },
    async requestStageRepayment(loanId: string, input: { amount: number; method: "cash" | "momo" }) {
      return request<{ repaymentId: string; momoRecipientMsisdn: string | null }>(`/v1/stages/loans/${loanId}/repayments`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async uploadStageRepaymentProof(repaymentId: string, file: Blob) {
      const form = new FormData();
      form.append("file", file);
      const res = await f(`${root}/v1/stages/repayments/${repaymentId}/proof`, {
        method: "POST",
        headers: authHeaders(),
        body: form,
      });
      return json<{ ok: true }>(res);
    },
    async confirmStageRepayment(repaymentId: string) {
      return request<{ ok: true }>(`/v1/stages/repayments/${repaymentId}/confirm`, { method: "POST" });
    },
    async getStageLedger(stageId: string) {
      return request<{ transactions: StageTransaction[] }>(`/v1/stages/${stageId}/ledger`);
    },
    async createStageTransaction(stageId: string, input: { type: StageTransaction["type"]; amount: number; memberId?: string | null; narrative: string }) {
      return request<{ transactionId: string }>(`/v1/stages/${stageId}/transactions`, { method: "POST", body: JSON.stringify(input) });
    },
    async getStageMessages(stageId: string, withRiderId?: string) {
      const qs = withRiderId ? `?with=${encodeURIComponent(withRiderId)}` : "";
      return request<{ messages: StageMessage[] }>(`/v1/stages/${stageId}/messages${qs}`);
    },
    async sendStageMessage(stageId: string, input: { body: string; recipientId?: string }) {
      return request<{ messageId: string }>(`/v1/stages/${stageId}/messages`, { method: "POST", body: JSON.stringify(input) });
    },
    // Admin oversight — read-only, gated by the vslaAdminLedgerVisibility setting.
    async adminGetStages() {
      return request<{ stages: AdminStageSummary[] }>("/v1/admin/stages");
    },
    async adminCreateStage(input: { name: string; area?: string; address?: string; description?: string; chairmanRiderId?: string; groupAdminRiderId?: string }) {
      return request<{ stageId: string }>("/v1/admin/stages", { method: "POST", body: JSON.stringify(input) });
    },
    async adminGetStage(stageId: string) {
      return request<AdminStageDetail>(`/v1/admin/stages/${stageId}`);
    },
    async adminGetStageLedger(stageId: string) {
      return request<{ transactions: StageTransaction[] }>(`/v1/admin/stages/${stageId}/ledger`);
    },
    async adminGetPendingStages() {
      return request<{ stages: (AdminStageSummary & { proposer_name: string | null; proposer_phone: string | null })[] }>(
        "/v1/admin/stages/pending",
      );
    },
    async adminApproveStage(stageId: string) {
      return request<{ ok: true }>(`/v1/admin/stages/${stageId}/approve`, { method: "POST" });
    },
    async adminRejectStage(stageId: string, reason: string) {
      return request<{ ok: true }>(`/v1/admin/stages/${stageId}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
    },
    // -----------------------------------------------------------------------
    // Peebee Gas: Fuel merchant network & attendant code redemption
    // -----------------------------------------------------------------------
    async gasStatus() {
      return request<{ ok: boolean; settings: { enabled: boolean; dailyLimitUgx: number; voucherExpiryMinutes: number; platformDiscountPercent: number } }>("/v1/gas/status");
    },
    async gasStations() {
      return request<{ outlets: FuelStationOutlet[] }>("/v1/gas/stations");
    },
    async gasProducts() {
      return request<{ products: FuelProduct[] }>("/v1/gas/products");
    },
    async gasOutletPrices(outletId: string) {
      return request<{ outlet_id: string; prices: FuelOutletPrice[] }>(`/v1/gas/outlets/${outletId}/prices`);
    },
    async updateGasOutletPrices(outletId: string, prices: { product_id: string; price_per_unit: number }[]) {
      return request<{ ok: true; updated: number }>(`/v1/gas/outlets/${outletId}/prices`, {
        method: "PUT",
        body: JSON.stringify({ prices }),
      });
    },
    async verifyGasCode(code: string, outletId?: string) {
      return request<{ valid: boolean; code: FuelCode; outlet_prices: FuelOutletPrice[] }>("/v1/gas/verify-code", {
        method: "POST",
        body: JSON.stringify({ code, outletId }),
      });
    },
    async dispenseGas(input: {
      code: string;
      outletId: string;
      productId: string;
      litres?: number;
      totalUgx?: number;
      pumpNumber?: number;
      attendantName?: string;
      odometer?: number;
    }) {
      return request<{ ok: true; receipt: FuelReceipt }>("/v1/gas/dispense", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async gasDispenses(outletId?: string) {
      const q = outletId ? `?outletId=${encodeURIComponent(outletId)}` : "";
      return request<{ dispenses: FuelReceipt[] }>(`/v1/gas/dispenses${q}`);
    },
    /** The signed-in customer's own fuel receipts. */
    async gasRiderDispenses() {
      return request<{ dispenses: FuelReceipt[] }>("/v1/gas/rider/dispenses");
    },
    async gasShiftSummary(outletId?: string) {
      const q = outletId ? `?outletId=${encodeURIComponent(outletId)}` : "";
      return request<{ summary: FuelShiftSummary }>(`/v1/gas/shift/summary${q}`);
    },
    async cancelRiderFuelCode() {
      return request<{ ok: true; refunded_ugx: number }>("/v1/gas/rider/cancel-code", { method: "POST", body: JSON.stringify({}) });
    },
    async generateRiderFuelCode(input: {
      vehiclePlate?: string;
      amountUgx: number;
      productId?: string;
      outletId?: string;
    }) {
      return request<{ ok: true; code: FuelCode }>("/v1/gas/rider/generate-code", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async getActiveRiderFuelCode() {
      return request<{ code: FuelCode | null }>("/v1/gas/rider/active-code");
    },
    async gasAttendantLogin(code: string, pin: string, outletId?: string) {
      return request<{
        ok: true;
        token: string;
        attendant: { id: string; code: string; name: string; phone: string; pump_lane: string; on_duty: boolean };
        outlet: FuelStationOutlet;
      }>("/v1/gas/attendants/login", {
        method: "POST",
        body: JSON.stringify({ code, pin, outletId }),
      });
    },
    async gasMe() {
      return request<{
        ok: true;
        attendant: { id: string; code: string; name: string; phone: string; pump_lane: string; on_duty: boolean };
        outlet: FuelStationOutlet;
      }>("/v1/gas/me");
    },
    async gasToggleDuty(onDuty: boolean) {
      return request<{ ok: true; on_duty: boolean }>("/v1/gas/attendants/toggle-duty", {
        method: "POST",
        body: JSON.stringify({ onDuty }),
      });
    },
    // Station Manager Portal Methods
    async gasManagerLogin(code: string | undefined, pin: string, outletId?: string) {
      return request<{
        ok: true;
        token: string;
        manager: FuelStationManager;
        outlet: FuelStationOutlet;
      }>("/v1/gas/manager/login", {
        method: "POST",
        body: JSON.stringify({ code, pin, outletId }),
      });
    },
    async gasManagerMe() {
      return request<{
        ok: true;
        manager: FuelStationManager;
        outlet: FuelStationOutlet;
      }>("/v1/gas/manager/me");
    },
    async gasManagerAttendants(outletId?: string, status?: string) {
      const params = new URLSearchParams();
      if (outletId) params.set("outletId", outletId);
      if (status) params.set("status", status);
      const q = params.toString() ? `?${params.toString()}` : "";
      return request<{ ok: true; attendants: FuelPumpAttendant[] }>(`/v1/gas/manager/attendants${q}`);
    },
    async gasManagerCommissionAttendant(data: {
      outletId: string;
      fullName: string;
      phone: string;
      attendantCode?: string;
      pumpLane?: string;
      pin?: string;
      approveImmediately?: boolean;
    }) {
      return request<{ ok: true; attendant: FuelPumpAttendant; temporary_pin?: string }>("/v1/gas/manager/attendants/commission", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    async gasManagerApproveAttendant(attendantId: string) {
      return request<{ ok: true; attendant: FuelPumpAttendant }>(`/v1/gas/manager/attendants/${encodeURIComponent(attendantId)}/approve`, {
        method: "POST",
      });
    },
    async gasManagerSuspendAttendant(attendantId: string) {
      return request<{ ok: true; attendant: FuelPumpAttendant }>(`/v1/gas/manager/attendants/${encodeURIComponent(attendantId)}/suspend`, {
        method: "POST",
      });
    },
    async gasManagerReactivateAttendant(attendantId: string) {
      return request<{ ok: true; attendant: FuelPumpAttendant }>(`/v1/gas/manager/attendants/${encodeURIComponent(attendantId)}/reactivate`, {
        method: "POST",
      });
    },
    async gasManagerReassignPump(attendantId: string, pumpLane: string) {
      return request<{ ok: true; attendant: FuelPumpAttendant }>(`/v1/gas/manager/attendants/${encodeURIComponent(attendantId)}/reassign-pump`, {
        method: "POST",
        body: JSON.stringify({ pumpLane }),
      });
    },
    async gasManagerResetPin(attendantId: string, pin?: string) {
      return request<{ ok: true; temporary_pin?: string }>(`/v1/gas/manager/attendants/${encodeURIComponent(attendantId)}/reset-pin`, {
        method: "POST",
        body: JSON.stringify({ pin }),
      });
    },
    async gasManagerDeleteAttendant(attendantId: string) {
      return request<{ ok: true }>(`/v1/gas/manager/attendants/${encodeURIComponent(attendantId)}`, {
        method: "DELETE",
      });
    },
    async gasManagerSalesSummary(outletId?: string, period = "today") {
      const q = outletId ? `?outletId=${encodeURIComponent(outletId)}&period=${encodeURIComponent(period)}` : `?period=${encodeURIComponent(period)}`;
      return request<{ ok: true; summary: FuelStationSalesSummary }>(`/v1/gas/manager/sales-summary${q}`);
    },
    async gasManagerTransactions(outletId?: string, limit = 50, offset = 0) {
      const q = outletId ? `?outletId=${encodeURIComponent(outletId)}&limit=${limit}&offset=${offset}` : `?limit=${limit}&offset=${offset}`;
      return request<{ ok: true; transactions: FuelReceipt[] }>(`/v1/gas/manager/transactions${q}`);
    },
    async gasManagerPayoutAccounts(outletId?: string) {
      const q = outletId ? `?outletId=${encodeURIComponent(outletId)}` : "";
      return request<{ ok: true; accounts: FuelStationPayoutAccount[] }>(`/v1/gas/manager/payout-accounts${q}`);
    },
    async gasManagerAddPayoutAccount(data: {
      outletId: string;
      type: "momo" | "bank";
      accountRef: string;
      accountName: string;
      networkOrBank: string;
      isPrimary?: boolean;
    }) {
      return request<{ ok: true; account: FuelStationPayoutAccount }>("/v1/gas/manager/payout-accounts", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    async gasManagerWithdrawals(outletId?: string) {
      const q = outletId ? `?outletId=${encodeURIComponent(outletId)}` : "";
      return request<{ ok: true; withdrawals: FuelStationWithdrawal[] }>(`/v1/gas/manager/withdrawals${q}`);
    },
    async gasManagerRequestWithdrawal(data: {
      outletId: string;
      amountUgx: number;
      destinationType: "momo" | "bank";
      destinationDetails: any;
    }) {
      return request<{ ok: true; withdrawal: FuelStationWithdrawal }>("/v1/gas/manager/withdrawals", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    ...workMethods(request),
    ...workAdminMethods(request),
    ...talentMethods(request),
    ...talentAdminMethods(request),
    ...educationMethods(request),
    ...videoAdsMethods(request),
    ...channelsMethods(request),
    /** A job photo as a Blob (private: the request carries the sign-in header, so it can't be a plain image URL). */
    async workPhotoBlob(photoId: string): Promise<Blob> {
      const res = await f(`${root}/v1/work/photos/${encodeURIComponent(photoId)}`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Couldn't load the photo.");
      return res.blob();
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** One dish row from GET /v1/food/nearby-items. */
export interface FoodNearbyItem {
  id: string; restaurantId: string; restaurantName: string; businessType: string;
  name: string; description: string | null; price: number; from: boolean;
  photoKey: string | null; updatedAt: string | null; isFeatured: boolean;
  prepTimeMinutes: number | null; badge: string | null; categoryName: string | null;
  distanceKm: number | null; isDemo: boolean;
}
