"use client";

import type { WalletLedgerEntry } from "@peebee/shared";
import {
  MATCHING_MODE_DESCRIPTIONS,
  MATCHING_MODE_LABELS,
  type MatchingMode,
  exitPracticeMode,
  isPracticeJourneyComplete,
  isPracticeMode,
  launchPractice,
} from "@peebee/shared";
import {
  BadgeDollarSign,
  Bell,
  BellOff,
  BellRing,
  ChevronRight,
  Clapperboard,
  FlaskConical,
  KeyRound,
  LifeBuoy,
  LogOut,
  Map,
  MessageCircle,
  Pencil,
  Shield,
  Truck,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { useChannelsConfig } from "../../lib/channels";
import { useHeaderDrawer } from "../../lib/header-drawer";
import { useLanguage, useTranslate } from "../../lib/i18n";
import { useMapStylePref, type MapStylePref } from "../../lib/mapStyle";
import { loadActivity, type Activity } from "../../lib/notification-activity";
import { pushSupported, subscribeToPush } from "../../lib/push";
import { useThemeMode, type ThemeMode } from "../../lib/theme";
import { walletTabHref } from "../../lib/wallet-tab";
import { PasswordInput } from "../PasswordInput";
import { ProfilePhoto } from "../ProfilePhoto";
import { SavedLocations } from "../SavedLocations";

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

function Seg({
  label,
  value,
  options,
  onChange,
  hint,
  cols,
}: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
  hint?: string;
  cols?: 2 | 3 | 4;
}) {
  return (
    <div className="d-block">
      <div className="d-label">{label}</div>
      <div className={`d-seg${cols === 4 ? " is-4" : ""}`} role="group" aria-label={label}>
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            aria-pressed={value === opt.id}
            className={value === opt.id ? "is-on" : ""}
            onClick={() => onChange(opt.id)}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {hint ? <p className="d-hint">{hint}</p> : null}
    </div>
  );
}

const APPEARANCE: { id: ThemeMode; label: string; hint: string }[] = [
  { id: "auto", label: "Auto", hint: "Switches with the time of day" },
  { id: "light", label: "Light", hint: "Always light" },
  { id: "dark", label: "Dark", hint: "Always dark" },
];

const MAP_STYLE: { id: MapStylePref; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "normal", label: "Normal" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

function MapStyleBlock() {
  const { pref, setPref } = useMapStylePref();
  const [jawg, setJawg] = useState(false);
  useEffect(() => {
    api.getSettings().then((res) => setJawg(res.settings.mapsActiveProvider === "jawg")).catch(() => {});
  }, []);
  if (!jawg) return null;
  return (
    <div className="d-block">
      <div className="d-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Map size={14} strokeWidth={2} aria-hidden />
        Map style
      </div>
      <div className="d-seg is-4" role="group" aria-label="Map style">
        {MAP_STYLE.map((opt) => (
          <button
            key={opt.id}
            type="button"
            aria-pressed={pref === opt.id}
            className={pref === opt.id ? "is-on" : ""}
            onClick={() => setPref(opt.id)}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <p className="d-hint">Auto follows the app theme: a bright map by day, a dark one at night.</p>
    </div>
  );
}

function DrawerAppearanceSettings() {
  const { mode, setMode } = useThemeMode();
  const hint = APPEARANCE.find((o) => o.id === mode)?.hint;
  return (
    <>
      <Seg
        label="Appearance"
        value={mode}
        options={APPEARANCE}
        onChange={(id) => setMode(id as ThemeMode)}
        hint={hint}
      />
      <MapStyleBlock />
    </>
  );
}

function DrawerLanguage() {
  const { language, setLanguage } = useLanguage();
  return (
    <Seg
      label="Language"
      value={language}
      options={[
        { id: "en", label: "English" },
        { id: "lg", label: "Luganda" },
      ]}
      onChange={(id) => setLanguage(id as "en" | "lg")}
    />
  );
}

type PushState = "unsupported" | "default" | "granted" | "denied";

function DrawerPush() {
  const [state, setState] = useState<PushState>("unsupported");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !pushSupported() || typeof Notification === "undefined") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read the device permission once on mount
      setState("unsupported");
      return;
    }
    setState(Notification.permission as PushState);
  }, []);

  async function enable() {
    if (state !== "default" || busy) return;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission === "granted") await subscribeToPush();
      setState(typeof Notification === "undefined" ? "unsupported" : (Notification.permission as PushState));
    } finally {
      setBusy(false);
    }
  }

  const copy: Record<PushState, { title: string; hint: string; Icon: typeof Bell; on: boolean }> = {
    granted: { title: "Push notifications are on", hint: "You'll hear about new messages and order updates on this device.", Icon: BellRing, on: true },
    default: { title: "Push notifications are off", hint: "Turn them on to hear about new messages and order updates.", Icon: Bell, on: false },
    denied: { title: "Notifications are blocked", hint: "Allow notifications for Peebee in your browser or phone settings, then come back.", Icon: BellOff, on: false },
    unsupported: { title: "Not available on this device", hint: "Install Peebee to your home screen to get push notifications.", Icon: BellOff, on: false },
  };
  const { title, hint, Icon, on } = copy[state];
  const canToggle = state === "default" || state === "granted";

  return (
    <div className="d-push">
      <span className="d-ico"><Icon size={18} strokeWidth={2} aria-hidden /></span>
      <span className="min-w-0 flex-1">
        <span className="d-push-title block">{title}</span>
        <span className="d-push-hint block">{hint}</span>
      </span>
      {canToggle && (
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={title}
          disabled={busy || state === "granted"}
          className={`d-toggle${on ? " is-on" : ""}`}
          onClick={() => { if (!on) void enable(); }}
        />
      )}
    </div>
  );
}

