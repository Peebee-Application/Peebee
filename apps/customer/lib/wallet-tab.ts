"use client";

/** Wallet gold-track tabs, in display order. `home` in a URL still means Central. */
export const WALLET_TABS = ["central", "topup", "send", "give", "accounts", "transactions", "recipients"] as const;
export type WalletTab = (typeof WALLET_TABS)[number];

const listeners = new Set<() => void>();

export function parseWalletTab(value: string | null | undefined): WalletTab {
  if (value === "home" || value === "central" || !value) return "central";
  return (WALLET_TABS as readonly string[]).includes(value) ? (value as WalletTab) : "central";
}

function readTab(): WalletTab {
  if (typeof window === "undefined") return "central";
  return parseWalletTab(new URLSearchParams(window.location.search).get("tab"));
}

let tab: WalletTab = readTab();

export function subscribeWalletTab(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getWalletTab(): WalletTab {
  return tab;
}

export function setWalletTab(next: WalletTab | "home") {
  const resolved = parseWalletTab(next);
  if (tab === resolved) return;
  tab = resolved;
  listeners.forEach((listener) => listener());
}

export function walletTabHref(next: WalletTab | "home"): string {
  const resolved = parseWalletTab(next);
  if (resolved === "give") return "/give";
  return resolved === "central" ? "/wallet" : `/wallet?tab=${resolved}`;
}
