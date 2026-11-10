"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthButton, AuthField, AuthNoticeView, AuthScreen, AuthSub, AuthTitle, AuthTop, OtpBoxes, PasswordField } from "../../components/account/AuthUi";
import { identifierInputMode, identifierIsValid, identifierKind, maskContact } from "../../lib/account-id";
import { classifyAuthError, type AuthNotice } from "../../lib/auth-notice";
import { api } from "../../lib/api";
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
  const [slow, setSlow] = useState(false);
  const [notice, setNotice] = useState<AuthNotice | null>(null);

  useEffect(() => {
    if (!busy) return;
    const timer = window.setTimeout(() => setSlow(true), 3500);
    return () => window.clearTimeout(timer);
  }, [busy]);

  const kind = identifierKind(identifier);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    if (!identifierIsValid(identifier) || busy) return;
    setSlow(false);
    setBusy(true);
    setNotice(null);
    try {
      const res = await api.requestPasswordReset(identifier.trim());
      if (res.target) setSentTarget(res.target);
      if (res.devCode) setDevCode(res.devCode);
      setStep("confirm");
    } catch (err) {
      setNotice(classifyAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmReset(e: React.FormEvent) {
    e.preventDefault();
    if (busy || code.length !== 6 || newPassword.length < 6) return;
    setSlow(false);
    setBusy(true);
    setNotice(null);
    try {
      const res = await api.confirmPasswordReset(identifier.trim(), code, newPassword);
      setSession(res.token, res.user);
    } catch (err) {
      setNotice(classifyAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthScreen>
      <AuthTop
        busy={busy}
        onBack={() => {
          if (busy) return;
          if (step === "confirm") { setStep("request"); setNotice(null); return; }
          router.push("/login");
        }}
        step={step === "request" ? "Reset" : "New password"}
      />
      {step === "request" ? (
        <form onSubmit={requestCode}>
          <AuthTitle>Reset your password</AuthTitle>
          <AuthSub>Enter the phone or email on your account and we&apos;ll send a code.</AuthSub>
          <div className="account-stack">
            <AuthField
              id="identifier"
              label="Phone or email"
              icon={kind === "email" ? "mail" : "phone"}
              value={identifier}
              onChange={(value) => { setIdentifier(value); setNotice(null); }}
              type={kind === "email" ? "email" : "text"}
              inputMode={identifierInputMode(identifier)}
              autoComplete="username"
              autoFocus
              disabled={busy}
              invalid={!!notice}
            />
            {notice && <AuthNoticeView notice={notice} onRetry={() => void requestCode({ preventDefault() {} } as React.FormEvent)} />}
            {slow && busy && <AuthNoticeView notice={{ tone: "info", message: "Still working…" }} />}
            <AuthButton type="submit" busy={busy} disabled={!identifierIsValid(identifier)}>{busy ? "Sending…" : "Send reset code"}</AuthButton>
            <p className="account-links"><Link href="/login">Back to log in</Link></p>
          </div>
        </form>
      ) : (
        <form onSubmit={confirmReset}>
          <AuthTitle>Choose a new password</AuthTitle>
          <AuthSub>Enter the code we sent to <b>{maskContact(sentTarget ?? identifier)}</b>.</AuthSub>
          <div className="account-stack">
            <OtpBoxes value={code} onChange={setCode} disabled={busy} invalid={notice?.tone === "error"} />
            <PasswordField
              id="newPassword"
              label="New password · at least 6 characters"
              value={newPassword}
              onChange={setNewPassword}
              placeholder="New password"
              autoComplete="new-password"
              disabled={busy}
            />
            {devCode && <p className="account-dev">No SMS or email provider is configured yet — your code is <strong>{devCode}</strong>.</p>}
            {notice && <AuthNoticeView notice={notice} />}
            {slow && busy && <AuthNoticeView notice={{ tone: "info", message: "Still working…" }} />}
            <AuthButton type="submit" busy={busy} disabled={code.length !== 6 || newPassword.length < 6}>{busy ? "Saving…" : "Reset password"}</AuthButton>
            <p className="account-links"><button type="button" disabled={busy} onClick={() => { setStep("request"); setNotice(null); }}>Use a different phone or email</button></p>
          </div>
        </form>
      )}
    </AuthScreen>
  );
}
