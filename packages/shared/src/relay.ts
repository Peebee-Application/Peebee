/** Relay delivery: a long parcel goes boda -> matatu -> boda. See apps/api/src/relay. */

export type RelayLegKind = "boda" | "matatu";
export type RelayLegStatus = "waiting" | "open" | "assigned" | "in_transit" | "arrived" | "done";

export type RelayDropMode = "stage" | "station";
/** door: a rider brings it (paid). collect: the customer collects at the station. pending: they choose once it arrives. */
export type RelayLastMile = "door" | "collect" | "pending";

export type RelayQuote = {
  /** The route's full name (older clients); show `direction` instead. */
  routeName: string;
  /** This trip's way along the route, written like a ticket: "KLA - EBB" or "EBB - KLA". */
  direction?: string;
  /** The route both ways: "KLA ⇄ EBB". */
  routeCode?: string;
  /** Every leg, to the door. */
  total: number;
  dropMode?: RelayDropMode;
  /** Station routes: where the matatu leaves it, and the price to collect there (legs 1 and 2). */
  station?: { name: string; address: string | null } | null;
  collectTotal?: number | null;
  /** True when the customer picks door or collect now; false when they choose once it arrives. */
  choiceAtOrder?: boolean;
  /** Stages near the customer where they can meet the matatu instead (admin setting); priced like collecting. */
  meetStages?: Array<{ id: string; name: string; distanceKm: number; isStation: boolean }>;
  legs: Array<{ leg: 1 | 2 | 3; kind: RelayLegKind; fromName: string; toName: string; distanceKm: number; fee: number }>;
};

/** The relay as the order page shows it. handoffCode is only sent to whoever is handing the parcel over. */
export type OrderRelay = {
  routeName: string | null;
  /** The matatu leg's way along the route: "KLA - EBB" or "EBB - KLA". */
  direction?: string | null;
  /** The route both ways: "KLA ⇄ EBB". */
  routeCode?: string | null;
  dropMode?: RelayDropMode;
  lastMile?: RelayLastMile;
  station?: { name: string; address: string | null; lat: number | null; lng: number | null; phone: string | null } | null;
  /** When the station received it, and when (and to whom) it was handed on. */
  heldAt?: string | null;
  releasedAt?: string | null;
  releasedTo?: "customer" | "rider" | null;
  /** Customer only, while it's waiting at the station: their collection code and the price of a rider instead. */
  collectCode?: string | null;
  sendRiderFee?: number;
  /** Meeting the matatu at a stage (until missed, when it goes on to the station). */
  meetStage?: { name: string; lat: number | null; lng: number | null } | null;
  missedAt?: string | null;
  /** Minutes until the matatu reaches the customer's stage or the station, from its live position. */
  etaMinutes?: number | null;
  legs: Array<{
    id: string;
    leg: 1 | 2 | 3;
    kind: RelayLegKind;
    fromName: string | null;
    fromLat: number | null;
    fromLng: number | null;
    toName: string | null;
    toLat: number | null;
    toLng: number | null;
    distanceKm: number | null;
    fee: number;
    status: RelayLegStatus;
    providerName: string | null;
    vehiclePlate: string | null;
    startedAt: string | null;
    handedOverAt: string | null;
    handoffCode?: string;
  }>;
};

export type RelayOpenLeg = {
  id: string;
  order_id: string;
  from_name: string;
  from_lat: number;
  from_lng: number;
  to_name: string;
  distance_km: number;
  fee: number;
  created_at: string;
  destination_area: string | null;
  destination_address: string | null;
  matatu_status: RelayLegStatus | null;
  vehicle_plate: string | null;
};

export type RelayRoute = {
  id: string;
  drop_mode?: RelayDropMode;
  name: string;
  stage_a_name: string;
  stage_a_lat: number;
  stage_a_lng: number;
  stage_b_name: string;
  stage_b_lat: number;
  stage_b_lng: number;
  parcel_fare: number;
  active: number;
  operators?: number;
  /** Stored short codes for the two ends (migration 0107); null when not set. */
  stage_a_code?: string | null;
  stage_b_code?: string | null;
  /** The codes shown: stored, or made from the stage names. */
  codes?: { a: string; b: string };
  /** "KLA ⇄ EBB". */
  route_code?: string;
  /** Both directions: ["KLA - EBB", "EBB - KLA"]. */
  directions?: [string, string];
};

export type RelayOperator = {
  user_id: string;
  route_id: string | null;
  route_name: string | null;
  /** The route both ways: "KLA ⇄ EBB". */
  route_code?: string | null;
  vehicle_plate: string;
  phone: string | null;
  status: "pending" | "approved" | "suspended";
  name?: string;
  account_phone?: string | null;
  parcels?: number;
  created_at: string;
  updated_at: string;
};

