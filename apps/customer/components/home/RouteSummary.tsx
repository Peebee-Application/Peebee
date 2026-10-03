"use client";

import { MapPin } from "lucide-react";
import { useTranslate } from "../../lib/i18n";
import { placeSubtitle, type Place } from "../../lib/places";

/** The chosen pickup/destination (or just a delivery location) as quiet
 * rows with a Change link — the order screens' recap of the place step. */
export function RouteSummary({
  pickup,
  destination,
  destinationLabel,
  onChange,
}: {
  pickup: Place | null;
  destination: Place;
  destinationLabel: string;
  onChange: () => void;
}) {
  const t = useTranslate();
  const rows: Array<{ key: string; label: string; place: Place; dot: boolean }> = [];
  if (pickup) rows.push({ key: "pickup", label: t("place_pickup"), place: pickup, dot: true });
  rows.push({ key: "destination", label: destinationLabel, place: destination, dot: false });
  return (
    <div className="rounded-2xl bg-[rgb(var(--surface-muted))] p-3">
      <ul className="space-y-2.5">
        {rows.map((r) => (
          <li key={r.key} className="flex items-start gap-3">
            <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden>
              {r.dot ? <span className="h-3 w-3 rounded-full bg-ink ring-4 ring-[rgb(var(--color-ink)/0.15)]" /> : <MapPin className="h-5 w-5 text-gold" strokeWidth={2.25} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold text-ink-500">{r.label}</span>
              <span className="block truncate text-[15px] font-semibold text-ink">{r.place.label}</span>
              {placeSubtitle(r.place) && <span className="block truncate text-xs text-ink-500">{placeSubtitle(r.place)}</span>}
            </span>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onChange} className="mt-2.5 text-sm font-bold text-gold">
        {t("place_change")}
      </button>
    </div>
  );
}
