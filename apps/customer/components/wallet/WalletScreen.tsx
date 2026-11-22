"use client";

import "./wallet.css";
import type { CardInput, CustomerWallet, CustomerWalletSummary, PaymentNextAction, PaymentOptions, WalletContact, WalletLedgerEntry, WalletMoneyRequest, WalletShares, WalletSpending } from "@peebee/shared";
import { ApiError } from "@peebee/shared";
import { ArrowDownToLine, ArrowLeftRight, BookUser, Check, ChevronDown, ChevronRight, Eye, EyeOff, Gift, HandHeart, Plus, Search, Send, Snowflake, Trash2, UserRoundPlus, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRegisterNavBack, useRegisterNavPrimaryAction } from "../../lib/nav-primary-action";
import { contactInputError, contactPicker, firstContact, type PickedContact } from "../../lib/wallet-contact";
import { parseWalletTab, getWalletTab, setWalletTab, subscribeWalletTab, walletTabHref, type WalletTab } from "../../lib/wallet-tab";
import { describeTxWhen } from "../../lib/wallet-when";
import { CardFields, CardHostedNote, CardPaymentSteps, cardFromForm, emptyCard, type CardForm } from "../CardPayment";
import { ConfirmationFooter } from "../ConfirmationFooter";
import { api, errorMessage } from "../../lib/api";
import { useTranslate, type TranslationKey } from "../../lib/i18n";
import { useNetworkStatus } from "../../lib/use-network-status";
import { backspace, commitExpr, emptyExpr, evalWhole, exprAmount, pressDigit, pressOp, type Expr, type Op } from "../../lib/wallet-calc";
import { CreditSection } from "./CreditSection";

type Tab = WalletTab;
type Sheet = null | "more" | "send" | "request" | "topup" | "cashout" | "move" | "rewards" | "tx" | "settings" | "contact" | "new" | "from" | "payreq";
type Person = { recipientId: string; name: string; maskedPhone: string };
type Result = null | { kind: "processing" | "success" | "failed"; title: string; detail?: string; amount?: number; account?: string };

const ERR: Record<string, TranslationKey> = {
  recipient_not_found: "wallet_err_not_found",
  insufficient_balance: "wallet_err_short",
  insufficient_wallet_balance: "wallet_err_short",
  account_frozen: "wallet_err_frozen",
  self_transfer: "wallet_err_self",
  recipient_cap_exceeded: "wallet_err_cap",
  shared_not_sendable: "wallet_err_shared",
};

function explain(err: unknown, t: (key: TranslationKey, params?: Record<string, string | number>) => string) {
  if (err instanceof ApiError && err.code && ERR[err.code]) return t(ERR[err.code]);
  return errorMessage(err);
}

function whole(n: number) {
  return Math.round(n).toLocaleString("en-UG");
}
function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase() || "?";
}
function accountLabel(name: string, isPrimary: boolean, t: (key: TranslationKey, params?: Record<string, string | number>) => string) {
  if (isPrimary && /^(main wallet|primary|main|main account)$/i.test(name.trim())) return t("wallet_main_account");
  if (/account$/i.test(name.trim())) return name.trim();
  return t("wallet_named_account", { name: name.trim() });
}
function tone(i: number) {
  return (["w-gold", "w-slate", "w-cream"] as const)[i % 3]!;
}
function newKey() {
  return globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const HIDDEN_KEY = "peebee-wallet-hidden";
function readHidden(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "{}") as Record<string, boolean>; } catch { return {}; }
}

function MerchantFace({ name, logo }: { name: string; logo: string | null }) {
  const [url, setUrl] = useState<string | null>(logo && !logo.startsWith("/v1/") ? logo : null);
  useEffect(() => {
    const match = logo?.match(/^\/v1\/restaurants\/([^/]+)\/logo/);
    if (!match) return;
    let dead = false;
    let object: string | undefined;
    api.restaurantLogoBlob(decodeURIComponent(match[1]!)).then((blob) => {
      if (dead) return;
      object = URL.createObjectURL(blob);
      setUrl(object);
    }).catch(() => undefined);
    return () => { dead = true; if (object) URL.revokeObjectURL(object); };
  }, [logo]);
  if (url) return <span aria-hidden className="block h-9 w-9 rounded-full bg-cover bg-center" style={{ backgroundImage: `url("${url}")` }} />;
  return <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gold/20 text-xs font-extrabold text-ink">{initials(name)}</span>;
}

