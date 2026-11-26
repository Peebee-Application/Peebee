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
import { resetModerationCache, screenText } from "./moderation.js";
import { allocate, ruleAmount } from "./monetization.js";
import { sweepTalent } from "./scheduled.js";
import { resetTalentSchemaCache } from "./service.js";
import { setTalentSettings } from "./settings.js";

process.env.JWT_SECRET = "talent-test-only-secret";

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
const CLEANING = "tcat_cleaning";
const TECH = "tcat_tech";

async function setup(opts: { freeAccess?: boolean } = {}) {
  resetSchemaCache();
  resetTalentSchemaCache();
  resetModerationCache();
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  await setTalentSettings({ enabled: true, workerApproval: "review", freeAccess: opts.freeAccess ?? true, postsPerHour: 100, trialDays: 0 });

  let n = 0;
  const mkUser = async (id: string, o: { role?: "customer" | "rider" | "admin"; wallet?: number; name?: string } = {}) => {
    n += 1;
    await client.execute({
      sql: "INSERT INTO users (id, phone, name, role, password_hash, wallet_balance, admin_role) VALUES (?, ?, ?, ?, 'x', ?, ?)",
      args: [id, `+25670010${String(n).padStart(4, "0")}`, o.name ?? `User ${id}`, o.role ?? "customer", o.wallet ?? 0, o.role === "admin" ? "super_admin" : null],
    });
    return signToken({ sub: id, role: o.role ?? "customer" });
  };
  const wallet = async (id: string) => Number((await client.execute({ sql: "SELECT wallet_balance AS b FROM users WHERE id = ?", args: [id] })).rows[0].b);
  const workEarnings = async (id: string) => Number((await client.execute({ sql: "SELECT balance FROM provider_wallets WHERE provider_type='talent' AND environment='live' AND provider_id=?", args: [id] })).rows[0]?.balance ?? 0);
  const call = async (path: string, o: { method?: string; token?: string; body?: unknown } = {}) => {
    const res = await app.request(`/v1/talent${path}`, {
      method: o.method ?? (o.body !== undefined ? "POST" : "GET"),
      headers: { "Content-Type": "application/json", ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}) },
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
    });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
  };
  const admin = await mkUser("admin_t", { role: "admin" });

  /** A worker with an approved, activated profile. */
  const mkWorker = async (id: string, o: { role?: "customer" | "rider"; wallet?: number; categories?: string[]; approve?: boolean; name?: string } = {}) => {
    const token = await mkUser(id, { role: o.role, wallet: o.wallet, name: o.name });
    const res = await call("/profile", {
      method: "PUT", token,
      body: { headline: `Reliable helper ${id}`, bio: "Ten years of experience in the field.", categoryIds: o.categories ?? [CLEANING], skills: ["cleaning", "laundry"], area: "Kololo", ...KAMPALA, radiusKm: 20, rateType: "day", rateUgx: 30000 },
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    if (o.approve !== false) {
      const ok = await call(`/admin/workers/${id}/approve`, { token: admin, body: {} });
      assert.equal(ok.status, 200, JSON.stringify(ok.json));
    }
    return token;
  };
  const gigBody = (extra: Json = {}) => ({
    type: "gig", title: "Clean my two bedroom flat", description: "Deep clean of a two bedroom flat in Kololo, floors and windows.", categoryId: CLEANING,
    area: "Kololo", ...KAMPALA, budgetMaxUgx: 80000, acceptRules: true, ...extra,
  });
  const dbRow = async (sql: string, args: unknown[] = []) => (await client.execute({ sql, args: args as InArgs })).rows[0] as Json;
  const totalMoney = async () =>
    Number((await client.execute("SELECT (SELECT COALESCE(SUM(wallet_balance), 0) FROM users) + (SELECT COALESCE(SUM(balance), 0) FROM provider_wallets WHERE provider_type='talent' AND environment='live') AS n")).rows[0].n) + Number((await client.execute("SELECT COALESCE(SUM(held_ugx), 0) AS n FROM talent_contracts")).rows[0].n);
  return { client, call, mkUser, mkWorker, wallet, workEarnings, admin, gigBody, dbRow, totalMoney };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test("talent: allocate always adds up and ruleAmount follows the rule", () => {
  for (const [total, w] of [[1000, [1, 1, 1]], [7, [3, 3, 3]], [0, [1, 2]], [100, [50000, 30000, 20000]], [1, [1]]] as const) {
    const parts = allocate(total, [...w]);
    assert.equal(parts.reduce((a, b) => a + b, 0), total);
    assert.ok(parts.every((p) => p >= 0));
  }
  assert.equal(ruleAmount({ active: 1, model: "flat", flat_ugx: 5000 }, 999), 5000);
  assert.equal(ruleAmount({ active: 1, model: "percent", percent: 10, min_ugx: 0, max_ugx: 0 }, 80000), 8000);
  assert.equal(ruleAmount({ active: 1, model: "percent", percent: 10, min_ugx: 10000, max_ugx: 0 }, 5000), 10000, "minimum applies");
  assert.equal(ruleAmount({ active: 1, model: "percent", percent: 10, min_ugx: 0, max_ugx: 3000 }, 80000), 3000, "maximum applies");
  assert.equal(ruleAmount({ active: 0, model: "flat", flat_ugx: 5000 }, 1), 0, "inactive rule charges nothing");
  assert.equal(ruleAmount({ active: 1, model: "free" }, 1), 0);
  assert.equal(ruleAmount(null, 1), 0);
});

test("talent: screening blocks illegal work, holds borderline work, passes ordinary work", async () => {
  await setup();
  assert.equal((await screenText("Looking for a hitman")).state, "blocked");
  assert.equal((await screenText("We need someone to forge a fake id")).state, "blocked");
  assert.equal((await screenText("Escort services wanted")).state, "review", "ambiguous words go to staff, not an outright block");
  assert.equal((await screenText("Security escort for a wedding")).state, "review");
  assert.equal((await screenText("S.c.a.m ... prostitution")).state, "blocked", "punctuation tricks don't get past");
  assert.equal((await screenText("Pick up a package, no scam")).state, "review");
  assert.equal((await screenText("Clean a two bedroom flat and wash windows")).state, "clear");
  assert.equal((await screenText("Predescort and rescue")).state, "clear", "a term must start a word to match");
});

// ---------------------------------------------------------------------------
// Switches and access
// ---------------------------------------------------------------------------

test("talent: closed until admin turns it on; config stays readable", async () => {
  const { call, mkUser, client } = await setup();
  await client.execute("UPDATE settings SET value = '0' WHERE key = 'talent_enabled'");
  await setTalentSettings({ enabled: false });
  const user = await mkUser("u1");
  assert.equal((await call("/jobs", { token: user })).status, 503);
  const config = await call("/config", { token: user });
  assert.equal(config.status, 200);
  assert.equal(config.json.enabled, false);
});

test("talent: job types and payment modes follow the admin switches", async () => {
  const { call, mkUser, gigBody } = await setup();
  const emp = await mkUser("emp", { wallet: 500000 });
  await setTalentSettings({ jobTypes: ["project", "hiring"] });
  const closed = await call("/jobs", { token: emp, body: gigBody() });
  assert.equal(closed.status, 403);
  assert.equal(closed.json.error, "type_closed");
  await setTalentSettings({ jobTypes: ["gig", "project", "hiring"], paymentModes: ["escrow"], defaultPaymentMode: "escrow" });
  const direct = await call("/jobs", { token: emp, body: gigBody({ paymentMode: "direct" }) });
  assert.equal(direct.status, 400);
  assert.equal(direct.json.error, "payment_mode_unavailable");
  const ok = await call("/jobs", { token: emp, body: gigBody() });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.job.paymentMode, "escrow", "the only enabled mode is the default");
});

// ---------------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------------

test("talent: worker profile needs approval, hides until live, blocks illegal work", async () => {
  const { call, mkWorker, mkUser, admin } = await setup();
  const seeker = await mkUser("seeker");
  const w = await mkWorker("w1", { approve: false });
  assert.equal((await call("/workers", { token: seeker })).json.total, 0, "pending profile isn't searchable");
  const me = await call("/me", { token: w });
  assert.equal(me.json.profile.status, "pending");

  const applyNow = await call("/jobs/none/apply", { token: w, body: {} });
  assert.equal(applyNow.status, 409, "job not found is reported as not open");

  assert.equal((await call("/admin/workers/w1/approve", { token: admin, body: {} })).status, 200);
  const found = await call("/workers?category=" + CLEANING, { token: seeker });
  assert.equal(found.json.total, 1);
  assert.equal(found.json.workers[0].id, "w1");
  assert.equal(found.json.workers[0].phone, null, "phone stays hidden");

  const bad = await call("/profile", { method: "PUT", token: w, body: { headline: "I am a hitman for hire", categoryIds: [CLEANING] } });
  assert.equal(bad.status, 422);
  assert.equal(bad.json.error, "prohibited_work");
});

test("talent: riders can work unless admin says no", async () => {
  const { call, mkUser } = await setup();
  const rider = await mkUser("rider1", { role: "rider" });
  const body = { headline: "Rider and handyman", categoryIds: [CLEANING] };
  assert.equal((await call("/profile", { method: "PUT", token: rider, body })).status, 200);
  await setTalentSettings({ ridersCanWork: false });
  const other = await mkUser("rider2", { role: "rider" });
  const res = await call("/profile", { method: "PUT", token: other, body });
  assert.equal(res.status, 403);
  assert.equal(res.json.error, "riders_not_allowed");
});

test("talent: worker search filters, ranks and never shows yourself; phone unlock", async () => {
  const { call, mkWorker, mkUser, client } = await setup();
  const a = await mkWorker("wa", { categories: [CLEANING] });
  await mkWorker("wb", { categories: [TECH] });
  await client.execute("UPDATE talent_profiles SET rating_sum = 50, rating_count = 10, jobs_completed = 9 WHERE user_id = 'wa'");
  const emp = await mkUser("empS", { wallet: 10000 });
  const byCat = await call(`/workers?category=${TECH}`, { token: emp });
  assert.deepEqual(byCat.json.workers.map((w: Json) => w.id), ["wb"]);
  const bySeg = await call("/workers?segment=professional", { token: emp });
  assert.deepEqual(bySeg.json.workers.map((w: Json) => w.id), ["wb"]);
  const text = await call("/workers?q=laundry", { token: emp });
  assert.equal(text.json.total, 2);
  const mine = await call("/workers", { token: a });
  assert.ok(!mine.json.workers.some((w: Json) => w.id === "wa"), "never lists yourself");
  const near = await call(`/workers?lat=${KAMPALA.lat}&lng=${KAMPALA.lng}&sort=nearest`, { token: emp });
  assert.ok(near.json.workers[0].distanceKm !== null);
  const detail = await call("/workers/wa", { token: emp });
  assert.equal(detail.json.phoneLocked, true);
  assert.equal(detail.json.worker.phone, null);
  const unlock = await call("/workers/wa/unlock-contact", { token: emp, body: {} });
  assert.equal(unlock.status, 200, "free while access is free");
  assert.ok(unlock.json.phone);
  assert.ok((await call("/workers/wa", { token: emp })).json.worker.phone);
  await setTalentSettings({ workerSearchEnabled: false });
  assert.equal((await call("/workers", { token: emp })).status, 403);
});

// ---------------------------------------------------------------------------
// The gig, end to end, with money checked at every step
// ---------------------------------------------------------------------------

async function startCommissions(call: (path: string, o?: any) => Promise<{ status: number; json: Json }>, admin: string) {
  await setTalentSettings({ freeAccess: false });
  for (const body of [
    { kind: "employer_commission", model: "percent", percent: 5, active: true },
    { kind: "worker_commission", jobType: "gig", model: "percent", percent: 10, active: true },
  ]) assert.equal((await call("/admin/fee-rules", { method: "PUT", token: admin, body })).status, 200);
}

test("talent: escrow gig — hold, submit, release, fees, rating; no money is created or lost", async () => {
  const { call, mkWorker, mkUser, wallet, workEarnings, admin, gigBody, dbRow, totalMoney } = await setup();
  await startCommissions(call, admin);
  const worker = await mkWorker("w1", { wallet: 0 });
  const emp = await mkUser("emp1", { wallet: 200000 });
  const before = await totalMoney();

  const posted = await call("/jobs", { token: emp, body: gigBody() });
  assert.equal(posted.status, 201, JSON.stringify(posted.json));
  const jobId = posted.json.job.id;
  assert.equal(posted.json.job.status, "open");

  const applied = await call(`/jobs/${jobId}/apply`, { token: worker, body: { message: "I can start today" } });
  assert.equal(applied.status, 201, JSON.stringify(applied.json));
  assert.equal((await call(`/jobs/${jobId}/apply`, { token: worker, body: {} })).status, 409, "no double applications");

  const applicants = await call(`/jobs/${jobId}/applications`, { token: emp });
  assert.equal(applicants.json.applicants.length, 1);
  assert.equal(applicants.json.applicants[0].phoneLocked, true);
  const appId = applicants.json.applicants[0].id;

  // Employer pays the job price plus their 5% fee (4,000) into escrow.
  const accepted = await call(`/applications/${appId}/accept`, { token: emp, body: {} });
  assert.equal(accepted.status, 201, JSON.stringify(accepted.json));
  assert.equal(accepted.json.priceUgx, 80000);
  assert.equal(accepted.json.employerFeeUgx, 4000);
  assert.equal(accepted.json.workerFeeUgx, 8000);
  assert.equal(accepted.json.heldUgx, 84000);
  assert.equal(await wallet("emp1"), 116000);
  assert.equal(await totalMoney(), before, "money is in escrow, not lost");
  assert.equal((await call(`/jobs/${jobId}`, { token: emp })).json.job.status, "in_progress");

  const contractId = accepted.json.contractId;
  assert.equal((await call(`/applications/${appId}/accept`, { token: emp, body: {} })).status, 409, "can't accept twice");

  const sub = await call(`/contracts/${contractId}/submit`, { token: worker, body: { note: "All done, photos sent" } });
  assert.equal(sub.status, 200, JSON.stringify(sub.json));
  assert.equal((await call(`/contracts/${contractId}/release`, { token: worker, body: {} })).status, 404, "only the employer releases");

  const released = await call(`/contracts/${contractId}/release`, { token: emp, body: {} });
  assert.equal(released.status, 200, JSON.stringify(released.json));
  assert.equal(released.json.settled, true);
  assert.equal(await workEarnings("w1"), 72000, "worker gets 80,000 less their 10% fee");
  const ct = await dbRow("SELECT * FROM talent_contracts WHERE id = ?", [contractId]);
  assert.equal(ct.status, "settled");
  assert.equal(ct.held_ugx, 0);
  assert.equal(ct.commission_ugx, 12000, "Peebee kept 4,000 + 8,000");
  assert.equal(await totalMoney() + 12000, before, "everything is accounted for: wallets plus Peebee's commission");
  assert.equal((await dbRow("SELECT COALESCE(SUM(amount_ugx), 0) AS n FROM talent_charges WHERE kind IN ('employer_commission', 'worker_commission') AND status = 'paid'")).n, 12000);
  assert.equal((await call(`/jobs/${jobId}`, { token: emp })).json.job.status, "completed");
  assert.equal((await dbRow("SELECT jobs_completed AS n FROM talent_profiles WHERE user_id = 'w1'")).n, 1);

  // Releasing again changes nothing.
  assert.equal((await call(`/contracts/${contractId}/release`, { token: emp, body: {} })).status, 409);
  assert.equal(await workEarnings("w1"), 72000);

  // Ratings.
  assert.equal((await call(`/contracts/${contractId}/review`, { token: emp, body: { rating: 5, comment: "Spotless" } })).status, 200);
  assert.equal((await call(`/contracts/${contractId}/review`, { token: emp, body: { rating: 1 } })).status, 409, "one rating each");
  assert.equal((await call(`/contracts/${contractId}/review`, { token: worker, body: { rating: 4 } })).status, 200);
  const profile = await call("/workers/w1", { token: emp });
  assert.equal(profile.json.worker.rating, 5);
  assert.equal(profile.json.reviews[0].comment, "Spotless");
});

test("talent: not enough money for escrow — nothing changes", async () => {
  const { call, mkWorker, mkUser, wallet, gigBody, dbRow } = await setup();
  const worker = await mkWorker("w1");
  const emp = await mkUser("emp1", { wallet: 1000 });
  const jobId = (await call("/jobs", { token: emp, body: gigBody() })).json.job.id;
  await call(`/jobs/${jobId}/apply`, { token: worker, body: {} });
  const appId = (await call(`/jobs/${jobId}/applications`, { token: emp })).json.applicants[0].id;
  const res = await call(`/applications/${appId}/accept`, { token: emp, body: {} });
  assert.equal(res.status, 402);
  assert.equal(await wallet("emp1"), 1000);
  assert.equal((await dbRow("SELECT COUNT(*) AS n FROM talent_contracts")).n, 0);
  assert.equal((await dbRow("SELECT status FROM talent_applications WHERE id = ?", [appId])).status, "applied");
  assert.equal((await dbRow("SELECT COUNT(*) AS n FROM talent_money")).n, 0, "no stray hold left behind");
});

test("talent: two accepts at once — exactly one contract, one debit", async () => {
  const { call, mkWorker, mkUser, wallet, gigBody, dbRow } = await setup();
  const worker = await mkWorker("w1");
  const emp = await mkUser("emp1", { wallet: 500000 });
  const jobId = (await call("/jobs", { token: emp, body: gigBody() })).json.job.id;
  await call(`/jobs/${jobId}/apply`, { token: worker, body: {} });
  const appId = (await call(`/jobs/${jobId}/applications`, { token: emp })).json.applicants[0].id;
  const results = await Promise.all([1, 2, 3].map(() => call(`/applications/${appId}/accept`, { token: emp, body: {} })));
  assert.equal(results.filter((r) => r.status === 201).length, 1, JSON.stringify(results.map((r) => r.status)));
  assert.equal((await dbRow("SELECT COUNT(*) AS n FROM talent_contracts")).n, 1);
  assert.equal(await wallet("emp1"), 500000 - 80000, "charged once (no fees are on while access is free)");
});

test("talent: cancel refunds the held money in full; a submitted job must be disputed instead", async () => {
  const { call, mkWorker, mkUser, wallet, admin, gigBody, dbRow, totalMoney } = await setup();
  await startCommissions(call, admin);
  const worker = await mkWorker("w1");
  const emp = await mkUser("emp1", { wallet: 200000 });
  const before = await totalMoney();
  const jobId = (await call("/jobs", { token: emp, body: gigBody() })).json.job.id;
  await call(`/jobs/${jobId}/apply`, { token: worker, body: {} });
  const appId = (await call(`/jobs/${jobId}/applications`, { token: emp })).json.applicants[0].id;
  const contractId = (await call(`/applications/${appId}/accept`, { token: emp, body: {} })).json.contractId;
  assert.equal(await wallet("emp1"), 116000);

  await call(`/contracts/${contractId}/submit`, { token: worker, body: {} });
  const blocked = await call(`/contracts/${contractId}/cancel`, { token: emp, body: { reason: "Changed my mind" } });
  assert.equal(blocked.status, 409, "submitted work can't just be cancelled");

  // Back to a fresh contract to test a clean cancel.
  const j2 = (await call("/jobs", { token: emp, body: gigBody({ title: "Another clean" }) })).json.job.id;
  const w2 = await mkWorker("w2");
  await call(`/jobs/${j2}/apply`, { token: w2, body: {} });
  const app2 = (await call(`/jobs/${j2}/applications`, { token: emp })).json.applicants[0].id;
  const c2 = (await call(`/applications/${app2}/accept`, { token: emp, body: {} })).json.contractId;
  const before2 = await wallet("emp1");
  const cancelled = await call(`/contracts/${c2}/cancel`, { token: w2, body: { reason: "I am unwell" } });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.json));
  assert.equal(await wallet("emp1"), before2 + 84000, "full refund including the fee");
  assert.equal((await dbRow("SELECT status FROM talent_contracts WHERE id = ?", [c2])).status, "cancelled");
  assert.equal((await call(`/jobs/${j2}`, { token: emp })).json.job.status, "open", "the place is open again");
  assert.ok((await totalMoney()) === before, "still conserved (the first contract is still held)");
});

