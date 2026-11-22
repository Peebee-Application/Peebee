"use client";

import type { SavedLocation, WalletLedgerEntry } from "@peebee/shared";
import { ArrowUpRight, Bell, HelpCircle, Pencil, MapPin } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { loadActivity, type Activity } from "../../lib/notification-activity";
import { useLanguage } from "../../lib/i18n";
import { useThemeMode, type ThemeMode } from "../../lib/theme";
import { walletTabHref } from "../../lib/wallet-tab";
import Link from "next/link";

function OpenButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="customer-drawer-open" onClick={onClick}>
      {label} <ArrowUpRight size={18} strokeWidth={2.2} aria-hidden />
    </button>
  );
}

function money(amount: number) {
  return `UGX ${Math.abs(amount).toLocaleString("en-UG")}`;
}

function ledgerTitle(row: WalletLedgerEntry) {
  if (row.merchant_name) return row.merchant_name;
  if (row.type === "transfer_out") return `Sent to ${row.counterparty_name ?? "someone"}`;
  if (row.type === "transfer_in") return row.counterparty_name ?? "Received";
  if (row.type === "topup") return "Top-up";
  if (row.type === "order_payment") return "Order";
  if (row.type === "refund") return "Refund";
  return row.note ?? row.type;
}

export function WalletPreview({ onOpen }: { onOpen: () => void }) {
  const [balance, setBalance] = useState<number | null>(null);
  const [tx, setTx] = useState<WalletLedgerEntry | null>(null);
  useEffect(() => {
    let live = true;
    api.getWallet().then((w) => {
      if (!live) return;
      setBalance(w.balance);
      setTx(w.ledger[0] ?? null);
    }).catch(() => {});
    return () => { live = false; };
  }, []);
  return (
    <div className="customer-preview">
      <p className="customer-preview-kicker">Your wallet</p>
      <div className="customer-preview-wallet-row">
        <div>
          <p className="customer-preview-balance">{balance == null ? "—" : money(balance)}</p>
          <p className="customer-preview-muted">Available balance</p>
        </div>
        <Link href={walletTabHref("topup")} className="customer-preview-topup">
          + Top up
        </Link>
      </div>
      <Link href={walletTabHref("transactions")} className="customer-preview-details">
        Details →
      </Link>
      {tx && (
        <div className="customer-preview-tx">
          <p className="customer-preview-muted">Recent transaction</p>
          <div className="customer-preview-tx-row">
            <span className="min-w-0 flex-1 truncate">{ledgerTitle(tx)}</span>
            <span className={`shrink-0 font-bold ${tx.amount > 0 ? "text-green" : ""}`}>
              {tx.amount > 0 ? "+" : "−"}{money(tx.amount)}
            </span>
          </div>
        </div>
      )}
      <OpenButton label="Open Wallet" onClick={onOpen} />
    </div>
  );
}

export function ProfilePreview({ onOpen }: { onOpen: () => void }) {
  const { user } = useAuth();
  const [places, setPlaces] = useState<SavedLocation[]>([]);
  useEffect(() => {
    let live = true;
    api.getLocations().then((res) => { if (live) setPlaces(res.locations); }).catch(() => {});
    return () => { live = false; };
  }, []);
  const initial = (user?.name?.trim()?.[0] ?? "P").toUpperCase();
  const labels = places.slice(0, 2).map((p) => p.label).filter(Boolean);
  return (
    <div className="customer-preview">
      <div className="customer-drawer-hero" style={{ paddingBottom: 8 }}>
        <span className="customer-preview-avatar" aria-hidden>{initial}</span>
        <span className="customer-drawer-hero-name">{user?.name ?? "—"}</span>
        {user?.phone && <span className="customer-drawer-hero-meta">{user.phone}</span>}
      </div>
      <button type="button" className="customer-preview-row" onClick={onOpen}>
        <Pencil size={16} strokeWidth={1.9} aria-hidden />
        <span className="flex-1 text-left">Display name</span>
        {user?.name && <span className="max-w-[45%] truncate text-xs text-ink-500">{user.name}</span>}
      </button>
      <button type="button" className="customer-preview-row" onClick={onOpen}>
        <MapPin size={16} strokeWidth={1.9} aria-hidden />
        <span className="flex-1 text-left">Saved places</span>
        {labels.length > 0 && <span className="max-w-[45%] truncate text-xs text-ink-500">{labels.join(", ")}</span>}
      </button>
      <OpenButton label="Open Profile" onClick={onOpen} />
    </div>
  );
}

