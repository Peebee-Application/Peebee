"use client";

import type { TvDevice } from "@peebee/shared";
import { CheckCircle2, MonitorPlay, Tv, Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import { api, errorMessage } from "../../../lib/api";
import { Empty, ErrorNote, LearnScreen, Pill, ScreenHeader, SectionTitle, Skeleton, card, displayFont, ghostBtn, monoCls, primaryBtn } from "../ui";

const TV_URL = (process.env.NEXT_PUBLIC_TV_URL ?? "https://tv.peebee.online").replace(/^https?:\/\//, "").replace(/\/$/, "");

const clean = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);

function LinkTv() {
  const asked = useSearchParams().get("code");
  const [code, setCode] = useState(() => clean(asked ?? ""));
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState<string | null>(null);
  const [devices, setDevices] = useState<TvDevice[] | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDevices((await api.tvDevices()).devices);
    } catch {
      setDevices([]);
    }
  }, []);

  useEffect(() => {
    void load();
    // Who is linked is worth keeping fresh: the TV shows up here the moment it connects.
    const timer = setInterval(() => void load(), 15000);
    return () => clearInterval(timer);
  }, [load]);

  async function link(e: FormEvent) {
    e.preventDefault();
    if (code.length !== 6) return;
    setBusy(true);
    setError(null);
    setLinked(null);
    try {
      const res = await api.tvPair(code, name.trim(), "learn");
      setLinked(res.device.name);
      setCode("");
      setName("");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await api.tvRemove(id);
      setRemoving(null);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <LearnScreen>
      <ScreenHeader
        back={{ href: "/learn", label: "Learn" }}
        label="Peebee Learn"
        title="Watch on your TV"
        icon={Tv}
        subtitle="Study on the big screen: watch lessons, take quizzes and pick up where you left off. Your progress stays in sync with your phone."
      />

      <section aria-labelledby="link-h" className={`${card} relative space-y-4 overflow-hidden p-4`}>
        <span className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-[radial-gradient(circle,rgb(var(--color-gold)/0.35),transparent_70%)]" aria-hidden />
        <h2 id="link-h" className={`${displayFont} relative text-base font-semibold text-ink`}>
          Link a TV
        </h2>
        <ol className="relative space-y-2.5 text-[13px] text-ink-500">
          {[
            <>On your TV, open the browser and go to <strong className="text-ink">{TV_URL}</strong></>,
            <>The TV shows a 6-character code. Type it here, then tap <strong className="text-ink">Link TV</strong>.</>,
            <>That&apos;s it. Your courses appear on the TV within a few seconds.</>,
          ].map((step, n) => (
            <li key={n} className="flex items-start gap-2.5">
              <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gold/20 text-[11px] font-bold text-gold">{n + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <form onSubmit={link} className="relative space-y-3">
          <div className="field-box rounded-2xl border border-[var(--border-faint)]">
          <input
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            maxLength={6}
            value={code}
            onChange={(e) => setCode(clean(e.target.value))}
            aria-label="Code shown on the TV"
            placeholder="ABC123"
            className={`${monoCls} h-14 w-full text-center text-2xl font-medium tracking-[0.35em] text-ink outline-none`}
          />
          </div>
          <div className="field-box rounded-2xl border border-[var(--border-faint)]">
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 60))}
            aria-label="Name for this TV (optional)"
            placeholder="Name this TV (optional), e.g. Living room"
            className="h-11 w-full text-sm text-ink outline-none"
          />
          </div>
          <button type="submit" disabled={busy || code.length !== 6} className={`${primaryBtn} w-full`}>
            {busy ? "Linking…" : "Link TV"}
          </button>
          <p className="text-[11px] text-ink-500">Only link a TV that is showing this same code. The TV will be able to open your courses and lessons. It can never spend your money.</p>
        </form>
        {error && <ErrorNote>{error}</ErrorNote>}
        {linked && (
          <p role="status" className="relative flex items-start gap-2 rounded-2xl bg-green/10 px-3.5 py-3 text-sm font-semibold text-green">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {linked} is linked. Look at your TV: your courses are on the screen.
          </p>
        )}
      </section>

      <section aria-labelledby="tvs-h" className="space-y-3">
        <SectionTitle id="tvs-h" icon={MonitorPlay}>
          Your TVs
        </SectionTitle>
        {devices === null ? (
          <Skeleton className="h-16" />
        ) : devices.length === 0 ? (
          <Empty icon={Tv}>No TV is linked yet.</Empty>
        ) : (
          <ul className="space-y-2.5">
            {devices.map((d) => (
              <li key={d.id} className={`${card} flex items-center justify-between gap-3 p-3.5`}>
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] bg-gold/15 text-gold">
                    <Tv className="h-[18px] w-[18px]" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{d.name}</p>
                    <p className="mt-0.5">{d.online ? <Pill tone="green">On now</Pill> : <Pill tone="muted">Off or not connected</Pill>}</p>
                  </div>
                </div>
                {removing === d.id ? (
                  <span className="flex shrink-0 items-center gap-2 text-xs">
                    <button type="button" onClick={() => void remove(d.id)} className={`${primaryBtn} !rounded-xl !px-3 !py-1.5 !text-xs`}>
                      Unlink
                    </button>
                    <button type="button" onClick={() => setRemoving(null)} className={`${ghostBtn} !rounded-xl !px-3 !py-1.5 !text-xs`}>
                      Keep
                    </button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setRemoving(d.id)} aria-label={`Unlink ${d.name}`} className="shrink-0 rounded-xl p-2 text-ink-500 hover:text-ink">
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </LearnScreen>
  );
}

export default function WatchOnTvPage() {
  return (
    <Suspense fallback={null}>
      <LinkTv />
    </Suspense>
  );
}
