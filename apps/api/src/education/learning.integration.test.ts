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
import { gradeExam } from "./exam-grading.js";
import { splitPayment, sniffMedia } from "./learning.js";
import { setLearnSettings } from "./settings.js";
import { resetStudioCache } from "./studio.js";

process.env.JWT_SECRET = "learning-test-only-secret";
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
    async batch(statements: ReturnType<typeof prepare>[]) {
      const results = await client.batch(statements.map(({ sql, args }) => ({ sql, args: args as InArgs })), "write");
      return results.map((result) => ({ results: result.rows, success: true, meta: { changes: result.rowsAffected, last_row_id: Number(result.lastInsertRowid ?? 0) } }));
    },
  } as unknown as D1Database);
}

/** An in-memory stand-in for the R2 bucket, with range reads. */
function fakeR2() {
  const store = new Map<string, { bytes: Uint8Array; type?: string }>();
  const bucket: R2Bucket = {
    async put(key, value, options) {
      const bytes = value instanceof ReadableStream ? new Uint8Array(await new Response(value).arrayBuffer()) : new Uint8Array(value as ArrayBuffer);
      store.set(key, { bytes, type: options?.httpMetadata?.contentType });
    },
    async get(key, options) {
      const item = store.get(key);
      if (!item) return null;
      const range = options?.range;
      const slice = range ? item.bytes.slice(range.offset, range.offset + (range.length ?? item.bytes.length - range.offset)) : item.bytes;
      return { body: new Blob([slice as BlobPart]).stream(), httpMetadata: { contentType: item.type }, size: item.bytes.length };
    },
    async delete(key) {
      store.delete(key);
    },
  };
  return { bucket, store };
}

const MP4 = (extra = 64) => {
  const bytes = new Uint8Array(12 + extra);
  bytes.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d], 0); // ....ftypisom
  for (let i = 12; i < bytes.length; i += 1) bytes[i] = i % 251;
  return bytes;
};

async function setup() {
  resetSchemaCache();
  resetStudioCache();
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  const r2 = fakeR2();
  setR2Binding(r2.bucket);
  await setLearnSettings({ createsPerHour: 1000, quizAttemptsPerHour: 200 });

  let n = 0;
  const mkUser = async (id: string, wallet = 0) => {
    n += 1;
    await client.execute({
      sql: "INSERT INTO users (id, phone, name, role, password_hash, wallet_balance, email_verified_at) VALUES (?, ?, ?, 'customer', 'x', ?, datetime('now'))",
      args: [id, `+25672000${String(n).padStart(4, "0")}`, `User ${id}`, wallet],
    });
    await client.execute({ sql: "INSERT INTO personal_wallets (user_id) VALUES (?)", args: [id] });
    return signToken({ sub: id, role: "customer" });
  };
  const balance = async (id: string) => Number((await client.execute({ sql: "SELECT wallet_balance AS b FROM users WHERE id = ?", args: [id] })).rows[0].b);
  const earnings = async (id: string) => Number((await client.execute({
    sql: "SELECT COALESCE(SUM(w.balance), 0) AS b FROM provider_wallets w JOIN edu_schools s ON s.id=w.provider_id WHERE w.provider_type='education' AND w.environment='live' AND s.owner_id=?",
    args: [id],
  })).rows[0].b);
  const phone = async (id: string) => String((await client.execute({ sql: "SELECT phone FROM users WHERE id = ?", args: [id] })).rows[0].phone);
  const raw = async (path: string, opts: { method?: string; token?: string; body?: BodyInit | Uint8Array; headers?: Record<string, string> } = {}) => {
    const res = await app.request(`/v1${path}`, {
      method: opts.method ?? "GET",
      headers: { ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), ...opts.headers },
      body: opts.body as BodyInit | undefined,
    });
    return res;
  };
  const call = async (path: string, opts: { method?: string; token?: string; body?: unknown } = {}) => {
    const res = await raw(`/education${path}`, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      token: opts.token,
      headers: { "Content-Type": "application/json" },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
  };

  /** An educator with a published course that has one lesson with a quiz and one without. */
  const makeCourse = async (ownerToken: string, price = 0) => {
    const school = (await call("/studio/schools", { token: ownerToken, body: { name: "Hilltop School", kind: "school", streams: ["foundations"] } })).json.school;
    const cls = (await call(`/studio/schools/${school.id}/classes`, { token: ownerToken, body: { stream: "foundations", name: "P4", framework: "uganda_primary" } })).json.class;
    const course = (await call(`/studio/classes/${cls.id}/courses`, { token: ownerToken, body: { title: "Fractions", priceUgx: price } })).json.course;
    const mod = (await call(`/studio/courses/${course.id}/modules`, { token: ownerToken, body: { title: "Unit 1" } })).json.module;
    const plain = (await call(`/studio/modules/${mod.id}/lessons`, { token: ownerToken, body: { title: "Intro lesson" } })).json.lesson;
    const quizzed = (
      await call(`/studio/modules/${mod.id}/lessons`, {
        token: ownerToken,
        body: {
          title: "Halves",
          quiz: {
            title: "Check",
            passingScorePercent: 50,
            questions: [
              { question: "1/2 of 10?", options: ["5", "2"], correctIndex: 0, explanation: "Half of ten is five" },
              { question: "1/4 of 8?", options: ["4", "2"], correctIndex: 1, explanation: "A quarter of eight is two" },
            ],
          },
        },
      })
    ).json.lesson;
    await call(`/studio/courses/${course.id}`, { method: "PATCH", token: ownerToken, body: { status: "published" } });
    return { school, cls, course, mod, plain, quizzed };
  };
  return { client, r2, call, raw, mkUser, balance, earnings, phone, makeCourse };
}

