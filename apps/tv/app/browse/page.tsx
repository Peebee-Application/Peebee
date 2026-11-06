"use client";

import { useState } from "react";
import { CourseCard } from "../../components/CourseCard";
import { Message, Screen } from "../../components/Screen";
import { tvApi } from "../../lib/api";
import { useAutoFocus } from "../../lib/dpad";
import { useLoad } from "../../lib/useLoad";

// "Campus" is the university level (stream id "compass"), named the same way as in the Peebee app's menu.
const LEVELS = [
  { id: "all", label: "All" },
  { id: "skills", label: "Skills" },
  { id: "sprouts", label: "Sprouts" },
  { id: "foundations", label: "Basics" },
  { id: "academy", label: "Academy" },
  { id: "compass", label: "Campus" },
];

const ugx = (n: number) => (n > 0 ? `UGX ${n.toLocaleString("en-UG")}` : "Free");

/** Every published course, by level. Looking is free and needs no account; opening a course's lessons needs enrolling. */
export default function BrowsePage() {
  const [level, setLevel] = useState("all");
  const { data, error, loading } = useLoad(() => tvApi.catalog(level), [level]);
  const courses = data?.courses ?? [];
  useAutoFocus(true, `[data-level="${level}"]`);

  return (
    <Screen title="Browse courses" kicker="Peebee Learn">
      <div role="radiogroup" aria-label="Level" className="flex flex-wrap gap-[0.8rem]">
        {LEVELS.map((l) => (
          <button
            key={l.id}
            type="button"
            role="radio"
            aria-checked={level === l.id}
            data-focusable
            data-level={l.id}
            onClick={() => setLevel(l.id)}
            className={`rounded-full px-[1.4rem] py-[0.5rem] text-[1.2rem] font-bold ${level === l.id ? "bg-gold text-ink-gold" : "border border-[var(--border-faint)] text-ink focus:bg-gold focus:text-ink-gold"}`}
          >
            {l.label}
          </button>
        ))}
      </div>
      {loading && <Message>Loading courses…</Message>}
      {error && <Message tone="error">{error.message}</Message>}
      {!loading && !error && courses.length === 0 && <Message>No courses here. Try another level.</Message>}
      {courses.length > 0 && (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-[1.3rem]">
          {courses.map((c) => (
            <li key={c.id}>
              <CourseCard id={c.id} href={`/course/${c.id}`} title={c.title} subtitle={`${c.schoolName} · ${c.lessonCount} lesson${c.lessonCount === 1 ? "" : "s"}`} badge={ugx(c.priceUgx)} />
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}
