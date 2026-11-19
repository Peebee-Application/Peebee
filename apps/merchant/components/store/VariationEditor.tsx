"use client";

import {
  buildVariantMatrix,
  colorHex,
  normaliseOptionKey,
  type ProductVariationSettings,
  type VariantInput,
} from "@peebee/shared";
import {
  AlertCircle, Barcode, Camera, Check, ChevronDown, ChevronUp, Cookie, Copy, Eye, HardDrive, ImageIcon, Info, Layers,
  Loader2, Minus, Package, Palette, Plus, Ruler, Shirt, SlidersHorizontal, Tag, Trash2, X, type LucideIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { uploadStoreMedia } from "../../lib/plans";
import { BarcodeScanButton } from "./BarcodeScan";

/** One option the merchant is building, e.g. Colour with Black and Red. */
export type EditorOption = { name: string; values: Array<{ value: string; hex?: string }> };
export type EditorState = { options: EditorOption[]; variants: VariantInput[] };

export const EMPTY_EDITOR: EditorState = { options: [], variants: [] };


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

/** "6 variants" and the lowest price, for the sheet's footer. */
export function variantSummary(state: EditorState): { count: number; from: number | null; stock: number } {
  const prices = state.variants.map((v) => Number(v.price) || 0).filter((p) => p > 0);
  return {
    count: state.variants.length,
    from: prices.length ? Math.min(...prices) : null,
    stock: state.variants.reduce((n, v) => n + Math.max(0, Number(v.inventory_quantity) || 0), 0),
  };
}

const ICONS: Record<string, LucideIcon> = { color: Palette, size: Ruler, storage: HardDrive, material: Shirt, flavour: Cookie, pack: Package };
const SUB_LABEL = "mb-2 flex items-center gap-2 text-[17px] font-extrabold text-ink";
const FIELD = "field-box flex min-h-[60px] min-w-0 items-center gap-2.5 rounded-2xl border-2 border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-4 focus-within:border-gold focus-within:ring-4 focus-within:ring-gold/20";
const FIELD_INPUT = "min-w-0 flex-1 bg-transparent p-0 text-[21px] font-extrabold text-ink outline-none placeholder:font-semibold placeholder:text-ink-500/70";
const PREFIX = "shrink-0 text-base font-extrabold text-ink-500";
const CARD = "space-y-4 rounded-3xl border-[1.5px] border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4 shadow-[0_4px_16px_rgba(10,10,10,0.06)]";
const SECTION = "flex items-center gap-1.5 text-[15px] font-extrabold uppercase tracking-wider text-ink-500";
const APPLY = "flex min-h-[60px] min-w-[104px] shrink-0 items-center justify-center gap-1.5 rounded-2xl px-4 text-lg font-black active:scale-95";
const TWO_COL = "grid grid-cols-1 gap-3 min-[380px]:grid-cols-2";

const digitsOnly = (v: string) => v.replace(/\D/g, "");
const money = (n: number | null | undefined) => (n ? Math.round(n).toLocaleString("en-US") : "");
const ugx = (n: number) => `UGX ${Math.round(n).toLocaleString("en-US")}`;

function MoneyField({ label, value, onChange, error, testId, placeholder }: { label: string; value: number | null | undefined; onChange: (n: number | null) => void; error?: string; testId?: string; placeholder?: string }) {
  return (
    <label className="block min-w-0">
      <span className={SUB_LABEL}>{label}</span>
      <span className={`${FIELD} ${error ? "!border-red-600 ring-4 ring-red-600/15" : ""}`}>
        <span className={PREFIX}>UGX</span>
        <input className={FIELD_INPUT} inputMode="numeric" value={money(value)} placeholder={placeholder ?? "0"} data-testid={testId}
          onChange={(e) => { const d = digitsOnly(e.target.value); onChange(d ? Number(d) : null); }} />
      </span>
      {error ? <span className="mt-2 flex items-center gap-2 text-base font-bold text-red-600"><AlertCircle className="h-5 w-5 shrink-0" /> {error}</span> : null}
    </label>
  );
}

function StockStepper({ value, onChange, label, testId, dark }: { value: number; onChange: (n: number) => void; label: string; testId?: string; dark?: boolean }) {
  const n = Math.max(0, Math.round(Number(value)) || 0);
  const shell = dark ? "border-white/20 bg-[#1c1c1c]" : "border-[var(--border-faint)] bg-[rgb(var(--surface-input))]";
  const minus = dark ? "bg-[#2c2c2c] text-white" : "bg-[rgb(var(--surface-muted))] text-ink";
  return (
    <div className={`field-box grid min-h-[60px] min-w-0 grid-cols-[50px_minmax(0,1fr)_50px] items-center rounded-2xl border-2 p-[3px] ${shell}`}>
      <button type="button" aria-label={`${label}: one less`} onClick={() => onChange(Math.max(0, n - 1))} className={`flex h-[50px] items-center justify-center rounded-xl active:scale-95 ${minus}`}><Minus className="h-6 w-6" strokeWidth={3} /></button>
      <input aria-label={label} inputMode="numeric" value={String(n)} data-testid={testId} onChange={(e) => onChange(Number(digitsOnly(e.target.value)) || 0)}
        className={`w-full min-w-0 bg-transparent p-0 text-center text-[22px] font-black outline-none ${dark ? "text-white" : "text-ink"}`} />
      <button type="button" aria-label={`${label}: one more`} onClick={() => onChange(n + 1)} className="flex h-[50px] items-center justify-center rounded-xl bg-gold text-ink-gold active:scale-95"><Plus className="h-6 w-6" strokeWidth={3} /></button>
    </div>
  );
}

export function VariationEditor({
  value, onChange, settings, basePrice, baseStock, mode = "inline",
}: {
  value: EditorState;
  onChange: (next: EditorState) => void;
  settings: ProductVariationSettings;
  basePrice: number;
  baseStock: number;
  /** "sheet": Options and Variants tabs (the Catalog sheet). "inline": both stacked (inside another form). */
  mode?: "sheet" | "inline";
}) {
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [bulkPrice, setBulkPrice] = useState<number | null>(null);
  const [bulkStock, setBulkStock] = useState<number>(Math.max(0, baseStock || 0));
  const [truncated, setTruncated] = useState(false);
  const [tab, setTab] = useState<"options" | "variants">(value.variants.length > 0 ? "variants" : "options");
  const [open, setOpen] = useState<Record<string, boolean>>({});

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
  const empty = value.options.length === 0 && value.variants.length === 0;
  const showOptions = mode === "inline" || tab === "options";
  const showVariants = mode === "inline" || tab === "variants";

  // Colour swatch and short label for a variant card.
  const swatchOption = value.options.find((o) => typeFor(o.name)?.display === "swatch");
  function variantLook(v: VariantInput) {
    const vals = Array.isArray(v.values) ? v.values : [];
    let hex: string | undefined;
    let short = "";
    vals.forEach((val, i) => {
      const opt = value.options[i];
      const text = String(val ?? "");
      if (opt && swatchOption && opt === swatchOption) {
        hex = opt.values.find((x) => x.value === text)?.hex ?? colorHex(text);
      } else if (!short && text) short = text.slice(0, 3);
    });
    return { hex, short, name: (v.title || vals.filter(Boolean).join(" / ") || "Default").split(" / ").join(" · ") };
  }

  const optionsPanel = (
    <div className="space-y-4">
      {empty && (
        <div className="flex flex-col items-center gap-1.5 pt-2 text-center">
          <span className="mb-2 flex h-24 w-24 items-center justify-center rounded-[30px] bg-gold/15 text-[#8a6d0b] dark:text-gold"><Layers className="h-12 w-12" /></span>
          <h3 className="text-2xl font-black text-ink">No options yet</h3>
          <p className="text-lg font-semibold text-ink-500">What changes on this item?</p>
        </div>
      )}

      {value.options.map((option, index) => {
        const type = typeFor(option.name);
        const swatch = type?.display === "swatch";
        const Icon = (type && ICONS[type.key]) || SlidersHorizontal;
        const suggestions = (type?.suggestedValues ?? []).filter((s) => !option.values.some((v) => v.value.toLowerCase() === s.toLowerCase()));
        const onCard = !!type?.showOnBuyCard && settings.quickAddEnabled;
        const editableName = !type || settings.allowCustomOptions;
        return (
          <div key={index} className={CARD} data-testid="variation-option">
            <div className="flex items-center gap-3">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gold text-ink-gold"><Icon className="h-7 w-7" /></span>
              <div className="min-w-0 flex-1">
                {type ? (
                  <p className="break-words text-[21px] font-black leading-tight text-ink">{option.name}</p>
                ) : (
                  <label className="block">
                    <span className="sr-only">Option name</span>
                    <input value={option.name} maxLength={30} aria-label={`Option ${index + 1} name`} readOnly={!editableName}
                      onChange={(e) => setOption(index, { name: e.target.value })}
                      className="w-full min-w-0 rounded-xl border-2 border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2 text-[19px] font-black text-ink outline-none focus:border-gold" />
                  </label>
                )}
                {onCard && <span className="mt-1 inline-flex h-7 items-center gap-1.5 rounded-full bg-green/15 px-2.5 text-sm font-extrabold text-green"><Eye className="h-4 w-4" /> On Buy card</span>}
              </div>
              <button type="button" aria-label={`Remove ${option.name || "option"}`} onClick={() => apply(value.options.filter((_, i) => i !== index))}
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-[1.5px] border-[var(--border-faint)] text-ink-500 active:scale-95"><Trash2 className="h-6 w-6" /></button>
            </div>
            {!type && option.name.trim() && settings.allowCustomOptions && <p className="text-base font-semibold text-ink-500">Custom option. It will not open on a Buy-home card.</p>}
            {!type && option.name.trim() && !settings.allowCustomOptions && <p className="text-base font-bold text-red-600">Peebee only allows its listed options. Pick one from the list.</p>}

            {option.values.length > 0 && (
              <div className="flex flex-wrap gap-2.5">
                {option.values.map((v, vi) => (
                  <span key={v.value} className={`inline-flex min-h-14 max-w-full items-center gap-2.5 rounded-full border-2 border-gold bg-gold/15 pr-2 text-[19px] font-extrabold text-ink ${swatch ? "pl-2" : "pl-[18px]"}`}>
                    {swatch && (
                      <label className="relative h-[38px] w-[38px] shrink-0 cursor-pointer rounded-full border-2 border-white/90 shadow-[0_0_0_1.5px_rgba(0,0,0,0.25)]" style={{ background: v.hex ?? colorHex(v.value) ?? "#cccccc" }}>
                        <span className="sr-only">Colour for {v.value}</span>
                        <input type="color" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" value={v.hex ?? colorHex(v.value) ?? "#cccccc"}
                          onChange={(e) => setOption(index, { values: option.values.map((x, xi) => (xi === vi ? { ...x, hex: e.target.value } : x)) })} />
                      </label>
                    )}
                    <span className="min-w-0 break-words">{v.value}</span>
                    <button type="button" aria-label={`Remove ${v.value}`} onClick={() => setOption(index, { values: option.values.filter((_, xi) => xi !== vi) })}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink/10 text-ink active:scale-95"><X className="h-5 w-5" strokeWidth={2.8} /></button>
                  </span>
                ))}
              </div>
            )}

            {suggestions.length > 0 && (
              <div className="space-y-2.5">
                <p className={SECTION}>Tap to add</p>
                <div className="flex flex-wrap gap-2.5" aria-label="Suggestions">
                  {suggestions.slice(0, 12).map((s) => (
                    <button key={s} type="button" onClick={() => addValue(index, s)}
                      className="inline-flex min-h-14 items-center gap-2 rounded-full border-2 border-dashed border-[var(--border-faint)] pl-3 pr-[18px] text-lg font-bold text-ink active:scale-95">
                      {swatch ? <span className="h-[30px] w-[30px] shrink-0 rounded-full border-2 border-white/90 shadow-[0_0_0_1.5px_rgba(0,0,0,0.25)]" style={{ background: colorHex(s) ?? "#cccccc" }} /> : <Plus className="h-5 w-5" strokeWidth={2.8} />}
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label htmlFor={`variation-value-${index}`} className={SUB_LABEL}>{option.values.length ? `Other ${(option.name || "value").toLowerCase()}` : `Add a ${(option.name || "value").toLowerCase()}`}</label>
              <div className="flex gap-2.5">
                <span className={`${FIELD} flex-1`}>
                  <input id={`variation-value-${index}`} className={FIELD_INPUT} value={draft[index] ?? ""} placeholder={swatch ? "e.g. Navy" : "Type, then Add"}
                    onChange={(e) => setDraft((d) => ({ ...d, [index]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addValue(index, draft[index] ?? ""); } }} />
                </span>
                <button type="button" onClick={() => addValue(index, draft[index] ?? "")} className={`${APPLY} bg-gold text-ink-gold`}><Plus className="h-6 w-6" strokeWidth={3} /> Add</button>
              </div>
            </div>
          </div>
        );
      })}

      {value.options.length < settings.maxOptionsPerProduct && (
        <div className="space-y-3">
          <p className={SECTION}><Plus className="h-4 w-4" strokeWidth={3} /> {value.options.length === 0 ? "Pick an option" : "Add another option"}</p>
          <div className="grid grid-cols-2 gap-3">
            {available.map((t) => {
              const Icon = ICONS[t.key] ?? SlidersHorizontal;
              return (
                <button key={t.key} type="button" onClick={() => addOption(t.name)}
                  className="flex min-h-[76px] min-w-0 flex-col items-start justify-center gap-2 rounded-[20px] border-2 border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3.5 py-3 text-left text-[19px] font-extrabold text-ink active:scale-[.98] min-[380px]:flex-row min-[380px]:items-center min-[380px]:gap-3">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-gold/15 text-[#8a6d0b] dark:text-gold"><Icon className="h-[26px] w-[26px]" /></span>
                  <span className="min-w-0 leading-tight">{t.name}</span>
                </button>
              );
            })}
            {settings.allowCustomOptions && (
              <button type="button" onClick={() => addOption("Custom")}
                className="flex min-h-[76px] min-w-0 flex-col items-start justify-center gap-2 rounded-[20px] border-2 border-dashed border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3.5 py-3 text-left text-[19px] font-extrabold text-ink active:scale-[.98] min-[380px]:flex-row min-[380px]:items-center min-[380px]:gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-[rgb(var(--surface-muted))] text-ink"><Plus className="h-[26px] w-[26px]" strokeWidth={2.6} /></span>
                <span className="min-w-0 leading-tight">Custom</span>
              </button>
            )}
          </div>
          <p className="flex items-center gap-2.5 px-1 text-base font-bold text-ink-500"><Info className="h-5 w-5 shrink-0" /> Up to {settings.maxOptionsPerProduct} options · {settings.maxVariantsPerProduct} variants</p>
        </div>
      )}
    </div>
  );

  const variantsPanel = (
    <div className="space-y-4">
      {value.variants.length === 0 && mode === "sheet" && (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <span className="flex h-20 w-20 items-center justify-center rounded-[26px] bg-gold/15 text-[#8a6d0b] dark:text-gold"><Layers className="h-10 w-10" /></span>
          <p className="text-xl font-black text-ink">No variants yet</p>
          <button type="button" onClick={() => setTab("options")} className="flex min-h-14 items-center gap-2 rounded-full bg-gold px-6 text-lg font-black text-ink-gold"><SlidersHorizontal className="h-5 w-5" /> Add options</button>
        </div>
      )}
      {value.variants.length > 0 && (
        <>
          <div className="space-y-4 rounded-3xl border-[1.5px] border-gold/40 bg-black p-4 text-white" data-testid="variation-bulk">
            <p className="flex items-center gap-2.5 text-xl font-black"><span className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-gold text-ink-gold"><Copy className="h-[22px] w-[22px]" /></span> Set all {value.variants.length} at once</p>
            <div>
              <label htmlFor="variation-bulk-price" className="mb-2 block text-[17px] font-extrabold">Same price for all</label>
              <div className="flex gap-2.5">
                <span className="field-box flex min-h-[60px] min-w-0 flex-1 items-center gap-2.5 rounded-2xl border-2 border-white/20 bg-[#1c1c1c] px-4 focus-within:border-gold">
                  <span className="shrink-0 text-base font-extrabold text-white/60">UGX</span>
                  <input id="variation-bulk-price" inputMode="numeric" value={money(bulkPrice)} placeholder={money(basePrice) || "0"} aria-label="Set one price for every variant"
                    onChange={(e) => { const d = digitsOnly(e.target.value); setBulkPrice(d ? Number(d) : null); }}
                    className="min-w-0 flex-1 bg-transparent p-0 text-[21px] font-extrabold text-white outline-none placeholder:text-white/40" />
                </span>
                <button type="button" className={`${APPLY} bg-gold text-ink-gold`} onClick={() => { const p = Number(bulkPrice); if (p > 0) onChange({ ...value, variants: value.variants.map((v) => ({ ...v, price: Math.round(p) })) }); }}>
                  <Check className="h-6 w-6" strokeWidth={3} /> Apply
                </button>
              </div>
            </div>
            <div>
              <p className="mb-2 block text-[17px] font-extrabold">Same stock for all</p>
              <div className="flex gap-2.5">
                <div className="min-w-0 flex-1"><StockStepper dark value={bulkStock} onChange={setBulkStock} label="Set one stock level for every variant" /></div>
                <button type="button" className={`${APPLY} bg-gold text-ink-gold`} onClick={() => { const q = Math.max(0, Math.round(bulkStock)); onChange({ ...value, variants: value.variants.map((v) => ({ ...v, inventory_quantity: q })) }); }}>
                  <Check className="h-6 w-6" strokeWidth={3} /> Apply
                </button>
              </div>
            </div>
          </div>

          {value.variants.map((v, i) => {
            const key = v.id ?? `${v.title}-${i}`;
            const patch = (p: Partial<VariantInput>) => onChange({ ...value, variants: value.variants.map((x, xi) => (xi === i ? { ...x, ...p } : x)) });
            return (
              <VariantCard key={key} v={v} look={variantLook(v)} open={!!open[key]} onToggle={() => setOpen((o) => ({ ...o, [key]: !o[key] }))} patch={patch}
                onRemove={() => onChange({ ...value, variants: value.variants.filter((_, xi) => xi !== i) })} />
            );
          })}
        </>
      )}
    </div>
  );

  return (
    <div className={mode === "inline" ? "space-y-4" : ""} data-testid="variation-editor">
      {mode === "inline" && (
        <div>
          <h3 className="text-lg font-black text-ink">Options and variants</h3>
          <p className="mt-0.5 text-base font-semibold text-ink-500">Add options like Colour or Size. You set each variant&apos;s price and stock.</p>
        </div>
      )}
      {mode === "sheet" && (
        <div className="sticky top-0 z-10 -mx-4 bg-[rgb(var(--surface-card))] px-4 pb-3.5">
          <div className="grid grid-cols-2 gap-1.5 rounded-[20px] bg-black p-1.5 ring-1 ring-white/10" role="tablist">
            {(["options", "variants"] as const).map((t) => {
              const on = tab === t;
              const Icon = t === "options" ? SlidersHorizontal : Layers;
              return (
                <button key={t} type="button" role="tab" aria-selected={on} onClick={() => setTab(t)}
                  className={`flex min-h-14 min-w-0 items-center justify-center gap-2 rounded-[15px] px-2 text-lg font-extrabold ${on ? "bg-gold text-ink-gold" : "text-white"}`}>
                  <Icon className="h-[22px] w-[22px] shrink-0" /> {t === "options" ? "Options" : "Variants"}
                  {t === "variants" && value.variants.length > 0 && (
                    <span className={`flex h-[30px] min-w-[30px] items-center justify-center rounded-full px-2 text-base font-black ${on ? "bg-black text-gold" : "bg-white/15 text-white"}`}>{value.variants.length}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-4">
        {truncated && <p className="flex gap-2.5 rounded-2xl bg-red-600/10 px-4 py-3 text-base font-bold text-red-600"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /> Those options make more than {settings.maxVariantsPerProduct} variants, so only the first {settings.maxVariantsPerProduct} were kept. Remove some values.</p>}
        {legacy && <p className="flex gap-2.5 rounded-2xl bg-[rgb(var(--surface-muted))] px-4 py-3 text-base font-semibold text-ink-500"><Info className="mt-0.5 h-5 w-5 shrink-0" /> These variants were made before options existed. Add an option to replace them with Colour or Size choices, or edit their price and stock.</p>}
        {showOptions && optionsPanel}
        {showVariants && variantsPanel}
      </div>
    </div>
  );
}

function VariantCard({ v, look, open, onToggle, patch, onRemove }: {
  v: VariantInput;
  look: { hex?: string; short: string; name: string };
  open: boolean;
  onToggle: () => void;
  patch: (p: Partial<VariantInput>) => void;
  onRemove: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const stock = Math.max(0, Number(v.inventory_quantity) || 0);
  const noPrice = !(Number(v.price) > 0);

  async function upload(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    setUploading(true);
    setPhotoError("");
    const res = await uploadStoreMedia(file);
    setUploading(false);
    if (res.ok && res.data.url) patch({ image_url: res.data.url });
    else setPhotoError(res.ok ? "Upload failed. Try again." : res.message);
    if (camera.current) camera.current.value = "";
    if (gallery.current) gallery.current.value = "";
  }

  return (
    <div className={`${CARD} ${open ? "!border-2 !border-gold" : ""}`} data-testid="variation-variant">
      <div className="flex items-center gap-3">
        <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl border-2 border-white/85 text-lg font-black shadow-[0_0_0_1.5px_rgba(0,0,0,0.2)]"
          style={{ background: look.hex ?? "rgb(var(--gold))", color: look.hex ? (isLight(look.hex) ? "#0a0a0a" : "#ffffff") : "#0a0a0a" }}>
          {look.short || <Tag className="h-6 w-6" />}
        </span>
        <p className="min-w-0 flex-1 break-words text-[22px] font-black leading-tight text-ink">{look.name}</p>
        {stock > 0
          ? <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-green/15 px-3 text-[15px] font-extrabold text-green"><Check className="h-4 w-4" strokeWidth={3} /> In stock</span>
          : <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-red-600/10 px-3 text-[15px] font-extrabold text-red-600"><AlertCircle className="h-4 w-4" /> Sold out</span>}
      </div>
      <div className={TWO_COL}>
        <MoneyField label="Price" value={v.price} onChange={(n) => patch({ price: n ?? 0 })} error={noPrice ? "Add a price" : undefined} testId="variant-price" />
        <div className="min-w-0">
          <p className={SUB_LABEL}>Stock</p>
          <StockStepper value={stock} onChange={(n) => patch({ inventory_quantity: n })} label={`${look.name} stock`} testId="variant-stock" />
        </div>
      </div>
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="flex min-h-14 w-full items-center gap-2.5 rounded-2xl bg-[rgb(var(--surface-muted))] px-4 text-lg font-extrabold text-ink active:scale-[.99]">
        {open ? <ChevronUp className="h-6 w-6" strokeWidth={2.8} /> : <ChevronDown className="h-6 w-6" strokeWidth={2.8} />}
        {open ? "Less" : "More"}
        <span className="ml-auto flex items-center gap-2 text-ink-500" aria-hidden="true"><Tag className="h-5 w-5" /><Barcode className="h-5 w-5" /><Camera className="h-5 w-5" /></span>
      </button>
      {open && (
        <div className="space-y-4">
          <div className={TWO_COL}>
            <MoneyField label="Was price" value={v.compare_at_price ?? null} onChange={(n) => patch({ compare_at_price: n })} placeholder="—" />
            <label className="block min-w-0">
              <span className={SUB_LABEL}>SKU</span>
              <span className={FIELD}><input className={FIELD_INPUT} maxLength={40} value={v.sku ?? ""} onChange={(e) => patch({ sku: e.target.value })} placeholder="Your code" /></span>
            </label>
          </div>
          <div>
            <label htmlFor={`barcode-${look.name}`} className={SUB_LABEL}>Barcode</label>
            <div className="flex gap-2.5">
              <span className={`${FIELD} flex-1`}>
                <input id={`barcode-${look.name}`} className={FIELD_INPUT} maxLength={40} value={v.barcode ?? ""} onChange={(e) => patch({ barcode: e.target.value })} placeholder="Type or scan" />
              </span>
              <BarcodeScanButton onScan={(code) => patch({ barcode: code })} />
            </div>
          </div>
          <div>
            <p className={SUB_LABEL}>Photo</p>
            <div className="flex items-center gap-3">
              {v.image_url ? (
                <span className="relative shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={v.image_url} alt="" className="h-[76px] w-[76px] rounded-2xl border border-[var(--border-faint)] object-cover" data-testid="variant-photo" />
                  <button type="button" aria-label="Remove photo" onClick={() => patch({ image_url: "" })} className="absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black text-white ring-2 ring-[rgb(var(--surface-card))]"><X className="h-4 w-4" strokeWidth={3} /></button>
                </span>
              ) : (
                <span className="flex h-[76px] w-[76px] shrink-0 items-center justify-center rounded-2xl border-2 border-dashed border-[var(--border-faint)] text-ink-500">
                  {uploading ? <Loader2 className="h-7 w-7 animate-spin" /> : <ImageIcon className="h-7 w-7" />}
                </span>
              )}
              <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 min-[380px]:grid-cols-2">
                <button type="button" disabled={uploading} onClick={() => camera.current?.click()} className="flex min-h-14 min-w-0 items-center justify-center gap-2 rounded-2xl border-2 border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-2 text-lg font-extrabold text-ink disabled:opacity-50"><Camera className="h-6 w-6 shrink-0" /> Camera</button>
                <button type="button" disabled={uploading} onClick={() => gallery.current?.click()} className="flex min-h-14 min-w-0 items-center justify-center gap-2 rounded-2xl border-2 border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-2 text-lg font-extrabold text-ink disabled:opacity-50"><ImageIcon className="h-6 w-6 shrink-0" /> Gallery</button>
              </div>
              <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => upload(e.target.files)} data-testid="variant-camera-input" />
              <input ref={gallery} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => upload(e.target.files)} data-testid="variant-gallery-input" />
            </div>
            {uploading && <p className="mt-2 text-base font-bold text-ink-500">Uploading…</p>}
            {photoError && <p className="mt-2 flex items-center gap-2 text-base font-bold text-red-600"><AlertCircle className="h-5 w-5 shrink-0" /> {photoError}</p>}
          </div>
          <button type="button" onClick={onRemove} className="flex min-h-[60px] w-full items-center justify-center gap-2.5 rounded-full border-2 border-red-600/45 text-lg font-extrabold text-red-600 active:scale-[.99]">
            <Trash2 className="h-[22px] w-[22px]" /> Remove this variant
          </button>
        </div>
      )}
    </div>
  );
}

function isLight(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 170;
}

export { ugx as variationUgx };
