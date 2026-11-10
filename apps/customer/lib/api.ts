import { configurePracticeSession, createApiClient, friendlyErrorMessage } from "@peebee/shared";
import { createCustomerFetch, leavePracticeForLiveSession } from "./live-session";

export const TOKEN_KEY = "peebee_customer_token";
export const USER_KEY = "peebee_customer_user";

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

/** The session ended server-side (expired, reset, suspended, or signed out
 * elsewhere). Drop the cached copy and start again at the login screen —
 * otherwise the app keeps showing a signed-in shell where nothing loads.
 * A full page load rather than a router push, so no stale state survives. */
function onUnauthorized() {
  if (typeof window === "undefined") return;
  // The session is already dead. Drop practice too, so the login screen is live
  // and a saved practice persona cannot be written back over the next sign-in.
  leavePracticeForLiveSession(TOKEN_KEY, null);
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
  if (!window.location.pathname.startsWith("/login")) window.location.href = "/login";
}

export const api = createApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:10000",
  fetchImpl: createCustomerFetch(getStoredToken),
  getToken: getStoredToken,
  onUnauthorized,
});

/** Practice signs in as a demo persona on the shared practice world; the real session is put back on exit. */
configurePracticeSession({ api, apply: (r) => ({ [TOKEN_KEY]: r.token, [USER_KEY]: JSON.stringify(r.user) }) });

/** Extracts a human-readable message from an ApiClient error — never a
 * raw "API 400: xxx" string. */
export function errorMessage(err: unknown): string {
  return friendlyErrorMessage(err);
}
