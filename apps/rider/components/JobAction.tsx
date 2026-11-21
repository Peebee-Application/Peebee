"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const JobActionContext = createContext({ active: false, register: (_change: number) => {} });

/** Mounting a job action replaces the tabs; leaving the flow restores them. */
export function JobActionProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0);
  const [register] = useState(() => (change: number) => setCount((value) => Math.max(0, value + change)));
  return <JobActionContext.Provider value={{ active: count > 0, register }}>{children}</JobActionContext.Provider>;
}

export function useJobActionActive() { return useContext(JobActionContext).active; }

export function JobAction({ children }: { children: ReactNode }) {
  const { register } = useContext(JobActionContext);
  useEffect(() => { register(1); return () => register(-1); }, [register]);
  return <nav aria-label="Job action" className="customer-nav fixed inset-x-0 bottom-3 z-40 px-3 pb-[env(safe-area-inset-bottom)]">
    <div className="customer-nav-capsule mx-auto flex max-w-lg items-center gap-1 rounded-[24px] p-1.5">
      <Link href="/" aria-label="Back to jobs" className="flex h-[62px] w-12 shrink-0 items-center justify-center rounded-[18px] text-white focus-visible:outline focus-visible:outline-gold"><ChevronLeft className="h-7 w-7" aria-hidden /></Link>
      <div className="job-action-content min-w-0 flex-1">{children}</div>
    </div>
  </nav>;
}
