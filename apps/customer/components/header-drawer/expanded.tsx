"use client";

import type { WalletLedgerEntry } from "@peebee/shared";
import { BadgeDollarSign, BellRing, ChevronRight, LifeBuoy, LogOut, MessageCircle, Pencil, Shield, Truck, Wallet } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { useHeaderDrawer } from "../../lib/header-drawer";
import { useTranslate } from "../../lib/i18n";
import { loadActivity, type Activity } from "../../lib/notification-activity";
import { walletTabHref } from "../../lib/wallet-tab";
import { AppearanceSettings } from "../AppearanceSettings";
import { ChangePasswordPanel } from "../ChangePasswordPanel";
import { LanguageSettings } from "../LanguageSettings";
import { MatchingPreference } from "../MatchingPreference";
import { NotificationSettings } from "../NotificationSettings";
import { PracticeModeCard } from "../PracticeMode";
import { ProfilePhoto } from "../ProfilePhoto";
import { SavedLocations } from "../SavedLocations";
import { ChannelEntryCard } from "../channels/ChannelEntryCard";

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

function DrawerLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  const drawer = useHeaderDrawer();
  return (
    <Link href={href} className={className} onClick={() => drawer.close()}>
      {children}
    </Link>
  );
}

function DrawerEditProfile() {
  const { user, updateUser } = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { // eslint-disable-next-line react-hooks/set-state-in-effect -- keep the field in sync when the account name changes elsewhere
    setName(user?.name ?? "");
  }, [user?.name]);
  function cancel() {
    setName(user?.name ?? "");
    setMessage(null);
    setEditing(false);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!user) return;
    setBusy(true);
    setMessage(null);
    try {
      const saved = await api.updateMyDisplayName(name);
      updateUser({ ...user, name: saved.name });
      setMessage("Display name saved.");
      setEditing(false);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setMessage(null); setEditing(true); }}
        className="customer-drawer-edit"
      >
        Edit profile
        <Pencil className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
      </button>
    );
  }
  return (
    <form onSubmit={save} className="home-card space-y-3 text-left">
      <h2 className="text-sm font-semibold">Display name</h2>
      <input
        aria-label="Display name"
        autoComplete="name"
        placeholder="Your display name"
        required
        maxLength={80}
        value={name}
        disabled={busy}
        onChange={(event) => { setName(event.target.value); setMessage(null); }}
        className="w-full rounded-2xl border border-[var(--border-faint)]"
      />
      <div className="flex gap-2">
        <button type="button" onClick={cancel} disabled={busy} className="min-h-12 flex-1 rounded-full border border-[var(--border-faint)] font-bold text-ink disabled:opacity-50">Cancel</button>
        <button type="submit" disabled={busy || !name.trim() || name.trim() === user?.name} className="min-h-12 flex-1 rounded-full bg-gold font-bold text-ink-gold disabled:opacity-50">{busy ? "Saving…" : "Save display name"}</button>
      </div>
      {message && <p role="status" className="text-sm">{message}</p>}
    </form>
  );
}

export function ProfileExpanded() {
  const t = useTranslate();
  const { user, logout } = useAuth();
  const drawer = useHeaderDrawer();
  const initial = (user?.name?.trim()?.[0] ?? "P").toUpperCase();
  return (
    <div className="space-y-5 pb-2 pt-1">
      <h1 className="customer-drawer-title">Profile</h1>
      <section className="customer-drawer-hero">
        <span className="customer-drawer-avatar">
          <ProfilePhoto size="lg" initials={initial} />
        </span>
        <span className="customer-drawer-hero-name">{user?.name ?? "—"}</span>
        {user?.phone && <span className="customer-drawer-hero-meta">{user.phone}</span>}
        {user?.accountCode && <span className="customer-drawer-hero-id">Peebee ID · {user.accountCode}</span>}
        <DrawerEditProfile />
      </section>
      <div className="customer-drawer-stack">
        <button
          type="button"
          className="customer-drawer-row"
          onClick={() => drawer.openSection("wallet")}
        >
          <Wallet className="h-5 w-5 shrink-0 text-gold" strokeWidth={1.75} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="customer-drawer-row-label block">{t("nav_wallet")}</span>
            <span className="customer-drawer-row-sub block">Open your wallet</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-ink-500/60" strokeWidth={1.75} aria-hidden />
        </button>
        <div onClick={() => drawer.close()}>
          <ChannelEntryCard />
        </div>
      </div>
      <SavedLocations />
      {user?.role === "admin" && (
        <DrawerLink href="/admin" className="customer-drawer-row">
          <Shield className="h-5 w-5 shrink-0 text-green" strokeWidth={1.75} aria-hidden />
          <span className="customer-drawer-row-label flex-1">Rider verification (admin)</span>
          <ChevronRight className="h-4 w-4 shrink-0 text-ink-500/60" strokeWidth={1.75} aria-hidden />
        </DrawerLink>
      )}
      <button
        onClick={() => { drawer.close(); logout(); }}
        className="customer-drawer-logout"
      >
        <LogOut className="h-4 w-4" strokeWidth={2} aria-hidden />
        {t("log_out")}
      </button>
    </div>
  );
}

