import { db } from "../db/client.js";
import { actAs, where, type Scenario } from "./demo-customers.js";

/** Buy and Deliver scenarios: a marketplace basket, a long parcel by matatu relay, a nearby parcel, and a pharmacy prescription. */
type Call = Awaited<ReturnType<typeof actAs>>;
const idOf = (body: Record<string, any>) => String(body.order?.id ?? body.orderId ?? body.id ?? (Array.isArray(body.orders) ? body.orders[0]?.id : "") ?? "");

async function place(call: Call, name: string, path: string, body: unknown): Promise<string | null> {
  const res = await call("POST", path, body);
  if (res.status >= 300) {
    console.error(`Practice demo ${name} refused:`, res.status, JSON.stringify(res.body).slice(0, 220));
    return null;
  }
  return idOf(res.body) || "ok";
}

export const marketplaceBasket: Scenario = async (c, call) => {
  const products = await db.execute("SELECT p.id, p.store_id, p.title, p.price, p.image_url FROM store_products p JOIN stores s ON s.id = p.store_id WHERE s.merchant_id LIKE 'prac\\_%' ESCAPE '\\' AND s.pro_tier IN ('pro_store','pro_live') AND s.category IN ('groceries','stores') AND s.sub_category IS NOT 'pharmacy' ORDER BY RANDOM() LIMIT 2");
  if (!products.rows.length) return null;
  return place(call, "marketplace basket", "/marketplace/checkout", { items: products.rows.map((p) => ({ productId: String(p.id), storeId: String(p.store_id), title: String(p.title), price: Number(p.price), quantity: 1 })), paymentMethod: "wallet", ...where(c) });
};

/** Entebbe to Kampala is far enough that the platform offers the matatu relay. */
export const relayParcel: Scenario = async (c, call) => {
  const listed = await call("POST", "/lists", { title: "Parcel to Kampala", items: [{ name: "Documents envelope", quantity: 1 }] });
  return place(call, "relay parcel", "/orders", {
    listId: listed.body.listId, type: "parcel", pickupArea: "Entebbe Town", pickupAddress: "Entebbe Central Market", pickupLat: 0.0612, pickupLng: 32.4637,
    destinationArea: "Garden City", destinationAddress: "Yusuf Lule Road, Kampala", destinationLat: 0.3209, destinationLng: 32.5917, deliveryMode: "relay", relayLastMile: "door",
  });
};

export const nearbyParcel: Scenario = async (c, call) => {
  const listed = await call("POST", "/lists", { title: "Parcel to a friend", items: [{ name: "Gift box", quantity: 1 }] });
  return place(call, "parcel", "/orders", { listId: listed.body.listId, type: "parcel", pickupArea: "Entebbe Town", pickupAddress: "Botanical Gardens", pickupLat: 0.0629, pickupLng: 32.4691, ...where(c) });
};

/** A shared product link bought without an account. The practice token on the request keeps it in the practice world. */
export const guestOrder: Scenario = async (c, call) => {
  const products = await db.execute("SELECT p.id FROM store_products p JOIN stores s ON s.id = p.store_id WHERE s.merchant_id LIKE 'prac\\_%' ESCAPE '\\' AND s.pro_tier IN ('pro_store','pro_live') AND s.category IN ('groceries','stores') AND p.price >= 10000 ORDER BY RANDOM() LIMIT 1");
  const id = String(products.rows[0]?.id ?? "");
  if (!id) return null;
  return place(call, "guest checkout", "/guest/checkout", { productId: id, quantity: 1, name: "Guest Visitor", phone: "0700000777", address: c.areaAddress, lat: c.lat, lng: c.lng, createAccount: false });
};

export const BUY_SCENARIOS: ReadonlyArray<readonly [string, Scenario]> = [["marketplace", marketplaceBasket], ["relay", relayParcel], ["parcel", nearbyParcel], ["guest", guestOrder]];
