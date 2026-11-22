"use client";

import { isPracticeMode, type CustomerWallet, type CustomerWalletSummary, type WalletShares } from "@peebee/shared";
import { ArrowRight, Plus, ShieldCheck, Snowflake, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { homeWalletAccounts, walletDeckIndex, type HomeWalletAccount } from "../../lib/home-wallet";
import { useTranslate } from "../../lib/i18n";
import { formatUgx } from "../../lib/order-display";
import { homeFont } from "./home-font";
import "./home-wallet.css";

export function WalletCard({ personalized = false }: { personalized?: boolean }) {
  const { user, ready } = useAuth();
  if (!ready || !user) return null;
  return <WalletDeck key={`${user.id}:${isPracticeMode() ? "practice" : "live"}`} personalized={personalized} />;
}

function WalletDeck({ personalized }: { personalized: boolean }) {
  const [data, setData] = useState<{ wallet: CustomerWallet; accounts: CustomerWalletSummary[]; shares: WalletShares | null } | null>(null);
  const [error, setError] = useState(false);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState(0);
  const [shuffle, setShuffle] = useState<1 | -1 | null>(null);
  const pointer = useRef<{ id: number; x: number; y: number; dx: number; horizontal: boolean } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    let live = true, request = 0;
    const readHidden = () => {
      try { const value: unknown = JSON.parse(localStorage.getItem("peebee-wallet-hidden") || "{}"); setHidden(value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, boolean> : {}); } catch { setHidden({}); }
    };
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      const current = ++request;
      const [wallet, accounts, shares] = await Promise.allSettled([api.getWallet(), api.getWallets(), api.getWalletShares()]);
      if (!live || current !== request) return;
      if (wallet.status === "rejected") { setError(true); return; }
      setData({ wallet: wallet.value, accounts: accounts.status === "fulfilled" ? accounts.value.wallets : [], shares: shares.status === "fulfilled" ? shares.value : null });
      setError(accounts.status === "rejected");
      readHidden();
    };
    const refresh = () => { void load(); };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("peebee:data-updated", refresh);
    window.addEventListener("storage", readHidden);
    return () => { live = false; document.removeEventListener("visibilitychange", refresh); window.removeEventListener("peebee:data-updated", refresh); window.removeEventListener("storage", readHidden); };
  }, [reload]);

  const cards = data ? homeWalletAccounts(data.wallet, data.accounts, data.shares) : [];
  const index = Math.max(0, cards.findIndex(card => card.id === selected));
  const active = cards[index];
  const incoming = cards[walletDeckIndex(index, shuffle ?? 1, cards.length)];
  function finishShuffle(direction: number) {
    setSelected(cards[walletDeckIndex(index, direction, cards.length)]?.id ?? null);
    setShuffle(null);
  }
  function switchCard(direction: 1 | -1) {
    if (cards.length < 2 || shuffle) return;
    setDrag(0);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) finishShuffle(direction);
    else setShuffle(direction);
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = pointer.current;
    if (!start || start.id !== event.pointerId || shuffle) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (!start.horizontal) {
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { pointer.current = null; return; }
      if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy)) return;
      start.horizontal = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    start.dx = dx;
    suppressClick.current = true;
    setDrag(Math.max(-120, Math.min(120, dx)));
  }
  function endPointer(cancelled: boolean) {
    const start = pointer.current;
    pointer.current = null;
    setDrag(0);
    if (!cancelled && start?.horizontal && Math.abs(start.dx) >= 40) switchCard(start.dx < 0 ? 1 : -1);
  }

  return <section className={`home-wallet ${personalized ? "home-wallet--personalized" : "home-wallet--legacy"} ${homeFont.className}`} aria-label="My Wallet">
    <h2 className="home-wallet__heading">My Wallet</h2>
    {!active ? <div className="home-wallet__empty" role="status">{error ? <><p>Your wallet couldn’t load.</p><button type="button" onClick={() => setReload(value => value + 1)}>Try again</button></> : <p>Loading your wallet…</p>}</div> : <>
      <div className={`home-wallet__deck ${shuffle ? `is-shuffling ${shuffle === 1 ? "to-next" : "to-previous"}` : ""} ${drag ? "is-dragging" : ""}`}
        tabIndex={cards.length > 1 ? 0 : undefined} role="group" aria-roledescription="carousel" aria-label="Wallet accounts"
        onKeyDownCapture={() => { suppressClick.current = false; }}
        onKeyDown={event => { if (event.target !== event.currentTarget) return; if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); switchCard(event.key === "ArrowRight" ? 1 : -1); } }}
        onPointerDown={event => { if (!event.isPrimary || event.button !== 0 || cards.length < 2 || shuffle) return; suppressClick.current = false; pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, horizontal: false }; }}
        onPointerMove={onPointerMove} onPointerUp={() => endPointer(false)} onPointerCancel={() => endPointer(true)}
        onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}
        style={{ "--wallet-drag": `${drag}px`, "--wallet-tilt": `${drag / 25}deg` } as CSSProperties}>
        {cards.length > 2 && <div className="home-wallet__back home-wallet__back--far" aria-hidden />}
        {cards.length > 1 && <div className="home-wallet__back home-wallet__back--near" aria-hidden />}
        {shuffle && incoming && <article className="home-wallet__card home-wallet__incoming" aria-hidden inert><WalletFace active={incoming} hidden={hidden[incoming.id.replace(/^own:/, "")] === true} /></article>}
        <article className="home-wallet__card" onAnimationEnd={event => { if (event.target === event.currentTarget && shuffle) finishShuffle(shuffle); }}>
          <WalletFace active={active} hidden={hidden[active.id.replace(/^own:/, "")] === true} />
        </article>
      </div>
      <span className="sr-only" aria-live="polite" aria-atomic="true">{active.name}, wallet {index + 1} of {cards.length}{active.frozen ? ", frozen" : ""}</span>
      {cards.length > 1 ? <button type="button" className="home-wallet__switch" onClick={() => switchCard(1)} disabled={!!shuffle} aria-label="Show next wallet. You can also swipe across the cards.">Swipe to switch</button> : <Link className="home-wallet__switch" href="/wallet?tab=accounts">Manage accounts<ArrowRight size={16} aria-hidden /></Link>}
      {error && <p className="home-wallet__notice">Some accounts couldn’t load. <button type="button" onClick={() => setReload(value => value + 1)}>Retry</button></p>}
    </>}
  </section>;
}

