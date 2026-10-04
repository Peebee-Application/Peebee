"use client";

import type { ServiceKey } from "@peebee/shared";
import { PauseCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";

const NAMES: Record<ServiceKey, string> = { shopping: "Shopping lists", parcel: "Parcel delivery", ride: "Rides", food: "Food ordering" };
const WATCH: ServiceKey[] = ["food"];

/** Tells a restaurant that food ordering is paused. */
export function ServiceBanner() {
  const [paused, setPaused] = useState<ServiceKey[]>([]);

  useEffect(() => {
    let stopped = false;
    const check = () =>
      api
        .getSettings()
        .then((res) => {
          if (!stopped) setPaused(WATCH.filter((k) => res.settings.services?.[k] === false));
        })
        .catch(() => {});
    check();
    const timer = setInterval(check, 60_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  if (paused.length === 0) return null;
  const all = paused.length === WATCH.length;
  return (
    <div className="flex items-start gap-2 bg-gold/15 px-4 py-2.5 text-sm text-ink" role="status">
      <PauseCircle className="mt-0.5 h-4 w-4 shrink-0 text-gold" strokeWidth={2.25} aria-hidden />
      <p>
        <span className="font-bold">{all && WATCH.length > 1 ? "All services are paused." : `${paused.map((k) => NAMES[k]).join(", ")} ${paused.length > 1 || paused[0] === "ride" ? "are" : "is"} paused.`}</span>{" "}
        No new orders will arrive; orders already in progress carry on as normal.
      </p>
    </div>
  );
}