function DrawerMatching() {
  const t = useTranslate();
  const { user, updateUser } = useAuth();
  const [enabledModes, setEnabledModes] = useState<MatchingMode[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.getSettings().then((res) => setEnabledModes(res.settings.enabledModes ?? [])).catch(() => {});
  }, []);
  if (enabledModes.length <= 1) return null;
  const current = user?.defaultMatchingMode ?? enabledModes[0];
  async function choose(mode: MatchingMode) {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateMatchingPreference(mode);
      updateUser({ ...user, defaultMatchingMode: mode });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="d-card d-match">
      <div className="d-label">{t("account_matching_heading")}</div>
      {enabledModes.map((mode) => (
        <button
          key={mode}
          type="button"
          disabled={busy}
          onClick={() => choose(mode)}
          aria-pressed={current === mode}
          className={`d-match-opt${current === mode ? " is-on" : ""}`}
        >
          <span className="d-radio" aria-hidden />
          <span>
            <span className="d-match-name block">{MATCHING_MODE_LABELS[mode]}</span>
            <span className="d-match-desc block">{MATCHING_MODE_DESCRIPTIONS[mode]}</span>
          </span>
        </button>
      ))}
      {error && <p className="d-hint" style={{ color: "#b91c1c" }}>{error}</p>}
    </div>
  );
}

function DrawerPractice() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [active, setActive] = useState(false);
  useEffect(() => {
    api.getSettings().then(({ settings }) => setAvailable(settings.practiceModeEnabled)).catch(() => setAvailable(false));
  }, []);
  useEffect(() => { // eslint-disable-next-line react-hooks/set-state-in-effect -- practice mode is stored outside React
    setActive(isPracticeMode());
  }, []);
  if (available == null) return null;
  if (active) {
    async function exit() {
      const completed = isPracticeJourneyComplete("customer");
      exitPracticeMode("customer");
      if (completed) await api.completePractice("customer").catch(() => undefined);
      window.location.replace("/");
    }
    return (
      <button type="button" onClick={() => void exit()} className="d-btn d-btn-outline" style={{ width: "100%" }}>
        Exit practice
      </button>
    );
  }
  return (
    <div className="d-practice">
      <div className="d-practice-head">
        <span className="d-practice-ico"><FlaskConical size={20} strokeWidth={2} aria-hidden /></span>
        <span>
          <span className="d-push-title block">Practice Mode</span>
          <span className="d-push-hint block">Practise inside the real customer app with safe sample data.</span>
        </span>
      </div>
      <p className="d-practice-note">The screens and controls are the same as live. No real orders, notifications, balances or payments are used.</p>
      <button
        type="button"
        disabled={!available}
        className="d-btn d-btn-sky"
        onClick={() => { void launchPractice("customer").then((path) => window.location.assign(path)); }}
      >
        {available ? "Open customer practice" : "Practice is currently unavailable"}
      </button>
    </div>
  );
}

