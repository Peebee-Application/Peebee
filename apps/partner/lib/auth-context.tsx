"use client";

import type { AuthUser, CarMe } from "@tuma/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, TOKEN_KEY, USER_KEY } from "./api";

export type PartnerMode = "owner" | "driver";
const MODE_KEY = "tuma_partner_mode";

type AuthState = {
  user: AuthUser | null;
  ready: boolean;
  /** Owner/driver status and vehicles; null until loaded. */
  me: CarMe | null;
  meReady: boolean;
  mode: PartnerMode;
  setMode: (mode: PartnerMode) => void;
  refreshMe: () => Promise<void>;
  login: (identifier: string, password: string) => Promise<void>;
  register: (input: { name: string; email?: string; phone?: string; password: string }) => Promise<void>;
  setSession: (token: string, user: AuthUser) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<CarMe | null>(null);
  const [meReady, setMeReady] = useState(false);
  const [mode, setModeState] = useState<PartnerMode>("driver");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(USER_KEY);
      if (raw) setUser(JSON.parse(raw) as AuthUser);
      const stored = localStorage.getItem(MODE_KEY);
      if (stored === "owner" || stored === "driver") setModeState(stored);
    } finally {
      setReady(true);
    }
  }, []);

  const refreshMe = useCallback(async () => {
    if (!user) {
      setMe(null);
      setMeReady(true);
      return;
    }
    try {
      setMe(await api.carMe());
    } catch {
      setMe(null);
    } finally {
      setMeReady(true);
    }
  }, [user]);

  useEffect(() => {
    setMeReady(false);
    void refreshMe();
  }, [refreshMe]);

  const setMode = useCallback((next: PartnerMode) => {
    localStorage.setItem(MODE_KEY, next);
    setModeState(next);
  }, []);

  const persist = useCallback((token: string, nextUser: AuthUser) => {
    if (nextUser.role !== "customer") throw new Error("Use a customer account for Tuma Car.");
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    setUser(nextUser);
  }, []);

  const login = useCallback(async (identifier: string, password: string) => {
    const result = await api.login({ identifier, password });
    persist(result.token, result.user);
  }, [persist]);

  const register = useCallback(async (input: { name: string; email?: string; phone?: string; password: string }) => {
    const result = await api.register({ ...input, role: "customer" });
    persist(result.token, result.user);
  }, [persist]);

  const logout = useCallback(() => {
    void api.logout().catch(() => undefined);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
    setMe(null);
  }, []);

  const value = useMemo(
    () => ({ user, ready, me, meReady, mode, setMode, refreshMe, login, register, setSession: persist, logout }),
    [user, ready, me, meReady, mode, setMode, refreshMe, login, register, persist, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
