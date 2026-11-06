"use client";

import {
  LESSON_CONTENT_TYPES,
  QUESTION_TYPE_LABELS,
  isAssessment,
  type LearnSettings,
  type LessonContentType,
  type QuestionType,
  type StudioAssignment,
  type StudioLesson,
  type StudioLive,
  type StudioQuiz,
  type StudioQuizQuestion,
  type StudioSlide,
} from "@peebee/shared";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Button, Field, Notice, cardCls, controlCls } from "../ui";

export type ItemInput = {
  title: string;
  contentType: LessonContentType;
  durationMinutes: number;
  summary: string;
  contentUrl: string;
  body: string;
  slides: StudioSlide[];
  live: StudioLive | null;
  assignment: StudioAssignment | null;
  quiz: StudioQuiz | null;
};

// ---------------------------------------------------------------------------
// Questions: every type is edited in one draft shape and converted on save
// ---------------------------------------------------------------------------

type Draft = {
  id?: string;
  type: QuestionType;
  question: string;
  points: string;
  explanation: string;
  options: string[];
  correct: number;
  multi: number[];
  bool: boolean;
  accepted: string;
  pairs: { left: string; right: string }[];
};

const blank = (type: QuestionType = "single"): Draft => ({
  type,
  question: "",
  points: "1",
  explanation: "",
  options: type === "ordering" ? ["", "", ""] : ["", ""],
  correct: 0,
  multi: [],
  bool: true,
  accepted: "",
  pairs: [{ left: "", right: "" }, { left: "", right: "" }],
});

function fromQuestion(q: StudioQuizQuestion): Draft {
  const type = q.type ?? "single";
  const base = blank(type);
  return {
    ...base,
    id: q.id,
    question: q.question,
    points: String(q.points ?? 1),
    explanation: q.explanation ?? "",
    options: q.options ?? base.options,
    correct: q.correctIndex ?? 0,
    multi: q.correctIndexes ?? [],
    bool: q.answerBool ?? true,
    accepted: (q.accepted ?? []).join("\n"),
    pairs: q.pairs ?? base.pairs,
  };
}

/** Returns the question to save, or the reason it can't be saved yet. */
function toQuestion(d: Draft, n: number): StudioQuizQuestion | string {
  const text = d.question.trim();
  if (!text) return `Question ${n} needs its text.`;
  const points = Number(d.points);
  const base = { ...(d.id ? { id: d.id } : {}), type: d.type, question: text, points: Number.isInteger(points) && points >= 1 ? points : 1, ...(d.explanation.trim() ? { explanation: d.explanation.trim() } : {}) };
  const options = d.options.map((o) => o.trim());
  switch (d.type) {
    case "single":
      if (options.some((o) => !o)) return `Question ${n} has an empty choice. Fill it in or remove it.`;
      return { ...base, options, correctIndex: d.correct };
    case "multiple":
      if (options.some((o) => !o)) return `Question ${n} has an empty choice. Fill it in or remove it.`;
      if (d.multi.length === 0) return `Question ${n}: tick every correct choice.`;
      return { ...base, options, correctIndexes: d.multi };
    case "true_false":
      return { ...base, answerBool: d.bool };
    case "fill_blank":
    case "short_answer": {
      const accepted = d.accepted.split("\n").map((a) => a.trim()).filter(Boolean);
      if (!accepted.length) return `Question ${n} needs at least one accepted answer.`;
      return { ...base, accepted };
    }
    case "ordering":
      if (options.some((o) => !o)) return `Question ${n} has an empty item. Fill it in or remove it.`;
      return { ...base, options };
    case "matching": {
      const pairs = d.pairs.map((p) => ({ left: p.left.trim(), right: p.right.trim() }));
      if (pairs.some((p) => !p.left || !p.right)) return `Question ${n} has an incomplete pair.`;
      return { ...base, pairs };
    }
  }
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-2">{children}</div>;
}

const iconBtn = "shrink-0 rounded-lg p-1.5 text-ink-500 hover:bg-[rgb(var(--surface-muted))] hover:text-ink disabled:opacity-30";

