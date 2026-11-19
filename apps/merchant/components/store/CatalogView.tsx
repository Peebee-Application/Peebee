"use client";

import { Check, Ellipsis, Eye, Flame, Grid3x3, Layers, LayoutList, ListFilter, Package, PackageOpen, PackageX, Pencil, Plus, Search, Star, X, Zap, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BottomSheet } from "./BottomSheet";
import { PageHeader, Seg, card, ghostBtn, goldBtn } from "./StoreUI";

export type CatalogProduct = {
  id: string;
  title: string;
  price: number;
  compare_at_price: number | null;
  inventory_quantity: number;
  category_name?: string | null;
  badge?: string | null;
  image_url: string | null;
  variants?: unknown[];
};

type View = "list" | "grid";
type StockFilter = "all" | "in" | "out";
const VIEW_KEY = "peebee_store_catalog_view";
const ALL = "__all__";
const fmt = (n: number) => Math.round(Number(n) || 0).toLocaleString("en-US");
export const categoryOf = (p: { category_name?: string | null }) => (p.category_name || "").trim() || "General";

/** Big "UGX 85,000" with a small grey currency. */
function Price({ p, stacked = false }: { p: CatalogProduct; stacked?: boolean }) {
  const sale = p.compare_at_price != null && p.compare_at_price > p.price;
  return (
    <div className="min-w-0 leading-tight">
      <span className="whitespace-nowrap text-[21px] font-black text-ink"><span className="mr-1 text-[15px] font-bold text-ink-500">UGX</span>{fmt(p.price)}</span>
      {sale && <span className={`${stacked ? "block" : "ml-2 inline-block"} whitespace-nowrap text-[15px] font-bold text-ink-500 line-through`}>{stacked ? "UGX " : ""}{fmt(p.compare_at_price!)}</span>}
    </div>
  );
}

function StockPill({ p }: { p: CatalogProduct }) {
  return p.inventory_quantity > 0 ? (
    <span className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full bg-[#16a34a]/15 px-3 text-[15px] font-extrabold text-[#15803d] dark:text-[#4ade80]">
      <Check className="h-4 w-4 shrink-0" strokeWidth={3} /> <span className="truncate">{p.inventory_quantity} in stock</span>
    </span>
  ) : (
    <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-red-600/12 px-3 text-[15px] font-extrabold text-red-600 dark:text-red-400">
      <PackageX className="h-4 w-4 shrink-0" /> Sold out
    </span>
  );
}

function Photo({ p, className }: { p: CatalogProduct; className: string }) {
  return p.image_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={p.image_url} alt="" className={`${className} object-cover`} />
  ) : (
    <span className={`${className} grid place-items-center bg-[rgb(var(--surface-muted))] text-ink-500`}><Package className="h-10 w-10" /></span>
  );
}

function Ribbon({ text }: { text: string }) {
  return (
    <span className="absolute -top-3 left-3 z-[2] inline-flex h-[30px] max-w-[calc(100%-24px)] items-center gap-1 rounded-full border-[3px] border-[rgb(var(--cream))] bg-gold px-2.5 text-[14px] font-black text-ink-gold">
      <Star className="h-3.5 w-3.5 shrink-0" strokeWidth={2.6} /><span className="truncate">{text}</span>
    </span>
  );
}

const actBtn = "flex min-h-[60px] min-w-0 items-center justify-center gap-2 rounded-[18px] bg-[rgb(var(--surface-muted))] px-2 text-[18px] font-black text-ink transition active:scale-95";
function PinButton({ on, onClick, title, size = 64 }: { on: boolean; onClick: () => void; title: string; size?: number }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} aria-label={on ? `Unpin ${title} from Live` : `Pin ${title} for Live`} data-testid="pin-live"
      style={{ width: size }}
      className={`grid min-h-[56px] shrink-0 place-items-center rounded-[18px] transition active:scale-95 ${on ? "bg-gold text-ink-gold" : "bg-[rgb(var(--surface-muted))] text-orange-600 dark:text-orange-400"}`}>
      <Flame className="h-6 w-6" />
    </button>
  );
}

