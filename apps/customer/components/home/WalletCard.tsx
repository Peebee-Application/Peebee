"use client";

import { isPracticeMode, type CustomerWallet, type CustomerWalletSummary, type WalletShares } from "@peebee/shared";
import { ArrowRight, Plus, ShieldCheck, Snowflake, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { homeWalletAccounts, type HomeWalletAccount } from "../../lib/home-wallet";
import { useTranslate } from "../../lib/i18n";
import { formatUgx } from "../../lib/order-display";
import { homeFont } from "./home-font";
import { WalletStack } from "./WalletStack";
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

  return <section className={`home-wallet ${personalized ? "home-wallet--personalized" : "home-wallet--legacy"} ${homeFont.className}`} aria-label="My Wallet">
    <h2 className="home-wallet__heading">My Wallet</h2>
    {!cards.length ? <div className="home-wallet__empty" role="status">{error ? <><p>Your wallet couldn’t load.</p><button type="button" onClick={() => setReload(value => value + 1)}>Try again</button></> : <p>Loading your wallet…</p>}</div> : <>
      <WalletStack accounts={cards} renderCard={account => <WalletFace active={account} hidden={hidden[account.id.replace(/^own:/, "")] === true} />} />
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
