"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthGate } from "./AuthGate";
import { BottomNav } from "./BottomNav";
import { BrandHeader } from "./BrandHeader";
import { SettingsDrawer } from "./SettingsDrawer";
import { SupportAlertsProvider } from "./SupportAlerts";
import { Breadcrumbs } from "./shell/Breadcrumbs";
import { CommandPalette } from "./shell/CommandPalette";
import { Sidebar } from "./shell/Sidebar";
import { Toaster } from "./shell/Toaster";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = pathname === "/login" || pathname === "/set-password";
  // The dashboard and the Users page use the whole desktop width; settings and forms stay in a readable column.
  const wide = pathname === "/" || pathname.startsWith("/people") || pathname.startsWith("/income");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    if (isAuthPage) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setDrawerOpen(false);
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isAuthPage]);

  // A new page closes the menus.
  useEffect(() => {
    setDrawerOpen(false);
    setSearchOpen(false);
  }, [pathname]);

  const openSearch = () => { setDrawerOpen(false); setSearchOpen(true); };

  return (
    <AuthGate>
      <SupportAlertsProvider>
      {!isAuthPage && <BrandHeader onMenuClick={() => setDrawerOpen(true)} onSearch={openSearch} />}
      {!isAuthPage && <Sidebar onSearch={openSearch} />}
      {!isAuthPage && <SettingsDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onSearch={openSearch} />}
      {!isAuthPage && <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />}
      <div className={isAuthPage ? "" : "lg:pl-[264px]"}>
        <main className={`admin-main mx-auto min-h-dvh max-w-lg customer-nav-content-clearance pb-[calc(88px+env(safe-area-inset-bottom))] ${isAuthPage ? "" : wide ? "lg:max-w-[1440px]" : "lg:max-w-[1040px]"}`}>
          {!isAuthPage && <Breadcrumbs />}
          {children}
        </main>
      </div>
      {!isAuthPage && <BottomNav onSettingsClick={() => setDrawerOpen(true)} />}
      {!isAuthPage && <Toaster />}
      </SupportAlertsProvider>
    </AuthGate>
  );
}
