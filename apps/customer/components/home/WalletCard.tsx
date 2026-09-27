"use client";

import type { CustomerWallet, WalletShares } from "@tuma/shared";
import { ArrowUpRight, ShieldCheck, UserCheck, Users, Wallet as WalletIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useTranslate } from "../../lib/i18n";
import { formatUgx } from "../../lib/order-display";

export function WalletCard() {
  const t = useTranslate();
  const [wallet, setWallet] = useState<CustomerWallet | null>(null);
  const [shares, setShares] = useState<WalletShares | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getWallet().catch(() => null), api.getWalletShares().catch(() => null)]).then(
      ([w, s]) => {
        if (cancelled) return;
        if (w) setWallet(w);
        if (s) setShares(s);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, clientWidth } = scrollRef.current;
    const index = Math.round(scrollLeft / (clientWidth * 0.82));
    setActiveIndex(index);
  };

  const scrollToCard = (index: number) => {
    if (!scrollRef.current) return;
    const { clientWidth } = scrollRef.current;
    scrollRef.current.scrollTo({
      left: index * (clientWidth * 0.84),
      behavior: "smooth",
    });
    setActiveIndex(index);
  };

  if (!wallet) return null;

  const activeReceived = shares?.received.filter((r) => r.status === "active") ?? [];
  const activeGranted = shares?.granted.filter((g) => g.status === "active" || g.status === "pending") ?? [];
  const totalCards = 1 + activeReceived.length + (activeGranted.length > 0 ? 1 : 0);

  return (
    <div className="space-y-2">
      {/* Horizontal Edge-Peeking Snap Carousel */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex gap-3 overflow-x-auto snap-x snap-mandatory scrollbar-none -mx-4 px-4 py-1"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {/* Card 1: Primary Personal MoMo Wallet */}
        <div className="snap-start w-[84vw] max-w-[320px] shrink-0 rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4 shadow-sm hover:border-gold/30 transition-all flex flex-col justify-between">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
                <WalletIcon className="h-4.5 w-4.5" strokeWidth={2} aria-hidden />
              </span>
              <div>
                <span className="block text-[11px] font-bold uppercase tracking-wider text-ink-500">
                  {t("wallet_escrow_title")}
                </span>
                <span className="flex items-center gap-1 text-[11px] font-semibold text-green">
                  <ShieldCheck className="h-3 w-3" />
                  {t("wallet_protected")}
                </span>
              </div>
            </div>
            <Link
              href="/wallet"
              className="flex items-center gap-1 text-xs font-bold text-gold hover:underline"
            >
              {t("wallet_top_up")}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="mt-3 flex items-baseline justify-between">
            <div>
              <span className="text-xl font-extrabold text-ink tracking-tight">
                {formatUgx(wallet.balance)}
              </span>
              <span className="block text-[10px] text-ink-500">
                {t("wallet_cap")}: {formatUgx(wallet.cap)} {wallet.verified ? `· ${t("wallet_verified")}` : ""}
              </span>
            </div>
            <Link
              href="/wallet"
              className="rounded-full bg-[rgb(var(--surface-muted))] px-2.5 py-1 text-[11px] font-bold text-ink hover:bg-gold/20 transition-colors"
            >
              {t("wallet_details")} →
            </Link>
          </div>
        </div>

        {/* Card 2..N: Secondary Shared Wallets Received (Family/Staff Allowance) */}
        {activeReceived.map((share) => (
          <div
            key={share.id}
            className="snap-start w-[84vw] max-w-[320px] shrink-0 rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4 shadow-sm hover:border-gold/30 transition-all flex flex-col justify-between"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green/15 text-green">
                  <Users className="h-4.5 w-4.5" strokeWidth={2} aria-hidden />
                </span>
                <div>
                  <span className="block text-[11px] font-bold uppercase tracking-wider text-ink-500 truncate max-w-[130px]">
                    {share.owner_name}
                  </span>
                  <span className="rounded-full bg-green/15 px-2 py-0.2 text-[10px] font-bold text-green">
                    {t("wallet_family_pool")}
                  </span>
                </div>
              </div>
              <span className="text-[11px] font-semibold text-ink-500">{t("wallet_active")}</span>
            </div>

            <div className="mt-3 flex items-baseline justify-between">
              <div>
                <span className="text-xl font-extrabold text-ink tracking-tight">
                  {share.owner_balance != null ? formatUgx(share.owner_balance) : t("wallet_shared_balance_hidden")}
                </span>
                <span className="block text-[10px] text-ink-500">{t("wallet_available_for_orders")}</span>
              </div>
              <Link
                href="/wallet"
                className="rounded-full bg-[rgb(var(--surface-muted))] px-2.5 py-1 text-[11px] font-bold text-ink hover:bg-gold/20 transition-colors"
              >
                {t("wallet_manage")}
              </Link>
            </div>
          </div>
        ))}

        {/* Card Granted: Shared Wallets Managed by You */}
        {activeGranted.length > 0 && (
          <div className="snap-start w-[84vw] max-w-[320px] shrink-0 rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4 shadow-sm hover:border-gold/30 transition-all flex flex-col justify-between">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy/15 text-navy">
                  <UserCheck className="h-4.5 w-4.5" strokeWidth={2} aria-hidden />
                </span>
                <div>
                  <span className="block text-[11px] font-bold uppercase tracking-wider text-ink-500">
                    {t("wallet_staff_family_access")}
                  </span>
                  <span className="text-[10px] font-semibold text-ink-500">
                    {t("wallet_active_recipients", {
                      count: activeGranted.length,
                      plural: activeGranted.length > 1 ? "s" : "",
                    })}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs font-semibold text-ink-500">
                {activeGranted.map((g) => g.grantee_name).join(", ")}
              </span>
              <Link
                href="/wallet"
                className="rounded-full bg-[rgb(var(--surface-muted))] px-2.5 py-1 text-[11px] font-bold text-ink hover:bg-gold/20 transition-colors"
              >
                {t("wallet_settings")}
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* Pagination Indicator Dots */}
      {totalCards > 1 && (
        <div className="flex justify-center items-center gap-2 pt-1" role="tablist" aria-label="Wallet cards">
          {Array.from({ length: totalCards }).map((_, i) => (
            <button
              type="button"
              key={i}
              role="tab"
              aria-selected={activeIndex === i}
              aria-label={`Go to card ${i + 1} of ${totalCards}`}
              onClick={() => scrollToCard(i)}
              className={`h-2 rounded-full transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-gold/50 ${
                activeIndex === i ? "w-6 bg-gold" : "w-2 bg-[rgb(var(--color-ink-500)/0.25)] hover:bg-[rgb(var(--color-ink-500)/0.5)]"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
