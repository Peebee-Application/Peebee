import type { MenuItem, Restaurant, RestaurantMenu } from "./domain.js";

// Shared fictional catalogue for sandbox testing; entries stay hidden in live mode.
const CREATED = "2026-01-01T00:00:00.000Z";
type Dish = { name: string; description: string; price: number; art: "rice" | "grill" | "pizza" | "burger" | "salad" | "drink"; badge?: MenuItem["badge"]; options?: boolean };
const seeds = [
  { slug: "lakeview", name: "Lakeview Kitchen", cuisine: "Ugandan · Grills", address: "Demo location · Entebbe", open: true, dishes: [
    { name: "Chicken pilau", description: "Spiced rice, grilled chicken, fresh kachumbari and a house chilli sauce.", price: 18000, art: "rice", badge: "trending", options: true },
    { name: "Beef luwombo", description: "Slow-cooked beef in groundnut sauce, served with steamed matooke.", price: 22000, art: "grill", options: true },
    { name: "Tilapia & chips", description: "Grilled lake-style tilapia with crispy chips and a lemon wedge.", price: 28000, art: "grill", badge: "new" },
    { name: "Garden salad", description: "Crunchy greens, tomato, cucumber and a fresh citrus dressing.", price: 9000, art: "salad" },
    { name: "Passion fruit juice", description: "A chilled glass of fresh passion fruit juice.", price: 5000, art: "drink" },
  ] },
  { slug: "brick-oven", name: "Brick Oven Social", cuisine: "Pizza · Italian", address: "Demo location · Kitala", open: true, dishes: [
    { name: "Margherita pizza", description: "Tomato, mozzarella and basil on a thin, wood-fired style crust.", price: 24000, art: "pizza", badge: "trending", options: true },
    { name: "BBQ chicken pizza", description: "Smoky chicken, sweet peppers, mozzarella and barbecue sauce.", price: 29000, art: "pizza", options: true },
    { name: "Roasted vegetable pizza", description: "Seasonal vegetables with a rich tomato sauce and fresh herbs.", price: 26000, art: "pizza", badge: "new", options: true },
    { name: "Garlic bread", description: "Warm bread brushed with garlic butter and parsley.", price: 8000, art: "grill", badge: "sale" },
    { name: "Lemon mint cooler", description: "Fresh lemon and mint over ice.", price: 6000, art: "drink" },
  ] },
  { slug: "bun-yard", name: "The Bun Yard", cuisine: "Burgers · Street food", address: "Demo location · Kampala", open: true, dishes: [
    { name: "Classic beef burger", description: "Grilled beef, cheddar, lettuce and tomato in a toasted bun.", price: 19000, art: "burger", badge: "trending", options: true },
    { name: "Crispy chicken burger", description: "Golden chicken, slaw and a creamy pepper sauce.", price: 20000, art: "burger", badge: "new", options: true },
    { name: "Plant-based burger", description: "A hearty bean patty with avocado, crunchy greens and tomato.", price: 18000, art: "burger", options: true },
    { name: "Loaded chips", description: "Crispy chips topped with cheese, herbs and a tangy house sauce.", price: 10000, art: "grill", badge: "sale" },
    { name: "Vanilla milkshake", description: "A creamy vanilla shake, served cold.", price: 8000, art: "drink" },
  ] },
  { slug: "green-table", name: "Green Table Café", cuisine: "Healthy · Café", address: "Demo location · Entebbe", open: false, dishes: [
    { name: "Avocado grain bowl", description: "Avocado, warm grains, roasted vegetables and a lemon dressing.", price: 16000, art: "salad", badge: "trending", options: true },
    { name: "Roasted chicken salad", description: "Chicken, leafy greens and cherry tomatoes with a yoghurt dressing.", price: 19000, art: "salad", options: true },
    { name: "Vegetable rice bowl", description: "Seasoned rice with colourful vegetables and a sesame dressing.", price: 14000, art: "rice", badge: "new" },
    { name: "Fruit bowl", description: "A fresh mix of pineapple, watermelon and seasonal fruit.", price: 9000, art: "salad" },
    { name: "Mango smoothie", description: "Mango blended with yoghurt and a little honey.", price: 7000, art: "drink" },
  ] },
] satisfies Array<{ slug: string; name: string; cuisine: string; address: string; open: boolean; dishes: Dish[] }>;