function SheetFrame({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="w-scrim flex items-end" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="w-sheet w-sheet-in max-h-[92dvh] w-full overflow-y-auto px-5 pb-8 pt-3" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-white/20" />
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-[22px] font-extrabold">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function WalletScreen() {
  const t = useTranslate();
  const router = useRouter();
  const search = useSearchParams();
  const online = useNetworkStatus();
  const tab = useSyncExternalStore(subscribeWalletTab, getWalletTab, () => "central" as Tab);
  const [wallet, setWallet] = useState<CustomerWallet | null>(null);
  const [wallets, setWallets] = useState<CustomerWalletSummary[]>([]);
  const [features, setFeatures] = useState<CustomerWalletsResponseFeatures | null>(null);
  const [maxWallets, setMaxWallets] = useState(5);
  const [suggested, setSuggested] = useState<string[]>(["Home", "Office", "Travel"]);
  const [total, setTotal] = useState(0);
  const [shares, setShares] = useState<WalletShares | null>(null);
  const [contacts, setContacts] = useState<WalletContact[]>([]);
  const [requests, setRequests] = useState<WalletMoneyRequest[]>([]);
  const [incoming, setIncoming] = useState(0);
  const [spending, setSpending] = useState<WalletSpending | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [result, setResult] = useState<Result>(null);
  const [hidden, setHidden] = useState<Record<string, boolean>>(() => (typeof window === "undefined" ? {} : readHidden()));
  const [settingsFor, setSettingsFor] = useState<string>("primary");
  const [person, setPerson] = useState<Person | null>(null);
  const [fromId, setFromId] = useState("primary");
  const [expr, setExpr] = useState<Expr>(emptyExpr());
  const [note, setNote] = useState("");
  const [review, setReview] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [pressed, setPressed] = useState<string | null>(null);
  const [idemKey, setIdemKey] = useState("");
  const [payOptions, setPayOptions] = useState<PaymentOptions | null>(null);
  const [topAmount, setTopAmount] = useState("");
  const [msisdn, setMsisdn] = useState("");
  const [topMethod, setTopMethod] = useState<"mobile_money" | "card">("mobile_money");
  const [cardForm, setCardForm] = useState<CardForm>(emptyCard);
  const [cardStep, setCardStep] = useState<{ topupId: string; card: CardInput; action: PaymentNextAction } | null>(null);
  const [pendingTopup, setPendingTopup] = useState<string | null>(null);
  const [topError, setTopError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"all" | "saved" | "recent" | "shared" | "mine">("all");
  const [query, setQuery] = useState("");
  const [txQuery, setTxQuery] = useState("");
  const [txKind, setTxKind] = useState<"all" | "out" | "in">("all");
  const [contactQ, setContactQ] = useState("");
  const [nickname, setNickname] = useState("");
  const [pickedContact, setPickedContact] = useState<PickedContact | null>(null);
  const [manualContact, setManualContact] = useState(false);
  const [looked, setLooked] = useState<Person | null>(null);
  const [moveFrom, setMoveFrom] = useState("primary");
  const [moveTo, setMoveTo] = useState("");
  const [moveAmount, setMoveAmount] = useState("");
  const [newName, setNewName] = useState("");
  const [rename, setRename] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmUnfreeze, setConfirmUnfreeze] = useState(false);
  const [shareTo, setShareTo] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [cashAmount, setCashAmount] = useState("");
  const [cashPhone, setCashPhone] = useState("");
  const [cashInfo, setCashInfo] = useState<{ enabled: boolean; allowed: number; lockDays: number } | null>(null);
  const [payRequest, setPayRequest] = useState<WalletMoneyRequest | null>(null);
  const [requestAmount, setRequestAmount] = useState("");
  const [intoId, setIntoId] = useState("primary");
  const openedAccount = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [w, list, sh, ct, rq, sp] = await Promise.all([
        api.getWallet(),
        api.getWallets(),
        api.getWalletShares().catch(() => ({ granted: [], received: [] })),
        api.getWalletContacts().catch(() => ({ contacts: [], available: false })),
        api.getWalletRequests().catch(() => ({ requests: [], incomingOpen: 0, available: false })),
        api.getWalletSpending("month").catch(() => null),
      ]);
      setWallet(w);
      setWallets(list.wallets);
      setFeatures(list.features ?? null);
      setMaxWallets(list.maxWallets);
      setSuggested(list.suggestedNames);
      setTotal(list.total ?? list.wallets.reduce((s, a) => s + a.balance, 0));
      setShares(sh);
      setContacts(ct.contacts);
      setRequests(rq.requests);
      setIncoming(rq.incomingOpen);
      setSpending(sp);
    } catch (err) {
      setLoadError(explain(err, t));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load applies the server response
    void load();
    api.getPaymentOptions().then(setPayOptions).catch(() => undefined);
    api.getCustomerWithdrawals().then((c) => setCashInfo({ enabled: c.enabled, allowed: c.allowed, lockDays: c.lockDays ?? 0 })).catch(() => undefined);
  }, [load]);
  useEffect(() => {
    const id = search.get("topup_return");
    if (!id) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resume a hosted top-up from the return URL
    setPendingTopup(id);
    setSheet("topup");
    router.replace("/wallet");
  }, [search, router]);
  useEffect(() => {
    if (!pendingTopup) return;
    const timer = setInterval(() => {
      api.refreshTopup(pendingTopup).then((res) => { if (res.topup.status !== "pending") { setPendingTopup(null); void load(); } }).catch(() => undefined);
    }, 3000);
    return () => clearInterval(timer);
  }, [pendingTopup, load]);

  const main = wallets.find((w) => w.isPrimary) ?? wallets[0];
  const others = Math.max(0, wallets.length - 1);
  const from = wallets.find((w) => w.id === fromId) ?? main;
  const amount = exprAmount(expr);
  const chip = expr.op && expr.right ? evalWhole(expr) : null;
  const available = from?.balance ?? 0;
  const frozenFrom = !!from?.frozen;
  const over = amount != null && amount > available;

  function openTab(next: Tab) {
    setWalletTab(next);
    router.replace(walletTabHref(next), { scroll: false });
  }
  useEffect(() => {
    setWalletTab(parseWalletTab(search.get("tab")));
  }, [search]);
  useEffect(() => {
    // Home's account links open the existing detail/move sheets, never a new payment flow.
    const accountId = search.get("account");
    const action = search.get("action");
    const handoff = accountId ? `${accountId}:${action ?? "details"}` : null;
    if (!handoff) { openedAccount.current = null; return; }
    if (openedAccount.current === handoff || loading) return;
    const account = wallets.find(item => item.id === accountId);
    if (!account) return;
    openedAccount.current = handoff;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronize the existing sheet with an external account URL
    setSettingsFor(account.id);
    setRename(account.name);
    setFormError(null);
    if (action === "move" && !account.isPrimary && !account.frozen) {
      setMoveFrom(wallets.find(item => item.isPrimary)?.id ?? "primary");
      setMoveTo(account.id);
      setMoveAmount("");
      setSheet("move");
    } else setSheet("settings");
  }, [search, wallets, loading]);
  function hide(id: string) {
    const next = { ...hidden, [id]: !hidden[id] };
    setHidden(next);
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
  }
  function openSend(p: Person, source = fromId) {
    setPerson(p);
    setFromId(source);
    setExpr(emptyExpr());
    setNote("");
    setReview(false);
    setSendError(null);
    setIdemKey(newKey());
    setPayRequest(null);
    setSheet(null);
    openTab("send");
  }

  const recent: Person[] = useMemo(() => {
    const rows: Person[] = [];
    for (const entry of wallet?.ledger ?? []) {
      if (entry.type === "transfer_out" && entry.counterparty_id && entry.counterparty_name && !rows.some((r) => r.recipientId === entry.counterparty_id)) {
        rows.push({ recipientId: entry.counterparty_id, name: entry.counterparty_name, maskedPhone: entry.masked_phone ?? "" });
      }
    }
    return rows;
  }, [wallet]);

  const people = useMemo(() => {
    const saved = contacts.map((c) => ({ ...c, kind: "saved" as const, label: c.nickname || c.name }));
    const rec = recent.map((c) => ({ ...c, id: c.recipientId, kind: "recent" as const, label: c.name, nickname: null }));
    const sharedPeople = [
      ...(shares?.granted ?? []).filter((g) => g.status === "active" || g.status === "pending").map((g) => ({ recipientId: g.grantee_id, name: g.grantee_name, maskedPhone: g.masked_phone ?? "", id: g.id, kind: "shared" as const, label: g.grantee_name, nickname: null })),
      ...(shares?.received ?? []).filter((g) => g.status === "active").map((g) => ({ recipientId: g.owner_id, name: g.owner_name, maskedPhone: g.masked_phone ?? "", id: g.id, kind: "shared" as const, label: g.owner_name, nickname: null })),
    ];
    const all = [...saved, ...rec, ...sharedPeople];
    const unique = all.filter((p, i) => all.findIndex((o) => o.recipientId === p.recipientId) === i);
    const q = query.trim().toLowerCase();
    return unique.filter((p) => {
      if (filter === "saved" && p.kind !== "saved") return false;
      if (filter === "recent" && p.kind !== "recent") return false;
      if (filter === "shared" && p.kind !== "shared") return false;
      if (filter === "mine") return false;
      return !q || p.label.toLowerCase().includes(q) || p.maskedPhone.includes(q);
    });
  }, [contacts, recent, shares, filter, query]);

  async function submitSend() {
    if (!person || amount == null || busy || frozenFrom || over) return;
    setBusy(true);
    setResult({ kind: "processing", title: t("wallet_processing"), amount });
    setSheet(null);
    const key = idemKey || newKey();
    try {
      const body = { recipientId: person.recipientId, amount, note: note.trim() || undefined, fromWalletId: fromId, idempotencyKey: key };
      const res = payRequest ? await api.payWalletRequest(payRequest.id, { fromWalletId: fromId, idempotencyKey: key }) : await api.transferWallet(body);
      setResult({ kind: "success", title: t("wallet_sent_to", { name: res.recipientName ?? person.name }), amount, account: accountLabel(from?.name ?? "", !!from?.isPrimary, t), detail: res.balance != null ? whole(res.balance) : undefined });
      await load();
    } catch (err) {
      setResult({ kind: "failed", title: t("wallet_failed"), detail: explain(err, t) });
    } finally {
      setBusy(false);
    }
  }

  async function freeze(id: string, on: boolean) {
    setFormError(null);
    if (!on && !confirmUnfreeze) { setConfirmUnfreeze(true); return; }
    try {
      await api.setWalletFrozen(id, on, on ? undefined : true);
      setConfirmUnfreeze(false);
      await load();
    } catch (err) { setFormError(explain(err, t)); }
  }

  const ledger = (wallet?.ledger ?? []).filter((e) => {
    if (txKind === "out" && e.amount >= 0) return false;
    if (txKind === "in" && e.amount < 0) return false;
    const q = txQuery.trim().toLowerCase();
    if (!q) return true;
    return `${e.counterparty_name ?? ""} ${e.merchant_name ?? ""} ${e.note ?? ""} ${e.type}`.toLowerCase().includes(q);
  });

  const sending = (tab === "send" || sheet === "send") && !result;
  const sendReady = !!person && amount != null && !frozenFrom && !over;
  useRegisterNavPrimaryAction(
    result?.kind === "success"
      ? { label: t("wallet_done"), onClick: () => { setResult(null); setReview(false); openTab("central"); } }
      : sending && review && amount != null
        ? { label: t("wallet_swipe_send", { amount: whole(amount) }), confirmation: true, busy, disabled: busy, detail: `UGX ${whole(amount)}`, onClick: submitSend }
        : sending && !review
          ? { label: t("wallet_continue"), detail: amount ? `UGX ${whole(amount)}` : undefined, disabled: !sendReady, onClick: () => { setIdemKey(newKey()); setReview(true); } }
          : null,
  );
  useRegisterNavBack(!!result || (sending && review), () => {
    if (result) {
      const failed = result.kind === "failed";
      setResult(null);
      if (failed) setReview(true);
      else openTab("central");
      return;
    }
    setReview(false);
  }, 2);

  if (loading) return <div className="w-canvas p-6 text-sm opacity-70" aria-busy="true">{t("wallet_loading")}</div>;
  if (loadError || !wallet) {
    return (
      <div className="wallet-root w-canvas space-y-4 px-6 py-16 text-center">
        <p className="text-lg font-extrabold">{t("wallet_load_error")}</p>
        {loadError && <p className="text-sm text-ink-500">{loadError}</p>}
        <button type="button" onClick={() => { setLoading(true); void load(); }} className="w-pill w-pill-send mx-auto px-6">{t("wallet_retry")}</button>
      </div>
    );
  }

  const selected = wallets.find((w) => w.id === settingsFor) ?? main;
  const cardAvailable = !!payOptions?.card.available;
  const cardDirect = cardAvailable && !!payOptions?.card.direct;

  return (
    <div className="wallet-root w-canvas relative pb-4">
      {tab === "central" && (
        <div className="w-pop">
          <section className="w-highlight">
            <p className="w-kicker">{t("wallet_total_balance")}</p>
            <p className="mt-1 flex items-baseline gap-2"><span className="w-cur">UGX</span><span className="w-amt">{whole(total)}</span></p>
            <p className="mt-2 text-[12.5px] font-medium opacity-70">{accountLabel(main?.name ?? "Main", true, t).replace(/ account$/, "")} · {others === 1 ? t("wallet_other_account") : t("wallet_other_accounts", { count: others })}</p>
          </section>
          <div className="w-tilegrid">
            <button type="button" className="w-tile" onClick={() => { setPerson(null); setReview(false); setExpr(emptyExpr()); openTab("send"); }}>
              <span className="w-tile-icon"><Send size={20} /></span>
              <span className="w-tile-label">{t("send")}</span>
            </button>
            <button type="button" className="w-tile" onClick={() => { setTopError(null); openTab("topup"); }}>
              <span className="w-tile-icon"><Plus size={20} /></span>
              <span className="w-tile-label">{t("wallet_top_up")}</span>
            </button>
            {features?.requests !== false && (
              <button type="button" className="w-tile" onClick={() => { setPerson(null); setRequestAmount(""); setFormError(null); setSheet("request"); }}>
                <span className="w-tile-icon"><ArrowDownToLine size={20} /></span>
                <span className="w-tile-label">{t("wallet_request")}</span>
              </button>
            )}
            <button type="button" className="w-tile" onClick={() => router.push("/give")}>
              <span className="w-tile-icon"><HandHeart size={20} /></span>
              <span className="w-tile-label">{t("wallet_give_tab")}</span>
            </button>
          </div>
          <button type="button" className="w-card w-lift mx-4 mt-1 flex w-[calc(100%-2rem)] items-center gap-3 px-3.5 py-3 text-left" onClick={() => setSheet("rewards")}>
            <span className="flex h-8 w-8 items-center justify-center rounded-[11px] bg-gold/20 text-gold"><Gift size={18} /></span>
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold">{t("wallet_rewards")} <span className="font-medium" style={{ color: "rgba(250,248,239,0.62)" }}>· UGX {whole(wallet.credit ?? 0)}{incoming ? ` · ${incoming}` : ""}</span></span>
            <ChevronRight size={18} style={{ opacity: .6 }} />
          </button>
          <h2 className="w-section-title">{t("wallet_transactions")}</h2>
          <section className="w-card w-lift mx-4 w-[calc(100%-2rem)] px-4 pb-2 pt-1">
            <TxList rows={ledger.slice(0, 4)} t={t} />
          </section>
        </div>
      )}

      {tab === "accounts" && (
        <div className="w-pop">
          <section className="w-mast">
            <div className="w-hero-row">
              <h1 className="w-title">{t("wallet_accounts")}</h1>
              {wallets.length < maxWallets && <button type="button" className="w-new" onClick={() => { setNewName(""); setFormError(null); setSheet("new"); }}><Plus size={16} />{t("wallet_new_account")}</button>}
            </div>
            <p className="w-caption">{t("wallet_accounts_count", { count: wallets.length, total: whole(total) })}</p>
          </section>
          <div className="space-y-3 px-4 pt-1">
            {wallets.map((w, i) => (
              <article key={w.id} className={`w-acard ${tone(i)} ${w.frozen ? "w-frozen" : ""}`}>
                <div className="rings" aria-hidden>{[180, 130, 80].map((s) => <span key={s} style={{ width: s, height: s }} />)}</div>
                <p className="relative z-[2] text-base font-extrabold">{accountLabel(w.name, w.isPrimary, t)}</p>
                <p className="absolute right-[18px] top-4 z-[2] text-base font-extrabold">{hidden[w.id] ? "••••••" : <><small className="mr-1 text-[11px] opacity-60">UGX</small>{whole(w.balance)}</>}</p>
                <div className="absolute bottom-3.5 left-4 z-[2] flex gap-2">
                  <button type="button" aria-label={t("wallet_freeze")} className="w-round" onClick={() => { setSettingsFor(w.id); if (w.frozen) { setConfirmUnfreeze(true); setRename(w.name); setSheet("settings"); } else void freeze(w.id, true); }}><Snowflake size={16} /></button>
                  <button type="button" aria-label={t("wallet_account_settings")} className="w-round" onClick={() => { setSettingsFor(w.id); setRename(w.name); setConfirmDelete(false); setFormError(null); setSheet("settings"); }}>⚙</button>
                  <button type="button" aria-label={hidden[w.id] ? t("wallet_show_balance") : t("wallet_hide_balance")} className="w-round" onClick={() => hide(w.id)}>{hidden[w.id] ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                </div>
                <button type="button" className="absolute bottom-4 right-4 z-[2] flex items-center gap-2 text-[12.5px] font-extrabold" onClick={() => { setSettingsFor(w.id); if (w.frozen) { setConfirmUnfreeze(true); setRename(w.name); setSheet("settings"); } else void freeze(w.id, true); }} aria-pressed={!w.frozen}>
                  {w.frozen ? t("wallet_frozen") : t("wallet_active")}
                  <span className={`relative h-[30px] w-[50px] rounded-full ${w.frozen ? "bg-ink-500" : "bg-green"}`}><span className={`absolute top-[3px] h-6 w-6 rounded-full bg-white shadow ${w.frozen ? "left-[3px]" : "left-[23px]"}`} /></span>
                </button>
              </article>
            ))}
            <SharedBlock shares={shares} t={t} onAccept={async (id, action) => { if (action === "accept") await api.acceptWalletShare(id); else if (action === "decline") await api.declineWalletShare(id); else await api.revokeWalletShare(id); await load(); }} />
          </div>
        </div>
      )}

      {tab === "recipients" && (
        <div className="w-pop">
          <section className="w-mast">
            <div className="w-hero-row">
              <h1 className="w-title">{t("wallet_recipients")}</h1>
              <button type="button" className="w-new" onClick={() => { setContactQ(""); setNickname(""); setLooked(null); setPickedContact(null); setManualContact(true); setFormError(null); setSheet("contact"); }}><Plus size={16} />{t("wallet_add_contact")}</button>
            </div>
            <p className="w-caption">{people.length} saved</p>
          </section>
          <label className="w-search"><Search size={16} style={{ opacity: .55 }} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("wallet_search_contacts")} aria-label={t("wallet_search_contacts")} /></label>
          <section className="w-card w-lift mx-4 w-[calc(100%-2rem)] px-2 py-1">
            {filter === "mine" ? wallets.map((w) => (
              <button key={w.id} type="button" className="flex min-h-14 w-full items-center gap-3 border-b border-white/10 px-2 text-left last:border-0" onClick={() => { setMoveFrom(w.id); setMoveTo(wallets.find((o) => o.id !== w.id)?.id ?? ""); setSheet("move"); }}>
                <span className="font-bold">{accountLabel(w.name, w.isPrimary, t)}</span><span className="ml-auto text-sm font-extrabold">UGX {whole(w.balance)}</span>
              </button>
            )) : people.map((p) => (
              <button key={`${p.kind}-${p.recipientId}`} type="button" className="flex min-h-14 w-full items-center gap-3 border-b border-white/10 px-2 text-left last:border-0" onClick={() => openSend(p)}>
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gold text-xs font-extrabold text-ink">{initials(p.label)}</span>
                <span className="min-w-0"><b className="block truncate">{p.label}</b><span className="text-xs" style={{ color: "rgba(250,248,239,0.62)" }}>{p.maskedPhone}</span></span>
                <ChevronRight size={18} style={{ opacity: .5 }} className="ml-auto" />
              </button>
            ))}
            {people.length === 0 && filter !== "mine" && <p className="px-2 py-6 text-sm" style={{ color: "rgba(250,248,239,0.62)" }}>{t("wallet_no_contacts")}</p>}
          </section>
          <button type="button" className="w-cta mx-4 mt-4 w-[calc(100%-2rem)]" onClick={() => { setContactQ(""); setNickname(""); setLooked(null); setPickedContact(null); setManualContact(true); setFormError(null); setSheet("contact"); }}>
            <UserRoundPlus size={18} />{t("wallet_add_contact")}
          </button>
        </div>
      )}

      {tab === "transactions" && (
        <div className="w-pop">
          <section className="w-mast">
            <h1 className="w-title">{t("wallet_transactions")}</h1>
          </section>
          <div className="w-chiprow">
            {(["all", "in", "out"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setTxKind(k)} className={`w-filter ${txKind === k ? "on" : ""}`}>{t(k === "all" ? "wallet_all" : k === "in" ? "wallet_in" : "wallet_out")}</button>
            ))}
          </div>
          <GroupedTxList rows={ledger} t={t} />
        </div>
      )}

      {sheet === "more" && <SheetFrame title={t("wallet_more")} onClose={() => setSheet(null)}>
        {features?.requests !== false && <RowButton label={t("wallet_request")} hint={incoming ? String(incoming) : undefined} onClick={() => { setPerson(null); setRequestAmount(""); setFormError(null); setSheet("request"); }} />}
        {cashInfo?.enabled && <RowButton label={t("wallet_cash_out")} onClick={() => { setFormError(null); setSheet("cashout"); }} />}
        <RowButton label={t("wallet_move")} onClick={() => { setMoveFrom(fromId); setMoveTo(wallets.find((w) => w.id !== fromId)?.id ?? ""); setSheet("move"); }} />
      </SheetFrame>}

      {(sheet === "send" || tab === "send") && <div className="w-pop">
        <section className="w-mast">
          <h1 className="w-title">{person && review ? t("wallet_review_title") : t("send")}</h1>
        </section>
        <SendSteps stage={person && review ? "review" : "pay"} />
        <div className="px-4">
        {!person && (
          <div>
            <label className="w-search !mx-0"><Search size={16} style={{ opacity: .55 }} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("wallet_search_contacts")} aria-label={t("wallet_search_contacts")} /></label>
            <section className="w-card w-lift mt-3 w-full px-2 py-1">
              {people.map((p) => (
                <button key={`${p.kind}-${p.recipientId}`} type="button" className="flex min-h-14 w-full items-center gap-3 border-b border-white/10 px-2 text-left last:border-0" onClick={() => openSend(p)}>
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gold text-xs font-extrabold text-ink">{initials(p.label)}</span>
                  <span className="min-w-0"><b className="block truncate">{p.label}</b><span className="text-xs" style={{ color: "rgba(250,248,239,0.62)" }}>{p.maskedPhone}</span></span>
                  <ChevronRight size={18} style={{ opacity: .5 }} className="ml-auto" />
                </button>
              ))}
              {people.length === 0 && <p className="px-2 py-6 text-sm" style={{ color: "rgba(250,248,239,0.62)" }}>{t("wallet_no_contacts")}</p>}
            </section>
            <button type="button" className="w-cta mt-4 w-full" onClick={() => { setContactQ(""); setNickname(""); setLooked(null); setPickedContact(null); setManualContact(true); setFormError(null); setSheet("contact"); }}>
              <UserRoundPlus size={18} />{t("wallet_add_contact")}
            </button>
          </div>
        )}
        {person && !review && (
          <div className="space-y-3">
            <button type="button" className="w-pick" onClick={() => { setPerson(null); setReview(false); }}>
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gold text-sm font-extrabold text-ink">{initials(person.name)}</span>
              <span className="min-w-0 flex-1 text-left"><span className="w-pick-kicker">{t("wallet_to")}</span><b className="block truncate">{person.name}</b></span>
              <ChevronDown size={18} style={{ opacity: .55 }} />
            </button>
            <button type="button" className="w-pick" onClick={() => setSheet("from")}>
              <span className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-gold/20 text-gold"><Send size={18} aria-hidden /></span>
              <span className="min-w-0 flex-1 text-left"><span className="w-pick-kicker">{t("wallet_from_account")}</span><b className="block truncate">{accountLabel(from?.name ?? "", !!from?.isPrimary, t)} · UGX {whole(available)}</b></span>
              <ChevronDown size={18} style={{ opacity: .55 }} />
            </button>
            {frozenFrom && <p className="rounded-2xl bg-white/10 px-3 py-2 text-sm font-semibold">{t("wallet_frozen_banner", { name: accountLabel(from?.name ?? "", !!from?.isPrimary, t) })}</p>}
            <div className="w-amount-box">
              <span className="w-cur">UGX</span>
              <span className={`w-amt ${expr.left ? "" : "is-empty"}`}>{expr.op ? `${whole(Number(expr.left || 0))} ${expr.op} ${expr.right}` : expr.left ? whole(Number(expr.left)) : "0"}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {[10_000, 25_000, 50_000, 100_000].map((n) => (
                <button key={n} type="button" className={`w-amtchip ${!expr.op && Number(expr.left || 0) === n ? "on" : ""}`} onClick={() => setExpr({ left: String(n), op: null, right: "" })}>{whole(n)}</button>
              ))}
            </div>
            {chip != null && <button type="button" className="w-chip" onClick={() => setExpr(commitExpr(expr))}>= UGX {whole(chip)}</button>}
            <button type="button" className="text-sm font-semibold opacity-70" onClick={() => setExpr({ left: String(Math.max(0, Math.floor(available))), op: null, right: "" })}>{t("wallet_available", { amount: whole(available) })} · {t("wallet_use_max")}</button>
            {over && <div className="rounded-2xl bg-danger/10 px-3 py-2 text-sm font-semibold text-danger-ink">{t("wallet_over")} <button type="button" className="underline" onClick={() => setExpr({ left: String(Math.floor(available)), op: null, right: "" })}>{t("wallet_use_max")}</button> <button type="button" className="underline" onClick={() => { setSheet(null); openTab("topup"); }}>{t("wallet_top_up")}</button></div>}
            {sendError && <p className="text-sm text-danger-ink" role="alert">{sendError}</p>}
            <label className="w-infield"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} placeholder={t("wallet_note")} aria-label={t("wallet_note")} /></label>
            <div className="grid grid-cols-4 gap-2">{(["+", "−", "×", "÷"] as const).map((op) => { const next = (op === "−" ? "-" : op) as Op; return <button key={op} type="button" className={`w-op ${expr.op === next ? "on" : ""}`} onClick={() => setExpr(pressOp(expr, next))}>{op}</button>; })}</div>
            <div className="grid grid-cols-3 gap-2">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "⌫"].map((k) => (
                <button key={k} type="button" className={`w-key ${pressed === k ? "is-pressed" : ""}`} onPointerDown={() => setPressed(k)} onPointerUp={() => setPressed(null)} onClick={() => setExpr(k === "⌫" ? backspace(expr) : pressDigit(expr, k))}>{k}</button>
              ))}
            </div>
          </div>
        )}
        {person && review && amount != null && (
          <div className="w-card w-lift px-5 py-6 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gold text-lg font-extrabold text-ink">{initials(person.name)}</span>
            <p className="mt-3 flex items-baseline justify-center gap-2"><span className="w-cur">UGX</span><span className="w-amt" style={{ fontSize: 36 }}>{whole(amount)}</span></p>
            <p className="mt-1 opacity-70">to {person.name}</p>
            <div className="mt-5 space-y-1 text-left">
              <ReviewRow label={t("wallet_from_account")} value={accountLabel(from?.name ?? "", !!from?.isPrimary, t)} onEdit={() => { setReview(false); setSheet("from"); }} edit={t("wallet_edit")} />
              <ReviewRow label={t("wallet_fee")} value="UGX 0" />
              <ReviewRow label={t("wallet_balance_after")} value={`UGX ${whole(Math.max(0, available - amount))}`} />
            </div>
          </div>
        )}
      </div></div>}

      {sheet === "from" && <SheetFrame title={t("wallet_choose_account")} onClose={() => setSheet(null)}>
        {wallets.map((w) => {
          const sharedBlocked = false;
          const disabled = !!w.frozen || sharedBlocked;
          return <button key={w.id} type="button" disabled={disabled} className="flex min-h-14 w-full items-center justify-between border-b border-[var(--border-faint)] text-left disabled:opacity-40" onClick={() => { setFromId(w.id); setSheet(null); }}><span>{accountLabel(w.name, w.isPrimary, t)}{w.frozen ? ` · ${t("wallet_frozen")}` : ""}</span><span>UGX {whole(w.balance)}</span></button>;
        })}
        {(shares?.received ?? []).filter((s) => s.status === "active").map((s) => (
          <button key={s.id} type="button" disabled={!features?.sendFromShared || !s.wallet_id} className="flex min-h-14 w-full items-center justify-between text-left disabled:opacity-40" onClick={() => { if (s.wallet_id) setFromId(s.wallet_id); setSheet(null); }}><span>{s.wallet_name} · {s.owner_name}</span><span>{t("wallet_shared_balance_hidden")}</span></button>
        ))}
      </SheetFrame>}

      {sheet === "request" && <SheetFrame title={t("wallet_request")} onClose={() => setSheet(null)}>
        <RequestForm t={t} wallets={wallets} intoId={intoId} setIntoId={setIntoId} amount={requestAmount} setAmount={setRequestAmount} error={formError} busy={busy} requests={requests}
          onCreate={async (payer) => {
            setBusy(true); setFormError(null);
            try {
              await api.createWalletRequest({ recipientId: payer.recipientId, payer: payer.recipientId ? undefined : contactQ, amount: Number(requestAmount), intoWalletId: intoId, note: note || undefined });
              setSheet(null); await load();
            } catch (err) { setFormError(explain(err, t)); } finally { setBusy(false); }
          }}
          onPay={(r) => { setPayRequest(r); setPerson({ recipientId: r.recipientId, name: r.personName, maskedPhone: r.maskedPhone }); setExpr({ left: String(r.amount), op: null, right: "" }); setReview(true); setIdemKey(newKey()); setSheet(null); openTab("send"); }}
          onAct={async (id, act) => { if (act === "decline") await api.declineWalletRequest(id); else if (act === "later") await api.laterWalletRequest(id); else await api.cancelWalletRequest(id); await load(); }}
        />
      </SheetFrame>}

      {(sheet === "topup" || tab === "topup") && <SheetFrame title={t("wallet_top_up")} onClose={() => { setSheet(null); if (tab === "topup") openTab("central"); }}>
        <p className="mb-2 text-sm text-ink-500">{t("wallet_topup_main")}</p>
        {topError && <p className="mb-2 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger-ink" role="alert">{topError}</p>}
        {pendingTopup ? <p className="text-sm text-ink-500">{t("wallet_confirming_topup")}</p> : cardStep ? <CardPaymentSteps paymentId={cardStep.topupId} card={cardStep.card} initial={cardStep.action} onCancel={() => { setCardStep(null); setCardForm(emptyCard); }} onPending={() => { setPendingTopup(cardStep.topupId); setCardStep(null); setTopAmount(""); }} /> : (
          <form className="space-y-3" onSubmit={async (e) => {
            e.preventDefault();
            const parsed = Number(topAmount);
            if (!parsed) { setTopError(t("wallet_err_short")); return; }
            setBusy(true); setTopError(null);
            try {
              const useCard = topMethod === "card" && cardAvailable;
              const input = cardFromForm(cardForm);
              const res = await api.topUpWallet(useCard ? { amount: parsed, method: "card", ...(cardDirect && input ? { card: input } : {}) } : { amount: parsed, msisdn: msisdn || undefined });
              if (res.redirectUrl) { window.location.href = res.redirectUrl; return; }
              if (useCard && cardDirect && input && res.nextAction) { setCardStep({ topupId: res.topupId, card: input, action: res.nextAction }); return; }
              setPendingTopup(res.topupId); setTopAmount("");
            } catch (err) { setTopError(explain(err, t)); } finally { setBusy(false); }
          }}>
            {!online && <p className="rounded-xl bg-gold/10 px-3 py-2 text-xs font-semibold text-ink-500">{t("wallet_offline_topup")}</p>}
            <input inputMode="numeric" aria-label={t("wallet_top_up")} value={topAmount} onChange={(e) => setTopAmount(e.target.value.replace(/[^\d]/g, ""))} placeholder="UGX" className="w-full rounded-2xl" />
            {cardAvailable && <div className="flex gap-2"><button type="button" className={`flex-1 rounded-full py-2 text-sm font-bold ${topMethod === "mobile_money" ? "bg-ink text-cream" : "bg-[rgb(var(--surface-muted))]"}`} onClick={() => setTopMethod("mobile_money")}>Mobile money</button><button type="button" className={`flex-1 rounded-full py-2 text-sm font-bold ${topMethod === "card" ? "bg-ink text-cream" : "bg-[rgb(var(--surface-muted))]"}`} onClick={() => setTopMethod("card")}>Card</button></div>}
            {topMethod === "card" && cardDirect && <CardFields value={cardForm} onChange={setCardForm} />}
            {topMethod === "card" && cardAvailable && !cardDirect && <CardHostedNote />}
            {topMethod === "mobile_money" && <input aria-label="Mobile money number" value={msisdn} onChange={(e) => setMsisdn(e.target.value)} placeholder="07…" className="w-full rounded-2xl" />}
            <button className="w-pill w-pill-send h-14 w-full" disabled={busy}>{busy ? t("wallet_starting") : t("wallet_top_up")}</button>
          </form>
        )}
      </SheetFrame>}

      {sheet === "cashout" && cashInfo && <SheetFrame title={t("wallet_cash_out")} onClose={() => setSheet(null)}>
        {wallet.frozen && <p className="mb-2 rounded-xl bg-ink-500/10 px-3 py-2 text-sm font-semibold">{t("wallet_frozen_banner", { name: t("wallet_main_account") })}</p>}
        <p className="mb-2 text-sm text-ink-500">UGX {whole(cashInfo.allowed)}{cashInfo.lockDays ? ` · ${cashInfo.lockDays}d` : ""}</p>
        <input inputMode="numeric" aria-label={t("wallet_cash_out")} value={cashAmount} onChange={(e) => setCashAmount(e.target.value.replace(/[^\d]/g, ""))} className="mb-2 w-full rounded-2xl" />
        <input aria-label="Mobile money number" value={cashPhone} onChange={(e) => setCashPhone(e.target.value)} className="mb-2 w-full rounded-2xl" placeholder="07…" />
        {formError && <p className="mb-2 text-sm text-danger-ink" role="alert">{formError}</p>}
        <button type="button" className="w-pill w-pill-send h-14 w-full" disabled={busy || !!wallet.frozen} onClick={async () => { setBusy(true); setFormError(null); try { await api.withdrawCustomerWallet({ amount: Number(cashAmount), msisdn: cashPhone.trim() }); setSheet(null); await load(); } catch (err) { setFormError(explain(err, t)); } finally { setBusy(false); } }}>{t("wallet_cash_out")}</button>
      </SheetFrame>}

      {sheet === "move" && <SheetFrame title={t("wallet_move")} onClose={() => setSheet(null)}>
        <label className="mb-2 block text-xs font-bold text-ink-500">{t("wallet_from")}<select className="mt-1 w-full rounded-2xl" value={moveFrom} onChange={(e) => setMoveFrom(e.target.value)}>{wallets.map((w) => <option key={w.id} value={w.id} disabled={!!w.frozen}>{accountLabel(w.name, w.isPrimary, t)}</option>)}</select></label>
        <label className="mb-2 block text-xs font-bold text-ink-500">{t("wallet_to")}<select className="mt-1 w-full rounded-2xl" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>{wallets.filter((w) => w.id !== moveFrom).map((w) => <option key={w.id} value={w.id}>{accountLabel(w.name, w.isPrimary, t)}</option>)}</select></label>
        <input inputMode="numeric" aria-label={t("wallet_move")} value={moveAmount} onChange={(e) => setMoveAmount(e.target.value.replace(/[^\d]/g, ""))} className="mb-2 w-full rounded-2xl" />
        {formError && <p className="mb-2 text-sm text-danger-ink" role="alert">{formError}</p>}
        <button type="button" className="w-pill w-pill-send h-14 w-full" disabled={busy} onClick={async () => { setBusy(true); setFormError(null); try { await api.transferBetweenWallets({ fromWalletId: moveFrom, toWalletId: moveTo, amount: Number(moveAmount), idempotencyKey: newKey() }); setSheet(null); await load(); } catch (err) { setFormError(explain(err, t)); } finally { setBusy(false); } }}>{t("wallet_move")}</button>
      </SheetFrame>}

      {sheet === "rewards" && <SheetFrame title={t("wallet_rewards")} onClose={() => setSheet(null)}><CreditSection hideCashout /></SheetFrame>}
      {sheet === "tx" && <SheetFrame title={t("wallet_transactions")} onClose={() => setSheet(null)}>
        <div className="mb-2 flex gap-2">{(["all", "out", "in"] as const).map((k) => <button key={k} type="button" className={`rounded-full px-3 py-1 text-sm font-bold ${txKind === k ? "bg-ink text-cream" : "bg-[rgb(var(--surface-muted))]"}`} onClick={() => setTxKind(k)}>{k === "all" ? t("wallet_all") : k === "out" ? t("wallet_out") : t("wallet_in")}</button>)}</div>
        <label className="field-box mb-2 flex items-center rounded-2xl px-3"><Search size={16} /><input value={txQuery} onChange={(e) => setTxQuery(e.target.value)} aria-label={t("wallet_search")} className="h-11 w-full bg-transparent outline-none" /></label>
        <div className="mb-3 grid grid-cols-3 gap-2 text-center text-xs">
          <div><p className="text-ink-500">{t("wallet_week")}</p></div>
          <div className="rounded-xl bg-[rgb(var(--surface-muted))] py-2"><p className="text-ink-500">{t("wallet_out")}</p><p className="font-extrabold">{whole(spending?.totalOut ?? 0)}</p></div>
          <div className="rounded-xl bg-green/10 py-2"><p className="text-ink-500">{t("wallet_in")}</p><p className="font-extrabold text-green">{whole(spending?.totalIn ?? 0)}</p></div>
        </div>
        <TxList rows={ledger} t={t} />
      </SheetFrame>}

      {sheet === "settings" && selected && <SheetFrame title={t("wallet_account_settings")} onClose={() => setSheet(null)}>
        <label className="field-box mb-3 flex items-center rounded-2xl px-3"><input value={rename} onChange={(e) => setRename(e.target.value)} aria-label={t("wallet_account_settings")} maxLength={40} className="h-12 w-full bg-transparent outline-none" /></label>
        <button type="button" className="mb-3 text-sm font-bold text-gold" onClick={async () => { await api.renameWallet(selected.id, rename.trim()); await load(); }}>{t("wallet_save")}</button>
        {selected.isPrimary && <p className="mb-3 text-xs text-ink-500">UGX {whole(wallet.balance)} / {whole(wallet.cap)} {wallet.verified ? "" : ""}</p>}
        <p className="mb-2 text-sm font-bold">{selected.frozen ? t("wallet_frozen") : t("wallet_active")}</p>
        {confirmUnfreeze && <p className="mb-2 text-sm">{t("wallet_unfreeze_confirm")}</p>}
        <button type="button" className="mb-4 w-full rounded-full bg-[rgb(var(--surface-muted))] py-3 text-sm font-bold" onClick={() => void freeze(selected.id, !selected.frozen)}>{selected.frozen ? t("wallet_unfreeze") : t("wallet_freeze")}</button>
        <label className="field-box mb-2 flex items-center rounded-2xl px-3"><input value={shareTo} onChange={(e) => setShareTo(e.target.value)} placeholder={t("wallet_contact_phone")} aria-label={t("wallet_share_yours")} className="h-12 w-full bg-transparent outline-none" /></label>
        <button type="button" className="mb-4 text-sm font-bold" onClick={async () => { setFormError(null); try { await api.shareWallet({ recipient: shareTo.trim(), walletId: selected.id }); setShareTo(""); await load(); } catch (err) { setFormError(explain(err, t)); } }}>{t("wallet_send_invite")}</button>
        {(shares?.granted ?? []).filter((g) => (g.wallet_id ?? "primary") === (selected.isPrimary ? null : selected.id) || (selected.isPrimary && !g.wallet_id)).map((g) => (
          <div key={g.id} className="flex items-center justify-between py-2 text-sm"><span>{g.grantee_name} · {g.masked_phone} · {g.status}</span>{g.status !== "revoked" && g.status !== "declined" && <button type="button" className="font-bold" onClick={async () => { await api.revokeWalletShare(g.id); await load(); }}>{t("wallet_revoke")}</button>}</div>
        ))}
        {!selected.isPrimary && selected.balance === 0 && (confirmDelete ? (
          <div className="mt-3 rounded-2xl bg-danger/10 p-3 text-sm text-danger-ink"><p>{t("wallet_delete_confirm")}</p><button type="button" className="mt-2 font-extrabold" onClick={async () => { try { await api.deleteWallet(selected.id); setSheet(null); await load(); } catch (err) { setFormError(explain(err, t)); } }}>{t("wallet_delete")}</button></div>
        ) : <button type="button" className="mt-3 flex items-center gap-2 text-sm font-bold text-danger" onClick={() => setConfirmDelete(true)}><Trash2 size={16} />{t("wallet_delete_account")}</button>)}
        {formError && <p className="mt-2 text-sm text-danger-ink" role="alert">{formError}</p>}
        <button type="button" className="mt-4 flex w-full items-center justify-center gap-2 rounded-full border py-3 text-sm font-bold" onClick={() => { setMoveFrom(selected.id); setMoveTo(wallets.find((w) => w.id !== selected.id)?.id ?? ""); setSheet("move"); }}><ArrowLeftRight size={16} />{t("wallet_move")}</button>
      </SheetFrame>}

      {sheet === "contact" && <ContactSheet
        t={t}
        busy={busy}
        nicknames={features?.nicknames !== false}
        contactQ={contactQ}
        setContactQ={setContactQ}
        nickname={nickname}
        setNickname={setNickname}
        looked={looked}
        setLooked={setLooked}
        picked={pickedContact}
        setPicked={setPickedContact}
        manual={manualContact}
        setManual={setManualContact}
        error={formError}
        setError={setFormError}
        setBusy={setBusy}
        onSaved={async () => { setSheet(null); await load(); }}
        onClose={() => setSheet(null)}
      />}

      {sheet === "new" && <SheetFrame title={t("wallet_new_account")} onClose={() => setSheet(null)}>
        <div className="mb-3 flex flex-wrap gap-2">{suggested.map((name) => <button key={name} type="button" className="rounded-full bg-[rgb(var(--surface-muted))] px-3 py-1.5 text-sm font-bold" onClick={() => setNewName(name)}>{name}</button>)}</div>
        <label className="field-box mb-3 flex items-center rounded-2xl px-3"><input value={newName} onChange={(e) => setNewName(e.target.value)} aria-label={t("wallet_new_account")} maxLength={40} className="h-12 w-full bg-transparent outline-none" /></label>
        {formError && <p className="mb-2 text-sm text-danger-ink">{formError}</p>}
        <button type="button" className="w-pill w-pill-send h-14 w-full" disabled={busy || !newName.trim()} onClick={async () => { setBusy(true); setFormError(null); try { await api.createWallet(newName.trim()); setSheet(null); await load(); } catch (err) { setFormError(explain(err, t)); } finally { setBusy(false); } }}>{t("wallet_create_wallet")}</button>
      </SheetFrame>}

      {result && (
        <div className={`wallet-result ${result.kind === "failed" ? "bg-cream text-ink" : "bg-green text-white"}`} onClick={() => result.kind !== "processing" && setResult(null)}>
          {result.kind === "processing" && <p className="text-xl font-extrabold">{result.title}</p>}
          {result.kind === "success" && <>
            <span className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-white text-green"><Check size={48} /></span>
            <p className="text-lg font-bold opacity-80">UGX</p>
            <p className="text-5xl font-extrabold">{whole(result.amount ?? 0)}</p>
            <p className="mt-2 text-lg font-bold">{result.title}</p>
            {result.detail && <p className="mt-1 text-sm opacity-80">{t("wallet_new_balance", { amount: result.detail, account: result.account ?? "" })}</p>}
            <button type="button" className="mt-8 h-12 w-full max-w-xs rounded-full bg-white font-extrabold text-green" onClick={() => { setResult(null); openTab("central"); }}>{t("wallet_done")}</button>
            <button type="button" className="mt-3 h-12 w-full max-w-xs rounded-full border border-white/40 font-bold" onClick={() => { setResult(null); openTab("transactions"); }}>{t("wallet_view_tx")}</button>
            <p className="mt-6 text-sm opacity-80">{t("wallet_tap_to_close")}</p>
          </>}
          {result.kind === "failed" && <>
            <p className="text-2xl font-extrabold text-danger">{result.title}</p>
            <p className="mt-2 max-w-xs text-sm text-ink-500">{result.detail}</p>
            <button type="button" className="mt-6 h-12 w-full max-w-xs rounded-full bg-gold font-extrabold text-ink" onClick={() => { setResult(null); setSheet(null); setReview(true); openTab("send"); }}>{t("wallet_try_again")}</button>
          </>}
        </div>
      )}
    </div>
  );
}

