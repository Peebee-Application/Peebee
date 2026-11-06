import bcrypt from "bcryptjs";
import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  EDUCATION_STREAMS,
  EDUCATION_STREAM_IDS,
  DEMO_INSTITUTIONS,
  DEMO_SPROUTS_ACTIVITIES,
  DEMO_SPROUTS_TIMER,
  DEMO_SPROUTS_COPLAY,
  DEMO_FOUNDATIONS_WORKSHEETS,
  DEMO_FOUNDATIONS_SUBMISSIONS,
  DEMO_FOUNDATIONS_MERITS,
  DEMO_ACADEMY_TIMETABLE,
  DEMO_ACADEMY_EXAM,
  DEMO_ACADEMY_REPORT_CARD,
  DEMO_COMPASS_COURSE,
  DEMO_COMPASS_PEER_REVIEW,
  DEMO_COMPASS_CREDENTIAL,
  DEMO_SKILLS_COURSE,
  DEMO_SKILLS_SUBMISSION,
  DEMO_SKILLS_LOGBOOK,
  DEMO_TUITION_INVOICE,
  DEMO_SUBSCRIPTION_PASSES,
  DEMO_GUARDIAN_ALERTS,
  DEMO_LIVE_MEETINGS,
  DEMO_LIVE_PARTICIPANTS,
  DEMO_TUTOR_CONTACTS,
  DEMO_LIVE_CHAT_MESSAGES,
  type ApprenticeLogbookEntry,
  type FoundationsSubmission,
  type LiveChatMessage,
  type SkillsVideoSubmission,
  type VideoTimestampCritique,
} from "@peebee/shared";
import { requireAuth } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { tableExistsCheap } from "../lib/schema.js";
import { clearFailures, checkLockout, consume, recordFailure, tooManyRequests } from "../lib/ratelimit.js";
import { artRoutes } from "./art.js";
import { catalogRoutes } from "./catalog.js";
import { classroomRoutes } from "./classroom.js";
import { proRoutes } from "./pro.js";
import { gradeExam } from "./exam-grading.js";
import { learnRoutes, mediaRoutes, studioLearningRoutes } from "./learning.js";
import { salesLearnRoutes, salesStudioRoutes } from "./sales.js";
import { schoolChatRoutes } from "./chat.js";
import { communityLearnRoutes, communityStudioRoutes } from "./community.js";
import { getLearnSettings } from "./settings.js";
import { learningReady, studioReady, studioRoutes } from "./studio.js";
import { creatorRoutes } from "./creator-routes.js";
import { creatorStudyRoutes } from "./creator-study.js";
import { creatorFileRoutes, creatorResourceRoutes } from "./creator-resources.js";
import { creatorCommerceRoutes } from "./creator-commerce.js";
import { creatorPublicRoutes } from "./creator-public.js";

/**
 * Peebee Learn API, mounted at /v1/education.
 *
 *  - /streams, /institutions and /catalog are public and read-only.
 *  - /studio is the persisted school → class → course → lesson builder.
 *  - Everything else is the learner sandbox: it needs a signed-in account, keeps
 *    its working state per account (never shared between people), takes the
 *    person's identity from the session rather than from the request, and does
 *    not invent grades, payments or signatures.
 */
export const educationRoutes = new Hono();

// ----------------------------------------------------
// Public
// ----------------------------------------------------
educationRoutes.get("/streams", (c) => c.json({ ok: true, streams: EDUCATION_STREAMS }));

educationRoutes.get("/institutions", (c) => c.json({ ok: true, institutions: DEMO_INSTITUTIONS }));

educationRoutes.get("/institutions/:slug", (c) => {
  const slug = c.req.param("slug");
  const institution = DEMO_INSTITUTIONS.find((i) => i.slug === slug || i.id === slug);
  if (!institution) return c.json({ error: "not_found", message: "That institution wasn't found." }, 404);
  return c.json({ ok: true, institution });
});

educationRoutes.route("/catalog", catalogRoutes);
educationRoutes.route("/art", artRoutes);
educationRoutes.route("/", mediaRoutes);
educationRoutes.route("/creator-files", creatorFileRoutes);
educationRoutes.route("/creator-public", creatorPublicRoutes);

