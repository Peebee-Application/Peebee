"use client";

import type { RiderProSubscriptionView } from "@peebee/shared";
import { Crown } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";

const CADENCE_LABEL: Record<string, string> = { daily: "day", weekly: "week", monthly: "month" };

/**
 * Self-contained, mirrors ../app/account/page.tsx's SubscriptionCard: fetches
 * its own state, renders nothing when Pro isn't enabled at all, and polls
 * after a payment the same way (sandbox/mock mobile money has no webhook to
 * push a result back). Unlike the base subscription, both a recurring and a
 * one-time plan may be on offer at once — this shows one button per plan.
 */
export function ProSubscriptionCard() {
  const [subscription, setSubscription] = useState<RiderProSubscriptionView | null>(null);
  const [busyMode, setBusyMode] = useState<"recurring" | "once" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const polling = useRef(false);
  const pendingIdRef = useRef<string | null>(null);

  const load = useCallback(() => {
    return api.myRiderProSubscription().then((res) => {
      setSubscription(res.subscription);
      return res;
    });
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  useEffect(() => {
    const id = pendingIdRef.current;
    if (!id || polling.current) return;
    polling.current = true;
    const interval = setInterval(async () => {
      try {
        const res = await api.refreshProSubscriptionPayment(id);
        if (res.payment.status !== "pending") {
          pendingIdRef.current = null;
          await load();
        }
      } catch {
        // keep polling — a transient error shouldn't stop it
      }
    }, 4000);
    return () => {
      clearInterval(interval);
      polling.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscription, load]);

  async function pay(mode: "recurring" | "once") {
    setBusyMode(mode);
    setError(null);
    try {
      const res = await api.payProSubscription(mode);
      pendingIdRef.current = res.paymentId;
      polling.current = false; // let the effect above pick the new id up
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyMode(null);
    }
  }

  if (!subscription || !subscription.enabled) return null;

  if (subscription.current) {
    return (
      <section id="rider-pro" className="home-card flex items-center gap-3 !border-l-4 !border-l-green">
        <Crown className="h-5 w-5 shrink-0 text-green" strokeWidth={1.75} aria-hidden />
        <p className="text-sm text-ink-500">
          {subscription.mode === "once"
            ? "You're Pro for good — paid once, active forever."
            : subscription.paidThrough
              ? `Pro is active through ${new Date(subscription.paidThrough).toLocaleDateString()}.`
              : "Pro is active."}
        </p>
      </section>
    );
  }

  const isPending = !!pendingIdRef.current;
  const nothingOnOffer = !subscription.recurringEnabled && !subscription.onetimeEnabled;

  return (
    <section id="rider-pro" className="home-card space-y-2.5 !border-l-4 !border-l-gold">
      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Crown className="h-4 w-4 text-gold" strokeWidth={2} aria-hidden />
        {subscription.status === "past_due" ? "Your Pro payment failed" : "Go Pro"}
      </p>
      <p className="text-sm text-ink-500">Unlocks Luganda list reading, Stage Savings, and other Pro perks.</p>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {nothingOnOffer && <p className="text-xs text-ink-500">Not available to buy right now.</p>}
      <div className="space-y-2">
        {subscription.recurringEnabled && (
          <button
            onClick={() => pay("recurring")}
            disabled={busyMode !== null || isPending}
            className="min-h-11 w-full rounded-full bg-gold px-4 text-sm font-bold text-ink-gold disabled:opacity-60"
          >
            {isPending
              ? "Confirming…"
              : busyMode === "recurring"
                ? "Sending…"
                : `Subscribe — UGX ${subscription.recurringAmount.toLocaleString()}/${CADENCE_LABEL[subscription.recurringCadence]}`}
          </button>
        )}
        {subscription.onetimeEnabled && (
          <button
            onClick={() => pay("once")}
            disabled={busyMode !== null || isPending}
            className="min-h-11 w-full rounded-full border border-gold px-4 text-sm font-bold text-ink disabled:opacity-60"
          >
            {isPending
              ? "Confirming…"
              : busyMode === "once"
                ? "Sending…"
                : `Unlock forever — UGX ${subscription.onetimeAmount.toLocaleString()}`}
          </button>
        )}
      </div>
    </section>
  );
}
