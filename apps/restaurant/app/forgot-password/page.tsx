"use client";
import { AuthScene } from "@peebee/shared/auth";


import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PasswordInput } from "../../components/PasswordInput";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const { setSession } = useAuth();
  const [step, setStep] = useState<"request" | "confirm">("request");
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [sentTarget, setSentTarget] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.requestPasswordReset(identifier.trim());
      if (res.target) setSentTarget(res.target);
      if (res.devCode) setDevCode(res.devCode);
      setStep("confirm");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmReset(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.confirmPasswordReset(identifier.trim(), code, newPassword);
      setSession(res.token, res.user);
      router.replace("/");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthScene><div className="auth-legacy">
      <div className="mx-auto w-full max-w-sm space-y-6">

        <div className="space-y-1 text-center">
          <h1 className="text-xl font-bold text-ink">Reset your password</h1>
          <p className="text-sm text-ink-500">
            {step === "request"
              ? "Enter the phone or email on your account and we'll send you a reset code."
              : `Enter the code we sent to ${sentTarget ?? "you"} and choose a new password.`}
          </p>
        </div>

        {step === "request" ? (
          <form onSubmit={requestCode} className="card space-y-4 !p-5">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-ink-500" htmlFor="identifier">
                Phone or email
              </label>
              <input
                id="identifier"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
                placeholder="sharon@example.com"
                autoFocus
              />
            </div>

            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

            <button
              type="submit"
              disabled={busy || !identifier.trim()}
              className="flex min-h-12 w-full items-center justify-center rounded-full bg-gold px-4 py-3 text-base font-bold text-ink-gold shadow-[0_4px_12px_rgba(201,162,39,0.35)] transition-opacity hover:opacity-95 disabled:opacity-60"
            >
              {busy ? "Sending…" : "Send reset code"}
            </button>
          </form>
        ) : (
          <form onSubmit={confirmReset} className="card space-y-4 !p-5">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-ink-500" htmlFor="code">
                6-digit code
              </label>
              <input
                id="code"
                required
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, ""))}
                className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-3 text-center text-2xl tracking-[0.4em] outline-none focus:border-gold"
                placeholder="······"
                autoFocus
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-ink-500" htmlFor="newPassword">
                New password
              </label>
              <PasswordInput
                id="newPassword"
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
                placeholder="••••••••"
              />
            </div>

            {devCode && (
              <p className="rounded-lg bg-gold/10 px-3 py-2 text-xs text-ink-500">
                No SMS/email provider configured yet — your code is <strong>{devCode}</strong>.
              </p>
            )}
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

            <button
              type="submit"
              disabled={busy || code.length !== 6 || newPassword.length < 6}
              className="flex min-h-12 w-full items-center justify-center rounded-full bg-gold px-4 py-3 text-base font-bold text-ink-gold shadow-[0_4px_12px_rgba(201,162,39,0.35)] transition-opacity hover:opacity-95 disabled:opacity-60"
            >
              {busy ? "Resetting…" : "Reset password"}
            </button>

            <button
              type="button"
              onClick={() => setStep("request")}
              className="w-full text-center text-sm font-semibold text-gold"
            >
              Use a different phone or email
            </button>
          </form>
        )}

        <Link href="/login" className="block text-center text-xs text-ink-500 underline">
          Back to log in
        </Link>
      </div>
    </div></AuthScene>
  );
}