test("pure helpers: commission split never overpays, media is identified by its bytes", () => {
  for (const [amount, pct] of [[100000, 10], [33333, 7], [1, 60], [999, 0]] as const) {
    const s = splitPayment(amount, pct);
    assert.equal(s.commission + s.payout, amount);
    assert.ok(s.commission >= 0 && s.payout >= 0);
  }
  assert.equal(sniffMedia(MP4())?.type, "video/mp4");
  assert.equal(sniffMedia(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]))?.type, "video/webm");
  assert.equal(sniffMedia(new TextEncoder().encode("<html><script>alert(1)</script>"))?.type, undefined);
  assert.equal(sniffMedia(new TextEncoder().encode("MZ\u0090\u0000executable-bytes")), null);
});

test("video: only the owner can upload, the bytes decide the type, size and the switch are enforced", async () => {
  const { call, raw, r2, mkUser, makeCourse } = await setup();
  const owner = await mkUser("own_1");
  const other = await mkUser("oth_1");
  const { plain } = await makeCourse(owner);
  const put = (token: string, bytes: Uint8Array, len = bytes.length) =>
    raw(`/education/studio/lessons/${plain.id}/media`, { method: "PUT", token, body: bytes, headers: { "Content-Length": String(len), "Content-Type": "video/mp4" } });

  assert.equal((await put(other, MP4())).status, 404, "someone else's lesson looks like it doesn't exist");
  const fake = new TextEncoder().encode("<html><script>alert(1)</script></html>");
  assert.equal((await put(owner, fake)).status, 400, "an HTML file renamed to video is refused");
  assert.equal(r2.store.size, 0, "nothing was stored");

  const ok = await put(owner, MP4(200));
  assert.equal(ok.status, 201);
  assert.equal(r2.store.size, 1);
  assert.equal((await call(`/studio/courses/${(await call(`/studio/lessons/${plain.id}`, { method: "PATCH", token: owner, body: {} })).json.lesson.courseId}`, { token: owner })).json.course.modules[0].lessons[0].media.contentType, "video/mp4");

  // Replacing the file removes the old one.
  assert.equal((await put(owner, MP4(300))).status, 201);
  assert.equal(r2.store.size, 1);

  await setLearnSettings({ maxVideoMb: 1 });
  assert.equal((await put(owner, MP4(), 2 * 1024 * 1024)).status, 413);
  await setLearnSettings({ videoUploadsEnabled: false });
  assert.equal((await put(owner, MP4())).status, 503);
  await setLearnSettings({ videoUploadsEnabled: true, maxVideoMb: 50 });

  assert.equal((await raw(`/education/studio/lessons/${plain.id}/media`, { method: "DELETE", token: other })).status, 404);
  assert.equal((await raw(`/education/studio/lessons/${plain.id}/media`, { method: "DELETE", token: owner })).status, 200);
  assert.equal(r2.store.size, 0);
});

