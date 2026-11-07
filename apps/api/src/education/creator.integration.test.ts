import test from "node:test";
import assert from "node:assert/strict";
import {
  addAdmin,
  addUser,
  addMerchantStore,
  app,
  freshDatabase,
} from "../test-support/db.js";
import { setPlatformEnvironment } from "../lib/settings.js";
import { resetSchemaCache } from "../lib/schema.js";
import { setLearningModelForTests, runLearningJob } from "./creator-ai.js";
import { resourceType } from "./creator-resources.js";
import { setR2Binding } from "../storage/r2.js";
import { zipSync, strToU8 } from "fflate";
import { extractOfficeText } from "./creator-source.js";
import type { LearningDraft, LearningWorkspace } from "@peebee/shared";
const json = async (r: Response) => (await r.json()) as any;
async function setup() {
  const db = await freshDatabase(),
    admin = await addAdmin(db),
    owner = await addUser(db, "creator"),
    learner = await addUser(db, "learner"),
    other = await addUser(db, "other"),
    teacher = await addUser(db, "teacher");
  await admin.setOptions({
    learn_creator_enabled: true,
    learn_creator_publishing_enabled: true,
    learn_creator_selling_enabled: true,
    learn_creator_sharing_enabled: true,
    learn_creator_review_required: false,
  });
  const call = (token: string, path: string, method = "GET", body?: unknown) =>
    app.request(`/v1/education/creator${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const grant = async (userId: string, permission: string, schoolId = "") =>
    assert.equal(
      (
        await call(admin.token, "/permissions", "POST", {
          userId,
          permission,
          schoolId,
          active: true,
          evidence: "Eligibility and relevant authority checked for this test.",
        })
      ).status,
      200,
    );
  await grant("creator", "publish");
  await grant("creator", "sell");
  const create = async () => {
    const response = await call(owner, "/courses", "POST", {
      title: "Practical bookkeeping",
    });
    assert.equal(
      response.status,
      201,
      JSON.stringify(await response.clone().json()),
    );
    return (await json(response)).workspace as LearningWorkspace;
  };
  const edit = async (
    w: LearningWorkspace,
    patch: Partial<LearningDraft> = {},
  ) => {
    const draft: LearningDraft = {
      ...w.draft,
      title: "Bookkeeping",
      visibility: "unlisted",
      objectives: [
        {
          id: "obj1",
          title: "Calculate gross profit",
          evidence: "Solve a sales-minus-cost example",
          source: "Teacher notes, section 1",
        },
      ],
      modules: [
        {
          id: "mod1",
          title: "Shop finances",
          description: "",
          lessons: [
            {
              id: "les1",
              title: "Gross profit",
              minutes: 10,
              body: "Gross profit is sales minus the cost of goods sold.",
              objectiveIds: ["obj1"],
              resources: [],
              questions: [
                {
                  id: "q1",
                  question: "Sales are 10 and cost is 6. Gross profit?",
                  options: ["4", "16"],
                  correctIndex: 0,
                  explanation: "10 minus 6 is 4.",
                  objectiveId: "obj1",
                },
              ],
            },
          ],
        },
      ],
      ...patch,
    };
    const r = await call(owner, `/courses/${w.courseId}`, "PUT", {
      revision: w.revision,
      draft,
    });
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
    return (await json(r)).workspace as LearningWorkspace;
  };
  const publish = async (w: LearningWorkspace) => {
    const r = await call(owner, `/courses/${w.courseId}/publish`, "POST", {
      revision: w.revision,
    });
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
    return (await json(r)).publicationId as string;
  };
  return {
    db,
    admin,
    owner,
    learner,
    other,
    teacher,
    call,
    grant,
    create,
    edit,
    publish,
  };
}

test("creator readiness is migration-safe and defaults are off", async () => {
  const db = await freshDatabase(),
    token = await addUser(db, "test");
  const call = () =>
    app.request("/v1/education/creator/config", {
      headers: { Authorization: `Bearer ${token}` },
    });
  assert.equal((await json(await call())).enabled, false);
  await db.execute("DROP TABLE edu_generation_jobs");
  resetSchemaCache();
  const config = await json(await call());
  assert.equal(config.ready, false);
  const r = await app.request("/v1/education/creator/courses", {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(r.status, 503);
});

test("private creation uses canonical Learn records without merchant auto-import; other accounts cannot read or mutate", async () => {
  const s = await setup(),
    w = await s.create();
  assert.equal(w.context, "personal");
  assert.equal(
    (
      await s.db.execute({
        sql: "SELECT status FROM edu_courses WHERE id=?",
        args: [w.courseId],
      })
    ).rows[0].status,
    "draft",
  );
  assert.equal((await s.call(s.other, `/courses/${w.courseId}`)).status, 404);
  assert.equal(
    (
      await s.call(s.other, `/courses/${w.courseId}`, "PUT", {
        revision: 1,
        draft: w.draft,
      })
    ).status,
    404,
  );
  const store = await addMerchantStore(s.db, "merchant_creator");
  await store.call("/merchants/me/store/tier", "POST", { tier: "elite" });
  // Same user can own a merchant and personal profile; automatic sync must not associate personal work.
  await s.db.execute({
    sql: "INSERT INTO merchant_members(merchant_id,user_id,role,status) VALUES(?,?,'owner','active')",
    args: ["m_merchant_creator", "creator"],
  });
  const token = s.owner;
  await app.request("/v1/merchants/me/lms/courses", {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Merchant-Id": "m_merchant_creator",
    },
  });
  assert.equal(
    (
      await s.db.execute({
        sql: "SELECT store_id FROM edu_courses WHERE id=?",
        args: [w.courseId],
      })
    ).rows[0].store_id,
    null,
  );
});

test("concurrent draft saves detect conflicts and reject foreign resources and malformed objectives", async () => {
  const s = await setup(),
    w = await s.create(),
    updated = await s.edit(w);
  assert.equal(
    (
      await s.call(s.owner, `/courses/${w.courseId}`, "PUT", {
        revision: w.revision,
        draft: updated.draft,
      })
    ).status,
    409,
  );
  const d = structuredClone(updated.draft);
  d.modules[0].lessons[0].objectiveIds = ["missing"];
  assert.equal(
    (
      await s.call(s.owner, `/courses/${w.courseId}`, "PUT", {
        revision: updated.revision,
        draft: d,
      })
    ).status,
    400,
  );
  d.modules[0].lessons[0].objectiveIds = ["obj1"];
  d.modules[0].lessons[0].resources = [
    {
      id: "foreign",
      title: "Secret file",
      kind: "pdf",
      url: "resource:not_mine",
      description: "",
      transcript: "",
      tutorAllowed: false,
    },
  ];
  assert.equal(
    (
      await s.call(s.owner, `/courses/${w.courseId}`, "PUT", {
        revision: updated.revision,
        draft: d,
      })
    ).status,
    400,
  );
});

test("AI generation is staged, idempotent and quota-controlled; it never overwrites a manual draft", async () => {
  const s = await setup();
  await s.admin.setOptions({
    learn_creator_ai_enabled: true,
    learn_creator_generations_day: 1,
  });
  const w = await s.edit(await s.create());
  let calls = 0;
  setLearningModelForTests(async () => {
    calls++;
    return {
      text: JSON.stringify({ ...w.draft, summary: "AI suggested summary" }),
      usage: { totalTokenCount: 25 },
    };
  });
  try {
    const payload = {
      revision: w.revision,
      stage: "outline",
      requestId: "same-request-0001",
    };
    const r = await json(
      await s.call(s.owner, `/courses/${w.courseId}/jobs`, "POST", payload),
    );
    assert.ok(r.job.id);
    for (let i = 0; i < 30; i++) {
      const j = await json(await s.call(s.owner, `/jobs/${r.job.id}`));
      if (j.job.status === "completed") break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const completed = await json(await s.call(s.owner, `/jobs/${r.job.id}`));
    assert.equal(completed.job.status, "completed");
    assert.equal(
      (await json(await s.call(s.owner, `/courses/${w.courseId}`))).workspace
        .draft.summary,
      w.draft.summary,
    );
    const duplicate = await json(
      await s.call(s.owner, `/courses/${w.courseId}/jobs`, "POST", payload),
    );
    assert.equal(duplicate.job.id, r.job.id);
    assert.equal(calls, 1);
    assert.equal(
      (
        await s.call(s.owner, `/courses/${w.courseId}/jobs`, "POST", {
          ...payload,
          requestId: "another-request-0002",
        })
      ).status,
      429,
    );
    assert.equal((await s.call(s.other, `/jobs/${r.job.id}`)).status, 404);
  } finally {
    setLearningModelForTests(null);
  }
});

test("review approval applies only to that revision; self-review cannot satisfy independent review", async () => {
  const s = await setup();
  await s.admin.setOptions({ learn_creator_review_required: true });
  const w = await s.edit(await s.create());
  await s.grant("creator", "review");
  assert.equal(
    (
      await s.call(s.owner, `/courses/${w.courseId}/reviews`, "POST", {
        revision: w.revision,
        status: "approved",
        comments: "Reviewed objectives and arithmetic.",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await s.call(s.owner, `/courses/${w.courseId}/publish`, "POST", {
        revision: w.revision,
      })
    ).status,
    403,
  );
  await s.grant("teacher", "review");
  await s.call(s.owner, `/courses/${w.courseId}/reviewers`, "POST", {
    reviewerId: "teacher",
  });
  assert.equal((await s.call(s.teacher, `/courses/${w.courseId}`)).status, 200);
  assert.equal(
    (
      await s.call(s.teacher, `/courses/${w.courseId}`, "PUT", {
        revision: w.revision,
        draft: w.draft,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await s.call(s.teacher, `/courses/${w.courseId}/reviews`, "POST", {
        revision: w.revision,
        status: "approved",
        comments:
          "Independent review: arithmetic and objective evidence checked.",
      })
    ).status,
    200,
  );
  await s.publish(w);
  const next = await s.edit(w, { summary: "Changed after review" });
  assert.equal(
    (
      await s.call(s.owner, `/courses/${w.courseId}/publish`, "POST", {
        revision: next.revision,
      })
    ).status,
    403,
  );
});

test("shared publications hide answer keys and keep each learner's progress and tutor history separate", async () => {
  const s = await setup(),
    w = await s.edit(await s.create());
  await s.publish(w);
  const meta = await json(
    await s.call(s.learner, `/publications/${w.courseId}`),
  );
  assert.equal(meta.publication.hasAccess, false);
  assert.equal(meta.publication.modules[0].lessons[0].body, "");
  assert.equal(
    (await s.call(s.learner, `/publications/${w.courseId}/join`, "POST", {}))
      .status,
    200,
  );
  const pub = await json(
    await s.call(s.learner, `/publications/${w.courseId}`),
  );
  assert.equal(
    pub.publication.modules[0].lessons[0].questions[0].correctIndex,
    -1,
  );
  assert.equal(
    pub.publication.modules[0].lessons[0].questions[0].explanation,
    "",
  );
  assert.equal(
    (
      await s.call(s.learner, `/publications/${w.courseId}/complete`, "POST", {
        lessonId: "les1",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await json(
        await s.call(s.learner, `/publications/${w.courseId}/answer`, "POST", {
          lessonId: "les1",
          questionId: "q1",
          answer: 0,
        }),
      )
    ).correct,
    true,
  );
  assert.equal(
    (
      await s.call(s.learner, `/publications/${w.courseId}/complete`, "POST", {
        lessonId: "les1",
      })
    ).status,
    200,
  );
  await s.call(s.other, `/publications/${w.courseId}/join`, "POST", {});
  assert.deepEqual(
    (await json(await s.call(s.other, `/publications/${w.courseId}/progress`)))
      .lessonIds,
    [],
  );
  await s.admin.setOptions({ learn_creator_tutor_enabled: true });
  setLearningModelForTests(async (_feature, _model, _system, prompt) => {
    assert.ok(!prompt.includes('"correctIndex":0'));
    return {
      text: "Let's check: what costs do you subtract from sales?",
      usage: {},
    };
  });
  try {
    assert.equal(
      (
        await s.call(s.learner, `/publications/${w.courseId}/tutor`, "POST", {
          lessonId: "les1",
          text: "Help me understand",
          requestId: "tutor-request-0001",
        })
      ).status,
      200,
    );
    assert.equal(
      (await json(await s.call(s.other, `/publications/${w.courseId}/tutor`)))
        .messages.length,
      0,
    );
  } finally {
    setLearningModelForTests(null);
  }
});

test("recipient-bound invitations cannot be stolen; course messages do not grant access", async () => {
  const s = await setup(),
    w = await s.edit(await s.create(), { visibility: "invite" });
  await s.publish(w);
  const invite = await json(
    await s.call(s.owner, `/courses/${w.courseId}/invites`, "POST", {
      recipientId: "learner",
    }),
  );
  assert.equal(
    (await s.call(s.other, "/invites/accept", "POST", { token: invite.token }))
      .status,
    404,
  );
  assert.equal(
    (
      await s.call(s.learner, "/invites/accept", "POST", {
        token: invite.token,
      })
    ).status,
    200,
  );
  assert.equal(
    (await json(await s.call(s.learner, `/publications/${w.courseId}`)))
      .publication.hasAccess,
    true,
  );
  const next = await s.edit(w, { priceUgx: 1000, visibility: "unlisted" });
  await s.publish(next);
  assert.equal(
    (
      await s.call(s.owner, `/publications/${w.courseId}/share`, "POST", {
        recipientId: "other",
        note: "Try this course",
      })
    ).status,
    200,
  );
  assert.equal(
    (await json(await s.call(s.other, "/shares"))).messages.length,
    1,
  );
  assert.equal(
    (await json(await s.call(s.other, `/publications/${w.courseId}`)))
      .publication.hasAccess,
    false,
  );
  assert.equal(
    (
      await s.call(s.owner, `/courses/${w.courseId}/invites`, "POST", {
        recipientId: "other",
      })
    ).status,
    403,
  );
});

test("published versions remain stable for enrolled learners after creator edits", async () => {
  const s = await setup(),
    w = await s.edit(await s.create());
  const first = await s.publish(w);
  await s.call(s.learner, `/publications/${w.courseId}/join`, "POST", {});
  const changed = structuredClone(w.draft);
  changed.modules[0].lessons[0].body = "New version's explanation";
  const saved = await json(
    await s.call(s.owner, `/courses/${w.courseId}`, "PUT", {
      revision: w.revision,
      draft: changed,
    }),
  );
  await s.publish(saved.workspace);
  const old = await json(
    await s.call(s.learner, `/publications/${w.courseId}`),
  );
  assert.equal(old.publication.id, first);
  assert.match(old.publication.modules[0].lessons[0].body, /Gross profit/);
});

test("paid access and wallet entries commit once under concurrent requests; refunds reverse the original environment", async () => {
  const s = await setup(),
    w = await s.edit(await s.create(), { priceUgx: 1000 });
  const pub = await s.publish(w);
  await s.db.execute(
    "UPDATE users SET wallet_balance=10000 WHERE id='learner'",
  );
  const buy = (requestId: string) =>
    s.call(s.learner, `/publications/${w.courseId}/buy`, "POST", {
      publicationId: pub,
      price: 1000,
      requestId,
    });
  const results = await Promise.all([
    buy("purchase-request-a"),
    buy("purchase-request-b"),
  ]);
  for (const r of results)
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.equal(
    (await s.db.execute("SELECT wallet_balance FROM users WHERE id='learner'"))
      .rows[0].wallet_balance,
    9000,
  );
  assert.equal(
    (
      await s.db.execute(
        "SELECT COUNT(*) AS n FROM edu_creator_purchases WHERE status='settled'",
      )
    ).rows[0].n,
    1,
  );
  const purchase = (await s.db.execute("SELECT * FROM edu_creator_purchases"))
    .rows[0];
  await setPlatformEnvironment("sandbox");
  assert.equal(
    (await s.call(s.owner, `/purchases/${purchase.id}/refund`, "POST", {}))
      .status,
    200,
  );
  assert.equal(
    (await s.call(s.owner, `/purchases/${purchase.id}/refund`, "POST", {}))
      .status,
    200,
  );
  assert.equal(
    (await s.db.execute("SELECT wallet_balance FROM users WHERE id='learner'"))
      .rows[0].wallet_balance,
    10000,
  );
  assert.equal(
    (await json(await s.call(s.learner, `/publications/${w.courseId}`)))
      .publication.hasAccess,
    false,
  );
});

test("insufficient funds do not create partial sales, enrollments or wallet postings", async () => {
  const s = await setup(),
    w = await s.edit(await s.create(), { priceUgx: 1000 });
  const pub = await s.publish(w);
  const r = await s.call(s.learner, `/publications/${w.courseId}/buy`, "POST", {
    publicationId: pub,
    price: 1000,
    requestId: "insufficient-wallet",
  });
  assert.equal(r.status, 403);
  assert.equal(
    (await s.db.execute("SELECT COUNT(*) AS n FROM edu_creator_purchases"))
      .rows[0].n,
    0,
  );
  assert.equal(
    (
      await s.db.execute(
        "SELECT COUNT(*) AS n FROM edu_enrollments WHERE user_id='learner'",
      )
    ).rows[0].n,
    0,
  );
});

test("uploaded resources verify bytes and stay private even when the ID is known", async () => {
  const s = await setup(),
    w = await s.create();
  await s.admin.setOptions({ learn_creator_uploads_enabled: true });
  const objects = new Map<string, Uint8Array>();
  setR2Binding({
    put: async (k, value) => {
      objects.set(
        k,
        new Uint8Array(await new Response(value as BodyInit).arrayBuffer()),
      );
    },
    get: async (k) =>
      objects.has(k)
        ? {
            body: new Blob([
              objects.get(k)! as Uint8Array<ArrayBuffer>,
            ]).stream(),
            size: objects.get(k)!.length,
          }
        : null,
    delete: async (k) => {
      objects.delete(k);
    },
  });
  try {
    assert.equal(
      resourceType(
        new TextEncoder().encode("<script>alert(1)</script>"),
        "image/png",
      ),
      null,
    );
    const png = new Uint8Array([0x89, 80, 78, 71, 13, 10, 26, 10]);
    const r = await app.request(
      `/v1/education/creator/courses/${w.courseId}/resources`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${s.owner}`,
          "Content-Type": "image/png",
          "X-File-Name": "diagram.png",
          "X-Upload-Length": String(png.length),
        },
        body: png,
      },
    );
    assert.equal(r.status, 201, JSON.stringify(await r.clone().json()));
    const resource = (await json(r)).resource;
    assert.equal(
      (await s.call(s.other, `/resources/${resource.id}/url`)).status,
      404,
    );
    assert.equal(
      (await s.call(s.owner, `/resources/${resource.id}/url`)).status,
      200,
    );
  } finally {
    setR2Binding(undefined);
  }
});

