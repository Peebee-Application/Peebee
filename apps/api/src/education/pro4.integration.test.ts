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

process.env.JWT_SECRET = "pro4-test-only-secret";
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

async function hub(ctx: Awaited<ReturnType<typeof setup>>) {
  const teacher = await ctx.mk("t_1");
  const buddy = await ctx.mk("t_2");
  const learner = await ctx.mk("l_1");
  const other = await ctx.mk("l_2");
  await ctx.client.execute({ sql: "UPDATE users SET wallet_balance = 50000 WHERE id IN ('l_1', 'l_2')", args: [] });
  const edu = (p: string, o: { method?: string; body?: unknown } = {}) => ctx.request(`/v1/education${p}`, { ...o, token: teacher });
  const co = (p: string, o: { method?: string; body?: unknown } = {}) => ctx.request(`/v1/education${p}`, { ...o, token: buddy });
  const me = (p: string, o: { method?: string; body?: unknown } = {}) => ctx.request(`/v1/education${p}`, { ...o, token: learner });
  const them = (p: string, o: { method?: string; body?: unknown } = {}) => ctx.request(`/v1/education${p}`, { ...o, token: other });
  const sc = (await edu("/studio/schools", { body: { name: "Hub school", kind: "school", streams: ["foundations"] } })).json.school;
  const cls = (await edu(`/studio/schools/${sc.id}/classes`, { body: { stream: "foundations", name: "S3", framework: "uganda_primary" } })).json.class;
  const course = (await edu(`/studio/classes/${cls.id}/courses`, { body: { title: "Community course", priceUgx: 0 } })).json.course;
  const mod = (await edu(`/studio/courses/${course.id}/modules`, { body: { title: "Unit" } })).json.module;
  const a = (await edu(`/studio/modules/${mod.id}/lessons`, { body: { title: "First", contentType: "text", body: "one" } })).json.lesson;
  const b = (await edu(`/studio/modules/${mod.id}/lessons`, { body: { title: "Second", contentType: "text", body: "two" } })).json.lesson;
  await edu(`/studio/courses/${course.id}`, { method: "PATCH", body: { status: "published" } });
  return { teacher, buddy, learner, other, edu, co, me, them, sc, course, mod, a, b, ctx };
}

test("reviews: only once part-way through, one per learner, with a reply from the teacher", async () => {
  const k = await hub(await setup());
  await k.me(`/learn/courses/${k.course.id}/enroll`, { body: {} });
  const early = await k.me(`/learn/courses/${k.course.id}/review`, { body: { rating: 5, body: "Great" } });
  assert.equal(early.json.error, "too_early");
  await k.me(`/learn/lessons/${k.a.id}/complete`, { body: {} });
  assert.equal((await k.me(`/learn/courses/${k.course.id}/review`, { body: { rating: 5, body: "Great course" } })).status, 200);
  assert.equal((await k.me(`/learn/courses/${k.course.id}/review`, { body: { rating: 4, body: "Great, with edits" } })).status, 200, "a second post edits the first");
  assert.equal((await k.edu(`/learn/courses/${k.course.id}/review`, { body: { rating: 5 } })).json.error, "own_course");
  assert.equal((await k.them(`/learn/courses/${k.course.id}/review`, { body: { rating: 5 } })).status, 403, "not enrolled");

  const pub = (await k.ctx.request(`/v1/education/catalog/courses/${k.course.id}`)).json.course;
  assert.deepEqual(pub.rating, { average: 4, count: 1 });
  assert.equal(pub.reviews[0].body, "Great, with edits");
  assert.equal(pub.reviews[0].name, "Person", "only a first name is public");

  const reply = await k.edu(`/studio/courses/${k.course.id}/reviews/l_1/reply`, { method: "PUT", body: { reply: "Thank you!" } });
  assert.equal(reply.status, 200);
  assert.equal((await k.me(`/learn/courses/${k.course.id}/review`)).json.review.reply, "Thank you!");
  await setLearnSettings({ reviewsEnabled: false });
  assert.equal((await k.me(`/learn/courses/${k.course.id}/review`, { body: { rating: 1 } })).json.error, "reviews_off");
});

