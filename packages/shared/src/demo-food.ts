import type { MenuItem, Restaurant, RestaurantMenu } from "./domain.js";
import type { FoodBusinessType } from "./food-business.js";

// Shared fictional catalogue for sandbox testing; entries stay hidden in live mode.
const CREATED = "2026-01-01T00:00:00.000Z";
type Dish = {
  name: string;
  description: string;
  price: number;
  art: "rice" | "grill" | "pizza" | "burger" | "salad" | "drink" | "wrap" | "samosa" | "baked" | "cake";
  category: string;
  badge?: MenuItem["badge"];
  options?: boolean;
  featured?: boolean;
};
const seeds = [
  { slug: "lakeview", name: "Lakeview Kitchen", cuisine: "Ugandan · Grills", businessType: "restaurant", address: "Demo location · Entebbe", open: true, cover: "lakeview-restaurant", dishes: [
    { name: "Chicken pilau", description: "Spiced rice, grilled chicken, fresh kachumbari and a house chilli sauce.", price: 18000, art: "rice", category: "Mains", badge: "trending", options: true, featured: true },
    { name: "Beef luwombo", description: "Slow-cooked beef in groundnut sauce, served with steamed matooke.", price: 22000, art: "grill", category: "Mains", options: true },
    { name: "Tilapia & chips", description: "Grilled lake-style tilapia with crispy chips and a lemon wedge.", price: 28000, art: "grill", category: "Mains", badge: "new" },
    { name: "Garden salad", description: "Crunchy greens, tomato, cucumber and a fresh citrus dressing.", price: 9000, art: "salad", category: "Sides" },
    { name: "Passion fruit juice", description: "A chilled glass of fresh passion fruit juice.", price: 5000, art: "drink", category: "Drinks" },
    { name: "Beef samosas", description: "Crisp golden parcels filled with spiced beef and served with a tamarind dip.", price: 7000, art: "samosa", category: "Starters", featured: true },
    { name: "Warm banana cake", description: "Soft banana cake with a caramelised top and a little cinnamon.", price: 8000, art: "cake", category: "Desserts" },
  ] },
  { slug: "brick-oven", name: "Brick Oven Social", cuisine: "Pizza · Italian", businessType: "restaurant", address: "Demo location · Kitala", open: true, cover: "brick-oven-restaurant", dishes: [
    { name: "Margherita pizza", description: "Tomato, mozzarella and basil on a thin, wood-fired style crust.", price: 24000, art: "pizza", category: "Pizzas", badge: "trending", options: true, featured: true },
    { name: "BBQ chicken pizza", description: "Smoky chicken, sweet peppers, mozzarella and barbecue sauce.", price: 29000, art: "pizza", category: "Pizzas", options: true },
    { name: "Roasted vegetable pizza", description: "Seasonal vegetables with a rich tomato sauce and fresh herbs.", price: 26000, art: "pizza", category: "Pizzas", badge: "new", options: true },
    { name: "Garlic bread", description: "Warm bread brushed with garlic butter and parsley.", price: 8000, art: "grill", category: "Sides", badge: "sale" },
    { name: "Lemon mint cooler", description: "Fresh lemon and mint over ice.", price: 6000, art: "drink", category: "Drinks" },
    { name: "Tomato basil soup", description: "Slow-simmered tomato soup with basil and a toasted bread bite.", price: 10000, art: "salad", category: "Starters" },
    { name: "Chocolate cake slice", description: "A rich cocoa sponge layered with smooth chocolate cream.", price: 12000, art: "cake", category: "Desserts", featured: true },
  ] },
  { slug: "bun-yard", name: "The Bun Yard", cuisine: "Burgers · Street food", businessType: "restaurant", address: "Demo location · Kampala", open: true, cover: "bun-yard-restaurant", dishes: [
    { name: "Classic beef burger", description: "Grilled beef, cheddar, lettuce and tomato in a toasted bun.", price: 19000, art: "burger", category: "Burgers", badge: "trending", options: true, featured: true },
    { name: "Crispy chicken burger", description: "Golden chicken, slaw and a creamy pepper sauce.", price: 20000, art: "burger", category: "Burgers", badge: "new", options: true },
    { name: "Plant-based burger", description: "A hearty bean patty with avocado, crunchy greens and tomato.", price: 18000, art: "burger", category: "Burgers", options: true },
    { name: "Loaded chips", description: "Crispy chips topped with cheese, herbs and a tangy house sauce.", price: 10000, art: "grill", category: "Sides", badge: "sale" },
    { name: "Vanilla milkshake", description: "A creamy vanilla shake, served cold.", price: 8000, art: "drink", category: "Drinks" },
    { name: "Crispy onion rings", description: "Sweet onion rings in a light golden crumb with house dip.", price: 9000, art: "grill", category: "Sides" },
    { name: "Fudge brownie", description: "A soft-centred chocolate brownie with toasted nuts.", price: 10000, art: "cake", category: "Desserts" },
  ] },
  { slug: "green-table", name: "Green Table Café", cuisine: "Healthy · Café", businessType: "restaurant", address: "Demo location · Entebbe", open: false, cover: "green-table-restaurant", dishes: [
    { name: "Avocado grain bowl", description: "Avocado, warm grains, roasted vegetables and a lemon dressing.", price: 16000, art: "salad", category: "Mains", badge: "trending", options: true, featured: true },
    { name: "Roasted chicken salad", description: "Chicken, leafy greens and cherry tomatoes with a yoghurt dressing.", price: 19000, art: "salad", category: "Mains", options: true },
    { name: "Vegetable rice bowl", description: "Seasoned rice with colourful vegetables and a sesame dressing.", price: 14000, art: "rice", category: "Mains", badge: "new" },
    { name: "Fruit bowl", description: "A fresh mix of pineapple, watermelon and seasonal fruit.", price: 9000, art: "salad", category: "Sides" },
    { name: "Mango smoothie", description: "Mango blended with yoghurt and a little honey.", price: 7000, art: "drink", category: "Drinks" },
    { name: "Banana oat pancakes", description: "Fluffy oat pancakes with banana and a drizzle of honey.", price: 12000, art: "baked", category: "Breakfast", featured: true },
    { name: "Berry yoghurt cup", description: "Creamy yoghurt layered with seasonal fruit and crunchy granola.", price: 8500, art: "salad", category: "Breakfast" },
  ] },
  { slug: "sharon-cooks", name: "Sharon Cooks", cuisine: "Ugandan · Home-cooked", businessType: "kitchen", address: "Demo location · Kira", open: true, cover: "beef-luwombo", dishes: [
    { name: "Sunday chicken stew", description: "Slow-simmered chicken stew with matooke and fresh herbs.", price: 18000, art: "rice", category: "Mains", featured: true, options: true },
    { name: "Groundnut beans & matooke", description: "Creamy groundnut beans served with soft steamed matooke.", price: 14000, art: "rice", category: "Mains" },
    { name: "Pumpkin leaf greens", description: "Tender local greens cooked with onion and a little groundnut.", price: 7000, art: "salad", category: "Sides" },
    { name: "Fresh chapati", description: "Flaky pan-cooked chapati, made fresh to order.", price: 3000, art: "wrap", category: "Sides" },
    { name: "Ginger tea", description: "Warming ginger tea with lemon and a touch of honey.", price: 4000, art: "drink", category: "Drinks" },
  ] },
  { slug: "hearth-and-home", name: "Hearth & Home Kitchen", cuisine: "East African · Comfort food", businessType: "kitchen", address: "Demo location · Ntinda", open: true, cover: "chicken-pilau", dishes: [
    { name: "Beef pilau lunch box", description: "Fragrant spiced rice with tender beef and kachumbari.", price: 16000, art: "rice", category: "Mains", featured: true },
    { name: "Chicken curry & rice", description: "A gentle coconut chicken curry with steamed rice.", price: 19000, art: "grill", category: "Mains" },
    { name: "Crispy cassava bites", description: "Golden cassava pieces with a tangy tomato chilli dip.", price: 6000, art: "grill", category: "Snacks" },
    { name: "Chapati roll", description: "Soft chapati rolled with egg, greens and a fresh tomato relish.", price: 8000, art: "wrap", category: "Snacks" },
    { name: "Passion cooler", description: "Fresh passion fruit juice served chilled.", price: 5000, art: "drink", category: "Drinks" },
  ] },
  { slug: "kampala-rolex-stop", name: "Kampala Rolex Stop", cuisine: "Rolex · Street food", businessType: "street_food", address: "Demo location · Wandegeya", open: true, cover: "loaded-chips", dishes: [
    { name: "Classic egg rolex", description: "Fresh chapati wrapped around a fluffy two-egg vegetable omelette.", price: 5000, art: "wrap", category: "Rolex", featured: true },
    { name: "Beef rolex", description: "A hot chapati with egg, spiced beef, cabbage and tomato.", price: 8000, art: "wrap", category: "Rolex", badge: "trending" },
    { name: "Avocado rolex", description: "Egg rolex finished with creamy avocado and fresh greens.", price: 7000, art: "wrap", category: "Rolex" },
    { name: "Golden samosas", description: "Crisp savoury samosas with a bright tomato dip.", price: 3000, art: "samosa", category: "Quick bites" },
    { name: "Passion juice", description: "A chilled cup of fresh passion fruit juice.", price: 3000, art: "drink", category: "Drinks" },
  ] },
  { slug: "chapati-corner", name: "Chapati Corner", cuisine: "Grilled bites · Street food", businessType: "street_food", address: "Demo location · Nakawa", open: true, cover: "bun-yard-restaurant", dishes: [
    { name: "Beef skewers", description: "Char-grilled beef skewers with onion, pepper and a smoky sauce.", price: 10000, art: "grill", category: "Grill", featured: true },
    { name: "Spiced grilled maize", description: "Sweet roasted maize brushed with chilli-lime butter.", price: 4000, art: "grill", category: "Grill" },
    { name: "Chapati and beans", description: "Fresh chapati with slow-cooked beans and kachumbari.", price: 7000, art: "wrap", category: "Quick meals" },
    { name: "Crispy plantain", description: "Golden ripe plantain with a pinch of chilli salt.", price: 5000, art: "grill", category: "Quick bites" },
    { name: "Tamarind cooler", description: "A refreshing sweet-tart tamarind drink over ice.", price: 3500, art: "drink", category: "Drinks" },
  ] },
  { slug: "golden-crumb", name: "Golden Crumb Bakery", cuisine: "Breads · Pastries", businessType: "bakery", address: "Demo location · Kololo", open: true, cover: "garlic-bread", dishes: [
    { name: "Country sourdough loaf", description: "A crusty slow-fermented loaf with a soft, open crumb.", price: 14000, art: "baked", category: "Breads", featured: true },
    { name: "Cinnamon swirl", description: "Soft rolled pastry with cinnamon sugar and a light glaze.", price: 7000, art: "baked", category: "Pastries" },
    { name: "Chocolate croissant", description: "Buttery laminated pastry with a dark chocolate centre.", price: 8000, art: "baked", category: "Pastries" },
    { name: "Berry tart", description: "A crisp pastry shell with vanilla cream and seasonal berries.", price: 10000, art: "cake", category: "Cakes & tarts" },
    { name: "Fresh coffee", description: "A smooth freshly brewed cup, served hot.", price: 6000, art: "drink", category: "Drinks" },
  ] },
  { slug: "sweet-oven", name: "Sweet Oven Bakehouse", cuisine: "Cakes · Baked treats", businessType: "bakery", address: "Demo location · Bugolobi", open: false, cover: "vanilla-shake", dishes: [
    { name: "Chocolate celebration cake", description: "A rich chocolate sponge with silky cocoa frosting.", price: 16000, art: "cake", category: "Cakes", featured: true },
    { name: "Banana bread slice", description: "Moist banana loaf with warm spice and toasted nuts.", price: 6000, art: "baked", category: "Loaves" },
    { name: "Vanilla cupcakes", description: "Soft vanilla cakes topped with a swirl of buttercream.", price: 5000, art: "cake", category: "Cakes" },
    { name: "Sugar doughnuts", description: "Pillowy doughnuts rolled in a light dusting of sugar.", price: 4000, art: "baked", category: "Pastries" },
    { name: "Spiced milk tea", description: "Black tea simmered with milk, ginger and warming spices.", price: 3500, art: "drink", category: "Drinks" },
  ] },
] satisfies Array<{ slug: string; name: string; cuisine: string; businessType: FoodBusinessType; address: string; open: boolean; cover: string; dishes: Dish[] }>;

