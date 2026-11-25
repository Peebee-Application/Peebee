"use client";

import { Bell, Bike, BookOpen, BriefcaseBusiness, Building2, CircleHelp, Home, Menu, Settings, ShoppingBag, UtensilsCrossed, Wallet, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useChatDrawer } from "../lib/chat-drawer";
import { useHeaderDrawer } from "../lib/header-drawer";
import { useHomeMenu } from "../lib/home-menu";
import { useModules } from "../lib/modules";
import { BrandHeader } from "./BrandHeader";
import { HeaderWordmark } from "./HeaderWordmark";
import { OfflineBanner } from "./OfflineBanner";

const brandDescriptionId = "customer-current-location";
const taglines = ["Go with Peebee", "Food, rides and more", "Find your next stop", "Shop closer to home"];

export function CustomerChrome({ children, navigation, hasNav }: { children: ReactNode; navigation: ReactNode; hasNav: boolean }) {
  const pathname = usePathname();
  const drawer = useHeaderDrawer();
  const chat = useChatDrawer();
  const menu = useHomeMenu();
  const isEnabled = useModules();
  const [sidebarPath, setSidebarPath] = useState<string | null>(null);
  const sideOpen = sidebarPath === pathname && !chat.open && drawer.mode === "closed";
  const opener = useRef<HTMLButtonElement>(null);
  const closer = useRef<HTMLButtonElement>(null);
  const pane = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const previousPath = useRef(pathname);
  const scrollPositions = useRef(new Map<string, number>());
  const restore = useRef(false);

  function closeSidebar() {
    setSidebarPath(null);
    requestAnimationFrame(() => opener.current?.focus());
  }

  useEffect(() => {
    if (!sideOpen) return;
    closer.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSidebar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sideOpen]);

  useEffect(() => {
    const onPop = () => {
      restore.current = location.pathname !== previousPath.current;
      setSidebarPath(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useLayoutEffect(() => {
    const element = pane.current;
    if (!element || previousPath.current === pathname) return;
    previousPath.current = pathname;
    element.scrollTop = restore.current ? scrollPositions.current.get(pathname) ?? 0 : 0;
    restore.current = false;
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      content.current?.getAnimations().forEach(animation => animation.cancel());
      content.current?.animate({ top: ["12px", "0px"] }, { duration: 180, easing: "ease-out" });
    }
  }, [pathname]);

  const destinations = [
    { href: "/", label: "Home", Icon: Home },
    ...(isEnabled("ride") ? [{ href: "/ride", label: menu.clusters.ride.label, Icon: Bike }] : []),
    ...(isEnabled("buy") ? [{ href: "/shopping", label: menu.clusters.shopping.label, Icon: ShoppingBag }] : []),
    ...(isEnabled("buy.food") ? [{ href: "/food", label: menu.clusters.food.label, Icon: UtensilsCrossed }] : []),
    ...(isEnabled("learn") ? [{ href: "/learn", label: menu.clusters.learn.label, Icon: BookOpen }] : []),
    ...(isEnabled("hive") ? [{ href: "/services", label: menu.clusters.hive.label, Icon: BriefcaseBusiness }] : []),
    ...(menu.navigation.spacesEnabled ? [{ href: "/spaces", label: menu.navigation.spacesLabel, Icon: Building2 }] : []),
    { href: "/wallet", label: "Wallet", Icon: Wallet },
    { href: "/notifications", label: "Notifications", Icon: Bell },
    { href: "/settings", label: "Settings", Icon: Settings },
    { href: "/help", label: "Help", Icon: CircleHelp },
  ];

  return (
    <div className="customer-chrome" data-side-open={sideOpen} data-nav={hasNav}>
      <aside id="customer-side-drawer" className="customer-side-drawer" role="dialog" aria-modal="true" aria-label="Peebee menu" inert={!sideOpen}>
        <div className="customer-side-drawer-heading">
          <strong>Peebee</strong>
          <button ref={closer} type="button" aria-label="Close sidebar" onClick={closeSidebar}><X size={22} aria-hidden /></button>
        </div>
        <nav aria-label="Peebee destinations">
          {destinations.map(({ href, label, Icon }) => (
            <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} onClick={() => setSidebarPath(null)}>
              <Icon size={21} aria-hidden />{label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="customer-chrome-surface" inert={sideOpen}>
        <BrandHeader
          brandDescriptionId={brandDescriptionId}
          renderBrand={details => <HeaderWordmark {...details} brandDescriptionId={brandDescriptionId} taglines={taglines} />}
          leadingControl={<button ref={opener} type="button" className="customer-header-toggle customer-sidebar-toggle" aria-label="Open sidebar" aria-controls="customer-side-drawer" aria-expanded={sideOpen}
            onClick={() => { drawer.close(); setSidebarPath(pathname); }}>
            <Menu size={24} aria-hidden />
          </button>}
        />
        <main ref={pane} className={`customer-content-pane ${hasNav ? "customer-nav-content-clearance" : ""}`}
          onScroll={event => scrollPositions.current.set(pathname, event.currentTarget.scrollTop)}>
          <OfflineBanner />
          <div ref={content} className="customer-chrome-content">{children}</div>
        </main>
        {navigation}
      </div>
      {sideOpen && <button type="button" className="customer-side-dismiss" aria-label="Close sidebar" tabIndex={-1} onClick={closeSidebar} />}
    </div>
  );
}
