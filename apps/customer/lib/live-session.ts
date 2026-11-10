import { createPracticeFetch, discardPracticeSession } from "@peebee/shared";

/** Session calls that must hit the live API even while practice mode is still flagged on. */
const LIVE_AUTH_POSTS = new Set([
  "/v1/auth/login",
  "/v1/auth/register",
  "/v1/auth/google",
  "/v1/auth/logout",
  "/v1/auth/password/reset/request",
  "/v1/auth/password/reset/confirm",
]);

/**
 * Customer fetch: a signed-out visitor never sees practice data, and signing
 * in or out always reaches the real account API. Other requests keep the
 * shared practice simulator while a signed-in customer is practising, so
 * rider and merchant practice behaviour is unchanged.
 */
export function createCustomerFetch(getToken: () => string | null | undefined, realFetch: typeof fetch = fetch): typeof fetch {
  const practice = createPracticeFetch("customer", realFetch);
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const raw = request?.url ?? String(input);
    const url = new URL(raw, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const signedOut = !getToken();
    if (signedOut || (method === "POST" && LIVE_AUTH_POSTS.has(url.pathname))) return realFetch(input, init);
    return practice(input, init);
  }) as typeof fetch;
}

/** Ends the one token. A failure is ignored: the local session is already going. */
export function revokeToken(token: string | null | undefined) {
  if (!token || typeof fetch === "undefined") return;
  const base = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:10000").replace(/\/$/, "");
  void fetch(`${base}/v1/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
}

/**
 * Leaves practice without restoring a saved session. Revokes a server-practice
 * backup token when it is not the token being kept. Returns the backup so
 * callers can still read it.
 */
export function leavePracticeForLiveSession(tokenKey: string, keepToken?: string | null): Record<string, string | null> | null {
  const backup = discardPracticeSession();
  const backed = backup?.[tokenKey];
  if (backed && backed !== keepToken) revokeToken(backed);
  return backup;
}
