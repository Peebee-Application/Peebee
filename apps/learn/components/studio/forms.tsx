"use client";

import {
  EDUCATION_STREAMS,
  SCHOOL_KINDS,
  STREAM_LEVELS,
  frameworksForStream,
  type ClassKind,
  type CurriculumFramework,
  type EducationStream,
  type LearnSettings,
  type SchoolKind,
  type StudioClass,
  type StudioCourse,
  type StudioSchool,
} from "@peebee/shared";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { STREAM_UI } from "../../lib/streams";
import { Button, Field, Notice, Segmented, cardCls, controlCls } from "../ui";

type FormShellProps = { title: string; children: ReactNode; onSubmit: (e: FormEvent) => void; error: string | null; busy: boolean; submitLabel: string; onCancel?: () => void };

function FormShell({ title, children, onSubmit, error, busy, submitLabel, onCancel }: FormShellProps) {
  return (
    <form onSubmit={onSubmit} className={`${cardCls} space-y-4 p-4 sm:p-5`}>
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {children}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// School
// ---------------------------------------------------------------------------

export type SchoolInput = {
  name: string;
  kind: SchoolKind;
  streams: EducationStream[];
  tagline: string;
  bio: string;
  location: string;
  motto: string;
  badge: string;
  contactEmail: string;
  contactPhone: string;
};

export function SchoolForm({
  settings,
  initial,
  submitLabel,
  title,
  busy,
  error,
  onSubmit,
  onCancel,
  lockedStreams = [],
}: {
  settings: LearnSettings;
  initial?: StudioSchool;
  submitLabel: string;
  title: string;
  busy: boolean;
  error: string | null;
  onSubmit: (input: SchoolInput) => void;
  onCancel?: () => void;
  /** Streams that already have classes and so cannot be removed. */
  lockedStreams?: EducationStream[];
}) {
  const id = useId();
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<SchoolKind>(initial?.kind ?? "school");
  const [streams, setStreams] = useState<EducationStream[]>(initial?.streams ?? []);
  const [tagline, setTagline] = useState(initial?.tagline ?? "");
  const [bio, setBio] = useState(initial?.bio ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [motto, setMotto] = useState(initial?.motto ?? "");
  const [badge, setBadge] = useState(initial?.badge ?? "");
  const [contactEmail, setContactEmail] = useState(initial?.contactEmail ?? "");
  const [contactPhone, setContactPhone] = useState(initial?.contactPhone ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  function toggle(streamId: EducationStream) {
    if (lockedStreams.includes(streamId)) return;
    setStreams((prev) => (prev.includes(streamId) ? prev.filter((s) => s !== streamId) : [...prev, streamId]));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return setLocalError("Give your school a name of at least 2 characters.");
    if (streams.length === 0) return setLocalError("Choose at least one stream, so learners know who it is for.");
    setLocalError(null);
    onSubmit({ name, kind, streams, tagline, bio, location, motto, badge, contactEmail, contactPhone });
  }

  const open = EDUCATION_STREAMS.filter((s) => settings.streams.includes(s.id) || streams.includes(s.id));

  return (
    <FormShell title={title} onSubmit={submit} error={localError ?? error} busy={busy} submitLabel={submitLabel} onCancel={onCancel}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="School, academy or tutor name" htmlFor={`${id}-name`}>
          <input id={`${id}-name`} required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className={controlCls} placeholder="e.g. Greenfield Primary School" />
        </Field>
        <Field label="What kind of provider are you?" htmlFor={`${id}-kind`}>
          <select id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.target.value as SchoolKind)} className={controlCls}>
            {SCHOOL_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-base font-semibold text-ink-500">Who do you teach? Choose every stream you offer</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {open.map((s) => {
            const ui = STREAM_UI[s.id];
            const Icon = ui.icon;
            const on = streams.includes(s.id);
            const locked = lockedStreams.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                disabled={locked}
                onClick={() => toggle(s.id)}
                className={`flex items-start gap-3 rounded-xl border p-3 text-left transition disabled:cursor-not-allowed ${on ? "border-gold bg-gold/10" : "border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] hover:border-gold/40"}`}
              >
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-gold" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-lg font-semibold text-ink">{ui.title}</span>
                  <span className="block text-base text-ink-500">{ui.audience}</span>
                  {locked && <span className="mt-1 block text-sm text-ink-500">Has classes, so it can&apos;t be removed</span>}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="One-line description" htmlFor={`${id}-tag`}>
          <input id={`${id}-tag`} maxLength={200} value={tagline} onChange={(e) => setTagline(e.target.value)} className={controlCls} placeholder="What you teach, in a sentence" />
        </Field>
        <Field label="Location" htmlFor={`${id}-loc`}>
          <input id={`${id}-loc`} maxLength={200} value={location} onChange={(e) => setLocation(e.target.value)} className={controlCls} placeholder="Town or area, or “Online”" />
        </Field>
        <Field label="Motto (optional)" htmlFor={`${id}-motto`}>
          <input id={`${id}-motto`} maxLength={200} value={motto} onChange={(e) => setMotto(e.target.value)} className={controlCls} />
        </Field>
        <Field label="Registration or accreditation (optional)" htmlFor={`${id}-badge`}>
          <input id={`${id}-badge`} maxLength={120} value={badge} onChange={(e) => setBadge(e.target.value)} className={controlCls} placeholder="e.g. MoES registered, UNEB centre number" />
        </Field>
        <Field label="Contact email (optional)" htmlFor={`${id}-email`}>
          <input id={`${id}-email`} type="email" maxLength={120} value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className={controlCls} />
        </Field>
        <Field label="Contact phone (optional)" htmlFor={`${id}-phone`}>
          <input id={`${id}-phone`} inputMode="tel" maxLength={40} value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className={controlCls} />
        </Field>
      </div>
      <Field label="About (optional)" htmlFor={`${id}-bio`}>
        <textarea id={`${id}-bio`} rows={3} maxLength={2000} value={bio} onChange={(e) => setBio(e.target.value)} className={controlCls} placeholder="Tell parents and learners who you are and how you teach" />
      </Field>
    </FormShell>
  );
}

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

export type ClassInput = {
  stream: EducationStream;
  kind: ClassKind;
  name: string;
  level: string;
  framework: CurriculumFramework;
  academicYear: string;
  term: string;
  teacherName: string;
  capacity: number;
  summary: string;
};

const KIND_COPY: Record<EducationStream, { class: string; masterclass: string }> = {
  sprouts: { class: "Class", masterclass: "Play workshop" },
  foundations: { class: "Class", masterclass: "Holiday masterclass" },
  academy: { class: "Class", masterclass: "Revision masterclass" },
  compass: { class: "Course group", masterclass: "Masterclass" },
  skills: { class: "Class", masterclass: "Masterclass" },
};

export function ClassForm({
  settings,
  school,
  initial,
  submitLabel,
  title,
  busy,
  error,
  onSubmit,
  onCancel,
  presetStream,
}: {
  settings: LearnSettings;
  school: StudioSchool;
  initial?: StudioClass;
  submitLabel: string;
  title: string;
  busy: boolean;
  error: string | null;
  onSubmit: (input: ClassInput) => void;
  onCancel?: () => void;
  presetStream?: EducationStream;
}) {
  const id = useId();
  const editing = Boolean(initial);
  const streamChoices = school.streams.filter((s) => settings.streams.includes(s) || s === initial?.stream);
  const [stream, setStream] = useState<EducationStream>(initial?.stream ?? (presetStream && streamChoices.includes(presetStream) ? presetStream : streamChoices[0] ?? "foundations"));
  const [kind, setKind] = useState<ClassKind>(initial?.kind ?? "class");
  const [name, setName] = useState(initial?.name ?? "");
  const [level, setLevel] = useState(initial?.level ?? "");
  const [framework, setFramework] = useState<CurriculumFramework>(initial?.framework ?? frameworksForStream(stream)[0]?.id ?? "open_syllabus");
  const [academicYear, setAcademicYear] = useState(initial?.academicYear ?? String(new Date().getFullYear()));
  const [term, setTerm] = useState(initial?.term ?? "");
  const [teacherName, setTeacherName] = useState(initial?.teacherName ?? "");
  const [capacity, setCapacity] = useState(String(initial?.capacity ?? 40));
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  const frameworks = frameworksForStream(stream);
  const copy = KIND_COPY[stream];

  function changeStream(next: EducationStream) {
    setStream(next);
    setLevel("");
    const options = frameworksForStream(next);
    if (!options.some((f) => f.id === framework)) setFramework(options[0]?.id ?? "open_syllabus");
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return setLocalError("Give the class a name of at least 2 characters.");
    const seats = Number(capacity);
    if (!Number.isInteger(seats) || seats < 1) return setLocalError("Capacity must be a whole number of 1 or more.");
    setLocalError(null);
    onSubmit({ stream, kind, name, level, framework, academicYear, term, teacherName, capacity: seats, summary });
  }

  return (
    <FormShell title={title} onSubmit={submit} error={localError ?? error} busy={busy} submitLabel={submitLabel} onCancel={onCancel}>
      {!editing && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Stream" htmlFor={`${id}-stream`}>
            <select id={`${id}-stream`} value={stream} onChange={(e) => changeStream(e.target.value as EducationStream)} className={controlCls}>
              {streamChoices.map((s) => (
                <option key={s} value={s}>
                  {STREAM_UI[s].title} · {STREAM_UI[s].audience}
                </option>
              ))}
            </select>
          </Field>
          <div className="space-y-1">
            <span className="block text-base font-semibold text-ink-500">Format</span>
            <Segmented
              label="Format"
              value={kind}
              onChange={setKind}
              options={[
                { id: "class", label: copy.class },
                { id: "masterclass", label: copy.masterclass, disabled: !settings.masterclassesEnabled },
              ]}
            />
            <p className="text-sm text-ink-500">{kind === "class" ? "A fixed group that follows a term or year." : "A short, focused programme anyone can join."}</p>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor={`${id}-name`}>
          <input id={`${id}-name`} required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className={controlCls} placeholder={stream === "skills" ? "e.g. Beginner Tailoring" : "e.g. Primary 4 Blue"} />
        </Field>
        <Field label="Level or grade" htmlFor={`${id}-level`}>
          <input id={`${id}-level`} list={`${id}-levels`} maxLength={120} value={level} onChange={(e) => setLevel(e.target.value)} className={controlCls} placeholder="Pick one or type your own" />
          <datalist id={`${id}-levels`}>
            {STREAM_LEVELS[stream].map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </Field>
        <Field label="Syllabus" htmlFor={`${id}-fw`} hint="The curriculum this class follows">
          <select id={`${id}-fw`} value={framework} onChange={(e) => setFramework(e.target.value as CurriculumFramework)} className={controlCls}>
            {frameworks.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
            {!frameworks.some((f) => f.id === "open_syllabus") && <option value="open_syllabus">Own syllabus</option>}
          </select>
        </Field>
        <Field label="Teacher or lead" htmlFor={`${id}-teacher`}>
          <input id={`${id}-teacher`} maxLength={120} value={teacherName} onChange={(e) => setTeacherName(e.target.value)} className={controlCls} placeholder="Who teaches this class" />
        </Field>
        <Field label="Year" htmlFor={`${id}-year`}>
          <input id={`${id}-year`} maxLength={40} value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} className={controlCls} placeholder="2026 or 2026/27" />
        </Field>
        <Field label="Term, semester or intake" htmlFor={`${id}-term`}>
          <input id={`${id}-term`} maxLength={60} value={term} onChange={(e) => setTerm(e.target.value)} className={controlCls} placeholder="e.g. Term 3, Semester 1, 4 weeks" />
        </Field>
        <Field label="Seats" htmlFor={`${id}-cap`}>
          <input id={`${id}-cap`} type="number" min={1} max={100000} inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value)} className={controlCls} />
        </Field>
      </div>
      <Field label="What this class covers (optional)" htmlFor={`${id}-sum`}>
        <textarea id={`${id}-sum`} rows={2} maxLength={2000} value={summary} onChange={(e) => setSummary(e.target.value)} className={controlCls} />
      </Field>
    </FormShell>
  );
}

// ---------------------------------------------------------------------------
// Course
// ---------------------------------------------------------------------------

export type CourseInput = { title: string; summary: string; priceUgx: number; framework: CurriculumFramework; outcomes: string[] };

export function CourseForm({
  settings,
  stream,
  defaultFramework,
  initial,
  submitLabel,
  title,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  settings: LearnSettings;
  stream: EducationStream;
  defaultFramework: CurriculumFramework;
  initial?: StudioCourse;
  submitLabel: string;
  title: string;
  busy: boolean;
  error: string | null;
  onSubmit: (input: CourseInput) => void;
  onCancel?: () => void;
}) {
  const id = useId();
  const [courseTitle, setCourseTitle] = useState(initial?.title ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [price, setPrice] = useState(String(initial?.priceUgx ?? 0));
  const [framework, setFramework] = useState<CurriculumFramework>(initial?.framework ?? defaultFramework);
  const [outcomes, setOutcomes] = useState((initial?.outcomes ?? []).join("\n"));
  const [localError, setLocalError] = useState<string | null>(null);
  const frameworks = frameworksForStream(stream);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (courseTitle.trim().length < 2) return setLocalError("Give the course a title of at least 2 characters.");
    const priceUgx = Number(price || 0);
    if (!Number.isInteger(priceUgx) || priceUgx < 0) return setLocalError("The price must be a whole number of 0 or more.");
    if (priceUgx > settings.maxCoursePriceUgx) return setLocalError(`A course can cost up to UGX ${settings.maxCoursePriceUgx.toLocaleString("en-UG")}.`);
    setLocalError(null);
    onSubmit({
      title: courseTitle,
      summary,
      priceUgx,
      framework,
      outcomes: outcomes.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 12),
    });
  }

  return (
    <FormShell title={title} onSubmit={submit} error={localError ?? error} busy={busy} submitLabel={submitLabel} onCancel={onCancel}>
      <Field label="Course title" htmlFor={`${id}-title`}>
        <input id={`${id}-title`} required maxLength={120} value={courseTitle} onChange={(e) => setCourseTitle(e.target.value)} className={controlCls} placeholder="e.g. Mathematics: Fractions, Decimals & Geometry" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Syllabus" htmlFor={`${id}-fw`}>
          <select id={`${id}-fw`} value={framework} onChange={(e) => setFramework(e.target.value as CurriculumFramework)} className={controlCls}>
            {frameworks.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
            {!frameworks.some((f) => f.id === "open_syllabus") && <option value="open_syllabus">Own syllabus</option>}
          </select>
        </Field>
        <Field label="Price (UGX)" htmlFor={`${id}-price`} hint={settings.paidCoursesEnabled ? "0 makes the course free" : "Paid courses are switched off right now, so courses are free"}>
          <input
            id={`${id}-price`}
            type="number"
            min={0}
            step={1000}
            inputMode="numeric"
            disabled={!settings.paidCoursesEnabled}
            value={settings.paidCoursesEnabled ? price : "0"}
            onChange={(e) => setPrice(e.target.value)}
            className={controlCls}
          />
        </Field>
      </div>
      <Field label="About this course" htmlFor={`${id}-sum`}>
        <textarea id={`${id}-sum`} rows={3} maxLength={2000} value={summary} onChange={(e) => setSummary(e.target.value)} className={controlCls} placeholder="What will learners study and how will they be assessed?" />
      </Field>
      <Field label="Learning outcomes" htmlFor={`${id}-out`} hint="One per line. What can a learner do after finishing? (up to 12)">
        <textarea id={`${id}-out`} rows={4} value={outcomes} onChange={(e) => setOutcomes(e.target.value)} className={controlCls} placeholder={"Add and subtract fractions\nRead a bar chart"} />
      </Field>
    </FormShell>
  );
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

export function ModuleForm({
  initial,
  title,
  submitLabel,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: { title: string; description: string };
  title: string;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: (input: { title: string; description: string }) => void;
  onCancel?: () => void;
}) {
  const id = useId();
  const [moduleTitle, setModuleTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (moduleTitle.trim().length < 2) return setLocalError("Give the module a title of at least 2 characters.");
    setLocalError(null);
    onSubmit({ title: moduleTitle, description });
  }

  return (
    <FormShell title={title} onSubmit={submit} error={localError ?? error} busy={busy} submitLabel={submitLabel} onCancel={onCancel}>
      <Field label="Module title" htmlFor={`${id}-title`} hint="A unit, topic or week">
        <input id={`${id}-title`} required maxLength={120} value={moduleTitle} onChange={(e) => setModuleTitle(e.target.value)} className={controlCls} placeholder="e.g. Unit 1: Visual fractions" />
      </Field>
      <Field label="What it covers (optional)" htmlFor={`${id}-desc`}>
        <textarea id={`${id}-desc`} rows={2} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} className={controlCls} />
      </Field>
    </FormShell>
  );
}
