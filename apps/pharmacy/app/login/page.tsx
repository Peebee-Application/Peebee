"use client";

import {
  FileText,
  KeyRound,
  Phone,
  Pill,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "../../lib/auth-context";
import { ServerPracticeCard } from "@peebee/shared/practice-ui";
import { api } from "../../lib/api";

export default function PharmacyLoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(identifier, password);
      router.push("/");
    } catch (err: any) {
      setError(err?.message || "Sign in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-sm space-y-6 pt-8 pb-12">
      <div className="text-center space-y-2">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl bg-gold text-ink-gold shadow-md">
          <Pill className="h-8 w-8" />
        </div>
        <h1 className="text-xl font-black text-ink">Peebee Pharmacy</h1>
        <p className="text-xs text-ink-500 font-medium">
          Licensed Pharmacist & Prescription Dispensing Portal
        </p>
      </div>

      <div className="home-card !p-6 shadow-sm space-y-4">
        {error && (
          <div className="rounded-2xl bg-red-500/10 p-3 text-xs font-bold text-red-600">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-ink-500">Phone number or email</label>
            <div className="field-box flex items-center rounded-2xl border border-[var(--border-faint)] px-3 py-2.5">
              <Phone className="h-4 w-4 text-ink-500 shrink-0" />
              <input
                type="text"
                required
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="w-full bg-transparent px-2.5 text-xs text-ink focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-ink-500">Password</label>
            <div className="field-box flex items-center rounded-2xl border border-[var(--border-faint)] px-3 py-2.5">
              <KeyRound className="h-4 w-4 text-ink-500 shrink-0" />
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-transparent px-2.5 text-xs text-ink focus:outline-none"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-2xl bg-gold py-3 text-xs font-black text-ink-gold shadow transition hover:opacity-95 active:scale-98 disabled:opacity-50"
          >
            {busy ? "Signing in..." : "Sign in to Pharmacy Console"}
          </button>
        </form>

        <div className="rounded-2xl bg-[rgb(var(--surface-muted))] p-3 text-center text-[11px] text-ink-500">
          <p>Supervising Pharmacist Credentials verified via National Drug Authority (NDA)</p>
        </div>
      </div>

      <ServerPracticeCard role="pharmacy" api={api} body="Try the pharmacy console as a demo pharmacist: prescriptions to quote, orders to prepare and stock to manage. Nothing here is real." buttonLabel="Practise as a pharmacist" />
    </div>
  );
}
