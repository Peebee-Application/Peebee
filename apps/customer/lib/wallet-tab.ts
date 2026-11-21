"use client";

export type WalletTab = "recipients" | "home" | "accounts";

const listeners = new Set<() => void>();

function readTab(): WalletTab {
  if (typeof window === "undefined") return "home";
  const value = new URLSearchParams(window.location.search).get("tab");
  return value === "recipients" || value === "accounts" ? value : "home";
}

let tab: WalletTab = readTab();

export function subscribeWalletTab(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getWalletTab(): WalletTab {
  return tab;
}

export function setWalletTab(next: WalletTab) {
  if (tab === next) return;
  tab = next;
  listeners.forEach((listener) => listener());
}

export function walletTabHref(next: WalletTab): string {
  return next === "home" ? "/wallet" : `/wallet?tab=${next}`;
}
