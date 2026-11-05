import assert from "node:assert/strict";
import test from "node:test";
import { addAdmin, addMerchantStore, addUser, app, freshDatabase } from "../test-support/db.js";
import { getPlatformEnvironment, invalidateSettingsCache } from "../lib/settings.js";
import { signToken } from "../auth/jwt.js";
import { postLedgerTransaction } from "../ledger/service.js";
import { finalizeMerchantPayment } from "./service.js";

const json = async (response: Response) => await response.json() as any;
type Db = Awaited<ReturnType<typeof freshDatabase>>;
type World = "live" | "sandbox";

async function setup() {
  const db = await freshDatabase();
  invalidateSettingsCache();
  const merchant = await addMerchantStore(db, "world-owner");
  const admin = await addAdmin(db);
  const switchTo = async (environment: World) => {
    const result = await admin.call("/admin/platform-environment", "PUT", { environment });
    assert.equal(result.status, 200, JSON.stringify(await result.clone().json()));
  };
  return { db, merchant, admin, switchTo };
}

async function enableLivePayments(db: Db) {
  await db.execute("INSERT OR REPLACE INTO settings(key,value) VALUES ('merchant_payments_enabled','1'),('merchant_live_custody_approved','1')");
  await db.execute(`INSERT INTO merchant_custody_approvals
    (id,custody_provider,payout_provider,environment,safeguarding_reference,approved_by,effective_at,status)
    VALUES ('custody','test','test','live','test','adm_test',datetime('now','-1 day'),'active')`);
  invalidateSettingsCache();
}

async function paymentFixture(db: Db, merchantId: string, environment: World) {
  const suffix = environment;
  await addUser(db, `customer-${suffix}`);
  await addUser(db, `rider-${suffix}`, "rider");
  await db.execute({ sql: "INSERT INTO merchant_outlets(id,merchant_id,category_id,name,code) VALUES (?,?, 'mcat_retail','Main',?)", args: [`out-${suffix}`, merchantId, `OUT-${suffix}`] });
  await db.execute(`INSERT INTO lists(id,customer_id,title,status,environment) VALUES ('list-${suffix}','customer-${suffix}','Shop','active','${environment}')`);
  await db.execute(`INSERT INTO orders(id,list_id,customer_id,rider_id,stage,payment_rail,estimated_total,final_total,delivery_fee,environment,funds_model)
    VALUES ('order-${suffix}','list-${suffix}','customer-${suffix}','rider-${suffix}','Shop','escrow',1000,1000,0,'${environment}','merchant_allocations_v1')`);
  await db.execute(`INSERT INTO payments(id,order_id,type,provider,provider_ref,amount,status)
    VALUES ('payment-${suffix}','order-${suffix}','collection','yo_mock','ref-${suffix}',1000,'successful')`);
  await db.execute({ sql: `INSERT INTO merchant_payments(id,order_id,merchant_id,outlet_id,amount,confirmation_mode,rider_id,initiated_by,
    rider_confirmed_at,merchant_confirmed_at,risk_state,policy_version,idempotency_key,environment)
    VALUES (? ,?, ?, ?, 1000,'dual_confirm',?,?,datetime('now'),datetime('now'),'passed',1,?,?)`,
  args: [`mp-${suffix}`, `order-${suffix}`, merchantId, `out-${suffix}`, `rider-${suffix}`, `rider-${suffix}`, `buy-${suffix}`, environment] });
}

