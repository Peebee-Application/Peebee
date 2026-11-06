"use client";

import type { EducationStream, StudioClass, StudioSchool } from "@peebee/shared";
import { Layers, Pencil, Plus, Receipt, Ticket, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CoverPicker } from "../../../components/studio/CoverPicker";
import { ClassForm, SchoolForm, type ClassInput, type SchoolInput } from "../../../components/studio/forms";
import { Button, Chip, Crumbs, EmptyState, LinkButton, Notice, Skeleton, cardCls } from "../../../components/ui";
import { api, errorMessage } from "../../../lib/api";
import { useLearnAuth } from "../../../lib/auth-context";
import { useStudioSettings } from "../../../lib/studio-config";
import { STREAM_UI, plural } from "../../../lib/streams";

export default function SchoolPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const settings = useStudioSettings();
  const { activeStream } = useLearnAuth();
  const [school, setSchool] = useState<StudioSchool | null>(null);
  const [classes, setClasses] = useState<StudioClass[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [mode, setMode] = useState<"none" | "class" | "edit">("none");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [found, list] = await Promise.all([api.studioSchool(id), api.studioClasses(id)]);
      setSchool(found.school);
      setClasses(list.classes);
    } catch (err) {
      setClasses([]);
      setSchool(null);
      setError(errorMessage(err));
    }
  }, [id]);

  useEffect(() => {
    void load();
    if (new URLSearchParams(window.location.search).has("new")) setMode("class");
  }, [load]);

  const byStream = useMemo(() => {
    const groups = new Map<EducationStream, StudioClass[]>();
    for (const cls of classes ?? []) groups.set(cls.stream, [...(groups.get(cls.stream) ?? []), cls]);
    return [...groups.entries()];
  }, [classes]);

  const lockedStreams = useMemo(() => [...new Set((classes ?? []).map((c) => c.stream))], [classes]);
  const suspended = school?.status === "suspended";
  const canBuild = settings.enabled && !suspended;
  const classLimitReached = (classes?.length ?? 0) >= settings.maxClassesPerSchool;

  async function createClass(input: ClassInput) {
    setBusy(true);
    setFormError(null);
    try {
      const res = await api.studioCreateClass(id, input);
      router.push(`/classes/${res.class.id}?new=1`);
    } catch (err) {
      setFormError(errorMessage(err));
      setBusy(false);
    }
  }

  async function saveSchool(input: SchoolInput) {
    setBusy(true);
    setFormError(null);
    try {
      await api.studioUpdateSchool(id, input);
      setMode("none");
      await load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeSchool() {
    if (!school) return;
    if (!window.confirm(`Delete “${school.name}” and everything in it (${school.classCount} classes, ${school.courseCount} courses, ${school.lessonCount} lessons)? This can't be undone.`)) return;
    setBusy(true);
    try {
      await api.studioDeleteSchool(id);
      router.replace("/schools");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (classes === null) return <Skeleton className="h-64" />;
  if (!school) {
    return (
      <div className="space-y-4">
        <Crumbs items={[{ label: "Schools", href: "/schools" }, { label: "Not found" }]} />
        <Notice tone="error">{error ?? "That school wasn't found."}</Notice>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-6">
      <Crumbs items={[{ label: "Schools", href: "/schools" }, { label: school.name }]} />

      <header className={`${cardCls} space-y-3 p-4 sm:p-5`}>
        <CoverPicker kind="school" id={school.id} maxMb={settings.maxCoverMb} disabled={!canBuild} />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap gap-1.5">
              {school.streams.map((s) => (
                <Chip key={s} tone="gold">
                  {STREAM_UI[s].title}
                </Chip>
              ))}
              {suspended && <Chip>Suspended</Chip>}
            </div>
            <h2 className="font-display text-2xl font-semibold text-ink">{school.name}</h2>
            {school.tagline && <p className="text-lg text-ink-500">{school.tagline}</p>}
            <p className="text-base text-ink-500">{[school.location, school.badge].filter(Boolean).join(" · ")}</p>
          </div>
          {mode === "none" && (
            <div className="grid w-full grid-cols-3 gap-2">
              <LinkButton href={`/schools/${school.id}/sales`} variant="secondary" className="!min-h-16 flex-col !gap-0.5 !px-1 !text-base">
                <Ticket className="h-6 w-6 text-gold" aria-hidden /> Sales
              </LinkButton>
              <LinkButton href={`/schools/${school.id}/fees`} variant="secondary" className="!min-h-16 flex-col !gap-0.5 !px-1 !text-base">
                <Receipt className="h-6 w-6 text-gold" aria-hidden /> Fees
              </LinkButton>
              {canBuild && (
                <Button variant="secondary" className="!min-h-16 flex-col !gap-0.5 !px-1 !text-base" onClick={() => setMode("edit")}>
                  <Pencil className="h-6 w-6 text-gold" aria-hidden /> Edit
                </Button>
              )}
            </div>
          )}
        </div>
        <p className="text-base text-ink-500">
          {plural(school.classCount, "class", "classes")} · {plural(school.courseCount, "course")} ({school.publishedCourseCount} live) · {plural(school.lessonCount, "lesson")}
        </p>
      </header>

      {suspended && <Notice tone="error">Suspended by Peebee. Contact support.</Notice>}
      {!settings.enabled && !suspended && <Notice tone="info">The Studio is off right now.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      {mode === "edit" && (
        <SchoolForm
          settings={settings}
          initial={school}
          lockedStreams={lockedStreams}
          title="School details"
          submitLabel="Save changes"
          busy={busy}
          error={formError}
          onSubmit={saveSchool}
          onCancel={() => {
            setMode("none");
            setFormError(null);
          }}
        />
      )}

      {mode === "class" && (
        <ClassForm
          settings={settings}
          school={school}
          presetStream={activeStream}
          title="Add a class or masterclass"
          submitLabel="Create class"
          busy={busy}
          error={formError}
          onSubmit={createClass}
          onCancel={() => {
            setMode("none");
            setFormError(null);
          }}
        />
      )}

      <section aria-labelledby="classes-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 id="classes-heading" className="text-base font-semibold text-ink">
            Classes and masterclasses
          </h3>
          {canBuild && mode !== "class" && classes.length > 0 && (
            <Button onClick={() => setMode("class")} disabled={classLimitReached}>
              <Plus className="h-4 w-4" aria-hidden /> Add class
            </Button>
          )}
        </div>
        {classLimitReached && <Notice tone="info">A school can have up to {settings.maxClassesPerSchool} classes.</Notice>}

        {classes.length === 0 ? (
          mode !== "class" && (
            <EmptyState
              icon={Layers}
              title="Add your first class"
              body="A class is a cohort such as Primary 4 Blue, or a short masterclass anyone can join. Courses and lessons are taught inside it."
              action={
                canBuild ? (
                  <Button onClick={() => setMode("class")}>
                    <Plus className="h-4 w-4" aria-hidden /> Add a class
                  </Button>
                ) : undefined
              }
            />
          )
        ) : (
          byStream.map(([stream, list]) => {
            const ui = STREAM_UI[stream];
            const Icon = ui.icon;
            return (
              <div key={stream} className="space-y-2">
                <h4 className="flex items-center gap-2 text-base font-bold uppercase tracking-wider text-ink-500">
                  <Icon className="h-4 w-4 text-gold" aria-hidden /> {ui.title} · {ui.audience}
                </h4>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {list.map((cls) => (
                    <li key={cls.id}>
                      <Link href={`/classes/${cls.id}`} className={`${cardCls} block space-y-2 p-4 transition hover:border-gold/50 hover:shadow-[var(--shadow-card-hover)]`}>
                        <div className="flex items-start justify-between gap-2">
                          <h5 className="min-w-0 text-lg font-semibold text-ink">{cls.name}</h5>
                          <Chip tone={cls.kind === "masterclass" ? "gold" : "muted"}>{cls.kind === "masterclass" ? "Masterclass" : "Class"}</Chip>
                        </div>
                        <p className="text-base text-ink-500">{[cls.level, cls.academicYear, cls.term].filter(Boolean).join(" · ")}</p>
                        <p className="text-base text-ink-500">
                          {cls.courseCount} {cls.courseCount === 1 ? "course" : "courses"}
                          {cls.teacherName ? ` · ${cls.teacherName}` : ""}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </section>

      {canBuild && (
        <section aria-labelledby="danger-heading" className={`${cardCls} flex flex-wrap items-center justify-between gap-3 p-4`}>
          <div>
            <h3 id="danger-heading" className="text-lg font-semibold text-ink">
              Delete this school
            </h3>
            <p className="text-base text-ink-500">Removes the school with all of its classes, courses and lessons.</p>
          </div>
          <Button variant="danger" onClick={removeSchool} disabled={busy}>
            <Trash2 className="h-4 w-4" aria-hidden /> Delete school
          </Button>
        </section>
      )}
    </div>
  );
}
