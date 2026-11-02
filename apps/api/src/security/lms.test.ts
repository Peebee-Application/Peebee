import test from "node:test";
import assert from "node:assert/strict";
import { addAdmin, addMerchantStore, addUser, anonymous, app, freshDatabase } from "../test-support/db.js";
import { setSmsSenderForTests } from "../lib/sms-gateway.js";
import { setEmailSenderForTests } from "../lib/email-gateway.js";

const json = async (res: Response) => (await res.json()) as any;
type Db = Awaited<ReturnType<typeof freshDatabase>>;

async function setup() {
  const client = await freshDatabase();
  const admin = await addAdmin(client);
  const seller = await addMerchantStore(client, "u_lms_seller");
  assert.equal((await seller.call("/merchants/me/store/tier", "POST", {tier: "elite"})).status, 200);
  const course = async (body: object = {}) =>
    json(await seller.call("/merchants/me/lms/courses", "POST", {
      title: "Poultry Masterclass", price_ugx: 40000,
      modules: [{ title: "M1", lessons: [{ title: "L1", content_url: "https://www.youtube.com/watch?v=x" }, { title: "L2" }] }, { title: "M2", lessons: [{ title: "L3" }] }, { title: "M3", lessons: [{ title: "L4" }] }],
      ...body,
    }));
  const student = async (id: string, phone: string) => addUser(client, id, "customer", { phone });
  return { client, admin, seller, course, student };
}
const catalogIds = async () => (await json(await anonymous("/education/catalog/courses"))).courses.map((c: any) => c.id);

test("students are real accounts: the seat is theirs, and how accounts are made follows the admin option", async () => {
  const { client, admin, seller, course } = await setup();
  const made = await course();
  const courseId = made.course.id;
  const enrol = (body: object) => seller.call("/merchants/me/lms/enrollments", "POST", { courseId, ...body });

  // No real SMS: the working option is "must already have an account".
  const unknown = await enrol({ studentName: "Nina Student", studentPhone: "0700 111 222" });
  assert.equal(unknown.status, 404);
  assert.equal((await json(unknown)).error, "student_not_registered");

  const texts: Array<{ to: string; body: string }> = [];
  setSmsSenderForTests(async (to, body) => { texts.push({ to, body }); return { status: "sent", provider: "africas_talking", externalId: "m1" }; });
  try {
    const created = await json(await enrol({ studentName: "Nina Student", studentPhone: "0700 111 222" }));
    assert.equal(created.accountCreated, true, "with a real SMS provider the account is made from the phone");
    const user = (await client.execute("SELECT id, role, phone FROM users WHERE phone = '+256700111222'")).rows[0];
    assert.equal(user.role, "customer");
    const seat = (await client.execute({ sql: "SELECT user_id, status, price_paid_ugx FROM edu_enrollments WHERE course_id = ?", args: [courseId] })).rows[0];
    assert.equal(seat.user_id, user.id, "the Learn seat is Nina's, not the merchant's");
    assert.equal(created.notice.channel, "sms");
    assert.equal(created.notice.status, "delivered", "the provider accepted it");
    assert.match(texts[0].body, /forgot-password/, "a new account is told how to set a password");
    assert.equal((await enrol({ studentName: "Nina Student", studentPhone: "+256700111222" })).status, 409, "enrolling twice is refused");

    // An existing account is just enrolled, with a course link.
    await addUser(client, "u_existing_stu", "customer", { phone: "+256700333444" });
    const existing = await json(await enrol({ studentName: "Eddie Existing", studentPhone: "0700333444", sendSmsNotice: true }));
    assert.equal(existing.accountCreated, false);
    assert.match(texts[texts.length - 1].body, /learn\/course/);

    // A partner account is not a student.
    await addUser(client, "u_rider_stu", "rider", { phone: "+256700555666" });
    assert.equal((await enrol({ studentName: "Rita Rider", studentPhone: "0700555666" })).status, 409);

    await admin.setOptions({ lms_enrollment_identity: "require_existing_account" });
    assert.equal((await enrol({ studentName: "Nobody New", studentPhone: "0700777888" })).status, 404);
  } finally {
    setSmsSenderForTests(null);
  }

  // Email invitations need an email provider.
  const refused = await admin.call("/admin/option-settings", "PATCH", { values: { lms_enrollment_identity: "email_invite" } });
  assert.equal(refused.status, 400);
  const mails: Array<{ to: string; subject: string; text: string }> = [];
  setEmailSenderForTests(async (to, subject, text) => { mails.push({ to, subject, text }); });
  try {
    await admin.setOptions({ lms_enrollment_identity: "email_invite" });
    assert.equal((await enrol({ studentName: "No Email", studentPhone: "0700999000" })).status, 400, "an invitation needs an email address");
    const invited = await json(await enrol({ studentName: "Ian Invited", studentPhone: "0700999111", studentEmail: "ian@example.com" }));
    assert.equal(invited.notice.channel, "email");
    assert.equal(mails[0].to, "ian@example.com");
    assert.match(mails[0].subject, /Poultry Masterclass/);
    setEmailSenderForTests(async () => { throw new Error("mailbox full"); });
    const failed = await json(await enrol({ studentName: "Fay Failed", studentPhone: "0700999222", studentEmail: "fay@example.com" }));
    assert.equal(failed.notice.status, "failed", "a failed email is reported as failed");
    assert.match(failed.notice.error, /mailbox full/);
  } finally {
    setEmailSenderForTests(null);
  }
});

