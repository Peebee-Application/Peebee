"use client";

import { MapPin } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

/** If no fix has been sent for this long while sharing, warn the provider: the phone is probably locked or the page is in the background. */
const QUIET_AFTER_MS = 60_000;

type WakeLockSentinelLike = { release: () => Promise<void> };

/**
 * While a job is booked or in progress, shares this device's location every few seconds. Stops when the job ends,
 * you leave the page or you switch it off. A web page can't read location once it isn't on screen, so while sharing
 * it also asks the phone to keep the screen on, and warns when updates go quiet.
 */
export function ShareLocation({ jobId, active }: { jobId: string; active: boolean }) {
  const [on, setOn] = useState(true);
  const [state, setState] = useState<"idle" | "sharing" | "denied" | "unavailable">("idle");
  const [quiet, setQuiet] = useState(false);
  const lastSent = useRef(0);
  const lastFix = useRef(0);

  useEffect(() => {
    if (!active || !on) { setState("idle"); setQuiet(false); return; }
    if (typeof navigator === "undefined" || !navigator.geolocation) { setState("unavailable"); return; }
    setState("sharing");
    lastFix.current = Date.now();
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        lastFix.current = now;
        setQuiet(false);
        if (now - lastSent.current < 8000) return;
        lastSent.current = now;
        api.workShareLocation(jobId, pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy).catch(() => {});
      },
      (err) => setState(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    );

    // Keep the screen awake so the page stays visible and location keeps flowing. Re-asked when the page comes back on screen.
    let lock: WakeLockSentinelLike | null = null;
    const wake = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinelLike> } }).wakeLock;
    const hold = () => { if (wake && document.visibilityState === "visible") wake.request("screen").then((l) => { lock = l; }).catch(() => {}); };
    hold();
    const onVisible = () => { if (document.visibilityState === "visible") hold(); };
    document.addEventListener("visibilitychange", onVisible);

    const watchdog = window.setInterval(() => { setQuiet(Date.now() - lastFix.current > QUIET_AFTER_MS); }, 10_000);
    return () => {
      navigator.geolocation.clearWatch(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(watchdog);
      lock?.release().catch(() => {});
    };
  }, [jobId, active, on]);

  if (!active) return null;
  return (
    <section className="home-card space-y-2 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <MapPin className={`h-5 w-5 shrink-0 ${state === "sharing" && !quiet ? "text-green" : "text-ink-500"}`} aria-hidden />
          <p className="text-base font-medium text-ink-500">
            {state === "sharing" ? "The customer can see where you are. Your location is recorded during the job, and cancelling after a long stay at the address can be reviewed by Peebee." : state === "denied" ? "Location is blocked. Allow it in your browser settings so the customer can follow you." : state === "unavailable" ? "Your location isn't available right now." : "Location sharing is off."}
          </p>
        </div>
        <button type="button" onClick={() => setOn((v) => !v)} className="shrink-0 rounded-full border border-[var(--border-faint)] px-3 py-1.5 text-base font-black text-ink">{on ? "Stop" : "Share"}</button>
      </div>
      {state === "sharing" && quiet && (
        <p className="rounded-xl bg-gold/15 p-2.5 text-base font-bold text-ink" role="status">
          Location updates have stopped. Keep this page open with the screen on, and make sure location is allowed.
        </p>
      )}
    </section>
  );
}
