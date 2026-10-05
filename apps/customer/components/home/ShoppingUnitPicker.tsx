"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, X } from "lucide-react";
import { SHOPPING_UNITS, SHOPPING_UNIT_IDS, type ShoppingUnit, type ShoppingUnitSettings } from "@peebee/shared";
import { Select } from "@peebee/shared/select";
import { useTranslate } from "../../lib/i18n";
import { UNIT_KEYS } from "./shoppingUnitLabels";

export function ShoppingUnitPicker({ value, customUnit, suggestions, config, onPick }: {
  value: ShoppingUnit; customUnit?: string; suggestions: ShoppingUnit[]; config: ShoppingUnitSettings;
  onPick: (unit: ShoppingUnit, customUnit?: string) => void;
}) {
  const t = useTranslate();
  const [expanded, setExpanded] = useState(false);
  const options = [...new Set([value, ...suggestions])].slice(0, config.suggestedCount);
  if (config.allowBudget && !options.includes("budget")) options.push("budget");
  const display = value === "other" ? customUnit || t("unit_other") : value === "pcs" ? t("unit_pcs") : SHOPPING_UNITS[value].short;
  return <div className="flex min-w-0 items-center" style={{ flex: "0 1 auto", maxWidth: "45%" }}>
    <Select value={value} displayValue={display} onValueChange={(next) => onPick(next as ShoppingUnit, customUnit)} aria-label={t("list_unit_label")} className="text-sm font-semibold text-ink outline-none" style={{ minWidth: 0 }}>
      {options.map((unit) => <option key={unit} value={unit}>{unit === "other" ? customUnit || t("unit_other") : t(UNIT_KEYS[unit])}</option>)}
    </Select>
    <button type="button" onClick={() => setExpanded(true)} aria-label={t("list_more_units")} title={t("list_more_units")} className="flex h-10 w-6 shrink-0 items-center justify-center rounded-lg text-ink-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"><MoreHorizontal className="h-4 w-4" aria-hidden /></button>
    {expanded && createPortal(<UnitCatalogDialog value={value} customUnit={customUnit} config={config} onClose={() => setExpanded(false)} onPick={(unit, label) => { onPick(unit, label); setExpanded(false); }} />, document.body)}
  </div>;
}

function UnitCatalogDialog({ value, customUnit, config, onClose, onPick }: {
  value: ShoppingUnit; customUnit?: string; config: ShoppingUnitSettings; onClose: () => void;
  onPick: (unit: ShoppingUnit, customUnit?: string) => void;
}) {
  const t = useTranslate();
  const dialog = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState("");
  const [custom, setCustom] = useState(customUnit || "");
  const [customMode, setCustomMode] = useState(false);
  useEffect(() => { const el = dialog.current; el?.showModal(); return () => { el?.close(); }; }, []);
  const units = SHOPPING_UNIT_IDS.filter((id) => (config.allowBudget || id !== "budget") && `${t(UNIT_KEYS[id])} ${SHOPPING_UNITS[id].label} ${SHOPPING_UNITS[id].short}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <dialog ref={dialog} aria-labelledby="shopping-units-title" onCancel={(event) => { event.preventDefault(); onClose(); }} onKeyDown={(event) => event.stopPropagation()} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} className="m-auto w-[calc(100%-2rem)] max-w-md rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 text-ink shadow-xl backdrop:bg-black/50">
    <div className="mb-4 flex items-center justify-between gap-3"><h2 id="shopping-units-title" className="text-lg font-bold">{t("list_all_units")}</h2><button type="button" onClick={onClose} aria-label={t("list_units_close")} className="rounded-full p-2 text-ink-500"><X className="h-5 w-5" aria-hidden /></button></div>
    {!customMode ? <>
      <input aria-label={t("list_find_unit")} placeholder={t("list_find_unit")} value={search} onChange={(event) => setSearch(event.target.value)} className="mb-3 w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 outline-none focus:border-gold" />
      <div className="max-h-[45dvh] overflow-y-auto">
        {units.map((unit) => <button key={unit} type="button" aria-pressed={unit === value} onClick={() => onPick(unit)} className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-[rgb(var(--surface-muted))] ${unit === value ? "bg-[rgb(var(--surface-muted))] font-semibold" : ""}`}><span>{t(UNIT_KEYS[unit])}</span>{unit === value && <span className="text-gold" aria-hidden>✓</span>}</button>)}
        {units.length === 0 && <p className="px-3 py-3 text-sm text-ink-500">{t("list_no_unit_results")}</p>}
      </div>
      {config.allowCustom && <button type="button" onClick={() => setCustomMode(true)} className="mt-3 min-h-11 w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-left font-semibold">{t("unit_other")}</button>}
    </> : <form onSubmit={(event) => { event.preventDefault(); if (custom.trim()) onPick("other", custom.trim()); }} className="space-y-3">
      <label htmlFor="shopping-custom-unit" className="block text-sm font-semibold">{t("list_custom_unit")}</label>
      <input id="shopping-custom-unit" autoFocus required maxLength={config.customUnitMaxLength} value={custom} onChange={(event) => setCustom(event.target.value)} placeholder={t("list_custom_unit_example")} className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 outline-none focus:border-gold" />
      <p className="text-xs text-ink-500">{t("list_custom_unit_hint")}</p>
      <button disabled={!custom.trim()} className="min-h-11 w-full rounded-full bg-gold font-semibold text-ink-gold disabled:opacity-50">{t("list_use_unit")}</button>
      <button type="button" onClick={() => setCustomMode(false)} className="min-h-10 w-full text-sm text-ink-500">{t("list_units_back")}</button>
    </form>}
  </dialog>;
}
