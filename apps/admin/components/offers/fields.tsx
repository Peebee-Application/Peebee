"use client";

import { useEffect, useState, type ReactNode } from "react";
import { adminRequest, requestErrorMessage } from "../../lib/admin-request";
import { Select } from "../ui/Select";
import { Switch } from "../ui/Switch";
import { toast } from "../shell/Toaster";

const input = "w-full rounded-xl border border-[var(--border-faint)] px-4 py-3.5 text-base outline-none focus:border-gold";

export function Card({ title, hint, children, badge }: { title?: string; hint?: string; children: ReactNode; badge?: ReactNode }) {
  return (
    <section className="home-card space-y-4">
      {(title || hint) && (
        <header className="flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-lg font-extrabold text-ink">{title}</h2>}
            {hint && <p className="mt-0.5 text-sm text-ink-500">{hint}</p>}
          </div>
          {badge}
        </header>
      )}
      {children}
    </section>
  );
}

export function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex items-start gap-2.5">
      <Switch checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block text-base font-bold text-ink">{label}</span>
        {hint && <span className="block text-sm text-ink-500">{hint}</span>}
      </span>
    </label>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="block text-sm font-bold text-ink-500">{label}</span>
      {children}
      {hint && <span className="block text-sm text-ink-500">{hint}</span>}
    </div>
  );
}

/** A whole-number field that keeps what the admin typed while they type and hands back a number. */
export function NumberField({ label, hint, value, onChange, suffix, min = 0, max, step }: { label: string; hint?: string; value: number; onChange: (v: number) => void; suffix?: string; min?: number; max?: number; step?: number }) {
  // While the admin is typing we show exactly what they typed; otherwise the saved number.
  const [typing, setTyping] = useState<string | null>(null);
  return (
    <Field label={suffix ? `${label} (${suffix})` : label} hint={hint}>
      <input
        inputMode="decimal"
        value={typing ?? String(value)}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d.]/g, "");
          setTyping(raw);
          const n = Number(raw);
          if (raw !== "" && Number.isFinite(n)) onChange(Math.min(max ?? Infinity, Math.max(min, step ? Math.round(n / step) * step : n)));
        }}
        onBlur={() => setTyping(null)}
        className={input}
      />
    </Field>
  );
}

export function TextField({ label, hint, value, onChange, placeholder, maxLength }: { label: string; hint?: string; value: string; onChange: (v: string) => void; placeholder?: string; maxLength?: number }) {
  return (
    <Field label={label} hint={hint}>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} maxLength={maxLength} className={input} />
    </Field>
  );
}

