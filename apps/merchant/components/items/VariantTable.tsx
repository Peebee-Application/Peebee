"use client";

import {
  Barcode, Boxes, Camera, Check, ChevronDown, ChevronRight, ChevronUp, CircleAlert, Copy, Grid3x3, Image as ImageIcon, Layers, LayoutList, Link2,
  Loader2, Minus, PackageX, Pencil, Plus, RotateCcw, Ruler, Tag, X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Per-variant values the wizard keeps. Price "" means "use the colour price" (or the main price). */
export type VariantValues = { price: string; stock: number; was?: string; sku?: string; barcode?: string; image?: string };
export type Colour = { name: string; hex: string };
type Rows = Record<string, VariantValues>;

export function digitsOf(v: string | undefined) { return Number((v ?? "").replace(/\D/g, "")) || 0; }
export function comboKey(size: string, colour: string) { return `${size}|${colour}`; }
const fmt = (n: number) => n.toLocaleString("en-US");

/** The price a variant sells at: its own price, else its colour price, else the main price. 0 = missing. */
export function effectivePrice(rows: Rows, groupPrices: Record<string, string>, basePrice: number, size: string, colour: string) {
  return digitsOf(rows[comboKey(size, colour)]?.price) || digitsOf(groupPrices[colour]) || basePrice;
}

export function combos(sizes: string[], colours: Colour[]) {
  if (!sizes.length && !colours.length) return [];
  const ss = sizes.length ? sizes : [""];
  const cs = colours.length ? colours.map((c) => c.name) : [""];
  return ss.flatMap((s) => cs.map((c) => ({ size: s, colour: c, key: comboKey(s, c), label: [s, c].filter(Boolean).join(" · ") })));
}

/** Light swatches need dark text on top. */
function inkOn(hex: string) {
  const h = hex.replace("#", "");
  if (h.length !== 6) return "#0a0a0a";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return r * 0.299 + g * 0.587 + b * 0.114 > 160 ? "#0a0a0a" : "#ffffff";
}

type Props = {
  title: string;
  sizes: string[];
  colours: Colour[];
  basePrice: number;
  defaultStock: number;
  rows: Rows;
  setRows: (update: (rows: Rows) => Rows) => void;
  groupPrices: Record<string, string>;
  setGroupPrices: (update: (m: Record<string, string>) => Record<string, string>) => void;
  onApplyAll: (price: number | null, stock: number | null) => void;
  showMissing: boolean;
  uploadPhoto: (file: File) => Promise<string | null>;
};

const card = "rounded-3xl border-[1.5px] border-[var(--border-faint)] bg-[rgb(var(--surface-card))] shadow-[0_4px_16px_rgba(10,10,10,0.06)]";
const lab = "mb-2 flex items-center gap-2 text-[17px] font-extrabold text-ink";
const fieldBox = "field-box flex min-h-[60px] items-center gap-2.5 rounded-2xl border-2 border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-4 focus-within:border-gold focus-within:ring-4 focus-within:ring-gold/20";
const fieldInput = "min-h-14 w-full min-w-0 flex-1 bg-transparent text-[21px] font-extrabold text-ink outline-none placeholder:font-semibold placeholder:text-ink-500/70";
const red = "text-red-600 dark:text-red-400";

export function VariantTable(p: Props) {
  const { sizes, colours, basePrice, defaultStock, rows, setRows, groupPrices, setGroupPrices, showMissing } = p;
  const [view, setView] = useState<"list" | "grid">("list");
  const [gridMode, setGridMode] = useState<"stock" | "price">("stock");
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<{ size: string; colour: string } | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const all = combos(sizes, colours);
  const price = (s: string, c: string) => effectivePrice(rows, groupPrices, basePrice, s, c);
  const stockOf = (s: string, c: string) => rows[comboKey(s, c)]?.stock ?? defaultStock;
  const own = (s: string, c: string) => digitsOf(rows[comboKey(s, c)]?.price) > 0;
  const missing = all.filter((r) => price(r.size, r.colour) <= 0);
  const groups: Colour[] = colours.length ? colours : [{ name: "", hex: "" }];
  const sizeList = sizes.length ? sizes : [""];
  const isOpen = (c: string, i: number) => openMap[c] ?? (groups.length <= 2 || i === 0 || (showMissing && missing.some((m) => m.colour === c)));

  function setStock(s: string, c: string, n: number) {
    const k = comboKey(s, c);
    setRows((m) => ({ ...m, [k]: { ...(m[k] ?? { price: "" }), stock: Math.max(0, Math.min(99999, n)) } }));
  }

  function showFirstMissing() {
    const first = missing[0];
    if (!first) return;
    setView("list");
    setOpenMap((m) => ({ ...m, [first.colour]: true }));
    setTimeout(() => document.getElementById(`vt-${first.key}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
  }

  return (
    <section className="space-y-4" data-testid="variants-table">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-2xl font-black text-ink">
          <Layers className="h-6 w-6" /> Variants
          <span className="grid h-9 min-w-9 place-items-center rounded-full bg-black px-2.5 text-lg text-gold dark:bg-gold dark:text-ink-gold" data-testid="variant-count">{all.length}</span>
        </h2>
        <Seg value={view} onChange={(v) => setView(v as "list" | "grid")} options={[{ v: "list", icon: <LayoutList className="h-[22px] w-[22px]" />, label: "List" }, { v: "grid", icon: <Grid3x3 className="h-[22px] w-[22px]" />, label: "Grid" }]} testId="variant-view" />
      </div>

      {showMissing && missing.length > 0 && (
        <div role="alert" className={`flex items-center gap-3 rounded-[20px] border-2 border-red-600 bg-red-600/10 py-3 pl-4 pr-3 dark:border-red-400 ${red}`} data-testid="variants-missing">
          <CircleAlert className="h-7 w-7 shrink-0" />
          <span className="min-w-0 flex-1 text-[19px] font-black">{missing.length} need a price</span>
          <button type="button" onClick={showFirstMissing} className="flex min-h-14 shrink-0 items-center gap-1.5 rounded-2xl bg-red-600 px-4 text-[17px] font-black text-white dark:bg-red-500">Show <ChevronDown className="h-5 w-5" strokeWidth={2.8} /></button>
        </div>
      )}

      <button type="button" onClick={() => setBulkOpen(true)} data-testid="variants-bulk" className="flex min-h-16 w-full items-center gap-3 rounded-[20px] border-[1.5px] border-gold/40 bg-black px-3.5 text-left text-[19px] font-black text-white dark:bg-[#000]">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gold text-ink-gold"><Copy className="h-[22px] w-[22px]" /></span>
        <span className="min-w-0 flex-1">Same price &amp; stock for all {all.length}</span>
        <ChevronRight className="h-6 w-6 shrink-0 text-gold" strokeWidth={3} />
      </button>

      {view === "list" ? (
        <>
          {groups.map((g, gi) => {
            const gRows = sizeList.map((s) => ({ size: s, key: comboKey(s, g.name) }));
            const left = gRows.reduce((n, r) => n + stockOf(r.size, g.name), 0);
            const sold = gRows.filter((r) => stockOf(r.size, g.name) === 0).length;
            const gMissing = showMissing ? gRows.filter((r) => price(r.size, g.name) <= 0).length : 0;
            const open = !g.name || isOpen(g.name, gi);
            const gp = digitsOf(groupPrices[g.name]) || basePrice;
            return (
              <div key={g.name || "all"} className={`${card} space-y-3.5 p-3.5 ${gMissing ? "!border-2 !border-red-600 dark:!border-red-400" : ""}`} data-testid={`variant-group-${g.name || "all"}`}>
                {g.name && (
                  <button type="button" onClick={() => setOpenMap((m) => ({ ...m, [g.name]: !open }))} aria-expanded={open} className="flex w-full items-center gap-3 text-left">
                    <span className="h-14 w-14 shrink-0 rounded-2xl border-[3px] border-white/90 shadow-[0_0_0_1.5px_rgba(0,0,0,0.25)]" style={{ background: g.hex }} />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-[22px] font-black leading-tight text-ink">{g.name}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-base font-bold text-ink-500">
                        {sizes.length > 0 && <span className="inline-flex items-center gap-1"><Ruler className="h-4 w-4" />{sizes.length}</span>}
                        <span className="inline-flex items-center gap-1"><Boxes className="h-4 w-4" />{left}</span>
                        {sold > 0 && <span className={`inline-flex items-center gap-1 ${red}`}><PackageX className="h-4 w-4" />{sold}</span>}
                        {!open && gp > 0 && <span className="inline-flex items-center gap-1"><Tag className="h-4 w-4" />{fmt(gp)}</span>}
                      </span>
                    </span>
                    {gMissing > 0 && <span className="inline-flex h-[34px] shrink-0 items-center gap-1 rounded-full bg-red-600 px-2.5 text-base font-black text-white dark:bg-red-500"><CircleAlert className="h-[18px] w-[18px]" />{gMissing}</span>}
                    <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[rgb(var(--surface-muted))] text-ink">{open ? <ChevronUp className="h-7 w-7" strokeWidth={2.8} /> : <ChevronDown className="h-7 w-7" strokeWidth={2.8} />}</span>
                  </button>
                )}
                {open && (
                  <>
                    {g.name && (
                      <div>
                        <p className={lab}><Tag className="h-5 w-5" /> {sizes.length ? `Price for all ${g.name}` : "Price"}</p>
                        <div className={`${fieldBox} ${showMissing && gMissing ? "!border-red-600 dark:!border-red-400" : ""}`}>
                          <span className="text-base font-extrabold text-ink-500">UGX</span>
                          <input value={groupPrices[g.name] ? fmt(digitsOf(groupPrices[g.name])) : ""} onChange={(e) => setGroupPrices((m) => ({ ...m, [g.name]: e.target.value }))} inputMode="numeric" placeholder={basePrice ? fmt(basePrice) : "0"} aria-label={`Price for all ${g.name}`} className={fieldInput} data-testid={`group-price-${g.name}`} />
                        </div>
                        {showMissing && gMissing > 0 && <p className={`mt-2 flex items-center gap-2 text-base font-bold ${red}`}><CircleAlert className="h-5 w-5" /> Add a price</p>}
                      </div>
                    )}
                    {sizes.length > 0 ? (
                      <>
                        <div className="grid grid-cols-[56px_minmax(0,1fr)_auto] gap-2.5 text-[17px] font-extrabold text-ink">
                          <span>Size</span><span>Price</span><span className="w-[142px]">Stock</span>
                        </div>
                        {gRows.map((r) => {
                          const st = stockOf(r.size, g.name);
                          const pr = price(r.size, g.name);
                          const isOwn = own(r.size, g.name);
                          const miss = showMissing && pr <= 0;
                          const name = [r.size, g.name].filter(Boolean).join(" · ");
                          return (
                            <div key={r.key} id={`vt-${r.key}`} className="grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-2.5" data-testid={`variant-row-${r.key}`}>
                              <button type="button" onClick={() => setEditing({ size: r.size, colour: g.name })} aria-label={`Edit ${name}`} className={`grid h-[60px] w-14 place-items-center rounded-2xl border-2 px-1 text-center text-[19px] font-black leading-none break-all ${st === 0 ? `border-red-600/35 bg-red-600/10 ${red}` : "border-transparent bg-[rgb(var(--surface-muted))] text-ink"}`}>{r.size}</button>
                              <button type="button" onClick={() => setEditing({ size: r.size, colour: g.name })} aria-label={`${name} price`} className={`flex h-[60px] min-w-0 items-center justify-center rounded-2xl border-2 px-1 text-[clamp(16px,4.7vw,20px)] font-extrabold ${miss ? `border-red-600 bg-red-600/10 dark:border-red-400 ${red}` : isOwn ? "border-gold bg-gold/15 font-black text-ink" : "border-dashed border-[var(--border-faint)] text-ink-500"}`} data-testid={`variant-price-${r.key}`}>
                                {miss ? <CircleAlert className="h-6 w-6" /> : fmt(pr)}
                              </button>
                              <BigStepper value={st} onChange={(n) => setStock(r.size, g.name, n)} label={name} danger={st === 0} compact />
                              {st === 0 && <p className={`col-span-3 -mt-1 flex items-center gap-2 text-base font-extrabold ${red}`}><PackageX className="h-5 w-5" /> Sold out</p>}
                            </div>
                          );
                        })}
                      </>
                    ) : (
                      <div className="flex items-end gap-2.5">
                        <div className="min-w-0 flex-1">
                          <p className={lab}><Boxes className="h-5 w-5" /> Stock</p>
                          <BigStepper value={stockOf("", g.name)} onChange={(n) => setStock("", g.name, n)} label={g.name} danger={stockOf("", g.name) === 0} />
                        </div>
                        <button type="button" onClick={() => setEditing({ size: "", colour: g.name })} aria-label={`More for ${g.name}`} className="grid h-[60px] w-14 shrink-0 place-items-center rounded-2xl bg-[rgb(var(--surface-muted))] text-ink"><Pencil className="h-6 w-6" /></button>
                      </div>
                    )}
                    {!sizes.length && stockOf("", g.name) === 0 && <p className={`flex items-center gap-2 text-base font-extrabold ${red}`}><PackageX className="h-5 w-5" /> Sold out</p>}
                  </>
                )}
              </div>
            );
          })}
          {sizes.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-[15px] font-bold text-ink-500">
              <span className="inline-flex items-center gap-2"><i className="h-5 w-6 rounded-md border-2 border-dashed border-[var(--border-faint)]" />{colours.length ? "Colour price" : "Main price"}</span>
              <span className="inline-flex items-center gap-2"><i className="h-5 w-6 rounded-md border-2 border-gold bg-gold/15" />Own price</span>
              <span className="inline-flex items-center gap-2"><i className="h-5 w-6 rounded-md border-2 border-red-600/50 bg-red-600/10" />Sold out</span>
            </div>
          )}
        </>
      ) : (
        <div className={`${card} space-y-3.5 p-3.5`} data-testid="variants-grid">
          <Seg wide value={gridMode} onChange={(v) => setGridMode(v as "stock" | "price")} options={[{ v: "stock", icon: <Boxes className="h-[22px] w-[22px]" />, label: "Stock" }, { v: "price", icon: <Tag className="h-[22px] w-[22px]" />, label: "Price" }]} testId="grid-mode" />
          <div className="-mx-1 overflow-x-auto px-1 pb-1" data-testid="variants-grid-scroll">
            <div className="grid items-center gap-2" style={{ gridTemplateColumns: `52px repeat(${groups.length}, minmax(84px, 1fr))`, minWidth: 52 + groups.length * 92 }}>
              <span />
              {groups.map((g) => (
                <div key={g.name || "all"} className="flex flex-col items-center gap-1.5 pb-0.5 text-center text-[15px] font-extrabold text-ink">
                  {g.name ? <i className="block h-10 w-10 rounded-xl border-[3px] border-white/90 shadow-[0_0_0_1.5px_rgba(0,0,0,0.25)]" style={{ background: g.hex }} /> : <Boxes className="h-8 w-8 text-ink-500" />}
                  <span className="break-words leading-tight">{g.name || (gridMode === "stock" ? "Stock" : "Price")}</span>
                </div>
              ))}
              {sizeList.map((s) => (
                <Row key={s || "one"}>
                  <span className="grid h-16 place-items-center rounded-2xl bg-[rgb(var(--surface-muted))] px-1 text-center text-[19px] font-black leading-none text-ink break-all">{s || "•"}</span>
                  {groups.map((g) => {
                    const st = stockOf(s, g.name);
                    const pr = price(s, g.name);
                    const name = [s, g.name].filter(Boolean).join(" · ");
                    const miss = pr <= 0;
                    return (
                      <button key={g.name || "all"} type="button" onClick={() => setEditing({ size: s, colour: g.name })} aria-label={`Edit ${name}`} data-testid={`grid-cell-${comboKey(s, g.name)}`}
                        className={`relative grid h-16 min-w-0 place-items-center rounded-2xl border-2 px-1 font-black ${gridMode === "price" ? "text-[clamp(14px,4vw,17px)]" : "text-[22px]"} ${
                          (gridMode === "stock" && st === 0) || (gridMode === "price" && miss && showMissing) ? `border-red-600/50 bg-red-600/10 ${red}` : "border-[var(--border-faint)] bg-[rgb(var(--surface-input))] text-ink"
                        }`}>
                        {gridMode === "stock" ? st : miss ? <CircleAlert className="h-6 w-6" /> : fmt(pr)}
                        {own(s, g.name) && <i className="absolute right-[7px] top-[7px] h-3 w-3 rounded-full bg-gold" />}
                      </button>
                    );
                  })}
                </Row>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-[15px] font-bold text-ink-500">
            <span className="inline-flex items-center gap-2"><i className="h-4 w-4 rounded-full bg-gold" />Own price</span>
            <span className="inline-flex items-center gap-2"><i className="h-5 w-6 rounded-md border-2 border-red-600/50 bg-red-600/10" />Sold out</span>
            <span className="inline-flex items-center gap-2"><Pencil className="h-[18px] w-[18px]" />Tap a box</span>
          </div>
        </div>
      )}

      {editing && <EditSheet {...p} size={editing.size} colour={editing.colour} onClose={() => setEditing(null)} />}
      {bulkOpen && <BulkSheet count={all.length} basePrice={basePrice} defaultStock={defaultStock} onApply={p.onApplyAll} onClose={() => setBulkOpen(false)} />}
    </section>
  );
}

function Row({ children }: { children: ReactNode }) { return <>{children}</>; }

function Seg({ value, onChange, options, wide = false, testId }: { value: string; onChange: (v: string) => void; options: { v: string; icon: ReactNode; label: string }[]; wide?: boolean; testId?: string }) {
  return (
    <div role="radiogroup" data-testid={testId} className={`grid grid-cols-2 gap-1 rounded-[18px] bg-black p-1 dark:border dark:border-white/10 dark:bg-[#000] ${wide ? "w-full" : ""}`}>
      {options.map((o) => (
        <button key={o.v} type="button" role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)}
          className={`flex min-h-[52px] min-w-[84px] items-center justify-center gap-1.5 rounded-[14px] px-3 text-[17px] font-extrabold ${value === o.v ? "bg-gold text-ink-gold" : "text-white"}`}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

/** Big − n + stepper (52px buttons); `compact` keeps it 142px wide for table rows. */
export function BigStepper({ value, onChange, label, danger = false, compact = false, dark = false }: { value: number; onChange: (n: number) => void; label: string; danger?: boolean; compact?: boolean; dark?: boolean }) {
  return (
    <div className={`field-box grid h-[60px] items-center rounded-2xl border-2 p-[3px] ${compact ? "w-[142px] grid-cols-[48px_1fr_48px]" : "w-full grid-cols-[52px_1fr_52px]"} ${
      dark ? "border-white/20 bg-[#1c1c1c]" : danger ? "border-red-600/50 bg-[rgb(var(--surface-input))]" : "border-[var(--border-faint)] bg-[rgb(var(--surface-input))]"}`}>
      <button type="button" onClick={() => onChange(Math.max(0, value - 1))} aria-label={`Less ${label}`} className={`grid h-[52px] place-items-center rounded-[13px] ${dark ? "bg-[#2c2c2c] text-white" : "bg-[rgb(var(--surface-muted))] text-ink"}`}><Minus className="h-6 w-6" strokeWidth={3} /></button>
      <input value={String(value)} onChange={(e) => onChange(digitsOf(e.target.value))} inputMode="numeric" aria-label={`Stock ${label}`}
        className={`w-full min-w-0 bg-transparent text-center text-[22px] font-black outline-none ${dark ? "text-white" : danger ? "text-red-600 dark:text-red-400" : "text-ink"}`} />
      <button type="button" onClick={() => onChange(value + 1)} aria-label={`More ${label}`} className="grid h-[52px] place-items-center rounded-[13px] bg-gold text-ink-gold"><Plus className="h-6 w-6" strokeWidth={3} /></button>
    </div>
  );
}

function Sheet({ children, onClose, label, testId }: { children: ReactNode; onClose: () => void; label: string; testId: string }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55" role="dialog" aria-modal="true" aria-label={label} onClick={onClose}>
      <div className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[32px] bg-[rgb(var(--surface-card))] shadow-[0_-12px_40px_rgba(0,0,0,0.35)] dark:border-t dark:border-gold/35 dark:bg-[rgb(20_20_20)]" onClick={(e) => e.stopPropagation()} data-testid={testId}>
        <div className="grid h-7 shrink-0 place-items-center"><i className="block h-1.5 w-14 rounded-full bg-ink-500/45" /></div>
        {children}
      </div>
    </div>
  );
}

function SheetHead({ tile, title, sub, onClose }: { tile: ReactNode; title: string; sub: string; onClose: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-3.5 px-4 pb-3.5">
      {tile}
      <div className="min-w-0 flex-1">
        <h3 className="break-words text-[26px] font-black leading-tight text-ink">{title}</h3>
        {sub && <p className="mt-0.5 break-words text-[17px] font-semibold text-ink-500">{sub}</p>}
      </div>
      <button type="button" onClick={onClose} aria-label="Close" className="grid h-14 w-14 shrink-0 place-items-center rounded-full border-[1.5px] border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] text-ink"><X className="h-7 w-7" strokeWidth={2.6} /></button>
    </div>
  );
}

function SheetFoot({ onClick, children, testId }: { onClick: () => void; children: ReactNode; testId: string }) {
  return (
    <div className="shrink-0 border-t border-[var(--border-faint)] px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-3">
      <button type="button" onClick={onClick} data-testid={testId} className="flex min-h-16 w-full items-center justify-center gap-2.5 rounded-full bg-gold text-xl font-black text-ink-gold shadow-[0_8px_22px_rgb(var(--gold)/0.35)]">{children}</button>
    </div>
  );
}

function EditSheet(p: Props & { size: string; colour: string; onClose: () => void }) {
  const { size, colour, rows, setRows, groupPrices, basePrice, defaultStock, onClose, colours } = p;
  const key = comboKey(size, colour);
  const row = rows[key] ?? { price: "", stock: defaultStock };
  const isOwn = digitsOf(row.price) > 0;
  const [ownMode, setOwnMode] = useState(isOwn);
  const [more, setMore] = useState(Boolean(row.was || row.sku || row.barcode || row.image));
  const [uploading, setUploading] = useState(false);
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  const hex = colours.find((c) => c.name === colour)?.hex ?? "";
  const inherited = digitsOf(groupPrices[colour]) || basePrice;
  const name = [colour, size].filter(Boolean).join(" · ");
  const patch = (x: Partial<VariantValues>) => setRows((m) => ({ ...m, [key]: { ...(m[key] ?? { price: "", stock: defaultStock }), ...x } }));
  const parentLabel = colours.length && size ? `${colour} price` : "Main price";

  async function addPhoto(list: FileList | null) {
    const f = list?.[0];
    if (!f) return;
    setUploading(true);
    const url = await p.uploadPhoto(f);
    setUploading(false);
    if (!url) return;
    // One photo per colour: fill every size of this colour that has none yet.
    setRows((m) => {
      const next = { ...m, [key]: { ...(m[key] ?? { price: "", stock: defaultStock }), image: url } };
      if (colour) for (const s of p.sizes) { const k = comboKey(s, colour); if (k !== key && !next[k]?.image) next[k] = { ...(next[k] ?? { price: "", stock: defaultStock }), image: url }; }
      return next;
    });
  }

  const tile = (
    <span className="grid h-[60px] min-w-[60px] shrink-0 place-items-center rounded-2xl border-2 border-white/85 px-1.5 text-[21px] font-black shadow-[0_0_0_1.5px_rgba(0,0,0,0.2)]" style={{ background: hex || "rgb(var(--gold))", color: hex ? inkOn(hex) : "#0a0a0a" }}>{size || <Tag className="h-7 w-7" />}</span>
  );

  return (
    <Sheet onClose={onClose} label={`Edit ${name}`} testId="variant-edit-sheet">
      <SheetHead tile={tile} title={name || "Variant"} sub={p.title} onClose={onClose} />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4 pt-1">
        <div>
          <p className={lab}>Price</p>
          <div className="grid grid-cols-2 gap-2.5">
            <button type="button" aria-pressed={!ownMode} onClick={() => { setOwnMode(false); patch({ price: "" }); }} className={`flex min-h-[60px] min-w-0 items-center justify-center gap-2 rounded-2xl border-2 px-2 text-[17px] font-extrabold text-ink ${!ownMode ? "border-gold bg-gold/15" : "border-[var(--border-faint)] bg-[rgb(var(--surface-card))]"}`}><Link2 className="h-[22px] w-[22px] shrink-0" /><span className="break-words">{parentLabel}</span></button>
            <button type="button" aria-pressed={ownMode} onClick={() => { setOwnMode(true); if (!isOwn && inherited) patch({ price: String(inherited) }); }} className={`flex min-h-[60px] min-w-0 items-center justify-center gap-2 rounded-2xl border-2 px-2 text-[17px] font-extrabold text-ink ${ownMode ? "border-gold bg-gold/15" : "border-[var(--border-faint)] bg-[rgb(var(--surface-card))]"}`} data-testid="edit-own-price"><Pencil className="h-[22px] w-[22px] shrink-0" />Own price</button>
          </div>
        </div>
        <div className={`${fieldBox} ${ownMode ? "" : "opacity-70"}`}>
          <span className="text-base font-extrabold text-ink-500">UGX</span>
          <input value={ownMode ? (row.price ? fmt(digitsOf(row.price)) : "") : inherited ? fmt(inherited) : ""} readOnly={!ownMode} onChange={(e) => patch({ price: e.target.value })} inputMode="numeric" placeholder="0" aria-label={`${name} price`} className={fieldInput} data-testid="edit-price" />
        </div>
        <div>
          <p className={lab}>Stock</p>
          <BigStepper value={row.stock} onChange={(n) => patch({ stock: n })} label={name} danger={row.stock === 0} />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <button type="button" onClick={() => patch({ stock: 0 })} className={`flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-[rgb(var(--surface-muted))] text-[17px] font-extrabold ${red}`} data-testid="edit-sold-out"><PackageX className="h-[22px] w-[22px]" />Sold out</button>
          <button type="button" onClick={() => { setOwnMode(false); setRows((m) => ({ ...m, [key]: { price: "", stock: defaultStock } })); }} className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-[rgb(var(--surface-muted))] text-[17px] font-extrabold text-ink"><RotateCcw className="h-[22px] w-[22px]" />Reset</button>
        </div>
        <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more} className="flex min-h-14 w-full items-center gap-2.5 rounded-2xl bg-[rgb(var(--surface-muted))] px-4 text-lg font-extrabold text-ink" data-testid="edit-more">
          {more ? <ChevronUp className="h-6 w-6" strokeWidth={2.8} /> : <ChevronDown className="h-6 w-6" strokeWidth={2.8} />} {more ? "Less" : "More"}
          <span className="ml-auto flex gap-2 text-ink-500"><Tag className="h-5 w-5" /><Barcode className="h-5 w-5" /><Camera className="h-5 w-5" /></span>
        </button>
        {more && (
          <>
            <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
              <div className="min-w-0">
                <p className={lab}>Was price</p>
                <div className={fieldBox}><span className="text-base font-extrabold text-ink-500">UGX</span><input value={row.was ? fmt(digitsOf(row.was)) : ""} onChange={(e) => patch({ was: e.target.value })} inputMode="numeric" placeholder="—" aria-label="Was price" className={fieldInput} data-testid="edit-was" /></div>
              </div>
              <div className="min-w-0">
                <p className={lab}>SKU</p>
                <div className={fieldBox}><input value={row.sku ?? ""} onChange={(e) => patch({ sku: e.target.value.slice(0, 40) })} aria-label="SKU" className={fieldInput} data-testid="edit-sku" /></div>
              </div>
            </div>
            <div>
              <p className={lab}>Barcode</p>
              <div className={fieldBox}><input value={row.barcode ?? ""} onChange={(e) => patch({ barcode: e.target.value.slice(0, 40) })} inputMode="numeric" placeholder="Type barcode" aria-label="Barcode" className={fieldInput} data-testid="edit-barcode" /></div>
            </div>
            <div>
              <p className={lab}>{colour ? "Photo of this colour" : "Photo"}</p>
              <div className="flex items-center gap-3">
                {row.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={row.image} alt="" className="h-[76px] w-[76px] shrink-0 rounded-2xl border border-[var(--border-faint)] object-cover" />
                ) : uploading ? <span className="grid h-[76px] w-[76px] shrink-0 place-items-center rounded-2xl bg-[rgb(var(--surface-muted))]"><Loader2 className="h-7 w-7 animate-spin text-gold" /></span> : null}
                <button type="button" onClick={() => camRef.current?.click()} className="flex min-h-[60px] min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl border-2 border-[var(--border-faint)] bg-[rgb(var(--surface-card))] text-lg font-extrabold text-ink"><Camera className="h-6 w-6 shrink-0" />Camera</button>
                <button type="button" onClick={() => galRef.current?.click()} className="flex min-h-[60px] min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl border-2 border-[var(--border-faint)] bg-[rgb(var(--surface-card))] text-lg font-extrabold text-ink"><ImageIcon className="h-6 w-6 shrink-0" />Gallery</button>
              </div>
              <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void addPhoto(e.target.files); e.target.value = ""; }} />
              <input ref={galRef} type="file" accept="image/*" hidden onChange={(e) => { void addPhoto(e.target.files); e.target.value = ""; }} />
            </div>
          </>
        )}
      </div>
      <SheetFoot onClick={onClose} testId="edit-done"><Check className="h-[26px] w-[26px]" strokeWidth={3} /> Done</SheetFoot>
    </Sheet>
  );
}

function BulkSheet({ count, basePrice, defaultStock, onApply, onClose }: { count: number; basePrice: number; defaultStock: number; onApply: (price: number | null, stock: number | null) => void; onClose: () => void }) {
  const [price, setPrice] = useState(basePrice ? String(basePrice) : "");
  const [stock, setStock] = useState(defaultStock);
  const [done, setDone] = useState<{ price?: boolean; stock?: boolean }>({});
  const applyBtn = "flex min-h-[60px] min-w-[104px] shrink-0 items-center justify-center gap-1.5 rounded-2xl bg-gold px-3 text-lg font-black text-ink-gold";
  return (
    <Sheet onClose={onClose} label="Same for all" testId="variant-bulk-sheet">
      <SheetHead tile={<span className="grid h-[60px] w-[60px] shrink-0 place-items-center rounded-2xl bg-gold text-ink-gold"><Copy className="h-7 w-7" /></span>} title={`Set all ${count}`} sub="" onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-1">
        <div className="space-y-4 rounded-3xl border-[1.5px] border-gold/40 bg-black p-4 text-white dark:bg-[#000]">
          <div>
            <p className="mb-2 text-[17px] font-extrabold">Same price for all</p>
            <div className="flex gap-2.5">
              <div className="field-box flex min-h-[60px] min-w-0 flex-1 items-center gap-2.5 rounded-2xl border-2 border-white/20 bg-[#1c1c1c] px-4 focus-within:border-gold">
                <span className="text-base font-extrabold text-white/60">UGX</span>
                <input value={price ? fmt(digitsOf(price)) : ""} onChange={(e) => { setPrice(e.target.value); setDone((d) => ({ ...d, price: false })); }} inputMode="numeric" placeholder="0" aria-label="Same price for all" className="min-h-14 w-full min-w-0 flex-1 bg-transparent text-[21px] font-extrabold text-white outline-none placeholder:text-white/45" data-testid="bulk-price" />
              </div>
              <button type="button" disabled={!digitsOf(price)} onClick={() => { onApply(digitsOf(price), null); setDone((d) => ({ ...d, price: true })); }} className={`${applyBtn} disabled:opacity-50`} data-testid="bulk-apply-price"><Check className="h-[22px] w-[22px]" strokeWidth={3} />{done.price ? "Done" : "Apply"}</button>
            </div>
          </div>
          <div>
            <p className="mb-2 text-[17px] font-extrabold">Same stock for all</p>
            <div className="flex gap-2.5">
              <div className="min-w-0 flex-1"><BigStepper value={stock} onChange={(n) => { setStock(n); setDone((d) => ({ ...d, stock: false })); }} label="all" dark /></div>
              <button type="button" onClick={() => { onApply(null, stock); setDone((d) => ({ ...d, stock: true })); }} className={applyBtn} data-testid="bulk-apply-stock"><Check className="h-[22px] w-[22px]" strokeWidth={3} />{done.stock ? "Done" : "Apply"}</button>
            </div>
          </div>
        </div>
      </div>
      <SheetFoot onClick={onClose} testId="bulk-done"><Check className="h-[26px] w-[26px]" strokeWidth={3} /> Done</SheetFoot>
    </Sheet>
  );
}
