"use client";

import { Fold } from "../../../components/Fold";
import {
  hasPermission,
  type AdCampaignReport, type AdsConfig, type VideoAdminProvider, type VideoConfig, type VideoProviderKey,
} from "@peebee/shared";
import { AlertCircle, CheckCircle2, Megaphone, Video } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { SettingsPageShell, SettingsSaveBar } from "../../../components/SettingsPageShell";
import { api, errorMessage } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";

const ugx = (n: number) => `UGX ${n.toLocaleString()}`;

function Toggle({ on, disabled, onChange, label }: { on: boolean; disabled: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out disabled:opacity-60 ${on ? "bg-gold" : "bg-neutral-300 dark:bg-neutral-700"}`}
    >
      <span className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${on ? "translate-x-5" : "translate-x-0"}`} />
    </button>
  );
}

function SwitchRow({ title, hint, on, disabled, onChange }: { title: string; hint: string; on: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-[var(--border-faint)] pt-4">
      <div className="min-w-0">
        <span className="block text-sm font-bold text-ink">{title}</span>
        <span className="text-xs text-ink-500">{hint}</span>
      </div>
      <Toggle on={on} disabled={disabled} onChange={onChange} label={title} />
    </div>
  );
}

function NumberField({ id, label, hint, value, min, max, step, disabled, onChange }: { id: string; label: string; hint: string; value: number; min: number; max: number; step?: number; disabled: boolean; onChange: (v: number) => void }) {
  return (
    <div className="field-box flex flex-col rounded-2xl bg-[rgb(var(--surface-muted))] p-3">
      <label htmlFor={id} className="mb-1 text-xs font-bold text-ink-500">{label}</label>
      <input id={id} type="number" inputMode="numeric" min={min} max={max} step={step ?? 1} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} className="w-full text-sm text-ink outline-none" />
      <span className="mt-1 text-[10px] text-ink-500">{hint}</span>
    </div>
  );
}

function SectionHead({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold/15 text-gold">{icon}</div>
      <div>
        <h2 className="text-base font-bold text-ink">{title}</h2>
        <p className="text-xs text-ink-500">{hint}</p>
      </div>
    </div>
  );
}

const CARD = "space-y-4 rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 shadow-sm";

