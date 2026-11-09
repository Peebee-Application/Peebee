"use client";

import { isValueAvailable, type ProductOption, type Selection, type VariantLike } from "@peebee/shared";

/**
 * Colour swatches, size buttons or a dropdown for each option of a product, depending on how the admin set the option
 * to show. A value with no purchasable variant (given the other choices) is struck through and cannot be picked.
 */
export function OptionPicker({
  options, variants, selection, onSelect, tracked = true, idPrefix,
}: {
  options: ProductOption[];
  variants: VariantLike[];
  selection: Selection;
  onSelect: (optionKey: string, value: string) => void;
  tracked?: boolean;
  idPrefix: string;
}) {
  return (
    <div className="buy-opts">
      {options.map((option) => {
        const chosen = selection[option.key] ?? "";
        const labelId = `${idPrefix}-${option.key}`;
        return (
          <div key={option.key} className="buy-opt">
            <p id={labelId} className="buy-opt__label">{option.name}<b>{chosen}</b></p>
            {option.display === "dropdown" ? (
              <select aria-labelledby={labelId} className="buy-opt__select" value={chosen} onChange={(e) => onSelect(option.key, e.target.value)}>
                {option.values.map((v) => <option key={v.value} value={v.value}>{v.value}</option>)}
              </select>
            ) : (
              <div role="radiogroup" aria-labelledby={labelId} className="buy-opt__row">
                {option.values.map((v) => {
                  const on = chosen.toLowerCase() === v.value.toLowerCase();
                  const ok = isValueAvailable(variants, option.key, v.value, selection, tracked);
                  const swatch = option.display === "swatch";
                  return (
                    <button
                      key={v.value} type="button" role="radio" aria-checked={on} aria-label={`${option.name} ${v.value}${ok ? "" : ", unavailable"}`}
                      className={`${swatch ? "buy-swatch" : "buy-chip"}${on ? " is-on" : ""}${ok ? "" : " is-off"}`}
                      style={swatch ? ({ ["--sw" as string]: v.hex ?? "rgb(var(--color-ink-500))" } as React.CSSProperties) : undefined}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSelect(option.key, v.value); }}
                    >
                      {swatch ? <span aria-hidden /> : v.value}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
