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
import { resetStudioCache } from "./studio.js";
import { setLearnSettings } from "./settings.js";

process.env.JWT_SECRET = "education-test-only-secret";

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

async function setup(opts: { migrate?: boolean } = {}) {
  resetSchemaCache();
  resetStudioCache();
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    if (opts.migrate === false && (file.startsWith("0109_") || file.startsWith("0113_") || file.startsWith("0115_") || file.startsWith("0116_") || file.startsWith("0117_") || file.startsWith("0118_") || file.startsWith("0119_") || file.startsWith("0120_") || file.startsWith("0133_") || file.startsWith("0138_") || file.startsWith("0139_") || file.startsWith("0176_"))) continue; // 0133 alters edu_courses (needs 0109); 0138/0139 build on 0133
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  await setLearnSettings({ createsPerHour: 1000 });

  let n = 0;
  const mkUser = async (id: string, role: "customer" | "admin" = "customer") => {
    n += 1;
    await client.execute({
      sql: "INSERT INTO users (id, phone, name, role, password_hash, admin_role) VALUES (?, ?, ?, ?, 'x', ?)",
      args: [id, `+25671000${String(n).padStart(4, "0")}`, `User ${id}`, role, role === "admin" ? "super_admin" : null],
    });
    return signToken({ sub: id, role });
  };
  const call = async (path: string, opts: { method?: string; token?: string; body?: unknown } = {}) => {
    const res = await app.request(`/v1${path}`, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: { "Content-Type": "application/json", ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
  };
  const edu = (path: string, o: Parameters<typeof call>[1] = {}) => call(`/education${path}`, o);

  const makeSchool = async (token: string, extra: Json = {}) => {
    const r = await edu("/studio/schools", { token, body: { name: "Greenfield Primary", kind: "school", streams: ["foundations", "skills"], ...extra } });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    return r.json.school as Json;
  };
  const makeClass = async (token: string, schoolId: string, extra: Json = {}) => {
    const r = await edu(`/studio/schools/${schoolId}/classes`, {
      token,
      body: { stream: "foundations", name: "Primary 4 Blue", level: "Primary 4", framework: "uganda_primary", ...extra },
    });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    return r.json.class as Json;
  };
  const makeCourse = async (token: string, classId: string, extra: Json = {}) => {
    const r = await edu(`/studio/classes/${classId}/courses`, { token, body: { title: "Fractions", priceUgx: 0, ...extra } });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    return r.json.course as Json;
  };
  const makeModule = async (token: string, courseId: string) => {
    const r = await edu(`/studio/courses/${courseId}/modules`, { token, body: { title: "Module 1" } });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    return r.json.module as Json;
  };
  return { client, call, edu, mkUser, makeSchool, makeClass, makeCourse, makeModule };
}

test("learn: only the catalogue and stream list are public; everything else needs a sign-in", async () => {
  const { edu } = await setup();
  assert.equal((await edu("/streams")).status, 200);
  assert.equal((await edu("/catalog/courses")).status, 200);
  for (const [method, path, body] of [
    ["GET", "/sprouts/activities"],
    ["POST", "/sprouts/timer/unlock", { pin: "1234" }],
    ["GET", "/foundations/worksheets"],
    ["POST", "/chat/send", { text: "hi" }],
    ["POST", "/tuition/pay", { amountUgx: 1 }],
    ["GET", "/studio/schools"],
    ["POST", "/studio/schools", { name: "X" }],
  ] as const) {
    const r = await edu(path, { method, body });
    assert.equal(r.status, 401, `${method} ${path} must require sign-in`);
  }
});

test("learn: the old built-in PINs 1234 and 0000 no longer unlock anything", async () => {
  const { edu, mkUser } = await setup();
  const token = await mkUser("parent_1");
  assert.equal((await edu("/sprouts/timer/unlock", { token, body: { pin: "1234" } })).status, 409, "no PIN set yet");
  assert.equal((await edu("/sprouts/parent-pin", { method: "PUT", token, body: { pin: "4821" } })).status, 200);
  assert.equal((await edu("/sprouts/timer/unlock", { token, body: { pin: "1234" } })).status, 400);
  assert.equal((await edu("/sprouts/timer/unlock", { token, body: { pin: "0000" } })).status, 400);
  assert.equal((await edu("/sprouts/timer/unlock", { token, body: { pin: "4821" } })).json.unlocked, true);
  // Changing the PIN needs the current one.
  assert.equal((await edu("/sprouts/parent-pin", { method: "PUT", token, body: { pin: "9999" } })).status, 400);
  assert.equal((await edu("/sprouts/parent-pin", { method: "PUT", token, body: { pin: "9999", currentPin: "4821" } })).status, 200);
  // The PIN is stored hashed.
  const other = await mkUser("parent_2");
  assert.equal((await edu("/sprouts/timer/unlock", { token: other, body: { pin: "9999" } })).status, 409, "one account's PIN says nothing about another's");
});

test("learn: guessing the parent PIN locks the account out", async () => {
  const { edu, mkUser } = await setup();
  const token = await mkUser("parent_3");
  await edu("/sprouts/parent-pin", { method: "PUT", token, body: { pin: "4821" } });
  let last = 0;
  for (let i = 0; i < 8; i += 1) last = (await edu("/sprouts/timer/unlock", { token, body: { pin: String(1000 + i) } })).status;
  assert.equal(last, 429);
  assert.equal((await edu("/sprouts/timer/unlock", { token, body: { pin: "4821" } })).status, 429, "even the right PIN waits out the lock");
});

test("learn: chat identity comes from the session, and one account never sees another's messages", async () => {
  const { edu, mkUser } = await setup();
  const a = await mkUser("stu_a");
  const b = await mkUser("stu_b");
  const sent = await edu("/chat/send", { token: a, body: { text: "Hello class", roomId: "room_x", senderId: "tutor_1", senderName: "Principal", senderRole: "tutor" } });
  assert.equal(sent.status, 200);
  assert.equal(sent.json.message.senderId, "stu_a");
  assert.equal(sent.json.message.senderName, "User stu_a");
  assert.equal(sent.json.message.senderRole, "student");
  const mine = await edu("/chat/messages?id=room_x", { token: a });
  assert.equal(mine.json.messages.length, 1);
  const theirs = await edu("/chat/messages?id=room_x", { token: b });
  assert.equal(theirs.json.messages.length, 0);
  assert.equal((await edu("/chat/send", { token: a, body: { text: "x", attachmentUrl: "javascript:alert(1)" } })).status, 400);
  assert.equal((await edu("/chat/send", { token: a, body: { text: "" } })).status, 400);
});

test("learn: nothing is graded, signed or paid without the real thing happening", async () => {
  const { edu, mkUser } = await setup();
  const token = await mkUser("stu_c");
  const exam = await edu("/academy/exam/submit", { token, body: { examId: "exam_uace_math_01", answers: { q1: "x = 2, x = -3" }, tabSwitchCount: 3 } });
  assert.equal(exam.status, 200);
  assert.equal(exam.json.scorePercent, 0, "the server marks it from its own key, not a made-up number");
  assert.equal(exam.json.passed, false);

  const log = await edu("/skills/logbook", { token, body: { practicalHours: 4, taskPerformed: "Fades", workshopLocation: "Studio", supervisorName: "Master Alex" } });
  assert.equal(log.status, 200);
  assert.equal(log.json.entry.supervisorSignatureRecorded, false, "a learner cannot sign for their supervisor");

  // A parent signature counts only with the real PIN.
  const noPinYet = await edu("/foundations/worksheets/submit", { token, body: { worksheetId: "ws_p4_math", parentPin: "1111", parentSignerName: "Mum" } });
  assert.equal(noPinYet.status, 409, "typing a PIN when none is set is not a signature");
  const unsigned = await edu("/foundations/worksheets/submit", { token, body: { worksheetId: "ws_p4_math", scannedPhotoUrls: ["https://example.com/a.jpg"] } });
  assert.equal(unsigned.status, 200);
  assert.equal(unsigned.json.submission.parentSigned, false);
  assert.equal(unsigned.json.submission.status, "pending_parent");
  assert.equal(unsigned.json.submission.studentId, "stu_c", "the student is whoever is signed in");
  assert.equal(unsigned.json.submission.meritPointsEarned, 0, "merit stars are awarded by a teacher, not by submitting");
  await edu("/sprouts/parent-pin", { method: "PUT", token, body: { pin: "7342" } });
  assert.equal((await edu("/foundations/worksheets/submit", { token, body: { worksheetId: "ws_p4_math", parentPin: "1111" } })).status, 400);
  const signed = await edu("/foundations/worksheets/submit", { token, body: { worksheetId: "ws_p4_math", parentPin: "7342", parentSignerName: "Mum" } });
  assert.equal(signed.status, 200);
  assert.equal(signed.json.submission.parentSigned, true);
  assert.equal((await edu("/foundations/worksheets/submit", { token, body: { worksheetId: "ws_nope" } })).status, 404);
  assert.equal((await edu("/foundations/worksheets/submit", { token, body: { worksheetId: "ws_p4_math", scannedPhotoUrls: ["javascript:alert(1)"] } })).status, 400);

  const pay = await edu("/tuition/pay", { token, body: { amountUgx: 1_000_000 } });
  assert.equal(pay.status, 410, "the demo fee schedule can't take payment; real fees are invoices");

  const critique = await edu("/skills/critiques", { token, body: { timestampSeconds: 5, critiqueText: "Nice" } });
  assert.equal(critique.status, 403, "only an educator can critique");
});

test("studio: school → class → course → module → lesson, then publish", async () => {
  const { edu, mkUser, makeSchool, makeClass, makeCourse, makeModule } = await setup();
  const token = await mkUser("teacher_1");
  const school = await makeSchool(token);
  assert.equal(school.status, "active");
  assert.deepEqual(school.streams, ["foundations", "skills"]);
  const cls = await makeClass(token, school.id);
  assert.equal(cls.kind, "class");
  const course = await makeCourse(token, cls.id, { outcomes: ["Add fractions"] });
  assert.equal(course.status, "draft");

  const empty = await edu(`/studio/courses/${course.id}`, { method: "PATCH", token, body: { status: "published" } });
  assert.equal(empty.status, 409, "can't publish a course with nothing to teach");

  const mod = await makeModule(token, course.id);
  const lesson = await edu(`/studio/modules/${mod.id}/lessons`, {
    token,
    body: {
      title: "Halves and quarters",
      durationMinutes: 20,
      contentUrl: "https://example.com/video.mp4",
      quiz: { title: "Check", passingScorePercent: 60, questions: [{ question: "1/2 of 10?", options: ["5", "2"], correctIndex: 0 }] },
    },
  });
  assert.equal(lesson.status, 201, JSON.stringify(lesson.json));
  assert.equal(lesson.json.lesson.quiz.questions.length, 1);

  const published = await edu(`/studio/courses/${course.id}`, { method: "PATCH", token, body: { status: "published" } });
  assert.equal(published.status, 200);
  assert.equal(published.json.course.status, "published");
  assert.equal(published.json.course.lessonCount, 1);

  const detail = await edu(`/studio/courses/${course.id}`, { token });
  assert.equal(detail.json.course.modules[0].lessons[0].title, "Halves and quarters");
  const schools = await edu("/studio/schools", { token });
  assert.equal(schools.json.schools[0].classCount, 1);
  assert.equal(schools.json.schools[0].courseCount, 1);
  assert.equal(schools.json.schools[0].publishedCourseCount, 1);
  assert.equal(schools.json.schools[0].lessonCount, 1);
  assert.equal((await edu(`/studio/schools/${school.id}`, { token })).json.school.name, "Greenfield Primary");
  assert.equal((await edu(`/studio/classes/${cls.id}`, { token })).json.class.courseCount, 1);
});

test("studio: another educator can neither see nor change your work (and cannot tell it exists)", async () => {
  const { edu, mkUser, makeSchool, makeClass, makeCourse, makeModule } = await setup();
  const owner = await mkUser("owner_1");
  const intruder = await mkUser("intruder_1");
  const school = await makeSchool(owner);
  const cls = await makeClass(owner, school.id);
  const course = await makeCourse(owner, cls.id);
  const mod = await makeModule(owner, course.id);
  const les = await edu(`/studio/modules/${mod.id}/lessons`, { token: owner, body: { title: "Secret lesson" } });
  const lessonId = les.json.lesson.id;

  const probes: [string, string, unknown?][] = [
    ["GET", `/studio/schools/${school.id}`],
    ["GET", `/studio/classes/${cls.id}`],
    ["GET", `/studio/schools/${school.id}/classes`],
    ["PATCH", `/studio/schools/${school.id}`, { name: "Hijacked" }],
    ["DELETE", `/studio/schools/${school.id}`],
    ["POST", `/studio/schools/${school.id}/classes`, { stream: "foundations", name: "Fake class" }],
    ["PATCH", `/studio/classes/${cls.id}`, { name: "Hijacked" }],
    ["DELETE", `/studio/classes/${cls.id}`],
    ["GET", `/studio/classes/${cls.id}/courses`],
    ["POST", `/studio/classes/${cls.id}/courses`, { title: "Planted course" }],
    ["GET", `/studio/courses/${course.id}`],
    ["PATCH", `/studio/courses/${course.id}`, { title: "Hijacked" }],
    ["DELETE", `/studio/courses/${course.id}`],
    ["POST", `/studio/courses/${course.id}/modules`, { title: "Planted" }],
    ["PATCH", `/studio/modules/${mod.id}`, { title: "Hijacked" }],
    ["DELETE", `/studio/modules/${mod.id}`],
    ["POST", `/studio/modules/${mod.id}/lessons`, { title: "Planted" }],
    ["PATCH", `/studio/lessons/${lessonId}`, { title: "Hijacked" }],
    ["DELETE", `/studio/lessons/${lessonId}`],
  ];
  for (const [method, path, body] of probes) {
    const r = await edu(path, { method, token: intruder, body });
    assert.equal(r.status, 404, `${method} ${path} must look like it doesn't exist: ${JSON.stringify(r.json)}`);
  }
  assert.deepEqual((await edu("/studio/schools", { token: intruder })).json.schools, []);

  const still = await edu(`/studio/courses/${course.id}`, { token: owner });
  assert.equal(still.json.course.title, "Fractions");
  assert.equal(still.json.course.modules[0].lessons[0].title, "Secret lesson");
});

test("studio: admin settings decide what is allowed", async () => {
  const { edu, mkUser, makeSchool, makeClass } = await setup();
  const token = await mkUser("teacher_2");

  await setLearnSettings({ maxSchoolsPerUser: 1 });
  const school = await makeSchool(token);
  const second = await edu("/studio/schools", { token, body: { name: "Another", kind: "school", streams: ["skills"] } });
  assert.equal(second.status, 409);
  assert.equal(second.json.error, "limit_reached");

  // A stream that is closed cannot be used.
  await setLearnSettings({ streams: ["foundations"] });
  const closed = await edu(`/studio/schools/${school.id}/classes`, { token, body: { stream: "skills", name: "Closed stream", framework: "open_syllabus" } });
  assert.equal(closed.status, 400);
  assert.equal(closed.json.error, "stream_closed");
  await setLearnSettings({ streams: ["sprouts", "foundations", "academy", "compass", "skills"] });

  // The class must be in a stream the school offers, on a syllabus used in that stream.
  assert.equal((await edu(`/studio/schools/${school.id}/classes`, { token, body: { stream: "academy", name: "Wrong stream" } })).json.error, "stream_not_offered");
  assert.equal((await edu(`/studio/schools/${school.id}/classes`, { token, body: { stream: "foundations", name: "Wrong syllabus", framework: "ib_diploma" } })).json.error, "framework_mismatch");

  // Masterclasses can be switched off.
  await setLearnSettings({ masterclassesEnabled: false });
  assert.equal((await edu(`/studio/schools/${school.id}/classes`, { token, body: { stream: "skills", kind: "masterclass", name: "Guitar", framework: "open_syllabus" } })).json.error, "masterclasses_off");
  await setLearnSettings({ masterclassesEnabled: true });
  const master = await makeClass(token, school.id, { stream: "skills", kind: "masterclass", name: "Guitar", framework: "open_syllabus" });
  assert.equal(master.kind, "masterclass");

  // Class and course counts, prices and lesson length obey the limits.
  await setLearnSettings({ maxCoursesPerClass: 1, maxCoursePriceUgx: 100_000 });
  const cls = await makeClass(token, school.id);
  assert.equal((await edu(`/studio/classes/${cls.id}/courses`, { token, body: { title: "Too dear", priceUgx: 100_001 } })).json.error, "price_too_high");
  assert.equal((await edu(`/studio/classes/${cls.id}/courses`, { token, body: { title: "OK course", priceUgx: 100_000 } })).status, 201);
  assert.equal((await edu(`/studio/classes/${cls.id}/courses`, { token, body: { title: "One too many" } })).json.error, "limit_reached");

  await setLearnSettings({ paidCoursesEnabled: false, maxCoursesPerClass: 12 });
  assert.equal((await edu(`/studio/classes/${cls.id}/courses`, { token, body: { title: "Paid", priceUgx: 5000 } })).json.error, "paid_courses_off");
  assert.equal((await edu(`/studio/classes/${cls.id}/courses`, { token, body: { title: "Free", priceUgx: 0 } })).status, 201);

  // The master switch.
  await setLearnSettings({ enabled: false });
  assert.equal((await edu(`/studio/schools/${school.id}/classes`, { token, body: { stream: "foundations", name: "Off" } })).status, 503);
});

test("studio: lesson input is checked (https links only, quiz shape, length)", async () => {
  const { edu, mkUser, makeSchool, makeClass, makeCourse, makeModule } = await setup();
  const token = await mkUser("teacher_3");
  const course = await makeCourse(token, (await makeClass(token, (await makeSchool(token)).id)).id);
  const mod = await makeModule(token, course.id);
  const post = (b: Json) => edu(`/studio/modules/${mod.id}/lessons`, { token, body: b });

  for (const bad of ["javascript:alert(1)", "http://insecure.example.com/x", "data:text/html,<script>1</script>", "not a url"]) {
    assert.equal((await post({ title: "Bad link", contentUrl: bad })).status, 400, bad);
  }
  assert.equal((await post({ title: "x" })).status, 400, "titles need two characters");
  assert.equal((await post({ title: "Quiz", quiz: { title: "q", passingScorePercent: 50, questions: [{ question: "?", options: ["a", "b"], correctIndex: 5 }] } })).status, 400);
  assert.equal((await post({ title: "Quiz", quiz: { title: "q", passingScorePercent: 150, questions: [{ question: "?", options: ["a", "b"], correctIndex: 0 }] } })).status, 400);
  await setLearnSettings({ maxLessonMinutes: 60, maxQuizQuestionsPerLesson: 1 });
  assert.equal((await post({ title: "Long one", durationMinutes: 61 })).json.error, "lesson_too_long");
  const twoQs = { title: "q", passingScorePercent: 50, questions: [{ question: "1?", options: ["a", "b"], correctIndex: 0 }, { question: "2?", options: ["a", "b"], correctIndex: 1 }] };
  assert.equal((await post({ title: "Too many questions", quiz: twoQs })).json.error, "quiz_too_long");
  const stored = await post({ title: "<b>Bold</b>\u0000 title", contentUrl: "https://ok.example.com/a.mp4" });
  assert.equal(stored.status, 201);
  assert.ok(!stored.json.lesson.title.includes("\u0000"), "control characters are stripped");
  assert.equal((await post({ title: "Huge", summary: "x".repeat(2001) })).status, 400);
});

test("studio: creating things too fast is throttled", async () => {
  const { edu, mkUser, makeSchool, makeClass } = await setup();
  const token = await mkUser("teacher_4");
  const school = await makeSchool(token);
  await setLearnSettings({ createsPerHour: 2 });
  let last = 0;
  for (let i = 0; i < 4; i += 1) {
    last = (await edu(`/studio/schools/${school.id}/classes`, { token, body: { stream: "foundations", name: `Class ${i}`, framework: "uganda_primary" } })).status;
  }
  assert.equal(last, 429);
  void makeClass;
});

test("catalogue: shows only published courses from active schools, and never the quiz answers", async () => {
  const { edu, call, mkUser, makeSchool, makeClass, makeCourse, makeModule } = await setup();
  const admin = await mkUser("admin_1", "admin");
  const token = await mkUser("teacher_5");
  const school = await makeSchool(token);
  const cls = await makeClass(token, school.id);
  const live = await makeCourse(token, cls.id, { title: "Live course" });
  const draft = await makeCourse(token, cls.id, { title: "Draft course" });
  const mod = await makeModule(token, live.id);
  await edu(`/studio/modules/${mod.id}/lessons`, {
    token,
    body: { title: "Lesson one", quiz: { title: "Q", passingScorePercent: 50, questions: [{ question: "Secret?", options: ["yes", "no"], correctIndex: 1, explanation: "Because no" }] } },
  });
  await edu(`/studio/courses/${live.id}`, { method: "PATCH", token, body: { status: "published" } });

  const list = await edu("/catalog/courses");
  assert.deepEqual(list.json.courses.map((c: Json) => c.title), ["Live course"]);
  assert.equal((await edu(`/catalog/courses/${draft.id}`)).status, 404);

  const detail = await edu(`/catalog/courses/${live.id}`);
  assert.equal(detail.status, 200);
  const raw = JSON.stringify(detail.json);
  assert.ok(!raw.includes("correctIndex") && !raw.includes("Because no") && !raw.includes("quiz_json"), "quiz answers never leave the educator's own view");
  assert.equal(detail.json.course.modules[0].lessons[0].questionCount, 1);

  // Staff can suspend a school: it drops out of the catalogue and its owner can no longer edit it.
  const sus = await call(`/admin/learn-schools/${school.id}/status`, { token: admin, body: { status: "suspended" } });
  assert.equal(sus.status, 200, JSON.stringify(sus.json));
  assert.equal((await edu("/catalog/courses")).json.courses.length, 0);
  assert.equal((await edu(`/studio/schools/${school.id}`, { method: "PATCH", token, body: { name: "Still me" } })).json.error, "school_suspended");
  // Someone who is not staff cannot suspend or restore.
  assert.equal((await call(`/admin/learn-schools/${school.id}/status`, { token, body: { status: "active" } })).status, 403);
  await call(`/admin/learn-schools/${school.id}/status`, { token: admin, body: { status: "active" } });
  assert.equal((await edu("/catalog/courses")).json.courses.length, 1);
});

test("admin: Learn settings are validated, staff-only and recorded in the activity log", async () => {
  const { call, client, mkUser } = await setup();
  const admin = await mkUser("admin_2", "admin");
  const user = await mkUser("plain_1");
  assert.equal((await call("/admin/learn-settings", { token: user })).status, 403);
  assert.equal((await call("/admin/learn-settings", { method: "PATCH", token: user, body: { enabled: false } })).status, 403);
  assert.equal((await call("/admin/learn-settings", { method: "PATCH", token: admin, body: { maxSchoolsPerUser: 0 } })).status, 400);
  assert.equal((await call("/admin/learn-settings", { method: "PATCH", token: admin, body: { streams: ["nonsense"] } })).status, 400);
  const ok = await call("/admin/learn-settings", { method: "PATCH", token: admin, body: { maxSchoolsPerUser: 5, paidCoursesEnabled: false } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.learn.maxSchoolsPerUser, 5);
  assert.equal(ok.json.learn.paidCoursesEnabled, false);
  const log = await client.execute("SELECT summary FROM admin_activity_log WHERE summary LIKE '%Peebee Learn%'");
  assert.equal(log.rows.length, 1);
});

test("studio: answers 'upgrade pending' instead of failing when migration 0109 isn't applied yet", async () => {
  const { edu, mkUser } = await setup({ migrate: false });
  const token = await mkUser("teacher_6");
  const r = await edu("/studio/schools", { token });
  assert.equal(r.status, 503);
  assert.equal(r.json.error, "learn_upgrade_pending");
  assert.equal((await edu("/catalog/courses")).status, 200, "the public catalogue just shows nothing");
});
