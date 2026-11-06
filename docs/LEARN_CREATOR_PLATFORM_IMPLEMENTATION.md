# Learn creator platform: implementation and rollout

The shared creator is implemented across Customer Learn, educator Studio and Merchant Elite. It extends the existing `edu_courses`, modules, lessons, enrollments, progress, rewards and wallet systems; it does not create a second LMS. The product plan is tracked in PR #376.

## Available flows

- Customer Learn: `/learn/create`, `/learn/study/:courseId`, `/learn/messages`.
- Educator Studio: `/create?class=:classId`, or adopt an existing course with `?course=:courseId`. Assigned co-teachers retain the existing course permissions. Review invitations open a read-only draft with separate review controls.
- Merchant Elite: Store → LMS & Learn Sync → shared course authoring. `/store/learning?store=:storeId` creates a business-owned course in the store's existing Learn academy. Existing store courses can be adopted by canonical course ID.
- Admin: Commerce Options → LMS controls authoring, generation, tutoring, uploads, publishing, sales, sharing, review policy, models and allowances. The creator permissions panel records publisher, seller, reviewer and school-publisher grants with staff evidence and activity logs.

People can create private courses or learning paths, save a learning profile, supply goals, audience, language, curriculum, timetable and source notes, request an objective/roadmap suggestion, then draft lessons from the accepted outline. AI jobs store suggestions separately; applying a suggestion requires the unchanged saved revision. Manual editing remains available when AI is disabled.

The editor supports lesson text, teacher-only notes, objective evidence, practice questions, module/lesson reordering, reference courses/links, uploaded videos, images, GIFs, PDF, Word, PowerPoint and audio, plus external HTTPS resources. GIF playback is opt-in. Resources have private signed access links and course storage allowances. Source extraction returns notes for creator review; it never silently changes teaching material. Legacy `.doc` files remain downloadable but must be converted or manually transcribed for analysis. Long recordings and large documents need shorter excerpts within the configured analysis limit.

A creator can study an unpublished private snapshot without publisher approval. Private study does not list a course, create a storefront offer, or send course cards. The study player provides per-user practice evidence, completion and private tutor history. Teacher notes and assessment answer keys are excluded from learner/tutor context. Sequential release, prerequisites and cohort seat availability are enforced; paid seat reservation and wallet posting commit together.

Publishing is a separate, permissioned action. School publication requires the school owner or a scoped school publisher. By default an independent verified educator must approve the exact revision; editing invalidates that approval for the next publication. Revoked reviewer credentials stop appearing as current verification. Labels describe recorded review, not guaranteed accuracy or unbiased content.

Public/unlisted course links have signed-out syllabus previews. Recipient-bound, expiring invitations grant free access and can specify an existing intake. Course cards sent through Learn messages do not transfer a learner's progress, tutor history, paid access or invitation rights. Paid courses use public or unlisted checkout links.

## Merchant Elite and accounting

Business authoring checks the selected store, active membership, configured digital-management roles, effective Elite entitlement and existing LMS switches. Personal drafts are explicitly excluded from automatic store linking. Existing quizzes, exams, assignments, live lessons and other instructor activities retain their native players and assessment logic. Adopting a course protects it against partial legacy editor payloads and destructive parent deletion; the new editor handles its versioned text/resources. Native activity authoring continues to be a separate LMS capability, rather than an AI-generated replacement for official assessments.

Store-authored publications update the canonical course and its linked digital offer. Only public versions appear in discovery/storefront lists. Existing `lms_learn_sync_mode` controls Learn listing, including manual publication and store-only operation. Store checkout and Learn checkout call the same managed-course purchase service for paid courses.

Purchases use the existing balanced ledger and wallet caches, with an atomic receipt, entitlement, version pin and business fulfillment. The existing `lms_payment_path` selects Learn commission/school-owner payout or digital commission/merchant balance. Concurrent retries settle one purchase. Refunds reverse the original price, commission, beneficiary and environment even if policy changes; access follows the existing refund option. Refunds require available seller funds; shortfalls return a reconciliation message without a partial refund. Existing learner access survives Elite expiry, while new store authoring/sales require entitlement.

Immutable snapshots pin the authored text, resources and practice to the learner's enrolled version. Existing native instructor activities retain the canonical LMS activity contract. Completion uses pinned lesson IDs so later draft additions do not prevent completion of a purchased version.

## Required migration and activation

**Manual D1 migration:** `apps/api/src/db/migrations/0158_learn_creator.sql`.

**Live status — 6 November 2026:** Applied to the configured production D1 database `peebee-api` using Wrangler remote execution. All 15 new tables, four named indexes and the version/job/invitation/permission columns were verified. Recorded as `0158_learn_creator.sql` in `d1_migrations` (row 107). The prerequisite LMS schema was present; no earlier migrations were replayed. Creator settings remain unset, so their safe defaults still apply. The application code has not been deployed by this operation.

Apply it after the existing Learn/LMS, ledger and AI key migrations, through the repository's normal manual D1 workflow. Deployment does not apply SQL. The new endpoints check schema readiness and the feature switches default off; old LMS paths check table availability before touching new data. Do not enable creator switches before the whole migration is applied.

After code review/merge, deploy only from clean `main` exactly matching `origin/main`, using the normal deploy commands and `scripts/preflight-deploy.mjs`. The schema migration has been applied as recorded above. Live feature switches, Google AI keys and deployed applications were not changed.

Configure the existing Admin → AI Features key manager for `learn_generation` and `learn_tutor`, using shared or separate pools. No provider key is sent to browsers. Models are admin-controlled Gemini identifiers, initially the repository's existing `gemini-2.5-flash`. Generation uses `generateContent` with JSON Schema and validates all returned drafts again on the server. The provider contract follows [Google's structured-output documentation](https://ai.google.dev/gemini-api/docs/generate-content/structured-output).

Enable manual authoring first, then generation/tutoring/uploads as appropriate. Public publishing, sharing and selling have their own switches. Keep independent review enabled unless Admin intentionally changes that policy. Grant creator permissions only after the applicable identity, age/guardian, teaching authority and selling checks; evidence is recorded in the permission panel. This implementation supplies the permission workflow, not an automated age/credential verification service.

The existing scheduler recovers queued/stale generation jobs, respecting configured attempts and budgets. Jobs cannot overwrite drafts. AI request failure, cancellation and allowance exhaustion leave saved material intact.

## Validation

The integration suite covers schema readiness/default-off operation, ownership, optimistic revisions, staged AI jobs, quotas, independent review, revoked credentials, private study, private attachments, teacher notes, answers, per-learner tutoring/progress, invitation recipients, stable versions, legacy endpoint bypass protection, concurrent purchases/refunds, insufficient-funds rollback, intake capacity and both Merchant Elite payment modes. Existing Learn, digital-commerce and AI-key suites are run alongside it.

The disposable local browser workflow uses mocked model output: login → create private course → generate outline → explicitly apply → draft lessons → explicitly apply → private study → answer practice → tutor conversation → complete lesson → reload saved progress. It does not exercise a live Gemini account or make real payments. TypeScript checks cover API, shared package, Customer, Learn, Merchant and Admin.

## Remaining plan extensions

This delivers course creation, study, sharing and course sales. Paid AI credit packs, creator subscription tiers, institution-wide AI billing, paid educator reviews, automated age/credential checks, advanced adaptive replanning, collaborative simultaneous editing, SCORM/xAPI export and a general media-generation studio remain separate extensions. They are not represented as delivered billing or verification capabilities. Tutor prompts and output quality still require evaluation with actual teaching material before broad live activation.
