"use client";

import { AlignLeft, Check, Globe, Hand, Leaf, MapPin, MessageCircle, Phone, ShoppingBag, Smartphone, Store as StoreIcon, Truck, Wallet, ExternalLink, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ErrorNote, GRow, Group, SectionLabel, Toggle } from "../account/AccountUI";
import { BottomSheet } from "./BottomSheet";
import { PageHeader, fieldCls, labelCls } from "./StoreUI";
import { api, errorMessage } from "../../lib/api";

export type SettingsStore = {
  name: string; category: "groceries" | "stores"; description: string | null; logo_url: string | null; phone: string | null;
  whatsapp_number?: string | null; address?: string | null; min_order_amount?: number; status: "active" | "inactive";
  is_open?: number | boolean | null; delivery_enabled?: number | boolean | null; pickup_enabled?: number | boolean | null;
};

type TextField = "name" | "description" | "phone" | "whatsapp_number" | "address";
const TEXT: Record<TextField, { title: string; icon: LucideIcon; type?: string; max: number; min?: number; multiline?: boolean; mode?: "tel" | "text" }> = {
  name: { title: "Store name", icon: StoreIcon, max: 60, min: 2 },
  description: { title: "About", icon: AlignLeft, max: 500, multiline: true },
  phone: { title: "Phone", icon: Phone, max: 20, mode: "tel" },
  whatsapp_number: { title: "WhatsApp", icon: MessageCircle, max: 20, mode: "tel" },
  address: { title: "Address", icon: MapPin, max: 160 },
};
const QUICK = [0, 5000, 10000, 20000];
const ugx = (n: number) => `UGX ${Math.round(n).toLocaleString("en-US")}`;
const on = (v: unknown, dflt = true) => (v == null ? dflt : v === true || Number(v) === 1);

