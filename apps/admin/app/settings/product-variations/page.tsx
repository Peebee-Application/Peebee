"use client";

import { DEFAULT_PRODUCT_VARIATIONS, normaliseOptionKey, resolveProductVariations, type ProductVariationSettings, type VariationDisplay, type VariationType } from "@peebee/shared";
import { useEffect, useState } from "react";
import { Switch } from "../../../components/ui/Switch";
import { SettingsPageShell, SettingsSaveBar } from "../../../components/SettingsPageShell";
import { api, errorMessage } from "../../../lib/api";

const field = "w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-sm outline-none focus:border-gold";
const DISPLAYS: Array<{ value: VariationDisplay; label: string }> = [
  { value: "swatch", label: "Colour swatches" },
  { value: "chips", label: "Buttons" },
  { value: "dropdown", label: "Dropdown" },
];

export default function ProductVariationsPage() {
  const [config, setConfig] = useState<ProductVariationSettings>(DEFAULT_PRODUCT_VARIATIONS);
  /** Suggested values are edited as text and split on save, so typing a comma never fights the field. */
  const [valueText, setValueText] = useState<string[]>(DEFAULT_PRODUCT_VARIATIONS.types.map((t) => t.suggestedValues.join(", ")));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getSettings()
      .then(({ settings }) => {
        const next = resolveProductVariations(settings.productVariations);
        setConfig(next);
        setValueText(next.types.map((t) => t.suggestedValues.join(", ")));
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, []);

  function change(patch: Partial<ProductVariationSettings>) {
    setConfig((old) => ({ ...old, ...patch }));
    setSaved(false);
  }
  function updateType(index: number, patch: Partial<VariationType>) {
    change({ types: config.types.map((t, i) => (i === index ? { ...t, ...patch } : t)) });
  }
  function addType() {
    change({ types: [...config.types, { key: "", name: "", display: "chips", showOnBuyCard: false, suggestedValues: [] }] });
    setValueText((old) => [...old, ""]);
  }
  function removeType(index: number) {
    change({ types: config.types.filter((_, i) => i !== index) });
    setValueText((old) => old.filter((_, i) => i !== index));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const types = config.types.map((t, i) => ({
        ...t,
        key: normaliseOptionKey(t.key || t.name),
        suggestedValues: (valueText[i] ?? "").split(",").map((v) => v.trim()).filter(Boolean),
      }));
      const next = resolveProductVariations({ ...config, types });
      const { settings } = await api.adminUpdateSettings({ productVariations: next });
      const stored = resolveProductVariations(settings.productVariations);
      setConfig(stored);
      setValueText(stored.types.map((t) => t.suggestedValues.join(", ")));
      setSaved(true);
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }

  const onCard = config.types.filter((t) => t.showOnBuyCard && t.name.trim());

  return (
    <SettingsPageShell title="Product variations" loading={loading}>
      <form onSubmit={save} className="space-y-5">
        <p className="text-sm text-ink-500">Merchants build products from the options you agree here, like Colour and Size. You also choose which options open up on a product card on the Buy home, so shoppers can pick and add in place. A product with none of those options simply shows a plain add button.</p>

        <section className="home-card space-y-3">
          <h2 className="font-bold">Buy home cards</h2>
          <label className="flex items-center gap-3 text-sm"><Switch checked={config.quickAddEnabled} onChange={(e) => change({ quickAddEnabled: e.target.checked })} />Open a product card in place to pick options and add</label>
          <label className="block space-y-1 text-xs font-semibold text-ink-500"><span>Most options one card opens</span>
            <select className={field} value={config.maxCardOptions} onChange={(e) => change({ maxCardOptions: Number(e.target.value) })}>
              <option value={1}>1 (the first agreed option)</option>
              <option value={2}>2 (for example Colour and Size)</option>
            </select>
          </label>
          <p className="text-xs text-ink-500">{config.quickAddEnabled ? (onCard.length ? `Cards open with: ${onCard.slice(0, config.maxCardOptions).map((t) => t.name).join(" and ")}.` : "No option is switched on for cards yet, so cards show a plain add button.") : "Cards show a plain add button."}</p>
        </section>

        <section className="home-card space-y-3">
          <h2 className="font-bold">Limits for merchants</h2>
          <label className="flex items-center gap-3 text-sm"><Switch checked={config.allowCustomOptions} onChange={(e) => change({ allowCustomOptions: e.target.checked })} />Merchants may add options that are not on the list (these never open on a Buy card)</label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1 text-xs font-semibold text-ink-500"><span>Options per product (1 to 3)</span><input className={field} type="number" min={1} max={3} value={config.maxOptionsPerProduct} onChange={(e) => change({ maxOptionsPerProduct: Number(e.target.value) })} /></label>
            <label className="block space-y-1 text-xs font-semibold text-ink-500"><span>Variants per product (up to 200)</span><input className={field} type="number" min={1} max={200} value={config.maxVariantsPerProduct} onChange={(e) => change({ maxVariantsPerProduct: Number(e.target.value) })} /></label>
          </div>
        </section>

        <section className="home-card space-y-3">
          <h2 className="font-bold">Agreed options</h2>
          {config.types.map((type, index) => (
            <div key={index} className="space-y-2 rounded-2xl border border-[var(--border-faint)] p-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1 text-xs font-semibold text-ink-500"><span>Name shoppers see</span><input className={field} value={type.name} maxLength={30} onChange={(e) => updateType(index, { name: e.target.value })} /></label>
                <label className="block space-y-1 text-xs font-semibold text-ink-500"><span>Shown as</span>
                  <select className={field} value={type.display} onChange={(e) => updateType(index, { display: e.target.value as VariationDisplay })}>
                    {DISPLAYS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </select>
                </label>
              </div>
              <label className="block space-y-1 text-xs font-semibold text-ink-500"><span>Suggested values, separated by commas</span><input className={field} value={valueText[index] ?? ""} onChange={(e) => { const v = e.target.value; setValueText((old) => old.map((x, i) => (i === index ? v : x))); setSaved(false); }} /></label>
              <label className="flex items-center gap-3 text-sm"><Switch checked={type.showOnBuyCard} onChange={(e) => updateType(index, { showOnBuyCard: e.target.checked })} />Open on Buy home cards</label>
              <button type="button" className="min-h-11 text-sm font-bold text-ink-500" onClick={() => removeType(index)}>Remove this option</button>
            </div>
          ))}
          {config.types.length < 12 && <button type="button" className="min-h-11 text-sm font-bold text-gold" onClick={addType}>Add an option</button>}
        </section>
        <SettingsSaveBar busy={busy} error={error} saved={saved} />
      </form>
    </SettingsPageShell>
  );
}
