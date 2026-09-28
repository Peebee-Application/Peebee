/**
 * Sunbird AI (sunbird.ai, Kampala) — the only hosted TTS/translation API
 * found with a real Luganda voice; Google, Azure, and ElevenLabs have none.
 * Authenticated with a bearer token, read straight from the env (mirroring
 * how JWT_SECRET etc. are handled) rather than the DB-encrypted
 * payment-provider credential store, which has no admin UI to manage it yet
 * and would be unused scope here — set with `wrangler secret put
 * SUNBIRD_API_KEY` in apps/api.
 */

const BASE_URL = "https://api.sunbird.ai";

function apiKey(): string {
  const key = process.env.SUNBIRD_API_KEY;
  if (!key) throw new Error("SUNBIRD_API_KEY is not set");
  return key;
}

export async function translateToLuganda(text: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/tasks/translate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ source_language: "eng", target_language: "lug", text }),
  });
  if (!res.ok) throw new Error(`Sunbird translate failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { output?: { translated_text?: string } };
  const translated = body.output?.translated_text;
  if (!translated) throw new Error("Sunbird translate returned no text");
  return translated;
}

/** `response_mode: "stream"` returns the raw audio bytes in this one call,
 * rather than a signed GCS URL that would need a second fetch and expires
 * after 30 minutes. */
export async function synthesizeLuganda(text: string, voice: string): Promise<ArrayBuffer> {
  const res = await fetch(`${BASE_URL}/tasks/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text, language: "lug", voice, response_mode: "stream" }),
  });
  if (!res.ok) throw new Error(`Sunbird speech synthesis failed: ${res.status} ${await res.text()}`);
  return res.arrayBuffer();
}
