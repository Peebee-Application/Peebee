"use client";

import { resetNotificationSnapshots } from "@peebee/shared";

import type { AuthUser, Merchant } from "@peebee/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage, TOKEN_KEY, USER_KEY } from "./api";

type AuthState = {
  user: AuthUser | null;
  ready: boolean;
  merchants: Merchant[];
  merchant: Merchant | null;
  merchantsReady: boolean;
  merchantLoadError: string | null;
  selectMerchant: (id: string) => void;
  refreshMerchants: () => Promise<void>;
  login: (identifier: string, password: string) => Promise<void>;
  register: (input: { name: string; email?: string; phone?: string; password: string }) => Promise<void>;
  setSession: (token: string, user: AuthUser) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [merchantsReady, setMerchantsReady] = useState(false);
  const [merchantLoadError, setMerchantLoadError] = useState<string | null>(null);
  const refreshEpoch = useRef(0);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(USER_KEY);
      if (raw) setUser(JSON.parse(raw) as AuthUser);
      setSelectedId(localStorage.getItem("peebee_merchant_selected"));
    } finally {
      setReady(true);
    }
  }, []);

  const refreshMerchants = useCallback(async () => {
    const request = ++refreshEpoch.current;
    setMerchantsReady(false);
    setMerchantLoadError(null);
    if (!user) {
      setMerchants([]);
      setMerchantsReady(true);
      return;
    }
    try {
      const result = await api.myMerchants();
      if (request !== refreshEpoch.current) return;
      setMerchants(result.merchants);
      if (!result.merchants.some((item) => item.id === selectedId)) {
        const nextId = result.merchants[0]?.id ?? null;
        setSelectedId(nextId);
        if (nextId) localStorage.setItem("peebee_merchant_selected", nextId);
        else localStorage.removeItem("peebee_merchant_selected");
      }
    } catch (cause) {
      if (request === refreshEpoch.current) setMerchantLoadError(errorMessage(cause));
      throw cause;
    } finally {
      if (request === refreshEpoch.current) setMerchantsReady(true);
    }
  }, [selectedId, user]);

  useEffect(() => {
    // The anonymous first render must not mark account loading complete before session restoration.
    if (!ready) return;
    void refreshMerchants().catch(() => undefined);
  }, [ready, refreshMerchants, user?.id]);

  const persist = useCallback((token: string, nextUser: AuthUser) => {
    resetNotificationSnapshots();
    if (nextUser.role !== "customer") throw new Error("Use a customer account for Peebee Merchant.");
    ++refreshEpoch.current;
    setMerchants([]);
    setMerchantsReady(false);
    setMerchantLoadError(null);
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

  const selectMerchant = useCallback((id: string) => {
    if (id === selectedId) return;
    ++refreshEpoch.current;
    setMerchantsReady(false);
    localStorage.setItem("peebee_merchant_selected", id);
    setSelectedId(id);
  }, [selectedId]);

  const logout = useCallback(() => {
    ++refreshEpoch.current;
    setMerchantLoadError(null);
    // Cached pages and data belong to the signed-in account; drop them on logout.
    navigator.serviceWorker?.controller?.postMessage("clear-runtime-cache");
    resetNotificationSnapshots();
    void api.logout().catch(() => undefined);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem("peebee_merchant_selected");
    setUser(null);
    setMerchants([]);
  }, []);

  const merchant = merchants.find((item) => item.id === selectedId) ?? merchants[0] ?? null;
  const value = useMemo(() => ({ user, ready, merchants, merchant, merchantsReady, merchantLoadError, selectMerchant, refreshMerchants, login, register, setSession: persist, logout }),
    [user, ready, merchants, merchant, merchantsReady, merchantLoadError, selectMerchant, refreshMerchants, login, register, persist, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
