import test from "node:test";
import assert from "node:assert/strict";
import { addMerchantStore, addUser, anonymous, app, freshDatabase } from "../test-support/db.js";
import { signToken } from "../auth/jwt.js";
import { eatInstant, isHttpsUrl, isRealDate, normalizePhone } from "../lib/validation.js";
import { OPTION_SETTINGS, resolveEffective, validateValue } from "../lib/option-registry.js";
import { getOption } from "../lib/option-settings.js";

const json = async (res: Response) => (await res.json()) as any;

async function adminToken(client: Awaited<ReturnType<typeof freshDatabase>>) {
  await client.execute("INSERT INTO users (id, phone, name, password_hash, role, status, admin_role) VALUES ('adm_f', '+256700000888', 'Staff', 'hash', 'admin', 'active', 'super_admin')");
  return signToken({ sub: "adm_f", role: "admin" });
}
const authed = (token: string) => (path: string, method = "GET", body?: object) =>
  app.request(`/v1${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });

test("validation helpers", () => {
  assert.equal(normalizePhone("0701 556 778"), "+256701556778");
  assert.equal(normalizePhone("+256 701 556 778"), "+256701556778");
  assert.equal(normalizePhone("abc"), null);
  assert.ok(isRealDate("2030-02-28"));
  assert.ok(!isRealDate("2030-02-31"));
  assert.ok(!isRealDate("2030-13-01"));
  assert.equal(eatInstant("2030-01-01", "03:00"), Date.UTC(2030, 0, 1, 0, 0), "03:00 in Kampala is 00:00 UTC");
  assert.equal(eatInstant("2030-02-31", "10:00"), null);
  assert.ok(isHttpsUrl("https://meet.example.com/x"));
  assert.ok(!isHttpsUrl("javascript:alert(1)"));
  assert.ok(!isHttpsUrl("http://example.com"));
  assert.ok(!isHttpsUrl("https://user:pw@example.com"));
});

test("every option has a valid default, a recommended choice, and an honest availability", () => {
  const schema = { hasTable: () => false, hasColumn: () => false };
  for (const def of OPTION_SETTINGS) {
    if (def.kind === "enum") {
      assert.ok(def.options.some((o) => o.value === def.default), `${def.key}: default is one of the options`);
      assert.ok(def.options.some((o) => o.recommended), `${def.key}: one option is marked recommended`);
      const working = def.options.filter((o) => o.built && !o.requires);
      const effective = resolveEffective(def, def.default, schema);
      if (working.length > 0) {
        assert.ok(working.some((o) => o.value === effective), `${def.key}: effective value is one that works`);
      } else {
        // A feature that has not shipped at all: nothing can be selected, and the default is simply reported.
        assert.equal(effective, def.default, `${def.key}: unshipped feature reports its default`);
        assert.ok(def.options.every((o) => !validateValue(def, o.value, schema).ok), `${def.key}: nothing selectable yet`);
      }
    }
    if (def.kind === "multi") {
      for (const v of def.default) assert.ok(def.options.some((o) => o.value === v), `${def.key}: default ${v} exists`);
      // A list that may be empty (min 0) stays empty until the migration its choices need is applied.
      if (def.min !== 0) assert.ok((resolveEffective(def, def.default, schema) as string[]).length >= 1, `${def.key}: something stays enabled`);
    }
    assert.ok(validateValue(def, def.default, schema).ok || def.kind === "enum" || def.kind === "multi", `${def.key}: default validates`);
  }
});

test("admin option settings: validated, availability-aware, access-controlled and logged", async () => {
  const client = await freshDatabase();
  const admin = authed(await adminToken(client));
  const customer = authed(await addUser(client, "u_not_admin"));

  assert.equal((await customer("/admin/option-settings")).status, 403);
  assert.equal((await anonymous("/admin/option-settings")).status, 401);

  const all = await json(await admin("/admin/option-settings?module=storefront"));
  const mode = all.settings.find((s: any) => s.key === "storefront_checkout_mode");
  assert.equal(mode.default, "handoff_to_app");
  assert.equal(mode.effective, "handoff_to_app");
  assert.ok(mode.options.find((o: any) => o.value === "handoff_to_app").recommended);
  assert.equal(mode.options.find((o: any) => o.value === "inline_web_checkout").available, false, "an option that is not built cannot be chosen");

  const refused = await admin("/admin/option-settings", "PATCH", { values: { storefront_checkout_mode: "inline_web_checkout" } });
  assert.equal(refused.status, 400);
  assert.match((await json(refused)).errors.storefront_checkout_mode, /not available yet/);

  const mixed = await admin("/admin/option-settings", "PATCH", { values: { rate_limit_public_booking_per_hour: 3, lms_pass_mark_percent: 500 } });
  assert.equal(mixed.status, 400, "all or nothing: one bad value rejects the batch");
  assert.equal(await getOption("rate_limit_public_booking_per_hour"), 10, "nothing was stored");

  const bad = await admin("/admin/option-settings", "PATCH", { values: { storefront_reserved_subdomains: ["fine", "Not Valid!"], member_roles_manage_catalog: [] } });
  const errors = (await json(bad)).errors;
  assert.ok(errors.storefront_reserved_subdomains && errors.member_roles_manage_catalog);
  assert.equal((await admin("/admin/option-settings", "PATCH", { values: { nonsense: 1 } })).status, 400);

  const ok = await admin("/admin/option-settings", "PATCH", { values: { rate_limit_public_booking_per_hour: 3, services_booking_confirmation: "auto_confirm", storefront_reserved_subdomains: ["Billing", "pay"] } });
  assert.equal(ok.status, 200);
  assert.equal(await getOption("rate_limit_public_booking_per_hour"), 3);
  assert.equal(await getOption("services_booking_confirmation"), "auto_confirm");
  assert.deepEqual(await getOption("storefront_reserved_subdomains"), ["billing", "pay"], "list entries are normalised");
  const logged = await client.execute("SELECT summary, before_json, after_json FROM admin_activity_log WHERE entity_type = 'option_settings'");
  assert.equal(logged.rows.length, 1, "one activity entry for the batch");
  assert.match(String(logged.rows[0].after_json), /rate_limit_public_booking_per_hour/);

  assert.equal((await json(await admin("/admin/option-settings", "PATCH", { values: { rate_limit_public_booking_per_hour: 3 } }))).changed.length, 0, "no change, nothing logged");
});

test("merchant team roles follow the admin policy", async () => {
  const client = await freshDatabase();
  const owner = await addMerchantStore(client, "u_role_owner");
  assert.equal((await owner.call("/merchants/me/store/tier", "POST", {tier: "elite"})).status, 200);
  const cashierToken = await addUser(client, "u_role_cashier");
  await client.execute({ sql: "INSERT INTO merchant_members (merchant_id, user_id, role, status) VALUES (?, 'u_role_cashier', 'cashier', 'active')", args: [owner.merchantId] });
  const cashier = authed(cashierToken);
  const admin = authed(await adminToken(client));
  const product = { title: "Mug", price: 5000, inventory_quantity: 5 };

  const blocked = await cashier("/merchants/me/products", "POST", product);
  assert.equal(blocked.status, 403);
  assert.equal((await json(blocked)).error, "insufficient_role");
  assert.equal((await cashier("/merchants/me/store", "PUT", { name: "Hacked name" })).status, 403);
  assert.equal((await cashier("/merchants/me/store/tier", "POST", { tier: "elite" })).status, 403);
  assert.equal((await cashier("/merchants/me/digital-products", "POST", { title: "Guide", price_ugx: 100 })).status, 403);
  assert.equal((await cashier("/merchants/me/store")).status, 200, "reads stay open to the team");
  assert.notEqual((await owner.call("/merchants/me/products", "POST", product)).status, 403, "owners can");

  await admin("/admin/option-settings", "PATCH", { values: { member_roles_manage_catalog: ["owner", "manager", "cashier"] } });
  assert.notEqual((await cashier("/merchants/me/products", "POST", product)).status, 403, "admin widened the policy");
  assert.equal((await cashier("/merchants/me/store", "PUT", { name: "Still no" })).status, 403, "other permissions unchanged");
});

test("public writes are rate limited by admin-set ceilings", async () => {
  const client = await freshDatabase();
  const owner = await addUser(client, "u_rl_owner");
  const admin = authed(await adminToken(client));
  const o = authed(owner);
  const biz = (await json(await o("/services-platform/my-business", "POST", { name: "Rate Limited Advisory", category: "consultation", phone: "+256700123456" }))).business;
  await client.execute("UPDATE service_businesses SET status = 'active'");
  const offering = (await json(await o("/services-platform/offerings", "POST", { title: "Call", price_ugx: 1000 }))).offering;
  await admin("/admin/option-settings", "PATCH", { values: { rate_limit_public_booking_per_hour: 2 } });
  const book = (phone: string) => anonymous(`/services-platform/public/${biz.slug}/book`, "POST", {
    service_id: offering.id, customer_name: "Caller", customer_phone: phone, scheduled_date: "2031-05-05", scheduled_time: "10:00", payment_rail: "cash_at_venue",
  });
  assert.equal((await book("+256700000011")).status, 200);
  assert.equal((await book("+256700000012")).status, 200);
  const limited = await book("+256700000013");
  assert.equal(limited.status, 429, "the third request from one address in an hour is refused");
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
});

test("service rules: dates, notice period, virtual switch, approval and confirmation options", async () => {
  const client = await freshDatabase();
  const owner = await addUser(client, "u_rules_owner");
  const admin = authed(await adminToken(client));
  const o = authed(owner);
  const profile = { name: "Rules Advisory", category: "consultation", phone: "0700123456" };

  const pending = await json(await o("/services-platform/my-business", "POST", profile));
  assert.equal(pending.business.status, "pending_review");
  assert.equal(pending.business.phone, "+256700123456", "phones are normalised");
  assert.equal((await o("/services-platform/my-business", "PUT", { logo_url: "javascript:alert(1)" })).status, 400, "only https images");
  await client.execute("DELETE FROM service_businesses");

  await admin("/admin/option-settings", "PATCH", { values: { services_business_approval: "auto_approve_all", services_booking_confirmation: "auto_confirm" } });
  const live = await json(await o("/services-platform/my-business", "POST", profile));
  assert.equal(live.business.status, "active");

  const virtual = (await json(await o("/services-platform/offerings", "POST", { title: "Video call", price_ugx: 5000, location_type: "virtual", virtual_meeting_url: "https://meet.example.com/abc" }))).offering;
  assert.equal((await o("/services-platform/offerings", "POST", { title: "Bad link", location_type: "virtual", virtual_meeting_url: "http://insecure.example" })).status, 400);
  const book = (over: object) => anonymous(`/services-platform/public/${live.business.slug}/book`, "POST", {
    service_id: virtual.id, customer_name: "Dan", customer_phone: "+256700000021", scheduled_date: "2031-05-05", scheduled_time: "10:00", payment_rail: "cash_at_venue", location_type: "virtual", ...over,
  });

  assert.equal((await book({ scheduled_date: "2031-02-31" })).status, 400, "not a real date");
  const soon = await book({ scheduled_date: new Date().toISOString().slice(0, 10), scheduled_time: "00:00" });
  assert.equal(soon.status, 400);
  assert.equal((await json(soon)).error, "too_soon", "inside the notice period");
  const ok = await json(await book({}));
  assert.equal(ok.booking.status, "confirmed", "auto-confirm option");

  await client.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('services_platform_virtual_enabled', '0')");
  const { invalidateSettingsCache } = await import("../lib/settings.js");
  invalidateSettingsCache();
  assert.equal((await book({ customer_phone: "+256700000022" })).status, 403, "virtual consultations switched off by admin");
  assert.equal((await o("/services-platform/offerings", "POST", { title: "Another video", location_type: "virtual" })).status, 403);

  await client.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('services_platform_max_services', '1')");
  invalidateSettingsCache();
  assert.equal((await o("/services-platform/offerings", "POST", { title: "Over the limit" })).status, 403, "per-business service cap");
});

test("the demo catalogue is not shown on a live platform, and writes to missing tables say so", async () => {
  const client = await freshDatabase();
  const admin = authed(await adminToken(client));
  const stores = await json(await anonymous("/marketplace/stores"));
  assert.deepEqual(stores.stores, [], "no demo stores for live shoppers");
  assert.equal((await anonymous("/marketplace/stores/store_demo_fresh_mart")).status, 404);
  assert.equal((await anonymous("/marketplace/products/prod_milk_1l")).status, 404);
  assert.deepEqual((await json(await anonymous("/marketplace/spotlight"))).spotlight, []);

  await admin("/admin/option-settings", "PATCH", { values: { marketplace_demo_catalog: "always" } });
  assert.ok((await json(await anonymous("/marketplace/stores"))).stores.length > 0, "admin can allow it");
  assert.equal((await anonymous("/marketplace/stores/store_demo_fresh_mart")).status, 200);

  const seller = await addMerchantStore(client, "u_mig_seller");
  assert.equal((await seller.call("/merchants/me/store/tier", "POST", {tier: "elite"})).status, 200);
  await client.execute("DROP TABLE store_digital_fulfillments");
  await client.execute("DROP TABLE store_digital_products");
  const { resetSchemaCache } = await import("../lib/schema.js");
  resetSchemaCache();
  const res = await seller.call("/merchants/me/digital-products", "POST", { title: "Guide", price_ugx: 100 });
  assert.equal(res.status, 503, "not a silent ok:true");
  assert.equal((await json(res)).error, "migration_pending");
});

test("digital product input is validated and uses the admin defaults", async () => {
  const client = await freshDatabase();
  const admin = authed(await adminToken(client));
  const seller = await addMerchantStore(client, "u_dig_valid");
  assert.equal((await seller.call("/merchants/me/store/tier", "POST", {tier: "elite"})).status, 200);
  const post = (body: object) => seller.call("/merchants/me/digital-products", "POST", body);
  assert.equal((await post({ title: "x" })).status, 400, "title too short");
  assert.equal((await post({ title: "Guide", price_ugx: -5 })).status, 400);
  assert.equal((await post({ title: "Guide", kind: "weapon" })).status, 400);
  assert.equal((await post({ title: "Guide", file_url: "javascript:alert(1)" })).status, 400);
  assert.equal((await post({ title: "Guide", max_downloads: 100000 })).status, 400);

  await admin("/admin/option-settings", "PATCH", { values: { digital_default_max_downloads: 7, digital_default_expiry_days: 90, digital_max_products: 2 } });
  const first = await json(await post({ title: "Guide One", price_ugx: 1000, license_keys_pool: ["A", "A", " B "] }));
  assert.equal(first.product.max_downloads, 7);
  assert.equal(first.product.expiry_days, 90);
  assert.deepEqual(first.product.license_keys_pool, ["A", "B"], "keys are trimmed and unique");
  assert.equal((await post({ title: "Guide Two", price_ugx: 1000, max_downloads: 0 })).status, 200);
  const third = await post({ title: "Guide Three" });
  assert.equal(third.status, 403);
  assert.equal((await json(third)).error, "product_limit");
});
