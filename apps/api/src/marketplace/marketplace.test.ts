import { setModuleFlags } from "../lib/modules.js";
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import app from "../app.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { resetSchemaCache } from "../lib/schema.js";
import { signToken } from "../auth/jwt.js";
import { invalidateSettingsCache } from "../lib/settings.js";
import { allowDemoCatalog } from "../test-support/db.js";

function bindDatabase(client: Client) {
  const prepare = (sql: string) => ({
    sql,
    args: [] as unknown[],
    bind(...args: unknown[]) {
      this.args = args;
      return this;
    },
    async all() {
      const result = await client.execute({ sql: this.sql, args: this.args as InArgs });
      return { results: result.rows, success: true, meta: { changes: result.rowsAffected, last_row_id: Number(result.lastInsertRowid ?? 0) } };
    },
  });
  setD1Binding({
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      const results = await client.batch(statements.map(({ sql, args }) => ({ sql, args: args as InArgs })), "write");
      return results.map((result) => ({ results: result.rows, success: true, meta: { changes: result.rowsAffected, last_row_id: Number(result.lastInsertRowid ?? 0) } }));
    },
  } as unknown as D1Database);
}

test("marketplace routes: public browsing is accessible without authentication", async () => {
  resetSchemaCache();
  const client = createClient({ url: "file::memory:" });
  const migrations = existsSync(join(process.cwd(), "apps/api/src/db/migrations")) ? join(process.cwd(), "apps/api/src/db/migrations") : join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) {
      await client.execute(sql);
    }
  }
  bindDatabase(client);
  await allowDemoCatalog(client);

  // 1. Public stores list
  const storesRes = await app.request("/v1/marketplace/stores");
  assert.equal(storesRes.status, 200);
  const storesData = (await storesRes.json()) as any;
  assert.ok(Array.isArray(storesData.stores));
  assert.ok(storesData.stores.length > 0);
  // Verify demo stores have is_live = 1
  const freshMart = storesData.stores.find((s: any) => s.id === "store_demo_fresh_mart");
  assert.ok(freshMart);
  assert.equal(Number(freshMart.is_live), 1);

  // 1b. Public stores sorted nearest first when lat & lng are provided
  const nearRes = await app.request("/v1/marketplace/stores?lat=0.3353&lng=32.5857");
  assert.equal(nearRes.status, 200);
  const nearData = (await nearRes.json()) as any;
  assert.ok(Array.isArray(nearData.stores));
  assert.equal(nearData.stores[0].id, "store_demo_fresh_mart");
  assert.equal(nearData.stores[0].distance_km, 0);
  for (let i = 1; i < nearData.stores.length; i++) {
    const prev = nearData.stores[i - 1].distance_km ?? 999999;
    const curr = nearData.stores[i].distance_km ?? 999999;
    assert.ok(prev <= curr, `stores should be sorted ascending by distance: ${prev} <= ${curr}`);
  }

  // 2. Public live channels rail
  const liveRes = await app.request("/v1/marketplace/live");
  assert.equal(liveRes.status, 200);
  const liveData = (await liveRes.json()) as any;
  assert.ok(Array.isArray(liveData.liveChannels));
  assert.ok(liveData.liveChannels.length > 0);

  // 3. Public spotlight feed
  const spotRes = await app.request("/v1/marketplace/spotlight");
  assert.equal(spotRes.status, 200);
  const spotData = (await spotRes.json()) as any;
  assert.ok(Array.isArray(spotData.spotlight));
  assert.ok(spotData.spotlight.length > 0);

  // 4. Public single product detail
  const prodRes = await app.request("/v1/marketplace/products/prod_honey_glazed_chicken");
  assert.equal(prodRes.status, 200);
  const prodData = (await prodRes.json()) as any;
  assert.ok(prodData.product);
  assert.equal(prodData.product.id, "prod_honey_glazed_chicken");
  assert.equal(prodData.product.image_url, "/products/honey-glazed-chicken.jpg");
  assert.ok(prodData.store);
  assert.equal(prodData.store.id, "store_demo_fresh_mart");

  const blazerRes = await app.request("/v1/marketplace/products/prod_pink_blazer");
  assert.equal(blazerRes.status, 200);
  const blazerData = (await blazerRes.json()) as any;
  assert.ok(blazerData.product);
  assert.equal(blazerData.product.id, "prod_pink_blazer");
  assert.equal(blazerData.product.image_url, "/products/pink-blazer.jpg");

  // 5. Authenticated merchant endpoint rejects without bearer token
  const meStoreRes = await app.request("/v1/merchants/me/store");
  assert.equal(meStoreRes.status, 401);
});

