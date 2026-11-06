"use client";

import { EDUCATION_STREAMS, type EducationStream, type FeeInvoice, type LearnEnrollment, type LearnerBadge, type LearnerLesson, type TvDevice } from "@peebee/shared";
import {
  ArrowRight,
  Award,
  Backpack,
  BookOpen,
  GraduationCap,
  Hammer,
  Landmark,
  PlayCircle,
  Radio,
  Receipt,
  Search,
  Sparkles,
  Sprout,
  Trophy,
  Tv,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LearnThumb } from "@peebee/shared/learn-thumb";
import { LearningCreatorLink } from "@peebee/shared/learning-creator-link";
import { useAuth } from "../../lib/auth-context";
import { api, errorMessage } from "../../lib/api";
import { bodyFont, display, monoFont } from "./fonts";

type CatalogCourse = Awaited<ReturnType<typeof api.getCatalogCourses>>["courses"][number];
type HomeConfig = Awaited<ReturnType<typeof api.getCatalogHomeConfig>>["home"];

/** Used until (or unless) Admin's home settings load, so the screen never waits on them. */
const DEFAULT_HOME: HomeConfig = { progress: true, tools: true, freeRail: true, railSize: 8, tv: true, certificates: true, fees: true, live: true, trialClasses: true };

const card = "rounded-[18px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))]";
const ugx = (n: number) => (n > 0 ? `UGX ${n.toLocaleString("en-UG")}` : "Free");
const LEARN_STUDIO_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? "https://learn.peebee.online";
/** The Learn home shows course pictures slightly taller than the 16:9 used everywhere else. */
const HOME_RATIO = "15 / 9";

/** One door per level. Labels follow the bottom menu: "Basics" is primary school and "Campus" is university. */
const DOORS: { id: EducationStream; label: string; blurb: string; icon: LucideIcon; glow: string }[] = [
  { id: "skills", label: "Skills", blurb: "Learn anything practical", icon: Hammer, glow: "bg-[radial-gradient(circle,rgb(var(--color-gold)),transparent_70%)]" },
  { id: "sprouts", label: "Sprouts", blurb: "Ages 3–6, play and stories", icon: Sprout, glow: "bg-[radial-gradient(circle,rgb(var(--color-green)),transparent_70%)]" },
  { id: "foundations", label: "Basics", blurb: "Primary, ages 6–12", icon: Backpack, glow: "bg-[radial-gradient(circle,rgb(var(--color-ink)/0.4),transparent_70%)]" },
  { id: "academy", label: "Academy", blurb: "Secondary and exam prep", icon: Landmark, glow: "bg-[radial-gradient(circle,rgb(var(--color-gold)/0.6),transparent_70%)]" },
  { id: "compass", label: "Campus", blurb: "University and college", icon: GraduationCap, glow: "bg-[radial-gradient(circle,rgb(var(--color-green)/0.6),transparent_70%)]" },
];

