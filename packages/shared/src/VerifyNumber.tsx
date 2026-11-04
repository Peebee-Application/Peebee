"use client";

import { useState } from "react";

/**
 * "Verify" for a saved mobile money number: texts a 6-digit code to the number, then asks for it. Presentational on
 * purpose: each app passes its own API calls, so this works in the customer, rider and partner apps alike.
 * Only a number its owner can receive texts on can be verified, which is the point.
 */
export function VerifyNumber({
  send,
  confirm,
  onVerified,
}: {
  send: () => Promise<{ devCode?: string } | void>;
  confirm: (code: string) => Promise<unknown>;
  onVerified: () => void;
}) {
  const [step, setStep] = useState<"idle" | "code">("idle");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);

  async function sendCode() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await send();
      setDevCode(res && "devCode" in res && res.devCode ? res.devCode : null);
      setStep("code");
      setCode("");
    } catch (err) {
      setMessage(err instanceof Error ? err.message.replace(/^API \d+: /, "") : "Couldn't send the code.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode() {
    setBusy(true);
    setMessage(null);
    try {
      await confirm(code.trim());
      onVerified();
    } catch (err) {
      setMessage(err instanceof Error ? err.message.replace(/^API \d+: /, "") : "That code isn't right.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "idle") {
    return (
      <div className="space-y-1">
        <button type="button" onClick={() => void sendCode()} disabled={busy} className="text-xs font-bold text-gold disabled:opacity-50">
          {busy ? "Sending…" : "Verify this number"}
        </button>
        {message && <p className="text-xs text-red-600">{message}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-ink-500">We texted a 6-digit code to this number. It expires in 10 minutes.</p>
      {devCode && <p className="text-xs font-semibold text-gold">Test code: {devCode}</p>}
      <div className="flex gap-2">
        <input
          aria-label="6-digit code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          placeholder="123456"
          className="min-w-0 flex-1 rounded-lg border border-[var(--border-faint)] px-3 py-2 text-[15px] tracking-widest outline-none focus:border-gold"
        />
        <button
          type="button"
          onClick={() => void confirmCode()}
          disabled={busy || code.length !== 6}
          className="shrink-0 rounded-lg bg-gold px-3 text-sm font-bold text-ink-gold disabled:opacity-50"
        >
          {busy ? "Checking…" : "Confirm"}
        </button>
      </div>
      <button type="button" onClick={() => void sendCode()} disabled={busy} className="text-xs font-semibold text-ink-500 underline disabled:opacity-50">
        Send a new code
      </button>
      {message && <p className="text-xs text-red-600">{message}</p>}
    </div>
  );
}
