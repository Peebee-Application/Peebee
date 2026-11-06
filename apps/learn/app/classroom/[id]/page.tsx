"use client";

import { CUE_LABELS, CUE_TARGETS, type ConsoleCue, type ConsoleView, type CueKind, type CueTarget, type StudioLesson } from "@peebee/shared";
import { Eye, Hand, Monitor, Pause, Play, Plus, Smartphone, Square, Trash2, Users } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { Button, Chip, Crumbs, Field, Notice, Segmented, Skeleton, cardCls, controlCls } from "../../../components/ui";
import { ProUpgrade } from "../../../components/ProNotice";
import { api, errorMessage } from "../../../lib/api";
import { useTvAccess } from "../../../lib/pro";

const TARGET_LABEL: Record<CueTarget, string> = { screen: "TV", phones: "Phones", both: "TV + phones" };

function cueSummary(cue: ConsoleCue, lessonTitle?: string): string {
  const p = cue.payload;
  switch (cue.kind) {
    case "slide":
      return String(p.title ?? "");
    case "lesson":
      return lessonTitle ?? cue.lessonTitle ?? "Lesson";
    case "announcement":
      return String(p.text ?? "");
    case "timer":
      return `${p.label || "Timer"} · ${Math.round(Number(p.seconds ?? 0) / 60 * 10) / 10} min`;
    case "question":
      return String(p.question ?? "");
    case "exam":
      return `${p.title ?? "Exam"} · ${(p.questions as unknown[] | undefined)?.length ?? 0} questions · ${p.minutes} min`;
    case "attendance":
      return "Take attendance";
  }
}

