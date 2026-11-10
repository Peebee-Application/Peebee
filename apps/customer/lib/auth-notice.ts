import { ApiError, friendlyErrorMessage } from "@peebee/shared";

export type AuthNoticeTone = "error" | "lockout" | "offline" | "google" | "info";

export type AuthNotice = { tone: AuthNoticeTone; message: string };

const GOOGLE_COPY = "Google sign-in didn't work. Use email or phone instead.";
const CREDENTIALS_COPY = "Wrong phone, email or password. Try again or reset your password.";
const OFFLINE_COPY = "You're offline. Check your connection, then Retry.";
const LOCKOUT_COPY = "Too many tries. Please wait a few minutes.";

function serverMessage(err: ApiError): string {
  const message = friendlyErrorMessage(err);
  return message && !message.startsWith("API ") ? message : "";
}

/** Maps a failed sign-in into the notice that sits under the fields. Values the person typed stay put. */
export function classifyAuthError(err: unknown): AuthNotice {
  const browserOffline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (browserOffline || err instanceof TypeError) return { tone: "offline", message: OFFLINE_COPY };
  if (err instanceof ApiError) {
    if (err.code === "invalid_credentials") return { tone: "error", message: CREDENTIALS_COPY };
    if (err.status === 429 || err.code === "rate_limited") return { tone: "lockout", message: serverMessage(err) || LOCKOUT_COPY };
    if (err.code === "role_mismatch" || err.code === "account_suspended") {
      return { tone: err.code === "role_mismatch" ? "google" : "error", message: serverMessage(err) || "That account can't sign in here." };
    }
    if (err.code === "invalid_google_token" || err.code?.startsWith("google_")) return { tone: "google", message: GOOGLE_COPY };
  }
  const message = friendlyErrorMessage(err);
  if (/too many|try again shortly|rate limit/i.test(message)) return { tone: "lockout", message };
  if (/couldn't connect|offline|network/i.test(message)) return { tone: "offline", message: OFFLINE_COPY };
  if (/google sign-in/i.test(message)) return { tone: "google", message: GOOGLE_COPY };
  return { tone: "error", message };
}