test("Q&A and announcements: learners ask, teachers answer, and each may only remove their own", async () => {
  const k = await hub(await setup());
  await k.me(`/learn/courses/${k.course.id}/enroll`, { body: {} });
  await k.them(`/learn/courses/${k.course.id}/enroll`, { body: {} });
  const asked = await k.me(`/learn/courses/${k.course.id}/qa`, { body: { body: "What does 'half' mean?", lessonId: k.a.id } });
  assert.equal(asked.status, 201, JSON.stringify(asked.json));
  assert.equal((await k.ctx.request(`/v1/education/learn/courses/${k.course.id}/qa`, { token: await k.ctx.mk("stranger") })).status, 403);
  assert.equal((await k.me(`/learn/courses/${k.course.id}/qa`, { body: { body: "x", lessonId: "nope" } })).status, 400);

  const qid = asked.json.id;
  assert.equal((await k.edu(`/learn/qa/${qid}/answers`, { body: { body: "One of two equal parts." } })).status, 201);
  assert.equal((await k.them(`/learn/qa/${qid}/answers`, { body: { body: "I think it is 0.5" } })).status, 201);
  const forThem = (await k.them(`/learn/courses/${k.course.id}/qa?lessonId=${k.a.id}`)).json.questions;
  assert.equal(forThem.length, 1);
  assert.equal(forThem[0].answers.length, 2);
  assert.equal(forThem[0].answers[0].byTeacher, true);
  assert.equal(forThem[0].canDelete, false);
  assert.equal((await k.them(`/learn/qa/${qid}`, { method: "DELETE" })).status, 404, "a classmate can't remove someone else's question");
  assert.equal((await k.them(`/learn/courses/${k.course.id}/qa?lessonId=${k.b.id}`)).json.questions.length, 0, "questions stay with their lesson");
  assert.equal((await k.edu(`/studio/courses/${k.course.id}/community`)).json.openQuestions, 0, "answered by a teacher");

  const posted = await k.edu(`/studio/courses/${k.course.id}/announcements`, { body: { title: "Welcome", body: "Class starts Monday." } });
  assert.equal(posted.status, 201);
  assert.equal((await k.me(`/learn/courses/${k.course.id}/announcements`)).json.announcements[0].title, "Welcome");
  assert.equal((await k.me(`/studio/courses/${k.course.id}/announcements`, { body: { title: "Hack" } })).status, 404);
  assert.equal((await k.me(`/learn/qa/${qid}`, { method: "DELETE" })).status, 200);

  await setLearnSettings({ qaPostsPerHour: 1, qaEnabled: true });
  const chatty = await k.ctx.mk("l_3");
  const say = (body: string) => k.ctx.request(`/v1/education/learn/courses/${k.course.id}/qa`, { token: chatty, body: { body } });
  await k.ctx.request(`/v1/education/learn/courses/${k.course.id}/enroll`, { token: chatty, body: {} });
  assert.equal((await say("First one")).status, 201);
  assert.equal((await say("Second one")).status, 429, "slow down");
  await setLearnSettings({ qaEnabled: false });
  assert.equal((await k.me(`/learn/courses/${k.course.id}/qa`, { body: { body: "Anyone?" } })).json.error, "qa_off");
});

test("extra teachers: they edit and mark with the owner, but can't delete or reprice", async () => {
  const k = await hub(await setup());
  assert.equal((await k.co(`/studio/courses/${k.course.id}`)).status, 404, "not on the course yet");
  const added = await k.edu(`/studio/courses/${k.course.id}/instructors`, { body: { identifier: "+256760000002" } });
  assert.equal(added.status, 201, JSON.stringify(added.json));
  assert.equal((await k.co(`/studio/courses/${k.course.id}/instructors`, { body: { identifier: "+256760000003" } })).json.error, "owner_only");
  assert.equal((await k.edu(`/studio/courses/${k.course.id}/instructors`, { body: { identifier: "+256769999999" } })).json.error, "person_not_found");

  assert.equal((await k.co(`/studio/courses/${k.course.id}`)).status, 200);
  const made = await k.co(`/studio/modules/${k.mod.id}/lessons`, { body: { title: "Added by buddy", contentType: "text", body: "hi" } });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.equal((await k.co(`/studio/lessons/${k.a.id}`, { method: "PATCH", body: { title: "Renamed by buddy" } })).status, 200);
  assert.equal((await k.co(`/studio/courses/${k.course.id}`, { method: "PATCH", body: { priceUgx: 99999 } })).json.error, "owner_only");
  assert.equal((await k.co(`/studio/courses/${k.course.id}`, { method: "DELETE" })).json.error, "owner_only");
  assert.equal((await k.co("/studio/shared-courses")).json.courses[0].title, "Community course");

  // They answer as a teacher and see everything open.
  await k.me(`/learn/courses/${k.course.id}/enroll`, { body: {} });
  const q = (await k.me(`/learn/courses/${k.course.id}/qa`, { body: { body: "Help?" } })).json.id;
  await k.co(`/learn/qa/${q}/answers`, { body: { body: "Sure." } });
  assert.equal((await k.me(`/learn/courses/${k.course.id}/qa`)).json.questions[0].answers[0].byTeacher, true);

  assert.equal((await k.edu(`/studio/courses/${k.course.id}/instructors/t_2`, { method: "DELETE" })).status, 200);
  assert.equal((await k.co(`/studio/courses/${k.course.id}`)).status, 404, "removed");
  await setLearnSettings({ instructorsEnabled: false });
  assert.equal((await k.edu(`/studio/courses/${k.course.id}/instructors`, { body: { identifier: "+256760000002" } })).json.error, "instructors_off");
});

