# Peebee Learn: AI creation, personal learning, sharing, and sales

Date: 2026-11-06
Status: implementation proposal; no runtime changes in this document-only change.
Repository baseline inspected: origin/main at e1b2eaf4.

## 1. Intended outcome

Anyone can describe what they want to learn, generate a personal learning path or complete course, enrich it with videos and documents, study with a personalized AI tutor, and choose to share or sell the finished work. Creation must not require someone to establish a school first.

Schools and teachers also receive AI-assisted course creation inside the existing Learn Studio. They can turn an approved syllabus, scheme of work, teaching notes, or learning outcomes into editable courses, teaching plans, lessons, and assessments for their classes. Personal creation and institutional authoring use the same generation services with different ownership, curriculum context, permissions, and publication workflows.

The complete journey is: goal -> objectives -> editable roadmap -> lessons and materials -> private study or publication -> message/link sharing -> free enrollment or purchase -> individual tutoring and progress -> creator earnings.

This is a native extension of Peebee, using its existing accounts, customer app, Learn Studio, education API, D1, R2, and wallet systems. Base44 is product inspiration, not a required dependency; its exact template internals have not been verified.

## 2. Existing foundations and integration decisions

| Foundation inspected | Plan |
| --- | --- |
| `apps/customer/app/learn` | Learner dashboard, discovery, personal plans, course consumption, and starting creation |
| `apps/learn` | Extend the creator studio and preserve the existing school/class workflows |
| `apps/api/src/education/studio.ts` | Reuse course/module/lesson authoring with explicit support for personal creators |
| `apps/api/src/education/learning.ts` | Extend enrollment, access checks, progress, and assessment integration |
| `apps/api/src/education/sales.ts` | Reuse compatible sales concepts; do not assume bundles or school passes already represent personal paths |
| `apps/api/src/education/payments.ts`, `apps/api/src/wallet` | Reuse wallet ledger primitives; add durable purchase and settlement orchestration |
| `apps/api/src/education/community.ts` | Extend existing reviews, questions, and collaboration where applicable |
| `apps/api/src/ai/features.ts` | Register Learn AI features with the existing feature switches, key pools, and usage visibility |
| `apps/api/src/storage/r2.ts` | Private originals, protected lesson materials, and generated derivatives |
| Customer chat and education chat | Verify delivery, recipient authorization, and message persistence before adding course cards; simulated tutor UI is not a production messaging foundation |

Keep shared contracts in `packages/shared`. Do not replace the stack with a separate PostgreSQL/Prisma application. Verify provider and processing-runtime capabilities during implementation before selecting extraction or media libraries.

## 3. Product objects and ownership

A course is a self-contained teaching package with objectives, modules, lessons, resources, and assessments. A learning path is an ordered route to an outcome; its steps can reference courses, individual learning activities, or original material.

Keep four concepts separate: the authored content, its published version, a learner's entitlement to access it, and that learner's private plan/progress. Sharing a course shares content access according to its rules; it never shares the sender's diagnostic results, tutor history, private notes, or profile.

A personal learning plan can be adapted for one learner without rewriting the creator's published course. A creator may intentionally turn their private plan into a reusable course or path. Offer a preview of exactly what will become visible before publication.

Recommended personal-creator architecture: add a reusable creator identity and a container that supports either a personal creator or a school/class context. Retain existing course/module/lesson records where practical. Do not create visible fake schools to satisfy current foreign keys. Introduce compatible ownership resolution for legacy school-owned courses, then support personal ownership behind readiness checks. The exact additive schema must be settled in the foundation phase after inspecting all school ownership assumptions.

## 4. Main user journeys and screens

### Learner home

Show Continue learning, My learning paths, My courses, revision needs, and Create something new. Each item shows the next action, progress, and whether it is private, shared, free, or purchased. Keep school content and personal learning discoverable without forcing a role switch.

### Create with AI

1. Choose course or learning path; start from a topic, supplied material, or both.
2. Enter the desired outcome, existing knowledge, audience/level, language, available time, and curriculum where relevant.
3. AI asks only follow-up questions needed to resolve material ambiguity. Diagnostics are optional and governed by settings.
4. Review generated measurable objectives and prerequisites before generating all lesson content.
5. Review and reorder the roadmap; select which parts to expand.
6. Generate lessons, examples, practice, and assessments in recoverable background jobs.
7. Save a private draft, start studying, or open the editor.

