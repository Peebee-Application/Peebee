"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { classifyAuthError, type AuthNotice } from "../../lib/auth-notice";
import { useAuth } from "../../lib/auth-context";
import { AuthNoticeView, GoogleMark } from "./AuthUi";

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

/**
 * "Continue with Google". The real Google button sits on top of our dark
 * face so the tap reaches Google's iframe (an overlay on top of that iframe
 * is ignored on Android). With no client id configured, the face itself
 * explains that email or phone still works.
 */
export function CustomerGoogleButton({ onSignedIn, onNotice }: { onSignedIn?: () => void; onNotice?: (notice: AuthNotice | null) => void }) {
  const { setSession } = useAuth();
  const buttonRef = useRef<HTMLDivElement>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [notice, setNotice] = useState<AuthNotice | null>(null);
  const show = useCallback((next: AuthNotice | null) => {
    setNotice(next);
    onNotice?.(next);
  }, [onNotice]);

  useEffect(() => {
    if (!busy) return;
    const timer = window.setTimeout(() => setSlow(true), 3500);
    return () => window.clearTimeout(timer);
  }, [busy]);

  useEffect(() => {
    if (!scriptReady || !CLIENT_ID || !buttonRef.current || !window.google) return;
    const node = buttonRef.current;
    window.google.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: async (response: { credential: string }) => {
        show(null);
        setSlow(false);
        setBusy(true);
        try {
          const res = await api.googleAuth(response.credential, "customer");
          setSession(res.token, res.user);
          onSignedIn?.();
        } catch (err) {
          show(classifyAuthError(err));
        } finally {
          setBusy(false);
        }
      },
    });
    let previousWidth = 0;
    const render = () => {
      const width = Math.round(node.parentElement?.clientWidth ?? node.clientWidth);
      if (!width || width === previousWidth) return;
      previousWidth = width;
      const sdkWidth = Math.min(400, Math.max(200, width));
      node.replaceChildren();
      window.google?.accounts.id.renderButton(node, {
        type: "standard",
        theme: "filled_black",
        size: "large",
        shape: "rectangular",
        width: sdkWidth,
        text: "continue_with",
        logo_alignment: "center",
      });
    };
    render();
    const observer = new ResizeObserver(render);
    if (node.parentElement) observer.observe(node.parentElement);
    return () => observer.disconnect();
  }, [scriptReady, setSession, onSignedIn, show]);

  if (CLIENT_ID && !scriptReady) {
    return (
      <>
        <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onReady={() => setScriptReady(true)} onError={() => show({ tone: "google", message: "Google sign-in didn't work. Use email or phone instead." })} />
        <div className="account-skel" role="status" aria-label="Loading Google sign-in" />
        {notice && <div className="mt-3"><AuthNoticeView notice={notice} /></div>}
      </>
    );
  }

  return (
    <div className="space-y-3">
      {CLIENT_ID && <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onReady={() => setScriptReady(true)} onError={() => show({ tone: "google", message: "Google sign-in didn't work. Use email or phone instead." })} />}
      <div className={`account-google account-btn account-btn-dark${busy ? " is-busy" : ""}`} aria-busy={busy || undefined}>
        {busy && <span className="account-spin" aria-hidden />}
        <GoogleMark />
        <span>{busy ? "Signing you in…" : "Continue with Google"}</span>
        {CLIENT_ID ? <div ref={buttonRef} className="account-google-hit" /> : (
          <button type="button" className="account-google-fallback" aria-label="Continue with Google" onClick={() => show({ tone: "google", message: "Google sign-in didn't work. Use email or phone instead." })} />
        )}
      </div>
      {slow && busy && <AuthNoticeView notice={{ tone: "info", message: "Still working…" }} />}
      {notice && <AuthNoticeView notice={notice} />}
    </div>
  );
}
