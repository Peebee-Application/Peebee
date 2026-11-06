"use client";

import { Fold } from "../../../components/Fold";
import { ModuleState } from "../../../components/ModuleState";
import { Select } from "../../../components/ui/Select";
import { Switch } from "../../../components/ui/Switch";
import {
  WORK_SETTINGS_EXTRA_DEFAULTS,
  type WorkAdminSettings,
  type WorkMatchingMode,
  type WorkPricingMode,
  type WorkProviderKind,
  type WorkServiceType,
} from "@peebee/shared";
import { useEffect, useState } from "react";
import { ErrorNote, Field, inputCls, label, useWorkPermissions } from "../../../components/work/ui";
import { api, errorMessage } from "../../../lib/api";

type NumKey =
  | "commissionPercent" | "offerWindowMinutes" | "radiusKm" | "maxNotified" | "minLeadMinutes" | "maxAdvanceDays" | "quoteValidHours"
  | "maxQuoteUgx" | "freeCancelMinutes" | "lateCancelFeePercent" | "autoConfirmHours" | "disputeWindowHours" | "jobsPerHour"
  | "maxRematches" | "maxPhotosPerJob" | "maxPhotoKb" | "onsiteRadiusM" | "onsiteMinMinutes" | "onsiteSuspendAfterFlags" | "onsiteWindowDays" | "locationRetentionDays";
type BoolKey = "scheduleTomorrowEnabled" | "enabled" | "requireApproval" | "rematchOnProviderCancel" | "photosEnabled" | "chatEnabled" | "trackingEnabled" | "onsiteCheckEnabled" | "onsiteFlagNoLocation" | "onsiteRequireLocation";

/** Ranges are exactly those in apps/api/src/settings/routes.ts (`work`). */
const NUM: Record<NumKey, { label: string; min: number; max: number; hint?: string }> = {
  commissionPercent: { label: "Commission (%)", min: 0, max: 60, hint: "Peebee's share; a service can override it" },
  offerWindowMinutes: { label: "Offer window (minutes)", min: 5, max: 10080, hint: "How long an unclaimed job stays open" },
  radiusKm: { label: "Search radius (km)", min: 1, max: 200 },
  maxNotified: { label: "Max providers notified", min: 1, max: 200 },
  minLeadMinutes: { label: "Minimum lead time (minutes)", min: 0, max: 10080 },
  maxAdvanceDays: { label: "Max days ahead", min: 1, max: 365 },
  quoteValidHours: { label: "Quote valid (hours)", min: 1, max: 336 },
  maxQuoteUgx: { label: "Max quote (UGX)", min: 1000, max: 1_000_000_000 },
  freeCancelMinutes: { label: "Free cancel window (minutes)", min: 0, max: 1440, hint: "After a provider is on the job" },
  lateCancelFeePercent: { label: "Late cancel fee (%)", min: 0, max: 100 },
  autoConfirmHours: { label: "Auto-confirm after (hours)", min: 1, max: 336 },
  disputeWindowHours: { label: "Problem report window (hours)", min: 1, max: 720 },
  jobsPerHour: { label: "Bookings per customer per hour", min: 1, max: 100 },
  maxRematches: { label: "Max re-matches per job", min: 0, max: 10, hint: "Times a job can go back to other providers before refund" },
  maxPhotosPerJob: { label: "Max photos per job", min: 1, max: 30 },
  maxPhotoKb: { label: "Largest photo (KB)", min: 100, max: 10240 },
  onsiteRadiusM: { label: "On-site distance (metres)", min: 20, max: 2000, hint: "How close to the job address counts as being on site" },
  onsiteMinMinutes: { label: "Minutes on site before a cancellation is flagged", min: 1, max: 1440 },
  onsiteSuspendAfterFlags: { label: "Suspend after this many flags", min: 0, max: 50, hint: "0 turns automatic suspension off" },
  onsiteWindowDays: { label: "…within this many days", min: 1, max: 365 },
  locationRetentionDays: { label: "Keep location trails (days)", min: 1, max: 365, hint: "Trails behind an unreviewed flag are kept until it is reviewed" },
};

