"use client";

import { ADMIN_ROLE_LABELS, hasPermission } from "@peebee/shared";
import { ClipboardList, LogOut, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { ChangePasswordPanel } from "../../components/ChangePasswordPanel";
import { useAuth } from "../../lib/auth-context";

export default function AccountPage() {
  const { user, logout } = useAuth();
  const isSuperAdmin = user?.adminRole === "super_admin";
  const canViewActivityLog = hasPermission(user?.adminRole ?? null, "activity_log.view");

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <h1 className="text-xl font-bold text-ink">Account</h1>

      <section className="home-card flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ink/10 text-ink">
          <ShieldCheck className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
        <span>
          <span className="block text-[15px] font-bold text-ink">{user?.name ?? "—"}</span>
          <span className="block text-sm text-ink-500">{user?.phone ?? user?.email}</span>
        </span>
        <span className="ml-auto shrink-0 rounded-full bg-ink/10 px-2.5 py-0.5 text-xs font-semibold text-ink">
          {user?.adminRole ? ADMIN_ROLE_LABELS[user.adminRole] : "Admin"}
        </span>
      </section>

      {isSuperAdmin && (
        <Link
          href="/staff"
          className="home-card flex items-center gap-3 !rounded-2xl !py-3 text-sm font-semibold text-ink"
        >
          <Users className="h-5 w-5 text-gold" strokeWidth={1.75} aria-hidden />
          Staff accounts
        </Link>
      )}

      {canViewActivityLog && (
        <Link
          href="/activity"
          className="home-card flex items-center gap-3 !rounded-2xl !py-3 text-sm font-semibold text-ink"
        >
          <ClipboardList className="h-5 w-5 text-gold" strokeWidth={1.75} aria-hidden />
          Activity log
        </Link>
      )}

      <ChangePasswordPanel />

      <button
        onClick={logout}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-[var(--border-faint)] px-4 text-sm font-bold text-ink"
      >
        <LogOut className="h-4 w-4" strokeWidth={2} aria-hidden />
        Log out
      </button>
    </div>
  );
}
