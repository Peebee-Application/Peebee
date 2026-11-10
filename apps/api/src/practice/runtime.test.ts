import assert from "node:assert/strict";
import test from "node:test";
import {
  CAR_MODEL_CATALOG,
  type FoodSellerOrders,
  createPracticeFetch,
  discardPracticeSession,
  isPracticeJourneyComplete,
  isPracticeMode,
  isSandboxDemo,
  isServerPractice,
  startPracticeMode,
} from "@peebee/shared";

test("Food practice order tabs stay local and follow the sample settlement", async () => {
  installStorage();
  const fetcher = createPracticeFetch("restaurant", (async () => { throw new Error("Must not access live orders"); }) as typeof fetch);
  startPracticeMode("restaurant");
  const first = await (await fetcher("https://api.test/v1/restaurants/me/orders?view=active")).json() as FoodSellerOrders;
  assert.equal(first.orders.length, 1); assert.equal(first.orders[0].stage, "Shop");
  assert.equal((await (await fetcher("https://api.test/v1/restaurants/me/orders?view=history")).json() as FoodSellerOrders).orders.length, 0);
  await fetcher("https://api.test/v1/merchant-payments/mpay_practice/merchant-confirm", { method: "POST", body: "{}" });
  await fetcher("https://api.test/v1/merchants/merchant-practice/settlements", { method: "POST", body: "{}" });
  const history = await (await fetcher("https://api.test/v1/restaurants/me/orders?view=history")).json() as FoodSellerOrders;
  assert.equal(history.orders.length, 1); assert.equal(history.orders[0].stage, "Settle"); assert.deepEqual(history.counts, { active: 0, history: 1 });
});

test("Fuel attendant practice: receive a relay parcel from the matatu, then the customer collects it", async () => {
  installStorage();
  const fetcher = createPracticeFetch("gas", (async () => { throw new Error("Must not access live parcels"); }) as typeof fetch);
  startPracticeMode("gas");
  type Parcels = { incoming: { order_id: string; operator_name: string }[]; held: { customer_name: string }[]; recent: unknown[] };
  const parcels = async () => (await (await fetcher("https://api.test/v1/gas/relay/parcels")).json()) as Parcels;
  const post = (path: string, code: string) => fetcher(`https://api.test/v1/gas/relay/${path}`, { method: "POST", body: JSON.stringify({ code }) });
  const first = await parcels();
  assert.equal(first.incoming.length, 1);
  const matatuCode = first.incoming[0].operator_name.match(/\d{6}/)![0];
  assert.equal((await post("release", "135790")).status, 404, "nothing to hand over before it arrives");
  assert.equal((await post("receive", "000000")).status, 404);
  assert.equal((await post("receive", matatuCode)).status, 200);
  const held = await parcels();
  assert.equal(held.incoming.length, 0);
  const customerCode = held.held[0].customer_name.match(/\d{6}/)![0];
  assert.equal((await post("release", customerCode)).status, 200);
  const done = await parcels();
  assert.deepEqual([done.held.length, done.recent.length], [0, 1]);
  const journey = (await (await fetcher(`https://api.test/v1/gas/relay/parcels/${first.incoming[0].order_id}`)).json()) as { relay: { releasedTo: string } };
  assert.equal(journey.relay.releasedTo, "customer");
});

test("practice: a ride is taken by a driver at once, and calling the driver is answered at once", async () => {
  installStorage();
  const fetcher = createPracticeFetch("customer", (async () => { throw new Error("Must not access live calls"); }) as typeof fetch);
  startPracticeMode("customer");
  const post = (path: string, body: object = {}) => fetcher(`https://api.test/v1${path}`, { method: "POST", body: JSON.stringify(body) });
  const booked = await post("/car/bookings", { serviceTier: "comfort", vehicleSize: "large", pickupLat: 0.0512, pickupLng: 32.4637, destinationLat: 0.0712, destinationLng: 32.4837, pickupAddress: "Entebbe", destinationAddress: "Kitoro" });
  assert.equal(booked.status, 201);
  const { order } = await booked.json() as { order: { rider_id: string | null; car_driver_name: string | null } };
  assert.ok(order.rider_id?.startsWith("practice-car-driver-"), "a driver has already accepted");
  assert.ok(order.car_driver_name);
  const placed = await post("/calls", { calleeId: order.rider_id, orderId: "practice-order" });
  assert.equal(placed.status, 201);
  const { call } = await placed.json() as { call: { id: string; status: string; provider: string } };
  assert.deepEqual([call.status, call.provider], ["accepted", "mock"]);
  assert.equal(((await (await fetcher(`https://api.test/v1/calls/${call.id}`)).json()) as { call: { status: string } }).call.status, "accepted");
  assert.equal(((await (await post(`/calls/${call.id}/end`, { reason: "ended" })).json()) as { call: { status: string } }).call.status, "ended");
});

function installStorage() {
  const values = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage, location: { origin: "https://customer.test" } } });
}

