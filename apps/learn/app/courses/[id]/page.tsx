"use client";

import { CURRICULUM_FRAMEWORKS, LESSON_CONTENT_TYPES, isAssessment, type CourseStudent, type LessonContentType, type StudioClass, type StudioCourseDetail, type StudioLesson, type StudioSchool } from "@peebee/shared";
import { ArrowDown, ArrowUp, AudioLines, PenLine, BookOpenText, ClipboardCheck, Eye, EyeOff, GraduationCap, Layers, Pencil, Plus, Presentation, Radio, Trash2, Upload, Users, Video, type LucideIcon } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CoverPicker } from "../../../components/studio/CoverPicker";
import { CourseForm, ModuleForm, type CourseInput } from "../../../components/studio/forms";
import { ItemForm, type ItemInput } from "../../../components/studio/ItemForm";
import { Community } from "../../../components/studio/Community";
import { GradebookTable, Marking } from "../../../components/studio/Marking";
import { Button, Chip, Crumbs, EmptyState, Notice, Skeleton, cardCls } from "../../../components/ui";
import { api, errorMessage } from "../../../lib/api";
import { LearningCreatorLink } from "@peebee/shared/learning-creator-link";
import { useStudioSettings } from "../../../lib/studio-config";
import { STREAM_UI, formatMinutes, formatUgx, plural } from "../../../lib/streams";

type Editing =
  | { kind: "none" }
  | { kind: "course" }
  | { kind: "module-new" }
  | { kind: "module-edit"; id: string }
  | { kind: "lesson-new"; moduleId: string; type: LessonContentType }
  | { kind: "lesson-edit"; id: string };

const TYPE_LABEL = Object.fromEntries(LESSON_CONTENT_TYPES.map((t) => [t.id, t.label]));
const TYPE_ICON: Record<LessonContentType, LucideIcon> = { text: BookOpenText, slides: Presentation, audio: AudioLines, video: Video, live: Radio, quiz: ClipboardCheck, exam: GraduationCap, assignment: PenLine };

