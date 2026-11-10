import { PRACTICE_MODE_STORAGE_KEY, type PracticeRole } from "./practice.js";
import { startPracticeMode, practiceStartPath } from "./practice-runtime.js";

/**
 * Practising against the shared practice world on the server. The app signs in as a demo persona (POST /v1/practice/session)
 * and swaps that session into its own storage, so every screen and request works unchanged: the same API, the sandbox's
 * data. The person's real session is kept aside and put back on exit. When the server can't offer the shared world, the app
 * falls back to the built-in browser-local sample (practice-runtime.ts).
 */
export type PracticeSessionResult = {
  token: string;
  role: string;
  user?: { id: string; name: string; role: string; phone: string | null };
  attendant?: { id: string; code?: string; name: string; phone?: string; pump_lane?: string; on_duty?: boolean; outletId: string };
};

/** What an app puts in storage to be "signed in" as the persona: storage key → value (null removes the key). */
export type PracticeSessionApplier = (result: PracticeSessionResult) => Record<string, string | null>;

type Config = { api: { startPracticeSession(role: ServerRole): Promise<PracticeSessionResult> }; apply: PracticeSessionApplier };
export type ServerRole = "customer" | "rider" | "merchant" | "restaurant" | "pharmacy" | "gas" | "learner" | "educator" | "provider" | "worker" | "partner" | "sales" | "tv";

const SERVER_PRACTICE_KEY = "peebee_practice_server";
let config: Config | null = null;

/** Each app calls this once next to its API client. */
export function configurePracticeSession(next: Config) {
  config = next;
}

const storage = (): Storage | null => {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; }
};

export function isServerPractice(): boolean {
  return storage()?.getItem(SERVER_PRACTICE_KEY) != null;
}

const SERVER_ROLE: Record<PracticeRole, ServerRole> = { customer: "customer", rider: "rider", restaurant: "restaurant", merchant: "merchant", gas: "gas", learner: "learner" };

/** Starts practice. Returns the path to open. Uses the shared world when the server offers it, otherwise the built-in sample. */
export async function launchPractice(role: PracticeRole): Promise<string> {
  const store = storage();
  if (config && store && !isServerPractice()) {
    try {
      const result = await config.api.startPracticeSession(SERVER_ROLE[role]);
      const values = config.apply(result);
      const backup: Record<string, string | null> = {};
      for (const key of Object.keys(values)) backup[key] = store.getItem(key);
      store.setItem(SERVER_PRACTICE_KEY, JSON.stringify({ role, backup }));
      store.setItem(PRACTICE_MODE_STORAGE_KEY, "1");
      for (const [key, value] of Object.entries(values)) {
        if (value == null) store.removeItem(key); else store.setItem(key, value);
      }
      return practiceStartPath(role);
    } catch {
      // Practice is off, the shared world isn't available, or the network failed: use the built-in sample.
    }
  }
  return startPracticeMode(role);
}

/**
 * Drops practice on this device without putting a saved session back.
 * Logout and a new sign-in must not restore an earlier account over the one
 * the person just started. The returned backup is the session server-practice
 * had set aside (storage key → value); the caller can revoke its token.
 * Returns null when this device was not in the shared practice world.
 */
export function discardPracticeSession(): Record<string, string | null> | null {
  const store = storage();
  if (!store) return null;
  let backup: Record<string, string | null> | null = null;
  const raw = store.getItem(SERVER_PRACTICE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { backup?: Record<string, string | null> };
      backup = parsed.backup ?? null;
    } catch {
      backup = null;
    }
  }
  store.removeItem(SERVER_PRACTICE_KEY);
  store.removeItem(PRACTICE_MODE_STORAGE_KEY);
  return backup;
}

/** Leaves the shared world and puts the person's own session back. Returns false when the shared world wasn't in use. */
export function endServerPractice(): boolean {
  const store = storage();
  const raw = store?.getItem(SERVER_PRACTICE_KEY);
  if (!store || raw == null) return false;
  try {
    const { backup } = JSON.parse(raw) as { backup: Record<string, string | null> };
    for (const [key, value] of Object.entries(backup)) {
      if (value == null) store.removeItem(key); else store.setItem(key, value);
    }
  } finally {
    store.removeItem(SERVER_PRACTICE_KEY);
    store.removeItem(PRACTICE_MODE_STORAGE_KEY);
  }
  return true;
}

/**
 * Starts practice for an app that has no built-in sample (Partner, Pharmacy, Work, Sales, TV): it only works on the shared
 * world. Returns the path to open, or throws when practice is off or the shared world can't be reached.
 */
export async function launchServerPractice(role: ServerRole): Promise<string> {
  const store = storage();
  if (!config || !store) throw new Error("Practice isn't available in this app yet.");
  if (isServerPractice()) return "/";
  const result = await config.api.startPracticeSession(role);
  const values = config.apply(result);
  const backup: Record<string, string | null> = {};
  for (const key of Object.keys(values)) backup[key] = store.getItem(key);
  store.setItem(SERVER_PRACTICE_KEY, JSON.stringify({ role, backup }));
  store.setItem(PRACTICE_MODE_STORAGE_KEY, "1");
  for (const [key, value] of Object.entries(values)) {
    if (value == null) store.removeItem(key); else store.setItem(key, value);
  }
  return "/";
}
