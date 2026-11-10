import { endServerPractice, isServerPractice } from "./practice-server.js";
import { practiceTalentRequest, resetPracticeTalent } from "./practice-talent.js";
import { practiceTaxipressRequest, rememberPracticeTaxipressOptions, resetPracticeTaxipress } from "./practice-taxipress.js";
import { practiceWalletView, practiceWalletBalance, practiceWalletSpend, practiceWalletRefund, resetPracticeWallet } from "./practice-wallet.js";
import { practiceWorkRequest, resetPracticeWork } from "./practice-work.js";
import { PRACTICE_MODE_STORAGE_KEY, type PracticeRole } from "./practice.js";
import { practiceModuleOn } from "./modules.js";
import { roundFare } from "./fare.js";
import { haversineKm } from "./geo.js";
import { demoFoodImage, demoFoodMenu } from "./demo-food.js";
// Practice mode is centred on Entebbe: its shops, food places and riders replace the Kampala-only demo catalogue here.
import {
  PRACTICE_ENTEBBE, PRACTICE_FOOD_RESTAURANTS as DEMO_FOOD_RESTAURANTS, PRACTICE_PRODUCTS as DEMO_MARKETPLACE_PRODUCTS,
  PRACTICE_SPOTLIGHT as DEMO_MARKETPLACE_SPOTLIGHT, PRACTICE_STORES as DEMO_MARKETPLACE_STORES, practiceFoodRestaurant as demoFoodRestaurant, practiceRider,
} from "./practice-entebbe.js";
import { practiceSpotlightPosts } from "./practice-spotlight-posts.js";
import { CAR_MODEL_CATALOG, isVipRate } from "./car-model-catalog.js";
import { EDUCATION_STREAMS } from "./education/types.js";
import { handleStudioSandbox } from "./education/studio-sandbox.js";
import {
  DEMO_INSTITUTIONS,
  DEMO_SPROUTS_ACTIVITIES,
  DEMO_SPROUTS_TIMER,
  DEMO_SPROUTS_COPLAY,
  DEMO_FOUNDATIONS_WORKSHEETS,
  DEMO_FOUNDATIONS_SUBMISSIONS,
  DEMO_FOUNDATIONS_MERITS,
  DEMO_ACADEMY_TIMETABLE,
  DEMO_ACADEMY_EXAM,
  DEMO_ACADEMY_REPORT_CARD,
  DEMO_COMPASS_COURSE,
  DEMO_COMPASS_PEER_REVIEW,
  DEMO_COMPASS_CREDENTIAL,
  DEMO_SKILLS_COURSE,
  DEMO_SKILLS_SUBMISSION,
  DEMO_SKILLS_LOGBOOK,
  DEMO_TUITION_INVOICE,
  DEMO_SUBSCRIPTION_PASSES,
  DEMO_GUARDIAN_ALERTS,
  DEMO_LIVE_MEETINGS,
  DEMO_LIVE_PARTICIPANTS,
  DEMO_TUTOR_CONTACTS,
  DEMO_LIVE_CHAT_MESSAGES,
  DEMO_CREATORS,
  DEMO_CREATOR_COURSES,
} from "./education/demo-data.js";

const PRACTICE_STATE_VERSION = 4;
const PRACTICE_ORDER_ID = "practice-order";
const PRACTICE_LIST_ID = "practice-list";
const PRACTICE_PAYMENT_ID = "mpay_practice";
const PRACTICE_MERCHANT_ID = "merchant-practice";
const PRACTICE_OUTLET_ID = "outlet-practice";
const PRACTICE_CAR_CATEGORY_ID = "practice-car-comfort";
/** Luxury and Ambulance services in practice mode, mirroring the live seeded car types. */
const PRACTICE_SPECIAL_CATEGORIES: readonly {id: string; kind: string; service_group: "luxury" | "ambulance"; name: string; seats: number; rate_per_km: number; minimum_fare: number; rate_per_hour: number; description: string; has_vehicles: number; rider: string}[] = [
  { id: "practice-luxury-sedan", kind: "passenger", service_group: "luxury", name: "Luxury Sedan", seats: 4, rate_per_km: 5_000, minimum_fare: 60_000, rate_per_hour: 40_000, description: "Executive sedan with a professional chauffeur - weddings, airport pickups and VIP events.", has_vehicles: 1, rider: "practice-car-driver-lux-1" },
  { id: "practice-luxury-suv", kind: "passenger", service_group: "luxury", name: "Luxury SUV", seats: 6, rate_per_km: 7_000, minimum_fare: 90_000, rate_per_hour: 60_000, description: "Premium SUV for bridal parties and celebrity transport.", has_vehicles: 1, rider: "practice-car-driver-lux-2" },
  { id: "practice-luxury-limo", kind: "passenger", service_group: "luxury", name: "Stretch Limousine", seats: 8, rate_per_km: 12_000, minimum_fare: 200_000, rate_per_hour: 120_000, description: "Red-carpet arrivals, proms and parties.", has_vehicles: 1, rider: "practice-car-driver-lux-2" },
  { id: "practice-ambulance-basic", kind: "passenger", service_group: "ambulance", name: "Basic Ambulance", seats: 2, rate_per_km: 4_000, minimum_fare: 50_000, rate_per_hour: 0, description: "Patient transport with a trained crew.", has_vehicles: 1, rider: "practice-car-driver-amb-1" },
  { id: "practice-ambulance-icu", kind: "passenger", service_group: "ambulance", name: "ICU Ambulance", seats: 2, rate_per_km: 8_000, minimum_fare: 120_000, rate_per_hour: 0, description: "Fully equipped intensive-care ambulance.", has_vehicles: 1, rider: "practice-car-driver-amb-1" },
];
type PracticeSpecialCategory = (typeof PRACTICE_SPECIAL_CATEGORIES)[number];
function practiceSpecialCategory(id: unknown): PracticeSpecialCategory | null { return PRACTICE_SPECIAL_CATEGORIES.find((category) => category.id === id) ?? null; }
function practiceDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return 0;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.sin(((lat2 - lat1) * Math.PI) / 360) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(((lng2 - lng1) * Math.PI) / 360) ** 2));
}
/** A boda delivery fee from the shop to the customer; a shop in Kampala means the long way (relay). */
function practiceDeliveryFee(fromLat: number | null, fromLng: number | null, toLat: number, toLng: number) {
  if (fromLat == null || fromLng == null) return 5_000;
  const km = practiceDistanceKm(fromLat, fromLng, toLat, toLng);
  if (km > 15) return 18_000;
  return Math.max(3_000, Math.round((3_000 + km * 800) / 500) * 500);
}
function practiceSpecialFare(category: PracticeSpecialCategory, distanceKm: number, hireHours: unknown) {
  const hours = category.service_group === "luxury" ? Math.min(24, Math.max(0, Math.floor(Number(hireHours) || 0))) : 0;
  return roundFare(distanceKm * category.rate_per_km, category.minimum_fare) + hours * category.rate_per_hour;
}
const PRACTICE_SPECIAL_RIDERS = [
  { id: "practice-car-driver-lux-1", name: "James Kiggundu", make: "Mercedes-Benz", model: "S-Class", size: "normal", tier: "comfort", plate: "UBA 001L" },
  { id: "practice-car-driver-lux-2", name: "Brenda Nalwoga", make: "Range Rover", model: "Vogue", size: "large", tier: "comfort", plate: "UBA 002L" },
  { id: "practice-car-driver-amb-1", name: "Dr. Moses Opio", make: "Toyota", model: "HiAce Ambulance", size: "large", tier: "comfort", plate: "UBA 999A" },
] as const;
const PRACTICE_CAR_RIDERS = [
  { id: "practice-car-driver-01", name: "Daniel Kato", make: "Toyota", model: "Wish (2013 Model)", size: "normal", tier: "convenient", plate: "UBM 314A", isVip: false, image: "/vehicles/toyota-wish-2013.svg", townDailyUgx: 120000, upcountryDailyUgx: 180000 },
  { id: "practice-car-driver-02", name: "Sarah Namusoke", make: "Range Rover", model: "Velar (2018 Model)", size: "normal", tier: "comfort", plate: "UBV 001V", isVip: true, image: "/vehicles/range-rover-velar-2018.svg", townDailyUgx: 1000000, upcountryDailyUgx: 1500000 },
  { id: "practice-car-driver-03", name: "Peter Okello", make: "Toyota", model: "Land Cruiser TX Kaweesi", size: "large", tier: "convenient", plate: "UBA 777K", isVip: false, image: "/vehicles/toyota-land-cruiser-tx-kaweesi.svg", townDailyUgx: 450000, upcountryDailyUgx: 500000 },
  { id: "practice-car-driver-04", name: "Amina Nankya", make: "Toyota", model: "Voxy (2014 Model)", size: "large", tier: "comfort", plate: "UBF 112T", isVip: true, image: "/vehicles/toyota-noah-2013.svg", townDailyUgx: 550000, upcountryDailyUgx: 650000 },
  { id: "practice-car-driver-05", name: "Mark Ssemanda", make: "Toyota", model: "Prado (Ronaldo 2008)", size: "normal", tier: "convenient", plate: "UBK 404R", isVip: false, image: "/vehicles/toyota-prado-ronaldo-2008.svg", townDailyUgx: 300000, upcountryDailyUgx: 350000 },
  { id: "practice-car-driver-06", name: "Joyce Akello", make: "Porsche", model: "Panamera (2013 Model)", size: "normal", tier: "comfort", plate: "UBP 911P", isVip: true, image: "/vehicles/porsche-panamera-2013.svg", townDailyUgx: 1200000, upcountryDailyUgx: 1500000 },
  { id: "practice-car-driver-07", name: "Isaac Mugisha", make: "Mercedes-Benz", model: "Station Wagon (2024)", size: "large", tier: "convenient", plate: "UBW 024M", isVip: true, image: "/vehicles/mercedes-benz-station-wagon-2024.svg", townDailyUgx: 1700000, upcountryDailyUgx: 2500000 },
  { id: "practice-car-driver-08", name: "Ruth Atim", make: "Toyota", model: "Noah (2013 Model)", size: "large", tier: "comfort", plate: "UBP 520B", isVip: true, image: "/vehicles/toyota-noah-2013.svg", townDailyUgx: 500000, upcountryDailyUgx: 600000 },
] as const;
/** Entebbe truck and van drivers for Move / Cargo bookings, one per cargo type. */
const PRACTICE_CARGO_RIDERS = [
  { id: "practice-car-driver-cargo-van", category: "peebee-cargo-van", label: "Cargo Van", name: "Samuel Lwanga", make: "Toyota", model: "Hiace panel van", size: "large", tier: "convenient", plate: "UBM 212V", owner: "Entebbe Haulage Co." },
  { id: "practice-car-driver-cargo-pickup", category: "peebee-cargo-pickup", label: "Pickup Truck (1 Ton)", name: "Paul Kyeyune", make: "Isuzu", model: "D-Max pickup", size: "large", tier: "convenient", plate: "UBN 408P", owner: "Kitoro Movers" },
  { id: "practice-car-driver-cargo-truck-3t", category: "peebee-cargo-truck-3t", label: "Box Truck (3 Ton)", name: "George Mwesigwa", make: "Isuzu", model: "NPR box truck", size: "large", tier: "convenient", plate: "UBP 631T", owner: "Entebbe Haulage Co." },
  { id: "practice-car-driver-cargo-truck-7t", category: "peebee-cargo-truck-7t", label: "Heavy Truck (7 Ton)", name: "Fred Tumusiime", make: "Hino", model: "500 heavy truck", size: "large", tier: "convenient", plate: "UBQ 097H", owner: "Lake Region Transporters" },
] as const;
/** Cargo categories RideModal falls back to (rate per km, minimum fare). */
const PRACTICE_CARGO_RATES: Record<string, readonly [number, number]> = {
  "peebee-cargo-van": [2_500, 15_000],
  "peebee-cargo-pickup": [3_500, 25_000],
  "peebee-cargo-truck-3t": [5_000, 45_000],
  "peebee-cargo-truck-7t": [8_000, 80_000],
};
/** Practice Boda pricing for multi-stop + Name your fare (mirrors the API's defaults). */
const PRACTICE_RIDE = { ratePerKm: 1_000, minimumFare: 3_000, stopFee: 1_000, maxStops: 3, minPercent: 70, maxPercent: 150, offerTtlMs: 10 * 60_000, counterTtlMs: 120_000, maxRaises: 5 };
const PRACTICE_RIDE_JOB_ID = "practice-ride-offer";
const PRACTICE_RIDE_JOB_STOPS: PracticeStop[] = [
  { area: "Garden City", address: "Yusuf Lule Road", lat: 0.3209, lng: 32.5917 },
  { area: "Bugolobi Market", address: "Bandali Rise", lat: 0.3176, lng: 32.6133 },
];

