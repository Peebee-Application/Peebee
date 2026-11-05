"use client";

import {
  ClipboardCheck,
  FileText,
  Home,
  Pill,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { filterByModule, useModules } from "../lib/modules";

const NAV_ITEMS: { href: string; label: string; icon: typeof Home; badge?: string; module?: string }[] = [
  { href: "/", label: "Overview", icon: Home },
  { href: "/prescriptions", label: "Rx Review", icon: FileText, badge: "Live", module: "buy.pharmacy" },
  { href: "/inventory", label: "Medicines", icon: Pill, module: "buy.pharmacy" },
  { href: "/license", label: "Compliance", icon: ShieldCheck },
  { href: "/wallet", label: "Wallet", icon: Wallet },
];

export function PharmacyNav() {
  const pathname = usePathname();
  const moduleOn = useModules();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border-faint)] bg-[rgb(var(--surface-card))]/95 backdrop-blur-md safe-bottom">
      <div className="mx-auto flex max-w-lg items-center justify-around px-2 py-2">
        {filterByModule(NAV_ITEMS, moduleOn).map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex flex-col items-center gap-1 rounded-2xl px-3 py-1.5 text-[11px] font-bold transition active:scale-95 ${
                active
                  ? "text-gold font-black"
                  : "text-ink-500 hover:text-ink"
              }`}
            >
              <div className="relative">
                <Icon className={`h-5 w-5 ${active ? "text-gold" : "text-ink-500"}`} />
                {item.badge && !active && (
                  <span className="absolute -right-1.5 -top-1 flex h-2 w-2 rounded-full bg-gold" />
                )}
              </div>
              <span>{item.label}</span>
              {active && (
                <span className="absolute -bottom-1 h-1 w-6 rounded-full bg-gold" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
