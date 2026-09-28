import { PRACTICE_MODE_STORAGE_KEY, type PracticeRole } from "./practice.js";
import { roundFare } from "./fare.js";

const PRACTICE_STATE_VERSION = 2;
const PRACTICE_ORDER_ID = "practice-order";
const PRACTICE_LIST_ID = "practice-list";
const PRACTICE_PAYMENT_ID = "mpay_practice";
const PRACTICE_MERCHANT_ID = "merchant-practice";
const PRACTICE_OUTLET_ID = "outlet-practice";

type PracticeItem = { id: string; name: string; quantity: number; unitPrice: number; note: string | null };

type PracticeState = {
  version: number;
  role: PracticeRole;
  startedAt: number;
  hasOrder: boolean;
  riderClaimed: boolean;
  stage: string;
  autoAdvanceAt: number | null;
  orderType: "shopping" | "parcel";
  isRide: boolean;
  paymentRail: "escrow" | "float";
  items: PracticeItem[];
  total: number;
  deliveryFee: number;
  destinationArea: string;
  destinationAddress: string;
  merchantPaymentStatus: "none" | "awaiting_confirmation" | "available";
  merchantBalance: number;
  settlementStatus: "none" | "successful";
  settlementAmount: number;
  restaurantOpen: boolean;
};

const DEFAULT_ITEMS: PracticeItem[] = [
  { id: "practice-item-rice", name: "Rice", quantity: 2, unitPrice: 8_000, note: "2 kg packets" },
  { id: "practice-item-oil", name: "Cooking oil", quantity: 1, unitPrice: 9_000, note: null },
  { id: "practice-item-tomatoes", name: "Tomatoes", quantity: 1, unitPrice: 5_000, note: "Fresh and firm" },
];