function practiceRideQuote(pickup: { lat: number; lng: number }, destination: { lat: number; lng: number }, stops: Array<{ lat: number; lng: number }>) {
  const points = [pickup, ...stops, destination];
  let km = 0;
  for (let i = 1; i < points.length; i++) km += haversineKm(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
  const base = roundFare(km * PRACTICE_RIDE.ratePerKm, PRACTICE_RIDE.minimumFare);
  const stopFees = stops.length * roundFare(PRACTICE_RIDE.stopFee);
  const quote = base + stopFees;
  const min = Math.min(quote, roundFare((quote * PRACTICE_RIDE.minPercent) / 100));
  const max = Math.max(quote, roundFare((quote * PRACTICE_RIDE.maxPercent) / 100));
  return { quote, base, stopFees, km, min, max };
}

function practiceOfferSummary(state: PracticeState) {
  if (state.fareOffer == null || state.fareQuote == null) return null;
  const min = Math.min(state.fareQuote, roundFare((state.fareQuote * PRACTICE_RIDE.minPercent) / 100));
  const max = Math.max(state.fareQuote, roundFare((state.fareQuote * PRACTICE_RIDE.maxPercent) / 100));
  const raises = state.fareRaises ?? 0;
  return {
    amount: state.fareOffer, quote: state.fareQuote, min, max,
    expiresAt: state.offerExpiresAt ? new Date(state.offerExpiresAt).toISOString() : null,
    expired: state.offerExpiresAt != null && state.offerExpiresAt <= Date.now(),
    raises, raisesLeft: Math.max(0, PRACTICE_RIDE.maxRaises - raises),
  };
}

function practiceCounters(state: PracticeState) {
  return (state.counters ?? [])
    .filter((c) => c.status === "pending" && c.expiresAt > Date.now())
    .sort((a, b) => a.amount - b.amount)
    .map((c) => ({ id: c.id, amount: c.amount, offer: state.fareOffer ?? 0, rider_id: `practice-${c.riderName.toLowerCase()}`, rider_name: c.riderName, rider_rating: c.rating, rider_verified: 1, expires_at: new Date(c.expiresAt).toISOString(), created_at: new Date(c.expiresAt - PRACTICE_RIDE.counterTtlMs).toISOString() }));
}

/** Practice stops progress on their own once the passenger is aboard: each stop is reached, then left. */
function practiceStops(state: PracticeState) {
  const stops = state.stops ?? [];
  const elapsed = state.autoAdvanceAt != null ? Date.now() - state.autoAdvanceAt : -1;
  const aboard = ["PickedUp", "Handover", "Settle"].includes(state.stage);
  return stops.map((stop, i) => {
    const arriveAt = 22_000 + i * 14_000;
    const status: "pending" | "arrived" | "done" = !aboard ? "pending" : state.stage !== "PickedUp" || elapsed >= arriveAt + 7_000 ? "done" : elapsed >= arriveAt ? "arrived" : "pending";
    return { position: i + 1, area: stop.area, address: stop.address, lat: stop.lat, lng: stop.lng, status, arrivedAt: status === "pending" ? null : nowIso(), departedAt: status === "done" ? nowIso() : null };
  });
}

function practiceRideJobOrder(job: PracticeRideJob) {
  return {
    id: PRACTICE_RIDE_JOB_ID, list_id: "practice-ride-list", customer_id: "practice-customer", customer_name: "Grace N.",
    rider_id: job.claimed ? "practice-rider" : null, rider_name: job.claimed ? "Daniel" : null,
    matching_mode: "first_to_claim", stage: job.stage, type: "parcel", payment_rail: "escrow", funds_model: "merchant_allocations_v1", currency: "UGX",
    estimated_total: job.total, final_total: job.stage === "Create" ? null : job.total, delivery_fee: job.total,
    pickup_area: "Kololo", pickup_address: "Acacia Avenue", pickup_lat: 0.3337, pickup_lng: 32.5934,
    destination_area: "Ntinda", destination_address: "Ntinda Shopping Centre", destination_lat: 0.3536, destination_lng: 32.6162,
    distance_km: 6.1, matched_out_of_range: 0, voice_note_key: null, pin_code: "1357", eta_minutes: job.stage === "Deliver" ? 6 : null,
    restaurant_id: null, is_ride: 1, rider_lat: null, rider_lng: null, rider_location_updated_at: null,
    fare_offer: 6_000, fare_offer_quote: 7_500, fare_offer_raises: 0, stop_count: job.stops.length,
    created_at: nowIso(-3 * 60_000), updated_at: nowIso(),
  };
}

function freshRideJob(): PracticeRideJob {
  return { claimed: false, stage: "Create", total: 6_000, counter: null, stageAt: Date.now(), stops: PRACTICE_RIDE_JOB_STOPS.map((s) => ({ ...s, status: "pending" as const })) };
}

const PRACTICE_RECENT_PLACES = [
  { area: "Kisementi", address: "Acacia Mall, Kisementi, Kampala", lat: 0.3373, lng: 32.5907 },
  { area: "Lugogo", address: "Garden City, Yusuf Lule Road, Kampala", lat: 0.3201, lng: 32.5924 },
  { area: "Entebbe", address: "Entebbe International Airport, Entebbe", lat: 0.0424, lng: 32.4435 },
];
const PRACTICE_PASSENGERS_KEY = "peebee_practice_passengers_v1";
const PRACTICE_RIDESHARE_TRIPS = [
  { route: "entebbe-kampala", from: ["Entebbe City", 0.0612, 32.4637] as const, to: ["Kampala", 0.3136, 32.5811] as const, driver: PRACTICE_CAR_RIDERS[0], price: 15_000 },
  { route: "kampala-entebbe", from: ["Kampala", 0.3136, 32.5811] as const, to: ["Entebbe City", 0.0612, 32.4637] as const, driver: PRACTICE_CAR_RIDERS[1], price: 15_000 },
  { route: "kampala-mukono", from: ["Kampala", 0.3136, 32.5811] as const, to: ["Mukono", 0.3533, 32.7553] as const, driver: PRACTICE_CAR_RIDERS[3], price: 10_000 },
  { route: "kampala-jinja", from: ["Kampala", 0.3136, 32.5811] as const, to: ["Jinja", 0.4244, 33.2042] as const, driver: PRACTICE_CAR_RIDERS[2], price: 25_000 },
];
const PRACTICE_RIDESHARE_HOURS = [6, 9, 13, 16] as const;
const coordinatePart = (value: number) => `${value < 0 ? "n" : "p"}${String(Math.abs(value)).padStart(4, "0")}`;
const decodeCoordinatePart = (value: string) => (value[0] === "n" ? -1 : 1) * Number(value.slice(1)) / 100;

function practiceRideshareTrip(id: string, nearLabel = "Nearby area") {
  const nearMatch = /^practice-rideshare-near-(\d{4}-\d{2}-\d{2})-([pn]\d{4})-([pn]\d{4})-(\d+)-(6|9|13|16)$/.exec(id);
  if (nearMatch) {
    const index = Number(nearMatch[4]);
    const destination = [
      { label: "City centre", lat: 0.06, lng: 0.04, price: 6_000 },
      { label: "Market district", lat: -0.04, lng: 0.08, price: 7_000 },
      { label: "Transit hub", lat: 0.08, lng: -0.05, price: 8_000 },
      { label: "Neighbouring town", lat: -0.08, lng: -0.07, price: 9_000 },
    ][index];
    const lat = decodeCoordinatePart(nearMatch[2]);
    const lng = decodeCoordinatePart(nearMatch[3]);
    const departure = new Date(`${nearMatch[1]}T${nearMatch[5].padStart(2, "0")}:00:00Z`);
    if (!destination || !Number.isFinite(departure.getTime()) || departure.getTime() <= Date.now() + 30 * 60_000) return null;
    return { id, route: `nearby-${index}`, from: [`Near ${nearLabel}`, lat, lng] as const,
      to: [destination.label, lat + destination.lat, lng + destination.lng] as const,
      driver: PRACTICE_CAR_RIDERS[index], price: destination.price, departure };
  }
  const match = /^practice-rideshare-(\d{4}-\d{2}-\d{2})-(.+)-(6|9|13|16)$/.exec(id);
  if (!match) return null;
  const route = PRACTICE_RIDESHARE_TRIPS.find((item) => item.route === match[2]);
  const departure = new Date(`${match[1]}T${match[3].padStart(2, "0")}:00:00Z`);
  return route && Number.isFinite(departure.getTime()) && departure.getTime() > Date.now() + 30 * 60_000 ? { ...route, id, departure } : null;
}
function practiceRideshareTrips(query: URLSearchParams) {
  const nearLatValue = query.get("nearLat"), nearLngValue = query.get("nearLng");
  const nearLat = Number(nearLatValue), nearLng = Number(nearLngValue);
  if (nearLatValue !== null && nearLngValue !== null && [nearLat, nearLng].every(Number.isFinite)) {
    const latitude = Math.round(nearLat * 100);
    const longitude = Math.round(nearLng * 100);
    const locationKey = `${coordinatePart(latitude)}-${coordinatePart(longitude)}`;
    const label = (query.get("nearLabel") ?? "Nearby area").replace(/[\u0000-\u001f]/g, " ").slice(0, 100).trim() || "Nearby area";
    const date = query.get("date");
    const today = new Date().toISOString().slice(0, 10);
    const days = date ? [date] : [today, new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)];
    return days.flatMap((day) => PRACTICE_RIDESHARE_HOURS.flatMap((hour) => PRACTICE_CAR_RIDERS.flatMap((_, index) => {
      const id = `practice-rideshare-near-${day}-${locationKey}-${index}-${hour}`;
      const trip = practiceRideshareTrip(id, label);
      if (!trip) return [];
      return [{ id, driverName: trip.driver.name, vehicle: `${trip.driver.make} ${trip.driver.model}`, originLabel: trip.from[0], destLabel: trip.to[0], departAt: trip.departure.toISOString(), seatsLeft: 3, seatPrice: trip.price, plate: (trip.driver as any).plate, isVip: (trip.driver as any).isVip ?? false, image: (trip.driver as any).image ?? null, townDailyUgx: (trip.driver as any).townDailyUgx ?? null, upcountryDailyUgx: (trip.driver as any).upcountryDailyUgx ?? null }];
    })));
  }
  const fromLat = Number(query.get("fromLat")), fromLng = Number(query.get("fromLng"));
  const toLat = Number(query.get("toLat")), toLng = Number(query.get("toLng"));
  if (![fromLat, fromLng, toLat, toLng].every(Number.isFinite)) return [];
  const day = query.get("date");
  const today = new Date().toISOString().slice(0, 10);
  const days = day ? [day] : [today, new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)];
  return days.flatMap((date) => PRACTICE_RIDESHARE_TRIPS.flatMap((route) => PRACTICE_RIDESHARE_HOURS.flatMap((hour) => {
    const trip = practiceRideshareTrip(`practice-rideshare-${date}-${route.route}-${hour}`);
    if (!trip || Math.abs(fromLat - route.from[1]) > .18 || Math.abs(fromLng - route.from[2]) > .18 || Math.abs(toLat - route.to[1]) > .18 || Math.abs(toLng - route.to[2]) > .18) return [];
    return [{ id: trip.id, driverName: route.driver.name, vehicle: `${route.driver.make} ${route.driver.model}`, originLabel: route.from[0], destLabel: route.to[0], departAt: trip.departure.toISOString(), seatsLeft: 3, seatPrice: route.price, plate: (route.driver as any).plate, isVip: (route.driver as any).isVip ?? false, image: (route.driver as any).image ?? null, townDailyUgx: (route.driver as any).townDailyUgx ?? null, upcountryDailyUgx: (route.driver as any).upcountryDailyUgx ?? null }];
  })));
}
const PRACTICE_RENTAL_PLATES = ["UBR 118A", "UBS 340B", "UBT 592C", "UBU 706D", "UBV 214E", "UBW 468F", "UBX 931G", "UAY 175H"] as const;
const PRACTICE_RENTALS_KEY = "peebee_practice_selfdrive_rentals_v1";
const PRACTICE_RENTAL_CARS = [
  ...CAR_MODEL_CATALOG.map((model, i) => {
    const dailyPrice = model.townDailyUgx ?? model.standardDailyUgx;
    const isVip = model.isVip ?? isVipRate(dailyPrice);
    const townDailyUgx = model.townDailyUgx ?? dailyPrice;
    const upcountryDailyUgx = model.upcountryDailyUgx ?? Math.round(dailyPrice * 1.3);
    const plate = model.pseudoPlate ?? PRACTICE_RENTAL_PLATES[i % PRACTICE_RENTAL_PLATES.length];
    const photos = model.image ? [model.image] : [];
    const ownerName = isVip
      ? ["Peebee VIP Fleet", "Entebbe VIP Chauffeurs", "Victoria Executive Cars"][i % 3]
      : ["Amina Car Rentals", "Entebbe Family Cars", "Lakeview Van Hire"][i % 3];
    return {
      id: `practice-rent-${model.id}`,
      name: `${model.make} ${model.model}${model.variant ? ` ${model.variant}` : ""}`,
      category: model.bodyType ?? (model.seats >= 7 ? "Family MPV" : "Saloon"),
      bodyType: model.bodyType,
      seats: model.seats,
      dailyPrice,
      townDailyUgx,
      upcountryDailyUgx,
      deposit: Math.round(dailyPrice / 2),
      rent: dailyPrice,
      hourlyPrice: Math.round((dailyPrice * 1.2) / 24),
      halfDayPrice: Math.round(dailyPrice * 0.6),
      notes: `${isVip ? "VIP Fleet" : "Owner"} · ${ownerName} · Entebbe pickup`,
      ownerName,
      plate,
      modelNumber: model.modelYear ? `${model.modelYear} Model` : undefined,
      isVip,
      hourlyEnabled: !isVip,
      halfDayEnabled: !isVip,
      fullDayEnabled: true,
      serviceClass: isVip || dailyPrice > 100_000 ? ("comfort" as const) : ("convenient" as const),
      condition: isVip || dailyPrice > 100_000 ? ("excellent" as const) : ("good" as const),
      fuelLitresPerKm: model.fuelLitresPerKm,
      luggageLitres: model.luggageLitres,
      luggageNote: model.luggageNote,
      standardDailyPrice: dailyPrice,
      features: model.features ?? (dailyPrice > 100_000 ? ["Air conditioning", "Bluetooth"] : ["Air conditioning"]),
      photos,
      image: model.image,
      driverPolicy: model.driverPolicy ?? "self_drive",
    };
  }),
  { id: "practice-rent-hiace", name: "White Toyota Hiace 2019", category: "Minibus", seats: 14, dailyPrice: 200_000, deposit: 100_000, rent: 200_000, hourlyPrice: 10_000, halfDayPrice: 120_000, notes: "Owner · Lakeview Van Hire · Entebbe pickup", ownerName: "Lakeview Van Hire", hourlyEnabled: false, halfDayEnabled: false, fullDayEnabled: true },
  { id: "practice-rent-dmax", name: "White Isuzu D-Max Double Cab 2021", category: "Pickup", seats: 5, dailyPrice: 220_000, deposit: 110_000, rent: 220_000, hourlyPrice: 11_000, halfDayPrice: 132_000, notes: "Owner · Kitoro Movers · Entebbe pickup", ownerName: "Kitoro Movers", hourlyEnabled: false, halfDayEnabled: true, fullDayEnabled: true },
  { id: "practice-rent-van", name: "Toyota Hiace panel van 2018", category: "Van", seats: 2, dailyPrice: 180_000, deposit: 90_000, rent: 180_000, hourlyPrice: 9_000, halfDayPrice: 108_000, notes: "Owner · Entebbe Haulage Co. · Entebbe pickup", ownerName: "Entebbe Haulage Co.", hourlyEnabled: false, halfDayEnabled: true, fullDayEnabled: true },
  { id: "practice-rent-suv", name: "Blue Nissan X-Trail 2022", category: "SUV", seats: 5, dailyPrice: 180_000, deposit: 90_000, rent: 180_000, hourlyPrice: 9_000, halfDayPrice: 108_000, notes: "Owner · Entebbe Family Cars · Entebbe pickup", ownerName: "Entebbe Family Cars", hourlyEnabled: true, halfDayEnabled: false, fullDayEnabled: false },
];

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
  carCategoryId: string | null;
  carServiceTier: "convenient" | "comfort";
  carVehicleSize: "normal" | "large";
  demoCarRiderId: string | null;
  paymentRail: "escrow" | "float";
  items: PracticeItem[];
  total: number;
  deliveryFee: number;
  destinationArea: string;
  destinationAddress: string;
  pickupAddress: string | null;
  pickupLat: number | null;
  pickupLng: number | null;
  destinationLat: number | null;
  destinationLng: number | null;
  merchantPaymentStatus: "none" | "awaiting_confirmation" | "available";
  merchantBalance: number;
  settlementStatus: "none" | "successful";
  settlementAmount: number;
  restaurantOpen: boolean;
  /** Multi-stop + Name your fare (customer side). Optional so older snapshots still load. */
  stops?: PracticeStop[];
  fareOffer?: number | null;
  fareQuote?: number | null;
  fareRaises?: number;
  offerAt?: number | null;
  offerExpiresAt?: number | null;
  counters?: PracticeCounter[];
  countersSeeded?: number;
  /** The rider whose counter the customer accepted (Name your fare). */
  acceptedRiderName?: string | null;
  /** Rider side: a practice boda ride with a customer offer and two stops. */
  rideJob?: PracticeRideJob;
  /** Shop or food order: where the rider collects it, and which Entebbe rider took it. */
  vendor?: { kind: "store" | "restaurant"; id: string; name: string; address: string; lat: number | null; lng: number | null } | null;
  riderIdx?: number;
  /** Fuel attendant: a sample relay parcel arriving by matatu, then collected. */
  relayParcel?: { status: "incoming" | "held" | "collected"; heldAt: string | null; releasedAt: string | null };
};