test("video: only an enrolled learner gets a link, links stream with ranges and expire", async () => {
  const { call, raw, mkUser, makeCourse } = await setup();
  const owner = await mkUser("own_2");
  const learner = await mkUser("lrn_2");
  const outsider = await mkUser("out_2");
  const { plain, course } = await makeCourse(owner);
  const bytes = MP4(500);
  await raw(`/education/studio/lessons/${plain.id}/media`, { method: "PUT", token: owner, body: bytes, headers: { "Content-Length": String(bytes.length) } });

  assert.equal((await call(`/learn/lessons/${plain.id}/media-url`, { token: learner, body: {} })).status, 403, "not enrolled yet");
  assert.equal((await call(`/learn/courses/${course.id}/enroll`, { token: learner, body: {} })).status, 200);
  assert.equal((await call(`/learn/lessons/${plain.id}/media-url`, { token: outsider, body: {} })).status, 403);

  const link = (await call(`/learn/lessons/${plain.id}/media-url`, { token: learner, body: {} })).json.url as string;
  assert.ok(link.startsWith("https://api.test/v1/education/media/"));
  const path = link.replace("https://api.test/v1", "");

  const full = await raw(path);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "video/mp4");
  assert.equal(full.headers.get("x-content-type-options"), "nosniff");
  assert.equal(Number(full.headers.get("content-length")), bytes.length);
  assert.equal(new Uint8Array(await full.arrayBuffer()).length, bytes.length);

  const part = await raw(path, { headers: { Range: "bytes=10-19" } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-range"), `bytes 10-19/${bytes.length}`);
  assert.deepEqual([...new Uint8Array(await part.arrayBuffer())], [...bytes.slice(10, 20)]);
  assert.equal((await raw(path, { headers: { Range: "bytes=999999-" } })).status, 416);
  assert.equal((await raw("/education/media/not-a-real-token")).status, 401);
});

test("enrolment: free, paid (wallet debit, educator payout minus commission), refused without funds, never charged twice", async () => {
  const { call, mkUser, balance, earnings, makeCourse, client } = await setup();
  const owner = await mkUser("own_3");
  const rich = await mkUser("rich_3", 100_000);
  const poor = await mkUser("poor_3", 5_000);
  const { course } = await makeCourse(owner, 40_000);
  await setLearnSettings({ commissionPercent: 10 });

  assert.equal((await call(`/learn/courses/${course.id}`, { token: rich })).status, 403, "lessons are closed until enrolment");

  const broke = await call(`/learn/courses/${course.id}/enroll`, { token: poor, body: {} });
  assert.equal(broke.status, 402);
  assert.equal(await balance("poor_3"), 5_000, "nothing taken");
  assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM edu_enrollments")).rows[0].n), 0, "no half-made enrolment is left behind");

  assert.equal((await call(`/learn/courses/${course.id}/enroll`, { token: rich, body: {} })).status, 200);
  assert.equal(await balance("rich_3"), 60_000);
  assert.equal(await earnings("own_3"), 36_000, "educator receives price minus 10% commission");

  assert.equal((await call(`/learn/courses/${course.id}/enroll`, { token: rich, body: {} })).status, 409);
  assert.equal(await balance("rich_3"), 60_000, "a second tap is not charged");

  // Two taps at the same instant still charge once.
  const fresh = await mkUser("fresh_3", 100_000);
  const both = await Promise.all([call(`/learn/courses/${course.id}/enroll`, { token: fresh, body: {} }), call(`/learn/courses/${course.id}/enroll`, { token: fresh, body: {} })]);
  assert.deepEqual(both.map((r) => r.status).sort(), [200, 409], "one wins, the other is told it is already in progress or done");
  assert.equal(await balance("fresh_3"), 60_000);

  assert.equal((await call(`/learn/courses/${course.id}/enroll`, { token: owner, body: {} })).status, 400, "can't buy your own course");
  assert.equal((await call(`/learn/enrollments`, { token: rich })).json.enrollments[0].title, "Fractions");

  const view = await call(`/learn/courses/${course.id}`, { token: rich });
  assert.equal(view.status, 200);
  assert.ok(!JSON.stringify(view.json).includes("correctIndex") && !JSON.stringify(view.json).includes("Half of ten"), "the learner never receives quiz answers");
  const students = await call(`/studio/courses/${course.id}/students`, { token: owner });
  assert.equal(students.json.students.length, 2);
  assert.equal((await call(`/studio/courses/${course.id}/students`, { token: rich })).status, 404);

  await setLearnSettings({ enrolmentsEnabled: false });
  assert.equal((await call(`/learn/courses/${course.id}/enroll`, { token: poor, body: {} })).status, 503);
  await setLearnSettings({ enrolmentsEnabled: true, paidCoursesEnabled: false });
  assert.equal((await call(`/learn/courses/${course.id}/enroll`, { token: poor, body: {} })).status, 503);
});

test("enrolment: unpublished, suspended and unknown courses cannot be joined", async () => {
  const { call, mkUser, makeCourse, client } = await setup();
  const owner = await mkUser("own_4");
  const learner = await mkUser("lrn_4");
  const { course } = await makeCourse(owner);
  assert.equal((await call(`/learn/courses/crs_nope/enroll`, { token: learner, body: {} })).status, 404);
  await call(`/studio/courses/${course.id}`, { method: "PATCH", token: owner, body: { status: "draft" } });
  assert.equal((await call(`/learn/courses/${course.id}/enroll`, { token: learner, body: {} })).status, 404);
  await call(`/studio/courses/${course.id}`, { method: "PATCH", token: owner, body: { status: "published" } });
  await call(`/learn/courses/${course.id}/enroll`, { token: learner, body: {} });
  await client.execute("UPDATE edu_schools SET status = 'suspended'");
  assert.equal((await call(`/learn/courses/${course.id}`, { token: learner })).status, 403, "a suspended school's course closes");
});

test("quizzes are marked by the server; progress only counts passes; answers appear only after a pass", async () => {
  const { call, mkUser, makeCourse } = await setup();
  const owner = await mkUser("own_5");
  const learner = await mkUser("lrn_5");
  const { course, plain, quizzed } = await makeCourse(owner);
  await call(`/learn/courses/${course.id}/enroll`, { token: learner, body: {} });
  const quiz = (answers: number[]) => call(`/learn/lessons/${quizzed.id}/quiz`, { token: learner, body: { answers } });

  const bad = await quiz([1, 0]);
  assert.equal(bad.json.scorePercent, 0);
  assert.equal(bad.json.passed, false);
  assert.ok(!JSON.stringify(bad.json).includes("correctIndex") && !JSON.stringify(bad.json).includes("Half of ten"), "no answers leak on a fail");
  assert.equal((await call(`/learn/courses/${course.id}`, { token: learner })).json.course.progressPercent, 0);

  assert.equal((await quiz([0])).status, 400, "answers must cover every question");
  assert.equal((await call(`/learn/lessons/${quizzed.id}/complete`, { token: learner, body: {} })).json.error, "pass_quiz_first");

  const half = await quiz([0, 0]);
  assert.equal(half.json.scorePercent, 50);
  assert.equal(half.json.passed, true);
  assert.equal(half.json.results[0].correctIndex, 0);
  assert.equal(half.json.results[1].correct, false);
  assert.equal((await quiz([0, 1])).json.scorePercent, 100);

  assert.equal((await call(`/learn/lessons/${plain.id}/complete`, { token: learner, body: {} })).status, 200);
  assert.equal((await call(`/learn/lessons/${plain.id}/complete`, { token: learner, body: {} })).status, 200, "completing twice is harmless");
  const view = (await call(`/learn/courses/${course.id}`, { token: learner })).json.course;
  assert.equal(view.progressPercent, 100);
  assert.equal(view.modules[0].lessons.find((l: Json) => l.id === quizzed.id).bestScorePercent, 100);

  const outsider = await mkUser("out_5");
  assert.equal((await call(`/learn/lessons/${quizzed.id}/quiz`, { token: outsider, body: { answers: [0, 1] } })).status, 403);

  await setLearnSettings({ quizAttemptsPerHour: 2 });
  let last = 0;
  for (let i = 0; i < 4; i += 1) last = (await quiz([0, 1])).status;
  assert.equal(last, 429, "attempts are rate limited");
});

test("exams: marked on the server from a private key, once per learner", () => {
  const right = gradeExam("exam_uace_math_01", { q1: "x = 1, x = 1.5", q2: "9x^2 - 4cos(x) + 2e^(2x)", q3: "UGX 7,393,644" });
  assert.ok(right);
  assert.equal(right.autoPoints, right.autoOutOf);
  assert.equal(right.needsMarking, false);
  const wrong = gradeExam("exam_uace_math_01", { q1: "x = 2, x = -3", q2: "9x^2", q3: "4500000" });
  assert.equal(wrong?.autoPoints, 0);
  const mixed = gradeExam("exam_uace_math_01", { q1: "x = 1, x = 1.5" });
  assert.equal(mixed?.autoPoints, 5);
  assert.equal(gradeExam("exam_other", {}), null);
});

test("exams: the endpoint stores the result, never invents a score, and refuses a second attempt", async () => {
  const { call, mkUser } = await setup();
  const a = await mkUser("stu_6a");
  const b = await mkUser("stu_6b");
  const good = await call("/academy/exam/submit", {
    token: a,
    body: { examId: "exam_uace_math_01", answers: { q1: "x = 1, x = 1.5", q2: "9x² − 4cos x + 2e^(2x)", q3: "7393644" }, tabSwitchCount: 2, focusLossEventsCount: 1 },
  });
  assert.equal(good.status, 200, JSON.stringify(good.json));
  assert.equal(good.json.status, "graded");
  assert.equal(good.json.scorePercent, 100);
  assert.equal(good.json.passed, true);
  assert.equal(good.json.tabSwitchCount, 2);
  assert.equal((await call("/academy/exam/submit", { token: a, body: { examId: "exam_uace_math_01", answers: {} } })).status, 409);
  assert.equal((await call("/academy/exam/exam_uace_math_01/result", { token: a })).json.scorePercent, 100);

  const poor = await call("/academy/exam/submit", { token: b, body: { examId: "exam_uace_math_01", answers: { q1: "x = 2, x = -3" } } });
  assert.equal(poor.json.scorePercent, 0);
  assert.equal(poor.json.passed, false);
  assert.equal((await call("/academy/exam/exam_uace_math_01/result", { token: a })).json.scorePercent, 100, "one learner's result is not another's");
  assert.equal((await call("/academy/exam/nope/result", { token: b })).status, 404);
  assert.equal((await call("/academy/exam/submit", { token: b, body: { examId: "nope", answers: {} } })).status, 404);
});

test("fees: a school invoices a learner, who pays from the wallet in parts; the school gets paid minus commission", async () => {
  const { call, mkUser, balance, earnings, phone, makeCourse } = await setup();
  const owner = await mkUser("own_7", 0);
  const student = await mkUser("stu_7", 300_000);
  const stranger = await mkUser("str_7", 300_000);
  const { school } = await makeCourse(owner);
  await setLearnSettings({ commissionPercent: 10 });

  const make = (token: string, body: Json) => call(`/studio/schools/${school.id}/invoices`, { token, body });
  assert.equal((await make(stranger, { student: await phone("stu_7"), title: "Term 1 fees", amountUgx: 200_000 })).status, 404, "only the school's owner can invoice");
  assert.equal((await make(owner, { student: "+256000000000", title: "Term 1 fees", amountUgx: 200_000 })).json.error, "student_not_found");
  assert.equal((await make(owner, { student: await phone("own_7"), title: "Self", amountUgx: 1000 })).json.error, "own_account");
  const inv = (await make(owner, { student: await phone("stu_7"), title: "Term 1 fees", amountUgx: 200_000, dueDate: "2026-11-30" })).json.invoice;
  assert.equal(inv.balanceUgx, 200_000);

  assert.equal((await call("/learn/invoices", { token: student })).json.invoices.length, 1);
  assert.equal((await call("/learn/invoices", { token: stranger })).json.invoices.length, 0);
  const pay = (token: string, amountUgx: number) => call(`/learn/invoices/${inv.id}/pay`, { token, body: { amountUgx } });

  assert.equal((await pay(stranger, 1000)).status, 404, "someone else's invoice looks like it doesn't exist");
  assert.equal((await pay(student, 200_001)).json.error, "amount_too_high");
  const part = await pay(student, 50_000);
  assert.equal(part.status, 200);
  assert.equal(part.json.invoice.status, "partial");
  assert.equal(part.json.invoice.balanceUgx, 150_000);
  assert.equal(await balance("stu_7"), 250_000);
  assert.equal(await earnings("own_7"), 45_000);

  // The same last 150,000 sent twice at once is paid once.
  const race = await Promise.all([pay(student, 150_000), pay(student, 150_000)]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 400]);
  assert.equal(await balance("stu_7"), 100_000);
  assert.equal(await earnings("own_7"), 180_000);
  assert.equal((await call("/learn/invoices", { token: student })).json.invoices[0].status, "paid");
  assert.equal((await pay(student, 1000)).json.error, "already_paid");

  assert.equal((await call(`/studio/invoices/${inv.id}/cancel`, { token: owner, body: {} })).json.error, "already_paid");
});