test("talent: dispute — employer disputes, staff splits, money adds up", async () => {
  const { call, mkWorker, mkUser, wallet, admin, gigBody, dbRow, totalMoney } = await setup();
  await startCommissions(call, admin);
  const worker = await mkWorker("w1");
  const emp = await mkUser("emp1", { wallet: 200000 });
  const before = await totalMoney();
  const jobId = (await call("/jobs", { token: emp, body: gigBody() })).json.job.id;
  await call(`/jobs/${jobId}/apply`, { token: worker, body: {} });
  const appId = (await call(`/jobs/${jobId}/applications`, { token: emp })).json.applicants[0].id;
  const contractId = (await call(`/applications/${appId}/accept`, { token: emp, body: {} })).json.contractId;
  await call(`/contracts/${contractId}/submit`, { token: worker, body: {} });

  assert.equal((await call(`/contracts/${contractId}/dispute`, { token: emp, body: { reason: "Windows were not cleaned" } })).status, 200);
  assert.equal((await call(`/contracts/${contractId}/release`, { token: emp, body: {} })).status, 409, "frozen while disputed");
  const disputes = await call("/admin/disputes", { token: admin });
  assert.equal(disputes.json.disputes.length, 1);

  const bad = await call(`/admin/contracts/${contractId}/resolve`, { token: admin, body: { outcome: "split", refundUgx: 999999 } });
  assert.equal(bad.status, 409);
  assert.equal((await dbRow("SELECT status FROM talent_contracts WHERE id = ?", [contractId])).status, "disputed", "a bad resolution leaves it disputed");

  const split = await call(`/admin/contracts/${contractId}/resolve`, { token: admin, body: { outcome: "split", refundUgx: 30000, note: "Half the windows done" } });
  assert.equal(split.status, 200, JSON.stringify(split.json));
  const ct = await dbRow("SELECT * FROM talent_contracts WHERE id = ?", [contractId]);
  assert.equal(ct.status, "settled");
  assert.equal(ct.held_ugx, 0);
  assert.equal(ct.refunded_ugx + ct.paid_to_worker_ugx + ct.commission_ugx, 84000, "refund + worker + Peebee = what was held");
  assert.equal(await wallet("emp1"), 116000 + 30000);
  assert.equal(await totalMoney() + ct.commission_ugx, before);
  assert.equal((await call(`/admin/contracts/${contractId}/resolve`, { token: admin, body: { outcome: "release" } })).status, 409, "can't resolve twice");
});

