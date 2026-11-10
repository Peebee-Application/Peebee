"use client";

import { ModuleState } from "../../../components/ModuleState";
import { hasPermission, type GuestSettings } from "@peebee/shared";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { SettingsPageShell } from "../../../components/SettingsPageShell";
import { api, errorMessage } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";

function Row({ label, hint, checked, disabled, onChange, managed }: { label: string; hint: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void; managed?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-[var(--border-faint)] pt-4 first:border-t-0 first:pt-0">
      <div>
        <span className="block text-sm font-bold text-ink">{label}</span>
        <span className="text-xs text-ink-500">{hint}</span>
      </div>
      {managed ? <ModuleState on={checked} /> : (
        <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
        className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${checked ? "bg-gold" : "bg-neutral-300 dark:bg-neutral-700"}`}>
        <span className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${checked ? "translate-x-5" : "translate-x-0"}`} />
      </button>
      )}
    </div>
  );
}

export default function GuestSettingsPage() {
  const { user } = useAuth();
  const canManage = hasPermission(user?.adminRole ?? null, "settings.manage");
  const [form, setForm] = useState<GuestSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setForm((await api.adminGetGuestSettings()).guest), []);
  useEffect(() => { load().catch((err) => setError(errorMessage(err))); }, [load]);

  const set = <K extends keyof GuestSettings>(key: K, value: GuestSettings[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form || !canManage) return;
    if (!Number.isInteger(form.maxQuantity) || form.maxQuantity < 1 || form.maxQuantity > 50) { setError("Most of one item per guest order must be a whole number from 1 to 50."); return; }
    if (form.notifyWhatsapp && !/^[a-z0-9_]+$/.test(form.whatsappTemplate)) { setError("Enter the approved WhatsApp template name (lowercase letters, numbers, underscores) to use WhatsApp."); return; }
    setSaving(true); setError(null); setSaved(false);
    try {
      setForm((await api.adminUpdateGuestSettings(form)).guest);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) { setError(errorMessage(err)); }
    finally { setSaving(false); }
  }

  const off = !canManage;
  return (
    <SettingsPageShell title="Guest access" loading={!form && !error}>
      {form && (
        <form onSubmit={save} className="space-y-6 pb-12">
          {error && <div role="alert" className="flex items-center gap-3 rounded-2xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"><AlertCircle className="h-5 w-5 shrink-0" /><p>{error}</p></div>}
          {saved && <div role="status" className="flex items-center gap-3 rounded-2xl bg-green/10 p-4 text-sm font-semibold text-green"><CheckCircle2 className="h-5 w-5 shrink-0" /><p>Guest checkout settings saved.</p></div>}

          <section className="space-y-4 rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 shadow-sm">
            <div>
              <h2 className="text-base font-bold text-ink">Guest browsing</h2>
              <p className="text-xs text-ink-500">Signed-out visitors can look around the customer app. Cart, checkout, wallet, payments, orders, account, settings and notifications still ask them to sign in. Off keeps today&apos;s sign-in screen.</p>
            </div>
            <Row label="Allow guest browsing" hint="Shows “Browse as guest” on the welcome screen" checked={form.browsingEnabled} disabled={off} onChange={(v) => set("browsingEnabled", v)} />
          </section>

          <section className="space-y-4 rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 shadow-sm">
            <div>
              <h2 className="text-base font-bold text-ink">Guest checkout</h2>
              <p className="text-xs text-ink-500">People opening a shared product link can buy without an account. They always pay first, by mobile money (or card when Flutterwave is the active provider), and get a tracking code.</p>
            </div>
            <Row managed label="Allow guest checkout" hint="Shows “Buy as a guest” on shared product links" checked={form.enabled} disabled={off} onChange={(v) => set("enabled", v)} />
            <Row label="Offer card payment" hint="Only shown while Flutterwave is the active collection provider" checked={form.cardEnabled} disabled={off} onChange={(v) => set("cardEnabled", v)} />
            <Row label="Suggest creating an account" hint="A checkbox, ticked by default, that makes an account from the details the guest gave" checked={form.suggestAccount} disabled={off} onChange={(v) => set("suggestAccount", v)} />
            <Row label="Show status to anyone with the tracking code" hint="Off: guests must sign in (create an account) to track, or wait for messages" checked={form.codeStatusEnabled} disabled={off} onChange={(v) => set("codeStatusEnabled", v)} />
            <label className="block space-y-1 border-t border-[var(--border-faint)] pt-4 text-sm font-bold text-ink">Most of one item per guest order
              <input type="number" min={1} max={50} value={form.maxQuantity} disabled={off} onChange={(e) => set("maxQuantity", Number(e.target.value))} className="mt-1 min-h-11 w-32 rounded-xl px-3 text-base font-normal" />
            </label>
          </section>

          <section className="space-y-4 rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 shadow-sm">
            <div>
              <h2 className="text-base font-bold text-ink">Delivery alerts for guests</h2>
              <p className="text-xs text-ink-500">Sent when an order is received, paid, collected by a rider, on its way, arrived and delivered. Each message goes out once per channel. SMS, WhatsApp and email use the providers set up under Sales onboarding and Email.</p>
            </div>
            <Row label="In-app notification with sound" hint="Browser push (if the guest allowed it); the order page also plays the sound" checked={form.notifyPush} disabled={off} onChange={(v) => set("notifyPush", v)} />
            <Row label="Message in the order chat" hint="A message from Peebee in the order's chat" checked={form.notifyChat} disabled={off} onChange={(v) => set("notifyChat", v)} />
            <Row label="SMS" hint="Text message to the guest's phone" checked={form.notifySms} disabled={off} onChange={(v) => set("notifySms", v)} />
            <Row label="Email" hint="Only when the guest gave an email address" checked={form.notifyEmail} disabled={off} onChange={(v) => set("notifyEmail", v)} />
            <Row label="WhatsApp" hint="Needs an approved template with two variables: name, message" checked={form.notifyWhatsapp} disabled={off} onChange={(v) => set("notifyWhatsapp", v)} />
            <label className="block space-y-1 border-t border-[var(--border-faint)] pt-4 text-sm font-bold text-ink">WhatsApp template name
              <input value={form.whatsappTemplate} disabled={off} onChange={(e) => set("whatsappTemplate", e.target.value.trim())} placeholder="order_update" className="mt-1 min-h-11 w-full rounded-xl px-3 text-base font-normal" />
            </label>
          </section>

          {canManage && <button type="submit" disabled={saving} className="flex min-h-12 w-full items-center justify-center rounded-full bg-gold px-6 text-sm font-bold text-ink-gold disabled:opacity-60">{saving ? "Saving…" : "Save changes"}</button>}
        </form>
      )}
      {!form && error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </SettingsPageShell>
  );
}
