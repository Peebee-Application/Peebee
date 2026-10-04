"use client";

import { useRouter } from "next/navigation";
import { ChangePasswordPanel } from "../../components/ChangePasswordPanel";

/**
 * Where AuthGate sends a staff account with force_password_change set —
 * right after being invited, or after a Super Admin resets their password.
 * The API rejects almost every other request until this is done, so there's
 * nothing else useful to show here.
 */
export default function SetPasswordPage() {
  const router = useRouter();

  return (
    <div className="flex min-h-dvh flex-col justify-center px-6 py-10">
      <div className="mx-auto w-full max-w-sm space-y-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/peebee-logo-navy.png" alt="Peebee" className="mx-auto h-9 w-auto dark:hidden" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/peebee-logo-white.png" alt="Peebee" className="mx-auto hidden h-9 w-auto dark:block" />

        <div className="space-y-1 text-center">
          <h1 className="text-lg font-bold text-ink">Set your password</h1>
          <p className="text-sm text-ink-500">
            Enter the temporary password you were sent, then choose one only you know.
          </p>
        </div>

        <ChangePasswordPanel onDone={() => router.replace("/")} />
      </div>
    </div>
  );
}