function ProviderCard({ provider, active, canManage, onToggle, onChanged }: { provider: VideoAdminProvider; active: boolean; canManage: boolean; onToggle: () => void; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function run(fn: () => Promise<string | null>) {
    setBusy(true);
    setNote(null);
    try {
      setNote(await fn());
      await onChanged();
    } catch (err) {
      setNote(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink">{provider.displayName}</p>
          <p className="text-xs text-ink-500">{provider.summary}</p>
          <p className="mt-1 text-xs font-semibold">
            <span className={provider.configured ? "text-green" : "text-ink-500"}>{provider.configured ? "Keys saved" : "No keys yet"}</span>
            {provider.supportsProtectedPlayback && <span className="text-ink-500"> · can lock videos</span>}
          </p>
        </div>
        <Toggle on={active} disabled={!canManage} onChange={onToggle} label={`Offer ${provider.displayName} to every creator`} />
      </div>
      <button type="button" onClick={() => setOpen((o) => !o)} className="mt-3 text-xs font-bold text-gold" aria-expanded={open}>
        {open ? "Hide keys" : "Platform keys"}
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {provider.credentialFields.map((f) => (
            <div key={f.key} className="field-box flex flex-col rounded-2xl bg-[rgb(var(--surface-card))] p-3">
              <label htmlFor={`${provider.key}-${f.key}`} className="mb-1 text-xs font-bold text-ink-500">
                {f.label}{f.required ? "" : " (optional)"}{f.set ? " · saved" : ""}
              </label>
              <input
                id={`${provider.key}-${f.key}`}
                type={f.secret ? "password" : "text"}
                autoComplete="off"
                disabled={!canManage || busy}
                placeholder={f.set ? "Leave blank to keep the saved value" : f.placeholder}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                className="w-full text-sm text-ink outline-none"
              />
              {f.helpText && <span className="mt-1 text-[10px] text-ink-500">{f.helpText}</span>}
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!canManage || busy} className="admin-btn-gold min-h-10 px-4 text-xs font-bold" onClick={() => run(async () => {
              const filled = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()));
              if (!Object.keys(filled).length) return "Nothing to save.";
              await api.adminSaveVideoCredentials(provider.key, filled);
              setValues({});
              return "Keys saved.";
            })}>Save keys</button>
            <button type="button" disabled={!canManage || busy || !provider.configured} className="min-h-10 rounded-full px-4 text-xs font-bold text-ink" onClick={() => run(async () => {
              const r = await api.adminTestVideoCredentials(provider.key);
              return r.ok ? "The provider accepted these keys." : (r.message ?? "The check failed.");
            })}>Test</button>
            <button type="button" disabled={!canManage || busy || !provider.configured} className="min-h-10 rounded-full px-4 text-xs font-bold text-red-600" onClick={() => {
              if (!window.confirm(`Remove the saved ${provider.displayName} keys? Videos hosted there stop working until keys are saved again.`)) return;
              void run(async () => {
                await api.adminClearVideoCredentials(provider.key);
                return "Keys removed.";
              });
            }}>Remove keys</button>
          </div>
          {note && <p className="text-xs text-ink-500" role="status">{note}</p>}
        </div>
      )}
    </div>
  );
}

function CampaignRow({ c, canManage, onChanged, onError }: { c: AdCampaignReport; canManage: boolean; onChanged: () => Promise<void>; onError: (m: string) => void }) {
  const [creative, setCreative] = useState({ mediaUrl: "", clickUrl: "", headline: "", durationSeconds: 15 });
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await onChanged();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink">{c.name} <span className="text-xs font-semibold text-ink-500">· {c.advertiser}{c.house ? " · house" : ""}</span></p>
          <p className="text-xs text-ink-500">
            {c.house ? "Peebee's own promotion, earns nothing" : `${c.pricingModel.toUpperCase()} ${ugx(c.rateUgx)} · spent ${ugx(c.spentUgx)} of ${ugx(c.budgetUgx)}`}
          </p>
          <p className="mt-1 text-xs text-ink-500">{c.impressions} views · {c.completes} finished · {c.clicks} clicks · {c.skips} skipped · creators earned {ugx(c.creatorEarnedUgx)}</p>
        </div>
        <span className="rounded-full bg-gold/15 px-3 py-1 text-xs font-bold capitalize text-gold">{c.status}</span>
      </div>
      {canManage && (
        <div className="mt-3 flex flex-wrap gap-2">
          {c.status !== "active" && c.status !== "ended" && <button type="button" disabled={busy} className="admin-btn-gold min-h-10 px-4 text-xs font-bold" onClick={() => act(() => api.adminSetAdCampaignStatus(c.id, "active"))}>Start</button>}
          {c.status === "active" && <button type="button" disabled={busy} className="min-h-10 rounded-full px-4 text-xs font-bold text-ink" onClick={() => act(() => api.adminSetAdCampaignStatus(c.id, "paused"))}>Pause</button>}
          {c.status !== "ended" && <button type="button" disabled={busy} className="min-h-10 rounded-full px-4 text-xs font-bold text-red-600" onClick={() => { if (window.confirm(`End “${c.name}”? It cannot be restarted.`)) void act(() => api.adminSetAdCampaignStatus(c.id, "ended")); }}>End</button>}
          <button type="button" className="min-h-10 rounded-full px-4 text-xs font-bold text-gold" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>{adding ? "Cancel" : "Add an ad"}</button>
        </div>
      )}
      {adding && (
        <div className="mt-3 space-y-3">
          {([["mediaUrl", "Ad video address (https)"], ["clickUrl", "Where a tap goes (https, optional)"], ["headline", "Headline (optional)"]] as const).map(([k, label]) => (
            <div key={k} className="field-box flex flex-col rounded-2xl bg-[rgb(var(--surface-card))] p-3">
              <label htmlFor={`${c.id}-${k}`} className="mb-1 text-xs font-bold text-ink-500">{label}</label>
              <input id={`${c.id}-${k}`} value={creative[k]} onChange={(e) => setCreative((v) => ({ ...v, [k]: e.target.value }))} className="w-full text-sm text-ink outline-none" />
            </div>
          ))}
          <NumberField id={`${c.id}-dur`} label="Length (seconds)" hint="Must not be longer than the longest ad allowed in the settings above" value={creative.durationSeconds} min={1} max={180} disabled={false} onChange={(v) => setCreative((x) => ({ ...x, durationSeconds: v }))} />
          <button type="button" disabled={busy || !creative.mediaUrl.trim()} className="admin-btn-gold min-h-10 px-4 text-xs font-bold" onClick={() => act(async () => {
            await api.adminAddAdCreative(c.id, { mediaUrl: creative.mediaUrl.trim(), clickUrl: creative.clickUrl.trim() || null, headline: creative.headline.trim() || null, durationSeconds: creative.durationSeconds });
            setCreative({ mediaUrl: "", clickUrl: "", headline: "", durationSeconds: 15 });
            setAdding(false);
          })}>Add and approve</button>
        </div>
      )}
    </div>
  );
}