test("fees: not enough in the wallet leaves the invoice exactly as it was", async () => {
  const { call, mkUser, balance, earnings, phone, makeCourse } = await setup();
  const owner = await mkUser("own_8");
  const student = await mkUser("stu_8", 10_000);
  const { school } = await makeCourse(owner);
  const inv = (await call(`/studio/schools/${school.id}/invoices`, { token: owner, body: { student: await phone("stu_8"), title: "Uniform", amountUgx: 80_000 } })).json.invoice;
  const pay = await call(`/learn/invoices/${inv.id}/pay`, { token: student, body: { amountUgx: 80_000 } });
  assert.equal(pay.status, 402);
  const after = (await call("/learn/invoices", { token: student })).json.invoices[0];
  assert.equal(after.paidUgx, 0);
  assert.equal(after.status, "unpaid");
  assert.equal(await balance("stu_8"), 10_000);
  assert.equal(await earnings("own_8"), 0);

  // An unpaid invoice can be cancelled, and a cancelled one disappears for the learner.
  assert.equal((await call(`/studio/invoices/${inv.id}/cancel`, { token: owner, body: {} })).status, 200);
  assert.equal((await call("/learn/invoices", { token: student })).json.invoices.length, 0);
  assert.equal((await call(`/learn/invoices/${inv.id}/pay`, { token: student, body: { amountUgx: 1000 } })).status, 404);

  await setLearnSettings({ feesEnabled: false });
  assert.equal((await call(`/studio/schools/${school.id}/invoices`, { token: owner, body: { student: await phone("stu_8"), title: "x1", amountUgx: 1000 } })).status, 503);
});

