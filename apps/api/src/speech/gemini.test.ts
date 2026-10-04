import assert from "node:assert/strict";
import test from "node:test";
import { GEMINI_TTS_VOICES } from "@peebee/shared";
import { pcmToWav, resolveGeminiVoice, synthesizeLuganda, translateToLuganda } from "./gemini.js";

test("legacy voice ids map onto stable, distinct Gemini voices; real names pass through", () => {
  assert.equal(resolveGeminiVoice("Puck"), "Puck");
  const a = resolveGeminiVoice("waxal_lug_0004");
  assert.ok((GEMINI_TTS_VOICES as readonly string[]).includes(a));
  assert.equal(resolveGeminiVoice("waxal_lug_0004"), a, "stable");
  assert.notEqual(resolveGeminiVoice("waxal_lug_0005"), a, "two old voices stay distinct");
});

test("PCM is wrapped as a valid 24kHz mono WAV", () => {
  const wav = new Uint8Array(pcmToWav(new Uint8Array([1, 2, 3, 4])));
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), "WAVE");
  const v = new DataView(wav.buffer);
  assert.equal(v.getUint32(24, true), 24000);
  assert.equal(v.getUint32(40, true), 4);
  assert.equal(wav.length, 48);
});

test("translation and speech call Google AI Studio and decode the audio", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  const calls: Array<{ url: string; body: any; key: string | null }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, body, key: new Headers(init.headers).get("x-goog-api-key") });
    if (body.generationConfig?.responseModalities) {
      return Response.json({ candidates: [{ content: { parts: [{ inlineData: { data: btoa("\x01\x02\x03\x04"), mimeType: "audio/L16;codec=pcm;rate=24000" } }] } }] });
    }
    return Response.json({ candidates: [{ content: { parts: [{ text: " Amata " }] } }] });
  }) as typeof fetch;
  try {
    assert.equal(await translateToLuganda("milk"), "Amata");
    const audio = new Uint8Array(await synthesizeLuganda("Amata", "waxal_lug_0004"));
    assert.equal(audio.length, 48);
    assert.ok(calls[0].url.startsWith("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"));
    assert.ok(calls[1].url.includes("-tts:generateContent"));
    assert.equal(calls[0].key, "test-key");
    assert.ok((GEMINI_TTS_VOICES as readonly string[]).includes(calls[1].body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName));
  } finally {
    globalThis.fetch = realFetch;
  }
});
