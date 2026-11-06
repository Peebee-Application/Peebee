"use client";

import { EDUCATION_STREAMS, type EducationStream, type StudioSchool } from "@peebee/shared";
import { ArrowRight, CheckCircle2, Circle, Eye, MessageSquare, Plus, Radio, School as SchoolIcon, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Accordion } from "../components/Accordion";
import { Chip, EmptyState, LinkButton, Notice, Skeleton, cardCls } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { LearningCreatorLink } from "@peebee/shared/learning-creator-link";
import { useLearnAuth } from "../lib/auth-context";
import { STREAM_UI, plural } from "../lib/streams";

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}


export default function HomePage() {
  const { user, activeStream, setActiveStream } = useLearnAuth();
  const [schools, setSchools] = useState<StudioSchool[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.studioSchools();
      setSchools(res.schools);
    } catch (err) {
      setSchools([]);
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const list = schools ?? [];
    return {
      schools: list.length,
      classes: list.reduce((n, s) => n + s.classCount, 0),
      courses: list.reduce((n, s) => n + s.courseCount, 0),
      published: list.reduce((n, s) => n + s.publishedCourseCount, 0),
      lessons: list.reduce((n, s) => n + s.lessonCount, 0),
    };
  }, [schools]);

  const streamSchools = useMemo(() => (schools ?? []).filter((s) => s.streams.includes(activeStream)), [schools, activeStream]);
  const firstName = user?.name.split(" ")[0] ?? "there";

  // The one next thing to do, in the order a school gets built.
  const first = schools?.[0];
  const steps = [
    { done: totals.schools > 0, label: "Create your school", hint: "Name it and choose who you teach", href: "/schools?new=1" },
    { done: totals.classes > 0, label: "Add a class or masterclass", hint: "Pick the level and the syllabus", href: first ? `/schools/${first.id}?new=1` : "/schools?new=1" },
    { done: totals.courses > 0, label: "Create a course", hint: "A subject taught in that class", href: first ? `/schools/${first.id}` : "/schools" },
    { done: totals.lessons > 0, label: "Add modules and lessons", hint: "Build the syllabus, lesson by lesson", href: first ? `/schools/${first.id}` : "/schools" },
    { done: totals.published > 0, label: "Publish", hint: "Make the course visible to learners", href: first ? `/schools/${first.id}` : "/schools" },
  ];
  const next = steps.find((s) => !s.done);
  const allDone = !next && schools !== null;

  return (
    <div className="space-y-4 pb-6">
      <LearningCreatorLink api={api} href="/create" label="AI-assisted course authoring" />
      <h1 className="text-lg font-bold text-gold">
        {greeting()}, {firstName}
      </h1>

      {/* The one next thing to do */}
      <section className="space-y-3">
        {totals.schools === 0 && schools !== null ? (
          <LinkButton href="/schools?new=1" className="w-full !min-h-16 !text-xl">
            <Plus className="h-6 w-6" aria-hidden /> Create your school
          </LinkButton>
        ) : (
          next && (
            <LinkButton href={next.href} className="w-full !min-h-16 !text-xl">
              {next.label} <ArrowRight className="h-6 w-6" aria-hidden />
            </LinkButton>
          )
        )}
        <LinkButton href="/classroom" variant="secondary" className="w-full">
          <Radio className="h-6 w-6 text-gold" aria-hidden /> Host a live class
        </LinkButton>
      </section>

      {error && (
        <Notice tone="error">
          <p>{error}</p>
          <button type="button" onClick={() => void load()} className="mt-1 min-h-12 text-lg font-bold text-gold underline">
            Try again
          </button>
        </Notice>
      )}

      {/* Streams */}
      <section aria-labelledby="streams-heading" className="space-y-2">
        <h2 id="streams-heading" className="text-xl font-bold text-ink">
          What do you teach?
        </h2>
        <div role="tablist" aria-label="Learning streams" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {EDUCATION_STREAMS.map((stream) => {
            const ui = STREAM_UI[stream.id];
            const Icon = ui.icon;
            const selected = activeStream === stream.id;
            return (
              <button
                key={stream.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveStream(stream.id as EducationStream)}
                className={`flex min-h-16 shrink-0 items-center gap-2 rounded-2xl border px-4 text-lg font-bold transition ${
                  selected ? "border-gold bg-gold text-ink-gold" : "border-[var(--border-faint)] bg-[rgb(var(--surface-card))] text-ink"
                }`}
              >
                <Icon className="h-6 w-6" aria-hidden />
                {ui.title}
              </button>
            );
          })}
        </div>
        <p className="text-lg text-ink-500">{STREAM_UI[activeStream].audience}</p>
      </section>

      {/* Progress or numbers */}
      {schools === null ? (
        <Skeleton className="h-40" />
      ) : allDone ? (
        <section aria-label="Your studio at a glance" className="grid grid-cols-4 gap-2">
          {[
            { label: "Schools", value: totals.schools },
            { label: "Classes", value: totals.classes },
            { label: "Live", value: `${totals.published}/${totals.courses}` },
            { label: "Lessons", value: totals.lessons },
          ].map((kpi) => (
            <div key={kpi.label} className={`${cardCls} px-1 py-3 text-center`}>
              <p className="text-2xl font-black text-ink">{kpi.value}</p>
              <p className="text-base text-ink-500">{kpi.label}</p>
            </div>
          ))}
        </section>
      ) : (
        <Accordion title="Get your first course live" icon={Sparkles} summary={`${steps.filter((s) => s.done).length}/${steps.length}`} defaultOpen>
          <ol className="space-y-2">
            {steps.map((step) => {
              const isNext = step === next;
              return (
                <li key={step.label}>
                  <Link
                    href={step.href}
                    aria-current={isNext ? "step" : undefined}
                    className={`flex min-h-16 items-center gap-3 rounded-xl border px-3.5 py-3 transition ${
                      isNext ? "border-gold bg-gold/10" : "border-[var(--border-faint)]"
                    }`}
                  >
                    {step.done ? <CheckCircle2 className="h-6 w-6 shrink-0 text-green" aria-label="Done" /> : <Circle className="h-6 w-6 shrink-0 text-ink-500" aria-label="To do" />}
                    <span className={`min-w-0 flex-1 text-lg font-bold ${step.done ? "text-ink-500 line-through" : "text-ink"}`}>{step.label}</span>
                    {isNext && <ArrowRight className="h-5 w-5 shrink-0 text-gold" aria-hidden />}
                  </Link>
                </li>
              );
            })}
          </ol>
        </Accordion>
      )}

      {/* Schools */}
      <section aria-labelledby="schools-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="schools-heading" className="text-xl font-bold text-ink">
            Your schools
          </h2>
          <Link href="/schools" className="flex min-h-12 items-center text-lg font-bold text-gold">
            See all
          </Link>
        </div>
        {schools === null ? (
          <Skeleton className="h-28" />
        ) : streamSchools.length === 0 ? (
          <EmptyState
            icon={SchoolIcon}
            title={totals.schools === 0 ? "No school yet" : `None teach ${STREAM_UI[activeStream].title}`}
            body={totals.schools === 0 ? "Takes about a minute." : "Add it to a school or start a new one."}
            action={
              <LinkButton href="/schools?new=1">
                <Plus className="h-5 w-5" aria-hidden /> Create a school
              </LinkButton>
            }
          />
        ) : (
          <div className="space-y-3">
            {streamSchools.slice(0, 4).map((school) => (
              <Link key={school.id} href={`/schools/${school.id}`} className={`${cardCls} block space-y-2 p-4`}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="min-w-0 truncate text-xl font-bold text-ink">{school.name}</h3>
                  {school.status === "suspended" && <Chip tone="gold">Suspended</Chip>}
                </div>
                <p className="text-lg text-ink-500">
                  {plural(school.classCount, "class", "classes")} · {plural(school.courseCount, "course")} · {plural(school.lessonCount, "lesson")}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Tools */}
      <section aria-label="More tools" className="grid grid-cols-3 gap-3">
        {[
          { href: "/classroom", icon: Radio, title: "Live" },
          { href: "/chat", icon: MessageSquare, title: "Chat" },
          { href: "/streams", icon: Eye, title: "Preview" },
        ].map((tool) => (
          <Link key={tool.href} href={tool.href} className={`${cardCls} flex min-h-24 flex-col items-center justify-center gap-2 p-3 text-center`}>
            <tool.icon className="h-8 w-8 text-gold" aria-hidden />
            <span className="text-lg font-bold text-ink">{tool.title}</span>
          </Link>
        ))}
      </section>
    </div>
  );
}
