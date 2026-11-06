"use client";

import type { LiveSessionSummary, StudioCourse, StudioSchool, TvDevice } from "@peebee/shared";
import { Monitor, Play, Radio } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { Button, Chip, EmptyState, Field, LinkButton, Notice, Skeleton, cardCls, controlCls } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { ProChip, ProUpgrade } from "../../components/ProNotice";
import { useTvAccess } from "../../lib/pro";
import { useStudioSettings } from "../../lib/studio-config";

export default function ClassroomPage() {
  const router = useRouter();
  const settings = useStudioSettings();
  const { status: pro, allowed } = useTvAccess();
  const id = useId();
  const [sessions, setSessions] = useState<LiveSessionSummary[] | null>(null);
  const [schools, setSchools] = useState<StudioSchool[]>([]);
  const [devices, setDevices] = useState<TvDevice[]>([]);
  const [courses, setCourses] = useState<StudioCourse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [schoolId, setSchoolId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [screenId, setScreenId] = useState("");
  const [autoCues, setAutoCues] = useState(true);

  const load = useCallback(async () => {
    try {
      const [s, sc, d] = await Promise.all([api.classroomSessions(), api.studioSchools(), api.tvDevices().catch(() => ({ devices: [] as TvDevice[] }))]);
      setSessions(s.sessions);
      setSchools(sc.schools);
      setDevices(d.devices);
      setSchoolId((current) => current || sc.schools[0]?.id || "");
      setError(null);
    } catch (err) {
      setSessions([]);
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The courses of the chosen school, across its classes.
  useEffect(() => {
    setCourseId("");
    if (!schoolId) return setCourses([]);
    let cancelled = false;
    (async () => {
      try {
        const classes = (await api.studioClasses(schoolId)).classes;
        const lists = await Promise.all(classes.map((c) => api.studioCourses(c.id).then((r) => r.courses)));
        if (!cancelled) setCourses(lists.flat());
      } catch {
        if (!cancelled) setCourses([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  async function start(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const res = await api.classroomCreate({
        title: title.trim(),
        schoolId,
        courseId: courseId || undefined,
        screenDeviceId: screenId || undefined,
        autoCues: Boolean(courseId) && autoCues,
      });
      router.push(`/classroom/${res.session.id}`);
    } catch (err) {
      setFormError(errorMessage(err));
      setBusy(false);
    }
  }

  const live = (sessions ?? []).filter((s) => s.status === "live");
  const past = (sessions ?? []).filter((s) => s.status !== "live");
  const freeScreens = devices.filter((d) => !d.sessionId);

  return (
    <div className="space-y-5 pb-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-black text-ink"><Radio className="h-7 w-7 text-gold" aria-hidden /> Live</h1>
        <div className="flex w-full flex-wrap gap-2">
          <LinkButton href="/screens" variant="secondary">
            <Monitor className="h-6 w-6" aria-hidden /> Screens <ProChip status={pro} />
          </LinkButton>
          {!starting && (
            <Button className="flex-1" onClick={() => setStarting(true)} disabled={schools.length === 0 || !settings.liveEnabled}>
              <Play className="h-6 w-6" aria-hidden /> Start a class
            </Button>
          )}
        </div>
      </header>

      {pro && <ProUpgrade status={pro} />}
      {!settings.liveEnabled && <Notice tone="info">Live classes are off right now.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {sessions !== null && schools.length === 0 && (
        <Notice tone="info">
          Create a school first. <Link href="/schools?new=1" className="font-semibold underline">Create a school</Link>
        </Notice>
      )}

      {starting && (
        <form onSubmit={start} className={`${cardCls} space-y-4 p-4 sm:p-5`}>
          <h3 className="text-base font-semibold text-ink">Start a class</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Class title" htmlFor={`${id}-title`} className="sm:col-span-2">
              <input id={`${id}-title`} required minLength={2} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} className={controlCls} placeholder="e.g. Primary 4 Maths: Fractions" />
            </Field>
            <Field label="School" htmlFor={`${id}-school`}>
              <select id={`${id}-school`} value={schoolId} onChange={(e) => setSchoolId(e.target.value)} className={controlCls}>
                {schools.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Course (optional)" htmlFor={`${id}-course`} hint="Pick one to get a ready-made run sheet from its lessons">
              <select id={`${id}-course`} value={courseId} onChange={(e) => setCourseId(e.target.value)} className={controlCls}>
                <option value="">No course, I'll build the run sheet</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={allowed ? "TV screen" : "TV screen (Pro)"} htmlFor={`${id}-screen`} hint={!allowed ? "TV is a Pro feature. Your class can still run on students' phones." : devices.length === 0 ? "No screens connected yet. You can still run a phones-only class." : undefined}>
              <select id={`${id}-screen`} value={screenId} disabled={!allowed} onChange={(e) => setScreenId(e.target.value)} className={controlCls}>
                <option value="">Phones only (no TV)</option>
                {freeScreens.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.online ? "" : " (offline)"}
                  </option>
                ))}
              </select>
            </Field>
            {courseId && (
              <label className="flex items-center gap-2 self-end pb-2 text-lg font-semibold text-ink">
                <input type="checkbox" checked={autoCues} onChange={(e) => setAutoCues(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--color-gold))]" />
                Build the run sheet from its lessons and quizzes
              </label>
            )}
          </div>
          {formError && <Notice tone="error">{formError}</Notice>}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !schoolId}>
              {busy ? "Starting…" : "Start class"}
            </Button>
            <Button variant="secondary" onClick={() => setStarting(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {sessions === null ? (
        <Skeleton className="h-28" />
      ) : sessions.length === 0 ? (
        !starting && <EmptyState icon={Radio} title="No classes yet" body="Start a class to get a join code." />
      ) : (
        <>
          {live.length > 0 && (
            <section aria-labelledby="live-h" className="space-y-2">
              <h3 id="live-h" className="text-lg font-semibold text-ink">
                Live now
              </h3>
              <ul className="space-y-2">
                {live.map((s) => (
                  <li key={s.id}>
                    <Link href={`/classroom/${s.id}`} className={`${cardCls} flex items-center justify-between gap-3 p-4 transition hover:border-gold/50`}>
                      <div className="min-w-0">
                        <p className="truncate text-lg font-semibold text-ink">{s.title}</p>
                        <p className="text-base text-ink-500">
                          Code <span className="font-mono font-bold text-ink">{s.code}</span>
                        </p>
                      </div>
                      <Chip tone="green">Live</Chip>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {past.length > 0 && (
            <section aria-labelledby="past-h" className="space-y-2">
              <h3 id="past-h" className="text-lg font-semibold text-ink">
                Earlier classes
              </h3>
              <ul className="space-y-2">
                {past.map((s) => (
                  <li key={s.id} className={`${cardCls} flex items-center justify-between gap-3 p-4`}>
                    <p className="truncate text-lg font-semibold text-ink">{s.title}</p>
                    <span className="shrink-0 text-base text-ink-500">{s.createdAt.slice(0, 10)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