// ----------------------------------------------------
// Signed-in only from here
// ----------------------------------------------------
const authed = new Hono();
authed.use("*", requireAuth);
creatorRoutes.route("/", creatorStudyRoutes);
creatorRoutes.route("/", creatorResourceRoutes);
creatorRoutes.route("/", creatorCommerceRoutes);
authed.route("/creator", creatorRoutes);

authed.route("/studio", studioRoutes);
authed.route("/studio", studioLearningRoutes);
authed.route("/studio", salesStudioRoutes);
authed.route("/learn", salesLearnRoutes);
authed.route("/studio", communityStudioRoutes);
authed.route("/learn", communityLearnRoutes);
authed.route("/messages", schoolChatRoutes);
authed.route("/learn", learnRoutes);
authed.route("/classroom", classroomRoutes);
authed.route("/pro", proRoutes);

// ---- Input helpers -------------------------------------------------------

const clean = (max: number) =>
  z
    .string()
    .transform((v) => v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim())
    .pipe(z.string().max(max));

const httpsUrl = z
  .string()
  .max(500)
  .refine((v) => {
    try {
      return new URL(v).protocol === "https:";
    } catch {
      return false;
    }
  }, "Use a full https:// link");

const pinSchema = z.string().regex(/^\d{4,6}$/, "The PIN is 4 to 6 digits");

async function parse<T extends z.ZodTypeAny>(c: Context, schema: T): Promise<{ ok: true; data: z.infer<T> } | { ok: false; res: Response }> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (parsed.success) return { ok: true, data: parsed.data };
  const issue = parsed.error.issues[0];
  const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
  return { ok: false, res: c.json({ error: "invalid_body", message: `${where}${issue?.message ?? "Invalid request"}` }, 400) };
}

const nowStamp = () => new Date().toISOString().slice(0, 16).replace("T", " ");
const shortId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);

/** Burst limit for anything that writes, per account. */
async function writeBudget(c: Context, bucket: string, limit = 30) {
  const quota = await consume(`edu-${bucket}:${c.get("user").sub}`, limit, 60);
  return quota.allowed ? null : tooManyRequests(c, quota, "Slow down a little and try again.");
}

// ---- Per-account sandbox state ------------------------------------------
//
// The learner sandbox keeps what a person does in memory. It is isolated per
// account and bounded, so one person can neither see nor flood another's.

type Sandbox = {
  submissions: FoundationsSubmission[];
  skillsSubmission: SkillsVideoSubmission;
  critiques: VideoTimestampCritique[];
  logbook: ApprenticeLogbookEntry[];
  notes: { id: string; unitId: string; timestampSeconds: number; noteText: string }[];
  messages: LiveChatMessage[];
};

const MAX_SANDBOXES = 500;
const MAX_ROWS = 100;
const sandboxes = new Map<string, Sandbox>();

function sandboxFor(userId: string): Sandbox {
  const existing = sandboxes.get(userId);
  if (existing) {
    // Refresh recency so active accounts are evicted last.
    sandboxes.delete(userId);
    sandboxes.set(userId, existing);
    return existing;
  }
  if (sandboxes.size >= MAX_SANDBOXES) {
    const oldest = sandboxes.keys().next().value;
    if (oldest !== undefined) sandboxes.delete(oldest);
  }
  const fresh: Sandbox = {
    submissions: structuredClone(DEMO_FOUNDATIONS_SUBMISSIONS),
    skillsSubmission: structuredClone(DEMO_SKILLS_SUBMISSION),
    critiques: structuredClone(DEMO_SKILLS_SUBMISSION.critiques),
    logbook: structuredClone(DEMO_SKILLS_LOGBOOK),
    notes: [],
    messages: structuredClone(DEMO_LIVE_CHAT_MESSAGES),
  };
  sandboxes.set(userId, fresh);
  return fresh;
}

