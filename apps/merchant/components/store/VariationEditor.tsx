"use client";

import {
  buildVariantMatrix,
  colorHex,
  normaliseOptionKey,
  type ProductVariationSettings,
  type VariantInput,
} from "@peebee/shared";
import { Plus, X } from "lucide-react";
import { useState } from "react";

/** One option the merchant is building, e.g. Colour with Black and Red. */
export type EditorOption = { name: string; values: Array<{ value: string; hex?: string }> };
export type EditorState = { options: EditorOption[]; variants: VariantInput[] };

export const EMPTY_EDITOR: EditorState = { options: [], variants: [] };

const input = "w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2 text-sm text-ink focus:border-gold focus:outline-none";

/** Loads a product (as the merchant API returns it) into editor state. */
export function editorFromProduct(product: { options?: Array<{ name: string; values: Array<{ value: string; hex?: string }> }>; variants?: any[] }): EditorState {
  const options: EditorOption[] = (product.options ?? []).map((o) => ({ name: o.name, values: o.values.map((v) => ({ value: v.value, ...(v.hex ? { hex: v.hex } : {}) })) }));
  const variants: VariantInput[] = (product.variants ?? []).map((v) => ({
    id: v.id,
    title: v.title ?? "",
    values: Array.isArray(v.values) ? v.values : [],
    price: Number(v.price) || 0,
    compare_at_price: v.compare_at_price ?? null,
    sku: v.sku ?? "",
    barcode: v.barcode ?? "",
    inventory_quantity: Number(v.inventory_quantity ?? 0),
    image_url: v.image_url ?? "",
  }));
  return { options, variants };
}

/** The body the API expects for creating or editing variations. */
export function editorPayload(state: EditorState) {
  const options = state.options
    .filter((o) => o.name.trim() && o.values.length > 0)
    .map((o) => ({ name: o.name.trim(), values: o.values.map((v) => ({ value: v.value, ...(v.hex ? { hex: v.hex } : {}) })) }));
  return {
    options,
    variants: state.variants.map((v) => ({
      ...(v.id ? { id: v.id } : {}),
      title: v.title || undefined,
      values: v.values,
      price: Math.round(Number(v.price)) || 0,
      compare_at_price: v.compare_at_price ? Math.round(Number(v.compare_at_price)) : null,
      sku: v.sku || null,
      barcode: v.barcode || null,
      inventory_quantity: Math.max(0, Math.round(Number(v.inventory_quantity)) || 0),
      image_url: v.image_url || null,
    })),
  };
}

function validState(state: EditorState): string | null {
  if (state.variants.some((v) => !(v.price > 0))) return "Every variant needs a price above zero.";
  return null;
}
export { validState as variationProblem };