export default function VideoAdsSettingsPage() {
  const { user } = useAuth();
  const canManage = hasPermission(user?.adminRole ?? null, "settings.manage");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [video, setVideo] = useState<VideoConfig | null>(null);
  const [ads, setAds] = useState<AdsConfig | null>(null);
  const [providers, setProviders] = useState<VideoAdminProvider[]>([]);
  const [campaigns, setCampaigns] = useState<AdCampaignReport[]>([]);
  const [migrationApplied, setMigrationApplied] = useState(true);
  const [form, setForm] = useState({ advertiserName: "", name: "", pricingModel: "cpm" as "cpm" | "cpv" | "cpc", rateUgx: 0, budgetUgx: 0, isHouse: false });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const [v, a] = await Promise.all([api.adminGetVideo(), api.adminGetAds()]);
    setVideo(v.config);
    setProviders(v.providers);
    setAds(a.config);
    setCampaigns(a.campaigns);
    setMigrationApplied(v.migrationApplied && a.migrationApplied);
  }, []);

  useEffect(() => {
    load().catch((err) => setError(errorMessage(err))).finally(() => setLoading(false));
  }, [load]);

  const patchVideo = <K extends keyof VideoConfig>(k: K, v: VideoConfig[K]) => setVideo((p) => (p ? { ...p, [k]: v } : p));
  const patchAds = <K extends keyof AdsConfig>(k: K, v: AdsConfig[K]) => setAds((p) => (p ? { ...p, [k]: v } : p));
  const toggleIn = (list: VideoProviderKey[], key: VideoProviderKey) => (list.includes(key) ? list.filter((p) => p !== key) : [...list, key]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!video || !ads || !canManage) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const [v, a] = await Promise.all([api.adminSaveVideoConfig(video), api.adminSaveAdsConfig(ads)]);
      setVideo(v.config);
      setAds(a.config);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function createCampaign(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await api.adminCreateAdCampaign({ ...form, advertiserName: form.advertiserName.trim(), name: form.name.trim() });
      setForm({ advertiserName: "", name: "", pricingModel: "cpm", rateUgx: 0, budgetUgx: 0, isHouse: false });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <SettingsPageShell title="Video & ads" description="Where creator videos are kept, whether creators can bring their own, and the ads that play over them." loading={loading}>
      {video && ads && (
        <>
          {!migrationApplied && (
            <div className="flex items-center gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <p>The database update for video and ads has not been applied yet (0135_video_and_ads.sql). Settings can be saved, but nothing works until it is.</p>
            </div>
          )}
          <form onSubmit={handleSave} className="space-y-6">
            {error && (
              <div className="flex items-center gap-3 rounded-2xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"><AlertCircle className="h-5 w-5 shrink-0" /><p>{error}</p></div>
            )}
            {saved && (
              <div className="flex items-center gap-3 rounded-2xl bg-green/10 p-4 text-sm font-semibold text-green"><CheckCircle2 className="h-5 w-5 shrink-0" /><p>Video and ad settings saved.</p></div>
            )}

            <Fold head={<SectionHead icon={<Video className="h-5 w-5" />} title="Creator video" hint="Uploads, bring-your-own accounts and limits" />}>
              <SwitchRow title="Creator video" hint="When off, nobody can add or upload a video. Videos already added stay." on={video.enabled} disabled={!canManage} onChange={(v) => patchVideo("enabled", v)} />
              <SwitchRow title="Let creators bring their own" hint="Creators can connect their own Cloudinary, Mux, Bunny or Cloudflare account, or paste a link to a video file. Peebee takes only the video, never the provider's own ads or earnings." on={video.byoEnabled} disabled={!canManage} onChange={(v) => patchVideo("byoEnabled", v)} />
              <NumberField id="maxDuration" label="Longest video (seconds)" hint="Longer videos are refused" value={video.maxDurationSeconds} min={5} max={14400} disabled={!canManage} onChange={(v) => patchVideo("maxDurationSeconds", v)} />
              <NumberField id="maxPerDay" label="Videos per creator per day" hint="Uploads and imports together" value={video.maxVideosPerDay} min={1} max={1000} disabled={!canManage} onChange={(v) => patchVideo("maxVideosPerDay", v)} />
              <NumberField id="ttl" label="Locked-video address lifetime (seconds)" hint="How long the address for a locked video keeps working after a viewer is cleared to watch it" value={video.signedPlaybackTtlSeconds} min={60} max={86400} step={60} disabled={!canManage} onChange={(v) => patchVideo("signedPlaybackTtlSeconds", v)} />
              <div>
                <p className="mb-2 text-xs font-bold text-ink-500">Providers Peebee runs for creators (the tick is whether they are offered)</p>
                <div className="space-y-3">
                  {providers.map((p) => (
                    <ProviderCard key={p.key} provider={p} active={video.platformProviders.includes(p.key)} canManage={canManage} onToggle={() => patchVideo("platformProviders", toggleIn(video.platformProviders, p.key))} onChanged={load} />
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-bold text-ink-500">Providers a creator may bring</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {([...providers.map((p) => [p.key, p.displayName] as const), ["link", "Video link"] as const]).map(([key, label]) => {
                    const on = video.byoProviders.includes(key);
                    return (
                      <button key={key} type="button" disabled={!canManage} aria-pressed={on} onClick={() => patchVideo("byoProviders", toggleIn(video.byoProviders, key))} className={`rounded-2xl border px-4 py-3 text-left text-sm font-bold text-ink transition disabled:opacity-60 ${on ? "border-gold bg-gold/10" : "border-[var(--border-faint)] bg-[rgb(var(--surface-muted))]"}`}>{label}</button>
                    );
                  })}
                </div>
              </div>
            </Fold>

            <Fold head={<SectionHead icon={<Megaphone className="h-5 w-5" />} title="Ads over videos" hint="Peebee decides every ad, whichever provider holds the video" />}>
              <SwitchRow title="Ads" hint="When off, no ad plays anywhere" on={ads.enabled} disabled={!canManage} onChange={(v) => patchAds("enabled", v)} />
              <SwitchRow title="Before the video" hint="Pre-roll ad" on={ads.prerollEnabled} disabled={!canManage} onChange={(v) => patchAds("prerollEnabled", v)} />
              <SwitchRow title="During the video" hint="Mid-roll ads at regular intervals, on videos with a known length" on={ads.midrollEnabled} disabled={!canManage} onChange={(v) => patchAds("midrollEnabled", v)} />
              <SwitchRow title="Peebee's own promotions fill empty slots" hint="When no paying advertiser qualifies, one of Peebee's own ads plays instead. These earn nothing." on={ads.houseAdsFallback} disabled={!canManage} onChange={(v) => patchAds("houseAdsFallback", v)} />
              <SwitchRow title="No ads for members" hint="People who pay for a channel watch it without ads" on={ads.adFreeForMembers} disabled={!canManage} onChange={(v) => patchAds("adFreeForMembers", v)} />
              <NumberField id="creatorShare" label="Creator's share of ad revenue (%)" hint="What the creator earns from each ad on their video. Never above 95%." value={ads.creatorSharePercent} min={0} max={95} disabled={!canManage} onChange={(v) => patchAds("creatorSharePercent", v)} />
              <NumberField id="minVideo" label="Shortest video that gets ads (seconds)" hint="Shorter videos never get an ad" value={ads.minVideoSeconds} min={0} max={3600} disabled={!canManage} onChange={(v) => patchAds("minVideoSeconds", v)} />
              <NumberField id="midEvery" label="Mid-roll every (minutes)" hint="Gap between mid-roll ads" value={ads.midrollEveryMinutes} min={1} max={120} disabled={!canManage} onChange={(v) => patchAds("midrollEveryMinutes", v)} />
              <NumberField id="perView" label="Ads per viewing" hint="Most ads one person sees on one video within half an hour" value={ads.maxAdsPerView} min={1} max={20} disabled={!canManage} onChange={(v) => patchAds("maxAdsPerView", v)} />
              <NumberField id="perHour" label="Ads per viewer per hour" hint="Across all videos" value={ads.viewerCapPerHour} min={1} max={200} disabled={!canManage} onChange={(v) => patchAds("viewerCapPerHour", v)} />
              <NumberField id="maxAd" label="Longest ad (seconds)" hint="Longer ads are never played" value={ads.maxAdSeconds} min={5} max={180} disabled={!canManage} onChange={(v) => patchAds("maxAdSeconds", v)} />
              <NumberField id="skip" label="Skip button appears after (seconds)" hint="0 means skippable at once" value={ads.skipAfterSeconds} min={0} max={60} disabled={!canManage} onChange={(v) => patchAds("skipAfterSeconds", v)} />
            </Fold>

            {canManage && <SettingsSaveBar busy={saving} error={null} saved={saved} />}
          </form>

          <Fold head={<SectionHead icon={<Megaphone className="h-5 w-5" />} title="Campaigns" hint="Advertisers and Peebee's own promotions" />}>
            {campaigns.length === 0 && <p className="text-sm text-ink-500">No campaigns yet.</p>}
            <div className="space-y-3">
              {campaigns.map((c) => <CampaignRow key={c.id} c={c} canManage={canManage} onChanged={load} onError={setError} />)}
            </div>
            {canManage && migrationApplied && (
              <form onSubmit={createCampaign} className="space-y-3 border-t border-[var(--border-faint)] pt-4">
                <p className="text-sm font-bold text-ink">New campaign</p>
                {([["advertiserName", "Advertiser"], ["name", "Campaign name"]] as const).map(([k, label]) => (
                  <div key={k} className="field-box flex flex-col rounded-2xl bg-[rgb(var(--surface-muted))] p-3">
                    <label htmlFor={`new-${k}`} className="mb-1 text-xs font-bold text-ink-500">{label}</label>
                    <input id={`new-${k}`} required value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} className="w-full text-sm text-ink outline-none" />
                  </div>
                ))}
                <SwitchRow title="Peebee's own promotion" hint="Earns nothing and has no budget; fills empty slots" on={form.isHouse} disabled={false} onChange={(v) => setForm((f) => ({ ...f, isHouse: v }))} />
                {!form.isHouse && (
                  <>
                    <div className="field-box flex flex-col rounded-2xl bg-[rgb(var(--surface-muted))] p-3">
                      <label htmlFor="new-model" className="mb-1 text-xs font-bold text-ink-500">Advertiser pays per</label>
                      <select id="new-model" value={form.pricingModel} onChange={(e) => setForm((f) => ({ ...f, pricingModel: e.target.value as "cpm" | "cpv" | "cpc" }))} className="w-full text-sm text-ink outline-none">
                        <option value="cpm">1,000 views (CPM)</option>
                        <option value="cpv">finished view (CPV)</option>
                        <option value="cpc">click (CPC)</option>
                      </select>
                    </div>
                    <NumberField id="new-rate" label="Rate (UGX)" hint="Per 1,000 views, per finished view, or per click, as chosen above" value={form.rateUgx} min={0} max={100000000} step={100} disabled={false} onChange={(v) => setForm((f) => ({ ...f, rateUgx: v }))} />
                    <NumberField id="new-budget" label="Budget (UGX)" hint="The campaign stops when this is spent" value={form.budgetUgx} min={0} max={10000000000} step={1000} disabled={false} onChange={(v) => setForm((f) => ({ ...f, budgetUgx: v }))} />
                  </>
                )}
                <button type="submit" disabled={creating} className="admin-btn-gold min-h-11 px-6 text-sm font-bold">{creating ? "Creating…" : "Create campaign"}</button>
                <p className="text-xs text-ink-500">A new campaign is a draft. Add an ad to it, then start it.</p>
              </form>
            )}
          </Fold>
        </>
      )}
    </SettingsPageShell>
  );
}