function pushBounded<T>(list: T[], item: T, front = false) {
  if (front) list.unshift(item);
  else list.push(item);
  if (list.length > MAX_ROWS) {
    if (front) list.length = MAX_ROWS;
    else list.splice(0, list.length - MAX_ROWS);
  }
}

// ---- Parent PIN -----------------------------------------------------------

async function tableExists(name: string): Promise<boolean> {
  try {
    return await tableExistsCheap(name);
  } catch {
    return false;
  }
}

async function storedPinHash(userId: string): Promise<string | null> {
  const res = await db.execute({ sql: "SELECT pin_hash FROM edu_parent_pins WHERE user_id = ?", args: [userId] });
  return (res.rows[0]?.pin_hash as string | undefined) ?? null;
}

type PinCheck =
  | { ok: true }
  | { ok: false; status: 400 | 409 | 429 | 503; error: string; message: string; retryAfterSeconds?: number };

/** Checks a PIN with progressive lock-out, so a child cannot simply guess all 10,000. */
async function checkPin(userId: string, pin: string): Promise<PinCheck> {
  if (!(await tableExists("edu_parent_pins"))) {
    return { ok: false, status: 503, error: "learn_upgrade_pending", message: "Parent PIN is being set up. Try again shortly." };
  }
  const hash = await storedPinHash(userId);
  if (!hash) return { ok: false, status: 409, error: "pin_not_set", message: "Set a parent PIN first." };
  const key = `edu-pin:${userId}`;
  const lock = await checkLockout(key);
  if (!lock.allowed) {
    return { ok: false, status: 429, error: "rate_limited", message: "Too many wrong PINs. Try again later.", retryAfterSeconds: lock.retryAfterSeconds };
  }
  if (await bcrypt.compare(pin, hash)) {
    await clearFailures(key);
    return { ok: true };
  }
  await recordFailure(key);
  return { ok: false, status: 400, error: "wrong_pin", message: "That PIN is not right." };
}

// ----------------------------------------------------
// 1. Sprouts (Ages 3-6)
// ----------------------------------------------------
authed.get("/sprouts/activities", (c) =>
  c.json({ ok: true, activities: DEMO_SPROUTS_ACTIVITIES, screenTimer: DEMO_SPROUTS_TIMER, coPlayPrompt: DEMO_SPROUTS_COPLAY }),
);

authed.get("/sprouts/parent-pin", async (c) => {
  if (!(await tableExists("edu_parent_pins"))) return c.json({ ok: true, isSet: false });
  return c.json({ ok: true, isSet: (await storedPinHash(c.get("user").sub)) !== null });
});

authed.put("/sprouts/parent-pin", async (c) => {
  const parsed = await parse(c, z.object({ pin: pinSchema, currentPin: pinSchema.optional() }));
  if (!parsed.ok) return parsed.res;
  const userId = c.get("user").sub;
  if (!(await tableExists("edu_parent_pins"))) {
    return c.json({ error: "learn_upgrade_pending", message: "Parent PIN is being set up. Try again shortly." }, 503);
  }

  // Changing an existing PIN needs the current one, so a child cannot replace it.
  if (await storedPinHash(userId)) {
    if (!parsed.data.currentPin) return c.json({ error: "current_pin_required", message: "Enter the current PIN to change it." }, 400);
    const check = await checkPin(userId, parsed.data.currentPin);
    if (!check.ok) return c.json({ error: check.error, message: check.message }, check.status);
  }
  const hash = await bcrypt.hash(parsed.data.pin, 10);
  await db.execute({
    sql: `INSERT INTO edu_parent_pins (user_id, pin_hash, updated_at) VALUES (?, ?, datetime('now'))
          ON CONFLICT(user_id) DO UPDATE SET pin_hash = excluded.pin_hash, updated_at = datetime('now')`,
    args: [userId, hash],
  });
  return c.json({ ok: true });
});

authed.post("/sprouts/timer/unlock", async (c) => {
  const parsed = await parse(c, z.object({ pin: pinSchema }));
  if (!parsed.ok) return parsed.res;
  const check = await checkPin(c.get("user").sub, parsed.data.pin);
  if (!check.ok) {
    if (check.retryAfterSeconds) c.header("Retry-After", String(check.retryAfterSeconds));
    return c.json({ ok: false, unlocked: false, error: check.error, message: check.message }, check.status);
  }
  return c.json({ ok: true, unlocked: true, message: "Screen timer unlocked by parent PIN." });
});

