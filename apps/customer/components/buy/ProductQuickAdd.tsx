"use client";

import {
  cardOptions, defaultSelection, deriveProductOptions, findVariant, selectValue,
  type ProductOption, type ProductVariationSettings, type Selection, type VariantLike,
} from "@peebee/shared";
import { Check, Loader2, Plus, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { OptionPicker } from "./OptionPicker";

type QuickVariant = VariantLike & { id: string; title: string; price: number };

/** What a Buy card needs from a product to offer the in-place expand. */
export type QuickProduct = { id: string; price: number; variants?: QuickVariant[] | null; options?: ProductOption[] | null; inventory_quantity?: number | null };

/**
 * The "+" on a Buy card. A product with options the admin put on cards opens in place to pick them, then adds the chosen
 * variant. Any other product keeps the plain one-tap add, and a product with no variants never shows a picker.
 */
export function ProductQuickAdd({
  product, settings, label, onAdd, onPrice,
}: {
  product: QuickProduct;
  settings: ProductVariationSettings;
  label: string;
  onAdd: (variant: QuickVariant | undefined) => unknown;
  /** Lets the card show the selected variant's price. */
  onPrice?: (price: number | null, compareAt: number | null) => void;
}) {
  const variants = useMemo(() => (product.variants ?? []) as QuickVariant[], [product.variants]);
  const options = useMemo(() => (product.options && product.options.length ? product.options : deriveProductOptions(variants, settings)), [product.options, variants, settings]);
  const onCard = useMemo(() => cardOptions(options, settings), [options, settings]);
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<Selection>(() => defaultSelection(variants, options));
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const panelId = useId();
  const chosen = findVariant(variants, options, selection) as QuickVariant | null;
  const soldOut = !!chosen && chosen.inventory_quantity != null && chosen.inventory_quantity <= 0;

  async function commit(variant: QuickVariant | undefined) {
    setState("busy");
    try {
      await onAdd(variant);
      setState("done");
      window.setTimeout(() => { setState("idle"); setOpen(false); onPrice?.(null, null); }, 900);
    } catch {
      setState("idle");
    }
  }

  if (onCard.length === 0) {
    return (
      <button type="button" aria-label={label} disabled={state === "busy"} className={`buy-add ${state === "done" ? "is-done" : ""}`}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); void commit(variants[0]); }}>
        {state === "busy" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-5 w-5" strokeWidth={2.6} aria-hidden />}
      </button>
    );
  }

  function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const next = !open;
    setOpen(next);
    if (!next) onPrice?.(null, null);
    else if (chosen) onPrice?.(Number(chosen.price), chosen.compare_at_price != null ? Number(chosen.compare_at_price) : null);
  }

  return (
    <>
      <button type="button" aria-label={open ? `Close options for ${label.replace(/^Add /, "")}` : label} aria-expanded={open} aria-controls={panelId}
        className={`buy-add ${open ? "is-open" : ""}`} onClick={toggle}>
        {open ? <X className="h-5 w-5" strokeWidth={2.6} aria-hidden /> : <Plus className="h-5 w-5" strokeWidth={2.6} aria-hidden />}
      </button>
      <div id={panelId} className={`buy-expand${open ? " is-open" : ""}`} aria-hidden={!open} {...(!open ? { inert: true } : {})}>
        <div className="buy-expand__in">
          <OptionPicker
            options={onCard} variants={variants} selection={selection} idPrefix={panelId}
            onSelect={(key, value) => {
              const next = selectValue(variants, options, selection, key, value);
              setSelection(next);
              const v = findVariant(variants, options, next) as QuickVariant | null;
              onPrice?.(v ? Number(v.price) : null, v?.compare_at_price != null ? Number(v.compare_at_price) : null);
            }}
          />
          <button type="button" className={`buy-expand__go${state === "done" ? " is-done" : ""}`} disabled={!chosen || soldOut || state === "busy"}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); void commit(chosen ?? undefined); }}>
            {state === "busy" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : state === "done" ? <><Check className="h-4 w-4" aria-hidden />Added</> : soldOut ? "Sold out" : chosen ? `Add · UGX ${Number(chosen.price).toLocaleString("en-UG")}` : "Choose options"}
          </button>
        </div>
      </div>
    </>
  );
}
