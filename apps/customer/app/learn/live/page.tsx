"use client";

import type { PhoneCue } from "@peebee/shared";
import { Check, Hand, Radio } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../lib/api";
import { LearnScreen, Pill, ScreenHeader, card, displayFont, monoCls, primaryBtn } from "../ui";

const SESSION_KEY = "peebee_live_session";
const LETTERS = ["A", "B", "C", "D", "E", "F"];

type Joined = { id: string; title: string; hostName: string; pollSeconds: number };

function useSecondsLeft(endsAt: string | null | undefined, offsetMs: number): number | null {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!endsAt) return setLeft(null);
    const end = Date.parse(endsAt);
    const tick = () => setLeft(Math.max(0, Math.ceil((end - (Date.now() + offsetMs)) / 1000)));
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [endsAt, offsetMs]);
  return left;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** The lesson's video (or audio) played on the phone. The link is read once per item, so a refresh of the class never restarts it. */
function LessonMedia({ cue }: { cue: PhoneCue }) {
  const [media] = useState(cue.media ?? null);
  if (!media) return null;
  if (media.contentType.startsWith("audio/")) return <audio controls autoPlay preload="auto" src={media.url} className="w-full" />;
  return <video controls autoPlay muted playsInline preload="auto" src={media.url} className="aspect-video w-full rounded-xl bg-black" />;
}