Do not require an AI call for manual creation. Show generation state and allowance before starting; failures preserve completed work. Regeneration affects selected content and requires an explicit replacement action when it would overwrite edits.

### Course and path editor

Provide an outline, selected lesson editor, resource panel, AI assistance, learner preview, and publish controls. Support autosave with a visible saved/error state, conflict detection for concurrent edits, reordering, duplication, deletion, and undo or recoverable revisions.

Creators can edit objectives, text, examples, quizzes, assessments, prerequisites, titles, descriptions, covers, and path steps. Regenerate a paragraph or lesson without replacing unrelated work. Preview mobile and desktop learner layouts.

### AI-assisted creation for schools and teachers

Provide Create with AI from a school's class/course area and Assist with AI inside an existing course or lesson. A teacher working independently can author under their personal creator identity; a teacher working for a school chooses the authorized school/class context before generating anything. Clearly show who owns the draft and which budget will fund generation.

The institutional creation flow is:

1. Choose the school, class/cohort, subject, grade/level, term, curriculum framework, teaching language, and delivery mode. Prefill known class details without assuming they are correct for every course.
2. Upload or select authorized syllabus documents, schemes of work, textbook excerpts, teacher notes, PDFs, Word documents, slides, videos, and other resources. Identify which sources are approved curriculum references and which are supplementary material.
3. Specify intended learning outcomes, teaching weeks, lesson duration, available teaching time, prerequisites, assessment approach, and classroom/resource constraints. These are editable course inputs validated against admin-configured limits, not fixed scheduling constants.
4. Generate a proposed curriculum coverage map, course outline, and scheme of work. Map each objective and module to supplied curriculum references and distinguish uncovered outcomes, unsupported claims, and optional enrichment. Without an approved source, label curriculum alignment as unverified rather than official compliance.
5. Let the teacher revise and approve the outline, then generate selected modules or the full draft through checkpointed jobs.
6. Generate lesson explanations, teacher lesson plans, class activities, worked examples, homework, quizzes, assessment drafts, answer keys, and marking rubrics as selected. Separate teacher-only guidance and answers from learner-visible content.
7. Add or replace media/materials, preview as a learner, and submit for school review where required. Authorized reviewers can approve or return work with comments. Publication always requires an explicit authorized action.
8. Publish to the intended class/cohort or school library. Assignment and learner notifications are explicit actions with a recipient preview. Public sharing or sales require separate school authorization and platform policy checks.

Teachers can use AI on existing content: improve an explanation, propose missing objectives, create practice aligned to a lesson, translate or simplify selected material, and propose differentiated activities. Maintain a teacher-reviewed base course; level/language variants and learner-specific remediation must not silently change its published version or official assessment. Variants retain source links and require review because translation or simplification can change meaning.

School owners/admins manage teachers, course assignments, reviewers, and publishing/selling permissions within the platform's admin-controlled policy. A teacher's ability to edit a course does not automatically grant permission to change prices, publish publicly, move school assets into a personal workspace, or receive school sales proceeds. A departed teacher loses school access while school-owned drafts, publications, and audit history remain with the institution. Do not infer ownership from who clicked Generate.

Provide a school resource library scoped by membership and explicit resource permissions. Reuse approved school-owned content across authorized classes; require permission to reuse another creator's material. School-owned sales settle to the configured school beneficiary using the existing account/wallet model, not automatically to the generating teacher. Personal teacher publications remain a separate context, and neither context implies permission to transfer material between them.

School AI consumption is attributed to the school, teacher, job, and course. Support school budgets and per-teacher allowances within platform limits, with visible remaining allowance and admin-defined behavior on exhaustion. Teachers can save and continue manual editing when generation is unavailable. Do not include identifiable student records in generation prompts unless the feature needs them and the applicable permissions allow it; use aggregate learning evidence for class-wide revision suggestions.

