import test from "node:test";
import assert from "node:assert/strict";
import {freshDatabase,addMerchantStore,addAdmin,addUser,app} from "../test-support/db.js";
import {resetSchemaCache} from "../lib/schema.js";
import {invalidateSettingsCache} from "../lib/settings.js";
const json=async(r:Response)=>await r.json() as any;
const query="?from=2026-01-01T00:00:00Z&until=2027-01-01T00:00:00Z";
const entry={requestId:"c8f541f1-738f-4ebc-a61a-993a09e414ca",category:"operating_expense",amountUgx:5000,occurredAt:"2026-11-02T09:00:00Z",description:"Shop rent",reference:"receipt-1"};
async function setup(){const db=await freshDatabase();const merchant=await addMerchantStore(db,"finance-owner");return{db,merchant};}

test("expense retries are idempotent, preserve original records and never move wallet funds",async()=>{
  const {db,merchant}=await setup();
  const before=(await db.execute("SELECT wallet_balance FROM users WHERE id='finance-owner'")).rows[0].wallet_balance;
  const responses=await Promise.all([1,2].map(()=>merchant.call("/merchants/me/financial-entries","POST",entry)));
  assert.deepEqual(responses.map(r=>r.status),[201,201]);
  const result=await json(responses[0]);assert.equal(result.moneyMovement,false);
  assert.equal((await merchant.call("/merchants/me/financial-entries","POST",{...entry,amountUgx:6000})).status,409);
  const report=await json(await merchant.call(`/merchants/me/financial-report${query}`));
  assert.equal(report.entries.length,1);assert.equal(report.summary.expenses[0].amount,5000);
  assert.equal((await merchant.call(`/merchants/me/financial-entries/${result.entry.id}/void`,"POST",{reason:"Wrong receipt was entered."})).status,200);
  assert.equal((await merchant.call(`/merchants/me/financial-entries/${result.entry.id}/void`,"POST",{reason:"Retried original void action."})).status,200);
  const after=await json(await merchant.call(`/merchants/me/financial-report${query}`));
  assert.equal(after.summary.expenses.length,0);assert.ok(after.entries[0].voided_at);assert.equal(after.entries[0].amount_ugx,5000);
  assert.equal((await db.execute("SELECT wallet_balance FROM users WHERE id='finance-owner'")).rows[0].wallet_balance,before);
});

test("financial permissions and outlet scope follow the selected business and admin settings",async()=>{
  const {db,merchant}=await setup();const other=await addMerchantStore(db,"finance-other");
  await db.execute({sql:"INSERT INTO merchant_members(merchant_id,user_id,role,status) VALUES (?,'finance-owner','cashier','active')",args:[other.merchantId]});
  const headers={Authorization:`Bearer ${merchant.token}`,"X-Merchant-Id":other.merchantId};
  assert.equal((await app.request(`/v1/merchants/me/financial-report${query}`,{headers})).status,403);
  assert.equal((await merchant.call(`/merchants/me/financial-report${query}&outletId=another-merchant-outlet`)).status,404);
  const manager=await addUser(db,"finance-manager");await db.execute({sql:"INSERT INTO merchant_members(merchant_id,user_id,role,status) VALUES (?,'finance-manager','manager','active')",args:[merchant.merchantId]});
  const call=()=>app.request(`/v1/merchants/me/financial-report${query}`,{headers:{Authorization:`Bearer ${manager}`}});
  assert.equal((await call()).status,403);
  const admin=await addAdmin(db);await admin.setOptions({member_roles_view_financial_reports:["owner","finance","manager"]});
  assert.equal((await call()).status,200);
  await admin.setOptions({merchant_financial_reports_enabled:false});assert.equal((await call()).status,403);
});

