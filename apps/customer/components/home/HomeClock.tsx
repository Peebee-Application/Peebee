"use client";
import { useEffect, useState, type CSSProperties } from "react";
import type { HomePersonalizationSettings } from "@peebee/shared";
import { homeClock, homeGreeting } from "../../lib/personalized-home";

export function HomeClock({ rules, name }: { rules: HomePersonalizationSettings; name?: string }) {
  const [now, setNow] = useState<Date | null>(null);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const update = () => { if (document.visibilityState === "visible") setNow(new Date()); };
    update();
    // Clock freshness is independent of the visual flip cadence, including minute/day rollover.
    const timer = setInterval(update, 1000);
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const motion = () => setReduced(media.matches);
    motion(); media.addEventListener("change", motion);
    document.addEventListener("visibilitychange", update);
    return () => { clearInterval(timer); media.removeEventListener("change", motion); document.removeEventListener("visibilitychange", update); };
  }, []);
  const value = now ? homeClock(now) : null;
  return <div className="ph-greeting">
    {rules.clockEnabled && <div className={`ph-clock ${reduced ? "is-static" : ""}`} style={{ "--clock-cycle": `${rules.clockHoldSeconds * 2}s` } as CSSProperties}>
      <span className="sr-only">{value ? `${value.time}, ${value.date}` : "Local date and time"}</span>
      <span aria-hidden className="ph-clock-time">{value?.time ?? "\u00a0"}</span>
      <span aria-hidden className="ph-clock-date">{value?.date ?? "\u00a0"}</span>
    </div>}
    <h1>{now ? homeGreeting(now, rules) : "Hello"}{name ? `, ${name}` : ""}{now && homeGreeting(now, rules) === "Still up" ? "?" : ""}</h1>
  </div>;
}