function QuestionEditor({ id, n, d, onChange, onRemove, canRemove }: { id: string; n: number; d: Draft; onChange: (p: Partial<Draft>) => void; onRemove: () => void; canRemove: boolean }) {
  const setOption = (i: number, v: string) => onChange({ options: d.options.map((x, xi) => (xi === i ? v : x)) });
  const addOption = () => onChange({ options: [...d.options, ""] });
  const removeOption = (i: number) =>
    onChange({
      options: d.options.filter((_, xi) => xi !== i),
      correct: d.correct === i ? 0 : d.correct > i ? d.correct - 1 : d.correct,
      multi: d.multi.filter((m) => m !== i).map((m) => (m > i ? m - 1 : m)),
    });
  const moveOption = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= d.options.length) return;
    const next = [...d.options];
    [next[i], next[j]] = [next[j], next[i]];
    onChange({ options: next });
  };

  return (
    <fieldset className="space-y-2.5 rounded-xl border border-[var(--border-faint)] p-3">
      <legend className="px-1 text-base font-semibold text-gold">Question {n}</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Type" htmlFor={`${id}-t`} className="sm:col-span-2">
          <select id={`${id}-t`} value={d.type} onChange={(e) => onChange({ ...blank(e.target.value as QuestionType), id: d.id, question: d.question, explanation: d.explanation, points: d.points })} className={controlCls}>
            {QUESTION_TYPE_LABELS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Points" htmlFor={`${id}-p`}>
          <input id={`${id}-p`} type="number" min={1} max={100} inputMode="numeric" value={d.points} onChange={(e) => onChange({ points: e.target.value })} className={controlCls} />
        </Field>
      </div>
      <Field label={d.type === "fill_blank" ? "Question (use ___ for the blank)" : "Question"} htmlFor={`${id}-q`}>
        <input id={`${id}-q`} maxLength={500} value={d.question} onChange={(e) => onChange({ question: e.target.value })} className={controlCls} />
      </Field>

      {(d.type === "single" || d.type === "multiple") && (
        <>
          <p className="text-sm text-ink-500">{d.type === "single" ? "Choose the circle next to the correct answer." : "Tick every correct answer."}</p>
          {d.options.map((o, i) => (
            <Row key={i}>
              {d.type === "single" ? (
                <input type="radio" name={`${id}-correct`} aria-label={`Choice ${i + 1} is correct`} checked={d.correct === i} onChange={() => onChange({ correct: i })} className="h-4 w-4 shrink-0 accent-[rgb(var(--color-gold))]" />
              ) : (
                <input type="checkbox" aria-label={`Choice ${i + 1} is correct`} checked={d.multi.includes(i)} onChange={(e) => onChange({ multi: e.target.checked ? [...d.multi, i] : d.multi.filter((m) => m !== i) })} className="h-4 w-4 shrink-0 accent-[rgb(var(--color-gold))]" />
              )}
              <input aria-label={`Choice ${i + 1}`} maxLength={200} value={o} onChange={(e) => setOption(i, e.target.value)} className={controlCls} placeholder={`Choice ${i + 1}`} />
              {d.options.length > 2 && (
                <button type="button" aria-label={`Remove choice ${i + 1}`} onClick={() => removeOption(i)} className={iconBtn}>
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </Row>
          ))}
          {d.options.length < 8 && (
            <Button variant="secondary" className="!min-h-8 !px-3 !text-base" onClick={addOption}>
              <Plus className="h-3.5 w-3.5" /> Add choice
            </Button>
          )}
        </>
      )}

      {d.type === "true_false" && (
        <div className="flex gap-4 text-lg text-ink">
          {[true, false].map((b) => (
            <label key={String(b)} className="flex items-center gap-2">
              <input type="radio" name={`${id}-tf`} checked={d.bool === b} onChange={() => onChange({ bool: b })} className="h-4 w-4 accent-[rgb(var(--color-gold))]" />
              The statement is {b ? "true" : "false"}
            </label>
          ))}
        </div>
      )}

      {(d.type === "fill_blank" || d.type === "short_answer") && (
        <Field label="Accepted answers (one per line)" htmlFor={`${id}-a`} hint="Capital letters and extra spaces are ignored when marking.">
          <textarea id={`${id}-a`} rows={2} maxLength={1000} value={d.accepted} onChange={(e) => onChange({ accepted: e.target.value })} className={controlCls} />
        </Field>
      )}

      {d.type === "ordering" && (
        <>
          <p className="text-sm text-ink-500">Write the items in the correct order. Learners see them shuffled.</p>
          {d.options.map((o, i) => (
            <Row key={i}>
              <span className="w-5 shrink-0 text-center text-base font-bold text-gold">{i + 1}</span>
              <input aria-label={`Item ${i + 1}`} maxLength={200} value={o} onChange={(e) => setOption(i, e.target.value)} className={controlCls} placeholder={`Item ${i + 1}`} />
              <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => moveOption(i, -1)} className={iconBtn}><ArrowUp className="h-4 w-4" /></button>
              <button type="button" aria-label="Move down" disabled={i === d.options.length - 1} onClick={() => moveOption(i, 1)} className={iconBtn}><ArrowDown className="h-4 w-4" /></button>
              {d.options.length > 2 && (
                <button type="button" aria-label={`Remove item ${i + 1}`} onClick={() => removeOption(i)} className={iconBtn}><Trash2 className="h-4 w-4" /></button>
              )}
            </Row>
          ))}
          {d.options.length < 8 && (
            <Button variant="secondary" className="!min-h-8 !px-3 !text-base" onClick={addOption}>
              <Plus className="h-3.5 w-3.5" /> Add item
            </Button>
          )}
        </>
      )}

      {d.type === "matching" && (
        <>
          <p className="text-sm text-ink-500">Write each item with its partner. Learners see the partners shuffled.</p>
          {d.pairs.map((p, i) => (
            <Row key={i}>
              <input aria-label={`Item ${i + 1}`} maxLength={200} value={p.left} onChange={(e) => onChange({ pairs: d.pairs.map((x, xi) => (xi === i ? { ...x, left: e.target.value } : x)) })} className={controlCls} placeholder="Item" />
              <span aria-hidden className="text-ink-500">↔</span>
              <input aria-label={`Partner ${i + 1}`} maxLength={200} value={p.right} onChange={(e) => onChange({ pairs: d.pairs.map((x, xi) => (xi === i ? { ...x, right: e.target.value } : x)) })} className={controlCls} placeholder="Partner" />
              {d.pairs.length > 2 && (
                <button type="button" aria-label={`Remove pair ${i + 1}`} onClick={() => onChange({ pairs: d.pairs.filter((_, xi) => xi !== i) })} className={iconBtn}><Trash2 className="h-4 w-4" /></button>
              )}
            </Row>
          ))}
          {d.pairs.length < 8 && (
            <Button variant="secondary" className="!min-h-8 !px-3 !text-base" onClick={() => onChange({ pairs: [...d.pairs, { left: "", right: "" }] })}>
              <Plus className="h-3.5 w-3.5" /> Add pair
            </Button>
          )}
        </>
      )}

      <Field label="Why is it correct? (optional)" htmlFor={`${id}-e`}>
        <input id={`${id}-e`} maxLength={500} value={d.explanation} onChange={(e) => onChange({ explanation: e.target.value })} className={controlCls} />
      </Field>
      {canRemove && (
        <Button variant="danger" className="!min-h-8 !px-3 !text-base" onClick={onRemove}>
          Remove question
        </Button>
      )}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

const localInput = (iso: string | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** One item in a section: text, slides, audio, video, live video, quiz or exam. The type is chosen when it is created. */
export function ItemForm({
  settings,
  kind,
  initial,
  title,
  submitLabel,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  settings: LearnSettings;
  kind: LessonContentType;
  initial?: StudioLesson;
  title: string;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: (input: ItemInput) => void;
  onCancel?: () => void;
}) {
  const id = useId();
  const contentType = initial?.contentType ?? kind;
  const assessment = isAssessment(contentType);
  const typeLabel = LESSON_CONTENT_TYPES.find((t) => t.id === contentType)?.label ?? "Item";

  const [itemTitle, setItemTitle] = useState(initial?.title ?? "");
  const [minutes, setMinutes] = useState(String(initial?.durationMinutes ?? (assessment ? 10 : contentType === "live" ? 45 : 15)));
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [contentUrl, setContentUrl] = useState(initial?.contentUrl ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [slides, setSlides] = useState<StudioSlide[]>(initial?.slides?.length ? initial.slides : [{ title: "", body: "", imageUrl: "" }]);
  const [startsAt, setStartsAt] = useState(localInput(initial?.live?.startsAt));
  const [liveUrl, setLiveUrl] = useState(initial?.live?.url ?? "");
  const [liveNotes, setLiveNotes] = useState(initial?.live?.notes ?? "");
  const [quizTitle, setQuizTitle] = useState(initial?.quiz?.title ?? "");
  const [passing, setPassing] = useState(String(initial?.quiz?.passingScorePercent ?? (contentType === "exam" ? settings.examPassPercent : 60)));
  const [questions, setQuestions] = useState<Draft[]>(initial?.quiz?.questions.length ? initial.quiz.questions.map(fromQuestion) : [blank()]);
  const q = initial?.quiz?.settings ?? {};
  const [timeLimit, setTimeLimit] = useState(String(q.timeLimitMinutes ?? (contentType === "exam" ? 30 : 0)));
  const [attempts, setAttempts] = useState(String(q.maxAttempts ?? 0));
  const [shuffleQ, setShuffleQ] = useState(q.shuffleQuestions ?? false);
  const [shuffleO, setShuffleO] = useState(q.shuffleOptions ?? false);
  const [draw, setDraw] = useState(String(q.questionsPerAttempt ?? 0));
  const [maxPoints, setMaxPoints] = useState(String(initial?.assignment?.maxPoints ?? 100));
  const [passPercent, setPassPercent] = useState(String(initial?.assignment?.passPercent ?? 50));
  const [dueAt, setDueAt] = useState(localInput(initial?.assignment?.dueAt ?? undefined));
  const [allowResubmit, setAllowResubmit] = useState(initial?.assignment?.allowResubmit ?? true);
  const [localError, setLocalError] = useState<string | null>(null);

  const patchQuestion = (i: number, p: Partial<Draft>) => setQuestions((prev) => prev.map((x, xi) => (xi === i ? { ...x, ...p } : x)));
  const patchSlide = (i: number, p: Partial<StudioSlide>) => setSlides((prev) => prev.map((x, xi) => (xi === i ? { ...x, ...p } : x)));
  const moveSlide = (i: number, by: number) =>
    setSlides((prev) => {
      const j = i + by;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (itemTitle.trim().length < 2) return setLocalError("Give it a title of at least 2 characters.");
    const duration = Number(minutes);
    if (!Number.isInteger(duration) || duration < 1) return setLocalError("Length must be a whole number of minutes.");
    if (duration > settings.maxLessonMinutes) return setLocalError(`An item can run up to ${settings.maxLessonMinutes} minutes.`);
    const url = contentUrl.trim();
    if (url && !/^https:\/\//i.test(url)) return setLocalError("Links must start with https://");

    let cleanSlides: StudioSlide[] = [];
    if (contentType === "slides") {
      cleanSlides = slides.map((s) => ({ title: s.title.trim(), body: s.body.trim(), imageUrl: s.imageUrl.trim() })).filter((s) => s.title || s.body || s.imageUrl);
      if (cleanSlides.length === 0) return setLocalError("Add at least one slide.");
      if (cleanSlides.length > settings.maxSlidesPerLesson) return setLocalError(`A slide lesson can have up to ${settings.maxSlidesPerLesson} slides.`);
      for (const [i, s] of cleanSlides.entries()) {
        if (!s.title) return setLocalError(`Slide ${i + 1} needs a title.`);
        if (s.imageUrl && !/^https:\/\//i.test(s.imageUrl)) return setLocalError(`Slide ${i + 1}: the picture link must start with https://`);
      }
    }
    if (contentType === "text" && body.length > settings.maxLessonBodyChars) return setLocalError(`A text lesson can have up to ${settings.maxLessonBodyChars.toLocaleString("en-UG")} characters.`);

    let live: StudioLive | null = null;
    if (contentType === "live") {
      if (!startsAt) return setLocalError("Choose when the live lesson starts.");
      if (duration < 5) return setLocalError("A live lesson runs at least 5 minutes.");
      if (!/^https:\/\//i.test(liveUrl.trim())) return setLocalError("Add the meeting link, starting with https://");
      live = { startsAt: new Date(startsAt).toISOString(), durationMinutes: duration, url: liveUrl.trim(), notes: liveNotes.trim() };
    }

    let assignment: StudioAssignment | null = null;
    if (contentType === "assignment") {
      const points = Number(maxPoints);
      const pass = Number(passPercent);
      if (!Number.isInteger(points) || points < 1 || points > 1000) return setLocalError("Points are a whole number from 1 to 1000.");
      if (!Number.isInteger(pass) || pass < 0 || pass > 100) return setLocalError("The pass mark is a percentage from 0 to 100.");
      assignment = { maxPoints: points, passPercent: pass, dueAt: dueAt ? new Date(dueAt).toISOString() : null, allowResubmit };
    }

    let quiz: StudioQuiz | null = null;
    if (assessment) {
      const converted: StudioQuizQuestion[] = [];
      for (const [i, d] of questions.entries()) {
        const out = toQuestion(d, i + 1);
        if (typeof out === "string") return setLocalError(out);
        converted.push(out);
      }
      if (converted.length === 0) return setLocalError("Add at least one question.");
      if (converted.length > settings.maxQuizQuestionsPerLesson) return setLocalError(`A ${contentType} can have up to ${settings.maxQuizQuestionsPerLesson} questions.`);
      const pass = Number(passing);
      if (!Number.isInteger(pass) || pass < 0 || pass > 100) return setLocalError("The pass mark is a percentage from 0 to 100.");
      const limit = Number(timeLimit);
      const tries = Number(attempts);
      const drawn = Number(draw);
      if (![limit, tries, drawn].every((n) => Number.isInteger(n) && n >= 0)) return setLocalError("Time limit, attempts and questions per attempt are whole numbers, 0 or more.");
      quiz = {
        title: quizTitle.trim() || itemTitle.trim(),
        passingScorePercent: pass,
        questions: converted,
        settings: { timeLimitMinutes: limit, maxAttempts: tries, shuffleQuestions: shuffleQ, shuffleOptions: shuffleO, questionsPerAttempt: drawn },
      };
    }
    setLocalError(null);
    onSubmit({ title: itemTitle, contentType, durationMinutes: duration, summary, contentUrl: url, body: contentType === "text" || contentType === "assignment" ? body : "", slides: cleanSlides, live, assignment, quiz });
  }

  return (
    <form onSubmit={submit} className={`${cardCls} space-y-4 p-4 sm:p-5`}>
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <Field label={`${typeLabel} title`} htmlFor={`${id}-title`}>
        <input id={`${id}-title`} required maxLength={120} value={itemTitle} onChange={(e) => setItemTitle(e.target.value)} className={controlCls} placeholder={assessment ? "e.g. End of unit quiz" : "e.g. Halves and quarters"} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={contentType === "live" ? "Length of the live lesson (minutes)" : "Length (minutes)"} htmlFor={`${id}-min`}>
          <input id={`${id}-min`} type="number" min={1} max={settings.maxLessonMinutes} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} className={controlCls} />
        </Field>
        {(contentType === "video" || contentType === "audio") && (
          <Field label="Link instead of an upload (optional)" htmlFor={`${id}-url`} hint="Upload a file after saving, or paste a link learners can open.">
            <input id={`${id}-url`} type="url" inputMode="url" maxLength={500} value={contentUrl} onChange={(e) => setContentUrl(e.target.value)} className={controlCls} placeholder="https://…" />
          </Field>
        )}
      </div>

      {contentType === "text" && (
        <Field label="The lesson" htmlFor={`${id}-body`} hint={`${body.length.toLocaleString("en-UG")} of ${settings.maxLessonBodyChars.toLocaleString("en-UG")} characters. Leave a blank line between paragraphs.`}>
          <textarea id={`${id}-body`} rows={12} value={body} onChange={(e) => setBody(e.target.value)} className={controlCls} placeholder="Write the lesson here" />
        </Field>
      )}

      {contentType === "slides" && (
        <div className="space-y-3">
          {slides.map((s, i) => (
            <fieldset key={i} className="space-y-2 rounded-xl border border-[var(--border-faint)] p-3">
              <legend className="px-1 text-base font-semibold text-gold">Slide {i + 1}</legend>
              <Field label="Title" htmlFor={`${id}-st${i}`}>
                <input id={`${id}-st${i}`} maxLength={120} value={s.title} onChange={(e) => patchSlide(i, { title: e.target.value })} className={controlCls} />
              </Field>
              <Field label="Text" htmlFor={`${id}-sb${i}`}>
                <textarea id={`${id}-sb${i}`} rows={3} maxLength={4000} value={s.body} onChange={(e) => patchSlide(i, { body: e.target.value })} className={controlCls} />
              </Field>
              <Field label="Picture link (optional)" htmlFor={`${id}-si${i}`}>
                <input id={`${id}-si${i}`} type="url" inputMode="url" maxLength={500} value={s.imageUrl} onChange={(e) => patchSlide(i, { imageUrl: e.target.value })} className={controlCls} placeholder="https://…" />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" className="!min-h-8 !px-3 !text-base" disabled={i === 0} onClick={() => moveSlide(i, -1)}><ArrowUp className="h-3.5 w-3.5" /> Up</Button>
                <Button variant="secondary" className="!min-h-8 !px-3 !text-base" disabled={i === slides.length - 1} onClick={() => moveSlide(i, 1)}><ArrowDown className="h-3.5 w-3.5" /> Down</Button>
                {slides.length > 1 && <Button variant="danger" className="!min-h-8 !px-3 !text-base" onClick={() => setSlides((prev) => prev.filter((_, xi) => xi !== i))}>Remove slide</Button>}
              </div>
            </fieldset>
          ))}
          {slides.length < settings.maxSlidesPerLesson && (
            <Button variant="secondary" onClick={() => setSlides((prev) => [...prev, { title: "", body: "", imageUrl: "" }])}>
              <Plus className="h-4 w-4" /> Add slide
            </Button>
          )}
        </div>
      )}

      {contentType === "live" && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Starts" htmlFor={`${id}-at`} hint="Learners can open the join button a little before this.">
              <input id={`${id}-at`} type="datetime-local" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={controlCls} />
            </Field>
            <Field label="Meeting link" htmlFor={`${id}-lu`} hint={`From: ${settings.liveLessonHosts.split(",").join(", ")}`}>
              <input id={`${id}-lu`} type="url" inputMode="url" required maxLength={500} value={liveUrl} onChange={(e) => setLiveUrl(e.target.value)} className={controlCls} placeholder="https://meet.jit.si/…" />
            </Field>
          </div>
          <Field label="Note for learners (optional)" htmlFor={`${id}-ln`}>
            <textarea id={`${id}-ln`} rows={2} maxLength={2000} value={liveNotes} onChange={(e) => setLiveNotes(e.target.value)} className={controlCls} placeholder="What to bring, what we will cover" />
          </Field>
        </div>
      )}

      {contentType === "assignment" && (
        <div className="space-y-3">
          <Field label="Instructions" htmlFor={`${id}-ins`} hint="What the learner should do and hand in">
            <textarea id={`${id}-ins`} rows={6} value={body} onChange={(e) => setBody(e.target.value)} className={controlCls} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Points" htmlFor={`${id}-pts`}>
              <input id={`${id}-pts`} type="number" min={1} max={1000} inputMode="numeric" value={maxPoints} onChange={(e) => setMaxPoints(e.target.value)} className={controlCls} />
            </Field>
            <Field label="Pass mark (%)" htmlFor={`${id}-ap`}>
              <input id={`${id}-ap`} type="number" min={0} max={100} inputMode="numeric" value={passPercent} onChange={(e) => setPassPercent(e.target.value)} className={controlCls} />
            </Field>
            <Field label="Deadline (optional)" htmlFor={`${id}-due`}>
              <input id={`${id}-due`} type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className={controlCls} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-lg text-ink">
            <input type="checkbox" checked={allowResubmit} onChange={(e) => setAllowResubmit(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--color-gold))]" />
            Let learners hand in again until they pass
          </label>
        </div>
      )}

      {assessment ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Paper title" htmlFor={`${id}-qt`} className="sm:col-span-2">
              <input id={`${id}-qt`} maxLength={120} value={quizTitle} onChange={(e) => setQuizTitle(e.target.value)} className={controlCls} placeholder="Optional" />
            </Field>
            <Field label="Pass mark (%)" htmlFor={`${id}-pass`}>
              <input id={`${id}-pass`} type="number" min={0} max={100} inputMode="numeric" value={passing} onChange={(e) => setPassing(e.target.value)} className={controlCls} />
            </Field>
            <Field label="Time limit (minutes)" htmlFor={`${id}-tl`} hint="0 means untimed">
              <input id={`${id}-tl`} type="number" min={0} max={600} inputMode="numeric" value={timeLimit} onChange={(e) => setTimeLimit(e.target.value)} className={controlCls} />
            </Field>
            <Field label="Attempts allowed" htmlFor={`${id}-at2`} hint={`0 uses the platform limit (${(contentType === "exam" ? settings.examMaxAttempts : settings.quizMaxAttempts) || "unlimited"})`}>
              <input id={`${id}-at2`} type="number" min={0} max={50} inputMode="numeric" value={attempts} onChange={(e) => setAttempts(e.target.value)} className={controlCls} />
            </Field>
            <Field label="Questions drawn each time" htmlFor={`${id}-dr`} hint="0 asks them all">
              <input id={`${id}-dr`} type="number" min={0} max={200} inputMode="numeric" value={draw} onChange={(e) => setDraw(e.target.value)} className={controlCls} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-lg text-ink">
            <label className="flex items-center gap-2"><input type="checkbox" checked={shuffleQ} onChange={(e) => setShuffleQ(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--color-gold))]" /> Shuffle the questions</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={shuffleO} onChange={(e) => setShuffleO(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--color-gold))]" /> Shuffle the choices</label>
          </div>
          {questions.map((d, i) => (
            <QuestionEditor key={i} id={`${id}-q${i}`} n={i + 1} d={d} onChange={(p) => patchQuestion(i, p)} onRemove={() => setQuestions((prev) => prev.filter((_, xi) => xi !== i))} canRemove={questions.length > 1} />
          ))}
          {questions.length < settings.maxQuizQuestionsPerLesson && (
            <Button variant="secondary" onClick={() => setQuestions((prev) => [...prev, blank()])}>
              <Plus className="h-4 w-4" /> Add question
            </Button>
          )}
        </div>
      ) : contentType === "assignment" ? null : (
        <Field label={contentType === "text" ? "Short description (optional)" : "Notes"} htmlFor={`${id}-sum`}>
          <textarea id={`${id}-sum`} rows={3} maxLength={2000} value={summary} onChange={(e) => setSummary(e.target.value)} className={controlCls} placeholder="Key ideas, instructions and any homework" />
        </Field>
      )}

      {(localError ?? error) && <Notice tone="error">{localError ?? error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