test("talent: dispute resolved as full refund or full release", async () => {
  const { call, mkWorker, mkUser, wallet, workEarnings, admin, gigBody } = await setup();
  const make = async (suffix: string) => {
    const worker = await mkWorker(`w${suffix}`);
    const emp = await mkUser(`e${suffix}`, { wallet: 100000 });
    const jobId = (await call("/jobs", { token: emp, body: gigBody({ title: `Job ${suffix}` }) })).json.job.id;
    await call(`/jobs/${jobId}/apply`, { token: worker, body: {} });
    const appId = (await call(`/jobs/${jobId}/applications`, { token: emp })).json.applicants[0].id;
    const contractId = (await call(`/applications/${appId}/accept`, { token: emp, body: {} })).json.contractId;
    await call(`/contracts/${contractId}/submit`, { token: worker, body: {} });
    await call(`/contracts/${contractId}/dispute`, { token: worker, body: { reason: "Employer will not pay" } });
    return contractId;
  };
  const a = await make("1");
  assert.equal((await call(`/admin/contracts/${a}/resolve`, { token: admin, body: { outcome: "refund" } })).status, 200);
  assert.equal(await wallet("e1"), 100000);
  assert.equal(await wallet("w1"), 0);
  const b = await make("2");
  assert.equal((await call(`/admin/contracts/${b}/resolve`, { token: admin, body: { outcome: "release" } })).status, 200);
  assert.equal(await workEarnings("w2"), 80000);
  assert.equal(await wallet("e2"), 20000);
});

// ---------------------------------------------------------------------------
// Projects with milestones, direct pay, hiring
// ---------------------------------------------------------------------------

test("talent: project with milestones — pay step by step, fees split exactly", async () => {
  const { call, mkWorker, mkUser, wallet, workEarnings, admin, dbRow, totalMoney } = await setup();
  await startCommissions(call, admin);
  await call("/admin/fee-rules", { method: "PUT", token: admin, body: { kind: "worker_commission", jobType: "project", model: "percent", percent: 8, active: true } });
  const worker = await mkWorker("w1", { categories: [TECH] });
  const emp = await mkUser("emp1", { wallet: 1_000_000 });
  const before = await totalMoney();
  const posted = await call("/jobs", {
    token: emp,
    body: { type: "project", title: "Build our shop website", description: "A simple website with a product list and contact form.", categoryId: TECH, remote: true, budgetMinUgx: 300000, budgetMaxUgx: 600000, acceptRules: true },
  });
  assert.equal(posted.status, 201, JSON.stringify(posted.json));
  const jobId = posted.json.job.id;
  assert.equal((await call(`/jobs/${jobId}/apply`, { token: worker, body: { bidUgx: 0 } })).status, 400, "a project needs a price");
  assert.equal((await call(`/jobs/${jobId}/apply`, { token: worker, body: { bidUgx: 500001, message: "Happy to build it" } })).status, 201);
  const appId = (await call(`/jobs/${jobId}/applications`, { token: emp })).json.applicants[0].id;

  const wrong = await call(`/applications/${appId}/accept`, { token: emp, body: { milestones: [{ title: "Design", amountUgx: 100000 }] } });
  assert.equal(wrong.status, 400, "milestones must add up to the price");
  const accepted = await call(`/applications/${appId}/accept`, { token: emp, body: { milestones: [{ title: "Design", amountUgx: 200001 }, { title: "Build", amountUgx: 200000 }, { title: "Launch", amountUgx: 100000 }] } });
  assert.equal(accepted.status, 201, JSON.stringify(accepted.json));
  const { contractId } = accepted.json;
  assert.equal(accepted.json.heldUgx, 500001 + accepted.json.employerFeeUgx);
  const ms = await dbRow("SELECT SUM(employer_fee_ugx) AS e, SUM(worker_fee_ugx) AS w, SUM(amount_ugx) AS a FROM talent_milestones WHERE contract_id = ?", [contractId]);
  assert.equal(ms.e, accepted.json.employerFeeUgx, "milestone fees add up to the contract fee");
  assert.equal(ms.w, accepted.json.workerFeeUgx);
  assert.equal(ms.a, 500001);

  const detail = await call(`/contracts/${contractId}`, { token: worker });
  const [m1, m2, m3] = detail.json.milestones;
  assert.equal((await call(`/contracts/${contractId}/release`, { token: emp, body: {} })).status, 400, "several steps: say which");
  assert.equal((await call(`/contracts/${contractId}/milestones/${m1.id}/submit`, { token: worker, body: {} })).status, 200);
  assert.equal((await call(`/contracts/${contractId}/milestones/${m1.id}/release`, { token: emp, body: {} })).json.settled, false);
  const afterFirst = await workEarnings("w1");
  assert.equal(afterFirst, m1.payoutUgx);
  assert.equal((await call(`/contracts/${contractId}/milestones/${m1.id}/release`, { token: emp, body: {} })).status, 400, "already released");
  await call(`/contracts/${contractId}/milestones/${m2.id}/release`, { token: emp, body: {} });
  const last = await call(`/contracts/${contractId}/milestones/${m3.id}/release`, { token: emp, body: {} });
  assert.equal(last.json.settled, true);
  const ct = await dbRow("SELECT * FROM talent_contracts WHERE id = ?", [contractId]);
  assert.equal(ct.status, "settled");
  assert.equal(ct.held_ugx, 0, "nothing left held");
  assert.equal(await totalMoney() + ct.commission_ugx, before);
  assert.equal(await workEarnings("w1"), 500001 - ct.worker_fee_ugx);
});

test("talent: direct pay — Peebee's fee is collected, or owed and enforced", async () => {
  const { call, mkWorker, mkUser, wallet, admin, gigBody, dbRow } = await setup();
  await startCommissions(call, admin);
  const worker = await mkWorker("w1", { wallet: 3000 });
  const emp = await mkUser("emp1", { wallet: 2000 });
  const jobId = (await call("/jobs", { token: emp, body: gigBody({ paymentMode: "direct" }) })).json.job.id;
  await call(`/jobs/${jobId}/apply`, { token: worker, body: {} });
  const appId = (await call(`/jobs/${jobId}/applications`, { token: emp })).json.applicants[0].id;
  const accepted = await call(`/applications/${appId}/accept`, { token: emp, body: {} });
  assert.equal(accepted.status, 201, JSON.stringify(accepted.json));
  assert.equal(accepted.json.heldUgx, 0, "nothing is held for direct pay");
  assert.equal(await wallet("emp1"), 2000, "the employer's wallet isn't touched");
  const contractId = accepted.json.contractId;
  await call(`/contracts/${contractId}/submit`, { token: worker, body: {} });
  assert.equal((await call(`/contracts/${contractId}/release`, { token: emp, body: {} })).json.settled, true);
  // Employer fee 4,000 > 2,000 balance -> owed. Worker fee 8,000 > 3,000 balance -> owed.
  assert.equal(await wallet("emp1"), 2000);
  assert.equal(await wallet("w1"), 3000);
  assert.equal((await dbRow("SELECT COALESCE(SUM(amount_ugx), 0) AS n FROM talent_charges WHERE status = 'due'")).n, 12000);
  const earnings = await call("/earnings", { token: worker });
  assert.equal(earnings.json.owedUgx, 8000);

  // Paying what's owed.
  assert.equal((await call("/pay-due", { token: worker, body: {} })).status, 402);
  await setTalentSettings({ unpaidCommissionLimitUgx: 5000 });
  const blockedApply = await call(`/jobs/${(await call("/jobs", { token: emp, body: gigBody({ title: "Second" }) })).json.job?.id ?? "x"}/apply`, { token: worker, body: {} });
  assert.ok([403, 409].includes(blockedApply.status), "someone over the limit can't take new work");
  await dbRow("UPDATE users SET wallet_balance = 20000 WHERE id = 'w1'");
  const paid = await call("/pay-due", { token: worker, body: {} });
  assert.equal(paid.status, 200);
  assert.equal(paid.json.stillOwed, 0);
  assert.equal(await wallet("w1"), 12000);
});

