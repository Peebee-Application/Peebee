import { unzipSync, strFromU8 } from "fflate";
import { Buffer } from "node:buffer";
import { getR2Bucket } from "../storage/r2.js";
import { CreatorError, type Row } from "./creator-service.js";

export type LearningMaterial = {
  inlineData: { mimeType: string; data: string };
};
const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
/** Extract plain document text without running Office, macros, HTML or external relationships. */
export function extractOfficeText(bytes: Uint8Array, maxChars: number) {
  let inflated = 0;
  const files = unzipSync(bytes, {
    filter: (file) => {
      if (!/^(word\/document\.xml|ppt\/slides\/slide\d+\.xml)$/.test(file.name))
        return false;
      inflated += file.originalSize;
      if (inflated > maxChars * 20)
        throw new CreatorError(
          400,
          "The document expands beyond the source-processing limit.",
        );
      return true;
    },
  });
  const texts = Object.entries(files)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([name, data]) => {
      const xml = strFromU8(data),
        parts = [
          ...xml.matchAll(/<(?:w|a):t(?:\s[^>]*)?>([\s\S]*?)<\/(?:w|a):t>/g),
        ].map((m) => decodeXml(m[1]));
      return `${name}\n${parts.join(" ")}`;
    });
  const text = texts.join("\n\n").trim();
  if (!texts.length || !text)
    throw new CreatorError(
      400,
      "No readable Word or slide text was found. Keep the download and add source notes manually.",
    );
  if (text.length > maxChars)
    throw new CreatorError(
      400,
      "This document exceeds the source text limit. Split it into smaller teaching materials.",
    );
  return text;
}
export async function readLearningSource(
  resource: Row,
  maxBytes: number,
  maxChars: number,
): Promise<{ text?: string; material?: LearningMaterial }> {
  if (Number(resource.size_bytes) > maxBytes)
    throw new CreatorError(
      400,
      "This file is too large for AI analysis. Add a shorter excerpt or transcript; the original remains available to learners.",
    );
  const object = await getR2Bucket().get(String(resource.r2_key));
  if (!object) throw new CreatorError(404, "That source file wasn't found.");
  const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
  if (bytes.length > maxBytes)
    throw new CreatorError(400, "The file exceeds the analysis limit.");
  const mime = String(resource.mime_type);
  if (mime.includes("openxmlformats"))
    return { text: extractOfficeText(bytes, maxChars) };
  if (mime === "application/msword")
    throw new CreatorError(
      400,
      "Legacy Word files remain downloadable. Convert this file to DOCX or PDF, or paste its text, before using it as an AI source.",
    );
  if (
    ![
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/webp",
      "video/mp4",
      "video/webm",
      "audio/mpeg",
      "audio/mp4",
      "audio/webm",
      "audio/wav",
      "audio/ogg",
    ].includes(mime)
  )
    throw new CreatorError(
      400,
      "This resource needs a creator-provided transcript or description for AI analysis.",
    );
  return {
    material: {
      inlineData: {
        mimeType: mime,
        data: Buffer.from(bytes).toString("base64"),
      },
    },
  };
}