test("customer practice runs the real order API contract without reaching live fetch", async () => {
  installStorage();
  let liveCalls = 0;
  const practiceFetch = createPracticeFetch("customer", (async () => {
    liveCalls += 1;
    throw new Error("live fetch must not be called");
  }) as typeof fetch);
  startPracticeMode("customer");

  await practiceFetch("https://api.test/v1/lists", { method: "POST", body: JSON.stringify({ items: [{ name: "Rice", quantity: 1, unitCost: 10_000 }] }) });
  await practiceFetch("https://api.test/v1/orders", { method: "POST", body: JSON.stringify({ type: "shopping", estimatedTotal: 10_000 }) });
  const created = await (await practiceFetch("https://api.test/v1/orders/practice-order")).json() as { order: { stage: string; rider_id: string | null } };
  assert.equal(created.order.stage, "Create");
  assert.equal(created.order.rider_id, null);

  await practiceFetch("https://api.test/v1/orders/practice-order/match", { method: "POST" });
  await practiceFetch("https://api.test/v1/orders/practice-order/fund", { method: "POST", body: "{}" });
  const funded = await (await practiceFetch("https://api.test/v1/orders/practice-order")).json() as { order: { stage: string; rider_id: string | null } };
  assert.equal(funded.order.stage, "Shop");
  assert.equal(funded.order.rider_id, "practice-rider");
  assert.equal(liveCalls, 0);
});

test("practice car picker defaults to normal convenient and assigns random all-distance demo drivers", async () => {
  installStorage();
  const practiceFetch = createPracticeFetch("customer", (async () => { throw new Error("live fetch must not be called"); }) as typeof fetch);
  startPracticeMode("customer");
  const config = await (await practiceFetch("https://api.test/v1/car/config")).json() as { serviceTiers: object; categories: Array<{ id: string; seats: number }> };
  assert.ok(config.serviceTiers);
  assert.ok(config.categories.some((category) => category.seats === 4));
  assert.ok(config.categories.some((category) => category.seats === 7));
  const distantOptions = await (await practiceFetch("https://api.test/v1/car/service-options?pickupLat=80&pickupLng=140&destinationLat=-70&destinationLng=-140")).json() as { options: Array<{ size: string; tier: string; nearby: number }> };
  assert.equal(distantOptions.options.length, 4);
  assert.ok(distantOptions.options.every((option) => option.nearby === 2), "practice drivers are available regardless of distance");
  const defaultOption = distantOptions.options.find((option) => option.size === "normal" && option.tier === "convenient");
  assert.equal(defaultOption?.nearby, 2);

  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    let response = await practiceFetch("https://api.test/v1/car/bookings", { method: "POST", body: JSON.stringify({ vehicleSize: "large", serviceTier: "comfort", pickupLat: 0, pickupLng: 0, destinationLat: 0.01, destinationLng: 0.01 }) });
    assert.equal(response.status, 201);
    let info = await (await practiceFetch("https://api.test/v1/car/bookings/practice-order/info")).json() as { driverName: string; vehicleName: string };
    assert.equal(info.driverName, "Amina Nankya");
    assert.match(info.vehicleName, /Toyota Voxy/);
    Math.random = () => 0.99;
    response = await practiceFetch("https://api.test/v1/car/bookings", { method: "POST", body: JSON.stringify({ vehicleSize: "large", serviceTier: "comfort", pickupLat: -75, pickupLng: 100, destinationLat: 70, destinationLng: -100 }) });
    assert.equal(response.status, 201);
    info = await (await practiceFetch("https://api.test/v1/car/bookings/practice-order/info")).json() as { driverName: string; vehicleName: string };
    assert.equal(info.driverName, "Ruth Atim");
    assert.match(info.vehicleName, /Toyota Noah/);
  } finally {
    Math.random = originalRandom;
  }
});

test("rideshare practice lists nearby trips and books them without live network access", async () => {
  installStorage();
  const practiceFetch = createPracticeFetch("customer", (async () => { throw new Error("live fetch must not be called"); }) as typeof fetch);
  startPracticeMode("customer");

  const response = await practiceFetch("https://api.test/v1/car/carpool/trips?nearLat=0.32&nearLng=32.58&nearLabel=Kitaasa");
  const result = await response.json() as { trips: Array<{ id: string; originLabel: string; driverName: string; seatPrice: number }> };
  assert.ok(result.trips.length > 0);
  assert.match(result.trips[0].originLabel, /Kitaasa/);
  assert.doesNotMatch(result.trips[0].driverName, /demo/i, "the global header indicates practice mode");
  assert.ok(result.trips.every((trip) => trip.seatPrice > 0));

  const booking = await practiceFetch(`https://api.test/v1/car/carpool/trips/${result.trips[0].id}/seats`, {
    method: "POST",
    body: JSON.stringify({ seats: 1 }),
  });
  assert.equal(booking.status, 201);
  const body = await booking.json() as { order: { rider_id: string | null; estimated_total: number } };
  assert.match(body.order.rider_id ?? "", /^practice-car-driver-/);
  assert.equal(body.order.estimated_total, result.trips[0].seatPrice);
});

test("practice parcel fare and stored total use the same rounded amount", async () => {
  installStorage();
  const practiceFetch = createPracticeFetch("customer", (async () => { throw new Error("live fetch must not be called"); }) as typeof fetch);
  startPracticeMode("customer");
  for (const [estimatedTotal, expected] of [[3_102, 3_500], [3_100, 3_000], [3_350, 3_500]]) {
    const response = await practiceFetch("https://api.test/v1/orders", {
      method: "POST",
      body: JSON.stringify({ type: "parcel", estimatedTotal }),
    });
    const { order } = await response.json() as { order: { estimated_total: number; delivery_fee: number } };
    assert.equal(order.delivery_fee, expected);
    assert.equal(order.estimated_total, expected);
  }
});

