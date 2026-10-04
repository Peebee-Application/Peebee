"use client";

import { hasPermission } from "@peebee/shared";
import { User, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../lib/auth-context";
import { SETTINGS_LINKS } from "../lib/settings-nav";

export function NavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const canViewSettings = hasPermission(user?.adminRole ?? null, "settings.view");
  const visibleSettingsLinks = SETTINGS_LINKS.filter((link) => !link.show || link.show(user?.adminRole ?? null));

  return (
    <>
      <div
        className={`fixed inset-0 z-[60] bg-black/40 transition-opacity ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={`fixed inset-y-0 left-0 z-[70] flex w-[85%] max-w-xs flex-col overflow-y-auto bg-[rgb(var(--surface-card))] pb-[env(safe-area-inset-bottom)] shadow-xl transition-transform ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-faint)] px-4 py-3">
          <span className="text-sm font-bold text-ink">Menu</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink-500"
          >
            <X className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          </button>
        </div>

        <nav className="flex-1 space-y-5 px-2 py-3">
          <div>
            <Link
              href="/account"
              onClick={onClose}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${
                pathname.startsWith("/account") ? "bg-gold/15 text-gold" : "text-ink"
              }`}
            >
              <User className="h-4.5 w-4.5" strokeWidth={1.75} aria-hidden />
              Account
            </Link>
          </div>

          {canViewSettings && (
            <div>
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">Settings</p>
              <ul className="space-y-0.5">
                {visibleSettingsLinks.map((link) => {
                  const Icon = link.icon;
                  const active = pathname.startsWith(link.href);
                  return (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        onClick={onClose}
                        className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${
                          active ? "bg-gold/15 text-gold" : "text-ink"
                        }`}
                      >
                        <Icon className="h-4.5 w-4.5 shrink-0" strokeWidth={1.75} aria-hidden />
                        {link.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </nav>
      </aside>
    </>
  );
}
