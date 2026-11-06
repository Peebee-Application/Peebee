"use client";

import type { CourseCommunity, QaQuestion, StudioCohort } from "@peebee/shared";
import { MessageCircle, Plus, Star, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { api, errorMessage } from "../../lib/api";
import { useStudioSettings } from "../../lib/studio-config";
import { Button, Field, Notice, cardCls, controlCls } from "../ui";

const when = (iso: string) => new Date(iso).toLocaleDateString("en-UG", { day: "numeric", month: "short", year: "numeric" });
const localInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function Answer({ q, onDone, onError }: { q: QaQuestion; onDone: () => void; onError: (m: string) => void }) {
  const [text, setText] = useState("");
  return (
    <li className="space-y-1.5 rounded-xl border border-[var(--border-faint)] p-3">
      <p className="text-lg font-semibold text-ink">{q.body}</p>
      <p className="text-base text-ink-500">{q.askedBy} · {q.answers.length} answer{q.answers.length === 1 ? "" : "s"}</p>
      {q.answers.map((a) => (
        <p key={a.id} className="border-l-2 border-gold/40 pl-2 text-base text-ink">{a.byTeacher ? "Teacher: " : `${a.by}: `}{a.body}</p>
      ))}
      <div className="flex gap-2">
        <input aria-label="Your answer" value={text} onChange={(e) => setText(e.target.value)} maxLength={1500} className={controlCls} placeholder="Answer as the teacher" />
        <Button className="!min-h-14 shrink-0 !px-3 !text-base" disabled={text.trim().length < 2} onClick={() => api.learnAnswer(q.id, text).then(() => { setText(""); onDone(); }).catch((e) => onError(errorMessage(e)))}>Answer</Button>
      </div>
    </li>
  );
}

/** Everything about a course's people: teachers, intakes, announcements, reviews and questions. */
export function Community({ courseId }: { courseId: string }) {
  const settings = useStudioSettings();
  const fid = useId();
  const [data, setData] = useState<CourseCommunity | null>(null);
  const [questions, setQuestions] = useState<QaQuestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [who, setWho] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [cohort, setCohort] = useState<{ id: string | null; name: string; startsAt: string; enrolUntil: string; capacity: string } | null>(null);
  const [replies, setReplies] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    api.studioCommunity(courseId).then(setData).catch((e) => setError(errorMessage(e)));
    api.learnQa(courseId).then((r) => setQuestions(r.questions)).catch(() => setQuestions([]));
  }, [courseId]);
  useEffect(load, [load]);

  async function run(action: () => Promise<unknown>, done: string, after?: () => void) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      after?.();
      load();
      setNotice(done);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function saveCohort(e: FormEvent) {
    e.preventDefault();
    if (!cohort) return;
    void run(
      () => api.studioSaveCohort(courseId, cohort.id, { name: cohort.name, startsAt: new Date(cohort.startsAt).toISOString(), enrolUntil: cohort.enrolUntil ? new Date(cohort.enrolUntil).toISOString() : null, capacity: cohort.capacity ? Number(cohort.capacity) : null }),
      "Intake saved.",
      () => setCohort(null),
    );
  }

  if (!data) return error ? <Notice tone="error">{error}</Notice> : null;
  if (!data.ready) return <Notice tone="info">Teachers, intakes, reviews and questions need a platform update that hasn&apos;t finished yet.</Notice>;

  return (
    <section aria-labelledby="community-heading" className={`${cardCls} space-y-5 p-4`}>
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-gold" aria-hidden />
        <h3 id="community-heading" className="text-lg font-semibold text-ink">Teachers, intakes and discussion</h3>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice tone="success" onClose={() => setNotice(null)}>{notice}</Notice>}

      {settings.instructorsEnabled && (
        <div className="space-y-2">
          <h4 className="text-base font-bold uppercase tracking-wider text-ink-500">Teachers</h4>
          <ul className="space-y-1 text-lg text-ink">
            {data.instructors.length === 0 && <li className="text-base text-ink-500">Just you for now.</li>}
            {data.instructors.map((t) => (
              <li key={t.userId} className="flex items-center justify-between gap-2">
                {t.name}
                {data.owner && <button type="button" aria-label={`Remove ${t.name}`} onClick={() => window.confirm(`Remove ${t.name} from this course?`) && void run(() => api.studioRemoveInstructor(courseId, t.userId), "Teacher removed.")} className="text-ink-500 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>}
              </li>
            ))}
          </ul>
          {data.owner && (
            <div className="flex gap-2">
              <input aria-label="Phone number or email of the teacher" value={who} onChange={(e) => setWho(e.target.value)} className={controlCls} placeholder="Phone number or email of a Peebee account" />
              <Button disabled={busy || who.trim().length < 3} onClick={() => void run(() => api.studioAddInstructor(courseId, who), "Teacher added. They can now edit and mark this course.", () => setWho(""))}>Add</Button>
            </div>
          )}
        </div>
      )}

      {settings.cohortsEnabled && (
        <div className="space-y-2">
          <h4 className="text-base font-bold uppercase tracking-wider text-ink-500">Intakes</h4>
          <p className="text-base text-ink-500">With intakes, learners choose a start date when they join, and the course opens for them on that day. No intakes means anyone can join any time.</p>
          <ul className="space-y-1.5">
            {data.cohorts.map((h: StudioCohort) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border-faint)] p-2.5 text-lg text-ink">
                <span><span className="font-semibold">{h.name}</span> · starts {when(h.startsAt)} · {h.members}{h.capacity ? ` of ${h.capacity}` : ""} joined</span>
                <span className="flex gap-1">
                  <Button variant="secondary" className="!min-h-8 !px-3 !text-base" onClick={() => setCohort({ id: h.id, name: h.name, startsAt: localInput(h.startsAt), enrolUntil: localInput(h.enrolUntil), capacity: h.capacity ? String(h.capacity) : "" })}>Edit</Button>
                  <button type="button" aria-label={`Delete ${h.name}`} onClick={() => window.confirm(`Delete ${h.name}?`) && void run(() => api.studioDeleteCohort(h.id), "Intake deleted.")} className="p-2 text-ink-500 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                </span>
              </li>
            ))}
          </ul>
          {cohort ? (
            <form onSubmit={saveCohort} className="space-y-2 rounded-xl border border-[var(--border-faint)] p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Name" htmlFor={`${fid}-n`}><input id={`${fid}-n`} required maxLength={80} value={cohort.name} onChange={(e) => setCohort({ ...cohort, name: e.target.value })} className={controlCls} placeholder="March intake" /></Field>
                <Field label="Seats (optional)" htmlFor={`${fid}-c`}><input id={`${fid}-c`} type="number" min={1} inputMode="numeric" value={cohort.capacity} onChange={(e) => setCohort({ ...cohort, capacity: e.target.value })} className={controlCls} /></Field>
                <Field label="Starts" htmlFor={`${fid}-s`}><input id={`${fid}-s`} required type="datetime-local" value={cohort.startsAt} onChange={(e) => setCohort({ ...cohort, startsAt: e.target.value })} className={controlCls} /></Field>
                <Field label="Join until (optional)" htmlFor={`${fid}-u`} hint="Defaults to the start date"><input id={`${fid}-u`} type="datetime-local" value={cohort.enrolUntil} onChange={(e) => setCohort({ ...cohort, enrolUntil: e.target.value })} className={controlCls} /></Field>
              </div>
              <div className="flex gap-2"><Button type="submit" disabled={busy}>Save intake</Button><Button variant="secondary" onClick={() => setCohort(null)}>Cancel</Button></div>
            </form>
          ) : (
            <Button variant="secondary" onClick={() => setCohort({ id: null, name: "", startsAt: "", enrolUntil: "", capacity: "" })}><Plus className="h-4 w-4" aria-hidden /> Add an intake</Button>
          )}
        </div>
      )}

      {settings.announcementsEnabled && (
        <div className="space-y-2">
          <h4 className="text-base font-bold uppercase tracking-wider text-ink-500">Announcements</h4>
          <div className="space-y-2">
            <input aria-label="Announcement title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className={controlCls} placeholder="Title" />
            <textarea aria-label="Announcement text" rows={2} value={text} onChange={(e) => setText(e.target.value)} maxLength={settings.maxQaChars} className={controlCls} placeholder="What do your learners need to know?" />
            <Button disabled={busy || title.trim().length < 2} onClick={() => void run(() => api.studioPostAnnouncement(courseId, title, text), "Announcement posted.", () => { setTitle(""); setText(""); })}>Post announcement</Button>
          </div>
          <ul className="space-y-1.5">
            {data.announcements.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-2 text-lg text-ink">
                <span><span className="font-semibold">{a.title}</span> <span className="text-base text-ink-500">{when(a.createdAt.replace(" ", "T") + "Z")}</span></span>
                <button type="button" aria-label={`Delete ${a.title}`} onClick={() => void run(() => api.studioDeleteAnnouncement(a.id), "Announcement removed.")} className="text-ink-500 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {settings.qaEnabled && (
        <div className="space-y-2">
          <h4 className="flex items-center gap-1.5 text-base font-bold uppercase tracking-wider text-ink-500"><MessageCircle className="h-3.5 w-3.5" aria-hidden /> Questions ({data.openQuestions} waiting for a teacher)</h4>
          {questions.length === 0 ? <p className="text-base text-ink-500">No questions yet.</p> : <ul className="space-y-2">{questions.slice(0, 20).map((q) => <Answer key={`${q.id}-${q.answers.length}`} q={q} onDone={load} onError={setError} />)}</ul>}
        </div>
      )}

      {settings.reviewsEnabled && (
        <div className="space-y-2">
          <h4 className="flex items-center gap-1.5 text-base font-bold uppercase tracking-wider text-ink-500"><Star className="h-3.5 w-3.5" aria-hidden /> Reviews {data.rating.average !== null && `· ${data.rating.average} from ${data.rating.count}`}</h4>
          {data.reviews.length === 0 ? <p className="text-base text-ink-500">No reviews yet.</p> : (
            <ul className="space-y-2">
              {data.reviews.map((r) => (
                <li key={r.userId} className="space-y-1 rounded-xl border border-[var(--border-faint)] p-3 text-lg text-ink">
                  <p><span className="font-semibold">{r.name}</span> · {"★".repeat(r.rating)}</p>
                  {r.body && <p className="text-base">{r.body}</p>}
                  {r.reply ? <p className="text-base text-ink-500">Your reply: {r.reply}</p> : (
                    <div className="flex gap-2">
                      <input aria-label={`Reply to ${r.name}`} value={replies[r.userId] ?? ""} onChange={(e) => setReplies({ ...replies, [r.userId]: e.target.value })} className={controlCls} placeholder="Reply publicly" />
                      <Button className="!min-h-14 shrink-0 !px-3 !text-base" disabled={busy || !(replies[r.userId] ?? "").trim()} onClick={() => void run(() => api.studioReplyReview(courseId, r.userId, replies[r.userId]!), "Reply posted.")}>Reply</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