test("merchant practice confirmation marks that role's journey complete", async () => {
  installStorage();
  const practiceFetch = createPracticeFetch("merchant", (async () => { throw new Error("live fetch must not be called"); }) as typeof fetch);
  startPracticeMode("merchant");
  assert.equal(isPracticeJourneyComplete("merchant"), false);
  await practiceFetch("https://api.test/v1/merchant-payments/mpay_practice/merchant-confirm", { method: "POST", body: JSON.stringify({ amount: 28_000 }) });
  assert.equal(isPracticeJourneyComplete("merchant"), true);
});

test("Taxipress practice: book with the practice wallet and follow the taxi from the line to arrival", async (t) => {
  installStorage();
  const fetcher = createPracticeFetch("customer", (async () => { throw new Error("Must not access live Taxipress"); }) as typeof fetch);
  startPracticeMode("customer");
  const get = async (path: string) => (await fetcher(`https://api.test${path}`)).json() as Promise<any>;
  const post = (path: string, body: object = {}) => fetcher(`https://api.test${path}`, { method: "POST", body: JSON.stringify(body) });

  const config = await get("/v1/taxipress/config");
  assert.equal(config.enabled, true);
  assert.equal(config.routes[0].fromName, "Entebbe Stage", "practice starts where the customer is");
  const line = await get(`/v1/taxipress/routes/${config.routes[0].id}/queue`);
  assert.equal(line.line.length, 3);
  const taxi = line.line[0];
  assert.equal((await get("/v1/wallet")).balance, 2_000_000, "the practice wallet starts loaded");

  const booked = await post("/v1/taxipress/bookings", { queueId: taxi.id, seats: 2, payment: "app" });
  assert.equal(booked.status, 201);
  const { booking } = (await booked.json()) as { booking: any };
  assert.equal(booking.paymentStatus, "paid");
  assert.equal(booking.amount, 2 * config.routes[0].farePerSeat);
  assert.equal((await get("/v1/wallet")).balance, 2_000_000 - booking.amount, "the seats were paid for from the practice wallet");
  assert.equal((await get(`/v1/taxipress/routes/${config.routes[0].id}/queue`)).line[0].seatsLeft, taxi.seatsLeft - 2);

  assert.equal((await post("/v1/taxipress/bookings", { queueId: taxi.id, seats: 99, payment: "app" })).status, 400);
  assert.equal((await post("/v1/taxipress/bookings", { queueId: taxi.id, seats: 4, payment: "app" })).status, 409, "no room for four more");
  const cash = await post("/v1/taxipress/bookings", { queueId: line.line[2].id, seats: 1, payment: "cash" });
  const cashBooking = ((await cash.json()) as { booking: any; order: { id: string } });
  assert.equal(cashBooking.booking.paymentStatus, "pay_driver");
  assert.equal((await post(`/v1/orders/${cashBooking.order.id}/fund`, { paymentMethod: "cash" })).status, 200);
  assert.equal((await get("/v1/wallet")).balance, 2_000_000 - booking.amount, "cash does not touch the wallet");

  const now = Date.now();
  const at = async (seconds: number) => {
    t.mock.method(Date, "now", () => now + seconds * 1000);
    return (await get(`/v1/taxipress/bookings/${booking.id}`)).booking;
  };
  assert.deepEqual(((b) => [b.status, b.taxi.status])(await at(5)), ["booked", "in_line"], "waiting in the line");
  assert.deepEqual(((b) => [b.status, b.taxi.status])(await at(25)), ["booked", "boarding"], "boarding now");
  assert.deepEqual(((b) => [b.status, b.taxi.status])(await at(45)), ["boarded", "boarding"], "the driver confirmed the ticket");
  assert.deepEqual(((b) => [b.status, b.taxi.status])(await at(80)), ["boarded", "on_road"]);
  const road = await get(`/v1/taxipress/routes/${config.routes[0].id}/queue`);
  assert.equal(road.onRoad.length, 2, "the cash booking on another taxi has set off too");
  assert.equal(road.line.length, 1);
  assert.deepEqual(((b) => [b.status, b.taxi.status])(await at(120)), ["completed", "arrived"]);
  assert.equal((await get(`/v1/taxipress/routes/${config.routes[0].id}/queue`)).line.length, 3, "the taxi is back in the line");

  const broke = await post("/v1/taxipress/bookings", { queueId: line.line[1].id, seats: 1, payment: "app" });
  assert.equal(broke.status, 201);
  assert.equal((await get("/v1/taxipress/bookings/mine")).bookings.length, 3);
  const ledger = (await get("/v1/wallet")).ledger as Array<{ type: string }>;
  assert.equal(ledger.filter((e) => e.type === "order_payment").length, 2);
  t.mock.restoreAll();
});