Example: a teacher selects an existing secondary class and uploads the school's approved mathematics syllabus and notes. AI proposes a term outline and objective-to-source map. After review, the teacher generates lessons, adds a recorded demonstration and worksheet, and sends the draft to an authorized reviewer. The reviewer publishes it to the class. Learners receive their own tutor sessions and progress; teacher-only marking guidance stays private.

### Publish and sell

Review content completeness, audience, rights to materials, accessibility, visibility, sample lessons, price, tutor availability, and what purchase includes. Save the publication snapshot and display its version. Paid offers clearly disclose content access and any separate tutor allowance; a course purchase must not imply unlimited AI usage.

### Study

Learners can read/watch lessons, open resources, take practice, ask the tutor, resume a session, and see objective-level progress. Provide download-only fallbacks for supported attachments without a preview. Adapt explanations to the individual without exposing another learner's information.

### Creator workspace

List drafts and publications, processing jobs, shared invitations, learners, sales, refunds, and earnings. Show aggregate learning difficulties and consented feedback rather than private learner transcripts by default.

## 5. AI objectives, generation, and tutoring

Treat these as separate operations with validated contracts:

| Operation | Inputs | Stored output |
| --- | --- | --- |
| Objective generation | Goal, profile, diagnostic evidence, curriculum, source scope | Observable objectives, prerequisites, assessment evidence expected |
| Roadmap generation | Approved objectives, time budget, available content | Ordered steps, objective mappings, estimated effort, dependencies |
| Lesson generation | Objective, source excerpts, level, language | Lesson blocks, examples, source references, practice |
| Assessment generation | Objective and lesson scope | Questions, private answer/rubric data, difficulty metadata |
| Institutional planning | Authorized school/class context, approved syllabus sources, teaching schedule | Coverage map, scheme of work, lesson plans, reviewable curriculum gaps |
| Teacher assistance | Selected content, intended transformation, permitted resource library | Proposed edits, differentiated activities, translations, homework, teacher-only guidance |
| Tutoring | Authorized lesson/version, relevant sources, session summary, learner evidence | Learner-facing response and proposed learning evidence |
| Plan adjustment | Assessment history, remaining objectives, learner goal | Proposed revision activities or changes to the private plan |

Example: 'Manage the money in my shop' becomes objectives such as classify revenue and expenses, calculate gross profit from a ledger, maintain a daily cashbook, and explain why profit differs from cash. Each objective has a task that can demonstrate understanding.

Register Learn generation, tutoring, and material processing in the existing AI feature registry. Route supported calls through shared key management, with provider/model configuration exposed to Admin. Existing helpers are provider-specific, so extend the abstraction only when required rather than claiming provider interchangeability already exists.

Persist prompt/template version, model identifier, source/version references, validation result, job ID, and usage. Validate structured output server-side: required fields, objective references, dependency cycles, ordering, content bounds, and answer separation. JSON validity alone does not establish educational accuracy.

Use asynchronous, checkpointed generation with idempotency keys, bounded retry, cancellation, and partial recovery. Reserve usage allowance before dispatch and reconcile actual consumption. Expensive calls run outside database transactions. Admin-configured limits govern retries, context, generation size, concurrency, and spend.

The tutor should diagnose, give hints and examples, explain, and check transfer to a new problem. The selected teaching mode is admin-governed and can be chosen by creators/learners only within allowed modes. Store evidence by objective; do not equate message count, self-reported confidence, or lesson completion with mastery. AI proposes assessments of understanding; validated application logic controls progression and official completion rules.

Keep confidential exam answers out of tutor context when doing so would undermine the assessment. Automated tutoring does not independently award official school grades or credentials. Never fabricate sources, page numbers, timestamps, or extraction success.

## 6. Videos, documents, and other materials

Support multiple resources per lesson and per path step. Every resource records its owner, original name, media type, byte size, checksum, title, description, order, required/optional state, preview/download permissions, tutor-use permission, and processing state.

