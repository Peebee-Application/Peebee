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

export function GoogleSignInButton() {
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
          // Car owners and drivers are customer-role identities, so they use
          // the customer Google flow.
          const result = await api.googleAuth(response.credential, "customer");
          setSession(result.token, result.user);
          router.replace("/");
        } catch (cause) {
          setError(errorMessage(cause));
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
  }, [router, scriptReady, setSession]);

  if (!CLIENT_ID) return null;

  return (
    <div className="space-y-2">
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
      />
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-[var(--border-faint)]" />
        <span className="text-xs font-semibold text-ink-500">OR</span>
        <span className="h-px flex-1 bg-[var(--border-faint)]" />
      </div>
      <div ref={buttonRef} className="flex justify-center" />
      {error ? <p className="text-center text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
