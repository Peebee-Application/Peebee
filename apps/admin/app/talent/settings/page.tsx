"use client";

import { Fold } from "../../../components/Fold";

import { Select } from "../../../components/ui/Select";
import type { TalentAdminCategory, TalentAdminSettings, TalentJobType } from "@peebee/shared";
import { useCallback, useEffect, useState } from "react";
import { Chip, ErrorNote, Field, inputCls, label, Toggle, useTalentPermissions } from "../../../components/talent/ui";
import { api, errorMessage } from "../../../lib/api";

type NumKey = "maxOpenJobs" | "applicationsPerDay" | "postsPerHour" | "minJobUgx" | "maxJobUgx" | "jobExpiryDays" | "autoConfirmHours" | "maxMilestones" | "maxWorkersPerJob" | "searchRadiusKm" | "maxSkills" | "boostDays" | "unpaidCommissionLimitUgx" | "trialDays"
  | "recurringMaxActive" | "recurringMaxRuns" | "recurringMaxFailures" | "cancelFreeMinutes" | "lateCancelFeeUgx" | "lateCancelFeePercent" | "lateCancelPartySharePercent";

/** Ranges are exactly those in apps/api/src/talent/settings.ts. */
const NUM: Record<NumKey, { label: string; min: number; max: number; hint?: string }> = {
  maxOpenJobs: { label: "Open jobs per employer", min: 1, max: 1000 },
  applicationsPerDay: { label: "Applications per worker per day", min: 1, max: 1000, hint: "A Pro plan can lift this when 'Unlimited applications' is a Pro feature" },
  postsPerHour: { label: "Job posts per person per hour", min: 1, max: 200 },
  minJobUgx: { label: "Smallest job (UGX)", min: 0, max: 1_000_000_000 },
  maxJobUgx: { label: "Largest job (UGX)", min: 1000, max: 10_000_000_000 },
  jobExpiryDays: { label: "A job stays open for (days)", min: 1, max: 365 },
  autoConfirmHours: { label: "Pay automatically after (hours)", min: 1, max: 720, hint: "Submitted work is paid out by itself if the employer says nothing" },
  maxMilestones: { label: "Payment steps per project", min: 1, max: 50 },
  maxWorkersPerJob: { label: "People one job can ask for", min: 1, max: 500 },
  searchRadiusKm: { label: "Default search distance (km)", min: 1, max: 500 },
  maxSkills: { label: "Skills on a profile", min: 1, max: 50 },
  boostDays: { label: "A boost lasts (days)", min: 1, max: 90 },
  unpaidCommissionLimitUgx: { label: "Most unpaid fees before blocked (UGX)", min: 0, max: 1_000_000_000, hint: "For jobs paid directly: someone owing more can't take or post new work" },
  trialDays: { label: "Free Pro trial (days)", min: 0, max: 365, hint: "0 turns the trial off" },
  recurringMaxActive: { label: "Repeating jobs per employer", min: 1, max: 100 },
  recurringMaxRuns: { label: "Most times one job can repeat", min: 1, max: 520, hint: "A safety limit; employers can choose fewer" },
  recurringMaxFailures: { label: "Pause after this many failed repeats in a row", min: 1, max: 20, hint: "A repeat fails when, for example, the wallet can't cover it" },
  cancelFreeMinutes: { label: "Free cancellation for (minutes)", min: 0, max: 10080, hint: "After a job starts. Cancelling later can cost a fee" },
  lateCancelFeeUgx: { label: "Late-cancel fee, flat (UGX)", min: 0, max: 10_000_000, hint: "Used when the fee type is Flat. Default 5,000. 0 turns late fees off. Never charged while All free access is on" },
  lateCancelFeePercent: { label: "Late-cancel fee, percent (%)", min: 0, max: 50, hint: "Used when the fee type is Percent: a share of the work not yet paid" },
  lateCancelPartySharePercent: { label: "Share of the fee paid to the other person (%)", min: 0, max: 100, hint: "The rest is Peebee's" },
};
const SECTIONS: { title: string; keys: NumKey[] }[] = [
  { title: "Job limits", keys: ["minJobUgx", "maxJobUgx", "maxOpenJobs", "postsPerHour", "maxWorkersPerJob", "maxMilestones", "jobExpiryDays"] },
  { title: "Workers", keys: ["applicationsPerDay", "maxSkills", "searchRadiusKm", "boostDays"] },
  { title: "Payment", keys: ["autoConfirmHours", "unpaidCommissionLimitUgx", "trialDays"] },
  { title: "Cancellation", keys: ["cancelFreeMinutes", "lateCancelFeeUgx", "lateCancelFeePercent", "lateCancelPartySharePercent"] },
  { title: "Repeating jobs", keys: ["recurringMaxActive", "recurringMaxRuns", "recurringMaxFailures"] },
];
const TYPES: TalentJobType[] = ["gig", "project", "hiring"];