export const DEMO_FOOD_RESTAURANTS: Restaurant[] = seeds.map((seed) => ({
  id: `demo-food-${seed.slug}`, owner_id: "demo-food-owner", name: seed.name,
  description: "Fictional restaurant for sandbox testing.", cuisine: seed.cuisine,
  phone: null, address: seed.address, lat: 0.0645, lng: 32.4594,
  logo_key: null, cover_key: null, status: "active", is_open: seed.open ? 1 : 0,
  open_time: null, close_time: null, merchant_id: null, outlet_id: null,
  is_demo: true, created_at: CREATED, updated_at: CREATED,
}));

export function demoFoodRestaurant(id: string): Restaurant | undefined {
  return DEMO_FOOD_RESTAURANTS.find((restaurant) => restaurant.id === id);
}

const dishPhotos: Record<string, string[]> = {
  lakeview: ['chicken-pilau', 'beef-luwombo', 'tilapia-chips', 'garden-salad', 'passion-juice'],
  'brick-oven': ['margherita-pizza', 'bbq-pizza', 'vegetable-pizza', 'garlic-bread', 'lemon-cooler'],
  'bun-yard': ['beef-burger', 'chicken-burger', 'plant-burger', 'loaded-chips', 'vanilla-shake'],
  'green-table': ['avocado-bowl', 'chicken-salad', 'vegetable-rice', 'fruit-bowl', 'mango-smoothie'],
};

/** Generated photos shipped with the customer app, also used in Practice. */
export function demoFoodPhotoPath(itemId: string): string | undefined {
  for (const [slug, photos] of Object.entries(dishPhotos)) {
    const index = photos.findIndex((_, index) => itemId === `demo-food-${slug}-item-${index + 1}`);
    if (index >= 0) return `/demo-food/${photos[index]}.webp`;
  }
}

export function demoRestaurantPhotoPath(id: string): string | undefined {
  const slug = seeds.find(seed => id === `demo-food-${seed.slug}`)?.slug;
  return slug ? `/demo-food/${slug}-restaurant.webp` : undefined;
}

export function demoFoodMenu(id: string): RestaurantMenu | undefined {
  const seed = seeds.find((seed) => `demo-food-${seed.slug}` === id);
  if (!seed) return undefined;
  const items: MenuItem[] = seed.dishes.map((dish, index) => {
    const itemId = `${id}-item-${index + 1}`;
    const optionId = `${itemId}-size`;
    return {
      id: itemId, restaurant_id: id, category_id: `${id}-${index < 3 ? "mains" : "sides"}`,
      name: dish.name, description: dish.description, price: dish.price, photo_key: `demo-food/${dish.art}`,
      available: 1, prep_time_minutes: index < 3 ? 25 : 10, sort_order: index,
      badge: "badge" in dish ? dish.badge ?? null : null, created_at: CREATED, updated_at: CREATED,
      options: "options" in dish && dish.options ? [
        { id: optionId, menu_item_id: itemId, name: "Size", required: 1, multi_select: 0, sort_order: 0,
          choices: [{id:`${optionId}-regular`,name:"Regular",price_delta:0,sort_order:0},{id:`${optionId}-large`,name:"Large",price_delta:5000,sort_order:1}] },
        { id: `${itemId}-extras`, menu_item_id: itemId, name: "Extras", required: 0, multi_select: 1, sort_order: 1,
          choices: [{id:`${itemId}-extra-avocado`,name:"Avocado",price_delta:3000,sort_order:0},{id:`${itemId}-extra-chips`,name:"Chips",price_delta:4000,sort_order:1}] },
      ] : [],
    };
  });
  return { categories: [
    {id:`${id}-mains`,restaurant_id:id,name:"Mains",sort_order:0,created_at:CREATED,updated_at:CREATED,items:items.slice(0,3)},
    {id:`${id}-sides`,restaurant_id:id,name:"Sides & drinks",sort_order:1,created_at:CREATED,updated_at:CREATED,items:items.slice(3)},
  ], uncategorizedItems: [] };
}

