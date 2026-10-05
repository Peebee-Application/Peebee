"use client";
import { AuthScene } from "@peebee/shared/auth";


import { isUserVerified } from "@peebee/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

type Channel = "sms" | "email";

export default function VerifyPage() {
  const { user, updateUser, logout } = useAuth();
  const router = useRouter();
  const [channel, setChannel] = useState<Channel>("email");
  const [code, setCode] = useState("");
  const [sentTarget, setSentTarget] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user && isUserVerified(user)) router.replace("/");
  }, [user, router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // A code was already sent at registration — this just covers the case of
  // returning to /verify later (e.g. after logging back in unverified).
  // Email is the default channel; phone-only accounts fall back to SMS.
  useEffect(() => {
    if (!user || isUserVerified(user)) return;
    const defaultChannel: Channel = user.email ? "email" : "sms";
    setChannel(defaultChannel);
    void sendCode(defaultChannel, { silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function sendCode(c: Channel, opts?: { silent?: boolean }) {
    setBusy(true);
    if (!opts?.silent) setError(null);
    setDevCode(null);
    try {
      const res = await api.requestVerification(c);
      setSentTarget(res.target);
      if (res.devCode) setDevCode(res.devCode);
      setCooldown(30);
    } catch (err) {
      if (!opts?.silent) setError(errorMessage(err));
      setCooldown(30);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.confirmVerification(channel, code);
      updateUser(res.user);
      router.replace("/");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function switchChannel(c: Channel) {
    setChannel(c);
    setCode("");
    setError(null);
    setSentTarget(null);
    setDevCode(null);
    setCooldown(0);
  }

  const hasEmail = !!user?.email;
  const hasPhone = !!user?.phone;
  const hasBothChannels = hasEmail && hasPhone;

  return (
    <AuthScene><div className="auth-legacy">
      <div className="mx-auto w-full max-w-sm space-y-6">

        <div className="space-y-1 text-center">
          <h1 className="text-xl font-bold text-ink">Verify your account</h1>
          <p className="text-sm text-ink-500">
            {channel === "sms"
              ? `Enter the 6-digit code we texted to ${sentTarget ?? user?.phone ?? "your phone"}.`
              : `Enter the 6-digit code we emailed to ${sentTarget ?? user?.email ?? "your email"}.`}
          </p>
        </div>

        {hasBothChannels && (
          <div className="flex rounded-full bg-[rgb(var(--surface-muted))] p-1">
            {(["sms", "email"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => switchChannel(c)}
                className={`flex-1 rounded-full py-2 text-sm font-semibold transition-colors ${
                  channel === c ? "glass-panel text-ink shadow-sm" : "text-ink-500"
                }`}
              >
                {c === "sms" ? "By SMS" : "By email"}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={confirm} className="card space-y-4 !p-5">
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

          {devCode && (
            <p className="rounded-lg bg-gold/10 px-3 py-2 text-xs text-ink-500">
              No SMS/email provider configured yet — your code is <strong>{devCode}</strong>.
            </p>
          )}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <button
            type="submit"
            disabled={busy || code.length !== 6}
            className="flex min-h-12 w-full items-center justify-center rounded-full bg-gold px-4 py-3 text-base font-bold text-ink-gold shadow-[0_4px_12px_rgba(201,162,39,0.35)] transition-opacity hover:opacity-95 disabled:opacity-60"
          >
            {busy ? "Please wait…" : "Verify"}
          </button>

          <button
            type="button"
            onClick={() => sendCode(channel)}
            disabled={busy || cooldown > 0}
            className="w-full text-center text-sm font-semibold text-gold disabled:cursor-not-allowed disabled:text-ink-500/60"
          >
            {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
          </button>
        </form>

        <button type="button" onClick={logout} className="mx-auto block text-center text-xs text-ink-500 underline">
          Log out
        </button>
      </div>
    </div></AuthScene>
  );
}
