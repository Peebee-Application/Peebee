import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChevronRight, Menu, Shield } from "lucide-react";
import { BrandHeader } from "../../../customer/components/BrandHeader";
import { ChatDrawerShell, useChatDrawer } from "../../../customer/lib/chat-drawer";
import { HeaderDrawerProvider, useHeaderDrawer } from "../../../customer/lib/header-drawer";
import { CallsProvider } from "../../../customer/lib/calls-context";
import { LanguageProvider } from "../../../customer/lib/i18n";
import { configureHost, host, subscribe, sync } from "./host";
import type { TaxibeeHeader } from "./contracts";
import "./layout.css";

function AppStage() {
  const stage = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const nodes = ["app-shell", "mobile-nav"].map(id => document.getElementById(id)).filter(node => node !== null);
    for (const node of nodes) stage.current?.append(node);
    // Restore the legacy shell before React replaces the session's chat runtime.
    return () => document.getElementById("taxibee-customer-header")?.before(...nodes);
  }, []);
  return <div ref={stage} />;
}

function Chrome({ target }: { target: HTMLElement }) {
  const drawer = useHeaderDrawer();
  const chat = useChatDrawer();
  const user = useSyncExternalStore(subscribe, () => host.getUser());
  const [profile, setProfile] = useState<Element | null>(null);
  const [headerRow, setHeaderRow] = useState<Element | null>(null);
  useLayoutEffect(() => {
    setHeaderRow(target.querySelector(".customer-header > div"));
  }, [target]);
  useLayoutEffect(() => {
    const onAuth = () => { drawer.close(); if (chat.open) chat.close(); };
    document.addEventListener("taxibee-auth-open", onAuth);
    return () => document.removeEventListener("taxibee-auth-open", onAuth);
  }, [drawer.close, chat.open, chat.close]);
  useLayoutEffect(() => {
    setProfile(drawer.mode === "section" && drawer.section === "profile"
      ? target.querySelector("#header-menu .d-stack")
      : null);
  }, [drawer.mode, drawer.section, target]);
  return createPortal(<>
    <BrandHeader />
    {headerRow && createPortal(
      <button type="button" className="customer-header-toggle taxibee-side-toggle"
        aria-label="Open Taxibee menu" aria-controls="side-drawer" aria-expanded={false}
        data-action="toggle-side-drawer" onClick={() => drawer.close()}>
        <Menu size={24} aria-hidden />
      </button>, headerRow)}
    {profile && createPortal(user ? <div className="d-card">
      <button type="button" className="d-row" onClick={() => { drawer.close(); host.openLocal("profile"); }}>
        <span className="d-ico"><Shield size={18} aria-hidden /></span>
        <span className="d-row-title flex-1">Taxibee account tools</span>
        <ChevronRight className="d-chev" size={20} aria-hidden />
      </button>
    </div> : <button type="button" className="customer-drawer-open"
      onClick={() => { drawer.close(); host.signIn(); }}>Sign in to Peebee</button>, profile)}
  </>, target);
}

function SessionChrome({ target }: { target: HTMLElement }) {
  const account = useSyncExternalStore(subscribe, () => host.getUser()?.id ?? "guest");
  return <CallsProvider key={account}>
    <ChatDrawerShell>
      <HeaderDrawerProvider>
        <AppStage />
        <Chrome target={target} />
      </HeaderDrawerProvider>
    </ChatDrawerShell>
  </CallsProvider>;
}

const header: TaxibeeHeader = {
  mount(root, options) {
    const target = document.getElementById("taxibee-header-slot");
    if (!target) return;
    configureHost(options);
    try {
      const saved = localStorage.getItem("peebee-theme");
      const hour = new Date().getHours();
      document.documentElement.dataset.theme = saved === "light" || saved === "dark" ? saved : hour >= 6 && hour < 19 ? "light" : "dark";
    } catch { /* Customer theme follows the OS if browser storage is unavailable. */ }
    document.documentElement.classList.add("taxibee-customer-chrome");
    createRoot(root).render(
      <LanguageProvider>
        <SessionChrome target={target} />
      </LanguageProvider>,
    );
  },
  sync,
};

(window as Window & { TaxibeeHeader?: TaxibeeHeader }).TaxibeeHeader = header;
