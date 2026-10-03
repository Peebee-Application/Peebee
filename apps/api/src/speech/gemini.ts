import { GEMINI_TTS_VOICES, DEFAULT_GEMINI_VOICE } from "@tuma/shared";
import { GeminiApiError, withGeminiKey } from "./ai-keys.js";

/**
 * Google AI Studio (the Gemini API) — translates shopping-list text into
 * Luganda and reads it aloud. Keys are managed in the admin app (Settings →
 * Google AI keys) and rotated automatically in test mode — see ./ai-keys.ts;
 * the GEMINI_API_KEY secret is the fallback while none are saved. The models
 * can be overridden with GEMINI_TEXT_MODEL / GEMINI_TTS_MODEL without a code
 * change.
 */

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_TEXT_MODEL = "gemini-2.5-flash";
const DEFAULT_TTS_MODEL = "gemini-2.5-flash-preview-tts";

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; inlineData?: { data?: string; mimeType?: string } }> } }>;
};

async function generate(model: string, body: unknown, what: string): Promise<GeminiResponse> {
  return withGeminiKey(model, async (apiKey) => {
    const res = await fetch(`${BASE_URL}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new GeminiApiError(res.status, await res.text(), what);
    return (await res.json()) as GeminiResponse;
  });
}

export async function translateToLuganda(text: string): Promise<string> {
  const model = process.env.GEMINI_TEXT_MODEL || DEFAULT_TEXT_MODEL;
  const body = await generate(
    model,
    {
      contents: [
        {
          parts: [
            {
              text:
                "Translate this English shopping-list text into Luganda (Ganda, as spoken in Kampala). " +
                "Keep any digits as digits. Reply with only the Luganda translation, nothing else.\n\n" +
                text,
            },
          ],
        },
      ],
      generationConfig: { temperature: 0 },
    },
    "translation",
  );
  const translated = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
  if (!translated) throw new Error("Gemini translation returned no text");
  return translated;
}

/** The catalog stores a Gemini voice name. Older catalog entries still hold
 * the previous provider's speaker tags (e.g. "waxal_lug_0004"); those map
 * deterministically onto a Gemini voice so they keep working (and stay
 * distinct from each other) until an admin re-picks them. */
export function resolveGeminiVoice(voice: string): string {
  if ((GEMINI_TTS_VOICES as readonly string[]).includes(voice)) return voice;
  let hash = 0;
  for (const ch of voice) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return GEMINI_TTS_VOICES[hash % GEMINI_TTS_VOICES.length] ?? DEFAULT_GEMINI_VOICE;
}

/** Gemini returns raw 16-bit mono PCM; wrap it in a WAV header so every
 * browser can play it and it caches as a normal audio file. */
export function pcmToWav(pcm: Uint8Array, sampleRate = 24000): ArrayBuffer {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const write = (offset: number, s: string) => [...s].forEach((c, i) => v.setUint8(offset + i, c.charCodeAt(0)));
  write(0, "RIFF");
  v.setUint32(4, 36 + pcm.length, true);
  write(8, "WAVE");
  write(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  write(36, "data");
  v.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out.buffer;
}

export async function synthesizeLuganda(text: string, voice: string): Promise<ArrayBuffer> {
  const model = process.env.GEMINI_TTS_MODEL || DEFAULT_TTS_MODEL;
  const body = await generate(
    model,
    {
      contents: [{ parts: [{ text: `Say clearly, at a calm and steady pace, in Luganda: ${text}` }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: resolveGeminiVoice(voice) } } },
      },
    },
    "speech synthesis",
  );
  const inline = body.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
  if (!inline?.data) throw new Error("Gemini speech synthesis returned no audio");
  const rate = Number(/rate=(\d+)/.exec(inline.mimeType ?? "")?.[1]) || 24000;
  const bytes = Uint8Array.from(atob(inline.data), (c) => c.charCodeAt(0));
  return pcmToWav(bytes, rate);
}
