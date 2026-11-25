import { useEffect, useState } from "react";
import { MapPinned } from "lucide-react";
import type { useLocationLabel } from "./location";

const taglines = [
  "Travel with Taxibee",
  "Find your ride",
  "Ready to go?",
  "Go with Peebee",
];

export const brandDescriptionId = "taxibee-current-location";

export function TaxibeeBrand({ label, status, modeLabel }: ReturnType<typeof useLocationLabel> & { modeLabel: string | null }) {
  const [tagline, setTagline] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const location = label ?? (status === "idle" || status === "locating" ? "Locating…" : "Location unavailable");

  useEffect(() => {
    if (paused) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let timer: number;
    const schedule = () => {
      window.clearTimeout(timer);
      if (motion.matches) {
        setTagline(null);
        return;
      }
      const choices = (label ? [null, ...taglines] : taglines).filter(choice => choice !== tagline);
      timer = window.setTimeout(() => {
        setTagline(choices[Math.floor(Math.random() * choices.length)]);
      }, 5000 + Math.floor(Math.random() * 2001));
    };
    schedule();
    motion.addEventListener("change", schedule);
    return () => {
      window.clearTimeout(timer);
      motion.removeEventListener("change", schedule);
    };
  }, [label, status, tagline, paused]);

  return <span className="taxibee-header-brand" onPointerEnter={event => {
    if (event.pointerType === "mouse") setPaused(true);
  }} onPointerLeave={() => setPaused(false)}>
    <img src="/brand/peebee-logo-dark.svg?v=logo-6" width={40} height={40} alt="" />
    <span className="taxibee-header-brand-copy">
      <span className="taxibee-header-brand-name">Peebee{modeLabel && <sup>{modeLabel}</sup>}</span>
      <span className="taxibee-header-brand-detail" aria-hidden="true">
        {!tagline && <MapPinned size={11} aria-hidden />}
        <span>{tagline ?? location}</span>
      </span>
    </span>
    <span id={brandDescriptionId} hidden>{label ? `Current location: ${label}` : location}</span>
  </span>;
}
