"use client";

import { ShoppingBag, Store, UtensilsCrossed } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { useRequireAccount } from "../lib/guest-access";
import { ShareButton } from "./ShareButton";

export type SharedItemPreview = {
  kind: "product" | "dish";
  path: string;
  title: string;
  seller: string | null;
  price: string;
  image: string | null;
  description: string;
  details: string[];
  available: boolean;
  shareText: string;
};

/**
 * A product's or dish's own link: signed in, the full page; signed out (or
 * while the session loads, which is what search engines and link previews
 * see), a public preview with a way in that comes back here after sign-in.
 */
export function SharedItemGate({ preview, children }: { preview: SharedItemPreview; children: React.ReactNode }) {
  const { user, ready } = useAuth();
  if (ready && user) return <>{children}</>;
  return <PublicItemPreview preview={preview} />;
}

function PublicItemPreview({ preview }: { preview: SharedItemPreview }) {
  const router = useRouter();
  const requireAccount = useRequireAccount();
  const [guestOk, setGuestOk] = useState(false);
  // Guest checkout is a product-link feature, and the admin can switch it off.
  useEffect(() => {
    if (preview.kind !== "product" || !preview.available) return;
    api.getGuestConfig().then((cfg) => setGuestOk(cfg.enabled)).catch(() => {});
  }, [preview.kind, preview.available]);
  const productId = preview.path.split("/").filter(Boolean).pop() ?? "";
  const Icon = preview.kind === "dish" ? UtensilsCrossed : ShoppingBag;
  function signIn() {
    const productHref = guestOk && preview.kind === "product" ? `/guest/checkout?product=${encodeURIComponent(productId)}` : undefined;
    requireAccount({ returnTo: preview.path, buyAsGuestHref: productHref });
  }
  return (
    <article className="mx-auto max-w-md space-y-5 px-4 pb-32 pt-4 text-ink">
      <div className="relative aspect-[4/5] w-full overflow-hidden rounded-[32px] bg-[rgb(var(--surface-muted))] shadow-[var(--shadow-card-hover)] sm:aspect-square">
        {preview.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview.image} alt={preview.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-gold"><Icon className="h-16 w-16" aria-hidden="true" /></div>
        )}
        <div className="absolute right-4 top-4">
          <ShareButton
            target={{ url: preview.path, title: preview.title, text: preview.shareText }}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border-faint)] bg-[rgb(var(--surface-card)/.9)] text-ink shadow-[var(--shadow-card)] backdrop-blur-md active:scale-95"
          />
        </div>
      </div>
      <header className="space-y-1">
        {preview.seller && (
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-ink-500">
            <Store className="h-3.5 w-3.5" aria-hidden="true" /> {preview.seller}
          </p>
        )}
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-black leading-tight">{preview.title}</h1>
          <p className="shrink-0 text-xl font-black text-gold">{preview.price}</p>
        </div>
        {!preview.available && <p className="text-sm font-bold text-ink-500">Not available right now</p>}
      </header>
      <p className="text-sm leading-6 text-ink-500">{preview.description}</p>
      {preview.details.length > 0 && (
        <ul className="space-y-1 text-sm text-ink">
          {preview.details.map((detail) => <li key={detail}>{detail}</li>)}
        </ul>
      )}
      {guestOk && (
        <button type="button" onClick={() => router.push(`/guest/checkout?product=${encodeURIComponent(productId)}`)} className="flex min-h-12 w-full items-center justify-center rounded-full bg-gold px-6 text-sm font-bold text-ink-gold shadow-[var(--shadow-glow-gold)] active:scale-95">
          Buy as a guest
        </button>
      )}
      <button type="button" onClick={signIn} className={guestOk ? "flex min-h-12 w-full items-center justify-center rounded-full border border-gold px-6 text-sm font-bold text-ink active:scale-95" : "flex min-h-12 w-full items-center justify-center rounded-full bg-gold px-6 text-sm font-bold text-ink-gold shadow-[var(--shadow-glow-gold)] active:scale-95"}>
        {guestOk ? "Sign in to order" : "Sign in to order on Peebee"}
      </button>
      {guestOk && <p className="text-center text-sm text-ink-500">Already ordered as a guest? <a href="/guest/track" className="font-bold text-gold">Track your order</a></p>}
    </article>
  );
}
