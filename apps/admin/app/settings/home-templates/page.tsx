"use client";

import { useEffect, useState } from "react";
import { DEFAULT_HOME_TEMPLATES, HOME_SHORTCUTS, HOME_TEMPLATES, HOME_TEMPLATE_LIMITS, resolveHomeTemplates, type HomeShortcutId, type HomeTemplateId, type HomeTemplatesSettings } from "@peebee/shared";
import { SettingsPageShell, SettingsSaveBar } from "../../../components/SettingsPageShell";
import { Switch } from "../../../components/ui/Switch";
import { api, errorMessage } from "../../../lib/api";
import { HomeTemplatePreview } from "../../../components/HomeTemplatePreview";

const field = "mt-1 min-h-11 w-full rounded-xl border border-[var(--border-faint)] px-3 py-2 text-sm";

export default function HomeTemplatesPage() {
  const [config, setConfig] = useState<HomeTemplatesSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<HomeTemplateId>("11");
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
  function preview(id: HomeTemplateId) {
    setPreviewId(id);
    if (!window.matchMedia("(min-width: 1280px)").matches) {
      requestAnimationFrame(() => {
        const panel = document.getElementById("home-template-preview");
        panel?.focus({ preventScroll: true });
        panel?.scrollIntoView({ block: "start" });
      });
    }
  }
  function template(id: HomeTemplateId) {
    if (!config) return;
    const templates = config.templates.includes(id) ? config.templates.filter((v) => v !== id) : [...config.templates, id];
    if (!templates.length) { setError("Keep one template active, or turn off Dynamic home above to use the existing home."); return; }
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-bold">Active home templates</h2>
              <button type="button" className="min-h-11 rounded-xl border border-[var(--border-faint)] px-4 text-sm font-semibold" onClick={() => change({ templates: HOME_TEMPLATES.map((t) => t.id) })}>Activate all templates</button>
            </div>
            <p className="text-sm text-ink-500">Switch each design on or off. Preview any design without activating it. “Use only this template” makes that design the only active one. Changes apply after Save settings.</p>
            <p role="status" className="text-sm font-semibold">{!config.enabled ? "Dynamic home is off. Your template selections are kept for when you turn it on." : config.templates.length === 1 ? `Only ${HOME_TEMPLATES.find((t) => t.id === config.templates[0])?.name} will appear. Its shortcuts can still refresh at your chosen intervals.` : `${config.templates.length} active templates will rotate. ${HOME_TEMPLATES.length - config.templates.length} inactive.`}</p>
            <div className="grid items-start gap-6 xl:grid-cols-2">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">{HOME_TEMPLATES.map((t) => {
                const active = config.templates.includes(t.id);
                return <div key={t.id} className="rounded-2xl border border-[var(--border-faint)] p-3">
                  <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm">
                    <span><span className="block font-semibold">{t.id} · {t.name}</span><span className="block text-xs text-ink-500">{active ? "Active" : "Inactive"}</span></span>
                    <Switch aria-label={`${t.name} active`} checked={active} onChange={() => template(t.id)} />
                  </label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" aria-pressed={previewId === t.id} aria-controls="home-template-preview" onClick={() => preview(t.id)} className="min-h-11 rounded-xl border border-[var(--border-faint)] px-3 text-sm font-semibold aria-pressed:bg-gold aria-pressed:text-ink">Preview {t.id}</button>
                    <button type="button" onClick={() => { change({ enabled: true, templates: [t.id] }); setPreviewId(t.id); }} className="min-h-11 rounded-xl border border-[var(--border-faint)] px-3 text-sm font-semibold" aria-label={`Use only ${t.name}`}>Use only this template</button>
                  </div>
                </div>;
              })}</div>
              <HomeTemplatePreview templateId={previewId} config={config} />
            </div>
          </section>
          <section className="home-card space-y-4">
            <h2 className="font-bold">Timing and frequency</h2>
            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold">Explore animated lines</legend>
              <p className="text-xs text-ink-500">Lines play in this order for enabled modules. The module also selects the photograph.</p>
              {config.exploreLines.map((entry, index) => <div key={index} className="flex flex-wrap items-end gap-2">
                <label className="text-xs font-semibold">Module<select className={field} value={entry.module} onChange={(e) => change({ exploreLines: config.exploreLines.map((line, i) => i === index ? { ...line, module: e.target.value as typeof entry.module } : line) })}>{["ride", "eat", "buy", "work", "learn"].map((module) => <option key={module} value={module}>{module}</option>)}</select></label>
                <label className="min-w-[180px] flex-1 text-xs font-semibold">Line {index + 1}<input required maxLength={120} className={field} value={entry.text} onChange={(e) => change({ exploreLines: config.exploreLines.map((line, i) => i === index ? { ...line, text: e.target.value } : line) })} /></label>
                <button type="button" className="min-h-11 px-3 text-sm font-semibold" disabled={config.exploreLines.length === 1} onClick={() => change({ exploreLines: config.exploreLines.filter((_, i) => i !== index) })}>Remove line {index + 1}</button>
              </div>)}
              <button type="button" disabled={config.exploreLines.length >= 30} className="min-h-11 px-3 text-sm font-semibold" onClick={() => change({ exploreLines: [...config.exploreLines, { module: "ride", text: "" }] })}>Add line</button>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold">Explore typing speed (milliseconds per letter)<input required type="number" min={20} max={300} step={1} className={field} value={config.exploreTypeMs} onChange={(e) => change({ exploreTypeMs: Number(e.target.value) })} /></label>
              <label className="text-sm font-semibold">Explore completed text hold (seconds)<input required type="number" min={2} max={30} step={1} className={field} value={config.exploreHoldSeconds} onChange={(e) => change({ exploreHoldSeconds: Number(e.target.value) })} /></label>
            </div>
            <p className="text-sm text-ink-500">A new random interval is drawn between these values for each change. Use the same minimum and maximum for a fixed interval. Touching, focusing, scrolling, opening a sheet or leaving the app postpones changes.</p>
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