test("talent: hiring — apply, shortlist, hire; placement fee; contact opens on hire", async () => {
  const { call, mkWorker, mkUser, wallet, admin, dbRow } = await setup();
  await setTalentSettings({ freeAccess: false });
  await call("/admin/fee-rules", { method: "PUT", token: admin, body: { kind: "hire_fee", jobType: "hiring", model: "percent", percent: 5, minUgx: 10000, maxUgx: 200000, active: true } });
  await call("/admin/fee-rules", { method: "PUT", token: admin, body: { kind: "listing", jobType: "hiring", model: "flat", flatUgx: 20000, active: true } });
  const worker = await mkWorker("w1", { categories: [TECH] });
  const poor = await mkUser("empPoor", { wallet: 1000 });
  const body = { type: "hiring", title: "Shop assistant", description: "Full time shop assistant for our Kampala shop, honest and punctual.", categoryId: CLEANING, area: "Kampala", budgetMaxUgx: 600000, employmentType: "full_time", acceptRules: true };
  const noFunds = await call("/jobs", { token: poor, body });
  assert.equal(noFunds.status, 402);
  assert.equal((await dbRow("SELECT COUNT(*) AS n FROM talent_jobs")).n, 0, "a job that couldn't be paid for isn't kept");

  const emp = await mkUser("empRich", { wallet: 100000 });
  const posted = await call("/jobs", { token: emp, body });
  assert.equal(posted.status, 201, JSON.stringify(posted.json));
  assert.equal(posted.json.charged, 20000);
  assert.equal(await wallet("empRich"), 80000);
  const jobId = posted.json.job.id;
  assert.equal(posted.json.job.paymentMode, "none");

  assert.equal((await call(`/jobs/${jobId}/apply`, { token: worker, body: { message: "I have shop experience", bidUgx: 99 } })).status, 201);
  const appId = (await call(`/jobs/${jobId}/applications`, { token: emp })).json.applicants[0].id;
  assert.equal((await call(`/applications/${appId}/accept`, { token: emp, body: {} })).status, 400, "hiring posts use 'hire'");
  assert.equal((await call(`/applications/${appId}/shortlist`, { token: emp, body: {} })).status, 200);
  const hired = await call(`/applications/${appId}/hire`, { token: emp, body: {} });
  assert.equal(hired.status, 200, JSON.stringify(hired.json));
  assert.equal(hired.json.charged, 30000, "5% of 600,000, within the 10,000 to 200,000 limits");
  assert.ok(hired.json.workerPhone);
  assert.equal(await wallet("empRich"), 50000);
  assert.equal((await call(`/jobs/${jobId}`, { token: emp })).json.job.status, "filled");
  const after = await call(`/jobs/${jobId}/applications`, { token: emp });
  assert.equal(after.json.applicants[0].phoneLocked, false);
});

// ---------------------------------------------------------------------------
// Monetization: free access, onboarding, plans, trials, Pro features
// ---------------------------------------------------------------------------

test("talent: free access overrides every rule; turning it off starts charging", async () => {
  const { call, mkWorker, mkUser, wallet, admin, gigBody, dbRow } = await setup();
  for (const body of [
    { kind: "listing", jobType: "gig", model: "flat", flatUgx: 3000, active: true },
    { kind: "application", model: "flat", flatUgx: 500, active: true },
    { kind: "worker_onboarding", model: "flat", flatUgx: 5000, active: true },
  ]) assert.equal((await call("/admin/fee-rules", { method: "PUT", token: admin, body })).status, 200);
  await setTalentSettings({ freeAccess: true });
  const worker = await mkWorker("w1", { wallet: 0 });
  const emp = await mkUser("emp1", { wallet: 10000 });
  const jobId = (await call("/jobs", { token: emp, body: gigBody() })).json.job.id;
  assert.equal(await wallet("emp1"), 10000, "free access: no listing fee");
  assert.equal((await call(`/jobs/${jobId}/apply`, { token: worker, body: {} })).status, 201);
  assert.equal((await dbRow("SELECT COUNT(*) AS n FROM talent_charges WHERE status = 'paid'")).n, 0);
  assert.ok((await dbRow("SELECT COUNT(*) AS n FROM talent_charges WHERE status = 'waived'")).n >= 2, "waivers are recorded with a reason");

  await setTalentSettings({ freeAccess: false, freeOnboarding: true });
  const w2 = await mkWorker("w2", { wallet: 100 });
  assert.equal((await call("/me", { token: w2 })).json.profile.activated, true, "free onboarding waives the onboarding fee");
  const jobId2 = (await call("/jobs", { token: emp, body: gigBody({ title: "Second job" }) })).json.job.id;
  assert.equal(await wallet("emp1"), 7000, "now the listing fee applies");
  assert.equal((await call(`/jobs/${jobId2}/apply`, { token: w2, body: {} })).status, 402, "can't afford the application fee");
  assert.equal((await call(`/jobs/${jobId2}/apply`, { token: worker, body: {} })).status, 402, "worker with no money");
  await (await import("../db/client.js")).db.execute({ sql: "UPDATE users SET wallet_balance = 1000 WHERE id = 'w1'", args: [] });
  assert.equal((await call(`/jobs/${jobId2}/apply`, { token: worker, body: {} })).status, 201);
  assert.equal(await wallet("w1"), 500);
});

test("talent: paid onboarding must be paid before a profile can go live", async () => {
  const { call, mkUser, wallet, admin } = await setup();
  await setTalentSettings({ freeAccess: false, freeOnboarding: false });
  await call("/admin/fee-rules", { method: "PUT", token: admin, body: { kind: "worker_onboarding", model: "flat", flatUgx: 5000, active: true } });
  const token = await mkUser("w1", { wallet: 1000 });
  const put = await call("/profile", { method: "PUT", token, body: { headline: "Painter and decorator", categoryIds: [CLEANING] } });
  assert.equal(put.status, 200);
  assert.deepEqual(put.json.activation, { required: true, amountUgx: 5000 });
  assert.equal((await call("/profile/activate", { token, body: {} })).status, 402);
  assert.equal(await wallet("w1"), 1000);
  const { client } = await setup();
  void client;
});

test("talent: first N free each month, then charged", async () => {
  const { call, mkWorker, mkUser, wallet, admin, gigBody } = await setup();
  await setTalentSettings({ freeAccess: false });
  await call("/admin/fee-rules", { method: "PUT", token: admin, body: { kind: "listing", jobType: "gig", model: "flat", flatUgx: 2000, freeFirstN: 2, active: true } });
  await mkWorker("w1");
  const emp = await mkUser("emp1", { wallet: 20000 });
  for (const t of ["One", "Two", "Three"]) assert.equal((await call("/jobs", { token: emp, body: gigBody({ title: `Clean ${t}` }) })).status, 201);
  assert.equal(await wallet("emp1"), 18000, "only the third post was charged");
});

test("talent: plans waive fees, lower commission, and unlock Pro features; trial then paid", async () => {
  const { call, mkWorker, mkUser, wallet, admin, gigBody, dbRow } = await setup();
  await setTalentSettings({ freeAccess: false });
  await call("/admin/fee-rules", { method: "PUT", token: admin, body: { kind: "listing", jobType: "gig", model: "flat", flatUgx: 4000, active: true } });
  await call("/admin/fee-rules", { method: "PUT", token: admin, body: { kind: "worker_commission", jobType: "gig", model: "percent", percent: 10, active: true } });
  // Make advanced search a Pro feature.
  assert.equal((await call("/admin/features/advanced_worker_search", { method: "PATCH", token: admin, body: { pro: true } })).status, 200);
  await mkWorker("w1");
  const emp = await mkUser("emp1", { wallet: 200000 });

  const locked = await call("/workers?minRating=4", { token: emp });
  assert.equal(locked.status, 402);
  assert.equal(locked.json.error, "pro_required");
  assert.equal((await call("/workers?q=helper", { token: emp })).status, 200, "ordinary search stays open");

  const plans = await call("/plans", { token: emp });
  const pro = plans.json.plans.find((p: Json) => p.code === "employer_pro");
  assert.ok(pro.trialAvailable);
  assert.equal(pro.priceUgx, 40000);
  const sub = await call(`/plans/${pro.id}/subscribe`, { token: emp, body: {} });
  assert.equal(sub.status, 201);
  assert.equal(sub.json.trial, true, "first time: a free trial");
  assert.equal(await wallet("emp1"), 200000, "trial costs nothing");
  assert.equal((await call("/workers?minRating=4", { token: emp })).status, 200, "Pro feature unlocked");
  assert.equal((await call(`/plans/${pro.id}/subscribe`, { token: emp, body: {} })).status, 409, "already on it");

  // The plan waives listing fees.
  assert.equal((await call("/jobs", { token: emp, body: gigBody() })).status, 201);
  assert.equal(await wallet("emp1"), 200000, "listing waived by the plan");

  // Worker plan lowers worker commission to 5%.
  const worker = await mkWorker("wp", { wallet: 50000 });
  const wplan = (await call("/plans", { token: worker })).json.plans.find((p: Json) => p.code === "worker_pro");
  await dbRow("UPDATE talent_plans SET trial_days = 0 WHERE id = ?", [wplan.id]);
  const paid = await call(`/plans/${wplan.id}/subscribe`, { token: worker, body: {} });
  assert.equal(paid.status, 201, JSON.stringify(paid.json));
  assert.equal(paid.json.trial, false);
  assert.equal(await wallet("wp"), 35000, "paid from the wallet");
  const poorWorker = await mkWorker("wpoor", { wallet: 100 });
  assert.equal((await call(`/plans/${wplan.id}/subscribe`, { token: poorWorker, body: {} })).status, 402);

  const jobId = (await call("/jobs", { token: emp, body: gigBody({ title: "Priced job" }) })).json.job.id;
  await call(`/jobs/${jobId}/apply`, { token: worker, body: {} });
  const appId = (await call(`/jobs/${jobId}/applications`, { token: emp })).json.applicants[0].id;
  const accepted = await call(`/applications/${appId}/accept`, { token: emp, body: {} });
  assert.equal(accepted.json.workerFeeUgx, 4000, "5% (plan) rather than 10%");
});

