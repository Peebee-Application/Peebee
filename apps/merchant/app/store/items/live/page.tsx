"use client";

import { CalendarCheck, CircleCheckBig, Clock, ExternalLink, Eye, FilePen, Globe, Megaphone, Package, Plus, Radio, Rocket, Share2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BottomBar, FlowTop, GhostButton, PrimaryButton } from "../../../../components/flow/Flow";
import { ugx } from "../../../../lib/plans";

type Summary = {
  type: "physical" | "digital" | "service"; title: string; price: number; image: string; storeSlug: string; productId?: string;
  inApp: boolean; onWeb: boolean; live: boolean; outlets?: number; bookingUrl?: string; pending?: boolean;
};

const CUSTOMER = process.env.NEXT_PUBLIC_CUSTOMER_APP_URL ?? "https://app.peebee.online";

/** After publishing: where the item now shows, and quick next steps. */
export default function LiveInBuy() {
  const router = useRouter();
  const [s, setS] = useState<Summary | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const raw = sessionStorage.getItem("peebee_last_item");
        if (raw) setS(JSON.parse(raw) as Summary);
        else router.replace("/store");
      } catch {
        router.replace("/store");
      }
    }, 0);
    return () => clearTimeout(t);
  }, [router]);

  if (!s) return null;
  const draft = !s.live && s.type !== "service";
  const url = s.type === "service" ? s.bookingUrl || `${CUSTOMER}/store/${s.storeSlug}` : s.type === "physical" && s.productId ? `${CUSTOMER}/product/${s.productId}` : `${CUSTOMER}/store/${s.storeSlug}`;

  async function share() {
    try {
      if (navigator.share) await navigator.share({ title: s!.title, url });
      else await navigator.clipboard.writeText(url);
    } catch { /* closed */ }
  }

  return (
    <div className="mx-auto max-w-md pb-48">
      <FlowTop title="Done" onClose={() => router.push("/store")} />
      <div className="flex flex-col items-center gap-4 px-4 pt-6 text-center">
        <div className="relative">
          <span className="absolute inset-0 -m-6 rounded-full bg-gold/20 blur-2xl" aria-hidden />
          <span className="relative flex h-32 w-32 items-center justify-center rounded-full bg-gold text-ink-gold shadow-[0_12px_40px_rgb(var(--gold)/0.4)]">
            {draft ? <FilePen className="h-16 w-16" /> : s.pending ? <Clock className="h-16 w-16" /> : <Rocket className="h-16 w-16" />}
          </span>
        </div>
        <p className="text-3xl font-black text-ink" data-testid="live-title">{draft ? "Saved as draft" : s.pending ? "Waiting for review" : "Live in Buy"}</p>
        <div className="flex flex-wrap justify-center gap-2">
          {!draft && s.inApp && <span className="inline-flex h-9 items-center gap-1.5 rounded-full bg-green/10 px-3 text-sm font-bold text-green"><CircleCheckBig className="h-4 w-4" /> Peebee Buy</span>}
          {!draft && s.onWeb && s.type === "physical" && <span className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[rgb(var(--surface-muted))] px-3 text-sm font-bold text-ink"><Globe className="h-4 w-4" /> Website</span>}
          {s.type === "service" && <span className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[rgb(var(--surface-muted))] px-3 text-sm font-bold text-ink"><CalendarCheck className="h-4 w-4" /> Services</span>}
          {(s.outlets ?? 0) > 0 && <span className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[rgb(var(--surface-muted))] px-3 text-sm font-bold text-ink">{s.outlets} outlet{s.outlets === 1 ? "" : "s"}</span>}
        </div>
      </div>

      <a href={url} target="_blank" rel="noopener noreferrer" className="mx-4 mt-6 flex min-h-[84px] items-center gap-3 rounded-3xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3">
        {s.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={s.image} alt="" className="h-14 w-14 rounded-2xl object-cover" />
        ) : <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgb(var(--surface-muted))] text-ink-500">{s.type === "service" ? <CalendarCheck className="h-6 w-6" /> : <Package className="h-6 w-6" />}</span>}
        <span className="min-w-0 flex-1"><span className="block truncate text-lg font-bold text-ink">{s.title}</span><span className="text-base font-black text-gold">{ugx(s.price)}</span></span>
        <ExternalLink className="h-6 w-6 text-ink-500" />
      </a>

      <div className="mx-4 mt-4 grid grid-cols-3 gap-2">
        <button type="button" onClick={() => void share()} className="flex min-h-[84px] flex-col items-center justify-center gap-2 rounded-3xl bg-[rgb(var(--surface-muted))] text-sm font-bold text-ink"><Share2 className="h-6 w-6" /> Share</button>
        <Link href="/store#live" className="flex min-h-[84px] flex-col items-center justify-center gap-2 rounded-3xl bg-[rgb(var(--surface-muted))] text-sm font-bold text-ink"><Radio className="h-6 w-6" /> Go live</Link>
        <Link href="/store#promotions" className="flex min-h-[84px] flex-col items-center justify-center gap-2 rounded-3xl bg-[rgb(var(--surface-muted))] text-sm font-bold text-ink"><Megaphone className="h-6 w-6" /> Promote</Link>
      </div>

      <BottomBar aboveNav>
        <GhostButton onClick={() => window.open(url, "_blank", "noopener")}><Eye className="h-5 w-5" /> View</GhostButton>
        <PrimaryButton testId="add-another" onClick={() => { sessionStorage.removeItem("peebee_last_item"); router.push("/store/items/new"); }}><Plus className="h-5 w-5" /> Add another</PrimaryButton>
      </BottomBar>
    </div>
  );
}