test("marketplace checkout: links orders to delivery system and alerts boda riders", async () => {
  process.env.JWT_SECRET = "marketplace-tests-only";
  resetSchemaCache();
  const client = createClient({ url: "file::memory:" });
  const migrations = existsSync(join(process.cwd(), "apps/api/src/db/migrations")) ? join(process.cwd(), "apps/api/src/db/migrations") : join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) {
      await client.execute(sql);
    }
  }
  bindDatabase(client);
  await allowDemoCatalog(client);

  // Setup user and rider
  await client.execute("INSERT INTO users (id, phone, name, password_hash, role, status) VALUES ('cust_1', '+256700111222', 'Alice Mukasa', 'hash', 'customer', 'active')");
  await client.execute("INSERT INTO users (id, phone, name, password_hash, role, status) VALUES ('rider_1', '+256700333444', 'Bob Boda', 'hash', 'rider', 'active')");
  await client.execute("INSERT INTO riders (user_id, verified, is_online, stage_lat, stage_lng, area) VALUES ('rider_1', 1, 1, 0.3353, 32.5857, 'Kololo')");

  const customerToken = await signToken({ sub: "cust_1", role: "customer" });
  const riderToken = await signToken({ sub: "rider_1", role: "rider" });

  // Customer checks out items from FreshMart Supermarket
  const checkoutRes = await app.request("/v1/marketplace/checkout", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${customerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      items: [
        {
          productId: "prod_milk_1l",
          storeId: "store_demo_fresh_mart",
          title: "Farm Fresh Whole Milk",
          price: 3500,
          quantity: 2,
          variantTitle: "1 Litre Bottle",
        },
        {
          productId: "prod_eggs_tray",
          storeId: "store_demo_fresh_mart",
          title: "Farm Fresh Eggs",
          price: 13500,
          quantity: 1,
          variantTitle: "Full Tray (30)",
        },
      ],
      paymentMethod: "momo",
      paymentRail: "escrow",
      destinationAddress: "Acacia Mall / Kololo, Kampala",
      destinationArea: "Kololo",
      destinationLat: 0.3353,
      destinationLng: 32.5857,
    }),
  });

  assert.equal(checkoutRes.status, 201);
  const checkoutData = (await checkoutRes.json()) as any;
  assert.equal(checkoutData.ok, true);
  assert.ok(checkoutData.order);
  const orderId = checkoutData.order.id;
  assert.equal(checkoutData.order.store_id, "store_demo_fresh_mart");
  assert.equal(checkoutData.order.stage, "Create");
  assert.equal(checkoutData.order.payment_rail, "escrow");

  // Verify list and items in database
  const listItems = await client.execute({ sql: "SELECT * FROM list_items WHERE list_id = ?", args: [checkoutData.order.list_id] });
  assert.equal(listItems.rows.length, 2);

  // Rider views available jobs feed
  const availableRes = await app.request("/v1/riders/jobs/available", {
    headers: { Authorization: `Bearer ${riderToken}` },
  });
  assert.equal(availableRes.status, 200);
  const availableData = (await availableRes.json()) as any;
  const job = availableData.jobs.find((j: any) => j.id === orderId);
  assert.ok(job, "Marketplace order must appear in rider available jobs");
  assert.equal(job.store_name, "FreshMart Supermarket");
  assert.equal(job.store_category, "groceries");

  // Rider previews job shopping list
  const previewRes = await app.request(`/v1/riders/jobs/${orderId}/preview`, {
    headers: { Authorization: `Bearer ${riderToken}` },
  });
  assert.equal(previewRes.status, 200);
  const previewData = (await previewRes.json()) as any;
  assert.equal(previewData.items.length, 2);

  // Rider claims job
  const claimRes = await app.request(`/v1/orders/${orderId}/claim`, {
    method: "POST",
    headers: { Authorization: `Bearer ${riderToken}` },
  });
  assert.equal(claimRes.status, 200);

  // Check order details
  const getOrderRes = await app.request(`/v1/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${riderToken}` },
  });
  assert.equal(getOrderRes.status, 200);
  const getOrderData = (await getOrderRes.json()) as any;
  assert.equal(getOrderData.order.store_name, "FreshMart Supermarket");
  assert.equal(getOrderData.order.rider_id, "rider_1");
});