test("progress, completion and certificates come from what learners really did", async () => {
  const { client, admin, seller, course, student } = await setup();
  const made = await course();
  const courseId = made.course.id as string;
  assert.equal(made.course.total_lessons, 4, "computed from the lessons, not a fixed number");
  await student("u_prog", "+256700121212");
  const enrolled = await json(await seller.call("/merchants/me/lms/enrollments", "POST", { courseId, studentName: "Pat Progress", studentPhone: "+256700121212" }));
  assert.equal(enrolled.enrollment.total_lessons, 4);

  const lessons = (await client.execute({ sql: "SELECT id FROM edu_lessons WHERE course_id = ? ORDER BY position, id", args: [courseId] })).rows.map((r) => String(r.id));
  for (const [i, id] of lessons.slice(0, 2).entries()) {
    await client.execute({ sql: "INSERT INTO edu_lesson_progress (user_id, lesson_id, course_id, best_score_percent) VALUES ('u_prog', ?, ?, ?)", args: [id, courseId, i === 0 ? 80 : 100] });
  }
  const list = async () => (await json(await seller.call("/merchants/me/lms/enrollments"))).enrollments[0];
  let row = await list();
  assert.equal(row.completed_lessons, 2);
  assert.equal(row.progress_percent, 50);
  assert.equal(row.quiz_average_score, 90);
  assert.equal(row.access_status, "active");
  assert.equal((await json(await seller.call("/merchants/me/lms/courses"))).courses[0].completion_rate_percent, 0, "nobody has finished yet");

  // Certificates: automatic by default (Learn issues them), by hand when admin says so.
  assert.equal((await seller.call(`/merchants/me/lms/enrollments/${row.id}/certificate`, "POST", {})).status, 409, "not the manual mode");
  await admin.setOptions({ lms_certificates: "manual_issue" });
  const second = await course({ title: "Manual Cert Course" });
  const rule = (await client.execute({ sql: "SELECT certificate_enabled FROM edu_course_rules WHERE course_id = ?", args: [second.course.id] })).rows[0];
  assert.equal(Number(rule.certificate_enabled), 0, "new courses don't auto-issue under the manual option");
  const e2 = await json(await seller.call("/merchants/me/lms/enrollments", "POST", { courseId: second.course.id, studentName: "Pat Progress", studentPhone: "+256700121212" }));
  assert.equal((await seller.call(`/merchants/me/lms/enrollments/${e2.enrollment.id}/certificate`, "POST", {})).status, 409, "not finished");
  const l2 = (await client.execute({ sql: "SELECT id FROM edu_lessons WHERE course_id = ?", args: [second.course.id] })).rows.map((r) => String(r.id));
  for (const id of l2) await client.execute({ sql: "INSERT INTO edu_lesson_progress (user_id, lesson_id, course_id, best_score_percent) VALUES ('u_prog', ?, ?, 70)", args: [id, second.course.id] });
  assert.equal((await seller.call(`/merchants/me/lms/enrollments/${e2.enrollment.id}/certificate`, "POST", {})).status, 200);
  assert.equal((await client.execute({ sql: "SELECT COUNT(*) AS n FROM edu_certificates WHERE course_id = ? AND user_id = 'u_prog'", args: [second.course.id] })).rows[0].n, 1);
  const done = (await json(await seller.call("/merchants/me/lms/enrollments"))).enrollments.find((e: any) => e.course_id === second.course.id);
  assert.equal(done.access_status, "completed");
  assert.equal(done.certificate_issued, true);
  const courses = (await json(await seller.call("/merchants/me/lms/courses"))).courses;
  assert.equal(courses.find((c: any) => c.id === second.course.id).completion_rate_percent, 100);

  await admin.setOptions({ lms_certificates: "off" });
  assert.equal((await json(await seller.call("/merchants/me/lms/courses"))).courses[0].certificate_enabled, false);

  // A revoked seat shows as suspended.
  await client.execute({ sql: "UPDATE edu_enrollments SET status = 'revoked' WHERE course_id = ? AND user_id = 'u_prog'", args: [courseId] });
  row = (await json(await seller.call("/merchants/me/lms/enrollments"))).enrollments.find((e: any) => e.course_id === courseId);
  assert.equal(row.access_status, "suspended");
});

