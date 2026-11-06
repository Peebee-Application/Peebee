"use client";

import { EDUCATION_STREAMS, type StudioSchool } from "@peebee/shared";
import { GraduationCap, Plus } from "lucide-react";
import { LearnThumb } from "@peebee/shared/learn-thumb";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { SchoolForm, type SchoolInput } from "../../components/studio/forms";
import { Button, Chip, EmptyState, Notice, Skeleton, cardCls } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { useStudioSettings } from "../../lib/studio-config";
import { STREAM_UI, plural } from "../../lib/streams";

export default function SchoolsPage() {
  const router = useRouter();
  const settings = useStudioSettings();
  const [schools, setSchools] = useState<StudioSchool[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shared, setShared] = useState<{ id: string; title: string; schoolName: string; status: string }[]>([]);

  useEffect(() => {
    api.studioSharedCourses().then((r) => setShared(r.courses)).catch(() => setShared([]));
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      setSchools((await api.studioSchools()).schools);
    } catch (err) {
      setSchools([]);
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
    // "?new=1" opens the form straight away (used by the home page's next step).
    if (new URLSearchParams(window.location.search).has("new")) setCreating(true);
  }, [load]);

  async function create(input: SchoolInput) {
    setBusy(true);
    setFormError(null);
    try {
      const res = await api.studioCreateSchool(input);
      router.push(`/schools/${res.school.id}?new=1`);
    } catch (err) {
      setFormError(errorMessage(err));
      setBusy(false);
    }
  }

  const atLimit = (schools?.length ?? 0) >= settings.maxSchoolsPerUser;

  return (
    <div className="space-y-5 pb-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-black text-ink"><GraduationCap className="h-7 w-7 text-gold" aria-hidden /> Schools</h1>
        {!creating && (
          <Button onClick={() => setCreating(true)} disabled={atLimit || !settings.enabled}>
            <Plus className="h-6 w-6" aria-hidden /> New school
          </Button>
        )}
      </header>

      {!settings.enabled && <Notice tone="info">The Studio is off right now. Published courses stay visible.</Notice>}
      {atLimit && settings.enabled && !creating && (
        <Notice tone="info">Limit of {settings.maxSchoolsPerUser} schools reached.</Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}

      {creating && (
        <SchoolForm
          settings={settings}
          title="Create your school"
          submitLabel="Create school"
          busy={busy}
          error={formError}
          onSubmit={create}
          onCancel={() => {
            setCreating(false);
            setFormError(null);
          }}
        />
      )}

      {schools === null ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : schools.length === 0 ? (
        !creating && (
          <EmptyState
            icon={GraduationCap}
            title="Start with a school"
            body="Classes, courses and lessons live in it."
            action={
              <Button onClick={() => setCreating(true)}>
                <Plus className="h-6 w-6" aria-hidden /> Create your school
              </Button>
            }
          />
        )
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {schools.map((school) => (
            <li key={school.id}>
              <Link href={`/schools/${school.id}`} className={`${cardCls} block space-y-3 overflow-hidden transition hover:border-gold/50 hover:shadow-[var(--shadow-card-hover)]`}>
                <div className="h-28 overflow-hidden [&>*]:!aspect-auto [&>*]:!h-full [&_img]:h-full [&_img]:w-full [&_img]:object-cover">
                  <LearnThumb src={api.learnArtUrl("school", school.id)} />
                </div>
                <div className="space-y-3 px-4 pb-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-xl font-bold text-ink">{school.name}</h3>
                    <p className="truncate text-base text-ink-500">{school.tagline || school.location || "No description yet"}</p>
                  </div>
                  {school.status === "suspended" && <Chip tone="gold">Suspended</Chip>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {EDUCATION_STREAMS.filter((s) => school.streams.includes(s.id)).map((s) => (
                    <Chip key={s.id}>{STREAM_UI[s.id].title}</Chip>
                  ))}
                </div>
                <p className="text-base text-ink-500">
                  {plural(school.classCount, "class", "classes")} · {plural(school.courseCount, "course")} ({school.publishedCourseCount} live) · {plural(school.lessonCount, "lesson")}
                </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {shared.length > 0 && (
        <section aria-labelledby="shared-heading" className="space-y-2">
          <h3 id="shared-heading" className="text-lg font-semibold text-ink">Courses you teach with others</h3>
          <ul className="space-y-2">
            {shared.map((c) => (
              <li key={c.id}>
                <Link href={`/courses/${c.id}`} className={`${cardCls} flex items-center justify-between gap-3 p-3 hover:border-gold/50`}>
                  <span className="min-w-0"><span className="block truncate text-lg font-semibold text-ink">{c.title}</span><span className="block text-base text-ink-500">{c.schoolName}</span></span>
                  <Chip tone={c.status === "published" ? "green" : "muted"}>{c.status === "published" ? "Live" : "Draft"}</Chip>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
