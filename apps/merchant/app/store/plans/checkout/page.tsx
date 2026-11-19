"use client";

import {
  ArrowRight, BadgeCheck, CalendarClock, Check, CircleCheck, CreditCard, Crown, Download, GraduationCap, KeyRound, ListChecks, Loader2,
  MessageSquareText, Monitor, Package, Percent, Phone, QrCode, Radio, RotateCcw, ShieldCheck, Smartphone, Store, Users, Wallet, X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { BottomBar, ChoiceTile, CodeBoxes, ErrorNote, FlowTop, GhostButton, Keypad, PrimaryButton, Stepper } from "../../../../components/flow/Flow";
import { PLAN_NAME, plansApi, shortDate, ugx, type Checkout, type Cycle, type Method, type PaymentStart, type QuoteResponse, type Tier } from "../../../../lib/plans";

const STEPS = [
  { icon: ListChecks, label: "Review" },
  { icon: Wallet, label: "Pay" },
  { icon: ShieldCheck, label: "Verify" },
  { icon: CircleCheck, label: "Done" },
];
const ICON: Record<string, typeof Crown> = { merchant: QrCode, pro_live: Store, pro_store: Store, elite: Crown, legacy: BadgeCheck };
const UNLOCKS: Record<Tier, { icon: typeof Crown; text: string }[]> = {
  merchant: [{ icon: QrCode, text: "Code pay" }],
  pro_live: [{ icon: Package, text: "More items" }, { icon: Radio, text: "Live" }, { icon: Store, text: "Store" }],
  elite: [{ icon: Package, text: "5,000 items" }, { icon: Monitor, text: "POS" }, { icon: Download, text: "Digital" }, { icon: GraduationCap, text: "Courses" }, { icon: Users, text: "CRM" }, { icon: Percent, text: "Lower fee" }],
};
const PIN_LENGTH = 4;

type Stage = "loading" | "review" | "pay" | "setpin" | "verify" | "processing" | "failed";

function networkOf(phone: string): "MTN" | "Airtel" | null {
  const d = phone.replace(/\D/g, "").replace(/^256/, "").replace(/^0/, "");
  if (/^(77|78|76|79)/.test(d)) return "MTN";
  if (/^(70|75|74)/.test(d)) return "Airtel";
  return null;
}

function CheckoutFlow() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("loading");
  const [tier, setTier] = useState<Tier>("elite");
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const [q, setQ] = useState<QuoteResponse | null>(null);
  const [method, setMethod] = useState<Method>("wallet");
  const [phone, setPhone] = useState("+256 ");
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [payment, setPayment] = useState<PaymentStart | null>(null);
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(60);
  const [pin1, setPin1] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [failure, setFailure] = useState("");
  const submitted = useRef("");

  const goDone = useCallback((id: string) => router.replace(`/store/plans/done?checkout=${id}`), [router]);

  const follow = useCallback((c: Checkout, message?: string) => {
    setCheckout(c);
    if (c.status === "active" || c.status === "scheduled") goDone(c.id);
    else if (c.status === "paying" || c.status === "activating") setStage("processing");
    else if (c.status === "awaiting_code") setStage("verify");
    else { setFailure(message || "This checkout didn't finish. You were not charged."); setStage("failed"); }
  }, [goDone]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const existing = params.get("checkout");
    if (existing) {
      void plansApi.get(existing).then((res) => (res.ok ? follow(res.data.checkout, res.data.message) : (setFailure(res.message), setStage("failed"))));
      return;
    }
    const t = (params.get("tier") as Tier) || "elite";
    const c = (params.get("cycle") as Cycle) === "yearly" ? "yearly" : "monthly";
    void plansApi.quote(t, c).then((res) => {
      setTier(t);
      setCycle(c);
      if (!res.ok) { setFailure(res.message); setStage("failed"); return; }
      setQ(res.data);
      const m = res.data.methods;
      setMethod(res.data.quote.amount === 0 ? "free" : m.wallet ? "wallet" : m.mobileMoney ? "mobile_money" : "card");
      setStage("review");
    });
  }, [follow]);

  // Resend countdown.
  useEffect(() => {
    if (stage !== "verify" || resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [stage, resendIn]);

  // Processing: the server checks the payment and switches the plan.
  useEffect(() => {
    if (stage !== "processing" || !checkout) return;
    let stop = false;
    const tick = async () => {
      const res = await plansApi.get(checkout.id);
      if (stop) return;
      if (res.ok) {
        const c = res.data.checkout;
        if (c.status === "paying" || c.status === "activating") { setTimeout(() => void tick(), 3000); return; }
        follow(c, res.data.message);
      } else setTimeout(() => void tick(), 5000);
    };
    const first = setTimeout(() => void tick(), 2500);
    return () => { stop = true; clearTimeout(first); };
  }, [stage, checkout, follow]);

  const pinMode = (checkout?.verifyMethod ?? q?.verify.channel) === "pin";
  const codeLength = pinMode ? PIN_LENGTH : 6;

  async function start() {
    if (!q) return;
    setError("");
    if (q.verify.channel === "pin" && !q.verify.pinSet) { setStage("setpin"); return; }
    setBusy(true);
    const res = await plansApi.start({ tier, billingCycle: cycle, method: q.quote.amount === 0 ? "free" : method, ...(method === "mobile_money" ? { msisdn: phone.replace(/\s/g, "") } : {}) });
    setBusy(false);
    if (!res.ok) {
      if (res.error === "pin_required") { setStage("setpin"); return; }
      setError(res.message);
      return;
    }
    setCheckout(res.data.checkout);
    setDevCode(res.data.devCode ?? null);
    setCode("");
    submitted.current = "";
    setResendIn(60);
    setStage("verify");
  }

  async function savePin(pin: string) {
    setBusy(true);
    setError("");
    const res = await plansApi.setPin({ pin, ...(password ? { password } : {}) });
    setBusy(false);
    if (!res.ok) { setError(res.message); setPin1(""); setCode(""); return; }
    setQ((prev) => (prev ? { ...prev, verify: { ...prev.verify, pinSet: true } } : prev));
    setPin1("");
    setCode("");
    setStage("pay");
  }

  async function verify(value: string) {
    if (!checkout || submitted.current === value) return;
    submitted.current = value;
    setBusy(true);
    setError("");
    const res = await plansApi.verify(checkout.id, value);
    setBusy(false);
    if (!res.ok) {
      setCode("");
      submitted.current = "";
      if (res.error === "quote_changed") { setFailure(res.message); setStage("failed"); return; }
      setError(res.message + (typeof res.data.attemptsLeft === "number" ? ` (${res.data.attemptsLeft} left)` : ""));
      return;
    }
    if (res.data.payment) {
      setPayment(res.data.payment);
      if (res.data.payment.redirectUrl) { window.location.href = res.data.payment.redirectUrl; return; }
    }
    follow(res.data.checkout, res.data.message);
  }

  function typeDigit(d: string) {
    if (busy) return;
    if (stage === "setpin") {
      const next = (code + d).slice(0, PIN_LENGTH);
      if (next.length < PIN_LENGTH) { setCode(next); return; }
      setError("");
      if (!pin1) { setPin1(next); setCode(""); return; }
      if (next !== pin1) { setError("PINs don't match. Try again."); setPin1(""); setCode(""); return; }
      setCode(next);
      void savePin(next);
      return;
    }
    const next = (code + d).slice(0, codeLength);
    setCode(next);
    if (next.length === codeLength) void verify(next);
  }

  async function resend() {
    if (!checkout) return;
    const res = await plansApi.resend(checkout.id);
    if (!res.ok) { setError(res.message); return; }
    setDevCode(res.data.devCode ?? null);
    setResendIn(60);
  }

  async function cancel() {
    if (checkout && ["awaiting_code", "paying"].includes(checkout.status)) await plansApi.cancel(checkout.id);
    router.push("/store/plans");
  }

  const stepIndex = stage === "review" ? 0 : stage === "pay" ? 1 : stage === "setpin" || stage === "verify" || stage === "processing" ? 2 : 0;
  const quote = q?.quote;
  const title = stage === "review" ? "Review" : stage === "pay" ? "Pay" : stage === "setpin" ? "Set PIN" : stage === "verify" ? "Verify" : stage === "processing" ? "Paying" : "Plan";
  const amount = checkout?.amount ?? quote?.amount ?? 0;
  const net = networkOf(phone);

  return (
    <div className="mx-auto max-w-md pb-48">
      <FlowTop
        title={title}
        onBack={stage === "review" ? () => router.push("/store/plans") : stage === "pay" ? () => setStage("review") : stage === "setpin" ? () => setStage("pay") : undefined}
        onClose={stage === "processing" ? undefined : () => void cancel()}
      />
      {stage !== "loading" && stage !== "failed" && <Stepper steps={STEPS} current={stepIndex} onJump={(i) => (i === 0 && stage === "pay" ? setStage("review") : undefined)} />}

      {stage === "loading" && <div className="flex justify-center py-24"><Loader2 className="h-9 w-9 animate-spin text-gold" /></div>}

      {stage === "failed" && (
        <div className="space-y-6 px-4 pt-10 text-center">
          <span className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-red-500/10 text-red-600 dark:text-red-400"><X className="h-12 w-12" /></span>
          <p className="text-2xl font-black text-ink">Not done</p>
          <p className="text-base text-ink-500">{failure}</p>
          {checkout && <p className="text-sm font-bold text-ink-500">Ref {checkout.reference}</p>}
          <BottomBar>
            <PrimaryButton onClick={() => router.push("/store/plans")}><RotateCcw className="h-5 w-5" /> Try again</PrimaryButton>
          </BottomBar>
        </div>
      )}

      {stage === "review" && quote && (
        <div className="space-y-4 px-4 pt-5">
          <div className="flex items-center justify-center gap-4 rounded-3xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5">
            {[quote.fromPlan, quote.tier].map((p, i) => {
              const Icon = ICON[p] ?? Store;
              return (
                <div key={i} className="flex items-center gap-4">
                  {i === 1 && <ArrowRight className="h-6 w-6 text-ink-500" />}
                  <div className="flex flex-col items-center gap-2">
                    <span className={`flex h-16 w-16 items-center justify-center rounded-2xl ${i === 1 ? "bg-gold text-ink-gold" : "bg-[rgb(var(--surface-muted))] text-ink"}`}><Icon className="h-8 w-8" /></span>
                    <span className="text-sm font-bold text-ink">{PLAN_NAME[p] ?? p}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {quote.kind !== "downgrade" && (
            <div className="grid grid-cols-3 gap-2" aria-label="Unlocks">
              {UNLOCKS[quote.tier].map((u) => (
                <div key={u.text} className="flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-2xl bg-[rgb(var(--surface-muted))] px-1 text-center text-xs font-bold text-ink">
                  <u.icon className="h-6 w-6 text-gold" /> {u.text}
                </div>
              ))}
            </div>
          )}

          <dl className="space-y-3 rounded-3xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4 text-base" data-testid="review-summary">
            {quote.kind === "downgrade" ? (
              <>
                <div className="flex items-center justify-between"><dt className="flex items-center gap-2 text-ink-500"><CalendarClock className="h-5 w-5" /> Starts</dt><dd className="font-bold text-ink">{shortDate(quote.startsAt)}</dd></div>
                <div className="flex items-center justify-between"><dt className="text-ink-500">Today</dt><dd className="font-bold text-ink">{ugx(0)}</dd></div>
                {quote.laterAmount > 0 && <div className="flex items-center justify-between"><dt className="text-ink-500">Then</dt><dd className="font-bold text-ink">{ugx(quote.laterAmount)}</dd></div>}
              </>
            ) : (
              <>
                <div className="flex items-center justify-between"><dt className="flex items-center gap-2 text-ink-500"><CalendarClock className="h-5 w-5" /> {quote.kind === "renew" ? shortDate(quote.startsAt) : "Today"} → </dt><dd className="font-bold text-ink">{shortDate(quote.expiresAt)}</dd></div>
                <div className="flex items-center justify-between"><dt className="text-ink-500">{PLAN_NAME[quote.tier]} · {cycle === "yearly" ? "365" : "30"} days</dt><dd className="font-bold text-ink">{quote.free ? "Free" : ugx(quote.listPrice)}</dd></div>
                {quote.credit > 0 && (
                  <div className="flex items-center justify-between" data-testid="credit-row"><dt className="text-ink-500">{PLAN_NAME[quote.fromPlan]} credit · {quote.creditDays} d</dt><dd className="font-bold text-green">− {ugx(quote.credit)}</dd></div>
                )}
              </>
            )}
            <div className="flex items-center justify-between border-t border-[var(--border-faint)] pt-3"><dt className="text-lg font-black text-ink">Total</dt><dd className="text-xl font-black text-gold">{ugx(quote.amount)}</dd></div>
          </dl>
          <BottomBar>
            <PrimaryButton testId="review-continue" onClick={() => setStage("pay")}>Continue <ArrowRight className="h-5 w-5" /></PrimaryButton>
          </BottomBar>
        </div>
      )}

      {stage === "pay" && quote && q && (
        <div className="space-y-4 px-4 pt-5">
          <div className="relative overflow-hidden rounded-3xl bg-black p-5 text-white">
            <p className="flex items-center gap-2 text-sm font-bold text-white/70"><Crown className="h-4 w-4 text-gold" /> {PLAN_NAME[quote.tier]} · {quote.kind === "downgrade" ? `from ${shortDate(quote.startsAt)}` : `${cycle === "yearly" ? 365 : 30} days`}</p>
            <p className="mt-1 text-4xl font-black text-gold" data-testid="pay-amount">{ugx(quote.amount)}</p>
          </div>

          {quote.amount === 0 ? (
            <ChoiceTile selected onClick={() => undefined} className="flex min-h-[72px] items-center gap-3 px-4">
              <BadgeCheck className="h-7 w-7 text-gold" />
              <span className="flex-1 text-lg font-black text-ink">{quote.kind === "downgrade" ? "Nothing to pay today" : "Free"}</span>
              <span className="text-lg font-black text-ink">{ugx(0)}</span>
            </ChoiceTile>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Pay with">
                {q.methods.wallet && (
                  <ChoiceTile selected={method === "wallet"} onClick={() => setMethod("wallet")} className="flex min-h-[96px] flex-col items-center justify-center gap-1 p-2" testId="method-wallet">
                    <Wallet className="h-7 w-7 text-ink" /><span className="text-sm font-black text-ink">Wallet</span><span className="text-xs font-bold text-ink-500">{(q.wallet.balance ?? 0).toLocaleString("en-US")}</span>
                  </ChoiceTile>
                )}
                {q.methods.mobileMoney && (
                  <ChoiceTile selected={method === "mobile_money"} onClick={() => setMethod("mobile_money")} className="flex min-h-[96px] flex-col items-center justify-center gap-1 p-2" testId="method-momo">
                    <Smartphone className="h-7 w-7 text-ink" /><span className="text-center text-sm font-black leading-tight text-ink">Mobile money</span>
                  </ChoiceTile>
                )}
                {q.methods.card && (
                  <ChoiceTile selected={method === "card"} onClick={() => setMethod("card")} className="flex min-h-[96px] flex-col items-center justify-center gap-1 p-2" testId="method-card">
                    <CreditCard className="h-7 w-7 text-ink" /><span className="text-sm font-black text-ink">Card</span>
                  </ChoiceTile>
                )}
              </div>
              {method === "wallet" && q.wallet.balance < quote.amount && <ErrorNote>Wallet is short by {ugx(quote.amount - q.wallet.balance)}.</ErrorNote>}
              {method === "mobile_money" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    {(["MTN", "Airtel"] as const).map((n) => (
                      <span key={n} className={`flex min-h-12 items-center justify-center gap-2 rounded-2xl border-2 text-base font-black text-ink ${net === n ? "border-gold bg-gold/10" : "border-[var(--border-faint)]"}`}>
                        <span className={`h-5 w-5 rounded-full ${n === "MTN" ? "bg-[#ffcb05]" : "bg-[#e40000]"}`} /> {n}
                      </span>
                    ))}
                  </div>
                  <label className="flex min-h-14 items-center gap-3 rounded-2xl border-2 border-gold/60 bg-[rgb(var(--surface-input))] px-4">
                    <Phone className="h-5 w-5 text-ink-500" />
                    <span className="sr-only">Mobile money number</span>
                    <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" className="min-w-0 flex-1 bg-transparent !p-0 text-lg font-bold text-ink outline-none" data-testid="momo-phone" />
                  </label>
                </div>
              )}
            </>
          )}
          <p className="flex justify-center">
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-green/10 px-3 text-xs font-bold text-green">
              {q.verify.channel === "pin" ? <KeyRound className="h-4 w-4" /> : <MessageSquareText className="h-4 w-4" />} {q.verify.channel === "pin" ? "PIN check next" : "Code check next"}
            </span>
          </p>
          {error && <ErrorNote>{error}</ErrorNote>}
          <BottomBar>
            <PrimaryButton testId="pay-button" disabled={busy || (method === "wallet" && quote.amount > 0 && q.wallet.balance < quote.amount) || (method === "mobile_money" && quote.amount > 0 && !net)} onClick={() => void start()}>
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : quote.amount === 0 ? <Check className="h-5 w-5" /> : <Wallet className="h-5 w-5" />}
              {quote.amount === 0 ? `Confirm ${ugx(0)}` : `Pay ${ugx(quote.amount)}`}
            </PrimaryButton>
          </BottomBar>
        </div>
      )}

      {stage === "setpin" && (
        <div className="space-y-5 pt-6">
          <div className="flex flex-col items-center gap-3 px-4 text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-gold/15 text-gold"><KeyRound className="h-10 w-10" /></span>
            <p className="text-2xl font-black text-ink">{pin1 ? "Repeat PIN" : "New plan PIN"}</p>
            <p className="text-sm text-ink-500">Texts are off right now. Use a PIN to confirm.</p>
          </div>
          {!pin1 && (
            <label className="mx-4 flex min-h-14 items-center gap-3 rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-4">
              <ShieldCheck className="h-5 w-5 text-ink-500" />
              <span className="sr-only">Account password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Account password" autoComplete="current-password" className="min-w-0 flex-1 bg-transparent !p-0 text-base text-ink outline-none" />
            </label>
          )}
          <CodeBoxes value={code} length={PIN_LENGTH} />
          {error && <ErrorNote>{error}</ErrorNote>}
          <Keypad disabled={busy} onDigit={typeDigit} onDelete={() => setCode((v) => v.slice(0, -1))} />
        </div>
      )}

      {stage === "verify" && checkout && (
        <div className="space-y-5 pt-6">
          <div className="flex flex-col items-center gap-3 px-4 text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-gold/15 text-gold">{pinMode ? <KeyRound className="h-10 w-10" /> : <MessageSquareText className="h-10 w-10" />}</span>
            <p className="text-2xl font-black text-ink">{pinMode ? "Enter PIN" : "Enter code"}</p>
            {!pinMode && checkout.codeSentTo && <p className="flex items-center gap-1.5 text-sm font-bold text-ink-500"><Smartphone className="h-4 w-4" /> {checkout.codeSentTo}</p>}
            {devCode && <p className="rounded-full bg-[rgb(var(--surface-muted))] px-3 py-1 text-xs font-bold text-ink-500">Test code {devCode}</p>}
          </div>
          <CodeBoxes value={code} length={codeLength} />
          {!pinMode && (
            <p className="text-center">
              <button type="button" disabled={resendIn > 0} onClick={() => void resend()} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-ink-500 disabled:opacity-70">
                <RotateCcw className="h-4 w-4" /> Resend{resendIn > 0 ? ` · 0:${String(resendIn).padStart(2, "0")}` : ""}
              </button>
            </p>
          )}
          {error && <ErrorNote>{error}</ErrorNote>}
          {busy && <div className="flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>}
          <Keypad disabled={busy} onDigit={typeDigit} onDelete={() => setCode((v) => v.slice(0, -1))} />
        </div>
      )}

      {stage === "processing" && checkout && (
        <div className="space-y-5 px-4 pt-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="flex h-24 w-24 items-center justify-center rounded-full bg-gold/15 text-gold"><Smartphone className="h-12 w-12" /></span>
            <p className="text-2xl font-black text-ink">{checkout.method === "card" ? "Finish card payment" : "Approve on phone"}</p>
            {payment?.network && <span className="rounded-full bg-[rgb(var(--surface-muted))] px-3 py-1 text-xs font-bold text-ink">{payment.network} PIN</span>}
          </div>
          <ol className="space-y-1 rounded-3xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-3">
            <li className="flex min-h-14 items-center gap-3 px-2 font-bold text-ink"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-green text-white"><Check className="h-5 w-5" /></span> {pinMode ? "PIN" : "Code"} verified</li>
            <li className="flex min-h-14 items-center gap-3 px-2 font-bold text-ink"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-gold/20 text-gold"><Loader2 className="h-5 w-5 animate-spin" /></span> Waiting for payment</li>
            <li className="flex min-h-14 items-center gap-3 px-2 font-bold text-ink-500"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-[rgb(var(--surface-muted))]"><Crown className="h-5 w-5" /></span> Turn on {PLAN_NAME[checkout.tier]}</li>
          </ol>
          <p className="text-center text-sm font-bold text-ink-500">Ref {checkout.reference} · {ugx(amount)}</p>
          <BottomBar>
            <GhostButton onClick={() => void cancel()}><X className="h-5 w-5" /> Cancel</GhostButton>
          </BottomBar>
        </div>
      )}
    </div>
  );
}

export default function PlanCheckoutPage() {
  return (
    <Suspense fallback={null}>
      <CheckoutFlow />
    </Suspense>
  );
}