test("marketplace checkout: a bag from several stores is one delivery, priced exactly and paid once", async () => {
  resetSchemaCache();
  const client = createClient({ url: "file::memory:" });
  const migrations = existsSync(join(process.cwd(), "apps/api/src/db/migrations")) ? join(process.cwd(), "apps/api/src/db/migrations") : join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  await allowDemoCatalog(client);
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "marketplace-bag-tests-only";
  try {
    await client.execute("INSERT INTO users (id, phone, name, password_hash, role, wallet_balance) VALUES ('shopper', 'shopper', 'Shopper', 'hash', 'customer', 1000000), ('boda', 'boda', 'Boda', 'hash', 'rider', 0)");
    await client.execute("INSERT INTO riders (user_id, verified, is_online, stage_lat, stage_lng) VALUES ('boda', 1, 1, 0.3353, 32.5857)");
    await client.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('delivery_rate_per_km', '1000'), ('minimum_delivery_fee', '2000')");
    const shopper = await signToken({ sub: "shopper", role: "customer" });
    const boda = await signToken({ sub: "boda", role: "rider" });
    const post = (path: string, token: string, body: object) => app.request(`/v1${path}`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const items = [
      { productId: "prod_avocados_pack", storeId: "store_demo_fresh_mart", title: "Hass Avocados (Pack of 3)", price: 5000, quantity: 1 },
      { productId: "prod_retro_high_top", storeId: "store_demo_sneaker_hub", title: "Air Retro", price: 185000, quantity: 1 },
    ];
    const destination = { destinationLat: 0.3476, destinationLng: 32.5825 };

    const quote = (await (await post("/marketplace/checkout/quote", shopper, { items, ...destination })).json()) as {
      itemsTotal: number; deliveryFee: number; total: number; stores: { deliveryFee: number }[];
    };
    assert.equal(quote.itemsTotal, 190000);
    assert.ok(quote.deliveryFee >= 2000);
    assert.equal(quote.stores.reduce((sum, store) => sum + store.deliveryFee, 0), quote.deliveryFee);
    assert.equal(quote.total, 190000 + quote.deliveryFee);

    const res = await post("/marketplace/checkout", shopper, { items, paymentRail: "escrow", destinationArea: "Kololo", ...destination });
    assert.equal(res.status, 201);
    const { orders } = (await res.json()) as { orders: { id: string; estimated_total: number; delivery_fee: number; delivery_bundle_id: string }[] };
    assert.equal(orders.length, 2);
    assert.ok(orders.every((order) => order.delivery_bundle_id === orders[0].id), "both stores are one delivery");
    // Pickups are visited in the order that makes the trip shortest, not the cart's order.
    assert.deepEqual(orders.map((order) => order.estimated_total - order.delivery_fee).sort((x, y) => x - y), [5000, 185000], "items are not reduced by the delivery fee");
    assert.equal(orders.reduce((sum, order) => sum + order.estimated_total, 0), quote.total, "the orders charge exactly the quote");

    await client.execute("UPDATE orders SET matching_mode = 'first_to_claim', updated_at = datetime('now', '-1 hour')");
    assert.equal((await post(`/orders/${orders[0].id}/claim`, boda, {})).status, 200);
    const fund = await post(`/orders/${orders[0].id}/fund`, shopper, { paymentMethod: "wallet", useWallet: true, acceptedAmount: quote.total });
    assert.equal(fund.status, 200);
    const stages = (await client.execute("SELECT stage, rider_id FROM orders ORDER BY created_at")).rows;
    assert.deepEqual(stages.map((row) => [row.stage, row.rider_id]), [["Shop", "boda"], ["Shop", "boda"]], "one rider, one payment for both stores");
    assert.equal(Number((await client.execute("SELECT wallet_balance FROM users WHERE id = 'shopper'")).rows[0].wallet_balance), 1000000 - quote.total);
  } finally {
    process.env.JWT_SECRET = previousSecret;
    client.close();
  }
});

test("marketplace checkout: a long delivery from one store is relayed by matatu", async () => {
  resetSchemaCache();
  const client = createClient({ url: "file::memory:" });
  const migrations = existsSync(join(process.cwd(), "apps/api/src/db/migrations")) ? join(process.cwd(), "apps/api/src/db/migrations") : join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  await allowDemoCatalog(client);
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "marketplace-relay-tests-only";
  try {
    await client.execute("INSERT INTO users (id, phone, name, password_hash, role) VALUES ('shopper', 'shopper', 'Shopper', 'hash', 'customer')");
    await client.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('delivery_rate_per_km', '2000'), ('minimum_delivery_fee', '2000'), ('relay_enabled', '1')");
    // FreshMart is at Acacia Mall, Kololo; the customer is in Entebbe.
    await client.execute(`INSERT INTO relay_routes (id, name, stage_a_name, stage_a_lat, stage_a_lng, stage_b_name, stage_b_lat, stage_b_lng, parcel_fare, drop_mode)
                          VALUES ('r', 'Kampala - Entebbe', 'Kampala taxi park', 0.3136, 32.5811, 'Entebbe stage', 0.0512, 32.4637, 5000, 'stage')`);
    const shopper = await signToken({ sub: "shopper", role: "customer" });
    const post = (path: string, body: object) => app.request(`/v1${path}`, {
      method: "POST", headers: { Authorization: `Bearer ${shopper}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const items = [{ productId: "prod_avocados_pack", storeId: "store_demo_fresh_mart", title: "Hass Avocados", price: 5000, quantity: 1 }];
    const destination = { destinationLat: 0.06, destinationLng: 32.47 };
    const quote = (await (await post("/marketplace/checkout/quote", { items, ...destination })).json()) as {
      deliveryFee: number; relay: { legs: { kind: string; fee: number }[]; doorTotal: number } | null;
    };
    assert.ok(quote.relay, "relayed");
    assert.deepEqual(quote.relay!.legs.map((leg) => leg.kind), ["boda", "matatu", "boda"]);
    assert.equal(quote.deliveryFee, quote.relay!.doorTotal);
    const res = await post("/marketplace/checkout", { items, paymentRail: "escrow", ...destination });
    const { order } = (await res.json()) as { order: { id: string; delivery_fee: number; estimated_total: number } };
    assert.equal(order.delivery_fee, quote.deliveryFee);
    assert.equal(order.estimated_total, 5000 + quote.deliveryFee);
    assert.equal((await client.execute({ sql: "SELECT COUNT(*) AS n FROM order_relay_legs WHERE order_id = ?", args: [order.id] })).rows[0].n, 3);
  } finally {
    process.env.JWT_SECRET = previousSecret;
    client.close();
  }
});

test("merchant elite tier: upgrades to elite, manages Store 2.0 theme, smart collections, discounts, multi-outlet stock, B2B draft orders, and P&L analytics", async () => {
  resetSchemaCache();
  const client = createClient({ url: "file::memory:" });
  const migrations = existsSync(join(process.cwd(), "apps/api/src/db/migrations")) ? join(process.cwd(), "apps/api/src/db/migrations") : join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "marketplace-elite-tests-only";
  try {
    await client.execute("INSERT INTO users (id, phone, name, password_hash, role, status) VALUES ('merch_elite_1', '+256700999888', 'Kampala Boutique Owner', 'hash', 'customer', 'active')");
    await client.execute("INSERT INTO merchants (id, legal_name, display_name, business_kind, status, environment) VALUES ('m_elite_1', 'Kampala Boutique Ltd', 'Kampala Boutique', 'business', 'active', 'sandbox')");
    await client.execute("INSERT INTO merchant_members (merchant_id, user_id, role, status) VALUES ('m_elite_1', 'merch_elite_1', 'owner', 'active')");
    const catRow = await client.execute("SELECT id FROM merchant_categories LIMIT 1");
    const catId = String(catRow.rows[0]?.id ?? "cat_retail");
    await client.execute({
      sql: "INSERT INTO merchant_outlets (id, merchant_id, category_id, name, code, address, status) VALUES ('out_acacia', 'm_elite_1', ?, 'Acacia Mall Flagship', 'PEEBEE-9988-01', 'Acacia Avenue', 'active'), ('out_arena', 'm_elite_1', ?, 'Arena Mall Branch', 'PEEBEE-9988-02', 'Nsambya', 'active')",
      args: [catId, catId],
    });

    const merchantToken = await signToken({ sub: "merch_elite_1", role: "customer" });
    const req = (path: string, method = "GET", body?: object) =>
      app.request(`/v1${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${merchantToken}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });

    // 1. Tier 1: Merchant Code only (no online store yet)
    const getStoreRes = await req("/merchants/me/store");
    assert.equal(getStoreRes.status, 200);
    const initialStoreData = (await getStoreRes.json()) as any;
    assert.equal(initialStoreData.store, null);
    assert.ok(initialStoreData.settings);
    assert.equal(initialStoreData.settings.eliteEnabled, true);

    // 1b. Tier 2: Launch Marketplace Store (Pro)
    const createStoreRes = await req("/merchants/me/store", "POST", {
      name: "Kampala Boutique",
      category: "stores",
      sub_category: "fashion",
      address: "Acacia Mall, Kololo",
    });
    assert.equal(createStoreRes.status, 200);
    const createdStoreData = (await createStoreRes.json()) as any;
    assert.ok(createdStoreData.store);
    assert.equal(createdStoreData.store.pro_tier, "pro_live");

    // 2. Tier 3: Upgrade store to Advanced Marketplace (Elite)
    const upgradeRes = await req("/merchants/me/store/tier", "POST", { tier: "elite", billingCycle: "monthly" });
    assert.equal(upgradeRes.status, 200);
    const upgradeData = (await upgradeRes.json()) as any;
    assert.equal(upgradeData.ok, true);
    assert.equal(upgradeData.tier, "elite");
    assert.equal(upgradeData.store.pro_tier, "elite");
    assert.equal(Number(upgradeData.store.elite_tier), 1);

    // 3. Customize Store 2.0 theme, custom domain, loyalty, and B2B wholesale
    await client.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('storefront_domain_mode', 'subdomain_plus_verified_custom_domains')");
    invalidateSettingsCache();
    const updateStoreRes = await req("/merchants/me/store", "PUT", {
      name: "Kampala Boutique Elite",
      theme_layout: "editorial",
      theme_accent: "gold",
      custom_domain: "shop.kampalaboutique.ug",
      hero_headline: "New Resort Collection",
      hero_subheadline: "Same-hour boda delivery across Kampala",
      hero_cta_text: "Shop Runway",
      loyalty_enabled: true,
      loyalty_cashback_percent: 5,
      b2b_wholesale_enabled: true,
      b2b_min_order_amount: 500000,
    });
    assert.equal(updateStoreRes.status, 200);
    const updatedStore = ((await updateStoreRes.json()) as any).store;
    assert.equal(updatedStore.pro_tier, "elite");
    assert.equal(updatedStore.theme_layout, "editorial");
    assert.equal(updatedStore.custom_domain, "shop.kampalaboutique.ug");
    await client.execute({ sql: "UPDATE stores SET domain_verified = 1 WHERE id = ?", args: [updatedStore.id] }); // the DNS check is covered in security/storefront.test.ts
    assert.equal(Number(updatedStore.loyalty_enabled), 1);
    assert.equal(Number(updatedStore.loyalty_cashback_percent), 5);
    assert.equal(Number(updatedStore.b2b_wholesale_enabled), 1);

    // 4. Create a product with COGS
    const prodRes = await req("/merchants/me/products", "POST", {
      title: "Silk Evening Blazer",
      price: 180000,
      compare_at_price: 220000,
      cost_price: 95000,
      inventory_quantity: 10,
      category_name: "Fashion",
      badge: "VIP",
    });
    assert.equal(prodRes.status, 200);
    const prodBody = (await prodRes.json()) as any;
    assert.ok(prodBody.productId);

    // 5. Create a Smart Collection matching category Fashion
    const colRes = await req("/merchants/me/collections", "POST", {
      title: "VIP Fashion Edit",
      kind: "smart",
      rule_field: "category",
      rule_value: "Fashion",
      pinned: true,
    });
    assert.equal(colRes.status, 201);
    const colListRes = await req("/merchants/me/collections");
    const colList = (await colListRes.json()) as any;
    assert.equal(colList.collections.length, 1);
    assert.equal(colList.collections[0].matching_products_count, 1);

    // 6. Create an Elite Discount Code
    const discRes = await req("/merchants/me/discounts", "POST", {
      code: "KAMPALA20",
      title: "20% Off VIP Launch",
      kind: "percent",
      value: 20,
      min_order_amount: 100000,
      is_automatic: false,
    });
    assert.equal(discRes.status, 201);
    const discListRes = await req("/merchants/me/discounts");
    const discList = (await discListRes.json()) as any;
    assert.equal(discList.discounts.length, 1);
    assert.equal(discList.discounts[0].code, "KAMPALA20");

    // 7. Update Multi-Outlet Inventory across Acacia & Arena branches and verify total syncs
    const invUpdateRes = await req("/merchants/me/outlet-inventory", "PUT", {
      productId: prodBody.productId,
      outletId: "out_acacia",
      quantity: 14,
      lowStockThreshold: 3,
    });
    assert.equal(invUpdateRes.status, 200);
    const invUpdateRes2 = await req("/merchants/me/outlet-inventory", "PUT", {
      productId: prodBody.productId,
      outletId: "out_arena",
      quantity: 8,
      lowStockThreshold: 3,
    });
    assert.equal(invUpdateRes2.status, 200);
    assert.equal(((await invUpdateRes2.json()) as any).totalQuantity, 22);

    // 8. Create a B2B Wholesale Draft Order
    const b2bRes = await req("/merchants/me/draft-orders", "POST", {
      customer_name: "Serena Boutique Partner",
      customer_phone: "+256772123456",
      customer_company: "Serena Retail Group",
      payment_terms: "net_14",
      discount_amount: 50000,
      items: [
        {
          productId: prodBody.productId,
          title: "Silk Evening Blazer",
          unitPrice: 150000,
          quantity: 5,
        },
      ],
    });
    assert.equal(b2bRes.status, 201);
    const draftBody = (await b2bRes.json()) as any;
    assert.equal(draftBody.total, 700000);

    // 9. Verify Executive P&L Analytics
    const analyticsRes = await req("/merchants/me/elite-analytics");
    assert.equal(analyticsRes.status, 200);
    const analytics = ((await analyticsRes.json()) as any).analytics;
    assert.equal(analytics.b2bPipelineUgx, 700000);
    assert.equal(analytics.openDraftOrdersCount, 1);
    assert.equal(analytics.activeDiscountsCount, 1);
    assert.equal(analytics.activeCollectionsCount, 1);

    // 10. Dedicated Storefront auto-sync: resolves by custom_domain and returns dual-channel URLs + collections + discounts + outlets
    const storefrontRes = await app.request("/v1/marketplace/stores/shop.kampalaboutique.ug");
    assert.equal(storefrontRes.status, 200);
    const storefrontData = (await storefrontRes.json()) as any;
    assert.equal(storefrontData.store.pro_tier, "elite");
    assert.equal(storefrontData.store.theme_layout, "editorial");
    assert.equal(storefrontData.channels.dedicatedStorefrontUrl, `https://${updatedStore.slug}.peebee.online`);
    assert.equal(storefrontData.channels.customerAppUrl, `https://app.peebee.online/store/${updatedStore.slug}`);
    assert.equal(storefrontData.channels.customDomainUrl, "https://shop.kampalaboutique.ug");
    assert.equal(storefrontData.collections.length, 1);
    assert.equal(storefrontData.discounts.length, 0, "a private promo code is not published; only automatic offers are");
    assert.equal(storefrontData.outlets.length, 2);

    // 11. Public B2B Wholesale Inquiry from Dedicated Storefront ([store-name].peebee.online)
    const publicB2bRes = await app.request("/v1/marketplace/stores/shop.kampalaboutique.ug/b2b-inquiry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_name: "Acacia Corporate Buyer",
        customer_phone: "+256701223344",
        customer_company: "Acacia Hospitality Ltd",
        payment_terms: "net_30",
        items: [
          {
            productId: prodBody.productId,
            title: "Silk Evening Blazer",
            unitPrice: 180000,
            quantity: 4,
          },
        ],
      }),
    });
    assert.equal(publicB2bRes.status, 201);
    const publicB2bData = (await publicB2bRes.json()) as any;
    assert.equal(publicB2bData.total, 720000);

    // 12. Checkout Quote auto-syncs Promo Code (KAMPALA20 = 20% off) + VIP Loyalty Cashback (5%)
    const quoteRes = await req("/marketplace/checkout/quote", "POST", {
      items: [
        {
          productId: prodBody.productId,
          storeId: String(updatedStore.id),
          title: "Silk Evening Blazer",
          price: 180000,
          quantity: 1,
        },
      ],
      promoCode: "KAMPALA20",
      salesChannel: "dedicated_storefront",
    });
    assert.equal(quoteRes.status, 200);
    const quoteData = (await quoteRes.json()) as any;
    assert.equal(quoteData.rawItemsTotal, 180000);
    assert.equal(quoteData.discountAmount, 36000);
    assert.equal(quoteData.itemsTotal, 144000);
    assert.equal(quoteData.appliedDiscount.code, "KAMPALA20");
    assert.equal(quoteData.loyaltyCashbackUgx, 7200);

    // 13. Branch-to-Branch Stock Transfer (Acacia 14 -> 10, Arena 8 -> 12)
    const transferRes = await req("/merchants/me/stock-transfers", "POST", {
      productId: prodBody.productId,
      fromOutletId: "out_acacia",
      toOutletId: "out_arena",
      quantity: 4,
      note: "Weekend restock for Arena Mall",
    });
    assert.equal(transferRes.status, 201);
    const transferData = (await transferRes.json()) as any;
    assert.equal(transferData.fromQuantityAfter, 10);
    assert.equal(transferData.toQuantityAfter, 12);

    const transferListRes = await req("/merchants/me/stock-transfers");
    assert.equal(transferListRes.status, 200);
    const transferList = (await transferListRes.json()) as any;
    assert.equal(transferList.transfers.length, 1);
    assert.equal(transferList.transfers[0].quantity, 4);

    // 14. Omnichannel Walk-In POS Register Sale (deducts stock + credits 5% VIP loyalty points)
    const posSale1Res = await req("/merchants/me/pos-sales", "POST", {
      outlet_id: "out_acacia",
      customer_phone: "+256777000111",
      customer_name: "Grace Nakato",
      payment_method: "peebee_code",
      items: [
        {
          productId: prodBody.productId,
          title: "Silk Evening Blazer",
          unitPrice: 180000,
          quantity: 2,
        },
      ],
    });
    assert.equal(posSale1Res.status, 201);
    const posSale1 = (await posSale1Res.json()) as any;
    assert.equal(posSale1.total, 360000);
    assert.equal(posSale1.loyaltyEarnedUgx, 18000); // 5% of 360,000
    assert.equal(posSale1.loyaltyBalanceAfterUgx, 18000);
    assert.ok(String(posSale1.receiptCode).startsWith("POS-"));

    // Second POS sale for same VIP shopper redeeming 8,000 UGX of loyalty points
    const posSale2Res = await req("/merchants/me/pos-sales", "POST", {
      outlet_id: "out_acacia",
      customer_phone: "+256777000111",
      customer_name: "Grace Nakato",
      payment_method: "momo",
      redeem_loyalty_ugx: 8000,
      items: [
        {
          productId: prodBody.productId,
          title: "Silk Evening Blazer",
          unitPrice: 180000,
          quantity: 1,
        },
      ],
    });
    assert.equal(posSale2Res.status, 201);
    const posSale2 = (await posSale2Res.json()) as any;
    assert.equal(posSale2.loyaltyRedeemedUgx, 8000);
    assert.equal(posSale2.total, 172000);
    assert.equal(posSale2.loyaltyEarnedUgx, 8600); // 5% of 172,000
    assert.equal(posSale2.loyaltyBalanceAfterUgx, 18600); // 18,000 - 8,000 + 8,600

    // 15. Verify VIP Customer CRM & Loyalty Directory
    const crmRes = await req("/merchants/me/crm-customers");
    assert.equal(crmRes.status, 200);
    const crmData = (await crmRes.json()) as any;
    assert.equal(crmData.summary.totalCustomers, 1);
    assert.equal(crmData.summary.vipCount, 1);
    assert.equal(crmData.customers[0].tier, "vip");
    assert.equal(crmData.customers[0].orders_count, 2);
    assert.equal(crmData.customers[0].total_spent_ugx, 532000);
    assert.equal(crmData.customers[0].points_balance_ugx, 18600);

    // 16. Supplier Directory (Phase 4)
    const supRes = await req("/merchants/me/suppliers", "POST", {
      name: "Mukwano Wholesalers Ltd",
      contact_person: "Patrick Mukwano",
      phone: "+256772123456",
      email: "orders@mukwano.ug",
      address: "Plot 14 6th Street Industrial Area",
    });
    assert.equal(supRes.status, 200);
    const supData = (await supRes.json()) as any;
    assert.ok(supData.id);

    const supListRes = await req("/merchants/me/suppliers");
    assert.equal(supListRes.status, 200);
    const supList = (await supListRes.json()) as any;
    assert.equal(supList.suppliers.length, 1);
    assert.equal(supList.suppliers[0].name, "Mukwano Wholesalers Ltd");

    // 17. Draft Purchase Order & 1-Tap Stock Receiving (Phase 4)
    const poCreateRes = await req("/merchants/me/purchase-orders", "POST", {
      supplier_id: supData.id,
      outlet_id: "out_acacia",
      items: [
        {
          productId: prodBody.productId,
          title: "Silk Evening Blazer",
          quantity: 25,
          unitCost: 110000,
        },
      ],
      notes: "Urgent restocking for acacia mall outlet",
    });
    assert.equal(poCreateRes.status, 200);
    const poCreate = (await poCreateRes.json()) as any;
    assert.equal(poCreate.totalCost, 2750000);
    assert.ok(String(poCreate.poNumber).startsWith("PO-"));

    // 1-Tap Stock Receiving
    const poReceiveRes = await req(`/merchants/me/purchase-orders/${poCreate.id}/receive`, "POST", {});
    assert.equal(poReceiveRes.status, 200);
    const poReceive = (await poReceiveRes.json()) as any;
    assert.equal(poReceive.status, "received");
    assert.equal(poReceive.itemsReceivedCount, 1);

    // Verify outlet inventory was credited with 25 new units
    const invAfterPoRes = await req("/merchants/me/outlet-inventory?outlet_id=out_acacia");
    const invAfterPo = (await invAfterPoRes.json()) as any;
    const acaciaProdInv = invAfterPo.inventory.find((r: any) => r.product_id === prodBody.productId);
    // Was 12 after transfer - 3 via POS = 9, now + 25 = 34
    assert.equal(acaciaProdInv.quantity, 32);

    // 18. Product Bundles & Kits (Phase 4)
    const bundleCreateRes = await req("/merchants/me/bundles", "POST", {
      title: "VIP Executive Hamper",
      description: "Silk blazer plus luxury accessories combo",
      price: 220000,
      compare_at_price: 260000,
      items: [
        {
          productId: prodBody.productId,
          title: "Silk Evening Blazer",
          quantity: 1,
        },
      ],
    });
    assert.equal(bundleCreateRes.status, 200);
    const bundleCreate = (await bundleCreateRes.json()) as any;
    assert.ok(bundleCreate.id);

    const bundleListRes = await req("/merchants/me/bundles");
    assert.equal(bundleListRes.status, 200);
    const bundleList = (await bundleListRes.json()) as any;
    assert.equal(bundleList.bundles.length, 1);
    assert.equal(bundleList.bundles[0].title, "VIP Executive Hamper");
    assert.equal(bundleList.bundles[0].price, 220000);

    // Public store returns bundles
    const publicStoreRes = await req(`/marketplace/stores/${upgradeData.store.id}`);
    assert.equal(publicStoreRes.status, 200);
    const publicStoreData = (await publicStoreRes.json()) as any;
    assert.equal(publicStoreData.bundles.length, 1);
    assert.equal(publicStoreData.bundles[0].title, "VIP Executive Hamper");

    // 19. Customer Win-Back Campaigns (Phase 4)
    const winbackRes = await req("/merchants/me/winback-campaigns", "POST", {
      customer_phone: "+256777000111",
      customer_name: "Grace Nakato",
      discount_code: "WELCOMEBACK20",
      channel: "whatsapp",
      message: "Hello Grace! We miss you at Elite Boutique. Enjoy 20% off your next order today!",
    });
    assert.equal(winbackRes.status, 200);
    const winbackData = (await winbackRes.json()) as any;
    assert.ok(winbackData.campaignId);
    assert.ok(winbackData.whatsappUrl.includes("wa.me/256777000111"));

    const winbackListRes = await req("/merchants/me/winback-campaigns");
    assert.equal(winbackListRes.status, 200);
    const winbackList = (await winbackListRes.json()) as any;
    assert.equal(winbackList.campaigns.length, 1);
    assert.equal(winbackList.campaigns[0].customer_phone, "256777000111");

    // 20. Store 2.0 Visual Section Page Builder
    const sectionsRes = await req("/merchants/me/storefront-sections");
    assert.equal(sectionsRes.status, 200);
    const sectionsData = (await sectionsRes.json()) as any;
    assert.ok(Array.isArray(sectionsData.sections));
    assert.ok(sectionsData.sections.length >= 7);

    // Reorder and update sections
    const reorderedSections = [
      { id: "sec_hero", type: "hero", title: "Kampala Flagship Store", enabled: true, order: 1 },
      { id: "sec_bundles", type: "bundles", title: "Luxury Hamper Packages", enabled: true, order: 2 },
      { id: "sec_reviews", type: "testimonials", title: "VIP Client Reviews", enabled: false, order: 3 },
    ];
    const updateSecRes = await req("/merchants/me/storefront-sections", "PUT", {
      sections: reorderedSections,
    });
    assert.equal(updateSecRes.status, 200);
    const updateSec = (await updateSecRes.json()) as any;
    assert.equal(updateSec.ok, true);
    assert.equal(updateSec.sections.length, 3);
    assert.equal(updateSec.sections[0].id, "sec_hero");

    // Public store returns updated sections
    const publicStoreWithSecRes = await req(`/marketplace/stores/${upgradeData.store.id}`);
    assert.equal(publicStoreWithSecRes.status, 200);
    const publicStoreWithSec = (await publicStoreWithSecRes.json()) as any;
    assert.equal(publicStoreWithSec.sections.length, 3);
    assert.equal(publicStoreWithSec.sections[0].title, "Kampala Flagship Store");

    // 21. Automated SMS Receipts & Order Alerts
    const sendSmsRes = await req("/merchants/me/send-sms", "POST", {
      recipient_phone: "+256701445889",
      recipient_name: "Dr. Julian M.",
      message_type: "pos_receipt",
      body: "Thank you for shopping at Elite Boutique! Receipt code: #POS-9901. Total: UGX 220,000.",
    });
    assert.equal(sendSmsRes.status, 200);
    const sendSmsData = (await sendSmsRes.json()) as any;
    assert.equal(sendSmsData.ok, true);
    assert.equal(sendSmsData.status, "simulated", "no SMS provider is connected, so nothing was really sent");
    assert.equal(sendSmsData.costUgx, 0);
    assert.ok(sendSmsData.logId);
    assert.ok(sendSmsData.whatsappShareUrl.includes("wa.me/256701445889"));

    const smsLogsRes = await req("/merchants/me/sms-logs");
    assert.equal(smsLogsRes.status, 200);
    const smsLogsData = (await smsLogsRes.json()) as any;
    assert.equal(smsLogsData.logs.length, 1);
    assert.equal(smsLogsData.logs[0].recipient_phone, "+256701445889");
    assert.equal(smsLogsData.logs[0].message_type, "pos_receipt");
  } finally {
    process.env.JWT_SECRET = previousSecret;
    client.close();
  }
});