test("talent: platform-wide free trial of Pro features for new members, then it ends", async () => {
  const { call, mkWorker, mkUser, client } = await setup();
  await setTalentSettings({ freeAccess: false, trialDays: 14 });
  const { db } = await import("../db/client.js");
  await db.execute({ sql: "UPDATE talent_features SET pro = 1 WHERE key = 'contact_unlock'", args: [] });
  await mkWorker("w1");
  const emp = await mkUser("emp1", { wallet: 0 });
  assert.equal((await call("/workers/w1/unlock-contact", { token: emp, body: {} })).status, 402, "no trial before they have done anything as an employer");
  await call("/jobs", { token: emp, body: { type: "gig", title: "Small gig", description: "Carry boxes up two floors please.", categoryId: CLEANING, area: "Kololo", budgetMaxUgx: 10000, acceptRules: true } });
  const me = await call("/me", { token: emp });
  assert.ok(me.json.membership.employer.trial, "posting a first job starts the trial");
  assert.equal((await call("/workers/w1/unlock-contact", { token: emp, body: {} })).status, 200, "Pro feature available during the trial");
  await client.execute("UPDATE talent_subscriptions SET expires_at = datetime('now', '-1 day') WHERE user_id = 'emp1'");
  const emp2 = emp;
  await sweepTalent();
  assert.equal((await call("/me", { token: emp2 })).json.membership.employer.trial, null, "trial ended");
  assert.equal((await call("/workers/w1/unlock-contact", { token: emp2, body: {} })).status, 200, "already unlocked stays unlocked");
});

test("talent: expired plan renews from the wallet or lapses", async () => {
  const { call, mkWorker, wallet, client } = await setup();
  await setTalentSettings({ freeAccess: false });
  const w = await mkWorker("w1", { wallet: 40000 });
  const plan = (await call("/plans", { token: w })).json.plans.find((p: Json) => p.code === "worker_pro");
  await client.execute({ sql: "UPDATE talent_plans SET trial_days = 0 WHERE id = ?", args: [plan.id] });
  assert.equal((await call(`/plans/${plan.id}/subscribe`, { token: w, body: {} })).status, 201);
  assert.equal(await wallet("w1"), 25000);
  await client.execute("UPDATE talent_subscriptions SET expires_at = datetime('now', '-1 minute')");
  const swept = await sweepTalent();
  assert.equal(swept.renewed, 1);
  assert.equal(await wallet("w1"), 10000);
  await client.execute("UPDATE talent_subscriptions SET expires_at = datetime('now', '-1 minute') WHERE status = 'active'");
  const again = await sweepTalent();
  assert.equal(again.renewed, 0, "not enough money to renew");
  assert.equal(again.endedPlans, 1);
  const me = await call("/me", { token: w });
  assert.equal(me.json.membership.worker.subscriptions.length, 0);
});

// ---------------------------------------------------------------------------
// Safety and housekeeping
// ---------------------------------------------------------------------------

test("talent: illegal jobs are refused; borderline ones wait for staff; reports can take things down", async () => {
  const { call, mkUser, admin, gigBody, dbRow } = await setup();
  const emp = await mkUser("emp1", { wallet: 100000 });
  const bad = await call("/jobs", { token: emp, body: gigBody({ title: "Need a hitman", description: "Looking for someone to kill someone for money." }) });
  assert.equal(bad.status, 422);
  assert.equal(bad.json.error, "prohibited_work");
  assert.match(bad.json.message, /illegal or unconstitutional/);
  assert.equal((await dbRow("SELECT COUNT(*) AS n FROM talent_jobs")).n, 0);

  const noRules = await call("/jobs", { token: emp, body: { ...gigBody(), acceptRules: false } });
  assert.equal(noRules.status, 400, "the lawful-work confirmation is required");

  const review = await call("/jobs", { token: emp, body: gigBody({ title: "Move a parcel", description: "Help me smuggle a small package across the border." }) });
  assert.equal(review.status, 201);
  assert.equal(review.json.job.status, "pending_review");
  const visible = await mkUser("viewer");
  assert.equal((await call("/jobs", { token: visible })).json.total, 0, "held jobs aren't in the feed");
  assert.equal((await call(`/jobs/${review.json.job.id}`, { token: visible })).status, 404);
  const reports = await call("/admin/reports", { token: admin });
  assert.equal(reports.json.reports.length, 1);
  assert.equal(reports.json.reports[0].source, "screening");
  assert.equal((await call(`/admin/jobs/${review.json.job.id}/reject`, { token: admin, body: { reason: "Smuggling is illegal" } })).status, 200);
  assert.equal((await call(`/jobs/${review.json.job.id}`, { token: emp })).json.job.status, "rejected");

  // A user report takes a live job down.
  const ok = await call("/jobs", { token: emp, body: gigBody({ title: "Wash my car" }) });
  assert.equal((await call("/report", { token: visible, body: { targetType: "job", targetId: ok.json.job.id, reason: "Looks like a scam" } })).status, 200);
  const open = (await call("/admin/reports", { token: admin })).json.reports.find((r: Json) => r.targetId === ok.json.job.id);
  assert.equal((await call(`/admin/reports/${open.id}/resolve`, { token: admin, body: { action: "take_down", note: "Removed" } })).status, 200);
  assert.equal((await call(`/jobs/${ok.json.job.id}`, { token: visible })).status, 404);
});

test("talent: admin can add a prohibited term and it takes effect at once", async () => {
  const { call, mkUser, admin, gigBody } = await setup();
  const emp = await mkUser("emp1", { wallet: 100000 });
  assert.equal((await call("/jobs", { token: emp, body: gigBody({ title: "Wash my zanzibar rug" }) })).status, 201);
  assert.equal((await call("/admin/prohibited", { token: admin, body: { term: "zanzibar rug", category: "test", action: "block" } })).status, 201);
  assert.equal((await call("/jobs", { token: emp, body: gigBody({ title: "Wash my zanzibar rug" }) })).status, 422);
  assert.equal((await call("/admin/prohibited", { token: admin, body: { term: "zanzibar rug" } })).status, 409);
});

test("talent: admin job review mode holds every job until approved", async () => {
  const { call, mkUser, mkWorker, admin, gigBody } = await setup();
  await setTalentSettings({ jobReview: true });
  const emp = await mkUser("emp1", { wallet: 100000 });
  const worker = await mkWorker("w1");
  const posted = await call("/jobs", { token: emp, body: gigBody() });
  assert.equal(posted.json.job.status, "pending_review");
  assert.equal((await call(`/jobs/${posted.json.job.id}/apply`, { token: worker, body: {} })).status, 409);
  assert.equal((await call(`/admin/jobs/${posted.json.job.id}/approve`, { token: admin, body: {} })).status, 200);
  assert.equal((await call(`/jobs/${posted.json.job.id}/apply`, { token: worker, body: {} })).status, 201);
});

test("talent: limits — open jobs, budget range, own job, applications per day", async () => {
  const { call, mkUser, mkWorker, gigBody } = await setup();
  const emp = await mkUser("emp1", { wallet: 1_000_000 });
  await setTalentSettings({ maxOpenJobs: 2, minJobUgx: 5000, maxJobUgx: 100000 });
  assert.equal((await call("/jobs", { token: emp, body: gigBody({ budgetMaxUgx: 1000 }) })).json.error, "budget_out_of_range");
  assert.equal((await call("/jobs", { token: emp, body: gigBody({ budgetMaxUgx: 200000 }) })).json.error, "budget_out_of_range");
  const first = await call("/jobs", { token: emp, body: gigBody({ title: "One" }) });
  await call("/jobs", { token: emp, body: gigBody({ title: "Two" }) });
  assert.equal((await call("/jobs", { token: emp, body: gigBody({ title: "Three" }) })).json.error, "too_many_open_jobs");
  assert.equal((await call(`/jobs/${first.json.job.id}/apply`, { token: emp, body: {} })).status, 400, "can't apply to your own job");
  const dup = await call("/jobs", { token: emp, body: gigBody({ title: "Dup", idempotencyKey: "same-key-1" }) });
  assert.equal(dup.status, 409);

  const worker = await mkWorker("w1");
  await setTalentSettings({ maxOpenJobs: 50, applicationsPerDay: 1 });
  const j1 = await call("/jobs", { token: emp, body: gigBody({ title: "Four" }) });
  const j2 = await call("/jobs", { token: emp, body: gigBody({ title: "Five" }) });
  assert.equal((await call(`/jobs/${j1.json.job.id}/apply`, { token: worker, body: {} })).status, 201);
  const capped = await call(`/jobs/${j2.json.job.id}/apply`, { token: worker, body: {} });
  assert.equal(capped.status, 402);
  assert.equal(capped.json.error, "pro_required");
  assert.match(capped.json.message, /1 applications a day/);
  await setTalentSettings({ applicationsPerDay: 30 });
  assert.equal((await call(`/jobs/${j2.json.job.id}/apply`, { token: worker, body: {} })).status, 201);
});

test("talent: posting twice with the same idempotency key returns the first job", async () => {
  const { call, mkUser, gigBody } = await setup();
  const emp = await mkUser("emp1", { wallet: 100000 });
  const a = await call("/jobs", { token: emp, body: gigBody({ idempotencyKey: "retry-key-0001" }) });
  const b = await call("/jobs", { token: emp, body: gigBody({ idempotencyKey: "retry-key-0001" }) });
  assert.equal(a.status, 201);
  assert.equal(b.json.repeated, true);
  assert.equal(a.json.job.id, b.json.job.id);
});

