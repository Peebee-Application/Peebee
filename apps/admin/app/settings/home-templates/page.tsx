"use client";

import { useEffect, useState } from "react";
import { DEFAULT_HOME_TEMPLATES, HOME_SHORTCUTS, HOME_TEMPLATES, HOME_TEMPLATE_LIMITS, resolveHomeTemplates, type HomeShortcutId, type HomeTemplateId, type HomeTemplatesSettings } from "@peebee/shared";
import { SettingsPageShell, SettingsSaveBar } from "../../../components/SettingsPageShell";
import { Switch } from "../../../components/ui/Switch";
import { api, errorMessage } from "../../../lib/api";

const field = "mt-1 min-h-11 w-full rounded-xl border border-[var(--border-faint)] px-3 py-2 text-sm";

export default function HomeTemplatesPage() {
  const [config, setConfig] = useState<HomeTemplatesSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function load() {
    try { const { settings } = await api.getSettings(); setConfig(resolveHomeTemplates(settings.homeTemplates)); setError(null); }
    catch (e) { setError(errorMessage(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    let active = true;
    void api.getSettings().then(({ settings }) => { if (active) setConfig(resolveHomeTemplates(settings.homeTemplates)); })
      .catch((e) => { if (active) setError(errorMessage(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function change(patch: Partial<HomeTemplatesSettings>) {
    setConfig((current) => current ? { ...current, ...patch } : current); setSaved(false); setError(null);
  }
  function template(id: HomeTemplateId) {
    if (!config) return;
    const templates = config.templates.includes(id) ? config.templates.filter((v) => v !== id) : [...config.templates, id];
    if (!templates.length) { setError("Keep at least one template selected."); return; }
    change({ templates });
  }
  function eligible(id: HomeShortcutId) {
    if (!config) return;
    const eligibleShortcuts = config.eligibleShortcuts.includes(id) ? config.eligibleShortcuts.filter((v) => v !== id) : [...config.eligibleShortcuts, id];
    if (!eligibleShortcuts.length) { setError("Keep at least one shortcut eligible."); return; }
    change({ eligibleShortcuts, preferredShortcuts: config.preferredShortcuts.filter((v) => eligibleShortcuts.includes(v)) });
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!config) return;
    if (config.maxIntervalSeconds < config.minIntervalSeconds) { setError("The maximum switch interval must be at least the minimum."); return; }
    setBusy(true); setError(null); setSaved(false);
    try { const { settings } = await api.adminUpdateSettings({ homeTemplates: config }); setConfig(resolveHomeTemplates(settings.homeTemplates)); setSaved(true); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }

  return <SettingsPageShell title="Customer home templates" description="Everyday designs, changing at your pace. The customer header, navigation and greeting stay consistent." loading={loading}>
    {!config ? <div role="alert" className="home-card space-y-3"><p>{error || "Home settings could not be loaded."}</p><button type="button" className="admin-btn-gold min-h-11 px-4" onClick={() => { setLoading(true); setError(null); void load(); }}>Try again</button></div> :
      <form onSubmit={save} className="space-y-5">
        <fieldset disabled={busy} className="space-y-5 disabled:opacity-70">
          <section className="home-card space-y-3">
            <h2 className="font-bold">Dynamic home</h2>
            <label className="flex min-h-11 items-center gap-3"><Switch checked={config.enabled} onChange={(e) => change({ enabled: e.target.checked })} /><span>Use the rotating home templates</span></label>
            <p className="text-sm text-ink-500">Off restores the existing home and launch experience. On keeps “Hello, [first name]” above the artwork, with the same sans-serif font in every template. Orders, fee proposals, saved lists and wallet remain available.</p>
          </section>
          <section className="home-card space-y-3">
            <h2 className="font-bold">Template pool</h2>
            <p className="text-sm text-ink-500">Each change chooses a different enabled design when more than one is selected. All ten approved designs are included; 12 was tentative in the design shortlist.</p>
            <div className="grid gap-2 sm:grid-cols-2">{HOME_TEMPLATES.map((t) => <label key={t.id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-[var(--border-faint)] p-3 text-sm"><input type="checkbox" checked={config.templates.includes(t.id)} onChange={() => template(t.id)} className="h-5 w-5 accent-gold" /><span><span className="font-semibold">{t.id}</span> · {t.name}</span></label>)}</div>
          </section>
          <section className="home-card space-y-4">
            <h2 className="font-bold">Timing and frequency</h2>
            <p className="text-sm text-ink-500">A new random interval is drawn between these values for each change. Use the same minimum and maximum for a fixed interval. Customers can pause changes; touching, focusing, scrolling, opening a sheet or leaving the app postpones changes.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold">Minimum interval (seconds)<input required type="number" min={HOME_TEMPLATE_LIMITS.minSeconds} max={HOME_TEMPLATE_LIMITS.maxSeconds} step={1} className={field} value={config.minIntervalSeconds} onChange={(e) => change({ minIntervalSeconds: Number(e.target.value) })} /></label>
              <label className="text-sm font-semibold">Maximum interval (seconds)<input required type="number" min={config.minIntervalSeconds} max={HOME_TEMPLATE_LIMITS.maxSeconds} step={1} className={field} value={config.maxIntervalSeconds} onChange={(e) => change({ maxIntervalSeconds: Number(e.target.value) })} /></label>
              <label className="text-sm font-semibold">Shortcuts per template<input required type="number" min={1} max={HOME_TEMPLATE_LIMITS.maxShortcuts} step={1} className={field} value={config.shortcutCount} onChange={(e) => change({ shortcutCount: Number(e.target.value) })} /></label>
              <label className="text-sm font-semibold">Most-used weight<input required type="number" min={1} max={HOME_TEMPLATE_LIMITS.maxWeight} step={1} className={field} value={config.preferredWeight} onChange={(e) => change({ preferredWeight: Number(e.target.value) })} /><span className="mt-1 block text-xs font-normal text-ink-500">A weight of 3 gives each selected most-used shortcut three times the draw weight. This increases frequency without guaranteeing a slot.</span></label>
              <label className="text-sm font-semibold">Quiet time after interaction (seconds)<input required type="number" min={1} max={HOME_TEMPLATE_LIMITS.maxInteractionSeconds} step={1} className={field} value={config.interactionPauseSeconds} onChange={(e) => change({ interactionPauseSeconds: Number(e.target.value) })} /></label>
            </div>
          </section>
          <section className="home-card space-y-4">
            <h2 className="font-bold">Eligible and most-used submodules</h2>
            <p className="text-sm text-ink-500">Choose which customer destinations can appear, then mark those you want to appear more often. These are your selections, not automatic usage analytics. Live/Practice service switches, vehicle availability and Hire settings still apply. A shortcut never repeats within one screen.</p>
            {(["ride", "deliver", "buy", "hive", "learn", "channels"] as const).map((group) => <fieldset key={group} className="space-y-2"><legend className="mb-2 text-sm font-bold capitalize">{group === "hive" ? "Work & Hire" : group}</legend>{HOME_SHORTCUTS.filter((s) => s.module.split(".")[0] === group).map((s) => <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border-faint)] px-3 py-2"><label className="flex min-h-11 flex-1 items-center gap-3 text-sm"><input type="checkbox" checked={config.eligibleShortcuts.includes(s.id)} onChange={() => eligible(s.id)} className="h-5 w-5 accent-gold" /><span><span className="block font-semibold">{s.label}</span><span className="block text-xs text-ink-500">{s.description}</span></span></label><label className="flex min-h-11 items-center gap-2 text-xs font-semibold"><input type="checkbox" disabled={!config.eligibleShortcuts.includes(s.id)} checked={config.preferredShortcuts.includes(s.id)} onChange={() => change({ preferredShortcuts: config.preferredShortcuts.includes(s.id) ? config.preferredShortcuts.filter((id) => id !== s.id) : [...config.preferredShortcuts, s.id] })} className="h-5 w-5 accent-gold" />Most used</label></div>)}</fieldset>)}
          </section>
          <button type="button" onClick={() => { setConfig(structuredClone(DEFAULT_HOME_TEMPLATES)); setSaved(false); setError(null); }} className="min-h-11 w-full rounded-xl border border-[var(--border-faint)] text-sm font-semibold">Restore default home template settings</button>
        </fieldset>
        <SettingsSaveBar busy={busy} error={error} saved={saved} />
      </form>}
  </SettingsPageShell>;
}