function DrawerPassword() {
  const { user, setSession } = useAuth();
  const drawer = useHeaderDrawer();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!user) return null;
  if (!user.passwordSet) {
    return (
      <div className="d-card d-form">
        <div className="d-practice-head">
          <span className="d-ico"><KeyRound size={18} strokeWidth={1.75} aria-hidden /></span>
          <span className="d-push-title">Password</span>
        </div>
        <p className="d-hint">
          You signed in with Google, so there&apos;s no password on this account yet. Use{" "}
          <Link href="/forgot-password" className="font-bold" style={{ color: "var(--d-link)" }} onClick={() => drawer.close()}>
            forgot password
          </Link>
          {" "}to set one.
        </p>
      </div>
    );
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    if (newPassword !== confirmPassword) {
      setError("New passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.changePassword(currentPassword, newPassword);
      setSession(res.token, res.user);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="d-card d-form">
      <div className="d-practice-head">
        <span className="d-ico"><KeyRound size={18} strokeWidth={1.75} aria-hidden /></span>
        <span className="d-push-title">Change password</span>
      </div>
      <label className="d-block">
        <span className="d-field-label">Current password</span>
        <PasswordInput
          required
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className="d-field"
        />
      </label>
      <label className="d-block">
        <span className="d-field-label">New password</span>
        <PasswordInput
          required
          minLength={6}
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="d-field"
        />
      </label>
      <label className="d-block">
        <span className="d-field-label">Confirm new password</span>
        <PasswordInput
          required
          minLength={6}
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="d-field"
        />
      </label>
      {error && <p className="d-hint" style={{ color: "#b91c1c" }}>{error}</p>}
      {saved && <p className="d-hint" style={{ color: "#1b7a4e" }}>Password changed.</p>}
      <button type="submit" disabled={busy} className="d-btn d-btn-gold">{busy ? "Saving…" : "Update password"}</button>
      <p className="d-foot">Any other device you&apos;re signed in on will be signed out — this one stays signed in.</p>
    </form>
  );
}

function DrawerChannelRow() {
  const drawer = useHeaderDrawer();
  const { config } = useChannelsConfig();
  const [handle, setHandle] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!config?.enabled) return;
    api.myChannel().then((r) => setHandle(r.channel?.handle ?? null)).catch(() => setHandle(null));
  }, [config?.enabled]);
  if (!config?.enabled) return null;
  const label = handle ? `Creator Studio · @${handle}` : config.channelsOpen === false ? "Creator Studio" : "Start your channel";
  return (
    <Link href="/studio" className="d-row" onClick={() => drawer.close()}>
      <span className="d-ico"><Clapperboard size={18} strokeWidth={2} aria-hidden /></span>
      <span className="d-row-title flex-1">{label}</span>
      <ChevronRight className="d-chev" size={20} strokeWidth={2} aria-hidden />
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
      <button type="button" className="d-edit" onClick={() => { setMessage(null); setEditing(true); }}>
        Edit profile
        <Pencil size={14} strokeWidth={2.2} aria-hidden />
      </button>
    );
  }
  return (
    <form onSubmit={save} className="d-card d-form" style={{ width: "100%", textAlign: "left" }}>
      <div className="d-field-label">Display name</div>
      <input
        aria-label="Display name"
        autoComplete="name"
        placeholder="Your display name"
        required
        maxLength={80}
        value={name}
        disabled={busy}
        onChange={(event) => { setName(event.target.value); setMessage(null); }}
        className="d-field"
      />
      <div className="d-actions">
        <button type="button" onClick={cancel} disabled={busy} className="d-btn d-btn-outline">Cancel</button>
        <button type="submit" disabled={busy || !name.trim() || name.trim() === user?.name} className="d-btn d-btn-gold">{busy ? "Saving…" : "Save display name"}</button>
      </div>
      {message && <p className="d-hint">{message}</p>}
    </form>
  );
}

