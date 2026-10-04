import { createApiClient, friendlyErrorMessage } from "@peebee/shared";


export const TOKEN_KEY = "peebee_partner_token";
export const USER_KEY = "peebee_partner_user";

export function getStoredToken() {
  return typeof window === "undefined" ? null : window.localStorage.getItem(TOKEN_KEY);
}

export const api = createApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:10000",
  getToken: getStoredToken,
  onUnauthorized() {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
    if (window.location.pathname !== "/login") window.location.href = "/login";
  },
});

export const errorMessage = friendlyErrorMessage;
