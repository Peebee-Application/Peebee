"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CustomerGoogleButton } from "../../components/account/CustomerGoogleButton";
import {
  AuthBrand,
  AuthButton,
  AuthField,
  AuthNoticeView,
  AuthScreen,
  AuthSub,
  AuthTitle,
  AuthTop,
  CollapsedId,
  PasswordField,
} from "../../components/account/AuthUi";
import { identifierInputMode, identifierIsValid, identifierKind, identifierLabel } from "../../lib/account-id";
import { classifyAuthError, type AuthNotice } from "../../lib/auth-notice";
import { useAuth } from "../../lib/auth-context";
import { useGuestAccess } from "../../lib/guest-access";

type Step = "welcome" | "identifier" | "password" | "signup";
type Intent = "login" | "signup";

export default function LoginPage() {
  const { login, register } = useAuth();
  const { browsingEnabled, configReady } = useGuestAccess();
  const [step, setStep] = useState<Step>("welcome");
  const [intent, setIntent] = useState<Intent>("login");
  const [identifier, setIdentifier] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [notice, setNotice] = useState<AuthNotice | null>(null);

  useEffect(() => {
    if (!busy) return;
    const timer = window.setTimeout(() => setSlow(true), 3500);
    return () => window.clearTimeout(timer);
  }, [busy]);

  const kind = identifierKind(identifier);
  const idIcon = kind === "email" ? "mail" : "phone";
  const idValid = identifierIsValid(identifier);
  const showSignupPassword = name.trim().length > 0;

  async function submitLogin() {
    setNotice(null);
    setSlow(false);
    setBusy(true);
    try {
      await login(identifier.trim(), password);
    } catch (err) {
      setNotice(classifyAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitSignup() {
    setNotice(null);
    setSlow(false);
    setBusy(true);
    try {
      if (kind === "email") await register({ email: identifier.trim(), name: name.trim(), password });
      else await register({ phone: identifier.trim(), name: name.trim(), password });
    } catch (err) {
      setNotice(classifyAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  function continueFromIdentifier() {
    if (!idValid || busy) return;
    setNotice(null);
    setStep(intent === "signup" ? "signup" : "password");
  }

  return (
    <AuthScreen welcome={step === "welcome"}>
      {step === "welcome" ? (
        <>
          <AuthBrand />
          <AuthTitle center>Your day, delivered.</AuthTitle>
          <AuthSub center>Food, shopping and parcels, brought to your door by a Peebee rider.</AuthSub>
          <div className="account-stack" style={{ marginTop: 30 }}>
            <CustomerGoogleButton onNotice={setNotice} />
            <div className="account-or">or</div>
            <AuthButton tone="sec" onClick={() => { setIntent("login"); setNotice(null); setStep("identifier"); }}>Continue with email or phone</AuthButton>
            {configReady && browsingEnabled && (
              <Link href="/" className="account-textlink">Browse as guest <Chevron /></Link>
            )}
          </div>
          {notice && <div className="account-stack"><AuthNoticeView notice={notice} /></div>}
          <p className="account-legal">
            <a href="https://peebee.online/terms" target="_blank" rel="noreferrer">Terms</a>
            {" · "}
            <a href="https://peebee.online/privacy" target="_blank" rel="noreferrer">Privacy</a>
            {" · "}
            <Link href="/help">Help</Link>
          </p>
        </>
      ) : (
        <>
          <AuthTop
            busy={busy}
            onBack={() => {
              setNotice(null);
              if (step === "identifier") setStep("welcome");
              else setStep("identifier");
            }}
            step={step === "signup" || intent === "signup" ? (step === "identifier" ? "Step 1 of 3" : "Step 2 of 3") : step === "identifier" ? "Step 1 of 2" : "Step 2 of 2"}
          />
          {step === "identifier" && (
            <form onSubmit={(e) => { e.preventDefault(); continueFromIdentifier(); }}>
              <AuthTitle>Sign in or sign up</AuthTitle>
              <AuthSub>Enter your phone number or email.</AuthSub>
              <div className="account-stack">
                <AuthField
                  id="identifier"
                  label="Phone or email"
                  icon={kind === "email" ? "mail" : "phone"}
                  value={identifier}
                  onChange={(value) => { setIdentifier(value); setNotice(null); }}
                  placeholder="+256 70"
                  type={kind === "email" ? "email" : "text"}
                  inputMode={identifierInputMode(identifier)}
                  autoComplete="username"
                  autoFocus
                  invalid={!!notice}
                />
                <p className="account-hint">We&apos;ll show the right keyboard as you type.</p>
                <AuthButton type="submit" disabled={!idValid}>Continue</AuthButton>
              </div>
            </form>
          )}
          {step === "password" && (
            <form onSubmit={(e) => { e.preventDefault(); if (!busy && password) void submitLogin(); }}>
              <AuthTitle>Welcome back</AuthTitle>
              <AuthSub>Enter your password to log in.</AuthSub>
              <div className="account-stack">
                <CollapsedId label={identifierLabel(identifier)} value={identifier.trim()} icon={idIcon} onChange={busy ? undefined : () => setStep("identifier")} disabled={busy} />
                <PasswordField
                  id="password"
                  label="Password"
                  value={password}
                  onChange={(value) => { setPassword(value); setNotice(null); }}
                  placeholder="Password"
                  autoComplete="current-password"
                  disabled={busy}
                  invalid={notice?.tone === "error"}
                  autoFocus
                />
                {notice && <AuthNoticeView notice={notice} onRetry={() => void submitLogin()} />}
                <AuthButton type="submit" busy={busy} disabled={!password}>{busy ? "Signing you in…" : "Log in"}</AuthButton>
                {slow && busy && <AuthNoticeView notice={{ tone: "info", message: "Still working…" }} />}
                <p className="account-links"><Link href="/forgot-password">Forgot password?</Link></p>
                <p className="account-links">
                  New to Peebee?{" "}
                  <button type="button" disabled={busy} onClick={() => { setIntent("signup"); setNotice(null); setStep("signup"); }}>Create account</button>
                </p>
              </div>
            </form>
          )}
          {step === "signup" && (
            <form onSubmit={(e) => { e.preventDefault(); if (!busy && name.trim().length >= 2 && password.length >= 6) void submitSignup(); }}>
              <AuthTitle>Create your account</AuthTitle>
              <div className="account-stack">
                <CollapsedId label={identifierLabel(identifier)} value={identifier.trim()} icon={idIcon} onChange={busy ? undefined : () => { setIntent("signup"); setStep("identifier"); }} disabled={busy} />
                <AuthField
                  id="name"
                  label="Full name"
                  icon="user"
                  value={name}
                  onChange={(value) => { setName(value); setNotice(null); }}
                  placeholder="Sharon Namuli"
                  autoComplete="name"
                  disabled={busy}
                  autoFocus
                />
                {showSignupPassword && (
                  <PasswordField
                    id="new-password"
                    label="Password · at least 6 characters"
                    value={password}
                    onChange={(value) => { setPassword(value); setNotice(null); }}
                    placeholder="Password · at least 6 characters"
                    autoComplete="new-password"
                    disabled={busy}
                    invalid={notice?.tone === "error"}
                  />
                )}
                {notice && <AuthNoticeView notice={notice} onRetry={() => void submitSignup()} />}
                <AuthButton type="submit" busy={busy} disabled={name.trim().length < 2 || password.length < 6}>{busy ? "Creating account…" : "Create account"}</AuthButton>
                {slow && busy && <AuthNoticeView notice={{ tone: "info", message: "Still working…" }} />}
                <p className="account-links">
                  Already have an account?{" "}
                  <button type="button" disabled={busy} onClick={() => { setIntent("login"); setNotice(null); setStep("password"); }}>Log in</button>
                </p>
              </div>
            </form>
          )}
        </>
      )}
    </AuthScreen>
  );
}

function Chevron() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 5l7 7-7 7" /></svg>;
}