test("a learner can privately study an unpublished draft without publisher approval", async () => {
  const s = await setup(),
    w = await s.edit(await s.create(), { visibility: "private" });
  await s.db.execute(
    "UPDATE edu_creator_permissions SET active=0 WHERE user_id='creator'",
  );
  const started = await s.call(
    s.owner,
    `/courses/${w.courseId}/study`,
    "POST",
    { revision: w.revision },
  );
  assert.equal(
    started.status,
    200,
    JSON.stringify(await started.clone().json()),
  );
  const own = await json(await s.call(s.owner, `/publications/${w.courseId}`));
  assert.equal(own.publication.hasAccess, true);
  assert.equal(own.publication.visibility, "private");
  assert.equal(
    (await s.call(s.other, `/publications/${w.courseId}`)).status,
    404,
  );
  assert.equal(
    (
      await s.call(s.owner, `/publications/${w.courseId}/share`, "POST", {
        recipientId: "other",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await s.db.execute({
        sql: "SELECT status FROM edu_courses WHERE id=?",
        args: [w.courseId],
      })
    ).rows[0].status,
    "draft",
  );
  assert.equal(
    (await app.request(`/v1/education/creator-public/${w.courseId}`)).status,
    404,
  );
  await s.call(s.owner, `/publications/${w.courseId}/answer`, "POST", {
    lessonId: "les1",
    questionId: "q1",
    answer: 0,
  });
  assert.equal(
    (
      await s.call(s.owner, `/publications/${w.courseId}/complete`, "POST", {
        lessonId: "les1",
      })
    ).status,
    200,
  );
  assert.deepEqual(
    (await json(await s.call(s.owner, `/publications/${w.courseId}/progress`)))
      .lessonIds,
    ["les1"],
  );
});

test("public previews and learner payloads do not expose teacher-only guidance", async () => {
  const s = await setup(),
    w = await s.edit(await s.create());
  w.draft.modules[0].lessons[0].teacherNotes =
    "Confidential marking guidance ABC";
  const saved = (
    await json(
      await s.call(s.owner, `/courses/${w.courseId}`, "PUT", {
        revision: w.revision,
        draft: w.draft,
      }),
    )
  ).workspace;
  await s.publish(saved);
  const preview = await json(
    await app.request(`/v1/education/creator-public/${w.courseId}`),
  );
  assert.ok(!JSON.stringify(preview).includes("Confidential marking"));
  await s.call(s.learner, `/publications/${w.courseId}/join`, "POST", {});
  assert.ok(
    !JSON.stringify(
      await json(await s.call(s.learner, `/publications/${w.courseId}`)),
    ).includes("Confidential marking"),
  );
});

test("Word source extraction does not execute document content and bounds decompression", () => {
  const doc = zipSync({
    "word/document.xml": strToU8(
      "<w:document><w:p><w:r><w:t>Sales &amp; costs</w:t></w:r></w:p></w:document>",
    ),
    "word/vbaProject.bin": new Uint8Array([0, 1, 2]),
  });
  assert.match(extractOfficeText(doc, 1000), /Sales & costs/);
  assert.throws(() => extractOfficeText(doc, 1), /limit/);
  assert.throws(
    () =>
      extractOfficeText(zipSync({ "unrelated.xml": strToU8("nothing") }), 1000),
    /No readable/,
  );
});

test("drip and sequential locks also protect tutor, practice and media access", async () => {
  const s = await setup(),
    w = await s.edit(await s.create());
  w.draft.modules[0].lessons.push({
    ...structuredClone(w.draft.modules[0].lessons[0]),
    id: "les2",
    title: "Next lesson",
    questions: [],
  });
  const saved = (
    await json(
      await s.call(s.owner, `/courses/${w.courseId}`, "PUT", {
        revision: w.revision,
        draft: w.draft,
      }),
    )
  ).workspace;
  await s.publish(saved);
  await s.db.execute({
    sql: "UPDATE edu_course_rules SET sequential=1 WHERE course_id=?",
    args: [w.courseId],
  });
  await s.call(s.learner, `/publications/${w.courseId}/join`, "POST", {});
  const p = await json(await s.call(s.learner, `/publications/${w.courseId}`));
  assert.equal(p.publication.modules[0].lessons[1].locked, true);
  assert.equal(p.publication.modules[0].lessons[1].body, "");
  assert.equal(
    (
      await s.call(s.learner, `/publications/${w.courseId}/complete`, "POST", {
        lessonId: "les2",
      })
    ).status,
    403,
  );
});

for (const path of ["learn_payments_commission", "store_checkout_direct"]) {
  test(`Merchant Elite shares canonical authoring, purchase and refund (${path})`, async () => {
    const s = await setup(),
      merchant = await addMerchantStore(s.db, "merchant_author");
    await merchant.call("/merchants/me/store/tier", "POST", { tier: "elite" });
    await s.grant("merchant_author", "publish");
    await s.grant("merchant_author", "sell");
    await s.admin.setOptions({ lms_payment_path: path });
    const created = await s.call(merchant.token, "/courses", "POST", {
      title: "Business bookkeeping",
      storeId: merchant.storeId,
    });
    assert.equal(
      created.status,
      201,
      JSON.stringify(await created.clone().json()),
    );
    const w = (await json(created)).workspace as LearningWorkspace;
    const draft: LearningDraft = {
      ...w.draft,
      priceUgx: 1000,
      visibility: "public",
      objectives: [
        {
          id: "obj",
          title: "Calculate profit",
          evidence: "An example",
          source: "Business notes",
        },
      ],
      modules: [
        {
          id: "merch_mod",
          title: "Accounts",
          description: "",
          lessons: [
            {
              id: "merch_lesson",
              title: "Sales",
              body: "Track your sales and costs.",
              minutes: 10,
              objectiveIds: ["obj"],
              questions: [],
              resources: [],
            },
          ],
        },
      ],
    };
    const saved = await json(
      await s.call(merchant.token, `/courses/${w.courseId}`, "PUT", {
        revision: w.revision,
        draft,
      }),
    );
    const published = await s.call(
      merchant.token,
      `/courses/${w.courseId}/publish`,
      "POST",
      { revision: saved.workspace.revision },
    );
    assert.equal(
      published.status,
      200,
      JSON.stringify(await published.clone().json()),
    );
    const listed = await json(await merchant.call("/merchants/me/lms/courses"));
    assert.ok(listed.courses.some((c: any) => c.id === w.courseId));
    assert.equal(
      (
        await merchant.call("/merchants/me/lms/courses", "POST", {
          id: w.courseId,
          title: "Partial legacy payload",
        })
      ).status,
      409,
    );
    await s.db.execute(
      "UPDATE users SET wallet_balance=10000 WHERE id='learner'",
    );
    const bought = await app.request(
      `/v1/marketplace/digital/dig_crs_${w.courseId}/buy`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${s.learner}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      },
    );
    assert.equal(
      bought.status,
      201,
      JSON.stringify(await bought.clone().json()),
    );
    const receipt = await json(bought),
      purchase = (
        await s.db.execute({
          sql: "SELECT * FROM edu_creator_purchases WHERE course_id=?",
          args: [w.courseId],
        })
      ).rows[0];
    assert.equal(
      purchase.beneficiary_type,
      path === "store_checkout_direct" ? "merchant" : "customer",
    );
    assert.equal(
      (await json(await s.call(s.learner, `/publications/${w.courseId}`)))
        .publication.hasAccess,
      true,
    );
    await s.db.execute({
      sql: "UPDATE stores SET elite_expires_at='2000-01-01' WHERE id=?",
      args: [merchant.storeId],
    });
    assert.equal(
      (await json(await s.call(s.learner, `/publications/${w.courseId}`)))
        .publication.hasAccess,
      true,
    );
    assert.equal(
      (await s.call(merchant.token, `/courses/${w.courseId}`)).status,
      403,
    );
    await s.admin.setOptions({
      lms_payment_path:
        path === "store_checkout_direct"
          ? "learn_payments_commission"
          : "store_checkout_direct",
    });
    const refund = await merchant.call(
      `/merchants/me/digital-fulfillments/${receipt.fulfillmentId}/refund`,
      "POST",
      {},
    );
    assert.equal(
      refund.status,
      200,
      JSON.stringify(await refund.clone().json()),
    );
    assert.equal(
      (
        await s.db.execute(
          "SELECT wallet_balance FROM users WHERE id='learner'",
        )
      ).rows[0].wallet_balance,
      10000,
    );
  });
}

test("private study does not leak revised lesson metadata through legacy catalog or player; practice cannot be bypassed", async () => {
  const s = await setup(),
    w = await s.edit(await s.create());
  await s.publish(w);
  await s.call(s.learner, `/publications/${w.courseId}/join`, "POST", {});
  const changed = structuredClone(w.draft);
  changed.modules[0].lessons[0].title = "PRIVATE REVISED TITLE";
  changed.modules[0].lessons.push({
    ...structuredClone(changed.modules[0].lessons[0]),
    id: "private_lesson",
    title: "PRIVATE ADDED LESSON",
    questions: [],
  });
  const saved = (
    await json(
      await s.call(s.owner, `/courses/${w.courseId}`, "PUT", {
        revision: w.revision,
        draft: changed,
      }),
    )
  ).workspace;
  assert.equal(
    (
      await s.call(s.owner, `/courses/${w.courseId}/study`, "POST", {
        revision: saved.revision,
      })
    ).status,
    200,
  );
  for (const path of [
    `/v1/education/catalog/courses/${w.courseId}`,
    `/v1/education/learn/courses/${w.courseId}`,
  ]) {
    const response = await app.request(path, {
      headers: { Authorization: `Bearer ${s.learner}` },
    });
    assert.equal(response.status, 200, path);
    assert.ok(!JSON.stringify(await json(response)).includes("PRIVATE"), path);
  }
  assert.equal(
    (
      await app.request("/v1/education/learn/lessons/les1/complete", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${s.learner}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      })
    ).status,
    409,
  );
});

