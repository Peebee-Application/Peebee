"use client";

import { Download, GraduationCap, Key, Lock } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { softCard, ugx } from "./MarketplaceUI";

type DigitalItem = {
  id: string;
  title: string;
  kind: string;
  description: string | null;
  price_ugx?: number;
  compare_at_price_ugx?: number | null;
  sold_out?: boolean;
  file_name?: string | null;
  cover_image_url?: string | null;
};

type Receipt = { title: string; accessUrl: string; licenseKey: string | null; expiresAt: string | null; paid: number; textStatus: string | null; needsManual: boolean };

const KIND_LABEL: Record<string, string> = { download: "Download", license_key: "Licence key", course: "Course", template: "Template", service: "Service" };

/** The store's downloads, licence keys and courses: bought from the wallet, delivered at once. */
export function DigitalShelf({ items }: { items: DigitalItem[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  if (items.length === 0) return null;

  async function buy(item: DigitalItem) {
    setBusy(item.id);
    setError("");
    try {
      const res = await api.buyDigitalProduct(item.id);
      setReceipt({
        title: item.title, accessUrl: res.accessUrl, licenseKey: res.licenseKey, expiresAt: res.expiresAt, paid: res.pricePaidUgx,
        textStatus: res.sms?.status ?? null, needsManual: res.needsManualFulfilment,
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section id="digital" className="mt-6 scroll-mt-4" aria-labelledby="digital-heading">
      <h2 id="digital-heading" className="mb-2 px-0.5 text-sm font-black text-ink">Downloads, keys &amp; courses</h2>
      <p className="mb-3 px-0.5 text-[11px] text-ink-500">Pay from your Peebee wallet and get it straight away. Nothing is delivered by a rider.</p>
      {error && <p role="alert" className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p>}
      <div className="space-y-3">
        {items.map((item) => {
          const Icon = item.kind === "course" ? GraduationCap : item.kind === "license_key" ? Key : Download;
          const price = Number(item.price_ugx) || 0;
          return (
            <article key={item.id} className={`${softCard} flex items-start gap-3 p-4`}>
              {item.cover_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.cover_image_url} alt="" className="h-16 w-16 shrink-0 rounded-xl object-cover bg-surface-muted" loading="lazy" />
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold/15 text-gold"><Icon className="h-5 w-5" aria-hidden /></span>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase text-ink-500">{KIND_LABEL[item.kind] ?? item.kind}</p>
                <h3 className="text-sm font-black text-ink">{item.title}</h3>
                {item.description && <p className="mt-0.5 line-clamp-2 text-xs text-ink-500">{item.description}</p>}
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-sm font-black text-ink">
                    {price > 0 ? ugx(price) : "Free"}
                    {item.compare_at_price_ugx && item.compare_at_price_ugx > price ? <span className="ml-1.5 text-[10px] font-medium text-ink-500 line-through">{ugx(item.compare_at_price_ugx)}</span> : null}
                  </p>
                  <button
                    type="button"
                    disabled={busy !== null || item.sold_out}
                    onClick={() => void buy(item)}
                    className="min-h-10 rounded-full bg-gold px-5 text-xs font-black text-ink-gold disabled:opacity-50"
                  >
                    {item.sold_out ? "Sold out" : busy === item.id ? "Buying…" : price > 0 ? "Buy now" : "Get it"}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {receipt && (
        <div role="dialog" aria-modal="true" aria-label="Purchase complete" className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <div className="w-full max-w-sm space-y-3 rounded-3xl bg-cream p-5 text-ink shadow-2xl">
            <h3 className="text-base font-black">It&apos;s yours — {receipt.title}</h3>
            <p className="text-xs text-ink-500">{receipt.paid > 0 ? `${ugx(receipt.paid)} was taken from your wallet.` : "No charge."}{receipt.textStatus === "sent" ? " We also texted you the link." : ""}</p>
            {receipt.licenseKey && (
              <div className="rounded-2xl bg-surface-muted p-3">
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-ink-500"><Key className="h-3.5 w-3.5" aria-hidden /> Your licence key</p>
                <p className="mt-1 select-all break-all font-mono text-sm font-black">{receipt.licenseKey}</p>
              </div>
            )}
            {!receipt.licenseKey && receipt.needsManual && <p className="flex items-center gap-1.5 text-xs font-semibold"><Lock className="h-3.5 w-3.5" aria-hidden /> The store will add your key shortly; it will appear on your purchase page.</p>}
            {receipt.expiresAt && <p className="text-[11px] text-ink-500">Link works until {new Date(receipt.expiresAt).toLocaleDateString()}.</p>}
            <a href={receipt.accessUrl} className="flex min-h-11 w-full items-center justify-center rounded-full bg-gold px-5 text-sm font-black text-ink-gold">Open my purchase</a>
            <button type="button" onClick={() => setReceipt(null)} className="w-full py-2 text-xs font-bold text-ink-500">Close</button>
          </div>
        </div>
      )}
    </section>
  );
}
