import assert from "node:assert/strict";
import test from "node:test";
import { installNotificationSound, startAttentionTone } from "@peebee/shared";

test("attention repeats the existing recording and cancels sound/vibration on release or hiding", async () => {
  const keys = ["document", "navigator", "AudioContext", "fetch"] as const;
  const previous = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const sources: Array<{ loop: boolean; starts: number; stops: number; buffer: unknown }> = [];
  const vibrations: unknown[] = [];
  let fetched = "";
  class FakeAudioContext {
    state = "running"; destination = {};
    async resume() {} async close() {} async decodeAudioData() { return { recording: true }; }
    createBufferSource() {
      const source = { loop: false, starts: 0, stops: 0, buffer: null, connect() {}, disconnect() {}, start() { this.starts++; }, stop() { this.stops++; } };
      sources.push(source); return source;
    }
  }
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { vibrate: (pattern: unknown) => { vibrations.push(pattern); return true; } } });
  Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: FakeAudioContext });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: async (url: string) => { fetched = url; return new Response(new ArrayBuffer(4)); } });
  let dispose: (() => void) | undefined;
  try {
    dispose = installNotificationSound();
    await new Promise<void>((resolve) => setImmediate(resolve));
    doc.dispatchEvent(new Event("pointerdown"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(fetched, "/sounds/notification.mp3", "the existing beep recording is reused");
    const release = startAttentionTone(true);
    assert.equal(sources[0].loop, true); assert.equal(sources[0].starts, 1);
    release(); assert.equal(sources[0].stops, 1); assert.equal(vibrations.at(-1), 0);
    const tap = startAttentionTone(false);
    assert.equal(sources[1].loop, false); assert.equal(sources[1].starts, 1);
    tap();
    const held = startAttentionTone(true);
    doc.visibilityState = "hidden"; doc.dispatchEvent(new Event("visibilitychange"));
    assert.equal(sources[2].stops, 1); assert.equal(vibrations.at(-1), 0);
    held();
  } finally {
    dispose?.();
    keys.forEach((key, i) => { if (previous[i]) Object.defineProperty(globalThis, key, previous[i]!); else Reflect.deleteProperty(globalThis, key); });
  }
});
