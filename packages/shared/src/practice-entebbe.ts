/**
 * Practice mode's world, centred on Entebbe where Peebee launches: shops, malls, pharmacies, food places and
 * riders around the town, plus a few Kampala shops so a delivery can run the long way (relay). Everything is
 * fictional and browser-local; nothing here is a real business or contacts anyone.
 */
import {
  DEMO_MARKETPLACE_PRODUCTS, DEMO_MARKETPLACE_SPOTLIGHT, DEMO_MARKETPLACE_STORES,
  type DemoProduct, type DemoSpotlightItem, type DemoStore,
} from "./demo-marketplace.js";
import { DEMO_FOOD_RESTAURANTS } from "./demo-food.js";
import type { Restaurant } from "./domain.js";
import { DEFAULT_PRODUCT_VARIATIONS, deriveProductOptions } from "./product-variations.js";

const svg = (width: number, height: number, bg: string, emoji: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${width} ${height}'><rect width='100%' height='100%' fill='${bg}'/><text x='50%' y='54%' font-size='${Math.round(Math.min(width, height) * 0.5)}' text-anchor='middle' dominant-baseline='middle'>${emoji}</text></svg>`)}`;
const tile = (bg: string, emoji: string) => svg(400, 400, bg, emoji);
const banner = (bg: string, emoji: string) => svg(1200, 400, bg, emoji);

/** The centre of Entebbe town. Practice starts here. */
export const PRACTICE_ENTEBBE = { lat: 0.0612, lng: 32.4637 };

type StoreInput = {
  id: string; name: string; slug: string; category: DemoStore["category"]; sub: string; description: string; announcement?: string;
  phone: string; address: string; lat: number; lng: number; bg: string; emoji: string; min?: number; open?: boolean; live?: boolean;
  pharmacy?: { licence: string; pharmacist: string };
};
const store = (s: StoreInput): DemoStore => ({
  id: s.id, name: s.name, slug: s.slug, category: s.category, sub_category: s.sub, description: s.description, announcement: s.announcement,
  logo_url: tile(s.bg, s.emoji), banner_url: banner(s.bg, s.emoji), phone: s.phone, whatsapp_number: s.phone, address: s.address, lat: s.lat, lng: s.lng,
  is_open: s.open === false ? 0 : 1, delivery_enabled: 1, pickup_enabled: 1, min_order_amount: s.min ?? 5_000, pro_tier: s.live ? "pro_live" : "free",
  is_live: s.live ? 1 : 0, live_channel_title: s.live ? `${s.name}: fresh stock just in` : null, live_stream_url: s.live ? "/demo-video/market.mp4" : null,
  live_stream_poster_url: s.live ? "/demo-video/market.jpg" : null, live_viewer_count: s.live ? 64 : 0, status: "active",
  ...(s.pharmacy ? { nda_license_number: s.pharmacy.licence, supervising_pharmacist: s.pharmacy.pharmacist, is_nda_verified: true } : {}),
});

/** [title, UGX price, category, emoji, background] */
type Item = [string, number, string, string, string];
const products = (storeId: string, prefix: string, items: Item[], extra: Partial<DemoProduct> = {}): DemoProduct[] =>
  items.map(([title, price, category, emoji, bg], i) => ({
    id: `${prefix}_${i + 1}`, store_id: storeId, title, slug: `${prefix}-${i + 1}`, description: `${title}. Practice item from an Entebbe shop.`, price,
    compare_at_price: null, inventory_quantity: 40, category_name: category, image_url: tile(bg, emoji), has_variants: 0, variants: [], ...extra,
  }));

export const PRACTICE_ENTEBBE_STORES: DemoStore[] = [
  store({ id: "pe_lakeside_mart", name: "Lakeside Fresh Mart", slug: "lakeside-fresh-mart", category: "groceries", sub: "supermarket", description: "Entebbe's neighbourhood supermarket: fresh produce, dairy, pantry staples and household basics.", announcement: "Free delivery inside Entebbe on orders over UGX 40,000.", phone: "+256 700 310 001", address: "Victoria Mall, Entebbe Road", lat: 0.0489, lng: 32.4803, bg: "#E8F5E9", emoji: "🛒", live: true }),
  store({ id: "pe_central_market", name: "Entebbe Central Market Greens", slug: "entebbe-central-market-greens", category: "groceries", sub: "greengrocer", description: "Matooke, tomatoes, onions, fruit and greens, picked at the market this morning.", phone: "+256 700 310 002", address: "Entebbe Central Market, Kitoro Road", lat: 0.0576, lng: 32.4604, bg: "#F1F8E9", emoji: "🥬", min: 3_000 }),
  store({ id: "pe_lake_fish", name: "Lake Victoria Fish & Butchery", slug: "lake-victoria-fish-butchery", category: "groceries", sub: "butchery", description: "Fresh tilapia and Nile perch from the landing site, plus beef, goat and chicken cut to order.", phone: "+256 700 310 003", address: "Nakiwogo Road, near the landing site", lat: 0.0468, lng: 32.4522, bg: "#E3F2FD", emoji: "🐟" }),
  store({ id: "pe_sunrise_bakers", name: "Sunrise Bakers Entebbe", slug: "sunrise-bakers-entebbe", category: "groceries", sub: "bakery", description: "Bread, buns, cakes and mandazi baked fresh from 6 a.m.", announcement: "Warm bread out of the oven every morning at 7.", phone: "+256 700 310 004", address: "Airport Road, Bugonga", lat: 0.0503, lng: 32.4437, bg: "#FFF3E0", emoji: "🍞" }),
  store({ id: "pe_phones_hub", name: "Entebbe Phones & Electronics", slug: "entebbe-phones-electronics", category: "stores", sub: "electronics", description: "Phones, chargers, earphones, power banks and small appliances with a one-month warranty.", phone: "+256 700 310 005", address: "Kampala Road, Entebbe Town", lat: 0.0619, lng: 32.4611, bg: "#E8EAF6", emoji: "📱" }),
  store({ id: "pe_shoreline_fashion", name: "Shoreline Fashion & Fabrics", slug: "shoreline-fashion-fabrics", category: "stores", sub: "fashion", description: "Ready-made clothes, kitenge fabric and shoes for the whole family.", phone: "+256 700 310 006", address: "Victoria Mall, Level 1", lat: 0.0491, lng: 32.4806, bg: "#FCE4EC", emoji: "👗", min: 10_000 }),
  store({ id: "pe_hardware", name: "Bugonga Hardware & Paints", slug: "bugonga-hardware-paints", category: "stores", sub: "hardware", description: "Cement, paint, plumbing and electrical fittings, tools and padlocks.", phone: "+256 700 310 007", address: "Bugonga Road, Entebbe", lat: 0.0526, lng: 32.4469, bg: "#FFF8E1", emoji: "🔧", min: 10_000 }),
  store({ id: "pe_botanical_gifts", name: "Botanical Books & Gifts", slug: "botanical-books-gifts", category: "stores", sub: "gifts", description: "Notebooks, school supplies, souvenirs and gift baskets near the Botanical Gardens.", phone: "+256 700 310 008", address: "Botanical Gardens Road, Entebbe", lat: 0.0643, lng: 32.4687, bg: "#F3E5F5", emoji: "🎁" }),
  store({ id: "pe_lakeview_pharmacy", name: "Lakeview Pharmacy Entebbe", slug: "lakeview-pharmacy-entebbe", category: "pharmacy", sub: "pharmacy", description: "Licensed pharmacy in Entebbe town: everyday medicines, first aid, vitamins and baby care.", phone: "+256 700 310 009", address: "Kampala Road, Entebbe Town", lat: 0.0608, lng: 32.4629, bg: "#E0F7FA", emoji: "💊", pharmacy: { licence: "NDA/PH/ENT/0412", pharmacist: "Dr. Grace Nakitto" } }),
  store({ id: "pe_victoria_pharmacy", name: "Victoria Mall Pharmacy", slug: "victoria-mall-pharmacy", category: "pharmacy", sub: "pharmacy", description: "Open late at Victoria Mall: pain relief, cold and flu, digestion and wellness.", phone: "+256 700 310 010", address: "Victoria Mall, Entebbe Road", lat: 0.0487, lng: 32.4801, bg: "#E0F2F1", emoji: "🩺", pharmacy: { licence: "NDA/PH/ENT/0518", pharmacist: "Dr. Samuel Kigozi" } }),
];

const MEDS = (storeId: string, prefix: string, items: Array<[string, number, string, string, string, string]>) =>
  items.map(([title, price, category, form, strength, pack], i): DemoProduct => ({
    id: `${prefix}_${i + 1}`, store_id: storeId, title, slug: `${prefix}-${i + 1}`, description: `${title}. Over-the-counter, practice item.`, price,
    compare_at_price: null, inventory_quantity: 60, category_name: category, image_url: tile("#E0F7FA", "💊"), has_variants: 0, variants: [],
    rx_required: false, dosage_form: form, strength, pack_size: pack, active_ingredient: title.split(" ")[0],
  }));

type OptionSpec = { name: string; values: Array<{ value: string; delta?: number }> };

/** Gives a practice product real options (Colour, Size, ...) so the Buy card, product page and cart pickers have something to show. */
function withOptions(product: DemoProduct, specs: OptionSpec[], soldOut: string[] = []): DemoProduct {
  let combos: Array<Array<{ name: string; value: string; delta: number }>> = [[]];
  for (const spec of specs) combos = combos.flatMap((c) => spec.values.map((v) => [...c, { name: spec.name, value: v.value, delta: v.delta ?? 0 }]));
  const variants = combos.map((c, i) => {
    const title = c.map((x) => x.value).join(" / ");
    const row: Record<string, unknown> = {
      id: `${product.id}_v${i + 1}`, title, price: product.price + c.reduce((n, x) => n + x.delta, 0), compare_at_price: null,
      inventory_quantity: soldOut.includes(title) ? 0 : 12,
    };
    c.forEach((x, n) => { row[`option${n + 1}_name`] = x.name; row[`option${n + 1}_value`] = x.value; });
    return row;
  });
  return Object.assign(product, { has_variants: 1, variants, options: deriveProductOptions(variants as never[], DEFAULT_PRODUCT_VARIATIONS) });
}

export const PRACTICE_ENTEBBE_PRODUCTS: Record<string, DemoProduct[]> = {
  pe_lakeside_mart: products("pe_lakeside_mart", "pe_lm", [
    ["Fresh whole milk, 1 litre", 3_500, "Dairy & Eggs", "🥛", "#E3F2FD"], ["Eggs, tray of 30", 13_500, "Dairy & Eggs", "🥚", "#FFF8E1"],
    ["Rice, 2 kg", 9_000, "Pantry Staples", "🍚", "#FAFAFA"], ["Cooking oil, 1 litre", 9_500, "Pantry Staples", "🫒", "#F9FBE7"],
    ["Sugar, 1 kg", 5_000, "Pantry Staples", "🧂", "#FAFAFA"], ["Bottled water, 12 pack", 14_000, "Drinks", "💧", "#E1F5FE"],
  ]),
  pe_central_market: products("pe_central_market", "pe_cm", [
    ["Matooke bunch", 18_000, "Fresh Produce", "🍌", "#FFFDE7"], ["Tomatoes, 1 kg", 4_000, "Fresh Produce", "🍅", "#FFEBEE"],
    ["Onions, 1 kg", 3_500, "Fresh Produce", "🧅", "#FFF3E0"], ["Pineapple", 4_500, "Fruit", "🍍", "#FFFDE7"],
    ["Avocados, 4", 5_000, "Fruit", "🥑", "#F1F8E9"], ["Sukuma wiki bundle", 1_500, "Greens", "🥬", "#E8F5E9"],
  ]),
  pe_lake_fish: products("pe_lake_fish", "pe_lf", [
    ["Whole tilapia, about 1 kg", 20_000, "Fresh Fish", "🐟", "#E3F2FD"], ["Nile perch fillet, 1 kg", 28_000, "Fresh Fish", "🐠", "#E1F5FE"],
    ["Beef, 1 kg", 18_000, "Meat", "🥩", "#FFEBEE"], ["Whole chicken", 24_000, "Meat", "🍗", "#FFF3E0"], ["Goat meat, 1 kg", 22_000, "Meat", "🍖", "#FBE9E7"],
  ]),
  pe_sunrise_bakers: products("pe_sunrise_bakers", "pe_sb", [
    ["Sliced loaf", 5_500, "Bread", "🍞", "#FFF3E0"], ["Mandazi, 10", 5_000, "Pastries", "🍩", "#FFF8E1"], ["Cinnamon rolls, 4", 12_000, "Pastries", "🥐", "#FFE0B2"],
    ["Birthday cake, 1 kg", 55_000, "Cakes", "🎂", "#FCE4EC"], ["Meat pies, 4", 14_000, "Savoury", "🥧", "#FFECB3"],
  ]),
  pe_phones_hub: products("pe_phones_hub", "pe_ph", [
    ["Fast phone charger", 25_000, "Accessories", "🔌", "#E8EAF6"], ["Wired earphones", 15_000, "Accessories", "🎧", "#EDE7F6"],
    ["Power bank, 10,000 mAh", 65_000, "Accessories", "🔋", "#E8F5E9"], ["Smartphone, 64 GB", 420_000, "Phones", "📱", "#E3F2FD"],
    ["Bluetooth speaker", 90_000, "Audio", "🔊", "#F3E5F5"],
  ]),
  pe_shoreline_fashion: products("pe_shoreline_fashion", "pe_sf", [
    ["Kitenge dress", 75_000, "Women", "👗", "#FCE4EC"], ["Men's shirt", 45_000, "Men", "👔", "#E3F2FD"], ["School shoes", 55_000, "Shoes", "👞", "#EFEBE9"],
    ["Kitenge fabric, 6 yards", 60_000, "Fabric", "🧵", "#FFF3E0"], ["Sandals", 30_000, "Shoes", "🩴", "#FFF8E1"],
  ]),
  pe_hardware: products("pe_hardware", "pe_hw", [
    ["Cement, 50 kg bag", 36_000, "Building", "🧱", "#ECEFF1"], ["Wall paint, 4 litres", 85_000, "Paint", "🎨", "#FFF3E0"],
    ["Claw hammer", 22_000, "Tools", "🔨", "#EFEBE9"], ["Padlock", 15_000, "Security", "🔒", "#E8EAF6"], ["Extension socket, 4-way", 28_000, "Electrical", "🔌", "#FFFDE7"],
  ]),
  pe_botanical_gifts: products("pe_botanical_gifts", "pe_bg", [
    ["Exercise books, 12", 18_000, "Stationery", "📒", "#F3E5F5"], ["Gift basket", 70_000, "Gifts", "🧺", "#FCE4EC"],
    ["Wooden carving, small", 25_000, "Souvenirs", "🪵", "#EFEBE9"], ["Greeting card", 5_000, "Gifts", "💌", "#FFEBEE"], ["Scented candle", 20_000, "Gifts", "🕯️", "#FFF8E1"],
  ]),
  pe_lakeview_pharmacy: MEDS("pe_lakeview_pharmacy", "pe_lp", [
    ["Paracetamol 500 mg tablets", 3_000, "Pain & Fever", "Tablet", "500 mg", "Strip of 10"], ["Oral rehydration salts", 2_000, "Digestion & Stomach", "Powder", "20.5 g", "Sachet"],
    ["Vitamin C 1000 mg", 12_000, "Vitamins & Wellness", "Tablet", "1000 mg", "Tube of 20"], ["Antiseptic wipes", 6_000, "First Aid", "Wipes", "", "Pack of 20"],
    ["Cetirizine 10 mg", 5_000, "Cold & Allergy", "Tablet", "10 mg", "Strip of 10"],
  ]),
  pe_victoria_pharmacy: MEDS("pe_victoria_pharmacy", "pe_vp", [
    ["Ibuprofen 400 mg tablets", 5_000, "Pain & Fever", "Tablet", "400 mg", "Strip of 10"], ["Cough syrup", 11_000, "Cold & Allergy", "Syrup", "100 ml", "Bottle"],
    ["Antacid chewable tablets", 4_000, "Digestion & Stomach", "Tablet", "", "Strip of 12"], ["Baby diaper rash cream", 14_000, "Mother & Baby", "Cream", "", "Tube 50 g"],
    ["Plasters, assorted", 3_500, "First Aid", "Plaster", "", "Box of 20"],
  ]),
};

/** The few Kampala shops kept so a delivery can run the long way (relay). Everything else is in Entebbe. */
const KAMPALA_KEPT = ["store_demo_fresh_mart", "store_demo_tech_pulse", "store_demo_vine_pharmacy"];

export const PRACTICE_STORES: DemoStore[] = [
  ...PRACTICE_ENTEBBE_STORES,
  ...DEMO_MARKETPLACE_STORES.filter((s) => KAMPALA_KEPT.includes(s.id)),
];
const byId = (store: string, id: string) => PRACTICE_ENTEBBE_PRODUCTS[store]!.find((p) => p.id === id)!;
const COLOURS = (list: string[]): OptionSpec => ({ name: "Colour", values: list.map((value) => ({ value })) });
const SIZES = (list: string[]): OptionSpec => ({ name: "Size", values: list.map((value) => ({ value })) });
withOptions(byId("pe_shoreline_fashion", "pe_sf_1"), [COLOURS(["Pink", "Blue", "Green"]), SIZES(["S", "M", "L"])], ["Green / L"]);
withOptions(byId("pe_shoreline_fashion", "pe_sf_2"), [COLOURS(["White", "Blue", "Black"]), SIZES(["M", "L", "XL"])]);
withOptions(byId("pe_shoreline_fashion", "pe_sf_5"), [SIZES(["38", "40", "42"])]);
withOptions(byId("pe_phones_hub", "pe_ph_2"), [COLOURS(["Black", "White"])]);
withOptions(byId("pe_phones_hub", "pe_ph_4"), [{ name: "Storage", values: [{ value: "64 GB" }, { value: "128 GB", delta: 60_000 }] }]);
withOptions(byId("pe_lakeside_mart", "pe_lm_1"), [{ name: "Size", values: [{ value: "500 ml", delta: -1_500 }, { value: "1 litre" }, { value: "2 litres", delta: 3_000 }] }]);

export const PRACTICE_PRODUCTS: Record<string, DemoProduct[]> = {
  ...PRACTICE_ENTEBBE_PRODUCTS,
  ...Object.fromEntries(Object.entries(DEMO_MARKETPLACE_PRODUCTS).filter(([id]) => KAMPALA_KEPT.includes(id))),
};

/** Spotlight: one post per Entebbe shop (its first product), then the kept Kampala shops' own. */
export const PRACTICE_SPOTLIGHT: DemoSpotlightItem[] = [
  ...PRACTICE_ENTEBBE_STORES.map((s, i): DemoSpotlightItem => {
    const product = PRACTICE_ENTEBBE_PRODUCTS[s.id]![0]!;
    return {
      id: `pe_spot_${i + 1}`, store_id: s.id, store_name: s.name, store_slug: s.slug, store_logo: s.logo_url, store_category: s.category,
      type: s.is_live ? "live" : "image", media_url: s.is_live ? (s.live_stream_url ?? product.image_url) : product.image_url,
      ...(s.is_live ? { poster_url: s.live_stream_poster_url ?? undefined } : {}),
      title: `${product.title}: available now in ${s.address.split(",")[0]}`, description: `${s.name}, ${s.address}. Delivered around Entebbe.`,
      product: { id: product.id, title: product.title, price: product.price, image_url: product.image_url },
      ...(s.is_live ? { viewer_count: s.live_viewer_count } : {}), likes_count: 120 + i * 37, comments_count: 8 + i * 3,
    };
  }),
  ...DEMO_MARKETPLACE_SPOTLIGHT.filter((item) => KAMPALA_KEPT.includes(item.store_id)),
];

// ---------------------------------------------------------------------------
// Food: the same restaurants, kitchens, street food, bakeries and juice bars, all around Entebbe
// ---------------------------------------------------------------------------

const FOOD_PLACES: Record<string, { name?: string; address: string; dLat: number; dLng: number }> = {
  lakeview: { address: "Lakeside Road, Kitoro, Entebbe", dLat: -0.004, dLng: 0.003 },
  "brick-oven": { address: "Victoria Mall, Entebbe Road", dLat: -0.012, dLng: 0.016 },
  "bun-yard": { address: "Kampala Road, Entebbe Town", dLat: 0.0, dLng: -0.002 },
  "green-table": { address: "Botanical Gardens Road, Entebbe", dLat: 0.003, dLng: 0.005 },
  "sharon-cooks": { address: "Katabi, Entebbe", dLat: 0.018, dLng: -0.01 },
  "hearth-and-home": { address: "Abaita Ababiri, Entebbe", dLat: -0.02, dLng: 0.02 },
  "kampala-rolex-stop": { name: "Entebbe Rolex Stop", address: "Entebbe Central Market", dLat: -0.004, dLng: -0.003 },
  "chapati-corner": { address: "Nakiwogo Road, Entebbe", dLat: -0.014, dLng: -0.011 },
  "golden-crumb": { address: "Airport Road, Bugonga, Entebbe", dLat: -0.011, dLng: -0.02 },
  "sweet-oven": { address: "Lugard Avenue, Entebbe", dLat: 0.002, dLng: 0.001 },
  "sunburst-juice": { address: "Kitoro Road, Entebbe", dLat: -0.003, dLng: 0.002 },
  "pure-press": { address: "Lunyo, Entebbe", dLat: -0.025, dLng: 0.012 },
};

export const PRACTICE_FOOD_RESTAURANTS: Restaurant[] = DEMO_FOOD_RESTAURANTS.map((r) => {
  const place = FOOD_PLACES[r.id.replace("demo-food-", "")];
  if (!place) return r;
  return { ...r, ...(place.name ? { name: place.name } : {}), address: place.address, lat: PRACTICE_ENTEBBE.lat + place.dLat, lng: PRACTICE_ENTEBBE.lng + place.dLng };
});

export function practiceFoodRestaurant(id: string): Restaurant | undefined {
  return PRACTICE_FOOD_RESTAURANTS.find((r) => r.id === id);
}

// ---------------------------------------------------------------------------
// Riders: Entebbe boda riders who take the order, shop or collect it, deliver it and call on arrival
// ---------------------------------------------------------------------------

export type PracticeRider = { name: string; plate: string; phone: string; stage: string };
export const PRACTICE_RIDERS: PracticeRider[] = [
  { name: "Daniel Kato", plate: "UFP 246P", phone: "0700 410 001", stage: "Kitoro Stage" },
  { name: "Brian Ssemakula", plate: "UEX 318K", phone: "0700 410 002", stage: "Entebbe Town Stage" },
  { name: "Isaac Wasswa", plate: "UFA 905M", phone: "0700 410 003", stage: "Bugonga Stage" },
  { name: "Joel Mukasa", plate: "UFK 127T", phone: "0700 410 004", stage: "Katabi Stage" },
  { name: "Henry Ouma", plate: "UEZ 662D", phone: "0700 410 005", stage: "Kitoro Stage" },
  { name: "Ronald Byaruhanga", plate: "UFC 480H", phone: "0700 410 006", stage: "Lunyo Stage" },
];
export const practiceRider = (index: number | null | undefined): PracticeRider => PRACTICE_RIDERS[Math.abs(index ?? 0) % PRACTICE_RIDERS.length]!;
