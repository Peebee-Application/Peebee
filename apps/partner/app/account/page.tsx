"use client";

import { LogOut } from "lucide-react";
import { AppearanceSettings } from "../../components/AppearanceSettings";
import { useAuth } from "../../lib/auth-context";

export default function AccountPage() {
  const { user, me, logout } = useAuth();
  return (
    <div className="space-y-5 px-4 py-5">
      <header>
        <h1 className="text-2xl font-black">Account</h1>
        <p className="text-sm text-ink-500">{user?.name}</p>
      </header>
      <section className="home-card space-y-1 text-sm">
        <p>Owner: <strong>{me?.ownerStatus ?? "none"}</strong></p>
        <p>Driver: <strong>{me?.driverStatus ?? "none"}</strong></p>
      </section>
      <AppearanceSettings />
      <button onClick={logout} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-red-300 font-bold text-red-600">
        <LogOut className="h-4 w-4" />Log out
      </button>
    </div>
  );
}
