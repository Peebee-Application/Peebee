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

process.env.JWT_SECRET = "lms-test-only-secret";
process.env.PUBLIC_API_URL = "https://api.test";

type Json = Record<string, any>;

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
    async batch(statements: { all(): Promise<unknown> }[]) {
      const out = [];
      for (const s of statements) out.push(await s.all());
      return out;
    },
  } as unknown as D1Database);
}

async function migrate(client: Client, skip: string[] = []) {
  const dir = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (skip.some((s) => file.startsWith(s))) continue;
    for (const sql of splitSqlStatements(readFileSync(join(dir, file), "utf8"))) await client.execute(sql);
  }
}

async function setup(skip: string[] = []) {
  resetSchemaCache();
  resetStudioCache();
  const client = createClient({ url: "file::memory:" });
  await migrate(client, skip);
  bindDatabase(client);
  setR2Binding({ async put() {}, async get() { return null; }, async delete() {} } as unknown as R2Bucket);
  await setLearnSettings({ createsPerHour: 1000, quizAttemptsPerHour: 200 });
  let n = 0;
  const mkUser = async (id: string) => {
    n += 1;
    await client.execute({
      sql: "INSERT INTO users (id, phone, name, role, password_hash, email_verified_at, wallet_balance) VALUES (?, ?, ?, 'customer', 'x', datetime('now'), 0)",
      args: [id, `+25675000${String(n).padStart(4, "0")}`, `Person ${id}`],
    });
    await client.execute({ sql: "INSERT INTO personal_wallets (user_id) VALUES (?)", args: [id] });
    return signToken({ sub: id, role: "customer" });
  };
  const request = async (path: string, o: { method?: string; token?: string; body?: unknown } = {}) => {
    const res = await app.request(path, {
      method: o.method ?? (o.body !== undefined ? "POST" : "GET"),
      headers: { "Content-Type": "application/json", ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}) },
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
    });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
  };
  return { client, mkUser, request };
}

const QUESTIONS = [
  { type: "single", question: "2 + 2?", options: ["3", "4", "5"], correctIndex: 1, explanation: "Two and two make four." },
  { type: "multiple", question: "Which are even?", options: ["2", "3", "4"], correctIndexes: [0, 2] },
  { type: "true_false", question: "The sun is a star.", answerBool: true },
  { type: "fill_blank", question: "Capital of Uganda?", accepted: ["Kampala"] },
];

/** An educator with a published course, and a learner enrolled in it. */
async function course(ctx: Awaited<ReturnType<typeof setup>>) {
  const teacher = await ctx.mkUser("t_1");
  const learner = await ctx.mkUser("l_1");
  const edu = (path: string, o: { method?: string; body?: unknown } = {}) => ctx.request(`/v1/education${path}`, { ...o, token: teacher });
  const me = (path: string, o: { method?: string; body?: unknown } = {}) => ctx.request(`/v1/education${path}`, { ...o, token: learner });
  const school = (await edu("/studio/schools", { body: { name: "LMS school", kind: "school", streams: ["foundations"] } })).json.school;
  const cls = (await edu(`/studio/schools/${school.id}/classes`, { body: { stream: "foundations", name: "P5", framework: "uganda_primary" } })).json.class;
  const c = (await edu(`/studio/classes/${cls.id}/courses`, { body: { title: "Maths", priceUgx: 0 } })).json.course;
  const m1 = (await edu(`/studio/courses/${c.id}/modules`, { body: { title: "Unit 1" } })).json.module;
  const m2 = (await edu(`/studio/courses/${c.id}/modules`, { body: { title: "Unit 2" } })).json.module;
  const add = async (moduleId: string, body: Json) => {
    const res = await edu(`/studio/modules/${moduleId}/lessons`, { body });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    return res.json.lesson as Json;
  };
  return { teacher, learner, edu, me, school, c, m1, m2, add };
}

