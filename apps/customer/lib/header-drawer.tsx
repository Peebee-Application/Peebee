"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/** The header drawer has three heights: the bar, the first drop (~2/3), and a full section. */
export type HeaderDrawerMode = "closed" | "menu" | "section";
export type HeaderDrawerSection = "wallet" | "profile" | "notifications" | "settings";

type HeaderDrawerContextValue = {
  mode: HeaderDrawerMode;
  section: HeaderDrawerSection | null;
  openMenu: () => void;
  openSection: (section: HeaderDrawerSection) => void;
  close: () => void;
};

const HeaderDrawerContext = createContext<HeaderDrawerContextValue | null>(null);

export function HeaderDrawerProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<HeaderDrawerMode>("closed");
  const [section, setSection] = useState<HeaderDrawerSection | null>(null);

  const openMenu = useCallback(() => {
    setSection(null);
    setMode("menu");
  }, []);

  const openSection = useCallback((next: HeaderDrawerSection) => {
    setSection(next);
    setMode("section");
  }, []);

  const close = useCallback(() => {
    setMode("closed");
    setSection(null);
  }, []);

  const value = useMemo(
    () => ({ mode, section, openMenu, openSection, close }),
    [mode, section, openMenu, openSection, close],
  );

  return <HeaderDrawerContext.Provider value={value}>{children}</HeaderDrawerContext.Provider>;
}

export function useHeaderDrawer(): HeaderDrawerContextValue {
  const ctx = useContext(HeaderDrawerContext);
  if (!ctx) throw new Error("useHeaderDrawer must be used within HeaderDrawerProvider");
  return ctx;
}

/** Safe in shared chrome (nav, etc.) that may render outside the provider in tests. */
export function useHeaderDrawerOptional(): HeaderDrawerContextValue | null {
  return useContext(HeaderDrawerContext);
}

export function drawerSectionForPath(pathname: string): HeaderDrawerSection | null {
  if (pathname === "/wallet" || pathname.startsWith("/wallet/")) return "wallet";
  return null;
}

export function pathForDrawerSection(section: HeaderDrawerSection): string {
  if (section === "wallet") return "/wallet";
  if (section === "profile") return "/account";
  if (section === "notifications") return "/notifications";
  return "/settings";
}
