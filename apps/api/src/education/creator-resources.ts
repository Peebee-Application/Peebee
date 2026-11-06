import { Hono } from "hono";
import { SignJWT, jwtVerify } from "jose";
import { creatorDb as db } from "./creator-db.js";
import { getR2Bucket, r2IsReady } from "../storage/r2.js";
import { newId } from "../lib/ids.js";
import { one } from "./studio.js";
import {
  authorizeDraft,
  CreatorError,
  creatorOptions,
  creatorReady,
} from "./creator-service.js";
import { publicationFor, assertLearningLesson } from "./creator-study.js";
import { courseAccess } from "./learning.js";

async function resourceAccess(
  userId: string,
  courseId: string,
  resourceId: string,
) {
  try {
    await authorizeDraft(userId, courseId, true);
    return true;
  } catch (err) {
    if (!(err instanceof CreatorError)) throw err;
  }
  const p = await publicationFor(userId, courseId);
  const lesson = p.draft.modules
    .flatMap((m) => m.lessons)
    .find((l) => l.resources.some((r) => r.url === `resource:${resourceId}`));
  if (!lesson) return false;
  await assertLearningLesson(userId, p, lesson.id);
  return true;
}

/** File signatures are checked before storing anything; HTML/SVG/script files are not accepted. */
export function resourceType(
  bytes: Uint8Array,
  mime: string,
): { kind: string; mime: string } | null {
  const ascii = (start: number, end: number) =>
    new TextDecoder().decode(bytes.slice(start, end));
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG")
    return { kind: "image", mime: "image/png" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return { kind: "image", mime: "image/jpeg" };
  if (["GIF87a", "GIF89a"].includes(ascii(0, 6)))
    return { kind: "gif", mime: "image/gif" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP")
    return { kind: "image", mime: "image/webp" };
  if (ascii(0, 5) === "%PDF-") return { kind: "pdf", mime: "application/pdf" };
  if (ascii(4, 8) === "ftyp")
    return {
      kind: mime.startsWith("audio/") ? "audio" : "video",
      mime: mime.startsWith("audio/") ? "audio/mp4" : "video/mp4",
    };
  if (
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  )
    return {
      kind: mime.startsWith("audio/") ? "audio" : "video",
      mime: mime.startsWith("audio/") ? "audio/webm" : "video/webm",
    };
  if (
    ascii(0, 3) === "ID3" ||
    (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  )
    return { kind: "audio", mime: "audio/mpeg" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE")
    return { kind: "audio", mime: "audio/wav" };
  if (ascii(0, 4) === "OggS") return { kind: "audio", mime: "audio/ogg" };
  // Office Open XML is a ZIP container. Active content never renders inline; source extraction verifies contents separately.
  if (
    ascii(0, 2) === "PK" &&
    [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ].includes(mime)
  )
    return { kind: "document", mime };
  if (
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0 &&
    mime === "application/msword"
  )
    return { kind: "document", mime };
  return null;
}

export const creatorResourceRoutes = new Hono();
creatorResourceRoutes.post("/courses/:id/resources", async (c) => {
  const o = await creatorOptions();
  if (
    !o.learn_creator_enabled ||
    !o.learn_creator_uploads_enabled ||
    !r2IsReady()
  )
    throw new CreatorError(
      503,
      "Resource uploads are unavailable. Your draft is saved.",
    );
  await authorizeDraft(c.get("user").sub, c.req.param("id"));
  const limit = Number(o.learn_creator_max_upload_mb) * 1024 * 1024;
  const length = Number(
    c.req.header("Content-Length") || c.req.header("X-Upload-Length"),
  );
  if (!Number.isSafeInteger(length) || length < 1 || length > limit)
    throw new CreatorError(400, "This file exceeds the upload limit.");
  const reader = c.req.raw.body?.getReader();
  if (!reader) throw new CreatorError(400, "Choose a file.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < Math.min(16, length)) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > length) {
      await reader.cancel();
      throw new CreatorError(400, "This file exceeds the upload limit.");
    }
    chunks.push(part.value);
  }
  const data = new Uint8Array(Math.min(size, 16));
  let offset = 0;
  for (const part of chunks) {
    const slice = part.slice(0, data.length - offset);
    data.set(slice, offset);
    offset += slice.length;
    if (offset >= data.length) break;
  }
  const type = resourceType(
    data,
    c.req.header("Content-Type")?.split(";")[0] || "",
  );
  if (!type) {
    await reader.cancel();
    throw new CreatorError(
      400,
      "Use a supported video, image, GIF, PDF, Word, PowerPoint or audio file.",
    );
  }
  const id = newId("resource"),
    key = `learn/resources/${c.req.param("id")}/${id}`;
  let name = "Resource";
  try {
    name = decodeURIComponent(c.req.header("X-File-Name") || "Resource")
      .replace(/[\r\n\x00]/g, "")
      .slice(0, 200);
  } catch {
    throw new CreatorError(400, "Invalid file name.");
  }
  const cap = Number(o.learn_creator_storage_mb_per_course) * 1024 * 1024;
  const used = Number(
    (
      await one(
        "SELECT COALESCE(SUM(size_bytes),0) AS n FROM edu_creator_resources WHERE course_id=?",
        [c.req.param("id")],
      )
    )?.n,
  );
  if (used + length > cap) {
    await reader.cancel();
    throw new CreatorError(
      403,
      "This course has reached its uploaded storage allowance.",
    );
  }
  let chunkIndex = 0;
  let stream: ReadableStream<Uint8Array> = new ReadableStream({
    async pull(controller) {
      if (chunkIndex < chunks.length) {
        controller.enqueue(chunks[chunkIndex++]);
        return;
      }
      const next = await reader.read();
      if (next.done) {
        if (size !== length) {
          controller.error(new Error("Upload length mismatch"));
          return;
        }
        controller.close();
        return;
      }
      size += next.value.length;
      if (size > length) {
        await reader.cancel();
        controller.error(new Error("Upload exceeds declared length"));
        return;
      }
      controller.enqueue(next.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  const Fixed = (
    globalThis as unknown as {
      FixedLengthStream?: new (n: number) => {
        readable: ReadableStream<Uint8Array>;
        writable: WritableStream<Uint8Array>;
      };
    }
  ).FixedLengthStream;
  if (Fixed) {
    const fixed = new Fixed(length);
    void stream.pipeTo(fixed.writable).catch(() => undefined);
    stream = fixed.readable;
  }
  try {
    await getR2Bucket().put(key, stream, {
      httpMetadata: { contentType: type.mime },
    });
    const inserted = await db.execute({
      sql: "INSERT INTO edu_creator_resources(id,course_id,r2_key,name,mime_type,size_bytes,kind) SELECT ?,?,?,?,?,?,? WHERE (SELECT COALESCE(SUM(size_bytes),0) FROM edu_creator_resources WHERE course_id=?) + ? <= ?",
      args: [
        id,
        c.req.param("id"),
        key,
        name,
        type.mime,
        length,
        type.kind,
        c.req.param("id"),
        length,
        cap,
      ],
    });
    if (!inserted.rowsAffected)
      throw new CreatorError(
        403,
        "This course has reached its uploaded storage allowance.",
      );
  } catch (err) {
    await getR2Bucket().delete(key);
    throw err;
  }
  return c.json(
    {
      resource: {
        id,
        title: name,
        kind: type.kind,
        url: `resource:${id}`,
        description: "",
        transcript: "",
        tutorAllowed: false,
      },
    },
    201,
  );
});

const fileSecret = () => {
  if (!process.env.JWT_SECRET)
    throw new CreatorError(503, "File signing isn't configured.");
  return new TextEncoder().encode(process.env.JWT_SECRET);
};
creatorResourceRoutes.get("/resources/:id/url", async (c) => {
  const resource = await one("SELECT * FROM edu_creator_resources WHERE id=?", [
    c.req.param("id"),
  ]);
  if (!resource) throw new CreatorError(404, "That resource wasn't found.");
  const userId = c.get("user").sub;
  const authorized = await resourceAccess(
    userId,
    String(resource.course_id),
    String(resource.id),
  );
  if (!authorized) throw new CreatorError(403, "Resource access required.");
  const token = await new SignJWT({
    resourceId: resource.id,
    courseId: resource.course_id,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setAudience("learn-resource")
    .setIssuedAt()
    .setExpirationTime(
      Math.floor(Date.now() / 1000) +
        Number((await creatorOptions()).learn_creator_file_link_seconds),
    )
    .sign(fileSecret());
  return c.json({
    url: `/v1/education/creator-files/${resource.id}?token=${encodeURIComponent(token)}`,
  });
});

/** Media elements cannot send the app's bearer header, so use scoped, expiring playback tokens. */
export const creatorFileRoutes = new Hono();
creatorFileRoutes.get("/:id", async (c) => {
  try {
    if (!(await creatorReady())) return c.json({ error: "not_ready" }, 503);
    const { payload } = await jwtVerify(
      c.req.query("token") || "",
      fileSecret(),
      { audience: "learn-resource", algorithms: ["HS256"] },
    );
    if (payload.resourceId !== c.req.param("id") || !payload.sub)
      return c.json({ error: "forbidden" }, 403);
    const user = await one("SELECT status FROM users WHERE id=?", [
      payload.sub,
    ]);
    if (user?.status !== "active") return c.json({ error: "forbidden" }, 403);
    const r = await one(
      "SELECT * FROM edu_creator_resources WHERE id=? AND course_id=?",
      [payload.resourceId, payload.courseId],
    );
    if (!r) return c.json({ error: "not_found" }, 404);
    const allowed = await resourceAccess(
      payload.sub,
      String(r.course_id),
      String(r.id),
    );
    if (!allowed) return c.json({ error: "forbidden" }, 403);
    const size = Number(r.size_bytes),
      match = /^bytes=(\d+)-(\d*)$/.exec(c.req.header("Range") || "");
    const start = match ? Number(match[1]) : 0,
      end = match && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start > end || start >= size)
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    const obj = await getR2Bucket().get(
      String(r.r2_key),
      match ? { range: { offset: start, length: end - start + 1 } } : undefined,
    );
    if (!obj) return c.json({ error: "not_found" }, 404);
    const inline = ["image", "gif", "video", "audio", "pdf"].includes(
      String(r.kind),
    );
    return new Response(obj.body, {
      status: match ? 206 : 200,
      headers: {
        "Content-Type": String(r.mime_type),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(String(r.name))}`,
        "Content-Length": String(match ? end - start + 1 : size),
        "Accept-Ranges": "bytes",
        ...(match ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "sandbox",
      },
    });
  } catch {
    return c.json(
      {
        error: "resource_unavailable",
        message:
          "This link expired or access changed. Reopen the resource from your course.",
      },
      403,
    );
  }
});
