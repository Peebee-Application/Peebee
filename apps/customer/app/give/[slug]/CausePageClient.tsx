"use client";

import type { CauseView } from "@peebee/shared";
import { BadgeCheck, CheckCircle2, Clock, HeartHandshake } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ProgressBar } from "../../../components/channels/CauseCard";
import { Avatar } from "../../../components/channels/PostParts";
import { PublicFrame } from "../../../components/channels/PublicFrame";
import { ShareButton } from "../../../components/ShareButton";
import { SwipeToConfirm } from "../../../components/SwipeToConfirm";
import { api, errorMessage } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";
import { timeAgo, ugx, useChannelsConfig } from "../../../lib/channels";

type Receipt = { code: string; status: string; amountUgx: number };

const RECEIPT_KEY = "peebee_donation_receipt";

export function CausePageClient({ slug }: { slug: string }) {
  const { user } = useAuth();
  const { config } = useChannelsConfig();
  const rules = config?.causes;
  const [cause, setCause] = useState<CauseView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(10_000);
  const [tip, setTip] = useState(0);
  const [name, setName] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [message, setMessage] = useState("");
  const [method, setMethod] = useState<"momo" | "wallet">("momo");
  const [msisdn, setMsisdn] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const giveLock = useRef(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      setCause((await api.publicCause(slug)).cause);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [slug]);
  useEffect(() => { void load(); }, [load, user?.id]);

  // A donor who reloads while their payment is confirming picks up where they were.
  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(`${RECEIPT_KEY}:${slug}`);
      if (saved) setReceipt(JSON.parse(saved) as Receipt);
    } catch { /* private mode */ }
  }, [slug]);

  useEffect(() => {
    if (!receipt || receipt.status !== "pending") return;
    poll.current = setInterval(async () => {
      try {
        const r = await api.donationStatus(receipt.code);
        if (r.status !== "pending") {
          const next = { code: r.code, status: r.status, amountUgx: r.amountUgx };
          setReceipt(next);
          try { window.sessionStorage.setItem(`${RECEIPT_KEY}:${slug}`, JSON.stringify(next)); } catch { /* ignore */ }
          if (r.status === "successful") void load();
        }
      } catch { /* keep trying */ }
    }, 4000);
    return () => { if (poll.current) clearInterval(poll.current); };
  }, [receipt, slug, load]);

  async function give(e?: React.FormEvent) {
    e?.preventDefault();
    if (!reviewing) {
      setReviewing(true);
      setFormError(null);
      return;
    }
    if (giveLock.current) return;
    giveLock.current = true;
    setBusy(true);
    setFormError(null);
    try {
      const r = await api.donateToCause(slug, { amountUgx: amount, tipUgx: tip, name: name.trim() || undefined, anonymous, message: message.trim() || undefined, method, msisdn: method === "momo" ? msisdn : undefined });
      const next = { code: r.code, status: r.status, amountUgx: amount };
      setReceipt(next);
      try { window.sessionStorage.setItem(`${RECEIPT_KEY}:${slug}`, JSON.stringify(next)); } catch { /* ignore */ }
      setOpen(false);
      setReviewing(false);
      if (r.redirectUrl) window.location.href = r.redirectUrl;
      else if (r.status === "successful") void load();
    } catch (err) {
      setFormError(errorMessage(err));
      throw err;
    } finally {
      giveLock.current = false;
      setBusy(false);
    }
  }

  if (error && !cause) return <PublicFrame returnTo={`/give/${slug}`}><div className="space-y-3 p-8 text-center"><h1 className="text-lg font-bold text-ink">Cause not found</h1><p className="text-sm text-ink-500">{error}</p></div></PublicFrame>;
  if (!cause) return <div className="p-8 text-center text-sm text-ink-500" aria-busy="true">Loading…</div>;

  const accepting = cause.status === "live";
  const presets = [5_000, 10_000, 20_000, 50_000, 100_000].filter((v) => v >= (rules?.minDonationUgx ?? 0) && v <= (rules?.maxDonationUgx ?? Infinity));
  const canWallet = !!user && rules?.allowWalletPayment !== false;
  const canMomo = rules?.allowMobileMoney !== false;
  const needsSignIn = !user && rules?.guestDonations === false;

  return (
    <PublicFrame returnTo={`/give/${slug}`}>
      <article className="space-y-5 pb-32">
        {cause.coverUrl && /* eslint-disable-next-line @next/next/no-img-element */ <img src={cause.coverUrl} alt="" className="aspect-[16/10] w-full object-cover" />}
        <div className="space-y-4 px-4">
          <h1 className="text-2xl font-extrabold leading-tight text-ink">{cause.title}</h1>
          {cause.channel && (
            <Link href={`/c/${cause.channel.handle}`} className="flex items-center gap-2.5">
              <Avatar name={cause.channel.displayName} url={cause.channel.avatarUrl} size={32} />
              <span className="flex items-center gap-1 text-sm font-semibold text-ink">{cause.channel.displayName}{cause.channel.verified && <BadgeCheck className="h-4 w-4 text-gold" aria-label="Verified" />}</span>
            </Link>
          )}
          {cause.beneficiary && <p className="text-sm text-ink-500">For: <strong className="text-ink">{cause.beneficiary}</strong></p>}
          {cause.status !== "live" && <p className="rounded-2xl bg-[rgb(var(--surface-muted))] px-4 py-3 text-sm font-semibold text-ink">{cause.status === "ended" || cause.status === "closed" ? "This cause has ended. Thank you to everyone who gave." : cause.status === "frozen" ? "Giving is paused while this cause is reviewed." : `This cause is ${cause.status}.`}</p>}

          <div className="space-y-2 rounded-3xl bg-[rgb(var(--surface-card))] p-5 shadow-sm">
            <p className="text-2xl font-extrabold text-ink">{ugx(cause.raisedUgx)}</p>
            <p className="text-sm text-ink-500">raised of {ugx(cause.goalUgx)}</p>
            <ProgressBar percent={cause.percent} />
            <p className="flex items-center gap-4 text-sm text-ink-500"><span>{cause.donorCount} donor{cause.donorCount === 1 ? "" : "s"}</span>{accepting && <span className="flex items-center gap-1"><Clock className="h-4 w-4" aria-hidden /> {cause.daysLeft} day{cause.daysLeft === 1 ? "" : "s"} left</span>}</p>
            <div className="flex gap-2 pt-2">
              {accepting && !needsSignIn && <button type="button" onClick={() => setOpen(true)} className="min-h-12 flex-1 rounded-full bg-gold text-base font-bold text-ink-gold">Give now</button>}
              {needsSignIn && <Link href="/login" className="flex min-h-12 flex-1 items-center justify-center rounded-full bg-gold text-base font-bold text-ink-gold">Sign in to give</Link>}
              <ShareButton target={{ url: `/give/${cause.slug}`, title: cause.title, text: `${cause.title}. ${ugx(cause.raisedUgx)} raised of ${ugx(cause.goalUgx)}.` }} className="flex h-12 w-12 items-center justify-center rounded-full bg-[rgb(var(--surface-muted))] text-ink" />
            </div>
          </div>

          {receipt && (
            <div role="status" className={`space-y-1 rounded-3xl p-5 ${receipt.status === "successful" ? "bg-green/10" : receipt.status === "failed" ? "bg-red-50" : "bg-gold/10"}`}>
              {receipt.status === "pending" && <><p className="text-sm font-bold text-ink">Approve the payment on your phone</p><p className="text-xs text-ink-500">We will confirm here as soon as it goes through. Your code: <strong>{receipt.code}</strong></p></>}
              {receipt.status === "successful" && <><p className="flex items-center gap-2 text-sm font-bold text-green"><CheckCircle2 className="h-5 w-5" aria-hidden /> Thank you! {ugx(receipt.amountUgx)} received.</p><p className="text-xs text-ink-500">Receipt code: <strong>{receipt.code}</strong></p></>}
              {receipt.status === "failed" && <><p className="text-sm font-bold text-red-700">The payment did not go through. You have not been charged.</p><button type="button" onClick={() => { setReceipt(null); setOpen(true); }} className="text-sm font-bold text-gold">Try again</button></>}
            </div>
          )}

          <section aria-label="The story" className="space-y-2"><h2 className="text-base font-bold text-ink">The story</h2><p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">{cause.story}</p></section>

          {cause.updates.length > 0 && (
            <section aria-label="Updates" className="space-y-3"><h2 className="text-base font-bold text-ink">Updates</h2>
              {cause.updates.map((u) => <div key={u.id} className="rounded-2xl bg-[rgb(var(--surface-muted))] p-4"><p className="text-xs text-ink-500">{timeAgo(u.createdAt)} ago</p><p className="whitespace-pre-wrap break-words text-sm text-ink">{u.body}</p></div>)}
            </section>
          )}
          {cause.donors.length > 0 && (
            <section aria-label="Donors" className="space-y-3"><h2 className="flex items-center gap-2 text-base font-bold text-ink"><HeartHandshake className="h-5 w-5 text-gold" aria-hidden /> Recent donors</h2>
              {cause.donors.map((d, i) => <div key={i} className="flex items-start justify-between gap-3 text-sm"><div className="min-w-0"><p className="font-semibold text-ink">{d.name}</p>{d.message && <p className="break-words text-xs text-ink-500">“{d.message}”</p>}</div><p className="shrink-0 font-bold text-ink">{ugx(d.amountUgx)}</p></div>)}
            </section>
          )}
        </div>
      </article>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} aria-hidden />
          <form onSubmit={give} role="dialog" aria-modal="true" aria-label="Give" className="soft-drawer animate-drawer-in relative z-10 max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto p-5 pb-8">
            <h2 className="text-lg font-bold text-ink">Give to this cause</h2>
            <div className="flex flex-wrap gap-2">
              {presets.map((v) => <button key={v} type="button" aria-pressed={amount === v} onClick={() => setAmount(v)} className={`rounded-full px-4 py-2 text-sm font-semibold ${amount === v ? "bg-gold text-ink-gold" : "bg-[rgb(var(--surface-muted))] text-ink"}`}>{ugx(v)}</button>)}
            </div>
            <label className="block text-xs font-bold text-ink-500">Amount (UGX)
              <span className="field-box border border-[var(--border-faint)] mt-1 flex items-center rounded-2xl px-4"><input type="number" inputMode="numeric" required min={rules?.minDonationUgx} max={rules?.maxDonationUgx} value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="h-12 w-full text-base text-ink outline-none" /></span>
            </label>
            {rules?.donorTipEnabled && (
              <div className="space-y-2"><p className="text-xs font-bold text-ink-500">Add a tip to help Peebee run this (optional)</p>
                <div className="flex flex-wrap gap-2">{[0, 500, 1000, 2000].map((v) => <button key={v} type="button" aria-pressed={tip === v} onClick={() => setTip(v)} className={`rounded-full px-4 py-2 text-sm font-semibold ${tip === v ? "bg-gold text-ink-gold" : "bg-[rgb(var(--surface-muted))] text-ink"}`}>{v === 0 ? "No tip" : ugx(v)}</button>)}</div>
              </div>
            )}
            <label className="block text-xs font-bold text-ink-500">Your name (optional)
              <span className="field-box border border-[var(--border-faint)] mt-1 flex items-center rounded-2xl px-4"><input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoComplete="name" className="h-12 w-full text-base text-ink outline-none" /></span>
            </label>
            {rules?.allowAnonymous && <label className="flex items-center gap-3 text-sm text-ink"><input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} className="h-5 w-5" /> Hide my name from the donor list</label>}
            <label className="block text-xs font-bold text-ink-500">A message (optional)
              <span className="field-box border border-[var(--border-faint)] mt-1 flex items-center rounded-2xl px-4"><input value={message} maxLength={300} onChange={(e) => setMessage(e.target.value)} className="h-12 w-full text-base text-ink outline-none" /></span>
            </label>
            <div role="tablist" aria-label="How to pay" className="flex gap-2">
              {canMomo && <button type="button" role="tab" aria-selected={method === "momo"} onClick={() => setMethod("momo")} className={`flex-1 rounded-full px-4 py-3 text-sm font-bold ${method === "momo" ? "bg-gold text-ink-gold" : "bg-[rgb(var(--surface-muted))] text-ink"}`}>Mobile money</button>}
              {canWallet && <button type="button" role="tab" aria-selected={method === "wallet"} onClick={() => setMethod("wallet")} className={`flex-1 rounded-full px-4 py-3 text-sm font-bold ${method === "wallet" ? "bg-gold text-ink-gold" : "bg-[rgb(var(--surface-muted))] text-ink"}`}>Peebee wallet</button>}
            </div>
            {method === "momo" && canMomo && (
              <label className="block text-xs font-bold text-ink-500">MTN or Airtel number
                <span className="field-box border border-[var(--border-faint)] mt-1 flex items-center rounded-2xl px-4"><input type="tel" inputMode="tel" required autoComplete="tel" placeholder="07XX XXX XXX" value={msisdn} onChange={(e) => setMsisdn(e.target.value)} className="h-12 w-full text-base text-ink outline-none" /></span>
              </label>
            )}
            {formError && <p role="alert" className="rounded-2xl bg-danger/10 p-3 text-sm text-danger-ink">{formError}</p>}
            {reviewing ? (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-ink">Review gift · {ugx(amount + tip)}{tip > 0 ? ` (includes ${ugx(tip)} tip)` : ""} · {method === "wallet" ? "Peebee wallet" : "Mobile money"} · {cause.title}</p>
                <SwipeToConfirm tone="ink" commitAt={0.6} label={`Swipe to give UGX ${(amount + tip).toLocaleString("en-UG")}`} disabled={busy} onConfirm={() => give()} />
                <button type="button" disabled={busy} onClick={() => void give().catch(() => undefined)} className="min-h-12 w-full rounded-full border border-[var(--border-faint)] text-base font-bold text-ink disabled:opacity-60">{busy ? "Please wait…" : `Give UGX ${(amount + tip).toLocaleString("en-UG")} without swiping`}</button>
                <button type="button" onClick={() => setReviewing(false)} className="w-full text-sm font-semibold text-ink-500">Edit</button>
              </div>
            ) : (
              <button type="submit" className="min-h-12 w-full rounded-full bg-gold text-base font-bold text-ink-gold">Review gift</button>
            )}
            <p className="text-center text-xs text-ink-500">Money raised is held safely and released to the creator after checks.</p>
          </form>
        </div>
      )}
    </PublicFrame>
  );
}
