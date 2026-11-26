import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import app from "../app.js";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { resetSchemaCache } from "../lib/schema.js";
import { splitHeld } from "./service.js";
import { resetWorkSchemaCache } from "./service.js";
import { sweepWork } from "./scheduled.js";
import { setWorkSettings } from "./settings.js";
import { dwellAt, purgeTrails } from "./onsite.js";
import { getWorkSettings } from "./settings.js";

process.env.JWT_SECRET = "work-test-only-secret";

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

type Json = Record<string, any>;
const KAMPALA = { lat: 0.3136, lng: 32.5811 };
const HOUSE = "wsv_clean_house_standard"; // fixed, UGX 35,000 per bedroom
const WINDOW = "wsv_clean_item_window"; // quote, call-out UGX 10,000

async function setup() {
  resetSchemaCache();
  resetWorkSchemaCache();
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  await setWorkSettings({
    enabled: true, serviceTypes: ["clean"], pricingModes: ["fixed", "quote"], matchingModes: ["broadcast", "customer_picks", "admin_assigns"], defaultMatching: "broadcast",
    providerKinds: ["individual", "company"], commissionPercent: 15, requireApproval: true, offerWindowMinutes: 60, radiusKm: 15, maxNotified: 20, minLeadMinutes: 30,
    maxAdvanceDays: 30, quoteValidHours: 24, maxQuoteUgx: 5_000_000, freeCancelMinutes: 10, lateCancelFeePercent: 20, autoConfirmHours: 24, disputeWindowHours: 48, jobsPerHour: 100,
  });

  let n = 0;
  const mkUser = async (id: string, opts: { role?: "customer" | "admin"; wallet?: number } = {}) => {
    n += 1;
    await client.execute({
      sql: "INSERT INTO users (id, phone, name, role, password_hash, wallet_balance, admin_role) VALUES (?, ?, ?, ?, 'x', ?, ?)",
      args: [id, `+25670000${String(n).padStart(4, "0")}`, `User ${id}`, opts.role ?? "customer", opts.wallet ?? 0, opts.role === "admin" ? "super_admin" : null],
    });
    return signToken({ sub: id, role: opts.role ?? "customer" });
  };
  const wallet = async (id: string) => Number((await client.execute({ sql: "SELECT wallet_balance AS b FROM users WHERE id = ?", args: [id] })).rows[0].b);
  const earnings = async (id: string) => Number((await client.execute({ sql: "SELECT COALESCE(SUM(w.balance),0) AS b FROM provider_wallets w JOIN work_providers p ON p.id=w.provider_id WHERE w.provider_type='work' AND w.environment='live' AND p.user_id=?", args: [id] })).rows[0].b);
  const call = async (path: string, opts: { method?: string; token?: string; body?: unknown } = {}) => {
    const res = await app.request(`/v1/work${path}`, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: { "Content-Type": "application/json", ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
  };

  const admin = await mkUser("admin_w", { role: "admin" });
  /** A registered, approved, online provider near the job. */
  const mkProvider = async (id: string, services: string[] = [HOUSE, WINDOW], kind: "individual" | "company" = "individual", approve = true) => {
    const token = await mkUser(id);
    const reg = await call("/provider/register", { token, body: { kind, displayName: `Provider ${id}`, ...(kind === "company" ? { companyName: `${id} Cleaners Ltd` } : {}), serviceIds: services } });
    assert.equal(reg.status, 201, JSON.stringify(reg.json));
    if (approve) {
      await call(`/admin/providers/${reg.json.provider.id}/approve`, { token: admin, body: {} });
      await call("/provider/me", { method: "PUT", token, body: { online: true, ...KAMPALA } });
    }
    return { token, providerId: reg.json.provider.id as string };
  };
  const book = (token: string, extra: Json = {}) =>
    call("/jobs", { token, body: { serviceId: HOUSE, quantity: 2, address: "Plot 5 Kololo", area: "Kololo", ...KAMPALA, details: "Two bedroom flat", ...extra } });
  const dbJob = async (id: string) => (await client.execute({ sql: "SELECT * FROM work_jobs WHERE id = ?", args: [id] })).rows[0] as Json;
  return { client, call, mkUser, mkProvider, wallet, earnings, admin, book, dbJob };
}

test("work: split of held money always adds up", () => {
  for (const [held, pct, refund] of [[70000, 15, 0], [70000, 15, 70000], [70000, 15, 35000], [33333, 12.5, 11111], [1, 60, 0], [10000, 0, 2500]] as const) {
    const s = splitHeld(held, pct, refund);
    assert.equal(s.refund + s.commission + s.payout, held, `${held}/${pct}/${refund}`);
    assert.ok(s.payout >= 0 && s.commission >= 0 && s.refund >= 0);
  }
});

test("work: fixed price + broadcast — pay, accept, do, confirm, rate", async () => {
  const { call, mkUser, mkProvider, wallet, earnings, book, dbJob } = await setup();
  const customer = await mkUser("cust_1", { wallet: 200000 });
  const pro = await mkProvider("pro_1");

  const catalog = await call("/catalog?type=clean", { token: customer });
  assert.ok(catalog.json.services.length >= 10);
  assert.ok(catalog.json.services.every((s: Json) => s.type === "clean"));

  const booked = await book(customer);
  assert.equal(booked.status, 201, JSON.stringify(booked.json));
  const jobId = booked.json.job.id;
  assert.equal(booked.json.job.priceUgx, 70000, "price comes from the catalogue: 2 bedrooms × 35,000");
  assert.equal(booked.json.job.status, "open");
  assert.equal(await wallet("cust_1"), 130000, "the customer's money is held when they book");

  const open = await call("/provider/jobs/open", { token: pro.token });
  assert.equal(open.json.jobs.length, 1);
  assert.equal(open.json.jobs[0].customer, null, "who the customer is stays private until the job is theirs");
  assert.equal((await call(`/provider/jobs/${jobId}/accept`, { token: pro.token, body: {} })).status, 200);
  assert.equal((await dbJob(jobId)).status, "booked");
  const mine = await call("/provider/jobs", { token: pro.token });
  assert.equal(mine.json.jobs[0].customer.name, "User cust_1", "once it is theirs, they can reach the customer");
  assert.equal(mine.json.jobs[0].commissionPercent, 15);
  assert.equal((await call(`/provider/jobs/${jobId}`, { token: pro.token })).json.job.customer.name, "User cust_1");
  const rival = await mkProvider("pro_rival");
  assert.equal((await call(`/provider/jobs/${jobId}`, { token: rival.token })).status, 404, "another provider can't open it");

  assert.equal((await call(`/provider/jobs/${jobId}/complete`, { token: pro.token, body: {} })).status, 409, "can't finish a job that hasn't started");
  assert.equal((await call(`/provider/jobs/${jobId}/start`, { token: pro.token, body: {} })).status, 200);
  assert.equal((await call(`/jobs/${jobId}/confirm`, { token: customer, body: {} })).status, 409, "can't confirm before it is done");
  assert.equal((await call(`/provider/jobs/${jobId}/complete`, { token: pro.token, body: {} })).status, 200);

  // Confirming pays the provider once, even if the button is hammered.
  const confirms = await Promise.all([1, 2, 3, 4].map(() => call(`/jobs/${jobId}/confirm`, { token: customer, body: {} })));
  assert.equal(confirms.filter((r) => r.status === 200).length, 1);
  assert.equal(await earnings("pro_1"), 59500, "70,000 less 15% commission");
  assert.equal(await wallet("cust_1"), 130000);
  const done = await dbJob(jobId);
  assert.equal(done.status, "settled");
  assert.equal(done.commission_ugx, 10500);

  assert.equal((await call(`/jobs/${jobId}/rate`, { token: customer, body: { rating: 5, review: "Spotless" } })).status, 200);
  assert.equal((await call(`/jobs/${jobId}/rate`, { token: customer, body: { rating: 1 } })).status, 409, "one rating per job");
  const me = await call("/provider/me", { token: pro.token });
  assert.equal(me.json.provider.rating, 5);
  assert.equal(me.json.provider.jobsCompleted, 1);
  const earningsSummary = await call("/provider/earnings", { token: pro.token });
  assert.equal(earningsSummary.json.paidUgx, 59500);
});

test("work: quote after inspection — quote, accept, pay the difference, decline, lapse", async () => {
  const { call, mkUser, mkProvider, wallet, earnings, book, dbJob, client } = await setup();
  const customer = await mkUser("cust_q", { wallet: 100000 });
  const pro = await mkProvider("pro_q");

  const booked = await book(customer, { serviceId: WINDOW, quantity: 5 });
  const jobId = booked.json.job.id;
  assert.equal(booked.json.job.quantity, 1, "a quote job is one job");
  assert.equal(booked.json.job.heldUgx, 10000, "only the call-out fee is held at first");
  assert.equal(await wallet("cust_q"), 90000);

  assert.equal((await call(`/provider/jobs/${jobId}/accept`, { token: pro.token, body: {} })).status, 200);
  assert.equal((await dbJob(jobId)).status, "assigned");
  assert.equal((await call(`/provider/jobs/${jobId}/start`, { token: pro.token, body: {} })).status, 409, "no work before a quote is agreed");
  assert.equal((await call(`/provider/jobs/${jobId}/quote`, { token: pro.token, body: { priceUgx: 5000 } })).status, 400, "a quote can't be below the call-out fee");
  assert.equal((await call(`/provider/jobs/${jobId}/quote`, { token: pro.token, body: { priceUgx: 60000 } })).status, 200);
  assert.equal((await call(`/provider/jobs/${jobId}/quote`, { token: pro.token, body: { priceUgx: 50000 } })).status, 200, "a quote can be revised");

  const accept = await Promise.all([1, 2, 3].map(() => call(`/jobs/${jobId}/quote/accept`, { token: customer, body: {} })));
  assert.ok(accept.some((r) => r.status === 200) && accept.every((r) => r.status === 200 || r.status === 409), "repeat taps are harmless");
  assert.equal(await wallet("cust_q"), 50000, "the 40,000 difference was taken exactly once");
  assert.equal((await dbJob(jobId)).status, "booked");
  assert.equal((await dbJob(jobId)).held_ugx, 50000);

  // A second job: the customer declines the quote and the provider keeps the call-out fee (less commission).
  const second = await book(customer, { serviceId: WINDOW });
  await call(`/provider/jobs/${second.json.job.id}/accept`, { token: pro.token, body: {} });
  await call(`/provider/jobs/${second.json.job.id}/quote`, { token: pro.token, body: { priceUgx: 200000 } });
  const before = await earnings("pro_q");
  assert.equal((await call(`/jobs/${second.json.job.id}/quote/decline`, { token: customer, body: {} })).status, 200);
  assert.equal((await earnings("pro_q")) - before, 8500, "10,000 call-out less 15%");

  // A third: insufficient wallet to accept leaves it quoted and charges nothing.
  const third = await book(customer, { serviceId: WINDOW });
  await call(`/provider/jobs/${third.json.job.id}/accept`, { token: pro.token, body: {} });
  await call(`/provider/jobs/${third.json.job.id}/quote`, { token: pro.token, body: { priceUgx: 900000 } });
  const walletBefore = await wallet("cust_q");
  const broke = await call(`/jobs/${third.json.job.id}/quote/accept`, { token: customer, body: {} });
  assert.equal(broke.status, 402);
  assert.equal(await wallet("cust_q"), walletBefore);
  assert.equal((await dbJob(third.json.job.id)).status, "quoted");

  // An old quote can't be accepted; the sweep lets it lapse and pays the call-out fee.
  await client.execute({ sql: "UPDATE work_jobs SET quote_expires_at = datetime('now', '-1 hour') WHERE id = ?", args: [third.json.job.id] });
  assert.equal((await call(`/jobs/${third.json.job.id}/quote/accept`, { token: customer, body: {} })).json.error, "quote_expired");
  const proBefore = await earnings("pro_q");
  assert.equal((await sweepWork()).lapsedQuotes, 1);
  assert.equal((await earnings("pro_q")) - proBefore, 8500);
});

test("work: customer chooses among offers (fixed and quote)", async () => {
  const { call, mkUser, mkProvider, wallet, book, dbJob } = await setup();
  const customer = await mkUser("cust_p", { wallet: 300000 });
  const a = await mkProvider("pro_a");
  const b = await mkProvider("pro_b");

  const job = (await book(customer, { matchingMode: "customer_picks" })).json.job;
  assert.equal((await call(`/provider/jobs/${job.id}/accept`, { token: a.token, body: {} })).json.error, "wrong_mode", "the customer chooses here, so accepting isn't allowed");
  assert.equal((await call(`/provider/jobs/${job.id}/offer`, { token: a.token, body: { etaMinutes: 30, message: "I can come now" } })).status, 200);
  assert.equal((await call(`/provider/jobs/${job.id}/offer`, { token: b.token, body: { etaMinutes: 90 } })).status, 200);

  const detail = await call(`/jobs/${job.id}`, { token: customer });
  assert.equal(detail.json.offers.length, 2);
  assert.ok(detail.json.offers.every((o: Json) => o.priceUgx === 70000), "a fixed price is the same for everyone");
  const offerB = detail.json.offers.find((o: Json) => o.provider.name === "Provider pro_b");
  assert.equal((await call(`/jobs/${job.id}/offers/${offerB.id}/select`, { token: customer, body: {} })).status, 200);
  assert.equal((await dbJob(job.id)).provider_id, b.providerId);
  assert.equal((await call(`/jobs/${job.id}/offers/${offerB.id}/select`, { token: customer, body: {} })).status, 409);
  assert.equal((await call("/provider/jobs/open", { token: a.token })).json.jobs.length, 0, "the other provider no longer sees it");

  // Quote job: providers name a price, and choosing one takes the extra from the wallet.
  const q = (await book(customer, { serviceId: WINDOW, matchingMode: "customer_picks" })).json.job;
  assert.equal((await call(`/provider/jobs/${q.id}/offer`, { token: a.token, body: {} })).status, 400, "a quote offer needs a price");
  await call(`/provider/jobs/${q.id}/offer`, { token: a.token, body: { priceUgx: 45000 } });
  const offers = (await call(`/jobs/${q.id}`, { token: customer })).json.offers;
  const before = await wallet("cust_p");
  assert.equal((await call(`/jobs/${q.id}/offers/${offers[0].id}/select`, { token: customer, body: {} })).status, 200);
  assert.equal(before - (await wallet("cust_p")), 35000, "45,000 less the 10,000 call-out already held");
  assert.equal((await dbJob(q.id)).status, "booked");
});

test("work: only one provider can take a job, however many try at once", async () => {
  const { call, mkUser, mkProvider, book, dbJob } = await setup();
  const customer = await mkUser("cust_r", { wallet: 100000 });
  const pros = await Promise.all(["r1", "r2", "r3", "r4"].map((id) => mkProvider(`pro_${id}`)));
  const job = (await book(customer)).json.job;
  const results = await Promise.all(pros.map((p) => call(`/provider/jobs/${job.id}/accept`, { token: p.token, body: {} })));
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal((await dbJob(job.id)).status, "booked");
});

test("work: admin assigns jobs when that mode is used; unassigned jobs stay out of provider feeds", async () => {
  const { call, mkUser, mkProvider, admin, book, dbJob } = await setup();
  const customer = await mkUser("cust_a", { wallet: 300000 });
  const pro = await mkProvider("pro_s");
  const adminJob = await book(customer, { matchingMode: "admin_assigns", lat: undefined, lng: undefined });
  const job = adminJob.json.job;
  assert.equal((await call("/provider/jobs/open", { token: pro.token })).json.jobs.length, 0);
  assert.equal((await call(`/admin/jobs/${job.id}/assign`, { token: customer, body: { providerId: pro.providerId } })).status, 403);
  assert.equal((await call(`/admin/jobs/${job.id}/assign`, { token: admin, body: { providerId: pro.providerId } })).status, 200);
  assert.equal((await dbJob(job.id)).status, "booked");

  // The wrong service can't be assigned.
  const other = await mkProvider("pro_t", ["wsv_clean_car_wash"]);
  const j2 = (await book(customer, { matchingMode: "admin_assigns" })).json.job;
  assert.equal((await call(`/admin/jobs/${j2.id}/assign`, { token: admin, body: { providerId: other.providerId } })).json.error, "service_mismatch");
});

test("work: the admin's switches decide what customers and providers can do", async () => {
  const { call, mkUser, mkProvider, book } = await setup();
  const customer = await mkUser("cust_s", { wallet: 500000 });
  await mkProvider("pro_s1");

  await setWorkSettings({ matchingModes: ["customer_picks"], defaultMatching: "customer_picks" });
  assert.equal((await book(customer)).json.job.matchingMode, "customer_picks", "the only enabled mode is used");
  assert.equal((await book(customer, { matchingMode: "broadcast" })).json.error, "matching_unavailable");

  await setWorkSettings({ pricingModes: ["fixed"] });
  assert.ok((await call("/catalog", { token: customer })).json.services.every((s: Json) => s.pricingMode === "fixed"));
  assert.equal((await book(customer, { serviceId: WINDOW })).json.error, "pricing_unavailable");

  await setWorkSettings({ serviceTypes: [] });
  const closed = await book(customer);
  assert.equal(closed.status, 403);
  await setWorkSettings({ serviceTypes: ["clean"], providerKinds: ["individual"] });
  const company = await mkUser("co_x", { wallet: 0 });
  assert.equal((await call("/provider/register", { token: company, body: { kind: "company", displayName: "Xco", companyName: "X Ltd", serviceIds: [HOUSE] } })).status, 403);

  await setWorkSettings({ enabled: false });
  assert.equal((await call("/catalog", { token: customer })).status, 503, "the master switch closes the customer side");
});

test("work: booking checks — wallet, location, schedule, quantity, double submit", async () => {
  const { call, mkUser, book, wallet, client } = await setup();
  const poor = await mkUser("cust_poor", { wallet: 5000 });
  const none = await book(poor);
  assert.equal(none.status, 402);
  assert.equal(await wallet("cust_poor"), 5000);
  assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM work_jobs WHERE customer_id = 'cust_poor'")).rows[0].n), 0, "no job without payment");
  assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM work_money WHERE user_id = 'cust_poor'")).rows[0].n), 0);

  const customer = await mkUser("cust_c", { wallet: 1_000_000 });
  assert.equal((await book(customer, { lat: undefined, lng: undefined })).json.error, "location_required");
  assert.equal((await book(customer, { quantity: 99 })).json.error, "invalid_quantity");
  assert.equal((await book(customer, { scheduledFor: new Date(Date.now() + 5 * 60_000).toISOString() })).json.error, "too_soon");
  assert.equal((await book(customer, { scheduledFor: new Date(Date.now() + 90 * 86_400_000).toISOString() })).json.error, "too_far");
  assert.equal((await book(customer, { scheduledFor: new Date(Date.now() + 3 * 3_600_000).toISOString() })).status, 201);
  assert.equal((await book(customer, { serviceId: "nope" })).status, 404);

  const before = await wallet("cust_c");
  const key = "idem-key-0001";
  const twice = await Promise.all([book(customer, { idempotencyKey: key }), book(customer, { idempotencyKey: key })]);
  assert.ok(twice.every((r) => r.status === 201 || r.status === 200));
  assert.equal(twice[0].json.job.id, twice[1].json.job.id, "the same booking");
  assert.equal(before - (await wallet("cust_c")), 70000, "charged once");
  assert.equal((await call("/jobs", { token: customer })).json.jobs.length, 2);
});

test("work: cancelling — refunds, late fee, provider cancel, and the point of no return", async () => {
  const { call, mkUser, mkProvider, wallet, earnings, book, dbJob, client } = await setup();
  const customer = await mkUser("cust_x", { wallet: 500000 });
  const pro = await mkProvider("pro_x");

  const open = (await book(customer)).json.job;
  assert.equal((await call(`/jobs/${open.id}/cancel`, { token: customer, body: {} })).status, 200);
  assert.equal(await wallet("cust_x"), 500000, "cancelled before anyone took it: full refund");
  assert.equal((await call(`/jobs/${open.id}/cancel`, { token: customer, body: {} })).status, 409);
  assert.equal(await wallet("cust_x"), 500000, "and never refunded twice");

  // Within the free window: full refund.
  const early = (await book(customer)).json.job;
  await call(`/provider/jobs/${early.id}/accept`, { token: pro.token, body: {} });
  await call(`/jobs/${early.id}/cancel`, { token: customer, body: {} });
  assert.equal(await wallet("cust_x"), 500000);
  assert.equal(await earnings("pro_x"), 0);

  // After the free window: the provider gets 20% of what was held, less commission.
  const late = (await book(customer)).json.job;
  await call(`/provider/jobs/${late.id}/accept`, { token: pro.token, body: {} });
  await client.execute({ sql: "UPDATE work_jobs SET assigned_at = datetime('now', '-2 hours') WHERE id = ?", args: [late.id] });
  await call(`/jobs/${late.id}/cancel`, { token: customer, body: {} });
  assert.equal(await wallet("cust_x"), 500000 - 14000, "customer loses the 20% fee: 70,000 × 20%");
  assert.equal(await earnings("pro_x"), 11900, "14,000 less 15%");

  // With re-matching switched off, a provider cancelling refunds in full.
  await setWorkSettings({ rematchOnProviderCancel: false });
  const dropped = (await book(customer)).json.job;
  await call(`/provider/jobs/${dropped.id}/accept`, { token: pro.token, body: {} });
  assert.equal((await call(`/provider/jobs/${dropped.id}/cancel`, { token: pro.token, body: {} })).status, 200);
  assert.equal(await wallet("cust_x"), 500000 - 14000);
  await setWorkSettings({ rematchOnProviderCancel: true });

  // Once work starts, cancelling is not on offer; there is a report-a-problem route instead.
  const started = (await book(customer)).json.job;
  await call(`/provider/jobs/${started.id}/accept`, { token: pro.token, body: {} });
  await call(`/provider/jobs/${started.id}/start`, { token: pro.token, body: {} });
  assert.equal((await call(`/jobs/${started.id}/cancel`, { token: customer, body: {} })).status, 409);
  assert.equal((await call(`/provider/jobs/${started.id}/cancel`, { token: pro.token, body: {} })).status, 409);
  assert.equal((await dbJob(started.id)).status, "in_progress");
});

test("work: reporting a problem — admin splits the money; nobody else can", async () => {
  const { call, mkUser, mkProvider, wallet, earnings, admin, book, client } = await setup();
  const customer = await mkUser("cust_d", { wallet: 200000 });
  const pro = await mkProvider("pro_d");
  const job = (await book(customer)).json.job;
  await call(`/provider/jobs/${job.id}/accept`, { token: pro.token, body: {} });
  await call(`/provider/jobs/${job.id}/start`, { token: pro.token, body: {} });
  await call(`/provider/jobs/${job.id}/complete`, { token: pro.token, body: {} });

  assert.equal((await call(`/jobs/${job.id}/dispute`, { token: customer, body: { reason: "x" } })).status, 400);
  assert.equal((await call(`/jobs/${job.id}/dispute`, { token: customer, body: { reason: "Bathroom wasn't cleaned" } })).status, 200);
  assert.equal((await call(`/jobs/${job.id}/confirm`, { token: customer, body: {} })).status, 409, "a reported job can't be confirmed");

  assert.equal((await call(`/admin/jobs/${job.id}/resolve`, { token: customer, body: { outcome: "refund", note: "give it back" } })).status, 403);
  assert.equal((await call(`/admin/jobs/${job.id}/resolve`, { token: admin, body: { outcome: "split", note: "half" } })).status, 400, "a split needs a percentage");
  assert.equal((await call(`/admin/jobs/${job.id}/resolve`, { token: admin, body: { outcome: "split", refundPercent: 50, note: "Half done" } })).status, 200);
  assert.equal(await wallet("cust_d"), 130000 + 35000, "half comes back");
  assert.equal(await earnings("pro_d"), 29750, "the other half, less 15%");
  assert.equal((await call(`/admin/jobs/${job.id}/resolve`, { token: admin, body: { outcome: "refund", note: "again" } })).status, 409, "resolved once");
  assert.equal(await wallet("cust_d"), 165000);
  assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM admin_activity_log WHERE action = 'work.job.resolve'")).rows[0].n), 1);

  // The review window closes.
  const late = (await book(customer)).json.job;
  await call(`/provider/jobs/${late.id}/accept`, { token: pro.token, body: {} });
  await call(`/provider/jobs/${late.id}/start`, { token: pro.token, body: {} });
  await call(`/provider/jobs/${late.id}/complete`, { token: pro.token, body: {} });
  await client.execute({ sql: "UPDATE work_jobs SET completed_at = datetime('now', '-3 days') WHERE id = ?", args: [late.id] });
  assert.equal((await call(`/jobs/${late.id}/dispute`, { token: customer, body: { reason: "Too late to complain" } })).status, 409);
});

test("work: providers — approval, companies and staff", async () => {
  const { call, mkUser, mkProvider, wallet, earnings, admin, book, dbJob, client } = await setup();
  const customer = await mkUser("cust_t", { wallet: 300000 });

  // Unapproved providers can register but can't work.
  const pending = await mkProvider("pro_pending", [HOUSE], "individual", false);
  assert.equal((await call("/provider/me", { method: "PUT", token: pending.token, body: { online: true } })).status, 403);
  const job = (await book(customer)).json.job;
  assert.equal((await call("/provider/jobs/open", { token: pending.token })).status, 403);
  assert.equal((await call(`/admin/providers/${pending.providerId}/approve`, { token: pending.token, body: {} })).status, 403, "providers can't approve themselves");
  await call(`/admin/providers/${pending.providerId}/approve`, { token: admin, body: {} });
  assert.equal((await call(`/admin/providers/${pending.providerId}/approve`, { token: admin, body: {} })).status, 409, "already approved");
  await call(`/admin/providers/${pending.providerId}/suspend`, { token: admin, body: { note: "complaints" } });
  assert.equal((await call(`/provider/jobs/${job.id}/accept`, { token: pending.token, body: {} })).status, 403, "suspended providers lose access at once");
  assert.equal((await call("/provider/register", { token: pending.token, body: { kind: "individual", displayName: "Again", serviceIds: [HOUSE] } })).status, 409);

  // A company: the owner takes the job, assigns a staff member, who does it; the owner is paid.
  const company = await mkProvider("pro_co", [HOUSE], "company");
  const staffToken = await mkUser("staff_1");
  const found = await call("/provider/staff", { token: company.token, body: { identifier: "+256700099999" } });
  assert.equal(found.status, 404, "unknown people can't be added");
  const phone = (await client.execute({ sql: "SELECT phone FROM users WHERE id = 'staff_1'", args: [] })).rows[0].phone as string;
  assert.equal((await call("/provider/staff", { token: company.token, body: { identifier: phone } })).status, 201);
  assert.equal((await call("/provider/staff", { token: staffToken, body: { identifier: phone } })).status, 403, "staff aren't provider owners");

  const j = (await book(customer)).json.job;
  assert.equal((await call(`/provider/jobs/${j.id}/accept`, { token: staffToken, body: {} })).status, 403, "staff can't take new jobs");
  await call(`/provider/jobs/${j.id}/accept`, { token: company.token, body: {} });
  assert.equal((await call(`/provider/jobs/${j.id}/start`, { token: staffToken, body: {} })).status, 404, "staff only see jobs assigned to them");
  assert.equal((await call(`/provider/jobs/${j.id}/assign-worker`, { token: company.token, body: { workerId: "someone_else" } })).status, 404);
  assert.equal((await call(`/provider/jobs/${j.id}/assign-worker`, { token: company.token, body: { workerId: "staff_1" } })).status, 200);
  assert.equal((await call("/provider/jobs", { token: staffToken })).json.jobs.length, 1);
  assert.equal((await call(`/provider/jobs/${j.id}/start`, { token: staffToken, body: {} })).status, 200);
  assert.equal((await call(`/provider/jobs/${j.id}/complete`, { token: staffToken, body: {} })).status, 200);
  assert.equal((await call(`/provider/jobs/${j.id}/cancel`, { token: staffToken, body: {} })).status, 403);
  await call(`/jobs/${j.id}/confirm`, { token: customer, body: {} });
  assert.equal(await earnings("pro_co"), 59500, "the company owner is paid");
  assert.equal(await earnings("staff_1"), 0);
  assert.equal((await dbJob(j.id)).worker_id, "staff_1");

  assert.equal((await call("/provider/staff/staff_1", { method: "DELETE", token: company.token })).status, 200);
  assert.equal((await call("/provider/jobs", { token: staffToken })).status, 404, "removed staff lose access");
});

test("work: sweeps expire jobs, pay out unanswered jobs and finish interrupted payments — once", async () => {
  const { call, mkUser, mkProvider, wallet, earnings, book, client, dbJob } = await setup();
  const customer = await mkUser("cust_w", { wallet: 400000 });
  const pro = await mkProvider("pro_w");

  const stale = (await book(customer)).json.job;
  await client.execute({ sql: "UPDATE work_jobs SET expires_at = datetime('now', '-1 minute') WHERE id = ?", args: [stale.id] });
  const finished = (await book(customer)).json.job;
  await call(`/provider/jobs/${finished.id}/accept`, { token: pro.token, body: {} });
  await call(`/provider/jobs/${finished.id}/start`, { token: pro.token, body: {} });
  await call(`/provider/jobs/${finished.id}/complete`, { token: pro.token, body: {} });
  await client.execute({ sql: "UPDATE work_jobs SET confirm_by = datetime('now', '-1 minute') WHERE id = ?", args: [finished.id] });

  const first = await sweepWork();
  assert.equal(first.expired, 1);
  assert.equal(first.autoConfirmed, 1);
  assert.equal((await dbJob(stale.id)).status, "expired");
  assert.equal(await earnings("pro_w"), 59500);
  assert.equal(await wallet("cust_w"), 400000 - 70000, "the expired job was refunded, the finished one paid");

  const second = await sweepWork();
  assert.deepEqual([second.expired, second.autoConfirmed, second.moneyApplied], [0, 0, 0], "running it again changes nothing");
  assert.equal(await earnings("pro_w"), 59500);

  // A payment that was recorded but not delivered (a crash) is delivered once, even if two sweeps race.
  await client.execute({ sql: "INSERT INTO work_money (id, job_id, user_id, kind, amount_ugx, status, note, environment) VALUES ('payout:stuck', ?, 'pro_w', 'payout', 1000, 'pending', 'stuck', 'live')", args: [finished.id] });
  const [x, y] = await Promise.all([sweepWork(), sweepWork()]);
  assert.equal(x.moneyApplied + y.moneyApplied, 1);
  assert.equal(await earnings("pro_w"), 60500);

  // A booking that never got paid is cleared away.
  await client.execute({ sql: "INSERT INTO work_jobs (id, customer_id, service_id, service_type, service_name, pricing_mode, matching_mode, quantity, address, created_at) VALUES ('wjob_abandoned', 'cust_w', ?, 'clean', 'x', 'fixed', 'broadcast', 1, 'y', datetime('now', '-1 hour'))", args: [HOUSE] });
  assert.equal((await sweepWork()).cleared, 1);
});

test("work: no endpoint works without signing in, and roles are kept apart", async () => {
  const { call, mkUser, mkProvider, book } = await setup();
  const customer = await mkUser("cust_z", { wallet: 400000 });
  const pro = await mkProvider("pro_z");
  const job = (await book(customer)).json.job;
  const other = await mkUser("cust_other", { wallet: 0 });

  for (const [method, path] of [
    ["GET", "/catalog"], ["POST", "/jobs"], ["GET", "/jobs"], ["GET", `/jobs/${job.id}`], ["POST", `/jobs/${job.id}/cancel`], ["POST", `/jobs/${job.id}/confirm`],
    ["POST", "/provider/register"], ["GET", "/provider/me"], ["GET", "/provider/jobs/open"], ["POST", `/provider/jobs/${job.id}/accept`],
    ["GET", "/admin/providers"], ["POST", `/admin/jobs/${job.id}/assign`], ["PATCH", "/admin/services/x"],
  ] as const) {
    assert.equal((await call(path, { method })).status, 401, `${method} ${path}`);
  }

  // Someone else's job is invisible, not just forbidden.
  assert.equal((await call(`/jobs/${job.id}`, { token: other })).status, 404);
  assert.equal((await call(`/jobs/${job.id}/cancel`, { token: other, body: {} })).status, 404);
  assert.equal((await call(`/jobs/${job.id}/confirm`, { token: other, body: {} })).status, 404);

  // Customers and providers can't use the admin side; admins' routes need the right role.
  for (const token of [customer, pro.token]) {
    assert.equal((await call("/admin/providers", { token })).status, 403);
    assert.equal((await call("/admin/services", { token, method: "POST", body: {} })).status, 403);
  }
  // A customer who is not a provider has no provider account.
  assert.equal((await call("/provider/me", { token: customer })).status, 404);
  assert.equal((await call("/provider/jobs/open", { token: customer })).status, 404);
  // A provider can't act on a job that isn't theirs.
  const mine = (await book(customer)).json.job;
  await call(`/provider/jobs/${mine.id}/accept`, { token: pro.token, body: {} });
  const stranger = await mkProvider("pro_y");
  assert.equal((await call(`/provider/jobs/${mine.id}/start`, { token: stranger.token, body: {} })).status, 404);
  assert.equal((await call(`/provider/jobs/${mine.id}/cancel`, { token: stranger.token, body: {} })).status, 404);
});

test("work: admin manages the catalogue; changes never reprice a booked job", async () => {
  const { call, mkUser, admin, book, client } = await setup();
  const customer = await mkUser("cust_m", { wallet: 500000 });
  const before = (await book(customer)).json.job;
  assert.equal(before.priceUgx, 70000);

  assert.equal((await call(`/admin/services/${HOUSE}`, { method: "PATCH", token: admin, body: { unitPriceUgx: 50000 } })).status, 200);
  assert.equal((await call(`/jobs/${before.id}`, { token: customer })).json.job.priceUgx, 70000, "already booked at the old price");
  assert.equal((await book(customer)).json.job.priceUgx, 100000, "new bookings use the new price");

  assert.equal((await call(`/admin/services/${HOUSE}`, { method: "PATCH", token: admin, body: { pricingMode: "fixed", unitPriceUgx: 0 } })).status, 400);
  const added = await call("/admin/services", { token: admin, body: { type: "clean", category: "car", name: "Engine bay clean", pricingMode: "fixed", unitPriceUgx: 20000, unitLabel: "car" } });
  assert.equal(added.status, 201);
  assert.equal((await call("/catalog?type=clean", { token: customer })).json.services.some((s: Json) => s.name === "Engine bay clean"), true);
  await call(`/admin/services/${added.json.id}`, { method: "PATCH", token: admin, body: { active: false } });
  assert.equal((await call("/catalog?type=clean", { token: customer })).json.services.some((s: Json) => s.name === "Engine bay clean"), false);

  // Per-service commission overrides the platform default.
  await call(`/admin/services/wsv_clean_car_wash`, { method: "PATCH", token: admin, body: { commissionPercent: 5 } });
  const car = (await book(customer, { serviceId: "wsv_clean_car_wash", quantity: 1 })).json.job;
  assert.equal((await client.execute({ sql: "SELECT commission_percent AS p FROM work_jobs WHERE id = ?", args: [car.id] })).rows[0].p, 5);
  assert.ok(Number((await client.execute("SELECT COUNT(*) AS n FROM admin_activity_log WHERE action LIKE 'work.service.%'")).rows[0].n) >= 3, "changes are recorded");
});

test("work: until migration 0098 is applied everything answers 'upgrade pending'", async () => {
  const { call, mkUser, client } = await setup();
  const customer = await mkUser("cust_g", { wallet: 1000 });
  assert.equal((await call("/catalog", { token: customer })).status, 200);
  await client.execute("DROP TABLE work_events");
  resetWorkSchemaCache();
  const gated = await call("/catalog", { token: customer });
  assert.equal(gated.status, 503);
  assert.equal(gated.json.error, "work_upgrade_pending");
});

// ---------------------------------------------------------------------------
// Extras: re-matching, photos, chat and live location (migration 0099)
// ---------------------------------------------------------------------------

import { setR2Binding } from "../storage/r2.js";

function fakeBucket() {
  const store = new Map<string, { bytes: Uint8Array; type?: string }>();
  setR2Binding({
    async put(key: string, value: any, options?: { httpMetadata?: { contentType?: string } }) {
      store.set(key, { bytes: new Uint8Array(value as Uint8Array), type: options?.httpMetadata?.contentType });
    },
    async get(key: string) {
      const o = store.get(key);
      return o ? { body: new Response(o.bytes as BodyInit).body as ReadableStream, httpMetadata: { contentType: o.type } } : null;
    },
    async delete(key: string) {
      store.delete(key);
    },
  } as any);
  return store;
}
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);

async function multipart(path: string, token: string, bytes: Uint8Array, type = "image/png", fields: Record<string, string> = {}) {
  const form = new FormData();
  form.append("file", new File([bytes as BlobPart], "p.png", { type }));
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await app.request(`/v1/work${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
}

test("work: a provider who cancels sends the job back out, up to the admin's limit, then the customer is refunded", async () => {
  const { call, mkUser, mkProvider, wallet, book, dbJob } = await setup();
  const customer = await mkUser("cust_r1", { wallet: 200000 });
  const a = await mkProvider("pro_ra");
  const b = await mkProvider("pro_rb");
  const c = await mkProvider("pro_rc");
  const jobId = (await book(customer)).json.job.id as string;
  assert.equal(await wallet("cust_r1"), 130000);

  assert.equal((await call(`/provider/jobs/${jobId}/accept`, { token: a.token, body: {} })).status, 200);
  const first = await call(`/provider/jobs/${jobId}/cancel`, { token: a.token, body: { reason: "Car trouble" } });
  assert.equal(first.status, 200);
  assert.equal(first.json.rematched, true);
  let row = await dbJob(jobId);
  assert.equal(row.status, "open");
  assert.equal(row.provider_id, null);
  assert.equal(Number(row.held_ugx), 70000, "the money stays held");
  assert.equal(Number(row.rematch_count), 1);
  assert.equal(await wallet("cust_r1"), 130000, "no refund while it is being re-offered");

  // The provider who backed out can't take it again; others can.
  const again = await call(`/provider/jobs/${jobId}/accept`, { token: a.token, body: {} });
  assert.equal(again.status, 403, JSON.stringify(again.json));
  assert.equal((await call(`/provider/jobs/${jobId}/accept`, { token: b.token, body: {} })).status, 200);

  assert.equal((await call(`/provider/jobs/${jobId}/cancel`, { token: b.token, body: {} })).json.rematched, true);
  assert.equal(Number((await dbJob(jobId)).rematch_count), 2);
  assert.equal((await call(`/provider/jobs/${jobId}/accept`, { token: c.token, body: {} })).status, 200);

  // The limit is 2: a third cancellation refunds and closes the job.
  const last = await call(`/provider/jobs/${jobId}/cancel`, { token: c.token, body: {} });
  assert.equal(last.status, 200);
  assert.equal(last.json.rematched, false);
  row = await dbJob(jobId);
  assert.equal(row.status, "cancelled");
  assert.equal(await wallet("cust_r1"), 200000, "refunded in full");
});

test("work: a quote job goes back out before a price is accepted, and re-matching can be switched off", async () => {
  const { call, mkUser, mkProvider, wallet, book, dbJob } = await setup();
  const customer = await mkUser("cust_r2", { wallet: 100000 });
  const a = await mkProvider("pro_qa");
  const b = await mkProvider("pro_qb");
  const jobId = (await book(customer, { serviceId: WINDOW, quantity: 1 })).json.job.id as string;
  await call(`/provider/jobs/${jobId}/accept`, { token: a.token, body: {} });
  await call(`/provider/jobs/${jobId}/quote`, { token: a.token, body: { priceUgx: 40000 } });
  assert.equal((await dbJob(jobId)).status, "quoted");

  const out = await call(`/provider/jobs/${jobId}/cancel`, { token: a.token, body: {} });
  assert.equal(out.json.rematched, true);
  let row = await dbJob(jobId);
  assert.equal(row.status, "open");
  assert.equal(Number(row.price_ugx), 0, "the old quote is gone");
  assert.equal(Number(row.held_ugx), 10000, "the call-out fee stays held");

  // Switched off: the next cancellation refunds as before.
  await setWorkSettings({ rematchOnProviderCancel: false });
  await call(`/provider/jobs/${jobId}/accept`, { token: b.token, body: {} });
  const off = await call(`/provider/jobs/${jobId}/cancel`, { token: b.token, body: {} });
  assert.equal(off.json.rematched, false);
  row = await dbJob(jobId);
  assert.equal(row.status, "cancelled");
  assert.equal(await wallet("cust_r2"), 100000);
});

test("work: job photos are private, checked by their bytes, and limited", async () => {
  const store = fakeBucket();
  const { call, mkUser, mkProvider, book } = await setup();
  await setWorkSettings({ maxPhotosPerJob: 2 });
  const customer = await mkUser("cust_p1", { wallet: 200000 });
  const stranger = await mkUser("stranger_p");
  const pro = await mkProvider("pro_p");
  const jobId = (await book(customer)).json.job.id as string;

  const up = await multipart(`/jobs/${jobId}/photos`, customer, PNG, "image/png", { note: "The stained sofa" });
  assert.equal(up.status, 201, JSON.stringify(up.json));
  assert.equal(up.json.photo.phase, "request");
  assert.equal(store.size, 1);

  // A text file with an image label is refused: the bytes decide.
  const fake = await multipart(`/jobs/${jobId}/photos`, customer, new TextEncoder().encode("<script>alert(1)</script>"), "image/png");
  assert.equal(fake.status, 400);
  assert.equal((await multipart(`/jobs/${jobId}/photos`, customer, PNG, "application/pdf")).status, 400);

  // Only people on the job see it. A stranger gets "not found"; a provider who could take the open job sees the request photo.
  const id = up.json.photo.id as string;
  assert.equal((await call(`/jobs/${jobId}/photos`, { token: stranger })).status, 404);
  const raw = await app.request(`/v1/work/photos/${id}`, { headers: { Authorization: `Bearer ${stranger}` } });
  assert.equal(raw.status, 404);
  const owner = await app.request(`/v1/work/photos/${id}`, { headers: { Authorization: `Bearer ${customer}` } });
  assert.equal(owner.status, 200);
  assert.equal(owner.headers.get("x-content-type-options"), "nosniff");
  assert.equal(owner.headers.get("cache-control"), "private, no-store");
  const seen = await call(`/provider/jobs/${jobId}/photos`, { token: pro.token });
  assert.equal(seen.json.photos.length, 1);

  // Provider before/after photos once the job is theirs; the limit counts them all.
  assert.equal((await multipart(`/provider/jobs/${jobId}/photos`, pro.token, PNG, "image/png", { phase: "before" })).status, 404, "not their job yet");
  await call(`/provider/jobs/${jobId}/accept`, { token: pro.token, body: {} });
  const before = await multipart(`/provider/jobs/${jobId}/photos`, pro.token, PNG, "image/png", { phase: "before" });
  assert.equal(before.status, 201, JSON.stringify(before.json));
  assert.equal(before.json.photo.phase, "before");
  assert.equal((await multipart(`/jobs/${jobId}/photos`, customer, PNG)).status, 409, "the limit of 2 is reached");

  // Switched off from Admin.
  await setWorkSettings({ photosEnabled: false });
  assert.equal((await multipart(`/jobs/${jobId}/photos`, customer, PNG)).status, 503);
});

test("work: the customer and the provider can message each other once the job has a provider", async () => {
  const { call, mkUser, mkProvider, book } = await setup();
  const customer = await mkUser("cust_m1", { wallet: 200000 });
  const stranger = await mkUser("stranger_m");
  const pro = await mkProvider("pro_m");
  const jobId = (await book(customer)).json.job.id as string;

  const early = await call(`/jobs/${jobId}/messages`, { token: customer, body: { body: "Hello?" } });
  assert.equal(early.status, 409, "nobody to talk to yet");

  await call(`/provider/jobs/${jobId}/accept`, { token: pro.token, body: {} });
  assert.equal((await call(`/jobs/${jobId}/messages`, { token: customer, body: { body: "Gate code is 4321" } })).status, 201);
  assert.equal((await call(`/provider/jobs/${jobId}/messages`, { token: pro.token, body: { body: "On my way" } })).status, 201);
  assert.equal((await call(`/jobs/${jobId}/messages`, { token: customer, body: { body: "   " } })).status, 400);

  const thread = await call(`/jobs/${jobId}/messages`, { token: customer });
  assert.deepEqual(thread.json.messages.map((m: Json) => [m.from, m.body]), [["customer", "Gate code is 4321"], ["provider", "On my way"]]);
  assert.equal((await call(`/provider/jobs/${jobId}/messages`, { token: pro.token })).json.messages.length, 2);

  assert.equal((await call(`/jobs/${jobId}/messages`, { token: stranger })).status, 404);
  assert.equal((await call(`/jobs/${jobId}/messages`, { token: stranger, body: { body: "hi" } })).status, 404);
  // A provider can't post as the customer, nor the customer as the provider.
  assert.equal((await call(`/provider/jobs/${jobId}/messages`, { token: customer, body: { body: "x" } })).status, 404);

  await setWorkSettings({ chatEnabled: false });
  assert.equal((await call(`/jobs/${jobId}/messages`, { token: customer })).status, 503);
});

test("work: the customer sees the provider's location only while the job is on, and only if admin allows it", async () => {
  const { call, mkUser, mkProvider, book, client } = await setup();
  const customer = await mkUser("cust_l1", { wallet: 200000 });
  const stranger = await mkUser("stranger_l");
  const pro = await mkProvider("pro_l");
  const jobId = (await book(customer)).json.job.id as string;

  assert.equal((await call(`/provider/jobs/${jobId}/location`, { token: pro.token, body: { lat: 0.31, lng: 32.58 } })).status, 404, "not their job yet");
  await call(`/provider/jobs/${jobId}/accept`, { token: pro.token, body: {} });

  const sent = await call(`/provider/jobs/${jobId}/location`, { token: pro.token, body: { lat: 0.3201, lng: 32.5899 } });
  assert.equal(sent.status, 200);
  assert.equal(sent.json.stored, true);
  const quick = await call(`/provider/jobs/${jobId}/location`, { token: pro.token, body: { lat: 0.33, lng: 32.6 } });
  assert.equal(quick.json.stored, false, "pings closer together than a few seconds are dropped");

  const seen = await call(`/jobs/${jobId}`, { token: customer });
  assert.deepEqual({ lat: seen.json.job.providerLocation.lat, lng: seen.json.job.providerLocation.lng }, { lat: 0.3201, lng: 32.5899 });
  assert.equal((await call(`/provider/jobs/${jobId}`, { token: pro.token })).json.job.providerLocation, null, "the provider doesn't need it echoed back");
  assert.equal((await call(`/provider/jobs/${jobId}/location`, { token: stranger, body: { lat: 1, lng: 1 } })).status, 404);
  assert.equal((await call(`/provider/jobs/${jobId}/location`, { token: pro.token, body: { lat: 200, lng: 1 } })).status, 400);

  await client.execute({ sql: "UPDATE work_jobs SET provider_located_at = datetime('now', '-10 seconds') WHERE id = ?", args: [jobId] });
  await setWorkSettings({ trackingEnabled: false });
  assert.equal((await call(`/provider/jobs/${jobId}/location`, { token: pro.token, body: { lat: 0.4, lng: 32.7 } })).status, 503);
});

// ---------------------------------------------------------------------------
// On-site checks (migration 0100)
// ---------------------------------------------------------------------------

test("work: time on site counts only pings inside the radius, close together, and accurate enough", () => {
  const at = (min: number) => `2026-01-01 10:${String(min).padStart(2, "0")}:00`;
  const home = { lat: 0.3136, lng: 32.5811 };
  const near = (min: number, extra: Partial<{ lat: number; accuracyM: number | null }> = {}) => ({ lat: home.lat + 0.0003, lng: home.lng, accuracyM: 10, at: at(min), ...extra });
  const stay = Array.from({ length: 26 }, (_, i) => near(i)); // one ping a minute for 25 minutes
  assert.equal(dwellAt(stay, home, 150).onsiteMinutes, 25);
  assert.equal(dwellAt(stay, home, 150).points, 26);
  // A hole in the trail (phone locked) is not counted as time on site beyond the cap.
  const gap = [near(0), near(1), near(31), near(32)];
  assert.equal(dwellAt(gap, home, 150).onsiteMinutes, 1 + 5 + 1, "the 30-minute hole counts for at most five minutes");
  // Passing by: inside, then outside, then inside — only consecutive inside pings add up.
  const passing = [near(0), near(1, { lat: home.lat + 0.01 }), near(2)];
  assert.equal(dwellAt(passing, home, 150).onsiteMinutes, 0);
  // A ping less accurate than the radius can't prove anyone was there.
  assert.equal(dwellAt(stay.map((p) => ({ ...p, accuracyM: 500 })), home, 150).onsiteMinutes, 0);
  assert.equal(dwellAt([], home, 150).closestM, null);
  assert.ok((dwellAt(stay, home, 150).closestM ?? 0) > 20 && (dwellAt(stay, home, 150).closestM ?? 0) < 50);
});

async function onsiteSetup() {
  const ctx = await setup();
  await setWorkSettings({ onsiteCheckEnabled: true, onsiteRadiusM: 150, onsiteMinMinutes: 20, onsiteAction: "flag", onsiteFlagNoLocation: true, onsiteSuspendAfterFlags: 0, onsiteWindowDays: 30, locationRetentionDays: 30 });
  /** Pretend the provider sat at the address for `minutes`, one ping a minute, ending now. */
  const stayAtAddress = async (jobId: string, providerId: string, minutes: number, spot = { lat: 0.3137, lng: 32.5811 }) => {
    for (let i = 0; i <= minutes; i++) {
      await ctx.client.execute({
        sql: "INSERT INTO work_job_locations (job_id, provider_id, lat, lng, accuracy_m, recorded_at) VALUES (?, ?, ?, ?, 12, datetime('now', ?))",
        args: [jobId, providerId, spot.lat, spot.lng, `-${minutes - i} minutes`],
      });
    }
  };
  const flags = async () => (await ctx.client.execute("SELECT * FROM work_flags ORDER BY rowid")).rows as Json[];
  return { ...ctx, stayAtAddress, flags };
}

test("work: on-site checks are off by default — nothing is recorded or flagged", async () => {
  const { call, mkUser, mkProvider, book, client } = await setup();
  const flags = async () => (await client.execute("SELECT * FROM work_flags")).rows;
  const customer = await mkUser("cust_o0", { wallet: 200000 });
  const pro = await mkProvider("pro_o0");
  const jobId = (await book(customer)).json.job.id as string;
  await call(`/provider/jobs/${jobId}/accept`, { token: pro.token, body: {} });
  assert.equal((await call(`/provider/jobs/${jobId}/location`, { token: pro.token, body: { lat: 0.3137, lng: 32.5811 } })).status, 200);
  assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM work_job_locations")).rows[0].n), 0, "no trail is kept while the switch is off");
  await client.execute({ sql: "UPDATE work_jobs SET assigned_at = datetime('now', '-3 hours') WHERE id = ?", args: [jobId] });
  assert.equal((await call(`/jobs/${jobId}/cancel`, { token: customer, body: {} })).status, 200);
  assert.deepEqual(await flags(), []);
});

test("work: a cancellation after a long stay at the address is flagged and reviewed by admin", async () => {
  const { call, mkUser, mkProvider, book, client, admin, flags, stayAtAddress } = await onsiteSetup();
  const customer = await mkUser("cust_o1", { wallet: 200000 });
  const pro = await mkProvider("pro_o1");
  const jobId = (await book(customer)).json.job.id as string;
  await call(`/provider/jobs/${jobId}/accept`, { token: pro.token, body: {} });

  assert.equal((await call(`/provider/jobs/${jobId}/location`, { token: pro.token, body: { lat: 0.3137, lng: 32.5811, accuracy: 15 } })).json.stored, true);
  assert.equal((await call(`/provider/jobs/${jobId}/location`, { token: pro.token, body: { lat: 0.3137, lng: 32.5811 } })).json.stored, false);
  assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM work_job_locations")).rows[0].n), 1, "one trail point per stored update");

  await client.execute("DELETE FROM work_job_locations");
  await stayAtAddress(jobId, pro.providerId, 25);
  assert.equal((await call(`/jobs/${jobId}/cancel`, { token: customer, body: {} })).status, 200, "the cancellation itself still goes through");

  const [flag] = await flags();
  assert.equal(flag.kind, "cancel_after_onsite");
  assert.equal(flag.cancelled_by, "customer");
  assert.equal(flag.status, "open");
  assert.ok(Number(flag.onsite_minutes) >= 24, `on site ${flag.onsite_minutes} minutes`);
  assert.equal((await call(`/provider/jobs/open`, { token: pro.token })).status, 200, "action 'flag' leaves the provider working");

  const list = await call("/admin/flags", { token: admin });
  assert.equal(list.json.ready, true);
  assert.equal(list.json.openCount, 1);
  const detail = await call(`/admin/flags/${flag.id}`, { token: admin });
  assert.equal(detail.status, 200);
  assert.ok(detail.json.trail.length >= 20 && detail.json.job.address === "Plot 5 Kololo");
  assert.equal((await call(`/admin/flags/${flag.id}`, { token: pro.token })).status, 403, "providers can't read the queue");

  assert.equal((await call(`/admin/flags/${flag.id}/review`, { token: admin, body: { outcome: "warn", note: "First warning" } })).status, 200);
  assert.equal((await call(`/admin/flags/${flag.id}/review`, { token: admin, body: { outcome: "dismiss" } })).status, 409, "a flag is reviewed once");
  assert.equal((await flags())[0].status, "warned");
});

test("work: suspension — straight away if admin chooses, or after enough flags, and it can be undone", async () => {
  const { call, mkUser, mkProvider, book, client, admin, flags, stayAtAddress } = await onsiteSetup();
  await setWorkSettings({ onsiteSuspendAfterFlags: 2, rematchOnProviderCancel: false });
  const pro = await mkProvider("pro_o2");
  const cancelledAfterStay = async (customerId: string, who: "customer" | "provider") => {
    const customer = await mkUser(customerId, { wallet: 200000 });
    const jobId = (await book(customer)).json.job.id as string;
    assert.equal((await call(`/provider/jobs/${jobId}/accept`, { token: pro.token, body: {} })).status, 200);
    await stayAtAddress(jobId, pro.providerId, 22);
    const res = who === "customer" ? await call(`/jobs/${jobId}/cancel`, { token: customer, body: {} }) : await call(`/provider/jobs/${jobId}/cancel`, { token: pro.token, body: { reason: "can't" } });
    assert.equal(res.status, 200);
    return jobId;
  };
  const status = async () => String((await client.execute({ sql: "SELECT status FROM work_providers WHERE id = ?", args: [pro.providerId] })).rows[0].status);

  await cancelledAfterStay("cust_o2a", "customer");
  assert.equal(await status(), "approved", "one flag is under the limit");
  await cancelledAfterStay("cust_o2b", "provider");
  assert.equal(await status(), "suspended", "the second flag in the window suspends");
  const all = await flags();
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((f) => f.cancelled_by), ["customer", "provider"]);
  assert.equal(all[1].status, "suspended");
  assert.match(String(all[1].review_note), /Suspended automatically/);

  const customer = await mkUser("cust_o2c", { wallet: 100000 });
  const next = (await book(customer)).json.job.id as string;
  assert.equal((await call(`/provider/jobs/${next}/accept`, { token: pro.token, body: {} })).status, 403, "a suspended provider can't take jobs");
  const row = (await call("/admin/providers?status=suspended", { token: admin })).json.providers[0];
  assert.match(String(row.status_note), /Under review/);
  assert.equal((await call(`/admin/providers/${pro.providerId}/reinstate`, { token: admin, body: { note: "Cleared" } })).status, 200);
  assert.equal(await status(), "approved");

  // With the action set to "suspend", a single flagged cancellation suspends straight away.
  await setWorkSettings({ onsiteSuspendAfterFlags: 0, onsiteAction: "suspend" });
  await cancelledAfterStay("cust_o2d", "customer");
  assert.equal(await status(), "suspended");
  await call(`/admin/providers/${pro.providerId}/reinstate`, { token: admin, body: {} });

  // Admin can suspend from the review screen too, and the first, still-open flag can be dismissed.
  const first = (await flags())[0];
  assert.equal(first.status, "open");
  assert.equal((await call(`/admin/flags/${first.id}/review`, { token: admin, body: { outcome: "suspend", note: "Repeated" } })).status, 200);
  assert.equal(await status(), "suspended");
});

test("work: a provider who held a job and never shared a location is flagged; a short wait is not", async () => {
  const { call, mkUser, mkProvider, book, client, flags } = await onsiteSetup();
  await setWorkSettings({ rematchOnProviderCancel: false });
  const pro = await mkProvider("pro_o3");
  const first = await mkUser("cust_o3a", { wallet: 200000 });
  const quick = (await book(first)).json.job.id as string;
  await call(`/provider/jobs/${quick}/accept`, { token: pro.token, body: {} });
  assert.equal((await call(`/provider/jobs/${quick}/cancel`, { token: pro.token, body: { reason: "sorry" } })).status, 200);
  assert.deepEqual(await flags(), [], "cancelling soon after accepting is nothing to flag");

  const second = await mkUser("cust_o3b", { wallet: 200000 });
  const slow = (await book(second)).json.job.id as string;
  await call(`/provider/jobs/${slow}/accept`, { token: pro.token, body: {} });
  await client.execute({ sql: "UPDATE work_jobs SET assigned_at = datetime('now', '-45 minutes') WHERE id = ?", args: [slow] });
  assert.equal((await call(`/provider/jobs/${slow}/cancel`, { token: pro.token, body: { reason: "sorry" } })).status, 200);
  const [flag] = await flags();
  assert.equal(flag.kind, "cancel_no_location");

  await setWorkSettings({ onsiteFlagNoLocation: false });
  const third = await mkUser("cust_o3c", { wallet: 200000 });
  const other = (await book(third)).json.job.id as string;
  await call(`/provider/jobs/${other}/accept`, { token: pro.token, body: {} });
  await client.execute({ sql: "UPDATE work_jobs SET assigned_at = datetime('now', '-45 minutes') WHERE id = ?", args: [other] });
  await call(`/provider/jobs/${other}/cancel`, { token: pro.token, body: { reason: "sorry" } });
  assert.equal((await flags()).length, 1, "admin can switch the no-location check off");
});

test("work: a provider cancelling so the job is re-matched is checked too", async () => {
  const { call, mkUser, mkProvider, book, flags, stayAtAddress, dbJob } = await onsiteSetup();
  const customer = await mkUser("cust_o4", { wallet: 200000 });
  const pro = await mkProvider("pro_o4");
  const jobId = (await book(customer)).json.job.id as string;
  await call(`/provider/jobs/${jobId}/accept`, { token: pro.token, body: {} });
  await stayAtAddress(jobId, pro.providerId, 30);
  const res = await call(`/provider/jobs/${jobId}/cancel`, { token: pro.token, body: { reason: "cash" } });
  assert.equal(res.json.rematched, true);
  assert.equal((await dbJob(jobId)).status, "open");
  assert.equal((await flags()).length, 1);
});

test("work: old location trails are deleted, except evidence for a flag nobody has reviewed", async () => {
  const { client, mkUser, mkProvider, book, call, stayAtAddress } = await onsiteSetup();
  const customer = await mkUser("cust_o5", { wallet: 200000 });
  const pro = await mkProvider("pro_o5");
  const jobId = (await book(customer)).json.job.id as string;
  await call(`/provider/jobs/${jobId}/accept`, { token: pro.token, body: {} });
  await stayAtAddress(jobId, pro.providerId, 2);
  await client.execute("UPDATE work_job_locations SET recorded_at = datetime('now', '-40 days')");
  await client.execute({
    sql: `INSERT INTO work_flags (id, job_id, provider_id, customer_id, kind, cancelled_by, radius_m, min_minutes) VALUES ('wfl_keep', ?, ?, 'cust_o5', 'cancel_after_onsite', 'customer', 150, 20)`,
    args: [jobId, pro.providerId],
  });
  assert.equal(await purgeTrails(await getWorkSettings()), 0, "an open flag keeps its evidence");
  await client.execute("UPDATE work_flags SET status = 'dismissed'");
  assert.equal(await purgeTrails(await getWorkSettings()), 3);
  assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM work_job_locations")).rows[0].n), 0);
});

test("work: with on-site checks on, a job can't be started without a fresh location, and arrival is checked against the address", async () => {
  const { call, mkUser, mkProvider, book, client } = await onsiteSetup();
  const customer = await mkUser("cust_o6", { wallet: 200000 });
  const pro = await mkProvider("pro_o6");
  const jobId = (await book(customer)).json.job.id as string;
  await call(`/provider/jobs/${jobId}/accept`, { token: pro.token, body: {} });

  // No location yet: can't start, can't mark arrival.
  const early = await call(`/provider/jobs/${jobId}/start`, { token: pro.token, body: {} });
  assert.equal(early.status, 409);
  assert.equal(early.json.error, "location_required");
  assert.equal((await call(`/provider/jobs/${jobId}/arrived`, { token: pro.token, body: {} })).json.error, "location_required");

  // Far away: arrival is refused and says how far.
  assert.equal((await call(`/provider/jobs/${jobId}/location`, { token: pro.token, body: { lat: 0.3336, lng: 32.5811 } })).json.stored, true);
  const far = await call(`/provider/jobs/${jobId}/arrived`, { token: pro.token, body: {} });
  assert.equal(far.status, 409);
  assert.equal(far.json.error, "not_there_yet");
  assert.ok(far.json.distanceM > 2000);
  assert.equal((await call(`/jobs/${jobId}`, { token: customer })).json.job.arrivedAt, null);

  // At the address: arrival is accepted once, the customer sees it, and the job can start.
  await client.execute({ sql: "UPDATE work_jobs SET provider_lat = 0.3137, provider_lng = 32.5811, provider_located_at = datetime('now') WHERE id = ?", args: [jobId] });
  assert.equal((await call(`/provider/jobs/${jobId}/arrived`, { token: pro.token, body: {} })).status, 200);
  assert.equal((await call(`/provider/jobs/${jobId}/arrived`, { token: pro.token, body: {} })).json.repeated, true, "a second tap changes nothing");
  assert.ok((await call(`/jobs/${jobId}`, { token: customer })).json.job.arrivedAt);
  assert.equal((await call(`/provider/jobs/${jobId}/start`, { token: pro.token, body: {} })).status, 200);

  // A stale fix doesn't count; and admin can switch the rule off.
  const second = await mkUser("cust_o6b", { wallet: 200000 });
  const next = (await book(second)).json.job.id as string;
  await call(`/provider/jobs/${next}/accept`, { token: pro.token, body: {} });
  await client.execute({ sql: "UPDATE work_jobs SET provider_lat = 0.3137, provider_lng = 32.5811, provider_located_at = datetime('now', '-20 minutes') WHERE id = ?", args: [next] });
  assert.equal((await call(`/provider/jobs/${next}/start`, { token: pro.token, body: {} })).json.error, "location_required");
  await setWorkSettings({ onsiteRequireLocation: false });
  assert.equal((await call(`/provider/jobs/${next}/start`, { token: pro.token, body: {} })).status, 200);
});

test("work: starting a job needs no location while on-site checks are off", async () => {
  const { call, mkUser, mkProvider, book } = await setup();
  const customer = await mkUser("cust_o7", { wallet: 200000 });
  const pro = await mkProvider("pro_o7");
  const jobId = (await book(customer)).json.job.id as string;
  await call(`/provider/jobs/${jobId}/accept`, { token: pro.token, body: {} });
  assert.equal((await call(`/provider/jobs/${jobId}/start`, { token: pro.token, body: {} })).status, 200);
});

test("work: gaps in the trail while on site are counted for the reviewer", () => {
  const home = { lat: 0.3136, lng: 32.5811 };
  const p = (min: number) => ({ lat: home.lat, lng: home.lng, accuracyM: 10, at: `2026-01-01 10:${String(min).padStart(2, "0")}:00` });
  const d = dwellAt([p(0), p(1), p(20), p(21)], home, 150);
  assert.equal(d.gaps, 1);
  assert.equal(d.longestGapMinutes, 19);
  assert.equal(dwellAt([p(0), p(1), p(2)], home, 150).gaps, 0);
});
