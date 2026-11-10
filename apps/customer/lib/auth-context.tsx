"use client";

import { resetNotificationSnapshots } from "@peebee/shared";

import type { AuthUser } from "@peebee/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, TOKEN_KEY, USER_KEY } from "./api";
import { leavePracticeForLiveSession, revokeToken } from "./live-session";
import { unsubscribeFromPush } from "./push";
import { AUTH_CHANGE_EVENT } from "./cart";

type AuthState = {
  user: AuthUser | null;
  ready: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  register: (input: { phone?: string; email?: string; name: string; password: string }) => Promise<void>;
  logout: () => void;
  /** Patches the persisted user in place (e.g. after OTP verification succeeds) without a new token. */
  updateUser: (user: AuthUser) => void;
  /** Signs the browser in directly with an already-issued token (e.g. after a password reset). */
  setSession: (token: string, user: AuthUser) => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(USER_KEY);
      if (raw) setUser(JSON.parse(raw) as AuthUser);
    } catch {
      // ignore corrupt storage
    } finally {
      setReady(true);
    }
  }, []);

  // Per-user state on this device (the marketplace bag, lib/cart.ts) re-reads when the account changes.
  const userId = user?.id ?? null;
  useEffect(() => {
    if (ready) window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
  }, [ready, userId]);

  const persist = useCallback((token: string, nextUser: AuthUser) => {
    // Every successful sign-in starts live. A practice backup is revoked, not restored.
    const previous = window.localStorage.getItem(TOKEN_KEY);
    leavePracticeForLiveSession(TOKEN_KEY, token);
    if (previous && previous !== token) revokeToken(previous);
    resetNotificationSnapshots();
    window.localStorage.setItem(TOKEN_KEY, token);
    window.localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    setUser(nextUser);
  }, []);

  const login = useCallback(
    async (identifier: string, password: string) => {
      const res = await api.login({ identifier, password });
      if (res.user.role === "rider") {
        throw new Error("This account is registered as a rider. Please sign in from the rider app instead.");
      }
      if (res.user.role === "admin") {
        throw new Error("This account is registered as staff. Please sign in from the admin app instead.");
      }
      persist(res.token, res.user);
    },
    [persist],
  );

  const register = useCallback(
    async (input: { phone?: string; email?: string; name: string; password: string }) => {
      const res = await api.register({ ...input, role: "customer" });
      persist(res.token, res.user);
    },
    [persist],
  );

  const logout = useCallback(() => {
    resetNotificationSnapshots();
    // Drop practice before the logout call so it reaches the real API (the
    // practice simulator otherwise swallows /v1/auth/logout) and so a saved
    // practice session is not written back on top of the next sign-in.
    const current = window.localStorage.getItem(TOKEN_KEY);
    leavePracticeForLiveSession(TOKEN_KEY, current);
    // Order matters: this call reads the token out of local storage to
    // authenticate itself, so it has to be started before the token is
    // removed. Signing out doesn't wait on it or fail with it — the local
    // session goes either way — but without it the token stays valid on the
    // server for the rest of its life.
    const revoked = api.logout().catch(() => undefined);
    void unsubscribeFromPush();
    // A shared device (or just the next person to sign in on this one)
    // shouldn't see this account's cached orders/chat/wallet data — the
    // service worker's runtime cache is keyed by URL, not by who's signed
    // in, so it has to be cleared explicitly rather than just left to age
    // out on its own.
    navigator.serviceWorker?.controller?.postMessage("clear-runtime-cache");
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
    setUser(null);
    void revoked;
  }, []);

  const updateUser = useCallback((nextUser: AuthUser) => {
    window.localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    setUser(nextUser);
  }, []);

  const value = useMemo(
    () => ({ user, ready, login, register, logout, updateUser, setSession: persist }),
    [user, ready, login, register, logout, updateUser, persist],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
