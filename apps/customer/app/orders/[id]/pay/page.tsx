"use client";

import { Select } from "@peebee/shared/select";

import type { CardInput, CustomerWalletSummary, OrderDetail, PaymentNextAction, PaymentOptions, WalletShareReceived } from "@peebee/shared";
import { detectMobileMoneyNetwork, mobileMoneyNetworkLabel } from "@peebee/shared";
import { Banknote, CreditCard, Smartphone, Wallet } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApplicantPicker } from "../../../../components/ApplicantPicker";
import { CardFields, CardHostedNote, CardPaymentSteps, cardFromForm, emptyCard, type CardForm } from "../../../../components/CardPayment";
import { MobileNumberPicker } from "../../../../components/MobileNumberPicker";
import { OrderBreakdown } from "../../../../components/OrderBreakdown";
import { api, errorMessage } from "../../../../lib/api";
import { formatUgx } from "../../../../lib/order-display";
import { useLivePolling } from "../../../../lib/use-live-polling";
import { useNetworkStatus } from "../../../../lib/use-network-status";
import { useRegisterNavPrimaryAction, useRegisterNavBack } from "../../../../lib/nav-primary-action";
import { payReturnKey } from "../../../../lib/taxipress-draft";

/** Where to go once this order is paid (or on Back): a flow that sent the customer here (TaxiPress) can ask to come back. */
function afterPay(id: string, ticketId?: string | null) {
  const fallback = ticketId ? `/ride/taxipress/ticket/${ticketId}` : `/orders/${id}`;
  try { return sessionStorage.getItem(payReturnKey(id)) || fallback; } catch { return fallback; }
}

type Method = "mobile_money" | "card" | "wallet" | "cash";
type Quote = Awaited<ReturnType<typeof api.getOrderCheckout>>;
const METHODS = [
  { id: "mobile_money", label: "Mobile Money", icon: Smartphone },
  { id: "card", label: "Card", icon: CreditCard },
  { id: "wallet", label: "Wallet", icon: Wallet },
  { id: "cash", label: "Cash", icon: Banknote },
] as const;

