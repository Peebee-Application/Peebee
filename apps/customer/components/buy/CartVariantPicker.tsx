"use client";

import { findVariant, selectValue, variantPairs, type ProductOption, type Selection, type VariantLike } from "@peebee/shared";
import { ChevronDown, Loader2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { api } from "../../lib/api";
import { swapVariant, type CartItem } from "../../lib/cart";
import { OptionPicker } from "./OptionPicker";

type Variant = { id: string; title: string; price: number; compare_at_price?: number | null; image_url?: string | null; inventory_quantity?: number | null; values?: string[]; option1_name?: string | null; option1_value?: string | null; option2_name?: string | null; option2_value?: string | null; option3_name?: string | null; option3_value?: string | null };
type Loaded = { variants: Variant[]; options: ProductOption[]; tracked: boolean };

const cache = new Map<string, Promise<Loaded | null>>();

function load(productId: string): Promise<Loaded | null> {
  let hit = cache.get(productId);
  if (!hit) {
    hit = api.getMarketplaceProduct(productId).then((res: any) => {
      const p = res?.product;
      const variants: Variant[] = p?.variants ?? [];
      if (variants.length < 2) return null;
      const options: ProductOption[] = p.options?.length
        ? p.options
        : [{ key: "option", name: "Option", display: "chips", showOnBuyCard: false, values: variants.map((v) => ({ value: v.title })) }];
      const shaped = p.options?.length ? variants : variants.map((v) => ({ ...v, values: [v.title], option1_name: "Option", option1_value: v.title }));
      return { variants: shaped, options, tracked: p.track_inventory == null || !!p.track_inventory };
    }).catch(() => { cache.delete(productId); return null; });
    cache.set(productId, hit);
  }
  return hit;
}

/** The variant label on a cart row. Tapping it opens the same swatches or buttons as the product, and the row follows the choice. */
export function CartVariantPicker({ line, open, onToggle }: { line: CartItem; open: boolean; onToggle: () => void }) {
  const [data, setData] = useState<Loaded | null | undefined>(undefined);
  const panel = useId();
  useEffect(() => {
    if (!open || data !== undefined) return;
    let live = true;
    void load(line.productId).then((d) => { if (live) setData(d); });
    return () => { live = false; };
  }, [open, data, line.productId]);

  const label = [line.variantTitle, line.storeName].filter(Boolean).join(" · ");
  const current = data?.variants.find((v) => v.id === line.variantId);
  const selection: Selection = {};
  if (data && current) {
    const pairs = variantPairs(current as VariantLike);
    for (const o of data.options) selection[o.key] = o.key === "option" ? current.title : (pairs.find((p) => p.key === o.key)?.value ?? "");
  }

  return (
    <>
      <button type="button" aria-expanded={open} aria-controls={panel} onClick={onToggle} className="mt-0.5 inline-flex max-w-full items-center gap-1 text-[11px] text-ink-500">
        <span className="truncate">{label}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      <div id={panel} className={`buy-expand${open ? " is-open" : ""}`} aria-hidden={!open} {...(!open ? { inert: true } : {})}>
        <div className="buy-expand__in">
          {data === undefined && open && <Loader2 className="mt-2 h-4 w-4 animate-spin text-ink-500" aria-label="Loading options" />}
          {data === null && <p className="mt-2 text-[11px] text-ink-500">This item has no other options.</p>}
          {data && current && (
            <OptionPicker
              options={data.options} variants={data.variants} selection={selection} tracked={data.tracked} idPrefix={panel}
              onSelect={(key, value) => {
                const next = selectValue(data.variants, data.options, selection, key, value, data.tracked);
                const v = findVariant(data.variants, data.options, next);
                if (v) swapVariant(line.id, { variantId: v.id, variantTitle: v.title, price: Number(v.price), compareAtPrice: v.compare_at_price != null ? Number(v.compare_at_price) : undefined, imageUrl: v.image_url ?? undefined });
              }}
            />
          )}
        </div>
      </div>
    </>
  );
}
