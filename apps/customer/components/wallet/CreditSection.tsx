"use client";

import { MobileNumberPicker } from "../MobileNumberPicker";
import { formatUgx } from "../../lib/order-display";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";

type Credit = Awaited<ReturnType<typeof api.getCredit>>;
type Mine = Awaited<ReturnType<typeof api.getMyOffers>>;
type Referral = Awaited<ReturnType<typeof api.getReferral>>;
type Cashout = Awaited<ReturnType<typeof api.getCustomerWithdrawals>>;

const MODULE_NAMES: Record<string, string> = {
  ride_boda: "boda rides", ride_car: "car rides", delivery: "deliveries", food: "food", marketplace: "marketplace", pharmacy: "pharmacy", gas: "gas",
  laundry: "laundry", services: "services", learn: "Learn", work: "Work", talent: "Hire", taxipress: "Taxipress",
};

/**
 * Bonus credit, offers, invitations and (when an admin has opened it) cashing out — all in one place under the balance.
 * Each part appears only when it applies, so a customer with nothing of this sees nothing extra.
 */
export function CreditSection() {
  const [credit, setCredit] = useState<Credit | null>(null);
  const [mine, setMine] = useState<Mine | null>(null);
  const [referral, setReferral] = useState<Referral | null>(null);
  const [cashout, setCashout] = useState<Cashout | null>(null);
  const [copied, setCopied] = useState(false);
  const [friendCode, setFriendCode] = useState("");
  const [friendMessage, setFriendMessage] = useState<string | null>(null);
  const [wdAmount, setWdAmount] = useState("");
  const [wdPhone, setWdPhone] = useState("");
  const [wdMessage, setWdMessage] = useState<string | null>(null);
  const [wdBusy, setWdBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([api.getCredit(), api.getMyOffers(), api.getReferral(), api.getCustomerWithdrawals()]).then(([c, m, r, w]) => {
      if (!alive) return;
      if (c.status === "fulfilled") setCredit(c.value);
      if (m.status === "fulfilled") setMine(m.value);
      if (r.status === "fulfilled") setReferral(r.value);
      if (w.status === "fulfilled") setCashout(w.value);
    });
    return () => { alive = false; };
  }, []);

  const soonest = credit?.lots.find((l) => l.expires_at)?.expires_at ?? null;
  const spendOn = (credit?.spendableOn ?? []).map((m) => MODULE_NAMES[m] ?? m);

  async function applyFriendCode() {
    setFriendMessage(null);
    try {
      await api.applyReferral(friendCode.trim());
      setFriendMessage("Done — your first ride gets a welcome offer.");
      setFriendCode("");
    } catch (err) { setFriendMessage(errorMessage(err)); }
  }

  async function withdraw() {
    setWdBusy(true);
    setWdMessage(null);
    try {
      const res = await api.withdrawCustomerWallet({ amount: Number(wdAmount), msisdn: wdPhone.trim() });
      setWdMessage(res.status === "review" ? (res.message ?? "Your withdrawal is being checked.") : "On its way to your mobile money.");
      setWdAmount("");
      setCashout(await api.getCustomerWithdrawals());
    } catch (err) { setWdMessage(errorMessage(err)); }
    finally { setWdBusy(false); }
  }

  const showCredit = !!credit && credit.enabled && credit.balance > 0;
  const offers = mine?.offers ?? [];
  const showCashout = !!cashout?.enabled;
  if (!showCredit && offers.length === 0 && !referral?.enabled && !showCashout) return null;

  return (
    <div className="space-y-4">
      {showCredit && credit && (
        <section className="home-card space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Bonus credit</p>
          <p className="text-2xl font-bold text-ink">{formatUgx(credit.balance)}</p>
          <p className="text-sm text-ink-500">
            Spend it on {spendOn.length ? spendOn.join(", ") : "Peebee"}. It stays on Peebee and can&apos;t be withdrawn
            {soonest ? ` · the next part expires ${new Date(soonest.replace(" ", "T") + "Z").toLocaleDateString("en-UG", { day: "numeric", month: "short" })}` : ""}.
          </p>
        </section>
      )}

      {offers.length > 0 && (
        <section className="home-card space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Offers for you</p>
          <ul className="space-y-2">
            {offers.map((o) => (
              <li key={o.id} className="text-sm">
                <p className="font-bold text-ink">{o.name} <span className="font-normal text-ink-500">· {o.summary}</span></p>
                {o.description && <p className="text-ink-500">{o.description}</p>}
                {o.remaining != null && <p className="text-ink-500">{o.remaining} ride{o.remaining === 1 ? "" : "s"} left</p>}
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-500">They apply by themselves when you pay for a ride. Got a promo code? Enter it on the payment screen.</p>
        </section>
      )}

      {referral?.enabled && referral.code && (
        <section className="home-card space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Invite a friend</p>
          <p className="text-sm text-ink-500">Share your code. When your friend takes their first ride{referral.creditForFriend ? `, you get ${formatUgx(referral.creditForFriend)} of credit` : ""}.</p>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xl font-bold tracking-widest text-ink">{referral.code}</span>
            <button
              type="button"
              className="rounded-full bg-gold px-4 py-2 text-xs font-bold text-ink"
              onClick={() => { void navigator.clipboard?.writeText(referral.code ?? "").then(() => setCopied(true)).catch(() => undefined); }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          {(referral.invited ?? 0) > 0 && <p className="text-xs text-ink-500">{referral.invited} friend{referral.invited === 1 ? "" : "s"} joined with your code.</p>}
          <div className="flex items-center gap-2 pt-1">
            <input aria-label="A friend's code" value={friendCode} onChange={(e) => setFriendCode(e.target.value.toUpperCase())} placeholder="Have a friend's code?" maxLength={12} className="min-w-0 flex-1 rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-sm" />
            <button type="button" disabled={friendCode.trim().length < 4} onClick={() => void applyFriendCode()} className="rounded-xl bg-gold px-4 py-2.5 text-sm font-bold text-ink disabled:opacity-50">Use</button>
          </div>
          {friendMessage && <p className="text-sm text-ink-500" role="status">{friendMessage}</p>}
        </section>
      )}

      {showCashout && cashout && (
        <section className="home-card space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Cash out</p>
          <p className="text-sm text-ink-500">
            You can take out up to <strong className="text-ink">{formatUgx(cashout.allowed)}</strong> now.
            {cashout.lockDays ? ` Money you add stays in your wallet for ${cashout.lockDays} day${cashout.lockDays === 1 ? "" : "s"} first.` : ""} Bonus credit can&apos;t be withdrawn.
          </p>
          {cashout.allowed > 0 && (
            <div className="space-y-2">
              <input aria-label="Amount" inputMode="numeric" value={wdAmount} onChange={(e) => setWdAmount(e.target.value.replace(/[^\d]/g, ""))} placeholder="Amount (UGX)" className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-sm" />
              <MobileNumberPicker purpose="withdrawal" value={wdPhone} onChange={setWdPhone} />
              <button type="button" disabled={wdBusy || !wdAmount || wdPhone.trim().length < 6} onClick={() => void withdraw()} className="w-full rounded-xl bg-gold px-4 py-3 text-sm font-bold text-ink disabled:opacity-50">{wdBusy ? "Please wait…" : "Withdraw"}</button>
            </div>
          )}
          {wdMessage && <p className="text-sm text-ink-500" role="status">{wdMessage}</p>}
          {cashout.withdrawals.length > 0 && (
            <ul className="space-y-1 text-xs text-ink-500">
              {cashout.withdrawals.slice(0, 5).map((w) => <li key={w.id}>{formatUgx(w.amount)} · {w.status === "review" ? "being checked" : w.status}</li>)}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
