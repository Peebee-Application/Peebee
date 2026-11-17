"use client";

import type { GuestConfig } from "@peebee/shared";
import { ArrowLeft, Loader2, Minus, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { LocationPicker, emptyPoint, resolvePoint, type PointState } from "../../../components/LocationPicker";
import { OrderPhotosPicker, type PhotoDraft } from "../../../components/home/OrderPhotosPicker";
import { OrderVoiceNoteRecorder } from "../../../components/home/OrderVoiceNoteRecorder";
import { api, errorMessage } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";
import { guestClient, saveGuestSession } from "../../../lib/guest";
import { formatUgx } from "../../../lib/order-display";

type Variant = { id: string; title: string; price: number };
type Product = { id: string; title: string; price: number; image_url?: string | null; has_variants?: number | boolean; variants?: Variant[]; status?: string };

export function GuestCheckoutClient() {
  const params = useSearchParams();
  const router = useRouter();
  const { setSession } = useAuth();
  const productId = params.get("product") ?? "";
  const [config, setConfig] = useState<GuestConfig | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [storeName, setStoreName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [variantId, setVariantId] = useState<string | undefined>();
  const [quantity, setQuantity] = useState(1);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [point, setPoint] = useState<PointState>(emptyPoint);
  const [landmark, setLandmark] = useState("");
  const [voice, setVoice] = useState<Blob | null>(null);
  // Photos stay on the phone until the order exists (the guest token comes with it).
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [createAccount, setCreateAccount] = useState(true);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!productId) { setLoadError("Open this page from a product link."); return; }
    let live = true;
    Promise.all([api.getGuestConfig(), api.getMarketplaceProduct(productId)])
      .then(([cfg, res]) => {
        if (!live) return;
        setConfig(cfg);
        setCreateAccount(cfg.suggestAccount);
        setProduct(res.product as Product);
        setStoreName(res.store?.name ?? null);
        const first = (res.product as Product).variants?.[0];
        if (first) setVariantId(first.id);
      })
      .catch((err) => { if (live) setLoadError(errorMessage(err)); });
    return () => { live = false; };
  }, [productId]);

  const unit = useMemo(() => {
    if (!product) return 0;
    const variant = product.variants?.find((v) => v.id === variantId);
    return variant ? Number(variant.price) : Number(product.price);
  }, [product, variantId]);

  const place = resolvePoint(point, []);
  const located = place.lat != null && place.lng != null;
  const needsPassword = createAccount && password.length < 8;
  const ready = !!product && name.trim().length >= 2 && phone.replace(/\D/g, "").length >= 9 && located && !needsPassword && !busy;

  async function submit() {
    if (!ready || !product || place.lat == null || place.lng == null) return;
    setBusy(true);
    setError(null);
    try {
      const address = [landmark.trim(), place.address].filter(Boolean).join(" · ") || place.area || "Pinned location";
      const result = await api.guestCheckout({
        productId: product.id,
        variantId,
        quantity,
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        address,
        area: place.area,
        lat: place.lat,
        lng: place.lng,
        createAccount,
        password: createAccount ? password : undefined,
      });
      saveGuestSession({ orderId: result.orderId, trackingCode: result.trackingCode, token: result.token, item: product.title, phone: phone.trim() });
      if (voice) await guestClient(result.token).uploadOrderVoiceNote(result.orderId, voice).catch(() => {});
      for (const photo of photos) {
        await guestClient(result.token).uploadOrderPhotoToOrder(result.orderId, photo.blob, { note: photo.note.trim() || undefined }).catch(() => {});
      }
      // They chose to make an account: they are signed in already, and the guest page still works for this order.
      if (result.sessionToken && result.user) setSession(result.sessionToken, result.user);
      router.replace(`/guest/order/${result.orderId}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (loadError) return <div className="mx-auto max-w-md space-y-4 px-4 pt-8"><p role="alert" className="text-sm text-red-700">{loadError}</p><Link href="/" className="text-sm font-bold text-gold">Go to Peebee</Link></div>;
  if (!config || !product) return <div className="flex justify-center pt-24"><Loader2 className="h-6 w-6 animate-spin text-gold" aria-label="Loading" /></div>;
  if (!config.enabled) {
    return (
      <div className="mx-auto max-w-md space-y-4 px-4 pt-8 text-ink">
        <h1 className="text-2xl font-black">Please sign in to order</h1>
        <p className="text-sm text-ink-500">Guest checkout isn&apos;t available right now.</p>
        <Link href="/login" className="flex min-h-12 items-center justify-center rounded-full bg-gold px-6 text-sm font-bold text-ink-gold">Sign in</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-6 px-4 pb-32 pt-4 text-ink">
      <Link href={`/product/${productId}`} className="inline-flex items-center gap-1 text-sm font-semibold text-ink-500"><ArrowLeft className="h-4 w-4" aria-hidden /> Back to product</Link>
      <header className="space-y-1">
        <h1 className="text-2xl font-black">Checkout as a guest</h1>
        <p className="text-sm text-ink-500">No account needed. You get a tracking code and updates about your delivery.</p>
      </header>

      <section className="home-card space-y-3" aria-label="Your item">
        <div className="flex items-center gap-3">
          {product.image_url && /* eslint-disable-next-line @next/next/no-img-element */ <img src={product.image_url} alt="" className="h-16 w-16 rounded-2xl object-cover" />}
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold">{product.title}</p>
            {storeName && <p className="truncate text-xs text-ink-500">{storeName}</p>}
          </div>
          <p className="font-black text-gold">{formatUgx(unit)}</p>
        </div>
        {product.variants && product.variants.length > 0 && (
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Option">
            {product.variants.map((v) => (
              <button key={v.id} type="button" role="radio" aria-checked={variantId === v.id} onClick={() => setVariantId(v.id)}
                className={`min-h-10 rounded-full border px-4 text-sm font-semibold ${variantId === v.id ? "border-gold bg-gold/10 text-ink" : "border-[var(--border-faint)] text-ink-500"}`}>{v.title}</button>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Quantity</span>
          <div className="flex items-center gap-3">
            <button type="button" aria-label="Fewer" disabled={quantity <= 1} onClick={() => setQuantity((q) => q - 1)} className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border-faint)] disabled:opacity-40"><Minus className="h-4 w-4" aria-hidden /></button>
            <span className="w-6 text-center font-bold" aria-live="polite">{quantity}</span>
            <button type="button" aria-label="More" disabled={quantity >= config.maxQuantity} onClick={() => setQuantity((q) => q + 1)} className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border-faint)] disabled:opacity-40"><Plus className="h-4 w-4" aria-hidden /></button>
          </div>
        </div>
        <div className="flex justify-between border-t border-[var(--border-faint)] pt-3 text-sm"><span className="text-ink-500">Items</span><span className="font-bold">{formatUgx(unit * quantity)}</span></div>
        <p className="text-xs text-ink-500">Delivery is added when you pay.</p>
      </section>

      <section className="space-y-3" aria-label="Your details">
        <h2 className="text-lg font-bold">Your details</h2>
        <label className="block space-y-1 text-sm font-semibold">Full name
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="min-h-12 w-full rounded-xl px-3 text-base font-normal" />
        </label>
        <label className="block space-y-1 text-sm font-semibold">Phone number
          <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder="0772 123 456" className="min-h-12 w-full rounded-xl px-3 text-base font-normal" />
        </label>
        <label className="block space-y-1 text-sm font-semibold">Email <span className="font-normal text-ink-500">(optional)</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" className="min-h-12 w-full rounded-xl px-3 text-base font-normal" />
        </label>
      </section>

      <section className="space-y-3" aria-label="Delivery location">
        <h2 className="text-lg font-bold">Where should we deliver?</h2>
        <LocationPicker point={point} setPoint={setPoint} locations={[]} />
        <label className="block space-y-1 text-sm font-semibold">Landmark or house detail <span className="font-normal text-ink-500">(optional)</span>
          <input value={landmark} onChange={(e) => setLandmark(e.target.value)} placeholder="Blue gate, next to the pharmacy" className="min-h-12 w-full rounded-xl px-3 text-base font-normal" />
        </label>
      </section>

      <section className="space-y-3" aria-label="Voice note">
        <h2 className="text-lg font-bold">Tell the rider <span className="text-sm font-normal text-ink-500">(optional)</span></h2>
        <p className="text-sm text-ink-500">Record a short voice note: how to find you, or anything about the order.</p>
        <OrderVoiceNoteRecorder blob={voice} onChange={setVoice} />
        {config.photosAvailable && <OrderPhotosPicker photos={photos} onChange={setPhotos} maxPhotos={4} />}
      </section>

      {config.suggestAccount && (
        <section className="home-card space-y-3" aria-label="Create an account">
          <label className="flex min-h-11 cursor-pointer items-start gap-3">
            <input type="checkbox" checked={createAccount} onChange={(e) => setCreateAccount(e.target.checked)} className="mt-1 h-5 w-5 accent-[rgb(var(--gold,201_162_39))]" />
            <span className="text-sm"><span className="font-bold">Create a Peebee account with these details</span><br /><span className="text-ink-500">Track this order and reorder faster next time.</span></span>
          </label>
          {createAccount && (
            <div className="space-y-1">
              <label htmlFor="guest-password" className="block text-sm font-semibold">Choose a password</label>
              <input id="guest-password" aria-describedby="guest-password-hint" value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="new-password" minLength={8} className="min-h-12 w-full rounded-xl px-3 text-base font-normal" />
              <p id="guest-password-hint" className="text-xs text-ink-500">At least 8 characters. You sign in with your phone number.</p>
            </div>
          )}
        </section>
      )}

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button type="button" onClick={() => void submit()} disabled={!ready}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-gold px-6 text-sm font-bold text-ink-gold shadow-[var(--shadow-glow-gold)] active:scale-95 disabled:opacity-50">
        {busy ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Placing your order…</> : "Continue to payment"}
      </button>
      {!located && <p className="text-center text-xs text-ink-500">Choose your location on the map to continue.</p>}
    </div>
  );
}