test("cohorts: pick an intake, seats run out, and nothing opens before the start date", async () => {
  const ctx = await setup();
  const k = await hub(ctx);
  const future = new Date(Date.now() + 10 * 86400_000).toISOString();
  const first = await k.edu(`/studio/courses/${k.course.id}/cohorts`, { body: { name: "March intake", startsAt: future, capacity: 1 } });
  assert.equal(first.status, 201, JSON.stringify(first.json));
  const second = await k.edu(`/studio/courses/${k.course.id}/cohorts`, { body: { name: "May intake", startsAt: new Date(Date.now() + 60 * 86400_000).toISOString() } });

  const pub = (await ctx.request(`/v1/education/catalog/courses/${k.course.id}`)).json.course;
  assert.equal(pub.cohorts.length, 2);
  assert.equal(pub.cohorts[0].seatsLeft, 1);

  assert.equal((await k.me(`/learn/courses/${k.course.id}/enroll`, { body: {} })).json.error, "cohort_needed");
  assert.equal((await k.me(`/learn/courses/${k.course.id}/enroll`, { body: { cohortId: "nope" } })).json.error, "cohort_needed");
  assert.equal((await k.me(`/learn/courses/${k.course.id}/enroll`, { body: { cohortId: first.json.id } })).status, 200);
  assert.equal((await k.them(`/learn/courses/${k.course.id}/enroll`, { body: { cohortId: first.json.id } })).json.error, "cohort_needed", "the only seat is taken");
  assert.equal((await k.them(`/learn/courses/${k.course.id}/enroll`, { body: { cohortId: second.json.id } })).status, 200);

  // Before the start date the course is closed to them; after it, it opens.
  const view = (await k.me(`/learn/courses/${k.course.id}`)).json.course;
  assert.equal(view.modules[0].lessons[0].locked.reason, "drip");
  assert.equal((await k.me(`/learn/lessons/${k.a.id}`)).status, 403);
  await ctx.client.execute({ sql: "UPDATE edu_cohorts SET starts_at = ? WHERE id = ?", args: [new Date(Date.now() - 1000).toISOString(), first.json.id] });
  assert.equal((await k.me(`/learn/lessons/${k.a.id}`)).status, 200);

  assert.equal((await k.edu(`/studio/cohorts/${first.json.id}`, { method: "DELETE" })).json.error, "has_members");
  assert.equal((await k.edu(`/studio/cohorts/${first.json.id}`, { method: "PUT", body: { name: "March", startsAt: future, capacity: 0 } })).status, 400);
  const board = (await k.edu(`/studio/courses/${k.course.id}/community`)).json;
  assert.equal(board.cohorts.find((h: Json) => h.id === first.json.id).members, 1);
  await setLearnSettings({ cohortsEnabled: false });
  assert.equal((await k.edu(`/studio/courses/${k.course.id}/cohorts`, { body: { name: "June", startsAt: future } })).json.error, "cohorts_off");
});

test("a failed payment gives the cohort seat back", async () => {
  const ctx = await setup();
  const k = await hub(ctx);
  await k.edu(`/studio/courses/${k.course.id}`, { method: "PATCH", body: { priceUgx: 9000 } });
  await ctx.client.execute({ sql: "UPDATE users SET wallet_balance = 5 WHERE id = 'l_1'", args: [] });
  const h = await k.edu(`/studio/courses/${k.course.id}/cohorts`, { body: { name: "Only seat", startsAt: new Date(Date.now() + 86400_000).toISOString(), capacity: 1 } });
  assert.equal((await k.me(`/learn/courses/${k.course.id}/enroll`, { body: { cohortId: h.json.id } })).status, 402);
  assert.equal((await k.edu(`/studio/courses/${k.course.id}/community`)).json.cohorts[0].members, 0);
  assert.equal((await k.them(`/learn/courses/${k.course.id}/enroll`, { body: { cohortId: h.json.id } })).status, 200);
});

test("before migration 0120: none of it exists and everything else carries on", async () => {
  const ctx = await setup(["0120_"]);
  const k = await hub(ctx);
  assert.equal((await k.edu(`/studio/courses/${k.course.id}/announcements`, { body: { title: "Hi there" } })).status, 503);
  assert.equal((await k.edu(`/studio/courses/${k.course.id}/community`)).json.ready, false);
  assert.equal((await k.co(`/studio/courses/${k.course.id}`)).status, 404);
  assert.equal((await k.me(`/learn/courses/${k.course.id}/enroll`, { body: {} })).status, 200);
  assert.equal((await k.me(`/learn/lessons/${k.a.id}/complete`, { body: {} })).status, 200);
  const pub = (await ctx.request(`/v1/education/catalog/courses/${k.course.id}`)).json.course;
  assert.deepEqual(pub.rating, { average: null, count: 0 });
  assert.deepEqual(pub.cohorts, []);
  assert.equal((await k.me(`/learn/courses/${k.course.id}/qa`)).status, 200);
});
