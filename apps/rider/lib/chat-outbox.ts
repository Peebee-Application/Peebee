/** Text messages typed while offline (or that fail to send) wait here in
 * localStorage instead of being lost — flushed out in order once the
 * connection comes back. Photos and voice notes aren't queued: they're too
 * large to reliably hold and replay on a flaky connection. */
export type QueuedMessage = {
  localId: string;
  orderId: string;
  body: string;
  createdAt: string;
};

const KEY = "peebee-chat-outbox";

function readAll(): QueuedMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as QueuedMessage[]) : [];
  } catch {
    return [];
  }
}

function writeAll(items: QueuedMessage[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
  } catch {}
}

export function getQueuedMessages(orderId: string): QueuedMessage[] {
  return readAll().filter((m) => m.orderId === orderId);
}

export function queueMessage(orderId: string, body: string): QueuedMessage {
  const msg: QueuedMessage = {
    localId: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    orderId,
    body,
    createdAt: new Date().toISOString(),
  };
  writeAll([...readAll(), msg]);
  return msg;
}

export function removeQueuedMessage(localId: string) {
  writeAll(readAll().filter((m) => m.localId !== localId));
}