type PracticeStop = { area: string | null; address: string | null; lat: number; lng: number };
type PracticeCounter = { id: string; amount: number; riderName: string; rating: number; expiresAt: number; status: "pending" | "approved" | "rejected" };
type PracticeRideJob = {
  claimed: boolean;
  stage: string;
  total: number;
  counter: { amount: number; at: number; expiresAt: number } | null;
  stageAt: number;
  stops: Array<PracticeStop & { status: "pending" | "arrived" | "done" }>;
};

const DEFAULT_ITEMS: PracticeItem[] = [
  { id: "practice-item-rice", name: "Rice", quantity: 2, unitPrice: 8_000, note: "2 kg packets" },
  { id: "practice-item-oil", name: "Cooking oil", quantity: 1, unitPrice: 9_000, note: null },
  { id: "practice-item-tomatoes", name: "Tomatoes", quantity: 1, unitPrice: 5_000, note: "Fresh and firm" },
];

function stateKey(role: PracticeRole) {
  return `peebee_practice_state_v${PRACTICE_STATE_VERSION}_${role}`;
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
    carCategoryId: null,
    carServiceTier: "convenient",
    carVehicleSize: "normal",
    demoCarRiderId: null,
    paymentRail: "escrow",
    items: DEFAULT_ITEMS,
    total: 35_000,
    deliveryFee: 5_000,
    destinationArea: "Entebbe City",
    destinationAddress: "Kitoro Road",
    pickupAddress: null,
    pickupLat: null,
    pickupLng: null,
    destinationLat: null,
    destinationLng: null,
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
  if (state.role !== "customer" || state.autoAdvanceAt == null || ["Handover", "Settle", "Cancelled"].includes(state.stage)) return state;
  const elapsed = Date.now() - state.autoAdvanceAt;
  let stage = state.stage;
  // A shop or food order: the rider shops or waits for the kitchen, rides over, then arrives and rings.
  const [toDeliver, toArrived] = state.vendor ? [20_000, 50_000] : [5_000, 12_000];
  if (state.isRide) {
    stage = elapsed >= 15_000 ? "PickedUp" : elapsed >= 8_000 ? "Arrived" : "Deliver";
  } else if (elapsed >= toArrived && ["Shop", "Deliver"].includes(stage)) stage = "Arrived";
  else if (elapsed >= toDeliver && stage === "Shop") stage = "Deliver";
  if (stage === state.stage) return state;
  const next = { ...state, stage };
  saveState(next);
  return next;
}

export function isPracticeMode(): boolean {
  return canUseStorage() && window.localStorage.getItem(PRACTICE_MODE_STORAGE_KEY) === "1";
}

export function practiceStartPath(role: PracticeRole): string {
  return role === "customer" || role === "rider" || role === "merchant" || role === "restaurant" || role === "gas" || role === "learner" ? "/" : "/account";
}

export function startPracticeMode(role: PracticeRole): string {
  if (canUseStorage()) {
    window.localStorage.setItem(PRACTICE_MODE_STORAGE_KEY, "1");
    resetPracticeTalent();
    resetPracticeWork();
    resetPracticeTaxipress();
    resetPracticeWallet();
    saveState(initialState(role));
  }
  return practiceStartPath(role);
}

export function exitPracticeMode(role: PracticeRole) {
  if (!canUseStorage()) return;
  if (endServerPractice()) return;
  window.localStorage.removeItem(PRACTICE_MODE_STORAGE_KEY);
  window.localStorage.removeItem(stateKey(role));
  resetPracticeTalent();
  resetPracticeWork();
  resetPracticeTaxipress();
  resetPracticeWallet();
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
  // A Name-your-fare boda ride is matched to the rider whose counter was accepted, not a demo car.
  const car = state.isRide && !state.acceptedRiderName;
  return {
    id: PRACTICE_ORDER_ID,
    list_id: PRACTICE_LIST_ID,
    customer_id: "practice-customer",
    customer_name: state.isRide ? "Grace N." : "Amina",
    rider_id: riderAssigned ? (car ? (state.demoCarRiderId ?? PRACTICE_CAR_RIDERS[0].id) : "practice-rider") : null,
    rider_name: riderAssigned ? (car ? practiceCar(state.demoCarRiderId).driver : state.acceptedRiderName ?? (state.vendor ? practiceRider(state.riderIdx).name : "Daniel")) : null,
    car_category_name: car ? practiceCar(state.demoCarRiderId).name : null,
    car_make: car ? practiceCar(state.demoCarRiderId).make : null,
    car_model: car ? practiceCar(state.demoCarRiderId).model : null,
    car_plate: car ? practiceCar(state.demoCarRiderId).plate : null,
    car_driver_name: riderAssigned && car ? practiceCar(state.demoCarRiderId).driver : null,
    car_owner_name: car ? practiceCar(state.demoCarRiderId).owner : null,
    matching_mode: "first_to_claim",
    stage: state.stage,
    type: state.orderType,
    payment_rail: state.paymentRail,
    funds_model: "merchant_allocations_v1",
    currency: "UGX",
    estimated_total: state.total,
    final_total: state.stage === "Create" ? null : state.total,
    delivery_fee: state.deliveryFee,
    pickup_area: state.vendor ? state.vendor.address.split(",").pop()!.trim() : state.orderType === "parcel" ? "Kampala Central" : null,
    pickup_address: state.vendor?.address ?? state.pickupAddress ?? (state.orderType === "parcel" ? "Peebee Practice Pickup" : null),
    pickup_lat: state.vendor?.lat ?? state.pickupLat ?? (state.orderType === "parcel" ? 0.3136 : null),
    pickup_lng: state.vendor?.lng ?? state.pickupLng ?? (state.orderType === "parcel" ? 32.5811 : null),
    destination_area: state.destinationArea,
    destination_address: state.destinationAddress,
    destination_lat: state.destinationLat ?? PRACTICE_ENTEBBE.lat,
    destination_lng: state.destinationLng ?? PRACTICE_ENTEBBE.lng,
    distance_km: 3.4,
    matched_out_of_range: 0,
    voice_note_key: null,
    pin_code: "2468",
    eta_minutes: state.stage === "Deliver" ? 8 : null,
    restaurant_id: state.vendor?.kind === "restaurant" ? state.vendor.id : null,
    restaurant_name: state.vendor?.kind === "restaurant" ? state.vendor.name : undefined,
    store_name: state.vendor?.kind === "store" ? state.vendor.name : undefined,
    is_ride: state.isRide ? 1 : 0,
    rider_lat: null,
    rider_lng: null,
    rider_location_updated_at: null,
    fare_offer: state.fareOffer ?? null,
    fare_offer_quote: state.fareQuote ?? null,
    fare_offer_expires_at: state.offerExpiresAt ? new Date(state.offerExpiresAt).toISOString() : null,
    fare_offer_raises: state.fareRaises ?? 0,
    stop_count: (state.stops ?? []).length,
    created_at: nowIso(-12 * 60_000),
    updated_at: nowIso(),
  };
}

function practiceCar(riderId: string | null) {
  const cargo = PRACTICE_CARGO_RIDERS.find((entry) => entry.id === riderId);
  if (cargo) return { name: cargo.label, make: cargo.make, model: cargo.model, plate: cargo.plate, owner: cargo.owner, driver: cargo.name };
  const rider = [...PRACTICE_CAR_RIDERS, ...PRACTICE_SPECIAL_RIDERS].find((entry) => entry.id === riderId) ?? PRACTICE_CAR_RIDERS[0];
  return { name: riderId?.startsWith("practice-car-driver-lux-") ? "Luxury" : riderId?.startsWith("practice-car-driver-amb-") ? "Ambulance" : rider.size === "large" ? "Large · 5–7 seats" : "Normal · 3–4 seats", make: rider.make, model: rider.model, plate: rider.plate, owner: "Entebbe Cab Owners", driver: rider.name };
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
  return { ...orderDetailBase(state), ...((state.stops ?? []).length ? { rideStops: practiceStops(state) } : {}), ...(state.fareOffer != null ? { fareOffer: practiceOfferSummary(state) } : {}) };
}

