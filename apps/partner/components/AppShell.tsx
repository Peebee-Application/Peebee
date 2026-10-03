"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../lib/auth-context";
import { AuthGate } from "./AuthGate";
import { BottomNav } from "./BottomNav";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { mode, setMode } = useAuth();
  const bare = pathname === "/login";
  return (
    <AuthGate>
      {!bare && (
        <header className="sticky top-0 z-30 border-b border-[var(--border-faint)] bg-[rgb(var(--surface))]/95 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-xl items-center gap-3 px-4">
            <Link href="/" aria-label="Go to partner home" className="shrink-0">
              <Image src="/brand/tuma-logo-navy.png" alt="Tuma" width={120} height={36} priority className="h-7 w-auto dark:hidden" />
              <Image src="/brand/tuma-logo-white.png" alt="Tuma" width={120} height={36} priority className="hidden h-7 w-auto dark:block" />
            </Link>
            <div role="tablist" aria-label="Switch between owner and driver" className="ml-auto flex gap-1.5">
              {(["driver", "owner"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className={`min-h-9 rounded-full px-4 text-xs font-bold capitalize ${mode === m ? "bg-gold text-ink-gold" : "bg-gold/15 text-ink"}`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </header>
      )}
      <main className={`mx-auto min-h-dvh max-w-xl ${bare ? "" : "pb-20"}`}>{children}</main>
      {!bare && <BottomNav />}
    </AuthGate>
  );
}