export function VariationEditor({
  value, onChange, settings, basePrice, baseStock,
}: {
  value: EditorState;
  onChange: (next: EditorState) => void;
  settings: ProductVariationSettings;
  basePrice: number;
  baseStock: number;
}) {
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkStock, setBulkStock] = useState("");
  const [truncated, setTruncated] = useState(false);

  function apply(options: EditorOption[]) {
    const matrix = buildVariantMatrix(
      options.map((o) => ({ name: o.name, values: o.values })),
      value.variants,
      { price: basePrice > 0 ? basePrice : 1000, inventory_quantity: baseStock >= 0 ? baseStock : 0 },
      settings.maxVariantsPerProduct,
    );
    setTruncated(matrix.truncated);
    onChange({ options, variants: matrix.variants });
  }

  const typeFor = (name: string) => settings.types.find((t) => t.key === normaliseOptionKey(name));
  const usedKeys = new Set(value.options.map((o) => normaliseOptionKey(o.name)));
  const available = settings.types.filter((t) => !usedKeys.has(t.key));

  function addOption(name: string) {
    if (!name.trim() || value.options.length >= settings.maxOptionsPerProduct) return;
    apply([...value.options, { name: name.trim(), values: [] }]);
  }
  function setOption(index: number, patch: Partial<EditorOption>) {
    apply(value.options.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  }
  function addValue(index: number, raw: string) {
    const option = value.options[index];
    const added = raw.split(",").map((v) => v.trim()).filter(Boolean);
    const next = [...option.values];
    for (const v of added) {
      if (next.some((x) => x.value.toLowerCase() === v.toLowerCase())) continue;
      next.push({ value: v.slice(0, 40) });
    }
    setDraft((d) => ({ ...d, [index]: "" }));
    setOption(index, { values: next });
  }

  const legacy = value.options.length === 0 && value.variants.length > 0;

  return (
    <div className="space-y-3 rounded-2xl border border-[var(--border-faint)] p-3">
      <div>
        <h3 className="text-xs font-bold text-ink">Options and variants</h3>
        <p className="mt-0.5 text-[11px] text-ink-500">Add options like Colour or Size. Peebee builds one variant for every combination, and you set each one's price and stock.</p>
      </div>

      {value.options.map((option, index) => {
        const type = typeFor(option.name);
        const swatch = type?.display === "swatch";
        const suggestions = (type?.suggestedValues ?? []).filter((s) => !option.values.some((v) => v.value.toLowerCase() === s.toLowerCase()));
        return (
          <div key={index} className="space-y-2 rounded-2xl border border-[var(--border-faint)] p-3">
            <div className="flex items-center gap-2">
              <input className={input} value={option.name} maxLength={30} aria-label={`Option ${index + 1} name`} placeholder="Option name" readOnly={!settings.allowCustomOptions && !!type} onChange={(e) => setOption(index, { name: e.target.value })} />
              <button type="button" aria-label={`Remove ${option.name || "option"}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-500" onClick={() => apply(value.options.filter((_, i) => i !== index))}><X className="h-4 w-4" /></button>
            </div>
            {!type && option.name.trim() && settings.allowCustomOptions && <p className="text-[11px] text-ink-500">Custom option. It will not open on a Buy-home card.</p>}
            {!type && option.name.trim() && !settings.allowCustomOptions && <p className="text-[11px] text-red-600">Peebee only allows its listed options. Pick one from the list.</p>}
            <div className="flex flex-wrap gap-1.5">
              {option.values.map((v, vi) => (
                <span key={v.value} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[var(--border-faint)] px-2.5 text-xs font-semibold text-ink">
                  {swatch && (
                    <input type="color" aria-label={`Colour for ${v.value}`} className="h-5 w-5 cursor-pointer rounded-full border-0 bg-transparent p-0" value={v.hex ?? colorHex(v.value) ?? "#cccccc"}
                      onChange={(e) => setOption(index, { values: option.values.map((x, xi) => (xi === vi ? { ...x, hex: e.target.value } : x)) })} />
                  )}
                  {v.value}
                  <button type="button" aria-label={`Remove ${v.value}`} className="text-ink-500" onClick={() => setOption(index, { values: option.values.filter((_, xi) => xi !== vi) })}><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input className={input} value={draft[index] ?? ""} placeholder="Add a value, then press Enter" aria-label={`Add a ${option.name || "option"} value`}
                onChange={(e) => setDraft((d) => ({ ...d, [index]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addValue(index, draft[index] ?? ""); } }} />
              <button type="button" className="flex h-11 shrink-0 items-center gap-1 rounded-full bg-gold px-4 text-xs font-bold text-ink-gold" onClick={() => addValue(index, draft[index] ?? "")}><Plus className="h-3.5 w-3.5" />Add</button>
            </div>
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5" aria-label="Suggestions">
                {suggestions.slice(0, 12).map((s) => (
                  <button key={s} type="button" className="min-h-9 rounded-full border border-dashed border-[var(--border-faint)] px-2.5 text-xs text-ink-500" onClick={() => addValue(index, s)}>+ {s}</button>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {value.options.length < settings.maxOptionsPerProduct && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            {available.map((t) => (
              <button key={t.key} type="button" className="min-h-9 rounded-full bg-gold px-3 text-xs font-bold text-ink-gold" onClick={() => addOption(t.name)}>+ {t.name}</button>
            ))}
            {settings.allowCustomOptions && <button type="button" className="min-h-9 rounded-full border border-dashed border-[var(--border-faint)] px-3 text-xs font-bold text-ink" onClick={() => addOption("Custom")}>+ Custom option</button>}
          </div>
          <p className="text-[11px] text-ink-500">Up to {settings.maxOptionsPerProduct} options and {settings.maxVariantsPerProduct} variants per product.</p>
        </div>
      )}

      {truncated && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-200">Those options make more than {settings.maxVariantsPerProduct} variants, so only the first {settings.maxVariantsPerProduct} were kept. Remove some values.</p>}
      {legacy && <p className="rounded-xl bg-[rgb(var(--surface-muted))] px-3 py-2 text-xs text-ink-500">These variants were made before options existed. Add an option above to replace them with Colour or Size choices, or edit their price and stock here.</p>}

      {value.variants.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-ink">{value.variants.length} variant{value.variants.length === 1 ? "" : "s"}</h4>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex gap-1.5"><input className={input} type="number" inputMode="numeric" min={1} placeholder="Price for all" aria-label="Set one price for every variant" value={bulkPrice} onChange={(e) => setBulkPrice(e.target.value)} /><button type="button" className="min-h-11 rounded-full bg-gold px-3 text-xs font-bold text-ink-gold" onClick={() => { const p = Number(bulkPrice); if (p > 0) onChange({ ...value, variants: value.variants.map((v) => ({ ...v, price: Math.round(p) })) }); }}>Set</button></div>
            <div className="flex gap-1.5"><input className={input} type="number" inputMode="numeric" min={0} placeholder="Stock for all" aria-label="Set one stock level for every variant" value={bulkStock} onChange={(e) => setBulkStock(e.target.value)} /><button type="button" className="min-h-11 rounded-full bg-gold px-3 text-xs font-bold text-ink-gold" onClick={() => { const q = Number(bulkStock); if (q >= 0 && bulkStock !== "") onChange({ ...value, variants: value.variants.map((v) => ({ ...v, inventory_quantity: Math.round(q) })) }); }}>Set</button></div>
          </div>
          {value.variants.map((v, i) => {
            const patch = (p: Partial<VariantInput>) => onChange({ ...value, variants: value.variants.map((x, xi) => (xi === i ? { ...x, ...p } : x)) });
            return (
              <div key={v.id ?? `${v.title}-${i}`} className="space-y-2 rounded-2xl border border-[var(--border-faint)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-ink">{v.title || "Default"}</span>
                  <button type="button" aria-label={`Remove variant ${v.title}`} className="flex h-9 w-9 items-center justify-center rounded-full text-ink-500" onClick={() => onChange({ ...value, variants: value.variants.filter((_, xi) => xi !== i) })}><X className="h-4 w-4" /></button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1 text-[11px] font-semibold text-ink-500"><span>Price (UGX)</span><input className={input} type="number" inputMode="numeric" min={1} value={v.price || ""} onChange={(e) => patch({ price: Number(e.target.value) })} /></label>
                  <label className="space-y-1 text-[11px] font-semibold text-ink-500"><span>Was (UGX)</span><input className={input} type="number" inputMode="numeric" min={0} value={v.compare_at_price ?? ""} onChange={(e) => patch({ compare_at_price: e.target.value ? Number(e.target.value) : null })} /></label>
                  <label className="space-y-1 text-[11px] font-semibold text-ink-500"><span>In stock</span><input className={input} type="number" inputMode="numeric" min={0} value={v.inventory_quantity} onChange={(e) => patch({ inventory_quantity: Number(e.target.value) })} /></label>
                  <label className="space-y-1 text-[11px] font-semibold text-ink-500"><span>SKU</span><input className={input} maxLength={40} value={v.sku ?? ""} onChange={(e) => patch({ sku: e.target.value })} /></label>
                  <label className="space-y-1 text-[11px] font-semibold text-ink-500"><span>Barcode</span><input className={input} maxLength={40} value={v.barcode ?? ""} onChange={(e) => patch({ barcode: e.target.value })} /></label>
                  <label className="space-y-1 text-[11px] font-semibold text-ink-500"><span>Photo link</span><input className={input} inputMode="url" value={v.image_url ?? ""} onChange={(e) => patch({ image_url: e.target.value })} /></label>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
