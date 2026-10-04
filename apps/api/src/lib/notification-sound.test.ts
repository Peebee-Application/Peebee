import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { NotificationSnapshots, installNotificationSound, playNotificationSound } from "@peebee/shared";

test("alerts start after the initial inbox snapshot and ignore rereads/removals", () => {
  const inbox = new NotificationSnapshots();
  assert.equal(inbox.update("chat", ["old-message"]), false);
  assert.equal(inbox.update("chat", ["old-message"]), false);
  assert.equal(inbox.update("chat", []), false);
  assert.equal(inbox.update("chat", ["old-message"]), false);
  assert.equal(inbox.update("chat", ["old-message", "new-message"]), true);
  assert.equal(inbox.update("chat", ["old-message", "new-message"]), false);
});

test("empty inboxes still alert on their first incoming message", () => {
  const inbox = new NotificationSnapshots();
  assert.equal(inbox.update("chat", []), false);
  assert.equal(inbox.update("chat", ["new-message"]), true);
});

test("navigation filters have independent baselines and logout clears history", () => {
  const inbox = new NotificationSnapshots();
  inbox.update("orders:all", ["1"]);
  assert.equal(inbox.update("orders:active", ["2"]), false);
  assert.equal(inbox.update("orders:all", ["1", "2"]), true);
  inbox.clear();
  assert.equal(inbox.update("orders:all", ["1", "2", "3"]), false);
});

test("MP3 playback requires a user gesture and coalesces foreground alerts", async () => {
  const original = Object.getOwnPropertyDescriptors(globalThis);
  let started = 0;
  let ended: (() => void) | null = null;
  const documentMock = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const serviceWorker = new EventTarget();
  class AudioContextMock {
    state = "suspended";
    destination = {};
    async resume() { this.state = "running"; }
    async close() { this.state = "closed"; }
    async decodeAudioData() { return {}; }
    createBufferSource() {
      const source = { buffer: null, onended: null as (() => void) | null,
        connect() {}, disconnect() {}, start() { started++; ended = source.onended; } };
      return source;
    }
  }
  for (const [name, value] of Object.entries({ document: documentMock, navigator: { serviceWorker }, AudioContext: AudioContextMock,
    fetch: async (url: string) => { assert.equal(url, "/sounds/notification.mp3"); return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) }; } })) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const stop = installNotificationSound();
  try {
    assert.equal(playNotificationSound(), false);
    documentMock.dispatchEvent(new Event("pointerdown"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "peebee-notification" } }));
    assert.equal(started, 1);
    assert.equal(playNotificationSound(), false);
    const finish = ended as (() => void) | null;
    finish?.();
    assert.equal(playNotificationSound(), false);
    documentMock.visibilityState = "hidden";
    assert.equal(playNotificationSound(), false);
  } finally {
    stop();
    for (const name of ["document", "navigator", "AudioContext", "fetch"]) {
      if (original[name]) Object.defineProperty(globalThis, name, original[name]);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

for (const app of ["customer", "rider", "restaurant", "admin", "merchant", "partner"]) {
  test(`${app} push retains OS notification and plays the MP3 in one visible app`, async () => {
    const handlers = new Map<string, (event: { data: { json: () => unknown }; waitUntil: (promise: Promise<unknown>) => void }) => void>();
    const messages: unknown[] = [];
    let systemAlerts = 0;
    const self = {
      location: { origin: "https://example.test" },
      addEventListener(name: string, handler: typeof handlers extends Map<string, infer H> ? H : never) { handlers.set(name, handler); },
      registration: { async showNotification() { systemAlerts++; } },
      clients: { async matchAll() { return [
        { visibilityState: "hidden", focused: false, postMessage: () => assert.fail("hidden tab") },
        { visibilityState: "visible", focused: false, postMessage: () => assert.fail("unfocused duplicate") },
        { visibilityState: "visible", focused: true, postMessage: (message: unknown) => messages.push(message) },
      ]; } },
    };
    const source = readFileSync(new URL(`../../../${app}/public/sw.js`, import.meta.url), "utf8");
    runInNewContext(source, { self, URL });
    let pending: Promise<unknown> = Promise.resolve();
    handlers.get("push")!({ data: { json: () => ({ title: "New message" }) }, waitUntil: (promise) => { pending = promise; } });
    await pending;
    assert.equal(systemAlerts, 1);
    assert.equal(messages.length, 1);
    assert.equal((messages[0] as { type: string }).type, "peebee-notification");
    assert.match(source, /"\/sounds\/notification\.mp3"/);
  });
}