export default function ClassroomConsolePage() {
  const { id } = useParams<{ id: string }>();
  const [view, setView] = useState<ConsoleView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lessons, setLessons] = useState<StudioLesson[]>([]);
  const [picks, setPicks] = useState<Record<string, CueTarget>>({});
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const { status: pro, allowed: tvAllowed } = useTvAccess();

  const load = useCallback(async () => {
    try {
      const res = await api.classroomConsole(id);
      setView(res);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 2500);
    return () => clearInterval(timer);
  }, [load]);

  const courseId = view?.session.courseId ?? null;
  useEffect(() => {
    if (!courseId) return;
    api
      .studioCourse(courseId)
      .then((r) => setLessons(r.course.modules.flatMap((m) => m.lessons)))
      .catch(() => setLessons([]));
  }, [courseId]);

  const lessonTitles = useMemo(() => new Map(lessons.map((l) => [l.id, l.title])), [lessons]);

  async function act(key: string, fn: () => Promise<unknown>) {
    setPending(key);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(null);
    }
  }

  if (!view) return error ? <Notice tone="error">{error}</Notice> : <Skeleton className="h-64" />;

  const { session, screen, cues, members } = view;
  const live = session.status === "live";
  const presentCount = members.filter((m) => m.present).length;
  const hands = members.filter((m) => m.handRaised);
  const leaders = [...members].sort((a, b) => b.points - a.points).slice(0, 10);

  return (
    <div className="space-y-5 pb-8">
      <Crumbs items={[{ label: "Live classroom", href: "/classroom" }, { label: session.title }]} />

      <header className={`${cardCls} flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5`}>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate font-display text-xl font-semibold text-ink">{session.title}</h2>
            <Chip tone={live ? "green" : "muted"}>{live ? "Live" : "Ended"}</Chip>
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-base text-ink-500">
            <Monitor className="h-3.5 w-3.5" aria-hidden />
            {screen ? `${screen.name} · ${screen.online ? "online" : "offline"}` : "Phones only (no TV)"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold uppercase tracking-wider text-ink-500">Students join with</p>
          <p className="font-mono text-3xl font-bold tracking-[0.2em] text-ink" aria-label={`Join code ${session.code.split("").join(" ")}`}>
            {session.code}
          </p>
          <p className="max-w-[16rem] truncate text-sm text-ink-500">{session.joinUrl}</p>
        </div>
      </header>

      {error && <Notice tone="error">{error}</Notice>}
      {pro && screen && <ProUpgrade status={pro} />}

      {live && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={!screen} onClick={() => act("clear-screen", () => api.classroomClear(id, "screen"))}>
            <Monitor className="h-4 w-4" aria-hidden /> Clear TV
          </Button>
          <Button variant="secondary" onClick={() => act("clear-phones", () => api.classroomClear(id, "phones"))}>
            <Smartphone className="h-4 w-4" aria-hidden /> Clear phones
          </Button>
          <Button
            variant="secondary"
            disabled={!screen}
            onClick={() => act("playback", () => api.classroomPlayback(id, !session.playback.playing))}
          >
            {session.playback.playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
            {session.playback.playing ? "Pause video" : "Play video"}
          </Button>
          <Button
            variant="danger"
            className="ml-auto"
            onClick={() => {
              if (window.confirm("End this class? Students and the TV will be disconnected.")) void act("end", () => api.classroomEnd(id));
            }}
          >
            <Square className="h-4 w-4" aria-hidden /> End class
          </Button>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-labelledby="runsheet-h" className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 id="runsheet-h" className="text-lg font-semibold text-ink">
              Run sheet
            </h3>
            {live && !adding && (
              <Button variant="secondary" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" aria-hidden /> Add item
              </Button>
            )}
          </div>

          {adding && (
            <AddCue
              lessons={lessons}
              onCancel={() => setAdding(false)}
              onAdd={async (kind, payload) => {
                await api.classroomAddCue(id, { kind, payload });
                setAdding(false);
                await load();
              }}
            />
          )}

          {cues.length === 0 ? (
            <p className={`${cardCls} p-5 text-lg text-ink-500`}>Nothing here yet. Add slides, questions, a timer or an exam, then push each one to the TV, the phones or both.</p>
          ) : (
            <ol className="space-y-2">
              {cues.map((cue) => {
                const targets = CUE_TARGETS[cue.kind];
                const target = picks[cue.id] && targets.includes(picks[cue.id]!) ? picks[cue.id]! : cue.target;
                const isQuiz = (cue.kind === "question" && cue.payload.correctIndex != null) || cue.kind === "exam";
                const active = cue.status === "active";
                return (
                  <li key={cue.id} className={`${cardCls} space-y-3 p-4 ${active ? "border-gold" : ""}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Chip tone="gold">{CUE_LABELS[cue.kind]}</Chip>
                          {cue.onScreen && <Chip tone="green">On TV</Chip>}
                          {cue.onPhones && <Chip tone="green">On phones</Chip>}
                          {cue.status === "closed" && <Chip>Done</Chip>}
                        </div>
                        <p className="mt-1.5 text-lg font-semibold text-ink">{cueSummary(cue, lessonTitles.get(String(cue.payload.lessonId ?? "")))}</p>
                      </div>
                      {cue.kind !== "attendance" && (cue.status !== "queued" || cue.responses > 0) && (
                        <span className="shrink-0 text-base text-ink-500">{cue.responses} answered</span>
                      )}
                    </div>

                    {cue.counts && cue.counts.length > 0 && cue.kind === "question" && (
                      <ul className="space-y-1" aria-label="Live results">
                        {(cue.payload.options as string[]).map((opt, i) => {
                          const total = cue.counts!.reduce((a, b) => a + b, 0) || 1;
                          const pct = Math.round(((cue.counts![i] ?? 0) / total) * 100);
                          return (
                            <li key={i} className="text-base text-ink">
                              <div className="flex justify-between">
                                <span className="truncate">
                                  {opt}
                                  {cue.payload.correctIndex === i ? " ✓" : ""}
                                </span>
                                <span className="text-ink-500">{cue.counts![i] ?? 0}</span>
                              </div>
                              <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-[rgb(var(--surface-muted))]">
                                <div className="h-full bg-gold" style={{ width: `${pct}%` }} />
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    {live && (
                      <div className="flex flex-wrap items-center gap-2">
                        {targets.length > 1 && (
                          <div className="w-48">
                            <Segmented
                              label={`Where to show ${CUE_LABELS[cue.kind]}`}
                              value={target}
                              onChange={(v) => setPicks((p) => ({ ...p, [cue.id]: v }))}
                              options={targets.map((t) => ({ id: t, label: TARGET_LABEL[t], disabled: t !== "phones" && (!screen || !tvAllowed) }))}
                            />
                          </div>
                        )}
                        <Button disabled={pending === cue.id} onClick={() => act(cue.id, () => api.classroomPush(cue.id, target))}>
                          {active ? "Push again" : "Push"}
                        </Button>
                        {isQuiz && cue.status !== "queued" && !cue.revealed && (
                          <Button variant="secondary" onClick={() => act(cue.id, () => api.classroomReveal(cue.id))}>
                            <Eye className="h-4 w-4" aria-hidden /> Reveal answer
                          </Button>
                        )}
                        {active && (
                          <Button variant="secondary" onClick={() => act(cue.id, () => api.classroomCloseCue(cue.id))}>
                            Close
                          </Button>
                        )}
                        {!active && (
                          <button
                            type="button"
                            aria-label="Remove item"
                            onClick={() => act(cue.id, () => api.classroomDeleteCue(cue.id))}
                            className="ml-auto rounded-lg p-2 text-ink-500 hover:bg-[rgb(var(--surface-muted))] hover:text-red-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <aside aria-labelledby="class-h" className="space-y-3">
          <h3 id="class-h" className="flex items-center gap-1.5 text-lg font-semibold text-ink">
            <Users className="h-4 w-4" aria-hidden /> In the room · {presentCount}/{members.length}
          </h3>
          {hands.length > 0 && (
            <ul className={`${cardCls} divide-y divide-[var(--border-faint)]`} aria-label="Raised hands">
              {hands.map((m) => (
                <li key={m.userId} className="flex items-center justify-between gap-2 px-3 py-2 text-lg">
                  <span className="flex min-w-0 items-center gap-1.5 text-ink">
                    <Hand className="h-4 w-4 shrink-0 text-gold" aria-hidden />
                    <span className="truncate">{m.name}</span>
                  </span>
                  <Button variant="secondary" className="!min-h-8 !px-3 !py-1 text-base" onClick={() => act(m.userId, () => api.classroomLowerHand(id, m.userId))}>
                    Done
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {members.length === 0 ? (
            <p className={`${cardCls} p-4 text-lg text-ink-500`}>No one has joined yet. Share the code above.</p>
          ) : (
            <ul className={`${cardCls} divide-y divide-[var(--border-faint)]`}>
              {leaders.map((m) => (
                <li key={m.userId} className="flex items-center justify-between gap-2 px-3 py-2 text-lg">
                  <span className="flex min-w-0 items-center gap-2 text-ink">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${m.present ? "bg-green" : "bg-ink-500/40"}`} aria-label={m.present ? "Present" : "Not marked present"} />
                    <span className="truncate">{m.name}</span>
                  </span>
                  <span className="shrink-0 text-base font-semibold text-ink-500">{m.points} pts</span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}

function AddCue({ lessons, onAdd, onCancel }: { lessons: StudioLesson[]; onAdd: (kind: CueKind, payload: Record<string, unknown>) => Promise<void>; onCancel: () => void }) {
  const uid = useId();
  const [kind, setKind] = useState<CueKind>("question");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [lessonId, setLessonId] = useState("");
  const [textValue, setTextValue] = useState("");
  const [seconds, setSeconds] = useState(60);
  const [label, setLabel] = useState("");
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [correct, setCorrect] = useState<number | null>(0);
  const [explanation, setExplanation] = useState("");
  const [minutes, setMinutes] = useState(20);
  const [examQs, setExamQs] = useState([{ question: "", options: ["", ""], correctIndex: 0 }]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let payload: Record<string, unknown> = {};
      if (kind === "slide") payload = { title, body, ...(imageUrl ? { imageUrl } : {}) };
      if (kind === "lesson") payload = { lessonId };
      if (kind === "announcement") payload = { text: textValue };
      if (kind === "timer") payload = { seconds, label };
      if (kind === "question") payload = { question, options: options.filter((o) => o.trim()), correctIndex: correct, explanation };
      if (kind === "exam") payload = { title, minutes, questions: examQs.map((q) => ({ ...q, options: q.options.filter((o) => o.trim()) })) };
      await onAdd(kind, payload);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const kinds = (Object.keys(CUE_LABELS) as CueKind[]).filter((k) => k !== "lesson" || lessons.length > 0);

  return (
    <form onSubmit={submit} className={`${cardCls} space-y-3 p-4`}>
      <Field label="Type of item" htmlFor={`${uid}-kind`}>
        <select id={`${uid}-kind`} value={kind} onChange={(e) => setKind(e.target.value as CueKind)} className={controlCls}>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {CUE_LABELS[k]}
            </option>
          ))}
        </select>
      </Field>

      {(kind === "slide" || kind === "exam") && (
        <Field label="Title" htmlFor={`${uid}-title`}>
          <input id={`${uid}-title`} required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} className={controlCls} />
        </Field>
      )}
      {kind === "slide" && (
        <>
          <Field label="Text on the slide" htmlFor={`${uid}-body`}>
            <textarea id={`${uid}-body`} rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} className={controlCls} />
          </Field>
          <Field label="Picture link (optional)" htmlFor={`${uid}-img`} hint="A full https:// link">
            <input id={`${uid}-img`} type="url" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} className={controlCls} />
          </Field>
        </>
      )}
      {kind === "lesson" && (
        <Field label="Lesson" htmlFor={`${uid}-lesson`} hint="Plays the lesson's video or audio on the TV or on students' phones">
          <select id={`${uid}-lesson`} required value={lessonId} onChange={(e) => setLessonId(e.target.value)} className={controlCls}>
            <option value="">Choose a lesson</option>
            {lessons.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
              </option>
            ))}
          </select>
        </Field>
      )}
      {kind === "announcement" && (
        <Field label="Message" htmlFor={`${uid}-text`}>
          <input id={`${uid}-text`} required maxLength={300} value={textValue} onChange={(e) => setTextValue(e.target.value)} className={controlCls} />
        </Field>
      )}
      {kind === "timer" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Seconds" htmlFor={`${uid}-sec`}>
            <input id={`${uid}-sec`} type="number" min={5} max={3600} step={1} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} className={controlCls} />
          </Field>
          <Field label="Label (optional)" htmlFor={`${uid}-label`}>
            <input id={`${uid}-label`} maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} className={controlCls} />
          </Field>
        </div>
      )}
      {kind === "question" && (
        <>
          <Field label="Question" htmlFor={`${uid}-q`}>
            <input id={`${uid}-q`} required maxLength={300} value={question} onChange={(e) => setQuestion(e.target.value)} className={controlCls} />
          </Field>
          <OptionsEditor uid={uid} options={options} setOptions={setOptions} correct={correct} setCorrect={setCorrect} allowPoll />
          <Field label="Explanation (optional)" htmlFor={`${uid}-exp`}>
            <input id={`${uid}-exp`} maxLength={500} value={explanation} onChange={(e) => setExplanation(e.target.value)} className={controlCls} />
          </Field>
        </>
      )}
      {kind === "exam" && (
        <>
          <Field label="Minutes allowed" htmlFor={`${uid}-min`}>
            <input id={`${uid}-min`} type="number" min={1} step={1} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className={controlCls} />
          </Field>
          {examQs.map((q, qi) => (
            <fieldset key={qi} className="space-y-2 rounded-xl border border-[var(--border-faint)] p-3">
              <legend className="px-1 text-base font-semibold text-ink-500">Question {qi + 1}</legend>
              <input
                aria-label={`Question ${qi + 1}`}
                required
                maxLength={300}
                value={q.question}
                onChange={(e) => setExamQs((all) => all.map((x, i) => (i === qi ? { ...x, question: e.target.value } : x)))}
                className={controlCls}
              />
              <OptionsEditor
                uid={`${uid}-e${qi}`}
                options={q.options}
                setOptions={(o) => setExamQs((all) => all.map((x, i) => (i === qi ? { ...x, options: typeof o === "function" ? o(x.options) : o } : x)))}
                correct={q.correctIndex}
                setCorrect={(c) => setExamQs((all) => all.map((x, i) => (i === qi ? { ...x, correctIndex: c ?? 0 } : x)))}
              />
            </fieldset>
          ))}
          <Button variant="secondary" onClick={() => setExamQs((all) => [...all, { question: "", options: ["", ""], correctIndex: 0 }])}>
            <Plus className="h-4 w-4" aria-hidden /> Add question
          </Button>
        </>
      )}
      {kind === "attendance" && <p className="text-lg text-ink-500">Students tap “I&apos;m here” on their phones and are marked present.</p>}

      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Adding…" : "Add to run sheet"}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function OptionsEditor({
  uid,
  options,
  setOptions,
  correct,
  setCorrect,
  allowPoll = false,
}: {
  uid: string;
  options: string[];
  setOptions: (o: string[] | ((prev: string[]) => string[])) => void;
  correct: number | null;
  setCorrect: (c: number | null) => void;
  allowPoll?: boolean;
}) {
  return (
    <div className="space-y-2">
      <p className="text-base font-semibold text-ink-500">Options (tick the right one{allowPoll ? ", or none for a poll" : ""})</p>
      {options.map((opt, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="radio"
            name={`${uid}-correct`}
            checked={correct === i}
            onChange={() => setCorrect(i)}
            onClick={() => allowPoll && correct === i && setCorrect(null)}
            aria-label={`Option ${i + 1} is correct`}
            className="h-4 w-4 accent-[rgb(var(--color-gold))]"
          />
          <input
            aria-label={`Option ${i + 1}`}
            maxLength={200}
            value={opt}
            onChange={(e) => setOptions((all) => all.map((x, j) => (j === i ? e.target.value : x)))}
            className={controlCls}
          />
        </div>
      ))}
      {options.length < 6 && (
        <Button variant="secondary" onClick={() => setOptions((all) => [...all, ""])}>
          Add option
        </Button>
      )}
    </div>
  );
}