| Material | Authoring and learner behavior | AI use |
| --- | --- | --- |
| Uploaded video | Player, poster, captions/transcript, protected access | Transcript with real timestamps when available |
| Supported video link | Approved embed or external player | Only accessible, permitted transcripts; an embed does not imply extraction rights |
| PDF | Page preview and permitted download | Extracted text with page references; scanned pages require OCR |
| Word `.docx` | Safe converted preview plus original download | Extracted paragraphs/headings and stable source anchors |
| Legacy `.doc` | Conversion workflow or clear unsupported-conversion state | Only after successful conversion; never claim it was read merely because it uploaded |
| Presentations | Slide preview and download | Slide text and supported notes |
| Images | Accessible image preview | OCR/vision when enabled and successful |
| Audio | Player, transcript, download permission | Transcript with available timestamps |
| Worksheets and other files | Attachment/download with clear file type | Download-only unless a supported processor exists |

Build a private pipeline: upload authorization -> direct/resumable storage transfer where needed -> validation/quarantine -> extraction/conversion/transcription -> source segments -> optional retrieval index -> ready. Jobs expose queued, processing, ready, failed, and unsupported states with retry and fallback controls. Validate actual file signatures, not just extensions; isolate document conversion and strip active content from previews.

Large video uploads must avoid routing an entire file through an unsuitable API request. Confirm the deployment's supported upload and playback approach; add chunking or a media service only if needed. Responsive players, captions, keyboard navigation, mobile upload recovery, and lower-bandwidth options are part of acceptance.

Only authorized source segments can enter tutor retrieval. Partition retrieval by owner, course/version, and entitlement. Source documents are untrusted content, never instructions for executing tools or bypassing access rules. Removing a resource invalidates its retrieval entries; retention and references determine when originals and derivatives can be deleted.

## 7. Publication, sharing, and permissions

Model visibility and price independently: private, invite-only, unlisted, or public; free or paid. Support draft, review where configured, published, suspended, and archived lifecycle states. New content starts private and unpublished by default.

Direct links use a stable canonical course/path page. An unlisted link is discoverability control, not proof of permission. Private and invite-only access requires authenticated authorization; paid content requires an entitlement. Any token-based access grants have an explicit scope, expiration policy, revocation, and optional recipient binding.

Message sharing uses a persisted structured course/path card: item ID, canonical link, display snapshot, and safe preview metadata. Resolve current availability and access on open. Use the existing recipient picker and permission checks. Do not automatically send messages on publication. External sharing is a copy-link/native-share action initiated by the user.

Unauthenticated visitors see only permitted storefront/sample content and return to the same item after login. Invitations must not accidentally bypass payment: distinguish 'invite to view/purchase' from an explicit creator-granted free entitlement where allowed.

Do not permit course copying/remixing or commercial redistribution implicitly. If added, it needs explicit creator licensing, attribution, and rules for linked assets. Learners can personalize their own study plan without receiving resale rights.

## 8. Courses inside learning paths

A path can contain original content and references to other courses. Show which referenced courses the learner owns and which require a separate purchase. A paid path can sell its original teaching and curation, but its price must not suggest it includes third-party course access unless an authorized offer does so.

Initial settlement scope: one seller per purchasable offer. Defer multi-creator revenue splits until explicit agreements, allocation rules, refund handling, and ledger support exist. A course becoming unavailable should produce a visible blocked/replacement state, not silently count as completed.

## 9. Sales, entitlements, and earnings

Use existing UGX wallet capabilities initially. Before payment, show the exact item/version, seller, price, included access, tutor allowance, and purchase terms. Free enrollments and paid purchases should produce explicit access records.

Create durable purchase records and a retry-safe settlement state machine. The current payment helper performs debit/payout/refund calls, but is not sufficient evidence of crash-safe exactly-once settlement. Add unique operation references, ledger reconciliation, and recovery for interruption between payment steps. Verify existing wallet capabilities before choosing atomic batch or compensating transaction mechanics.

Required invariants: a retry cannot debit twice; an entitlement is not granted from a client success screen; payout is not repeated; each settled purchase has matching financial entries; failed/refunded purchases reach a defined access state. Preserve sandbox/live separation. Snapshot the applied price, commission policy, seller, currency, and offer version at checkout so later settings changes do not rewrite history.

Creators see gross sales, platform fees, refunds, net earnings, and available/pending balances where payout holds are enabled. Admin controls selling eligibility, allowed pricing, commission, payout timing, refund windows, and other commercial behavior. Show earnings through actual wallet/settlement state, not an independent balance counter.