test("learning: answers 'upgrade pending' until migration 0111 is applied, and the older Studio keeps working", async () => {
  resetSchemaCache();
  resetStudioCache();
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    if (file.startsWith("0111_") || file.startsWith("0116_")) continue;
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  setR2Binding(fakeR2().bucket);
  await client.execute({ sql: "INSERT INTO users (id, phone, name, role, password_hash) VALUES ('u_9', '+256720009999', 'U', 'customer', 'x')", args: [] });
  const token = await signToken({ sub: "u_9", role: "customer" });
  const call = async (path: string, init: RequestInit = {}) => app.request(`/v1/education${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  assert.equal((await call("/learn/enrollments")).status, 503);
  assert.equal((await call("/academy/exam/submit", { method: "POST", body: JSON.stringify({ examId: "exam_uace_math_01", answers: {} }) })).status, 503);
  assert.equal((await call("/studio/schools")).status, 200, "the Studio from migration 0109 is unaffected");
  const school = await call("/studio/schools", { method: "POST", body: JSON.stringify({ name: "Early School", kind: "school", streams: ["skills"] }) });
  assert.equal(school.status, 201);
});

test("deleting: content with learners or fees is protected; everything else is cleaned up, files included", async () => {
  const { call, raw, r2, mkUser, phone, makeCourse, client } = await setup();
  const owner = await mkUser("own_10");
  const learner = await mkUser("lrn_10", 100_000);
  const { school, cls, course, plain, mod } = await makeCourse(owner, 20_000);
  const bytes = MP4(300);
  await raw(`/education/studio/lessons/${plain.id}/media`, { method: "PUT", token: owner, body: bytes, headers: { "Content-Length": String(bytes.length) } });
  assert.equal(r2.store.size, 1);
  await call(`/learn/courses/${course.id}/enroll`, { token: learner, body: {} });
  await call(`/learn/lessons/${plain.id}/complete`, { token: learner, body: {} });

  // Paying learners are protected from the course, class and school being deleted under them.
  for (const path of [`/studio/courses/${course.id}`, `/studio/classes/${cls.id}`, `/studio/schools/${school.id}`]) {
    const r = await call(path, { method: "DELETE", token: owner });
    assert.equal(r.status, 409, path);
    assert.equal(r.json.error, "has_learners");
  }
  assert.equal(r2.store.size, 1);

  // A lesson can still be removed; its file and the learners' progress on it go with it.
  assert.equal((await call(`/studio/lessons/${plain.id}`, { method: "DELETE", token: owner })).status, 200);
  assert.equal(r2.store.size, 0, "the stored file is deleted with the lesson");
  assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM edu_lesson_progress")).rows[0].n), 0);
  assert.equal((await call(`/studio/modules/${mod.id}`, { method: "DELETE", token: owner })).status, 200);

  // Fee invoices protect a school too, until they are cancelled.
  const second = await makeCourse(owner);
  void second;
  const free = (await call("/studio/schools", { token: owner, body: { name: "Second School", kind: "school", streams: ["skills"] } })).json.school;
  const inv = (await call(`/studio/schools/${free.id}/invoices`, { token: owner, body: { student: await phone("lrn_10"), title: "Fees", amountUgx: 5000 } })).json.invoice;
  assert.equal((await call(`/studio/schools/${free.id}`, { method: "DELETE", token: owner })).json.error, "has_invoices");
  await call(`/studio/invoices/${inv.id}/cancel`, { token: owner, body: {} });
  assert.equal((await call(`/studio/schools/${free.id}`, { method: "DELETE", token: owner })).status, 200);
  assert.equal(Number((await client.execute({ sql: "SELECT COUNT(*) AS n FROM edu_fee_invoices WHERE school_id = ?", args: [free.id] })).rows[0].n), 0);
});

test("deleting: a school with an upload but no learners is removed completely, including the file", async () => {
  const { call, raw, r2, mkUser, makeCourse, client } = await setup();
  const owner = await mkUser("own_11");
  const { school, plain } = await makeCourse(owner);
  const bytes = MP4(100);
  await raw(`/education/studio/lessons/${plain.id}/media`, { method: "PUT", token: owner, body: bytes, headers: { "Content-Length": String(bytes.length) } });
  assert.equal(r2.store.size, 1);
  assert.equal((await call(`/studio/schools/${school.id}`, { method: "DELETE", token: owner })).status, 200);
  assert.equal(r2.store.size, 0);
  for (const table of ["edu_schools", "edu_classes", "edu_courses", "edu_modules", "edu_lessons", "edu_lesson_media"]) {
    assert.equal(Number((await client.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n), 0, table);
  }
});
