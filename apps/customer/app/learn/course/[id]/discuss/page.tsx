"use client";

import type { Announcement, QaQuestion } from "@peebee/shared";
import { MessageCircle, Trash2 } from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../../../../lib/api";
import { Empty, ErrorNote, LearnScreen, Pill, ScreenHeader, Skeleton, card, displayFont, primaryBtn } from "../../../ui";

const ago = (iso: string) => new Date(iso.replace(" ", "T") + "Z").toLocaleDateString("en-UG", { day: "numeric", month: "short" });

function Question({ q, onChanged, onError }: { q: QaQuestion; onChanged: () => void; onError: (m: string) => void }) {
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  async function answer() {
    if (reply.trim().length < 2) return;
    setBusy(true);
    try {
      await api.learnAnswer(q.id, reply);
      setReply("");
      onChanged();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className={`${card} space-y-3 p-4`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`${displayFont} text-[15px] font-semibold leading-snug text-ink`}>{q.body}</p>
          <p className="text-xs text-ink-500">{q.askedBy} · {ago(q.createdAt)}</p>
        </div>
        {q.canDelete && (
          <button type="button" aria-label="Delete question" onClick={() => window.confirm("Delete this question and its answers?") && api.learnDeleteQuestion(q.id).then(onChanged).catch((e) => onError(errorMessage(e)))} className="shrink-0 text-ink-500 hover:text-red-600">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      {q.answers.length > 0 && (
        <ul className="space-y-2 border-l-2 border-gold/40 pl-3">
          {q.answers.map((a) => (
            <li key={a.id} className="space-y-0.5">
              <p className="text-sm text-ink">{a.body}</p>
              <p className="flex items-center gap-2 text-xs text-ink-500">
                {a.by}
                {a.byTeacher && <Pill>Teacher</Pill>}
                · {ago(a.createdAt)}
                {a.canDelete && <button type="button" className="underline" onClick={() => api.learnDeleteAnswer(a.id).then(onChanged).catch((e) => onError(errorMessage(e)))}>Delete</button>}
              </p>
            </li>
          ))}
        </ul>
      )}
      <div className="field-box flex items-center gap-2 rounded-xl px-3 py-1.5 border border-[var(--border-faint)]">
        <input aria-label="Write an answer" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write an answer" maxLength={1500} className="min-w-0 flex-1 text-sm" />
        <button type="button" onClick={answer} disabled={busy} className="shrink-0 text-xs font-bold text-gold disabled:opacity-50">Reply</button>
      </div>
    </li>
  );
}

function Discuss() {
  const { id } = useParams<{ id: string }>();
  const lessonId = useSearchParams().get("lesson") ?? undefined;
  const [questions, setQuestions] = useState<QaQuestion[] | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.learnQa(id, lessonId).then((r) => setQuestions(r.questions)).catch((e) => setError(errorMessage(e)));
    api.learnAnnouncements(id).then((r) => setAnnouncements(r.announcements)).catch(() => undefined);
  }, [id, lessonId]);
  useEffect(load, [load]);

  async function ask() {
    if (text.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      await api.learnAsk(id, text, lessonId ?? null);
      setText("");
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <LearnScreen>
      <ScreenHeader
        back={{ href: `/learn/course/${id}`, label: "Class" }}
        label="Peebee Learn"
        title={lessonId ? "Questions about this lesson" : "Questions and announcements"}
        icon={MessageCircle}
        subtitle="Ask your tutor and classmates."
      />
      {error && <ErrorNote>{error}</ErrorNote>}

      {!lessonId && announcements.length > 0 && (
        <section aria-label="Announcements" className="space-y-2.5">
          {announcements.map((a) => (
            <article key={a.id} className="relative overflow-hidden rounded-[20px] border border-gold/40 bg-[linear-gradient(145deg,rgb(var(--color-gold)/0.18),rgb(var(--color-gold)/0.06))] p-4">
              <span className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gold/30 blur-2xl" aria-hidden />
              <p className={`${displayFont} relative text-[15px] font-bold text-ink`}>📣 {a.title}</p>
              {a.body && <p className="relative mt-1 whitespace-pre-line text-sm text-ink">{a.body}</p>}
              <p className="relative mt-1.5 text-xs text-ink-500">{ago(a.createdAt)}</p>
            </article>
          ))}
        </section>
      )}

      <section className={`${card} space-y-2.5 p-4`}>
        <label htmlFor="ask" className={`${displayFont} block text-sm font-semibold text-ink`}>Ask a question</label>
        <textarea id="ask" rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={1500} className="w-full rounded-2xl border border-[var(--border-faint)] px-3.5 py-3 text-sm" placeholder="What would you like to know?" />
        <button type="button" onClick={ask} disabled={busy} className={primaryBtn}>{busy ? "Posting…" : "Post question"}</button>
      </section>

      {questions === null ? (
        <Skeleton className="h-24" />
      ) : questions.length === 0 ? (
        <Empty icon={MessageCircle}>No questions yet. Be the first to ask.</Empty>
      ) : (
        <ul className="space-y-3">{questions.map((q) => <Question key={q.id} q={q} onChanged={load} onError={setError} />)}</ul>
      )}
    </LearnScreen>
  );
}

export default function DiscussPage() {
  return (
    <Suspense fallback={<div className="p-4"><Skeleton className="h-24" /></div>}>
      <Discuss />
    </Suspense>
  );
}