function WalletFace({ active, hidden }: { active: HomeWalletAccount; hidden: boolean }) {
  const t = useTranslate();
  return <>
    <header className="home-wallet__card-head"><div><Wallet size={32} strokeWidth={2.5} aria-hidden /><h3>{active.name}</h3></div>
            <span className="home-wallet__badge">{active.frozen ? <Snowflake size={17} aria-hidden /> : active.shared ? <Users size={17} aria-hidden /> : <ShieldCheck size={17} aria-hidden />}{active.frozen ? t("wallet_frozen") : active.shared ? "Shared" : t("wallet_protected")}</span>
          </header>
          <div className="home-wallet__balance-row"><div className="home-wallet__balance"><p>Available balance</p><strong>{hidden || active.balance === null ? "••••••" : formatUgx(active.balance)}</strong></div>
            {active.fundHref && <Link className="home-wallet__topup" href={active.fundHref} draggable={false} aria-label={`${t("wallet_top_up")} ${active.name}`}><span><Plus size={28} strokeWidth={2.5} aria-hidden /></span>{t("wallet_top_up")}</Link>}
          </div>
          <footer className="home-wallet__card-footer"><p>{active.shared ? <><b>Shared with you</b><span>{active.owner}</span></> : <><b>{active.verified ? t("wallet_verified") : "Not verified"}</b><span>Peebee Account</span></>}</p><Link href={active.detailsHref} draggable={false} aria-label={`${t("wallet_details")} ${active.name}`}>{t("wallet_details")}<ArrowRight size={23} aria-hidden /></Link></footer>
  </>;
}
