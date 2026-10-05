"use client";
import { AuthScene } from "@peebee/shared/auth";


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
    <AuthScene><div className="auth-legacy">
      <div className="mx-auto w-full max-w-sm space-y-6">

        <div className="space-y-1 text-center">
          <h1 className="text-lg font-bold text-ink">Set your password</h1>
          <p className="text-sm text-ink-500">
            Enter the temporary password you were sent, then choose one only you know.
          </p>
        </div>

        <ChangePasswordPanel onDone={() => router.replace("/")} />
      </div>
    </div></AuthScene>
  );
}
