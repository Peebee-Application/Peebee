"use client";

import type { LearnProStatus } from "@peebee/shared";
import { Monitor, Smartphone, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Chip, Crumbs, Notice, Skeleton, cardCls } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";

const ugx = (n: number) => (n > 0 ? `UGX ${n.toLocaleString("en-UG")}` : "Free");
const dateOf = (iso: string) => new Date(iso).toLocaleDateString("en-UG", { day: "numeric", month: "long", year: "numeric" });

export default function ProPage() {
  const [status, setStatus] = useState<LearnProStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () => api.proStatus().then(setStatus).catch((err) => setError(errorMessage(err)));
  useEffect(() => {
    void load();
  }, []);

  async function subscribe() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.proSubscribe();
      setNotice(`You have Learn Pro until ${dateOf(res.expiresAt)}.`);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const tv = status?.tv;
  const needsFunds = error ? /wallet/i.test(error) : false;

  return (
    <div className="space-y-5 pb-6">
      <Crumbs items={[{ label: "Home", href: "/" }, { label: "Learn Pro" }]} />
      <header className="space-y-1">
        <p className="text-base font-bold uppercase tracking-wider text-gold">Peebee Learn</p>
        <h2 className="font-display text-2xl font-semibold text-ink">Learn Pro</h2>
        <p className="text-lg text-ink-500">Everything for teaching a whole room from one screen.</p>
      </header>

      {error && (
        <Notice tone="error">
          {error}{" "}
          {needsFunds && (
            <a href="https://app.peebee.online/wallet" className="font-semibold underline">
              Open your wallet
            </a>
          )}
        </Notice>
      )}
      {notice && <Notice tone="success">{notice}</Notice>}

      {!status ? (
        <Skeleton className="h-48" />
      ) : (
        <>
          {!tv!.required && (
            <Notice tone="info">The TV classroom is free for every educator right now. You don&apos;t need Pro to use it.</Notice>
          )}

          <section className={`${cardCls} space-y-4 p-5`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-gold" aria-hidden />
                <h3 className="text-base font-semibold text-ink">What Pro includes</h3>
              </div>
              {tv!.pro ? <Chip tone="green">{tv!.expiresAt ? `Pro until ${dateOf(tv!.expiresAt)}` : "Pro, no end date"}</Chip> : <Chip>Not on Pro</Chip>}
            </div>
            <ul className="space-y-3 text-lg text-ink">
              <li className="flex items-start gap-3">
                <Monitor className="mt-0.5 h-5 w-5 shrink-0 text-gold" aria-hidden />
                <span>
                  <strong>TV classroom.</strong> Connect smart TVs, show slides, lessons and questions on the big screen, and see live results.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-ink-500" aria-hidden />
                <span className="text-ink-500">
                  <strong className="text-ink">Always free:</strong> teaching to students&apos; phones, quizzes, exams, attendance and everything else in the Studio.
                </span>
              </li>
            </ul>

            {tv!.required && !tv!.pro && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-faint)] pt-4">
                <p className="text-lg text-ink">
                  <strong>{ugx(status.priceUgx)}</strong> for {status.days} days, paid from your Peebee wallet.
                </p>
                <Button onClick={() => void subscribe()} disabled={busy}>
                  {busy ? "Working…" : "Get Learn Pro"}
                </Button>
              </div>
            )}
            {tv!.required && tv!.pro && tv!.expiresAt && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-faint)] pt-4">
                <p className="text-lg text-ink-500">Renew early and the days you have left are kept.</p>
                <Button variant="secondary" onClick={() => void subscribe()} disabled={busy}>
                  {busy ? "Working…" : `Add ${status.days} days for ${ugx(status.priceUgx)}`}
                </Button>
              </div>
            )}
          </section>

          <p className="text-base text-ink-500">
            Practice classes on a TV are always free. <Link href="/screens" className="font-semibold text-gold underline">Connect a screen</Link>
          </p>
        </>
      )}
    </div>
  );
}
