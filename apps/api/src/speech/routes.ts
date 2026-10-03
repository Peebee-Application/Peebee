import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import { getLugandaAudioSettings } from "../lib/settings.js";
import { getR2Bucket, uploadResponseHeaders } from "../storage/r2.js";
import { synthesizeLuganda, translateToLuganda } from "./gemini.js";

export const speechRoutes = new Hono();

/** Fixed phrase, so a preview clip only ever needs generating once per
 * voice, ever — cached in R2 forever rather than per-order like list audio. */
const PREVIEW_TEXT_EN = "Hello, this is how I will read your shopping list to you.";

const previewQuery = z.object({ voice: z.string().max(60) });

/** Lets a rider hear a catalog voice before picking it — the whole reason
 * this is a picker rather than one voice chosen unilaterally. */
speechRoutes.get("/speech/voice-preview", requireAuth, async (c) => {
  const parsed = previewQuery.safeParse({ voice: c.req.query("voice") });
  if (!parsed.success) return c.json({ error: "invalid_query" }, 400);

  const { voices, enabled } = await getLugandaAudioSettings();
  if (!enabled || !voices.some((v) => v.id === parsed.data.voice)) return c.json({ error: "unknown_voice" }, 400);

  const key = `tts-previews/lug-gemini/${parsed.data.voice}.wav`;
  const bucket = getR2Bucket();
  const cached = await bucket.get(key);
  if (cached) {
    return new Response(cached.body, { headers: uploadResponseHeaders(cached.httpMetadata?.contentType, "audio/wav") });
  }

  const lugandaText = await translateToLuganda(PREVIEW_TEXT_EN);
  const audio = await synthesizeLuganda(lugandaText, parsed.data.voice);
  await bucket.put(key, audio, { httpMetadata: { contentType: "audio/wav" } });

  return new Response(audio, { headers: uploadResponseHeaders("audio/wav", "audio/wav") });
});
