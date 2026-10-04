"use client";

import { Select } from "@peebee/shared/select";

import type { CustomerWalletSummary, OrderDetail, WalletShareReceived } from "@peebee/shared";
import { detectMobileMoneyNetwork, mobileMoneyNetworkLabel } from "@peebee/shared";
import { Banknote, Smartphone, Wallet } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApplicantPicker } from "../../../../components/ApplicantPicker";
import { MobileNumberPicker } from "../../../../components/MobileNumberPicker";
import { api, errorMessage } from "../../../../lib/api";
import { formatUgx } from "../../../../lib/order-display";
import { useLivePolling } from "../../../../lib/use-live-polling";
import { useNetworkStatus } from "../../../../lib/use-network-status";

type Method = "mobile_money" | "wallet" | "cash";
type Quote = Awaited<ReturnType<typeof api.getOrderCheckout>>;
const METHODS = [
  { id: "mobile_money", label: "Mobile Money", icon: Smartphone },
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const paying = useRef(false);
  const polling = useRef(false);
  const load = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      let current = await api.getOrder(id);
      if (!current.order.rider_id && ["Create", "Match"].includes(current.order.stage)) {
        await api.matchOrder(id).catch(() => {});
        current = await api.getOrder(id);
      }
      const pending = current.payments.find((p) => p.type === "collection" && ["pending", "unknown"].includes(p.status));
      if (pending) await api.refreshPayment(pending.id).catch(() => {});
      const nextQuote = await api.getOrderCheckout(id);
      setDetail(current);
      setQuote(nextQuote);
      if (!["Create", "Match", "Fund"].includes(current.order.stage)) router.replace(`/orders/${id}`);
    } catch (err) { setError(errorMessage(err)); }
    finally { polling.current = false; }
  }, [id, router]);
  useLivePolling(() => void load(), 4000, [load]);

  useEffect(() => {
    let active = true;
    Promise.all([api.getWallets(), api.getWalletShares()]).then(([own, shared]) => {
      if (!active) return;
      setWallets(own.wallets);
      setShares(shared.received.filter((w) => w.status === "active"));
    }).catch((err) => { if (active) setWalletError(errorMessage(err)); });
    return () => { active = false; };
  }, []);

  const choices = [
    ...(wallets ?? []).map((w) => ({ key: w.id, name: w.isPrimary ? `${w.name} (main wallet)` : w.name, balance: w.balance, walletId: w.id, ownerId: undefined as string | undefined })),
    ...shares.map((w) => ({ key: `shared:${w.id}`, name: `${w.wallet_name} — ${w.owner_name}`, balance: w.owner_balance, walletId: w.wallet_id ?? "primary", ownerId: w.owner_id })),
  ];
  const selectedWallet = choices.find((w) => w.key === walletKey);
  const amount = quote ? (method === "mobile_money" ? quote.mobileMoney : quote[method]) : null;
  const network = detectMobileMoneyNetwork(phone);
  const pending = detail?.payments.some((p) => p.type === "collection" && ["pending", "unknown"].includes(p.status)) ?? false;
  const ready = detail?.order.stage === "Match" && !!detail.order.rider_id && !pending;
  const insufficient = method === "wallet" && selectedWallet?.balance != null && amount != null && selectedWallet.balance < amount;
  const disabled = busy || !online || !ready || amount == null ||
    (method === "mobile_money" && !network) ||
    (method === "wallet" && (!selectedWallet || selectedWallet.balance == null || insufficient));

  async function pay() {
    if (disabled || paying.current || amount == null) return;
    paying.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api.fundOrder(id, {
        paymentMethod: method, acceptedAmount: amount,
        ...(method === "mobile_money" ? { msisdn: phone } : {}),
        ...(method === "wallet" ? { useWallet: true, walletId: selectedWallet?.walletId, walletOwnerId: selectedWallet?.ownerId } : {}),
      });
      if (result.redirectUrl) { window.location.href = result.redirectUrl; return; }
      if (result.funded || result.payment?.status === "successful") router.replace(`/orders/${id}`);
      else await load();
    } catch (err) { setError(errorMessage(err)); await load(); }
    finally { paying.current = false; setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-lg space-y-5 px-4 pb-28 pt-5">
      <div className="space-y-1">
        <Link href={`/orders/${id}`} className="text-sm font-semibold text-ink-500">Back to order</Link>
        <h1 className="text-2xl font-bold text-ink">Payment</h1>
        <p className="text-sm text-ink-500">How would you like to pay?</p>
      </div>
      <fieldset disabled={busy || pending} className="grid grid-cols-3 gap-2">
        <legend className="sr-only">Payment method</legend>
        {METHODS.map(({ id: value, label, icon: Icon }) => (
          <label key={value} className={`flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 p-2 text-center text-sm font-bold ${method === value ? "border-gold bg-gold/10 text-ink" : "border-[var(--border-faint)] text-ink-500"}`}>
            <input type="radio" name="payment-method" value={value} checked={method === value} onChange={() => setMethod(value)} className="sr-only peer" />
            <Icon className="h-6 w-6 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-gold" aria-hidden />
            {label}
          </label>
        ))}
      </fieldset>
      <section className="home-card space-y-4">
        <fieldset disabled={busy || pending} hidden={method !== "mobile_money"}>
          <MobileNumberPicker purpose="payment" value={phone} onChange={setPhone} prominent autoSave />
          <p className="mt-3 text-sm text-ink-500">Enter your MTN MoMo or Airtel Money number. We detect the network automatically.</p>
        </fieldset>
        {method === "wallet" && (
          <div className="space-y-3">
            <h2 className="text-lg font-bold text-ink">Pay from your wallet</h2>
            {walletError ? <p role="alert" className="text-sm text-red-700">{walletError}</p> : wallets === null ? <p>Loading your wallets…</p> : (
              <>
                {choices.length > 1 && (
                  <div className="space-y-2">
                    <label htmlFor="payment-wallet" className="block text-sm font-semibold">Select wallet</label>
                    <Select id="payment-wallet" value={walletKey} onValueChange={(value) => setWalletKey(value)} disabled={busy || pending} className="min-h-14 w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3 text-base">
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
        {quote && amount != null && amount > quote.baseAmount && <>
          <div className="flex justify-between text-sm text-ink-500"><span>Order amount</span><span>{formatUgx(quote.baseAmount)}</span></div>
          <div className="flex justify-between text-sm text-ink-500"><span>Payment and service fees</span><span>{formatUgx(amount - quote.baseAmount)}</span></div>
        </>}
        <div className="flex justify-between gap-3 text-lg font-bold text-ink"><span>Total</span><span>{amount == null ? "Loading…" : formatUgx(amount)}</span></div>
      </section>
      {detail && !detail.order.rider_id && (
        <section className="home-card">
          {detail.order.matching_mode === "customer_selects" ? <ApplicantPicker orderId={id} onSelected={() => void load()} /> :
            <p className="text-sm text-ink-500">Finding your rider. You can choose your payment option while you wait.</p>}
        </section>
      )}
      {pending && <p role="status" className="rounded-xl bg-gold/10 p-4 text-sm">Approve the payment request on your phone. We’re waiting for confirmation. You will not be charged again.</p>}
      {!pending && ready && detail?.payments.some((p) => p.type === "collection" && p.status === "failed") && <p role="status" className="text-sm text-ink-500">Your previous payment did not complete. You can try again or choose another payment option.</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!online && <p role="alert" className="text-sm text-ink-500">Connect to the internet to continue.</p>}
      <button type="button" onClick={() => void pay()} disabled={disabled} className="min-h-14 w-full rounded-full bg-gold px-4 text-base font-bold text-ink-gold disabled:opacity-50">
        {busy ? "Please wait…" : pending ? "Waiting for payment" : method === "cash" ? "Continue with cash" : `Pay${amount == null ? "" : ` ${formatUgx(amount)}`}${method === "mobile_money" && network ? ` with ${mobileMoneyNetworkLabel(network)}` : ""}`}
      </button>
    </div>
  );
}
