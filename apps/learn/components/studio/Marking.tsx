"use client";

import type { Gradebook, StudioAssignment, StudioSubmission } from "@peebee/shared";
import { Download } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { Button, Notice, cardCls, controlCls } from "../ui";

function Row({ s, a, onSaved }: { s: StudioSubmission; a: StudioAssignment; onSaved: () => void }) {
  const [score, setScore] = useState(s.score === null ? "" : String(s.score));
  const [feedback, setFeedback] = useState(s.feedback);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const n = Number(score);
    if (!Number.isInteger(n) || n < 0 || n > a.maxPoints) return setError(`Give a whole number from 0 to ${a.maxPoints}.`);
    setBusy(true);
    setError(null);
    try {
      await api.studioGradeSubmission(s.id, n, feedback);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="space-y-2 rounded-xl border border-[var(--border-faint)] p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-lg font-semibold text-ink">{s.learnerName}</p>
        <span className={`shrink-0 text-base font-semibold ${s.status === "graded" ? "text-green" : "text-gold"}`}>{s.status === "graded" ? `Marked ${s.score}/${a.maxPoints}` : "Waiting to be marked"}</span>
      </div>
      {s.body && <p className="whitespace-pre-line text-lg text-ink">{s.body}</p>}
      {s.link && (
        <a href={s.link} target="_blank" rel="noopener noreferrer" className="block break-all text-base font-semibold text-gold underline">
          {s.link}
        </a>
      )}
      <div className="grid gap-2 sm:grid-cols-[6rem_1fr_auto] sm:items-end">
        <label className="space-y-1 text-base font-semibold text-ink-500">
          Points (of {a.maxPoints})
          <input type="number" min={0} max={a.maxPoints} inputMode="numeric" value={score} onChange={(e) => setScore(e.target.value)} className={controlCls} />
        </label>
        <label className="space-y-1 text-base font-semibold text-ink-500">
          Feedback
          <input maxLength={2000} value={feedback} onChange={(e) => setFeedback(e.target.value)} className={controlCls} />
        </label>
        <Button onClick={save} disabled={busy}>
          {busy ? "Saving…" : s.status === "graded" ? "Update mark" : "Save mark"}
        </Button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </li>
  );
}

/** What learners handed in for one assignment, with a mark and feedback box for each. */
export function Marking({ lessonId, onChanged }: { lessonId: string; onChanged: () => void }) {
  const [data, setData] = useState<{ assignment: StudioAssignment | null; submissions: StudioSubmission[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api.studioSubmissions(lessonId).then(setData).catch((err) => setError(errorMessage(err)));
  }, [lessonId]);
  useEffect(load, [load]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <p className="text-base text-ink-500">Loading…</p>;
  if (!data.assignment) return <p className="text-base text-ink-500">This assignment has no settings yet.</p>;
  if (data.submissions.length === 0) return <p className="text-base text-ink-500">Nothing has been handed in yet.</p>;
  return (
    <ul className="space-y-2">
      {data.submissions.map((s) => (
        <Row key={`${s.id}-${s.submittedAt}-${s.score}`} s={s} a={data.assignment!} onSaved={() => { load(); onChanged(); }} />
      ))}
    </ul>
  );
}

const csvCell = (v: string | number | null) => {
  const t = v === null ? "" : String(v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/** Every learner against every item: done, and the mark where there is one. */
export function GradebookTable({ courseId, refreshKey }: { courseId: string; refreshKey: number }) {
  const [book, setBook] = useState<Gradebook | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.studioGradebook(courseId).then((r) => setBook(r.gradebook)).catch((err) => setError(errorMessage(err)));
  }, [courseId, refreshKey]);

  function download() {
    if (!book) return;
    const header = ["Learner", "Progress %", "Average %", ...book.items.map((i) => i.title)];
    const lines = [header, ...book.rows.map((r) => [r.name, r.progressPercent, r.averagePercent, ...r.cells.map((c) => (c.scorePercent !== null ? c.scorePercent : c.done ? "done" : ""))])];
    const blob = new Blob([lines.map((l) => l.map((v) => csvCell(v as string | number | null)).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "gradebook.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <section aria-labelledby="gradebook-heading" className={`${cardCls} space-y-3 p-4`}>
      <div className="flex items-center justify-between gap-3">
        <h3 id="gradebook-heading" className="text-lg font-semibold text-ink">
          Gradebook
        </h3>
        {book && book.rows.length > 0 && (
          <Button variant="secondary" className="!min-h-8 !px-3 !text-base" onClick={download}>
            <Download className="h-3.5 w-3.5" aria-hidden /> Download CSV
          </Button>
        )}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {!book ? (
        <p className="text-base text-ink-500">Loading…</p>
      ) : book.rows.length === 0 ? (
        <p className="text-base text-ink-500">Marks appear here once learners enrol.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-base">
            <thead>
              <tr className="border-b border-[var(--border-faint)] text-ink-500">
                <th className="sticky left-0 bg-[rgb(var(--surface-card))] py-2 pr-3 font-semibold">Learner</th>
                <th className="px-2 py-2 font-semibold">Done</th>
                <th className="px-2 py-2 font-semibold">Avg</th>
                {book.items.map((i) => (
                  <th key={i.lessonId} className="max-w-[8rem] truncate px-2 py-2 font-semibold" title={i.title}>
                    {i.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {book.rows.map((r) => (
                <tr key={r.userId} className="border-b border-[var(--border-faint)] text-ink">
                  <td className="sticky left-0 bg-[rgb(var(--surface-card))] py-2 pr-3 font-semibold">{r.name}</td>
                  <td className="px-2 py-2">{r.progressPercent}%</td>
                  <td className="px-2 py-2">{r.averagePercent === null ? "–" : `${r.averagePercent}%`}</td>
                  {r.cells.map((c) => (
                    <td key={c.lessonId} className="px-2 py-2">
                      {c.needsMarking ? <span className="font-semibold text-gold">To mark</span> : c.scorePercent !== null ? `${c.scorePercent}%` : c.done ? "✓" : "–"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
