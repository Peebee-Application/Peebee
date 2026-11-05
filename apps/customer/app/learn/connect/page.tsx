"use client";

import type { ConnectCourse, ConnectTopic, LearnerLesson } from "@peebee/shared";
import { BadgeCheck, MessageSquarePlus, MessagesSquare, Send } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api, errorMessage } from "../../../lib/api";
import { LearnScreen, ScreenHeader, card, displayFont as DISPLAY } from "../ui";

const MAX_CHARS = 1500;

/** SQLite stores UTC times without a zone ("2026-10-20 09:30:00"); read them as UTC. */
function ago(stamp: string): string {
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(stamp) ? stamp : `${stamp.replace(" ", "T")}Z`);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString("en-UG", { day: "numeric", month: "short" });
}

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-2xl bg-[rgb(var(--surface-muted))] ${className}`} aria-hidden />;
}

/** Marks the course's teacher (school owner or added teacher) wherever their name appears. */
function TutorBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-gold px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-ink-gold">
      <BadgeCheck className="h-3 w-3" aria-hidden /> Tutor
    </span>
  );
}

function Avatar({ name, teacher }: { name: string; teacher: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${teacher ? "bg-gold text-ink-gold" : "bg-[rgb(var(--surface-muted))] text-ink"}`}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function Composer({ courses, initialCourse, onPosted, onCancel }: { courses: ConnectCourse[]; initialCourse: string; onPosted: () => void; onCancel: () => void }) {
  const [courseId, setCourseId] = useState(initialCourse || courses[0]?.id || "");
  const [lessonId, setLessonId] = useState("");
  const [lessons, setLessons] = useState<{ id: string; title: string }[]>([]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lessons are optional context; they load when a course is picked.
  useEffect(() => {
    setLessonId("");
    setLessons([]);
    if (!courseId) return;
    let cancelled = false;
    api
      .learnCourse(courseId)
      .then((res) => {
        if (cancelled) return;
        const all: LearnerLesson[] = res.course.modules.flatMap((m) => m.lessons);
        setLessons(all.map((l) => ({ id: l.id, title: l.title })));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!courseId || body.trim().length < 3) return setError("Write at least a few words.");
    setBusy(true);
    setError(null);
    try {
      await api.learnAsk(courseId, body.trim(), lessonId || null);
      setBody("");
      onPosted();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={`${card} space-y-3 p-3.5`} aria-label="Ask a question">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="block text-[11px] font-semibold text-ink-500">
          About
          <select value={courseId} onChange={(e) => setCourseId(e.target.value)} className="mt-1 w-full rounded-xl px-3 py-2.5 text-sm text-ink">
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[11px] font-semibold text-ink-500">
          Lesson (optional)
          <select value={lessonId} onChange={(e) => setLessonId(e.target.value)} className="mt-1 w-full rounded-xl px-3 py-2.5 text-sm text-ink">
            <option value="">Whole course</option>
            {lessons.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block text-[11px] font-semibold text-ink-500">
        Your question or topic
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, MAX_CHARS))}
          rows={4}
          placeholder="What would you like to ask or discuss?"
          className="mt-1 w-full resize-none rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-sm text-ink"
        />
      </label>
      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10.5px] tabular-nums text-ink-500">
          {body.length}/{MAX_CHARS}
        </span>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="rounded-xl px-3.5 py-2 text-xs font-semibold text-ink-500">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="rounded-xl bg-gold px-4 py-2 text-xs font-bold text-ink-gold disabled:opacity-50">
            {busy ? "Posting…" : "Post"}
          </button>
        </div>
      </div>
    </form>
  );
}

function Topic({ topic, onChanged }: { topic: ConnectTopic; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (reply.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      await api.learnAnswer(topic.id, reply.trim());
      setReply("");
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(kind: "question" | "answer", id: string) {
    if (confirm !== id) return setConfirm(id);
    try {
      await (kind === "question" ? api.learnDeleteQuestion(id) : api.learnDeleteAnswer(id));
      setConfirm(null);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const count = topic.answers.length;
  return (
    <li className={`${card} space-y-2.5 p-3.5`}>
      <div className="flex items-center gap-2.5">
        <Avatar name={topic.askedBy} teacher={!!topic.askedByTeacher} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-bold text-ink">
            {topic.askedBy}
            {topic.askedByTeacher && <TutorBadge />}
          </p>
          <p className="text-[10.5px] text-ink-500">{ago(topic.createdAt)}</p>
        </div>
      </div>
      <p className="flex flex-wrap gap-1.5 text-[10.5px]">
        <Link href={`/learn/course/${topic.courseId}`} className="max-w-full truncate rounded-full bg-gold/15 px-2 py-0.5 font-bold text-gold">
          {topic.courseTitle}
        </Link>
        {topic.lessonTitle && <span className="max-w-full truncate rounded-full bg-[rgb(var(--surface-muted))] px-2 py-0.5 font-semibold text-ink-500">{topic.lessonTitle}</span>}
      </p>
      <p className="whitespace-pre-wrap break-words text-[13.5px] leading-snug text-ink">{topic.body}</p>
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-1.5 text-xs font-semibold text-gold">
          <MessagesSquare className="h-3.5 w-3.5" aria-hidden /> {count === 0 ? "Reply" : `${count} ${count === 1 ? "reply" : "replies"}`}
        </button>
        {topic.canDelete && (
          <button type="button" onClick={() => remove("question", topic.id)} className="text-[11px] font-semibold text-ink-500">
            {confirm === topic.id ? "Tap again to delete" : "Delete"}
          </button>
        )}
      </div>

      {open && (
        <div className="space-y-3 border-t border-[var(--border-faint)] pt-3">
          {topic.answers.map((a) => (
            <div key={a.id} className="flex gap-2.5">
              <Avatar name={a.by} teacher={a.byTeacher} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-ink">
                  {a.by}
                  {a.byTeacher && <TutorBadge />}
                  <span className="text-[10.5px] font-normal text-ink-500">{ago(a.createdAt)}</span>
                </p>
                <p className="whitespace-pre-wrap break-words text-[13px] leading-snug text-ink">{a.body}</p>
                {a.canDelete && (
                  <button type="button" onClick={() => remove("answer", a.id)} className="mt-0.5 text-[10.5px] font-semibold text-ink-500">
                    {confirm === a.id ? "Tap again to delete" : "Delete"}
                  </button>
                )}
              </div>
            </div>
          ))}
          <form onSubmit={send} className="flex gap-2">
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value.slice(0, MAX_CHARS))}
              aria-label="Write a reply"
              placeholder="Write a reply"
              className="min-w-0 flex-1 rounded-xl px-3 py-2.5 text-sm text-ink"
            />
            <button type="submit" disabled={busy || reply.trim().length < 2} aria-label="Send reply" className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-gold text-ink-gold disabled:opacity-50">
              <Send className="h-4 w-4" aria-hidden />
            </button>
          </form>
          {error && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export default function ConnectPage() {
  const [data, setData] = useState<{ enabled: boolean; courses: ConnectCourse[]; topics: ConnectTopic[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [course, setCourse] = useState<string>("");
  const [asking, setAsking] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.learnConnect(course || undefined);
      setData({ enabled: res.enabled, courses: res.courses, topics: res.topics });
      setError(null);
    } catch (err) {
      setData((d) => d ?? { enabled: true, courses: [], topics: [] });
      setError(errorMessage(err));
    }
  }, [course]);

  useEffect(() => {
    void load();
  }, [load]);

  // The course list always comes back complete, so the chips stay put while one is chosen.
  const courses = useMemo(() => data?.courses ?? [], [data]);
  const hasCourses = courses.length > 0;
  const chips = useMemo(() => [{ id: "", title: "All courses" }, ...courses.map((c) => ({ id: c.id, title: c.title }))], [courses]);

  return (
    <LearnScreen width="max-w-3xl" bottom="pb-44">
        <ScreenHeader label="Peebee Learn" title="Connect" icon={MessagesSquare} subtitle="Ask questions and talk with the people in your courses. Tutors are marked with a badge." />

        {error && (
          <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-3 text-sm text-ink">
            {error}
          </p>
        )}

        {data === null ? (
          <div className="space-y-2">
            <Skeleton className="h-14" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        ) : !data.enabled ? (
          <div className={`${card} flex flex-col items-center gap-2 px-5 py-10 text-center`}>
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gold/15 text-gold">
              <MessagesSquare className="h-6 w-6" aria-hidden />
            </span>
            <p className="text-sm font-semibold text-ink">Connect is switched off right now</p>
            <p className="max-w-xs text-xs text-ink-500">Questions and replies will come back when it is switched on again.</p>
          </div>
        ) : !hasCourses ? (
          <div className={`${card} flex flex-col items-center gap-2 px-5 py-10 text-center`}>
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gold/15 text-gold">
              <MessagesSquare className="h-6 w-6" aria-hidden />
            </span>
            <p className="text-sm font-semibold text-ink">Join a course to start talking</p>
            <p className="max-w-xs text-xs text-ink-500">Connect brings together the questions from every course you have joined.</p>
            <Link href="/learn" className="mt-1 rounded-xl bg-gold px-4 py-2 text-xs font-bold text-ink-gold">
              Discover courses
            </Link>
          </div>
        ) : (
          <>
            {asking ? (
              <Composer
                courses={courses}
                initialCourse={course}
                onCancel={() => setAsking(false)}
                onPosted={() => {
                  setAsking(false);
                  void load();
                }}
              />
            ) : (
              <button type="button" onClick={() => setAsking(true)} className={`${card} flex w-full items-center gap-3 p-3 text-left transition hover:border-gold/50 active:scale-[0.99]`}>
                <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-xl bg-gold/15 text-gold">
                  <MessageSquarePlus className="h-[18px] w-[18px]" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className={`${DISPLAY} block text-sm font-bold text-ink`}>Ask a question or start a topic</span>
                  <span className="block text-[11px] text-ink-500">About a course or one of its lessons</span>
                </span>
              </button>
            )}

            <div role="radiogroup" aria-label="Course" className="-mx-3.5 flex gap-2 overflow-x-auto px-3.5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {chips.map((c) => (
                <button
                  key={c.id || "all"}
                  type="button"
                  role="radio"
                  aria-checked={course === c.id}
                  onClick={() => setCourse(c.id)}
                  className={`max-w-[220px] shrink-0 truncate rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${course === c.id ? "bg-gold text-ink-gold" : "border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] text-ink-500 hover:text-ink"}`}
                >
                  {c.title}
                </button>
              ))}
            </div>

            {data.topics.length === 0 ? (
              <div className={`${card} flex flex-col items-center gap-2 px-5 py-10 text-center`}>
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gold/15 text-gold">
                  <MessagesSquare className="h-6 w-6" aria-hidden />
                </span>
                <p className="text-sm font-semibold text-ink">No questions yet</p>
                <p className="max-w-xs text-xs text-ink-500">Be the first to ask something about your course.</p>
              </div>
            ) : (
              <ul className="space-y-3">
                {data.topics.map((t) => (
                  <Topic key={t.id} topic={t} onChanged={() => void load()} />
                ))}
              </ul>
            )}
          </>
        )}
    </LearnScreen>
  );
}