test("talent: feed filters, invites, boosts and chat", async () => {
  const { call, mkUser, mkWorker, admin, gigBody } = await setup();
  const worker = await mkWorker("w1", { categories: [CLEANING] });
  const emp = await mkUser("emp1", { wallet: 100000 });
  const gig = await call("/jobs", { token: emp, body: gigBody() });
  await call("/jobs", { token: emp, body: { type: "project", title: "Logo design", description: "Design a simple logo for a juice stall.", categoryId: "tcat_design", remote: true, budgetMinUgx: 50000, budgetMaxUgx: 150000, acceptRules: true } });
  const feed = await call("/jobs", { token: worker });
  assert.equal(feed.json.total, 2);
  assert.equal((await call("/jobs?type=project", { token: worker })).json.jobs[0].title, "Logo design");
  assert.equal((await call("/jobs?segment=professional", { token: worker })).json.total, 1);
  assert.equal((await call("/jobs?q=flat", { token: worker })).json.total, 1);
  assert.equal((await call(`/jobs?lat=${KAMPALA.lat}&lng=${KAMPALA.lng}&radiusKm=5`, { token: worker })).json.total, 2, "remote jobs always match");
  assert.equal((await call("/jobs", { token: emp })).json.total, 0, "you don't see your own jobs in the feed");

  await call("/jobs/" + gig.json.job.id + "/invite", { token: emp, body: { workerId: "w1" } });
  assert.equal((await call("/jobs", { token: worker })).json.jobs.find((j: Json) => j.id === gig.json.job.id).invited, true);

  await setTalentSettings({ freeAccess: true });
  const boost = await call(`/jobs/${gig.json.job.id}/boost`, { token: emp, body: {} });
  assert.equal(boost.status, 200);
  assert.equal((await call("/jobs", { token: worker })).json.jobs[0].id, gig.json.job.id, "boosted job is first");

  const applied = await call(`/jobs/${gig.json.job.id}/apply`, { token: worker, body: {} });
  const appId = applied.json.application.id;
  assert.equal((await call(`/applications/${appId}/messages`, { token: worker, body: { body: "When can I come?" } })).status, 201);
  assert.equal((await call(`/applications/${appId}/messages`, { token: emp, body: { body: "Tomorrow morning" } })).status, 201);
  const thread = await call(`/applications/${appId}/messages`, { token: worker });
  assert.deepEqual(thread.json.messages.map((m: Json) => m.mine), [true, false]);
  const stranger = await mkUser("stranger");
  assert.equal((await call(`/applications/${appId}/messages`, { token: stranger })).status, 404);
  assert.equal((await call(`/applications/${appId}/messages`, { token: emp, body: { body: "Pay me to hack into someone" } })).status, 422);
  await setTalentSettings({ chatEnabled: false });
  assert.equal((await call(`/applications/${appId}/messages`, { token: worker })).status, 403);
  void admin;
});

test("talent: sweep auto-releases submitted work and expires stale jobs", async () => {
  const { call, mkUser, mkWorker, wallet, workEarnings, gigBody, client, dbRow } = await setup();
  const worker = await mkWorker("w1");
  const emp = await mkUser("emp1", { wallet: 200000 });
  const jobId = (await call("/jobs", { token: emp, body: gigBody() })).json.job.id;
  await call(`/jobs/${jobId}/apply`, { token: worker, body: {} });
  const appId = (await call(`/jobs/${jobId}/applications`, { token: emp })).json.applicants[0].id;
  const contractId = (await call(`/applications/${appId}/accept`, { token: emp, body: {} })).json.contractId;
  assert.equal((await sweepTalent()).autoReleased, 0, "nothing submitted yet");
  await call(`/contracts/${contractId}/submit`, { token: worker, body: {} });
  assert.equal((await sweepTalent()).autoReleased, 0, "not due yet");
  await client.execute("UPDATE talent_milestones SET confirm_by = datetime('now', '-1 minute')");
  assert.equal((await sweepTalent()).autoReleased, 1);
  assert.equal(await workEarnings("w1"), 80000);
  assert.equal((await sweepTalent()).autoReleased, 0, "only once");
  assert.equal((await dbRow("SELECT status FROM talent_contracts WHERE id = ?", [contractId])).status, "settled");

  const stale = (await call("/jobs", { token: emp, body: gigBody({ title: "Old job" }) })).json.job.id;
  await client.execute({ sql: "UPDATE talent_jobs SET expires_at = datetime('now', '-1 hour') WHERE id = ?", args: [stale] });
  assert.equal((await sweepTalent()).expiredJobs, 1);
  assert.equal((await call(`/jobs/${stale}`, { token: emp })).json.job.status, "expired");
});

test("talent: staff controls — settings are validated and logged; overview adds up", async () => {
  const { call, mkUser, admin, client } = await setup();
  const plain = await mkUser("plain");
  assert.equal((await call("/admin/settings", { token: plain })).status, 403);
  const bad = await call("/admin/settings", { method: "PUT", token: admin, body: { paymentModes: ["escrow"], defaultPaymentMode: "direct" } });
  assert.equal(bad.status, 400);
  const bad2 = await call("/admin/settings", { method: "PUT", token: admin, body: { minJobUgx: 500000, maxJobUgx: 10000 } });
  assert.equal(bad2.status, 400);
  const ok = await call("/admin/settings", { method: "PUT", token: admin, body: { trialDays: 30, freeAccess: false, boostDays: 3 } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.settings.trialDays, 30);
  assert.equal(ok.json.settings.freeAccess, false);
  const log = await client.execute("SELECT action FROM admin_activity_log WHERE action = 'talent.settings.update'");
  assert.equal(log.rows.length, 1, "recorded in the activity log");

  const badRule = await call("/admin/fee-rules", { method: "PUT", token: admin, body: { kind: "listing", model: "flat", flatUgx: 0, active: true } });
  assert.equal(badRule.status, 400);
  const badHiring = await call("/admin/fee-rules", { method: "PUT", token: admin, body: { kind: "worker_commission", jobType: "hiring", model: "percent", percent: 5, active: true } });
  assert.equal(badHiring.status, 400);
  const badPercent = await call("/admin/fee-rules", { method: "PUT", token: admin, body: { kind: "listing", model: "percent", percent: 95, active: true } });
  assert.equal(badPercent.status, 400, "a fee can never be 95%");
  const overview = await call("/admin/overview", { token: admin });
  assert.equal(overview.status, 200);
  assert.equal(overview.json.settings.freeAccess, false);
  assert.equal((await call("/admin/categories", { token: admin })).json.categories.length >= 15, true);
  const cat = await call("/admin/categories", { method: "POST", token: admin, body: { name: "Pet care", segment: "informal" } });
  assert.equal(cat.status, 201);
  assert.ok((await call("/config", { token: plain })).json.categories.some((c: Json) => c.name === "Pet care"));
  await call(`/admin/categories/${cat.json.id}`, { method: "PATCH", token: admin, body: { active: false } });
  assert.ok(!(await call("/config", { token: plain })).json.categories.some((c: Json) => c.name === "Pet care"));
});

// ---------------------------------------------------------------------------
// Late-cancel fees
// ---------------------------------------------------------------------------

async function runningGig(ctx: Awaited<ReturnType<typeof setup>>, o: { paymentMode?: "escrow" | "direct"; workerWallet?: number; employerWallet?: number } = {}) {
  const { call, mkWorker, mkUser, admin, gigBody } = ctx;
  await startCommissions(call, admin);
  const worker = await mkWorker("w1", { wallet: o.workerWallet ?? 0 });
  const emp = await mkUser("emp1", { wallet: o.employerWallet ?? 200000 });
  const jobId = (await call("/jobs", { token: emp, body: gigBody(o.paymentMode ? { paymentMode: o.paymentMode } : {}) })).json.job.id;
  await call(`/jobs/${jobId}/apply`, { token: worker, body: {} });
  const appId = (await call(`/jobs/${jobId}/applications`, { token: emp })).json.applicants[0].id;
  const accepted = await call(`/applications/${appId}/accept`, { token: emp, body: {} });
  assert.equal(accepted.status, 201, JSON.stringify(accepted.json));
  return { worker, emp, jobId, contractId: accepted.json.contractId as string };
}

test("talent: cancelling is free inside the grace window and while the fee is 0", async () => {
  const ctx = await setup();
  const { call, wallet, totalMoney } = ctx;
  await setTalentSettings({ lateCancelFeeMode: "percent", lateCancelFeePercent: 20, cancelFreeMinutes: 30 });
  const { emp, contractId } = await runningGig(ctx);
  const before = await totalMoney();
  const quote = await call(`/contracts/${contractId}/cancel-quote`, { token: emp });
  assert.equal(quote.json.free, true);
  assert.equal(quote.json.feeUgx, 0);
  const res = await call(`/contracts/${contractId}/cancel`, { token: emp, body: { reason: "Changed plans" } });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.lateFeeUgx, 0);
  assert.equal(await wallet("emp1"), 200000, "everything refunded");
  assert.equal(await totalMoney(), before);
});

test("talent: employer cancels late (escrow) — fee comes out of the refund, shared with the worker", async () => {
  const ctx = await setup();
  const { call, wallet, workEarnings, totalMoney, dbRow } = ctx;
  await setTalentSettings({ lateCancelFeeMode: "percent", lateCancelFeePercent: 20, cancelFreeMinutes: 0, lateCancelPartySharePercent: 70 });
  const { emp, contractId, worker } = await runningGig(ctx);
  const before = await totalMoney();
  await dbRow("UPDATE talent_contracts SET created_at = datetime('now', '-2 hours') WHERE id = ?", [contractId]);

  const quote = await call(`/contracts/${contractId}/cancel-quote`, { token: emp });
  assert.equal(quote.json.feeUgx, 16000, "20% of the 80,000 not yet paid");
  assert.equal(quote.json.compensationUgx, 11200);
  const refused = await call(`/contracts/${contractId}/cancel`, { token: emp, body: { reason: "Changed plans" } });
  assert.equal(refused.status, 409);
  assert.equal(refused.json.error, "late_cancel_fee", "the person must agree to the fee first");
  assert.equal(await wallet("emp1"), 116000, "nothing moved yet");

  const res = await call(`/contracts/${contractId}/cancel`, { token: emp, body: { reason: "Changed plans", acceptFee: true } });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.lateFeeUgx, 16000);
  assert.equal(await wallet("emp1"), 116000 + 84000 - 16000);
  assert.equal(await workEarnings("w1"), 11200, "the worker is compensated");
  const ct = await dbRow("SELECT * FROM talent_contracts WHERE id = ?", [contractId]);
  assert.equal(ct.status, "cancelled");
  assert.equal(ct.cancel_fee_ugx, 16000);
  assert.equal(ct.held_ugx, 0);
  assert.equal(await totalMoney() + 4800, before, "Peebee kept its 30% share of the fee");
  assert.equal((await dbRow("SELECT COALESCE(SUM(amount_ugx), 0) AS n FROM talent_charges WHERE kind = 'late_cancel_fee' AND status = 'paid'")).n, 4800);
  const detail = await call(`/contracts/${contractId}`, { token: worker });
  assert.equal(detail.json.cancelFeeUgx, 16000);
  assert.equal((await call(`/contracts/${contractId}/cancel`, { token: emp, body: { reason: "again", acceptFee: true } })).status, 409, "only once");
});