/** Store details: owners and managers change them here (Category stays locked); everyone else sees them read-only. */
export function StoreSettings({ store, canEdit, onBack, onSaved, logo, siteHost, buyUrl }: {
  store: SettingsStore; canEdit: boolean; onBack: () => void; onSaved: (patch: Partial<SettingsStore>) => void; logo: ReactNode; siteHost: string; buyUrl: string;
}) {
  const [editing, setEditing] = useState<TextField | "min_order" | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [sheetError, setSheetError] = useState("");
  const [saved, setSaved] = useState("");

  async function save(patch: Record<string, unknown>, label: string) {
    setError(""); setSaved("");
    const res = await api.updateMerchantProStore(patch);
    onSaved({ ...patch, ...(res?.store ?? {}) } as Partial<SettingsStore>);
    setSaved(label);
  }
  async function toggle(field: "is_open" | "delivery_enabled" | "pickup_enabled", label: string) {
    if (!canEdit || busy) return;
    const next = !on(store[field]);
    setBusy(field);
    try { await save({ [field]: next }, label); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(null); }
  }
  function open(field: TextField | "min_order") {
    if (!canEdit) return;
    setSheetError("");
    setValue(field === "min_order" ? String(store.min_order_amount ?? 5000) : String((store as Record<string, unknown>)[field] ?? ""));
    setEditing(field);
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    let patch: Record<string, unknown>;
    if (editing === "min_order") {
      const n = Number(value.replace(/[^\d]/g, ""));
      if (!Number.isFinite(n) || n < 0) { setSheetError("Type an amount."); return; }
      patch = { min_order_amount: Math.round(n) };
    } else {
      const meta = TEXT[editing];
      const v = value.trim();
      if (meta.min && v.length < meta.min) { setSheetError("Too short."); return; }
      patch = { [editing]: v };
    }
    setBusy("sheet"); setSheetError("");
    try { await save(patch, editing === "min_order" ? "Minimum order" : TEXT[editing].title); setEditing(null); }
    catch (cause) { setSheetError(errorMessage(cause)); } finally { setBusy(null); }
  }

  const trail = canEdit ? "edit" : "lock";
  const isOpen = on(store.is_open);
  const row = (field: TextField, label: string, val: string | null | undefined, testId: string) => (
    <GRow icon={TEXT[field].icon} label={label} value={val?.trim() ? val : <span className="text-ink-500">Not set</span>} trail={trail} onClick={canEdit ? () => open(field) : undefined} testId={testId} />
  );
  const toggleRow = (field: "is_open" | "delivery_enabled" | "pickup_enabled", icon: LucideIcon, label: string, testId: string) => (
    <GRow icon={icon} value={label} trail={<Toggle on={on(store[field])} />} onClick={canEdit ? () => void toggle(field, label) : undefined} pressed={on(store[field])} testId={testId} />
  );

  return (
    <div className="space-y-4" data-testid="settings">
      <PageHeader title="Settings" onBack={onBack} />
      <div className="flex items-center gap-3.5">
        {logo}
        <div className="min-w-0 flex-1">
          <p className="break-words text-[24px] font-black leading-tight text-ink" data-testid="settings-store-name">{store.name}</p>
          <span className={`mt-1.5 inline-flex h-[34px] items-center gap-1.5 rounded-full px-3 text-[15px] font-black ${store.status === "active" && isOpen ? "bg-[#16a34a]/15 text-[#15803d] dark:text-[#4ade80]" : "bg-[rgb(var(--surface-muted))] text-ink-500"}`} data-testid="settings-open-pill">
            <i className={`block h-2.5 w-2.5 rounded-full ${store.status === "active" && isOpen ? "bg-[#22c55e]" : "bg-ink-500"}`} />{store.status !== "active" ? "Closed" : isOpen ? "Open now" : "Closed now"}
          </span>
        </div>
      </div>
      {saved && <p role="status" className="flex items-center gap-2.5 rounded-[18px] bg-green-600/12 px-4 py-3 text-[17px] font-black text-green-700 dark:text-green-300" data-testid="settings-saved"><Check className="h-6 w-6" strokeWidth={3} /> {saved} saved</p>}
      <ErrorNote message={error} />

      <SectionLabel>Shop</SectionLabel>
      <Group>
        {toggleRow("is_open", StoreIcon, "Open for orders", "setting-open")}
        {row("name", "Name", store.name, "setting-name")}
        {row("description", "About", store.description, "setting-about")}
        <GRow icon={store.category === "groceries" ? Leaf : ShoppingBag} label="Category" value={store.category === "groceries" ? "Groceries & fresh food" : "Shop & boutique"} trail="lock" testId="setting-category" />
      </Group>
      <SectionLabel>Orders</SectionLabel>
      <Group>
        <GRow icon={Wallet} label="Minimum order" value={ugx(store.min_order_amount ?? 5000)} trail={trail} onClick={canEdit ? () => open("min_order") : undefined} testId="setting-min-order" />
        {toggleRow("delivery_enabled", Truck, "Delivery", "setting-delivery")}
        {toggleRow("pickup_enabled", Hand, "Pickup", "setting-pickup")}
      </Group>
      <SectionLabel>Contact</SectionLabel>
      <Group>
        {row("phone", "Phone", store.phone, "setting-phone")}
        {row("whatsapp_number", "WhatsApp", store.whatsapp_number, "setting-whatsapp")}
        {row("address", "Address", store.address, "setting-address")}
      </Group>
      <SectionLabel>Links</SectionLabel>
      <Group>
        <GRow icon={Globe} label="My website" value={<span className="break-all">{siteHost}</span>} href={`https://${siteHost}`} external trail={<ExternalLink className="h-6 w-6 shrink-0 text-ink-500" />} />
        <GRow icon={Smartphone} label="Peebee Buy" value={<span className="break-all">{buyUrl.replace(/^https?:\/\//, "")}</span>} href={buyUrl} external trail={<ExternalLink className="h-6 w-6 shrink-0 text-ink-500" />} />
      </Group>

      {editing && (
        <BottomSheet title={editing === "min_order" ? "Minimum order" : TEXT[editing].title} onClose={() => setEditing(null)} testId="setting-sheet"
          footer={<button type="submit" form="setting-form" disabled={busy === "sheet"} data-testid="setting-save"
            className="flex min-h-16 w-full items-center justify-center gap-2.5 rounded-full bg-gold text-[20px] font-black text-ink-gold shadow-[0_8px_22px_rgb(var(--gold)/0.35)] active:scale-[.98] disabled:opacity-50">
            <Check className="h-6 w-6" strokeWidth={3} /> {busy === "sheet" ? "Saving…" : "Save"}</button>}>
          <form id="setting-form" onSubmit={submit} className="space-y-4 pt-1">
            {editing === "min_order" ? (
              <>
                <label htmlFor="setting-input" className="flex min-h-[84px] items-center gap-2.5 rounded-[20px] border-[2.5px] border-gold bg-[rgb(var(--surface-input))] px-[18px] shadow-[0_0_0_5px_rgb(var(--gold)/0.2)]">
                  <span className="text-[20px] font-black text-ink-500">UGX</span>
                  <input id="setting-input" inputMode="numeric" value={value ? Number(value.replace(/[^\d]/g, "") || 0).toLocaleString("en-US") : ""} onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ""))}
                    className="min-w-0 flex-1 bg-transparent text-[34px] font-black text-ink outline-none" data-testid="setting-input" aria-label="Minimum order in UGX" />
                </label>
                <div className="flex flex-wrap gap-2.5">
                  {QUICK.map((q) => {
                    const sel = Number(value || 0) === q;
                    return <button key={q} type="button" onClick={() => setValue(String(q))} aria-pressed={sel} data-testid={`min-quick-${q}`}
                      className={`min-h-14 rounded-full border-2 px-[18px] text-[18px] font-black ${sel ? "border-gold bg-gold/15 text-ink" : "border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] text-ink"}`}>{q === 0 ? "None" : q.toLocaleString("en-US")}</button>;
                  })}
                </div>
              </>
            ) : (
              <div>
                <label htmlFor="setting-input" className={labelCls}>{(() => { const I = TEXT[editing].icon; return <I className="h-5 w-5 text-gold" />; })()} {TEXT[editing].title}</label>
                {TEXT[editing].multiline
                  ? <textarea id="setting-input" rows={4} maxLength={TEXT[editing].max} value={value} onChange={(e) => setValue(e.target.value)} className={`${fieldCls} py-3 leading-snug`} data-testid="setting-input" />
                  : <input id="setting-input" maxLength={TEXT[editing].max} inputMode={TEXT[editing].mode ?? "text"} type={TEXT[editing].mode === "tel" ? "tel" : "text"} value={value} onChange={(e) => setValue(e.target.value)} className={fieldCls} data-testid="setting-input" />}
              </div>
            )}
            <ErrorNote message={sheetError} />
          </form>
        </BottomSheet>
      )}
    </div>
  );
}
