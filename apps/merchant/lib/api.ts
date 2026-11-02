import { configurePracticeSession, createApiClient, createPracticeFetch, friendlyErrorMessage } from "@peebee/shared";

export const TOKEN_KEY = "peebee_merchant_token";
export const USER_KEY = "peebee_merchant_user";

export function getStoredToken() {
  return typeof window === "undefined" ? null : window.localStorage.getItem(TOKEN_KEY);
}

export const api = createApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:10000",
  fetchImpl: (input, init) => {
    const headers = new Headers(init?.headers);
    const selected = typeof window === "undefined" ? null : localStorage.getItem("peebee_merchant_selected");
    if (selected) headers.set("X-Merchant-Id", selected);
    return createPracticeFetch("merchant")(input, { ...init, headers });
  },
  getToken: getStoredToken,
  onUnauthorized() {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
    if (window.location.pathname !== "/login") window.location.href = "/login";
  },
});

export const errorMessage = friendlyErrorMessage;

/** Practice signs in as a demo persona on the shared practice world; the real session is put back on exit. */
configurePracticeSession({ api, apply: (r) => ({ [TOKEN_KEY]: r.token, [USER_KEY]: JSON.stringify(r.user) }) });