test("lesson kinds: text, slides, live, quiz and exam each save what they need, and bad input is refused", async () => {
  const ctx = await setup();
  const k = await course(ctx);
  const text = await k.add(k.m1.id, { title: "Counting", contentType: "text", body: "One, two, three." });
  assert.equal(text.contentType, "text");
  assert.equal(text.body, "One, two, three.");
  const slides = await k.add(k.m1.id, { title: "Shapes", contentType: "slides", slides: [{ title: "Circle", body: "Round." }, { title: "Square", body: "Four sides." }] });
  assert.equal(slides.slides.length, 2);

  const soon = new Date(Date.now() + 3600_000).toISOString();
  const wrongHost = await k.edu(`/studio/modules/${k.m1.id}/lessons`, { body: { title: "Live", contentType: "live", live: { startsAt: soon, durationMinutes: 45, url: "https://evil.example/room" } } });
  assert.equal(wrongHost.status, 400);
  assert.equal(wrongHost.json.error, "live_host");
  const live = await k.add(k.m1.id, { title: "Live revision", contentType: "live", live: { startsAt: soon, durationMinutes: 45, url: "https://meet.jit.si/peebee-p5" } });
  assert.equal(live.live.url, "https://meet.jit.si/peebee-p5");

  const incomplete = await k.edu(`/studio/modules/${k.m2.id}/lessons`, { body: { title: "Bad quiz", contentType: "quiz", quiz: { title: "q", passingScorePercent: 50, questions: [{ type: "single", question: "No answer set", options: ["a", "b"] }] } } });
  assert.equal(incomplete.status, 400);
  const empty = await k.edu(`/studio/modules/${k.m2.id}/lessons`, { body: { title: "No paper", contentType: "exam" } });
  assert.equal(empty.json.error, "quiz_needed");

  const quiz = await k.add(k.m2.id, { title: "End of unit", contentType: "quiz", quiz: { title: "Unit 1 quiz", passingScorePercent: 60, questions: QUESTIONS } });
  assert.equal(quiz.quiz.questions.length, 4);
  assert.equal(quiz.quiz.questions[1].type, "multiple");

  // Old clients still send the earlier type names.
  const legacy = await k.add(k.m1.id, { title: "Old style", contentType: "reading" });
  assert.equal(legacy.contentType, "text");

  await setLearnSettings({ maxSlidesPerLesson: 1 });
  const tooMany = await k.edu(`/studio/lessons/${slides.id}`, { method: "PATCH", body: { slides: [{ title: "a", body: "" }, { title: "b", body: "" }] } });
  assert.equal(tooMany.json.error, "too_many_slides");
});

test("order: items move between sections in one save, and a stale order is refused", async () => {
  const ctx = await setup();
  const k = await course(ctx);
  const a = await k.add(k.m1.id, { title: "Alpha", contentType: "text", body: "a" });
  const q = await k.add(k.m1.id, { title: "Quiz", contentType: "quiz", quiz: { title: "q", passingScorePercent: 50, questions: QUESTIONS.slice(0, 1) } });
  const b = await k.add(k.m2.id, { title: "Bravo", contentType: "text", body: "b" });

  const moved = await k.edu(`/studio/courses/${k.c.id}/order`, { body: { modules: [k.m2.id, k.m1.id], lessons: { [k.m1.id]: [a.id], [k.m2.id]: [b.id, q.id] } } });
  assert.equal(moved.status, 200, JSON.stringify(moved.json));
  const detail = (await k.edu(`/studio/courses/${k.c.id}`)).json.course;
  assert.deepEqual(detail.modules.map((m: Json) => m.id), [k.m2.id, k.m1.id]);
  assert.deepEqual(detail.modules[0].lessons.map((l: Json) => l.id), [b.id, q.id]);

  const stale = await k.edu(`/studio/courses/${k.c.id}/order`, { body: { modules: [k.m2.id, k.m1.id], lessons: { [k.m1.id]: [a.id], [k.m2.id]: [b.id] } } });
  assert.equal(stale.status, 409);
  const stranger = await ctx.mkUser("t_2");
  assert.equal((await ctx.request(`/v1/education/studio/courses/${k.c.id}/order`, { token: stranger, body: { modules: [], lessons: {} } })).status, 404);
});