test("revoking reviewer verification removes the current review label while preserving the publication", async () => {
  const s = await setup(),
    w = await s.edit(await s.create());
  await s.grant("teacher", "review");
  await s.call(s.owner, `/courses/${w.courseId}/reviewers`, "POST", {
    reviewerId: "teacher",
  });
  await s.call(s.teacher, `/courses/${w.courseId}/reviews`, "POST", {
    revision: w.revision,
    status: "approved",
    comments: "Reviewed objectives and source accuracy.",
  });
  await s.publish(w);
  const labels = async () =>
    (await json(await s.call(s.learner, `/publications/${w.courseId}`)))
      .publication.labels as string[];
  assert.ok((await labels()).some((l) => l.startsWith("Educator-reviewed")));
  await s.call(s.admin.token, "/permissions", "POST", {
    userId: "teacher",
    permission: "review",
    active: false,
    evidence: "Credential revoked for this test.",
  });
  assert.ok(!(await labels()).some((l) => l.startsWith("Educator-reviewed")));
});

test("generated course enrollments preserve intake capacity, prerequisites and atomic paid seat reservation", async () => {
  const s = await setup(),
    w = await s.edit(await s.create(), { priceUgx: 1000 });
  const pub = await s.publish(w);
  await s.db.execute({
    sql: "INSERT INTO edu_cohorts(id,course_id,name,starts_at,capacity) VALUES('intake',?,'Next intake','2099-01-01',1)",
    args: [w.courseId],
  });
  await s.db.execute(
    "UPDATE users SET wallet_balance=5000 WHERE id IN ('learner','other')",
  );
  const buy = (token: string, requestId: string, cohortId?: string) =>
    s.call(token, `/publications/${w.courseId}/buy`, "POST", {
      publicationId: pub,
      price: 1000,
      requestId,
      cohortId,
    });
  assert.equal((await buy(s.learner, "no-cohort-selected")).status, 409);
  assert.equal(
    (await buy(s.learner, "first-intake-buyer", "intake")).status,
    200,
  );
  assert.equal(
    (await buy(s.other, "second-intake-buyer", "intake")).status,
    409,
  );
  assert.equal(
    (await s.db.execute("SELECT wallet_balance FROM users WHERE id='other'"))
      .rows[0].wallet_balance,
    5000,
  );
  const receipt = (
    await s.db.execute(
      "SELECT id FROM edu_creator_purchases WHERE buyer_id='learner'",
    )
  ).rows[0];
  assert.equal(
    (await s.call(s.owner, `/purchases/${receipt.id}/refund`, "POST", {}))
      .status,
    200,
  );
  assert.equal(
    (
      await s.db.execute(
        "SELECT COUNT(*) AS n FROM edu_cohort_members WHERE cohort_id='intake'",
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (await buy(s.other, "replacement-intake-buyer", "intake")).status,
    200,
  );
});