test("a store whose module is switched off is in no list, page, product, live rail or spotlight feed", async () => {
  resetSchemaCache();
  const client = createClient({ url: "file::memory:" });
  const migrations = existsSync(join(process.cwd(), "apps/api/src/db/migrations")) ? join(process.cwd(), "apps/api/src/db/migrations") : join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  await allowDemoCatalog(client);
  const json = async (path: string) => { const res = await app.request(path); return { status: res.status, body: (await res.json()) as any }; };

  const before = await json("/v1/marketplace/stores");
  const groceries = before.body.stores.filter((s: any) => s.category === "groceries").length;
  assert.ok(before.body.stores.length > groceries, "demo has stores beyond groceries");
  assert.equal((await json("/v1/marketplace/stores/store_demo_fresh_mart")).status, 200);

  await setModuleFlags({ live: { "buy.marketplace": false } });
  const off = await json("/v1/marketplace/stores");
  assert.ok(off.body.stores.every((s: any) => s.category === "groceries" || s.category === "pharmacy"), "only the other modules' stores remain");
  const storeCategory = before.body.stores.find((s: any) => s.id === "store_demo_fresh_mart").category;
  if (storeCategory !== "groceries" && storeCategory !== "pharmacy") {
    assert.equal((await json("/v1/marketplace/stores/store_demo_fresh_mart")).status, 404);
    assert.deepEqual((await json("/v1/marketplace/stores/store_demo_fresh_mart/products")).body.products, []);
    assert.equal((await json("/v1/marketplace/products/prod_honey_glazed_chicken")).status, 404);
  }
  assert.ok((await json("/v1/marketplace/spotlight")).body.spotlight.every((i: any) => i.store_category === "groceries" || i.store_category === "pharmacy"));

  await setModuleFlags({ live: { "buy.marketplace": true, "buy.shopping": false, "buy.pharmacy": false } });
  assert.ok((await json("/v1/marketplace/stores")).body.stores.every((s: any) => s.category !== "groceries" && s.category !== "pharmacy"));

  await setModuleFlags({ live: { "buy": false } });
  assert.deepEqual((await json("/v1/marketplace/stores")).body.stores, []);
  assert.deepEqual((await json("/v1/marketplace/spotlight")).body.spotlight, []);
  assert.deepEqual((await json("/v1/marketplace/live")).body.liveChannels, []);
});
