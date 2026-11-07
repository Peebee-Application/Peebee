"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  LearningPublication,
  learningCreatorMethods,
} from "./learn-creator.js";
import { LearningResourceView } from "./LearningResourceView.js";
type Api = ReturnType<typeof learningCreatorMethods> & { baseUrl: string };
const card =
  "rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4 sm:p-5";
const button =
  "min-h-11 rounded-xl border border-[var(--border-faint)] px-4 py-2 text-sm font-semibold disabled:opacity-50";
const field =
  "w-full rounded-xl border border-[var(--border-faint)] p-3 text-sm outline-none focus:border-gold";
const message = (e: unknown) =>
  e instanceof Error ? e.message : "This action could not be completed.";

export function LearningStudy({
  api,
  courseId,
  inviteToken,
  signedIn = true,
  onSignIn,
}: {
  api: Api;
  courseId: string;
  inviteToken?: string;
  signedIn?: boolean;
  onSignIn?: () => void;
}) {
  const [publication, setPublication] = useState<LearningPublication | null>(
      null,
    ),
    [lessonId, setLessonId] = useState(""),
    [done, setDone] = useState<string[]>([]),
    [cohortId, setCohortId] = useState(""),
    [evidence, setEvidence] = useState<
      Array<{ objectiveId: string; correct: number; attempts: number }>
    >([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [text, setText] = useState(""),
    [messages, setMessages] = useState<Array<{ role: string; text: string }>>(
      [],
    ),
    [feedback, setFeedback] = useState<Record<string, string>>({}),
    [recipient, setRecipient] = useState(""),
    [note, setNote] = useState("");
  const purchaseRequest = useRef<string | null>(null);
  const load = useCallback(async () => {
    const r = signedIn
      ? await api.learningPublication(courseId)
      : await api.publicLearningPublication(courseId);
    setPublication(r.publication);
    setLessonId((id) => id || r.publication.modules[0]?.lessons[0]?.id || "");
    if (r.publication.hasAccess) {
      const [p, h] = await Promise.all([
        api.learningProgress(courseId),
        api.learningTutorHistory(courseId),
      ]);
      setDone(p.lessonIds);
      setEvidence(p.evidence);
      setMessages(h.messages);
    }
  }, [api, courseId, signedIn]);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (inviteToken && signedIn)
          await api.acceptLearningInvite(inviteToken);
        if (active) await load();
      } catch (e) {
        if (active) setError(message(e));
      }
    })();
    return () => {
      active = false;
    };
  }, [api, inviteToken, load, signedIn]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const lessons = publication?.modules.flatMap((m) => m.lessons) || [],
    lesson = lessons.find((l) => l.id === lessonId);
  if (inviteToken && !signedIn)
    return (
      <section className={`${card} space-y-3`}>
        <h1 className="text-xl font-semibold">
          You have a learning invitation
        </h1>
        <p>Sign in with the account this invitation was addressed to.</p>
        <button className={button} onClick={onSignIn}>
          Sign in to accept
        </button>
      </section>
    );
  if (!publication)
    return (
      <section className={card}>
        <h1 className="text-xl font-semibold">Your learning journey</h1>
        <p role={error ? "alert" : "status"} className="mt-3 text-sm">
          {error || "Opening course…"}
        </p>
        {error && (
          <button className={`${button} mt-3`} onClick={() => void run(load)}>
            Try again
          </button>
        )}
      </section>
    );
  return (
    <div className="space-y-5 text-ink">
      <header className={`${card} space-y-3`}>
        <p className="text-xs uppercase tracking-wider text-gold">
          Peebee Learn · {publication.kind} · version {publication.version}
        </p>
        <h1 className="font-display text-2xl font-semibold">
          {publication.title}
        </h1>
        <p className="text-sm text-ink-500">By {publication.creator}</p>
        <p className="whitespace-pre-wrap text-sm">{publication.summary}</p>
        <div className="flex flex-wrap gap-2">
          {publication.labels.map((label) => (
            <span
              key={label}
              className="rounded-lg bg-[rgb(var(--surface-muted))] px-3 py-2 text-xs"
            >
              {label}
            </span>
          ))}
        </div>
        <p className="text-xs text-ink-500">
          Review labels describe recorded review of this version; they do not
          guarantee error-free or unbiased content.
        </p>
      </header>
      {error && (
        <p role="alert" className={card}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={card}>
          {notice}
        </p>
      )}
      {!publication.hasAccess && (
        <section className={`${card} space-y-3`}>
          <h2 className="font-semibold">
            {publication.priceUgx > 0
              ? `Purchase access · UGX ${publication.priceUgx.toLocaleString("en-UG")}`
              : "Start learning for free"}
          </h2>
          <p className="text-sm text-ink-500">
            Your progress and tutor conversations are private. Paid content
            access does not include unlimited AI tutoring.
          </p>
          {(publication.cohorts || []).length > 0 && (
            <label className="block space-y-1 text-xs font-semibold">
              Choose your intake
              <select
                className={field}
                value={cohortId}
                onChange={(e) => setCohortId(e.target.value)}
              >
                <option value="">Choose a start date</option>
                {publication.cohorts!.map((h) => (
                  <option value={h.id} key={h.id}>
                    {h.name} · {h.startsAt.slice(0, 10)}
                    {h.seatsLeft === null ? "" : ` · ${h.seatsLeft} seats left`}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            disabled={busy}
            className={`${button} bg-gold text-ink-gold`}
            onClick={() =>
              void run(async () => {
                if (!signedIn) {
                  onSignIn?.();
                  return;
                }
                if (publication.priceUgx > 0) {
                  purchaseRequest.current ??= crypto.randomUUID();
                  await api.buyLearningPublication(
                    courseId,
                    publication.id,
                    publication.priceUgx,
                    purchaseRequest.current,
                    cohortId || undefined,
                  );
                } else
                  await api.joinLearningPublication(
                    courseId,
                    cohortId || undefined,
                  );
                await load();
              })
            }
          >
            {publication.priceUgx > 0
              ? "Pay from my Peebee wallet"
              : "Enroll and begin"}
          </button>
          <a className="ml-3 text-sm text-gold underline" href="/wallet">
            Open wallet
          </a>
        </section>
      )}
      <section className={`${card} space-y-2`}>
        <h2 className="font-semibold">What you will learn</h2>
        {publication.objectives.map((o) => (
          <div key={o.id}>
            <p className="text-sm font-medium">{o.title}</p>
            <p className="text-xs text-ink-500">{o.evidence}</p>
            {publication.hasAccess &&
              evidence.some((e) => e.objectiveId === o.id) && (
                <p className="text-xs text-ink-500">
                  Practice evidence:{" "}
                  {evidence.find((e) => e.objectiveId === o.id)?.correct}{" "}
                  correct questions across{" "}
                  {evidence.find((e) => e.objectiveId === o.id)?.attempts}{" "}
                  attempts. Completion and assessed mastery are separate.
                </p>
              )}
            {o.source && (
              <p className="text-xs text-ink-500">Source: {o.source}</p>
            )}
          </div>
        ))}
      </section>
      <div className="grid gap-5">
        <nav
          className={`${card} space-y-4 self-start`}
          aria-label="Learning roadmap"
        >
          <p className="text-xs text-ink-500">
            {done.filter((id) => lessons.some((l) => l.id === id)).length} of{" "}
            {lessons.length} lessons completed
          </p>
          {publication.modules.map((m) => (
            <section className="space-y-2" key={m.id}>
              <h2 className="text-sm font-semibold">{m.title}</h2>
              {m.lessons.map((l) => (
                <button
                  type="button"
                  key={l.id}
                  disabled={l.locked}
                  aria-current={lessonId === l.id ? "step" : undefined}
                  onClick={() => {
                    setLessonId(l.id);
                    setFeedback({});
                  }}
                  className={`block min-h-11 w-full rounded-xl px-3 py-2 text-left text-sm ${lessonId === l.id ? "bg-gold/15" : "bg-[rgb(var(--surface-muted))]"}`}
                >
                  {done.includes(l.id) ? "✓ " : ""}
                  {l.title}
                  {l.locked && (
                    <span className="block text-xs text-ink-500">
                      {l.lockMessage}
                    </span>
                  )}
                </button>
              ))}
            </section>
          ))}
        </nav>
        {publication.hasAccess && lesson ? (
          <article className={`${card} space-y-5`}>
            <div>
              <p className="text-xs text-ink-500">
                About {lesson.minutes} minutes
              </p>
              <h2 className="text-xl font-semibold">{lesson.title}</h2>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-7">
              {lesson.body}
            </p>
            {lesson.locked && <p role="status">{lesson.lockMessage}</p>}
            {lesson.nativeActivity && (
              <a
                className="text-sm font-semibold text-gold underline"
                href={`/learn/course/${courseId}/lesson/${lesson.id}`}
              >
                Open instructor activity in Learn
              </a>
            )}
            {lesson.resources.map((r) => (
              <LearningResourceView key={r.id} resource={r} api={api} />
            ))}
            {lesson.questions.map((q) => (
              <fieldset
                disabled={busy}
                key={q.id}
                className="space-y-2 rounded-xl border border-[var(--border-faint)] p-3"
              >
                <legend className="px-1 text-sm font-semibold">
                  {q.question}
                </legend>
                {q.options.map((option, i) => (
                  <button
                    type="button"
                    key={i}
                    className={`${button} block w-full text-left`}
                    onClick={() =>
                      void run(async () => {
                        const r = await api.answerLearningQuestion(
                          courseId,
                          lesson.id,
                          q.id,
                          i,
                        );
                        setEvidence(
                          (await api.learningProgress(courseId)).evidence,
                        );
                        setFeedback((f) => ({
                          ...f,
                          [q.id]: `${r.correct ? "Correct" : "Try again"}. ${r.explanation}`,
                        }));
                      })
                    }
                  >
                    {option}
                  </button>
                ))}
                {feedback[q.id] && (
                  <p role="status" className="text-sm">
                    {feedback[q.id]}
                  </p>
                )}
              </fieldset>
            ))}
            <button
              disabled={
                busy ||
                done.includes(lesson.id) ||
                lesson.locked ||
                lesson.nativeActivity
              }
              className={`${button} bg-gold text-ink-gold`}
              onClick={() =>
                void run(async () => {
                  await api.completeLearningLesson(courseId, lesson.id);
                  setDone((d) => [...new Set([...d, lesson.id])]);
                  setNotice(
                    "Lesson completed. Your learning evidence is tracked separately from completion.",
                  );
                })
              }
            >
              {done.includes(lesson.id)
                ? "Lesson completed"
                : "Mark lesson complete"}
            </button>
          </article>
        ) : (
          <div className={card}>
            <h2 className="font-semibold">Your roadmap is ready</h2>
            <p className="mt-2 text-sm text-ink-500">
              Enroll or purchase access to open lessons and study resources.
            </p>
          </div>
        )}
      </div>
      {publication.references.length > 0 && (
        <section className={`${card} space-y-3`}>
          <h2 className="font-semibold">Other courses on this path</h2>
          <p className="text-xs text-ink-500">
            These courses have their own access and purchase requirements.
          </p>
          {publication.references.map((r) => (
            <a
              key={r.courseId}
              className="block text-sm text-gold underline"
              href={`/learn/course/${encodeURIComponent(r.courseId)}`}
            >
              {r.title} · {r.note}
            </a>
          ))}
        </section>
      )}
      {publication.hasAccess &&
        lesson &&
        !lesson.locked &&
        !lesson.nativeActivity &&
        publication.tutoringEnabled !== false && (
          <section className={`${card} space-y-3`}>
            <h2 className="font-semibold">Study with your AI tutor</h2>
            <p className="text-xs text-ink-500">
              Ask about {lesson.title}. Your conversations belong to you; the
              creator does not see them here.
            </p>
            <div
              role="log"
              aria-live="polite"
              className="max-h-96 space-y-3 overflow-y-auto"
            >
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`rounded-xl p-3 ${m.role === "user" ? "bg-[rgb(var(--surface-muted))]" : "border border-[var(--border-faint)]"}`}
                >
                  <p className="text-xs font-semibold">
                    {m.role === "user" ? "You" : "AI tutor"}
                  </p>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {m.text}
                  </p>
                </div>
              ))}
            </div>
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                const question = text;
                setText("");
                void run(async () => {
                  const response = await api.learningTutor(
                    courseId,
                    lesson.id,
                    question,
                    crypto.randomUUID(),
                  );
                  setMessages((m) => [
                    ...m,
                    { role: "user", text: question },
                    { role: "assistant", text: response.text },
                  ]);
                });
              }}
            >
              <label className="block text-xs font-semibold">
                Your question or answer
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className={field}
                  maxLength={4000}
                  required
                />
              </label>
              <button disabled={busy || !text.trim()} className={button}>
                Ask tutor
              </button>
            </form>
          </section>
        )}
      {signedIn &&
        publication.sharingEnabled !== false &&
        publication.visibility !== "private" && (
          <section className={`${card} space-y-3`}>
            <h2 className="font-semibold">Share this learning journey</h2>
            <button
              className={button}
              onClick={() =>
                void run(async () => {
                  const url = new URL(
                    `/learn/study/${courseId}`,
                    window.location.origin,
                  ).href;
                  await navigator.clipboard.writeText(url);
                  setNotice("Learning link copied. Access rules still apply.");
                })
              }
            >
              Copy learning link
            </button>
            <label className="block text-xs font-semibold">
              Friend&apos;s Peebee account ID
              <input
                className={field}
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
              />
            </label>
            <label className="block text-xs font-semibold">
              Message
              <input
                className={field}
                value={note}
                maxLength={2000}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <button
              className={button}
              disabled={busy || !recipient}
              onClick={() =>
                void run(async () => {
                  await api.sendLearningShare(courseId, recipient, note);
                  setNotice(
                    "Course card sent to your friend's Learn messages. This doesn't share your progress or bypass payment.",
                  );
                })
              }
            >
              Send in Learn messages
            </button>
          </section>
        )}
    </div>
  );
}