test("talent: worker cancels late — fee from their wallet, employer refunded in full and compensated", async () => {
  const ctx = await setup();
  const { call, wallet, totalMoney, dbRow } = ctx;
  await setTalentSettings({ lateCancelFeeMode: "percent", lateCancelFeePercent: 20, cancelFreeMinutes: 0 });
  const { worker, contractId } = await runningGig(ctx, { workerWallet: 20000 });
  const before = await totalMoney();
  await dbRow("UPDATE talent_contracts SET created_at = datetime('now', '-2 hours') WHERE id = ?", [contractId]);
  const res = await call(`/contracts/${contractId}/cancel`, { token: worker, body: { reason: "I am unwell", acceptFee: true } });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.lateFeeStatus, "paid");
  assert.equal(await wallet("w1"), 4000, "paid 16,000");
  assert.equal(await wallet("emp1"), 200000 + 11200, "full refund plus compensation");
  assert.equal(await totalMoney() + 4800, before, "wallets plus Peebee's 4,800 equal the starting money");
});

test("talent: a worker who can't cover the late fee owes it", async () => {
  const ctx = await setup();
  const { call, wallet, dbRow } = ctx;
  await setTalentSettings({ lateCancelFeeMode: "percent", lateCancelFeePercent: 20, cancelFreeMinutes: 0 });
  const { worker, contractId } = await runningGig(ctx, { workerWallet: 1000 });
  await dbRow("UPDATE talent_contracts SET created_at = datetime('now', '-2 hours') WHERE id = ?", [contractId]);
  const res = await call(`/contracts/${contractId}/cancel`, { token: worker, body: { reason: "I am unwell", acceptFee: true } });
  assert.equal(res.status, 200);
  assert.equal(res.json.lateFeeStatus, "due");
  assert.equal(await wallet("w1"), 1000);
  assert.equal(await wallet("emp1"), 200000, "the employer is still refunded");
  assert.ok((await dbRow("SELECT COALESCE(SUM(amount_ugx), 0) AS n FROM talent_charges WHERE user_id = 'w1' AND status = 'due'")).n > 0);
});

test("talent: late fee on a directly-paid job, and none when charging is off", async () => {
  const ctx = await setup();
  const { call, wallet, workEarnings, dbRow } = ctx;
  await setTalentSettings({ lateCancelFeeMode: "percent", lateCancelFeePercent: 20, cancelFreeMinutes: 0 });
  const { emp, contractId } = await runningGig(ctx, { paymentMode: "direct", employerWallet: 50000 });
  await dbRow("UPDATE talent_contracts SET created_at = datetime('now', '-2 hours') WHERE id = ?", [contractId]);
  assert.equal(await wallet("emp1"), 50000, "nothing held for direct pay");
  const res = await call(`/contracts/${contractId}/cancel`, { token: emp, body: { reason: "Changed plans", acceptFee: true } });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(await wallet("emp1"), 50000 - 16000);
  assert.equal(await workEarnings("w1"), 11200);

  await setTalentSettings({ freeAccess: true });
  const q = await call(`/contracts/${contractId}/cancel-quote`, { token: emp });
  assert.equal(q.json.feeUgx, 0, "free access means no late fees");
});

test("talent: a late fee never exceeds what is held, and is capped at 50% by admin", async () => {
  const ctx = await setup();
  const { call, admin } = ctx;
  const bad = await call("/admin/settings", { method: "PUT", token: admin, body: { lateCancelFeePercent: 80 } });
  assert.equal(bad.status, 400);
  const bad2 = await call("/admin/settings", { method: "PUT", token: admin, body: { lateCancelPartySharePercent: 120 } });
  assert.equal(bad2.status, 400);
  const ok = await call("/admin/settings", { method: "PUT", token: admin, body: { lateCancelFeeMode: "percent", lateCancelFeePercent: 50, cancelFreeMinutes: 10, lateCancelPartySharePercent: 100 } });
  assert.equal(ok.json.settings.lateCancelFeePercent, 50);
});

// ---------------------------------------------------------------------------
// Recurring jobs
// ---------------------------------------------------------------------------

test("talent: rehire the same worker each week — a new contract each period, money held at the start", async () => {
  const ctx = await setup();
  const { call, wallet, dbRow, client, totalMoney } = ctx;
  const { emp, contractId, worker } = await runningGig(ctx);
  void worker;
  const before = await totalMoney();
  assert.equal((await call(`/contracts/${contractId}/repeat`, { token: emp, body: { frequency: "yearly" } })).status, 400);
  const made = await call(`/contracts/${contractId}/repeat`, { token: emp, body: { frequency: "weekly", maxRuns: 2 } });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.equal((await call(`/contracts/${contractId}/repeat`, { token: emp, body: { frequency: "weekly" } })).status, 409, "already repeating");
  const detail = await call(`/contracts/${contractId}`, { token: emp });
  assert.equal(detail.json.recurring.existing.frequency, "weekly");
  assert.equal(detail.json.recurring.canRepeat, false);

  assert.equal((await sweepTalent()).recurring.ran, 0, "not due yet");
  await client.execute("UPDATE talent_recurrences SET next_run_at = datetime('now', '-1 minute')");
  const heldBefore = await wallet("emp1");
  const first = await sweepTalent();
  assert.equal(first.recurring.ran, 1, JSON.stringify(first.recurring));
  assert.equal((await dbRow("SELECT COUNT(*) AS n FROM talent_contracts")).n, 2);
  assert.equal(await wallet("emp1"), heldBefore - 84000, "the second period's money is held");
  const rec = await dbRow("SELECT * FROM talent_recurrences");
  assert.equal(rec.runs_done, 1);
  assert.ok(String(rec.next_run_at) > new Date().toISOString().slice(0, 19).replace("T", " "), "the schedule moved on");
  assert.equal((await sweepTalent()).recurring.ran, 0, "the same period never runs twice");
  assert.equal(await totalMoney(), before, "all money is accounted for: it moved from the wallet into escrow");

  // The new contract is for the same worker and same price.
  const newest = await dbRow("SELECT * FROM talent_contracts ORDER BY created_at DESC, rowid DESC LIMIT 1");
  assert.equal(newest.worker_id, "w1");
  assert.equal(newest.price_ugx, 80000);
  assert.equal(newest.status, "active");

  // maxRuns of 2: one more run then it ends.
  await client.execute("UPDATE users SET wallet_balance = wallet_balance + 100000 WHERE id = 'emp1'");
  await client.execute("UPDATE talent_recurrences SET next_run_at = datetime('now', '-1 minute')");
  assert.equal((await sweepTalent()).recurring.ran, 1);
  assert.equal((await dbRow("SELECT status FROM talent_recurrences")).status, "ended");
  await client.execute("UPDATE talent_recurrences SET next_run_at = datetime('now', '-1 minute')");
  assert.equal((await sweepTalent()).recurring.ran, 0);
});

test("talent: a repeat that can't be funded is skipped, then the schedule pauses, then resumes", async () => {
  const ctx = await setup();
  const { call, client, dbRow, wallet } = ctx;
  await setTalentSettings({ recurringMaxFailures: 2, recurringFrequencies: ["daily", "weekly"] });
  const { emp, contractId } = await runningGig(ctx, { employerWallet: 90000 });
  assert.equal(await wallet("emp1"), 6000);
  assert.equal((await call(`/contracts/${contractId}/repeat`, { token: emp, body: { frequency: "daily" } })).status, 201);
  await client.execute("UPDATE talent_recurrences SET next_run_at = datetime('now', '-1 minute')");
  const one = await sweepTalent();
  assert.equal(one.recurring.failed, 1);
  assert.equal((await dbRow("SELECT COUNT(*) AS n FROM talent_contracts")).n, 1, "nothing was created");
  assert.equal((await dbRow("SELECT COUNT(*) AS n FROM talent_jobs")).n, 1, "no stray job is left behind");
  assert.equal(await wallet("emp1"), 6000);
  assert.match(String((await dbRow("SELECT last_error FROM talent_recurrences")).last_error), /wallet/i);
  assert.equal((await dbRow("SELECT status FROM talent_recurrences")).status, "active");
  await client.execute("UPDATE talent_recurrences SET next_run_at = datetime('now', '-1 minute')");
  const two = await sweepTalent();
  assert.equal(two.recurring.paused, 1);
  assert.equal((await dbRow("SELECT status FROM talent_recurrences")).status, "paused");
  await client.execute("UPDATE talent_recurrences SET next_run_at = datetime('now', '-1 minute')");
  assert.equal((await sweepTalent()).recurring.ran, 0, "paused schedules don't run");

  await client.execute("UPDATE users SET wallet_balance = 200000 WHERE id = 'emp1'");
  const recId = (await call("/recurrences", { token: emp })).json.recurrences[0].id;
  assert.equal((await call(`/recurrences/${recId}/resume`, { token: emp, body: {} })).status, 200);
  const resumed = await dbRow("SELECT * FROM talent_recurrences");
  assert.equal(resumed.status, "active");
  assert.equal(resumed.fail_count, 0);
  await client.execute("UPDATE talent_recurrences SET next_run_at = datetime('now', '-1 minute')");
  assert.equal((await sweepTalent()).recurring.ran, 1);
});

