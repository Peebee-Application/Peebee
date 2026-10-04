/** Stable clock slots work across Worker isolates without a background timer.
 * Advance against the entire configured pool before filtering cooling keys;
 * otherwise a cooldown would change the schedule for every other key. */
export function timedOrder<T>(keys: T[], intervalSeconds: number, now = Date.now()): T[] {
  if (keys.length < 2 || intervalSeconds <= 0) return keys;
  const offset = Math.floor(now / (intervalSeconds * 1000)) % keys.length;
  return [...keys.slice(offset), ...keys.slice(0, offset)];
}

export function nextRotationAt(intervalSeconds: number, now = Date.now()): string | null {
  return intervalSeconds > 0
    ? new Date((Math.floor(now / (intervalSeconds * 1000)) + 1) * intervalSeconds * 1000).toISOString()
    : null;
}
