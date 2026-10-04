"use client";

import type { AuthUser, Merchant } from "@peebee/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, TOKEN_KEY, USER_KEY } from "./api";

type AuthState = {
  user: AuthUser | null;
  ready: boolean;
  merchants: Merchant[];
  merchant: Merchant | null;
  merchantsReady: boolean;
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
    if (!user) {
      setMerchants([]);
      setMerchantsReady(true);
      return;
    }
    try {
      const result = await api.myMerchants();
      setMerchants(result.merchants);
      if (!selectedId && result.merchants[0]) setSelectedId(result.merchants[0].id);
    } finally {
      setMerchantsReady(true);
    }
  }, [selectedId, user]);

  useEffect(() => {
    setMerchantsReady(false);
    void refreshMerchants();
  }, [refreshMerchants, user?.id]);

  const persist = useCallback((token: string, nextUser: AuthUser) => {
    if (nextUser.role !== "customer") throw new Error("Use a customer account for Peebee Merchant.");
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
    localStorage.setItem("peebee_merchant_selected", id);
    setSelectedId(id);
  }, []);

  const logout = useCallback(() => {
    void api.logout().catch(() => undefined);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem("peebee_merchant_selected");
    setUser(null);
    setMerchants([]);
  }, []);

  const merchant = merchants.find((item) => item.id === selectedId) ?? merchants[0] ?? null;
  const value = useMemo(() => ({ user, ready, merchants, merchant, merchantsReady, selectMerchant, refreshMerchants, login, register, setSession: persist, logout }),
    [user, ready, merchants, merchant, merchantsReady, selectMerchant, refreshMerchants, login, register, persist, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