function stateKey(role: PracticeRole) {
  return `tuma_practice_state_v${PRACTICE_STATE_VERSION}_${role}`;
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function initialState(role: PracticeRole): PracticeState {
  const isRider = role === "rider";
  const isSeller = role === "merchant" || role === "restaurant";
  return {
    version: PRACTICE_STATE_VERSION,
    role,
    startedAt: Date.now(),
    hasOrder: isRider,
    riderClaimed: false,
    stage: isRider ? "Match" : "Create",
    autoAdvanceAt: null,
    orderType: "shopping",
    isRide: false,
    paymentRail: "escrow",
    items: DEFAULT_ITEMS,
    total: 35_000,
    deliveryFee: 5_000,
    destinationArea: "Entebbe City",
    destinationAddress: "Kitoro Road",
    merchantPaymentStatus: isSeller ? "awaiting_confirmation" : "none",
    merchantBalance: 0,
    settlementStatus: "none",
    settlementAmount: 0,
    restaurantOpen: true,
  };
}

function saveState(state: PracticeState) {
  if (canUseStorage()) window.localStorage.setItem(stateKey(state.role), JSON.stringify(state));
}

function loadState(role: PracticeRole): PracticeState {
  if (!canUseStorage()) return initialState(role);
  try {
    const parsed = JSON.parse(window.localStorage.getItem(stateKey(role)) ?? "null") as PracticeState | null;
    if (parsed?.version === PRACTICE_STATE_VERSION && parsed.role === role) return advanceCustomerState(parsed);
  } catch {
    // A corrupt practice snapshot is disposable by design.
  }
  const state = initialState(role);
  saveState(state);
  return state;
}

function advanceCustomerState(state: PracticeState): PracticeState {
  if (state.role !== "customer" || state.autoAdvanceAt == null) return state;
  const elapsed = Date.now() - state.autoAdvanceAt;
  let stage = state.stage;
  if (elapsed >= 12_000 && ["Shop", "Deliver"].includes(stage)) stage = "Arrived";
  else if (elapsed >= 5_000 && stage === "Shop") stage = "Deliver";
  if (stage === state.stage) return state;
  const next = { ...state, stage };
  saveState(next);
  return next;
}

export function isPracticeMode(): boolean {
  return canUseStorage() && window.localStorage.getItem(PRACTICE_MODE_STORAGE_KEY) === "1";
}

export function practiceStartPath(role: PracticeRole): string {
  return role === "customer" || role === "rider" || role === "merchant" || role === "restaurant" ? "/" : "/account";
}

export function startPracticeMode(role: PracticeRole): string {
  if (canUseStorage()) {
    window.localStorage.setItem(PRACTICE_MODE_STORAGE_KEY, "1");
    saveState(initialState(role));
  }
  return practiceStartPath(role);
}

export function exitPracticeMode(role: PracticeRole) {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(PRACTICE_MODE_STORAGE_KEY);
  window.localStorage.removeItem(stateKey(role));
}

export function practicePaymentCode() {
  return PRACTICE_PAYMENT_ID;
}

export function isPracticeJourneyComplete(role: PracticeRole): boolean {
  const state = loadState(role);
  if (role === "customer" || role === "rider") return state.stage === "Settle";
  return state.merchantPaymentStatus === "available" || state.settlementStatus === "successful";
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function parseBody(init?: RequestInit): Record<string, unknown> {
  if (typeof init?.body !== "string") return {};
  try {
    return JSON.parse(init.body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function nowIso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function orderFor(state: PracticeState) {
  const riderAssigned = state.riderClaimed;
  return {
    id: PRACTICE_ORDER_ID,
    list_id: PRACTICE_LIST_ID,
    customer_id: "practice-customer",
    customer_name: "Amina",
    rider_id: riderAssigned ? "practice-rider" : null,
    rider_name: riderAssigned ? "Daniel" : null,
    matching_mode: "first_to_claim",
    stage: state.stage,
    type: state.orderType,
    payment_rail: state.paymentRail,
    funds_model: "merchant_allocations_v1",
    currency: "UGX",
    estimated_total: state.total,
    final_total: state.stage === "Create" ? null : state.total,
    delivery_fee: state.deliveryFee,
    pickup_area: state.orderType === "parcel" ? "Kampala Central" : null,
    pickup_address: state.orderType === "parcel" ? "Tuma Practice Pickup" : null,
    pickup_lat: state.orderType === "parcel" ? 0.3136 : null,
    pickup_lng: state.orderType === "parcel" ? 32.5811 : null,
    destination_area: state.destinationArea,
    destination_address: state.destinationAddress,
    destination_lat: 0.0612,
    destination_lng: 32.4637,
    distance_km: 3.4,
    matched_out_of_range: 0,
    voice_note_key: null,
    pin_code: "2468",
    eta_minutes: state.stage === "Deliver" ? 8 : null,
    restaurant_id: null,
    is_ride: state.isRide ? 1 : 0,
    rider_lat: null,
    rider_lng: null,
    rider_location_updated_at: null,
    created_at: nowIso(-12 * 60_000),
    updated_at: nowIso(),
  };
}

function itemsFor(state: PracticeState) {
  return state.items.map((item) => ({
    id: item.id,
    list_id: PRACTICE_LIST_ID,
    name: item.name,
    quantity: item.quantity,
    note: item.note,
    unit_price: item.unitPrice,
  }));
}

const STAGES = ["Create", "Match", "Fund", "Shop", "Deliver", "Arrived", "Handover", "Settle"];

function orderDetail(state: PracticeState) {
  const stageIndex = Math.max(0, STAGES.indexOf(state.stage));
  const events = STAGES.slice(0, stageIndex + 1).map((stage, index) => ({
    id: `practice-event-${stage.toLowerCase()}`,
    order_id: PRACTICE_ORDER_ID,
    stage,
    note: index === 0 ? "Practice order created" : null,
    actor_id: null,
    created_at: nowIso(-(stageIndex - index) * 2 * 60_000),
  }));
  return {
    order: orderFor(state),
    items: itemsFor(state),
    events,
    substitutions: [],
    payments: state.stage === "Create" || state.stage === "Match" ? [] : [{
      id: "practice-collection",
      order_id: PRACTICE_ORDER_ID,
      type: "collection",
      provider: "practice",
      provider_ref: "practice-only",
      msisdn: "0700000000",
      network: "mtn",
      amount: state.total,
      currency: "UGX",
      status: "successful",
      created_at: nowIso(-8 * 60_000),
    }],
    rating: null,
    feeProposals: [],
  };
}

function paymentFor(state: PracticeState) {
  return {
    id: PRACTICE_PAYMENT_ID,
    order_id: PRACTICE_ORDER_ID,
    merchant_id: PRACTICE_MERCHANT_ID,
    outlet_id: PRACTICE_OUTLET_ID,
    outlet_name: state.role === "restaurant" ? "Tuma Kitchen" : "Tuma Practice Mart",
    display_name: state.role === "restaurant" ? "Tuma Kitchen" : "Tuma Practice Mart",
    amount: 28_000,
    status: state.merchantPaymentStatus === "none" ? "awaiting_confirmation" : state.merchantPaymentStatus,
    confirmation_mode: "dual_confirm",
    rider_id: "practice-rider",
    rider_confirmed_at: nowIso(-60_000),
    merchant_confirmed_at: state.merchantPaymentStatus === "available" ? nowIso() : null,
    risk_state: state.merchantPaymentStatus === "available" ? "passed" : "pending",
    environment: "sandbox",
    receipt_reference: "PRACTICE-001",
    rider_name: "Daniel",
    created_at: nowIso(-60_000),
    updated_at: nowIso(),
  };
}

function merchantSummary(state: PracticeState) {
  const payment = paymentFor(state);
  return {
    id: payment.id,
    order_id: payment.order_id,
    outlet_id: payment.outlet_id,
    outlet_name: payment.outlet_name,
    amount: payment.amount,
    status: payment.status,
    confirmation_mode: payment.confirmation_mode,
    risk_state: payment.risk_state,
    receipt_reference: payment.receipt_reference,
    rider_id: payment.rider_id,
    rider_name: payment.rider_name,
    created_at: payment.created_at,
    updated_at: payment.updated_at,
  };
}

function sampleMerchant() {
  return {
    id: PRACTICE_MERCHANT_ID,
    legal_name: "Tuma Practice Retail Ltd",
    display_name: "Tuma Practice Mart",
    business_kind: "business",
    status: "active",
    trust_tier: "standard",
    registration_number: "PRACTICE-REG",
    tax_id: "PRACTICE-TIN",
    environment: "sandbox",
    member_role: "owner",
    kyc_status: "approved",
    has_owner_id_document: 1,
    has_business_document: 1,
    created_at: nowIso(-30 * 86_400_000),
    updated_at: nowIso(),
  };
}

function sampleRestaurant(state: PracticeState) {
  return {
    id: "restaurant-practice",
    owner_id: "practice-owner",
    name: "Tuma Kitchen",
    description: "A safe practice restaurant",
    cuisine: "Ugandan",
    phone: "0700000000",
    address: "Kampala Road",
    lat: 0.3136,
    lng: 32.5811,
    logo_key: null,
    cover_key: null,
    status: "active",
    is_open: state.restaurantOpen ? 1 : 0,
    open_time: "08:00",
    close_time: "22:00",
    merchant_id: PRACTICE_MERCHANT_ID,
    outlet_id: PRACTICE_OUTLET_ID,
    created_at: nowIso(-30 * 86_400_000),
    updated_at: nowIso(),
  };
}

function sampleRider(online = true) {
  return {
    user_id: "practice-rider",
    verified: 1,
    is_online: online ? 1 : 0,
    area: "Entebbe City",
    created_at: nowIso(-90 * 86_400_000),
    vehicle_info: "UFP 246P",
    rating: 4.9,
    momo_msisdn: "0700000000",
    first_name: "Daniel",
    last_name: "Kato",
    alt_phone: null,
    stage_address: "Kitoro Stage, Entebbe",
    home_address: "Entebbe City",
    stage_lat: 0.0612,
    stage_lng: 32.4637,
    stage_name: "Kitoro Riders Stage",
    stage_chairman_name: "Practice Chairman",
    stage_chairman_contact: "0700000001",
    emergency_contact_name: "Practice Contact",
    emergency_contact_phone: "0700000002",
    national_id_key: "practice",
    profile_photo_key: "practice",
    profile_completed_at: nowIso(-80 * 86_400_000),
  };
}

function sampleMenu() {
  const category = {
    id: "practice-category",
    restaurant_id: "restaurant-practice",
    name: "Popular meals",
    sort_order: 0,
    created_at: nowIso(-86_400_000),
    updated_at: nowIso(),
  };
  const item = {
    id: "practice-menu-item",
    restaurant_id: "restaurant-practice",
    category_id: category.id,
    name: "Chicken and rice",
    description: "Practice menu item",
    price: 18_000,
    photo_key: null,
    available: 1,
    prep_time_minutes: 25,
    sort_order: 0,
    badge: "trending",
    created_at: nowIso(-86_400_000),
    updated_at: nowIso(),
    options: [],
  };
  return { categories: [{ ...category, items: [item] }], uncategorizedItems: [] };
}

function practiceError(message = "That action is outside this practice scenario. Your live account was not changed.") {
  return jsonResponse({ error: "practice_action_unavailable", message }, 409);
}

function handlePracticeRequest(role: PracticeRole, path: string, method: string, body: Record<string, unknown>): Response {
  let state = loadState(role);
  const save = (patch: Partial<PracticeState>) => {
    state = { ...state, ...patch };
    saveState(state);
  };

  if (method === "GET" && path === "/v1/orders/active") {
    return jsonResponse({ activeOrder: state.hasOrder && state.stage !== "Settle" ? orderFor(state) : null, pendingFeeProposal: null });
  }
  if (method === "GET" && path.startsWith("/v1/lists/recent")) {
    return jsonResponse({ lists: state.hasOrder ? [{ id: PRACTICE_LIST_ID, listId: PRACTICE_LIST_ID, title: "Practice shopping list", status: state.stage === "Settle" ? "delivered" : "active", itemCount: state.items.length, updatedAt: nowIso(), riderFirstName: state.riderClaimed || role === "customer" ? "Daniel" : null, riderId: state.riderClaimed || role === "customer" ? "practice-rider" : null, riderHasPhoto: false, area: state.destinationArea, orderId: PRACTICE_ORDER_ID }] : [] });
  }
  if (method === "POST" && path === "/v1/lists") {
    const rawItems = Array.isArray(body.items) ? body.items as Array<Record<string, unknown>> : [];
    const items = rawItems.length > 0 ? rawItems.map((item, index) => ({ id: `practice-item-${index + 1}`, name: String(item.name ?? `Item ${index + 1}`), quantity: Number(item.quantity ?? 1), unitPrice: Number(item.unitCost ?? 0), note: typeof item.note === "string" ? item.note : null })) : DEFAULT_ITEMS;
    save({ items });
    return jsonResponse({ id: PRACTICE_LIST_ID, listId: PRACTICE_LIST_ID, title: String(body.title ?? "Practice shopping list"), status: "draft", itemCount: items.length, createdAt: nowIso(), nextPath: `/orders/lists/${PRACTICE_LIST_ID}` });
  }
  if (method === "POST" && path === "/v1/orders") {
    const type = body.type === "parcel" ? "parcel" : "shopping";
    const estimated = Number(body.estimatedTotal ?? 30_000);
    const deliveryFee = type === "parcel" ? roundFare(estimated, 3_000) : 5_000;
    save({ hasOrder: true, riderClaimed: false, stage: "Create", orderType: type, isRide: body.isRide === true, paymentRail: body.paymentRail === "float" ? "float" : "escrow", total: type === "shopping" ? estimated + deliveryFee : deliveryFee, deliveryFee, destinationArea: String(body.destinationArea ?? "Entebbe City"), destinationAddress: String(body.destinationAddress ?? "Kitoro Road"), merchantPaymentStatus: "none", autoAdvanceAt: null });
    return jsonResponse({ order: orderFor(state) });
  }
  if (method === "GET" && path === `/v1/orders/${PRACTICE_ORDER_ID}`) return jsonResponse(orderDetail(state));
  if (method === "GET" && path === `/v1/orders/${PRACTICE_ORDER_ID}/checkout`) return jsonResponse({ baseAmount: state.total, mobileMoney: state.total, wallet: state.total, cash: state.total });
  if (method === "POST" && path === `/v1/orders/${PRACTICE_ORDER_ID}/match`) {
    save({ riderClaimed: true, stage: "Match" });
    return jsonResponse({ order: orderFor(state) });
  }
  if (method === "POST" && path === `/v1/orders/${PRACTICE_ORDER_ID}/claim`) {
    save({ riderClaimed: true, stage: "Shop" });
    return jsonResponse({ order: orderFor(state) });
  }
  if (method === "POST" && path === `/v1/orders/${PRACTICE_ORDER_ID}/fund`) {
    save({ stage: "Shop", paymentRail: body.paymentMethod === "cash" ? "float" : "escrow", autoAdvanceAt: Date.now() });
    return jsonResponse({ order: orderFor(state), funded: true, rail: state.paymentRail, payment: { id: "practice-collection", status: "successful", network: "mtn" } });
  }
  if (method === "POST" && path === `/v1/orders/${PRACTICE_ORDER_ID}/deliver`) {
    if (state.orderType === "shopping" && state.merchantPaymentStatus !== "available") return practiceError("Confirm the practice merchant purchase first, just as you must in a live shopping job.");
    save({ stage: "Deliver" });
    return jsonResponse({ order: orderFor(state) });
  }
  if (method === "POST" && path === `/v1/orders/${PRACTICE_ORDER_ID}/arrived`) {
    save({ stage: role === "rider" ? "Handover" : "Arrived" });
    return jsonResponse({ order: orderFor(state) });
  }
  if (method === "POST" && path === `/v1/orders/${PRACTICE_ORDER_ID}/handover`) {
    save({ stage: "Settle" });
    return jsonResponse({ order: orderFor(state) });
  }
  if (method === "POST" && path === `/v1/orders/${PRACTICE_ORDER_ID}/settle`) {
    save({ stage: "Settle" });
    return jsonResponse({ order: orderFor(state) });
  }
  if (method === "POST" && path === `/v1/orders/${PRACTICE_ORDER_ID}/rate`) return jsonResponse({ ok: true, rating: Number(body.rating ?? 5), comment: body.comment ?? null, recommended: body.recommended === true });
  if (method === "POST" && path === `/v1/orders/${PRACTICE_ORDER_ID}/location`) return jsonResponse({ ok: true });

  if (method === "GET" && path === "/v1/riders/me") return jsonResponse({ rider: sampleRider(true) });
  if (method === "POST" && path === "/v1/riders/status") return jsonResponse({ rider: sampleRider(body.online !== false) });
  if (method === "GET" && path === "/v1/riders/me/orders") return jsonResponse({ orders: state.riderClaimed ? [orderFor(state)] : [] });
  if (method === "GET" && path === "/v1/riders/jobs/available") {
    const order = orderFor(state);
    return jsonResponse({ jobs: state.riderClaimed ? [] : [{ ...order, customer_name: "Amina", restaurant_name: null, distanceKm: 1.8, outOfServiceRange: false, applied: false }] });
  }
  if (method === "GET" && path === `/v1/riders/jobs/${PRACTICE_ORDER_ID}/preview`) return jsonResponse({ items: itemsFor(state) });
  if (method === "GET" && path === "/v1/riders/me/subscription") return jsonResponse({ subscription: { required: false, mode: "recurring", amount: 0, cadence: "weekly", status: "active", current: true, paidThrough: null } });
  if (method === "GET" && path === "/v1/riders/me/wallet") return jsonResponse({ balance: state.stage === "Settle" ? 45_000 : 40_000, withdrawals: [], depositRequired: false, requiredDeposit: 0, depositShortfall: 0 });

  if (method === "GET" && path === "/v1/wallet") return jsonResponse({ balance: 12_000, cap: 2_000_000, verified: true, ledger: [] });
  if (method === "GET" && path === "/v1/wallet/shares") return jsonResponse({ granted: [], received: [] });
  if (method === "GET" && path === "/v1/wallets") return jsonResponse({ wallets: [{ id: "primary", name: "Primary", balance: 12_000, isPrimary: true }], suggestedNames: ["Family Expenses", "Office Supplies", "Personal Savings", "Travel Fund"], maxWallets: 5 });
  if (method === "GET" && /^\/v1\/wallets\/[^/]+\/ledger$/.test(path)) return jsonResponse({ ledger: [] });
  if (method === "GET" && /^\/v1\/wallets\/[^/]+\/report$/.test(path)) return jsonResponse({ period: "month", totalIn: 12_000, totalOut: 0, net: 12_000, byType: [] });
  if (method === "GET" && path.startsWith("/v1/mobile-numbers")) return jsonResponse({ numbers: [{ id: "practice-number", owner_id: "practice-user", purpose: path.includes("withdrawal") ? "withdrawal" : "payment", phone: "0700000000", label: "Practice number", is_primary: 1, created_at: nowIso(-86_400_000), updated_at: nowIso() }] });
  if (method === "GET" && path === "/v1/locations") return jsonResponse({ locations: [{ id: "practice-location", user_id: "practice-user", label: "Practice home", area: "Entebbe City", address: "Kitoro Road", lat: 0.0612, lng: 32.4637, created_at: nowIso(-86_400_000) }] });

  if (method === "POST" && path === "/v1/merchant-payments") {
    save({ merchantPaymentStatus: "awaiting_confirmation" });
    return jsonResponse({ payment: paymentFor(state) });
  }
  if (method === "GET" && path === `/v1/merchant-payments/${PRACTICE_PAYMENT_ID}`) {
    if (role === "rider" && state.merchantPaymentStatus === "awaiting_confirmation") save({ merchantPaymentStatus: "available" });
    return jsonResponse({ payment: paymentFor(state) });
  }
  if (method === "POST" && path === `/v1/merchant-payments/${PRACTICE_PAYMENT_ID}/merchant-confirm`) {
    save({ merchantPaymentStatus: "available", merchantBalance: 28_000 });
    return jsonResponse({ payment: paymentFor(state) });
  }

  if (method === "GET" && path === "/v1/merchants/me") return jsonResponse({ merchants: [sampleMerchant()] });
  if (method === "GET" && /^\/v1\/merchants\/[^/]+\/balance$/.test(path)) return jsonResponse({ balance: { held: 0, available: state.merchantBalance, settling: 0, updated_at: nowIso() }, currency: "UGX", environment: "sandbox" });
  if (method === "GET" && /^\/v1\/merchants\/[^/]+\/payments$/.test(path)) return jsonResponse({ payments: [merchantSummary(state)] });
  if (method === "GET" && /^\/v1\/merchants\/[^/]+\/transactions$/.test(path)) return jsonResponse({ transactions: state.merchantBalance > 0 ? [{ id: "practice-transaction", kind: "merchant_purchase", reference_type: "merchant_payment", reference_id: PRACTICE_PAYMENT_ID, description: "Practice goods handover", created_at: nowIso(), amount: 28_000, purpose: "payable_available", currency: "UGX", environment: "sandbox" }] : [] });
  if (method === "GET" && /^\/v1\/merchants\/[^/]+\/disputes$/.test(path)) return jsonResponse({ disputes: [] });
  if (method === "GET" && /^\/v1\/merchants\/[^/]+\/outlets$/.test(path)) return jsonResponse({ outlets: [{ id: PRACTICE_OUTLET_ID, merchant_id: PRACTICE_MERCHANT_ID, category_id: "cat-retail", category_name: "Retail Shop", category_slug: "retail-shop", name: "Tuma Practice Outlet", code: "TUMA-DEMO", phone: "0700000000", address: "Kampala Road", lat: 0.3136, lng: 32.5811, status: "active", created_at: nowIso(-86_400_000), updated_at: nowIso() }] });
  if (method === "GET" && path === "/v1/merchant-categories") return jsonResponse({ categories: [{ id: "cat-retail", slug: "retail-shop", name: "Retail Shop" }] });
  if (method === "GET" && /^\/v1\/merchants\/[^/]+\/settlement-accounts$/.test(path)) return jsonResponse({ settlementAccounts: [{ id: "practice-settlement-account", type: "momo", provider: "mtn", account_name: "Tuma Practice Mart", network_or_bank: "MTN", status: "verified", is_primary: 1, verified_at: nowIso(-86_400_000), cooling_until: null, masked_account_ref: "070***0000" }] });
  if (method === "POST" && /^\/v1\/merchants\/[^/]+\/settlement-quotes$/.test(path)) {
    const amount = Number(body.amount ?? 0);
    return jsonResponse({ quote: { id: "practice-quote", amount, fee: 500, totalDebit: amount + 500, currency: "UGX", expiresInSeconds: 120 } });
  }
  if (method === "GET" && /^\/v1\/merchants\/[^/]+\/settlements$/.test(path)) return jsonResponse({ settlements: state.settlementStatus === "successful" ? [{ id: "practice-settlement", amount: state.settlementAmount, fee: 500, total_debit: state.settlementAmount + 500, mode: "instant", status: "successful", provider: "practice", provider_ref: "practice-only", failure_code: null }] : [] });
  if (method === "POST" && /^\/v1\/merchants\/[^/]+\/settlements$/.test(path)) {
    const amount = Math.max(0, state.merchantBalance - 500);
    save({ settlementStatus: "successful", settlementAmount: amount, merchantBalance: 0 });
    return jsonResponse({ settlement: { id: "practice-settlement", amount, fee: 500, total_debit: amount + 500, mode: "instant", status: "successful", provider: "practice", provider_ref: "practice-only", failure_code: null } });
  }
  if (method === "POST" && /\/v1\/merchants\/[^/]+\/settlements\/[^/]+\/refresh$/.test(path)) return jsonResponse({ settlement: { id: "practice-settlement", amount: state.settlementAmount, fee: 500, total_debit: state.settlementAmount + 500, mode: "instant", status: "successful", provider: "practice", provider_ref: "practice-only", failure_code: null } });

  if (method === "GET" && path === "/v1/restaurants/me") return jsonResponse({ restaurant: sampleRestaurant(state) });
  if (method === "PATCH" && path === "/v1/restaurants/me") {
    if (typeof body.isOpen === "boolean") save({ restaurantOpen: body.isOpen });
    return jsonResponse({ restaurant: sampleRestaurant(state) });
  }
  if (method === "GET" && path === "/v1/restaurants/me/menu") return jsonResponse(sampleMenu());

  if (method === "GET" && path === "/v1/chat/threads") return jsonResponse({ threads: [] });
  if (method === "GET" && path === "/v1/restaurants/me/chat") return jsonResponse({ threads: [] });
  if (method === "GET" && path.startsWith("/v1/calls/incoming")) return jsonResponse({ call: null });

  return practiceError();
}

/** A fail-closed fetch adapter. While practice is active, only settings and
 * identity reads reach the real API. Operational requests are answered from
 * browser-local sample state or rejected before leaving the device. */
export function createPracticeFetch(role: PracticeRole, realFetch: typeof fetch = fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isPracticeMode()) return realFetch(input, init);
    const request = input instanceof Request ? input : null;
    const url = new URL(request?.url ?? String(input), typeof window !== "undefined" ? window.location.origin : "http://localhost");
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    if (url.pathname === "/v1/settings" || url.pathname.startsWith("/v1/practice/") || (url.pathname === "/v1/auth/me" && method === "GET")) return realFetch(input, init);
    if (url.pathname === "/v1/auth/logout" && method === "POST") return jsonResponse({ ok: true });
    if (!url.pathname.startsWith("/v1/")) return realFetch(input, init);
    return handlePracticeRequest(role, url.pathname, method, parseBody(init));
  }) as typeof fetch;
}
