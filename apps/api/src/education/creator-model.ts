import { z } from "zod";
import type { LearningDraft } from "@peebee/shared";
const text = (max: number) =>
  z
    .string()
    .max(max)
    .transform((s) =>
      s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim(),
    );
const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
const url = z
  .string()
  .max(2000)
  .refine(
    (s) =>
      !s ||
      /^resource:[a-zA-Z0-9_-]+$/.test(s) ||
      (() => {
        try {
          const u = new URL(s);
          return u.protocol === "https:" && !u.username && !u.password;
        } catch {
          return false;
        }
      })(),
    "Use an https:// URL or a resource uploaded here.",
  );
export const draftSchema = z.object({
  title: text(200).pipe(z.string().min(2)),
  summary: text(10000),
  kind: z.enum(["course", "path"]),
  language: text(80),
  audience: text(1000),
  goal: text(4000),
  timeBudget: text(1000).optional(),
  curriculum: text(4000),
  sourceText: text(100000),
  priceUgx: z.number().int().min(0).max(1000000000),
  visibility: z.enum(["private", "invite", "unlisted", "public"]),
  objectives: z
    .array(
      z.object({
        id,
        title: text(1000),
        evidence: text(2000),
        source: text(2000),
      }),
    )
    .max(100),
  modules: z
    .array(
      z.object({
        id,
        title: text(200),
        description: text(4000),
        lessons: z
          .array(
            z.object({
              id,
              title: text(200),
              body: text(100000),
              minutes: z.number().int().min(1).max(1440),
              objectiveIds: z.array(id).max(100),
              nativeActivity: z.boolean().optional(),
              teacherNotes: text(100000).optional(),
              resources: z
                .array(
                  z.object({
                    id,
                    title: text(300),
                    kind: z.enum([
                      "video",
                      "image",
                      "gif",
                      "pdf",
                      "document",
                      "audio",
                      "link",
                    ]),
                    url,
                    description: text(4000),
                    transcript: text(100000),
                    tutorAllowed: z.boolean(),
                  }),
                )
                .max(50),
              questions: z
                .array(
                  z.object({
                    id,
                    question: text(2000),
                    options: z.array(text(2000)).min(2).max(8),
                    correctIndex: z.number().int().min(0).max(7),
                    explanation: text(4000),
                    objectiveId: id,
                  }),
                )
                .max(20),
            }),
          )
          .max(40),
      }),
    )
    .max(30),
  references: z
    .array(z.object({ courseId: id, title: text(200), note: text(2000) }))
    .max(100),
});

export function validateDraft(
  input: unknown,
  limits: {
    modules: number;
    lessons: number;
    resources: number;
    source: number;
    body: number;
    questions: number;
  },
): LearningDraft {
  const d = draftSchema.parse(input);
  if (d.modules.length > limits.modules || d.sourceText.length > limits.source)
    throw new Error(
      "This draft exceeds the course or source limits set by Admin.",
    );
  const ids = new Set<string>();
  const unique = (value: string) => {
    if (ids.has(value))
      throw new Error(
        "Every objective, module, lesson, resource and question needs a unique identifier.",
      );
    ids.add(value);
  };
  d.objectives.forEach((o) => unique(o.id));
  const objectives = new Set(d.objectives.map((o) => o.id));
  for (const m of d.modules) {
    unique(m.id);
    if (m.lessons.length > limits.lessons)
      throw new Error("Too many lessons in this module.");
    for (const l of m.lessons) {
      unique(l.id);
      if (
        l.body.length > limits.body ||
        l.resources.length > limits.resources ||
        l.questions.length > limits.questions
      )
        throw new Error("A lesson exceeds the limits set by Admin.");
      if (l.objectiveIds.some((o) => !objectives.has(o)))
        throw new Error("A lesson refers to an unknown objective.");
      l.resources.forEach((r) => unique(r.id));
      for (const q of l.questions) {
        unique(q.id);
        if (
          q.correctIndex >= q.options.length ||
          !objectives.has(q.objectiveId)
        )
          throw new Error("A question has an invalid answer or objective.");
      }
    }
  }
  return d;
}

/** Answers, source notes and tutor transcripts never appear in discovery payloads. */
export function learnerDraft(draft: LearningDraft): LearningDraft {
  return {
    ...draft,
    sourceText: "",
    modules: draft.modules.map((m) => ({
      ...m,
      lessons: m.lessons.map((l) => ({
        ...l,
        teacherNotes: "",
        resources: l.resources.map((r) => ({ ...r, transcript: "" })),
        questions: l.questions.map((q) => ({
          ...q,
          correctIndex: -1,
          explanation: "",
        })),
      })),
    })),
  };
}
