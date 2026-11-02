"use client";
import { AuthJourney } from "@peebee/shared/auth";


import Link from "next/link";
import { useState } from "react";
import { GoogleSignInButton } from "../../components/GoogleSignInButton";
import { errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

export default function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [identifier, setIdentifier] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "login") await login(identifier, password);
      else if (identifier.includes("@")) await register({ name, email: identifier, password });
      else await register({ name, phone: identifier, password });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return <AuthJourney mode={mode} onModeChange={setMode} busy={busy} welcomeTitle="Good business starts here." description="Accept payments, sell products, manage branch stock and offer digital products or courses with the plan that fits your business." signupTitle="Ready for business?">
    <form onSubmit={submit} className="home-card flex flex-col gap-3.5">
      {mode === "register" && <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" className="min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-3"/>}
      <input aria-label="Email or phone" autoComplete="username" required value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="Email or phone" className="min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-3"/>
      <input required minLength={mode === "register" ? 6 : undefined} autoComplete={mode === "login" ? "current-password" : "new-password"} aria-label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-3"/>
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {mode === "login" && <Link href="/forgot-password" className="min-h-11 text-center text-sm font-bold text-gold">Forgot password?</Link>}
      <GoogleSignInButton />
<button disabled={busy} className="min-h-12 w-full rounded-full bg-gold font-bold text-ink-gold disabled:opacity-50">{busy ? "Please wait…" : mode === "login" ? "Log in" : "Continue"}</button>
    </form>

    <p className="text-center text-xs text-ink-500">Formal smartphone-equipped businesses are supported first. Merchant Lite for informal stalls comes later.</p>
  </AuthJourney>;
}
