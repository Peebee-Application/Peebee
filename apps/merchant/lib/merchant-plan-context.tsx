"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { api, errorMessage } from "./api";
import { useAuth } from "./auth-context";

type PlanAccess = { plan: string; isElite: boolean; features?: { catalog: boolean; live: boolean; ads: boolean }; pages?: { services: boolean; outlets: boolean } };
type State = { key: string; plan: PlanAccess | null; error: string | null };
const Context = createContext<{ plan: PlanAccess | null; loading: boolean; error: string | null; retry: () => void }>({ plan: null, loading: true, error: null, retry: () => {} });

/** One selected-business entitlement request shared by navigation and route gates. */
export function MerchantPlanProvider({ children }: { children: React.ReactNode }) {
  const { merchant } = useAuth();
  const pathname = usePathname();
  const key = `${merchant?.id ?? ""}:${pathname}`;
  const [state, setState] = useState<State | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!merchant) return;
    let active = true;
    api.getMerchantProStore().then(({ store }) => {
      if (active) setState({ key, plan: store?.plan ?? null, error: null });
    }).catch(cause => { if (active) setState({ key, plan: null, error: errorMessage(cause) }); });
    return () => { active = false; };
  }, [merchant?.id, key, attempt]);
  return <Context.Provider value={{ plan: state?.key === key ? state.plan : null, loading: Boolean(merchant) && state?.key !== key, error: state?.key === key ? state.error : null, retry: () => setAttempt(value => value + 1) }}>{children}</Context.Provider>;
}
export const useMerchantPlan = () => useContext(Context);