/** What a new learner is asked first. Each one opens a level. */
const PATHS: { stream: EducationStream; label: string; blurb: string; icon: LucideIcon }[] = [
  { stream: "skills", label: "A skill or trade", blurb: "Solar, tailoring, phones", icon: Hammer },
  { stream: "academy", label: "School subjects", blurb: "Secondary and exam prep", icon: Landmark },
  { stream: "compass", label: "University", blurb: "Modules and certificates", icon: GraduationCap },
  { stream: "sprouts", label: "For my child", blurb: "Ages 3–6, play and stories", icon: Sprout },
];

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-2xl bg-[rgb(var(--surface-muted))] ${className}`} aria-hidden />;
}

function SectionHead({ id, title, onSeeAll }: { id: string; title: string; onSeeAll?: () => void }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <h2 id={id} className="font-[family-name:var(--font-lh-display)] text-sm font-bold text-ink">
        {title}
      </h2>
      {onSeeAll && (
        <button type="button" onClick={onSeeAll} className="text-[11px] font-semibold text-gold">
          See all
        </button>
      )}
    </div>
  );
}

function greeting(name: string | undefined) {
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const first = name?.trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}

/** The lesson to open next in a course: the first one not finished and not locked. */
function nextLesson(modules: { lessons: LearnerLesson[] }[]): LearnerLesson | null {
  for (const m of modules) for (const l of m.lessons) if (!l.completed && !l.locked) return l;
  return null;
}

type Hero = {
  enrollment: LearnEnrollment;
  others: number;
  next: LearnerLesson | null;
  liveNow: LearnerLesson | null;
};

function ProgressRing({ percent }: { percent: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const [shown, setShown] = useState(0);
  // Fills in once on arrival; skipped for people who ask for less motion (see the transition class below).
  useEffect(() => {
    const t = setTimeout(() => setShown(percent), 200);
    return () => clearTimeout(t);
  }, [percent]);
  return (
    <div className="relative h-[76px] w-[76px] shrink-0" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Course progress">
      <svg width="76" height="76" viewBox="0 0 76 76" className="-rotate-90" aria-hidden>
        <circle cx="38" cy="38" r={r} fill="none" strokeWidth="6" className="stroke-white/15" />
        <circle
          cx="38"
          cy="38"
          r={r}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown / 100)}
          className="stroke-gold transition-[stroke-dashoffset] duration-[1100ms] ease-out motion-reduce:transition-none"
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center font-[family-name:var(--font-lh-display)] text-[17px] font-bold">{percent}%</span>
    </div>
  );
}

function ContinueHero({ hero }: { hero: Hero }) {
  const { enrollment: e, next, others } = hero;
  const href = next ? `/learn/course/${e.courseId}/lesson/${next.id}` : `/learn/course/${e.courseId}`;
  return (
    <div className="relative pb-7">
      <div className="relative z-[2] flex flex-col gap-3.5 overflow-hidden rounded-3xl border border-white/10 bg-[rgb(var(--color-black-700))] p-4 text-white">
        <span className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-gold/30 blur-2xl" aria-hidden />
        <div className="relative flex items-center gap-3.5">
          <ProgressRing percent={e.progressPercent} />
          <div className="min-w-0">
            <p className="truncate text-[11px] text-white/60">Continue · {e.schoolName}</p>
            <p className="font-[family-name:var(--font-lh-display)] text-base font-semibold leading-tight">{e.title}</p>
            <p className="text-[11px] text-white/60">
              {e.completedLessons} of {e.lessonCount} lessons done
            </p>
          </div>
        </div>
        {next && (
          <div className="relative flex items-center gap-2.5 rounded-2xl bg-white/10 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-white/60">Up next{next.durationMinutes > 0 ? ` · ${next.durationMinutes} min` : ""}</p>
              <p className="truncate text-[13px] font-semibold">{next.title}</p>
            </div>
            <PlayCircle className="h-5 w-5 shrink-0 text-white/80" aria-hidden />
          </div>
        )}
        <Link href={href} className="relative flex w-full items-center justify-center gap-2 rounded-2xl bg-gold px-3 py-3 text-[13px] font-bold text-ink-gold active:scale-[0.98] motion-safe:transition">
          {e.progressPercent === 0 ? "Start course" : next ? "Resume lesson" : "Open course"} <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
      {others > 0 && (
        <Link href="/learn/my" aria-label={`${others} more ${others === 1 ? "course" : "courses"}`}>
          <span className="absolute inset-x-3.5 bottom-3 z-[1] h-[30px] rounded-b-[20px] border border-t-0 border-[var(--border-faint)] bg-[rgb(var(--surface-card))]" aria-hidden />
          {others > 1 && <span className="absolute inset-x-7 bottom-0.5 h-[30px] rounded-b-[20px] border border-t-0 border-[var(--border-faint)] bg-[rgb(var(--surface-card))] opacity-70" aria-hidden />}
        </Link>
      )}
    </div>
  );
}

function Banner({ live, dueCount }: { live: { courseId: string; lesson: LearnerLesson } | null; dueCount: number }) {
  if (live) {
    return (
      <Link
        href={`/learn/course/${live.courseId}/lesson/${live.lesson.id}`}
        role="status"
        className="flex items-center gap-2.5 rounded-2xl border border-gold/40 bg-gold/15 px-3 py-2.5"
      >
        <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
        </span>
        <span className="min-w-0 flex-1 text-xs text-ink">
          <b className="block truncate text-[13px]">{live.lesson.title} is open now</b>
          Live lesson
        </span>
        <span className="shrink-0 rounded-full bg-gold px-3 py-1.5 text-[11px] font-bold text-ink-gold">Join</span>
      </Link>
    );
  }
  if (dueCount > 0) {
    return (
      <Link href="/learn/my" role="status" className="flex items-center gap-2.5 rounded-2xl border border-gold/40 bg-gold/15 px-3 py-2.5">
        <Receipt className="h-4 w-4 shrink-0 text-gold" aria-hidden />
        <span className="min-w-0 flex-1 text-[13px] font-semibold text-ink">
          {dueCount} fee{dueCount === 1 ? "" : "s"} due
        </span>
        <span className="shrink-0 rounded-full bg-gold px-3 py-1.5 text-[11px] font-bold text-ink-gold">Pay</span>
      </Link>
    );
  }
  return null;
}

function ProgressStrip({ badges }: { badges: LearnerBadge[] }) {
  const earned = badges.filter((b) => b.awardedAt);
  const next = badges.find((b) => !b.awardedAt);
  return (
    <Link href="/learn/certificates" className={`${card} flex items-center gap-3 p-3`}>
      <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-2xl bg-gold/15 text-gold">
        <Trophy className="h-[22px] w-[22px]" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-[family-name:var(--font-lh-display)] text-[15px] font-bold text-ink">
          {earned.length} of {badges.length} badges
        </span>
        <span className="block text-[11px] leading-snug text-ink-500">{next ? next.description : "You have earned every badge"}</span>
        <span className="mt-1.5 flex gap-1" aria-hidden>
          {badges.map((b) => (
            <i key={b.key} className={`h-[5px] w-3.5 rounded-full ${b.awardedAt ? "bg-gold" : "bg-[rgb(var(--surface-muted))]"}`} />
          ))}
        </span>
      </span>
      {next && (
        <span className="max-w-[84px] shrink-0 text-right text-[10px] leading-snug text-ink-500">
          <b className="block text-[11px] font-bold text-ink">{next.title}</b>
          Next badge
        </span>
      )}
    </Link>
  );
}

function LevelDoors({ stream, counts, onPick, onSeeAll }: { stream: EducationStream | "all"; counts: Record<string, number>; onPick: (s: EducationStream | "all") => void; onSeeAll: () => void }) {
  return (
    <section aria-labelledby="levels-h">
      <SectionHead id="levels-h" title="Choose your level" onSeeAll={onSeeAll} />
      <div role="radiogroup" aria-label="Level" className="-mx-3.5 flex snap-x snap-mandatory scroll-pl-3.5 gap-2.5 overflow-x-auto px-3.5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {DOORS.map((d) => {
          const on = stream === d.id;
          const Icon = d.icon;
          const n = counts[d.id] ?? 0;
          return (
            <button
              key={d.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onPick(on ? "all" : d.id)}
              className={`relative flex h-[168px] w-32 shrink-0 snap-start flex-col justify-between overflow-hidden rounded-[20px] border p-3 text-left transition active:scale-[0.98] ${on ? "border-gold ring-1 ring-gold" : "border-[var(--border-faint)] hover:border-gold/50"} bg-[rgb(var(--surface-card))]`}
            >
              <span className={`pointer-events-none absolute -right-[18px] -top-[18px] h-[90px] w-[90px] rounded-full opacity-90 ${d.glow}`} aria-hidden />
              <span className="relative flex h-[34px] w-[34px] items-center justify-center rounded-xl bg-[rgb(var(--color-ink))] text-[rgb(var(--surface-card))]">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="relative">
                <span className="block font-[family-name:var(--font-lh-display)] text-base font-bold text-ink">{d.label}</span>
                <span className="block text-[10.5px] leading-snug text-ink-500">{d.blurb}</span>
                <span className="mt-1 block text-[10px] font-bold tracking-wide text-gold">{n} {n === 1 ? "course" : "courses"}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function PathPicker({ stream, onPick }: { stream: EducationStream | "all"; onPick: (s: EducationStream) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2" role="group" aria-label="Pick a path">
      {PATHS.map((p) => {
        const Icon = p.icon;
        const on = stream === p.stream;
        return (
          <button
            key={p.stream}
            type="button"
            onClick={() => onPick(p.stream)}
            aria-pressed={on}
            className={`flex flex-col gap-3.5 rounded-2xl border p-3 text-left transition active:scale-[0.98] ${on ? "border-gold ring-1 ring-gold" : "border-[var(--border-faint)] hover:border-gold/50"} bg-[rgb(var(--surface-card))]`}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[rgb(var(--color-ink))] text-[rgb(var(--surface-card))]">
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <span>
              <span className="block text-[13px] font-semibold text-ink">{p.label}</span>
              <span className="block text-[10.5px] text-ink-500">{p.blurb}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Six single-digit boxes on one solid fill. Pasting fills all six; the sixth digit opens the class. */
function JoinLiveClass({ showTrials, newLearner }: { showTrials: boolean; newLearner: boolean }) {
  const router = useRouter();
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const [trials, setTrials] = useState<{ code: string; title: string }[]>([]);

  // Practice classes anyone can try without a tutor. Quietly absent when they're off or you aren't signed in.
  useEffect(() => {
    if (!showTrials) return;
    let cancelled = false;
    api
      .classroomTrial()
      .then((res) => !cancelled && setTrials(res.classes))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [showTrials]);

  const open = useCallback((code: string) => router.push(`/learn/live?code=${code}`), [router]);

  function setAt(i: number, value: string) {
    const clean = value.replace(/\D/g, "");
    const next = [...digits];
    if (clean.length > 1) {
      // A paste or autofill: spread it across the boxes.
      clean.slice(0, 6).split("").forEach((d, k) => (next[k] = d));
      setDigits(next);
      const last = Math.min(clean.length, 6) - 1;
      refs.current[Math.min(last + 1, 5)]?.focus();
      if (next.every(Boolean)) open(next.join(""));
      return;
    }
    next[i] = clean;
    setDigits(next);
    if (clean && i < 5) refs.current[i + 1]?.focus();
    if (next.every(Boolean)) open(next.join(""));
  }

  return (
    <section aria-labelledby="join-h" className={`${card} space-y-2.5 p-3.5`}>
      <div className="flex items-center gap-2.5">
        <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-xl bg-gold/15 text-gold">
          <Radio className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 id="join-h" className="font-[family-name:var(--font-lh-display)] text-sm font-bold text-ink">
            Join a live class
          </h2>
          <p className="text-[11px] text-ink-500">Enter the code on your tutor&apos;s screen</p>
        </div>
      </div>
      <div className="field-box flex gap-1.5 rounded-2xl !bg-[rgb(var(--surface-muted))] p-1.5" role="group" aria-label="Class code">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            value={d}
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            maxLength={6}
            aria-label={`Digit ${i + 1}`}
            onChange={(e) => setAt(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !digits[i] && i > 0) refs.current[i - 1]?.focus();
            }}
            className="h-[42px] w-full min-w-0 flex-1 rounded-xl border-0 p-0 text-center font-[family-name:var(--font-lh-mono)] text-lg font-medium text-ink outline-none focus:ring-2 focus:ring-gold"
          />
        ))}
      </div>
      {trials.length > 0 &&
        (newLearner ? (
          <div className="space-y-2 pt-0.5">
            <p className="text-[11px] text-ink-500">Try a practice class. It plays by itself.</p>
            <button type="button" onClick={() => open(trials[0].code)} className="w-full rounded-2xl bg-gold px-3 py-2.5 text-[13px] font-bold text-ink-gold">
              Start practice class
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => open(trials[0].code)} className="flex items-center gap-1.5 text-left text-[11px] text-ink-500">
            <Sparkles className="h-3 w-3 shrink-0 text-gold" aria-hidden /> No code yet? Try a practice class. It plays by itself.
          </button>
        ))}
    </section>
  );
}

function Tile({ href, icon: Icon, title, hint, badge, tone }: { href: string; icon: LucideIcon; title: string; hint: string; badge?: string; tone?: "ok" }) {
  return (
    <Link href={href} className={`${card} relative flex flex-col gap-5 p-3 transition hover:border-gold/50 active:scale-[0.98]`}>
      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[rgb(var(--surface-muted))] text-ink">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      {badge && (
        <span className={`absolute right-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-bold ${tone === "ok" ? "text-green-700 dark:text-green-400" : "bg-gold text-ink-gold"}`}>{badge}</span>
      )}
      <span>
        <span className="block text-[13px] font-semibold text-ink">{title}</span>
        <span className="block text-[10.5px] text-ink-500">{hint}</span>
      </span>
    </Link>
  );
}

function CourseCard({ course, wide }: { course: CatalogCourse; wide?: boolean }) {
  return (
    <Link href={`/learn/course/${course.id}`} className={`block ${wide ? "w-[200px] shrink-0 snap-start" : ""}`}>
      <LearnThumb src={api.learnArtUrl("course", course.id)} ratio={HOME_RATIO} className="mb-2 w-full rounded-[14px]" />
      <p className="line-clamp-2 text-xs font-bold leading-tight text-ink">{course.title}</p>
      <p className="mt-0.5 truncate text-[10.5px] text-ink-500">{course.schoolName}</p>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-ink-500">
        <span className="rounded-full bg-gold/15 px-2 py-0.5 font-bold text-gold">{ugx(course.priceUgx)}</span>
        <span>
          {course.lessonCount} lesson{course.lessonCount === 1 ? "" : "s"}
        </span>
        {course.demo && <span className="rounded-full bg-[rgb(var(--surface-muted))] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide">Demo</span>}
      </p>
    </Link>
  );
}

function Rail({ id, title, courses, onSeeAll }: { id: string; title: string; courses: CatalogCourse[]; onSeeAll: () => void }) {
  if (courses.length === 0) return null;
  return (
    <section aria-labelledby={id}>
      <SectionHead id={id} title={title} onSeeAll={onSeeAll} />
      <div className="-mx-3.5 flex snap-x scroll-pl-3.5 gap-2.5 overflow-x-auto px-3.5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {courses.map((c) => (
          <CourseCard key={c.id} course={c} wide />
        ))}
      </div>
    </section>
  );
}

function LearnHome() {
  const router = useRouter();
  const { user } = useAuth();
  const [courses, setCourses] = useState<CatalogCourse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<HomeConfig>(DEFAULT_HOME);
  const [enrollments, setEnrollments] = useState<LearnEnrollment[] | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [invoices, setInvoices] = useState<FeeInvoice[]>([]);
  const [badges, setBadges] = useState<LearnerBadge[]>([]);
  const [certCount, setCertCount] = useState(0);
  const [tvs, setTvs] = useState<TvDevice[]>([]);
  const [hero, setHero] = useState<Hero | null>(null);
  const [hello, setHello] = useState("Learn");
  // The level lives in the address (/learn?stream=skills) so the bottom menu, links and this page always agree.
  const asked = useSearchParams().get("stream");
  const stream: EducationStream | "all" = EDUCATION_STREAMS.some((s) => s.id === asked) ? (asked as EducationStream) : "all";
  const [school, setSchool] = useState<string | null>(null);
  // A school belongs to one level, so changing level (from the menu or the doors) clears it.
  useEffect(() => {
    setSchool(null);
    if (stream !== "all") setOnly(null);
  }, [stream]);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  // "See all" on a row opens the course grid for that row ("free") or for every course ("all").
  const [only, setOnly] = useState<"free" | "all" | null>(null);

  useEffect(() => setHello(greeting(user?.name)), [user?.name]);

  useEffect(() => {
    let cancelled = false;
    api
      .getCatalogCourses()
      .then((res) => !cancelled && setCourses(res.courses))
      .catch((err) => {
        if (cancelled) return;
        setCourses([]);
        setError(errorMessage(err));
      });
    api
      .getCatalogHomeConfig()
      .then((res) => !cancelled && setConfig(res.home))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Everything personal. Each call is optional: a failure only hides its own block.
  useEffect(() => {
    let cancelled = false;
    api
      .learnEnrollments()
      .then(async (res) => {
        if (cancelled) return;
        setEnrollments(res.enrollments);
        const open = res.enrollments.filter((e) => e.progressPercent < 100);
        const pick = open.find((e) => e.progressPercent > 0) ?? open[0] ?? res.enrollments[0];
        if (!pick) return;
        const others = res.enrollments.length - 1;
        setHero({ enrollment: pick, others, next: null, liveNow: null });
        try {
          const detail = await api.learnCourse(pick.courseId);
          if (cancelled) return;
          const lessons = detail.course.modules.flatMap((m) => m.lessons);
          setHero({
            enrollment: pick,
            others,
            next: nextLesson(detail.course.modules),
            liveNow: lessons.find((l) => l.live?.joinOpen && !l.completed && !l.locked) ?? null,
          });
        } catch {
          /* The hero still works without the next lesson. */
        }
      })
      .catch(() => {
        if (cancelled) return;
        setEnrollments([]);
        setSignedOut(true);
      });
    api.learnInvoices().then((r) => !cancelled && setInvoices(r.invoices)).catch(() => undefined);
    api.learnBadges().then((r) => !cancelled && r.enabled && setBadges(r.badges)).catch(() => undefined);
    api.learnCertificates().then((r) => !cancelled && setCertCount(r.certificates.length)).catch(() => undefined);
    api.tvDevices().then((r) => !cancelled && setTvs(r.devices)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const pickStream = useCallback(
    (s: EducationStream | "all") => {
      router.replace(s === "all" ? "/learn" : `/learn?stream=${s}`, { scroll: false });
      setSchool(null);
      setOnly(null);
    },
    [router],
  );

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const c of courses ?? []) out[c.stream] = (out[c.stream] ?? 0) + 1;
    return out;
  }, [courses]);

  const inStream = useMemo(() => (courses ?? []).filter((c) => stream === "all" || c.stream === stream), [courses, stream]);

  const schools = useMemo(() => {
    const map = new Map<string, { id: string; slug: string; name: string; count: number }>();
    for (const c of inStream) {
      const entry = map.get(c.schoolSlug) ?? { id: c.schoolId, slug: c.schoolSlug, name: c.schoolName, count: 0 };
      entry.count += 1;
      map.set(c.schoolSlug, entry);
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [inStream]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inStream.filter(
      (c) =>
        (!school || c.schoolSlug === school) &&
        (only !== "free" || c.priceUgx === 0) &&
        (!q || [c.title, c.summary, c.schoolName, c.className, c.classLevel].some((t) => t.toLowerCase().includes(q))),
    );
  }, [inStream, school, query, only]);

  const browsing = stream !== "all" || query.trim() !== "" || searchOpen || only !== null;
  const dueInvoices = invoices.filter((i) => i.status === "unpaid" || i.status === "partial");
  const dueTotal = dueInvoices.reduce((sum, i) => sum + i.balanceUgx, 0);
  const newLearner = enrollments !== null && enrollments.length === 0;
  const freeCourses = useMemo(() => (courses ?? []).filter((c) => c.priceUgx === 0).slice(0, config.railSize), [courses, config.railSize]);
  const newest = useMemo(() => {
    const shown = new Set(config.freeRail ? freeCourses.map((c) => c.id) : []);
    return (courses ?? []).filter((c) => !shown.has(c.id)).slice(0, config.railSize);
  }, [courses, config.railSize, config.freeRail, freeCourses]);
  const linkedTv = tvs[0];
  const showTools = config.tools && !signedOut;

  return (
    <div className={`${display.variable} ${bodyFont.variable} ${monoFont.variable} min-h-dvh font-[family-name:var(--font-lh-body)]`}>
    <div className="mx-auto max-w-3xl space-y-[18px] px-3.5 pb-44 pt-4">
      {!signedOut && <LearningCreatorLink api={api} href="/learn/create" />}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold">Peebee Learn</p>
          <h1 className="mt-[3px] font-[family-name:var(--font-lh-display)] text-[22px] font-bold leading-[1.1] tracking-[-0.02em] text-ink">{newLearner || signedOut ? "What do you want to learn?" : hello}</h1>
        </div>
        <button
          type="button"
          onClick={() => setSearchOpen((o) => !o)}
          aria-label={searchOpen ? "Close search" : "Search courses"}
          aria-expanded={searchOpen}
          className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[13px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] text-ink"
        >
          {searchOpen ? <X className="h-4 w-4" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
        </button>
      </header>

      {searchOpen && (
        <div className="field-box flex items-center gap-2.5 rounded-2xl px-3.5">
          <Search className="h-4 w-4 shrink-0 text-ink-500" aria-hidden />
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search courses"
            placeholder="Search courses, schools or subjects"
            className="h-11 w-full min-w-0 border-0 p-0 text-sm text-ink outline-none"
          />
        </div>
      )}

      {!browsing && (
        <>
          <Banner live={hero?.liveNow ? { courseId: hero.enrollment.courseId, lesson: hero.liveNow } : null} dueCount={dueInvoices.length} />

          {enrollments === null ? (
            <Skeleton className="h-52" />
          ) : hero ? (
            <ContinueHero hero={hero} />
          ) : (
            <PathPicker stream={stream} onPick={pickStream} />
          )}

          {config.progress && hero && badges.length > 0 && <ProgressStrip badges={badges} />}
        </>
      )}

      <LevelDoors stream={stream} counts={counts} onPick={pickStream} onSeeAll={() => setOnly("all")} />

      {!browsing && config.live && <JoinLiveClass showTrials={config.trialClasses} newLearner={newLearner || signedOut} />}

      {!browsing && showTools && (
        <section aria-label="Tools" className="grid grid-cols-2 gap-2.5">
          {config.tv && (
            <Tile href="/learn/tv" icon={Tv} title="Watch on TV" hint={linkedTv ? linkedTv.name : "Link a TV with a code"} badge={linkedTv ? "Linked" : undefined} tone="ok" />
          )}
          {config.certificates && <Tile href="/learn/certificates" icon={Award} title="Certificates" hint={certCount > 0 ? `${certCount} earned` : "Earn your first"} />}
          {config.fees && (
            <Tile href="/learn/my" icon={Receipt} title="Fees" hint={dueTotal > 0 ? `${ugx(dueTotal)} due` : "Nothing due"} badge={dueInvoices.length > 0 ? `${dueInvoices.length} due` : undefined} />
          )}
          <Tile href="/learn/my" icon={BookOpen} title="My courses" hint={enrollments && enrollments.length > 0 ? `${enrollments.length} joined` : "Pick your first"} />
        </section>
      )}

      {error && (
        <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-3 text-sm text-ink">
          {error}
        </p>
      )}

      {browsing ? (
        <section aria-labelledby="browse-h" className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="browse-h" className="font-[family-name:var(--font-lh-display)] text-base font-semibold text-ink">
              {stream !== "all" ? `${EDUCATION_STREAMS.find((s) => s.id === stream)?.title} courses` : only === "free" ? "Free courses" : "Courses"}
            </h2>
            {(stream !== "all" || only !== null) && (
              <button type="button" onClick={() => pickStream("all")} className="text-xs font-semibold text-gold">
                {stream !== "all" ? "All levels" : "Back"}
              </button>
            )}
          </div>

          {schools.length > 1 && (
            <div className="-mx-3.5 flex gap-2 overflow-x-auto px-3.5 pb-1" aria-label="Schools">
              {schools.map((s) => (
                <button
                  key={s.slug}
                  type="button"
                  aria-pressed={school === s.slug}
                  onClick={() => setSchool(school === s.slug ? null : s.slug)}
                  className={`flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs transition ${school === s.slug ? "border-gold bg-gold/10 text-ink" : "border-[var(--border-faint)] bg-[rgb(var(--surface-card))] text-ink-500 hover:border-gold/50"}`}
                >
                  <LearnThumb src={api.learnArtUrl("school", s.id)} className="w-9 shrink-0 rounded-md" />
                  <span className="font-semibold text-ink">{s.name}</span>
                  <span>{s.count}</span>
                </button>
              ))}
            </div>
          )}

          {courses === null ? (
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-40" />
              <Skeleton className="h-40" />
            </div>
          ) : visible.length === 0 ? (
            <div className={`${card} flex flex-col items-center gap-2 px-5 py-10 text-center`}>
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gold/15 text-gold">
                <BookOpen className="h-6 w-6" aria-hidden />
              </span>
              <p className="text-sm font-semibold text-ink">{courses.length === 0 ? "No courses are published yet" : "No courses match"}</p>
              <p className="max-w-xs text-xs text-ink-500">
                {courses.length === 0 ? "When schools and tutors publish courses they appear here." : "Try another level, school or search."}
              </p>
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3">
              {visible.map((c) => (
                <li key={c.id} className="min-w-0">
                  <CourseCard course={c} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : courses === null ? (
        <div className="space-y-2">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : (
        <>
          {config.freeRail && <Rail id="free-h" title="Free to start" courses={freeCourses} onSeeAll={() => setOnly("free")} />}
          <Rail id="new-h" title="New on Learn" courses={newest} onSeeAll={() => setOnly("all")} />
          {courses.length === 0 && (
            <div className={`${card} flex flex-col items-center gap-2 px-5 py-10 text-center`}>
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gold/15 text-gold">
                <BookOpen className="h-6 w-6" aria-hidden />
              </span>
              <p className="text-sm font-semibold text-ink">No courses are published yet</p>
              <p className="max-w-xs text-xs text-ink-500">When schools and tutors publish courses they appear here.</p>
            </div>
          )}
        </>
      )}

      <footer className="space-y-1 border-t border-[var(--border-faint)] pt-4 text-xs text-ink-500">
        <p>
          Teaching or running a school?{" "}
          <a href={LEARN_STUDIO_URL} className="font-semibold text-gold underline">
            Open the Educator Studio
          </a>
        </p>
        <p>
          Want to look around first?{" "}
          <Link href="/learn/demo" className="font-semibold text-gold underline">
            Try the demo school
          </Link>{" "}
          (sample data)
        </p>
      </footer>
    </div>
    </div>
  );
}

export default function LearnHomePage() {
  return (
    <Suspense fallback={null}>
      <LearnHome />
    </Suspense>
  );
}