test("POS snapshots survive catalog changes, retain retry semantics and separate unknown legacy environments",async()=>{
  const {db,merchant}=await setup();await merchant.call("/merchants/me/store/tier","POST",{tier:"elite"});
  await db.execute({sql:"INSERT INTO store_products(id,store_id,title,price,cost_price,inventory_quantity) VALUES ('cost-product',?,'Coffee',1000,400,10)",args:[merchant.storeId]});
  const sale={requestId:"e1415fba-150a-401f-b8ec-5679d8964ac6",items:[{productId:"cost-product",title:"Coffee",unitPrice:1000,quantity:2}],payment_method:"cash"};
  assert.equal((await merchant.call("/merchants/me/pos-sales","POST",sale)).status,201);
  await db.execute("UPDATE store_products SET cost_price=900 WHERE id='cost-product'");
  assert.equal((await merchant.call("/merchants/me/pos-sales","POST",sale)).status,200);
  await db.execute({sql:"INSERT INTO store_pos_sales(id,store_id,items_json,total_amount,receipt_code) VALUES ('legacy-pos',?,'[]',777,'LEGACY')",args:[merchant.storeId]});
  const report=await json(await merchant.call(`/merchants/me/financial-report${query}`));
  assert.equal(report.pos.length,1);assert.equal(report.pos[0].costUgx,800);assert.equal(report.summary.pos.recordedTotal,2000);
  assert.equal(report.summary.unassignedHistoricalPos.total,777);assert.equal(report.accounting.combinedProfitUgx,null);
  await db.execute("INSERT OR REPLACE INTO settings(key,value) VALUES ('platform_environment','sandbox')");invalidateSettingsCache();
  const sandbox=await json(await merchant.call(`/merchants/me/financial-report${query}`));assert.equal(sandbox.pos.length,0);
});

test("journal date filters exclude other periods and missing migrations preserve the old POS path",async()=>{
  const {db,merchant}=await setup();await merchant.call("/merchants/me/financial-entries","POST",entry);
  const report=await json(await merchant.call("/merchants/me/financial-report?from=2026-01-01T00:00:00Z&until=2026-02-01T00:00:00Z"));assert.equal(report.entries.length,0);
  await db.execute("DROP TABLE store_financial_entries");
  await db.execute("ALTER TABLE store_pos_sales DROP COLUMN environment");await db.execute("ALTER TABLE store_pos_sales DROP COLUMN cost_snapshot_json");resetSchemaCache();
  const fallback=await merchant.call(`/merchants/me/financial-report${query}`);assert.equal(fallback.status,200);assert.equal((await json(fallback)).availability.expenseJournal,false);
  assert.equal((await merchant.call("/merchants/me/financial-entries","POST",entry)).status,503);
  await merchant.call("/merchants/me/store/tier","POST",{tier:"elite"});
  await db.execute({sql:"INSERT INTO store_products(id,store_id,title,price,inventory_quantity) VALUES ('old-path',?,'Old schema',1000,2)",args:[merchant.storeId]});
  assert.equal((await merchant.call("/merchants/me/pos-sales","POST",{items:[{productId:"old-path",title:"Old schema",unitPrice:1000,quantity:1}],payment_method:"cash"})).status,201);
});

test("digital statements separate the buyer amount, actual commission and merchant payout, including refund reversals",async()=>{
  const {db,merchant}=await setup();await merchant.call("/merchants/me/store/tier","POST",{tier:"elite"});
  const buyer=await addUser(db,"statement-buyer");await db.execute("UPDATE users SET wallet_balance=1000 WHERE id='statement-buyer'");
  const product=(await json(await merchant.call("/merchants/me/digital-products","POST",{title:"Digital statement test",kind:"download",price_ugx:1000,file_url:"https://files.example.test/statement.pdf"}))).product;
  const purchase=await json(await app.request(`/v1/marketplace/digital/${product.id}/buy`,{method:"POST",headers:{Authorization:`Bearer ${buyer}`}}));
  assert.ok(purchase.fulfillmentId);
  const report=await json(await merchant.call(`/merchants/me/financial-report${query}`));
  const sale=report.ledger.find((row:any)=>row.kind==="digital_sale");
  assert.equal(sale.buyer_amount_ugx,1000);assert.equal(sale.platform_fee_ugx,50);assert.equal(sale.amount,950);
  assert.equal((await merchant.call(`/merchants/me/digital-fulfillments/${purchase.fulfillmentId}/refund`,"POST",{})).status,200);
  const reversed=await json(await merchant.call(`/merchants/me/financial-report${query}`));
  const refund=reversed.ledger.find((row:any)=>row.kind==="digital_refund");
  assert.equal(refund.buyer_amount_ugx,-1000);assert.equal(refund.platform_fee_ugx,-50);assert.equal(refund.amount,-950);
});