function orderDetailBase(state: PracticeState) {
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
    outlet_name: state.role === "restaurant" ? "Peebee Kitchen" : "Peebee Practice Mart",
    display_name: state.role === "restaurant" ? "Peebee Kitchen" : "Peebee Practice Mart",
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
    legal_name: "Peebee Practice Retail Ltd",
    display_name: "Peebee Practice Mart",
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
    name: "Peebee Kitchen",
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

/**
 * The Practice switches from admin → Services, applied to the simulated API the way the real API applies the Live ones.
 * Most routes of a switched-off module answer 403 like the live service-paused refusal; the configuration reads that the
 * apps use to decide what to show come back as "off" instead, so tiles disappear rather than error.
 */
const PRACTICE_MODULE_PREFIXES: ReadonlyArray<readonly [prefix: string, module: string, label: string]> = [
  ["/v1/car/rentals", "ride.car.selfdrive", "Self-drive hire"],
  ["/v1/car/carpool", "ride.car.carpool", "Carpool"],
  ["/v1/car/deals", "ride.car.deals", "Owner-driver deals"],
  ["/v1/car/", "ride.car", "Peebee Car"],
  ["/v1/taxipress/", "ride.taxipress", "Taxipress"],
  ["/v1/orders/practice-tp-order-", "ride.taxipress", "Taxipress"],
  ["/v1/relay/", "deliver.relay", "Relay delivery"],
  ["/v1/pharmacy/", "buy.pharmacy", "Pharmacy"],
  ["/v1/marketplace/", "buy.marketplace", "The marketplace"],
  ["/v1/guest/", "buy.guest", "Guest checkout"],
  ["/v1/gas/", "buy.gas", "Fuel"],
  ["/v1/work/", "hive.work", "Home services"],
  ["/v1/talent/", "hive.hire", "Peebee Hire"],
  ["/v1/education/", "learn", "Peebee Learn"],
];

function practiceModuleGate(path: string, method: string, body: Record<string, unknown>): Response | null {
  const paused = (label: string) => jsonResponse({ error: "service_paused", message: `${label} is switched off in Practice right now.` }, 403);
  if (method === "POST" && path === "/v1/orders" && body.isRide && !practiceModuleOn("ride.boda")) return paused("Boda rides");
  for (const [prefix, module, label] of PRACTICE_MODULE_PREFIXES) {
    if (!path.startsWith(prefix) || practiceModuleOn(module)) continue;
    if (path === "/v1/talent/config") return jsonResponse({ enabled: false, workerSearchEnabled: false });
    if (path === "/v1/guest/config") return jsonResponse({ enabled: false, browsingEnabled: false, cardAvailable: false, maxQuantity: 1, suggestAccount: false, codeStatusEnabled: false });
    if (path === "/v1/taxipress/config") return jsonResponse({ enabled: false, routes: [], cashEnabled: false, seatChoiceFeeUgx: 0, returnDiscountPercent: 0, maxSeatsPerBooking: 0, payWithinMinutes: 0, parcelFitText: "", parcelNotAllowed: [] });
    return paused(label);
  }
  return null;
}

const PRACTICE_GUEST_KEY = "peebee_practice_guest_orders_v1";
type PracticeGuestOrder = { code: string; orderId: string; item: string; placedAt: number; total: number };
const readGuestOrders = (): PracticeGuestOrder[] => { try { return canUseStorage() ? JSON.parse(window.localStorage.getItem(PRACTICE_GUEST_KEY) ?? "[]") : []; } catch { return []; } };

/** Guest checkout in practice: a shared product link bought without an account, then tracked by code. Status moves on by itself. */
function practiceGuestRequest(path: string, method: string, body: Record<string, unknown>): Response {
  if (method === "GET" && path === "/v1/guest/config") return jsonResponse({ enabled: true, browsingEnabled: false, cardAvailable: false, maxQuantity: 5, suggestAccount: true, codeStatusEnabled: true });
  if (method === "POST" && path === "/v1/guest/checkout") {
    const productId = String(body.productId ?? "");
    const quantity = Math.floor(Number(body.quantity));
    const product = Object.values(DEMO_MARKETPLACE_PRODUCTS).flat().find((p) => p.id === productId);
    if (!product || !(quantity >= 1 && quantity <= 5)) return practiceError("Choose a practice product and one to five of it.");
    if (!String(body.name ?? "").trim() || !String(body.phone ?? "").trim() || !String(body.address ?? "").trim()) return practiceError("Enter a name, phone number and address.");
    const code = `PB-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const total = product.price * quantity + 3_000;
    const order: PracticeGuestOrder = { code, orderId: `practice-guest-${Date.now()}`, item: product.title, placedAt: Date.now(), total };
    if (canUseStorage()) window.localStorage.setItem(PRACTICE_GUEST_KEY, JSON.stringify([order, ...readGuestOrders()].slice(0, 20)));
    return jsonResponse({ orderId: order.orderId, trackingCode: code, token: "practice-guest-token", total, accountCreated: false, existingAccount: false }, 201);
  }
  const track = path.match(/^\/v1\/guest\/track\/([^/]+)$/);
  if (method === "GET" && track) {
    const order = readGuestOrders().find((o) => o.code === decodeURIComponent(track[1]!).toUpperCase());
    if (!order) return jsonResponse({ error: "not_found", message: "We couldn't find that tracking code." }, 404);
    const elapsed = Date.now() - order.placedAt;
    const status = elapsed < 10_000 ? "received" : elapsed < 25_000 ? "preparing" : elapsed < 45_000 ? "on_the_way" : elapsed < 60_000 ? "arrived" : "delivered";
    return jsonResponse({ trackingCode: order.code, placedAt: new Date(order.placedAt).toISOString(), canCreateAccount: true, hasAccount: false, codeStatusEnabled: true, item: order.item, status });
  }
  return practiceError("Creating an account from a guest order isn't part of practice. Your live account was not changed.");
}

function handlePracticeRequest(role: PracticeRole, path: string, method: string, body: Record<string, unknown>, query = new URLSearchParams()): Response {
  let state = loadState(role);
  const save = (patch: Partial<PracticeState>) => {
    state = { ...state, ...patch };
    saveState(state);
  };

  const paused = practiceModuleGate(path, method, body);
  if (paused) return paused;

  if (role === "customer" && path.startsWith("/v1/guest/")) return practiceGuestRequest(path, method, body);
  if (role === "customer" && path.startsWith("/v1/talent/")) return practiceTalentRequest(path, method, body, query);
  if (role === "customer" && path.startsWith("/v1/work/")) return practiceWorkRequest(path, method, body, query);
  if (role === "customer" && (path.startsWith("/v1/taxipress/") || path.startsWith("/v1/taxipress-ticket/") || path.startsWith("/v1/orders/practice-tp-order-") || path.startsWith("/v1/public/receipts/practice-"))) return practiceTaxipressRequest(path, method, body);

  if (role === "customer" && method === "GET") {
    if (path === "/v1/car/rentals/listings") return jsonResponse({ days: 1, vehicles: PRACTICE_RENTAL_CARS });
    if (path === "/v1/car/rentals/mine") return jsonResponse({ rentals: canUseStorage() ? JSON.parse(window.localStorage.getItem(PRACTICE_RENTALS_KEY) ?? "[]") : [] });
    if (path === "/v1/car/rentals/renter-profile") return jsonResponse({ status: "approved", isSimulated: true, ninMasked: "••••••••••0000", residentialAddress: "Practice address · Entebbe", residenceMethod: "bill", hasNationalId: true, hasRentReceipt: false, hasLandlordLetter: false, hasResidenceBill: true, tenancyStart: null, tenancyEnd: null, reviewNotes: null });
    if (path === "/v1/car/config") return jsonResponse({ onDemandEnabled: practiceModuleOn("ride.car.ondemand"), matchingMode: "first_to_claim", emergencyNumber: "999", maxHireHours: 24, scheduled: practiceModuleOn("ride.car.scheduled") ? { maxAdvanceHours: 72, minLeadMinutes: 30 } : null, carpool: practiceModuleOn("ride.car.carpool") ? { maxSeatsPerBooking: 3, maxRepeatWeeks: 0 } : null, selfDrive: practiceModuleOn("ride.car.selfdrive") ? { maxDays: 7 } : null, serviceTiers: { ratePerKm: 2_000, minimumFare: 8_000, comfortPremiumPercent: 30, xlPremiumPercent: 50, xlMinSeats: 6 }, vehiclePhotos: false, kyc: null, deals: null, categories: [
      { id: PRACTICE_CAR_CATEGORY_ID, kind: "passenger", name: "Normal · Saloon", seats: 4, cargo_type: null, size_label: null, reference_image_key: null, rate_per_km: 2_000, minimum_fare: 8_000 },
      { id: "practice-car-large", kind: "passenger", name: "Large · Minivan", seats: 7, cargo_type: null, size_label: null, reference_image_key: null, rate_per_km: 3_000, minimum_fare: 12_000 },
      ...PRACTICE_SPECIAL_CATEGORIES.filter((category) => practiceModuleOn(category.service_group === "luxury" ? "ride.luxury" : "ride.ambulance")).map(({ rider: _rider, ...category }) => ({ ...category, cargo_type: null, size_label: null, reference_image_key: null })),
    ] });
    if (path === "/v1/car/category-nearby") return jsonResponse({ nearby: practiceSpecialCategory(query.get("categoryId")) ? 1 : 2 });
    if (path === "/v1/car/carpool/trips") return jsonResponse({ trips: practiceRideshareTrips(query), maxSeatsPerBooking: 3 });
    if (path === "/v1/car/service-options") {
      const lat1 = Number(query.get("pickupLat")), lng1 = Number(query.get("pickupLng")), lat2 = Number(query.get("destinationLat")), lng2 = Number(query.get("destinationLng"));
      const valid = [lat1, lng1, lat2, lng2].every(Number.isFinite);
      const distanceKm = valid ? 6371 * 2 * Math.asin(Math.sqrt(Math.sin(((lat2 - lat1) * Math.PI) / 360) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(((lng2 - lng1) * Math.PI) / 360) ** 2)) : 0;
      const baseFare = roundFare(distanceKm * 2_000, 8_000);
      const options = (["normal", "large"] as const).flatMap((size) => (["convenient", "comfort"] as const).map((tier) => ({ size, tier, fare: roundFare(baseFare * (size === "large" ? 1.5 : 1) * (tier === "comfort" ? 1.3 : 1), 0), nearby: 2 })));
      return jsonResponse({ distanceKm: Math.round(distanceKm * 10) / 10, options });
    }
    if (path === "/v1/restaurants") return jsonResponse({ restaurants: DEMO_FOOD_RESTAURANTS });
    const detail = path.match(/^\/v1\/restaurants\/(demo-food-[^/]+)$/);
    if (detail && demoFoodRestaurant(detail[1])) return jsonResponse({ restaurant: demoFoodRestaurant(detail[1]) });
    const menu = path.match(/^\/v1\/restaurants\/(demo-food-[^/]+)\/menu$/);
    if (menu && demoFoodMenu(menu[1])) return jsonResponse(demoFoodMenu(menu[1]));
    const photo = path.match(/^\/v1\/restaurants\/menu-items\/([^/]+)\/photo$/);
    const image = photo ? demoFoodImage(photo[1]) : undefined;
    if (image) return new Response(image, { headers: { "Content-Type": "image/svg+xml" } });

    if (path === "/v1/marketplace/stores") {
      const cat = query.get("category");
      let stores = cat ? DEMO_MARKETPLACE_STORES.filter((s) => s.category === cat) : [...DEMO_MARKETPLACE_STORES];
      const latParam = query.get("lat");
      const lngParam = query.get("lng");
      const userLat = latParam != null && latParam !== "" ? parseFloat(latParam) : null;
      const userLng = lngParam != null && lngParam !== "" ? parseFloat(lngParam) : null;
      if (userLat != null && !isNaN(userLat) && userLng != null && !isNaN(userLng)) {
        stores = stores.map((s) => {
          const sLat = typeof s.lat === "number" ? s.lat : null;
          const sLng = typeof s.lng === "number" ? s.lng : null;
          const distanceKm = sLat != null && sLng != null
            ? Math.round(haversineKm(userLat, userLng, sLat, sLng) * 10) / 10
            : null;
          return {
            ...s,
            distance_km: distanceKm,
          };
        });
        stores.sort((a, b) => {
          const distA = typeof a.distance_km === "number" ? a.distance_km : 999999;
          const distB = typeof b.distance_km === "number" ? b.distance_km : 999999;
          return distA - distB;
        });
      }
      return jsonResponse({ stores });
    }
    const storeDetail = path.match(/^\/v1\/marketplace\/stores\/([^/]+)$/);
    if (storeDetail) {
      let store = DEMO_MARKETPLACE_STORES.find((s) => s.id === storeDetail[1] || s.slug === storeDetail[1]);
      if (store) {
        const latParam = query.get("lat");
        const lngParam = query.get("lng");
        const userLat = latParam != null && latParam !== "" ? parseFloat(latParam) : null;
        const userLng = lngParam != null && lngParam !== "" ? parseFloat(lngParam) : null;
        if (userLat != null && !isNaN(userLat) && userLng != null && !isNaN(userLng)) {
          const sLat = typeof store.lat === "number" ? store.lat : null;
          const sLng = typeof store.lng === "number" ? store.lng : null;
          const distanceKm = sLat != null && sLng != null
            ? Math.round(haversineKm(userLat, userLng, sLat, sLng) * 10) / 10
            : null;
          store = { ...store, distance_km: distanceKm };
        }
        return jsonResponse({ store });
      }
    }
    const storeProducts = path.match(/^\/v1\/marketplace\/stores\/([^/]+)\/products$/);
    if (storeProducts) {
      const products = DEMO_MARKETPLACE_PRODUCTS[storeProducts[1]] || [];
      return jsonResponse({ products });
    }
    const productDetail = path.match(/^\/v1\/marketplace\/products\/([^/]+)$/);
    if (productDetail) {
      const pid = productDetail[1];
      for (const [storeId, prods] of Object.entries(DEMO_MARKETPLACE_PRODUCTS)) {
        const prod = prods.find((p) => p.id === pid || p.slug === pid);
        if (prod) {
          const store = DEMO_MARKETPLACE_STORES.find((s) => s.id === storeId);
          return jsonResponse({ product: prod, store });
        }
      }
    }
    if (path === "/v1/marketplace/live") {
      return jsonResponse({ liveChannels: DEMO_MARKETPLACE_STORES.filter((s) => s.is_live === 1) });
    }
    if (path === "/v1/marketplace/spotlight") {
      const cat = query.get("category");
      let spotlight = DEMO_MARKETPLACE_SPOTLIGHT;
      if (cat && cat !== "all") {
        if (cat === "live") {
          spotlight = spotlight.filter((item) => item.type === "live");
        } else {
          spotlight = spotlight.filter((item) => item.store_category === cat);
        }
      }
      return jsonResponse({ spotlight });
    }
  }

  if (role === "customer" && method === "POST" && path === "/v1/car/rentals") {
    const car = PRACTICE_RENTAL_CARS.find((vehicle) => vehicle.id === body.vehicleId);
    if (!car) return practiceError("Choose one of the demo cars to continue.");
    const start = String(body.startsAt ?? nowIso());
    const end = String(body.endsAt ?? nowIso(3_600_000));
    const period = body.periodType === "hourly" || body.periodType === "half_day" ? body.periodType : "full_day";
    if ((period === "hourly" && !car.hourlyEnabled) || (period === "half_day" && !car.halfDayEnabled) || (period === "full_day" && !car.fullDayEnabled)) return practiceError("That demo owner does not offer this rental period.");
    const hours = Math.max(1, Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / 3_600_000));
    const rent = period === "hourly" ? car.hourlyPrice * hours : period === "half_day" ? car.halfDayPrice : car.dailyPrice;
    // Rent and the refundable deposit come out of the practice wallet; the deposit comes back when the car is returned.
    if (!practiceWalletSpend(rent + car.deposit, `${car.name}: rent and deposit`)) return jsonResponse({ error: "insufficient_funds", message: `Your practice wallet has UGX ${practiceWalletBalance().toLocaleString("en-UG")}. This rental needs UGX ${(rent + car.deposit).toLocaleString("en-UG")} (rent and a refundable deposit).` }, 409);
    const id = `practice-rental-${Date.now()}`;
    const handover = new Date();
    const elapsed = new Date(end).getTime() - new Date(start).getTime();
    const rental = { id, vehicle_id: car.id, vehicle: car.name, plate: PRACTICE_RENTAL_PLATES[Math.max(0, PRACTICE_RENTAL_CARS.indexOf(car)) % PRACTICE_RENTAL_PLATES.length], renter_name: "You", owner_name: car.ownerName, starts_at: handover.toISOString(), ends_at: new Date(handover.getTime() + elapsed).toISOString(), days: 1, rent_amount: rent, deposit_amount: car.deposit, status: "active", damage_claim: 0, licence_number: String(body.licenceNumber ?? "DEMO"), licence_expiry: String(body.licenceExpiry ?? ""), owner_amount: null, refund_amount: null, period_type: period, handed_over_at: handover.toISOString(), overtime_amount: 0, hourly_price: car.hourlyPrice };
    const saved = canUseStorage() ? JSON.parse(window.localStorage.getItem(PRACTICE_RENTALS_KEY) ?? "[]") as unknown[] : [];
    if (canUseStorage()) window.localStorage.setItem(PRACTICE_RENTALS_KEY, JSON.stringify([rental, ...saved]));
    return jsonResponse({ id, days: 1, rent, deposit: car.deposit, periodType: period, status: "active" }, 201);
  }
  if (role === "customer" && method === "POST" && path === "/v1/car/rentals/renter-profile") return jsonResponse({ ok: true, status: "approved" }, 201);
  const demoRentalReturn = path.match(/^\/v1\/car\/rentals\/(practice-rental-\d+)\/demo-return$/);
  if (role === "customer" && method === "POST" && demoRentalReturn) {
    const stored = canUseStorage() ? JSON.parse(window.localStorage.getItem(PRACTICE_RENTALS_KEY) ?? "[]") as Array<Record<string, unknown>> : [];
    const returning = stored.find((rental) => rental.id === demoRentalReturn[1] && rental.status === "active");
    if (returning) practiceWalletRefund(Number(returning.deposit_amount), "Rental deposit returned");
    const rentals = stored.map((rental) => rental.id === demoRentalReturn[1] ? { ...rental, status: "completed", returned_at: nowIso(), refund_amount: Number(rental.deposit_amount), owner_amount: Number(rental.rent_amount) } : rental);
    if (canUseStorage()) window.localStorage.setItem(PRACTICE_RENTALS_KEY, JSON.stringify(rentals));
    return jsonResponse({ ok: true, status: "completed" });
  }

  // ---- Name your fare + multi-stop (practice stand-ins) -----------------
  // Customer: riders "answer" an open offer on a timer — counters after a few
  // seconds, and an offer at or above the app fare is simply accepted.
  if (role === "customer" && state.fareOffer != null && state.stage === "Create" && !state.riderClaimed && state.offerAt != null) {
    const elapsed = Date.now() - state.offerAt;
    if (state.fareQuote != null && state.fareOffer >= state.fareQuote && elapsed >= 6_000) {
      save({ riderClaimed: true, stage: "Match", counters: [] });
    } else {
      const summary = practiceOfferSummary(state)!;
      const seeded = state.countersSeeded ?? 0;
      const plan = [
        { at: 4_000, riderName: "Musa", rating: 4.8, bump: 1_000 },
        { at: 9_000, riderName: "Sarah", rating: 4.9, bump: 1_500 },
      ];
      const due = plan.filter((p, i) => i >= seeded && elapsed >= p.at && !summary.expired);
      if (due.length) {
        const counters = [...(state.counters ?? [])];
        for (const p of due) {
          const amount = Math.min(summary.max, roundFare(state.fareOffer + p.bump));
          if (amount > state.fareOffer) counters.push({ id: `practice-counter-${p.riderName.toLowerCase()}-${state.fareRaises ?? 0}`, amount, riderName: p.riderName, rating: p.rating, expiresAt: Date.now() + PRACTICE_RIDE.counterTtlMs, status: "pending" });
        }
        save({ counters, countersSeeded: seeded + due.length });
      }
    }
  }
  // Rider: the practice ride job's customer "accepts" a counter and "pays" on a timer.
  if (role === "rider") {
    const job = state.rideJob ?? freshRideJob();
    let next = job;
    if (!job.claimed && job.counter && Date.now() - job.counter.at >= 6_000) next = { ...job, claimed: true, stage: "Match", total: job.counter.amount, counter: null, stageAt: Date.now() };
    else if (job.claimed && job.stage === "Match" && Date.now() - job.stageAt >= 5_000) next = { ...job, stage: "Shop", stageAt: Date.now() };
    else if (job.stage === "PickedUp" && job.stops.every((st) => st.status === "done") && job.stops.length > 0 && Date.now() - job.stageAt >= 10_000) next = { ...job, stage: "Handover", stageAt: Date.now() };
    if (next !== job || !state.rideJob) save({ rideJob: next });
  }

  if (role === "customer" && method === "GET" && path === "/v1/rides/quote") {
    const num = (k: string) => Number(query.get(k));
    const stopsRaw = (query.get("stops") ?? "").trim();
    const stops = stopsRaw ? stopsRaw.split(";").map((pair) => { const [lat, lng] = pair.split(",").map(Number); return { lat, lng }; }) : [];
    if (stops.length > PRACTICE_RIDE.maxStops) return jsonResponse({ error: "invalid_stops", message: `A ride can have at most ${PRACTICE_RIDE.maxStops} stops.` }, 400);
    const q = practiceRideQuote({ lat: num("pickupLat"), lng: num("pickupLng") }, { lat: num("destinationLat"), lng: num("destinationLng") }, stops);
    return jsonResponse({ quote: q.quote, base: q.base, stopFees: q.stopFees, stopFee: PRACTICE_RIDE.stopFee, stops: stops.length, distanceKm: Math.round(q.km * 10) / 10, maxStops: PRACTICE_RIDE.maxStops, offers: { min: q.min, max: q.max, ttlMinutes: PRACTICE_RIDE.offerTtlMs / 60_000, maxRaises: PRACTICE_RIDE.maxRaises } });
  }
  if (role === "customer" && method === "POST" && path === "/v1/orders" && body.isRide === true && (Array.isArray(body.stops) || body.fareOffer != null) && body.pickupLat != null && body.destinationLat != null) {
    const stops = (Array.isArray(body.stops) ? body.stops as Array<Record<string, unknown>> : []).slice(0, PRACTICE_RIDE.maxStops).map((st) => ({ area: typeof st.area === "string" ? st.area : null, address: typeof st.address === "string" ? st.address : null, lat: Number(st.lat), lng: Number(st.lng) }));
    const pickup = { lat: Number(body.pickupLat), lng: Number(body.pickupLng) };
    const destination = { lat: Number(body.destinationLat), lng: Number(body.destinationLng) };
    const q = practiceRideQuote(pickup, destination, stops);
    let total = q.quote;
    let offer: number | null = null;
    if (body.fareOffer != null) {
      offer = roundFare(Number(body.fareOffer));
      if (offer < q.min || offer > q.max) return jsonResponse({ error: "offer_out_of_range", message: `Your offer must be between UGX ${q.min.toLocaleString("en-UG")} and UGX ${q.max.toLocaleString("en-UG")}.` }, 400);
      total = offer;
    }
    save({
      hasOrder: true, riderClaimed: false, acceptedRiderName: null, stage: "Create", orderType: "parcel", isRide: true, paymentRail: "escrow", total, deliveryFee: total,
      destinationArea: String(body.destinationArea ?? "Destination"), destinationAddress: String(body.destinationAddress ?? ""),
      pickupAddress: typeof body.pickupAddress === "string" ? body.pickupAddress : null, pickupLat: pickup.lat, pickupLng: pickup.lng, destinationLat: destination.lat, destinationLng: destination.lng,
      merchantPaymentStatus: "none", autoAdvanceAt: null, stops,
      fareOffer: offer, fareQuote: offer != null ? q.quote : null, fareRaises: 0, offerAt: offer != null ? Date.now() : null,
      offerExpiresAt: offer != null ? Date.now() + PRACTICE_RIDE.offerTtlMs : null, counters: [], countersSeeded: 0,
    });
    return jsonResponse({ order: orderFor(state) }, 201);
  }
  if (role === "customer" && method === "POST" && path === `/v1/orders/${PRACTICE_ORDER_ID}/fare-offer`) {
    const summary = practiceOfferSummary(state);
    if (!summary || state.stage !== "Create" || state.riderClaimed) return jsonResponse({ error: "invalid_stage", message: "A rider has already taken this ride." }, 409);
    const amount = body.standard === true ? summary.quote : roundFare(Number(body.amount ?? 0));
    if (amount <= summary.amount) return jsonResponse({ error: "offer_not_higher", message: "You can only raise your offer while riders are deciding." }, 400);
    if (amount > summary.max) return jsonResponse({ error: "offer_out_of_range", message: `Your offer must be at most UGX ${summary.max.toLocaleString("en-UG")}.` }, 400);
    if (summary.raisesLeft <= 0) return jsonResponse({ error: "too_many_raises", message: "You've raised this offer as many times as allowed." }, 409);
    save({
      fareOffer: amount, total: amount, deliveryFee: amount, fareRaises: summary.raises + 1, offerAt: Date.now(), offerExpiresAt: Date.now() + PRACTICE_RIDE.offerTtlMs, countersSeeded: 0,
      counters: (state.counters ?? []).map((c) => (c.status === "pending" && c.amount <= amount ? { ...c, status: "rejected" as const } : c)),
    });
    return jsonResponse({ order: orderFor(state), fareOffer: practiceOfferSummary(state), fareCounters: practiceCounters(state) });
  }
  if (role === "customer" && method === "GET" && path === `/v1/orders/${PRACTICE_ORDER_ID}/fare-counters`) {
    return jsonResponse({ fareOffer: practiceOfferSummary(state), counters: state.stage === "Create" && !state.riderClaimed ? practiceCounters(state) : [] });
  }
  const practiceCounterDecision = path.match(new RegExp(`^/v1/orders/${PRACTICE_ORDER_ID}/fee-proposals/(practice-counter-[^/]+)/decision$`));
  if (role === "customer" && method === "POST" && practiceCounterDecision) {
    const counter = (state.counters ?? []).find((c) => c.id === practiceCounterDecision[1] && c.status === "pending");
    if (!counter) return jsonResponse({ error: "not_found" }, 404);
    if (counter.expiresAt <= Date.now()) return jsonResponse({ error: "counter_expired", message: "That counter has expired. Pick another or raise your offer." }, 410);
    if (body.approve === true) {
      save({ riderClaimed: true, acceptedRiderName: counter.riderName, stage: "Match", total: counter.amount, deliveryFee: counter.amount, fareOffer: counter.amount, counters: (state.counters ?? []).map((c) => ({ ...c, status: c.id === counter.id ? "approved" as const : "rejected" as const })) });
    } else {
      save({ counters: (state.counters ?? []).map((c) => (c.id === counter.id ? { ...c, status: "rejected" as const } : c)) });
    }
    return jsonResponse({ order: orderFor(state), fareCounters: practiceCounters(state) });
  }
  if (role === "customer" && method === "POST" && path === `/v1/orders/${PRACTICE_ORDER_ID}/customer-cancel`) {
    save({ stage: "Cancelled", hasOrder: false, fareOffer: null, fareQuote: null, counters: [], stops: [] });
    return jsonResponse({ order: orderFor(state) });
  }
  if (method === "GET" && path === `/v1/orders/${PRACTICE_ORDER_ID}/stops`) return jsonResponse({ stops: practiceStops(state) });
  // The customer-side /match poll must not hand an open offer to a rider who never accepted it.
  if (role === "customer" && method === "POST" && path === `/v1/orders/${PRACTICE_ORDER_ID}/match` && state.fareOffer != null && !state.riderClaimed) {
    return jsonResponse({ order: orderFor(state) });
  }

  // Rider: the practice ride job (customer offer + two stops).
  if (role === "rider" && path.startsWith(`/v1/orders/${PRACTICE_RIDE_JOB_ID}`) || role === "rider" && path === `/v1/riders/jobs/${PRACTICE_RIDE_JOB_ID}/preview`) {
    const job = state.rideJob ?? freshRideJob();
    const put = (patch: Partial<PracticeRideJob>) => { save({ rideJob: { ...job, ...patch } }); return state.rideJob!; };
    const sub = path.slice(`/v1/orders/${PRACTICE_RIDE_JOB_ID}`.length);
    const stopsOut = (j: PracticeRideJob) => j.stops.map((st, i) => ({ position: i + 1, area: st.area, address: st.address, lat: st.lat, lng: st.lng, status: st.status, arrivedAt: null, departedAt: null }));
    const detail = (j: PracticeRideJob) => ({ order: practiceRideJobOrder(j), items: [], events: [], substitutions: [], payments: [], rating: null, feeProposals: [], bundleStops: [], rideStops: stopsOut(j), fareOffer: null });
    if (path.endsWith("/preview")) return jsonResponse({ items: [] });
    if (method === "GET" && sub === "") return jsonResponse(detail(job));
    if (method === "GET" && sub === "/stops") return jsonResponse({ stops: stopsOut(job) });
    if (method === "POST" && sub === "/fare-counters") {
      if (job.claimed) return jsonResponse({ error: "already_claimed", message: "This job has already been taken" }, 409);
      const amount = roundFare(Number(body.amount ?? 0));
      if (amount <= 6_000 || amount > 11_000) return jsonResponse({ error: "counter_out_of_range", message: "Your counter must be more than UGX 6,000 and at most UGX 11,000." }, 400);
      const j = put({ counter: { amount, at: Date.now(), expiresAt: Date.now() + PRACTICE_RIDE.counterTtlMs } });
      return jsonResponse({ counter: { id: "practice-rider-counter", amount, expiresAt: new Date(j.counter!.expiresAt).toISOString() } }, 201);
    }
    if (method === "POST" && (sub === "/claim" || sub === "/apply")) return jsonResponse({ order: practiceRideJobOrder(put({ claimed: true, stage: "Match", counter: null, stageAt: Date.now() })) });
    if (method === "POST" && sub === "/deliver") return jsonResponse({ order: practiceRideJobOrder(put({ stage: "Deliver", stageAt: Date.now() })) });
    if (method === "POST" && sub === "/arrived") return jsonResponse({ order: practiceRideJobOrder(put({ stage: "Arrived", stageAt: Date.now() })) });
    if (method === "POST" && sub === "/picked-up") return jsonResponse({ order: practiceRideJobOrder(put({ stage: "PickedUp", stageAt: Date.now() })) });
    const stopAction = sub.match(/^\/stops\/(\d+)\/(arrived|continue)$/);
    if (method === "POST" && stopAction) {
      if (job.stage !== "PickedUp") return jsonResponse({ error: "invalid_stage", message: "Stops start once the passenger is picked up." }, 409);
      const index = Number(stopAction[1]) - 1;
      const nextIndex = job.stops.findIndex((st) => st.status !== "done");
      if (index !== nextIndex) return jsonResponse({ error: "out_of_order", message: nextIndex >= 0 ? `Next is stop ${nextIndex + 1}.` : "All stops are done." }, 409);
      const want = stopAction[2] === "arrived" ? "pending" : "arrived";
      if (job.stops[index].status !== want) return jsonResponse({ error: "out_of_order", message: want === "arrived" ? "Mark the stop as arrived first." : "Already here." }, 409);
      const stops = job.stops.map((st, i) => (i === index ? { ...st, status: stopAction[2] === "arrived" ? "arrived" as const : "done" as const } : st));
      const j = put({ stops, stageAt: Date.now() });
      return jsonResponse({ stops: stopsOut(j), order: practiceRideJobOrder(j) });
    }
    if (method === "POST" && sub === "/settle") return jsonResponse({ order: practiceRideJobOrder(put({ stage: "Settle", stageAt: Date.now() })) });
    if (method === "POST" && sub === "/cancel") return jsonResponse({ order: practiceRideJobOrder(put(freshRideJob())) });
    if (method === "POST" && sub === "/location") return jsonResponse({ ok: true });
    if (method === "GET" && sub === "/chat") return jsonResponse({ messages: [] });
    return practiceError();
  }

  if (method === "GET" && path === "/v1/orders/active") {
    const activeOrder = state.hasOrder && !["Settle", "Cancelled"].includes(state.stage) ? orderFor(state) : null;
    return jsonResponse({
      activeOrder,
      pendingFeeProposal: null,
      ...(activeOrder && (state.stops ?? []).length ? { rideStops: practiceStops(state) } : {}),
      ...(activeOrder && state.fareOffer != null ? { fareOffer: practiceOfferSummary(state), fareCounters: state.stage === "Create" && !state.riderClaimed ? practiceCounters(state) : [] } : {}),
    });
  }
  if (method === "GET" && path.startsWith("/v1/lists/recent")) {
    const driver = state.isRide ? practiceCar(state.demoCarRiderId) : null;
    return jsonResponse({ lists: state.hasOrder ? [{ id: PRACTICE_LIST_ID, listId: PRACTICE_LIST_ID, title: state.isRide ? "Practice car ride" : "Practice shopping list", status: state.stage === "Settle" ? "delivered" : "active", itemCount: state.items.length, updatedAt: nowIso(), riderFirstName: state.riderClaimed || role === "customer" ? state.acceptedRiderName ?? driver?.driver ?? "Daniel" : null, riderId: state.riderClaimed || role === "customer" ? state.demoCarRiderId ?? "practice-rider" : null, riderHasPhoto: false, area: state.destinationArea, orderId: PRACTICE_ORDER_ID }] : [] });
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
    save({ hasOrder: true, riderClaimed: false, fareOffer: null, fareQuote: null, counters: [], stops: [], acceptedRiderName: null, stage: "Create", orderType: type, isRide: body.isRide === true, paymentRail: body.paymentRail === "float" ? "float" : "escrow", total: type === "shopping" ? estimated + deliveryFee : deliveryFee, deliveryFee, destinationArea: String(body.destinationArea ?? "Entebbe City"), destinationAddress: String(body.destinationAddress ?? "Kitoro Road"), merchantPaymentStatus: "none", autoAdvanceAt: null });
    return jsonResponse({ order: orderFor(state) });
  }
  if (role === "customer" && method === "POST" && path === "/v1/marketplace/checkout") {
    const rawItems = Array.isArray(body.items) ? (body.items as Array<Record<string, unknown>>) : [];
    const items = rawItems.map((item, index) => ({
      id: `practice-item-${index + 1}`,
      name: String(item.title ?? `Item ${index + 1}`),
      quantity: Number(item.quantity ?? 1),
      unitPrice: Number(item.price ?? 0),
      note: typeof item.variantTitle === "string" ? item.variantTitle : null,
    }));
    const estimated = items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0);
    const storeId = String(rawItems[0]?.storeId ?? "pe_lakeside_mart");
    const demoStore = DEMO_MARKETPLACE_STORES.find((s) => s.id === storeId);
    const vendor = { kind: "store" as const, id: storeId, name: demoStore?.name ?? "Marketplace Store", address: demoStore?.address ?? "Entebbe", lat: demoStore?.lat ?? null, lng: demoStore?.lng ?? null };
    const destLat = Number(body.destinationLat), destLng = Number(body.destinationLng);
    const toLat = Number.isFinite(destLat) && body.destinationLat != null ? destLat : PRACTICE_ENTEBBE.lat;
    const toLng = Number.isFinite(destLng) && body.destinationLng != null ? destLng : PRACTICE_ENTEBBE.lng;
    const deliveryFee = practiceDeliveryFee(vendor.lat, vendor.lng, toLat, toLng);
    // The rider is found for you, as in the live app, so the order is ready to pay straight away.
    save({
      items,
      hasOrder: true,
      riderClaimed: true,
      riderIdx: Math.floor(Math.random() * 1000),
      vendor,
      stage: "Match",
      orderType: "shopping",
      isRide: false,
      paymentRail: body.paymentRail === "float" ? "float" : "escrow",
      total: estimated + deliveryFee,
      deliveryFee,
      destinationArea: String(body.destinationArea ?? "Entebbe"),
      destinationAddress: String(body.destinationAddress ?? "Kitoro Road, Entebbe"),
      destinationLat: toLat,
      destinationLng: toLng,
      merchantPaymentStatus: "none",
      autoAdvanceAt: null,
    });
    const order = {
      ...orderFor(state),
      store_id: storeId,
      store_name: demoStore?.name ?? "Marketplace Store",
      store_category: demoStore?.category ?? "stores",
    };
    return jsonResponse({ ok: true, orders: [order], order }, 201);
  }
  const foodOrder = path.match(/^\/v1\/restaurants\/(demo-food-[^/]+)\/order$/);
  if (role === "customer" && method === "POST" && foodOrder) {
    const restaurant = demoFoodRestaurant(foodOrder[1]!);
    const menu = demoFoodMenu(foodOrder[1]!);
    if (!restaurant || !menu) return practiceError("Choose one of the practice restaurants to continue.");
    const menuItems = [...menu.categories.flatMap((category) => category.items), ...menu.uncategorizedItems];
    const rawItems = Array.isArray(body.items) ? (body.items as Array<Record<string, unknown>>) : [];
    const items = rawItems.flatMap((line, index) => {
      const dish = menuItems.find((entry) => entry.id === line.menuItemId);
      if (!dish) return [];
      const picked = new Set(Array.isArray(line.choiceIds) ? (line.choiceIds as string[]) : []);
      const choices = (dish.options ?? []).flatMap((option) => option.choices.filter((choice) => picked.has(choice.id)));
      const unitPrice = dish.price + choices.reduce((sum, choice) => sum + choice.price_delta, 0);
      return [{ id: `practice-item-${index + 1}`, name: dish.name, quantity: Math.max(1, Number(line.quantity) || 1), unitPrice, note: choices.length ? choices.map((choice) => choice.name).join(", ") : null }];
    });
    if (!items.length) return practiceError("Add something from the menu first.");
    const vendor = { kind: "restaurant" as const, id: restaurant.id, name: restaurant.name, address: restaurant.address ?? "Entebbe", lat: restaurant.lat ?? null, lng: restaurant.lng ?? null };
    const toLat = typeof body.destinationLat === "number" ? body.destinationLat : PRACTICE_ENTEBBE.lat;
    const toLng = typeof body.destinationLng === "number" ? body.destinationLng : PRACTICE_ENTEBBE.lng;
    const deliveryFee = practiceDeliveryFee(vendor.lat, vendor.lng, toLat, toLng);
    save({
      items, hasOrder: true, riderClaimed: true, riderIdx: Math.floor(Math.random() * 1000), vendor, stage: "Match", orderType: "shopping", isRide: false,
      paymentRail: body.paymentRail === "float" ? "float" : "escrow", total: items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0) + deliveryFee, deliveryFee,
      destinationArea: String(body.destinationArea ?? "Entebbe"), destinationAddress: String(body.destinationAddress ?? "Kitoro Road, Entebbe"),
      destinationLat: toLat, destinationLng: toLng, merchantPaymentStatus: "none", autoAdvanceAt: null,
    });
    return jsonResponse({ order: orderFor(state) }, 201);
  }
  if (role === "customer" && method === "POST" && path === "/v1/car/quote") {
    const cargo = PRACTICE_CARGO_RATES[String(body.categoryId)];
    if (cargo) {
      const km = practiceDistanceKm(Number(body.pickupLat), Number(body.pickupLng), Number(body.destinationLat), Number(body.destinationLng));
      return jsonResponse({ fare: roundFare(km * cargo[0], cargo[1]), distanceKm: Math.round(km * 10) / 10 });
    }
    const category = practiceSpecialCategory(body.categoryId);
    if (!category) return practiceError("Choose one of the demo car types to continue.");
    const km = practiceDistanceKm(Number(body.pickupLat), Number(body.pickupLng), Number(body.destinationLat), Number(body.destinationLng));
    return jsonResponse({ fare: practiceSpecialFare(category, km, body.hireHours), distanceKm: Math.round(km * 10) / 10 });
  }
  if (role === "customer" && method === "POST" && path === "/v1/car/bookings" && practiceSpecialCategory(body.categoryId)) {
    const category = practiceSpecialCategory(body.categoryId)!;
    const km = practiceDistanceKm(Number(body.pickupLat), Number(body.pickupLng), Number(body.destinationLat), Number(body.destinationLng));
    const fare = practiceSpecialFare(category, km, body.hireHours);
    save({ hasOrder: true, riderClaimed: true, fareOffer: null, fareQuote: null, counters: [], stops: [], acceptedRiderName: null, stage: "Match", orderType: "parcel", isRide: true, carCategoryId: category.id, carVehicleSize: "normal", carServiceTier: "comfort", demoCarRiderId: category.rider, paymentRail: "escrow", total: fare, deliveryFee: fare, destinationArea: String(body.destinationArea ?? "Entebbe City"), destinationAddress: String(body.destinationAddress ?? "Kitoro Road"), autoAdvanceAt: null });
    return jsonResponse({ order: orderFor(state) }, 201);
  }
  const cargoTruck = PRACTICE_CARGO_RIDERS.find((entry) => entry.category === body.categoryId);
  if (role === "customer" && method === "POST" && path === "/v1/car/bookings" && cargoTruck) {
    const rate = PRACTICE_CARGO_RATES[cargoTruck.category]!;
    const km = practiceDistanceKm(Number(body.pickupLat), Number(body.pickupLng), Number(body.destinationLat), Number(body.destinationLng));
    const fare = roundFare(km * rate[0], rate[1]);
    const load = String(body.cargoDescription ?? "").trim();
    save({ hasOrder: true, riderClaimed: true, fareOffer: null, fareQuote: null, counters: [], stops: [], acceptedRiderName: null, stage: "Match", orderType: "parcel", isRide: true, carCategoryId: cargoTruck.category, carVehicleSize: "large", carServiceTier: "convenient", demoCarRiderId: cargoTruck.id, paymentRail: "escrow", total: fare, deliveryFee: fare,
      items: [{ id: "practice-item-1", name: load || "Moving load", quantity: 1, unitPrice: 0, note: null }],
      pickupAddress: typeof body.pickupAddress === "string" ? body.pickupAddress : null, pickupLat: Number.isFinite(Number(body.pickupLat)) ? Number(body.pickupLat) : null, pickupLng: Number.isFinite(Number(body.pickupLng)) ? Number(body.pickupLng) : null,
      destinationArea: String(body.destinationArea ?? "Entebbe"), destinationAddress: String(body.destinationAddress ?? "Kitoro Road, Entebbe"),
      destinationLat: Number.isFinite(Number(body.destinationLat)) ? Number(body.destinationLat) : null, destinationLng: Number.isFinite(Number(body.destinationLng)) ? Number(body.destinationLng) : null, autoAdvanceAt: null });
    return jsonResponse({ order: orderFor(state) }, 201);
  }
  if (role === "customer" && method === "POST" && path === "/v1/car/bookings") {
    const vehicleSize = body.vehicleSize === "large" ? "large" : "normal";
    const serviceTier = body.serviceTier === "comfort" ? "comfort" : "convenient";
    const lat1 = Number(body.pickupLat), lng1 = Number(body.pickupLng), lat2 = Number(body.destinationLat), lng2 = Number(body.destinationLng);
    const validCoords = [lat1, lng1, lat2, lng2].every(Number.isFinite);
    const distanceKm = validCoords ? 6371 * 2 * Math.asin(Math.sqrt(Math.sin(((lat2 - lat1) * Math.PI) / 360) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(((lng2 - lng1) * Math.PI) / 360) ** 2)) : 0;
    const baseFare = roundFare(distanceKm * 2_000, 8_000);
    const fare = roundFare(baseFare * (vehicleSize === "large" ? 1.5 : 1) * (serviceTier === "comfort" ? 1.3 : 1), 0);
    const eligible = PRACTICE_CAR_RIDERS.filter((rider) => rider.size === vehicleSize && rider.tier === serviceTier);
    const demoRider = eligible[Math.floor(Math.random() * eligible.length)] ?? PRACTICE_CAR_RIDERS[0];
    save({ hasOrder: true, riderClaimed: true, fareOffer: null, fareQuote: null, counters: [], stops: [], acceptedRiderName: null, stage: "Match", orderType: "parcel", isRide: true, carCategoryId: vehicleSize === "large" ? "practice-car-large" : PRACTICE_CAR_CATEGORY_ID, carVehicleSize: vehicleSize, carServiceTier: serviceTier, demoCarRiderId: demoRider.id, paymentRail: "escrow", total: fare, deliveryFee: fare, destinationArea: String(body.destinationArea ?? "Entebbe City"), destinationAddress: String(body.destinationAddress ?? "Kitoro Road"), autoAdvanceAt: null });
    return jsonResponse({ order: orderFor(state) }, 201);
  }
  const rideshareBooking = path.match(/^\/v1\/car\/carpool\/trips\/(practice-rideshare-[^/]+)\/seats$/);
  if (role === "customer" && method === "POST" && rideshareBooking) {
    const trip = practiceRideshareTrip(rideshareBooking[1]);
    const seats = Number(body.seats);
    if (!trip || !Number.isInteger(seats) || seats < 1 || seats > 3) return practiceError("Choose an available demo trip and one to three seats.");
    save({ hasOrder: true, riderClaimed: true, fareOffer: null, fareQuote: null, counters: [], stops: [], acceptedRiderName: null, stage: "Match", orderType: "parcel", isRide: true, carCategoryId: PRACTICE_CAR_CATEGORY_ID,
      carVehicleSize: trip.driver.size === "large" ? "large" : "normal", carServiceTier: "convenient", demoCarRiderId: trip.driver.id,
      paymentRail: "escrow", total: trip.price * seats, deliveryFee: trip.price * seats, pickupAddress: trip.from[0], pickupLat: trip.from[1], pickupLng: trip.from[2],
      destinationArea: trip.to[0], destinationAddress: trip.to[0], destinationLat: trip.to[1], destinationLng: trip.to[2], autoAdvanceAt: null });
    return jsonResponse({ order: orderFor(state) }, 201);
  }
  if (method === "GET" && path === `/v1/orders/${PRACTICE_ORDER_ID}`) return jsonResponse(orderDetail(state));
  // Practice has no card rail: cards stay on the hosted-page path, which practice never opens.
  if (method === "GET" && path === "/v1/payments/options") return jsonResponse({ card: { available: false, direct: false }, mobileMoney: { direct: true } });
  if (method === "GET" && path === `/v1/orders/${PRACTICE_ORDER_ID}/checkout`) return jsonResponse({ baseAmount: state.total, mobileMoney: state.total, wallet: state.total, cash: state.total });
  if (method === "GET" && path === `/v1/car/bookings/${PRACTICE_ORDER_ID}/info`) {
    // A Name-your-fare ride is a boda, not a car booking (the live API answers 404 too).
    if (state.acceptedRiderName || state.fareOffer != null) return jsonResponse({ error: "not_found" }, 404);
    const car = practiceCar(state.demoCarRiderId);
    return jsonResponse({ car: true, scheduledFor: null, categoryName: car.name, vehicleName: `${car.make} ${car.model}`, plate: car.plate, ownerName: car.owner, driverName: car.driver });
  }
  if (method === "POST" && path === `/v1/orders/${PRACTICE_ORDER_ID}/match`) {
    save({ riderClaimed: true, stage: "Match" });
    return jsonResponse({ order: orderFor(state) });
  }
  if (method === "POST" && path === `/v1/orders/${PRACTICE_ORDER_ID}/claim`) {
    save({ riderClaimed: true, stage: "Shop" });
    return jsonResponse({ order: orderFor(state) });
  }
  if (method === "POST" && path === `/v1/orders/${PRACTICE_ORDER_ID}/fund`) {
    if (role === "customer" && body.paymentMethod === "wallet") {
      // Anything paid from the wallet really spends the practice wallet: shop and food orders, rides, cars and trucks.
      const label = state.vendor ? `${state.vendor.name} order` : state.isRide ? (state.carCategoryId?.startsWith("peebee-cargo-") ? "Peebee move" : "Peebee ride") : "Peebee order";
      if (!practiceWalletSpend(state.total, label)) return jsonResponse({ error: "insufficient_funds", message: `Your practice wallet has UGX ${practiceWalletBalance().toLocaleString("en-UG")}. This order needs UGX ${state.total.toLocaleString("en-UG")}.` }, 409);
    }
    save({ stage: state.isRide ? "Deliver" : "Shop", paymentRail: body.paymentMethod === "cash" ? "float" : "escrow", autoAdvanceAt: Date.now() });
    return jsonResponse({ order: orderFor(state), funded: true, rail: state.paymentRail, payment: { id: "practice-collection", status: "successful", network: "mtn" } });
  }
  if (method === "POST" && path === `/v1/orders/${PRACTICE_ORDER_ID}/deliver`) {
    if (state.isRide) { save({ stage: "Deliver" }); return jsonResponse({ order: orderFor(state) }); }
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
  if (method === "GET" && path === "/v1/riders/me/orders") {
    const rideJob = role === "rider" && state.rideJob?.claimed && state.rideJob.stage !== "Settle" ? [practiceRideJobOrder(state.rideJob)] : [];
    return jsonResponse({ orders: [...(state.riderClaimed ? [orderFor(state)] : []), ...rideJob] });
  }
  if (method === "GET" && path === "/v1/riders/jobs/available") {
    const order = orderFor(state);
    const job = state.rideJob;
    const rideOffer = role === "rider" && job && !job.claimed
      ? [{
          ...practiceRideJobOrder(job), customer_name: "Grace", restaurant_name: null, distanceKm: 0.9, outOfServiceRange: false, applied: false, bidding: null,
          fareOffer: {
            amount: 6_000, quote: 7_500, min: 5_000, max: 11_000, expiresAt: new Date(Date.now() + 8 * 60_000).toISOString(), expired: false,
            myCounter: job.counter ? { id: "practice-rider-counter", amount: job.counter.amount, expiresAt: new Date(job.counter.expiresAt).toISOString() } : null,
          },
        }]
      : [];
    return jsonResponse({ jobs: [...rideOffer, ...(state.riderClaimed ? [] : [{ ...order, customer_name: "Amina", restaurant_name: null, distanceKm: 1.8, outOfServiceRange: false, applied: false }])] });
  }
  if (method === "GET" && path === `/v1/riders/jobs/${PRACTICE_ORDER_ID}/preview`) return jsonResponse({ items: itemsFor(state) });
  if (method === "GET" && path === "/v1/riders/me/subscription") return jsonResponse({ subscription: { required: false, mode: "recurring", amount: 0, cadence: "weekly", status: "active", current: true, paidThrough: null } });
  if (method === "GET" && path === "/v1/riders/me/wallet") return jsonResponse({ balance: state.stage === "Settle" ? 45_000 : 40_000, withdrawals: [], depositRequired: false, requiredDeposit: 0, depositShortfall: 0 });

  if (method === "GET" && path === "/v1/wallet") return jsonResponse(role === "customer" ? practiceWalletView() : { balance: 12_000, cap: 2_000_000, verified: true, ledger: [] });
  if (method === "GET" && path === "/v1/wallet/shares") return jsonResponse({ granted: [], received: [] });
  if (method === "GET" && path === "/v1/wallets") return jsonResponse({ wallets: [{ id: "primary", name: "Primary", balance: role === "customer" ? practiceWalletBalance() : 12_000, isPrimary: true }], suggestedNames: ["Family Expenses", "Office Supplies", "Personal Savings", "Travel Fund"], maxWallets: 5 });
  if (method === "GET" && /^\/v1\/wallets\/[^/]+\/ledger$/.test(path)) return jsonResponse({ ledger: [] });
  if (method === "GET" && /^\/v1\/wallets\/[^/]+\/report$/.test(path)) return jsonResponse({ period: "month", totalIn: 12_000, totalOut: 0, net: 12_000, byType: [] });
  if (method === "GET" && path.startsWith("/v1/mobile-numbers")) return jsonResponse({ numbers: [{ id: "practice-number", owner_id: "practice-user", purpose: path.includes("withdrawal") ? "withdrawal" : "payment", phone: "0700000000", label: "Practice number", is_primary: 1, created_at: nowIso(-86_400_000), updated_at: nowIso() }] });
  if (method === "GET" && path === "/v1/locations") return jsonResponse({ locations: [
    { id: "practice-location", user_id: "practice-user", label: "Practice home", area: "Entebbe City", address: "Kitoro Road", lat: 0.0612, lng: 32.4637, created_at: nowIso(-86_400_000) },
    { id: "practice-work", user_id: "practice-user", label: "Work", area: "Nakasero", address: "Nakasero Road, Kampala", lat: 0.3242, lng: 32.5806, created_at: nowIso(-172_800_000) },
  ] });
  // Recent ride destinations and saved passengers for the Ride home — browser-local only.
  if (role === "customer" && method === "GET" && path === "/v1/orders/recent-places") return jsonResponse({ places: PRACTICE_RECENT_PLACES.map((p, i) => ({ ...p, last_at: nowIso(-(i + 1) * 86_400_000) })) });
  if (role === "customer" && path === "/v1/passengers") {
    const list = (): Array<Record<string, unknown>> => (canUseStorage() ? JSON.parse(window.localStorage.getItem(PRACTICE_PASSENGERS_KEY) ?? "null") : null) ?? [{ id: "practice-passenger", user_id: "practice-user", name: "Mum", phone: "0772000111", created_at: nowIso(-86_400_000) }];
    if (method === "GET") return jsonResponse({ enabled: true, passengers: list() });
    if (method === "POST") {
      const passenger = { id: `practice-passenger-${Date.now()}`, user_id: "practice-user", name: String(body.name ?? "Passenger"), phone: String(body.phone ?? ""), created_at: nowIso() };
      if (canUseStorage()) window.localStorage.setItem(PRACTICE_PASSENGERS_KEY, JSON.stringify([passenger, ...list()]));
      return jsonResponse({ passenger }, 201);
    }
  }
  const practicePassenger = path.match(/^\/v1\/passengers\/([^/]+)$/);
  if (role === "customer" && method === "DELETE" && practicePassenger) {
    if (canUseStorage()) {
      const rows = JSON.parse(window.localStorage.getItem(PRACTICE_PASSENGERS_KEY) ?? "[]") as Array<{ id: string }>;
      window.localStorage.setItem(PRACTICE_PASSENGERS_KEY, JSON.stringify(rows.filter((r) => r.id !== practicePassenger[1])));
    }
    return jsonResponse({ ok: true });
  }

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
  if (method === "GET" && /^\/v1\/merchants\/[^/]+\/outlets$/.test(path)) return jsonResponse({ outlets: [{ id: PRACTICE_OUTLET_ID, merchant_id: PRACTICE_MERCHANT_ID, category_id: "cat-retail", category_name: "Retail Shop", category_slug: "retail-shop", name: "Peebee Practice Outlet", code: "PEEBEE-DEMO", phone: "0700000000", address: "Kampala Road", lat: 0.3136, lng: 32.5811, status: "active", created_at: nowIso(-86_400_000), updated_at: nowIso() }] });
  if (method === "GET" && path === "/v1/merchant-categories") return jsonResponse({ categories: [{ id: "cat-retail", slug: "retail-shop", name: "Retail Shop" }] });
  if (method === "GET" && /^\/v1\/merchants\/[^/]+\/settlement-accounts$/.test(path)) return jsonResponse({ settlementAccounts: [{ id: "practice-settlement-account", type: "momo", provider: "mtn", account_name: "Peebee Practice Mart", network_or_bank: "MTN", status: "verified", is_primary: 1, verified_at: nowIso(-86_400_000), cooling_until: null, masked_account_ref: "070***0000" }] });
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
  if (role === "restaurant" && method === "GET" && path === "/v1/restaurants/me/orders") {
    const completed = state.settlementStatus === "successful";
    const history = query.get("view") === "history";
    const order = { id: PRACTICE_ORDER_ID, stage: completed ? "Settle" : state.merchantPaymentStatus === "available" ? "Deliver" : "Shop", customerId: "practice-customer", customerName: "Amina", riderName: "Daniel", createdAt: new Date(state.startedAt).toISOString(), updatedAt: nowIso(), items: state.items.map(item => ({ name: item.name, quantity: item.quantity, unitPrice: item.unitPrice })), itemsTotal: state.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0) };
    return jsonResponse({ orders: history === completed && !query.has("cursor") ? [order] : [], counts: { active: completed ? 0 : 1, history: completed ? 1 : 0 }, nextCursor: null });
  }

  // Pharmacy prescriptions: kept in this browser only, never sent anywhere.
  if (role === "customer" && path.startsWith("/v1/pharmacy/")) {
    const rxKey = "peebee_practice_prescriptions_v1";
    const readRx = (): Array<Record<string, unknown>> => (canUseStorage() ? JSON.parse(window.localStorage.getItem(rxKey) ?? "[]") : []);
    const writeRx = (rows: Array<Record<string, unknown>>) => { if (canUseStorage()) window.localStorage.setItem(rxKey, JSON.stringify(rows)); };
    const pharmacies = DEMO_MARKETPLACE_STORES.filter((s) => s.category === "pharmacy").map((s) => ({ id: s.id, name: s.name, address: s.address ?? null, phone: s.phone ?? null }));
    if (method === "GET" && path === "/v1/pharmacy/pharmacies") return jsonResponse({ pharmacies });
    if (method === "POST" && path === "/v1/pharmacy/uploads") return jsonResponse({ key: `rx/practice-user/practice-${Date.now()}.jpg` }, 201);
    if (method === "GET" && path === "/v1/pharmacy/prescriptions") return jsonResponse({ prescriptions: readRx() });
    if (method === "POST" && path === "/v1/pharmacy/prescriptions") {
      const pharmacy = pharmacies.find((p) => p.id === body.pharmacyId) ?? pharmacies[0];
      const prescription = {
        id: `rx_practice_${Date.now()}`, customerName: "You", customerPhone: null, pharmacyId: pharmacy?.id ?? "", pharmacyName: pharmacy?.name ?? "Practice pharmacy",
        hasImage: true, imagePath: null, patientNotes: String(body.patientNotes ?? ""), patientAge: typeof body.patientAge === "number" ? body.patientAge : null,
        patientGender: typeof body.patientGender === "string" ? body.patientGender : null, status: "pending_review", pharmacistNotes: "", dosageInstructions: "",
        quotedItems: [], quotedTotalUgx: 0, deliveryAddress: String(body.deliveryAddress ?? ""), deliveryFeeUgx: 5_000, createdAt: nowIso(), updatedAt: nowIso(),
      };
      writeRx([prescription, ...readRx()]);
      return jsonResponse({ ok: true, prescription }, 201);
    }
    const rxCancel = path.match(/^\/v1\/pharmacy\/prescriptions\/([^/]+)\/cancel$/);
    if (method === "POST" && rxCancel) {
      writeRx(readRx().map((rx) => (rx.id === rxCancel[1] ? { ...rx, status: "cancelled", updatedAt: nowIso() } : rx)));
      return jsonResponse({ ok: true });
    }
  }

  if (role === "gas" && path.startsWith("/v1/gas/relay/")) return practiceRelayParcel(path, method, body, state, save);
  if (path.startsWith("/v1/education/")) return practiceEducationRequest(path, method, body, query);

  if (method === "GET" && path === "/v1/chat/threads") return jsonResponse({ threads: [] });
  if (method === "GET" && path === "/v1/restaurants/me/chat") return jsonResponse({ threads: [] });
  if (method === "GET" && path.startsWith("/v1/calls/incoming")) return jsonResponse({ call: null });
  // Calling a practice driver or rider: they answer at once, on a call with no audio, and the call ends when you hang up.
  const practiceCall = (status: "accepted" | "ended", id: string, extra: { calleeId?: string; orderId?: string | null } = {}) => ({
    call: { id, caller_id: "practice-customer", callee_id: extra.calleeId ?? "practice-rider", order_id: extra.orderId ?? PRACTICE_ORDER_ID, restaurant_id: null, provider: "mock" as const, status,
      caller_session_id: null, callee_session_id: null, offer_sdp: null, answer_sdp: null, created_at: nowIso(-2_000), answered_at: nowIso(-1_000), ended_at: status === "ended" ? nowIso() : null, duration_seconds: status === "ended" ? 1 : null },
  });
  if (method === "POST" && path === "/v1/calls") {
    return jsonResponse(practiceCall("accepted", `practice-call-${Date.now()}`, { calleeId: typeof body.calleeId === "string" ? body.calleeId : undefined, orderId: typeof body.orderId === "string" ? body.orderId : null }), 201);
  }
  const callId = path.match(/^\/v1\/calls\/(practice-call-\d+)(\/end)?$/);
  if (callId && method === "GET" && !callId[2]) return jsonResponse(practiceCall("accepted", callId[1]));
  if (callId && method === "POST" && callId[2]) return jsonResponse(practiceCall("ended", callId[1]));

  return practiceError();
}

// Relay parcels at the station: the attendant receives a sample parcel with the
// matatu's code and hands it over with the customer's. The codes are shown on
// the sample parcel so the journey can be completed without anyone else.
const PRACTICE_PARCEL_ID = "ord_practice_relay_parcel";
const PRACTICE_MATATU_CODE = "246810";
const PRACTICE_COLLECT_CODE = "135790";

function practiceRelayParcel(path: string, method: string, body: Record<string, unknown>, state: PracticeState, save: (patch: Partial<PracticeState>) => void): Response {
  const parcel = state.relayParcel ?? { status: "incoming" as const, heldAt: null, releasedAt: null };
  const code = String(body.code ?? "");
  if (method === "POST" && path === "/v1/gas/relay/receive") {
    if (parcel.status !== "incoming" || code !== PRACTICE_MATATU_CODE) return jsonResponse({ error: "not_found", message: `No parcel with that code. In practice, the matatu's code is ${PRACTICE_MATATU_CODE}.` }, 404);
    save({ relayParcel: { ...parcel, status: "held", heldAt: nowIso() } });
    return jsonResponse({ orderId: PRACTICE_PARCEL_ID });
  }
  if (method === "POST" && path === "/v1/gas/relay/release") {
    if (parcel.status !== "held" || code !== PRACTICE_COLLECT_CODE) return jsonResponse({ error: "not_found", message: parcel.status === "incoming" ? "Receive the parcel from the matatu first." : `No parcel with that code. In practice, the customer's code is ${PRACTICE_COLLECT_CODE}.` }, 404);
    save({ relayParcel: { ...parcel, status: "collected", releasedAt: nowIso() } });
    return jsonResponse({ orderId: PRACTICE_PARCEL_ID });
  }
  const customerName = `Amina (practice) · code ${PRACTICE_COLLECT_CODE}`;
  if (method === "GET" && path === "/v1/gas/relay/parcels") {
    return jsonResponse({
      incoming: parcel.status === "incoming"
        ? [{ order_id: PRACTICE_PARCEL_ID, from_name: "Kampala Old Taxi Park", matatu_status: "arrived", vehicle_plate: "PRACTICE 14", operator_name: `Practice matatu · code ${PRACTICE_MATATU_CODE}`, started_at: nowIso(-40 * 60_000) }]
        : [],
      held: parcel.status === "held"
        ? [{ order_id: PRACTICE_PARCEL_ID, last_mile: "collect", held_at: parcel.heldAt ?? nowIso(), customer_name: customerName, customer_phone: "0700000000", rider_status: null, rider_name: null, release_code: null }]
        : [],
      recent: parcel.status === "collected"
        ? [{ order_id: PRACTICE_PARCEL_ID, released_to: "customer", released_at: parcel.releasedAt ?? nowIso(), customer_name: "Amina (practice)" }]
        : [],
    });
  }
  if (method === "GET" && path === `/v1/gas/relay/parcels/${PRACTICE_PARCEL_ID}`) {
    const leg = (n: 1 | 2, kind: "boda" | "matatu", fromName: string, toName: string, providerName: string, vehiclePlate: string, startedMin: number, handedMin: number | null) => ({
      id: `practice-relay-leg-${n}`, leg: n, kind, fromName, fromLat: null, fromLng: null, toName, toLat: null, toLng: null, distanceKm: null, fee: 0,
      status: handedMin == null ? "arrived" : "done", providerName, vehiclePlate, startedAt: nowIso(-startedMin * 60_000), handedOverAt: handedMin == null ? null : nowIso(-handedMin * 60_000),
    });
    return jsonResponse({
      order: { id: PRACTICE_PARCEL_ID, stage: parcel.status === "collected" ? "Settle" : "Deliver", destinationArea: "Entebbe" },
      relay: {
        routeName: "Kampala - Entebbe (practice)", direction: "KLA - EBB", routeCode: "KLA ⇄ EBB", dropMode: "station", lastMile: "collect",
        station: { name: "Peebee Practice Station", address: null, lat: null, lng: null, phone: null },
        heldAt: parcel.heldAt, releasedAt: parcel.releasedAt, releasedTo: parcel.status === "collected" ? "customer" : null,
        legs: [
          leg(1, "boda", "Nakasero", "Kampala Old Taxi Park", "Daniel", "PRACTICE 02", 75, 60),
          leg(2, "matatu", "Kampala Old Taxi Park", "Peebee Practice Station", "Practice matatu", "PRACTICE 14", 60, parcel.status === "incoming" ? null : 1),
        ],
      },
      events: [
        { stage: "Deliver", note: "Picked up from the sender", created_at: nowIso(-75 * 60_000) },
        { stage: "Deliver", note: "On the matatu to Entebbe", created_at: nowIso(-60 * 60_000) },
        ...(parcel.heldAt ? [{ stage: "Deliver", note: "Received at the station", created_at: parcel.heldAt }] : []),
        ...(parcel.releasedAt ? [{ stage: "Settle", note: "Collected by the customer", created_at: parcel.releasedAt }] : []),
      ],
    });
  }
  return practiceError();
}

function practiceEducationRequest(path: string, method: string, body: Record<string, unknown>, searchParams: URLSearchParams): Response {
  const studio = handleStudioSandbox(path, method, body);
  if (studio) return studio;
  if (method === "GET" && path === "/v1/education/streams") return jsonResponse({ ok: true, streams: EDUCATION_STREAMS });
  if (method === "GET" && path === "/v1/education/institutions") return jsonResponse({ ok: true, institutions: DEMO_INSTITUTIONS });
  if (method === "GET" && path.startsWith("/v1/education/institutions/")) return jsonResponse({ ok: true, institution: DEMO_INSTITUTIONS[0] });
  if (method === "GET" && path === "/v1/education/creators") return jsonResponse({ ok: true, creators: DEMO_CREATORS });
  if (method === "GET" && path === "/v1/education/courses") return jsonResponse({ ok: true, courses: DEMO_CREATOR_COURSES });

  // 1. Sprouts
  if (method === "GET" && path === "/v1/education/sprouts/activities") {
    return jsonResponse({
      ok: true,
      activities: DEMO_SPROUTS_ACTIVITIES,
      screenTimer: DEMO_SPROUTS_TIMER,
      coPlayPrompt: DEMO_SPROUTS_COPLAY,
    });
  }
  if (method === "POST" && path === "/v1/education/sprouts/timer/unlock") {
    return jsonResponse({ ok: true, unlocked: true, message: "Screen timer unlocked by parent PIN." });
  }

  // 2. Foundations
  if (method === "GET" && path === "/v1/education/foundations/worksheets") {
    return jsonResponse({
      ok: true,
      worksheets: DEMO_FOUNDATIONS_WORKSHEETS,
      submissions: DEMO_FOUNDATIONS_SUBMISSIONS,
      meritWallet: DEMO_FOUNDATIONS_MERITS,
    });
  }
  if (method === "POST" && path === "/v1/education/foundations/worksheets/submit") {
    const newSubmission = {
      id: `sub_practice_${Date.now()}`,
      worksheetId: String(body.worksheetId ?? DEMO_FOUNDATIONS_WORKSHEETS[0].id),
      worksheetTitle: DEMO_FOUNDATIONS_WORKSHEETS[0].title,
      subject: DEMO_FOUNDATIONS_WORKSHEETS[0].subject,
      studentId: "stud_timothy",
      studentName: "Timothy Mukasa",
      scannedPhotoUrls: ["/sample-homework-scan.jpg"],
      parentSigned: true,
      parentSignerName: String(body.parentSignerName ?? "Grace Mukasa"),
      parentSignedAt: "Just now",
      status: "graded",
      meritPointsEarned: 25,
      teacherRemarks: "Sample practice worksheet verified! Parent signature confirmed.",
      submittedAt: "Just now",
    };
    return jsonResponse({ ok: true, submission: newSubmission });
  }

  // 3. Academy
  if (method === "GET" && path === "/v1/education/academy/dashboard") {
    return jsonResponse({
      ok: true,
      timetable: DEMO_ACADEMY_TIMETABLE,
      activeExam: DEMO_ACADEMY_EXAM,
      reportCard: DEMO_ACADEMY_REPORT_CARD,
    });
  }
  if (method === "POST" && path === "/v1/education/academy/exam/submit") {
    return jsonResponse({
      ok: true,
      scorePercent: 88,
      passed: true,
      message: "Practice UNEB examination graded successfully. Report card generated.",
    });
  }

  // 4. Compass
  if (method === "GET" && path === "/v1/education/compass/course") {
    return jsonResponse({
      ok: true,
      course: DEMO_COMPASS_COURSE,
      peerReview: DEMO_COMPASS_PEER_REVIEW,
      credential: DEMO_COMPASS_CREDENTIAL,
    });
  }
  if (method === "POST" && path === "/v1/education/compass/notes") {
    return jsonResponse({ ok: true, noteId: `note_practice_${Date.now()}` });
  }
  if (method === "POST" && path === "/v1/education/compass/peer-review/submit") {
    return jsonResponse({ ok: true, isComplete: true });
  }

  // 5. Skills
  if (method === "GET" && path === "/v1/education/skills/course") {
    return jsonResponse({
      ok: true,
      course: DEMO_SKILLS_COURSE,
      submission: DEMO_SKILLS_SUBMISSION,
      logbook: DEMO_SKILLS_LOGBOOK,
    });
  }
  if (method === "POST" && path === "/v1/education/skills/practical/submit") {
    return jsonResponse({ ok: true, submission: DEMO_SKILLS_SUBMISSION });
  }
  if (method === "POST" && path === "/v1/education/skills/critiques") {
    return jsonResponse({
      ok: true,
      critique: {
        id: `crit_practice_${Date.now()}`,
        timestampSeconds: Number(body.timestampSeconds) || 30,
        instructorName: "Master Alex Mukasa",
        critiqueText: String(body.critiqueText || "Practice technique correction."),
        severity: "technique_correction",
        resolved: true,
      },
    });
  }
  if (method === "POST" && path === "/v1/education/skills/logbook") {
    return jsonResponse({
      ok: true,
      entry: {
        id: `log_practice_${Date.now()}`,
        studentId: "stud_denis",
        studentName: "Denis Kigozi",
        date: new Date().toISOString().slice(0, 10),
        practicalHours: Number(body.practicalHours) || 4.0,
        taskPerformed: String(body.taskPerformed || "Practice workshop haircut"),
        workshopLocation: "Peebee Barber Studio",
        supervisorName: "Master Alex Mukasa",
        supervisorSignatureRecorded: true,
        supervisorSignedAt: "Just now",
      },
    });
  }

  // Tuition & Billing
  if (method === "GET" && path === "/v1/education/tuition") {
    return jsonResponse({
      ok: true,
      invoice: DEMO_TUITION_INVOICE,
      passes: DEMO_SUBSCRIPTION_PASSES,
      guardianAlerts: DEMO_GUARDIAN_ALERTS,
    });
  }
  if (method === "POST" && path === "/v1/education/tuition/pay") {
    return jsonResponse({
      ok: true,
      receiptId: `REC_PRACTICE_${Date.now()}`,
      newBalanceUgx: 0,
      status: "paid",
    });
  }

  // Live Meetings & Classroom Video
  if (method === "GET" && path === "/v1/education/live/meetings") {
    const stream = searchParams.get("stream");
    const filtered = stream ? DEMO_LIVE_MEETINGS.filter((m) => m.stream === stream) : DEMO_LIVE_MEETINGS;
    return jsonResponse({ ok: true, meetings: filtered, activeMeeting: DEMO_LIVE_MEETINGS[0] });
  }
  if (method === "GET" && path.startsWith("/v1/education/live/meetings/")) {
    const id = path.split("/").pop();
    const meeting = DEMO_LIVE_MEETINGS.find((m) => m.id === id || m.roomCode === id) || DEMO_LIVE_MEETINGS[0];
    return jsonResponse({
      ok: true,
      meeting,
      participants: DEMO_LIVE_PARTICIPANTS,
      messages: DEMO_LIVE_CHAT_MESSAGES,
    });
  }

  // Live Tutor Chat
  if (method === "GET" && path === "/v1/education/chat/tutors") {
    return jsonResponse({ ok: true, tutors: DEMO_TUTOR_CONTACTS });
  }
  if (method === "GET" && path === "/v1/education/chat/messages") {
    return jsonResponse({ ok: true, messages: DEMO_LIVE_CHAT_MESSAGES });
  }
  if (method === "POST" && path === "/v1/education/chat/send") {
    return jsonResponse({
      ok: true,
      message: {
        id: `msg_practice_${Date.now()}`,
        roomId: body.roomId,
        channelId: body.channelId,
        senderId: "part_denis",
        senderName: "Denis Kigozi",
        senderRole: "student",
        text: String(body.text || ""),
        timestamp: "Just now",
        isQuestion: Boolean(body.isQuestion),
        upvotes: 0,
      },
    });
  }

  return practiceError();
}

/** A fail-closed fetch adapter. While practice is active, only settings and
 * identity reads reach the real API. Operational requests are answered from
 * browser-local sample state or rejected before leaving the device. */
const PLATFORM_ENVIRONMENT_KEY = "peebee_platform_environment";

/**
 * True while staff have the whole platform in sandbox (Admin). That is the developer's switch: every app then works on the
 * same demo data practice mode uses, but without the practice bar, because nobody chose practice. It is not practice mode;
 * a person switches that on for themselves and it adds the bar.
 */
export function isSandboxDemo(): boolean {
  return canUseStorage() && window.localStorage.getItem(PLATFORM_ENVIRONMENT_KEY) === "sandbox";
}

/** Remembers which environment the platform is in (read from the settings the app fetches anyway). */
function rememberPlatformEnvironment(environment: unknown) {
  if (!canUseStorage() || (environment !== "sandbox" && environment !== "live")) return;
  const before = window.localStorage.getItem(PLATFORM_ENVIRONMENT_KEY);
  if (before === environment) return;
  window.localStorage.setItem(PLATFORM_ENVIRONMENT_KEY, environment);
  // What is on screen was loaded the other way round: reload once so it shows the data for the new environment.
  if ((before === "sandbox") !== (environment === "sandbox") && typeof window.location?.reload === "function") window.location.reload();
}

/** Everything the Channels feature serves. */
const CHANNELS_PATHS = /^\/v1\/(channels|posts|comments|spotlight\/feed|public\/(channels|causes|donations|media)|creator|live|airings|subscriptions|tiers|ads|video|admin\/(channels|video|ads))(\/|$|\?)/;

const TAXIPRESS_STAFF_SETTINGS = [
  "luggageEnabled", "luggageTypes", "luggagePrices", "assistanceEnabled", "languageEnabled", "languages", "bookForOthersEnabled", "ticketSharingEnabled", "maxLapChildren", "childSeatFarePercent",
  "cashEnabled", "seatChoiceFeeUgx", "returnDiscountPercent", "maxSeatsPerBooking", "payWithinMinutes", "parcelFitText", "parcelNotAllowed",
] as const;

async function overlayTaxipressSettings(sample: Response, real: () => Promise<Response>): Promise<Response> {
  try {
    const live = (await (await real()).json()) as Record<string, unknown>;
    const base = (await sample.clone().json()) as Record<string, unknown>;
    for (const key of TAXIPRESS_STAFF_SETTINGS) if (live[key] !== undefined) base[key] = live[key];
    rememberPracticeTaxipressOptions(base);
    return jsonResponse(base);
  } catch {
    // Offline or refused: the sample's own defaults apply.
    rememberPracticeTaxipressOptions({});
    return sample;
  }
}

export function createPracticeFetch(role: PracticeRole, realFetch: typeof fetch = fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    // Practising against the shared world: the server answers, nothing is simulated here.
    if (isServerPractice()) return realFetch(input, init);
    const request = input instanceof Request ? input : null;
    const url = new URL(request?.url ?? String(input), typeof window !== "undefined" ? window.location.origin : "http://localhost");
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const practice = isPracticeMode();
    const sandbox = !practice && isSandboxDemo();

    // The settings are always the real ones; they also tell this app whether staff have put the platform in sandbox.
    if (url.pathname === "/v1/settings") {
      const response = await realFetch(input, init);
      if (method === "GET") void response.clone().json().then((body: { settings?: { platformEnvironment?: unknown } }) => rememberPlatformEnvironment(body?.settings?.platformEnvironment)).catch(() => undefined);
      return response;
    }
    if (!practice && !sandbox) return realFetch(input, init);
    if (url.pathname.startsWith("/v1/practice/") || (url.pathname === "/v1/auth/me" && method === "GET")) return realFetch(input, init);
    // Signing in and out stays real in sandbox: the developer still uses their own account.
    if (sandbox && url.pathname.startsWith("/v1/auth/")) return realFetch(input, init);
    if (url.pathname === "/v1/auth/logout" && method === "POST") return jsonResponse({ ok: true });
    if (!url.pathname.startsWith("/v1/")) return realFetch(input, init);
    // Channels, creator video and ads. Sandbox talks to the real sandbox data; practice mode never creates anything real.
    if (CHANNELS_PATHS.test(url.pathname)) {
      if (sandbox) return realFetch(input, init);
      // Spotlight shows demo posts from every kind of publisher; everything else in Channels stays off.
      const demoPosts = practiceSpotlightPosts(url.pathname, method, url.searchParams);
      if (demoPosts) return jsonResponse(demoPosts);
      if (url.pathname === "/v1/channels/config") return jsonResponse({ enabled: false });
      if (method === "GET") return jsonResponse({ error: "channels_unavailable", message: "Channels are not part of practice mode." }, 503);
      return jsonResponse({ error: "channels_unavailable", message: "Channels are not part of practice mode." }, 503);
    }
    const sample = handlePracticeRequest(role, url.pathname, method, parseBody(init), url.searchParams);
    // Taxipress's routes and taxis are the sample's, but the options staff control (luggage, assistance, languages, cash, limits)
    // are the platform's real settings, so what admin changes shows up here too.
    if (role === "customer" && method === "GET" && url.pathname === "/v1/taxipress/config") return overlayTaxipressSettings(sample, () => realFetch(input, init));
    return sample;
  }) as typeof fetch;
}
