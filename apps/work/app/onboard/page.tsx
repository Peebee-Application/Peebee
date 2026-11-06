"use client";

import type { WorkPublicSettings, WorkService } from "@peebee/shared";
import { Building2, Check, User } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

const CATEGORY_LABEL: Record<string, string> = { house: "Homes", office: "Offices", pet: "Pets", car: "Cars", household: "Household items" };

export default function OnboardPage() {
  const { user, setProvider, refreshProvider } = useAuth();
  const [services, setServices] = useState<WorkService[]>([]);
  const [settings, setSettings] = useState<WorkPublicSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kind, setKind] = useState<"individual" | "company">("individual");
  const [displayName, setDisplayName] = useState(user?.name ?? "");
  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [bio, setBio] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .workCatalog()
      .then((res) => {
        setServices(res.services);
        setSettings(res.settings);
        const kinds = res.settings.providerKinds ?? ["individual", "company"];
        if (!kinds.includes("individual") && kinds.includes("company")) setKind("company");
      })
      .catch((err) => setLoadError(errorMessage(err)));
  }, []);

  const kinds = (settings?.providerKinds ?? ["individual", "company"]) as ("individual" | "company")[];
  const grouped = useMemo(() => {
    const map = new Map<string, WorkService[]>();
    for (const s of services) map.set(s.category || "other", [...(map.get(s.category || "other") ?? []), s]);
    return [...map.entries()];
  }, [services]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (selected.size === 0) {
      setError("Choose at least one service you offer.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.workProviderRegister({
        kind, displayName: displayName.trim(), companyName: kind === "company" ? companyName.trim() : undefined,
        phone: phone.trim() || undefined, bio: bio.trim(), serviceIds: [...selected],
      });
      setProvider(res.provider);
      await refreshProvider();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <h1 className="text-xl font-black text-ink">Set up your provider account</h1>
        <p className="mt-1 text-base font-medium text-ink-500">Tell us who you are and what you do. Peebee reviews every account before it can take jobs.</p>
      </div>

      {loadError && <div className="rounded-2xl bg-red-500/10 p-3 text-base font-bold text-red-600" role="alert">{loadError}</div>}
      {error && <div className="rounded-2xl bg-red-500/10 p-3 text-base font-bold text-red-600" role="alert">{error}</div>}

      <section className="space-y-2">
        <h2 className="text-base font-black uppercase tracking-wider text-ink-500">I work as</h2>
        <div className="grid grid-cols-2 gap-2">
          {([
            { id: "individual", label: "An individual", hint: "Just me", icon: User },
            { id: "company", label: "A company", hint: "With a team", icon: Building2 },
          ] as const).filter((k) => kinds.includes(k.id)).map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => setKind(k.id)}
              className={`flex flex-col items-start gap-1 rounded-2xl border p-3 text-left transition active:scale-[0.98] ${kind === k.id ? "border-gold bg-gold/10" : "border-[var(--border-faint)]"}`}
            >
              <k.icon className={`h-5 w-5 ${kind === k.id ? "text-gold" : "text-ink-500"}`} aria-hidden />
              <span className="text-lg font-black text-ink">{k.label}</span>
              <span className="text-sm font-medium text-ink-500">{k.hint}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="home-card space-y-4 p-4">
        <label className="block space-y-1">
          <span className="text-base font-bold text-ink-500">{kind === "company" ? "Contact person" : "Your name"}</span>
          <input required minLength={2} maxLength={80} value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="w-full text-lg font-medium text-ink outline-none" />
        </label>
        {kind === "company" && (
          <label className="block space-y-1">
            <span className="text-base font-bold text-ink-500">Company name</span>
            <input required minLength={2} maxLength={100} value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="w-full text-lg font-medium text-ink outline-none" />
          </label>
        )}
        <label className="block space-y-1">
          <span className="text-base font-bold text-ink-500">Phone customers can reach you on</span>
          <input type="tel" value={phone ?? ""} onChange={(e) => setPhone(e.target.value)} className="w-full text-lg font-medium text-ink outline-none" />
        </label>
        <label className="block space-y-1">
          <span className="text-base font-bold text-ink-500">About you (optional)</span>
          <textarea rows={3} maxLength={500} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Experience, equipment, areas you cover…" className="w-full resize-none text-lg font-medium text-ink outline-none" />
        </label>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-black uppercase tracking-wider text-ink-500">What you offer</h2>
        {services.length === 0 && !loadError && <p className="text-base text-ink-500">Loading services…</p>}
        {grouped.map(([category, items]) => (
          <div key={category} className="space-y-1.5">
            <p className="text-base font-black text-ink">{CATEGORY_LABEL[category] ?? category}</p>
            <div className="flex flex-wrap gap-2">
              {items.map((s) => {
                const on = selected.has(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(s.id)}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-base font-bold transition active:scale-95 ${on ? "border-gold bg-gold text-ink-gold" : "border-[var(--border-faint)] text-ink"}`}
                  >
                    {on && <Check className="h-3 w-3" aria-hidden />}
                    {s.name}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      <button type="submit" disabled={busy || services.length === 0} className="w-full min-h-16 rounded-2xl bg-gold text-xl font-black text-ink-gold shadow transition active:scale-[0.98] disabled:opacity-50">
        {busy ? "Submitting…" : "Submit for approval"}
      </button>
    </form>
  );
}
