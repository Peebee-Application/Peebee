"use client";
import { AuthScene } from "@peebee/shared/auth";


import { CheckCircle2, XCircle } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { api } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";

const REASON_MESSAGES: Record<string, string> = {
  expired: "That link has expired. Log in and request a fresh one from the verify screen.",
  invalid: "That link is invalid or has already been used.",
  missing: "That link looks incomplete.",
};

function ConfirmedContent() {
  const params = useSearchParams();
  const ok = params.get("ok") === "1";
  const reason = params.get("reason") ?? "invalid";
  const { user, ready, updateUser } = useAuth();
  const refreshed = useRef(false);

  // The link verifies the account server-side, but if this browser is
  // already signed in (the common case — tapping the emailed link from the
  // same phone), its cached user object still shows unverified until we
  // pull the fresh copy. Without this, AuthGate sends them right back to
  // the code-entry screen after they tap "Continue to Peebee" — exactly the
  // "either/or, not both" flow this page exists to guarantee.
  useEffect(() => {
    if (!ok || !ready || !user || refreshed.current) return;
    refreshed.current = true;
    api
      .me()
      .then((res) => updateUser(res.user))
      .catch(() => {});
  }, [ok, ready, user, updateUser]);

  return (
    <AuthScene><div className="auth-legacy">
      <div className="mx-auto w-full max-w-sm space-y-6 text-center">

        <div className="card space-y-4 !p-8">
          {ok ? (
            <>
              <CheckCircle2 className="mx-auto h-12 w-12 text-green" strokeWidth={1.5} aria-hidden />
              <h1 className="text-xl font-bold text-ink">Email verified</h1>
              <p className="text-sm text-ink-500">You&apos;re all set — you can head back into Peebee.</p>
            </>
          ) : (
            <>
              <XCircle className="mx-auto h-12 w-12 text-red-600" strokeWidth={1.5} aria-hidden />
              <h1 className="text-xl font-bold text-ink">Couldn&apos;t verify that</h1>
              <p className="text-sm text-ink-500">{REASON_MESSAGES[reason] ?? REASON_MESSAGES.invalid}</p>
            </>
          )}

          <Link
            href="/"
            className="flex min-h-12 w-full items-center justify-center rounded-full bg-gold px-4 py-3 text-base font-bold text-ink-gold shadow-[0_4px_12px_rgba(201,162,39,0.35)] transition-opacity hover:opacity-95"
          >
            Continue to Peebee
          </Link>
        </div>
      </div>
    </div></AuthScene>
  );
}

export default function VerifyConfirmedPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmedContent />
    </Suspense>
  );
}
