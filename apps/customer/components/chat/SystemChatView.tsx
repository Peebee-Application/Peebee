"use client";

import type { WalletAlert } from "@peebee/shared";
import { ArrowLeft, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useTranslate } from "../../lib/i18n";
import { describeTxWhen } from "../../lib/wallet-when";

/** Peebee's own thread: money sent and money received, one conversation per person. */
export function SystemChatView({ onBack }: { onBack: () => void }) {
  const t = useTranslate();
  const [alerts, setAlerts] = useState<WalletAlert[] | null>(null);

  useEffect(() => {
    let live = true;
    api.getWalletAlerts().then((res) => { if (live) setAlerts(res.alerts); }).catch(() => { if (live) setAlerts([]); });
    api.markWalletAlertsRead().catch(() => undefined);
    return () => { live = false; };
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-cream pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center gap-3 border-b border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3 py-2.5">
          <button type="button" onClick={onBack} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-500" aria-label="Back">
            <ArrowLeft className="h-5 w-5" strokeWidth={2} aria-hidden />
          </button>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold text-ink"><Wallet className="h-5 w-5" aria-hidden /></span>
          <h1 className="min-w-0 flex-1 truncate text-base font-bold text-ink">{t("wallet_peebee")}</h1>
        </header>
        <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
          {alerts === null && <p className="text-sm text-ink-500">{t("wallet_loading")}</p>}
          {alerts?.length === 0 && <p className="text-sm text-ink-500">{t("wallet_no_alerts")}</p>}
          {alerts?.map((alert) => {
            const when = describeTxWhen(alert.createdAt);
            const time = when.kind === "today" ? t("wallet_today", { time: when.time }) : when.kind === "yesterday" ? t("wallet_yesterday") : when.kind === "weekday" ? t("wallet_tx_weekday", { day: when.day, time: when.time }) : when.label;
            return (
              <article key={alert.id} className="rounded-2xl bg-[rgb(var(--surface-card))] px-3 py-3 text-sm shadow-sm">
                <p className="font-extrabold text-ink">{alert.title}</p>
                <p className="mt-1 text-ink-500">{alert.body}</p>
                <p className="mt-2 text-xs text-ink-500">{time}</p>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
