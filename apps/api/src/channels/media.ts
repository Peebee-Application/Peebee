import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { requireAuth } from "../auth/middleware.js";
import { newId } from "../lib/ids.js";
import { baseMimeType, extensionForMime } from "../lib/mime.js";
import { consume } from "../lib/ratelimit.js";
import { getR2Bucket, uploadResponseHeaders } from "../storage/r2.js";
import { ChannelsError, fail, requireChannels } from "./common.js";

/**
 * Pictures and audio for channels and posts (public, cached) and ID documents (private, never served
 * to anyone but staff). Files go to the R2 bucket under separate prefixes so the two can never mix.
 */
export const mediaRoutes = new Hono();

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const AUDIO_TYPES = ["audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/webm", "audio/wav", "audio/x-m4a"];

export const PUBLIC_MEDIA_PREFIX = "channels/";
export const KYC_PREFIX = "kyc/";

/** Reads one uploaded file field, checks its type and size. */
async function takeFile(c: Context, allowed: string[], maxMb: number) {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new ChannelsError("missing_file", "Choose a file to upload.", 400);
  const type = baseMimeType(file.type);
  if (!allowed.includes(type)) throw new ChannelsError("unsupported_file_type", "That kind of file is not allowed.", 400);
  if (!file.size || file.size > maxMb * 1024 * 1024) throw new ChannelsError("file_too_large", `Files can be up to ${maxMb} MB.`, 413);
  return { file, type, kind: form?.get("kind") };
}

/** A picture or audio file for a channel or a post. Returns the path to store and the address to show. */
mediaRoutes.post("/channels/media", requireAuth, bodyLimit({ maxSize: 101 * 1024 * 1024, onError: (c) => c.json({ error: "file_too_large", message: "That file is too large." }, 413) }), async (c) => {
  try {
    const cfg = await requireChannels();
    const user = c.get("user");
    const limit = await consume(`channel-media:${user.sub}`, 60, 3600);
    if (!limit.allowed) throw new ChannelsError("rate_limited", "You are uploading too fast. Try again shortly.", 429);
    const { file, type, kind } = await takeFile(c, [...IMAGE_TYPES, ...AUDIO_TYPES], Math.max(cfg.publishing.maxImageMb, cfg.publishing.maxAudioMb));
    const isAudio = AUDIO_TYPES.includes(type);
    if (isAudio && !cfg.publishing.postTypes.includes("audio")) throw new ChannelsError("audio_off", "Audio posts are not available.", 400);
    if (isAudio ? file.size > cfg.publishing.maxAudioMb * 1024 * 1024 : file.size > cfg.publishing.maxImageMb * 1024 * 1024) {
      throw new ChannelsError("file_too_large", `Files can be up to ${isAudio ? cfg.publishing.maxAudioMb : cfg.publishing.maxImageMb} MB.`, 413);
    }
    const key = `${PUBLIC_MEDIA_PREFIX}${user.sub}/${newId(isAudio ? "aud" : "img")}.${extensionForMime(type, isAudio ? "mp3" : "jpg")}`;
    await getR2Bucket().put(key, await file.arrayBuffer(), { httpMetadata: { contentType: type } });
    const path = `/v1/public/media/${key}`;
    return c.json({ key, path, url: `${new URL(c.req.url).origin}${path}`, kind: isAudio ? "audio" : typeof kind === "string" ? kind : "image" }, 201);
  } catch (err) {
    return fail(c, err);
  }
});

/** Public pictures and audio. Only keys under the public prefix; ID documents live elsewhere. */
mediaRoutes.get("/public/media/*", async (c) => {
  const key = decodeURIComponent(new URL(c.req.url).pathname.replace(/^\/v1\/public\/media\//, ""));
  // Product photos and videos from the add-item wizard are public too (marketplace/store-items.ts).
  if (!(key.startsWith(PUBLIC_MEDIA_PREFIX) || key.startsWith("store-media/")) || key.includes("..")) return c.json({ error: "not_found" }, 404);
  const object = await getR2Bucket().get(key);
  if (!object) return c.json({ error: "not_found" }, 404);
  return new Response(object.body, { headers: { ...uploadResponseHeaders(object.httpMetadata?.contentType, "application/octet-stream"), "Cache-Control": "public, max-age=31536000, immutable" } });
});

/** Accept only our own public media paths (or public https addresses) as an image/audio reference. */
export function ownMediaPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.startsWith("/v1/public/media/channels/") && !value.includes("..") && value.length < 300) return value;
  try {
    const u = new URL(value);
    if (u.pathname.startsWith("/v1/public/media/channels/") && !u.pathname.includes("..")) return u.pathname;
  } catch {
    /* not a URL */
  }
  return null;
}

/** ID documents: private, owned by one person, never returned by any public route. */
export async function saveKycDocument(userId: string, file: File, type: string): Promise<string> {
  const key = `${KYC_PREFIX}${userId}/${newId("doc")}.${extensionForMime(type, "jpg")}`;
  await getR2Bucket().put(key, await file.arrayBuffer(), { httpMetadata: { contentType: type } });
  return key;
}

export { takeFile, IMAGE_TYPES };