test("Entebbe practice: shop and food orders paid from the practice wallet, a rider takes them and rings on arrival", async (t) => {
  installStorage();
  const fetcher = createPracticeFetch("customer", (async () => { throw new Error("Must not access the live app"); }) as typeof fetch);
  startPracticeMode("customer");
  const get = async (path: string) => (await fetcher(`https://api.test${path}`)).json() as Promise<any>;
  const post = (path: string, body: object = {}) => fetcher(`https://api.test${path}`, { method: "POST", body: JSON.stringify(body) });

  // The world is centred on Entebbe, with a few Kampala shops for the long way round.
  const stores = (await get("/v1/marketplace/stores?lat=0.0612&lng=32.4637")).stores as Array<{ id: string; name: string; address: string; distance_km: number; category: string }>;
  assert.equal(stores.filter((s) => s.id.startsWith("pe_")).length, 10);
  assert.equal(stores.filter((s) => !s.id.startsWith("pe_")).length, 3, "very few shops in Kampala");
  assert.ok(stores.slice(0, 10).every((s) => s.id.startsWith("pe_")), "the nearest shops are the Entebbe ones");
  assert.ok(stores[0].distance_km < 3);
  for (const category of ["groceries", "stores", "pharmacy"]) assert.ok(stores.some((s) => s.id.startsWith("pe_") && s.category === category), `Entebbe ${category}`);
  const products = (await get("/v1/marketplace/stores/pe_lakeside_mart/products")).products as Array<{ id: string; title: string; price: number }>;
  assert.ok(products.length >= 5);
  const restaurants = (await get("/v1/restaurants")).restaurants as Array<{ id: string; address: string; name: string }>;
  assert.equal(restaurants.length, 12);
  assert.ok(restaurants.every((r) => /Entebbe|Katabi|Kitoro|Lunyo|Bugonga/.test(r.address)), "every food place is around Entebbe");
  assert.equal((await get("/v1/pharmacy/pharmacies")).pharmacies.filter((p: { id: string }) => p.id.startsWith("pe_")).length, 2);

  // A shop order: a rider is found for you, you pay from the wallet, and the rider brings it.
  const milk = products[0]!;
  const checkout = await post("/v1/marketplace/checkout", { items: [{ storeId: "pe_lakeside_mart", title: milk.title, quantity: 2, price: milk.price }], destinationAddress: "Kitoro Road, Entebbe" });
  assert.equal(checkout.status, 201);
  const { order } = (await checkout.json()) as { order: any };
  assert.equal(order.stage, "Match");
  assert.ok(order.rider_id && order.rider_name !== "Daniel", "a rider from the Entebbe roster took it");
  assert.equal(order.pickup_address, "Victoria Mall, Entebbe Road");
  assert.ok(order.delivery_fee >= 3_000 && order.delivery_fee < 10_000, "a short boda ride inside Entebbe");
  const total = 2 * milk.price + order.delivery_fee;
  assert.equal(order.estimated_total, total);

  const before = (await get("/v1/wallet")).balance as number;
  assert.equal((await post("/v1/orders/practice-order/fund", { paymentMethod: "wallet", useWallet: true })).status, 200);
  assert.equal((await get("/v1/wallet")).balance, before - total, "the order was paid from the practice wallet");
  const now = Date.now();
  const stageAt = async (seconds: number) => {
    t.mock.method(Date, "now", () => now + seconds * 1000);
    return ((await get("/v1/orders/practice-order")).order as { stage: string }).stage;
  };
  assert.equal(await stageAt(5), "Shop", "the rider is collecting it");
  assert.equal(await stageAt(30), "Deliver", "on the way");
  assert.equal(await stageAt(60), "Arrived", "at your door");
  assert.equal((await post("/v1/orders/practice-order/handover", { pin: "2468" })).status, 200);
  assert.equal(((await get("/v1/orders/practice-order")).order as { stage: string }).stage, "Settle");
  t.mock.restoreAll();

  // A shop in Kampala is the long way round, so it costs more to deliver.
  const kampala = await post("/v1/marketplace/checkout", { items: [{ storeId: "store_demo_fresh_mart", title: "Eggs", quantity: 1, price: 13_500 }] });
  assert.equal(((await kampala.json()) as { order: { delivery_fee: number } }).order.delivery_fee, 18_000);

  // Food: the dishes and their choices are priced from the menu.
  const menu = await get("/v1/restaurants/demo-food-lakeview/menu");
  const dish = menu.categories.flatMap((c: any) => c.items).find((i: any) => i.options?.length) as { id: string; price: number; options: Array<{ choices: Array<{ id: string; price_delta: number }> }> };
  const large = dish.options[0]!.choices.find((c) => c.price_delta > 0)!;
  const food = await post("/v1/restaurants/demo-food-lakeview/order", { items: [{ menuItemId: dish.id, quantity: 2, choiceIds: [large.id] }], destinationAddress: "Kitoro Road, Entebbe" });
  assert.equal(food.status, 201);
  const foodOrder = ((await food.json()) as { order: any }).order;
  assert.equal(foodOrder.restaurant_name, "Lakeview Kitchen");
  assert.equal(foodOrder.estimated_total, 2 * (dish.price + large.price_delta) + foodOrder.delivery_fee);
  assert.equal(foodOrder.stage, "Match");
  const detail = await get("/v1/orders/practice-order");
  assert.equal(detail.items[0].quantity, 2);

  // Not enough in the wallet: nothing is taken and the order is not paid.
  const huge = await post("/v1/restaurants/demo-food-lakeview/order", { items: [{ menuItemId: dish.id, quantity: 500 }] });
  assert.equal(huge.status, 201);
  const wallet = (await get("/v1/wallet")).balance as number;
  const declined = await post("/v1/orders/practice-order/fund", { paymentMethod: "wallet", useWallet: true });
  assert.equal(declined.status, 409);
  assert.equal(((await declined.json()) as { error: string }).error, "insufficient_funds");
  assert.equal((await get("/v1/wallet")).balance, wallet);
  assert.equal(((await get("/v1/orders/practice-order")).order as { stage: string }).stage, "Match");
});

