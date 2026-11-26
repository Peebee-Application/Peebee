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
import { setR2Binding, type R2Bucket } from "../storage/r2.js";
import { setLearnSettings } from "./settings.js";
import { resetStudioCache } from "./studio.js";

process.env.JWT_SECRET = "pro3-test-only-secret";
process.env.PUBLIC_API_URL = "https://api.test";

type Json = Record<string, any>;

function bind(client: Client) {
  const prepare = (sql: string) => ({
    sql, args: [] as unknown[],
    bind(...args: unknown[]) { this.args = args; return this; },
    async all() {
      const r = await client.execute({ sql: this.sql, args: this.args as InArgs });
      return { results: r.rows, success: true, meta: { changes: r.rowsAffected, last_row_id: Number(r.lastInsertRowid ?? 0) } };
    },
  });
  setD1Binding({ prepare, async batch(st: { all(): Promise<unknown> }[]) { const o = []; for (const s of st) o.push(await s.all()); return o; } } as unknown as D1Database);
}

async function setup(skip: string[] = []) {
  resetSchemaCache();
  resetStudioCache();
  const client = createClient({ url: "file::memory:" });
  const dir = join(process.cwd(), "src/db/migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    if (skip.some((s) => f.startsWith(s))) continue;
    for (const sql of splitSqlStatements(readFileSync(join(dir, f), "utf8"))) await client.execute(sql);
  }
  bind(client);
  setR2Binding({ async put() {}, async get() { return null; }, async delete() {} } as unknown as R2Bucket);
  await setLearnSettings({ createsPerHour: 1000, quizAttemptsPerHour: 200 });
  let n = 0;
  const mk = async (id: string) => {
    n += 1;
    await client.execute({ sql: "INSERT INTO users (id, phone, name, role, password_hash, email_verified_at, wallet_balance) VALUES (?, ?, ?, 'customer', 'x', datetime('now'), 0)", args: [id, `+25676000${String(n).padStart(4, "0")}`, `Person ${id}`] });
    await client.execute({ sql: "INSERT INTO personal_wallets (user_id) VALUES (?)", args: [id] });
    return signToken({ sub: id, role: "customer" });
  };
  const request = async (path: string, o: { method?: string; token?: string; body?: unknown } = {}) => {
    const res = await app.request(path, { method: o.method ?? (o.body !== undefined ? "POST" : "GET"), headers: { "Content-Type": "application/json", ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}) }, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
  };
  return { client, mk, request };
}

async function shop(ctx: Awaited<ReturnType<typeof setup>>, wallet = 100_000) {
  const teacher = await ctx.mk("t_1");
  const learner = await ctx.mk("l_1");
  const other = await ctx.mk("l_2");
  await ctx.client.execute({ sql: "UPDATE users SET wallet_balance = ? WHERE id IN ('l_1', 'l_2')", args: [wallet] });
  const edu = (p: string, o: { method?: string; body?: unknown } = {}) => ctx.request(`/v1/education${p}`, { ...o, token: teacher });
  const me = (p: string, o: { method?: string; body?: unknown } = {}) => ctx.request(`/v1/education${p}`, { ...o, token: learner });
  const them = (p: string, o: { method?: string; body?: unknown } = {}) => ctx.request(`/v1/education${p}`, { ...o, token: other });
  const educatorEarnings = async () => Number((await ctx.client.execute("SELECT COALESCE(SUM(balance), 0) AS b FROM provider_wallets WHERE provider_type='education' AND environment='live'")).rows[0].b);
  const balance = async (id: string) => Number((await ctx.client.execute({ sql: "SELECT wallet_balance AS b FROM users WHERE id = ?", args: [id] })).rows[0]!.b);
  const sc = (await edu("/studio/schools", { body: { name: "Shop school", kind: "school", streams: ["foundations"] } })).json.school;
  const cls = (await edu(`/studio/schools/${sc.id}/classes`, { body: { stream: "foundations", name: "S2", framework: "uganda_primary" } })).json.class;
  const make = async (title: string, priceUgx: number) => {
    const course = (await edu(`/studio/classes/${cls.id}/courses`, { body: { title, priceUgx } })).json.course;
    const m = (await edu(`/studio/courses/${course.id}/modules`, { body: { title: "Unit" } })).json.module;
    const lesson = (await edu(`/studio/modules/${m.id}/lessons`, { body: { title: "Reading", contentType: "text", body: "hi" } })).json.lesson;
    await edu(`/studio/courses/${course.id}`, { method: "PATCH", body: { status: "published" } });
    return { course, lesson };
  };
  return { educatorEarnings, teacher, learner, edu, me, them, balance, sc, make, ctx };
}