export function CatalogView({
  products, pinnedId, onPin, onEdit, onVariations, onBack, onStarterPack, customerUrl, footer,
}: {
  products: CatalogProduct[];
  pinnedId: string;
  onPin: (p: CatalogProduct) => void;
  onEdit: (p: CatalogProduct) => void;
  onVariations: (p: CatalogProduct) => void;
  onBack: () => void;
  onStarterPack: () => void;
  /** Base address of the customer app, for "Preview in Buy". */
  customerUrl: string;
  footer?: ReactNode;
}) {
  const [view, setView] = useState<View>("list");
  const [cat, setCat] = useState(ALL);
  const [stock, setStock] = useState<StockFilter>("all");
  const [q, setQ] = useState("");
  const [catsOpen, setCatsOpen] = useState(false);
  const [more, setMore] = useState<CatalogProduct | null>(null);

  // Remember List or Grid on this phone.
  useEffect(() => {
    const t = setTimeout(() => {
      try { const v = localStorage.getItem(VIEW_KEY); if (v === "grid" || v === "list") setView(v); } catch { /* storage blocked */ }
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const pickView = (v: View) => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage blocked */ } };

  const cats = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products) m.set(categoryOf(p), (m.get(categoryOf(p)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [products]);
  const activeCat = cat === ALL || cats.some(([c]) => c === cat) ? cat : ALL;

  const inCat = products.filter((p) => activeCat === ALL || categoryOf(p) === activeCat);
  const needle = q.trim().toLowerCase();
  const shown = inCat.filter((p) => (stock === "all" || (stock === "in" ? p.inventory_quantity > 0 : p.inventory_quantity <= 0)) && (!needle || p.title.toLowerCase().includes(needle)));

  const addItem = (
    <Link href="/store/items/new" data-testid="add-item" className="flex min-h-[72px] items-center gap-3.5 rounded-[24px] bg-gold px-[18px] text-[21px] font-black text-ink-gold shadow-[0_10px_26px_rgb(var(--gold)/0.35)] transition active:scale-[.98]">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-black text-gold"><Plus className="h-7 w-7" strokeWidth={3} /></span>
      <span className="flex-1">Add item</span>
      <ChevronRight className="h-7 w-7" strokeWidth={3} />
    </Link>
  );

  if (products.length === 0) {
    return (
      <div className="space-y-4" data-testid="catalog">
        <PageHeader title="Catalog" count={0} onBack={onBack} />
        <div className={`${card} flex flex-col items-center gap-3 border-2 border-dashed px-5 py-8 text-center`} data-testid="catalog-empty">
          <span className="mb-1 grid h-[104px] w-[104px] place-items-center rounded-[32px] bg-gold/15 text-[#8a6d0b] dark:text-gold"><PackageOpen className="h-14 w-14" /></span>
          <h2 className="text-[25px] font-black text-ink">No items yet</h2>
          <p className="text-[18px] font-semibold text-ink-500">Add your first item to sell in Buy.</p>
          <Link href="/store/items/new" data-testid="add-item" className={`${goldBtn} min-h-[68px] text-[20px]`}><Plus className="h-7 w-7" strokeWidth={3} /> Add item</Link>
          <button type="button" onClick={onStarterPack} className={ghostBtn} data-testid="starter-pack"><Zap className="h-6 w-6" /> Starter pack</button>
        </div>
        {footer}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="catalog">
      <PageHeader title="Catalog" count={shown.length} onBack={onBack} />

      <div className="flex min-w-0 items-center gap-2.5">
      <label className="flex min-h-[60px] min-w-0 flex-1 items-center gap-2.5 rounded-full border-2 border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-4 focus-within:border-gold">
        <Search className="h-6 w-6 shrink-0 text-ink-500" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search items" data-testid="catalog-search"
          className="min-w-0 flex-1 bg-transparent text-[20px] font-semibold text-ink outline-none placeholder:text-ink-500" />
        {q && <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[rgb(var(--surface-muted))]"><X className="h-5 w-5" /></button>}
      </label>
        <Seg label="View" value={view} onChange={pickView} iconOnlyNarrow testId="catalog-view"
          options={[{ v: "list", icon: <LayoutList className="h-[22px] w-[22px]" />, label: "List", testId: "view-list" }, { v: "grid", icon: <Grid3x3 className="h-[22px] w-[22px]" />, label: "Grid", testId: "view-grid" }]} />
      </div>

      <div className="flex min-w-0 items-center gap-2.5">
        <button type="button" onClick={() => setCatsOpen(true)} aria-label="All categories" data-testid="categories-open"
          className="grid h-14 w-14 shrink-0 place-items-center rounded-[18px] bg-black text-gold dark:border-[1.5px] dark:border-gold/50 dark:bg-[#000]">
          <ListFilter className="h-7 w-7" strokeWidth={2.6} />
        </button>
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto py-0.5 pr-8 [-ms-overflow-style:none] [mask-image:linear-gradient(90deg,#000_calc(100%-44px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="radiogroup" aria-label="Category" data-testid="category-chips">
          {[[ALL, products.length] as [string, number], ...cats].map(([c, n]) => {
            const on = activeCat === c;
            return (
              <button key={c} type="button" role="radio" aria-checked={on} onClick={() => setCat(c)} data-testid={`cat-${c === ALL ? "all" : c}`}
                className={`flex h-14 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border-2 pl-[18px] pr-2 text-[18px] font-black ${on ? "border-gold bg-gold text-ink-gold" : "border-[var(--border-faint)] bg-[rgb(var(--surface-card))] text-ink"}`}>
                {c === ALL ? "All" : c}
                <span className={`grid h-[34px] min-w-[34px] place-items-center rounded-full px-2 text-[16px] ${on ? "bg-black text-gold" : "bg-[rgb(var(--surface-muted))]"}`}>{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      <Seg label="Stock" wide hideIconNarrow value={stock} onChange={setStock} testId="stock-filter"
        options={[{ v: "all", label: "All" }, { v: "in", icon: <Check className="h-[18px] w-[18px] shrink-0" strokeWidth={3} />, label: "In stock" }, { v: "out", icon: <PackageX className="h-[18px] w-[18px] shrink-0" />, label: "Sold out" }]} />

      {addItem}

      {shown.length === 0 ? (
        <div className={`${card} space-y-3 p-6 text-center`} data-testid="catalog-no-match">
          <p className="text-[19px] font-black text-ink">No items here</p>
          <button type="button" className={ghostBtn} onClick={() => { setCat(ALL); setStock("all"); setQ(""); }}>Show all items</button>
        </div>
      ) : view === "list" ? (
        <div className="space-y-5 pt-1" data-testid="catalog-list">
          {shown.map((p) => {
            const nVar = p.variants?.length ?? 0;
            const sale = p.compare_at_price != null && p.compare_at_price > p.price;
            return (
              <div key={p.id} className={`${card} relative flex flex-col gap-3.5 p-3.5`} data-testid={`product-${p.id}`}>
                {p.badge && <Ribbon text={p.badge} />}
                {sale && <span className="absolute -top-3 right-4 z-[2] inline-flex h-[30px] items-center rounded-full border-[3px] border-[rgb(var(--cream))] bg-red-600 px-3 text-[14px] font-black text-white">Sale</span>}
                <div className="flex min-w-0 gap-3.5">
                  <Photo p={p} className={`h-[104px] w-[104px] shrink-0 rounded-[20px] ${p.inventory_quantity > 0 ? "" : "opacity-70 grayscale-[.7]"}`} />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <h3 className="break-words text-[20px] font-black leading-tight text-ink">{p.title}</h3>
                    <Price p={p} />
                    <div className="flex flex-wrap gap-1.5">
                      <StockPill p={p} />
                      {nVar > 0 && <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-[rgb(var(--surface-muted))] px-3 text-[15px] font-extrabold text-ink"><Layers className="h-4 w-4" /> {nVar}</span>}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_64px] gap-2.5">
                  <button type="button" className={actBtn} onClick={() => onEdit(p)} data-testid="edit-item"><Pencil className="hidden h-[22px] w-[22px] shrink-0 min-[400px]:block" /> Edit</button>
                  <button type="button" className={actBtn} onClick={() => onVariations(p)} data-testid="open-variations"><Layers className="hidden h-[22px] w-[22px] shrink-0 min-[400px]:block" /> <span className="truncate">Variations</span></button>
                  <PinButton on={pinnedId === p.id} onClick={() => onPin(p)} title={p.title} />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-2.5 gap-y-5 pt-2" data-testid="catalog-grid">
          {shown.map((p) => {
            const nVar = p.variants?.length ?? 0;
            const sale = p.compare_at_price != null && p.compare_at_price > p.price;
            return (
              <div key={p.id} className={`${card} relative flex min-w-0 flex-col gap-2 !rounded-[24px] p-2.5`} data-testid={`grid-${p.id}`}>
                {p.badge && <Ribbon text={p.badge} />}
                <div className="relative">
                  <Photo p={p} className={`block aspect-square w-full rounded-[18px] ${p.inventory_quantity > 0 ? "" : "opacity-70 grayscale-[.7]"}`} />
                  {sale && <span className="absolute bottom-2 left-2 inline-flex h-[30px] items-center rounded-full bg-red-600 px-2.5 text-[15px] font-black text-white">Sale</span>}
                  {nVar > 0 && <span className="absolute bottom-2 right-2 inline-flex h-[30px] items-center gap-1 rounded-full bg-black/75 px-2.5 text-[15px] font-black text-white"><Layers className="h-4 w-4" />{nVar}</span>}
                </div>
                <h3 className="break-words px-0.5 text-[18px] font-black leading-tight text-ink">{p.title}</h3>
                <div className="px-0.5"><Price p={p} stacked /></div>
                <div className="min-w-0"><StockPill p={p} /></div>
                <div className="flex-1" />
                <div className="grid grid-cols-[minmax(0,1fr)_56px] gap-2">
                  <button type="button" className={`${actBtn} !min-h-[56px] !text-[17px]`} onClick={() => setMore(p)} aria-label={`More for ${p.title}`} data-testid="item-more"><Ellipsis className="h-[22px] w-[22px] shrink-0" strokeWidth={2.8} /> More</button>
                  <PinButton on={pinnedId === p.id} onClick={() => onPin(p)} title={p.title} size={56} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {footer}

      {catsOpen && (
        <BottomSheet title="Categories" subtitle="From each item's category" onClose={() => setCatsOpen(false)} testId="categories-sheet"
          footer={<button type="button" className={`${goldBtn} min-h-16 text-[20px]`} onClick={() => setCatsOpen(false)} data-testid="categories-done">Show {inCat.length} item{inCat.length === 1 ? "" : "s"}</button>}>
          <div className="space-y-2.5 pt-1" role="radiogroup" aria-label="Category">
            {[[ALL, products.length] as [string, number], ...cats].map(([c, n]) => {
              const on = activeCat === c;
              return (
                <button key={c} type="button" role="radio" aria-checked={on} onClick={() => setCat(c)} data-testid={`cat-row-${c === ALL ? "all" : c}`}
                  className={`flex min-h-[68px] w-full items-center gap-3.5 rounded-[20px] border-2 px-4 text-left text-[20px] font-black ${on ? "border-gold bg-gold/12" : "border-[var(--border-faint)] bg-[rgb(var(--surface-card))]"} text-ink`}>
                  <span className="min-w-0 flex-1 break-words">{c === ALL ? "All items" : c}</span>
                  <span className={`grid h-9 min-w-10 place-items-center rounded-full px-2.5 text-[17px] ${on ? "bg-gold text-ink-gold" : "bg-[rgb(var(--surface-muted))]"}`}>{n}</span>
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border-[2.5px] ${on ? "border-gold bg-gold text-ink-gold" : "border-[var(--border-faint)]"}`}>{on && <Check className="h-5 w-5" strokeWidth={3.2} />}</span>
                </button>
              );
            })}
          </div>
        </BottomSheet>
      )}

      {more && (
        <BottomSheet title={more.title} subtitle={`UGX ${fmt(more.price)} · ${more.inventory_quantity > 0 ? `${more.inventory_quantity} in stock` : "Sold out"}`} imageUrl={more.image_url} onClose={() => setMore(null)} testId="item-more-sheet">
          <div className="space-y-2.5 pt-1">
            {[
              { icon: Pencil, t: "Edit item", s: "Name, price, photos", go: () => onEdit(more), id: "more-edit" },
              { icon: Layers, t: "Variations", s: (more.variants?.length ?? 0) > 0 ? `${more.variants!.length} sizes & colours` : "Sizes & colours", go: () => onVariations(more), id: "more-variations" },
              { icon: Flame, t: pinnedId === more.id ? "Pinned for Live" : "Pin for Live", s: pinnedId === more.id ? "Tap to unpin" : "Show it first on Live", go: () => onPin(more), id: "more-pin", gold: pinnedId === more.id },
            ].map((a) => (
              <button key={a.id} type="button" data-testid={a.id} onClick={() => { const fn = a.go; setMore(null); window.setTimeout(fn, 320); }}
                className="flex min-h-[72px] w-full items-center gap-3.5 rounded-[20px] border-2 border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3 text-left">
                <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-[15px] ${a.gold ? "bg-gold text-ink-gold" : "bg-[rgb(var(--surface-muted))] text-ink"}`}><a.icon className="h-6 w-6" /></span>
                <span className="min-w-0 flex-1"><span className="block text-[20px] font-black text-ink">{a.t}</span><span className="block text-[16px] font-semibold text-ink-500">{a.s}</span></span>
                <ChevronRight className="h-6 w-6 shrink-0 text-ink-500" strokeWidth={2.8} />
              </button>
            ))}
            <a href={`${customerUrl}/product/${more.id}`} target="_blank" rel="noreferrer" data-testid="more-preview"
              className="flex min-h-[72px] w-full items-center gap-3.5 rounded-[20px] border-2 border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3 text-left">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[15px] bg-[rgb(var(--surface-muted))] text-ink"><Eye className="h-6 w-6" /></span>
              <span className="min-w-0 flex-1"><span className="block text-[20px] font-black text-ink">Preview in Buy</span><span className="block text-[16px] font-semibold text-ink-500">See what buyers see</span></span>
              <ChevronRight className="h-6 w-6 shrink-0 text-ink-500" strokeWidth={2.8} />
            </a>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}
