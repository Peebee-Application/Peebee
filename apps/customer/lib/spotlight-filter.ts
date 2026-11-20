import { useSyncExternalStore } from "react";

/** The five buttons on Spotlight's menu. Each one filters the shared feed. */
export const SPOTLIGHT_FILTERS = [
  { id: "foryou", label: "Explore" },
  { id: "following", label: "Following" },
  { id: "creators", label: "Creators" },
  { id: "market", label: "Market" },
  { id: "learn", label: "Learn" },
  { id: "other", label: "Other" },
] as const;

export type SpotlightFilter = (typeof SPOTLIGHT_FILTERS)[number]["id"];

let current: SpotlightFilter = "foryou";
const listeners = new Set<() => void>();

export function getSpotlightFilter(): SpotlightFilter {
  return current;
}

export function setSpotlightFilter(next: SpotlightFilter) {
  if (next === current) return;
  current = next;
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** The menu and the feed both read this, so tapping a button on the menu changes what the feed shows. */
export function useSpotlightFilter(): SpotlightFilter {
  return useSyncExternalStore(subscribe, getSpotlightFilter, () => "foryou");
}
