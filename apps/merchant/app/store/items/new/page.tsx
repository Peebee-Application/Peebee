"use client";

import {
  ArrowRight, Bike, Box, Building2, CalendarCheck, Camera, Check, ChevronRight, Clock, Copy, Crown, Download, Eye, FilePen, FileUp, Globe,
  ImagePlus, Images, KeyRound, Layers, Link2, Loader2, Lock, MapPin, Minus, Moon, Package, PackageOpen, Pencil, Plus, RotateCcw, Rocket,
  ShoppingBag, Star, Sun, Tag, Truck, Video, X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage, merchantRequest } from "../../../../lib/api";
import { call, uploadStoreMedia, ugx } from "../../../../lib/plans";
import { BottomBar, ChoiceTile, ErrorNote, FlowTop, GhostButton, PrimaryButton, Stepper, Toggle } from "../../../../components/flow/Flow";
import { VoiceButton } from "../../../../components/items/VoiceButton";
import { CustomerPreview, type PreviewItem } from "../../../../components/items/CustomerPreview";
import { VariantTable, combos, effectivePrice, type VariantValues } from "../../../../components/items/VariantTable";

type ItemType = "physical" | "digital" | "service";
type Photo = { url: string; uploading?: boolean; local?: string };
type Outlet = { id: string; name: string; on: boolean; qty: number };
type StoreInfo = { id: string; name: string; slug: string; phone?: string | null; isElite: boolean; digitalOn: boolean };
type ExistingProduct = { id: string; title: string; description?: string; price: number; compare_at_price?: number | null; image_url?: string; images_json?: string | null; category_name?: string; badge?: string; inventory_quantity?: number; variants?: { title?: string; price: number; inventory_quantity?: number; option1_value?: string | null; option2_value?: string | null }[]; options?: { name: string; values: { value: string; hex?: string }[] }[] };

const STEPS = [
  { icon: Layers, label: "Type" },
  { icon: Pencil, label: "Details" },
  { icon: Camera, label: "Photos" },
  { icon: Tag, label: "Price & stock" },
  { icon: Truck, label: "Delivery" },
  { icon: Eye, label: "Preview" },
  { icon: Rocket, label: "Publish" },
];
const CATEGORIES: Record<ItemType, string[]> = {
  physical: ["Clothes", "Shoes", "Phones", "Beauty", "Home", "Food"],
  digital: ["Ebook", "Music", "Software", "Template", "Course"],
  service: ["Beauty", "Repairs", "Lessons", "Health", "Events", "Consulting"],
};
const SERVICE_CATEGORY: Record<string, string> = { Beauty: "beauty_salon", Repairs: "home_trades", Lessons: "education_coaching", Health: "health_wellness", Events: "events_hospitality", Consulting: "consultation" };
const BADGES = ["New", "Best seller", "Local", "Sale"];
const COLOURS = [
  { name: "Black", hex: "#111111" }, { name: "White", hex: "#ffffff" }, { name: "Red", hex: "#d92d20" }, { name: "Blue", hex: "#2563eb" },
  { name: "Green", hex: "#16a34a" }, { name: "Gold", hex: "#c9a227" }, { name: "Brown", hex: "#8b5a2b" }, { name: "Grey", hex: "#9ca3af" },
];
const SIZE_SETS: Record<string, string[]> = { Shoes: ["39", "40", "41", "42", "43", "44"], Clothes: ["S", "M", "L", "XL"] };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const chipCls = (on: boolean) =>
  `inline-flex min-h-12 items-center gap-2 rounded-full px-4 text-base font-bold ${on ? "bg-gold text-ink-gold" : "bg-[rgb(var(--surface-muted))] text-ink"}`;
const label = "mb-2 flex items-center gap-1.5 text-sm font-bold text-ink-500";
const field = "w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] text-lg text-ink outline-none focus:border-gold";

function digits(v: string) { return Number(v.replace(/\D/g, "")) || 0; }