type CustomerWalletsResponseFeatures = NonNullable<Awaited<ReturnType<typeof api.getWallets>>["features"]>;

function txWhenLabel(iso: string | undefined, t: (key: TranslationKey, params?: Record<string, string | number>) => string) {
  const when = describeTxWhen(iso ?? "");
  if (when.kind === "today") return t("wallet_today", { time: when.time });
  if (when.kind === "yesterday") return t("wallet_yesterday");
  if (when.kind === "weekday") return t("wallet_tx_weekday", { day: when.day, time: when.time });
  return when.label;
}

function ContactSheet({ t, busy, nicknames, contactQ, setContactQ, nickname, setNickname, looked, setLooked, picked, setPicked, manual, setManual, error, setError, setBusy, onSaved, onClose }: {
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  busy: boolean;
  nicknames: boolean;
  contactQ: string;
  setContactQ: (value: string) => void;
  nickname: string;
  setNickname: (value: string) => void;
  looked: Person | null;
  setLooked: (person: Person | null) => void;
  picked: PickedContact | null;
  setPicked: (contact: PickedContact | null) => void;
  manual: boolean;
  setManual: (value: boolean) => void;
  error: string | null;
  setError: (value: string | null) => void;
  setBusy: (value: boolean) => void;
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const picker = contactPicker();
  const [name, setName] = useState(picked?.name || nickname);
  const [phone, setPhone] = useState(picked?.phone || (contactQ && !contactQ.includes("@") ? contactQ : ""));
  const [email, setEmail] = useState(picked?.email || (contactQ.includes("@") ? contactQ : ""));
  const [focus, setFocus] = useState<"name" | "phone" | "email" | null>(null);

  function identifier() {
    return (phone.trim() || email.trim());
  }

  async function fromPhone() {
    try {
      const [contact] = (await picker?.select(["name", "tel", "email"], { multiple: false })) ?? [];
      const next = firstContact(contact);
      if (!next) return;
      setPicked(next);
      setName(next.name);
      setPhone(next.phone);
      setEmail(next.email);
      setContactQ(next.phone || next.email);
      if (next.name) setNickname(next.name);
      setLooked(null);
      setError(null);
      setManual(true);
      if (next.phone || next.email) void lookup(next.phone || next.email);
    } catch {
      // The person closed the picker.
    }
  }

  async function lookup(raw: string) {
    const problem = contactInputError(raw);
    if (problem) return;
    try {
      const person = await api.lookupRecipient(raw.trim());
      setLooked(person);
      if (person.name && !name.trim()) {
        setName(person.name);
        setNickname(person.name);
      }
    } catch {
      setLooked(null);
    }
  }

  async function submit() {
    const ident = identifier();
    const problem = contactInputError(ident);
    if (problem) {
      setError(t(problem === "long" ? "wallet_contact_long" : problem === "format" ? "wallet_contact_format" : "wallet_contact_short"));
      return;
    }
    setBusy(true);
    setError(null);
    if (name.trim()) setNickname(name.trim());
    setContactQ(ident);
    try {
      const person = looked ?? await api.lookupRecipient(ident);
      setLooked(person);
      await api.saveWalletContact({ recipientId: person.recipientId, recipient: ident, nickname: (name.trim() || nickname.trim()) || undefined });
      await onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.code === "network_error") setError(t("wallet_contact_retry"));
      else setError(explain(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetFrame title={t("wallet_add_contact")} onClose={onClose}>
      {picker && (
        <button type="button" className="mb-3 flex min-h-12 w-full items-center gap-3 rounded-2xl px-1 text-left text-sm font-bold" onClick={() => void fromPhone()}>
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gold/20 text-gold"><BookUser size={18} aria-hidden /></span>
          {t("wallet_choose_phone")}
        </button>
      )}
      <div className={`w-infield mb-3 ${focus === "name" ? "is-focus" : ""}`}>
        <input
          value={name}
          onChange={(e) => { setName(e.target.value); setNickname(e.target.value); }}
          onFocus={() => setFocus("name")}
          onBlur={() => setFocus(null)}
          placeholder={t("wallet_contact_name")}
          aria-label={t("wallet_contact_name")}
        />
        {looked && <span className="ml-2 shrink-0 rounded-full bg-green/20 px-2 py-1 text-[10px] font-extrabold text-green">{t("wallet_registered")}</span>}
      </div>
      <div className={`w-infield ${focus === "phone" ? "is-focus" : ""} ${error ? "is-error" : ""}`}>
        <input
          value={phone}
          onChange={(e) => { setPhone(e.target.value); setLooked(null); setError(null); }}
          onFocus={() => setFocus("phone")}
          onBlur={() => { setFocus(null); if (phone.trim()) void lookup(phone.trim()); }}
          placeholder={t("wallet_contact_phone")}
          aria-label={t("wallet_contact_phone")}
          inputMode="tel"
        />
      </div>
      {error && <p className="w-field-error" role="alert">{error}</p>}
      <div className={`w-infield mt-3 mb-4 ${focus === "email" ? "is-focus" : ""}`}>
        <input
          value={email}
          onChange={(e) => { setEmail(e.target.value); if (!phone.trim()) setLooked(null); }}
          onFocus={() => setFocus("email")}
          onBlur={() => { setFocus(null); if (!phone.trim() && email.trim()) void lookup(email.trim()); }}
          placeholder={t("wallet_contact_email")}
          aria-label={t("wallet_contact_email")}
          inputMode="email"
        />
      </div>
      <button type="button" className="w-cta mt-2 w-full disabled:opacity-40" disabled={busy || !identifier()} onClick={() => void submit()}>{busy ? "…" : t("wallet_save_contact")}</button>
    </SheetFrame>
  );
}


function SendSteps({ stage }: { stage: "pay" | "review" | "done" }) {
  const items: { key: "pay" | "review" | "verify" | "done"; label: string }[] = [
    { key: "pay", label: "Pay" },
    { key: "review", label: "Review" },
    { key: "verify", label: "Verify" },
    { key: "done", label: "Done" },
  ];
  const order = { pay: 0, review: 1, verify: 2, done: 3 } as const;
  const here = order[stage];
  return (
    <ol className="w-steps" aria-label="Send progress">
      {items.map((item, i) => (
        <li key={item.key} className={`w-step ${i === here ? "on" : i < here ? "done" : ""}`}>
          <span className="w-step-dot" />
          {item.label}
          {i < items.length - 1 && <span className="w-step-line" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

function GroupedTxList({ rows, t }: { rows: WalletLedgerEntry[]; t: (key: TranslationKey, params?: Record<string, string | number>) => string }) {
  if (rows.length === 0) return <p className="px-5 py-8 text-sm opacity-70">{t("wallet_no_activity_yet")}</p>;
  const groups: { key: string; label: string; items: WalletLedgerEntry[] }[] = [];
  for (const e of rows) {
    const when = describeTxWhen(e.created_at ?? "");
    const label = when.kind === "today" ? t("wallet_day_today") : when.kind === "yesterday" ? t("wallet_yesterday") : when.kind === "weekday" ? when.day : when.label;
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(e);
    else groups.push({ key: `${label}-${e.id}`, label, items: [e] });
  }
  return <div>{groups.map((g) => (
    <section key={g.key}>
      <h2 className="w-day">{g.label}</h2>
      <div className="w-card w-lift mx-4 w-[calc(100%-2rem)] px-4">
        <TxList rows={g.items} t={t} />
      </div>
    </section>
  ))}</div>;
}

function TxList({ rows, t }: { rows: WalletLedgerEntry[]; t: (key: TranslationKey, params?: Record<string, string | number>) => string }) {
  if (rows.length === 0) return <p className="py-6 text-sm text-ink-500">{t("wallet_no_activity_yet")}</p>;
  return <ul>{rows.map((e) => {
    const title = e.merchant_name || (e.type === "transfer_out" ? t("wallet_sent_to", { name: e.counterparty_name ?? "" }) : e.type === "transfer_in" ? e.counterparty_name ?? t("wallet_in") : e.type === "topup" ? t("wallet_topups") : e.type === "order_payment" ? t("wallet_orders") : e.type);
    return <li key={e.id} className="flex min-h-[58px] items-center gap-3 border-b border-[var(--border-faint)]">
      <MerchantFace name={String(title)} logo={e.merchant_logo ?? null} />
      <span className="min-w-0 flex-1"><b className="block truncate text-sm">{title}</b><span className="text-xs text-ink-500">{txWhenLabel(e.created_at, t)}</span></span>
      <span className={`text-sm font-extrabold ${e.amount > 0 ? "text-green" : ""}`}>{e.amount > 0 ? "+" : "−"}UGX {whole(Math.abs(e.amount))}</span>
    </li>;
  })}</ul>;
}

function RowButton({ label, hint, onClick }: { label: string; hint?: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="flex min-h-14 w-full items-center justify-between border-b border-[var(--border-faint)] text-left text-base font-bold"><span>{label}</span>{hint && <span className="rounded-full bg-gold px-2 text-xs">{hint}</span>}</button>;
}
function ReviewRow({ label, value, onEdit, edit }: { label: string; value: string; onEdit?: () => void; edit?: string }) {
  return <div className="flex items-center justify-between border-b border-white/10 py-2.5 text-sm last:border-0"><span className="opacity-70">{label}</span><span className="font-bold">{value} {onEdit && <button type="button" className="ml-2 font-extrabold text-gold" onClick={onEdit}>{edit}</button>}</span></div>;
}

function SharedBlock({ shares, t, onAccept }: { shares: WalletShares | null; t: (key: TranslationKey, params?: Record<string, string | number>) => string; onAccept: (id: string, action: "accept" | "decline" | "revoke") => Promise<void> }) {
  const received = shares?.received ?? [];
  if (received.length === 0) return null;
  return <section className="pt-2"><h2 className="mb-2 text-sm font-extrabold text-ink-500">{t("wallet_shared_with_me")}</h2>{received.map((s) => (
    <div key={s.id} className="mb-2 rounded-2xl bg-[rgb(var(--surface-card))] px-3 py-3 shadow-sm">
      <p className="font-bold">{s.owner_name}</p>
      <p className="text-xs text-ink-500">{s.wallet_name} · {s.masked_phone}{s.status === "active" && s.owner_balance != null ? ` · UGX ${whole(s.owner_balance)}` : ` · ${t("wallet_invites")}`}</p>
      {s.status === "pending" && <div className="mt-2 flex gap-2"><button type="button" className="rounded-full bg-ink px-4 py-2 text-sm font-bold text-cream" onClick={() => void onAccept(s.id, "accept")}>{t("wallet_accept")}</button><button type="button" className="rounded-full bg-[rgb(var(--surface-muted))] px-4 py-2 text-sm font-bold" onClick={() => void onAccept(s.id, "decline")}>{t("decline")}</button></div>}
      {s.status === "active" && <button type="button" className="mt-2 text-sm font-bold" onClick={() => void onAccept(s.id, "revoke")}>{t("wallet_stop")}</button>}
    </div>
  ))}</section>;
}

function RequestForm({ t, wallets, intoId, setIntoId, amount, setAmount, error, busy, requests, onCreate, onPay, onAct }: {
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  wallets: CustomerWalletSummary[];
  intoId: string; setIntoId: (id: string) => void; amount: string; setAmount: (v: string) => void;
  error: string | null; busy: boolean; requests: WalletMoneyRequest[];
  onCreate: (payer: Person) => Promise<void>;
  onPay: (r: WalletMoneyRequest) => void;
  onAct: (id: string, act: "decline" | "later" | "cancel") => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [who, setWho] = useState<Person | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  return <div className="space-y-3">
    <label className="field-box flex items-center rounded-2xl px-3"><input value={q} onChange={(e) => { setQ(e.target.value); setWho(null); }} aria-label={t("wallet_contact_phone")} placeholder={t("wallet_contact_phone")} className="h-12 w-full bg-transparent outline-none" /></label>
    <button type="button" className="text-sm font-bold text-gold" onClick={async () => { setLocalError(null); try { setWho(await api.lookupRecipient(q.trim())); } catch (err) { setLocalError(explain(err, t)); } }}>{t("wallet_checking")}</button>
    {who && <p className="text-sm font-bold text-green">{who.name} · {who.maskedPhone}</p>}
    <input inputMode="numeric" aria-label={t("wallet_request")} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} className="w-full rounded-2xl" placeholder="UGX" />
    <label className="block text-xs font-bold text-ink-500">{t("wallet_into_account")}<select className="mt-1 w-full rounded-2xl" value={intoId} onChange={(e) => setIntoId(e.target.value)}>{wallets.map((w) => <option key={w.id} value={w.id}>{accountLabel(w.name, w.isPrimary, t)}</option>)}</select></label>
    {(error || localError) && <p className="text-sm text-danger-ink" role="alert">{error || localError}</p>}
    <button type="button" disabled={busy || !who || !Number(amount)} className="w-pill w-pill-send h-14 w-full disabled:opacity-40" onClick={() => who && void onCreate(who)}>{t("wallet_request")}</button>
    <h3 className="pt-2 text-sm font-extrabold">{t("wallet_transactions")}</h3>
    {requests.length === 0 && <p className="text-sm text-ink-500">{t("wallet_no_requests")}</p>}
    {requests.map((r) => (
      <div key={r.id} className="rounded-2xl bg-[rgb(var(--surface-muted))] px-3 py-2 text-sm">
        <p className="font-bold">{r.direction === "incoming" ? r.personName : r.personName} · UGX {whole(r.amount)} · {r.status}</p>
        <p className="text-xs text-ink-500">{r.maskedPhone}{r.note ? ` · ${r.note}` : ""}</p>
        {r.direction === "incoming" && (r.status === "open" || r.status === "later") && <div className="mt-2 flex gap-2"><button type="button" className="rounded-full bg-ink px-3 py-1.5 text-xs font-bold text-cream" onClick={() => onPay(r)}>{t("wallet_request_pay")}</button><button type="button" className="rounded-full bg-white px-3 py-1.5 text-xs font-bold" onClick={() => void onAct(r.id, "decline")}>{t("decline")}</button><button type="button" className="rounded-full bg-white px-3 py-1.5 text-xs font-bold" onClick={() => void onAct(r.id, "later")}>{t("wallet_later")}</button></div>}
        {r.direction === "outgoing" && (r.status === "open" || r.status === "later") && <button type="button" className="mt-2 text-xs font-bold" onClick={() => void onAct(r.id, "cancel")}>{t("wallet_cancel_request")}</button>}
      </div>
    ))}
  </div>;
}