test("Learn listing follows the admin option, and syncing never takes another store's course", async () => {
  const { client, admin, seller, course } = await setup();
  const other = await addMerchantStore(client, "u_lms_other");
  assert.equal((await other.call("/merchants/me/store/tier", "POST", {tier: "elite"})).status, 200);

  const auto = await course({ title: "Listed Course" });
  assert.ok((await catalogIds()).includes(auto.course.id), "two-way sync: it is in the Learn catalogue");
  assert.equal(auto.course.learn_synced, true);

  await admin.setOptions({ lms_learn_sync_mode: "publish_to_learn_manual" });
  const manual = await course({ title: "Manual Listing Course" });
  assert.equal(manual.course.learn_synced, false);
  assert.ok(!(await catalogIds()).includes(manual.course.id), "kept out of the catalogue until the merchant lists it");
  const row = (await json(await seller.call("/merchants/me/lms/courses"))).courses.find((c: any) => c.id === manual.course.id);
  assert.equal(row.learn_synced, false);
  assert.equal((await other.call(`/merchants/me/lms/courses/${manual.course.id}/publish-to-learn`, "POST", {})).status, 404, "only the owner can list it");
  assert.equal((await seller.call(`/merchants/me/lms/courses/${manual.course.id}/publish-to-learn`, "POST", {})).status, 200);
  assert.ok((await catalogIds()).includes(manual.course.id));
  assert.equal((await seller.call(`/merchants/me/lms/courses/${manual.course.id}/unlist-from-learn`, "POST", {})).status, 200);
  assert.ok(!(await catalogIds()).includes(manual.course.id));
  // It is still on sale in the store.
  assert.ok((await json(await anonymous(`/marketplace/stores/${seller.slug}`))).courses.some((c: any) => c.id === manual.course.id));

  await admin.setOptions({ lms_learn_sync_mode: "store_only" });
  assert.equal((await seller.call(`/merchants/me/lms/courses/${manual.course.id}/publish-to-learn`, "POST", {})).status, 409);
  const storeOnly = await course({ title: "Store Only Course" });
  assert.ok(!(await catalogIds()).includes(storeOnly.course.id));

  // Importing a Learn school's courses links only the merchant's own, unlinked ones.
  await client.execute({ sql: "INSERT INTO edu_schools (id, owner_id, name, slug, kind, streams, status) VALUES ('sch_x', 'u_lms_seller', 'X', 'x', 'training_centre', 'skills', 'active')", args: [] });
  const classId = String((await client.execute("SELECT id FROM edu_classes LIMIT 1")).rows[0].id);
  await client.execute({ sql: "INSERT INTO edu_courses (id, school_id, class_id, stream, title, price_ugx, status) VALUES ('crs_free', 'sch_x', ?, 'skills', 'Built in Learn', 1000, 'published')", args: [classId] });
  await client.execute({ sql: "INSERT INTO edu_courses (id, school_id, class_id, stream, title, price_ugx, status, store_id) VALUES ('crs_theirs', 'sch_x', ?, 'skills', 'Linked elsewhere', 1000, 'published', ?)", args: [classId, other.storeId] });
  const sync = await json(await seller.call("/merchants/me/lms/sync-from-learn", "POST", {}));
  assert.equal(sync.importedCount, 1);
  assert.equal((await client.execute("SELECT store_id FROM edu_courses WHERE id = 'crs_theirs'")).rows[0].store_id, other.storeId, "another store's course is left alone");
  assert.ok((await client.execute("SELECT 1 FROM store_digital_products WHERE id = 'dig_crs_crs_free'")).rows.length === 1, "and the course is put on sale");
  assert.equal((await client.execute("SELECT 1 FROM store_digital_products WHERE id = 'dig_crs_crs_theirs'")).rows.length, 0);
});