test("Cars and trucks practice: Entebbe drivers, a truck for a move, wallet payment and self-drive hire", async () => {
  installStorage();
  const fetcher = createPracticeFetch("customer", (async () => { throw new Error("Must not access the live app"); }) as typeof fetch);
  startPracticeMode("customer");
  const get = async (path: string) => (await fetcher(`https://api.test${path}`)).json() as Promise<any>;
  const post = (path: string, body: object = {}) => fetcher(`https://api.test${path}`, { method: "POST", body: JSON.stringify(body) });
  const entebbe = { pickupLat: 0.0612, pickupLng: 32.4637, pickupAddress: "Kitoro Road, Entebbe" };
  const kampala = { destinationLat: 0.3136, destinationLng: 32.5811, destinationArea: "Kampala", destinationAddress: "Nakasero, Kampala" };

  // A move: the right truck and its driver come, not a passenger car.
  const quote = (await (await post("/v1/car/quote", { categoryId: "peebee-cargo-truck-3t", ...entebbe, ...kampala })).json()) as { fare: number };
  assert.ok(quote.fare >= 45_000);
  const booked = await post("/v1/car/bookings", { categoryId: "peebee-cargo-truck-3t", ...entebbe, ...kampala, cargoDescription: "Sofa, bed and ten boxes" });
  assert.equal(booked.status, 201);
  const { order } = (await booked.json()) as { order: any };
  assert.equal(order.rider_id, "practice-car-driver-cargo-truck-3t");
  assert.equal(order.stage, "Match");
  assert.equal(order.estimated_total, quote.fare, "the booking costs what the quote said");
  assert.equal(order.pickup_address, "Kitoro Road, Entebbe");
  const info = await get("/v1/car/bookings/practice-order/info");
  assert.deepEqual([info.categoryName, info.vehicleName, info.plate, info.driverName], ["Box Truck (3 Ton)", "Isuzu NPR box truck", "UBP 631T", "George Mwesigwa"]);
  assert.equal((await get("/v1/orders/practice-order")).items[0].name, "Sofa, bed and ten boxes");
  const wallet = (await get("/v1/wallet")).balance as number;
  assert.equal((await post("/v1/orders/practice-order/fund", { paymentMethod: "wallet", useWallet: true })).status, 200);
  assert.equal((await get("/v1/wallet")).balance, wallet - quote.fare, "the move was paid from the practice wallet");

  // A car ride in Entebbe: a real-looking plate, paid from the wallet.
  const ride = await post("/v1/car/bookings", { vehicleSize: "normal", serviceTier: "convenient", ...entebbe, destinationLat: 0.0424, destinationLng: 32.4435, destinationArea: "Entebbe Airport", destinationAddress: "Entebbe International Airport" });
  const rideOrder = ((await ride.json()) as { order: any }).order;
  assert.match((await get("/v1/car/bookings/practice-order/info")).plate, /^U[A-Z]{2} \d{3}[A-Z]$/);
  const beforeRide = (await get("/v1/wallet")).balance as number;
  assert.equal((await post("/v1/orders/practice-order/fund", { paymentMethod: "wallet", useWallet: true })).status, 200);
  assert.equal((await get("/v1/wallet")).balance, beforeRide - rideOrder.estimated_total);

  // Self-drive hire: rent and deposit leave the wallet, the deposit comes back on return.
  const listings = (await get("/v1/car/rentals/listings")).vehicles as Array<{ id: string; category: string; notes: string; hourlyEnabled: boolean; deposit: number }>;
  assert.ok(listings.some((v) => v.category === "Pickup") && listings.some((v) => v.category === "Van"), "a pickup and a van for hire");
  assert.ok(listings.every((v) => !/demo/i.test(v.notes)));
  const car = listings.find((v) => v.id === "practice-rent-dmax")!;
  const cash = (await get("/v1/wallet")).balance as number;
  const start = new Date().toISOString();
  const rented = await post("/v1/car/rentals", { vehicleId: car.id, periodType: "full_day", startsAt: start, endsAt: new Date(Date.now() + 86_400_000).toISOString(), licenceNumber: "CM12345", licenceExpiry: "2030-01-01" });
  assert.equal(rented.status, 201);
  const rental = (await rented.json()) as { id: string; rent: number; deposit: number };
  assert.equal((await get("/v1/wallet")).balance, cash - rental.rent - rental.deposit);
  assert.match(((await get("/v1/car/rentals/mine")).rentals[0] as { plate: string }).plate, /^U[A-Z]{2} \d{3}[A-Z]$/);
  assert.equal((await post(`/v1/car/rentals/${rental.id}/demo-return`)).status, 200);
  assert.equal((await get("/v1/wallet")).balance, cash - rental.rent, "the deposit came back");
  assert.equal((await post(`/v1/car/rentals/${rental.id}/demo-return`)).status, 200);
  assert.equal((await get("/v1/wallet")).balance, cash - rental.rent, "returning twice does not refund twice");

  // Not enough in the wallet: nothing is taken.
  const hourly = listings.find((v) => v.hourlyEnabled)!;
  const before = (await get("/v1/wallet")).balance as number;
  const tooMuch = await post("/v1/car/rentals", { vehicleId: hourly.id, periodType: "hourly", startsAt: start, endsAt: new Date(Date.now() + 100_000 * 3_600_000).toISOString() });
  assert.equal(tooMuch.status, 409);
  assert.equal(((await tooMuch.json()) as { error: string }).error, "insufficient_funds");
  assert.equal((await get("/v1/wallet")).balance, before);
});

