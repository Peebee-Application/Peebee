"use client";

import { Select } from "@peebee/shared/select";

import type { CustomerWallet, CustomerWalletSummary, WalletLedgerEntry, WalletShares, WalletUsageReport } from "@peebee/shared";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  Users,
  Wallet as WalletIcon,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BottomDrawer } from "../../components/BottomDrawer";
import { MobileNumberPicker } from "../../components/MobileNumberPicker";
import { SwipeToConfirm } from "../../components/SwipeToConfirm";
import { api, errorMessage } from "../../lib/api";
import { useTranslate } from "../../lib/i18n";
import { useNetworkStatus } from "../../lib/use-network-status";
import { formatDateTime, formatUgx } from "../../lib/order-display";

const LEDGER_ICONS = {
  topup: ArrowDownLeft,
  order_payment: ArrowUpRight,
  refund: RotateCcw,
  adjustment: WalletIcon,
  transfer_out: ArrowUpRight,
  transfer_in: ArrowDownLeft,
} as const;

const LEDGER_LABELS: Record<string, string> = {
  topup: "Top-up",
  order_payment: "Order payment",
  refund: "Refund",
  adjustment: "Adjustment",
};

function ledgerLabel(entry: WalletLedgerEntry): string {
  if (entry.type === "transfer_out") return `Sent to ${entry.counterparty_name ?? "another customer"}`;
  if (entry.type === "transfer_in") return `Received from ${entry.counterparty_name ?? "another customer"}`;
  return LEDGER_LABELS[entry.type] ?? entry.type;
}

const SHARE_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  active: "Active",
  revoked: "Revoked",
  declined: "Declined",
};

const SUGGESTED_WALLET_NAMES_FALLBACK = ["Family Expenses", "Office Supplies", "Personal Savings", "Travel Fund"];