test("lesson media must come from approved hosts; module release follows the admin option", async () => {
  const { client, admin, seller, course } = await setup();
  const bad = await course({ modules: [{ title: "M", lessons: [{ title: "Evil", content_url: "https://evil.example/x.mp4" }] }] });
  assert.equal(bad.error, "lesson_host_not_allowed");
  const insecure = await course({ modules: [{ title: "M", lessons: [{ title: "Plain", content_url: "http://www.youtube.com/x" }] }] });
  assert.equal(insecure.error, "invalid_body", "plain http is refused whatever the mode");
  const good = await course({ title: "Hosted Course" });
  assert.ok(good.ok);

  await admin.setOptions({ lms_allowed_video_hosts: ["videos.example.com"] });
  assert.equal((await course({ modules: [{ title: "M", lessons: [{ title: "Sub", content_url: "https://cdn.videos.example.com/a" }] }] })).ok, true, "subdomains of an approved host count");
  assert.equal((await course({ modules: [{ title: "M", lessons: [{ title: "YT", content_url: "https://www.youtube.com/x" }] }] })).error, "lesson_host_not_allowed");
  await admin.setOptions({ lms_content_protection: "none" });
  assert.equal((await course({ modules: [{ title: "M", lessons: [{ title: "Any", content_url: "https://anywhere.example/a.mp4" }] }] })).ok, true);
  await admin.setOptions({ lms_content_protection: "signed_urls", lms_allowed_video_hosts: ["youtube.com", "youtu.be", "vimeo.com", "peebee.online"] });

  const drip = async (id: string) => (await client.execute({ sql: "SELECT m.title, d.drip_days FROM edu_modules m LEFT JOIN edu_module_drip d ON d.module_id = m.id WHERE m.course_id = ? ORDER BY m.position", args: [id] })).rows.map((r) => r.drip_days == null ? null : Number(r.drip_days));
  const normal = await course({ title: "All At Once" });
  assert.deepEqual(await drip(normal.course.id), [null, null, null]);
  await admin.setOptions({ lms_drip_default: "weekly" });
  const weekly = await course({ title: "Weekly Release" });
  assert.deepEqual(await drip(weekly.course.id), [null, 7, 14], "one module a week");
  await admin.setOptions({ lms_drip_default: "custom" });
  const custom = await course({ title: "My Schedule", modules: [{ title: "A", drip_days: 0, lessons: [{ title: "a" }] }, { title: "B", drip_days: 3, lessons: [{ title: "b" }] }] });
  assert.deepEqual(await drip(custom.course.id), [0, 3]);
  const shown = (await json(await seller.call("/merchants/me/lms/courses"))).courses.find((c: any) => c.id === custom.course.id);
  assert.equal(shown.modules[1].drip_days, 3);

  await admin.setOptions({ lms_max_courses: 1 });
  const over = await seller.call("/merchants/me/lms/courses", "POST", { title: "One Too Many" });
  assert.equal(over.status, 403);
  assert.equal((await json(over)).error, "course_limit");
});

