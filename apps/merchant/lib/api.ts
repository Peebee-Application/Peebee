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

/** Merchant-only additions retain the shared client's selected business, practice transport and auth. */
export async function merchantRequest<T>(path: string, init: {method?: string; body?: unknown} = {}): Promise<T> {
  const headers = new Headers({"Content-Type":"application/json"});
  const token = getStoredToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const selected = typeof window === "undefined" ? null : localStorage.getItem("peebee_merchant_selected");
  if (selected) headers.set("X-Merchant-Id",selected);
  const response = await createPracticeFetch("merchant")(`${api.baseUrl}/v1${path}`, {method:init.method??"GET",headers,cache:"no-store",body:init.body===undefined?undefined:JSON.stringify(init.body)});
  const body = await response.json().catch(()=>({})) as {message?:string;error?:string};
  if (response.status === 401 && token && typeof window !== "undefined") {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
    if (window.location.pathname !== "/login") window.location.href = "/login";
  }
  if (!response.ok) throw new Error(body.message??body.error??`Request failed (${response.status})`);
  return body as T;
}

/** Practice signs in as a demo persona on the shared practice world; the real session is put back on exit. */
configurePracticeSession({ api, apply: (r) => ({ [TOKEN_KEY]: r.token, [USER_KEY]: JSON.stringify(r.user) }) });
