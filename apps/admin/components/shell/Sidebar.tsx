"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { useAuth } from "../../lib/auth-context";
import { isActive, visibleGroups } from "../../lib/admin-nav";
import { useSupportAlerts } from "../SupportAlerts";

/** Desktop navigation: every admin area in clear groups, always in view. */
export function Sidebar({ onSearch }: { onSearch: () => void }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const groups = visibleGroups(user?.adminRole ?? null);
  const support = useSupportAlerts();
  return (
    <aside aria-label="Admin navigation" className="admin-sidebar fixed bottom-0 left-0 top-16 z-30 hidden w-[264px] flex-col lg:flex">
      <div className="px-4 pb-2 pt-4">
        <button type="button" onClick={onSearch} className="admin-search-btn flex h-10 w-full items-center gap-2 rounded-xl px-3 text-sm text-ink-500">
          <Search className="h-4 w-4" aria-hidden />
          <span className="flex-1 text-left">Search admin…</span>
          <kbd className="admin-kbd">⌘K</kbd>
        </button>
      </div>
      <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 pb-6 pt-2">
        {groups.map((g) => (
          <div key={g.id}>
            <p className="admin-nav-group px-3 pb-1.5">{g.label}</p>
            <ul className="space-y-0.5">
              {g.items.map((item) => {
                const Icon = item.icon;
                const on = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link href={item.href} aria-current={on ? "page" : undefined} className={`admin-nav-link ${on ? "is-active" : ""}`}>
                      <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={on ? 2.2 : 1.8} aria-hidden />
                      <span className="truncate">{item.label}</span>
                      {item.href === "/support-chat" && support.waiting > 0 && (
                        <span className="ml-auto rounded-full bg-red-500 px-1.5 text-[11px] font-black leading-5 text-white" aria-label={`${support.waiting} waiting`}>{support.waiting}</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