test("a course is paid the Learn way or the store way, by admin option, and refunds follow", async () => {
  const { client, admin, seller, course, student } = await setup();
  const made = await course();
  const buy = async (id: string, courseProduct: string) => {
    const token = await student(id, `+2567${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`);
    await client.execute({ sql: "UPDATE users SET wallet_balance = 100000 WHERE id = ?", args: [id] });
    return { id, res: await app.request(`/v1/marketplace/digital/${courseProduct}/buy`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }) };
  };
  const wallet = async (id: string) => Number((await client.execute({ sql: "SELECT wallet_balance FROM users WHERE id = ?", args: [id] })).rows[0].wallet_balance);

  // Learn path (default): wallet to the school owner, minus Learn's commission. No double-entry ledger line.
  const a = await buy("u_c1", `dig_crs_${made.course.id}`);
  assert.equal(a.res.status, 201);
  assert.equal(await wallet("u_c1"), 60000);
  assert.equal(await wallet("u_lms_seller"), 36000, "40,000 less Learn's 10%");
  assert.equal((await client.execute("SELECT COUNT(*) AS n FROM ledger_transactions WHERE kind = 'digital_sale'")).rows[0].n, 0);
  const seat = (await client.execute({ sql: "SELECT user_id, status FROM edu_enrollments WHERE course_id = ?", args: [made.course.id] })).rows[0];
  assert.equal(seat.user_id, "u_c1");
  assert.equal((await client.execute({ sql: "SELECT COUNT(*) AS n FROM store_lms_enrollments WHERE course_id = ? AND user_id = 'u_c1'", args: [made.course.id] })).rows[0].n, 1, "the store sees the student");

  const fid = (await json(a.res)).fulfillmentId;
  assert.equal((await seller.call(`/merchants/me/digital-fulfillments/${fid}/refund`, "POST", {})).status, 200);
  assert.equal(await wallet("u_c1"), 100000, "refunded in full");
  assert.equal(await wallet("u_lms_seller"), 0, "the school's share comes back");
  assert.equal((await client.execute({ sql: "SELECT status FROM edu_enrollments WHERE course_id = ? AND user_id = 'u_c1'", args: [made.course.id] })).rows[0].status, "revoked", "and the seat ends");

  // Store path: the merchant's balance and the ledger, at the digital-sales share.
  await admin.setOptions({ lms_payment_path: "store_checkout_direct" });
  const b = await buy("u_c2", `dig_crs_${made.course.id}`);
  assert.equal(b.res.status, 201);
  assert.equal(await wallet("u_c2"), 60000);
  assert.equal(Number((await client.execute({ sql: "SELECT available FROM merchant_balances WHERE merchant_id = ?", args: [seller.merchantId] })).rows[0].available), 38000, "40,000 less the 5% digital share");
  assert.equal((await client.execute("SELECT COUNT(*) AS n FROM ledger_transactions WHERE kind = 'digital_sale'")).rows[0].n, 1);

});
