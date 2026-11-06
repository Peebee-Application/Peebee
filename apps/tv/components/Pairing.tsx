"use client";

import { Qr } from "./JoinCard";
import { DemoScreen } from "./DemoScreen";
import { TrialPicker } from "./TrialPicker";

const CUSTOMER_URL = (process.env.NEXT_PUBLIC_CUSTOMER_URL ?? "https://peebee.online").replace(/\/$/, "");

/** First run: a big code to type into the Peebee app on a phone, and a QR code that opens the same page with the code filled in. */
export function Pairing({ code, linkUrl }: { code: string | null; linkUrl: string | null }) {
  const url = linkUrl ?? `${CUSTOMER_URL}/learn/tv${code ? `?code=${code}` : ""}`;
  return (
    <main className="tv-safe flex min-h-screen flex-col justify-center gap-[2rem]">
      <div className="tv-fade-in grid w-full max-w-[84rem] grid-cols-[1fr_18rem] items-center gap-[3.5rem]">
        <section className="space-y-[1.4rem]">
          <p className="text-[1.1rem] font-bold uppercase tracking-[0.22em] text-gold">Peebee TV</p>
          <h1 className="text-[3.4rem] font-black leading-[1.05] text-ink">Link this TV to your account</h1>
          <ol className="space-y-[0.6rem] text-[1.5rem] leading-snug text-ink-500">
            <li>
              <strong className="text-ink">1.</strong> Open <strong className="text-ink">Peebee</strong> on your phone: <strong className="text-ink">Learn</strong> › <strong className="text-ink">Watch on your TV</strong>
            </li>
            <li>
              <strong className="text-ink">2.</strong> Type this code, or scan the picture
            </li>
          </ol>
          <p className="font-mono text-[6.2rem] font-black leading-none tracking-[0.18em] text-ink" aria-label={code ? `Code ${code.split("").join(" ")}` : "Getting a code"}>
            {code ?? "······"}
          </p>
          <p className="text-[1.05rem] text-ink-500">
            The code changes every few minutes. Teachers: add this screen in Peebee Learn › Screens.
          </p>
        </section>
        <Qr value={url} label="QR code that opens the page to link this TV in the Peebee app" className="aspect-square w-full" />
      </div>
      <div className="w-full max-w-[84rem]">
        <TrialPicker />
      </div>
      <div className="w-full max-w-[84rem]">
        <DemoScreen />
      </div>
    </main>
  );
}