export function ProfileExpanded() {
  const t = useTranslate();
  const { user, logout } = useAuth();
  const drawer = useHeaderDrawer();
  const initial = (user?.name?.trim()?.[0] ?? "P").toUpperCase();
  return (
    <div className="d-stack">
      <h1 className="d-title">Profile</h1>
      <section className="d-hero">
        <ProfilePhoto size="lg" initials={initial} />
        <span className="d-hero-name">{user?.name ?? "—"}</span>
        {user?.phone && <span className="d-hero-meta">{user.phone}</span>}
        {user?.accountCode && <span className="d-hero-id">Peebee ID · {user.accountCode}</span>}
        <DrawerEditProfile />
      </section>
      <div className="d-card">
        <button type="button" className="d-row" onClick={() => drawer.openSection("wallet")}>
          <span className="d-ico"><Wallet size={18} strokeWidth={2} aria-hidden /></span>
          <span className="min-w-0 flex-1">
            <span className="d-row-title block">{t("nav_wallet")}</span>
            <span className="d-row-sub block">Open your wallet</span>
          </span>
          <ChevronRight className="d-chev" size={20} strokeWidth={2} aria-hidden />
        </button>
        <DrawerChannelRow />
      </div>
      <div className="d-saved">
        <SavedLocations />
      </div>
      {user?.role === "admin" && (
        <div className="d-card">
          <DrawerLink href="/admin" className="d-row">
            <span className="d-ico"><Shield size={18} strokeWidth={2} aria-hidden /></span>
            <span className="d-row-title flex-1">Rider verification (admin)</span>
            <ChevronRight className="d-chev" size={20} strokeWidth={2} aria-hidden />
          </DrawerLink>
        </div>
      )}
      <button
        type="button"
        onClick={() => { drawer.close(); logout(); }}
        className="d-logout"
      >
        <LogOut size={18} strokeWidth={2.2} aria-hidden />
        {t("log_out")}
      </button>
    </div>
  );
}

export function SettingsExpanded() {
  const drawer = useHeaderDrawer();
  return (
    <div className="d-stack">
      <h1 className="d-title">Settings</h1>
      <DrawerAppearanceSettings />
      <DrawerLanguage />
      <DrawerPush />
      <DrawerMatching />
      <div className="d-card">
        <Link href="/help" className="d-row" onClick={() => drawer.close()}>
          <span className="d-ico"><LifeBuoy size={18} strokeWidth={2} aria-hidden /></span>
          <span className="min-w-0 flex-1">
            <span className="d-row-title block">Help &amp; support</span>
            <span className="d-row-sub block">Ask the assistant or talk to the team</span>
          </span>
          <ChevronRight className="d-chev" size={20} strokeWidth={2} aria-hidden />
        </Link>
      </div>
      <DrawerPractice />
      <DrawerPassword />
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
    <div className="d-stack">
      <h1 className="d-title">Notifications</h1>
      <div className="d-note-bar">
        <span className="d-unread">{items == null ? "Notifications" : `${unreadCount} unread`}</span>
        {items && items.length > 0 && (
          <button type="button" className="d-mark" onClick={() => void markWalletRead()}>
            Mark all read
          </button>
        )}
      </div>
      <div className="d-seg" role="group" aria-label="Notification filter">
        <button type="button" aria-pressed={filter === "all"} className={filter === "all" ? "is-on" : ""} onClick={() => setFilter("all")}>All</button>
        <button type="button" aria-pressed={filter === "unread"} className={filter === "unread" ? "is-on" : ""} onClick={() => setFilter("unread")}>Unread</button>
      </div>
      {items === null && <div className="d-note" aria-busy="true" aria-label="Loading" style={{ minHeight: 70 }} />}
      {visible?.length === 0 && (
        <div className="d-note">
          <span className="d-ico"><BellRing size={18} strokeWidth={2} aria-hidden /></span>
          <span>
            <span className="d-note-title block">You&apos;re all caught up</span>
            <span className="d-note-copy block">New messages and order updates will show up here.</span>
          </span>
        </div>
      )}
      {visible && visible.length > 0 && visible.map((item) => {
        const Icon = ICON[item.kind];
        return (
          <Link key={item.id} href={item.href} onClick={() => drawer.close()} className="d-note">
            <span className="d-ico"><Icon size={18} strokeWidth={2} aria-hidden /></span>
            <span className="min-w-0 flex-1">
              <span className="d-note-title block">{item.title}</span>
              <span className="d-note-copy block">{item.detail}</span>
            </span>
            <span className="d-note-dot" aria-hidden />
          </Link>
        );
      })}
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