test("coupons: price drops, money splits on the discounted price, and limits hold", async () => {
  const ctx = await setup();
  const k = await shop(ctx);
  await setLearnSettings({ commissionPercent: 10 });
  const A = await k.make("Paid course", 10_000);
  const made = await k.edu(`/studio/schools/${k.sc.id}/coupons`, { body: { code: "half", percentOff: 50, maxUses: 1 } });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.equal((await k.edu(`/studio/schools/${k.sc.id}/coupons`, { body: { code: "HALF", percentOff: 10 } })).json.error, "code_taken");
  assert.equal((await k.edu(`/studio/schools/${k.sc.id}/coupons`, { body: { code: "TOOBIG", percentOff: 95 } })).json.error, "coupon_too_big");
  assert.equal((await k.edu(`/studio/schools/${k.sc.id}/coupons`, { body: { code: "BOTH", percentOff: 5, amountOffUgx: 100 } })).status, 400);

  const quote = (await k.me(`/learn/courses/${A.course.id}/quote`, { body: { coupon: "half" } })).json;
  assert.deepEqual([quote.valid, quote.discountUgx, quote.finalUgx], [true, 5000, 5000]);
  assert.equal((await k.me(`/learn/courses/${A.course.id}/quote`, { body: { coupon: "nope" } })).json.valid, false);

  const bad = await k.me(`/learn/courses/${A.course.id}/enroll`, { body: { coupon: "nope" } });
  assert.equal(bad.json.error, "coupon_invalid");
  assert.equal(await k.balance("l_1"), 100_000, "nothing was charged");
  const ok = await k.me(`/learn/courses/${A.course.id}/enroll`, { body: { coupon: "HALF" } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.paidUgx, 5000);
  assert.equal(await k.balance("l_1"), 95_000);
  assert.equal(await k.educatorEarnings(), 4500, "the educator gets the discounted price less Peebee's share");

  // The one use is spent.
  const B = await k.make("Second course", 10_000);
  assert.equal((await k.them(`/learn/courses/${A.course.id}/enroll`, { body: { coupon: "HALF" } })).json.error, "coupon_invalid");
  const list = (await k.edu(`/studio/schools/${k.sc.id}/sales`)).json;
  assert.equal(list.coupons[0].usedCount, 1);
  void B;
});

test("coupons: a failed payment gives the use back, and 100% off needs no wallet", async () => {
  const ctx = await setup();
  const k = await shop(ctx, 100);
  const A = await k.make("Dear course", 10_000);
  await setLearnSettings({ maxCouponPercent: 100 });
  await k.edu(`/studio/schools/${k.sc.id}/coupons`, { body: { code: "FIVE", percentOff: 50, maxUses: 1 } });
  await k.edu(`/studio/schools/${k.sc.id}/coupons`, { body: { code: "FREE", percentOff: 100 } });

  const poor = await k.me(`/learn/courses/${A.course.id}/enroll`, { body: { coupon: "FIVE" } });
  assert.equal(poor.status, 402);
  assert.equal((await k.edu(`/studio/schools/${k.sc.id}/sales`)).json.coupons.find((x: Json) => x.code === "FIVE").usedCount, 0, "the use came back");
  assert.equal(await k.balance("l_1"), 100);

  const free = await k.me(`/learn/courses/${A.course.id}/enroll`, { body: { coupon: "FREE" } });
  assert.equal(free.status, 200, JSON.stringify(free.json));
  assert.equal(free.json.paidUgx, 0);
  assert.equal(await k.balance("l_1"), 100);
  assert.equal((await k.me(`/learn/courses/${A.course.id}`)).status, 200);

  await setLearnSettings({ couponsEnabled: false });
  assert.equal((await k.edu(`/studio/schools/${k.sc.id}/coupons`, { body: { code: "LATER", percentOff: 5 } })).json.error, "coupons_off");
});

test("bundles: one payment enrols in every course, and only once", async () => {
  const ctx = await setup();
  const k = await shop(ctx);
  await setLearnSettings({ commissionPercent: 10 });
  const A = await k.make("Part one", 8000);
  const B = await k.make("Part two", 8000);
  const C = await k.make("Part three", 8000);
  const bad = await k.edu(`/studio/schools/${k.sc.id}/bundles`, { body: { title: "Solo", priceUgx: 1000, courseIds: [A.course.id] } });
  assert.equal(bad.status, 400);
  const made = await k.edu(`/studio/schools/${k.sc.id}/bundles`, { body: { title: "Whole series", priceUgx: 15_000, courseIds: [A.course.id, B.course.id, C.course.id], status: "published" } });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const offers = (await ctx.request(`/v1/education/catalog/courses/${B.course.id}`)).json.course;
  assert.equal(offers.bundles[0].title, "Whole series");
  assert.equal(offers.bundles[0].courseCount, 3);

  const buy = await k.me(`/learn/bundles/${made.json.id}/buy`, { body: {} });
  assert.equal(buy.status, 200, JSON.stringify(buy.json));
  assert.equal(buy.json.enrolledIn, 3);
  assert.equal(await k.balance("l_1"), 85_000);
  assert.equal(await k.educatorEarnings(), 13_500);
  for (const c of [A, B, C]) assert.equal((await k.me(`/learn/courses/${c.course.id}`)).status, 200);
  assert.equal((await k.me(`/learn/bundles/${made.json.id}/buy`, { body: {} })).json.error, "already_bought");
  assert.equal(await k.balance("l_1"), 85_000, "no second charge");

  // Broke learners can't buy, and the claim is released so they can try again later.
  await ctx.client.execute({ sql: "UPDATE users SET wallet_balance = 10 WHERE id = 'l_2'", args: [] });
  assert.equal((await k.them(`/learn/bundles/${made.json.id}/buy`, { body: {} })).status, 402);
  await ctx.client.execute({ sql: "UPDATE users SET wallet_balance = 20000 WHERE id = 'l_2'", args: [] });
  assert.equal((await k.them(`/learn/bundles/${made.json.id}/buy`, { body: {} })).status, 200);

  // A sold bundle is unpublished, not deleted.
  assert.equal((await k.edu(`/studio/bundles/${made.json.id}`, { method: "DELETE" })).json.unpublished, true);
  assert.equal((await k.edu(`/studio/schools/${k.sc.id}/sales`)).json.bundles[0].sold, 2);
});

test("school passes: every course opens while the pass lasts, then closes", async () => {
  const ctx = await setup();
  const k = await shop(ctx);
  await setLearnSettings({ commissionPercent: 10 });
  const A = await k.make("Course one", 9000);
  const B = await k.make("Course two", 9000);
  const plan = await k.edu(`/studio/schools/${k.sc.id}/plans`, { body: { title: "Monthly", priceUgx: 20_000, days: 30, status: "published" } });
  assert.equal(plan.status, 201, JSON.stringify(plan.json));
  assert.equal((await k.edu(`/studio/schools/${k.sc.id}/plans`, { body: { title: "Forever", priceUgx: 1, days: 9999 } })).status, 400);

  assert.equal((await k.me(`/learn/courses/${A.course.id}`)).status, 403, "no access yet");
  const offers = (await ctx.request(`/v1/education/catalog/courses/${A.course.id}`)).json.course;
  assert.equal(offers.plans[0].days, 30);

  const sub = await k.me(`/learn/plans/${plan.json.id}/subscribe`, { body: {} });
  assert.equal(sub.status, 200, JSON.stringify(sub.json));
  assert.equal(await k.balance("l_1"), 80_000);
  assert.equal(await k.educatorEarnings(), 18_000);
  for (const c of [A, B]) assert.equal((await k.me(`/learn/courses/${c.course.id}`)).status, 200);
  assert.equal((await k.me(`/learn/lessons/${A.lesson.id}/complete`, { body: {} })).status, 200);
  assert.equal((await k.me(`/learn/courses/${B.course.id}/enroll`, { body: {} })).json.viaPass, true);
  assert.equal(await k.balance("l_1"), 80_000, "a pass holder isn't charged for a course");
  const mine = (await k.me("/learn/enrollments")).json.enrollments.map((e: Json) => e.courseId).sort();
  assert.deepEqual(mine, [A.course.id, B.course.id].sort());
  assert.equal((await k.me("/learn/subscriptions")).json.subscriptions.length, 1);

  // Buying again adds on to the end.
  const before = (await k.me("/learn/subscriptions")).json.subscriptions[0].expiresAt;
  await k.me(`/learn/plans/${plan.json.id}/subscribe`, { body: {} });
  const after = (await k.me("/learn/subscriptions")).json.subscriptions[0].expiresAt;
  assert.ok(after > before);

  // When the pass runs out, so does the access.
  await ctx.client.execute({ sql: "UPDATE edu_subscriptions SET expires_at = datetime('now', '-1 day')", args: [] });
  assert.equal((await k.me(`/learn/courses/${A.course.id}`)).status, 403);
  assert.deepEqual((await k.me("/learn/enrollments")).json.enrollments, []);

  assert.equal((await k.edu(`/studio/schools/${k.sc.id}`, { method: "DELETE" })).json.error, "has_sales", "money was taken, so the school stays");
  await setLearnSettings({ subscriptionsEnabled: false });
  assert.equal((await k.me(`/learn/plans/${plan.json.id}/subscribe`, { body: {} })).json.error, "passes_off");
});

test("before migration 0119: single-course payment is untouched and sales say 'upgrade pending'", async () => {
  const ctx = await setup(["0119_"]);
  const k = await shop(ctx);
  const A = await k.make("Old way", 5000);
  assert.equal((await k.edu(`/studio/schools/${k.sc.id}/coupons`, { body: { code: "ANY", percentOff: 10 } })).status, 503);
  assert.equal((await k.edu(`/studio/schools/${k.sc.id}/sales`)).json.ready, false);
  assert.equal((await k.me(`/learn/courses/${A.course.id}/enroll`, { body: { coupon: "ANY" } })).json.error, "coupon_invalid");
  const ok = await k.me(`/learn/courses/${A.course.id}/enroll`, { body: {} });
  assert.equal(ok.status, 200);
  assert.equal(await k.balance("l_1"), 95_000);
  assert.equal((await ctx.request(`/v1/education/catalog/courses/${A.course.id}`)).status, 200);
  assert.deepEqual((await k.me("/learn/enrollments")).json.enrollments.length, 1);
});