export const DEMO_FOOD_RESTAURANTS: Restaurant[] = seeds.map((seed) => ({
  id: `demo-food-${seed.slug}`, owner_id: "demo-food-owner", name: seed.name,
  description: "Fictional food business for sandbox testing.", cuisine: seed.cuisine,
  business_type: seed.businessType,
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
  const cover = seeds.find(seed => id === `demo-food-${seed.slug}`)?.cover;
  return cover ? `/demo-food/${cover}.webp` : undefined;
}

export function demoFoodMenu(id: string): RestaurantMenu | undefined {
  const seed = seeds.find((seed) => `demo-food-${seed.slug}` === id);
  if (!seed) return undefined;
  const items: MenuItem[] = seed.dishes.map((dish, index) => {
    const itemId = `${id}-item-${index + 1}`;
    const optionId = `${itemId}-size`;
    const categorySlug = dish.category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return {
      id: itemId, restaurant_id: id, category_id: `${id}-${categorySlug}`,
      name: dish.name, description: dish.description, price: dish.price, photo_key: `demo-food/${dish.art}`,
      available: 1, prep_time_minutes: index < 3 ? 25 : 10, sort_order: index,
      is_featured: dish.featured ? 1 : 0,
      badge: "badge" in dish ? dish.badge ?? null : null, created_at: CREATED, updated_at: CREATED,
      options: "options" in dish && dish.options ? [
        { id: optionId, menu_item_id: itemId, name: "Size", required: 1, multi_select: 0, sort_order: 0,
          choices: [{id:`${optionId}-regular`,name:"Regular",price_delta:0,sort_order:0},{id:`${optionId}-large`,name:"Large",price_delta:5000,sort_order:1}] },
        { id: `${itemId}-extras`, menu_item_id: itemId, name: "Extras", required: 0, multi_select: 1, sort_order: 1,
          choices: [{id:`${itemId}-extra-avocado`,name:"Avocado",price_delta:3000,sort_order:0},{id:`${itemId}-extra-chips`,name:"Chips",price_delta:4000,sort_order:1}] },
      ] : [],
    };
  });
  const categories = new Map<string, { name: string; items: MenuItem[] }>();
  for (const [index, dish] of seed.dishes.entries()) {
    const categorySlug = dish.category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const category = categories.get(categorySlug) ?? { name: dish.category, items: [] };
    category.items.push(items[index]);
    categories.set(categorySlug, category);
  }
  return { categories: [...categories].map(([categorySlug, category], sort_order) => ({
    id: `${id}-${categorySlug}`,
    restaurant_id: id,
    name: category.name,
    sort_order,
    created_at: CREATED,
    updated_at: CREATED,
    items: category.items,
  })), uncategorizedItems: [] };
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
    wrap: '<path d="M190 214q130-110 260 0l-35 132q-95 40-190 0z" fill="#d8ad68"/><path d="M207 230q112-84 226 0l-20 30q-96-42-185 0z" fill="#6c914f"/><path d="m213 264 201 0-16 54q-83 34-168 0z" fill="#b96342"/><path d="M190 214q130-110 260 0l-18 38q-112-62-224 0z" fill="#edcc8b"/><ellipse cx="276" cy="221" rx="15" ry="10" fill="#f1e2c2"/><ellipse cx="344" cy="216" rx="15" ry="10" fill="#f1e2c2"/><path d="m245 334 143 0" stroke="#f8e7c3" stroke-width="10" stroke-linecap="round"/>',
    samosa: '<g stroke="#a96836" stroke-width="8" stroke-linejoin="round"><path d="m198 319 71-178 87 177z" fill="#dc9b48"/><path d="m292 319 83-196 92 196z" fill="#edb75a"/><path d="m340 337 57-143 70 143z" fill="#cf873e"/></g><path d="m219 305 50-126 63 126m-18 0 59-143 70 143m-84 18 34-85 43 85" fill="none" stroke="#f6d58d" stroke-width="8" stroke-linecap="round"/><circle cx="213" cy="344" r="15" fill="#72934f"/><circle cx="444" cy="344" r="15" fill="#b65b42"/>',
    baked: '<path d="M181 285q-18-33 10-52 0-58 55-55 34-74 99-35 56-27 83 25 62 3 57 59 43 51-6 86H205q-25-6-24-28" fill="#cf8c42"/><path d="M198 278q-5-25 22-37 5-42 48-40 28-57 76-25 46-21 65 22 45 0 42 43 27 31-7 48H213q-19-4-15-11" fill="#e8b45f"/><path d="M239 224q22 34 2 64m62-111q20 45 0 104m69-79q20 42 4 78m48-31q-15 20-10 41" fill="none" stroke="#f7d58f" stroke-width="9" stroke-linecap="round"/><ellipse cx="320" cy="339" rx="153" ry="16" fill="#c58a43" opacity=".25"/>',
    cake: '<path d="m203 223 139-73 112 71-140 77z" fill="#8b5039"/><path d="m203 223 111 75v71l-111-77z" fill="#d9a55c"/><path d="m314 298 140-77v72l-140 76z" fill="#b66c45"/><path d="m203 223 139-73 112 71-140 77z" fill="#f2d69e"/><path d="m203 242 111 75v18l-111-77z" fill="#f4e5c6"/><path d="m314 317 140-77v18l-140 77z" fill="#f1cf89"/><circle cx="344" cy="188" r="11" fill="#b44738"/><circle cx="378" cy="174" r="10" fill="#b44738"/><path d="m329 193 25-13m14 7 23-14" stroke="#72934f" stroke-width="6" stroke-linecap="round"/>',
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><defs><radialGradient id="bg"><stop stop-color="#f3e9d6"/><stop offset="1" stop-color="#d5dccd"/></radialGradient></defs><rect width="640" height="480" fill="url(#bg)"/><ellipse cx="320" cy="276" rx="192" ry="147" fill="#899886" opacity=".18"/><ellipse cx="320" cy="250" rx="185" ry="144" fill="#f9f6ed"/><ellipse cx="320" cy="250" rx="158" ry="121" fill="#f0eddf"/>${art[kind]}</svg>`;
}