const SECTIONS: { title: string; keys: NumKey[] }[] = [
  { title: "Pricing", keys: ["commissionPercent", "maxQuoteUgx", "quoteValidHours"] },
  { title: "Matching and scheduling", keys: ["offerWindowMinutes", "radiusKm", "maxNotified", "minLeadMinutes", "maxAdvanceDays"] },
  { title: "Cancellation, payout and problems", keys: ["freeCancelMinutes", "lateCancelFeePercent", "autoConfirmHours", "disputeWindowHours", "jobsPerHour"] },
];

const TYPES: WorkServiceType[] = ["clean", "fix", "laundry"];
const PRICING: WorkPricingMode[] = ["fixed", "quote"];
const MATCHING: WorkMatchingMode[] = ["broadcast", "customer_picks", "admin_assigns"];
const KINDS: WorkProviderKind[] = ["individual", "company"];

const DEFAULTS: WorkAdminSettings = {
  enabled: true, serviceTypes: ["clean"], pricingModes: ["fixed", "quote"], matchingModes: ["broadcast", "customer_picks"], defaultMatching: "broadcast",
  providerKinds: ["individual", "company"], commissionPercent: 15, requireApproval: true, offerWindowMinutes: 60, radiusKm: 15, maxNotified: 20,
  minLeadMinutes: 30, maxAdvanceDays: 30, quoteValidHours: 24, maxQuoteUgx: 5_000_000, freeCancelMinutes: 10, lateCancelFeePercent: 20,
  autoConfirmHours: 24, disputeWindowHours: 48, jobsPerHour: 6, ...WORK_SETTINGS_EXTRA_DEFAULTS,
};

type Form = Required<WorkAdminSettings>;
const withDefaults = (w: Partial<WorkAdminSettings> | undefined): Form => ({ ...DEFAULTS, ...(w ?? {}) }) as Form;

function Toggle({ label: text, hint, checked, disabled, onChange, managed }: { label: string; hint?: string; managed?: boolean; checked: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3">
      {managed ? <ModuleState on={checked} /> : <Switch checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />}
      <span>
        <span className="block text-sm font-semibold text-ink">{text}</span>
        {hint && <span className="block text-xs text-ink-500">{hint}</span>}
      </span>
    </label>
  );
}