export function NotificationsPreview({ onOpen }: { onOpen: () => void }) {
  const [items, setItems] = useState<Activity[] | null>(null);
  useEffect(() => {
    let live = true;
    loadActivity().then((next) => { if (live) setItems(next); }).catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, []);
  const unread = items?.length ?? 0;
  async function markAllRead() {
    await api.markWalletAlertsRead().catch(() => undefined);
    const next = await loadActivity().catch(() => []);
    setItems(next);
  }
  return (
    <div className="customer-preview">
      <div className="customer-preview-note-bar">
        <span className="customer-preview-unread">{items == null ? "Notifications" : `${unread} unread`}</span>
        {items && items.length > 0 && (
          <button type="button" className="customer-preview-mark" onClick={() => void markAllRead()}>
            Mark all read
          </button>
        )}
      </div>
      <ul className="customer-preview-list">
        {(items ?? []).slice(0, 3).map((item) => (
          <li key={item.id} className="customer-preview-note">
            <span className="customer-preview-dot" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold text-ink">{item.title}</span>
              <span className="block truncate text-xs text-ink-500">{item.detail}</span>
            </span>
          </li>
        ))}
        {items?.length === 0 && (
          <li className="flex items-center gap-2 text-sm text-ink-500">
            <Bell size={16} aria-hidden /> You&apos;re all caught up
          </li>
        )}
      </ul>
      <OpenButton label="Open Notifications" onClick={onOpen} />
    </div>
  );
}

const APPEARANCE: { mode: ThemeMode; label: string }[] = [
  { mode: "auto", label: "Auto" },
  { mode: "light", label: "Light" },
  { mode: "dark", label: "Dark" },
];

export function SettingsPreview({ onOpen }: { onOpen: () => void }) {
  const { mode, setMode } = useThemeMode();
  const { language, setLanguage } = useLanguage();
  return (
    <div className="customer-preview">
      <div>
        <p className="customer-preview-kicker">Appearance</p>
        <div className="customer-preview-seg" role="group" aria-label="Appearance">
          {APPEARANCE.map((opt) => (
            <button
              key={opt.mode}
              type="button"
              aria-pressed={mode === opt.mode}
              className={mode === opt.mode ? "is-on" : ""}
              onClick={() => setMode(opt.mode)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="customer-preview-kicker">Language</p>
        <div className="customer-preview-seg" role="group" aria-label="Language">
          <button type="button" aria-pressed={language === "en"} className={language === "en" ? "is-on" : ""} onClick={() => setLanguage("en")}>English</button>
          <button type="button" aria-pressed={language === "lg"} className={language === "lg" ? "is-on" : ""} onClick={() => setLanguage("lg")}>Luganda</button>
        </div>
      </div>
      <button type="button" className="customer-preview-row" onClick={onOpen}>
        <Bell size={16} strokeWidth={1.9} aria-hidden />
        <span className="flex-1 text-left">Push notifications</span>
        <span className="text-xs text-ink-500">On this device</span>
      </button>
      <button type="button" className="customer-preview-row" onClick={onOpen}>
        <HelpCircle size={16} strokeWidth={1.9} aria-hidden />
        <span className="flex-1 text-left">Help &amp; support</span>
        <span className="max-w-[45%] truncate text-xs text-ink-500">Ask the assistant or the team</span>
      </button>
      <OpenButton label="Open Settings" onClick={onOpen} />
    </div>
  );
}