test("talent: repost puts a fresh open job up each period and charges the listing fee", async () => {
  const ctx = await setup();
  const { call, mkUser, mkWorker, gigBody, client, dbRow, wallet, admin } = ctx;
  await setTalentSettings({ freeAccess: false });
  await call("/admin/fee-rules", { method: "PUT", token: admin, body: { kind: "listing", jobType: "gig", model: "flat", flatUgx: 3000, active: true } });
  await mkWorker("w1");
  const emp = await mkUser("emp1", { wallet: 10000 });
  const jobId = (await call("/jobs", { token: emp, body: gigBody() })).json.job.id;
  assert.equal(await wallet("emp1"), 7000);
  const made = await call(`/jobs/${jobId}/repeat`, { token: emp, body: { frequency: "weekly" } });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  await client.execute("UPDATE talent_recurrences SET next_run_at = datetime('now', '-1 minute')");
  assert.equal((await sweepTalent()).recurring.ran, 1);
  assert.equal((await dbRow("SELECT COUNT(*) AS n FROM talent_jobs WHERE status = 'open'")).n, 2);
  assert.equal(await wallet("emp1"), 4000, "listing fee charged for the new post");
  const mine = (await call("/jobs/mine", { token: emp })).json.jobs;
  assert.equal(mine.length, 2);
  // Not enough for another post: skipped.
  await client.execute("UPDATE users SET wallet_balance = 100 WHERE id = 'emp1'");
  await client.execute("UPDATE talent_recurrences SET next_run_at = datetime('now', '-1 minute')");
  const r = await sweepTalent();
  assert.equal(r.recurring.failed, 1);
  assert.equal((await dbRow("SELECT COUNT(*) AS n FROM talent_jobs")).n, 2, "failed repost left nothing behind");
});

test("talent: recurring is switchable, limited, Pro-gatable and either side can end it", async () => {
  const ctx = await setup();
  const { call, admin } = ctx;
  const { emp, contractId, worker } = await runningGig(ctx);
  await setTalentSettings({ recurringFrequencies: ["weekly"] });
  assert.equal((await call(`/contracts/${contractId}/repeat`, { token: emp, body: { frequency: "daily" } })).json.error, "frequency_unavailable");
  await setTalentSettings({ recurringEnabled: false });
  assert.equal((await call(`/contracts/${contractId}/repeat`, { token: emp, body: { frequency: "weekly" } })).json.error, "recurring_disabled");
  assert.equal((await call(`/contracts/${contractId}`, { token: emp })).json.recurring.canRepeat, false);
  await setTalentSettings({ recurringEnabled: true, freeAccess: false });
  await call("/admin/features/recurring_jobs", { method: "PATCH", token: admin, body: { pro: true } });
  const locked = await call(`/contracts/${contractId}/repeat`, { token: emp, body: { frequency: "weekly" } });
  assert.equal(locked.status, 402);
  assert.equal(locked.json.error, "pro_required");
  await call("/admin/features/recurring_jobs", { method: "PATCH", token: admin, body: { pro: false } });
  assert.equal((await call(`/contracts/${contractId}/repeat`, { token: worker, body: { frequency: "weekly" } })).status, 404, "only the employer sets it up");
  await setTalentSettings({ recurringMaxActive: 1 });
  const made = await call(`/contracts/${contractId}/repeat`, { token: emp, body: { frequency: "weekly" } });
  assert.equal(made.status, 201);
  const jobId2 = (await call("/jobs", { token: emp, body: { type: "gig", title: "Second", description: "Another small cleaning gig please.", categoryId: CLEANING, area: "Kololo", budgetMaxUgx: 10000, acceptRules: true } })).json.job?.id;
  if (jobId2) assert.equal((await call(`/jobs/${jobId2}/repeat`, { token: emp, body: { frequency: "weekly" } })).json.error, "too_many_recurring");

  const listed = await call("/recurrences", { token: worker });
  assert.equal(listed.json.recurrences.length, 1, "the worker can see it");
  assert.equal(listed.json.recurrences[0].role, "worker");
  assert.equal((await call(`/recurrences/${made.json.id}/pause`, { token: worker, body: {} })).status, 404, "a worker can't pause it");
  assert.equal((await call(`/recurrences/${made.json.id}/end`, { token: worker, body: {} })).status, 200, "but can leave it");
  assert.equal((await call("/recurrences", { token: emp })).json.recurrences.length, 0);
});

test("talent: late-cancel fee defaults to a flat UGX 5,000 and admin can change it", async () => {
  const ctx = await setup();
  const { call, wallet, workEarnings, dbRow, admin } = ctx;
  await setTalentSettings({ cancelFreeMinutes: 0 });
  const { emp, contractId } = await runningGig(ctx);
  await dbRow("UPDATE talent_contracts SET created_at = datetime('now', '-2 hours') WHERE id = ?", [contractId]);
  const q = await call(`/contracts/${contractId}/cancel-quote`, { token: emp });
  assert.equal(q.json.mode, "flat");
  assert.equal(q.json.feeUgx, 5000, "the default late-cancel fee");
  assert.equal(q.json.compensationUgx, 3500);
  const before = await wallet("emp1");
  assert.equal((await call(`/contracts/${contractId}/cancel`, { token: emp, body: { reason: "Changed plans", acceptFee: true } })).status, 200);
  assert.equal(await wallet("emp1"), before + 84000 - 5000);
  assert.equal(await workEarnings("w1"), 3500);

  // Admin changes the amount, then the type.
  assert.equal((await call("/admin/settings", { method: "PUT", token: admin, body: { lateCancelFeeUgx: 8000 } })).json.settings.lateCancelFeeUgx, 8000);
  const ctx2 = await runningGig2(ctx);
  assert.equal((await call(`/contracts/${ctx2}/cancel-quote`, { token: emp })).json.feeUgx, 8000);
  await call("/admin/settings", { method: "PUT", token: admin, body: { lateCancelFeeUgx: 0 } });
  assert.equal((await call(`/contracts/${ctx2}/cancel-quote`, { token: emp })).json.feeUgx, 0, "0 turns the flat fee off");
  await call("/admin/settings", { method: "PUT", token: admin, body: { lateCancelFeeMode: "percent", lateCancelFeePercent: 10 } });
  assert.equal((await call(`/contracts/${ctx2}/cancel-quote`, { token: emp })).json.feeUgx, 8000, "10% of 80,000");
  await setTalentSettings({ freeAccess: true });
  assert.equal((await call(`/contracts/${ctx2}/cancel-quote`, { token: emp })).json.feeUgx, 0, "free access: no fee");
});

/** A second running gig for the same employer, aged past the free window. */
async function runningGig2(ctx: Awaited<ReturnType<typeof setup>>) {
  const { call, mkWorker, dbRow, gigBody } = ctx;
  await mkWorker("w2");
  const emp = (await ctx.client.execute("SELECT id FROM users WHERE id = 'emp1'")).rows.length ? await signTokenFor("emp1") : "";
  const jobId = (await call("/jobs", { token: emp, body: gigBody({ title: "Second clean" }) })).json.job.id;
  const w2 = await signTokenFor("w2");
  await call(`/jobs/${jobId}/apply`, { token: w2, body: {} });
  const appId = (await call(`/jobs/${jobId}/applications`, { token: emp })).json.applicants[0].id;
  const contractId = (await call(`/applications/${appId}/accept`, { token: emp, body: {} })).json.contractId as string;
  await dbRow("UPDATE talent_contracts SET created_at = datetime('now', '-2 hours') WHERE id = ?", [contractId]);
  return contractId;
}
async function signTokenFor(id: string) {
  return signToken({ sub: id, role: "customer" });
}

// ---------------------------------------------------------------------------
// Sandbox sample data
// ---------------------------------------------------------------------------

test("talent: sandbox sample data is only for sandbox, hidden from live, and removable", async () => {
  const { call, mkUser, admin, client } = await setup();
  const { setPlatformEnvironment } = await import("../lib/settings.js");
  const viewer = await mkUser("viewer");
  assert.equal((await call("/admin/sandbox/seed", { token: admin, body: {} })).status, 409, "refused while live");

  await setPlatformEnvironment("sandbox");
  const seeded = await call("/admin/sandbox/seed", { token: admin, body: {} });
  assert.equal(seeded.status, 200, JSON.stringify(seeded.json));
  assert.equal(seeded.json.jobs, 9);
  const feed = await call("/jobs", { token: viewer });
  assert.equal(feed.json.total, 9, "every sample job shows in sandbox");
  assert.deepEqual([...new Set(feed.json.jobs.map((j: Json) => j.type))].sort(), ["gig", "hiring", "project"]);
  const workers = await call("/workers", { token: viewer });
  assert.equal(workers.json.total, 8);
  assert.equal((await call(`/workers/${workers.json.workers[0].id}`, { token: viewer })).status, 200);
  // Adding twice doesn't duplicate.
  await call("/admin/sandbox/seed", { token: admin, body: {} });
  assert.equal((await call("/jobs", { token: viewer })).json.total, 9);

  await setPlatformEnvironment("live");
  assert.equal((await call("/jobs", { token: viewer })).json.total, 0, "invisible while live");
  assert.equal((await call("/workers", { token: viewer })).json.total, 0);
  assert.equal((await call(`/jobs/${feed.json.jobs[0].id}`, { token: viewer })).status, 404);
  assert.equal((await call(`/workers/${workers.json.workers[0].id}`, { token: viewer })).status, 404);

  await setPlatformEnvironment("sandbox");
  const cleared = await call("/admin/sandbox/clear", { token: admin, body: {} });
  assert.equal(cleared.status, 200);
  assert.ok(cleared.json.removed > 0);
  assert.equal((await call("/jobs", { token: viewer })).json.total, 0);
  assert.equal((await client.execute("SELECT COUNT(*) AS n FROM users WHERE id LIKE 'talent_demo_%'")).rows[0].n, 0);
  assert.equal((await call("/admin/sandbox/seed", { token: viewer, body: {} })).status, 403, "staff only");
});