test("the self-drive model catalogue has real seats, fuel use and a daily price for every model", () => {
  assert.ok(CAR_MODEL_CATALOG.length >= 40);
  for (const model of CAR_MODEL_CATALOG) {
    assert.ok(Number.isInteger(model.seats) && model.seats >= 2 && model.seats <= 16, `${model.id} seats`);
    assert.ok(model.fuelLitresPerKm > 0 && model.fuelLitresPerKm < 1, `${model.id} fuel`);
    assert.ok(Number.isFinite(model.standardDailyUgx) && model.standardDailyUgx >= 50_000, `${model.id} price`);
    assert.ok(model.variant === undefined || typeof model.variant === "string", `${model.id} variant`);
  }
  assert.equal(CAR_MODEL_CATALOG.find((m) => m.id === "toyota-aqua")?.variant, "Hybrid");
});

test("Taxipress practice: cancel a seat before boarding and get the fare back; not once on board", async (t) => {
  installStorage();
  const fetcher = createPracticeFetch("customer", (async () => { throw new Error("Must not access live Taxipress"); }) as typeof fetch);
  startPracticeMode("customer");
  const get = async (path: string) => (await fetcher(`https://api.test${path}`)).json() as Promise<any>;
  const post = (path: string, body: object = {}) => fetcher(`https://api.test${path}`, { method: "POST", body: JSON.stringify(body) });
  const config = await get("/v1/taxipress/config");
  const routeId = config.routes[0].id as string;
  const taxi = (await get(`/v1/taxipress/routes/${routeId}/queue`)).line[1] as { id: string; seatsLeft: number };

  const paid = ((await (await post("/v1/taxipress/bookings", { queueId: taxi.id, seats: 2, payment: "app" })).json()) as { booking: any }).booking;
  assert.deepEqual([paid.cancel.allowed, paid.cancel.free, paid.cancel.fee, paid.cancel.refund], [true, true, 0, 16_000], "the ticket shows what a cancel would refund");
  assert.equal(paid.outcome, null);
  const wallet = (await get("/v1/wallet")).balance as number;
  const done = await post(`/v1/taxipress/bookings/${paid.id}/cancel`);
  assert.equal(done.status, 200);
  assert.deepEqual(((await done.json()) as { outcome: object }).outcome, { kind: "cancelled", refunded: 16_000, fee: 0 });
  assert.equal((await get("/v1/wallet")).balance, wallet + 16_000, "the fare went back to the practice wallet");
  const after = (await get(`/v1/taxipress/bookings/${paid.id}`)).booking;
  assert.deepEqual([after.status, after.paymentStatus, after.cancel.allowed, after.outcome.refunded], ["cancelled", "cancelled", false, 16_000]);
  assert.equal((await get(`/v1/taxipress/routes/${routeId}/queue`)).line.find((x: { id: string }) => x.id === taxi.id).seatsLeft, taxi.seatsLeft, "the seats are free again");
  assert.equal((await post(`/v1/taxipress/bookings/${paid.id}/cancel`)).status, 409, "no second refund");
  assert.equal((await get("/v1/wallet")).balance, wallet + 16_000);

  const cash = ((await (await post("/v1/taxipress/bookings", { queueId: taxi.id, seats: 1, payment: "cash" })).json()) as { booking: any }).booking;
  const cashDone = await post(`/v1/taxipress/bookings/${cash.id}/cancel`);
  assert.deepEqual(((await cashDone.json()) as { outcome: object }).outcome, { kind: "cancelled", refunded: 0, fee: 0 });

  const boarding = ((await (await post("/v1/taxipress/bookings", { queueId: taxi.id, seats: 1, payment: "app" })).json()) as { booking: any }).booking;
  const now = Date.now();
  t.mock.method(Date, "now", () => now + 25_000);
  assert.equal((await get(`/v1/taxipress/bookings/${boarding.id}`)).booking.cancel.allowed, true, "still allowed while the taxi is boarding");
  t.mock.method(Date, "now", () => now + 45_000);
  const onBoard = (await get(`/v1/taxipress/bookings/${boarding.id}`)).booking;
  assert.equal(onBoard.status, "boarded");
  assert.equal(onBoard.cancel.allowed, false);
  assert.equal((await post(`/v1/taxipress/bookings/${boarding.id}/cancel`)).status, 409);
  t.mock.restoreAll();
});

