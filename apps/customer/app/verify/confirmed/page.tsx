"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { AuthScreen, AuthSub, AuthTitle } from "../../../components/account/AuthUi";
import { api } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";
import { takeReturnTo } from "../../../lib/return-to";

const REASON_MESSAGES: Record<string, string> = {
  expired: "That link has expired. Log in and request a fresh one from the verify screen.",
  invalid: "That link is invalid or has already been used.",
  missing: "That link looks incomplete.",
};

function ConfirmedContent() {
  const params = useSearchParams();
  const router = useRouter();
  const ok = params.get("ok") === "1";
  const reason = params.get("reason") ?? "invalid";
  const { user, ready, updateUser } = useAuth();
  const refreshed = useRef(false);

  // The link verifies the account server-side. A browser that is already
  // signed in still has the old user until we pull the fresh copy, and
  // AuthGate would send them back to the code screen without it.
  useEffect(() => {
    if (!ok || !ready || !user || refreshed.current) return;
    refreshed.current = true;
    api.me().then((res) => updateUser(res.user)).catch(() => {});
  }, [ok, ready, user, updateUser]);

  return (
    <AuthScreen>
      <div className="account-stack" style={{ marginTop: 48, textAlign: "center" }}>
        {ok ? <CheckCircle2 className="mx-auto h-12 w-12 text-green" strokeWidth={1.5} aria-hidden /> : <XCircle className="mx-auto h-12 w-12" style={{ color: "rgb(var(--color-danger))" }} strokeWidth={1.5} aria-hidden />}
        <AuthTitle center>{ok ? "Email verified" : "Couldn't verify that"}</AuthTitle>
        <AuthSub center>{ok ? "You're all set — you can head back into Peebee." : (REASON_MESSAGES[reason] ?? REASON_MESSAGES.invalid)}</AuthSub>
        <Link
          href={ok ? "/" : "/login"}
          className="account-btn account-btn-gold"
          onClick={(event) => {
            if (!ok) return;
            const path = takeReturnTo() ?? "/";
            if (path === "/") return;
            event.preventDefault();
            router.push(path);
          }}
        >Continue</Link>
      </div>
    </AuthScreen>
  );
}

export default function VerifyConfirmedPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmedContent />
    </Suspense>
  );
}
