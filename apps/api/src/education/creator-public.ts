import { Hono } from "hono";
import {
  creatorReady,
  creatorOptions,
  publicationLabels,
} from "./creator-service.js";
import { one } from "./studio.js";
import { getLearnSettings } from "./settings.js";
import { clientIp, consume } from "../lib/ratelimit.js";
import type { LearningDraft } from "@peebee/shared";
import { learnerDraft } from "./creator-model.js";

/** Storefront-only projection. Never returns lesson content, resource URLs, private notes or answer keys. */
export const creatorPublicRoutes = new Hono();
creatorPublicRoutes.get("/:id", async (c) => {
  if (!(await creatorReady()) || !(await getLearnSettings()).enabled)
    return c.json({ error: "not_found" }, 404);
  const o = await creatorOptions(),
    quota = await consume(
      `creator-preview:${clientIp(c)}`,
      Number(o.learn_creator_public_reads_minute),
      60,
    );
  if (!quota.allowed) return c.json({ error: "rate_limited" }, 429);
  const row = await one(
    "SELECT p.*,s.name AS creator FROM edu_course_drafts d JOIN edu_course_publications p ON p.id=d.published_version JOIN edu_courses c ON c.id=d.course_id AND c.status='published' JOIN edu_schools s ON s.id=c.school_id AND s.status='active' WHERE d.course_id=?",
    [c.req.param("id")],
  );
  if (!row) return c.json({ error: "not_found" }, 404);
  const draft = learnerDraft(
    JSON.parse(String(row.body_json)) as LearningDraft,
  );
  if (!["public", "unlisted"].includes(draft.visibility))
    return c.json({ error: "not_found" }, 404);
  return c.json({
    publication: {
      id: String(row.id),
      courseId: String(row.course_id),
      version: Number(row.version),
      title: draft.title,
      summary: draft.summary,
      kind: draft.kind,
      priceUgx: draft.priceUgx,
      visibility: draft.visibility,
      creator: String(row.creator),
      labels: await publicationLabels(row),
      objectives: draft.objectives,
      references: draft.references,
      hasAccess: false,
      owner: false,
      modules: draft.modules.map((m) => ({
        ...m,
        description: "",
        lessons: m.lessons.map((l) => ({
          ...l,
          body: "",
          questions: [],
          resources: [],
        })),
      })),
    },
  });
});