test("Taxipress practice: a boarded seat has a receipt that verifies, and a cancelled or waiting one does not", async (t) => {
  installStorage();
  const fetcher = createPracticeFetch("customer", (async () => { throw new Error("Must not access the live app"); }) as typeof fetch);
  startPracticeMode("customer");
  const get = async (path: string) => fetcher(`https://api.test${path}`);
  const post = (path: string, body: object = {}) => fetcher(`https://api.test${path}`, { method: "POST", body: JSON.stringify(body) });
  const routeId = ((await (await get("/v1/taxipress/config")).json()) as { routes: Array<{ id: string }> }).routes[0]!.id;
  const taxi = ((await (await get(`/v1/taxipress/routes/${routeId}/queue`)).json()) as { line: Array<{ id: string }> }).line[0]!;
  const { booking } = (await (await post("/v1/taxipress/bookings", { queueId: taxi.id, seats: 2, payment: "app" })).json()) as { booking: { id: string; receiptRef: string | null } };
  assert.equal(booking.receiptRef, null, "no receipt before boarding");
  const now = Date.now();
  t.mock.method(Date, "now", () => now + 45_000);
  const boarded = ((await (await get(`/v1/taxipress/bookings/${booking.id}`)).json()) as { booking: { receiptRef: string } }).booking;
  assert.match(boarded.receiptRef, /^practice-tps-/);
  const verified = await get(`/v1/public/receipts/${encodeURIComponent(boarded.receiptRef)}`);
  assert.equal(verified.status, 200);
  const receipt = (await verified.json()) as { valid: boolean; amountUgx: number; demo: boolean; lines: Array<{ label: string; value: string }> };
  assert.deepEqual([receipt.valid, receipt.amountUgx, receipt.demo], [true, 16_000, true]);
  assert.ok(receipt.lines.some((l) => l.label === "Trip" && l.value.includes("→")));
  assert.equal((await get("/v1/public/receipts/practice-tps-nosuchbooking")).status, 404);
  t.mock.restoreAll();

  const second = ((await (await post("/v1/taxipress/bookings", { queueId: taxi.id, seats: 1, payment: "app" })).json()) as { booking: { id: string } }).booking;
  assert.equal((await get(`/v1/public/receipts/practice-tps-${second.id}`)).status, 404, "still waiting: no receipt");
  assert.equal((await post(`/v1/taxipress/bookings/${second.id}/cancel`)).status, 200);
  t.mock.method(Date, "now", () => now + 60_000);
  assert.equal((await get(`/v1/public/receipts/practice-tps-${second.id}`)).status, 404, "cancelled: no receipt");
  t.mock.restoreAll();
});

test("practice: guest checkout places an order, tracks it by code, and obeys the Practice switch", async () => {
  installStorage();
  const { rememberModuleAvailability } = await import("@peebee/shared");
  const fetcher = createPracticeFetch("customer", (async () => { throw new Error("Must not reach the live API"); }) as typeof fetch);
  startPracticeMode("customer");
  const stores = await (await fetcher("https://api.test/v1/marketplace/stores")).json() as { stores: { id: string }[] };
  const products = await (await fetcher(`https://api.test/v1/marketplace/stores/${stores.stores[0]!.id}/products`)).json() as { products: { id: string }[] };
  const body = { productId: products.products[0]!.id, quantity: 2, name: "Amina", phone: "0700000000", address: "Entebbe Road", lat: 0.05, lng: 32.46, createAccount: false };
  const placed = await fetcher("https://api.test/v1/guest/checkout", { method: "POST", body: JSON.stringify(body) });
  assert.equal(placed.status, 201);
  const { trackingCode } = await placed.json() as { trackingCode: string };
  const tracked = await (await fetcher(`https://api.test/v1/guest/track/${trackingCode}`)).json() as { status: string; item: string };
  assert.equal(tracked.status, "received");
  assert.ok(tracked.item);
  assert.equal((await fetcher("https://api.test/v1/guest/track/NOPE")).status, 404);

  rememberModuleAvailability({ "buy.guest": { live: true, practice: false } });
  assert.equal(((await (await fetcher("https://api.test/v1/guest/config")).json()) as { enabled: boolean }).enabled, false);
  assert.equal((await fetcher("https://api.test/v1/guest/checkout", { method: "POST", body: JSON.stringify(body) })).status, 403);
  rememberModuleAvailability({});
  assert.equal(((await (await fetcher("https://api.test/v1/guest/config")).json()) as { enabled: boolean }).enabled, true);
});