test("legacy businesses and new registrations follow the admin environment in both signup paths", async () => {
  const { db, merchant, switchTo } = await setup();
  assert.equal((await json(await merchant.call("/merchants/me"))).merchants[0].environment, "live");
  assert.equal((await db.execute("SELECT environment FROM merchants WHERE id='m_world-owner'")).rows[0].environment, "sandbox", "registration history is not rewritten");
  for (const environment of ["live", "sandbox"] as const) {
    await switchTo(environment);
    for (const route of ["/merchants/apply", "/merchant-portal/apply"]) {
      const token = await addUser(db, `signup-${environment}-${route.includes("portal") ? "portal" : "app"}`);
      const response = await app.request(`/v1${route}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({
        legalName: "Real Store Ltd", displayName: "Real Store", categoryId: "mcat_retail", outletName: "Main", lat: 0.3, lng: 32.5,
        ...(route.includes("portal") ? { features: { appListing: false, webStore: false } } : {}),
      }) });
      assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
      const me = await json(await app.request("/v1/merchants/me", { headers: { Authorization: `Bearer ${token}` } }));
      assert.equal(me.merchants[0].environment, environment);
      assert.equal((await db.execute({ sql: "SELECT environment FROM merchants WHERE id=?", args: [me.merchants[0].id] })).rows[0].environment, environment);
    }
  }
  await switchTo("live");
  const response = await merchant.call("/merchants/me");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal((await json(response)).merchants[0].environment, "live");
});

test("balances, statements and admin views select one world without migrating test money", async () => {
  const { db, merchant, admin, switchTo } = await setup();
  for (const environment of ["live", "sandbox"] as const) {
    const amount = environment === "live" ? 1200 : 9000;
    await db.execute({ sql: "INSERT INTO merchant_balances(merchant_id,environment,available) VALUES (?,?,?)", args: [merchant.merchantId, environment, amount] });
    await postLedgerTransaction({ kind: "world-test", idempotencyKey: `seed-${environment}`, environment, postings: [
      { ownerType: "merchant", ownerId: merchant.merchantId, purpose: "payable_available", environment, amount },
      { ownerType: "platform", ownerId: "peebee", purpose: "test", environment, amount: -amount },
    ] });
    await paymentFixture(db, merchant.merchantId, environment);
    await db.execute({ sql: "INSERT INTO merchant_disputes(id,order_id,merchant_payment_id,opened_by,amount,reason) VALUES (?,?,?,'world-owner',1000,'Review this payment')", args: [`dispute-${environment}`, `order-${environment}`, `mp-${environment}`] });
  }
  for (const environment of ["live", "sandbox"] as const) {
    await switchTo(environment);
    const expected = environment === "live" ? 1200 : 9000;
    const balance = await json(await merchant.call(`/merchants/${merchant.merchantId}/balance`));
    assert.equal(balance.environment, environment); assert.equal(balance.balance.available, expected);
    const transactions = (await json(await merchant.call(`/merchants/${merchant.merchantId}/transactions`))).transactions;
    assert.equal(transactions.length, 1); assert.equal(transactions[0].amount, expected); assert.equal(transactions[0].environment, environment);
    assert.deepEqual((await json(await merchant.call(`/merchants/${merchant.merchantId}/payments`))).payments.map((p: any) => p.id), [`mp-${environment}`]);
    assert.deepEqual((await json(await merchant.call(`/merchants/${merchant.merchantId}/disputes`))).disputes.map((d: any) => d.id), [`dispute-${environment}`]);
    const detail = await json(await admin.call(`/admin/merchants/${merchant.merchantId}`));
    assert.equal(detail.merchant.environment, environment); assert.equal(detail.merchant.available, expected);
    assert.equal(detail.payments.length, 1); assert.equal(detail.transactions.length, 1);
    const listing = (await json(await admin.call("/admin/merchants"))).merchants.find((m: any) => m.id === merchant.merchantId);
    assert.equal(listing.environment, environment); assert.equal(listing.available, expected);
  }
  const before = await db.execute("SELECT environment, available FROM merchant_balances ORDER BY environment");
  await switchTo("live");
  assert.deepEqual((await db.execute("SELECT environment, available FROM merchant_balances ORDER BY environment")).rows, before.rows);
  const sandbox = await json(await admin.call(`/admin/merchants/${merchant.merchantId}?environment=sandbox`));
  assert.equal(sandbox.merchant.available, 9000, "admin can explicitly inspect sandbox history while live");
});

test("practice requests stay sandboxed without switching a real merchant's environment", async () => {
  const { merchant } = await setup();
  const practiceToken = await signToken({ sub: "world-owner", role: "customer", practice: true });
  const response = await app.request("/v1/merchants/me", { headers: { Authorization: `Bearer ${practiceToken}` } });
  assert.equal(response.status, 200);
  assert.equal((await json(response)).merchants[0].environment, "sandbox");
  assert.equal((await json(await merchant.call("/merchants/me"))).merchants[0].environment, "live");
  assert.equal(await getPlatformEnvironment(), "live");
});

test("the first live receipt creates a separate balance atomically and cannot credit twice", async () => {
  const { db, merchant, switchTo } = await setup();
  await db.execute({ sql: "INSERT INTO merchant_balances(merchant_id,environment,available) VALUES (?,'sandbox',9000)", args: [merchant.merchantId] });
  await paymentFixture(db, merchant.merchantId, "live");
  await db.execute("CREATE TRIGGER fail_live_balance BEFORE INSERT ON merchant_balances WHEN NEW.environment='live' BEGIN SELECT RAISE(ABORT,'injected balance failure'); END");
  await assert.rejects(() => finalizeMerchantPayment("mp-live", "world-owner"));
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM ledger_transactions WHERE kind='merchant_purchase'")).rows[0].n, 0);
  assert.equal((await db.execute("SELECT principal_allocated FROM order_budgets WHERE order_id='order-live'")).rows[0].principal_allocated, 0);
  await db.execute("DROP TRIGGER fail_live_balance");
  await finalizeMerchantPayment("mp-live", "world-owner");
  await finalizeMerchantPayment("mp-live", "world-owner");
  const rows = (await db.execute("SELECT environment,available FROM merchant_balances ORDER BY environment")).rows;
  assert.deepEqual(rows.map(r => [r.environment,r.available]), [["live",1000],["sandbox",9000]]);
  await switchTo("sandbox");
  assert.equal((await json(await merchant.call(`/merchants/${merchant.merchantId}/balance`))).balance.available, 9000);
});

test("sandbox quotes cannot authorize live withdrawals and live destinations retain their cooling period", async () => {
  const { db, merchant, admin, switchTo } = await setup();
  await enableLivePayments(db);
  await db.execute({ sql: `INSERT INTO merchant_settlement_accounts(id,merchant_id,type,provider,account_ref,account_ref_last4,status,cooling_until)
    VALUES ('destination',?,'momo','yo','test','0000','verified',datetime('now','-1 hour'))`, args: [merchant.merchantId] });
  await switchTo("sandbox");
  const quoteResponse = await merchant.call(`/merchants/${merchant.merchantId}/settlement-quotes`, "POST", { settlementAccountId: "destination", amount: 1000, mode: "instant" });
  assert.equal(quoteResponse.status, 201, JSON.stringify(await quoteResponse.clone().json()));
  const quote = (await json(quoteResponse)).quote;
  await switchTo("live");
  const refused = await app.request(`/v1/merchants/${merchant.merchantId}/settlements`, { method: "POST", headers: { Authorization: `Bearer ${merchant.token}`, "Content-Type": "application/json", "Idempotency-Key": "attempt-live" }, body: JSON.stringify({ quoteId: quote.id }) });
  assert.equal(refused.status, 409); assert.equal((await json(refused)).error, "quote_expired_or_used");
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM merchant_settlements")).rows[0].n, 0);
  const liveQuote = () => merchant.call(`/merchants/${merchant.merchantId}/settlement-quotes`, "POST", { settlementAccountId: "destination", amount: 1000, mode: "instant" });
  assert.equal((await liveQuote()).status, 409, "sandbox's zero-hour wait is not valid for a new live destination");
  await admin.setOptions({ merchant_settlement_cooling_hours: 0 });
  const accepted = await liveQuote(); assert.equal(accepted.status, 201);
  const live = (await json(accepted)).quote;
  assert.equal((await db.execute({ sql: "SELECT environment FROM merchant_settlement_quotes WHERE id=?", args: [live.id] })).rows[0].environment, "live");
});
