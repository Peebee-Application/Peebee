import { setSetting } from "../lib/settings.js";

/** Lets one test customer book several rides in a row (the one-active-ride rule has its own test). */
export async function allowManyRides(): Promise<void> {
  await setSetting("one_active_ride_enabled", "0");
}
