"use client";

import { useEffect, useRef, useState } from "react";

export type FoundPlace = { label: string; lat: number; lng: number };

/** A search box that finds Ugandan places (OpenStreetMap) and reports the chosen one. */
export function PlaceSearch({ label, value, onPick }: { label: string; value: FoundPlace | null; onPick: (p: FoundPlace | null) => void }) {
  const [query, setQuery] = useState(value?.label ?? "");
  const [results, setResults] = useState<FoundPlace[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!open || query.trim().length < 3) {
      setResults([]);
      return;
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=ug&q=${encodeURIComponent(query)}`);
        const rows = (await res.json()) as Array<{ display_name: string; lat: string; lon: string }>;
        setResults(rows.map((r) => ({ label: r.display_name.split(",").slice(0, 3).join(",").trim(), lat: Number(r.lat), lng: Number(r.lon) })));
      } catch {
        setResults([]);
      }
    }, 400);
    return () => window.clearTimeout(timer.current);
  }, [open, query]);

  return (
    <div className="relative space-y-1">
      <label className="text-xs font-semibold text-ink-500">{label}</label>
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (value) onPick(null);
        }}
        placeholder="Search a town or place"
        className="min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-3"
      />
      {open && results.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface))] shadow-lg">
          {results.map((r) => (
            <li key={`${r.lat},${r.lng}`}>
              <button
                type="button"
                onClick={() => {
                  onPick(r);
                  setQuery(r.label);
                  setOpen(false);
                }}
                className="block w-full px-3 py-2.5 text-left text-sm text-ink"
              >
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {value && <p className="text-xs text-green">Selected ✓</p>}
    </div>
  );
}