const whenLabel = (iso: string) => new Date(iso).toLocaleString("en-UG", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function CoursePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const settings = useStudioSettings();
  const [course, setCourse] = useState<StudioCourseDetail | null>(null);
  const [cls, setCls] = useState<StudioClass | null>(null);
  const [school, setSchool] = useState<StudioSchool | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>({ kind: "none" });
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [students, setStudents] = useState<CourseStudent[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [attendance, setAttendance] = useState<Record<string, string>>({});
  const [marking, setMarking] = useState<string | null>(null);
  const [gradeKey, setGradeKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const found = await api.studioCourse(id);
      const owner = await api.studioClass(found.course.classId);
      const holder = await api.studioSchool(found.course.schoolId);
      setCourse(found.course);
      api.studioCourseStudents(id).then((r) => setStudents(r.students)).catch(() => setStudents([]));
      setCls(owner.class);
      setSchool(holder.school);
      setError(null);
    } catch (err) {
      setCourse(null);
      setError(errorMessage(err));
    } finally {
      setLoaded(true);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const lessons = course?.modules.flatMap((m) => m.lessons) ?? [];
    return { lessons: lessons.length, minutes: lessons.reduce((n, l) => n + l.durationMinutes, 0), quizzes: lessons.filter((l) => isAssessment(l.contentType)).length };
  }, [course]);

  const suspended = school?.status === "suspended";
  const canBuild = settings.enabled && !suspended;

  /** Runs one change, then refreshes the course. Every handler below goes through this so errors are shown the same way. */
  async function run(action: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setFormError(null);
    setNotice(null);
    try {
      await action();
      setEditing({ kind: "none" });
      await load();
      if (done) setNotice(done);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function uploadMedia(lessonId: string, file: File) {
    if (file.size > settings.maxVideoMb * 1024 * 1024) {
      setFormError(`That file is ${(file.size / 1024 / 1024).toFixed(0)} MB. Files can be up to ${settings.maxVideoMb} MB.`);
      return;
    }
    setUploading(lessonId);
    setFormError(null);
    setNotice(null);
    try {
      await api.studioUploadLessonMedia(lessonId, file);
      await load();
      setNotice("Video uploaded.");
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setUploading(null);
    }
  }

  const cancel = () => {
    setEditing({ kind: "none" });
    setFormError(null);
  };

  if (!loaded) return <Skeleton className="h-64" />;
  if (!course || !cls || !school) {
    return (
      <div className="space-y-4">
        <Crumbs items={[{ label: "Schools", href: "/schools" }, { label: "Not found" }]} />
        <Notice tone="error">{error ?? "That course wasn't found."}</Notice>
      </div>
    );
  }

  const published = course.status === "published";
  const framework = CURRICULUM_FRAMEWORKS.find((f) => f.id === course.framework)?.label ?? "Own syllabus";
  const lessonRoomLeft = (moduleId: string) => (course.modules.find((m) => m.id === moduleId)?.lessons.length ?? 0) < settings.maxLessonsPerModule;
  const editingLesson: StudioLesson | undefined =
    editing.kind === "lesson-edit" ? course.modules.flatMap((m) => m.lessons).find((l) => l.id === editing.id) : undefined;

  function saveLesson(input: ItemInput, existing?: StudioLesson, moduleId?: string) {
    return run(
      () => (existing ? api.studioUpdateLesson(existing.id, input) : api.studioCreateLesson(moduleId as string, input)),
      existing ? "Saved." : "Added.",
    );
  }

  /** The order as it is now: sections, and the items in each. Every move below edits a copy of this and saves it. */
  function currentOrder() {
    return { modules: course!.modules.map((m) => m.id), lessons: Object.fromEntries(course!.modules.map((m) => [m.id, m.lessons.map((l) => l.id)])) as Record<string, string[]> };
  }

  function moveItem(moduleId: string, lessonId: string, by: number) {
    const order = currentOrder();
    const list = order.lessons[moduleId];
    const from = list.indexOf(lessonId);
    const to = from + by;
    if (to < 0 || to >= list.length) return;
    [list[from], list[to]] = [list[to], list[from]];
    void run(() => api.studioReorderCourse(id, order));
  }

  function moveToSection(fromModule: string, lessonId: string, toModule: string) {
    const order = currentOrder();
    order.lessons[fromModule] = order.lessons[fromModule].filter((x) => x !== lessonId);
    order.lessons[toModule] = [...order.lessons[toModule], lessonId];
    void run(() => api.studioReorderCourse(id, order), "Moved.");
  }

  function moveSection(moduleId: string, by: number) {
    const order = currentOrder();
    const from = order.modules.indexOf(moduleId);
    const to = from + by;
    if (to < 0 || to >= order.modules.length) return;
    [order.modules[from], order.modules[to]] = [order.modules[to], order.modules[from]];
    void run(() => api.studioReorderCourse(id, order));
  }

  return (
    <div className="space-y-5 pb-6">
      <Crumbs
        items={[
          { label: "Schools", href: "/schools" },
          { label: school.name, href: `/schools/${school.id}` },
          { label: cls.name, href: `/classes/${cls.id}` },
          { label: course.title },
        ]}
      />

      <header className={`${cardCls} space-y-3 p-4 sm:p-5`}>
        <CoverPicker kind="course" id={id} maxMb={settings.maxCoverMb} disabled={!canBuild} published={published} />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap gap-1.5">
              <Chip tone={published ? "green" : "muted"}>{published ? "Live" : "Draft"}</Chip>
              <Chip tone="gold">{STREAM_UI[course.stream].title}</Chip>
            </div>
            <h2 className="font-display text-2xl font-semibold text-ink">{course.title}</h2>
            <p className="text-base text-ink-500">
              {framework} · {formatUgx(course.priceUgx)}
            </p>
          </div>
          {canBuild && editing.kind === "none" && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setEditing({ kind: "course" })}>
                <Pencil className="h-4 w-4" aria-hidden /> Edit
              </Button>
              <Button
                variant={published ? "secondary" : "primary"}
                disabled={busy || (!published && totals.lessons === 0)}
                onClick={() => run(() => api.studioUpdateCourse(id, { status: published ? "draft" : "published" }), published ? "The course is now a draft and hidden from learners." : "Published. Learners can now find this course.")}
              >
                {published ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                {published ? "Unpublish" : "Publish"}
              </Button>
            </div>
          )}
        </div>
        {course.summary && <p className="text-lg text-ink-500">{course.summary}</p>}
        {course.outcomes.length > 0 && (
          <div className="space-y-1 border-t border-[var(--border-faint)] pt-3">
            <p className="text-base font-semibold text-ink-500">After this course, a learner can:</p>
            <ul className="list-disc space-y-0.5 pl-5 text-lg text-ink">
              {course.outcomes.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="border-t border-[var(--border-faint)] pt-3 text-base text-ink-500">
          {plural(course.modules.length, "section")} · {plural(totals.lessons, "item")} · {formatMinutes(totals.minutes)} · {plural(totals.quizzes, "quiz or exam", "quizzes and exams")}
        </p>
        {!published && totals.lessons === 0 && canBuild && <p className="text-base text-ink-500">Add at least one item to be able to publish.</p>}
      </header>

      {suspended && <Notice tone="error">This school has been suspended by Peebee, so it can&apos;t be edited and its courses are hidden.</Notice>}
      {!settings.enabled && !suspended && <Notice tone="info">The Studio is switched off right now, so nothing can be created or edited.</Notice>}
      {notice && (
        <Notice tone="success" onClose={() => setNotice(null)}>
          {notice}
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {editing.kind === "none" && formError && <Notice tone="error">{formError}</Notice>}

      {editing.kind === "course" && (
        <CourseForm
          settings={settings}
          stream={course.stream}
          defaultFramework={course.framework}
          initial={course}
          title="Course details"
          submitLabel="Save changes"
          busy={busy}
          error={formError}
          onSubmit={(input: CourseInput) => run(() => api.studioUpdateCourse(id, input), "Course saved.")}
          onCancel={cancel}
        />
      )}

      {canBuild && editing.kind === "none" && (
        <section aria-labelledby="rules-heading" className={`${cardCls} space-y-3 p-4`}>
          <h3 id="rules-heading" className="text-lg font-semibold text-ink">
            Class rules
          </h3>
          {settings.prerequisitesEnabled && (
            <label className="flex items-start gap-2 text-lg text-ink">
              <input
                type="checkbox"
                checked={course.rules.sequential}
                disabled={busy}
                onChange={(e) => void run(() => api.studioSetCourseRules(id, { ...course.rules, sequential: e.target.checked }), "Rules saved.")}
                className="mt-0.5 h-4 w-4 accent-[rgb(var(--color-gold))]"
              />
              <span>
                Learners go in order
                <span className="block text-base text-ink-500">Each item opens when the ones before it are done. Live lessons never hold anyone back.</span>
              </span>
            </label>
          )}
          {settings.prerequisitesEnabled && (
            <div className="space-y-1">
              <label htmlFor="prereq" className="block text-base font-semibold text-ink-500">
                Learners must finish this course first
              </label>
              <select
                id="prereq"
                value={course.rules.prerequisiteCourseId ?? ""}
                disabled={busy}
                onChange={(e) => void run(() => api.studioSetCourseRules(id, { ...course.rules, prerequisiteCourseId: e.target.value || null }), "Rules saved.")}
                className="w-full rounded-xl border border-[var(--border-faint)] text-lg text-ink"
              >
                <option value="">None</option>
                {course.prerequisiteOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.title}
                  </option>
                ))}
              </select>
            </div>
          )}
          {settings.certificatesEnabled && (
            <label className="flex items-start gap-2 text-lg text-ink">
              <input
                type="checkbox"
                checked={course.rules.certificateEnabled}
                disabled={busy}
                onChange={(e) => void run(() => api.studioSetCourseRules(id, { ...course.rules, certificateEnabled: e.target.checked }), "Rules saved.")}
                className="mt-0.5 h-4 w-4 accent-[rgb(var(--color-gold))]"
              />
              <span>
                Give a certificate when a learner finishes
                <span className="block text-base text-ink-500">Every item done, including quizzes and exams.</span>
              </span>
            </label>
          )}
        </section>
      )}

      <section aria-labelledby="syllabus-heading" className="space-y-3">
        <LearningCreatorLink api={api} href={`/create?course=${encodeURIComponent(id)}`} label="Open shared authoring & AI assistance" />
        <div className="flex items-center justify-between gap-3">
          <h3 id="syllabus-heading" className="text-base font-semibold text-ink">
            Class outline
          </h3>
          {canBuild && editing.kind === "none" && course.modules.length > 0 && course.modules.length < settings.maxModulesPerCourse && (
            <Button onClick={() => setEditing({ kind: "module-new" })}>
              <Plus className="h-4 w-4" aria-hidden /> Add section
            </Button>
          )}
        </div>

        {editing.kind === "module-new" && (
          <ModuleForm
            title="Add a section"
            submitLabel="Add section"
            busy={busy}
            error={formError}
            onSubmit={(input) => run(() => api.studioCreateModule(id, input), "Section added.")}
            onCancel={cancel}
          />
        )}

        {course.modules.length === 0 ? (
          editing.kind !== "module-new" && (
            <EmptyState
              icon={Layers}
              title="Start with a section"
              body="A class has sections: units or weeks. Each holds lessons (text, slides, audio, video or live video) and, usually at the end, a quiz or exam."
              action={
                canBuild ? (
                  <Button onClick={() => setEditing({ kind: "module-new" })}>
                    <Plus className="h-4 w-4" aria-hidden /> Add the first section
                  </Button>
                ) : undefined
              }
            />
          )
        ) : (
          course.modules.map((mod, mi) => (
            <article key={mod.id} className={`${cardCls} space-y-3 p-4`}>
              {editing.kind === "module-edit" && editing.id === mod.id ? (
                <ModuleForm
                  initial={mod}
                  title="Edit section"
                  submitLabel="Save section"
                  busy={busy}
                  error={formError}
                  onSubmit={(input) => run(() => api.studioUpdateModule(mod.id, input), "Section saved.")}
                  onCancel={cancel}
                />
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold uppercase tracking-wider text-gold">Section {mi + 1}</p>
                    <h4 className="text-lg font-semibold text-ink">{mod.title}</h4>
                    {mod.description && <p className="text-base text-ink-500">{mod.description}</p>}
                    {settings.dripEnabled && canBuild && (
                      <label className="mt-1 flex items-center gap-2 text-base text-ink-500">
                        Opens
                        <input
                          type="number"
                          min={0}
                          max={730}
                          inputMode="numeric"
                          aria-label={`Days after enrolling that section ${mi + 1} opens`}
                          defaultValue={mod.dripDays ?? 0}
                          key={`${mod.id}-${mod.dripDays ?? 0}`}
                          onBlur={(e) => {
                            const days = Number(e.target.value);
                            if (Number.isInteger(days) && days >= 0 && days !== (mod.dripDays ?? 0)) void run(() => api.studioSetModuleDrip(mod.id, days), "Release saved.");
                          }}
                          className="w-16 rounded-lg border border-[var(--border-faint)] px-2 py-1 text-base text-ink"
                        />
                        days after a learner enrols (0 = straight away)
                      </label>
                    )}
                  </div>
                  {canBuild && editing.kind === "none" && (
                    <div className="flex shrink-0 gap-1">
                      <button type="button" aria-label={`Move section ${mi + 1} up`} disabled={mi === 0 || busy} onClick={() => moveSection(mod.id, -1)} className="rounded-lg p-2 text-ink-500 hover:bg-[rgb(var(--surface-muted))] hover:text-ink disabled:opacity-30">
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <button type="button" aria-label={`Move section ${mi + 1} down`} disabled={mi === course.modules.length - 1 || busy} onClick={() => moveSection(mod.id, 1)} className="rounded-lg p-2 text-ink-500 hover:bg-[rgb(var(--surface-muted))] hover:text-ink disabled:opacity-30">
                        <ArrowDown className="h-4 w-4" />
                      </button>
                      <button type="button" aria-label={`Edit section ${mi + 1}`} onClick={() => setEditing({ kind: "module-edit", id: mod.id })} className="rounded-lg p-2 text-ink-500 hover:bg-[rgb(var(--surface-muted))] hover:text-ink">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete section ${mi + 1}`}
                        onClick={() => {
                          if (window.confirm(`Delete “${mod.title}” and its ${mod.lessons.length} items?`)) void run(() => api.studioDeleteModule(mod.id), "Section deleted.");
                        }}
                        className="rounded-lg p-2 text-ink-500 hover:bg-[rgb(var(--surface-muted))] hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              )}

              <ol className="space-y-2">
                {mod.lessons.map((lesson, li) =>
                  editing.kind === "lesson-edit" && editing.id === lesson.id && editingLesson ? (
                    <li key={lesson.id}>
                      <ItemForm
                        settings={settings}
                        kind={editingLesson.contentType}
                        initial={editingLesson}
                        title={`Edit ${(TYPE_LABEL[editingLesson.contentType] ?? "item").toLowerCase()}`}
                        submitLabel="Save"
                        busy={busy}
                        error={formError}
                        onSubmit={(input) => saveLesson(input, editingLesson)}
                        onCancel={cancel}
                      />
                    </li>
                  ) : (
                    <li key={lesson.id} className="flex items-start justify-between gap-3 rounded-xl border border-[var(--border-faint)] px-3.5 py-3">
                      <div className="min-w-0 space-y-0.5">
                        <p className="flex items-center gap-2 text-lg font-semibold text-ink">
                          {(() => {
                            const Icon = TYPE_ICON[lesson.contentType];
                            return <Icon className={`h-4 w-4 shrink-0 ${isAssessment(lesson.contentType) ? "text-gold" : "text-ink-500"}`} aria-hidden />;
                          })()}
                          <span className="min-w-0">{lesson.title}</span>
                        </p>
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base text-ink-500">
                          <span>{TYPE_LABEL[lesson.contentType] ?? lesson.contentType}</span>
                          <span aria-hidden>·</span>
                          <span>{formatMinutes(lesson.durationMinutes)}</span>
                          {lesson.quiz && isAssessment(lesson.contentType) && (
                            <span className="text-gold">
                              {lesson.quiz.questions.length} {lesson.quiz.questions.length === 1 ? "question" : "questions"} · pass {lesson.quiz.passingScorePercent}%
                            </span>
                          )}
                          {lesson.live && <span className="text-gold">{whenLabel(lesson.live.startsAt)}</span>}
                          {lesson.live && (
                            <button
                              type="button"
                              className="font-semibold underline"
                              onClick={() =>
                                api
                                  .studioLessonAttendance(lesson.id)
                                  .then((r) => setAttendance((a) => ({ ...a, [lesson.id]: `${r.attendees.length} of ${r.enrolled} joined` })))
                                  .catch((err) => setFormError(errorMessage(err)))
                              }
                            >
                              {attendance[lesson.id] ?? "Who joined?"}
                            </button>
                          )}
                          {lesson.contentType === "slides" && <span>{lesson.slides.length} slides</span>}
                          {lesson.contentType === "assignment" && lesson.assignment && (
                            <>
                              <span className="text-gold">{lesson.assignment.maxPoints} points{lesson.assignment.dueAt ? ` · due ${whenLabel(lesson.assignment.dueAt)}` : ""}</span>
                              <button type="button" className="font-semibold underline" onClick={() => setMarking(marking === lesson.id ? null : lesson.id)}>
                                {marking === lesson.id ? "Hide marking" : "Marking"}
                              </button>
                            </>
                          )}
                        </p>
                        {lesson.summary && <p className="line-clamp-2 text-base text-ink-500">{lesson.summary}</p>}
                        {marking === lesson.id && (
                          <div className="pt-2">
                            <Marking lessonId={lesson.id} onChanged={() => setGradeKey((k) => k + 1)} />
                          </div>
                        )}
                        {settings.videoUploadsEnabled && (lesson.contentType === "video" || lesson.contentType === "audio") && (lesson.media || (canBuild && editing.kind === "none")) && (
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            {lesson.media && (
                              <span className="inline-flex items-center gap-1 text-base font-semibold text-green">
                                <Video className="h-3.5 w-3.5" aria-hidden /> {lesson.media.contentType.startsWith("audio") ? "Audio" : "Video"} uploaded · {lesson.media.sizeBytes < 1024 * 1024 ? `${Math.max(1, Math.round(lesson.media.sizeBytes / 1024))} KB` : `${(lesson.media.sizeBytes / 1024 / 1024).toFixed(1)} MB`}
                              </span>
                            )}
                            {canBuild && editing.kind === "none" && (
                              <>
                                <label
                                  className={`inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] px-3 text-base font-semibold text-ink hover:border-gold/50 focus-within:border-gold ${uploading === lesson.id ? "pointer-events-none opacity-60" : ""}`}
                                >
                                  <Upload className="h-3.5 w-3.5" aria-hidden />
                                  {uploading === lesson.id ? "Uploading…" : lesson.media ? "Replace file" : "Upload video or audio"}
                                  <input
                                    type="file"
                                    accept="video/mp4,video/webm,video/quicktime,audio/mpeg,audio/mp4,.mp4,.mov,.webm,.m4a,.mp3"
                                    className="sr-only"
                                    disabled={uploading !== null}
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      e.target.value = "";
                                      if (file) void uploadMedia(lesson.id, file);
                                    }}
                                  />
                                </label>
                                {lesson.media && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (window.confirm("Remove the uploaded file from this lesson?")) void run(() => api.studioDeleteLessonMedia(lesson.id), "File removed.");
                                    }}
                                    className="text-base font-semibold text-ink-500 underline hover:text-red-600"
                                  >
                                    Remove
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                      {canBuild && editing.kind === "none" && (
                        <div className="flex shrink-0 flex-wrap justify-end gap-1">
                          {course.modules.length > 1 && (
                            <select
                              aria-label={`Move “${lesson.title}” to another section`}
                              value=""
                              disabled={busy}
                              onChange={(e) => e.target.value && moveToSection(mod.id, lesson.id, e.target.value)}
                              className="max-w-[7rem] rounded-lg border border-[var(--border-faint)] px-2 py-1 text-base text-ink-500"
                            >
                              <option value="">Move to…</option>
                              {course.modules.filter((m) => m.id !== mod.id).map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.title}
                                </option>
                              ))}
                            </select>
                          )}
                          <button type="button" aria-label={`Move “${lesson.title}” up`} disabled={li === 0 || busy} onClick={() => moveItem(mod.id, lesson.id, -1)} className="rounded-lg p-2 text-ink-500 hover:bg-[rgb(var(--surface-muted))] hover:text-ink disabled:opacity-30">
                            <ArrowUp className="h-4 w-4" />
                          </button>
                          <button type="button" aria-label={`Move “${lesson.title}” down`} disabled={li === mod.lessons.length - 1 || busy} onClick={() => moveItem(mod.id, lesson.id, 1)} className="rounded-lg p-2 text-ink-500 hover:bg-[rgb(var(--surface-muted))] hover:text-ink disabled:opacity-30">
                            <ArrowDown className="h-4 w-4" />
                          </button>
                          <button type="button" aria-label={`Edit ${lesson.title}`} onClick={() => setEditing({ kind: "lesson-edit", id: lesson.id })} className="rounded-lg p-2 text-ink-500 hover:bg-[rgb(var(--surface-muted))] hover:text-ink">
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete ${lesson.title}`}
                            onClick={() => {
                              if (window.confirm(`Delete “${lesson.title}”?`)) void run(() => api.studioDeleteLesson(lesson.id), "Deleted.");
                            }}
                            className="rounded-lg p-2 text-ink-500 hover:bg-[rgb(var(--surface-muted))] hover:text-red-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </li>
                  ),
                )}
              </ol>

              {editing.kind === "lesson-new" && editing.moduleId === mod.id ? (
                <ItemForm
                  settings={settings}
                  kind={editing.type}
                  title={`Add ${(TYPE_LABEL[editing.type] ?? "item").toLowerCase()}`}
                  submitLabel="Add"
                  busy={busy}
                  error={formError}
                  onSubmit={(input) => saveLesson(input, undefined, mod.id)}
                  onCancel={cancel}
                />
              ) : (
                canBuild &&
                editing.kind === "none" && (
                  <div className="space-y-1.5 border-t border-[var(--border-faint)] pt-3">
                    <p className="text-base font-semibold text-ink-500">Add to this section</p>
                    <div className="flex flex-wrap gap-2">
                      {LESSON_CONTENT_TYPES.filter((t) => (t.id !== "live" || settings.liveLessonsEnabled) && (!isAssessment(t.id) || settings.maxQuizQuestionsPerLesson > 0)).map((t) => {
                        const Icon = TYPE_ICON[t.id];
                        return (
                          <Button key={t.id} variant="secondary" className="!min-h-14 !px-3 !text-base" disabled={!lessonRoomLeft(mod.id)} onClick={() => setEditing({ kind: "lesson-new", moduleId: mod.id, type: t.id })}>
                            <Icon className="h-3.5 w-3.5" aria-hidden /> {t.label}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                )
              )}
              {!lessonRoomLeft(mod.id) && <p className="text-base text-ink-500">A section can have up to {settings.maxLessonsPerModule} items.</p>}
            </article>
          ))
        )}
      </section>

      {published && <GradebookTable courseId={id} refreshKey={gradeKey} />}

      {canBuild && <Community courseId={id} />}

      {published && (
        <section aria-labelledby="students-heading" className={`${cardCls} space-y-3 p-4`}>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-gold" aria-hidden />
            <h3 id="students-heading" className="text-lg font-semibold text-ink">
              Learners ({students.length})
            </h3>
          </div>
          {students.length === 0 ? (
            <p className="text-base text-ink-500">Nobody has enrolled yet. Learners find published courses in the Peebee Learn catalogue.</p>
          ) : (
            <ul className="divide-y divide-[var(--border-faint)]">
              {students.map((st) => (
                <li key={st.userId} className="flex items-center justify-between gap-3 py-2 text-lg">
                  <span className="min-w-0 truncate font-semibold text-ink">{st.name}</span>
                  <span className="shrink-0 text-base text-ink-500">
                    {st.progressPercent}% done · {formatUgx(st.paidUgx)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {canBuild && (
        <section aria-labelledby="danger-heading" className={`${cardCls} flex flex-wrap items-center justify-between gap-3 p-4`}>
          <div>
            <h3 id="danger-heading" className="text-lg font-semibold text-ink">
              Delete this course
            </h3>
            <p className="text-base text-ink-500">Removes the course with all of its modules and lessons.</p>
          </div>
          <Button
            variant="danger"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm(`Delete “${course.title}” with its ${totals.lessons} lessons? This can't be undone.`)) return;
              setBusy(true);
              try {
                await api.studioDeleteCourse(id);
                router.replace(`/classes/${cls.id}`);
              } catch (err) {
                setError(errorMessage(err));
                setBusy(false);
              }
            }}
          >
            <Trash2 className="h-4 w-4" aria-hidden /> Delete course
          </Button>
        </section>
      )}
    </div>
  );
}