test("a learner takes a quiz: answers never leave the server, the paper is marked, and attempts are limited", async () => {
  const ctx = await setup();
  const k = await course(ctx);
  const text = await k.add(k.m1.id, { title: "Counting", contentType: "text", body: "One, two, three.", slides: [] });
  const quiz = await k.add(k.m1.id, { title: "Unit quiz", contentType: "quiz", quiz: { title: "Unit quiz", passingScorePercent: 75, questions: QUESTIONS, settings: { shuffleOptions: true, shuffleQuestions: true } } });
  const exam = await k.add(k.m2.id, { title: "Final", contentType: "exam", quiz: { title: "Final exam", passingScorePercent: 50, questions: QUESTIONS, settings: { timeLimitMinutes: 30 } } });
  await k.edu(`/studio/courses/${k.c.id}`, { method: "PATCH", body: { status: "published" } });
  assert.equal((await k.me(`/learn/courses/${k.c.id}/enroll`, { body: {} })).status, 200);

  const view = (await k.me(`/learn/courses/${k.c.id}`)).json.course;
  const items = view.modules.flatMap((m: Json) => m.lessons);
  const q = items.find((l: Json) => l.id === quiz.id);
  assert.equal(q.quiz.questionCount, 4);
  assert.ok(!JSON.stringify(view).includes("correctIndex") && !JSON.stringify(view).includes("Kampala"));
  assert.equal((await k.me(`/learn/lessons/${text.id}`)).json.lesson.body, "One, two, three.");

  // Marks a perfect sheet by reading what was served.
  const play = async (id: string, perfect: boolean) => {
    const start = await k.me(`/learn/lessons/${id}/quiz/start`, { body: {} });
    if (start.status !== 200) return { start };
    assert.ok(!JSON.stringify(start.json).includes("correct"), "no answers in the served paper");
    const answers: Json = {};
    for (const s of start.json.questions as Json[]) {
      if (s.type === "single") answers[s.id] = perfect ? s.options.indexOf("4") : 99;
      if (s.type === "multiple") answers[s.id] = perfect ? [s.options.indexOf("2"), s.options.indexOf("4")] : [];
      if (s.type === "true_false") answers[s.id] = perfect;
      if (s.type === "fill_blank") answers[s.id] = perfect ? " kampala" : "Nairobi";
    }
    const done = await k.me(`/learn/lessons/${id}/quiz/submit`, { body: { attemptToken: start.json.attemptToken, answers } });
    return { start, done };
  };

  const fail = await play(quiz.id, false);
  assert.equal(fail.done!.json.passed, false);
  assert.equal(fail.done!.json.attemptsUsed, 1);
  assert.ok(fail.done!.json.results[0].reveal, "quizzes show answers by default");
  assert.equal(JSON.stringify((await k.me(`/learn/courses/${k.c.id}`)).json.course).includes('"completed":true'), false);
  const pass = await play(quiz.id, true);
  assert.equal(pass.done!.json.scorePercent, 100);
  assert.equal(pass.done!.json.passed, true);

  // An exam gets one attempt, and does not show answers.
  const first = await play(exam.id, true);
  assert.equal(first.start.json.timeLimitMinutes, 30);
  assert.equal(first.done!.json.results[0].reveal, undefined);
  const second = await play(exam.id, true);
  assert.equal(second.start.status, 409);
  assert.equal(second.start.json.error, "no_attempts_left");

  const after = (await k.me(`/learn/courses/${k.c.id}`)).json.course;
  assert.equal(after.progressPercent, 67, "the quiz and exam are done, the text lesson isn't");

  // A token is only good for the lesson and the person it was made for.
  const start = await k.me(`/learn/lessons/${quiz.id}/quiz/start`, { body: {} });
  const wrongLesson = await k.me(`/learn/lessons/${text.id}/quiz/submit`, { body: { attemptToken: start.json.attemptToken, answers: {} } });
  assert.equal(wrongLesson.status, 400);
  const other = await ctx.mkUser("l_2");
  await ctx.request(`/v1/education/learn/courses/${k.c.id}/enroll`, { token: other, body: {} });
  const stolen = await ctx.request(`/v1/education/learn/lessons/${quiz.id}/quiz/submit`, { token: other, body: { attemptToken: start.json.attemptToken, answers: {} } });
  assert.equal(stolen.status, 400);
  assert.equal((await k.me(`/learn/lessons/${text.id}/complete`, { body: {} })).status, 200);
  assert.equal((await k.me(`/learn/lessons/${exam.id}/complete`, { body: {} })).status, 409, "an exam can't be ticked off");
});

