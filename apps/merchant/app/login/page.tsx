"use client";

import { BrandLogo } from "../../components/BrandLogo";

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

  return <div className="flex min-h-dvh items-center px-5 py-10"><div className="mx-auto w-full max-w-sm space-y-6">
    <div className="text-center">
      <BrandLogo wordmark={false} className="justify-center" />
      <h1 className="mt-3 text-2xl font-black text-navy">Merchant</h1>
      <p className="text-sm text-ink-500">Receive digital shopping payments without asking riders to cash out.</p>
    </div>
    <div className="flex rounded-full bg-[rgb(var(--surface-muted))] p-1">{(["login", "register"] as const).map((item) => <button key={item} type="button" onClick={() => setMode(item)} className={`flex-1 rounded-full py-2 text-sm font-bold ${mode === item ? "bg-[rgb(var(--surface))] shadow" : "text-ink-500"}`}>{item === "login" ? "Log in" : "Create account"}</button>)}</div>
    <form onSubmit={submit} className="home-card space-y-3">
      {mode === "register" && <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" className="min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-3"/>}
      <input required value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="Email or phone" className="min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-3"/>
      <input required minLength={6} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-3"/>
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      <button disabled={busy} className="min-h-12 w-full rounded-full bg-gold font-bold text-ink-gold disabled:opacity-50">{busy ? "Please wait…" : mode === "login" ? "Log in" : "Continue"}</button>
    </form>
    <GoogleSignInButton />
    <p className="text-center text-xs text-ink-500">Formal smartphone-equipped businesses are supported first. Merchant Lite for informal stalls comes later.</p>
  </div></div>;
}
