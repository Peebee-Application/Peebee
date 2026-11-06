import { DEMO_CREATORS, DEMO_SCHOOL_CLASSES } from "./demo-data.js";
import {
  DEFAULT_LEARN_SETTINGS,
  normaliseContentType,
  type SchoolKind,
  type StudioClass,
  type StudioCourse,
  type StudioLesson,
  type StudioModule,
  type StudioQuiz,
  type StudioSchool,
} from "./studio.js";
import { CURRICULUM_FRAMEWORKS, EDUCATION_STREAM_IDS, type CreatorProfile, type EducationStream } from "./types.js";

/**
 * The Studio in Sandbox mode. Same routes and answers as the real API, kept in
 * the browser and seeded with the demo schools, so an educator can try building
 * a school, a class, a course and its lessons without touching real data.
 */

const STORAGE_KEY = "peebee.practice.learn.studio.v1";

type CourseRow = Omit<StudioCourse, "moduleCount" | "lessonCount">;
type ClassRow = Omit<StudioClass, "courseCount">;
type SchoolRow = Omit<StudioSchool, "classCount" | "courseCount" | "publishedCourseCount" | "lessonCount">;
type Store = { schools: SchoolRow[]; classes: ClassRow[]; courses: CourseRow[]; modules: Omit<StudioModule, "lessons">[]; lessons: StudioLesson[] };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const problem = (status: number, error: string, message: string) => json({ error, message }, status);
const uid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36).slice(-3)}`;
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max) : "");
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : fallback);

const KIND_BY_CREATOR: Record<CreatorProfile["type"], SchoolKind> = {
  school: "school",
  academy: "academy",
  vocational_guild: "training_centre",
  independent_tutor: "independent_tutor",
  early_childhood_center: "school",
};

function seed(): Store {
  const store: Store = { schools: [], classes: [], courses: [], modules: [], lessons: [] };
  for (const c of DEMO_CREATORS) {
    store.schools.push({
      id: c.id,
      name: c.name,
      slug: c.handle,
      kind: KIND_BY_CREATOR[c.type],
      streams: c.supportedStreams,
      tagline: c.tagline,
      bio: c.bio,
      location: c.location,
      motto: "",
      badge: c.badge ?? "",
      contactEmail: "",
      contactPhone: "",
      status: "active",
      createdAt: "2026-01-12 08:00:00",
    });
  }
  for (const k of DEMO_SCHOOL_CLASSES) {
    store.classes.push({
      id: k.id,
      schoolId: k.schoolId,
      stream: k.stream,
      kind: k.kind,
      name: k.name,
      level: k.level,
      framework: k.framework,
      academicYear: k.academicYear,
      term: k.term ?? "",
      teacherName: k.teacherName,
      capacity: k.capacity,
      summary: k.summary,
      status: "published",
    });
  }
  for (const c of DEMO_CREATORS) {
    for (const course of c.courses) {
      if (!course.classId) continue;
      store.courses.push({
        id: course.id,
        schoolId: c.id,
        classId: course.classId,
        stream: course.stream,
        title: course.title,
        summary: course.summary,
        priceUgx: course.priceUgx,
        framework: course.framework ?? "open_syllabus",
        outcomes: course.outcomes ?? [],
        status: "published",
        createdAt: "2026-01-15 08:00:00",
      });
      course.modules.forEach((m, mi) => {
        store.modules.push({ id: m.id, courseId: course.id, title: m.title, description: m.description, position: mi + 1 });
        m.lessons.forEach((l, li) => {
          const q = l.quiz;
          const quiz: StudioQuiz | null = q
            ? {
                title: q.title,
                passingScorePercent: q.passingScorePercent,
                questions: q.questions.map((x) => ({ question: x.questionText, options: x.options, correctIndex: x.correctOptionIndex, explanation: x.explanation })),
              }
            : null;
          store.lessons.push({
            id: l.id,
            moduleId: m.id,
            courseId: course.id,
            title: l.title,
            contentType: normaliseContentType(l.contentType),
            durationMinutes: l.durationMinutes,
            summary: l.summary,
            contentUrl: "",
            position: li + 1,
            body: "",
            slides: [],
            live: null,
            quiz,
            media: null,
          });
        });
      });
    }
  }
  return store;
}

let memory: Store | null = null;

function load(): Store {
  if (memory) return memory;
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (raw) {
      memory = JSON.parse(raw) as Store;
      return memory;
    }
  } catch {
    /* private mode: keep it in memory for this visit */
  }
  memory = seed();
  return memory;
}

function save(store: Store) {
  memory = store;
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* private mode */
  }
}

/** Forget the sandbox schools so the next visit starts from the demo again. */
export function resetStudioSandbox() {
  memory = null;
  try {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(MESSAGES_KEY);
    }
  } catch {
    /* ignore */
  }
}

const S = DEFAULT_LEARN_SETTINGS;

const schoolOut = (st: Store, s: SchoolRow): StudioSchool => ({
  ...s,
  classCount: st.classes.filter((c) => c.schoolId === s.id).length,
  courseCount: st.courses.filter((c) => c.schoolId === s.id).length,
  publishedCourseCount: st.courses.filter((c) => c.schoolId === s.id && c.status === "published").length,
  lessonCount: st.lessons.filter((l) => st.courses.some((c) => c.id === l.courseId && c.schoolId === s.id)).length,
});
const classOut = (st: Store, c: ClassRow): StudioClass => ({ ...c, courseCount: st.courses.filter((x) => x.classId === c.id).length });
const courseOut = (st: Store, c: CourseRow): StudioCourse => ({
  ...c,
  moduleCount: st.modules.filter((m) => m.courseId === c.id).length,
  lessonCount: st.lessons.filter((l) => l.courseId === c.id).length,
});

function readQuiz(raw: unknown): StudioQuiz | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const q = raw as Partial<StudioQuiz>;
  const questions = Array.isArray(q.questions) ? q.questions : [];
  if (!questions.length) return null;
  return {
    title: clean(q.title, 120) || "Quiz",
    passingScorePercent: Math.max(0, Math.min(100, num(q.passingScorePercent, 70))),
    questions: questions.slice(0, S.maxQuizQuestionsPerLesson).map((x) => {
      const options = (Array.isArray(x?.options) ? x.options : []).map((o: unknown) => clean(o, 200)).filter(Boolean).slice(0, 6);
      return { ...x, question: clean(x?.question, 200), options, correctIndex: Math.max(0, Math.min(options.length - 1, num(x?.correctIndex, 0))), explanation: clean(x?.explanation, 2000) };
    }),
    settings: q.settings,
  };
}

function httpsOrEmpty(v: unknown): string | null {
  const url = clean(v, 500);
  if (!url) return "";
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** Answers a Studio request from the browser's own store. Returns null for paths that are not Studio paths. */
export function handleStudioSandbox(path: string, method: string, body: Record<string, unknown>): Response | null {
  if (path.startsWith("/v1/education/messages/")) return handleMessagesSandbox(path, method, body);
  if (path === "/v1/education/catalog/courses" && method === "GET") {
    const st = load();
    const courses = st.courses
      .filter((c) => c.status === "published")
      .map((c) => {
        const school = st.schools.find((s) => s.id === c.schoolId);
        const cls = st.classes.find((k) => k.id === c.classId);
        return {
          id: c.id, stream: c.stream, title: c.title, summary: c.summary, priceUgx: c.priceUgx, framework: c.framework, outcomes: c.outcomes,
          schoolName: school?.name ?? "", schoolSlug: school?.slug ?? "", className: cls?.name ?? "", classKind: cls?.kind ?? "class", classLevel: cls?.level ?? "",
          lessonCount: st.lessons.filter((l) => l.courseId === c.id).length, demo: false,
        };
      });
    return json({ ok: true, courses });
  }

  // Enrolment, payments, uploads and fees need the real service and real money, so the sandbox only lists nothing for them.
  if (path.startsWith("/v1/education/learn/") || path.startsWith("/v1/education/classroom/") || path.startsWith("/v1/education/pro") || path.startsWith("/v1/tv/")) {
    if (method === "GET" && (path.endsWith("/devices") )) return json({ ok: true, devices: [] });
    if (method === "GET" && path.endsWith("/sessions")) return json({ ok: true, sessions: [] });
    if (method === "GET" && path.endsWith("/trial")) return json({ ok: true, classes: [] });
    if (method === "GET" && path.endsWith("/education/pro")) return json({ ok: true, tv: { required: false, pro: false, allowed: true, expiresAt: null }, priceUgx: 50000, days: 30 });
    if (method === "GET" && path.endsWith("/enrollments")) return json({ ok: true, enrollments: [] });
    if (method === "GET" && path.endsWith("/invoices")) return json({ ok: true, invoices: [] });
    return problem(503, "sandbox_only", "This needs the live service. It isn't available in the sandbox.");
  }
  if (/^\/v1\/education\/studio\/(lessons\/[^/]+\/media|invoices\/|schools\/[^/]+\/invoices)/.test(path)) {
    if (method === "GET") return json({ ok: true, invoices: [] });
    return problem(503, "sandbox_only", "Uploads and fees need the live service. They aren't available in the sandbox.");
  }
  if (/^\/v1\/education\/studio\/courses\/[^/]+\/students$/.test(path)) return json({ ok: true, students: [] });

  const prefix = "/v1/education/studio";
  if (!path.startsWith(prefix)) return null;
  const route = path.slice(prefix.length);
  const st = load();
  const done = (next: Store) => save(next);

  if (method === "GET" && route === "/config") return json({ ok: true, settings: S, usage: { schools: st.schools.length } });
  if (method === "GET" && route === "/schools") return json({ ok: true, schools: st.schools.map((s) => schoolOut(st, s)) });

  if (method === "POST" && route === "/schools") {
    // The seeded demo schools do not count against the limit, only the ones made here.
    const mine = st.schools.filter((s) => s.id.startsWith("sch_")).length;
    if (mine >= S.maxSchoolsPerUser) return problem(409, "limit_reached", `You can run up to ${S.maxSchoolsPerUser} schools on Peebee Learn.`);
    const name = clean(body.name, 120);
    if (name.length < 2) return problem(400, "invalid_body", "name: Enter at least 2 characters");
    const streams = (Array.isArray(body.streams) ? body.streams : []).filter((x): x is EducationStream => (EDUCATION_STREAM_IDS as readonly string[]).includes(x as string));
    if (!streams.length) return problem(400, "invalid_body", "streams: Choose at least one stream");
    const school: SchoolRow = {
      id: uid("sch"), name, slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "school"}-${Math.random().toString(36).slice(2, 8)}`,
      kind: (clean(body.kind, 30) as SchoolKind) || "school", streams: [...new Set(streams)],
      tagline: clean(body.tagline, 200), bio: clean(body.bio, 2000), location: clean(body.location, 200), motto: clean(body.motto, 200), badge: clean(body.badge, 120),
      contactEmail: clean(body.contactEmail, 120), contactPhone: clean(body.contactPhone, 40), status: "active", createdAt: new Date().toISOString().slice(0, 19).replace("T", " "),
    };
    done({ ...st, schools: [school, ...st.schools] });
    return json({ ok: true, school: { ...school, classCount: 0, courseCount: 0, publishedCourseCount: 0, lessonCount: 0 } }, 201);
  }

  let m = route.match(/^\/schools\/([^/]+)$/);
  if (m) {
    const school = st.schools.find((s) => s.id === m![1]);
    if (!school) return problem(404, "not_found", "That school wasn't found.");
    if (method === "GET") return json({ ok: true, school: schoolOut(st, school) });
    if (method === "PATCH") {
      const next: SchoolRow = { ...school };
      for (const key of ["name", "tagline", "bio", "location", "motto", "badge", "contactEmail", "contactPhone"] as const) {
        if (body[key] !== undefined) next[key] = clean(body[key], key === "bio" ? 2000 : 200);
      }
      if (Array.isArray(body.streams)) next.streams = body.streams.filter((x): x is EducationStream => (EDUCATION_STREAM_IDS as readonly string[]).includes(x as string));
      done({ ...st, schools: st.schools.map((s) => (s.id === school.id ? next : s)) });
      return json({ ok: true, school: schoolOut(st, next) });
    }
    if (method === "DELETE") {
      const courseIds = new Set(st.courses.filter((c) => c.schoolId === school.id).map((c) => c.id));
      done({
        schools: st.schools.filter((s) => s.id !== school.id),
        classes: st.classes.filter((c) => c.schoolId !== school.id),
        courses: st.courses.filter((c) => c.schoolId !== school.id),
        modules: st.modules.filter((x) => !courseIds.has(x.courseId)),
        lessons: st.lessons.filter((l) => !courseIds.has(l.courseId)),
      });
      return json({ ok: true });
    }
  }

  m = route.match(/^\/schools\/([^/]+)\/classes$/);
  if (m) {
    const school = st.schools.find((s) => s.id === m![1]);
    if (!school) return problem(404, "not_found", "That school wasn't found.");
    if (method === "GET") return json({ ok: true, classes: st.classes.filter((c) => c.schoolId === school.id).map((c) => classOut(st, c)) });
    if (method === "POST") {
      const stream = body.stream as EducationStream;
      const name = clean(body.name, 120);
      if (name.length < 2) return problem(400, "invalid_body", "name: Enter at least 2 characters");
      if (!school.streams.includes(stream)) return problem(400, "stream_not_offered", "Add that stream to your school before creating a class in it.");
      const kind = body.kind === "masterclass" ? "masterclass" : "class";
      const framework = clean(body.framework, 40) || "open_syllabus";
      const fw = CURRICULUM_FRAMEWORKS.find((f) => f.id === framework);
      if (!fw || (!fw.streams.includes(stream) && framework !== "open_syllabus")) return problem(400, "framework_mismatch", "That syllabus isn't used in this stream. Pick one from the list or use your own syllabus.");
      if (st.classes.filter((c) => c.schoolId === school.id).length >= S.maxClassesPerSchool) return problem(409, "limit_reached", `A school can have up to ${S.maxClassesPerSchool} classes.`);
      const cls: ClassRow = {
        id: uid("cls"), schoolId: school.id, stream, kind, name, level: clean(body.level, 120), framework: framework as ClassRow["framework"],
        academicYear: clean(body.academicYear, 40), term: clean(body.term, 60), teacherName: clean(body.teacherName, 120),
        capacity: Math.max(1, num(body.capacity, 40)), summary: clean(body.summary, 2000), status: "published",
      };
      done({ ...st, classes: [...st.classes, cls] });
      return json({ ok: true, class: { ...cls, courseCount: 0 } }, 201);
    }
  }

  m = route.match(/^\/classes\/([^/]+)$/);
  if (m) {
    const cls = st.classes.find((c) => c.id === m![1]);
    if (!cls) return problem(404, "not_found", "That class wasn't found.");
    if (method === "GET") return json({ ok: true, class: classOut(st, cls) });
    if (method === "PATCH") {
      const next: ClassRow = { ...cls };
      for (const key of ["name", "level", "academicYear", "term", "teacherName", "summary"] as const) {
        if (body[key] !== undefined) next[key] = clean(body[key], key === "summary" ? 2000 : 120);
      }
      if (body.capacity !== undefined) next.capacity = Math.max(1, num(body.capacity, cls.capacity));
      done({ ...st, classes: st.classes.map((c) => (c.id === cls.id ? next : c)) });
      return json({ ok: true, class: classOut(st, next) });
    }
    if (method === "DELETE") {
      const courseIds = new Set(st.courses.filter((c) => c.classId === cls.id).map((c) => c.id));
      done({
        ...st,
        classes: st.classes.filter((c) => c.id !== cls.id),
        courses: st.courses.filter((c) => c.classId !== cls.id),
        modules: st.modules.filter((x) => !courseIds.has(x.courseId)),
        lessons: st.lessons.filter((l) => !courseIds.has(l.courseId)),
      });
      return json({ ok: true });
    }
  }

  m = route.match(/^\/classes\/([^/]+)\/courses$/);
  if (m) {
    const cls = st.classes.find((c) => c.id === m![1]);
    if (!cls) return problem(404, "not_found", "That class wasn't found.");
    if (method === "GET") return json({ ok: true, courses: st.courses.filter((c) => c.classId === cls.id).map((c) => courseOut(st, c)) });
    if (method === "POST") {
      const title = clean(body.title, 120);
      if (title.length < 2) return problem(400, "invalid_body", "title: Enter at least 2 characters");
      const price = Math.max(0, num(body.priceUgx, 0));
      if (price > S.maxCoursePriceUgx) return problem(400, "price_too_high", `A course can cost up to UGX ${S.maxCoursePriceUgx.toLocaleString("en-UG")}.`);
      if (st.courses.filter((c) => c.classId === cls.id).length >= S.maxCoursesPerClass) return problem(409, "limit_reached", `A class can have up to ${S.maxCoursesPerClass} courses.`);
      const course: CourseRow = {
        id: uid("crs"), schoolId: cls.schoolId, classId: cls.id, stream: cls.stream, title, summary: clean(body.summary, 2000), priceUgx: price,
        framework: (clean(body.framework, 40) || cls.framework) as CourseRow["framework"],
        outcomes: (Array.isArray(body.outcomes) ? body.outcomes : []).map((o) => clean(o, 200)).filter(Boolean).slice(0, 12),
        status: "draft", createdAt: new Date().toISOString().slice(0, 19).replace("T", " "),
      };
      done({ ...st, courses: [...st.courses, course] });
      return json({ ok: true, course: courseOut(st, course) }, 201);
    }
  }

  m = route.match(/^\/courses\/([^/]+)$/);
  if (m) {
    const course = st.courses.find((c) => c.id === m![1]);
    if (!course) return problem(404, "not_found", "That course wasn't found.");
    if (method === "GET") {
      const modules = st.modules.filter((x) => x.courseId === course.id).sort((a, b) => a.position - b.position);
      return json({
        ok: true,
        course: { ...courseOut(st, course), modules: modules.map((x) => ({ ...x, lessons: st.lessons.filter((l) => l.moduleId === x.id).sort((a, b) => a.position - b.position) })) },
      });
    }
    if (method === "PATCH") {
      const next: CourseRow = { ...course };
      if (body.title !== undefined) next.title = clean(body.title, 120);
      if (body.summary !== undefined) next.summary = clean(body.summary, 2000);
      if (body.priceUgx !== undefined) {
        const price = Math.max(0, num(body.priceUgx, 0));
        if (price > S.maxCoursePriceUgx) return problem(400, "price_too_high", `A course can cost up to UGX ${S.maxCoursePriceUgx.toLocaleString("en-UG")}.`);
        next.priceUgx = price;
      }
      if (Array.isArray(body.outcomes)) next.outcomes = body.outcomes.map((o) => clean(o, 200)).filter(Boolean).slice(0, 12);
      if (body.status === "published" || body.status === "draft") {
        if (body.status === "published" && course.status !== "published" && !st.lessons.some((l) => l.courseId === course.id)) {
          return problem(409, "course_empty", "Add at least one lesson before publishing this course.");
        }
        next.status = body.status;
      }
      done({ ...st, courses: st.courses.map((c) => (c.id === course.id ? next : c)) });
      return json({ ok: true, course: courseOut(st, next) });
    }
    if (method === "DELETE") {
      done({ ...st, courses: st.courses.filter((c) => c.id !== course.id), modules: st.modules.filter((x) => x.courseId !== course.id), lessons: st.lessons.filter((l) => l.courseId !== course.id) });
      return json({ ok: true });
    }
  }

  m = route.match(/^\/courses\/([^/]+)\/modules$/);
  if (m && method === "POST") {
    const course = st.courses.find((c) => c.id === m![1]);
    if (!course) return problem(404, "not_found", "That course wasn't found.");
    const title = clean(body.title, 120);
    if (title.length < 2) return problem(400, "invalid_body", "title: Enter at least 2 characters");
    const existing = st.modules.filter((x) => x.courseId === course.id).length;
    if (existing >= S.maxModulesPerCourse) return problem(409, "limit_reached", `A course can have up to ${S.maxModulesPerCourse} modules.`);
    const mod = { id: uid("mod"), courseId: course.id, title, description: clean(body.description, 2000), position: existing + 1 };
    done({ ...st, modules: [...st.modules, mod] });
    return json({ ok: true, module: { ...mod, lessons: [] } }, 201);
  }

  m = route.match(/^\/modules\/([^/]+)$/);
  if (m) {
    const mod = st.modules.find((x) => x.id === m![1]);
    if (!mod) return problem(404, "not_found", "That module wasn't found.");
    if (method === "PATCH") {
      const next = { ...mod, title: body.title !== undefined ? clean(body.title, 120) : mod.title, description: body.description !== undefined ? clean(body.description, 2000) : mod.description };
      done({ ...st, modules: st.modules.map((x) => (x.id === mod.id ? next : x)) });
      return json({ ok: true, module: { ...next, lessons: [] } });
    }
    if (method === "DELETE") {
      done({ ...st, modules: st.modules.filter((x) => x.id !== mod.id), lessons: st.lessons.filter((l) => l.moduleId !== mod.id) });
      return json({ ok: true });
    }
  }

  m = route.match(/^\/modules\/([^/]+)\/lessons$/);
  if (m && method === "POST") {
    const mod = st.modules.find((x) => x.id === m![1]);
    if (!mod) return problem(404, "not_found", "That module wasn't found.");
    const title = clean(body.title, 120);
    if (title.length < 2) return problem(400, "invalid_body", "title: Enter at least 2 characters");
    const url = httpsOrEmpty(body.contentUrl);
    if (url === null) return problem(400, "invalid_body", "contentUrl: Use a full https:// link");
    const minutes = Math.max(1, num(body.durationMinutes, 10));
    if (minutes > S.maxLessonMinutes) return problem(400, "lesson_too_long", `A lesson can run up to ${S.maxLessonMinutes} minutes.`);
    const existing = st.lessons.filter((l) => l.moduleId === mod.id).length;
    if (existing >= S.maxLessonsPerModule) return problem(409, "limit_reached", `A module can have up to ${S.maxLessonsPerModule} lessons.`);
    const lesson: StudioLesson = {
      id: uid("les"), moduleId: mod.id, courseId: mod.courseId, title, contentType: normaliseContentType(clean(body.contentType, 30) || "video"),
      durationMinutes: minutes, summary: clean(body.summary, 2000), contentUrl: url, position: existing + 1,
      body: clean(body.body, S.maxLessonBodyChars), slides: Array.isArray(body.slides) ? (body.slides as StudioLesson["slides"]).slice(0, S.maxSlidesPerLesson) : [],
      live: (body.live as StudioLesson["live"]) ?? null, quiz: readQuiz(body.quiz) ?? null, media: null,
    };
    done({ ...st, lessons: [...st.lessons, lesson] });
    return json({ ok: true, lesson }, 201);
  }

  m = route.match(/^\/lessons\/([^/]+)$/);
  if (m) {
    const lesson = st.lessons.find((l) => l.id === m![1]);
    if (!lesson) return problem(404, "not_found", "That lesson wasn't found.");
    if (method === "PATCH") {
      const url = body.contentUrl === undefined ? lesson.contentUrl : httpsOrEmpty(body.contentUrl);
      if (url === null) return problem(400, "invalid_body", "contentUrl: Use a full https:// link");
      const quiz = readQuiz(body.quiz);
      const next: StudioLesson = {
        ...lesson,
        title: body.title !== undefined ? clean(body.title, 120) : lesson.title,
        summary: body.summary !== undefined ? clean(body.summary, 2000) : lesson.summary,
        durationMinutes: body.durationMinutes !== undefined ? Math.min(S.maxLessonMinutes, Math.max(1, num(body.durationMinutes, lesson.durationMinutes))) : lesson.durationMinutes,
        contentUrl: url,
        contentType: body.contentType !== undefined ? normaliseContentType(clean(body.contentType, 30)) : lesson.contentType,
        body: body.body !== undefined ? clean(body.body, S.maxLessonBodyChars) : lesson.body,
        slides: Array.isArray(body.slides) ? (body.slides as StudioLesson["slides"]).slice(0, S.maxSlidesPerLesson) : lesson.slides,
        live: body.live !== undefined ? (body.live as StudioLesson["live"]) : lesson.live,
        quiz: quiz === undefined ? lesson.quiz : quiz,
      };
      done({ ...st, lessons: st.lessons.map((l) => (l.id === lesson.id ? next : l)) });
      return json({ ok: true, lesson: next });
    }
    if (method === "DELETE") {
      done({ ...st, lessons: st.lessons.filter((l) => l.id !== lesson.id) });
      return json({ ok: true });
    }
  }

  return problem(404, "not_found", "That wasn't found.");
}