Do not promise lifetime access or unlimited tutoring. Recommended default offer is a one-time content purchase with clearly disclosed access terms and separately governed tutoring allowance. Creator-selected terms must remain inside admin policy.

## 10. Versions, updates, and buyer protection

Separate mutable drafts from immutable published versions. Publishing snapshots objectives, lesson content, assessment references, resource versions, and offer metadata. A learner is associated with a known content version; their personal progress and tutor history reference it.

Editing published content creates a new draft. Content updates show a change summary and map stable objective/lesson identities so progress is not lost. Define eligibility for updates in the offer policy and preserve already purchased versions unless an explicit moderation or access policy requires removal. Ordinary unpublishing stops new discovery/sales without silently deleting buyer access.

Resources referenced by purchased versions cannot be casually replaced or deleted. Moderation removals need a specific access/refund resolution, with audited decisions. Changing price or free/paid status must not remove existing entitlements.

## 11. Proposed additive data model

Names below are proposed logical records, not migration filenames or a commitment to one table per row. Final schema follows the ownership audit.

| Record group | Responsibility |
| --- | --- |
| Creator identities and content ownership | Personal/school ownership and authorized editors |
| School memberships and scoped roles | Teacher/reviewer assignments and author/publish/sell permissions; extend existing instructor structures where suitable |
| Curriculum mappings and teaching plans | Supplied framework/source versions, outcome coverage, term/week sequence, teacher-reviewed variants |
| Review submissions and decisions | Draft version submitted, reviewer comments, approval/return state, actor and audit history |
| Learning profiles | Goal-relevant preferences without duplicating account identity |
| Objectives and content-objective mappings | Observable outcomes, prerequisites, evidence criteria |
| Learning paths, versions, and ordered steps | Reusable authored roadmap and referenced content |
| Course versions and versioned lesson blocks | Immutable publication snapshots and editable drafts |
| Resources, attachments, and source segments | Original files, derivatives, extraction state, provenance |
| Generation and processing jobs | Durable execution, idempotency, cancellation, progress, recovery |
| Study plans and plan steps | Learner-specific route and approved adaptations |
| Tutor sessions and messages | Private conversations tied to objectives and versions |
| Learning evidence and objective progress | Assessment evidence, misconceptions, revision needs |
| Invitations and share grants | Scoped access offers, acceptance, expiry, revocation |
| Offers, purchases, settlements, entitlements | Access and money linked through auditable operations |
| AI usage reservations and events | Budgets, model usage, failed calls, reconciliation |
| Reports and moderation decisions | Review state, actions, reasons, audit trail |

Reuse enrollments/progress/assessments where their semantics match. Add appropriate foreign keys, uniqueness, indexes, pagination, and tenant/environment boundaries. Store private answer keys separately from learner-facing payloads. Avoid large mutable chat-history JSON fields when individual messages and resumable sessions are required.

## 12. API and service boundaries

Proposed capabilities, fitted to existing route conventions during implementation:

- Profile and dashboard reads/writes.
- Create draft, edit outline/content, clone owned draft, inspect revisions.
- Start/cancel/retry generation; get job progress; accept generated changes.
- Generate school coverage maps, schemes of work, and lesson plans; propose selected teacher edits; submit/review institutional drafts.
- Manage scoped school membership/resource permissions and class/cohort assignments within platform policy.
- Authorize upload, complete upload, list/update resources, request processing, authorized preview/download.
- Publish new version, inspect storefront, archive, list creator publications.
- Create/accept/revoke invitations; resolve canonical links and shared-message cards.
- Quote and purchase an offer; inspect purchase state and learner entitlement.
- Create/resume tutor session, send message, stream response, inspect objective progress.
- View creator sales/earnings, submit reports, and perform permissioned moderation.

Every operation validates the authenticated actor, ownership/role, current entitlement, environment, version, feature readiness, rate limits, and input contract on the server. Streaming needs disconnect handling, durable final messages, and a recoverable state for interrupted responses.

## 13. Admin controls and operations

All behavioral settings live in `settings`, are validated in settings routes, appear on an Admin page, and create activity-log records. Product choices below are recommended defaults that Admin can change, not hardcoded constants.