export function SelectField<T extends string>({ label, hint, value, onChange, options }: { label: string; hint?: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <Field label={label} hint={hint}>
      <Select value={value} onValueChange={(v: string) => onChange(v as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
    </Field>
  );
}

export function Grid({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 }) {
  return <div className={`grid gap-3 ${cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>{children}</div>;
}

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  return <p className={`rounded-xl px-4 py-3 text-base ${tone === "warn" ? "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200" : "bg-surface-muted text-ink-500"}`}>{children}</p>;
}

export function Pill({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-surface-muted px-3 py-1 text-xs font-bold uppercase tracking-wide text-ink-500">{children}</span>;
}

export const ugx = (n: number) => `UGX ${Math.round(n).toLocaleString("en-UG")}`;

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export type WindowValue = { days: number[]; from: string; to: string };

export function WindowsEditor({ value, onChange }: { value: WindowValue[]; onChange: (v: WindowValue[]) => void }) {
  const update = (i: number, patch: Partial<WindowValue>) => onChange(value.map((w, j) => (j === i ? { ...w, ...patch } : w)));
  return (
    <div className="space-y-3">
      {value.map((w, i) => (
        <div key={i} className="space-y-2 rounded-xl border border-[var(--border-faint)] p-3">
          <div className="flex flex-wrap gap-1.5">
            {DAY_LABELS.map((d, day) => {
              const on = w.days.length === 0 || w.days.includes(day);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    const current = w.days.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : w.days;
                    const next = current.includes(day) ? current.filter((x) => x !== day) : [...current, day].sort();
                    update(i, { days: next.length === 7 ? [] : next });
                  }}
                  className={`min-h-11 rounded-full px-4 py-2 text-sm font-bold ${on ? "bg-gold text-ink" : "bg-surface-muted text-ink-500"}`}
                >
                  {d}
                </button>
              );
            })}
          </div>
          <Grid>
            <Field label="From"><input type="time" value={w.from} onChange={(e) => update(i, { from: e.target.value })} className={input} /></Field>
            <Field label="To"><input type="time" value={w.to} onChange={(e) => update(i, { to: e.target.value })} className={input} /></Field>
          </Grid>
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="text-xs font-semibold text-red-600">Remove this window</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...value, { days: [], from: "07:00", to: "09:00" }])} className="text-sm font-semibold text-gold">+ Add a time window</button>
      <p className="text-xs text-ink-500">Times are Kampala time. A window may run past midnight, such as 22:00 to 05:00. All seven days selected means every day.</p>
    </div>
  );
}

export type ZoneValue = { lat: number; lng: number; radiusKm: number; label: string };

export function ZonesEditor({ value, onChange }: { value: ZoneValue[]; onChange: (v: ZoneValue[]) => void }) {
  const update = (i: number, patch: Partial<ZoneValue>) => onChange(value.map((z, j) => (j === i ? { ...z, ...patch } : z)));
  return (
    <div className="space-y-3">
      {value.map((z, i) => (
        <div key={i} className="space-y-2 rounded-xl border border-[var(--border-faint)] p-3">
          <TextField label="Name" value={z.label} onChange={(v) => update(i, { label: v })} placeholder="Entebbe airport" maxLength={80} />
          <Grid cols={3}>
            <NumberField label="Latitude" value={z.lat} onChange={(v) => update(i, { lat: v })} min={-90} max={90} />
            <NumberField label="Longitude" value={z.lng} onChange={(v) => update(i, { lng: v })} min={-180} max={180} />
            <NumberField label="Radius" suffix="km" value={z.radiusKm} onChange={(v) => update(i, { radiusKm: v })} min={0.1} max={500} />
          </Grid>
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="text-xs font-semibold text-red-600">Remove this zone</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...value, { lat: 0.3136, lng: 32.5811, radiusKm: 2, label: "" }])} className="text-sm font-semibold text-gold">+ Add a zone</button>
    </div>
  );
}

export type ConfigKind = "offers" | "discountWallet" | "incentives" | "credit";
export type ConfigBundle = {
  offers: any; discountWallet: any; incentives: any; credit: any;
  available: { offers: boolean; discountWallet: boolean; incentives: boolean; credit: boolean };
  defaults: { offers: any; discountWallet: any; incentives: any; credit: any };
};

/** Loads Admin → Offers settings once and saves one of the four configs. Everything the page edits lives in `draft`. */
export function useOffersConfig<K extends ConfigKind>(kind: K) {
  const [bundle, setBundle] = useState<ConfigBundle | null>(null);
  const [draft, setDraft] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    adminRequest<ConfigBundle>("/admin/offers/config")
      .then((b) => {
        if (!alive) return;
        setBundle(b);
        setDraft(b[kind]);
      })
      .catch((err) => { if (alive) setError(requestErrorMessage(err)); });
    return () => { alive = false; };
  }, [kind]);

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await adminRequest<Record<string, unknown>>(`/admin/offers/config/${kind}`, { method: "PUT", body: draft });
      setDraft(res[kind]);
      setBundle((b) => (b ? { ...b, [kind]: res[kind] } : b));
      setSaved(true);
    } catch (err) {
      const message = requestErrorMessage(err);
      setError(message);
      toast(message, "error");
    } finally {
      setBusy(false);
    }
  }
  return { bundle, draft, setDraft, error, busy, saved, save, loading: !bundle };
}

export { input as inputClass };