// ---------------------------------------------------------------------------
// School messages in Sandbox: two practice conversations kept in the browser. Calls are off here.
// ---------------------------------------------------------------------------

const MESSAGES_KEY = "peebee.practice.learn.messages.v1";
type SandboxMessage = { id: string; sender_role: "customer" | "school"; body: string; type: "text"; call_id: null; call_status: null; call_duration_seconds: null; read: number; created_at: string };
type SandboxThread = { schoolId: string; customerId: string; customerName: string; messages: SandboxMessage[] };

function seedThreads(): SandboxThread[] {
  const school = load().schools[0];
  if (!school) return [];
  const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
  const m = (id: string, role: "customer" | "school", body: string, minutesAgo: number, read: number): SandboxMessage => ({ id, sender_role: role, body, type: "text", call_id: null, call_status: null, call_duration_seconds: null, read, created_at: at(minutesAgo) });
  return [
    { schoolId: school.id, customerId: "practice-parent", customerName: "Grace Namutebi (parent)", messages: [m("pm1", "customer", "Good morning. Is there still a seat in the P.4 class this term?", 90, 0)] },
    { schoolId: school.id, customerId: "practice-student", customerName: "Brian Okello (student)", messages: [m("pm2", "customer", "When is the next maths quiz?", 600, 1), m("pm3", "school", "Friday at 10am. Revise units 3 and 4.", 540, 1)] },
  ];
}