// ----------------------------------------------------
// 2. Foundations (Ages 6-12)
// ----------------------------------------------------
authed.get("/foundations/worksheets", (c) =>
  c.json({ ok: true, worksheets: DEMO_FOUNDATIONS_WORKSHEETS, submissions: sandboxFor(c.get("user").sub).submissions, meritWallet: DEMO_FOUNDATIONS_MERITS }),
);

const worksheetSubmit = z.object({
  worksheetId: clean(80).pipe(z.string().min(1)),
  scannedPhotoUrls: z.array(httpsUrl).max(10).default([]),
  parentPin: pinSchema.optional(),
  parentSignerName: clean(80).default(""),
});

authed.post("/foundations/worksheets/submit", async (c) => {
  const slow = await writeBudget(c, "worksheet");
  if (slow) return slow;
  const parsed = await parse(c, worksheetSubmit);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;
  const user = c.get("user");

  const ws = DEMO_FOUNDATIONS_WORKSHEETS.find((w) => w.id === d.worksheetId);
  if (!ws) return c.json({ error: "not_found", message: "That worksheet wasn't found." }, 404);

  // A parent signature counts only when the real PIN is entered.
  let parentSigned = false;
  if (d.parentPin) {
    const check = await checkPin(user.sub, d.parentPin);
    if (!check.ok) return c.json({ error: check.error, message: check.message }, check.status);
    parentSigned = true;
  }

  const submission = {
    id: `sub_${shortId()}`,
    worksheetId: ws.id,
    worksheetTitle: ws.title,
    subject: ws.subject,
    studentId: user.sub,
    studentName: user.name,
    scannedPhotoUrls: d.scannedPhotoUrls.length > 0 ? d.scannedPhotoUrls : ws.samplePhotoUrl ? [ws.samplePhotoUrl] : [],
    parentSigned,
    parentSignerName: parentSigned ? d.parentSignerName || "Parent or guardian" : "",
    parentSignedAt: parentSigned ? nowStamp() : "",
    status: parentSigned ? "submitted" : "pending_parent",
    meritPointsEarned: 0,
    teacherRemarks: parentSigned ? "Submission received. Pending teacher review." : "Waiting for a parent to sign.",
    submittedAt: nowStamp(),
  } as FoundationsSubmission;
  pushBounded(sandboxFor(user.sub).submissions, submission, true);
  return c.json({ ok: true, submission });
});

// ----------------------------------------------------
// 3. Academy (Ages 12-18)
// ----------------------------------------------------
authed.get("/academy/dashboard", (c) =>
  c.json({ ok: true, timetable: DEMO_ACADEMY_TIMETABLE, activeExam: DEMO_ACADEMY_EXAM, reportCard: DEMO_ACADEMY_REPORT_CARD }),
);

const examSubmit = z.object({
  examId: clean(80).pipe(z.string().min(1)),
  answers: z.record(z.string().max(40), clean(4000)).default({}),
  tabSwitchCount: z.number().int().min(0).max(1000).default(0),
  focusLossEventsCount: z.number().int().min(0).max(1000).default(0),
});

function examResponse(row: Record<string, unknown>) {
  const graded = row.status === "graded";
  return {
    ok: true,
    status: graded ? "graded" : "submitted",
    scorePercent: row.score_percent === null || row.score_percent === undefined ? null : Number(row.score_percent),
    passed: row.passed === null || row.passed === undefined ? null : Number(row.passed) === 1,
    autoPoints: Number(row.auto_points),
    autoOutOf: Number(row.auto_out_of),
    tabSwitchCount: Number(row.tab_switch_count),
    message: graded
      ? "Your exam has been marked."
      : "Your answers were received. Your teacher will mark the rest.",
  };
}