export default function PaymentPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const online = useNetworkStatus();
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [method, setMethod] = useState<Method>("mobile_money");
  const [phone, setPhone] = useState("");
  const [wallets, setWallets] = useState<CustomerWalletSummary[] | null>(null);
  const [shares, setShares] = useState<WalletShareReceived[]>([]);
  const [walletKey, setWalletKey] = useState("primary");
  const [walletError, setWalletError] = useState<string | null>(null);
  // Card is offered only when Flutterwave is active. `direct` = Peebee's own form (admin switch), otherwise Flutterwave's hosted page.
  const [payOptions, setPayOptions] = useState<PaymentOptions | null>(null);
  const [cardForm, setCardForm] = useState<CardForm>(emptyCard);
  const [cardStep, setCardStep] = useState<{ paymentId: string; card: CardInput; action: PaymentNextAction } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A promo code the customer typed. Offers that apply by themselves need nothing here.
  const [codeInput, setCodeInput] = useState("");
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  const [codeMessage, setCodeMessage] = useState<string | null>(null);
  const [promoOpen, setPromoOpen] = useState(false);
  const appliedCodeRef = useRef<string | null>(null);
  const paying = useRef(false);
  const ticketId = useRef<string | null>(null);
  const polling = useRef(false);
  const load = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      let current = await api.getOrder(id);
      // A combined delivery is paid once, from its first pickup.
      const bundleLead = current.order.delivery_bundle_id && current.order.delivery_bundle_id !== id
        ? current.bundleStops?.find((stop) => stop.id === current.order.delivery_bundle_id)
        : undefined;
      if (bundleLead && ["Create", "Match", "Fund"].includes(bundleLead.stage) && ["Create", "Match"].includes(current.order.stage)) {
        router.replace(`/orders/${current.order.delivery_bundle_id}/pay`);
        return;
      }
      let bundleWindowOpen = false;
      if (!current.order.delivery_bundle_id && current.order.stage === "Create") {
        try {
          const candidates = await api.getDeliveryBundleCandidates();
          bundleWindowOpen = candidates.orders.some((candidate) => candidate.id === id);
          // Adding another restaurant happens while ordering, not at payment: a lone order simply
          // continues here, so its pickup-choice hold is closed automatically.
          if (bundleWindowOpen) {
            await api.closeDeliveryBundleWindow(id);
            bundleWindowOpen = false;
          }
        } catch {
          bundleWindowOpen = false;
        }
      }
      if (!bundleWindowOpen && !current.order.rider_id && ["Create", "Match"].includes(current.order.stage)) {
        await api.matchOrder(id).catch(() => {});
        current = await api.getOrder(id);
      }
      const pending = current.payments.find((p) => p.type === "collection" && ["pending", "unknown"].includes(p.status));
      if (pending) await api.refreshPayment(pending.id).catch(() => {});
      const nextQuote = await api.getOrderCheckout(id, appliedCodeRef.current);
      const nextUnpaidPickup = current.order.stage === "Fund"
        ? current.bundleStops?.find((stop) => stop.id !== id && stop.stage === "Match")
        : undefined;
      if (nextUnpaidPickup) {
        router.replace(`/orders/${nextUnpaidPickup.id}/pay`);
        return;
      }
      setDetail(current);
      setQuote(nextQuote);
      ticketId.current = nextQuote.taxipress?.bookingId ?? null;
      // Paid already (a relay paid before its rider): nothing left to do here, the order page follows it.
      const paid = current.payments.some((p) => p.type === "collection" && p.status === "successful");
      if (!["Create", "Match", "Fund"].includes(current.order.stage) || (paid && current.order.stage !== "Fund")) router.replace(afterPay(id, ticketId.current));
    } catch (err) { setError(errorMessage(err)); }
    finally { polling.current = false; }
  }, [id, router]);
  useLivePolling(() => void load(), 4000, [load]);
  // TaxiPress: cash can be switched off, or the passenger may already hold the most cash bookings allowed.
  const cashBlocked = quote?.taxipress?.cashAllowed === false ? quote.taxipress.cashReason ?? "Cash isn't available for this ride." : null;
  // A relay is paid in the app, never in cash.
  useEffect(() => {
    if ((quote?.payBeforeRider || cashBlocked) && method === "cash") setMethod("mobile_money");
  }, [quote?.payBeforeRider, cashBlocked, method]);

  useEffect(() => {
    let active = true;
    Promise.all([api.getWallets(), api.getWalletShares()]).then(([own, shared]) => {
      if (!active) return;
      setWallets(own.wallets);
      setShares(shared.received.filter((w) => w.status === "active"));
    }).catch((err) => { if (active) setWalletError(errorMessage(err)); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    api.getPaymentOptions().then(setPayOptions).catch(() => setPayOptions(null));
  }, []);
  const cardAvailable = !!payOptions?.card.available;
  const cardDirect = cardAvailable && !!payOptions?.card.direct;
  const cardInput = cardFromForm(cardForm);

  const choices = [
    ...(wallets ?? []).map((w) => ({ key: w.id, name: w.isPrimary ? `${w.name} (main wallet)` : w.name, balance: w.balance, walletId: w.id, ownerId: undefined as string | undefined })),
    ...shares.map((w) => ({ key: `shared:${w.id}`, name: `${w.wallet_name} — ${w.owner_name}`, balance: w.owner_balance, walletId: w.wallet_id ?? "primary", ownerId: w.owner_id })),
  ];
  const selectedWallet = choices.find((w) => w.key === walletKey);
  const amount = quote ? (method === "mobile_money" || method === "card" ? quote.mobileMoney : quote[method]) : null;
  const network = detectMobileMoneyNetwork(phone);
  const pending = detail?.payments.some((p) => p.type === "collection" && ["pending", "unknown"].includes(p.status)) ?? false;
  const combinedStops = detail?.bundleStops ?? [];
  // A ride is paid in one glance: the fare, a way to pay, done. No order breakdown, promo code tucked away.
  const isRide = !!detail?.order.is_ride;
  // Relay: pay straight away, before any rider (admin setting). Direct: wait until a rider accepts.
  const payFirst = !!quote?.payBeforeRider;
  const ready = !pending && (payFirst || (detail?.order.stage === "Match" && !!detail.order.rider_id
    && (combinedStops.length < 2 || combinedStops.every((stop) => stop.stage === "Match"))));
  const methods = METHODS.filter((m) => (m.id !== "cash" || !payFirst) && (m.id !== "card" || cardAvailable));
  const insufficient = method === "wallet" && selectedWallet?.balance != null && amount != null && selectedWallet.balance < amount;
  const disabled = busy || !!cardStep || (method === "cash" && !!cashBlocked) || !online || !ready || amount == null ||
    (method === "mobile_money" && !network) ||
    (method === "card" && cardDirect && !cardInput) ||
    (method === "wallet" && (!selectedWallet || selectedWallet.balance == null || insufficient));

  async function applyCode() {
    const code = codeInput.trim();
    if (!code) return;
    setCodeMessage(null);
    try {
      const res = await api.previewOrderOffer(id, code);
      if (res.codeAccepted) {
        appliedCodeRef.current = code;
        setAppliedCode(code);
        setCodeMessage(`${code.toUpperCase()} applied — you save ${formatUgx(res.discount + res.cashback)}`);
        await load();
      } else {
        setCodeMessage(res.codeMessage ?? "That code isn't valid for this order.");
      }
    } catch (err) { setCodeMessage(errorMessage(err)); }
  }

  function removeCode() {
    appliedCodeRef.current = null;
    setAppliedCode(null);
    setCodeInput("");
    setCodeMessage(null);
    void load();
  }

  async function pay() {
    if (disabled || paying.current || amount == null) return;
    paying.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api.fundOrder(id, {
        paymentMethod: method, acceptedAmount: amount, ...(appliedCode ? { offerCode: appliedCode } : {}),
        ...(method === "mobile_money" ? { msisdn: phone } : {}),
        ...(method === "card" && cardDirect && cardInput ? { card: cardInput } : {}),
        ...(method === "wallet" ? { useWallet: true, walletId: selectedWallet?.walletId, walletOwnerId: selectedWallet?.ownerId } : {}),
      });
      if (result.redirectUrl) { window.location.href = result.redirectUrl; return; }
      if (method === "card" && cardInput && result.payment?.id && result.nextAction) {
        setCardStep({ paymentId: result.payment.id, card: cardInput, action: result.nextAction });
        return;
      }
      setCardForm(emptyCard);
      if (result.funded || result.payment?.status === "successful") {
        // A combined delivery is paid once (quote.bundle); only an older part-paid one still chains to the next pickup.
        const nextUnpaidPickup = quote?.bundle ? undefined : detail?.bundleStops?.find((stop) => stop.id !== id && stop.stage === "Match");
        router.replace(nextUnpaidPickup ? `/orders/${nextUnpaidPickup.id}/pay` : afterPay(id, ticketId.current));
      }
      else await load();
    } catch (err) { setError(errorMessage(err)); await load(); }
    finally { paying.current = false; setBusy(false); }
  }

  // The final pay step is the bottom nav's gold right capsule (both themes),
  // wired to the same pay() with the same disabled rules.
  // Pay step: nav Back returns to the order.
  useRegisterNavBack(true, () => router.push(afterPay(id, ticketId.current)));
  useRegisterNavPrimaryAction({
    tone: "gold",
    label: busy ? "Please wait…" : pending ? "Waiting for payment" : method === "cash" ? "Continue with cash" : `Pay${amount == null ? "" : ` ${formatUgx(amount)}`}`,
    sublabel: !busy && !pending && method === "mobile_money" && network ? `with ${mobileMoneyNetworkLabel(network)}` : method === "wallet" && !busy && !pending ? "from wallet" : undefined,
    disabled,
    busy: busy || pending,
    onClick: () => void pay(),
  });

  return (
    <div className="mx-auto max-w-lg space-y-5 px-4 pt-5">
      <div className="space-y-1">
        <Link href={`/orders/${id}`} className="text-sm font-semibold text-ink-500">{isRide ? "Back" : "Back to order"}</Link>
        <h1 className="text-2xl font-bold text-ink">Payment</h1>
        <p className="text-sm text-ink-500">How would you like to pay?</p>
      </div>
      {detail && !detail.order.rider_id && payFirst && (
        <p className="rounded-xl bg-gold/10 p-3 text-sm leading-6 text-ink">Pay now. We&apos;ll assign your riders and matatu for same-day delivery.</p>
      )}
      <fieldset disabled={busy || pending} className={`grid gap-2 ${methods.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
        <legend className="sr-only">Payment method</legend>
        {methods.map(({ id: value, label, icon: Icon }) => (
          <label key={value} className={`flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border-2 p-2 text-center text-sm font-bold ${value === "cash" && cashBlocked ? "cursor-not-allowed opacity-50" : "cursor-pointer"} ${method === value ? "border-gold bg-gold/10 text-ink" : "border-[var(--border-faint)] text-ink-500"}`}>
            <input type="radio" name="payment-method" value={value} checked={method === value} disabled={value === "cash" && !!cashBlocked} aria-describedby={value === "cash" && cashBlocked ? "cash-blocked" : undefined} onChange={() => setMethod(value)} className="sr-only peer" />
            <Icon className="h-6 w-6 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-gold" aria-hidden />
            {label}
          </label>
        ))}
      </fieldset>
      {cashBlocked && <p id="cash-blocked" className="-mt-2 text-sm text-ink-500">{cashBlocked}</p>}
      {quote?.offer && (quote.offer.discount > 0 || quote.offer.cashback > 0) && (
        <p className="rounded-xl bg-gold/10 p-3 text-sm leading-6 text-ink">
          {quote.offer.applied.map((a) => a.name).join(", ")} — {quote.offer.discount > 0 ? `you save ${formatUgx(quote.offer.discount)}` : ""}
          {quote.offer.discount > 0 && quote.offer.cashback > 0 ? " and " : ""}
          {quote.offer.cashback > 0 ? `${formatUgx(quote.offer.cashback)} comes back to your wallet after the ride` : ""}.
        </p>
      )}
      {!pending && !quote?.bundle && (
        <div className="space-y-2">
          {appliedCode ? (
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-semibold text-ink">Code {appliedCode.toUpperCase()}</span>
              <button type="button" onClick={removeCode} className="font-semibold text-ink-500">Remove</button>
            </div>
          ) : isRide && !promoOpen ? (
            <button type="button" onClick={() => setPromoOpen(true)} className="min-h-10 text-sm font-semibold text-ink-500">Have a promo code?</button>
          ) : (
            <div className="flex items-center gap-2">
              <input aria-label="Promo code" value={codeInput} onChange={(e) => setCodeInput(e.target.value.toUpperCase())} placeholder="Promo code" maxLength={30} autoCapitalize="characters" className="min-w-0 flex-1 rounded-xl border border-[var(--border-faint)] px-3 py-3 text-[15px]" />
              <button type="button" onClick={() => void applyCode()} disabled={!codeInput.trim()} className="rounded-xl bg-gold px-4 py-3 text-sm font-bold text-ink disabled:opacity-50">Apply</button>
            </div>
          )}
          {codeMessage && <p className="text-sm text-ink-500" role="status">{codeMessage}</p>}
        </div>
      )}
      <section className="home-card space-y-4">

        <fieldset disabled={busy || pending} hidden={method !== "mobile_money"} className="min-w-0">
          <MobileNumberPicker purpose="payment" value={phone} onChange={setPhone} prominent autoSave />
          <p className="mt-3 text-sm text-ink-500">Enter your MTN MoMo or Airtel Money number. We detect the network automatically.</p>
        </fieldset>
        {method === "card" && (cardStep ? (
          <CardPaymentSteps
            paymentId={cardStep.paymentId}
            card={cardStep.card}
            initial={cardStep.action}
            onCancel={() => { setCardStep(null); setCardForm(emptyCard); void load(); }}
            onPending={() => { setCardStep(null); setCardForm(emptyCard); void load(); }}
          />
        ) : (
          <div className="space-y-3">
            <h2 className="text-lg font-bold text-ink">Pay by card</h2>
            {cardDirect ? <CardFields value={cardForm} onChange={setCardForm} disabled={busy || pending} /> : <CardHostedNote />}
          </div>
        ))}
        {method === "wallet" && (
          <div className="space-y-3">
            <h2 className="text-lg font-bold text-ink">Pay from your wallet</h2>
            {walletError ? <p role="alert" className="text-sm text-red-700">{walletError}</p> : wallets === null ? <p>Loading your wallets…</p> : (
              <>
                {choices.length > 1 && (
                  <div className="space-y-2">
                    <label htmlFor="payment-wallet" className="block text-sm font-semibold">Select wallet</label>
                    <Select id="payment-wallet" value={walletKey} onValueChange={(value) => setWalletKey(value)} disabled={busy || pending} className="min-h-14 w-full rounded-xl border border-[var(--border-faint)] glass-panel px-3 text-base">
                      {choices.map((w) => <option key={w.key} value={w.key}>{w.name}</option>)}
                    </Select>
                  </div>
                )}
                <p className="text-sm text-ink-500">{selectedWallet?.name}</p>
                <p className="text-2xl font-bold text-ink">{selectedWallet?.balance == null ? "Balance unavailable" : formatUgx(selectedWallet.balance)}</p>
                <p className="text-sm text-ink-500">Available balance</p>
                {insufficient && <p role="alert" className="text-sm text-red-700">This wallet has insufficient funds. <Link href="/wallet" className="underline">Top up your wallet</Link> or choose another payment option.</p>}
              </>
            )}
          </div>
        )}
        {method === "cash" && (
          <div className="space-y-2">
            <h2 className="text-lg font-bold text-ink">Pay cash to your rider</h2>
            <p className="text-sm leading-6 text-ink-500">Please set aside {amount == null ? "the order amount" : formatUgx(amount)}. Pay your rider when your delivery or ride is completed.</p>
          </div>
        )}
        {method !== "cash" && <p className="rounded-xl bg-gold/10 p-3 text-sm leading-6 text-ink">Your money is held safely in the app. Your rider receives it only after your delivery or ride is completed.</p>}
      </section>
      <section className="home-card space-y-2" aria-live="polite">
        {!isRide && quote?.delivery && quote.items && quote.itemsSubtotal != null ? (
          // Items, their subtotal, a faint line, the delivery and its breakdown, then the total.
          <OrderBreakdown
            items={quote.items}
            itemsSubtotal={quote.itemsSubtotal}
            delivery={quote.delivery}
            fees={amount != null ? amount - quote.baseAmount : 0}
            total={amount}
            deliveryLabel={detail?.order.is_ride ? "Fare" : undefined}
          />
        ) : (
          <>
            {quote && amount != null && amount > quote.baseAmount && <>
              <div className="flex justify-between text-sm text-ink-500"><span>{isRide ? "Fare" : "Order amount"}</span><span>{formatUgx(quote.baseAmount)}</span></div>
              <div className="flex justify-between text-sm text-ink-500"><span>Payment and service fees</span><span>{formatUgx(amount - quote.baseAmount)}</span></div>
            </>}
            <div className="flex justify-between gap-3 text-lg font-bold text-ink"><span>{isRide ? "Total fare" : "Total"}</span><span>{amount == null ? "Loading…" : formatUgx(amount)}</span></div>
          </>
        )}
      </section>
      {detail && !detail.order.rider_id && !payFirst && (
        <section className="home-card">
          {detail.order.matching_mode === "customer_selects" ? <ApplicantPicker orderId={id} onSelected={() => void load()} /> :
            <p className="text-sm text-ink-500">Finding your rider. You can choose your payment option while you wait.</p>}
        </section>
      )}
      {pending && <p role="status" className="rounded-xl bg-gold/10 p-4 text-sm">{method === "card" ? "We’re waiting for your bank to confirm the card payment. You will not be charged again." : "Approve the payment request on your phone. We’re waiting for confirmation. You will not be charged again."}</p>}
      {!pending && ready && detail?.payments.some((p) => p.type === "collection" && p.status === "failed") && <p role="status" className="text-sm text-ink-500">Your previous payment did not complete. You can try again or choose another payment option.</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!online && <p role="alert" className="text-sm text-ink-500">Connect to the internet to continue.</p>}
    </div>
  );
}