export type RelayOperatorWallet = {
  walletType: "relay_work";
  balance: number;
  environment: "live" | "sandbox";
  personalWalletActive: boolean;
  personalWalletActivationAvailable: boolean;
  providerWalletTransfersEnabled: boolean;
};

export type RelayOperatorParcels = {
  carrying: Array<{
    id: string; order_id: string; from_name: string; to_name: string; status: RelayLegStatus; handoff_code: string; started_at: string;
    /** This parcel's way along the route: "KLA - EBB". */
    direction?: string | null;
    last_mile_status: RelayLegStatus | null; last_rider_name: string | null;
    /** Set when the customer meets the matatu at this stage: hand it to them with their code. */
    meet_stage_name?: string | null; customer_name?: string | null; customer_phone?: string | null;
    /** For an in-app call to the customer meeting the matatu. */
    customer_id?: string | null;
  }>;
  incoming: Array<{ order_id: string; stage_name: string; stage: string; rider_name: string | null }>;
  recent: Array<{ id: string; order_id: string; from_name: string; to_name: string; handed_over_at: string; paid_amount: number | null; direction?: string | null }>;
};

export type RelaySettings = {
  enabled: boolean;
  minDistanceKm: number;
  maxAccessKm: number;
  lastMileRadiusKm: number;
  releasePerLeg: boolean;
  lastMileChoice?: "order" | "arrival";
  stationMaxKm?: number;
  stagePickup?: boolean;
  stageFallback?: boolean;
  matatuSpeedKmh?: number;
  arrivalNoticeMinutes?: number;
  /** Sandbox only: demo riders, matatu and petrol stations play the roles a tester leaves. */
  sandboxDemo?: boolean;
  sandboxDemoStepSeconds?: number;
  /** A relay order can be paid as soon as it is placed, before any rider (default on). */
  payBeforeRider?: boolean;
  /** "Direct" (one rider all the way) is promised in under this many hours (1-24, default 3). */
  directMaxHours?: number;
};

export type RelayRouteStage = {
  id: string; route_id: string; seq: number; name: string; lat: number; lng: number;
  outlet_id: string | null; outlet_name: string | null; station_brand: string | null; active: number;
};

export type RelayAdminOrder = {
  id: string;
  stage: string;
  createdAt: string;
  environment: string;
  legs: Array<{ leg: number; kind: RelayLegKind; fromName: string; toName: string; fee: number; status: RelayLegStatus; providerName: string | null; handedOverAt: string | null; paidAmount: number | null; paidAt: string | null }>;
};

/** A relayed order as anyone involved follows it (customer, riders, matatu, seller). */
export type RelayTrack = {
  order: {
    id: string; stage: string; type: string; createdAt: string;
    pickupArea: string | null; destinationArea: string | null; customerName: string | null; riderName: string | null;
    lat: number | null; lng: number | null; locationAt: string | null;
  };
  relay: OrderRelay;
  events: Array<{ stage: string; note: string; created_at: string }>;
};

/** The petrol station's view in the Peebee Gas app. */
export type RelayStationParcels = {
  incoming: Array<{ order_id: string; from_name: string; matatu_status: RelayLegStatus; vehicle_plate: string | null; operator_name: string | null; started_at: string | null }>;
  held: Array<{
    order_id: string; last_mile: RelayLastMile; held_at: string; customer_name: string | null; customer_phone: string | null;
    rider_status: RelayLegStatus | null; rider_name: string | null;
    /** Shown once a rider is on the way: the rider enters it to take the parcel. */
    release_code: string | null;
  }>;
  recent: Array<{ order_id: string; released_to: "customer" | "rider"; released_at: string; customer_name: string | null }>;
};

export type RelayStation = {
  id: string; name: string; address: string | null; lat: number | null; lng: number | null; status: string;
  /** 0 off, 1 live, 2 sandbox & practice only. */
  relay_drop: number; station_name: string; holding: number;
  /** The routes this station is a stage of (it serves only those). */
  routes?: string | null;
};

export type RelayMerchantOrder = { id: string; stage: string; created_at: string; destination_area: string | null; store_name: string; customer_name: string | null };

/** One rider's whole bag trip along the road: store to store in the shortest order, then to the customer. */
export type BagTrip = {
  legs: Array<{ fromName: string; toName: string; km: number }>;
  totalKm: number;
  /** The first store straight to the customer, and what the other stops add to it. */
  directKm: number;
  directFee: number;
  addedKm: number;
  addedFee: number;
  fee: number;
};