authed.post("/academy/exam/submit", async (c) => {
  const slow = await writeBudget(c, "exam", 10);
  if (slow) return slow;
  const parsed = await parse(c, examSubmit);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;
  const user = c.get("user");
  // The server marks what it holds an answer key for; the key never leaves the server.
  const grade = gradeExam(d.examId, d.answers);
  if (!grade) return c.json({ error: "not_found", message: "That exam wasn't found." }, 404);
  if (!(await learningReady())) return c.json({ error: "learn_upgrade_pending", message: "Exams are being set up. Try again shortly." }, 503);

  const settings = await getLearnSettings();
  const percent = grade.autoOutOf > 0 ? Math.round((grade.autoPoints / grade.autoOutOf) * 100) : null;
  const final = !grade.needsMarking && percent !== null;
  const id = `exm_${shortId()}`;
  const insert = await db.execute({
    sql: `INSERT OR IGNORE INTO edu_exam_submissions
            (id, user_id, exam_id, answers_json, auto_points, auto_out_of, total_points, needs_marking, score_percent, passed, tab_switch_count, focus_loss_count, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id, user.sub, d.examId, JSON.stringify(d.answers), grade.autoPoints, grade.autoOutOf, grade.totalPoints, grade.needsMarking ? 1 : 0,
      final ? percent : null, final ? (percent! >= settings.examPassPercent ? 1 : 0) : null, d.tabSwitchCount, d.focusLossEventsCount, final ? "graded" : "submitted",
    ] as never,
  });
  if ((insert.rowsAffected ?? 0) === 0) return c.json({ error: "already_submitted", message: "You have already submitted this exam." }, 409);
  const row = await db.execute({ sql: "SELECT * FROM edu_exam_submissions WHERE id = ?", args: [id] });
  return c.json(examResponse(row.rows[0] as Record<string, unknown>));
});

authed.get("/academy/exam/:id/result", async (c) => {
  if (!(await learningReady())) return c.json({ error: "learn_upgrade_pending", message: "Exams are being set up. Try again shortly." }, 503);
  const row = await db.execute({ sql: "SELECT * FROM edu_exam_submissions WHERE user_id = ? AND exam_id = ?", args: [c.get("user").sub, c.req.param("id")] });
  if (!row.rows[0]) return c.json({ error: "not_found", message: "You haven't submitted this exam." }, 404);
  return c.json(examResponse(row.rows[0] as Record<string, unknown>));
});

// ----------------------------------------------------
// 4. Compass (University)
// ----------------------------------------------------
authed.get("/compass/course", (c) =>
  c.json({ ok: true, course: DEMO_COMPASS_COURSE, peerReview: DEMO_COMPASS_PEER_REVIEW, credential: DEMO_COMPASS_CREDENTIAL }),
);

authed.post("/compass/notes", async (c) => {
  const slow = await writeBudget(c, "notes");
  if (slow) return slow;
  const parsed = await parse(
    c,
    z.object({
      unitId: clean(80).pipe(z.string().min(1)),
      timestampSeconds: z.number().int().min(0).max(86_400),
      noteText: clean(2000).pipe(z.string().min(1)),
    }),
  );
  if (!parsed.ok) return parsed.res;
  const note = { id: `note_${shortId()}`, ...parsed.data };
  pushBounded(sandboxFor(c.get("user").sub).notes, note);
  return c.json({ ok: true, noteId: note.id, saved: true });
});

authed.post("/compass/peer-review/submit", async (c) => {
  const slow = await writeBudget(c, "peer");
  if (slow) return slow;
  const parsed = await parse(
    c,
    z.object({
      assignmentId: clean(80).pipe(z.string().min(1)),
      anonymousSubmissionId: clean(80).pipe(z.string().min(1)),
      scores: z
        .array(z.object({ criteriaName: clean(120), scoreAwarded: z.number().min(0).max(1000), feedback: clean(2000) }))
        .min(1)
        .max(20),
    }),
  );
  if (!parsed.ok) return parsed.res;
  return c.json({ ok: true, isComplete: true, message: "Peer review feedback submitted." });
});

// ----------------------------------------------------
// 5. Skills (everyday learners: vocational, practical, informal)
// ----------------------------------------------------
authed.get("/skills/course", (c) => {
  const box = sandboxFor(c.get("user").sub);
  return c.json({ ok: true, course: DEMO_SKILLS_COURSE, submission: { ...box.skillsSubmission, critiques: box.critiques }, logbook: box.logbook });
});

authed.post("/skills/practical/submit", async (c) => {
  const slow = await writeBudget(c, "practical", 10);
  if (slow) return slow;
  const parsed = await parse(
    c,
    z.object({
      trade: clean(60).default("general"),
      taskTitle: clean(160).pipe(z.string().min(1)),
      videoUrl: httpsUrl,
      durationSeconds: z.number().int().min(1).max(3600),
    }),
  );
  if (!parsed.ok) return parsed.res;
  const user = c.get("user");
  const submission = {
    id: `vid_sub_${shortId()}`,
    studentId: user.sub,
    studentName: user.name,
    trade: parsed.data.trade,
    taskTitle: parsed.data.taskTitle,
    videoUrl: parsed.data.videoUrl,
    uploadedAt: nowStamp(),
    durationSeconds: parsed.data.durationSeconds,
    status: "under_review",
    critiques: [],
  } as unknown as SkillsVideoSubmission;
  sandboxFor(user.sub).skillsSubmission = submission;
  return c.json({ ok: true, submission });
});

/** Only an educator (someone who runs a school in the Studio) may critique a submission. */
async function isEducator(userId: string): Promise<boolean> {
  if (!(await studioReady())) return false;
  const res = await db.execute({ sql: "SELECT 1 AS yes FROM edu_schools WHERE owner_id = ? AND status = 'active' LIMIT 1", args: [userId] });
  return res.rows.length > 0;
}

authed.post("/skills/critiques", async (c) => {
  const user = c.get("user");
  if (!(await isEducator(user.sub))) {
    return c.json({ error: "educators_only", message: "Only an educator with a school on Peebee Learn can leave feedback on a submission." }, 403);
  }
  const slow = await writeBudget(c, "critique");
  if (slow) return slow;
  const parsed = await parse(
    c,
    z.object({
      submissionId: clean(80).optional(),
      timestampSeconds: z.number().int().min(0).max(3600),
      critiqueText: clean(1000).pipe(z.string().min(1)),
      severity: z.enum(["praise", "technique_correction", "safety_warning"]).default("technique_correction"),
    }),
  );
  if (!parsed.ok) return parsed.res;
  const critique: VideoTimestampCritique = {
    id: `crit_${shortId()}`,
    timestampSeconds: parsed.data.timestampSeconds,
    instructorName: user.name,
    critiqueText: parsed.data.critiqueText,
    severity: parsed.data.severity,
    resolved: false,
  };
  pushBounded(sandboxFor(user.sub).critiques, critique);
  return c.json({ ok: true, critique });
});

authed.post("/skills/logbook", async (c) => {
  const slow = await writeBudget(c, "logbook");
  if (slow) return slow;
  const parsed = await parse(
    c,
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date format YYYY-MM-DD").default(() => new Date().toISOString().slice(0, 10)),
      practicalHours: z.number().min(0.25).max(16),
      taskPerformed: clean(500).pipe(z.string().min(1)),
      workshopLocation: clean(160).pipe(z.string().min(1)),
      supervisorName: clean(120).pipe(z.string().min(1)),
    }),
  );
  if (!parsed.ok) return parsed.res;
  const user = c.get("user");
  // The supervisor has to sign for themselves; the learner cannot sign on their behalf.
  const entry: ApprenticeLogbookEntry = {
    id: `log_${shortId()}`,
    studentId: user.sub,
    studentName: user.name,
    date: parsed.data.date,
    practicalHours: parsed.data.practicalHours,
    taskPerformed: parsed.data.taskPerformed,
    workshopLocation: parsed.data.workshopLocation,
    masterSupervisorName: parsed.data.supervisorName,
    supervisorSignatureRecorded: false,
  };
  pushBounded(sandboxFor(user.sub).logbook, entry, true);
  return c.json({ ok: true, entry });
});

// ----------------------------------------------------
// Tuition & Billing
// ----------------------------------------------------
authed.get("/tuition", (c) => c.json({ ok: true, invoice: DEMO_TUITION_INVOICE, passes: DEMO_SUBSCRIPTION_PASSES, guardianAlerts: DEMO_GUARDIAN_ALERTS }));

// The sample fee schedule above is demo data. Real fees are invoices a school sends you, paid from your Peebee wallet at /learn/invoices.
authed.post("/tuition/pay", (c) =>
  c.json({ error: "use_invoices", message: "Pay school fees from your invoices. Nothing has been charged here." }, 410),
);

// ----------------------------------------------------
// Live meetings
// ----------------------------------------------------
const streamQuery = (c: Context): string | undefined => {
  const stream = c.req.query("stream");
  if (stream === "campus") return "compass";
  return stream && (EDUCATION_STREAM_IDS as readonly string[]).includes(stream) ? stream : undefined;
};

authed.get("/live/meetings", (c) => {
  const stream = streamQuery(c);
  const meetings = stream ? DEMO_LIVE_MEETINGS.filter((m) => m.stream === stream) : DEMO_LIVE_MEETINGS;
  const activeMeeting = DEMO_LIVE_MEETINGS.find((m) => m.isLiveNow) ?? DEMO_LIVE_MEETINGS[0];
  return c.json({ ok: true, meetings, activeMeeting });
});

authed.get("/live/meetings/:id", (c) => {
  const id = c.req.param("id");
  const meeting = DEMO_LIVE_MEETINGS.find((m) => m.id === id || m.roomCode === id);
  if (!meeting) return c.json({ error: "not_found", message: "That meeting wasn't found." }, 404);
  const messages = sandboxFor(c.get("user").sub).messages.filter((msg) => msg.roomId === meeting.id || !msg.roomId);
  return c.json({ ok: true, meeting, participants: DEMO_LIVE_PARTICIPANTS, messages });
});

// ----------------------------------------------------
// Chat with tutors and classroom channels
// ----------------------------------------------------
authed.get("/chat/tutors", (c) => {
  const stream = streamQuery(c);
  return c.json({ ok: true, tutors: stream ? DEMO_TUTOR_CONTACTS.filter((t) => t.stream === stream) : DEMO_TUTOR_CONTACTS });
});

authed.get("/chat/messages", (c) => {
  const id = (c.req.query("id") ?? "").slice(0, 80);
  const all = sandboxFor(c.get("user").sub).messages;
  const filtered = id ? all.filter((m) => m.roomId === id || m.channelId === id) : all;
  return c.json({ ok: true, messages: filtered });
});

authed.post("/chat/send", async (c) => {
  const slow = await writeBudget(c, "chat");
  if (slow) return slow;
  const parsed = await parse(
    c,
    z.object({
      roomId: clean(80).optional(),
      channelId: clean(80).optional(),
      text: clean(2000).pipe(z.string().min(1)),
      isQuestion: z.boolean().optional(),
      attachmentUrl: httpsUrl.optional(),
      isVoiceNote: z.boolean().optional(),
      voiceDurationSecs: z.number().int().min(1).max(600).optional(),
    }),
  );
  if (!parsed.ok) return parsed.res;
  const user = c.get("user");
  // Who is speaking comes from the session. The request cannot claim to be a tutor or someone else.
  const message: LiveChatMessage = {
    id: `msg_${shortId()}`,
    roomId: parsed.data.roomId,
    channelId: parsed.data.channelId,
    senderId: user.sub,
    senderName: user.name,
    senderRole: "student",
    text: parsed.data.text,
    timestamp: "Just now",
    isQuestion: Boolean(parsed.data.isQuestion),
    upvotes: 0,
    isVoiceNote: Boolean(parsed.data.isVoiceNote),
    voiceDurationSecs: parsed.data.voiceDurationSecs,
    attachmentUrl: parsed.data.attachmentUrl,
  };
  pushBounded(sandboxFor(user.sub).messages, message);
  return c.json({ ok: true, message });
});

educationRoutes.route("/", authed);
