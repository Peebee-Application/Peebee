"use client";
import { useEffect, useState } from "react";
import { DEFAULT_SHOPPING_UNIT_SETTINGS, SHOPPING_UNITS, SHOPPING_UNIT_IDS, type ShoppingStandardUnit, type ShoppingUnitRule, type ShoppingUnitSettings } from "@peebee/shared";
import { Select } from "@peebee/shared/select";
import { SettingsPageShell, SettingsSaveBar } from "../../../components/SettingsPageShell";
import { api, errorMessage } from "../../../lib/api";

const field = "w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-sm outline-none focus:border-gold";
export default function ShoppingUnitsSettingsPage() {
  const [config, setConfig] = useState<ShoppingUnitSettings>(() => structuredClone(DEFAULT_SHOPPING_UNIT_SETTINGS));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.getSettings().then(({ settings }) => setConfig(settings.shoppingUnits ?? structuredClone(DEFAULT_SHOPPING_UNIT_SETTINGS))).catch((e) => setError(errorMessage(e))).finally(() => setLoading(false)); }, []);
  function change(patch: Partial<ShoppingUnitSettings>) { setConfig((old) => ({ ...old, ...patch })); setSaved(false); }
  function updateRule(index: number, patch: Partial<ShoppingUnitRule>) { change({ rules: config.rules.map((rule, i) => i === index ? { ...rule, ...patch } : rule) }); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setSaved(false);
    try {
      const cleaned = { ...config, rules: config.rules.map((rule) => ({ ...rule, keywords: rule.keywords.map((word) => word.trim()).filter(Boolean), units: [...new Set(rule.units)] })), fallbackUnits: [...new Set(config.fallbackUnits)] };
      const { settings } = await api.adminUpdateSettings({ shoppingUnits: cleaned });
      setConfig(settings.shoppingUnits ?? cleaned); setSaved(true);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <SettingsPageShell title="Shopping units" loading={loading}>
    <form onSubmit={save} className="space-y-5">
      <section className="home-card space-y-3"><h2 className="font-bold">Suggestions and buying modes</h2><p className="text-sm text-ink-500">Customers see a suggested unit, a short list of likely alternatives, and a button for all units. Their own choice is always preserved.</p>
        {([
          ["enabled", "Suggest units from the item name"], ["autoSelect", "Automatically select the best match"],
          ["allowBudget", "Allow Buy by amount"], ["allowCustom", "Allow Other… with a custom measure"],
        ] as const).map(([key, label]) => <label key={key} className="flex items-center gap-3 text-sm"><input type="checkbox" checked={config[key]} onChange={(e) => change({ [key]: e.target.checked })}/>{label}</label>)}
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 text-xs font-semibold text-ink-500"><span>Suggested alternatives</span><input type="number" min={1} max={6} required value={config.suggestedCount} onChange={(e) => change({ suggestedCount: Number(e.target.value) })} className={field}/></label>
          <label className="space-y-1 text-xs font-semibold text-ink-500"><span>Letters before partial matching</span><input type="number" min={2} max={10} required value={config.minimumPrefixLength} onChange={(e) => change({ minimumPrefixLength: Number(e.target.value) })} className={field}/></label>
        </div>
        <label className="block space-y-1 text-xs font-semibold text-ink-500"><span>Maximum custom-unit length</span><input type="number" min={1} max={60} required value={config.customUnitMaxLength} onChange={(e) => change({ customUnitMaxLength: Number(e.target.value) })} className={field}/></label>
        <label className="block space-y-1 text-xs font-semibold text-ink-500"><span>Default for an unfamiliar item</span><Select aria-label="Default buying unit" value={config.fallbackUnits[0]} onValueChange={(value) => change({ fallbackUnits: [value as ShoppingStandardUnit, ...config.fallbackUnits.filter((id) => id !== value)] })} className={field}>{SHOPPING_UNIT_IDS.filter((id) => config.allowBudget || id !== "budget").map((id) => <option key={id} value={id}>{SHOPPING_UNITS[id].label}</option>)}</Select></label>
      </section>
      <section className="home-card space-y-3"><div><h2 className="font-bold">Item matching rules</h2><p className="text-xs text-ink-500">Add names in English, Luganda or other local wording. Separate names with commas. Higher-priority matches win; packaging words can take precedence over the product name.</p></div>
        {config.rules.map((rule, index) => <details key={index} className="rounded-xl border border-[var(--border-faint)] p-3">
          <summary className="cursor-pointer text-sm font-semibold">{rule.keywords.filter(Boolean).slice(0, 3).join(", ") || "New rule"} → {SHOPPING_UNITS[rule.units[0]].label}</summary>
          <div className="mt-3 space-y-3">
            <label className="block space-y-1 text-xs font-semibold text-ink-500"><span>Item names or phrases</span><textarea required value={rule.keywords.join(",")} onChange={(e) => updateRule(index, { keywords: e.target.value.split(",") })} placeholder="e.g. rice, beans, flour" className={field}/></label>
            <label className="block space-y-1 text-xs font-semibold text-ink-500"><span>Best unit</span><Select aria-label={`Best unit for rule ${index + 1}`} value={rule.units[0]} onValueChange={(value) => updateRule(index, { units: [value as ShoppingStandardUnit, ...rule.units.filter((id) => id !== value)] })} className={field}>{SHOPPING_UNIT_IDS.map((id) => <option key={id} value={id}>{SHOPPING_UNITS[id].label}</option>)}</Select></label>
            <details><summary className="cursor-pointer text-xs font-semibold">Alternative units ({rule.units.length - 1})</summary><div className="mt-2 grid grid-cols-2 gap-2">{SHOPPING_UNIT_IDS.filter((id) => id !== rule.units[0]).map((id) => <label key={id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={rule.units.includes(id)} onChange={(e) => updateRule(index, { units: e.target.checked ? [...rule.units, id] : rule.units.filter((unit) => unit !== id) })}/>{SHOPPING_UNITS[id].label}</label>)}</div></details>
            <label className="block space-y-1 text-xs font-semibold text-ink-500"><span>Matching priority</span><input type="number" min={0} max={100} required value={rule.priority} onChange={(e) => updateRule(index, { priority: Number(e.target.value) })} className={field}/></label>
            <button type="button" onClick={() => change({ rules: config.rules.filter((_, i) => i !== index) })} className="min-h-10 text-sm font-semibold text-ink-500">Remove rule</button>
          </div>
        </details>)}
        <button type="button" disabled={config.rules.length >= 100} onClick={() => change({ rules: [...config.rules, { keywords: [""], units: [config.fallbackUnits[0]], priority: 0 }] })} className="min-h-11 w-full rounded-xl border border-[var(--border-faint)] text-sm font-semibold">Add matching rule</button>
      </section>
      <SettingsSaveBar busy={busy} error={error} saved={saved}/>
    </form>
  </SettingsPageShell>;
}