test("sandbox and practice are two switches over the same demo data: sandbox has no practice bar, practice does", async () => {
  installStorage();
  const win = (globalThis as unknown as { window: { localStorage: Storage; location: { origin: string; reload: () => void } } }).window;
  let reloads = 0;
  win.location.reload = () => { reloads++; };
  const realCalls: string[] = [];
  let platformEnvironment: "live" | "sandbox" = "live";
  const real = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input), "https://customer.test").pathname;
    realCalls.push(path);
    if (path === "/v1/settings") return new Response(JSON.stringify({ settings: { platformEnvironment } }), { headers: { "Content-Type": "application/json" } });
    if (path === "/v1/taxipress/config") return new Response(JSON.stringify({ real: true, path, luggageEnabled: false, languages: [{ code: "rw", name: "Kinyarwanda" }] }), { headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ real: true, path }), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const fetcher = createPracticeFetch("customer", real);
  const get = async (path: string) => (await fetcher(`https://customer.test${path}`)).json() as Promise<any>;
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  // Live and not practising: everything is the real server's.
  assert.equal((await get("/v1/taxipress/config")).real, true);
  assert.deepEqual([isSandboxDemo(), isPracticeMode()], [false, false]);

  // Staff put the platform in sandbox. The app learns it from the settings it fetches anyway and reloads once.
  platformEnvironment = "sandbox";
  await get("/v1/settings"); await flush();
  assert.deepEqual([isSandboxDemo(), isPracticeMode(), reloads], [true, false, 1], "sandbox, not practice, and the screen reloaded once");
  await get("/v1/settings"); await flush();
  assert.equal(reloads, 1, "no reload loop");

  // Now the app works on the practice data (Entebbe Taxipress, the shops...) with no one having switched practice on.
  realCalls.length = 0;
  const config = await get("/v1/taxipress/config");
  assert.equal(config.enabled, true);
  assert.equal(config.routes[0].fromName, "Entebbe Stage");
  assert.equal(config.luggageEnabled, false, "what staff switch off in admin is off in the demo too");
  assert.deepEqual(config.languages, [{ code: "rw", name: "Kinyarwanda" }], "and so are the languages they chose");
  assert.equal((await get("/v1/wallet")).balance, 2_000_000, "the practice wallet is there");
  assert.ok((await get("/v1/marketplace/stores?lat=0.0612&lng=32.4637")).stores.some((s: { id: string }) => s.id.startsWith("pe_")), "the Entebbe shops");
  // The only thing read from the server is the options staff control for Taxipress (luggage, languages, cash and limits).
  assert.deepEqual(realCalls, ["/v1/taxipress/config"], "nothing else touched the server");
  assert.equal(isPracticeMode(), false, "this is sandbox, so no practice bar: the bar follows isPracticeMode only");

  // Signing in, the settings and the practice status stay real, so a developer still uses their own account.
  const post = (path: string) => fetcher(`https://customer.test${path}`, { method: "POST", body: "{}" });
  assert.equal(((await (await post("/v1/auth/login")).json()) as { real: boolean }).real, true);
  assert.equal(((await (await post("/v1/auth/logout")).json()) as { real: boolean }).real, true, "logging out is real in sandbox");
  assert.equal((await get("/v1/auth/me")).real, true);
  assert.equal((await get("/v1/practice/customer/status")).real, true);
  assert.equal((await get("/v1/settings")).settings.platformEnvironment, "sandbox");

  // A person switching practice on for themselves is a separate thing: it adds the bar (isPracticeMode) and uses the same data.
  startPracticeMode("customer");
  assert.deepEqual([isPracticeMode(), isSandboxDemo()], [true, true]);
  assert.equal((await get("/v1/taxipress/config")).enabled, true);
  assert.equal(((await (await post("/v1/auth/logout")).json()) as { ok: boolean }).ok, true, "practice keeps its own stubbed logout");

  // Staff take the platform back to live: everything is real again, and practice (the person's own choice) still works.
  platformEnvironment = "live";
  await get("/v1/settings"); await flush();
  assert.deepEqual([isSandboxDemo(), reloads], [false, 2]);
  assert.equal((await get("/v1/taxipress/config")).enabled, true, "still practising: their own switch");
  win.localStorage.removeItem("peebee_practice_mode");
  assert.equal((await get("/v1/taxipress/config")).real, true, "no sandbox, no practice: the server");
});


test("leaving practice drops the saved session instead of restoring it over the next login", () => {
  installStorage();
  const win = (globalThis as unknown as { window: { localStorage: Storage } }).window;
  startPracticeMode("customer");
  win.localStorage.setItem("peebee_customer_token", "demo-token");
  win.localStorage.setItem("peebee_practice_server", JSON.stringify({ role: "customer", backup: { peebee_customer_token: "old-live-token" } }));
  const backup = discardPracticeSession();
  assert.equal(backup?.peebee_customer_token, "old-live-token");
  assert.equal(isPracticeMode(), false);
  assert.equal(isServerPractice(), false);
  assert.equal(win.localStorage.getItem("peebee_practice_server"), null);
  assert.equal(win.localStorage.getItem("peebee_customer_token"), "demo-token", "the token in use is left for logout to revoke");
});

test("Taxipress demo books the way the app does: who travels and what they bring, not a seat count", async (t) => {
  installStorage();
  const fetcher = createPracticeFetch("customer", (async () => { throw new Error("Must not access live Taxipress"); }) as typeof fetch);
  startPracticeMode("customer");
  const get = async (path: string) => (await fetcher(`https://api.test${path}`)).json() as Promise<any>;
  const post = (path: string, body: object = {}) => fetcher(`https://api.test${path}`, { method: "POST", body: JSON.stringify(body) });
  const config = await get("/v1/taxipress/config");
  const route = config.routes.find((r: { toName: string }) => r.toName === "Ntinda Stage");
  const line = await get(`/v1/taxipress/routes/${route.id}/queue`);

  const one = await post("/v1/taxipress/bookings", { queueId: line.line[0].id, adults: 1, children: 0, luggage: { fragile: 1 }, assistance: "none", language: "lg", payment: "cash" });
  assert.equal(one.status, 201, "one adult is never refused as too many seats");
  const { booking } = (await one.json()) as { booking: any };
  assert.equal(booking.seats, 1);
  assert.equal(booking.amount, route.farePerSeat + 7_000, "the fare plus the fragile bag");
  assert.equal(booking.details.language, "lg");
  assert.deepEqual(booking.details.luggage, { fragile: 1 });

  const crowd = await post("/v1/taxipress/bookings", { queueId: line.line[1].id, adults: 5, children: 0 });
  assert.equal(crowd.status, 400, "five adults are over the limit");
  assert.match(((await crowd.json()) as { message: string }).message, /up to 4 seats/);

  const family = await post("/v1/taxipress/bookings", { queueId: line.line[1].id, adults: 2, children: 3, payment: "cash" });
  assert.equal(family.status, 201);
  const fam = ((await family.json()) as { booking: any }).booking;
  assert.equal(fam.seats, 3, "two children ride on laps, the third needs a seat");
  assert.equal(fam.amount, route.farePerSeat * 3);
  t.mock.restoreAll();
});