/** Trusted, self-contained illustrated thumbnails; no remote image service or R2 seed needed. */
export function demoFoodImage(itemId: string): string | undefined {
  const restaurant = DEMO_FOOD_RESTAURANTS.find((r) => demoFoodMenu(r.id)?.categories.some((cat) => cat.items.some((item) => item.id === itemId)));
  if (!restaurant) return undefined;
  const item = demoFoodMenu(restaurant.id)!.categories.flatMap((cat) => cat.items).find((item) => item.id === itemId)!;
  const kind = item.photo_key!.split("/")[1];
  const art: Record<string, string> = {
    pizza: '<circle cx="320" cy="245" r="132" fill="#d69b51"/><circle cx="320" cy="245" r="117" fill="#eebd64"/><path d="M320 124v240m-105-177 210 120m-210 0 210-120" stroke="#d79a50" stroke-width="5"/><g fill="#b95039"><circle cx="277" cy="184" r="19"/><circle cx="375" cy="213" r="20"/><circle cx="287" cy="300" r="20"/><circle cx="363" cy="297" r="17"/></g><g fill="#65834c"><ellipse cx="318" cy="214" rx="10" ry="22" transform="rotate(35 318 214)"/><ellipse cx="246" cy="250" rx="10" ry="22"/><ellipse cx="352" cy="165" rx="10" ry="22"/></g>',
    burger: '<path d="M202 224c0-135 236-135 236 0z" fill="#d39a4c"/><rect x="202" y="276" width="236" height="57" rx="27" fill="#c58a43"/><rect x="195" y="251" width="250" height="35" rx="17" fill="#684131"/><path d="m195 243 32-13 27 15 36-16 38 18 35-19 37 14 43-10v20H195z" fill="#73964c"/><path d="m210 260 96 32 106-32" fill="#f1c65b"/><g fill="#f5dcad"><ellipse cx="262" cy="171" rx="7" ry="3"/><ellipse cx="323" cy="149" rx="7" ry="3"/><ellipse cx="381" cy="177" rx="7" ry="3"/></g>',
    rice: '<ellipse cx="312" cy="251" rx="115" ry="78" fill="#e5c17b"/><g fill="#f5dfaa"><ellipse cx="255" cy="239" rx="20" ry="8"/><ellipse cx="300" cy="220" rx="20" ry="8"/><ellipse cx="349" cy="251" rx="20" ry="8"/><ellipse cx="288" cy="275" rx="20" ry="8"/></g><path d="M331 176c86-27 111 83 32 89-56 5-84-57-32-89" fill="#ad643a"/><g fill="#72934f"><circle cx="213" cy="211" r="20"/><circle cx="234" cy="184" r="19"/></g><circle cx="403" cy="292" r="24" fill="#c66143"/>',
    grill: '<path d="M243 178c67-56 159-15 151 73-7 79-118 105-166 33-30-45-21-75 15-106" fill="#a9673d"/><path d="m255 198 100 30m-115 7 119 33m-98 12 84 24" stroke="#704932" stroke-width="9" stroke-linecap="round"/><g fill="#e4b858"><rect x="403" y="189" width="17" height="105" rx="5"/><rect x="426" y="208" width="17" height="97" rx="5"/><rect x="446" y="194" width="17" height="98" rx="5"/></g><ellipse cx="208" cy="284" rx="32" ry="24" fill="#6b914e"/>',
    salad: '<g fill="#729b59"><ellipse cx="265" cy="204" rx="60" ry="38" transform="rotate(-25 265 204)"/><ellipse cx="362" cy="211" rx="65" ry="40" transform="rotate(30 362 211)"/><ellipse cx="293" cy="286" rx="78" ry="44"/></g><g fill="#d86a4c"><circle cx="253" cy="261" r="22"/><circle cx="365" cy="277" r="25"/><circle cx="324" cy="185" r="19"/></g><path d="M315 221c57-43 70 19 19 57-48 31-69-13-19-57" fill="#c7d384"/><path d="M315 233c38-24 42 10 10 32-31 20-42-11-10-32" fill="#8ca65b"/>',
    drink: '<path d="m246 139 26 211q48 26 96 0l26-211z" fill="#dda953"/><path d="m254 202 19 145q47 23 94 0l19-145z" fill="#eebd68"/><ellipse cx="320" cy="139" rx="74" ry="17" fill="#f5ddb0"/><path d="m340 208 43-115" stroke="#faf1dc" stroke-width="11"/><g fill="#f9eac9" opacity=".7"><rect x="279" y="224" width="26" height="26" rx="6"/><rect x="320" y="257" width="26" height="26" rx="6"/></g><circle cx="252" cy="159" r="28" fill="#afbc69"/>',
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><defs><radialGradient id="bg"><stop stop-color="#f3e9d6"/><stop offset="1" stop-color="#d5dccd"/></radialGradient></defs><rect width="640" height="480" fill="url(#bg)"/><ellipse cx="320" cy="276" rx="192" ry="147" fill="#899886" opacity=".18"/><ellipse cx="320" cy="250" rx="185" ry="144" fill="#f9f6ed"/><ellipse cx="320" cy="250" rx="158" ry="121" fill="#f0eddf"/>${art[kind]}</svg>`;
}