| Area | Controls |
| --- | --- |
| Availability | Personal creation, AI generation, tutoring, uploads, sharing, discovery, sales |
| AI | Allowed provider/model, templates/teaching modes, budgets, quotas, context and output limits, concurrency, retries |
| Schools and teachers | School AI eligibility/budgets, per-teacher allowance policy, allowed authoring modes, curriculum-source rules, review requirements, delegation limits, institutional sharing/selling permissions |
| Learning | Mastery criteria, revision intervals, diagnostic behavior, progression rules |
| Materials | Allowed types, sizes, counts, duration limits, OCR/transcription, embed hosts, downloads |
| Publishing | Creator eligibility, review requirements, permitted visibility, samples, content limits |
| Commerce | Price bounds, commission, selling eligibility, payout/refund rules, bundled tutor allowance |
| Sharing | Invite limits/expiry, allowed grants, copying/remixing policy |
| Privacy and retention | Transcript/source retention, creator analytics access, deletion behavior |

New capabilities default off until migrations, credentials, processing infrastructure, and checks are ready. Manual authoring and existing Learn functions continue when AI is unavailable. Missing keys or exhausted budgets produce clear feature-specific states without breaking ordinary course access.

Admin needs job failures/retries, AI usage and budget visibility, pending moderation, purchase reconciliation, refund handling, and feature kill switches. Monitor generation success, queue delay, material-processing success, grounding coverage, study resumption, objective evidence, sharing acceptance, purchases, refunds, and net settlement. Define metric events and denominators during foundation work; targets remain configurable.

## 14. UI and accessibility rules

Use existing cream, ink, gold, and surface tokens. Multi-part inputs use `field-box` for one edge-to-edge fill; selected tabs may use their existing states. Keep implementation/provider details out of learner flows unless needed for a meaningful choice.

Support narrow screens, keyboard operation, focus management, screen readers, captioned media, readable document fallbacks, recoverable upload errors, and explicit autosave state. Display progress and errors in text rather than colour alone. Shared links preserve their destination through authentication.

## 15. Delivery sequence and acceptance gates

Each phase is a bounded implementation milestone, with separate reviewable PRs where needed. Do not enable public sales simply because course generation works.

| Phase | Deliverable | Exit evidence |
| --- | --- | --- |
| 0. Foundation | Ownership audit, school/teacher role and review matrix, schema/API contracts, admin controls, job/runtime design, payment recovery design | Existing school workflows remain compatible; personal and school ownership, budget attribution, and policy assumptions documented |
| 1. Personal authoring | Private manual courses/paths, creator identity, learner dashboard, outline editor, autosave | User creates and resumes a course without creating a school; another user cannot access its draft |
| 2. AI generation | Personal generation plus school/teacher syllabus import, objectives, coverage maps, schemes of work, staged lesson/assessment generation, scoped budgets, recoverable jobs | Personal and school drafts survive refresh/retry/failure; school generation maps to supplied sources, respects roles, and preserves teacher edits |
| 3. Materials | Multiple resources, video/PDF/DOCX support, preview/download, processing and provenance | Authorized learner can use materials; failed extraction remains honest and recoverable; private assets remain private |
| 4. Tutor and adaptation | Persistent sessions, grounded answers, objective evidence, private plan adjustments | Two learners on the same course have separate sessions/progress; real references; existing grading rules preserved |
| 5. Publishing and sharing | Immutable versions, school review/approval, class/cohort assignment, storefront/sample, direct links, messages, free enrollments/invites | School review gates and class access enforced; friend opens link/card, authenticates, obtains correct access, and begins their own study; revoked invites are rejected |
| 6. Commerce | Paid offers, entitlements, retry-safe wallet settlement, earnings and refunds | Duplicate requests and simulated interruptions cannot duplicate debit/payout or strand money without recovery |
| 7. Public launch | Discovery, moderation, analytics, operational controls, rollout documentation | Full create-edit-share-buy-study-update-refund flow passes; monitoring and rollback exercised |

Phases 2 and 3 follow foundation authoring; phase 4 needs objectives and source processing; phase 5 needs stable content versions; phase 6 needs publication and verified payment recovery. Scope delivery by these gates rather than an unsupported calendar promise. Legacy document conversion, advanced video processing, offline downloads, and multi-creator commercial bundles can follow the core release where infrastructure warrants; PDF, DOCX, video attachments, sharing, and selling remain required core outcomes.