test("a live lesson hands out its link only in the join window, and counts who came", async () => {
  const ctx = await setup();
  const k = await course(ctx);
  const later = await k.add(k.m1.id, { title: "Next week", contentType: "live", live: { startsAt: new Date(Date.now() + 7 * 86400_000).toISOString(), durationMinutes: 60, url: "https://zoom.us/j/123" } });
  const now = await k.add(k.m1.id, { title: "Right now", contentType: "live", live: { startsAt: new Date(Date.now() - 5 * 60_000).toISOString(), durationMinutes: 60, url: "https://us02web.zoom.us/j/456" } });
  const over = await k.add(k.m1.id, { title: "Last week", contentType: "live", live: { startsAt: new Date(Date.now() - 7 * 86400_000).toISOString(), durationMinutes: 60, url: "https://zoom.us/j/789" } });
  await k.edu(`/studio/courses/${k.c.id}`, { method: "PATCH", body: { status: "published" } });
  await k.me(`/learn/courses/${k.c.id}/enroll`, { body: {} });

  const view = (await k.me(`/learn/courses/${k.c.id}`)).json.course;
  assert.ok(!JSON.stringify(view).includes("zoom.us"), "the link is not in the course view");
  const byId = Object.fromEntries(view.modules[0].lessons.map((l: Json) => [l.id, l]));
  assert.equal(byId[later.id].live.joinOpen, false);
  assert.equal(byId[now.id].live.joinOpen, true);

  assert.equal((await k.me(`/learn/lessons/${later.id}/join`, { body: {} })).json.error, "live_not_open");
  assert.equal((await k.me(`/learn/lessons/${over.id}/join`, { body: {} })).json.error, "live_over");
  const joined = await k.me(`/learn/lessons/${now.id}/join`, { body: {} });
  assert.equal(joined.json.url, "https://us02web.zoom.us/j/456");
  assert.equal((await k.me(`/learn/lessons/${now.id}/complete`, { body: {} })).status, 409);
  const attendance = (await k.edu(`/studio/lessons/${now.id}/attendance`)).json;
  assert.equal(attendance.attendees.length, 1);
  assert.equal(attendance.enrolled, 1);

  await setLearnSettings({ liveLessonsEnabled: false });
  assert.equal((await k.me(`/learn/lessons/${now.id}/join`, { body: {} })).json.error, "live_off");
});

