"use client";

import { hasPermission } from "@peebee/shared";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useAuth } from "../../lib/auth-context";
import { SETTINGS_LINKS } from "../../lib/settings-nav";

export default function SettingsPage() {
  const { user } = useAuth();
  const links = SETTINGS_LINKS.filter((link) => !link.show || link.show(user?.adminRole ?? null));

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <h1 className="text-xl font-bold text-ink">Settings</h1>
      <p className="text-sm text-ink-500">Each area below is its own page — tap one to view or change it.</p>
      <ul className="space-y-2">
        {links.map((link) => {
          const Icon = link.icon;
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                className="home-card flex items-center gap-3 !py-3 transition active:opacity-70"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
                  <Icon className="h-4.5 w-4.5" strokeWidth={1.75} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink">{link.label}</span>
                  <span className="block truncate text-xs text-ink-500">{link.description}</span>
                </span>
                <ChevronRight className="h-4.5 w-4.5 shrink-0 text-ink-500" strokeWidth={1.75} aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