export default function WalletPage() {
  const t = useTranslate();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [wallet, setWallet] = useState<CustomerWallet | null>(null);
  const [amount, setAmount] = useState("");
  const [msisdn, setMsisdn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingTopupId, setPendingTopupId] = useState<string | null>(null);
  const online = useNetworkStatus();

  // Multiple named wallets — "primary" is the original wallet (the one
  // `wallet` above is always about); everything else is a real wallet the
  // customer created. Selecting one swaps which wallet the balance card,
  // activity list, and usage report below are showing.
  const [wallets, setWallets] = useState<CustomerWalletSummary[]>([]);
  const [suggestedNames, setSuggestedNames] = useState<string[]>(SUGGESTED_WALLET_NAMES_FALLBACK);
  const [maxWallets, setMaxWallets] = useState(5);
  const [selectedWalletId, setSelectedWalletId] = useState("primary");
  const [secondaryLedger, setSecondaryLedger] = useState<WalletLedgerEntry[]>([]);
  const [report, setReport] = useState<WalletUsageReport | null>(null);
  const [reportPeriod, setReportPeriod] = useState<"week" | "month" | "all">("month");

  const [showCreateWallet, setShowCreateWallet] = useState(false);
  const [newWalletName, setNewWalletName] = useState("");
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const [showMoveFunds, setShowMoveFunds] = useState(false);
  const [moveFrom, setMoveFrom] = useState("primary");
  const [moveTo, setMoveTo] = useState("");
  const [moveAmount, setMoveAmount] = useState("");
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

  const loadWallets = useCallback(() => {
    api
      .getWallets()
      .then((res) => {
        setWallets(res.wallets);
        setSuggestedNames(res.suggestedNames);
        setMaxWallets(res.maxWallets);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadWallets();
  }, [loadWallets]);

  useEffect(() => {
    if (selectedWalletId === "primary") {
      setSecondaryLedger([]);
      return;
    }
    api
      .getWalletLedger(selectedWalletId)
      .then((res) => setSecondaryLedger(res.ledger))
      .catch(() => setSecondaryLedger([]));
  }, [selectedWalletId]);

  useEffect(() => {
    api
      .getWalletReport(selectedWalletId, reportPeriod)
      .then(setReport)
      .catch(() => setReport(null));
  }, [selectedWalletId, reportPeriod]);

  const selectedWallet = wallets.find((w) => w.id === selectedWalletId);
  const activityLedger = selectedWalletId === "primary" ? (wallet?.ledger ?? []) : secondaryLedger;
  const canCreateWallet = wallets.length < maxWallets;

  async function submitCreateWallet(e: React.FormEvent) {
    e.preventDefault();
    if (!newWalletName.trim()) return;
    setWalletBusy(true);
    setWalletError(null);
    try {
      const res = await api.createWallet(newWalletName.trim());
      setNewWalletName("");
      setShowCreateWallet(false);
      loadWallets();
      setSelectedWalletId(res.wallet.id);
    } catch (err) {
      setWalletError(errorMessage(err));
    } finally {
      setWalletBusy(false);
    }
  }

  async function submitRename(id: string) {
    if (!renameValue.trim()) return;
    setWalletBusy(true);
    try {
      await api.renameWallet(id, renameValue.trim());
      setRenamingId(null);
      loadWallets();
    } catch (err) {
      setWalletError(errorMessage(err));
    } finally {
      setWalletBusy(false);
    }
  }

  async function deleteWallet(id: string) {
    setWalletBusy(true);
    setWalletError(null);
    try {
      await api.deleteWallet(id);
      if (selectedWalletId === id) setSelectedWalletId("primary");
      loadWallets();
    } catch (err) {
      setWalletError(errorMessage(err));
    } finally {
      setWalletBusy(false);
    }
  }

  async function submitMoveFunds(e: React.FormEvent) {
    e.preventDefault();
    const parsedAmount = Number(moveAmount);
    if (!moveTo) {
      setMoveError("Choose a destination wallet.");
      return;
    }
    if (moveFrom === moveTo) {
      setMoveError("Choose two different wallets.");
      return;
    }
    if (!parsedAmount || parsedAmount <= 0) {
      setMoveError("Enter an amount to move.");
      return;
    }
    setMoveBusy(true);
    setMoveError(null);
    try {
      await api.transferBetweenWallets({ fromWalletId: moveFrom, toWalletId: moveTo, amount: parsedAmount });
      setMoveAmount("");
      setShowMoveFunds(false);
      load();
      loadWallets();
    } catch (err) {
      setMoveError(errorMessage(err));
    } finally {
      setMoveBusy(false);
    }
  }

  const [showSend, setShowSend] = useState(false);
  const [sendRecipient, setSendRecipient] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sendNote, setSendNote] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);

  const [shares, setShares] = useState<WalletShares | null>(null);
  const [showShareInvite, setShowShareInvite] = useState(false);
  const [shareRecipient, setShareRecipient] = useState("");
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .getWallet()
      .then(setWallet)
      .catch(() => {});
  }, []);

  const loadShares = useCallback(() => {
    api
      .getWalletShares()
      .then(setShares)
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    loadShares();
  }, [load, loadShares]);

  // Returning from a hosted checkout (Flutterwave) — resume polling for
  // whichever top-up sent them there.
  useEffect(() => {
    const returned = searchParams.get("topup_return");
    if (returned) {
      setPendingTopupId(returned);
      router.replace("/wallet");
    }
  }, [searchParams, router]);

  useEffect(() => {
    if (!pendingTopupId) return;
    const interval = setInterval(() => {
      api
        .refreshTopup(pendingTopupId)
        .then((res) => {
          if (res.topup.status !== "pending") {
            setPendingTopupId(null);
            load();
          }
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, [pendingTopupId, load]);

  async function submitTopup(e: React.FormEvent) {
    e.preventDefault();
    const parsedAmount = Number(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      setError("Enter an amount to top up.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.topUpWallet({ amount: parsedAmount, msisdn: msisdn || undefined });
      if (res.redirectUrl) {
        window.location.href = res.redirectUrl;
        return;
      }
      setPendingTopupId(res.topupId);
      setAmount("");
      setMsisdn("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const [recipientCategory, setRecipientCategory] = useState<"all" | "shared" | "recent">("all");

  const frequentRecipients = useMemo(() => {
    const list: { id: string; name: string; target: string; type: "shared" | "recent"; subtitle: string }[] = [];
    shares?.granted.forEach((g) => {
      list.push({
        id: `g-${g.id}`,
        name: g.grantee_name,
        target: g.grantee_name,
        type: "shared",
        subtitle: "Staff / Family",
      });
    });
    shares?.received.forEach((r) => {
      list.push({
        id: `r-${r.id}`,
        name: r.owner_name,
        target: r.owner_name,
        type: "shared",
        subtitle: "Shared Pool",
      });
    });
    wallet?.ledger.forEach((entry) => {
      if (entry.type === "transfer_out" && entry.counterparty_name) {
        if (!list.some((it) => it.name.toLowerCase() === entry.counterparty_name?.toLowerCase())) {
          list.push({
            id: `l-${entry.id}`,
            name: entry.counterparty_name,
            target: entry.counterparty_name,
            type: "recent",
            subtitle: "Recent Transfer",
          });
        }
      }
    });
    return list;
  }, [shares, wallet]);

  const filteredRecipients = useMemo(() => {
    if (recipientCategory === "shared") return frequentRecipients.filter((r) => r.type === "shared");
    if (recipientCategory === "recent") return frequentRecipients.filter((r) => r.type === "recent");
    return frequentRecipients;
  }, [frequentRecipients, recipientCategory]);

  async function executeTransfer(): Promise<void> {
    const parsedAmount = Number(sendAmount);
    if (!sendRecipient.trim()) {
      setSendError("Enter the recipient's phone number or email.");
      throw new Error("Missing recipient");
    }
    if (!parsedAmount || parsedAmount <= 0) {
      setSendError("Enter an amount to send.");
      throw new Error("Invalid amount");
    }
    setSendBusy(true);
    setSendError(null);
    try {
      const res = await api.transferWallet({
        recipient: sendRecipient.trim(),
        amount: parsedAmount,
        note: sendNote.trim() || undefined,
      });
      setSendSuccess(`Sent ${formatUgx(parsedAmount)} to ${res.recipientName}.`);
      setSendRecipient("");
      setSendAmount("");
      setSendNote("");
      setShowSend(false);
      load();
    } catch (err) {
      setSendError(errorMessage(err));
      throw err;
    } finally {
      setSendBusy(false);
    }
  }

  async function submitShareInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!shareRecipient.trim()) {
      setShareError("Enter the person's phone number or email.");
      return;
    }
    setShareBusy(true);
    setShareError(null);
    try {
      await api.shareWallet({
        recipient: shareRecipient.trim(),
        walletId: selectedWalletId === "primary" ? undefined : selectedWalletId,
      });
      setShareRecipient("");
      setShowShareInvite(false);
      loadShares();
    } catch (err) {
      setShareError(errorMessage(err));
    } finally {
      setShareBusy(false);
    }
  }

  async function respondShare(id: string, action: "accept" | "decline" | "revoke") {
    setRespondingId(id);
    try {
      if (action === "accept") await api.acceptWalletShare(id);
      else if (action === "decline") await api.declineWalletShare(id);
      else await api.revokeWalletShare(id);
      loadShares();
    } catch {
      // Best-effort — a stale row just won't reflect the action; the next reload fixes it.
    } finally {
      setRespondingId(null);
    }
  }

  if (!wallet) {
    return <div className="p-4 text-sm text-ink-500">{t("wallet_loading")}</div>;
  }

  const pctUsed = wallet.cap > 0 ? Math.min(100, Math.round((wallet.balance / wallet.cap) * 100)) : 0;

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <h1 className="text-xl font-bold text-ink">{t("wallet_title")}</h1>

      {/* Wallet switcher — up to 5 total (the original + up to 4 named ones) */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        {wallets.map((w) => (
          <button
            key={w.id}
            type="button"
            onClick={() => setSelectedWalletId(w.id)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold ${
              selectedWalletId === w.id ? "border-gold bg-gold/10 text-ink" : "border-[var(--border-faint)] text-ink-500"
            }`}
          >
            {w.name}
          </button>
        ))}
        {canCreateWallet && (
          <button
            type="button"
            onClick={() => setShowCreateWallet(true)}
            className="flex shrink-0 items-center gap-1 rounded-full border border-dashed border-[var(--border-faint)] px-3 py-1.5 text-xs font-bold text-ink-500"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
            {t("wallet_add")}
          </button>
        )}
      </div>

      <section className="home-card space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              {selectedWallet?.name ?? t("wallet_main")}
            </p>
            {renamingId === selectedWalletId ? (
              <div className="mt-1 flex items-center gap-2">
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  maxLength={40}
                  className="min-w-0 flex-1 rounded-lg border border-[var(--border-faint)] px-2 py-1 text-sm outline-none focus:border-gold"
                />
                <button
                  type="button"
                  onClick={() => submitRename(selectedWalletId)}
                  disabled={walletBusy}
                  className="shrink-0 text-xs font-bold text-gold"
                >
                  {t("wallet_save")}
                </button>
                <button type="button" onClick={() => setRenamingId(null)} className="shrink-0 text-xs font-semibold text-ink-500">
                  {t("cancel")}
                </button>
              </div>
            ) : (
              <p className="text-3xl font-bold text-ink">{formatUgx(selectedWallet?.balance ?? wallet.balance)}</p>
            )}
          </div>
          {renamingId !== selectedWalletId && (
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={() => {
                  setRenamingId(selectedWalletId);
                  setRenameValue(selectedWallet?.name ?? "");
                }}
                aria-label="Rename wallet"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgb(var(--surface-muted))] text-ink-500"
              >
                <Pencil className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              </button>
              {selectedWalletId !== "primary" && (selectedWallet?.balance ?? 0) === 0 && (
                <button
                  type="button"
                  onClick={() => deleteWallet(selectedWalletId)}
                  disabled={walletBusy}
                  aria-label="Delete wallet"
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-red-50 text-red-600 disabled:opacity-60"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                </button>
              )}
            </div>
          )}
        </div>
        {walletError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{walletError}</p>}
        {selectedWalletId === "primary" && (
          <div className="space-y-1">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[rgb(var(--surface-muted))]">
              <div className="h-full rounded-full bg-gold" style={{ width: `${pctUsed}%` }} />
            </div>
            <p className="text-xs text-ink-500">
              Up to {formatUgx(wallet.cap)} {wallet.verified ? "(verified account)" : "(verify your phone or email to raise this)"}
            </p>
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            setMoveFrom(selectedWalletId);
            setMoveTo(wallets.find((w) => w.id !== selectedWalletId)?.id ?? "");
            setShowMoveFunds(true);
          }}
          disabled={wallets.length < 2}
          className="flex min-h-10 w-full items-center justify-center gap-1.5 rounded-full border border-[var(--border-faint)] text-sm font-bold text-ink disabled:opacity-50"
        >
          <ArrowLeftRight className="h-4 w-4" strokeWidth={2} aria-hidden />
          {t("wallet_move_funds")}
        </button>
      </section>

      {selectedWalletId === "primary" && (
      <section className="home-card space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">{t("wallet_top_up_heading")}</h2>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {pendingTopupId ? (
          <div className="flex items-center gap-3 py-2">
            <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-gold border-t-transparent" />
            <p className="text-sm text-ink-500">{t("wallet_confirming_topup")}</p>
          </div>
        ) : (
          <form onSubmit={submitTopup} className="space-y-2">
            {!online && (
              <p className="rounded-lg bg-gold/10 px-3 py-2 text-xs font-semibold text-ink-500">
                {t("wallet_offline_topup")}
              </p>
            )}
            <input
              required
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="Amount (UGX)"
              className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
            />
            <MobileNumberPicker purpose="payment" value={msisdn} onChange={setMsisdn} />
            <button
              type="submit"
              disabled={busy || !online || !msisdn.trim()}
              className="min-h-12 w-full rounded-full bg-gold px-4 text-base font-bold text-ink-gold shadow-[0_4px_12px_rgba(201,162,39,0.35)] disabled:opacity-60"
            >
              {busy ? t("wallet_starting") : t("wallet_top_up_heading")}
            </button>
          </form>
        )}
      </section>
      )}

      {selectedWalletId === "primary" && (
      <section className="home-card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink">{t("wallet_send_transfer_heading")}</h2>
            <p className="text-xs text-ink-500">{t("wallet_send_transfer_subtitle")}</p>
          </div>
          {!showSend && (
            <button
              type="button"
              onClick={() => {
                setShowSend(true);
                setSendSuccess(null);
              }}
              disabled={!online}
              className="flex items-center gap-1.5 rounded-full bg-gold px-3.5 py-1.5 text-xs font-bold text-ink-gold shadow-sm disabled:opacity-50 active:scale-95 transition-transform"
            >
              <Send className="h-3.5 w-3.5 stroke-[2.2]" aria-hidden />
              {t("send")}
            </button>
          )}
        </div>

        {/* Avatar-Driven Frequent Recipient Carousel / Grid */}
        <div className="space-y-2">
          <div className="flex items-center gap-3 overflow-x-auto scrollbar-none py-1 -mx-1 px-1">
            {/* New recipient avatar */}
            <button
              type="button"
              onClick={() => {
                setShowSend(true);
                setSendRecipient("");
              }}
              className="flex flex-col items-center gap-1.5 shrink-0 group"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-dashed border-gold/60 bg-gold/10 text-gold group-hover:scale-105 transition-transform">
                <Plus className="h-5 w-5 stroke-[2.5]" />
              </div>
              <span className="text-[11px] font-semibold text-ink-500 truncate max-w-[56px]">{t("wallet_new_recipient")}</span>
            </button>

            {/* Frequent / Shared contact avatars */}
            {filteredRecipients.map((rec) => {
              const isSelected = sendRecipient.toLowerCase() === rec.target.toLowerCase();
              return (
                <button
                  key={rec.id}
                  type="button"
                  onClick={() => {
                    setSendRecipient(rec.target);
                    setShowSend(true);
                  }}
                  className="flex flex-col items-center gap-1.5 shrink-0 group"
                >
                  <div
                    className={`flex h-12 w-12 items-center justify-center rounded-full transition-all text-sm font-extrabold ${
                      isSelected
                        ? "bg-gold text-ink-gold ring-2 ring-gold ring-offset-2 scale-105 shadow-[var(--shadow-glow-gold)]"
                        : "bg-[rgb(var(--surface-muted))] text-ink hover:bg-gold/20"
                    }`}
                  >
                    {rec.name.slice(0, 2).toUpperCase()}
                  </div>
                  <span className="text-[11px] font-bold text-ink truncate max-w-[62px]">
                    {rec.name.split(" ")[0]}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Segmented Switch: All vs Shared Wallets vs Recent */}
          <div className="flex rounded-full bg-[rgb(var(--surface-muted))] p-1">
            {(["all", "shared", "recent"] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setRecipientCategory(cat)}
                className={`flex-1 rounded-full py-1 text-[11px] font-bold transition-all ${
                  recipientCategory === cat
                    ? "glass-panel text-ink shadow-sm"
                    : "text-ink-500 hover:text-ink"
                }`}
              >
                {cat === "all" ? t("wallet_contacts_all") : cat === "shared" ? t("wallet_contacts_shared") : t("wallet_contacts_recent")}
              </button>
            ))}
          </div>
        </div>

        {/* Transfer Drawer / Form */}
        {showSend && (
          <div className="space-y-3 pt-2 border-t border-[var(--border-faint)] animate-drawer-in">
            {sendError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{sendError}</p>}
            <input
              required
              value={sendRecipient}
              onChange={(e) => setSendRecipient(e.target.value)}
              placeholder="Recipient phone or email"
              className="w-full rounded-xl border border-[var(--border-faint)] glass-panel px-3 py-2.5 text-[15px] outline-none focus:border-gold"
            />
            <div className="relative flex items-center">
              <span className="pointer-events-none absolute left-3 text-xs font-bold text-ink-500">UGX</span>
              <input
                required
                inputMode="numeric"
                value={sendAmount}
                onChange={(e) => setSendAmount(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="Amount to send"
                className="w-full rounded-xl border border-[var(--border-faint)] glass-panel py-2.5 pl-12 pr-3 text-[15px] font-semibold text-ink outline-none focus:border-gold"
              />
            </div>
            <input
              value={sendNote}
              onChange={(e) => setSendNote(e.target.value.slice(0, 140))}
              placeholder="Note (e.g. Groceries or rent share)"
              className="w-full rounded-xl border border-[var(--border-faint)] glass-panel px-3 py-2.5 text-[15px] outline-none focus:border-gold"
            />

            <div className="space-y-2 pt-1">
              <SwipeToConfirm
                label={t("wallet_slide_to_transfer")}
                confirmedLabel={t("wallet_transferring")}
                onConfirm={executeTransfer}
                disabled={sendBusy || !online || !sendRecipient.trim() || !sendAmount}
              />
              <button
                type="button"
                onClick={() => {
                  setShowSend(false);
                  setSendError(null);
                }}
                className="w-full py-1.5 text-center text-xs font-semibold text-ink-500 hover:text-ink"
              >
                {t("cancel")}
              </button>
            </div>
          </div>
        )}
      </section>
      )}

      <section className="home-card space-y-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-ink-500" strokeWidth={2} aria-hidden />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
            {t("wallet_share_heading")} &ldquo;{selectedWallet?.name ?? t("wallet_main")}&rdquo;
          </h2>
        </div>

        {shares && shares.received.filter((r) => r.status === "pending").length > 0 && (
          <div className="space-y-2">
            {shares.received
              .filter((r) => r.status === "pending")
              .map((r) => (
                <div key={r.id} className="space-y-2 rounded-xl border border-[var(--border-faint)] p-3">
                  <p className="text-sm text-ink">
                    <span className="font-bold">{r.owner_name}</span> wants to share their &ldquo;{r.wallet_name}&rdquo;
                    wallet with you.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => respondShare(r.id, "decline")}
                      disabled={respondingId === r.id}
                      className="min-h-9 flex-1 rounded-full border border-[var(--border-faint)] text-xs font-bold text-ink disabled:opacity-60"
                    >
                      {t("decline")}
                    </button>
                    <button
                      type="button"
                      onClick={() => respondShare(r.id, "accept")}
                      disabled={respondingId === r.id}
                      className="min-h-9 flex-1 rounded-full bg-gold text-xs font-bold text-ink-gold disabled:opacity-60"
                    >
                      {t("accept")}
                    </button>
                  </div>
                </div>
              ))}
          </div>
        )}

        {shares && shares.received.filter((r) => r.status === "active").length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-ink-500">{t("wallet_shared_with_you")}</p>
            {shares.received
              .filter((r) => r.status === "active")
              .map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-faint)] p-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-ink">
                      {r.owner_name} · {r.wallet_name}
                    </span>
                    <span className="block text-xs text-ink-500">
                      {r.owner_balance != null ? `${formatUgx(r.owner_balance)} available` : t("wallet_active")}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => respondShare(r.id, "revoke")}
                    disabled={respondingId === r.id}
                    className="shrink-0 rounded-full bg-[rgb(var(--surface-muted))] px-3 py-1.5 text-xs font-bold text-ink disabled:opacity-60"
                  >
                    {t("wallet_stop")}
                  </button>
                </div>
              ))}
          </div>
        )}

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-ink-500">{t("wallet_shared_with_others")}</p>
            {!showShareInvite && (
              <button
                type="button"
                onClick={() => setShowShareInvite(true)}
                disabled={!online}
                className="text-xs font-bold text-gold disabled:opacity-50"
              >
                + {t("wallet_share_yours")}
              </button>
            )}
          </div>
          {shares && shares.granted.length === 0 && !showShareInvite && (
            <p className="text-xs text-ink-500">{t("wallet_not_shared_anyone")}</p>
          )}
          {shares?.granted.map((g) => (
            <div key={g.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-faint)] p-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-ink">
                  {g.grantee_name} · {g.wallet_name}
                </span>
                <span className="block text-xs text-ink-500">{SHARE_STATUS_LABELS[g.status] ?? g.status}</span>
              </span>
              {(g.status === "pending" || g.status === "active") && (
                <button
                  type="button"
                  onClick={() => respondShare(g.id, "revoke")}
                  disabled={respondingId === g.id}
                  className="shrink-0 rounded-full bg-[rgb(var(--surface-muted))] px-3 py-1.5 text-xs font-bold text-ink disabled:opacity-60"
                >
                  {t("wallet_revoke")}
                </button>
              )}
            </div>
          ))}
          {showShareInvite && (
            <form onSubmit={submitShareInvite} className="space-y-2 pt-1">
              {shareError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{shareError}</p>}
              <input
                required
                value={shareRecipient}
                onChange={(e) => setShareRecipient(e.target.value)}
                placeholder="Their phone or email"
                className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowShareInvite(false);
                    setShareError(null);
                  }}
                  className="min-h-10 flex-1 rounded-full border border-[var(--border-faint)] text-xs font-bold text-ink"
                >
                  {t("cancel")}
                </button>
                <button
                  type="submit"
                  disabled={shareBusy || !online}
                  className="min-h-10 flex-[2] rounded-full bg-gold text-xs font-bold text-ink-gold disabled:opacity-60"
                >
                  {shareBusy ? t("wallet_inviting") : t("wallet_send_invite")}
                </button>
              </div>
            </form>
          )}
        </div>
      </section>

      <section className="home-card space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">{t("wallet_usage_report")}</h2>
          <div className="flex rounded-full bg-[rgb(var(--surface-muted))] p-1">
            {(["week", "month", "all"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setReportPeriod(p)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-bold capitalize ${
                  reportPeriod === p ? "glass-panel text-ink shadow-sm" : "text-ink-500"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        {report ? (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-green/10 px-2 py-2.5">
              <p className="text-xs text-ink-500">{t("wallet_in")}</p>
              <p className="text-sm font-bold text-green">{formatUgx(report.totalIn)}</p>
            </div>
            <div className="rounded-xl bg-[rgb(var(--surface-muted))] px-2 py-2.5">
              <p className="text-xs text-ink-500">{t("wallet_out")}</p>
              <p className="text-sm font-bold text-ink">{formatUgx(report.totalOut)}</p>
            </div>
            <div className="rounded-xl bg-gold/10 px-2 py-2.5">
              <p className="text-xs text-ink-500">{t("wallet_net")}</p>
              <p className="text-sm font-bold text-ink">{formatUgx(report.net)}</p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-ink-500">{t("wallet_no_activity")}</p>
        )}
      </section>

      <section className="space-y-2.5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">{t("wallet_activity_heading")}</h2>
        {activityLedger.length === 0 && <p className="py-6 text-center text-sm text-ink-500">{t("wallet_no_activity_yet")}</p>}
        <ul className="space-y-2">
          {activityLedger.map((entry) => {
            const Icon = LEDGER_ICONS[entry.type] ?? WalletIcon;
            const isCredit = entry.amount > 0;
            return (
              <li key={entry.id} className="home-card flex items-center gap-3 !rounded-2xl !px-3 !py-3">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                    isCredit ? "bg-green/15 text-green" : "bg-[rgb(var(--surface-muted))] text-ink-500"
                  }`}
                >
                  <Icon className="h-4 w-4" strokeWidth={2} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-ink">{ledgerLabel(entry)}</span>
                  <span className="block truncate text-xs text-ink-500">
                    {formatDateTime(entry.created_at)}
                    {entry.actor_name ? ` · by ${entry.actor_name}` : ""}
                  </span>
                </span>
                <span className={`shrink-0 text-sm font-bold ${isCredit ? "text-green" : "text-ink"}`}>
                  {isCredit ? "+" : ""}
                  {formatUgx(entry.amount)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Full-Screen Vibrant Green Flash Success Overlay */}
      {sendSuccess && (
        <div
          onClick={() => setSendSuccess(null)}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-green p-6 text-white cursor-pointer select-none animate-drawer-in"
          style={{ animationDuration: "350ms" }}
        >
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/20 mb-5 shadow-lg">
            <Check className="h-10 w-10 text-white stroke-[3.5]" />
          </div>
          <h3 className="text-2xl font-black tracking-tight text-white mb-2">{t("wallet_transfer_confirmed")}</h3>
          <p className="text-base font-semibold text-white/95 text-center max-w-xs mb-8">{sendSuccess}</p>
          <span className="rounded-full bg-white/25 px-5 py-2 text-xs font-extrabold uppercase tracking-wider text-white shadow-sm">
            {t("wallet_tap_to_close")}
          </span>
        </div>
      )}

      <BottomDrawer isOpen={showCreateWallet} onClose={() => setShowCreateWallet(false)} title={t("wallet_new_wallet_title")}>
        <form onSubmit={submitCreateWallet} className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {suggestedNames.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setNewWalletName(name)}
                className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                  newWalletName === name ? "border-gold bg-gold/10 text-ink" : "border-[var(--border-faint)] text-ink-500"
                }`}
              >
                {name}
              </button>
            ))}
          </div>
          <input
            required
            value={newWalletName}
            onChange={(e) => setNewWalletName(e.target.value.slice(0, 40))}
            placeholder={t("wallet_type_own_name")}
            className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
          />
          {walletError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{walletError}</p>}
          <button
            type="submit"
            disabled={walletBusy || !newWalletName.trim()}
            className="min-h-11 w-full rounded-full bg-gold px-4 text-sm font-bold text-ink-gold disabled:opacity-60"
          >
            {walletBusy ? t("wallet_creating") : t("wallet_create_wallet")}
          </button>
        </form>
      </BottomDrawer>

      <BottomDrawer isOpen={showMoveFunds} onClose={() => setShowMoveFunds(false)} title={t("wallet_move_funds_title")}>
        <form onSubmit={submitMoveFunds} className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink-500">{t("wallet_from")}</label>
            <Select aria-label={t("wallet_from")}
              value={moveFrom}
              onValueChange={(value) => setMoveFrom(value)}
              className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
            >
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} · {formatUgx(w.balance)}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink-500">{t("wallet_to")}</label>
            <Select aria-label={t("wallet_to")}
              value={moveTo}
              onValueChange={(value) => setMoveTo(value)}
              className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
            >
              <option value="">{t("wallet_choose_wallet")}</option>
              {wallets
                .filter((w) => w.id !== moveFrom)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
            </Select>
          </div>
          <input
            required
            inputMode="numeric"
            value={moveAmount}
            onChange={(e) => setMoveAmount(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="Amount (UGX)"
            className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
          />
          {moveError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{moveError}</p>}
          <button
            type="submit"
            disabled={moveBusy || !moveTo || !moveAmount}
            className="min-h-11 w-full rounded-full bg-gold px-4 text-sm font-bold text-ink-gold disabled:opacity-60"
          >
            {moveBusy ? t("wallet_moving") : t("wallet_move_funds")}
          </button>
        </form>
      </BottomDrawer>
    </div>
  );
}