test("migration 0116 turns a lesson's own quiz into a quiz item and keeps the scores", async () => {
  const ctx = await setup(["0116_"]);
  const { client } = ctx;
  await client.execute({ sql: "INSERT INTO users (id, phone, name, role, password_hash) VALUES ('u_o', '+256751110001', 'O', 'customer', 'x'), ('u_l', '+256751110002', 'L', 'customer', 'x')", args: [] });
  await client.execute({ sql: "INSERT INTO edu_schools (id, owner_id, name, slug, kind, streams) VALUES ('s1', 'u_o', 'S', 's', 'school', 'foundations')", args: [] });
  await client.execute({ sql: "INSERT INTO edu_classes (id, school_id, stream, name) VALUES ('cl1', 's1', 'foundations', 'C')", args: [] });
  await client.execute({ sql: "INSERT INTO edu_courses (id, school_id, class_id, stream, title) VALUES ('co1', 's1', 'cl1', 'foundations', 'Course')", args: [] });
  await client.execute({ sql: "INSERT INTO edu_modules (id, course_id, title, position) VALUES ('m1', 'co1', 'Unit', 1)", args: [] });
  const quiz = JSON.stringify({ title: "T", passingScorePercent: 50, questions: [{ question: "q", options: ["a", "b"], correctIndex: 0 }] });
  await client.execute({ sql: "INSERT INTO edu_lessons (id, module_id, course_id, title, content_type, position, quiz_json) VALUES ('les_1', 'm1', 'co1', 'Lesson', 'reading', 1, ?), ('les_2', 'm1', 'co1', 'Plain', 'audio_story', 2, NULL)", args: [quiz] });
  await client.execute({ sql: "INSERT INTO edu_lesson_progress (user_id, lesson_id, course_id, best_score_percent) VALUES ('u_l', 'les_1', 'co1', 80)", args: [] });
  await client.execute({ sql: "INSERT INTO edu_quiz_attempts (id, user_id, lesson_id, course_id, score_percent, passed, answers_json) VALUES ('a1', 'u_l', 'les_1', 'co1', 80, 1, '[0]')", args: [] });

  const sql = readFileSync(join(process.cwd(), "src/db/migrations/0116_learn_lms_items.sql"), "utf8");
  for (const statement of splitSqlStatements(sql)) await client.execute(statement);
  // Running it twice changes nothing more (the ALTERs are the only non-repeatable part).
  for (const statement of splitSqlStatements(sql).filter((s) => !/^\s*ALTER/i.test(s))) await client.execute(statement);

  const rows = (await client.execute("SELECT id, content_type, position, quiz_json FROM edu_lessons ORDER BY id")).rows as Json[];
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId.les_1.content_type, "text");
  assert.equal(byId.les_1.quiz_json, null);
  assert.equal(byId.les_2.content_type, "audio");
  assert.equal(byId.les_1_q.content_type, "quiz");
  assert.ok(byId.les_1_q.position > byId.les_2.position, "the quiz moves to the end of the section");
  assert.equal(rows.length, 3);
  const progress = (await client.execute("SELECT best_score_percent FROM edu_lesson_progress WHERE lesson_id = 'les_1_q'")).rows[0] as Json;
  assert.equal(progress.best_score_percent, 80);
  assert.equal(((await client.execute("SELECT lesson_id FROM edu_quiz_attempts WHERE id = 'a1'")).rows[0] as Json).lesson_id, "les_1_q");
});

test("before migration 0116: text lessons say 'upgrade pending' while video, quiz and the rest keep working", async () => {
  const ctx = await setup(["0116_"]);
  const k = await course(ctx);
  const text = await k.edu(`/studio/modules/${k.m1.id}/lessons`, { body: { title: "Words", contentType: "text", body: "hi" } });
  assert.equal(text.status, 503);
  assert.equal(text.json.error, "upgrade_pending");
  const video = await k.add(k.m1.id, { title: "Clip", contentType: "video", contentUrl: "https://example.com/v.mp4" });
  assert.equal(video.contentType, "video");
  const quiz = await k.add(k.m1.id, { title: "Check", contentType: "quiz", quiz: { title: "c", passingScorePercent: 50, questions: QUESTIONS.slice(0, 1) } });
  await k.edu(`/studio/courses/${k.c.id}`, { method: "PATCH", body: { status: "published" } });
  await k.me(`/learn/courses/${k.c.id}/enroll`, { body: {} });
  const start = await k.me(`/learn/lessons/${quiz.id}/quiz/start`, { body: {} });
  assert.equal(start.status, 200);
  assert.equal((await k.me(`/learn/courses/${k.c.id}`)).status, 200);
});