## 16. Validation strategy

Use existing education integration test patterns and add meaningful tests for changed behavior:

- Legacy school authoring/enrollment remains functional with and without new migrations.
- School teachers can generate only within their assigned contexts; editing, approval, publishing, and selling permissions are independently enforced.
- Curriculum maps cite actual supplied source versions, flag gaps, and do not label unverified alignment as official compliance.
- School generation uses the correct budget; role removal blocks future school access and preserves institution-owned content.
- Teacher-only answers/rubrics stay out of learner payloads and tutor retrieval; adaptations do not alter official grades or the published base course.
- School-owned sales credit the configured institutional beneficiary; teachers cannot export school materials into personal sales without authorization.
- Private drafts, published content, paid content, source files, and tutor sessions enforce the access matrix.
- Invalid model output, cyclic paths, provider failures, exhausted budgets, retries, and cancellation preserve integrity.
- Invalid file signatures, hostile document content, processing failures, source deletion, and unauthorized retrieval are handled.
- A shared link or message never exposes the sender's progress or grants paid content accidentally.
- Publish/update/unpublish does not silently change a buyer's content version or erase progress.
- Purchase idempotency, concurrent checkout, interrupted debit/payout, refunds, and sandbox/live separation reconcile correctly.
- Tutor citations refer to actual accessible sources, and protected assessment answers remain protected.
- Mobile/desktop browser verification covers manual creation, AI creation, editing, upload, publication, sharing, checkout, tutoring, and creator earnings.

Record a fixed educational evaluation set for objectives and grounded tutoring with explicit rubrics, including insufficient-source cases. Automated structural tests and educational review serve different purposes; both are required before broad AI rollout.

Run the affected applications' existing type/lint/build and integration checks. This planning-only change requires document/diff verification, not runtime tests.

## 17. Migration and rollout procedure

Use additive migrations with a manifest in each implementation PR listing exact files and application order. Migrations are applied manually to live D1; deployment never implies migration completion. Guard new columns with `hasColumn()` and new tables with readiness checks, or keep all dependent paths behind default-off flags. Do not leave existing hot paths querying absent schema.

Roll out in order: compatible dormant code -> manually applied migrations -> processing/job infrastructure and credentials -> readiness verification -> internal creators -> invited learners -> free sharing -> limited paid offers -> broader discovery. Keep feature flags independently reversible and stop new sales without stranding existing buyers. Disabling AI must leave purchased content and non-AI study accessible.

For each code milestone: fetch origin, use an isolated `codex/<task>` worktree from current `origin/main`, preserve unrelated work, run relevant checks, commit and push, review and merge via PR. Deploy only from clean main matching origin/main, through `scripts/preflight-deploy.mjs`. This document itself requires no deployment.

## 18. Decisions carried into implementation

Working assumptions: personal and school creators coexist; one-time UGX wallet purchases first; one seller per offer; third-party paid course access sold separately; private drafts by default; tutor usage disclosed separately from content ownership; no implicit resale/remix rights; no automatic publication or message delivery.

School and teacher authoring is core release scope, using the shared generation engine rather than a later separate product. Institutional review, curriculum mappings, scoped resource access, school budget attribution, and authorized classroom delivery are included. Recommended school review defaults and delegation remain configurable in platform Admin; school-level choices operate within those constraints.

Foundation work must resolve: exact personal ownership schema, existing messaging capabilities, durable job infrastructure, document/video processing providers, payment recovery primitives, and how creator eligibility/refund/update policies appear in Admin. These are bounded implementation decisions, not reasons to omit the create/share/sell journey.

The release is complete when a user can generate a bookkeeping course from a goal, edit objectives and lessons, add a video and PDF/Word material, publish a version, send it to a friend by message or link, sell access to another learner, have each learner study privately with a grounded tutor, and see reconciled earnings while retaining the existing school-based Learn experience.

It must also support a school teacher generating a source-mapped course from an approved syllabus, editing and enriching it, obtaining any required school approval, assigning it to the correct class, and optionally publishing/selling under institutional authorization, with school ownership, budgets, private assessment material, and learner access preserved throughout.
