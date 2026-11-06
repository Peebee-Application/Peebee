"use client";

import type { ScreenState } from "@peebee/shared";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { JoinCard } from "../../components/JoinCard";
import { TrialPicker } from "../../components/TrialPicker";
import { StageCue } from "../../components/Stage";
import { TvAuthError, tvApi } from "../../lib/api";
import { useDevice } from "../../lib/device";
import { useBack } from "../../lib/dpad";
import { useServerClock } from "../../lib/time";

/** The classroom: shows whatever the tutor has pushed to this screen. */
export default function LearnPage() {
  const router = useRouter();
  const { state: device, secret, lost, pollSeconds, trial, setTrial } = useDevice();
  const [screen, setScreen] = useState<ScreenState | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const now = useServerClock(screen?.serverNow);
  // Back leaves a practice class too, so the next visit starts from the home screen.
  const goHome = useCallback(() => {
    void (trial ? setTrial(null) : Promise.resolve()).finally(() => router.push("/"));
  }, [router, trial, setTrial]);
  useBack(goHome);

  // Any key press counts as the "tap" some TVs need before they allow sound.
  useEffect(() => {
    const on = () => setSoundOn(true);
    window.addEventListener("keydown", on, { once: true });
    return () => window.removeEventListener("keydown", on);
  }, []);

  const interval = useRef(pollSeconds);
  interval.current = screen?.pollSeconds ?? pollSeconds;
  useEffect(() => {
    if (!secret) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const next = await tvApi.screen(secret);
        if (!cancelled) setScreen(next);
      } catch (err) {
        if (err instanceof TvAuthError) return lost();
        /* a dropped connection: keep showing what we have and try again */
      }
      if (!cancelled) timer = setTimeout(tick, Math.max(1, interval.current) * 1000);
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [secret, lost]);

  // A screen that isn't paired has no classroom of its own, but it can show a practice class.
  useEffect(() => {
    if (device.phase === "pairing" && !trial) router.replace("/");
  }, [device.phase, trial, router]);

  if (!screen) return <main className="tv-safe flex min-h-screen items-center justify-center text-[1.6rem] text-ink-500">Connecting to your class…</main>;

  if (!screen.session) {
    return (
      <main className="tv-safe flex min-h-screen flex-col items-center justify-center gap-[1.6rem] text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/peebee-logo-dark.svg?v=logo-6" alt="" width={96} height={96} className="h-[6rem] w-[6rem]" />
        <h1 className="text-[3.6rem] font-black text-ink">Waiting for your tutor</h1>
        <p className="max-w-[44rem] text-[1.5rem] leading-snug text-ink-500">
          In Peebee Learn, start a class and choose <strong className="text-ink">{screen.device.name}</strong>.
        </p>
        <div className="mt-[1.2rem] w-full max-w-[84rem] text-left">
          <TrialPicker heading="While you wait, watch a practice class" />
        </div>
        <p className="text-[1.1rem] text-ink-500">Back returns home</p>
      </main>
    );
  }

  const session = screen.session;
  return (
    <main className="tv-safe flex min-h-screen flex-col gap-[1.4rem]">
      <header className="flex items-center justify-between">
        <p className="text-[1.3rem] font-bold text-ink-500">{session.title}</p>
        <div className="flex items-center gap-[1.2rem]">
          {session.trial && (
            <>
              <span className="rounded-full bg-gold/15 px-[1rem] py-[0.3rem] text-[1rem] font-bold uppercase tracking-wide text-gold">Practice class</span>
              <button
                type="button"
                data-focusable
                onClick={goHome}
                className="rounded-full border border-[var(--border-faint)] px-[1.2rem] py-[0.4rem] text-[1rem] font-bold text-ink focus:bg-gold focus:text-ink-gold"
              >
                Leave practice class
              </button>
            </>
          )}
          <p className="text-[1.1rem] text-ink-500">Peebee Learn</p>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 gap-[2.4rem]">
        <section key={screen.cue?.id ?? "idle"} className="tv-fade-in min-h-0 min-w-0 flex-1" aria-live="polite">
          {screen.cue ? (
            <StageCue cue={screen.cue} state={screen} now={now} soundOn={soundOn} />
          ) : (
            <div className="flex h-full flex-col justify-center gap-[1rem]">
              <p className="text-[1.1rem] font-bold uppercase tracking-[0.2em] text-gold">Class in session</p>
              <h1 className="text-[4.4rem] font-black leading-[1.08] text-ink">{session.title}</h1>
              <p className="text-[1.6rem] text-ink-500">Join from your phone with the code on the right.</p>
            </div>
          )}
        </section>
        <JoinCard code={session.code} url={session.joinUrl} participants={session.participants} present={session.present} hands={session.hands} />
      </div>
    </main>
  );
}