export function SettingsExpanded() {
  const drawer = useHeaderDrawer();
  return (
    <div className="space-y-5 pb-2 pt-1">
      <h1 className="customer-drawer-title">Settings</h1>
      <AppearanceSettings />
      <LanguageSettings />
      <NotificationSettings />
      <MatchingPreference />
      <Link
        href="/help"
        onClick={() => drawer.close()}
        className="customer-drawer-row"
      >
        <LifeBuoy className="h-5 w-5 shrink-0 text-gold" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="customer-drawer-row-label block">Help &amp; support</span>
          <span className="customer-drawer-row-sub block">Ask the assistant or talk to the team</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-ink-500/60" strokeWidth={1.75} aria-hidden />
      </Link>
      <PracticeModeCard role="customer" />
      <ChangePasswordPanel />
    </div>
  );
}

const ICON = { fee: BadgeDollarSign, message: MessageCircle, order: Truck, wallet: Wallet } as const;

export function NotificationsExpanded() {
  const [items, setItems] = useState<Activity[] | null>(null);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const drawer = useHeaderDrawer();

  function reload() {
    return loadActivity().then(setItems).catch(() => setItems([]));
  }

  useEffect(() => {
    let cancelled = false;
    loadActivity().then((next) => { if (!cancelled) setItems(next); }).catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, []);

  const unreadCount = items?.length ?? 0;
  const visible = filter === "unread" ? (items ?? []).slice() : items;

  async function markWalletRead() {
    await api.markWalletAlertsRead().catch(() => undefined);
    await reload();
  }

  return (
    <div className="space-y-4 pb-2 pt-1">
      <h1 className="customer-drawer-title">Notifications</h1>
      <div className="customer-preview-note-bar">
        <span className="customer-preview-unread">{items == null ? "Notifications" : `${unreadCount} unread`}</span>
        {items && items.length > 0 && (
          <button type="button" className="customer-preview-mark" onClick={() => void markWalletRead()}>
            Mark all read
          </button>
        )}
      </div>
      <div className="customer-preview-seg" role="group" aria-label="Notification filter">
        <button type="button" aria-pressed={filter === "all"} className={filter === "all" ? "is-on" : ""} onClick={() => setFilter("all")}>All</button>
        <button type="button" aria-pressed={filter === "unread"} className={filter === "unread" ? "is-on" : ""} onClick={() => setFilter("unread")}>Unread</button>
      </div>
      <section className="space-y-2.5" aria-label="Activity">
        {items === null && <div className="home-card h-[70px] animate-pulse !rounded-2xl" aria-busy="true" aria-label="Loading" />}
        {visible?.length === 0 && (
          <div className="customer-drawer-row">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold/15 text-gold"><BellRing className="h-5 w-5" strokeWidth={1.9} aria-hidden /></span>
            <span>
              <span className="customer-drawer-row-label block">You&apos;re all caught up</span>
              <span className="customer-drawer-row-sub block">New messages and order updates will show up here.</span>
            </span>
          </div>
        )}
        {visible && visible.length > 0 && (
          <ul className="space-y-2.5">
            {visible.map((item) => {
              const Icon = ICON[item.kind];
              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    onClick={() => drawer.close()}
                    className="customer-drawer-row"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold/15 text-gold">
                      <Icon className="h-5 w-5" strokeWidth={1.9} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="customer-drawer-row-label block truncate">{item.title}</span>
                      <span className="customer-drawer-row-sub block truncate">{item.detail}</span>
                    </span>
                    <span className="customer-preview-dot" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

export function WalletExpanded() {
  const [balance, setBalance] = useState<number | null>(null);
  const [tx, setTx] = useState<WalletLedgerEntry[]>([]);
  useEffect(() => {
    let live = true;
    api.getWallet().then((w) => {
      if (!live) return;
      setBalance(w.balance);
      setTx(w.ledger.slice(0, 5));
    }).catch(() => {});
    return () => { live = false; };
  }, []);
  return (
    <div className="customer-preview pb-2 pt-1">
      <p className="customer-preview-kicker">Your wallet</p>
      <div className="customer-preview-wallet-row">
        <div>
          <p className="customer-preview-balance">{balance == null ? "—" : money(balance)}</p>
          <p className="customer-preview-muted">Available balance</p>
        </div>
        <DrawerLink href={walletTabHref("topup")} className="customer-preview-topup">
          + Top up
        </DrawerLink>
      </div>
      <DrawerLink href={walletTabHref("transactions")} className="customer-preview-details">
        Details →
      </DrawerLink>
      {tx.length > 0 && (
        <div className="customer-preview-tx">
          <p className="customer-preview-muted">Recent transactions</p>
          {tx.map((row) => (
            <div key={row.id} className="customer-preview-tx-row">
              <span className="min-w-0 flex-1 truncate">{ledgerTitle(row)}</span>
              <span className={`shrink-0 font-bold ${row.amount > 0 ? "text-green" : ""}`}>
                {row.amount > 0 ? "+" : "−"}{money(row.amount)}
              </span>
            </div>
          ))}
        </div>
      )}
      <DrawerLink href="/wallet" className="customer-drawer-open">
        Open Wallet
      </DrawerLink>
    </div>
  );
}