function loadThreads(): SandboxThread[] {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(MESSAGES_KEY) : null;
    if (raw) return JSON.parse(raw) as SandboxThread[];
  } catch {
    /* fall through to a fresh set */
  }
  return seedThreads();
}

function saveThreads(threads: SandboxThread[]) {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(MESSAGES_KEY, JSON.stringify(threads));
  } catch {
    /* private mode: the practice conversation just won't persist */
  }
}

function handleMessagesSandbox(path: string, method: string, body: Record<string, unknown>): Response {
  const parts = path.replace("/v1/education/messages/", "").split("/").filter(Boolean);
  const threads = loadThreads();
  const school = load().schools[0];
  const preview = (t: SandboxThread) => t.messages[t.messages.length - 1];
  const config = { callsEnabled: false, maxMessageChars: DEFAULT_LEARN_SETTINGS.maxMessageChars };

  if (parts[0] === "studio" && parts.length === 1 && method === "GET") {
    return json({
      ok: true,
      threads: threads.map((t) => ({
        schoolId: t.schoolId,
        schoolName: load().schools.find((x) => x.id === t.schoolId)?.name ?? school?.name ?? "",
        customerId: t.customerId,
        customerName: t.customerName,
        lastMessagePreview: preview(t)?.body ?? "",
        lastMessageAt: preview(t)?.created_at ?? new Date().toISOString(),
        unread: t.messages.some((x) => x.sender_role === "customer" && !x.read),
      })),
    });
  }
  if (parts[0] === "studio" && parts.length >= 3) {
    const thread = threads.find((t) => t.schoolId === parts[1] && t.customerId === parts[2]);
    if (!thread) return problem(404, "not_found", "That conversation wasn't found.");
    if (parts[3] === "read" && method === "POST") {
      thread.messages.forEach((x) => { if (x.sender_role === "customer") x.read = 1; });
      saveThreads(threads);
      return json({ ok: true });
    }
    if (method === "GET") return json({ ok: true, schoolName: load().schools.find((x) => x.id === thread.schoolId)?.name ?? "", customerName: thread.customerName, ...config, messages: thread.messages });
    if (method === "POST") {
      const text = clean(body.body, config.maxMessageChars);
      if (!text) return problem(400, "invalid_body", "Write a message first.");
      const id = uid("pm");
      thread.messages.push({ id, sender_role: "school", body: text, type: "text", call_id: null, call_status: null, call_duration_seconds: null, read: 0, created_at: new Date().toISOString() });
      saveThreads(threads);
      return json({ ok: true, id }, 201);
    }
  }
  if (parts[0] === "mine" && method === "GET") return json({ ok: true, threads: [] });
  return problem(503, "sandbox_only", "This needs the live service. It isn't available in the sandbox.");
}
