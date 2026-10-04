"use client";

import type { AuthUser } from "@peebee/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, TOKEN_KEY, USER_KEY } from "./api";

type AuthState = {
  user: AuthUser | null;
  ready: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => void;
  /** Signs the browser in directly with an already-issued token — e.g. after a password change. */
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

  const persist = useCallback((token: string, nextUser: AuthUser) => {
    window.localStorage.setItem(TOKEN_KEY, token);
    window.localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    setUser(nextUser);
  }, []);

  const login = useCallback(
    async (identifier: string, password: string) => {
      const res = await api.login({ identifier, password });
      if (res.user.role !== "admin") {
        throw new Error("This portal is for admin accounts only.");
      }
      persist(res.token, res.user);
    },
    [persist],
  );

  const logout = useCallback(() => {
    // Order matters: this call reads the token out of local storage to
    // authenticate itself, so it has to be started before the token is
    // removed. Signing out doesn't wait on it or fail with it — the local
    // session goes either way — but without it the token stays valid on the
    // server for the rest of its life. That matters most here: this is the
    // account that can read every rider's National ID.
    const revoked = api.logout().catch(() => undefined);
    // A shared device shouldn't see this account's cached data — the
    // service worker's runtime cache is keyed by URL, not by who's signed
    // in, so it has to be cleared explicitly. Matters most here: this is
    // the account that can read every rider's National ID.
    navigator.serviceWorker?.controller?.postMessage("clear-runtime-cache");
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
    setUser(null);
    void revoked;
  }, []);

  const value = useMemo(
    () => ({ user, ready, login, logout, setSession: persist }),
    [user, ready, login, logout, persist],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