export default function NewItemWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [limits, setLimits] = useState({ photos: 8, imageMb: 8, videoMb: 60 });
  const [existing, setExisting] = useState<ExistingProduct[]>([]);
  const [copyOpen, setCopyOpen] = useState(false);

  const [type, setType] = useState<ItemType | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [badge, setBadge] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [video, setVideo] = useState<Photo | null>(null);

  const [price, setPrice] = useState("");
  const [was, setWas] = useState("");
  const [cost, setCost] = useState("");
  const [stock, setStock] = useState(10);
  const [sizes, setSizes] = useState<string[]>([]);
  const [sizeDraft, setSizeDraft] = useState("");
  const [colours, setColours] = useState<{ name: string; hex: string }[]>([]);
  const [rows, setRows] = useState<Record<string, VariantValues>>({});
  const [groupPrices, setGroupPrices] = useState<Record<string, string>>({});
  const [showMissing, setShowMissing] = useState(false);

  const [digitalMode, setDigitalMode] = useState<"file" | "link" | "keys">("file");
  const [digitalFile, setDigitalFile] = useState<File | null>(null);
  const [digitalLink, setDigitalLink] = useState("");
  const [digitalKeys, setDigitalKeys] = useState("");

  const [duration, setDuration] = useState(60);
  const [location, setLocation] = useState<"in_facility" | "client_site" | "virtual">("in_facility");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [openAt, setOpenAt] = useState("09:00");
  const [closeAt, setCloseAt] = useState("17:00");

  const [rider, setRider] = useState(true);
  const [pickup, setPickup] = useState(true);
  const [size, setSize] = useState<"small" | "medium" | "large">("medium");
  const [readyIn, setReadyIn] = useState<"now" | "1h" | "same_day" | "2_days">("now");
  const [returnsDays, setReturnsDays] = useState(7);

  const [previewDark, setPreviewDark] = useState(false);
  const [inApp, setInApp] = useState(true);
  const [onWeb, setOnWeb] = useState(true);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [live, setLive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await merchantRequest<{ store: { id: string; name: string; slug: string; phone?: string; plan?: { isElite: boolean } } | null; settings?: { eliteDigitalProductsEnabled?: boolean } }>("/merchants/me/store");
        if (!res.store) { router.replace("/store"); return; }
        const isElite = Boolean(res.store.plan?.isElite);
        setStore({ id: res.store.id, name: res.store.name, slug: res.store.slug, phone: res.store.phone, isElite, digitalOn: res.settings?.eliteDigitalProductsEnabled !== false });
        if (isElite) {
          merchantRequest<{ outlets: { id: string; name: string; status?: string }[] }>("/merchants/me/outlet-inventory")
            .then((o) => setOutlets(o.outlets.filter((x) => x.status !== "inactive").map((x, i) => ({ id: x.id, name: x.name, on: i === 0, qty: 0 }))))
            .catch(() => undefined);
        }
      } catch (e) {
        setError(errorMessage(e));
      }
      const lim = await call<{ photos: number; imageMb: number; videoMb: number }>("/merchants/me/store/media-limits");
      if (lim.ok) setLimits(lim.data);
      merchantRequest<{ products: ExistingProduct[] }>("/merchants/me/products").then((p) => setExisting(p.products)).catch(() => undefined);
    })();
  }, [router]);

  const variantRows = useMemo(() => combos(sizes, colours), [sizes, colours]);

  const elite = Boolean(store?.isElite);
  const outletMode = type === "physical" && elite && outlets.length > 0 && outlets.some((o) => o.on);
  const priceNum = digits(price);
  const wasNum = digits(was) || null;
  const costNum = digits(cost);
  const hasVariantTable = type === "physical" && variantRows.length > 0;
  const variantPrice = (size: string, colour: string) => effectivePrice(rows, groupPrices, priceNum, size, colour);
  const missingPrices = hasVariantTable ? variantRows.filter((r) => variantPrice(r.size, r.colour) <= 0).length : 0;
  // With variants the main price can be left empty when every variant has one; the item then shows "from" the lowest.
  const productPrice = priceNum || (hasVariantTable && !missingPrices ? Math.min(...variantRows.map((r) => variantPrice(r.size, r.colour))) : 0);

  // ---- media ----
  async function addFiles(list: FileList | null) {
    if (!list) return;
    setError("");
    const room = Math.max(0, limits.photos - photos.length);
    const files = Array.from(list).slice(0, room);
    if (list.length > room) setError(`Up to ${limits.photos} photos.`);
    for (const file of files) {
      const local = URL.createObjectURL(file);
      setPhotos((p) => [...p, { url: "", local, uploading: true }]);
      const res = await uploadStoreMedia(file);
      setPhotos((p) => (res.ok ? p.map((x) => (x.local === local ? { url: res.data.url, local } : x)) : p.filter((x) => x.local !== local)));
      if (!res.ok) setError(res.message);
    }
  }
  async function addVideo(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    setError("");
    const local = URL.createObjectURL(file);
    setVideo({ url: "", local, uploading: true });
    const res = await uploadStoreMedia(file);
    if (res.ok) setVideo({ url: res.data.url, local });
    else { setVideo(null); setError(res.message); }
  }
  const makeCover = (i: number) => setPhotos((p) => [p[i], ...p.filter((_, j) => j !== i)]);

  // ---- copy an item ----
  function copyFrom(p: ExistingProduct) {
    setType("physical");
    setTitle(`${p.title} (copy)`.slice(0, 120));
    setDescription(p.description ?? "");
    setCategory(p.category_name && p.category_name !== "General" ? p.category_name : "");
    setBadge(p.badge ?? "");
    let imgs: string[] = [];
    try { imgs = p.images_json ? (JSON.parse(p.images_json) as string[]) : []; } catch { imgs = []; }
    if (!imgs.length && p.image_url) imgs = [p.image_url];
    setPhotos(imgs.filter((u) => /^https?:\/\//.test(u)).map((url) => ({ url })));
    setPrice(String(p.price || ""));
    setWas(p.compare_at_price ? String(p.compare_at_price) : "");
    setStock(p.inventory_quantity ?? 10);
    const sizeOpt = p.options?.find((o) => /size/i.test(o.name));
    const colOpt = p.options?.find((o) => /colou?r/i.test(o.name));
    setSizes(sizeOpt?.values.map((v) => v.value) ?? []);
    setColours(colOpt?.values.map((v) => ({ name: v.value, hex: v.hex ?? COLOURS.find((c) => c.name === v.value)?.hex ?? "#999999" })) ?? []);
    setCopyOpen(false);
    setStep(1);
  }

  // ---- validation per step ----
  function canNext(): string | null {
    if (step === 0) return type ? null : "Pick a type.";
    if (step === 1) return title.trim().length >= 2 ? null : "Add a name.";
    if (step === 2) return photos.some((p) => p.uploading) || video?.uploading ? "Wait for uploads." : null;
    if (step === 3) {
      if (type === "service") return priceNum >= 0 && days.length ? null : "Pick days.";
      if (hasVariantTable && missingPrices) return "missing-variant-prices";
      if (productPrice <= 0) return "Add a price.";
      if (type === "digital" && digitalMode === "link" && !/^https:\/\//.test(digitalLink)) return "Add an https link.";
      if (type === "digital" && digitalMode === "keys" && !digitalKeys.trim()) return "Add keys.";
      if (type === "digital" && digitalMode === "file" && !digitalFile) return "Add the file.";
      return null;
    }
    if (step === 4) return type !== "physical" || rider || pickup ? null : "Pick rider or pickup.";
    return null;
  }

  function next() {
    const problem = canNext();
    if (problem === "missing-variant-prices") {
      setShowMissing(true);
      setError("");
      setTimeout(() => document.querySelector('[data-testid="variants-missing"]')?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
      return;
    }
    if (problem) { setError(problem); return; }
    setError("");
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
    window.scrollTo({ top: 0 });
  }
  function back() {
    setError("");
    if (step === 0) router.push("/store");
    else setStep((s) => s - 1);
  }

  const finalCategory = (customCategory.trim() || category || "General").slice(0, 60);

  const preview: PreviewItem = {
    type: type ?? "physical", title, description, category: finalCategory === "General" ? "" : finalCategory, badge,
    images: photos.filter((p) => p.url || p.local).map((p) => p.url || p.local!), price: productPrice, was: wasNum, storeName: store?.name ?? "",
    sizes, colours, delivery: { rider, pickup, readyIn, returnsDays }, digitalKind: digitalMode, duration, location,
  };

  // ---- publish ----
  async function publish() {
    if (!store || !type) return;
    setBusy(true);
    setError("");
    const images = photos.map((p) => p.url).filter(Boolean);
    try {
      let summary: Record<string, unknown> = { type, title, price: type === "physical" ? productPrice : priceNum, image: images[0] ?? "", storeSlug: store.slug, inApp, onWeb, live };
      if (type === "physical") {
        const hasVariants = variantRows.length > 0;
        const options = [
          ...(sizes.length ? [{ name: "Size", values: sizes.map((value) => ({ value })) }] : []),
          ...(colours.length ? [{ name: "Colour", display: "swatch" as const, values: colours.map((c) => ({ value: c.name, hex: c.hex })) }] : []),
        ];
        const body = {
          title: title.trim(), description: description.trim(), category_name: finalCategory, badge, images,
          video_url: video?.url ?? "", price: productPrice, compare_at_price: wasNum && wasNum > productPrice ? wasNum : null,
          ...(costNum ? { cost_price: costNum } : {}),
          inventory_quantity: stock,
          ...(hasVariants ? {
            options,
            variants: variantRows.map((r) => {
              const v = rows[r.key];
              const vPrice = variantPrice(r.size, r.colour);
              const vWas = digits(v?.was ?? "");
              return {
                values: [r.size, r.colour].filter(Boolean),
                price: vPrice,
                inventory_quantity: v?.stock ?? stock,
                ...(vWas > vPrice ? { compare_at_price: vWas } : {}),
                ...(v?.sku?.trim() ? { sku: v.sku.trim() } : {}),
                ...(v?.barcode?.trim() ? { barcode: v.barcode.trim() } : {}),
                ...(v?.image ? { image_url: v.image } : {}),
              };
            }),
          } : {}),
          ...(outletMode ? { outlets: outlets.filter((o) => o.on).map((o) => ({ outletId: o.id, quantity: o.qty })) } : {}),
          delivery: { delivery: rider, pickup, sameDay: readyIn !== "2_days", readyInDays: readyIn === "2_days" ? 2 : 0, readyIn, size, returnsDays },
          show_in_app: inApp, show_on_web: onWeb, status: live ? "active" : "draft",
        };
        const res = await call<{ productId: string; storeSlug: string }>("/merchants/me/store/items", "POST", body);
        if (!res.ok) {
          setError(res.message);
          if (res.data.upgrade) setTimeout(() => router.push("/store/plans?tier=elite"), 1500);
          return;
        }
        summary = { ...summary, productId: res.data.productId, outlets: outletMode ? outlets.filter((o) => o.on).length : 0 };
      } else if (type === "digital") {
        const kind = digitalMode === "keys" ? "license_key" : finalCategory === "Template" ? "template" : "download";
        const created = await api.createMerchantDigitalProduct({
          title: title.trim(), kind, description: description.trim(), price_ugx: priceNum,
          compare_at_price_ugx: wasNum && wasNum > priceNum ? wasNum : null,
          cover_image_url: images[0] ?? "",
          ...(digitalMode === "link" ? { file_url: digitalLink.trim() } : {}),
          ...(digitalMode === "keys" ? { license_keys_pool: digitalKeys.split(/\s*\n\s*/).map((k) => k.trim()).filter(Boolean) } : {}),
          status: live ? "published" : "draft",
        } as never);
        if (digitalMode === "file" && digitalFile) await api.uploadMerchantDigitalFile(created.product.id, digitalFile);
        summary = { ...summary, productId: created.product.id, inApp: true, onWeb: false };
      } else {
        let biz = await call<{ business: { slug: string; status: string } | null }>("/services-platform/my-business");
        if (biz.ok && !biz.data.business) {
          const made = await call<{ business: { slug: string; status: string } }>("/services-platform/my-business", "POST", {
            name: store.name, category: SERVICE_CATEGORY[category] ?? "consultation", phone: store.phone || "", description: "",
          });
          if (!made.ok) { setError(made.message); return; }
          biz = { ok: true, status: 200, data: { business: made.data.business } };
        }
        if (!biz.ok) { setError(biz.message); return; }
        const offering = await call<{ offering: { id: string } }>("/services-platform/offerings", "POST", {
          title: title.trim(), category: finalCategory.toLowerCase(), description: description.trim(), pricing_type: priceNum > 0 ? "fixed" : "custom_quote",
          price_ugx: priceNum, compare_at_price_ugx: wasNum && wasNum > priceNum ? wasNum : null, duration_minutes: duration, buffer_minutes: 15,
          location_type: location, image_url: images[0] ?? "",
        });
        if (!offering.ok) { setError(offering.message); return; }
        await call("/services-platform/hours", "PUT", { hours: days.sort().map((weekday) => ({ weekday, open_time: openAt, close_time: closeAt })) });
        const slug = biz.data.business?.slug ?? "";
        summary = { ...summary, productId: offering.data.offering.id, bookingUrl: slug ? `https://peebee.online/services/${slug}` : "", pending: biz.data.business?.status === "pending_review", inApp: true, onWeb: true };
      }
      sessionStorage.setItem("peebee_last_item", JSON.stringify(summary));
      router.replace("/store/items/live");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const stepTitle = step === 0 ? "New item" : STEPS[step].label;

  return (
    <div className="mx-auto max-w-md pb-48">
      <FlowTop title={stepTitle} onBack={step > 0 ? back : undefined} onClose={() => router.push("/store")} />
      <Stepper steps={STEPS} current={step} onJump={(i) => setStep(i)} />

      {/* 1. Type */}
      {step === 0 && (
        <div className="space-y-3 px-4 pt-5">
          {([
            { t: "physical" as const, icon: Package, name: "Physical", sub: [ShoppingBag, Truck, Box] },
            { t: "digital" as const, icon: Download, name: "Digital", sub: [FileUp, KeyRound, Link2] },
            { t: "service" as const, icon: CalendarCheck, name: "Service", sub: [Clock, MapPin, Video] },
          ]).map(({ t, icon: Icon, name, sub }) => {
            const locked = t === "digital" && (!elite || !store?.digitalOn);
            return (
              <ChoiceTile
                key={t}
                testId={`type-${t}`}
                selected={type === t}
                onClick={() => (locked ? router.push("/store/plans?tier=elite") : setType(t))}
                className="flex min-h-[96px] items-center gap-4 p-4"
              >
                {locked && <span className="absolute -top-2.5 right-4 inline-flex h-7 items-center gap-1 rounded-full bg-gold px-2.5 text-xs font-black text-ink-gold"><Crown className="h-3.5 w-3.5" /> Elite</span>}
                <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${type === t ? "bg-gold text-ink-gold" : "bg-[rgb(var(--surface-muted))] text-ink"}`}>
                  <Icon className="h-7 w-7" />
                </span>
                <span className="flex-1">
                  <span className="block text-xl font-black text-ink">{name}</span>
                  <span className="mt-1 flex gap-2 text-ink-500">{sub.map((S, i) => <S key={i} className="h-4 w-4" />)}</span>
                </span>
                {locked ? <Lock className="h-6 w-6 text-gold" /> : (
                  <span className={`flex h-7 w-7 items-center justify-center rounded-full border-2 ${type === t ? "border-gold bg-gold" : "border-[var(--border-faint)]"}`}>{type === t && <Check className="h-4 w-4 text-black" />}</span>
                )}
              </ChoiceTile>
            );
          })}
          <button type="button" onClick={() => setCopyOpen(true)} disabled={!existing.length} className="flex min-h-16 w-full items-center gap-3 rounded-3xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-4 text-lg font-bold text-ink disabled:opacity-50" data-testid="copy-item">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold/15 text-gold"><Copy className="h-5 w-5" /></span>
            <span className="flex-1 text-left">Copy an item</span>
            <ChevronRight className="h-5 w-5 text-ink-500" />
          </button>
        </div>
      )}

      {/* 2. Details */}
      {step === 1 && (
        <div className="space-y-5 px-4 pt-5">
          <div>
            <p className={label}>Name</p>
            <div className="field-box flex items-center gap-1 rounded-2xl border-2 border-gold/60 bg-[rgb(var(--surface-input))] pl-4 pr-1">
              <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 120))} placeholder="e.g. Canvas sneakers" className="min-h-14 min-w-0 flex-1 bg-transparent text-lg font-bold text-ink outline-none" data-testid="item-title" aria-label="Name" />
              <VoiceButton label="Say the name" onText={(t) => setTitle((v) => (v ? `${v} ${t}` : t).slice(0, 120))} />
            </div>
          </div>
          <div>
            <p className={label}>Category</p>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES[type ?? "physical"].map((c) => (
                <button key={c} type="button" onClick={() => { setCategory(c); setCustomCategory(""); if (SIZE_SETS[c] && !sizes.length) setSizes([]); }} className={chipCls(category === c && !customCategory)}>{c}</button>
              ))}
              <input value={customCategory} onChange={(e) => setCustomCategory(e.target.value.slice(0, 60))} placeholder="+ New" aria-label="New category" className="min-h-12 w-28 rounded-full border-2 border-dashed border-[var(--border-faint)] bg-transparent !px-4 text-base font-bold text-ink outline-none focus:border-gold" />
            </div>
          </div>
          <div>
            <p className={label}>About</p>
            <div className="field-box flex items-start gap-1 rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] pl-4 pr-1 pt-1">
              <textarea value={description} onChange={(e) => setDescription(e.target.value.slice(0, 2000))} rows={4} placeholder="Short description" className="min-w-0 flex-1 resize-none bg-transparent py-3 text-base text-ink outline-none" aria-label="About" />
              <VoiceButton label="Say the description" onText={(t) => setDescription((v) => (v ? `${v} ${t}` : t).slice(0, 2000))} />
            </div>
          </div>
          {type !== "service" && (
            <div>
              <p className={label}>Badge</p>
              <div className="flex flex-wrap gap-2">
                {BADGES.map((b) => (
                  <button key={b} type="button" onClick={() => setBadge(badge === b ? "" : b)} className={chipCls(badge === b)}>{b === "Best seller" && <Star className="h-4 w-4" />}{b}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3. Photos */}
      {step === 2 && (
        <div className="space-y-4 px-4 pt-5">
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => cameraRef.current?.click()} className="flex min-h-[88px] flex-col items-center justify-center gap-2 rounded-3xl bg-gold text-lg font-black text-ink-gold" data-testid="photo-camera">
              <Camera className="h-7 w-7" /> Camera
            </button>
            <button type="button" onClick={() => galleryRef.current?.click()} className="flex min-h-[88px] flex-col items-center justify-center gap-2 rounded-3xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] text-lg font-black text-ink" data-testid="photo-gallery">
              <Images className="h-7 w-7" /> Gallery
            </button>
          </div>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} data-testid="camera-input" />
          <input ref={galleryRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} data-testid="gallery-input" />
          <input ref={videoRef} type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden" onChange={(e) => { void addVideo(e.target.files); e.target.value = ""; }} data-testid="video-input" />

          <div className="grid grid-cols-3 gap-3 pt-2">
            {photos.map((p, i) => (
              <div key={p.local ?? p.url} className="relative aspect-square">
                <button type="button" onClick={() => makeCover(i)} aria-label={i === 0 ? "Cover photo" : "Make cover"} className="h-full w-full overflow-hidden rounded-2xl bg-[rgb(var(--surface-muted))]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.local ?? p.url} alt="" className="h-full w-full object-cover" />
                </button>
                {p.uploading && <span className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/40"><Loader2 className="h-7 w-7 animate-spin text-white" /></span>}
                {i === 0 && !p.uploading && <span className="absolute bottom-2 left-2 inline-flex h-6 items-center gap-1 rounded-full bg-gold px-2 text-[11px] font-black text-ink-gold"><Star className="h-3 w-3" /> Cover</span>}
                <button type="button" onClick={() => setPhotos((list) => list.filter((_, j) => j !== i))} aria-label="Remove photo" className="absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-[rgb(var(--cream))] bg-ink text-cream">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            {photos.length < limits.photos && (
              <button type="button" onClick={() => galleryRef.current?.click()} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-[var(--border-faint)] text-sm font-bold text-ink-500">
                <ImagePlus className="h-7 w-7" /> Add
              </button>
            )}
          </div>
          <p className="text-center text-xs font-bold text-ink-500">{photos.length}/{limits.photos}</p>

          <div className="flex min-h-16 items-center gap-3 rounded-3xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold/15 text-gold"><Video className="h-5 w-5" /></span>
            <span className="flex-1 text-lg font-bold text-ink">Video</span>
            {video ? (
              <>
                {video.uploading ? <Loader2 className="h-5 w-5 animate-spin text-gold" /> : <Check className="h-5 w-5 text-green" />}
                <button type="button" onClick={() => setVideo(null)} aria-label="Remove video" className="flex h-11 w-11 items-center justify-center rounded-full bg-[rgb(var(--surface-muted))] text-ink"><X className="h-5 w-5" /></button>
              </>
            ) : (
              <button type="button" onClick={() => videoRef.current?.click()} className="inline-flex min-h-11 items-center gap-1 rounded-full bg-[rgb(var(--surface-muted))] px-4 text-sm font-bold text-ink"><Plus className="h-4 w-4" /> Add</button>
            )}
          </div>
        </div>
      )}

      {/* 4. Price & stock */}
      {step === 3 && (
        <div className="space-y-5 px-4 pt-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className={label}>Price</p>
              <div className="field-box flex items-center gap-2 rounded-2xl border-2 border-gold/60 bg-[rgb(var(--surface-input))] px-4">
                <span className="text-sm font-bold text-ink-500">UGX</span>
                <input value={price ? Number(digits(price)).toLocaleString("en-US") : ""} onChange={(e) => setPrice(e.target.value)} inputMode="numeric" placeholder="0" className="min-h-14 min-w-0 flex-1 bg-transparent text-lg font-black text-ink outline-none" data-testid="item-price" aria-label="Price" />
              </div>
            </div>
            <div>
              <p className={label}>Was</p>
              <div className="field-box flex items-center gap-2 rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-4">
                <span className="text-sm font-bold text-ink-500">UGX</span>
                <input value={was ? Number(digits(was)).toLocaleString("en-US") : ""} onChange={(e) => setWas(e.target.value)} inputMode="numeric" placeholder="—" className="min-h-14 min-w-0 flex-1 bg-transparent text-lg font-bold text-ink outline-none" aria-label="Was price" />
              </div>
            </div>
          </div>

          {type === "physical" && (
            <>
              <div className="rounded-3xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-ink-500">Cost</span>
                  <div className="field-box flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3">
                    <span className="text-xs font-bold text-ink-500">UGX</span>
                    <input value={cost ? Number(digits(cost)).toLocaleString("en-US") : ""} onChange={(e) => setCost(e.target.value)} inputMode="numeric" placeholder="0" className="min-h-11 w-full min-w-0 flex-1 bg-transparent text-base font-bold text-ink outline-none" aria-label="Cost" />
                  </div>
                </div>
                {costNum > 0 && priceNum > 0 && (
                  <p className="mt-3 flex items-center justify-between text-sm"><span className="font-bold text-ink-500">Profit</span><span className={`font-black ${priceNum - costNum >= 0 ? "text-green" : "text-red-600"}`}>{ugx(priceNum - costNum)}</span></p>
                )}
              </div>

              <div>
                <p className={label}>Size</p>
                <div className="flex flex-wrap gap-2">
                  {(SIZE_SETS[category] ?? ["S", "M", "L", "XL"]).concat(sizes.filter((s) => !(SIZE_SETS[category] ?? ["S", "M", "L", "XL"]).includes(s))).map((s) => (
                    <button key={s} type="button" onClick={() => setSizes((list) => (list.includes(s) ? list.filter((x) => x !== s) : [...list, s]))} className={`${chipCls(sizes.includes(s))} min-w-12 justify-center`}>{s}</button>
                  ))}
                  <form onSubmit={(e) => { e.preventDefault(); const v = sizeDraft.trim().slice(0, 20); if (v && !sizes.includes(v)) setSizes((l) => [...l, v]); setSizeDraft(""); }} className="flex">
                    <input value={sizeDraft} onChange={(e) => setSizeDraft(e.target.value)} placeholder="+" aria-label="Add size" className="min-h-12 w-20 rounded-full border-2 border-dashed border-[var(--border-faint)] bg-transparent !px-4 text-center text-base font-bold text-ink outline-none focus:border-gold" />
                  </form>
                </div>
              </div>
              <div>
                <p className={label}>Colour</p>
                <div className="flex flex-wrap gap-2">
                  {COLOURS.map((c) => {
                    const on = colours.some((x) => x.name === c.name);
                    return (
                      <button key={c.name} type="button" onClick={() => setColours((l) => (on ? l.filter((x) => x.name !== c.name) : [...l, c]))} className={chipCls(on)}>
                        <span className="h-5 w-5 rounded-full border border-black/20" style={{ background: c.hex }} /> {c.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              {variantRows.length > 0 ? (
                <VariantTable
                  title={title}
                  sizes={sizes}
                  colours={colours}
                  basePrice={priceNum}
                  defaultStock={stock}
                  rows={rows}
                  setRows={setRows}
                  groupPrices={groupPrices}
                  setGroupPrices={setGroupPrices}
                  showMissing={showMissing}
                  onApplyAll={(p, st) => {
                    if (p !== null) { setPrice(String(p)); setGroupPrices({}); setRows((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { ...v, price: "" }]))); }
                    if (st !== null) { setStock(st); setRows((m) => Object.fromEntries(variantRows.map((r) => [r.key, { ...(m[r.key] ?? { price: "" }), stock: st }]))); }
                  }}
                  uploadPhoto={async (f) => { const res = await uploadStoreMedia(f); if (!res.ok) { setError(res.message); return null; } return res.data.url; }}
                />
              ) : !outletMode && (
                <div className="flex items-center justify-between rounded-3xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4">
                  <span className="flex items-center gap-2 text-lg font-bold text-ink"><PackageOpen className="h-5 w-5 text-gold" /> Stock</span>
                  <Stepper2 value={stock} onChange={setStock} />
                </div>
              )}
              {outletMode && <p className="text-center text-sm font-bold text-ink-500"><Building2 className="mr-1 inline h-4 w-4" /> Stock per outlet on Publish</p>}
            </>
          )}

          {type === "digital" && (
            <>
              <div className="grid grid-cols-3 gap-2">
                {([["file", FileUp, "File"], ["link", Link2, "Link"], ["keys", KeyRound, "Keys"]] as const).map(([m, Icon, name]) => (
                  <ChoiceTile key={m} selected={digitalMode === m} onClick={() => setDigitalMode(m)} className="flex min-h-[88px] flex-col items-center justify-center gap-1.5">
                    <Icon className="h-7 w-7 text-ink" /><span className="text-base font-black text-ink">{name}</span>
                  </ChoiceTile>
                ))}
              </div>
              {digitalMode === "file" && (
                <>
                  <input ref={fileRef} type="file" className="hidden" onChange={(e) => setDigitalFile(e.target.files?.[0] ?? null)} />
                  <button type="button" onClick={() => fileRef.current?.click()} className="flex min-h-16 w-full items-center gap-3 rounded-3xl border-2 border-dashed border-[var(--border-faint)] px-4 text-left text-base font-bold text-ink">
                    <FileUp className="h-6 w-6 text-gold" /> <span className="min-w-0 flex-1 truncate">{digitalFile ? digitalFile.name : "Choose file"}</span>
                  </button>
                </>
              )}
              {digitalMode === "link" && <input value={digitalLink} onChange={(e) => setDigitalLink(e.target.value)} placeholder="https://" inputMode="url" className={`${field} min-h-14`} aria-label="Download link" />}
              {digitalMode === "keys" && <textarea value={digitalKeys} onChange={(e) => setDigitalKeys(e.target.value)} rows={4} placeholder="One key per line" className={`${field} font-mono`} aria-label="Licence keys" />}
            </>
          )}

          {type === "service" && (
            <>
              <div>
                <p className={label}><Clock className="h-4 w-4" /> Length</p>
                <div className="flex flex-wrap gap-2">
                  {[30, 60, 90, 120].map((d) => <button key={d} type="button" onClick={() => setDuration(d)} className={chipCls(duration === d)}>{d < 60 ? `${d} min` : `${d / 60}${d % 60 ? ".5" : ""} h`}</button>)}
                </div>
              </div>
              <div>
                <p className={label}><CalendarCheck className="h-4 w-4" /> Days</p>
                <div className="grid grid-cols-7 gap-1.5">
                  {WEEKDAYS.map((d, i) => (
                    <button key={d} type="button" onClick={() => setDays((l) => (l.includes(i) ? l.filter((x) => x !== i) : [...l, i]))} className={`min-h-12 rounded-2xl text-sm font-bold ${days.includes(i) ? "bg-gold text-ink-gold" : "bg-[rgb(var(--surface-muted))] text-ink"}`}>{d}</button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className={label}>Opens</span><input type="time" value={openAt} onChange={(e) => setOpenAt(e.target.value)} className={`${field} min-h-14`} /></label>
                <label className="block"><span className={label}>Closes</span><input type="time" value={closeAt} onChange={(e) => setCloseAt(e.target.value)} className={`${field} min-h-14`} /></label>
              </div>
            </>
          )}
        </div>
      )}

      {/* 5. Delivery */}
      {step === 4 && (
        <div className="space-y-5 px-4 pt-5">
          {type === "physical" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <ChoiceTile selected={rider} onClick={() => setRider(!rider)} className="flex min-h-[96px] flex-col items-center justify-center gap-2"><Bike className="h-8 w-8 text-ink" /><span className="text-base font-black text-ink">Peebee rider</span></ChoiceTile>
                <ChoiceTile selected={pickup} onClick={() => setPickup(!pickup)} className="flex min-h-[96px] flex-col items-center justify-center gap-2"><ShoppingBag className="h-8 w-8 text-ink" /><span className="text-base font-black text-ink">Pickup</span></ChoiceTile>
              </div>
              <div>
                <p className={label}><Box className="h-4 w-4" /> Size</p>
                <div className="grid grid-cols-3 gap-2">
                  {([["small", ShoppingBag, "Bag"], ["medium", Box, "Box"], ["large", Truck, "Large"]] as const).map(([s, Icon, name]) => (
                    <ChoiceTile key={s} selected={size === s} onClick={() => setSize(s)} className="flex min-h-[80px] flex-col items-center justify-center gap-1.5"><Icon className="h-6 w-6 text-ink" /><span className="text-sm font-black text-ink">{name}</span></ChoiceTile>
                  ))}
                </div>
              </div>
              <div>
                <p className={label}><Clock className="h-4 w-4" /> Ready in</p>
                <div className="flex flex-wrap gap-2">
                  {([["now", "Now"], ["1h", "1 h"], ["same_day", "Same day"], ["2_days", "2 days"]] as const).map(([v, name]) => (
                    <button key={v} type="button" onClick={() => setReadyIn(v)} className={chipCls(readyIn === v)}>{name}</button>
                  ))}
                </div>
              </div>
              <div className="flex min-h-16 items-center gap-3 rounded-3xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-4">
                <RotateCcw className="h-6 w-6 text-gold" />
                <span className="flex-1 text-lg font-bold text-ink">Returns · 7 days</span>
                <Toggle on={returnsDays > 0} onChange={(on) => setReturnsDays(on ? 7 : 0)} label="Returns" />
              </div>
            </>
          )}
          {type === "digital" && (
            <div className="flex flex-col items-center gap-3 rounded-3xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-6 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gold/15 text-gold"><Download className="h-8 w-8" /></span>
              <p className="text-xl font-black text-ink">Instant</p>
              <p className="text-sm text-ink-500">Sent right after payment.</p>
            </div>
          )}
          {type === "service" && (
            <div className="space-y-3">
              {([["in_facility", MapPin, "In store"], ["client_site", Truck, "At client"], ["virtual", Video, "Online"]] as const).map(([v, Icon, name]) => (
                <ChoiceTile key={v} selected={location === v} onClick={() => setLocation(v)} className="flex min-h-16 items-center gap-3 px-4">
                  <Icon className="h-6 w-6 text-ink" /><span className="flex-1 text-lg font-black text-ink">{name}</span>
                  {location === v && <Check className="h-5 w-5 text-gold" />}
                </ChoiceTile>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 6. Preview */}
      {step === 5 && (
        <div className="space-y-4 px-4 pt-5">
          <div className="mx-auto grid w-48 grid-cols-2 gap-1 rounded-full bg-black p-1.5" role="radiogroup" aria-label="Preview theme">
            <button type="button" role="radio" aria-checked={!previewDark} aria-label="Light" onClick={() => setPreviewDark(false)} className={`flex h-11 items-center justify-center rounded-full ${!previewDark ? "bg-gold text-black" : "text-white"}`}><Sun className="h-5 w-5" /></button>
            <button type="button" role="radio" aria-checked={previewDark} aria-label="Dark" onClick={() => setPreviewDark(true)} className={`flex h-11 items-center justify-center rounded-full ${previewDark ? "bg-gold text-black" : "text-white"}`}><Moon className="h-5 w-5" /></button>
          </div>
          <CustomerPreview item={preview} dark={previewDark} />
        </div>
      )}

      {/* 7. Publish */}
      {step === 6 && (
        <div className="space-y-3 px-4 pt-5">
          {type === "physical" ? (
            <>
              <div className="flex min-h-[76px] items-center gap-3 rounded-3xl border-2 border-gold bg-[rgb(var(--surface-card))] px-4">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gold/15 text-gold"><ShoppingBag className="h-6 w-6" /></span>
                <span className="min-w-0 flex-1"><span className="block text-lg font-bold text-ink">Peebee Buy</span><span className="block break-all text-xs text-ink-500">app.peebee.online</span></span>
                <Toggle on={inApp} onChange={setInApp} label="Show in Peebee Buy" />
              </div>
              <div className="flex min-h-[76px] items-center gap-3 rounded-3xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-4">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gold/15 text-gold"><Globe className="h-6 w-6" /></span>
                <span className="min-w-0 flex-1"><span className="block text-lg font-bold text-ink">My website</span><span className="block break-all text-xs text-ink-500">{store?.slug}.peebee.online</span></span>
                <Toggle on={onWeb} onChange={setOnWeb} label="Show on my website" />
              </div>

              <p className={`${label} pt-2`}><Building2 className="h-4 w-4" /> Outlets</p>
              {elite ? (
                outlets.length ? outlets.map((o) => (
                  <div key={o.id} className="space-y-3 rounded-3xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4">
                    <div className="flex min-h-11 items-center gap-3">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gold/15 text-gold"><Building2 className="h-6 w-6" /></span>
                      <span className="min-w-0 flex-1 break-words text-base font-bold text-ink">{o.name}</span>
                      <Toggle on={o.on} onChange={(on) => setOutlets((l) => l.map((x) => (x.id === o.id ? { ...x, on } : x)))} label={`Sell at ${o.name}`} />
                    </div>
                    {o.on && (
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-1.5 text-sm font-bold text-ink-500"><PackageOpen className="h-4 w-4" /> Stock</span>
                        <Stepper2 value={o.qty} onChange={(qty) => setOutlets((l) => l.map((x) => (x.id === o.id ? { ...x, qty } : x)))} />
                      </div>
                    )}
                  </div>
                )) : <p className="rounded-3xl bg-[rgb(var(--surface-muted))] p-4 text-sm font-bold text-ink-500">No outlets yet.</p>
              ) : (
                <button type="button" onClick={() => router.push("/store/plans?tier=elite")} className="relative flex min-h-[76px] w-full items-center gap-3 rounded-3xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-4 text-left" data-testid="outlets-locked">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[rgb(var(--surface-muted))] text-ink-500"><Building2 className="h-6 w-6" /></span>
                  <span className="flex-1 text-base font-bold text-ink">Stock per outlet</span>
                  <span className="inline-flex h-7 items-center gap-1 rounded-full bg-gold px-2.5 text-xs font-black text-ink-gold"><Lock className="h-3.5 w-3.5" /> Elite</span>
                </button>
              )}
            </>
          ) : (
            <div className="flex flex-wrap justify-center gap-2 py-2">
              <span className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[rgb(var(--surface-muted))] px-4 text-sm font-bold text-ink"><ShoppingBag className="h-4 w-4 text-gold" /> Peebee Buy</span>
              {type === "service" && <span className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[rgb(var(--surface-muted))] px-4 text-sm font-bold text-ink"><CalendarCheck className="h-4 w-4 text-gold" /> Services</span>}
            </div>
          )}

          {type !== "service" && (
            <div className="grid grid-cols-2 gap-1 rounded-full bg-[rgb(var(--surface-muted))] p-1.5" role="radiogroup" aria-label="Status">
              <button type="button" role="radio" aria-checked={live} onClick={() => setLive(true)} className={`flex min-h-12 items-center justify-center gap-2 rounded-full text-base font-bold ${live ? "bg-gold text-ink-gold" : "text-ink"}`}><Rocket className="h-5 w-5" /> Live now</button>
              <button type="button" role="radio" aria-checked={!live} onClick={() => setLive(false)} className={`flex min-h-12 items-center justify-center gap-2 rounded-full text-base font-bold ${!live ? "bg-gold text-ink-gold" : "text-ink"}`}><FilePen className="h-5 w-5" /> Draft</button>
            </div>
          )}
        </div>
      )}

      {error && <div className="mt-4"><ErrorNote>{error}</ErrorNote></div>}

      <BottomBar>
        {step === 5 && <GhostButton square label="Edit" onClick={() => setStep(1)}><Pencil className="h-6 w-6" /></GhostButton>}
        {step < 6 ? (
          <PrimaryButton testId="wizard-next" onClick={next}>{step === 5 ? "Looks good" : "Next"} <ArrowRight className="h-5 w-5" /></PrimaryButton>
        ) : (
          <PrimaryButton testId="wizard-publish" disabled={busy || (type === "physical" && live && !inApp && !onWeb)} onClick={() => void publish()}>
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Rocket className="h-5 w-5" />} {live || type === "service" ? "Publish" : "Save draft"}
          </PrimaryButton>
        )}
      </BottomBar>

      {copyOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" role="dialog" aria-modal="true" aria-label="Copy an item" onClick={() => setCopyOpen(false)}>
          <div className="max-h-[80dvh] w-full max-w-md overflow-y-auto rounded-t-[32px] bg-[rgb(var(--surface-card))] p-4 pb-[calc(16px+env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xl font-black text-ink">Copy an item</p>
              <button type="button" onClick={() => setCopyOpen(false)} aria-label="Close" className="flex h-12 w-12 items-center justify-center rounded-full bg-[rgb(var(--surface-muted))] text-ink"><X className="h-6 w-6" /></button>
            </div>
            <ul className="space-y-2">
              {existing.slice(0, 50).map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => copyFrom(p)} className="flex min-h-[72px] w-full items-center gap-3 rounded-2xl bg-[rgb(var(--surface-muted))] p-2 text-left">
                    {p.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.image_url} alt="" className="h-14 w-14 rounded-xl object-cover" />
                    ) : <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-[rgb(var(--surface-card))] text-ink-500"><Package className="h-6 w-6" /></span>}
                    <span className="min-w-0 flex-1"><span className="block truncate text-base font-bold text-ink">{p.title}</span><span className="text-sm font-bold text-gold">{ugx(p.price)}</span></span>
                    <Copy className="h-5 w-5 text-ink-500" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

/** − n + stepper with big buttons. */
function Stepper2({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-full bg-[rgb(var(--surface-muted))] p-1">
      <button type="button" onClick={() => onChange(Math.max(0, value - 1))} aria-label="Less" className="flex h-11 w-11 items-center justify-center rounded-full bg-[rgb(var(--surface-card))] text-ink"><Minus className="h-5 w-5" /></button>
      <input value={String(value)} onChange={(e) => onChange(digits(e.target.value))} inputMode="numeric" aria-label="Quantity" className="w-12 bg-transparent !p-0 text-center text-lg font-black text-ink outline-none" />
      <button type="button" onClick={() => onChange(value + 1)} aria-label="More" className="flex h-11 w-11 items-center justify-center rounded-full bg-[rgb(var(--surface-card))] text-ink"><Plus className="h-5 w-5" /></button>
    </div>
  );
}
