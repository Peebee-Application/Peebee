/** The first successful snapshot is a baseline, not a new notification.
 * Scope includes the account and conversation/filter so navigation and
 * another user's old messages do not produce false alerts. */
export class NotificationSnapshots {
  private snapshots = new Map<string, Set<string>>();

  clear(): void { this.snapshots.clear(); }

  update(scope: string, keys: readonly string[]): boolean {
    const seen = this.snapshots.get(scope);
    if (!seen) {
      this.snapshots.set(scope, new Set(keys));
      return false;
    }
    const changed = keys.some((key) => !seen.has(key));
    for (const key of keys) seen.add(key);
    return changed;
  }
}

const snapshots = new NotificationSnapshots();
export function resetNotificationSnapshots(): void { snapshots.clear(); }
let context: AudioContext | null = null;
let buffer: AudioBuffer | null = null;
let audioBytes: Promise<ArrayBuffer> | null = null;
let decoding: Promise<void> | null = null;
let playing = false;
let lastPlayedAt = 0;

export function playNotificationSound(): boolean {
  if (typeof document === "undefined" || document.visibilityState !== "visible") return false;
  if (!context || context.state !== "running" || !buffer || playing) return false;
  // Coalesce the same alert arriving through push and foreground polling.
  if (Date.now() - lastPlayedAt < 1500) return false;
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.onended = () => { playing = false; source.disconnect(); };
  playing = true;
  lastPlayedAt = Date.now();
  source.start();
  return true;
}

export function observeNotificationSnapshot(scope: string, keys: readonly string[]): void {
  if (snapshots.update(scope, keys)) playNotificationSound();
}

/** Unlock audio during a real tap/key press, as required by mobile browsers.
 * No notification permission or browser autoplay setting is changed. */
export function installNotificationSound(): () => void {
  audioBytes ??= fetch("/sounds/notification.mp3").then((response) => {
    if (!response.ok) throw new Error("Notification sound unavailable");
    return response.arrayBuffer();
  });
  void audioBytes.catch(() => { audioBytes = null; });

  function unlock() {
    if (typeof AudioContext === "undefined") return;
    context ??= new AudioContext();
    const activeContext = context;
    void activeContext.resume().catch(() => {});
    if (!buffer && !decoding && audioBytes) {
      decoding = audioBytes
        .then((bytes) => activeContext.decodeAudioData(bytes.slice(0)))
        .then((decoded) => { if (context === activeContext) buffer = decoded; })
        .catch(() => {})
        .finally(() => { decoding = null; });
    }
  }

  function onPush(event: MessageEvent) {
    if (event.data?.type === "peebee-notification") playNotificationSound();
  }

  document.addEventListener("pointerdown", unlock, { passive: true });
  document.addEventListener("keydown", unlock);
  navigator.serviceWorker?.addEventListener("message", onPush);
  return () => {
    document.removeEventListener("pointerdown", unlock);
    document.removeEventListener("keydown", unlock);
    navigator.serviceWorker?.removeEventListener("message", onPush);
    const oldContext = context;
    context = null;
    buffer = null;
    playing = false;
    if (oldContext) void oldContext.close().catch(() => {});
  };
}
