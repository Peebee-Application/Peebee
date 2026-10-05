"use client";

import { Select } from "@peebee/shared/select";

import { ArrowRight, Check, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslate, type TranslationKey } from "../../lib/i18n";

/** Uganda's everyday market units — produce and groceries are almost
 * always sold by weight or volume rather than by piece. */
export type Unit = "pcs" | "kg" | "g" | "l" | "ml" | "m";
export const UNIT_KEYS: Record<Unit, TranslationKey> = {
  pcs: "unit_pcs",
  kg: "unit_kg",
  g: "unit_g",
  l: "unit_l",
  ml: "unit_ml",
  m: "unit_m",
};
export const UNIT_ABBR: Record<Unit, string> = { pcs: "", kg: "kg", g: "g", l: "L", ml: "ml", m: "m" };

/** 0 = typing the name, 1 = quantity, 2 = price, 3 = finished (one small line). */
export type Stage = 0 | 1 | 2 | 3;
export type Item = { name: string; quantity: string; unitCost: string; unit: Unit; stage: Stage };

export const blankItem = (): Item => ({ name: "", quantity: "1", unitCost: "", unit: "pcs", stage: 0 });

const money = (n: number) => n.toLocaleString("en-UG");
const qtyLabel = (item: Item) => `${item.quantity || "1"}${UNIT_ABBR[item.unit] ? ` ${UNIT_ABBR[item.unit]}` : ""}`;

const field =
  "min-w-0 flex-1 bg-transparent px-1.5 text-base font-semibold text-ink outline-none placeholder:font-normal placeholder:text-ink-500/60";
const chip = "block max-w-full truncate px-1 py-1.5 text-sm font-semibold text-ink";

/** A full-width, single-line shopping entry: name → quantity → price.
 * Text columns share the available width in proportion to their contents;
 * the unit and action controls stay compact. Confirmed fields become chips,
 * then the item settles into a summary. Tap a chip or summary to edit again. */
export function ListItemLine({
  item,
  canRemove,
  onChange,
  onRemove,
  onComplete,
}: {
  item: Item;
  canRemove: boolean;
  onChange: (patch: Partial<Item>) => void;
  onRemove: () => void;
  onComplete: () => void;
}) {
  const t = useTranslate();
  const nameRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const { stage } = item;

  useEffect(() => {
    const el = stage === 0 ? nameRef.current : stage === 1 ? qtyRef.current : stage === 2 ? priceRef.current : null;
    el?.focus();
    if (stage === 1) el?.select();
  }, [stage]);

  if (stage === 3) {
    const price = Number(item.unitCost) || 0;
    const total = (Number(item.quantity) || 1) * price;
    return (
      <div className="flex items-center gap-2 py-1.5">
        <button
          type="button"
          onClick={() => onChange({ stage: 0 })}
          className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
        >
          <span className="truncate text-sm font-semibold text-ink">{item.name}</span>
          <span className="shrink-0 text-xs text-ink-500">
            {qtyLabel(item)}
            {price > 0 && ` × ${money(price)}`}
          </span>
        </button>
        {price > 0 && <span className="shrink-0 text-sm font-bold text-ink">{money(total)}</span>}
        {canRemove && (
          <button type="button" onClick={onRemove} aria-label={t("list_remove_item")} className="shrink-0 p-1 text-ink-500/70 hover:text-red-600">
            <X className="h-4 w-4" strokeWidth={2} aria-hidden />
          </button>
        )}
      </div>
    );
  }

  const canAdvance = stage === 0 ? item.name.trim().length > 0 : stage === 1 ? Number(item.quantity) > 0 : true;
  const unitLabel = UNIT_ABBR[item.unit] || t("unit_pcs");

  function advance() {
    if (!canAdvance) return;
    if (stage === 2) {
      onChange({ stage: 3 });
      onComplete();
    } else {
      onChange({ stage: (stage + 1) as Stage });
    }
  }
  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      advance();
    }
  };
  // Zero bases let every column shrink within one row. Content weights give
  // longer values more room without forcing equal widths or minimums that wrap.
  const seg = (text: string, minimum: number, maximum: number): React.CSSProperties => ({
    flexGrow: Math.min(maximum, Math.max(minimum, text.length)),
    flexShrink: 1,
    flexBasis: "0%",
    minWidth: 0,
  });
  const segClass = "flex min-w-0 items-center transition-[flex-grow] duration-200 ease-out";
  const nextButton = (
    <button
      type="button"
      onClick={advance}
      disabled={!canAdvance}
      aria-label="Next"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold text-ink-gold transition-opacity disabled:opacity-35"
    >
      {stage === 2 ? <Check className="h-4 w-4" strokeWidth={2.75} aria-hidden /> : <ArrowRight className="h-4 w-4" strokeWidth={2.5} aria-hidden />}
    </button>
  );

  return (
    <div className="field-box flex h-14 w-full min-w-0 flex-nowrap items-center gap-1.5 rounded-2xl border border-[var(--border-faint)] px-2.5">
      <div className={segClass} style={seg(item.name, 4, 24)}>
        {stage === 0 ? (
          <input
            ref={nameRef}
            value={item.name}
            onChange={(e) => onChange({ name: e.target.value })}
            onKeyDown={onEnter}
            placeholder={t("list_item_name_placeholder")}
            enterKeyHint="next"
            className={field}
          />
        ) : (
          <button type="button" onClick={() => onChange({ stage: 0 })} className={`${chip} w-full text-left`} title={item.name}>
            {item.name}
          </button>
        )}
      </div>

      {stage >= 1 && (
        <div className={segClass} style={seg(stage === 1 ? item.quantity : qtyLabel(item), stage === 1 ? 2 : 3, 12)}>
          {stage === 1 ? (
            <input
              ref={qtyRef}
              value={item.quantity}
              onChange={(e) => onChange({ quantity: e.target.value.replace(/[^\d]/g, "") })}
              onKeyDown={onEnter}
              inputMode="numeric"
              placeholder={t("list_quantity_label")}
              aria-label={t("list_quantity_label")}
              enterKeyHint="next"
              className={field}
            />
          ) : (
            <button type="button" onClick={() => onChange({ stage: 1 })} className={`${chip} w-full text-left`} title={qtyLabel(item)}>
              {qtyLabel(item)}
            </button>
          )}
        </div>
      )}

      {stage === 1 && (
        <Select
          value={item.unit}
          displayValue={unitLabel}
          onValueChange={(value) => onChange({ unit: value as Unit })}
          aria-label={t("list_unit_label")}
          className="text-sm font-semibold text-ink outline-none"
          style={{ flex: "0 1 auto", maxWidth: "40%" }}
        >
          {(Object.keys(UNIT_KEYS) as Unit[]).map((u) => (
            <option key={u} value={u}>{t(UNIT_KEYS[u])}</option>
          ))}
        </Select>
      )}

      {stage === 2 && (
        <div className={segClass} style={seg(item.unitCost, 5, 12)}>
          <input
            ref={priceRef}
            value={item.unitCost}
            onChange={(e) => onChange({ unitCost: e.target.value.replace(/[^\d]/g, "") })}
            onKeyDown={onEnter}
            inputMode="numeric"
            placeholder={t("list_price_short")}
            aria-label={t("list_price_short")}
            enterKeyHint="done"
            className={field}
          />
        </div>
      )}

      {nextButton}
      {canRemove && (
        <button type="button" onClick={onRemove} aria-label={t("list_remove_item")} className="shrink-0 p-1 text-ink-500/60 hover:text-red-600">
          <X className="h-4 w-4" strokeWidth={2} aria-hidden />
        </button>
      )}
    </div>
  );
}