function Chips<T extends string>({ options, value, disabled, onChange }: { options: readonly T[]; value: T[]; disabled: boolean; onChange: (v: T[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== o) : options.filter((x) => x === o || value.includes(x)))}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-bold disabled:opacity-60 ${on ? "border-gold bg-gold/15 text-ink" : "border-[var(--border-faint)] text-ink-500"}`}
          >
            {label(o)}
          </button>
        );
      })}
    </div>
  );
}

export default function WorkSettingsPage() {
  const { canEditSettings, canManage } = useWorkPermissions();
  const [form, setForm] = useState<Form | null>(null);
  const [nums, setNums] = useState<Record<string, string>>({});
  const [quick, setQuick] = useState("60, 180");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  function apply(w: Partial<WorkAdminSettings> | undefined) {
    const next = withDefaults(w);
    setForm(next);
    setQuick(next.scheduleQuickMinutes.join(", "));
    setNums(Object.fromEntries((Object.keys(NUM) as NumKey[]).map((k) => [k, String(next[k])])));
  }

  useEffect(() => {
    api
      .workAdminGetSettings()
      .then((r) => apply(r.settings.work))
      .catch((err) => setError(errorMessage(err)));
  }, []);

  if (!form) return error ? <ErrorNote message={error} /> : <p className="text-sm text-ink-500">Loading…</p>;

  const ro = !canEditSettings;
  const setBool = (k: BoolKey, v: boolean) => { setSaved(false); setForm({ ...form, [k]: v }); };
  const setList = <K extends "serviceTypes" | "pricingModes" | "matchingModes" | "providerKinds">(k: K, v: Form[K]) => { setSaved(false); setForm({ ...form, [k]: v }); };

  /** "30, 60, 180" -> [30, 60, 180]; null when it is not a list of up to four different whole minutes from 5 to 4320. */
  function parseQuick(text: string): number[] | null {
    const parts = text.split(",").map((t) => t.trim()).filter(Boolean);
    const hours = parts.map(Number);
    if (parts.length > 4 || hours.some((h) => !Number.isInteger(h) || h < 5 || h > 4320) || new Set(hours).size !== hours.length) return null;
    return hours.sort((a, b) => a - b);
  }

  function problem(): string | null {
    if (!form) return null;
    for (const k of Object.keys(NUM) as NumKey[]) {
      const spec = NUM[k];
      const n = Number(nums[k]);
      if (nums[k] === "" || !Number.isInteger(n) || n < spec.min || n > spec.max) return `${spec.label} must be a whole number from ${spec.min.toLocaleString()} to ${spec.max.toLocaleString()}.`;
    }
    if (parseQuick(quick) === null) return "Quick times must be up to four different whole minutes from 5 to 4320, like 60, 180.";
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(form.scheduleTomorrowTime)) return "Choose a time for the Tomorrow option.";
    if (form.pricingModes.length === 0) return "Turn on at least one pricing mode.";
    if (form.matchingModes.length === 0) return "Turn on at least one matching mode.";
    if (form.providerKinds.length === 0) return "Allow at least one provider kind.";
    if (!form.matchingModes.includes(form.defaultMatching)) return "The default matching must be one that is switched on.";
    return null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const p = problem();
    if (p) return setError(p);
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const payload = { ...form, scheduleQuickMinutes: parseQuick(quick) ?? [], ...Object.fromEntries((Object.keys(NUM) as NumKey[]).map((k) => [k, Number(nums[k])])) } as WorkAdminSettings;
      const res = await api.workAdminUpdateSettings(payload);
      apply(res.settings.work);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const numField = (k: NumKey) => (
    <Field key={k} label={NUM[k].label} hint={`${NUM[k].hint ? `${NUM[k].hint}. ` : ""}${NUM[k].min.toLocaleString()} to ${NUM[k].max.toLocaleString()}`}>
      <input
        inputMode="numeric"
        disabled={ro}
        value={nums[k] ?? ""}
        onChange={(e) => { setSaved(false); setNums({ ...nums, [k]: e.target.value.replace(/[^\d]/g, "") }); }}
        className={inputCls}
      />
    </Field>
  );

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {ro && (
        <p className="text-xs text-ink-500">
          {canManage ? "Saving Work settings also needs the settings.manage permission, which you don't have." : "You can view these settings but not change them."}
        </p>
      )}

      <Fold title="Availability">
        <Toggle managed label="Peebee Work is on" hint="Master switch for customers and providers. Staff keep access to finish open jobs." checked={form.enabled} disabled={ro} onChange={(v) => setBool("enabled", v)} />
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-ink-500">Kinds of work customers can book</p>
          <Chips options={TYPES} value={form.serviceTypes} disabled={ro} onChange={(v) => setList("serviceTypes", v)} />
          <p className="text-xs text-ink-500">
            {TYPES.map((t) => `${label(t)} ${form.serviceTypes.includes(t) ? "on" : "off"}`).join(" · ")}
          </p>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-ink-500">Pricing modes</p>
          <Chips options={PRICING} value={form.pricingModes} disabled={ro} onChange={(v) => setList("pricingModes", v)} />
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-ink-500">Matching modes</p>
          <Chips options={MATCHING} value={form.matchingModes} disabled={ro} onChange={(v) => setList("matchingModes", v)} />
          <p className="text-xs text-ink-500">If more than one is on, the customer chooses; otherwise the default is used.</p>
        </div>
        <Field label="Default matching">
          <Select disabled={ro} value={form.defaultMatching} onValueChange={(next) => { setSaved(false); setForm({ ...form, defaultMatching: next as WorkMatchingMode }); }} className={inputCls}>
            {MATCHING.map((m) => <option key={m} value={m}>{label(m)}</option>)}
          </Select>
        </Field>
      </Fold>

      <Fold title="Providers">
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-ink-500">Who may register</p>
          <Chips options={KINDS} value={form.providerKinds} disabled={ro} onChange={(v) => setList("providerKinds", v)} />
        </div>
        <Toggle label="Require staff approval" hint="Providers must be approved before they can go online or take jobs." checked={form.requireApproval} disabled={ro} onChange={(v) => setBool("requireApproval", v)} />
      </Fold>

      {SECTIONS.map((s) => (
        <section key={s.title} className="home-card space-y-3">
          <h2 className="text-sm font-bold text-ink">{s.title}</h2>
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">{s.keys.map(numField)}</div>
        </section>
      ))}

      <Fold title="Provider cancellations, photos, chat and tracking">
        <Toggle
          label="Re-match when a provider cancels"
          hint="Offer the job to other providers instead of refunding the customer."
          checked={form.rematchOnProviderCancel}
          disabled={ro}
          onChange={(v) => setBool("rematchOnProviderCancel", v)}
        />
        {numField("maxRematches")}
        <Toggle managed label="Photos on jobs" checked={form.photosEnabled} disabled={ro} onChange={(v) => setBool("photosEnabled", v)} />
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
          {numField("maxPhotosPerJob")}
          {numField("maxPhotoKb")}
        </div>
        <Toggle managed label="Chat" hint="Customer and provider can message about a job." checked={form.chatEnabled} disabled={ro} onChange={(v) => setBool("chatEnabled", v)} />
        <Toggle managed label="Live tracking" hint="Customer sees the provider's location while the job is on." checked={form.trackingEnabled} disabled={ro} onChange={(v) => setBool("trackingEnabled", v)} />
      </Fold>

      <Fold title="Quick times when scheduling">
        <p className="text-xs text-ink-500">Choices a customer can tap when they book for later, on the Hive home and the booking page. Only times inside the minimum lead time and days ahead above are shown.</p>
        <Field label="Minutes from now" hint="Up to four durations in minutes, from 5 to 4320 (3 days), separated by commas. 60 shows as “In 1 hour”, 180 as “In 3 hours”. Leave empty for none.">
          <input disabled={ro} value={quick} onChange={(e) => { setSaved(false); setQuick(e.target.value.replace(/[^\d,\s]/g, "")); }} className={inputCls} inputMode="numeric" />
        </Field>
        <Toggle managed label="Offer “Tomorrow”" hint="The following day, at the time below (the customer's local time)." checked={form.scheduleTomorrowEnabled} disabled={ro} onChange={(v) => setBool("scheduleTomorrowEnabled", v)} />
        <Field label="Tomorrow at" hint="Shown to customers with the time, like “Tomorrow 9:00 am”.">
          <input type="time" disabled={ro} value={form.scheduleTomorrowTime} onChange={(e) => { setSaved(false); setForm({ ...form, scheduleTomorrowTime: e.target.value }); }} className={inputCls} />
        </Field>
      </Fold>

      <Fold title="On-site checks">
        <p className="text-xs text-ink-500">
          Records where a provider is during a job, and flags a cancellation that comes after a long stay at the customer&apos;s address, so staff can look into possible off-app cash deals.
          A flag is a reason to look, not proof. Providers are told their location is recorded.
        </p>
        <Toggle managed label="On-site checks" hint="Off by default. Needs migration 0100 and live tracking to be on." checked={form.onsiteCheckEnabled} disabled={ro} onChange={(v) => setBool("onsiteCheckEnabled", v)} />
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
          {numField("onsiteRadiusM")}
          {numField("onsiteMinMinutes")}
        </div>
        <Field label="When a cancellation is flagged" hint="“Flag only” leaves the provider working until staff review it.">
          <Select disabled={ro} value={form.onsiteAction} onValueChange={(next) => { setSaved(false); setForm({ ...form, onsiteAction: next as "flag" | "suspend" }); }} className={inputCls}>
            <option value="flag">Flag only (staff review)</option>
            <option value="suspend">Flag and suspend the provider until reviewed</option>
          </Select>
        </Field>
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
          {numField("onsiteSuspendAfterFlags")}
          {numField("onsiteWindowDays")}
        </div>
        <Toggle label="Also flag jobs with no location at all" hint="The provider held the job that long, never shared a location, then it was cancelled." checked={form.onsiteFlagNoLocation} disabled={ro} onChange={(v) => setBool("onsiteFlagNoLocation", v)} />
        <Toggle label="Providers must share location to start a job" hint="They can only tap Start with a location update from the last few minutes. Location is only collected while a job is booked or in progress." checked={form.onsiteRequireLocation} disabled={ro} onChange={(v) => setBool("onsiteRequireLocation", v)} />
        {numField("locationRetentionDays")}
      </Fold>

      <ErrorNote message={error} />
      {saved && <p className="text-sm font-medium text-green">Saved.</p>}
      {!ro && (
        <button type="submit" disabled={busy} className="min-h-12 w-full rounded-[20px] bg-gold px-4 text-sm font-bold text-ink-gold shadow disabled:opacity-60">
          {busy ? "Saving…" : "Save settings"}
        </button>
      )}
    </form>
  );
}
