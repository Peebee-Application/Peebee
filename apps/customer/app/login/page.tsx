"use client";
import { AuthJourney } from "@peebee/shared/auth";


import Link from "next/link";
import { useState } from "react";
import { GoogleSignInButton } from "../../components/GoogleSignInButton";
import { PasswordInput } from "../../components/PasswordInput";
import { useAuth } from "../../lib/auth-context";
import { errorMessage } from "../../lib/api";

type Identifier = "email" | "phone";

export default function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [identifierType, setIdentifierType] = useState<Identifier>("email");
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") {
        await login(loginIdentifier, password);
      } else if (identifierType === "email") {
        await register({ email: email.trim(), name, password });
      } else {
        await register({ phone: phone.trim(), name, password });
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return <AuthJourney mode={mode} onModeChange={setMode} busy={busy} welcomeTitle="Your day, delivered." description="Shopping, errands and rides. Let Peebee take care of the little things." signupTitle="Ready to start?">
        <form onSubmit={onSubmit} className="card space-y-4 !p-5">
          {mode === "login" ? (
            <div className="space-y-1">
              <label className="text-xs font-semibold text-ink-500" htmlFor="identifier">
                Phone or email
              </label>
              <input
                id="identifier"
                required
                value={loginIdentifier}
                onChange={(e) => setLoginIdentifier(e.target.value)}
                className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
                placeholder="sharon@example.com"
              />
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-ink-500" htmlFor="name">
                  Name
                </label>
                <input
                  id="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
                  placeholder="Sharon"
                />
              </div>

              <div className="flex rounded-full bg-[rgb(var(--surface-muted))] p-1">
                {(["email", "phone"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setIdentifierType(t)}
                    className={`flex-1 rounded-full py-2 text-xs font-bold capitalize transition-colors ${
                      identifierType === t ? "glass-panel text-ink shadow-sm" : "text-ink-500"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {identifierType === "email" ? (
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-ink-500" htmlFor="email">
                    Email
                  </label>
                  <input
                    id="email"
                    required
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
                    placeholder="sharon@example.com"
                  />
                </div>
              ) : (
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-ink-500" htmlFor="phone">
                    Phone
                  </label>
                  <input
                    id="phone"
                    required
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
                    placeholder="+256700000001"
                  />
                </div>
              )}
            </>
          )}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink-500" htmlFor="password">
              Password
            </label>
            <PasswordInput
              id="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          <GoogleSignInButton role="customer" />
<button
            type="submit"
            disabled={busy}
            className="flex min-h-12 w-full items-center justify-center rounded-full bg-gold px-4 py-3 text-base font-bold text-ink-gold shadow-[0_4px_12px_rgba(201,162,39,0.35)] transition-opacity hover:opacity-95 disabled:opacity-60"
          >
            {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
          </button>

          {mode === "login" && (
            <Link href="/forgot-password" className="block text-center text-sm font-semibold text-gold">
              Forgot password?
            </Link>
          )}
        </form>


  </AuthJourney>;
}
