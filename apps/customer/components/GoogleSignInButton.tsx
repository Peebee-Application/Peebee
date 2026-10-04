"use client";

import Script from "next/script";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth-context";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: Record<string, unknown>) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

/** "Continue with Google" — signs in if the Google account's email already
 * has a Peebee account, otherwise creates one (email pre-verified, since
 * Google already confirmed it). Renders nothing if no client ID is configured. */
export function GoogleSignInButton({ role }: { role: "customer" | "rider" }) {
  const { setSession } = useAuth();
  const router = useRouter();
  const buttonRef = useRef<HTMLDivElement>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!scriptReady || !CLIENT_ID || !buttonRef.current || !window.google) return;
    window.google.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: async (response: { credential: string }) => {
        setError(null);
        try {
          const res = await api.googleAuth(response.credential, role);
          setSession(res.token, res.user);
          router.replace("/");
        } catch (err) {
          setError(errorMessage(err));
        }
      },
    });
    window.google.accounts.id.renderButton(buttonRef.current, {
      type: "standard",
      theme: "outline",
      size: "large",
      shape: "pill",
      width: 320,
      text: "continue_with",
    });
  }, [scriptReady, role, setSession, router]);

  if (!CLIENT_ID) return null;

  return (
    <div className="space-y-2">
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={() => setScriptReady(true)} />
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-[var(--border-faint)]" />
        <span className="text-xs font-semibold text-ink-500">OR</span>
        <span className="h-px flex-1 bg-[var(--border-faint)]" />
      </div>
      <div ref={buttonRef} className="flex justify-center" />
      {error && <p className="text-center text-xs text-red-600">{error}</p>}
    </div>
  );
}
