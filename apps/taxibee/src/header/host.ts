import { useSyncExternalStore } from "react";
import { friendlyErrorMessage } from "@peebee/shared";
import type { TaxibeeHeaderHost } from "./contracts";

export let host: TaxibeeHeaderHost;
export let api: TaxibeeHeaderHost["api"];
const listeners = new Set<() => void>();

export function configureHost(value: TaxibeeHeaderHost) {
  host = value;
  api = value.api;
}

export function sync() {
  listeners.forEach(listener => listener());
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getStoredToken() {
  return host?.getToken() ?? null;
}

export const errorMessage = friendlyErrorMessage;

export function useAuth() {
  const user = useSyncExternalStore(subscribe, () => host.getUser());
  return {
    user,
    ready: true,
    updateUser: host.updateUser,
    setSession: host.setSession,
    logout: user ? host.signOut : host.signIn,
  };
}

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function subscribeToPush() {
  return host.subscribePush();
}