function Question({ cue, sessionId, left, onAnswered }: { cue: PhoneCue; sessionId: string; left: number | null; onAnswered: () => void }) {
  const [choice, setChoice] = useState<number | null>(cue.mine ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = cue.answered || choice !== null || !cue.open;

  async function pick(i: number) {
    if (locked) return;
    setChoice(i);
    setBusy(true);
    setError(null);
    try {
      await api.classroomRespond(sessionId, cue.id, [i]);
      onAnswered();
    } catch (err) {
      setChoice(null);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const reveal = cue.reveal;
  return (
    <div className={`${card} space-y-4 p-4`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-wider text-gold">{cue.poll ? "Poll" : "Question"}</p>
        {left !== null && cue.open && <span className="rounded-full bg-gold px-3 py-1 font-mono text-sm font-bold text-ink-gold">{clock(left)}</span>}
      </div>
      <h2 className="text-lg font-semibold text-ink">{cue.question}</h2>
      <ul className="space-y-2.5">
        {(cue.options ?? []).map((option, i) => {
          const mine = (cue.mine ?? choice) === i;
          const right = reveal && reveal.correctIndex === i;
          const wrongMine = reveal && mine && reveal.correctIndex !== i && !cue.poll;
          return (
            <li key={i}>
              <button
                type="button"
                disabled={locked || busy}
                onClick={() => void pick(i)}
                aria-pressed={mine}
                className={`flex min-h-14 w-full items-center gap-3 rounded-xl border-2 px-4 py-3 text-left text-base font-semibold transition active:scale-[0.99] ${
                  right ? "border-green bg-green/15 text-ink" : wrongMine ? "border-red-500/60 bg-red-500/10 text-ink" : mine ? "border-gold bg-gold/15 text-ink" : "border-[var(--border-faint)] text-ink"
                } disabled:cursor-default`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold text-sm font-black text-ink-gold">{LETTERS[i]}</span>
                <span className="min-w-0 flex-1">{option}</span>
                {reveal && <span className="text-sm text-ink-500">{reveal.counts[i]}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {!reveal && (cue.answered || choice !== null) && (
        <p role="status" className="flex items-center gap-1.5 text-sm font-semibold text-green">
          <Check className="h-4 w-4" aria-hidden /> Answer sent. Wait for your tutor to reveal it.
        </p>
      )}
      {!reveal && !cue.open && !cue.answered && choice === null && <p className="text-sm text-ink-500">Time&apos;s up for this one.</p>}
      {reveal && (
        <div role="status" className="space-y-1">
          {!cue.poll && <p className={`text-sm font-bold ${reveal.correct ? "text-green" : "text-red-600 dark:text-red-400"}`}>{reveal.correct === null ? "You didn't answer" : reveal.correct ? "Correct!" : "Not this time"}</p>}
          {reveal.explanation && <p className="text-sm text-ink-500">{reveal.explanation}</p>}
        </div>
      )}
    </div>
  );
}

function Exam({ cue, sessionId, left, onSubmitted }: { cue: PhoneCue; sessionId: string; left: number | null; onSubmitted: () => void }) {
  const questions = cue.questions ?? [];
  const [answers, setAnswers] = useState<number[]>(() => questions.map(() => -1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittedRef = useRef(false);
  const done = cue.answered || submittedRef.current;

  const submit = useCallback(
    async (auto: boolean) => {
      if (submittedRef.current || cue.answered) return;
      if (!auto && answers.some((a) => a < 0)) return setError("Answer every question before you hand in.");
      submittedRef.current = true;
      setBusy(true);
      setError(null);
      try {
        // Time's up with questions unanswered: they simply score nothing.
        await api.classroomRespond(sessionId, cue.id, answers);
        onSubmitted();
      } catch (err) {
        submittedRef.current = false;
        setError(errorMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [answers, cue.answered, cue.id, onSubmitted, sessionId],
  );

  // Hand in automatically when the clock runs out.
  useEffect(() => {
    if (left === 0 && !done && cue.open !== false) void submit(true);
  }, [left, done, cue.open, submit]);

  return (
    <div className="space-y-4">
      <div className={`${card} flex items-center justify-between gap-3 p-4`}>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-gold">Exam</p>
          <h2 className="truncate text-lg font-semibold text-ink">{cue.title}</h2>
        </div>
        {left !== null && !cue.revealed && <span className="rounded-full bg-gold px-3 py-1 font-mono text-base font-bold text-ink-gold">{clock(left)}</span>}
      </div>

      {cue.result && (
        <p role="status" className="rounded-xl bg-green/10 px-4 py-3 text-sm font-semibold text-green">
          Handed in. {cue.revealed ? `You scored ${cue.result.score} out of ${cue.result.outOf}.` : "Your tutor will share the results."}
        </p>
      )}

      {questions.map((q, qi) => {
        const review = cue.review?.[qi];
        return (
          <fieldset key={qi} disabled={done || !cue.open} className={`${card} space-y-2.5 p-4`}>
            <legend className="px-1 text-sm font-semibold text-ink">
              {qi + 1}. {q.question}
            </legend>
            {q.options.map((option, oi) => (
              <label
                key={oi}
                className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-base transition ${
                  review && review.correctIndex === oi ? "border-green bg-green/15" : answers[qi] === oi ? "border-gold bg-gold/15" : "border-[var(--border-faint)]"
                }`}
              >
                <input type="radio" name={`q${qi}`} checked={answers[qi] === oi} onChange={() => setAnswers((prev) => prev.map((a, i) => (i === qi ? oi : a)))} className="h-5 w-5 accent-[rgb(var(--color-gold))]" />
                <span className="text-ink">{option}</span>
              </label>
            ))}
            {review?.explanation && <p className="text-sm text-ink-500">{review.explanation}</p>}
          </fieldset>
        );
      })}

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {!done && cue.open && (
        <button type="button" onClick={() => void submit(false)} disabled={busy} className="w-full rounded-xl bg-gold px-4 py-3.5 text-base font-semibold text-ink-gold disabled:opacity-50">
          {busy ? "Handing in…" : "Hand in my exam"}
        </button>
      )}
      {!done && !cue.open && <p className="text-sm text-ink-500">Time&apos;s up. This exam is closed.</p>}
    </div>
  );
}

function Attendance({ cue, sessionId, present, onDone }: { cue: PhoneCue; sessionId: string; present: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function mark() {
    setBusy(true);
    setError(null);
    try {
      await api.classroomRespond(sessionId, cue.id, []);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  const here = present || cue.answered;
  return (
    <div className={`${card} space-y-4 p-6 text-center`}>
      <p className="text-xs font-bold uppercase tracking-wider text-gold">Attendance</p>
      {here ? (
        <p role="status" className="flex items-center justify-center gap-2 text-xl font-bold text-green">
          <Check className="h-6 w-6" aria-hidden /> You&apos;re marked present
        </p>
      ) : (
        <button type="button" onClick={mark} disabled={busy || !cue.open} className="w-full rounded-2xl bg-gold px-6 py-6 text-2xl font-black text-ink-gold disabled:opacity-50">
          {busy ? "…" : "I'm here"}
        </button>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

export default function LiveClassPage() {
  const [joined, setJoined] = useState<Joined | null>(null);
  const [code, setCode] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [cue, setCue] = useState<PhoneCue | null>(null);
  const [status, setStatus] = useState<"live" | "ended">("live");
  const [present, setPresent] = useState(false);
  const [hand, setHand] = useState(false);
  const [title, setTitle] = useState("");
  const [hostName, setHostName] = useState("");
  const [offset, setOffset] = useState(0);
  const [lost, setLost] = useState<string | null>(null);
  const versionRef = useRef(0);
  const refreshNow = useRef<() => void>(() => undefined);

  const join = useCallback(async (value: string) => {
    setJoining(true);
    setJoinError(null);
    try {
      const res = await api.classroomJoin(value.trim());
      try {
        window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(res.session));
      } catch {
        /* private mode */
      }
      versionRef.current = 0;
      setTitle(res.session.title);
      setHostName(res.session.hostName);
      setJoined(res.session);
    } catch (err) {
      setJoinError(errorMessage(err));
    } finally {
      setJoining(false);
    }
  }, []);

  // A link from the TV's QR code carries the code; a reload keeps you in the class.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("code");
    if (fromUrl && /^\d{6}$/.test(fromUrl)) {
      setCode(fromUrl);
      void join(fromUrl);
      return;
    }
    try {
      const saved = window.sessionStorage.getItem(SESSION_KEY);
      if (saved) {
        const s = JSON.parse(saved) as Joined;
        setTitle(s.title);
        setHostName(s.hostName);
        setJoined(s);
      }
    } catch {
      /* ignore */
    }
  }, [join]);

  // Ask the server for changes. When nothing changed the answer is a few bytes.
  useEffect(() => {
    if (!joined) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let every = joined.pollSeconds;
    const tick = async () => {
      try {
        const res = await api.classroomState(joined.id, versionRef.current || undefined);
        if (cancelled) return;
        setLost(null);
        if (res.changed) {
          versionRef.current = res.version;
          setOffset(Date.parse(res.serverNow) - Date.now());
          setCue(res.cue);
          setStatus(res.status);
          setPresent(res.present);
          setHand(res.handRaised);
          setTitle(res.session.title);
          setHostName(res.session.hostName);
        }
      } catch (err) {
        if (cancelled) return;
        const message = errorMessage(err);
        if (/not found|wasn't found/i.test(message)) {
          try {
            window.sessionStorage.removeItem(SESSION_KEY);
          } catch {
            /* ignore */
          }
          setJoined(null);
          return;
        }
        setLost("Reconnecting…");
      }
      if (!cancelled) timer = setTimeout(tick, every * 1000);
    };
    refreshNow.current = () => {
      clearTimeout(timer);
      versionRef.current = 0;
      void tick();
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [joined]);

  const left = useSecondsLeft(cue?.endsAt, offset);

  async function toggleHand() {
    if (!joined) return;
    const next = !hand;
    setHand(next);
    try {
      await api.classroomHand(joined.id, next);
    } catch {
      setHand(!next);
    }
  }

  function leave() {
    try {
      window.sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
    setJoined(null);
    setCue(null);
    setCode("");
  }

  if (!joined) {
    return (
      <LearnScreen width="max-w-md">
        <ScreenHeader
          back={{ href: "/learn", label: "Learn" }}
          label="Peebee Learn"
          title="Join a live class"
          icon={Radio}
          subtitle="Enter the 6-digit code shown on the classroom screen, or scan its picture with your camera."
        />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void join(code);
          }}
          className={`${card} relative space-y-4 overflow-hidden p-5`}
        >
          <span className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-[radial-gradient(circle,rgb(var(--color-gold)/0.35),transparent_70%)]" aria-hidden />
          <label htmlFor="live-code" className={`${displayFont} relative block text-sm font-semibold text-ink`}>
            Class code
          </label>
          <div className="field-box relative rounded-2xl border border-[var(--border-faint)]">
          <input
            id="live-code"
            inputMode="numeric"
            autoComplete="off"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className={`${monoCls} h-16 w-full text-center text-3xl font-medium tracking-[0.3em] text-ink outline-none`}
            placeholder="000000"
          />
          </div>
          {joinError && (
            <p role="alert" className="relative text-sm text-red-600 dark:text-red-400">
              {joinError}
            </p>
          )}
          <button type="submit" disabled={joining || code.length !== 6} className={`${primaryBtn} relative w-full !py-3.5 !text-base`}>
            {joining ? "Joining…" : "Join class"}
          </button>
        </form>
      </LearnScreen>
    );
  }

  return (
    <LearnScreen width="max-w-md" bottom="pb-28">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="mb-1">
            <Pill tone={status === "live" ? "green" : "muted"}>
              <span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${status === "live" ? "animate-pulse bg-green" : "bg-ink-500"}`} aria-hidden /> {status === "live" ? "Live" : "Ended"}
            </Pill>
          </p>
          <h1 className={`${displayFont} truncate text-xl font-bold tracking-[-0.02em] text-ink`}>{title}</h1>
          {hostName && <p className="truncate text-xs text-ink-500">with {hostName}</p>}
        </div>
        <button type="button" onClick={leave} className="shrink-0 rounded-[13px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3 py-2 text-xs font-semibold text-ink">
          Leave
        </button>
      </header>
      {lost && (
        <p role="status" className="rounded-xl bg-gold/10 px-3.5 py-2.5 text-xs text-ink">
          {lost}
        </p>
      )}

      {status === "ended" ? (
        <div className={`${card} space-y-2 p-6 text-center`}>
          <h2 className={`${displayFont} text-lg font-semibold text-ink`}>This class has ended</h2>
          <p className="text-sm text-ink-500">Thanks for joining. Your tutor will share anything that needs following up.</p>
          <Link href="/learn/my" className="inline-block pt-2 text-sm font-semibold text-gold underline">
            Back to my learning
          </Link>
        </div>
      ) : !cue ? (
        <div className={`${card} space-y-2 p-6 text-center`}>
          <h2 className={`${displayFont} text-lg font-semibold text-ink`}>You&apos;re in</h2>
          <p className="text-sm text-ink-500">Watch the classroom screen. Questions will appear here when your tutor sends them.</p>
        </div>
      ) : (
        <div key={cue.id} className="space-y-4">
          {cue.kind === "question" && <Question cue={cue} sessionId={joined.id} left={left} onAnswered={() => refreshNow.current()} />}
          {cue.kind === "exam" && <Exam cue={cue} sessionId={joined.id} left={left} onSubmitted={() => refreshNow.current()} />}
          {cue.kind === "attendance" && <Attendance cue={cue} sessionId={joined.id} present={present} onDone={() => refreshNow.current()} />}
          {(cue.kind === "slide" || cue.kind === "lesson") && (
            <div className={`${card} space-y-2 p-5`}>
              <p className="text-xs font-bold uppercase tracking-wider text-gold">{cue.kind === "lesson" ? "Now" : "Slide"}</p>
              <h2 className={`${displayFont} text-xl font-bold text-ink`}>{cue.title}</h2>
              {cue.media && <LessonMedia cue={cue} />}
              {cue.body && <p className="whitespace-pre-line text-sm text-ink">{cue.body}</p>}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {cue.imageUrl && <img src={cue.imageUrl} alt="" className="w-full rounded-xl" />}
            </div>
          )}
          {cue.kind === "announcement" && (
            <div className={`${card} space-y-2 p-5`}>
              <p className="text-xs font-bold uppercase tracking-wider text-gold">Announcement</p>
              <p className={`${displayFont} text-xl font-bold text-ink`}>{cue.text}</p>
            </div>
          )}
          {cue.kind === "timer" && (
            <div className={`${card} space-y-2 p-6 text-center`}>
              {cue.label && <p className="text-sm font-semibold text-ink">{cue.label}</p>}
              <p className={`${monoCls} text-6xl font-medium text-ink`}>{left === null ? clock(cue.seconds ?? 0) : clock(left)}</p>
            </div>
          )}
        </div>
      )}

      {status === "live" && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border-faint)] bg-[rgb(var(--surface-card)/0.85)] p-3 backdrop-blur-md pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-md">
            <button
              type="button"
              onClick={() => void toggleHand()}
              aria-pressed={hand}
              className={`flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-semibold transition active:scale-[0.98] ${hand ? "bg-gold text-ink-gold" : "border border-[var(--border-faint)] text-ink"}`}
            >
              <Hand className="h-4 w-4" aria-hidden /> {hand ? "Hand raised. Tap to lower" : "Raise my hand"}
            </button>
          </div>
        </div>
      )}
    </LearnScreen>
  );
}
