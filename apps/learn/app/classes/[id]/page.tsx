"use client";

import type { StudioClass, StudioCourse, StudioSchool } from "@peebee/shared";
import { BookOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { LearnThumb } from "@peebee/shared/learn-thumb";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ClassForm, CourseForm, type ClassInput, type CourseInput } from "../../../components/studio/forms";
import { Button, Chip, Crumbs, EmptyState, Notice, Skeleton, cardCls } from "../../../components/ui";
import { api, errorMessage } from "../../../lib/api";
import { useStudioSettings } from "../../../lib/studio-config";
import { STREAM_UI, formatUgx, plural } from "../../../lib/streams";
import { CURRICULUM_FRAMEWORKS } from "@peebee/shared";

export default function ClassPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const settings = useStudioSettings();
  const [cls, setCls] = useState<StudioClass | null>(null);
  const [school, setSchool] = useState<StudioSchool | null>(null);
  const [courses, setCourses] = useState<StudioCourse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [mode, setMode] = useState<"none" | "course" | "edit">("none");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const found = await api.studioClass(id);
      const [owner, list] = await Promise.all([api.studioSchool(found.class.schoolId), api.studioCourses(id)]);
      setCls(found.class);
      setSchool(owner.school);
      setCourses(list.courses);
    } catch (err) {
      setCourses([]);
      setCls(null);
      setError(errorMessage(err));
    }
  }, [id]);

  useEffect(() => {
    void load();
    if (new URLSearchParams(window.location.search).has("new")) setMode("course");
  }, [load]);

  const suspended = school?.status === "suspended";
  const canBuild = settings.enabled && !suspended;
  const limitReached = (courses?.length ?? 0) >= settings.maxCoursesPerClass;

  async function createCourse(input: CourseInput) {
    setBusy(true);
    setFormError(null);
    try {
      const res = await api.studioCreateCourse(id, input);
      router.push(`/courses/${res.course.id}`);
    } catch (err) {
      setFormError(errorMessage(err));
      setBusy(false);
    }
  }

  async function saveClass(input: ClassInput) {
    setBusy(true);
    setFormError(null);
    try {
      const { stream: _stream, ...rest } = input;
      await api.studioUpdateClass(id, rest);
      setMode("none");
      await load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeClass() {
    if (!cls) return;
    if (!window.confirm(`Delete “${cls.name}” and its ${cls.courseCount} courses with all their lessons? This can't be undone.`)) return;
    setBusy(true);
    try {
      await api.studioDeleteClass(id);
      router.replace(`/schools/${cls.schoolId}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (courses === null) return <Skeleton className="h-64" />;
  if (!cls || !school) {
    return (
      <div className="space-y-4">
        <Crumbs items={[{ label: "Schools", href: "/schools" }, { label: "Not found" }]} />
        <Notice tone="error">{error ?? "That class wasn't found."}</Notice>
      </div>
    );
  }

  const ui = STREAM_UI[cls.stream];
  const framework = CURRICULUM_FRAMEWORKS.find((f) => f.id === cls.framework)?.label ?? "Own syllabus";

  return (
    <div className="space-y-5 pb-6">
      <Crumbs items={[{ label: "Schools", href: "/schools" }, { label: school.name, href: `/schools/${school.id}` }, { label: cls.name }]} />

      <header className={`${cardCls} space-y-3 p-4 sm:p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap gap-1.5">
              <Chip tone="gold">{ui.title}</Chip>
              <Chip>{cls.kind === "masterclass" ? "Masterclass" : "Class"}</Chip>
            </div>
            <h2 className="font-display text-2xl font-semibold text-ink">{cls.name}</h2>
            <p className="text-base text-ink-500">{[cls.level, cls.academicYear, cls.term].filter(Boolean).join(" · ")}</p>
          </div>
          {canBuild && mode === "none" && (
            <Button variant="secondary" onClick={() => setMode("edit")}>
              <Pencil className="h-4 w-4" aria-hidden /> Edit details
            </Button>
          )}
        </div>
        {cls.summary && <p className="text-lg text-ink-500">{cls.summary}</p>}
        <dl className="grid grid-cols-2 gap-3 border-t border-[var(--border-faint)] pt-3 text-base sm:grid-cols-4">
          <div>
            <dt className="text-ink-500">Syllabus</dt>
            <dd className="font-semibold text-ink">{framework}</dd>
          </div>
          <div>
            <dt className="text-ink-500">Teacher</dt>
            <dd className="font-semibold text-ink">{cls.teacherName || "Not set"}</dd>
          </div>
          <div>
            <dt className="text-ink-500">Seats</dt>
            <dd className="font-semibold text-ink">{cls.capacity}</dd>
          </div>
          <div>
            <dt className="text-ink-500">Courses</dt>
            <dd className="font-semibold text-ink">{courses.length}</dd>
          </div>
        </dl>
      </header>

      {suspended && <Notice tone="error">This school has been suspended by Peebee, so it can&apos;t be edited.</Notice>}
      {!settings.enabled && !suspended && <Notice tone="info">The Studio is switched off right now, so nothing can be created or edited.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      {mode === "edit" && (
        <ClassForm
          settings={settings}
          school={school}
          initial={cls}
          title="Class details"
          submitLabel="Save changes"
          busy={busy}
          error={formError}
          onSubmit={saveClass}
          onCancel={() => {
            setMode("none");
            setFormError(null);
          }}
        />
      )}

      {mode === "course" && (
        <CourseForm
          settings={settings}
          stream={cls.stream}
          defaultFramework={cls.framework}
          title="Create a course"
          submitLabel="Create course"
          busy={busy}
          error={formError}
          onSubmit={createCourse}
          onCancel={() => {
            setMode("none");
            setFormError(null);
          }}
        />
      )}

      <section aria-labelledby="courses-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 id="courses-heading" className="text-base font-semibold text-ink">
            Courses in this class
          </h3>
          {canBuild && mode !== "course" && courses.length > 0 && (
            <Button onClick={() => setMode("course")} disabled={limitReached}>
              <Plus className="h-4 w-4" aria-hidden /> New course
            </Button>
          )}
        </div>
        {limitReached && <Notice tone="info">A class can have up to {settings.maxCoursesPerClass} courses.</Notice>}

        {courses.length === 0 ? (
          mode !== "course" && (
            <EmptyState
              icon={BookOpen}
              title="Create the first course"
              body="A course is one subject taught in this class. Next you add its modules and lessons."
              action={
                canBuild ? (
                  <Button onClick={() => setMode("course")}>
                    <Plus className="h-4 w-4" aria-hidden /> Create a course
                  </Button>
                ) : undefined
              }
            />
          )
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {courses.map((course) => (
              <li key={course.id}>
                <Link href={`/courses/${course.id}`} className={`${cardCls} block space-y-2 overflow-hidden transition hover:border-gold/50 hover:shadow-[var(--shadow-card-hover)]`}>
                  <LearnThumb src={api.learnArtUrl("course", course.id)} />
                  <div className="space-y-2 px-4 pb-4">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="min-w-0 text-lg font-semibold text-ink">{course.title}</h4>
                    <Chip tone={course.status === "published" ? "green" : "muted"}>{course.status === "published" ? "Live" : "Draft"}</Chip>
                  </div>
                  {course.summary && <p className="line-clamp-2 text-base text-ink-500">{course.summary}</p>}
                  <p className="text-base text-ink-500">
                    {plural(course.moduleCount, "module")} · {plural(course.lessonCount, "lesson")} · {formatUgx(course.priceUgx)}
                  </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canBuild && (
        <section aria-labelledby="danger-heading" className={`${cardCls} flex flex-wrap items-center justify-between gap-3 p-4`}>
          <div>
            <h3 id="danger-heading" className="text-lg font-semibold text-ink">
              Delete this class
            </h3>
            <p className="text-base text-ink-500">Removes the class with its courses and lessons.</p>
          </div>
          <Button variant="danger" onClick={removeClass} disabled={busy}>
            <Trash2 className="h-4 w-4" aria-hidden /> Delete class
          </Button>
        </section>
      )}
    </div>
  );
}
