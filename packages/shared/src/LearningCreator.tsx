"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  emptyLearningDraft,
  type LearningDraft,
  type LearningWorkspace,
  type LearningJob,
  type LearningCreatorConfig,
  type LearningProfile,
  type LearningReview,
  type LearningLesson,
  type LearningResource,
  type learningCreatorMethods,
} from "./learn-creator.js";
import { LearningEarnings } from "./LearningEarnings.js";
import { LearningResourceView } from "./LearningResourceView.js";

type Api = ReturnType<typeof learningCreatorMethods> & { baseUrl: string };
const card =
  "rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4 sm:p-5";
const field =
  "w-full rounded-xl border border-[var(--border-faint)] p-3 text-sm text-ink outline-none focus:border-gold";
const button =
  "min-h-11 rounded-xl border border-[var(--border-faint)] px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50";
const primary = `${button} bg-gold text-ink-gold`;
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "That change could not be saved. Try again.";
const makeId = () => crypto.randomUUID().replaceAll("-", "");
const newLesson = (): LearningLesson => ({
  id: makeId(),
  title: "New lesson",
  body: "",
  minutes: 10,
  objectiveIds: [],
  resources: [],
  questions: [],
});
function Field({
  label,
  value,
  onChange,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  return (
    <label className="block space-y-1 text-xs font-semibold text-ink-500">
      <span>{label}</span>
      {multiline ? (
        <textarea
          className={`${field} min-h-28`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className={field}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}

export function LearningCreator({
  api,
  initialCourseId,
  initialClassId,
  storeId,
  studyBase = "https://app.peebee.online/learn/study",
  reviewOnly: forceReviewOnly = false,
}: {
  api: Api;
  initialCourseId?: string;
  initialClassId?: string;
  storeId?: string;
  studyBase?: string;
  reviewOnly?: boolean;
}) {
  const [config, setConfig] = useState<LearningCreatorConfig | null>(null),
    [list, setList] = useState<LearningWorkspace[]>([]),
    [ws, setWs] = useState<LearningWorkspace | null>(null),
    [draft, setDraft] = useState<LearningDraft>(emptyLearningDraft),
    [saved, setSaved] = useState("");
  const [profile, setProfile] = useState<LearningProfile>({
      goals: "",
      level: "",
      language: "English",
      minutesPerDay: 20,
    }),
    [profileOpen, setProfileOpen] = useState(false),
    [earningsOpen, setEarningsOpen] = useState(false),
    [newTitle, setNewTitle] = useState(""),
    [kind, setKind] = useState<"course" | "path">("course");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [job, setJob] = useState<LearningJob | null>(null),
    [reviews, setReviews] = useState<LearningReview[]>([]),
    [reviewer, setReviewer] = useState(""),
    [comments, setComments] = useState("");
  const [inbox, setInbox] = useState<
      Array<{ courseId: string; title: string; revision: number }>
    >([]),
    [preview, setPreview] = useState(false);
  const reviewOnly = forceReviewOnly || ws?.canEdit === false;
  const saving = useRef(false),
    dirty = ws !== null && JSON.stringify(draft) !== saved;
  const refresh = useCallback(async () => {
    const r = await api.learningWorkspaces();
    setList(r.workspaces.filter((w) => !storeId || w.storeId === storeId));
  }, [api, storeId]);
  const open = useCallback(
    async (id: string) => {
      const r = await api.learningWorkspace(id);
      setWs(r.workspace);
      setDraft(r.workspace.draft);
      setSaved(JSON.stringify(r.workspace.draft));
      setReviews(r.reviews);
      setJob(null);
      setError("");
      setPreview(false);
    },
    [api],
  );
  useEffect(() => {
    let active = true;
    api
      .learningCreatorConfig()
      .then(async (c) => {
        if (!active) return;
        setConfig(c);
        if (!c.ready) return;
        const [l, p, r] = await Promise.all([
          api.learningWorkspaces(),
          api.learningProfile(),
          api.learningReviewInbox(),
        ]);
        if (!active) return;
        setList(l.workspaces.filter((w) => !storeId || w.storeId === storeId));
        setProfile(p.profile);
        setInbox(r.invitations);
        if (initialCourseId) {
          try {
            await open(initialCourseId);
          } catch {
            const created = await api.createLearningWorkspace({
              title: "Course draft",
              courseId: initialCourseId,
              storeId,
            });
            if (active) await open(created.workspace.courseId);
          }
        }
      })
      .catch((e) => active && setError(errorText(e)));
    return () => {
      active = false;
    };
  }, [api, initialCourseId, storeId, open]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const save = useCallback(async () => {
    if (!ws || ws.canEdit === false || forceReviewOnly || saving.current)
      return ws;
    saving.current = true;
    try {
      const result = await api.saveLearningDraft(
        ws.courseId,
        ws.revision,
        draft,
      );
      setWs(result.workspace);
      setSaved(JSON.stringify(draft));
      return result.workspace;
    } finally {
      saving.current = false;
    }
  }, [api, ws, draft, forceReviewOnly]);
  // Explicit save remains available; revision checks protect concurrent edits in other tabs.
  useEffect(() => {
    if (!dirty || busy || reviewOnly || error) return;
    const timer = setTimeout(() => {
      setBusy(true);
      save()
        .catch((e) => setError(errorText(e)))
        .finally(() => setBusy(false));
    }, 1200);
    return () => clearTimeout(timer);
  }, [dirty, busy, reviewOnly, error, save]);
  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.status)) return;
    let active = true;
    const timer = setTimeout(() => {
      api
        .learningJob(job.id)
        .then((r) => active && setJob(r.job))
        .catch((e) => active && setError(errorText(e)));
    }, 2500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [api, job]);
  const update = (patch: Partial<LearningDraft>) =>
    setDraft((d) => ({ ...d, ...patch }));
  const updateLesson = (
    moduleIndex: number,
    lessonIndex: number,
    patch: Partial<LearningLesson>,
  ) =>
    setDraft((d) => ({
      ...d,
      modules: d.modules.map((m, mi) =>
        mi === moduleIndex
          ? {
              ...m,
              lessons: m.lessons.map((l, li) =>
                li === lessonIndex ? { ...l, ...patch } : l,
              ),
            }
          : m,
      ),
    }));
  const link = ws ? `${studyBase}/${encodeURIComponent(ws.courseId)}` : "";
  if (!config)
    return (
      <section className={card}>
        <p role="status">Loading your learning workspace…</p>
        {error && <p role="alert">{error}</p>}
      </section>
    );
  if (!config.ready || !config.enabled)
    return (
      <section className={card}>
        <h1 className="text-xl font-semibold text-ink">
          Create your learning journey
        </h1>
        <p className="mt-2 text-sm text-ink-500">
          Course creation is being prepared. Your existing courses remain
          available.
        </p>
      </section>
    );
  return (
    <div className="space-y-5 text-ink">
      <header className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-wider text-gold">
          Peebee Learn ·{" "}
          {storeId
            ? "Merchant Elite"
            : initialClassId
              ? "School studio"
              : "Your learning workspace"}
        </p>
        <h1 className="font-display text-2xl font-semibold">
          Create. Teach. Share.
        </h1>
        <p className="max-w-2xl text-sm text-ink-500">
          Build a course or learning path, add your materials, and guide each
          learner through it. AI drafts remain yours to review and edit.
        </p>
      </header>
      {error && (
        <div role="alert" className={card}>
          <p>{error}</p>
          <button
            className={`${button} mt-2`}
            onClick={() => {
              setError("");
              if (ws) void run(() => open(ws.courseId));
            }}
          >
            Reload saved draft
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className={card}>
          {notice}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button className={button} onClick={() => setProfileOpen((v) => !v)}>
          Learning profile
        </button>
        <button className={button} onClick={() => setEarningsOpen((v) => !v)}>
          Sales and refunds
        </button>
        {ws && (
          <button
            className={button}
            disabled={dirty}
            onClick={() => {
              setWs(null);
              setJob(null);
              void refresh();
            }}
          >
            All my drafts
          </button>
        )}
      </div>
      {earningsOpen && <LearningEarnings api={api} />}
      {profileOpen && (
        <section className={`${card} space-y-3`}>
          <h2 className="font-semibold">Your learning profile</h2>
          <Field
            label="What do you want to achieve?"
            value={profile.goals}
            onChange={(goals) => setProfile({ ...profile, goals })}
          />
          <Field
            label="Current knowledge / level"
            value={profile.level}
            onChange={(level) => setProfile({ ...profile, level })}
          />
          <Field
            label="Preferred language"
            value={profile.language}
            onChange={(language) => setProfile({ ...profile, language })}
          />
          <label className="block text-xs font-semibold">
            Minutes available each day
            <input
              type="number"
              min={1}
              max={1440}
              className={field}
              value={profile.minutesPerDay}
              onChange={(e) =>
                setProfile({
                  ...profile,
                  minutesPerDay: Number(e.target.value),
                })
              }
            />
          </label>
          <button
            disabled={busy}
            className={primary}
            onClick={() =>
              void run(async () => {
                await api.saveLearningProfile(profile);
                setNotice("Learning profile saved.");
              })
            }
          >
            Save profile
          </button>
        </section>
      )}
      {!ws && (
        <>
          <section className={`${card} space-y-3`}>
            <h2 className="font-semibold">Start something new</h2>
            <Field
              label="Course or path title"
              value={newTitle}
              onChange={setNewTitle}
            />
            <label className="block text-xs font-semibold">
              What are you creating?
              <select
                className={field}
                value={kind}
                onChange={(e) => setKind(e.target.value as "course" | "path")}
              >
                <option value="course">Complete course</option>
                <option value="path">Learning path</option>
              </select>
            </label>
            <button
              className={primary}
              disabled={busy || newTitle.trim().length < 2}
              onClick={() =>
                void run(async () => {
                  const r = await api.createLearningWorkspace({
                    title: newTitle,
                    kind,
                    classId: initialClassId,
                    storeId,
                  });
                  await open(r.workspace.courseId);
                })
              }
            >
              Create private draft
            </button>
          </section>
          <section className="grid gap-3 sm:grid-cols-2">
            {list.map((w) => (
              <button
                key={w.courseId}
                className={`${card} text-left`}
                onClick={() => void run(() => open(w.courseId))}
              >
                <span className="block font-semibold">{w.draft.title}</span>
                <span className="text-xs text-ink-500">
                  {w.context} · Revision {w.revision} ·{" "}
                  {w.publishedVersion
                    ? "Published version available"
                    : "Private draft"}
                </span>
              </button>
            ))}
          </section>
          {inbox.length > 0 && (
            <section className={`${card} space-y-2`}>
              <h2 className="font-semibold">Review invitations</h2>
              {inbox.map((r) => (
                <button
                  key={r.courseId}
                  className={button}
                  onClick={() => void run(() => open(r.courseId))}
                >
                  {r.title} · revision {r.revision}
                </button>
              ))}
            </section>
          )}
        </>
      )}
      {ws && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto text-xs text-ink-500" role="status">
              Revision {ws.revision} ·{" "}
              {busy
                ? "Working…"
                : dirty
                  ? "Unsaved changes"
                  : "All changes saved"}
            </span>
            <button
              className={button}
              disabled={busy || !dirty || reviewOnly}
              onClick={() =>
                void run(async () => {
                  await save();
                })
              }
            >
              Save
            </button>
            <button
              className={button}
              disabled={busy || reviewOnly}
              onClick={() =>
                void run(async () => {
                  const current = dirty ? await save() : ws;
                  if (!current) return;
                  await api.studyLearningDraft(ws.courseId, current.revision);
                  window.location.assign(link);
                })
              }
            >
              Study this draft privately
            </button>
            <button className={button} onClick={() => setPreview((v) => !v)}>
              {preview ? "Back to editing" : "Learner preview"}
            </button>
          </div>
          {preview ? (
            <section className={`${card} space-y-5`}>
              <h2 className="text-xl font-semibold">{draft.title}</h2>
              <p>{draft.summary}</p>
              {draft.modules.map((m) => (
                <div key={m.id} className="space-y-4">
                  <h3 className="font-semibold">{m.title}</h3>
                  {m.lessons.map((l) => (
                    <article key={l.id} className="space-y-3">
                      <h4 className="font-semibold">{l.title}</h4>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">
                        {l.body}
                      </p>
                      {l.resources.map((r) => (
                        <LearningResourceView
                          key={r.id}
                          api={api}
                          resource={r}
                        />
                      ))}
                    </article>
                  ))}
                </div>
              ))}
            </section>
          ) : (
            <fieldset
              disabled={busy || reviewOnly}
              className="space-y-5 disabled:opacity-80"
            >
              <section className={`${card} space-y-3`}>
                <h2 className="font-semibold">Your brief</h2>
                <Field
                  label="Title"
                  value={draft.title}
                  onChange={(title) => update({ title })}
                />
                <Field
                  label="Summary"
                  value={draft.summary}
                  onChange={(summary) => update({ summary })}
                  multiline
                />
                <Field
                  label="Learning goal"
                  value={draft.goal}
                  onChange={(goal) => update({ goal })}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Audience and current level"
                    value={draft.audience}
                    onChange={(audience) => update({ audience })}
                  />
                  <Field
                    label="Teaching language"
                    value={draft.language}
                    onChange={(language) => update({ language })}
                  />
                </div>
                <Field
                  label="Curriculum / term / teaching schedule"
                  value={draft.curriculum}
                  onChange={(curriculum) => update({ curriculum })}
                />
                <Field
                  label="Available study time / teaching timetable"
                  value={draft.timeBudget || ""}
                  onChange={(timeBudget) => update({ timeBudget })}
                />
                <Field
                  label="Source material and reference names (paste your notes or syllabus)"
                  value={draft.sourceText}
                  onChange={(sourceText) => update({ sourceText })}
                  multiline
                />
                {config.aiEnabled && (
                  <div className="flex flex-wrap gap-2">
                    {(["outline", "lessons"] as const).map((stage) => (
                      <button
                        type="button"
                        key={stage}
                        className={primary}
                        disabled={
                          (!!job &&
                            ["queued", "running"].includes(job.status)) ||
                          (stage === "lessons" && !draft.modules.length)
                        }
                        onClick={() =>
                          void run(async () => {
                            const current = dirty ? await save() : ws;
                            if (!current) return;
                            setJob(
                              (
                                await api.generateLearningContent(
                                  ws.courseId,
                                  current.revision,
                                  stage,
                                  crypto.randomUUID(),
                                )
                              ).job,
                            );
                          })
                        }
                      >
                        {stage === "outline"
                          ? "Suggest objectives & roadmap"
                          : "Draft lesson content"}
                      </button>
                    ))}
                  </div>
                )}
              </section>
              <section className={`${card} space-y-3`}>
                <h2 className="font-semibold">Learning objectives</h2>
                {draft.objectives.map((ob, i) => (
                  <div
                    className="space-y-2 border-b border-[var(--border-faint)] pb-3"
                    key={ob.id}
                  >
                    <Field
                      label={`Objective ${i + 1}`}
                      value={ob.title}
                      onChange={(title) =>
                        update({
                          objectives: draft.objectives.map((o) =>
                            o.id === ob.id ? { ...o, title } : o,
                          ),
                        })
                      }
                    />
                    <Field
                      label="What will demonstrate understanding?"
                      value={ob.evidence}
                      onChange={(evidence) =>
                        update({
                          objectives: draft.objectives.map((o) =>
                            o.id === ob.id ? { ...o, evidence } : o,
                          ),
                        })
                      }
                    />
                    <Field
                      label="Curriculum/source reference (leave blank if unverified)"
                      value={ob.source}
                      onChange={(source) =>
                        update({
                          objectives: draft.objectives.map((o) =>
                            o.id === ob.id ? { ...o, source } : o,
                          ),
                        })
                      }
                    />
                    <button
                      type="button"
                      className={button}
                      onClick={() =>
                        update({
                          objectives: draft.objectives.filter(
                            (o) => o.id !== ob.id,
                          ),
                          modules: draft.modules.map((m) => ({
                            ...m,
                            lessons: m.lessons.map((l) => ({
                              ...l,
                              objectiveIds: l.objectiveIds.filter(
                                (id) => id !== ob.id,
                              ),
                              questions: l.questions.filter(
                                (q) => q.objectiveId !== ob.id,
                              ),
                            })),
                          })),
                        })
                      }
                    >
                      Remove objective
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className={button}
                  onClick={() =>
                    update({
                      objectives: [
                        ...draft.objectives,
                        {
                          id: makeId(),
                          title: "New objective",
                          evidence: "",
                          source: "",
                        },
                      ],
                    })
                  }
                >
                  Add objective
                </button>
              </section>
              {draft.modules.map((m, mi) => (
                <section key={m.id} className={`${card} space-y-4`}>
                  <Field
                    label={`Module ${mi + 1}`}
                    value={m.title}
                    onChange={(title) =>
                      update({
                        modules: draft.modules.map((mod) =>
                          mod.id === m.id ? { ...mod, title } : mod,
                        ),
                      })
                    }
                  />
                  <Field
                    label="Module description"
                    value={m.description}
                    onChange={(description) =>
                      update({
                        modules: draft.modules.map((mod) =>
                          mod.id === m.id ? { ...mod, description } : mod,
                        ),
                      })
                    }
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={button}
                      disabled={mi === 0}
                      onClick={() => {
                        const mods = [...draft.modules];
                        [mods[mi - 1], mods[mi]] = [mods[mi], mods[mi - 1]];
                        update({ modules: mods });
                      }}
                    >
                      Move module up
                    </button>
                    <button
                      type="button"
                      className={button}
                      onClick={() =>
                        update({
                          modules: draft.modules.filter(
                            (mod) => mod.id !== m.id,
                          ),
                        })
                      }
                    >
                      Remove module
                    </button>
                  </div>
                  {m.lessons.map((l, li) => (
                    <div
                      key={l.id}
                      className="space-y-3 rounded-xl border border-[var(--border-faint)] p-3"
                    >
                      <Field
                        label={`Lesson ${li + 1}`}
                        value={l.title}
                        onChange={(title) => updateLesson(mi, li, { title })}
                      />
                      <Field
                        label="Lesson text, examples and activities"
                        value={l.body}
                        onChange={(body) => updateLesson(mi, li, { body })}
                        multiline
                      />
                      <Field
                        label="Teacher-only lesson plan / marking notes (hidden from learners and tutor)"
                        value={l.teacherNotes || ""}
                        onChange={(teacherNotes) =>
                          updateLesson(mi, li, { teacherNotes })
                        }
                        multiline
                      />
                      <div className="flex flex-wrap gap-3">
                        {draft.objectives.map((o) => (
                          <label
                            key={o.id}
                            className="flex items-center gap-2 text-xs"
                          >
                            <input
                              type="checkbox"
                              checked={l.objectiveIds.includes(o.id)}
                              onChange={(e) =>
                                updateLesson(mi, li, {
                                  objectiveIds: e.target.checked
                                    ? [...l.objectiveIds, o.id]
                                    : l.objectiveIds.filter(
                                        (id) => id !== o.id,
                                      ),
                                })
                              }
                            />
                            {o.title}
                          </label>
                        ))}
                      </div>
                      <ResourceEditor
                        api={api}
                        courseId={ws.courseId}
                        resources={l.resources}
                        onAppend={(resource) =>
                          setDraft((d) => ({
                            ...d,
                            modules: d.modules.map((module) =>
                              module.id === m.id
                                ? {
                                    ...module,
                                    lessons: module.lessons.map((lesson) =>
                                      lesson.id === l.id
                                        ? {
                                            ...lesson,
                                            resources: [
                                              ...lesson.resources,
                                              resource,
                                            ],
                                          }
                                        : lesson,
                                    ),
                                  }
                                : module,
                            ),
                          }))
                        }
                        upload={config.uploadsEnabled}
                        maxMb={config.maxUploadMb}
                        onChange={(resources) =>
                          updateLesson(mi, li, { resources })
                        }
                        onError={setError}
                        onSource={
                          config.aiEnabled
                            ? (resourceId) =>
                                void run(async () => {
                                  const current = dirty ? await save() : ws;
                                  if (current)
                                    setJob(
                                      (
                                        await api.generateLearningContent(
                                          ws.courseId,
                                          current.revision,
                                          "source",
                                          crypto.randomUUID(),
                                          resourceId,
                                        )
                                      ).job,
                                    );
                                })
                            : undefined
                        }
                      />
                      <details>
                        <summary className="cursor-pointer py-2 text-sm font-semibold">
                          Practice questions ({l.questions.length})
                        </summary>
                        <div className="space-y-3">
                          {l.questions.map((q, qi) => (
                            <div key={q.id} className="space-y-2">
                              <Field
                                label="Question"
                                value={q.question}
                                onChange={(question) =>
                                  updateLesson(mi, li, {
                                    questions: l.questions.map((qq, i) =>
                                      i === qi ? { ...qq, question } : qq,
                                    ),
                                  })
                                }
                              />
                              <Field
                                label="Answer choices (one per line)"
                                value={q.options.join("\n")}
                                onChange={(value) =>
                                  updateLesson(mi, li, {
                                    questions: l.questions.map((qq, i) =>
                                      i === qi
                                        ? { ...qq, options: value.split("\n") }
                                        : qq,
                                    ),
                                  })
                                }
                                multiline
                              />
                              <label className="block text-xs">
                                Correct answer
                                <select
                                  className={field}
                                  value={q.correctIndex}
                                  onChange={(e) =>
                                    updateLesson(mi, li, {
                                      questions: l.questions.map((qq, i) =>
                                        i === qi
                                          ? {
                                              ...qq,
                                              correctIndex: Number(
                                                e.target.value,
                                              ),
                                            }
                                          : qq,
                                      ),
                                    })
                                  }
                                >
                                  {q.options.map((v, i) => (
                                    <option key={i} value={i}>
                                      {v || `Option ${i + 1}`}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="block text-xs">
                                Objective
                                <select
                                  className={field}
                                  value={q.objectiveId}
                                  onChange={(e) =>
                                    updateLesson(mi, li, {
                                      questions: l.questions.map((qq, i) =>
                                        i === qi
                                          ? {
                                              ...qq,
                                              objectiveId: e.target.value,
                                            }
                                          : qq,
                                      ),
                                    })
                                  }
                                >
                                  {draft.objectives.map((o) => (
                                    <option value={o.id} key={o.id}>
                                      {o.title}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <Field
                                label="Explanation (shown after answering)"
                                value={q.explanation}
                                onChange={(explanation) =>
                                  updateLesson(mi, li, {
                                    questions: l.questions.map((qq, i) =>
                                      i === qi ? { ...qq, explanation } : qq,
                                    ),
                                  })
                                }
                              />
                              <button
                                type="button"
                                className={button}
                                onClick={() =>
                                  updateLesson(mi, li, {
                                    questions: l.questions.filter(
                                      (qq) => qq.id !== q.id,
                                    ),
                                  })
                                }
                              >
                                Remove question
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            className={button}
                            disabled={!draft.objectives.length}
                            onClick={() =>
                              updateLesson(mi, li, {
                                questions: [
                                  ...l.questions,
                                  {
                                    id: makeId(),
                                    question: "New question",
                                    options: [
                                      "Answer A",
                                      "Answer B",
                                      "Answer C",
                                      "Answer D",
                                    ],
                                    correctIndex: 0,
                                    explanation: "",
                                    objectiveId: draft.objectives[0].id,
                                  },
                                ],
                              })
                            }
                          >
                            Add practice question
                          </button>
                        </div>
                      </details>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={button}
                          disabled={li === 0}
                          onClick={() => {
                            const lessons = [...m.lessons];
                            [lessons[li - 1], lessons[li]] = [
                              lessons[li],
                              lessons[li - 1],
                            ];
                            update({
                              modules: draft.modules.map((mm) =>
                                mm.id === m.id ? { ...mm, lessons } : mm,
                              ),
                            });
                          }}
                        >
                          Move lesson up
                        </button>
                        <button
                          type="button"
                          className={button}
                          onClick={() =>
                            update({
                              modules: draft.modules.map((mm) =>
                                mm.id === m.id
                                  ? {
                                      ...mm,
                                      lessons: mm.lessons.filter(
                                        (ll) => ll.id !== l.id,
                                      ),
                                    }
                                  : mm,
                              ),
                            })
                          }
                        >
                          Remove lesson
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    className={button}
                    disabled={m.lessons.length >= config.maxLessons}
                    onClick={() =>
                      update({
                        modules: draft.modules.map((mm) =>
                          mm.id === m.id
                            ? { ...mm, lessons: [...mm.lessons, newLesson()] }
                            : mm,
                        ),
                      })
                    }
                  >
                    Add lesson
                  </button>
                </section>
              ))}
              <button
                type="button"
                className={button}
                disabled={draft.modules.length >= config.maxModules}
                onClick={() =>
                  update({
                    modules: [
                      ...draft.modules,
                      {
                        id: makeId(),
                        title: "New module",
                        description: "",
                        lessons: [newLesson()],
                      },
                    ],
                  })
                }
              >
                Add module
              </button>
              {draft.kind === "path" && (
                <section className={`${card} space-y-3`}>
                  <h2 className="font-semibold">
                    Courses to explore along this path
                  </h2>
                  <p className="text-xs text-ink-500">
                    Referenced courses retain their own access and purchase
                    requirements.
                  </p>
                  {draft.references.map((ref, i) => (
                    <div key={i} className="space-y-2">
                      <Field
                        label="Course ID"
                        value={ref.courseId}
                        onChange={(courseId) =>
                          update({
                            references: draft.references.map((r, ri) =>
                              ri === i ? { ...r, courseId } : r,
                            ),
                          })
                        }
                      />
                      <Field
                        label="Course title"
                        value={ref.title}
                        onChange={(title) =>
                          update({
                            references: draft.references.map((r, ri) =>
                              ri === i ? { ...r, title } : r,
                            ),
                          })
                        }
                      />
                      <Field
                        label="Why study it here?"
                        value={ref.note}
                        onChange={(note) =>
                          update({
                            references: draft.references.map((r, ri) =>
                              ri === i ? { ...r, note } : r,
                            ),
                          })
                        }
                      />
                      <button
                        type="button"
                        className={button}
                        onClick={() =>
                          update({
                            references: draft.references.filter(
                              (_, ri) => ri !== i,
                            ),
                          })
                        }
                      >
                        Remove reference
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className={button}
                    onClick={() =>
                      update({
                        references: [
                          ...draft.references,
                          {
                            courseId: "course_id",
                            title: "Course title",
                            note: "",
                          },
                        ],
                      })
                    }
                  >
                    Reference a course
                  </button>
                </section>
              )}
              <section className={`${card} space-y-3`}>
                <h2 className="font-semibold">Publish and share</h2>
                <p className="text-xs text-ink-500">
                  Publishing saves a separate version. Existing learner
                  conversations remain private. Public publishing and sales
                  require creator eligibility; school/business permissions also
                  apply.
                </p>
                <label className="block text-xs">
                  Visibility
                  <select
                    className={field}
                    value={draft.visibility}
                    onChange={(e) =>
                      update({
                        visibility: e.target
                          .value as LearningDraft["visibility"],
                      })
                    }
                  >
                    <option value="private">Private draft</option>
                    <option value="invite">Invited learners</option>
                    <option value="unlisted">Unlisted link</option>
                    <option value="public">Public discovery</option>
                  </select>
                </label>
                <label className="block text-xs">
                  Price (UGX; 0 is free)
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={draft.priceUgx}
                    className={field}
                    onChange={(e) =>
                      update({ priceUgx: Number(e.target.value) })
                    }
                  />
                </label>
                <p className="text-xs text-ink-500">
                  A content purchase does not include unlimited AI tutoring.
                  Only publish material you have permission to distribute.
                </p>
                <button
                  type="button"
                  className={primary}
                  disabled={!config.publishingEnabled}
                  onClick={() =>
                    void run(async () => {
                      const current = dirty ? await save() : ws;
                      if (!current) return;
                      await api.publishLearningCourse(
                        ws.courseId,
                        current.revision,
                      );
                      await open(ws.courseId);
                      setNotice(
                        "Version published. You can now share its learning link.",
                      );
                    })
                  }
                >
                  Publish reviewed version
                </button>
              </section>
            </fieldset>
          )}
          {job && (
            <section className={`${card} space-y-3`} aria-live="polite">
              <h2 className="font-semibold">AI draft: {job.status}</h2>
              {job.error && <p>{job.error}</p>}
              {["queued", "running"].includes(job.status) && (
                <button
                  className={button}
                  onClick={() =>
                    void run(async () => {
                      await api.cancelLearningJob(job.id);
                      setJob({ ...job, status: "cancelled" });
                    })
                  }
                >
                  Cancel generation
                </button>
              )}
              {job.result && (
                <>
                  <p className="text-sm">
                    {job.result.objectives.length} objectives ·{" "}
                    {job.result.modules.length} modules. Applying this
                    suggestion replaces your current outline/content; inspect it
                    first.
                  </p>
                  <details>
                    <summary>Inspect generated suggestion</summary>
                    <div className="max-h-96 space-y-4 overflow-auto py-3 text-sm">
                      <h3 className="font-semibold">{job.result.title}</h3>
                      <p>{job.result.summary}</p>
                      {job.stage === "source" && (
                        <p className="whitespace-pre-wrap">
                          {job.result.sourceText}
                        </p>
                      )}
                      {job.result.objectives.map((o) => (
                        <div key={o.id}>
                          <p className="font-semibold">{o.title}</p>
                          <p>{o.evidence}</p>
                          <p className="text-xs text-ink-500">{o.source}</p>
                        </div>
                      ))}
                      {job.result.modules.map((m) => (
                        <section key={m.id} className="space-y-2">
                          <h3 className="font-semibold">{m.title}</h3>
                          {m.lessons.map((l) => (
                            <article key={l.id}>
                              <h4 className="font-medium">
                                {l.title} · {l.minutes} minutes
                              </h4>
                              <p className="whitespace-pre-wrap">
                                {l.body ||
                                  "Outline: content will be drafted next."}
                              </p>
                              <p className="text-xs text-ink-500">
                                {l.questions.length} practice questions ·{" "}
                                {l.resources.length} resources
                              </p>
                            </article>
                          ))}
                        </section>
                      ))}
                    </div>
                  </details>
                  <button
                    className={primary}
                    disabled={busy || ws.revision !== job.baseRevision || dirty}
                    onClick={() => {
                      if (job.result) {
                        setDraft(job.result);
                        setJob(null);
                        setNotice(
                          "Suggestion applied to your draft. Review before publishing.",
                        );
                      }
                    }}
                  >
                    Use this suggestion
                  </button>
                  {ws.revision !== job.baseRevision && (
                    <p className="text-xs">
                      The draft changed since this generation began. Start a new
                      generation to avoid overwriting your edits.
                    </p>
                  )}
                </>
              )}
            </section>
          )}
          <section className={`${card} space-y-3`}>
            <h2 className="font-semibold">Educator review</h2>
            <p className="text-xs text-ink-500">
              Reviews apply to an exact revision. Verification and permissions
              are managed by Admin; a teacher name alone is not an endorsement.
            </p>
            <Field
              label="Verified reviewer's Peebee account ID"
              value={reviewer}
              onChange={setReviewer}
            />
            <button
              className={button}
              disabled={busy || !reviewer}
              onClick={() =>
                void run(async () => {
                  await api.inviteLearningReviewer(ws.courseId, reviewer);
                  setNotice(
                    "Review invitation saved in the educator's review inbox.",
                  );
                })
              }
            >
              Invite review
            </button>
            <Field
              label="Review scope, findings and corrections"
              value={comments}
              onChange={setComments}
              multiline
            />
            <div className="flex flex-wrap gap-2">
              {(["approved", "changes_requested"] as const).map((status) => (
                <button
                  key={status}
                  className={button}
                  disabled={busy || dirty || !comments.trim()}
                  onClick={() =>
                    void run(async () => {
                      await api.submitLearningReview(
                        ws.courseId,
                        ws.revision,
                        status,
                        comments,
                      );
                      await open(ws.courseId);
                      setNotice("Review recorded for this revision.");
                    })
                  }
                >
                  {status === "approved"
                    ? "Approve this revision"
                    : "Request changes"}
                </button>
              ))}
            </div>
            {reviews.map((r) => (
              <p key={r.id} className="whitespace-pre-wrap text-sm">
                <strong>{r.reviewerName}</strong> · revision {r.revision} ·{" "}
                {r.status}
                <br />
                {r.comments}
              </p>
            ))}
          </section>
          {ws.publishedVersion && (
            <section className={`${card} space-y-3`}>
              <h2 className="font-semibold">Published learning link</h2>
              <a className="break-all text-sm text-gold underline" href={link}>
                {link}
              </a>
              <div className="flex flex-wrap gap-2">
                <button
                  className={button}
                  onClick={() =>
                    void run(async () => {
                      await navigator.clipboard.writeText(link);
                      setNotice("Learning link copied.");
                    })
                  }
                >
                  Copy link
                </button>
                {typeof navigator !== "undefined" &&
                  typeof navigator.share === "function" && (
                    <button
                      className={button}
                      onClick={() =>
                        void run(async () => {
                          await navigator.share({
                            title: draft.title,
                            url: link,
                          });
                        })
                      }
                    >
                      Share
                    </button>
                  )}
              </div>
              <InviteForm
                api={api}
                courseId={ws.courseId}
                link={link}
                onError={setError}
                onNotice={setNotice}
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}

function ResourceEditor({
  api,
  courseId,
  resources,
  onChange,
  onAppend,
  onError,
  upload,
  maxMb,
  onSource,
}: {
  api: Api;
  courseId: string;
  resources: LearningResource[];
  onChange: (r: LearningResource[]) => void;
  onAppend: (r: LearningResource) => void;
  onError: (s: string) => void;
  upload: boolean;
  maxMb: number;
  onSource?: (resourceId: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">
        Videos, images, GIFs and supporting resources
      </h3>
      {resources.map((r, i) => (
        <div
          key={r.id}
          className="space-y-2 border-t border-[var(--border-faint)] pt-3"
        >
          <Field
            label="Resource title"
            value={r.title}
            onChange={(title) =>
              onChange(
                resources.map((rr, ri) => (ri === i ? { ...rr, title } : rr)),
              )
            }
          />
          <Field
            label="Description / image alternative text"
            value={r.description}
            onChange={(description) =>
              onChange(
                resources.map((rr, ri) =>
                  ri === i ? { ...rr, description } : rr,
                ),
              )
            }
          />
          {!r.url.startsWith("resource:") && (
            <Field
              label="HTTPS resource link"
              value={r.url}
              onChange={(url) =>
                onChange(
                  resources.map((rr, ri) => (ri === i ? { ...rr, url } : rr)),
                )
              }
            />
          )}
          <label className="block text-xs">
            Resource type
            <select
              value={r.kind}
              className={field}
              onChange={(e) =>
                onChange(
                  resources.map((rr, ri) =>
                    ri === i
                      ? {
                          ...rr,
                          kind: e.target.value as LearningResource["kind"],
                        }
                      : rr,
                  ),
                )
              }
            >
              {[
                "video",
                "image",
                "gif",
                "pdf",
                "document",
                "audio",
                "link",
              ].map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </label>
          <Field
            label="Transcript or extracted notes for the tutor (include real source/page labels)"
            value={r.transcript}
            onChange={(transcript) =>
              onChange(
                resources.map((rr, ri) =>
                  ri === i ? { ...rr, transcript } : rr,
                ),
              )
            }
            multiline
          />
          {onSource && r.url.startsWith("resource:") && (
            <button
              type="button"
              className={button}
              onClick={() => onSource(r.url.slice(9))}
            >
              Extract source notes for review
            </button>
          )}
          <label className="flex gap-2 text-xs">
            <input
              type="checkbox"
              checked={r.tutorAllowed}
              onChange={(e) =>
                onChange(
                  resources.map((rr, ri) =>
                    ri === i ? { ...rr, tutorAllowed: e.target.checked } : rr,
                  ),
                )
              }
            />
            Allow the tutor to use these notes
          </label>
          <button
            type="button"
            className={button}
            onClick={() => onChange(resources.filter((rr) => rr.id !== r.id))}
          >
            Remove resource
          </button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={button}
          onClick={() =>
            onChange([
              ...resources,
              {
                id: makeId(),
                title: "Supporting resource",
                kind: "link",
                url: "",
                description: "",
                transcript: "",
                tutorAllowed: false,
              },
            ])
          }
        >
          Add a resource link
        </button>
        {upload && (
          <label className={`${button} cursor-pointer`}>
            {uploading ? "Uploading…" : `Upload material (up to ${maxMb} MB)`}
            <input
              className="sr-only"
              type="file"
              disabled={uploading}
              accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.doc,.docx,.pptx,video/mp4,video/webm,audio/*"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setUploading(true);
                try {
                  if (file.size > maxMb * 1024 * 1024)
                    throw new Error(
                      "The file is larger than the upload limit.",
                    );
                  const res = await api.uploadLearningResource(courseId, file);
                  onAppend(res.resource);
                } catch (err) {
                  onError(errorText(err));
                } finally {
                  setUploading(false);
                  e.target.value = "";
                }
              }}
            />
          </label>
        )}
      </div>
    </div>
  );
}
function InviteForm({
  api,
  courseId,
  link,
  onError,
  onNotice,
}: {
  api: Api;
  courseId: string;
  link: string;
  onError: (s: string) => void;
  onNotice: (s: string) => void;
}) {
  const [recipient, setRecipient] = useState(""),
    [cohortId, setCohortId] = useState(""),
    [cohorts, setCohorts] = useState<
      Awaited<ReturnType<Api["learningCohorts"]>>["cohorts"]
    >([]);
  useEffect(() => {
    let active = true;
    api
      .learningCohorts(courseId)
      .then((r) => active && setCohorts(r.cohorts))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api, courseId]);
  return (
    <div className="space-y-2">
      <Field
        label="Invite a learner by Peebee account ID (free courses)"
        value={recipient}
        onChange={setRecipient}
      />
      {cohorts.length > 0 && (
        <label className="block text-xs font-semibold">
          Intake for this invitation
          <select
            className={field}
            value={cohortId}
            onChange={(e) => setCohortId(e.target.value)}
          >
            <option value="">Choose a start date</option>
            {cohorts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} · {h.startsAt.slice(0, 10)}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        className={button}
        disabled={!recipient}
        onClick={async () => {
          try {
            const r = await api.createLearningInvite(
              courseId,
              recipient,
              cohortId || undefined,
            );
            const url = `${link}?invite=${encodeURIComponent(r.token)}`;
            await navigator.clipboard.writeText(url);
            onNotice(
              "Recipient-bound invitation copied. Send it to this learner; it does not expose your progress.",
            );
          } catch (e) {
            onError(errorText(e));
          }
        }}
      >
        Create and copy invitation
      </button>
    </div>
  );
}
