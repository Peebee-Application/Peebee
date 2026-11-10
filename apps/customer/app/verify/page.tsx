"use client";

import { isUserVerified } from "@peebee/shared";
import { useEffect, useState } from "react";
import { AuthButton, AuthNoticeView, AuthScreen, AuthSub, AuthTitle, AuthTop, OtpBoxes } from "../../components/account/AuthUi";
import { maskContact } from "../../lib/account-id";
import { classifyAuthError, type AuthNotice } from "../../lib/auth-notice";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

type Channel = "sms" | "email";

function clock(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function VerifyPage() {
  const { user, updateUser, logout } = useAuth();
  const [picked, setPicked] = useState<Channel | null>(null);
  const channel: Channel = picked ?? (user?.email ? "email" : "sms");
  const [code, setCode] = useState("");
  const [sentTarget, setSentTarget] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<AuthNotice | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    if (!user || isUserVerified(user)) return;
    const next: Channel = user.email ? "email" : "sms";
    const timer = window.setTimeout(() => { void sendCode(next, { silent: true }); }, 0);
    return () => window.clearTimeout(timer);
    // The code is already sent at registration; this covers a later visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function sendCode(next: Channel, opts?: { silent?: boolean }) {
    setBusy(true);
    if (!opts?.silent) setNotice(null);
    setDevCode(null);
    try {
      const res = await api.requestVerification(next);
      setSentTarget(res.target);
      if (res.devCode) setDevCode(res.devCode);
      setCooldown(30);
    } catch (err) {
      if (!opts?.silent) setNotice(classifyAuthError(err));
      setCooldown(30);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6 || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await api.confirmVerification(channel, code);
      updateUser(res.user);
    } catch (err) {
      setNotice(classifyAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  function switchChannel() {
    const next: Channel = channel === "email" ? "sms" : "email";
    setPicked(next);
    setCode("");
    setNotice(null);
    setSentTarget(null);
    setDevCode(null);
    setCooldown(0);
    void sendCode(next);
  }

  const hasEmail = !!user?.email;
  const hasPhone = !!user?.phone;
  const shown = sentTarget ?? (channel === "sms" ? user?.phone : user?.email) ?? "";
  const other = channel === "email" ? "Send by SMS instead" : "Send by email instead";

  return (
    <AuthScreen>
      <AuthTop onBack={logout} backLabel="Sign out" step="Step 3 of 3" busy={busy} />
      <form onSubmit={confirm}>
        <AuthTitle>Enter the 6-digit code</AuthTitle>
        <AuthSub>We sent it to <b>{maskContact(shown)}</b></AuthSub>
        <div className="account-stack">
          <OtpBoxes value={code} onChange={(value) => { setCode(value); setNotice(null); }} disabled={busy} invalid={notice?.tone === "error"} />
          <p className="account-hint">It fills in automatically when the message arrives.</p>
          {devCode && <p className="account-dev">No SMS or email provider is configured yet — your code is <strong>{devCode}</strong>.</p>}
          {notice && <AuthNoticeView notice={notice} onRetry={() => void sendCode(channel)} />}
          <AuthButton type="submit" busy={busy} disabled={code.length !== 6}>{busy ? "Checking…" : "Verify"}</AuthButton>
          <div className="account-split">
            <span style={{ color: "rgb(var(--color-ink-500))" }}>
              {cooldown > 0 ? <>Resend code in <b style={{ color: "rgb(var(--color-ink))" }}>{clock(cooldown)}</b></> : (
                <button type="button" onClick={() => void sendCode(channel)} disabled={busy}>Resend code</button>
              )}
            </span>
            {hasEmail && hasPhone && (
              <button type="button" onClick={switchChannel} disabled={busy}>{other}</button>
            )}
          </div>
        </div>
      </form>
    </AuthScreen>
  );
}