export default function TalentSettingsPage() {
  const { canManage } = useTalentPermissions();
  const [form, setForm] = useState<TalentAdminSettings | null>(null);
  const [nums, setNums] = useState<Record<string, string>>({});
  const [categories, setCategories] = useState<TalentAdminCategory[]>([]);
  const [newCat, setNewCat] = useState("");
  const [newSeg, setNewSeg] = useState<"informal" | "professional" | "both">("both");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sample, setSample] = useState<string | null>(null);

  const apply = useCallback((s: TalentAdminSettings) => {
    setForm(s);
    setNums(Object.fromEntries((Object.keys(NUM) as NumKey[]).map((k) => [k, String(s[k])])));
  }, []);
  const loadCats = useCallback(() => { api.talentAdminCategories().then((r) => setCategories(r.categories)).catch((e) => setError(errorMessage(e))); }, []);
  useEffect(() => { api.talentAdminGetSettings().then((r) => apply(r.settings)).catch((e) => setError(errorMessage(e))); loadCats(); }, [apply, loadCats]);

  if (!form) return error ? <ErrorNote message={error} /> : <p className="text-sm text-ink-500">Loading…</p>;
  const ro = !canManage;
  const set = <K extends keyof TalentAdminSettings>(k: K, v: TalentAdminSettings[K]) => { setSaved(false); setForm({ ...form, [k]: v }); };

  function problem(): string | null {
    for (const k of Object.keys(NUM) as NumKey[]) {
      const n = Number(nums[k]);
      if (nums[k] === "" || !Number.isInteger(n) || n < NUM[k].min || n > NUM[k].max) return `${NUM[k].label} must be a whole number from ${NUM[k].min.toLocaleString()} to ${NUM[k].max.toLocaleString()}.`;
    }
    if (Number(nums.minJobUgx) > Number(nums.maxJobUgx)) return "The smallest job can't be more than the largest.";
    if (form!.paymentModes.length === 0) return "Allow at least one way to pay for gigs and projects.";
    if (!form!.paymentModes.includes(form!.defaultPaymentMode)) return "The default way to pay must be one that is switched on.";
    return null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const p = problem();
    if (p) return setError(p);
    setBusy(true); setError(null); setSaved(false);
    try {
      const payload = { ...form!, ...Object.fromEntries((Object.keys(NUM) as NumKey[]).map((k) => [k, Number(nums[k])])) } as TalentAdminSettings;
      const res = await api.talentAdminUpdateSettings(payload);
      apply(res.settings);
      setSaved(true);
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {ro && <p className="text-xs text-ink-500">You can view these settings but not change them.</p>}
      <Fold title="Availability">
        <Toggle managed label="Peebee Hire is on" hint="Master switch for customers. Staff keep access to finish open work." checked={form.enabled} disabled={ro} onChange={(v) => set("enabled", v)} />
        <div className="space-y-1.5"><p className="text-xs font-semibold text-ink-500">Kinds of job people can post</p><div className="flex flex-wrap gap-1.5">{TYPES.map((t) => <Chip key={t} on={form.jobTypes.includes(t)} disabled={ro} onClick={() => set("jobTypes", form.jobTypes.includes(t) ? form.jobTypes.filter((x) => x !== t) : TYPES.filter((x) => x === t || form.jobTypes.includes(x)))}>{label(t)}</Chip>)}</div></div>
        <Toggle managed label="Find-a-worker search" hint="The directory where anyone can search for workers." checked={form.workerSearchEnabled} disabled={ro} onChange={(v) => set("workerSearchEnabled", v)} />
        <Toggle label="Riders can offer other work" checked={form.ridersCanWork} disabled={ro} onChange={(v) => set("ridersCanWork", v)} />
        <Toggle managed label="Ratings" checked={form.reviewsEnabled} disabled={ro} onChange={(v) => set("reviewsEnabled", v)} />
        <Toggle managed label="Messaging between employer and applicant" checked={form.chatEnabled} disabled={ro} onChange={(v) => set("chatEnabled", v)} />
        <Toggle label="Hide phone numbers until hired" hint="Otherwise numbers are shown to employers straight away." checked={form.hideContacts} disabled={ro} onChange={(v) => set("hideContacts", v)} />
      </Fold>

      <Fold title="Repeating jobs">
        <Toggle managed label="Employers can repeat jobs" hint="Rebook the same worker, or put the job up again, every day, week or month." checked={form.recurringEnabled} disabled={ro} onChange={(v) => set("recurringEnabled", v)} />
        <div className="space-y-1.5"><p className="text-xs font-semibold text-ink-500">Repeat intervals offered</p><div className="flex flex-wrap gap-1.5">{(["daily", "weekly", "biweekly", "monthly"] as const).map((f) => <Chip key={f} on={form.recurringFrequencies.includes(f)} disabled={ro} onClick={() => set("recurringFrequencies", form.recurringFrequencies.includes(f) ? form.recurringFrequencies.filter((x) => x !== f) : (["daily", "weekly", "biweekly", "monthly"] as const).filter((x) => x === f || form.recurringFrequencies.includes(x)))}>{label(f)}</Chip>)}</div></div>
        <p className="text-xs text-ink-500">To make repeating a Pro feature, mark &ldquo;Recurring jobs&rdquo; as Pro in the Money tab. The limits are further down.</p>
      </Fold>

      <Fold title="How gigs and projects are paid">
        <div className="flex flex-wrap gap-1.5">
          {(["escrow", "direct"] as const).map((m) => <Chip key={m} on={form.paymentModes.includes(m)} disabled={ro} onClick={() => set("paymentModes", form.paymentModes.includes(m) ? form.paymentModes.filter((x) => x !== m) : (["escrow", "direct"] as const).filter((x) => x === m || form.paymentModes.includes(x)))}>{m === "escrow" ? "Protected (escrow)" : "Direct to worker"}</Chip>)}
        </div>
        <p className="text-xs text-ink-500">Escrow holds the employer&apos;s money and releases it when the work is approved. Direct lets the two sides settle between themselves; Peebee collects its fee from each wallet. If both are on, the employer chooses.</p>
        <Field label="Default when only one choice is shown"><Select disabled={ro} value={form.defaultPaymentMode} onValueChange={(next) => set("defaultPaymentMode", next as "escrow" | "direct")} className={inputCls}><option value="escrow">Protected (escrow)</option><option value="direct">Direct to worker</option></Select></Field>
      </Fold>

      <Fold title="Approval and safety">
        <Field label="New worker profiles"><Select disabled={ro} value={form.workerApproval} onValueChange={(next) => set("workerApproval", next as "review" | "auto")} className={inputCls}><option value="review">Staff approve each one</option><option value="auto">Go live automatically</option></Select></Field>
        <Toggle label="Review every job before it goes live" hint="Off: jobs go live at once unless the safety screening flags them." checked={form.jobReview} disabled={ro} onChange={(v) => set("jobReview", v)} />
      </Fold>

      <Fold title="Charging">
        <Toggle label="All free access" hint="Overrides every fee and plan. Set the fees in the Money tab." checked={form.freeAccess} disabled={ro} onChange={(v) => set("freeAccess", v)} />
        <Toggle label="Free onboarding" checked={form.freeOnboarding} disabled={ro} onChange={(v) => set("freeOnboarding", v)} />
      </Fold>

      <Fold title="Late-cancel fee type">
        <div className="flex flex-wrap gap-1.5">{(["flat", "percent"] as const).map((m) => <Chip key={m} on={form.lateCancelFeeMode === m} disabled={ro} onClick={() => set("lateCancelFeeMode", m)}>{m === "flat" ? "Flat amount" : "Percentage"}</Chip>)}</div>
        <p className="text-xs text-ink-500">Flat is the default (UGX 5,000). The amounts are set under Cancellation below. The fee is never more than the work still to be paid for.</p>
      </Fold>

      {SECTIONS.map((sec) => (
        <section key={sec.title} className="home-card space-y-3 !p-3.5">
          <h2 className="text-sm font-bold text-ink">{sec.title}</h2>
          {sec.keys.map((k) => (
            <Field key={k} label={NUM[k].label} hint={`${NUM[k].hint ? `${NUM[k].hint}. ` : ""}${NUM[k].min.toLocaleString()} to ${NUM[k].max.toLocaleString()}`}>
              <input inputMode="numeric" disabled={ro} value={nums[k] ?? ""} onChange={(e) => { setSaved(false); setNums({ ...nums, [k]: e.target.value.replace(/\D/g, "") }); }} className={inputCls} />
            </Field>
          ))}
        </section>
      ))}

      <ErrorNote message={error} />
      {saved && <p className="rounded-xl bg-gold/10 px-3 py-2 text-sm text-ink">Saved.</p>}
      {!ro && <button type="submit" disabled={busy} className="min-h-11 w-full rounded-full bg-gold px-4 text-sm font-bold text-ink-gold disabled:opacity-50">{busy ? "Saving…" : "Save settings"}</button>}

      <Fold title="Sample data (sandbox only)">
        <p className="text-xs text-ink-500">Adds sample workers, employers and jobs of every kind so you can see Jobs working. They only appear while the platform is in sandbox and can be removed any time. Customers can also explore the same samples in practice mode, which needs no setup.</p>
        {sample && <p className="rounded-xl bg-gold/10 px-3 py-2 text-sm text-ink">{sample}</p>}
        {!ro && (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={async () => { setError(null); setSample(null); try { const r = await api.talentAdminSeedSandbox(); setSample(`Added ${r.workers} workers, ${r.employers} employers and ${r.jobs} jobs.`); } catch (err) { setError(errorMessage(err)); } }} className="min-h-11 rounded-full bg-gold px-4 text-sm font-bold text-ink-gold">Add sample jobs</button>
            <button type="button" onClick={async () => { setError(null); setSample(null); try { const r = await api.talentAdminClearSandbox(); setSample(`Removed ${r.removed} sample accounts and their jobs.`); } catch (err) { setError(errorMessage(err)); } }} className="min-h-11 rounded-full border border-[var(--border-faint)] px-4 text-sm font-bold text-ink">Remove samples</button>
          </div>
        )}
      </Fold>

      <Fold title="Kinds of work">
        <p className="text-xs text-ink-500">Workers and employers pick from this list. Turning one off hides it from new choices.</p>
        <ul className="divide-y divide-[var(--border-faint)] rounded-xl border border-[var(--border-faint)]">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className={c.active ? "text-ink" : "text-ink-500 line-through"}>{c.name} <span className="text-[11px] text-ink-500">· {label(c.segment)}</span></span>
              {!ro && <button type="button" className="text-xs font-bold text-gold underline" onClick={async () => { try { await api.talentAdminUpdateCategory(c.id, { active: !c.active }); loadCats(); } catch (err) { setError(errorMessage(err)); } }}>{c.active ? "Turn off" : "Turn on"}</button>}
            </li>
          ))}
        </ul>
        {!ro && (
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input aria-label="New kind of work" value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="New kind of work" className={inputCls} />
            <Select aria-label="Segment" value={newSeg} onValueChange={(next) => setNewSeg(next as typeof newSeg)} className={inputCls}><option value="both">Both</option><option value="informal">Trades</option><option value="professional">Professional</option></Select>
            <button type="button" disabled={newCat.trim().length < 2} onClick={async () => { try { await api.talentAdminCreateCategory({ name: newCat.trim(), segment: newSeg }); setNewCat(""); loadCats(); } catch (err) { setError(errorMessage(err)); } }} className="col-span-2 min-h-11 rounded-full border border-[var(--border-faint)] px-4 text-sm font-bold text-ink disabled:opacity-50">Add kind of work</button>
          </div>
        )}
      </Fold>
    </form>
  );
}
