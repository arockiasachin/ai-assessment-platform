# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The project is pre-1.0
(`package.json` is at `0.1.0`); until it reaches 1.0.0, minor versions may include breaking changes.

Entries below are derived from the actual git history. No git tags carry a SemVer version yet: the
only tag is `legacy-archive-v1` at commit `82a48fc`, which is documented as its own non-versioned
section.

## [Unreleased]

Phase 1 (contracts), Phase 2 (feature pods), Phase 3 (hardening) and Phase 4 (cutover) are complete
and landed on `dev`. Phase 2 delivered seven feature pods (quiz generation, quiz attempt
persistence, rubric grading, sandboxed code evaluation, groups/peer evaluation, analytics, LMS
export); Phase 3 delivered three hardening pods (security review, accessibility/performance,
observability); and Phase 4 delivered the seeded demo course, the unified grade store, and the
retirement of the two legacy stores (`AssessmentGrade`, `Quiz`/`QuizQuestion`). Nothing below is
released — `package.json` is still `0.1.0`.

Deferred to a future release: the **grading-agreement / calibration report** (a Phase 3
deliverable). The platform records everything needed to compute human-vs-AI grading agreement — the
per-criterion `AIGradeSuggestion` score, `confidence` and `model`, joined to the published `Grade`
(`points`, `source`, `approvedById`, `overrideReason`) and the `AuditLog` trail of `accept` versus
`override` — so this needs no schema change to build later. It was not built because agreement
cannot be meaningfully measured from demo data, and a number computed off a handful of seeded
examples would read as rigour while meaning nothing. Two caveats for whoever picks it up: a raw
**accept rate is an anchoring-confounded proxy** (the review queue shows the teacher the AI's score,
so a high accept rate cannot distinguish an accurate model from a rubber-stamping reviewer — a
genuine measurement needs an independent second marker, which pairs with the deferred
second-marker-sampling workflow), and **AI rationale/evidence text is redacted 15 days after results
publication** by the retention policy, so agreement should be computed at publish time rather than
retroactively (score-level agreement survives permanently).

Known issues deliberately left open at this boundary: the Prisma schema was frozen through Phases
1–3, but is now unfrozen. One migration added the six capabilities that six features previously
worked around via JSON columns or request-supplied values (team-formation
attributes/availability, analytics alert thresholds, quiz draft/published state, the grading
suggestion dedupe key ordering, LTI registration and user-mapping persistence, and the
per-assessment quiz attempt cap), and dropped seven dead models. See
[`docs/schema/unfreeze.md`](docs/schema/unfreeze.md). The legacy grade-store duality is now
resolved: a manual mark publishes into the audited modern `Grade` and `AssessmentGrade` was retired
(see [`docs/verification/grade-store-unification.md`](docs/verification/grade-store-unification.md)).
Two security items remain decisions rather than defects: container cleanup's
dependence on a reachable Docker daemon, and the multi-instance follow-up for the now
per-process login throttle. Phase 4 closed the other three decisions (login rate
limiting, session role re-validation, and out-of-process `unit` execution); see
[`docs/security/hardening.md`](docs/security/hardening.md). One duplicate, unmerged
implementation of quiz generation exists on a preserved branch and was intentionally
not merged. See [`docs/README.md`](docs/README.md) for the full gap list.

- **Course materials are readable, and the student Resources page is real** — `Material`/`MaterialChunk` had a write path and retrieval but **no reader**: nothing in the repo listed materials, so `/student/resources` was a placeholder and the only rows were two near-identical seeded documents. A new `lib/materials.ts` reads a student's materials across **two tiers** — material attached to an offering they are enrolled in, **or** course-wide material (`offeringId: null`) for a course they are enrolled in — mirroring the scope `lib/quiz-generation/retrieval.ts` already used, so the list and the quiz generator cannot disagree about what a student may be quizzed on. No index or migration was added, deliberately: `@@index([offeringId])` serves the first tier and `@@index([courseId, createdAt])` the second. Three mockup fields the schema cannot support were **dropped rather than faked** — `topic` (no such column, and a material has no topic; a _question_ does), `sizeLabel` (nothing is stored, so there is no size) and the pipeline `state` column (`indexMaterial` is synchronous, so a material is indexed or it is not). The seed grew from 2 materials / 9 chunks to **8 materials / 15 chunks** covering every rendered `MaterialKind` except `OTHER`, both scope tiers, both link states and both index states, with the indexed four produced through `indexMaterial` so "indexed" means retrieval actually works. Two defects in the seed were found and fixed on the way: the past offering's material could not demonstrate cross-offering isolation because every student was enrolled in **both** offerings (students 4–5 are now active-only), and the teardown deleted only the two original ids so a re-seed would have collided on the primary key (create, teardown and summary now read one `MATERIAL_IDS` constant, proven by seeding twice). `tests/materials-read.test.ts`, `tests/material-mapping.test.ts`, `tests/materials-view.test.ts` and the new `tests/demo-seed-shape.test.ts` — which asserts **legibility rather than existence**, the lesson from the three Wave 1 seed bugs that each passed a test counting rows — pin the scope, the projection, the filtering arithmetic and the seed's shape.
- **Quiz retrieval no longer reaches across offerings of the same course** — `lib/quiz-generation/retrieval.ts` describes its second tier as "course-wide chunks (materials with no offering)", but the code filtered on `courseId` alone. A course has many offerings — sections, terms, years — so that filter also matched material attached to _other_ offerings of the same course, meaning a quiz generated for one cohort could be grounded in another cohort's material (in the demo, the previous year's revision handout). It was masked only because the seeded row in question has no chunks. `SimilaritySearchOptions` gained an explicit `courseWideOnly` flag (rather than overloading the nullable `offeringId`, where `null` is indistinguishable from "not supplied"), the retriever now passes it, and the code finally matches its own comment. This also closes a divergence the two-tier materials reader documented as impossible: the reader scoped a student to their enrolled offerings plus course-wide material, so the retriever was strictly broader. Both `tests/materials-read.test.ts` and `tests/quiz-generation-pipeline.test.ts` gained a **same-course sibling offering** fixture, because the pre-existing cross-course tests could not catch it — they were rejected by the `courseId` filter before the relevant tier was consulted.
- **Embeddings are decoupled from chat: `EMBEDDINGS_PROVIDER` keeps material-grounded retrieval working behind a chat-only provider** — DeepSeek (and Anthropic) expose no embeddings endpoint, so `LLM_PROVIDER=deepseek` previously fed the chat provider into `embedTexts`, and material indexing + material-grounded quiz generation failed with a cryptic "deepseek does not support embeddings". A new `EMBEDDINGS_PROVIDER` selects the provider used by `embedTexts` / `indexMaterial` / `searchMaterialChunks` / quiz-generation retrieval, while generation and grading keep `LLM_PROVIDER`; it defaults to `LLM_PROVIDER` when unset, so existing configs behave exactly as before. `getLlmProvider()` now returns the generation-only `LlmGenerationProvider` (no `embed()` at all) and a new `getEmbeddingsProvider()` returns the embeddings provider, making the boundary a compile-time one. A non-embedding embeddings provider fails with an actionable `LlmEmbeddingsUnsupportedError` naming `EMBEDDINGS_PROVIDER` and suggesting `openai`/`ollama` (catchable as `LlmUnsupportedError`). `GET /api/health` now reports `checks.llm.generation` and `checks.llm.embeddings` separately, and `llm.generate`/`llm.embed` log lines carry a `capability` tag. `.env.example` and [`docs/llm-providers.md`](docs/llm-providers.md) document the split, including `LLM_PROVIDER=deepseek` + `EMBEDDINGS_PROVIDER=openai` and the local Ollama option. Reproduced with a failing `embedTexts` test and covered by `tests/llm-embeddings-provider.test.ts`.
- **DeepSeek-V4.1-Flash is a first-class LLM provider (`LLM_PROVIDER=deepseek`)** — selecting it uses the canonical model id `deepseek-flash` and base URL `https://api.deepseek.com`, configured through a dedicated `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` family, so an operator no longer has to know DeepSeek is OpenAI-shaped. The provider reuses the OpenAI-compatible Chat Completions transport but reports `provider: "deepseek"` in results, logs and `/api/health`, and fails fast with a clear config error when the key is missing. It exposes no embeddings route (`embed()` throws `LlmUnsupportedError`), so material indexing still needs an embedding provider. Because `deepseek-flash` has no immutable snapshot, the response `id` and `system_fingerprint` are retained in the existing `AIGradeSuggestion.rawResponse` JSON column (no schema change) for grade contestability. `mock` remains the default when `LLM_PROVIDER` is unset. See [`docs/llm-providers.md`](docs/llm-providers.md).
- **Student-work retention policy: a results-published anchor, a redact-only purge, and an operator trigger** — implements the owner's policy ("Student work is retained till he gets graded for the whole course and 15 days after results are published"). A sixth, additive migration `20260912040000_add_retention_policy` adds `CourseOffering.resultsPublishedAt` — the per-offering anchor, set exactly once by an explicit teacher action (`POST /api/teacher/offerings/[offeringId]/results`, `requireRole("teacher")` + ownership, with a "Publish results" button on the teacher Classes page) — and a `purgedAt` marker on the seven entities the purge redacts. `lib/retention/policy.ts` is the pure, database-free decision (an inclusive 15-day boundary; an unpublished or within-window offering is never eligible) and `lib/retention/purge.ts` derives eligibility **server-side** from the stored anchor, never from the request. The purge is **redact-only** — no row is deleted, so no foreign key is orphaned — and it never references `Grade` or `AuditLog`, which are retained in full. Student-authored content on `Submission`/`SubmissionVersion`, `QuizResponse` and `TestRun` is cleared, as are the AI rationale and **quoted evidence spans** on `AIGradeSuggestion`; `CourseRating` and `PeerEvaluation` lose only their free text, keeping their numbers for reporting. It is idempotent (`purgedAt IS NULL` scoping) and dry-run by default, and runs from `POST /api/admin/retention/purge` (`requireRole("admin")`) or `npm run retention:purge [-- --execute]` on a cron (no scheduler dependency was added). `tests/retention-policy.test.ts`, `tests/retention-purge.test.ts` and `tests/retention-route-auth.test.ts` pin the boundary, prove the dry run writes nothing and that a published `Grade` or an `AuditLog` row is never deleted, and prove the second run is a no-op. See [`docs/privacy/retention-policy.md`](docs/privacy/retention-policy.md).
- **Legacy quiz store retired: the JSON import now writes the modern `Question`/`QuestionOption` spine** — `createQuizFromImportForSessionUser` (`POST /api/teacher/quiz`) previously wrote the legacy `Quiz`/`QuizQuestion` models (`optionsJson`/`correctIndex`), which the modern scorer never reads, so an imported quiz appeared in the quiz center with zero questions and could not be delivered or graded by the modern pipeline. It now writes **published** modern questions attributed to the importing teacher, and the import contract requires an explicit, ownership-checked `offeringId` (a non-owner gets a `403`), closing the same dual-offering ambiguity already fixed for assessment creation. Every reader was migrated — the gradebook payload, the server-side quiz grader (`POST /api/quiz/grade`), the student assessments payload, the admin data explorer, the dev seed route and `prisma/seed.ts` — and a new migration `20260912030000_retire_quiz` drops `Quiz`/`QuizQuestion` plus the `Assessment.quiz` back-relation after a repo-wide reference check. See [`docs/verification/legacy-quiz-retirement.md`](docs/verification/legacy-quiz-retirement.md).
- **Phase 4 demo course and the end-to-end spine proof** — a new deterministic, idempotent seed (`prisma/seed-demo.ts`, npm script `prisma:seed:demo`) creates one "Algebra Foundations" course that drives the whole spine through the real services: indexed `Material`/`MaterialChunk` embeddings, an AI-generated and published quiz in the modern `Question`/`QuestionOption` shape, three server-scored `QuizAttempt`s, a weighted `Rubric` with per-criterion `AIGradeSuggestion`s on a `GradeReview`, a `CodeTask` with `TestCase`s, a group project with five-dimension `PeerEvaluation`s, `ContributionEvent`s and `Milestone`s, a completed offering with `CourseRating`s, and an `LtiRegistration`. It fills the seed coverage gap for the seventeen models the shipped features depend on, and every published `Grade` comes from an explicit human action with its `AuditLog` row. `tests/demo-spine.test.ts` walks author → generate → deliver → score → suggest → review → publish → analytics/export in one run and asserts the two non-negotiable invariants (no client answer key; no grade published without a human and a published grade is never overwritten). Browser verification of the demo pages also found and fixed a real React hydration error in the student date formatting. See [`docs/demo.md`](docs/demo.md).

- **Grade stores unified: manual marks now publish into the audited modern pipeline, and the legacy `AssessmentGrade` model is retired** — a teacher typing a mark (`POST /api/gradebook/marks`, `upsertAssessmentGrade`) and a teacher grading a submission (`PUT /api/teacher/assessments/submissions`) now write a **published** modern `Grade` attributed to the acting teacher plus an `AuditLog` row, through `recordManualMark`/`applyManualMark` in `lib/grading/review-service.ts` (the same module that owns the only other `Grade.publishedAt` writer). Clearing a mark (`score: null`) deletes the grade and audits the removal (`grade.manual_mark_cleared`), so a mark cannot vanish unaudited. Every reader — gradebook payloads, student assessments, submission grading, group-grade resolution, the admin explorer, and the LMS export — now reads the modern store; `lib/lms-export` no longer falls back to legacy marks and `StudentFinalGrade.legacyFallbackAssessmentIds` was removed. A new migration `20260912020000_retire_assessment_grade` drops the `AssessmentGrade` table (the baseline and the two later migrations are untouched). See [`docs/verification/grade-store-unification.md`](docs/verification/grade-store-unification.md).
- **Presence-aware partial updates and a build guard against the data-loss bug class** — a shared `partialUpdate()` helper (`lib/partial-update.ts`) turns a parsed request plus an allow-list into a Prisma `data` object containing only the fields the client actually sent, keeping _omitted_ (leave untouched), _explicit `null`_ (clear) and _present_ (set) distinct, with optional per-field transforms that raise a clear `PartialUpdateError` for an invalid value instead of writing it. `updateGroupForTeacher`, `updateMilestoneForTeacher`, `updateTestCaseForTeacher`, `editGeneratedQuestionForTeacher`, and `PUT /api/teacher/offerings/[offeringId]` now use it with behaviour unchanged, so the two High-severity bugs from `bugfix-run-2`/`bugfix-run-3` cannot silently regress. A plugin-free ESLint rule (`local/no-unguarded-partial-write`, `eslint-rules/no-unguarded-partial-write.mjs`) fails `npm run verify` when a Prisma `.update`/`.updateMany` payload collapses an omitted field to `null` or writes a raw request object, and `tests/partial-update-guard.test.ts` asserts that a single-field update touches only that field. See [`docs/engineering/partial-update-guide.md`](docs/engineering/partial-update-guide.md).
- **Schema unfreeze: six missing capabilities as real columns, seven dead models dropped** — the first schema change after the squashed baseline. One additive migration (`20260912000000_schema_unfreeze`) adds `StudentProfile.formationProfile`, `CourseOffering.analyticsSettings`, `Question.status`/`publishedAt`/`publishedById`, `AIGradeSuggestion.seq`, `LtiRegistration` + `LtiUserMapping`, and `Assessment.maxAttempts`, and drops the seven dead models (`AttendanceSession`, `AttendanceRecord`, `Stream`, `StudentStream`, `CourseRating`, `CourseGradeHistory`, `ExternalReference`) with their back-relations, the `AttendanceStatus` enum, every `noSqlRefId` column, and `User.legacyPassword`. The consumer code was migrated onto the new columns and legacy JSON/metadata reads are kept for backward compatibility. `AssessmentGrade` is deliberately kept (LMS-export legacy fallback; a separate product decision). See [`docs/schema/unfreeze.md`](docs/schema/unfreeze.md).
- **LLM quiz generation (Phase 2)** — a teacher describes a topic; the system retrieves their own course material, generates multiple-choice drafts with misconception-targeting distractors tagged by subtopic and difficulty, and keeps them unpublished until an explicit publish action (`lib/quiz-generation/**`, `app/api/teacher/quiz-generation/**`, `components/teacher-quiz-generator.tsx`). See [`docs/features/quiz-generation.md`](docs/features/quiz-generation.md).
- **Team formation, peer evaluation, contribution tracking and milestones (Phase 2)** — instructor-weighted CATME-style formation that maximises the worst-fitting team and respects schedule availability, confidential five-dimension peer evaluation with adjustment factors computed with and without self-ratings, free-rider detection, contribution events as evidence only, and milestones with timestamped completion (`lib/groups/**`, `app/api/teacher/groups/**`, `app/api/student/peer-evaluation/**`, `components/teacher-groups-manager.tsx`, `components/student-peer-evaluation.tsx`). See [`docs/features/groups-peereval.md`](docs/features/groups-peereval.md).
- **Analytics, item analysis, intervention alerts and adaptive retake (Phase 2)** — per-question difficulty and discrimination indices computed from real `QuizAttempt`/`QuizResponse` data with an honest small-sample guard, cohort distribution and pass rate reusing the existing chart components, threshold-configurable class-average/contribution-imbalance/pending-review alerts scoped to the owning teacher, and a targeted retake containing only the questions a student failed (`lib/analytics/**`, `app/api/teacher/analytics/**`, `app/api/student/analytics/retake/**`, `components/teacher-analytics-dashboard.tsx`, `components/student-adaptive-retake.tsx`). See [`docs/features/analytics.md`](docs/features/analytics.md).
- **Weighted final grades and LMS export (Phase 2)** — a sum-checked category weighting that combines **published** grades only (an unapproved AI suggestion is excluded, never zero-scored) with an explicit modern-`Grade`-over-legacy-`AssessmentGrade` precedence, a downloadable OneRoster 1.2-shaped CSV export (line items, results, score scales), and pure offline LTI 1.3 AGS groundwork (score and LineItem payload builders, a typed client interface, and an in-memory dry run that makes no network calls) (`lib/lms-export/**`, `lib/contracts/lms-export.ts`, `app/api/teacher/export/**`, `app/api/student/export/**`, `components/teacher-lms-export.tsx`). See [`docs/features/lms-export.md`](docs/features/lms-export.md).
- **Sandboxed code and debugging evaluation (Phase 2)** — Docker-isolated execution of student code with no network, enforced CPU/memory/time limits, non-root read-only containers, `--pids-limit` and guaranteed container cleanup; PrairieLearn-style per-test results across unit / input-output / structure / code-quality categories; deterministic offline LLM-drafted test cases that stay drafts until a teacher publishes them; server-side deadline and submission-cap enforcement; and cohort similarity that flags suspicious pairs without ever deciding (`lib/code-eval/**`, `app/api/teacher/code-tasks/**`, `app/api/student/code-submissions/**`, `components/teacher-code-tasks.tsx`, `components/student-code-submissions.tsx`). See [`docs/features/code-eval.md`](docs/features/code-eval.md).
- **Quiz attempt persistence and grading (Phase 2)** — students can start (or resume) and submit a persisted quiz attempt, scored server-side by the existing `lib/quiz-scoring.ts` kernel through `lib/quiz-generation/grading.ts`; the pre-submission payload never carries an answer key or explanation, `QuizResponse` rows record the selected option and `null` for unanswered questions for adaptive-retake compatibility, and the score is written as a deterministic `AIGradeSuggestion` on a `GradeReview` that a human must approve (a later attempt supersedes, never double-counts, and never rewrites a published grade). Attempt cap (default 3, `QUIZ_MAX_ATTEMPTS`) and deadline are enforced server-side (`lib/quiz-attempts/**`, `lib/contracts/quiz-attempts.ts`, `app/api/student/quiz-attempts/**`, `app/api/teacher/quiz-attempts/**`, `components/student-quiz-attempts.tsx`). See [`docs/features/quiz-grading.md`](docs/features/quiz-grading.md).
- **Short-answer partial credit, routed through the human review queue** — students can now answer `SHORT_ANSWER`/`ESSAY` questions with prose (`MAX_ANSWER_TEXT_LENGTH` = 10,000 chars). Each free-text answer is scored for partial credit: a semantic LLM grade (`lib/llm`, task `quiz-grading`, prompt version `quiz-text-grading-v1`) with a reproducible deterministic lexical fallback, gated on an explicit `QUIZ_TEXT_SIMILARITY_THRESHOLD` (default 0.35), clamped to `[0, Question.points]`, and recorded with its rationale and the verbatim student text as evidence. Every score is an `AIGradeSuggestion` on a `GradeReview` (per-response when the quiz has free text, so each answer carries its own evidence); **nothing publishes** — only a teacher `accept`/`override` sets `Grade.publishedAt`. A text answer with no reference answer (`Question.explanation` null) is never guessed at: it is stored unscored (`pointsAwarded: null`, `needsManualReview: true`) with a `manual-review-required` suggestion asking for a human. Re-attempts supersede the previous per-response suggestions rather than double-counting, and a published grade is never overwritten. Choice scoring and `Question.points` weighting are unchanged. No schema change was needed. See [`docs/features/short-answer-partial-credit.md`](docs/features/short-answer-partial-credit.md).
- **Observability instrumentation (Phase 3)** — dependency-free structured JSON logging with correlation ids and a redaction policy (secrets/cookies/passwords never serialized), per-request and per-response lines, unhandled-error capture, per-call LLM telemetry (provider/model/usage/latency; prompt content off by default), a teacher-scoped grade-activity reader over `AuditLog`, and an unauthenticated `GET /api/health` with a timeout-bounded database check (`lib/observability/**`, `app/api/health/route.ts`, `app/api/teacher/observability/**`, `instrumentation.ts`). See [`docs/observability.md`](docs/observability.md).

- **Accessibility & performance audit of the Phase 2 surfaces** — charts now expose a text alternative (`title`/`desc`), grade badges and destructive-on-tint text meet WCAG AA contrast, placeholder-only inputs and unlabeled `Select` triggers across the new dashboards got accessible names, quiz options expose their selected state, and `app/(dashboard)/loading.tsx` + `error.tsx` give the new routes real loading/error states. See [`docs/quality/a11y-perf-audit.md`](docs/quality/a11y-perf-audit.md).

### Fixed

- **React hydration error in the student quiz/code date rendering (found by Phase 4 browser verification).** `components/student-quiz-attempts.tsx` and `components/student-code-submissions.tsx` formatted timestamps with a bare `new Date(...).toLocaleString()`, so the Node server rendered its default `en-US` locale while the browser rendered the user's locale and React raised `Hydration failed because the server rendered text didn't match the client` on `/student/quizzes`. Both now use an explicit `en-US` locale through a local `formatDateTime` helper, so server HTML and the hydrated DOM agree. Re-verified in a real browser: zero hydration errors on `/student/quizzes`, `/student/code-submissions`, `/teacher/reviews`, and `/teacher/analytics`. See [`docs/demo.md`](docs/demo.md#browser-verification).
- **bugfix-run-4 (post-retirement verification pass)** — the first adversarial pass after the grade-store unification and the legacy-quiz retirement; two High-severity grade-integrity defects, each reproduced with a failing-then-passing test. See [`docs/verification/bugfix-run-4.md`](docs/verification/bugfix-run-4.md).
  - **The review path overwrote a teacher-published manual mark (High).** A manual gradebook mark does not route through the `GradeReview` queue, so a stale AI suggestion leaves the review `PENDING` while the grade is already published. `submitReviewDecision` then upserted the grade unconditionally: `accept` replaced the manual mark with the AI total (`source = AI_SUGGESTED`, fresh `publishedAt`), and `flag`/`reject` un-published it and rewrote its points, so the mark vanished from every published-only reader. `accept` now returns `409` when a published grade exists ("use an override to change it"), and non-publishing decisions never touch a published grade; an explicit human `override` still replaces it (`lib/grading/review-service.ts`, `tests/grade-manual-immutability.test.ts`).
  - **A model re-run could silently clobber a concurrent manual mark (High).** `recordAiSuggestion` read `Grade.publishedAt` and then wrote; a teacher's mark committing in between was invisible to the read, and the write's `update` (which never sets `publishedAt`) left the human timestamp but replaced the points and source, producing a published grade that looked human-approved but carried the model's score. All three grade writers now take the same `Assessment` row lock before reading any grade state, making the read and write one critical section (`tests/grade-rerun-race.test.ts`). The existing `@@unique([assessmentId, studentId])` already prevented duplicate rows.
  - Also re-verified live and in tests: the migrated quiz import is gradeable end to end (import → published, attributed `Question`/`QuestionOption` → key-free student payload → weighted attempt score) with `offeringId` ownership enforced (`403` non-owner/non-existent, `400` missing); the modern `Grade` keeps its `(assessmentId, studentId)` uniqueness; a manual clear is not silently resurrected (a later run writes only an unpublished draft); no live accessor of the retired stores remains; and the earlier fixes (partial-update presence semantics, out-of-range rejection, object-level authz, key-free payloads, `/api/health` 503 without leak) still hold.
- **bugfix-run-3 (final pass)** — two defects, each reproduced with a failing-then-passing test.
  - **Partial `PUT /api/teacher/assessments/submissions` destroyed a grade (High, data loss).** The handler was a full replace written as a partial update: an _omitted_ `score` was indistinguishable from an explicit `score: null`, and `status`/`gradedAt`/`gradedById`/`feedback` were written unconditionally. A partial request therefore reverted a `GRADED` submission to `SUBMITTED` and wiped its grade and feedback. Now updates only the fields actually present; an explicit `null` still un-grades; a body with neither field is a `400` that writes nothing (`tests/teacher-submissions-partial-update.test.ts`). This closes suspicion S-1 carried since bugfix-run-2, and is the same class as run-2's offering-PUT fix.
  - **Concurrent quiz attempt start returned a generic 500.** Two simultaneous starts both computed the same `attemptNumber`, and the loser hit a Prisma `P2002` unique-constraint error. Now takes a row lock on the assessment, re-checks in-progress state and the cap inside the transaction, and resumes the winning attempt (`tests/quiz-attempts-adversarial.test.ts`).
  - Also added regression coverage for the instrumentation change below (`tests/observability-instrumentation.test.ts`) and confirmed clean behaviour for quiz-attempt double-submit, foreign-question IDOR, answer-key leakage, observability redaction, and `/api/health` against a dead database (`503` in ~0.3s, no hang, no leak). See [`docs/verification/bugfix-run-3.md`](docs/verification/bugfix-run-3.md).
- **Grade integrity and assessment placement (post-run-3)** — three defects carried as SUSPECTED across bug-fix runs 1–3, each now reproduced with a failing-then-passing test. See [`docs/verification/grading-integrity.md`](docs/verification/grading-integrity.md).
  - **Rubric-derived and quiz-derived grade buckets can no longer be summed.** `latestSuggestionTotals` deduped per bucket but summed across kinds, so a rubric criterion (`criterion:<id>`) plus the deterministic quiz auto-score (`label:Quiz score`) were added together and clamped to the rubric ceiling (a 10-point criterion with a 20/20 attempt became 20). It now counts exactly one bucket kind by explicit precedence (rubric → per-response quiz → whole-quiz auto-score → legacy), and `upsertRubricForTeacher` refuses to attach a rubric to an auto-scored `QUIZ` assessment, so the illegal combination cannot be created either (`lib/grading/review-service.ts`, `lib/rubric-grading/rubric-service.ts`, `tests/grading-bucket-kinds.test.ts`).
  - **`Question.points` is now honoured by scoring.** The kernel weighted every question equally (`correctCount / total × maxMarks`) even though `points` is teacher-editable and was serialized to students, so the point values a student saw did not affect the score. Scoring is now weighted by `points` and projected onto `maxMarks`, falls back to `1` for absent/zero/non-finite weights, and is clamped to `[0, maxMarks]`; the legacy `QuizQuestion` path keeps the default `1`, so equal weighting remains its special case (`lib/quiz-scoring.ts`, `lib/quiz-generation/grading.ts`, `lib/quiz-attempts/service.ts`, `lib/quiz-attempts/serialize.ts`, `tests/quiz-scoring-points.test.ts`).
  - **Assessment creation now requires an explicit `offeringId`.** `createAssessmentForSessionUser` resolved the offering by `courseId` + newest `academicYear`, so a teacher who teaches one course in two offerings could have an assessment silently written into the wrong class. `POST /api/gradebook/assessments` now requires `offeringId`, the service validates that the offering belongs to the signing-in teacher (a missing or foreign id is a clear `403`), and the teacher dialogs select a class offering instead of a course. This is a deliberate breaking contract change — `courseId` was removed rather than kept as an ambiguous fallback (`lib/contracts/gradebook.ts`, `lib/gradebook-db.ts`, `app/api/gradebook/assessments/route.ts`, `components/gradebook-provider.tsx`, `components/add-assessment-dialog.tsx`, `components/teacher-assignments-manager.tsx`, `tests/assessment-offering-selection.test.ts`).
- **Edge-runtime instrumentation defect.** `instrumentation.ts` statically imported the observability logger, which reaches `process.stdout` and `process.version`. Next.js bundles this file for both the Node.js and Edge instrumentation runtimes, so Turbopack emitted Edge-runtime warnings and would have thrown had the Edge hooks executed. It is now a thin `NEXT_RUNTIME` dispatcher that dynamically imports `lib/observability/instrumentation-node.ts`, which is the pattern the Next.js instrumentation docs prescribe. Turbopack Edge warnings: 2 → 0. (Note: `proxy.ts` itself runs on the Node.js runtime in Next 16, so middleware logging was never affected.)
- **Documentation drift.** An audit found the phase documents contradicting the shipped code — Phase 1 described as in progress and Phases 2–3 as not started while all ten pods were merged, plus stale commit hashes, an outdated "CI runs on `main` only" claim, and a stale branch-protection note. Sixteen `docs/**` files corrected, with a "Known gaps and open decisions" section added rather than leaving the workarounds undocumented.

### Security

- **Signed, expiring sessions replace the unsigned plaintext cookie** (`lib/session.ts`,
  `lib/auth.ts`, `proxy.ts`). The `auth-user` cookie is now
  `base64url(payload).base64url(HMAC-SHA256)`, verified in constant time on every read; expired,
  malformed, or tampered values are rejected. `SESSION_SECRET` is read from the environment, and a
  missing secret throws in production. `proxy.ts` verifies the signature rather than parsing the
  cookie, and `/quiz` was added to the matcher.
- **`requireRole` / `requireUser` authorization helper** (`lib/authz.ts`) re-verifies the signed
  session server-side and enforces the role on every protected route. Object-level checks limit a
  teacher to their own offerings/assessments and a student to their own data.
- **Deleted the `admin`/`admin` login backdoor** (`app/api/auth/login/route.ts`): every login is a
  database lookup plus a bcrypt comparison.
- **Locked down the destructive seed endpoint** (`app/api/auth/seed/route.ts`): it now requires a
  signature-verified admin session re-checked against the database, an explicit
  `{ "confirm": "RESET-SEED" }` body, and `ALLOW_DESTRUCTIVE_SEED=true` in production. It no longer
  echoes credentials.
- **Closed the student self-grading hole** (`app/api/gradebook/marks/route.ts`,
  `lib/gradebook-db.ts`): only teachers and admins may write marks, and a teacher may only write
  marks for assessments in their own offerings.
- **Removed the client answer key; quiz grading is now server-authoritative** (`lib/gradebook.ts`,
  `lib/gradebook-db.ts`, `lib/quiz-scoring.ts`, `lib/quiz-grading.ts`, `app/api/quiz/grade/route.ts`,
  `components/quiz-runner.tsx`). The gradebook payload no longer carries `QuizQuestion.correctIndex`;
  the browser submits only the options it selected and the server grades them, disclosing the key
  only in the post-submission response. A student is always graded as their own profile, and a
  teacher only for assessments they own.
- **Repaired the admin seed tool** (`components/admin-tools-panel.tsx`) to send the required
  `{ "confirm": "RESET-SEED" }` body (behind a confirmation prompt) after the endpoint was hardened.
- **Scoped the student gradebook payload to the signed-in student** (`lib/gradebook-db.ts`,
  `components/gradebook-provider.tsx`, `components/student-view.tsx`). `GET /api/gradebook` used to
  serialize every classmate's identity and every classmate's mark to a student; it now returns only
  the student's own row plus a server-computed `classAverages` aggregate, so the "vs class average"
  view still works without leaking per-student grades. Teachers keep the full cohort view they are
  authorized to see.
- **Phase 4 security hardening** ([`docs/security/hardening.md`](docs/security/hardening.md)): closed the three decisions the Phase 3 review left open — `POST /api/auth/login` now enforces a bounded, non-enumerating sliding-window throttle over the normalized identifier and client IP (per-process only; a multi-instance deployment still needs shared state), `requireRole`/`requireUser` re-validate the actor's current database role through a short-lived cache and return `401` on deletion or demotion (≤30 s staleness window), and sandboxed `unit` tests run student code in a separate child interpreter so it cannot forge or suppress the harness's per-test evidence.
- **Phase 3 security review** (see [`docs/security/security-review.md`](docs/security/security-review.md)). Hardened the code-eval harness so untrusted student code cannot forge per-test evidence, made the code-submission cap and course-enrollment capacity checks atomic under concurrency, and confirmed the published-grade invariant holds across all Phase 2 features.

### Added

- **Student code submissions ported — a merge, not a replace, with the task's marks and limits finally carried** — the mockup screen is a read-only report while the real page is the only place a student can hand in code, so the editor and submit path are preserved and the mockup's information architecture is layered around them. The selected task's runs are now server-fetched via `?assessmentId=`, so the client fetch on selection is gone. The one contract change carries exactly three fields a student page legitimately needs and had no way to get: `maxMarks` (from the assessment) and the sandbox `timeLimitMs` / `memoryLimitMb` (from the code task) — nothing teacher-only, and no answer-key or hidden-case field. Dropped rather than faked: the mockup's `isHidden` visibility column (there is no student-facing `TestCase` shape, and the contract is explicit that student shapes never carry `expectedOutput`), the mockup's global test-case fixtures (a student's case results must come from **their own** latest run), and any score derived without `maxMarks`. The seeded `TestRun` has no `finishedAt` and no `coverage` and its evidence does not match `readRunEvidence`, so those cells render em dashes — correct rather than a bug to work around.

- **Teacher groups ported, and a teacher may now see the peer-evaluation pair matrix (D6)** — the two are separate commits because the second touches a confidentiality surface. `GroupAnalysisResponse` gains `peerEvaluationPairs`: evaluator and evaluatee id **and name**, status, per-dimension values and `submittedAt`, built from the same `PeerEvaluation` rows `analyzeGroup` already consumed (the only query change is `submittedAt` in an existing `select` plus a deterministic `orderBy`). A draft rating is listed so a teacher can see who has not finished, but carries `ratings: null` and no timestamp. The rationale is standard CATME practice — an instructor needs the pairs to spot collusion and free-riding, and the anonymity promise is **student-to-student, not student-to-instructor**. The boundary is enforced rather than assumed: `lib/groups/student-service.ts` is untouched, the pair shape attaches only to the teacher analysis schema, and `tests/groups-peer-evaluation.test.ts` — which stringifies a student's `received` aggregate to prove it carries no rater identity — passes **unchanged**. The page itself is now a list plus one **server-selected** detail (`?offeringId=` / `?groupId=`), so the four-endpoint client re-fetch on offering change is gone and only the six mutations remain a client island. Dropped rather than faked: `similarityFlag` (`SimilarityCheck` has no group relation at all) and `avgContribution` (no equivalent column — replaced by each member's share of the group's recorded contribution weight, labelled as such). Free-rider standing comes from the rating signal only, matching `lib/groups/free-rider.ts` and the test that pins it. Peer comments are deliberately **not** in the payload: D6 covered "who rated whom, per dimension, with names", and widening it to free text would be a further disclosure decision.

- **Teacher code-tasks ported onto the mockup shell, with the detail server-fetched** — the real page was a "list plus three client fetches on selection" while the mockup is a single tabbed task view, so the selected task's detail, runs and similarity now load on the server in one `Promise.all` and the picker became plain `<Link>`s carrying `?assessmentId=` — shareable URLs, no client JS, and three fetch-on-mount calls gone ([`docs/plans/wave-1.md`](docs/plans/wave-1.md) §5). Only the six **mutating** actions remain a client island, calling the existing routes and then `router.refresh()` so new data arrives through the RSC payload rather than a fourth fetch. Dropped rather than faked: the mockup's "weighting 15% of the final grade" (`Assessment` has no weight column), the per-case "last result" column (`TestCaseResponse` carries no result), and any `ERROR` run (`resolveRunStatus` returns it only for an out-of-memory kill). `submissionCount` is labelled "runs", because it counts runs and not distinct students. `null` coverage, `runtimeMs` and `finishedAt` render as em dashes.
- **Student courses ported, with the rating distribution as a real aggregate** — the query moved out of the route into `lib/student-courses.ts` (mirroring `lib/student-assessments.ts`) so the page renders from props instead of fetching on mount, and `app/api/student/courses/route.ts` is now a thin wrapper. The mockup's rating donut needed data the payload did not have, so `ratingDistribution` was added as an **aggregate-only** field (counts per star value, five buckets) built by a pure `buildRatingDistribution`; the peer table with names and comments is deliberately **not** ported, per D7 and what `docs/features/course-ratings.md` already documents as intentional, and a test asserts no peer comment, profile id, user id or email appears anywhere in the serialized payload. The Materials card is dropped (`Material` has no reader) and `room` has no column. Fixes a latent dead end on the way: the rating form rendered for any completed offering but the route rejects a waitlisted enrolment with a 403, so it now requires `isEnrolled && isCompleted`.

- **Student quizzes ported onto the mockup shell** — presentation only: every `useState` and every fetch is byte-identical to the previous component, so the attempt flow (start, save, submit) is untouched. `Card` became `SectionCard`, `Badge` became `StatusPill` against the closed vocabulary, and the raw emerald/destructive paragraphs became `Callout` so a result is announced by `role` rather than by colour alone. A KPI row derives entirely from the quiz list the server sent, the selected quiz marks itself with `aria-current`, and the quiz/attempt rows gained the shared focus ring. Not ported because nothing can serve them: the mockup's countdown timer, per-question flags, and practice/graded distinction (D4).
- **Teacher reports: the ratings half, server-fetched, and `purged` exposed** — the page's data moved from a client `useEffect` to server props, removing one instance of the deferred P1 fetch-on-mount finding rather than adding another. Deliberately absent: the mockup's report-card table (no query for per-student marks) plus "At risk" and "Completion" (D3). One contract addition was forced by the design: its comment cell distinguishes three states, but `comment: null` cannot tell "the student wrote nothing" from "the purge cleared it", so `purged` is serialized from `CourseRating.purgedAt`.
- **Teacher rubrics: a read-only summary beside the working editor** — additive, because the mockup screen is a read-only report while the real page is the authoring form; the editor is unchanged and remains the only write path. It surfaces the sum of criterion ceilings against the assessment's `maxMarks` and the prompt version stored with every suggestion. **Weights render as relative numbers with no "totals 100%" claim** — the schema fixes no unit for `RubricCriterion.weight` and validates no sum (D8).
- **Student assessments: server-fetched, with "marked but unreleased" now expressible** — the Prisma query moved out of the route handler into `lib/student-assessments.ts`, removing the fetch-on-mount recorded against this page; the route stays as a thin wrapper because the page's refresh path still calls it. The payload now carries `hasMark` and `published`, so "not marked" and "marked but not released" are distinguishable without exposing an unreleased value, and feedback is withheld until the grade is released. **The class average is computed from released grades only**, and `tests/student-assessments-published.test.ts` builds one published plus two unpublished peer marks so a regression fails with a different number (100% versus 58.33%) rather than passing silently. An earlier commit in this slice shipped a Blocker — the mount `useEffect` was removed without moving the draft seeding into the initialiser, so a saved draft rendered blank and "Save draft" erased it behind a success message — fixed in `ac91e16`, which also scoped `aria-invalid` to the fields an error implicates and dropped a "Back to dashboard" link that returned the anonymous user to the page they were already on.
- **`lib/format.ts`** — the real-data-safe formatters moved out of `lib/mock/format.ts`, because eight real modules were importing a tree scheduled for reduction to test fixtures — the same dependency `lib/labels.ts` was created to close. Every date uses an explicit locale **and** `timeZone: "UTC"`, and two student views that had been using an unpinned `toLocaleString` now use it, closing a latent hydration mismatch. The mock module re-exports them and keeps only the frozen `MOCK_NOW` clock and the three helpers anchored to it, which must not be used on real data.

### Removed

- **`GET /api/student/courses` has no consumer left** — its page now calls `listStudentCourses` directly on the server, so the wrapper route is unreachable from the app. It is kept as a documented HTTP surface (see [`docs/features/course-ratings.md`](docs/features/course-ratings.md)) rather than deleted, because an external client may use it; its sibling `GET /api/student/assessments` is **not** orphaned, since that page's refresh path still calls it. Worth a deliberate decision — either delete both or document both as public API.
  Its page was ported onto the shell in the same wave, and the read path it replaced was one of the deferred fetch-on-mount findings.

- **Student peer evaluation ported onto the mockup shell — a merge, not a restyle** — the mockup screen is a read-only report while the real page is the only surface where a student can submit a peer evaluation, so the rating form is preserved and the mockup's reporting cards are added around it ([`docs/plans/wave-1.md`](docs/plans/wave-1.md) §5). The write path is provably untouched — `reload`, `submit`, `updateRating`, `updateComment` and `buildDrafts` are byte-identical, so the request body, URL, error handling and the draft/submit distinction are exactly as before, and a browser round trip confirms it ("Draft saved. You can change it until you submit."). Added: a round-progress card with the self-rating state, a ratings card that pairs each dimension's behavioural anchor with its control so the number means something, the received-ratings card, and a team table. **The disclosure threshold is read from `received.minRatersRequired`, never a local constant** — the mockup hardcoded 2 and wrote "at least 2 teammates" into its copy while the server requires 3, and the larger number is the privacy control. On the seeded data the page correctly shows the _withheld_ state ("2 of 3 needed"), because a three-member team yields two non-self ratings.

- **Sign-in and register restyled onto the mockup frame, and the retired "Gradebook" wordmark is gone** — the auth pages were the last surface still carrying the old product name: `components/auth-page-shell.tsx` put a hardcoded "G" inside the card and titled the page after the retired brand. Both pages now use the mockup frame (brand block above the card, one `<main>`, a real `<h1>`) and read the name and tagline from `BRAND`, so the auth screens and the app shell cannot disagree. The submission paths are untouched — same request bodies, same error surfacing, the same full-navigation `window.location.assign` after sign-in, the same `router.push("/login")` after register — and errors now render through `AuthFeedback`, a `Callout` adapter carrying a live role so a screen reader announces the result without moving focus. The role select is upgraded from a native `<select>` to the shared primitive with its value→label map, and `aria-invalid` is set only on the fields an error actually implicates (a mismatched confirmation marks the two password fields, not the valid email). **Seven** mockup affordances are deliberately **not** carried over because each would describe or require something the backend does not do: the sign-in role selector (the role is derived server-side, so a choice would invite picking a workspace the user has no account in), "Forgot password?" (no reset flow exists), "Keep me signed in" (the session lifetime is fixed server-side), register's "Full name" (`registerRequestSchema` has no name and the route derives it from the email) and its "pending verification" screen (registration signs the user in immediately), and its acceptable-use checkbox and 12-character minimum (nothing records acceptance, and the contract accepts `min(1)`, so a client-only minimum would reject registrations the server would accept). The identifier field also stays a **username-or-email** `text` input rather than the mockup's `type="email"`, because `loginRequestSchema.email` is a non-empty string and the seeded administrator's identifier is literally `admin`. The same class of inconsistency was fixed on the pages still using the old shell: `components/dashboard-header.tsx` now reads `BRAND` instead of the retired wordmark, `components/teacher-view.tsx`'s marks card is titled "Marks" rather than the old product name, and the auth pages' "Back to dashboard" link was removed — it pointed at `/`, which redirects to `/login`, so it returned the anonymous user to the page they were already on.

- **`/teacher/classes` is now the class roster, and offering administration moved to `/teacher/offerings`** — the route and the mockup page only ever shared a name: the real page administered course offerings (enrollment limits, registration windows, results publication) while the mockup showed the students enrolled. They are now two pages, each naming what it is ([`docs/plans/wave-1.md`](docs/plans/wave-1.md) §D1). The split was not cosmetic: "Publish results" sets `CourseOffering.resultsPublishedAt`, the retention anchor that starts the purge clock and cannot be undone, so dropping that screen to make room for a roster would have left the retention policy with no trigger in the UI. `/teacher/offerings` is also the first page to exist in the real app with **no mockup counterpart**, so `NavItem` gained an `appOnly` flag — such an item carries its real path, is filtered out of mockup scope and out of `allNavItems()`, which keeps the mockup index's page count and the "every mockup nav href has a mockup page" assertion honest. The roster is server-fetched (no fetch-on-mount) and shows four derived columns; two of the mockup's six are **omitted rather than faked** — "Last active" (no activity timestamp exists on any model) and "Standing" (the real alerts are offering-level, with no per-student flag). `toTeacherRosterRow` is pure and tested, pinning that an unmarked student averages `null` and never `0`, while a genuine `0/10` stays `0`.

- **Teacher submissions queue, and a `FilterBar` that can actually filter** — `/teacher/submissions` is the first real page ported from the mockups after the Wave 0 pilot, as a read-only browse view (`app/(dashboard)/teacher/submissions/page.tsx` + `components/teacher-submissions-table.tsx`) over a new server read (`lib/teacher-submissions.ts`). The grading editor deliberately stays where it works, inside `/teacher/assignments`, because it is the only client of `PUT /api/teacher/assessments/submissions`; the queue's per-row action links into it rather than replacing it, so nothing moved on the write path and the partial-update guard keeps covering it ([`docs/plans/wave-1.md`](docs/plans/wave-1.md) §D2). The queue needs two things the existing route deliberately hides — the real `AssessmentType` rather than the Quiz/Assignment collapse, and the mark whether or not it has been released, because "marked, withheld" is a state the tiles have to name — so it has its own read rather than bending one projection to serve both consumers. Rows are fetched on the server and filtered in the client, so there is **no fetch-on-mount**; and `FilterBar`, previously inert by design ("no state and no submit handler"), now takes **opt-in controlled props** so a real page can have working search and selects without changing the 13 mockup pages that render it. `toTeacherSubmissionRow` is a pure function with its own test — the read path behind this page had **no test at all** before. Two invariants are pinned by name: an unmarked submission is `null`, never `0`, and `published` is independent of `points` so a withheld mark survives as its own state.
- **`lib/labels.ts`** — the shared domain→status vocabulary (18 maps: `ASSESSMENT_KIND_LABEL`, `SUBMISSION_STATE_TO_STATUS`, `TEST_RUN_STATE_TO_STATUS`, …) moved out of `app/mockup/teacher/_lib/labels.ts` into `lib/`, because a real page must not import from the mockup tree that is scheduled for deletion. The mockup module is now a one-line re-export, so every mockup page keeps working and each mapping has exactly one definition.

- **UI mockup tree and design system: thirty-eight static screens across three roles, and the primitives behind them** — a full design deliverable at `app/mockup/**` (35 routes) plus the standalone auth and quiz screens under `app/(mockup-standalone)/mockup/**` (3), built on a shared shell (`components/shell/**`) and a primitive set (`components/ui/**`: `Callout` + `tone.ts`, `CodeBlock`, `TruncatedText`, `PageTabs`, `FilterBar`, `StatCard`, `DataTable`, `StatusPill`, `GradeDonut`, `Sparkline`, `ProgressBar`, `EmptyState`, `Timeline`, `MetricRow`, `SectionCard`). Every screen renders from typed fixtures in `lib/mock/**` whose string unions mirror the Prisma enums 1:1 so a later wiring pass needs no translation tables. Two refinement passes hoisted page-local workarounds into the primitives: the four local `overflow-x-auto` hacks on tab rows — which were clipping the active-tab underline entirely — were deleted in favour of `PageTabs` owning narrow-width scrolling, five hand-rolled notice panels were replaced by `Callout`, and `-foreground` tokens were banned on tinted backgrounds (measured: `--warning-foreground` on `bg-warning/15` in dark is 1.35:1, whereas the audited pairs in `tone.ts` are 4.88–14.11:1). The tree is deliberately unauthenticated (`proxy.ts` does not match `/mockup`) and **is not yet connected to the backend**; the wiring plan is [`docs/plans/mockup-to-backend.md`](docs/plans/mockup-to-backend.md), and the design system is [`docs/ui/design-system.md`](docs/ui/design-system.md).

- **Course ratings restored** — students can rate a completed course they are enrolled in and update their rating, and teachers get an ownership-scoped ratings report with per-course averages, counts, and comments. `20260912010000_restore_course_rating` re-creates the `CourseRating` model dropped by `20260912000000_schema_unfreeze` (which an audit wrongly reported as unreferenced); the already-modernized consumer code is restored (`app/api/student/courses/rating`, `app/api/teacher/reports/ratings`, `components/student-courses-view.tsx`, `components/teacher-ratings-report.tsx`, `app/(dashboard)/teacher/reports`), with the contract, service layer, nav entry, and fresh tests. See [`docs/features/course-ratings.md`](docs/features/course-ratings.md).

- **`zod` API contract** (`lib/contracts/`). Request/response schemas for auth, gradebook, and the
  grading pipeline, plus `lib/api.ts` body parsing. Route handlers touched in this change validate
  input against these schemas instead of hand-rolling checks.
- **Grade review state machine** (`lib/grading/`). `recordAiSuggestion` stores the full
  explainability envelope (rationale, evidence, confidence, model, prompt version, tokens, latency);
  `submitReviewDecision` enforces legal `GradeReviewStatus` transitions
  (`PENDING` / `NEEDS_REVIEW` / `AUTO_ACCEPTED` / `OVERRIDDEN` / `REJECTED`); every transition writes
  an `AuditLog` row in the same transaction. Only the human `accept`/`override` actions set
  `Grade.publishedAt`, so no grade publishes without teacher sign-off.
- **Tests** (`tests/auth.test.ts`, `tests/authorization.test.ts`, `tests/contracts.test.ts`,
  `tests/grading-state-machine.test.ts`, `tests/quiz-scoring.test.ts`, `tests/quiz-grading.test.ts`,
  `tests/gradebook-scoping.test.ts`). They prove a forged admin cookie and a student self-grading
  attempt are rejected, that quiz correctness is derived server-side with object-level
  authorization, that a student's gradebook payload contains only their own row, and exercise the
  contract schemas and state machine.
- **Assessment spine schema** (`prisma/schema.prisma`). Additive models for rubrics and criteria
  (`Rubric`, `RubricCriterion`); the grading pipeline (`AIGradeSuggestion`, `GradeReview`, `Grade`)
  with an append-only `AuditLog`; quiz questions, attempts, and responses (`Question`,
  `QuestionOption`, `QuizAttempt`, `QuizResponse`); code evaluation (`CodeTask`, `TestCase`,
  `TestRun`); collaboration (`Group`, `GroupMember`, `PeerEvaluation`, `ContributionEvent`,
  `Milestone`); integrity (`SimilarityCheck`); submissions (`SubmissionVersion`); and course
  retrieval (`Material`, `MaterialChunk`). New enums: `MaterialKind`, `QuestionType`,
  `QuizAttemptStatus`, `GradeReviewStatus`, `GradeSource`, `TestRunStatus`, `GroupStatus`,
  `PeerEvaluationStatus`, `MilestoneStatus`, `ContributionEventType`, `SimilarityVerdict`.
  `AssessmentType` gained `DESCRIPTIVE`, `CODE`, and `GROUP_PROJECT`.
- **Baseline migration** (`prisma/migrations/20260911180000_baseline/migration.sql`). A single
  squashed initial migration that takes an empty database all the way to the current
  `prisma/schema.prisma`: the full assessment spine (tables, enums, indexes, foreign keys), plus
  `CREATE EXTENSION IF NOT EXISTS vector` and
  `MaterialChunk_embedding_hnsw_idx`, an HNSW index using `vector_cosine_ops`. It replaces the
  incomplete Phase 1 migration chain.
- **Pluggable LLM provider adapter** (`lib/llm/`). One `LlmProvider` interface with `generate` and
  `embed`, four providers (`openai-compatible`, `anthropic`, `ollama`, `mock`), env-driven selection
  via `LLM_PROVIDER`, a process-wide lazy singleton, and injected `env` / `fetchImpl` for tests.
  Every result carries provider, model, usage, and latency; requests carry `task` and
  `promptVersion` for the explainability envelope.
- **Deterministic offline mock provider** (`lib/llm/providers/mock.ts`). No API key and no network,
  so CI and tests stay free and reproducible.
- **pgvector retrieval module** (`lib/vector/`). A deterministic text chunker (`chunk.ts`), batch
  embedding through the LLM provider (`embed.ts`), and cosine similarity search over `MaterialChunk`
  using pgvector's `<=>` operator (`search.ts`). Vector columns are read and written with raw SQL
  because `MaterialChunk.embedding` is `Unsupported("vector(1536)")` in the Prisma datamodel;
  `indexMaterial` replaces a material's chunks transactionally.
- **Environment template** (`.env.example`) covering the database URL, session secret, provider
  selection, timeouts, and the OpenAI-compatible, Anthropic, and Ollama settings.

### Changed

- **Wave 0 of the backend wiring: the shell is now scope-aware, and one real page runs on it** — `AppShell` takes a `scope`. `"mockup"` (the default) resolves nav hrefs to the static `/mockup` routes and keeps the mockup-only chrome, so all 38 mockup pages are unchanged; `"app"` resolves them to the authenticated routes, takes the signed-in user from the server, drops the mockup-only affordances (preview-role switcher, mockup index, notifications — there is no `Notification` model, so rendering one would fabricate data — and the inert search field, which is a labelled `role="search"` landmark that silently swallows input) and offers a real sign-out. The nav stays a single definition (`components/shell/nav-config.ts`) resolved per scope by `navHref`; the two routes renamed in the real tree are mapped explicitly (`quiz-ai` → `/teacher/quiz-generation`, `activity` → `/teacher/observability`), and the **six** items with no real page (`*/profile` / `*/settings` for the three roles, which were never built) carry a `null` target and are dropped from the app nav rather than rendered as broken links. (`teacher/submissions` was one of these and has since become a real read-only queue; see [`docs/plans/wave-1.md`](docs/plans/wave-1.md) §D2.) `tests/nav-scope.test.ts` walks the filesystem and fails if any app-scope href lacks a page, which is the invariant a naive "strip the `/mockup` prefix" translation would have broken. The real `User` model has no name column, so an app-scope shell shows the email and derives initials from it (`lib/user-identity.ts`) rather than inventing a name. `app/(dashboard)/teacher/reviews` is the pilot: it keeps its `getSessionUser` guard and its existing queries, and adopts the shell with a `PageHeader`. See [`docs/ui/design-system.md`](docs/ui/design-system.md) §8.3.1.

- **The app brand is now "Rubrix" in the document title, not the retired "Gradebook"** — the shell and the design system had both moved to `Rubrix — AI-assisted assessment & feedback` while `app/layout.tsx` still set `Gradebook — Assessment & Marks Tracker`, so the first real page a user saw carried the old brand in the tab. The root metadata now uses the Rubrix title plus a `%s · Rubrix` template, so a page sets a short title and the brand is appended.

- **Route handlers authorize and validate through shared helpers** (`app/api/**`). Protected routes
  now call `requireRole`, and the auth, gradebook, teacher, and student handlers parse bodies with
  the `lib/contracts` schemas. `lib/gradebook-db.ts` takes the authenticated actor instead of
  re-reading the session.
- `lib/admin-db.ts`: widened `DbAssessmentType` for the new `AssessmentType` enum values.
- **Test database provisioning** (`tests/helpers/provision.ts`). The harness now resets the test
  database and applies the committed migration history with `prisma migrate deploy`, instead of
  diffing `prisma/schema.prisma` from empty. CI therefore exercises the real migration path and
  fails if the history stops reproducing the schema from scratch.

### Fixed

- **Unsigned session cookie.** `lib/auth.ts` stored a plaintext JSON cookie and trusted its
  client-supplied `role`/`id`; `proxy.ts` parsed the same value. Both now verify the HMAC signature.
- **Prisma migration history.** `prisma migrate deploy` could not build a fresh database:
  `20260807071217_init` created only the `User` table, `20260807124500_course_registration_rating`
  altered `Course`/`CourseOffering` and referenced `StudentProfile` (none created by any migration),
  and `20260807_manual_transition.sql` was a loose file Prisma never ran. The history was
  re-baselined into one squashed migration so an empty database now reaches the current schema
  through `prisma migrate deploy`.
- `lib/vector/search.ts`: an empty query now reports the caller's configured provider instead of
  hardcoding the mock provider name.

### bugfix-run-1

Real-time bug-fixing pass 1 of 3 (see [`docs/verification/bugfix-run-1.md`](docs/verification/bugfix-run-1.md)).

#### Security

- **Raw database errors are no longer echoed to API clients** (`lib/api.ts`,
  `app/api/gradebook/assessments/route.ts`, `app/api/gradebook/marks/route.ts`,
  `app/api/teacher/quiz/route.ts`). An invalid `date` or unbounded `maxMarks` used to reach Prisma,
  and the route returned the resulting `PrismaClientValidationError` message — including schema
  fragments and internal file paths — with a 400. Inputs are now validated at the contract boundary
  and unexpected errors return a generic 500.

#### Fixed

- **AI grade suggestions no longer double-count when the model is re-run**
  (`lib/grading/review-service.ts`). Both `recordAiSuggestion` and `submitReviewDecision` summed
  _every_ `AIGradeSuggestion` row for the assessment/student, so re-running a criterion added the new
  score on top of the old one and inflated the draft — and then the published — grade. Scoring now
  sums the latest suggestion per logical bucket (`rubricCriterionId` / `quizResponseId` /
  `submissionId` / `criterionLabel` / overall), preserving history while superseding old scores.
- **A graded submission can no longer be overwritten or reverted by the student**
  (`app/api/student/assessments/[assessmentId]/submission/route.ts`). `action: "submit"` used to
  overwrite a `GRADED` status (leaving the grade and feedback attached), and `action: "saveDraft"`
  then reset it to `DRAFT` with a null `submittedAt`. A graded submission is now immutable to the
  student, and a submitted assignment cannot be saved back to a draft.
- **Out-of-range marks are rejected instead of silently clamped** (`lib/gradebook-db.ts`). A score
  above `maxMarks` or below zero returned `200 success` while a different value was stored; it now
  returns `400 Score must be between 0 and <maxMarks>.`
- **Invalid dates and unbounded `maxMarks` are rejected at the contract boundary**
  (`lib/contracts/common.ts`, `lib/contracts/gradebook.ts`). `PUT /api/teacher/offerings/[id]` used to
  silently store `null` when a date string could not be parsed, wiping the existing schedule.
- **AI draft grade writes are audited** (`lib/grading/review-service.ts`). `recordAiSuggestion`
  mutated the draft `Grade` without an `AuditLog` row, contradicting the service's own "every
  mutation is audited" contract; it now writes `grade.ai_draft_created` / `grade.ai_draft_updated`.
- **Fixture-list identity fixes in two legacy client views** (`components/student-assessments-view.tsx`,
  `components/student-courses-view.tsx`): `payload?.x ?? []` allocated a fresh array every render,
  forcing downstream `useMemo`s to recompute on every render.

### bugfix-run-2

Real-time bug-fixing pass 2 of 3 (see [`docs/verification/bugfix-run-2.md`](docs/verification/bugfix-run-2.md)).

#### Security

- **OneRoster CSV export no longer allows spreadsheet formula injection** (`lib/lms-export/csv.ts`).
  A free-text cell (assessment title, comment, description) beginning with `=`, `+`, `-`, `@`, a tab,
  or a CR was emitted verbatim, so a crafted title such as `=cmd|'/C calc'!A0` would execute when the
  exported file was opened in Excel/Sheets/LibreOffice. String cells are now prefixed with an
  apostrophe (OWASP mitigation); numeric cells are exempt so negative numbers stay numeric, and
  RFC-4180 quoting still applies afterwards.

#### Fixed

- **A partial `PUT /api/teacher/offerings/[id]` no longer wipes the offering's schedule dates**
  (`app/api/teacher/offerings/[offeringId]/route.ts`). `parseDateOrNull` collapsed "field omitted"
  and "field invalid" into `null`, and the route wrote all four date columns unconditionally, so a
  body such as `{ "studentLimit": 30 }` returned 200 while clearing `registrationOpenAt`,
  `registrationCloseAt`, `startsOn`, and `endsOn`. Omitted fields are now left untouched, an explicit
  `null` still clears a field, and an unparseable date is rejected with 400.
- **Soft-removed group members are no longer scored or offered an individual grade**
  (`lib/groups/service.ts`, `lib/groups/student-service.ts`). `getOfferingAnalysisForTeacher`,
  `resolveUniformGroupGrade`, and `recomputeAdjustmentFactorsForGroup` built their roster from every
  `GroupMember` without filtering `leftAt`, so a former member received an adjustment factor and a
  suggested individual grade and their retained ratings skewed the team norm for everyone else. Only
  current members (`leftAt = null`) are scored; removed members' historical rows are retained.
- **Rubric evaluation now runs under the offline `mock` provider** (`lib/llm/providers/mock.ts`).
  The mock only synthesized the `quiz-generation` task, so `task: "rubric-grading"` received generic
  JSON that `parseCriterionEvaluation` rejects and `POST /api/teacher/reviews/evaluate` always
  answered 502 with `LLM_PROVIDER=mock`. The mock now returns a deterministic, schema-valid
  per-criterion evaluation whose evidence is a verbatim quote of the submission.
- **Mock quiz generation no longer leaks the prompt's material section into subtopic tags**
  (`lib/llm/providers/mock.ts`). The parser consumed every line after `Subtopic tags to use:`,
  including the `Course material …` heading and the retrieved source text, and persisted those as
  `Question.subtopic`. It now reads only the bullet tags in the first section and falls back to
  `<topic> fundamentals`.

### bugfix-run-3

Real-time bug-fixing pass 3 of 3 (see [`docs/verification/bugfix-run-3.md`](docs/verification/bugfix-run-3.md)).

#### Fixed

- **A partial `PUT /api/teacher/assessments/submissions` no longer destroys an existing grade**
  (`app/api/teacher/assessments/submissions/route.ts`). The legacy route treated an omitted `score`
  as `score: null`, so a feedback-only request reverted a `GRADED` submission to `SUBMITTED`, cleared
  `gradedAt`/`gradedById` and wiped the feedback — the same full-replace data-loss class as
  `bugfix-run-2`'s offering PUT. It is now a partial update: only fields the body actually carries
  are written (an explicit `score: null` still un-grades deliberately), a body with neither `score`
  nor `feedback` is a 400, and a malformed JSON body returns 400 instead of throwing.
- **Concurrent quiz-attempt starts no longer return a 500 or race the attempt cap**
  (`lib/quiz-attempts/service.ts`). Two simultaneous `POST /api/student/quiz-attempts` requests both
  computed the same `attemptNumber`, and the loser collided on the
  `(assessmentId, studentId, attemptNumber)` unique key — surfacing a generic 500 to a student who
  simply double-tapped "Start" and leaving a check-then-create window on the attempt cap. Attempt
  creation now runs in one transaction that takes a `SELECT … FOR UPDATE` lock on the assessment row
  and re-checks the existing in-progress attempt and the cap, so a concurrent start resumes the
  winner instead of erroring.

### wave-4: the CAT/FAT grading policy wired into the product

The grading policy was implemented, tested, and **called by nothing**. `lib/grading/policy.ts` was
imported only by its own test, `wave-3.md` §9 described a `CourseOffering.gradingConfig` column that
did not exist in the schema or any migration, and `docs/README.md` presented the policy as shipped.
So three requirements were absent from the product: weights that persist, a way for a teacher to
define and edit them, and a minimum-CAT gate that applied to anybody.

#### Added

- **`CourseOffering.gradingConfig`** (nullable JSON, migration `20260917010000_offering_grading_config`)
  holding the CAT/FAT split, the chosen final assessment, and the minimum-CAT gate. **Category
  membership is deliberately not stored** — it is derived from the offering's assessments at read
  time, because storing an `assessmentIds` list would silently drop any assessment added afterwards
  from the weighted total.
- **`lib/grading/offering-config.ts`** — the seam where a stored column becomes a weighted
  configuration. Absent and malformed policies are distinguished, and neither throws: the column is
  read on the export path.
- **`lib/grading/offering-eligibility.ts`** — per-student CAT progress and FAT verdict.
- **`GET`/`PUT /api/teacher/offerings/[offeringId]/grading`** — read and write the policy, scoped to
  the caller's own offerings (a non-owner sees `404`) and audited, because it changes how every
  student's final grade is computed. A named final assessment must belong to the offering.
- **The policy editor** (`components/offering-grading-policy.tsx`), per offering on
  `/teacher/offerings`: the split, the final-assessment choice, the gate, the resolved membership,
  and each student's verdict.

#### Changed

- **The export applies the stored policy.** `loadExportContext` resolved its config from the request
  body or an equal-weight default; it now reads the offering's policy in between. An offering with
  nothing stored keeps **equal weighting** — the default CAT 40 / FAT 60 split is offered in the
  editor and never applied automatically, because the FAT is derived by due date and silently
  putting 60% of a course's weight on whichever assessment falls due last is the same error as
  guessing an exported letter grade.
- **`AssessmentRow.type` is the Prisma enum**, not `string`. The widening was why the policy's input
  type could not accept the row.
- **The demo seed gained a past-due CAT assessment** with published marks spanning the gate. Every
  demo assessment was future-dated, so the gate had nothing to judge and was undemonstrable. The
  marks are chosen to show every verdict, including a genuine zero (a real mark) as distinct from
  missing work.

#### Fixed

- **The FAT gate's completion ratio counted work that had not happened.** Its denominator was every
  CAT assessment on the course, including those still ahead, so a course three weeks into its term
  reported `insufficient-cat-work` for the whole cohort — not because marking was behind, but
  because the term was not over, and the gate could never reach a verdict until the final week. It
  now counts only CAT work that has fallen due.
- **The FAT heuristic can be overridden.** `deriveDefaultGradingConfig` identified the final
  assessment by due date with no way to correct it; it now honours an explicit choice, and tolerates
  a stale one by falling back rather than failing.

#### Notes

- **The gate is reported, not enforced.** The roster shows verdicts; nothing refuses a FAT attempt.
  Enforcement needs the FAT's own delivery path to consult the policy, and refusing an attempt is a
  harder failure than refusing an export.
- **The create contract is unchanged** (`Quiz | Assignment`). Teachers can weight the kinds that
  exist; authoring descriptive/code/group assessments from the gradebook remains a product decision.

### Small fixes: dark-mode following the user, token contrast, and stale docs

#### Fixed

- **Dark-mode styling followed the operating system instead of the user's choice.** 21 sites across 8
  components used an arbitrary `[@media(prefers-color-scheme:dark)]:` variant, on the belief — stated
  in `grade-badge.tsx`'s own comment — that the app "never sets" a `.dark` class and therefore themes
  purely via `prefers-color-scheme`. It does set one: `theme-toggle.tsx` maintains `.dark` / `.light`
  on `<html>`, the pre-paint `themeInitScript` does the same, and `globals.css` declares
  `@custom-variant dark (&:is(.dark *))`. So a media query was the wrong tool: a user on a dark-OS
  machine who explicitly chose light mode still got the dark-mode text shades, and the reverse. All 21
  now use `dark:`. Verified in the compiled CSS rather than by reading the diff: a fresh build emits
  `:is(.dark *)` selectors for these utilities (50 of them) and no escaped media-variant class.
- **`--success` / `--warning` used as text, which fails AA.** `--success` reaches 2.76:1 and
  `--warning` 2.54:1 as small text — below even the 3:1 non-text threshold for an icon.
  `components/stat-card.tsx` painted its icon chip with the raw tokens, and `components/quiz-runner.tsx`
  used `text-success` on three text/icon sites. Both now use the text-safe pairs from
  `@/components/ui/tone`, which already documented the rule.
- **`WARNING_TEXT` added to `@/components/ui/tone`.** Only success had a constant, so warning call sites
  either inlined the pair or used the raw token and failed. The pair needs an explicit `dark:`
  counterpart because `--warning-foreground` is a solid-fill colour.

#### Documentation

- **Stale status lines corrected.** `plans/mockup-to-backend.md` and `plans/wave-2.md` both still read
  "plan, not started" although the work is done, and `wave-2.md` listed S9 as "pending" — with a note
  that its slice table is the plan as written, not the order things landed (S5 preceded S4).
- **`README.md` claimed `main` and `dev` both pointed at `12e45be` with a divergence count of 0.** They
  do not: `dev` is 114 commits ahead. Rewritten to describe the release line and to note that commit
  hashes inside these documents are historical records rather than current pointers.
- **The a11y audit overstated its outstanding P2 item.** It listed both `StudentAssessmentsView` and
  `TeacherSubmissionsManager` as still fetching on mount; the first was converted to server-seeded
  props during the Wave 1 port. Corrected, with the remaining one (`TeacherSubmissionsManager`) and why
  it is harder — it renders inside another component, so it needs a prop threaded through two levels
  rather than a page-level payload.
- **The parent plan's §6 risk table** marked its two open items resolved, with what actually happened:
  the similarity constraint was a **live defect** (reproduced, then fixed) rather than a theoretical
  one, and the index was added.
- **`/mockup` is now tagged `design-reference-v1`**, satisfying §8's "deleted or explicitly kept as a
  tagged design reference" literally rather than by convention. The tag names `ee08004`, the last
  commit that changed the tree.

### The grading-policy editor: logic extracted, and verified in a browser

The editor (`components/offering-grading-policy.tsx`) shipped without a test, because this
repository deliberately has no DOM environment. It writes a value that changes **every student's
final grade**, so leaving it unverified was the weakest part of the work.

#### Added

- **`lib/grading/policy-view.ts`** — the editor's pure logic, extracted so it is testable without a
  DOM, following the pattern the viewer pages already use (`lib/materials-view.ts`,
  `lib/planner-view.ts`, `lib/calendar-view.ts`, `lib/observability-view.ts`). The component now
  holds only rendering and the fetch.
- **`tests/grading-policy-view.test.ts`** — 29 cases. The load-bearing ones are the `null` cases:
  `minimumCatPercent: null` means "this course has no CAT gate", which is _different_ from a gate at
  zero, and forms are where meanings get flattened. A round trip that turned `null` into `0` would
  pass every type check and quietly change who may sit the final exam. Mutation-tested: sending a
  disabled gate's placeholder number fails 3 cases; loading a `null` gate as an enabled gate at zero
  fails 2.

#### Verified

- **The editor renders correctly**, confirmed in a browser as the teacher rather than inferred from
  tests. The configured offering shows `CAT 40% / FAT 60%`, the derived membership
  ("4 assessment(s) · Final: Linear models group project (derived from due dates)"), the advisory
  note, and all five verdicts — including the **em dash** for a student with nothing marked, which is
  the display half of the null-vs-zero rule. The unconfigured offering shows **both** callouts ("No
  policy stored yet" and "Not enough assessments").
- **Toggling the gate checkbox disables the minimum-CAT field**, and **wrote nothing** — the audit
  trail still holds exactly one `offering.grading_config.updated` row, from an earlier API test and
  not from the browser session. That is the Save button being the only write path, checked rather
  than assumed.

### The three audit follow-ups: similarity key, creator index, and the letters

#### Fixed

- **`SimilarityCheck` could store duplicate pairs.** The unique key led with a nullable
  `assessmentId` (`[assessmentId, codeTaskId, studentId, comparedStudentId]`), and Postgres treats
  NULLs as distinct in a unique index — so two identical rows for one student pair could both be
  inserted whenever `assessmentId` was null. **Reproduced against a real database before changing
  anything**, and `assessmentId: null` is reachable: `scanCohortSimilarityForTeacher` passes the
  value it was given. Every reader counts or ranks pairs, so a duplicate is double-counted in the
  similarity view and can appear twice in a teacher's queue. The parent plan had flagged this as
  "confirm before surfacing for real"; it was surfaced and never confirmed.
  `codeTaskId` is now **required** and the key is `[codeTaskId, studentId, comparedStudentId]`, so no
  nullable column remains in it and uniqueness holds unconditionally. `assessmentId` is kept as a
  denormalized convenience but removed from the key — it is fully determined by `codeTaskId`
  (`CodeTask.assessmentId` is `@unique`), so it added nothing and its nullability was the hole.
  Migration `20260917020000_similarity_check_unique_key` deletes rows with a null `codeTaskId` (no
  code path can produce one) and collapses duplicates to the most recently checked row; both are
  no-ops on this repository's databases and both operate on a recomputable analysis table.
- **`Assessment.createdById` had no index** while every teacher page load filters on it — in both
  the gradebook's assessment list and the calendar's event query — and the compound indexes lead with
  `offeringId`/`courseId`, so neither could serve a creator-scoped filter. Added in
  `20260917030000_assessment_creator_index`. The parent plan §6 listed this and said to add it when
  the port touched that path.
- **A course letter could still be produced for a single mark.** `courseLetter(pct)` applied course
  bands to one assessment's mark, and its only consumer was `GradeBadge`'s `showCourseLetter` prop —
  whose own docblock anticipated "the one call site that means it", which **never existed**. Both
  removed, so no surface can render an unjustified letter. The mark-distribution histograms keep
  their letters: they bin marks on the absolute scale and carry a visible note that a VIT letter is
  awarded for a course grand total, so the bin is labelled rather than misleading.

#### Documentation

- Four stale claims corrected: `grading-bands.ts` said the absolute scale fed the exported final
  grade (that letter was removed) and called the regime choice an open decision (`§3, D1` is
  resolved and `Course.category` exists); `gradebook.ts` referenced a `CourseCategory` field "the
  schema does not have" (it does); `cohort.ts`/`legacy.ts` named a `letterGrade` function that no
  longer exists; and `docs/features/analytics.md` gave the pass rate as `>= 60%` when the code uses
  VIT's 50 — the code had already recorded that 60 "appears in no VIT document". Dated plan sections
  are left as written.
- `docs/features/lms-export.md` now states plainly that the export carries **no letter**, and why.

### wave-4: admin surface, mock-layer scope, and the design-reference tree

Wave 4 closed the mockup-to-backend migration. It landed the admin surface on the shared shell, then
settled what happens to the mockup tree itself — the item the plan left as a decision.

#### Added

- **`tests/mock-layer-scope.test.ts`** — a source-level guard that `@/lib/mock` is imported only from
  the design-reference tree, that `components/shell/**` imports no mock _values_, and that the eight
  retired pre-design-system shell components stay deleted. It matches every way a module can reach
  another (static, `export … from`, side-effect, dynamic `import()`, `require()`) and normalises alias
  and relative specifiers, so `../../lib/mock` and `~/lib/mock` are caught while `@/lib/mockup-*` and
  `some-lib/mock` are not — verified by mutation against all twelve forms. It deliberately does not
  strip comments, because a line-based `//` strip truncates at the first `//` inside a string literal
  (a URL) and would hide an import sharing that line.
- **`TopBarNotification`** (`components/shell/top-bar.tsx`) — the view shape for the mockup's
  notification popover, declared locally instead of imported, because there is no `Notification` model.

#### Fixed

- **`/teacher` no longer fabricates a `0%` average.** `components/teacher-view.tsx` coerced a null
  assessment average to `0` (`assessmentAverage(...) ?? 0`), so an assessment with no published marks
  drew a bar indistinguishable from a cohort that genuinely averaged zero — and the chart's
  screen-reader description announced it as "0%". `assessmentAverage` returns `null` deliberately, and
  both sibling charts preserve it, so this was an outlier. Unmarked assessments are now omitted from
  the series. Found by an audit of all 29 app-scope routes against `mockup-to-backend.md` §8's "no page
  renders a number that nothing derives"; it was the only violation.
- **The chart series is now a tested pure function.** `assessmentsWithAverage` (`lib/analytics/legacy.ts`)
  is extracted from the component so the omission is testable, and
  `tests/analytics-assessments-with-average.test.ts` pins the contract — including that a _genuine_
  zero average is still charted, which is what makes the `?? 0` regression detectable. Mutation-tested:
  reintroducing `?? 0` in the helper fails four of the seven cases.
- **Four dead locals removed** — two unused imports and two unused test fixtures. All `no-unused-vars`
  warnings are gone.
- **Three hand-rolled date formatters removed, and every rendered date is UTC.** `lib/format.ts`
  documents the rule — an explicit `timeZone` on every format, because a `toLocaleString` without one
  renders differently on a UTC server and a non-UTC browser — and three sites violated it.
  `lib/gradebook.ts` and `components/teacher-submissions-manager.tsx` each had their own
  `formatDate`/`formatDateTime` duplicate without one; both are deleted and their callers use the
  shared helpers. `components/upcoming-events-panel.tsx` needed more: it read ISO instants with the
  **local** accessors, so the initial month and day grid resolved to the server's answer during SSR
  and the browser's after hydration. Its whole date model is now UTC.
  `tests/format-utc.test.ts` pins the rule, asserting both offset directions so it does not merely
  pass because CI is UTC; removing the `timeZone` options fails 4 of its 5 cases.
- **The assessment kind no longer mislabels real data.** `lib/gradebook.ts` declared its own
  `AssessmentType = "Quiz" | "Assignment"`, shadowing the Prisma enum of the same name, and the reader
  fed a five-value column through it — so the seed's `DESCRIPTIVE`, `CODE` and `GROUP_PROJECT`
  assessments all rendered as **"Assignment"** in the gradebook table and the submissions queue, while
  the submissions _table_ labelled the same data correctly from the Prisma enum. `lib/student-assessments.ts`
  and `lib/admin-db.ts` held second and third copies. All three are gone: the read path carries the
  Prisma enum and labels it through `ASSESSMENT_KIND_LABEL`. The four `as DbAssessmentType` casts went
  with them — they existed only to silence the mismatch. The **create** path keeps the API contract's
  two-kind vocabulary deliberately; widening it is a product decision, left open.
- **Correction, same change:** `AssessmentKind`'s values in `lib/student-assessments.ts` were the
  collapsed pair, so a student's assessment list could not distinguish a descriptive or code
  assessment from an assignment. The type filter also offered only Quiz and Assignment, which could
  not isolate kinds the list actually contains; it now offers every kind in the label map.

#### Changed

- **`TopBar` and `AppShell` take mockup data as props.** Both previously imported `MOCK_NOTIFICATIONS`
  and `MOCK_CURRENT_USER` (and `formatRelativeTime`) directly, so a shell component the real app
  renders depended on fixture data at module scope. The fixtures and their fixed clock now stay in
  `app/mockup/layout.tsx`, which formats each timestamp before passing it down. The notification
  affordance renders only in mockup scope _and_ only when notifications are supplied, so app scope has
  no path to fabricated data.
- **`lib/labels.ts` and `lib/teacher-submissions.ts` use the generated Prisma enums** in place of nine
  and two mock view unions. Each union was verified value-identical to its enum before the swap, so
  the label maps are unchanged; they were duplicates, not a separate vocabulary.
- **`MockupRole` is defined in `components/shell/nav-config.ts`** rather than imported from
  `lib/mock/types`. It is a navigation concept — it decides which nav sections exist.

#### Removed

- **Five components from the pre-design-system shell**: `role-page-shell`, `dashboard`,
  `dashboard-header`, `role-routes-menu`, `future-page-placeholder`. All were unreferenced once every
  page moved to `AppShell`; `dashboard-header` was the source of the stale role label ("Teacher view")
  that `/teacher` no longer renders.

#### Documentation

- **`docs/ui/design-system.md`** now describes the shipped state: the shell anatomy documents both
  mounts (`app/mockup/layout.tsx` and `app/(dashboard)/layout.tsx`) and the scope-dependent ids, and
  the "three placeholder stub pages" row is corrected — none remain.
- **`docs/README.md`** records Wave 3 (T1–T8) and Wave 4 (A1–A4) as complete, and documents why
  `/mockup` is retained and what keeping it required.

### Documentation

Final documentation refresh against the frozen post-Phase-4 tree (`dev` @ `12e45be`), which had
drifted repeatedly while agents were shipping.

- **Phase status corrected.** Phases 0–4 are now all recorded as complete, including Phase 4
  (demo course, unified grade store, legacy-store retirements, retention policy); there is no
  Phase 5. Shipped-feature tables now include the post-Phase-4 landings: schema unfreeze
  (`759333b`), security hardening (`7011bfa`), course-ratings restoration (`b6222c8`), the
  partial-update guard (`b225b39`), the unified grade store (`87f094e`), the demo course
  (`9b7340f`), legacy quiz retirement (`d353a53`), DeepSeek (`fe65e5a`), retention (`702ab25`),
  embeddings split (`aefe1c2`), short-answer partial credit (`5981203`), and the run-4
  grade-immutability fixes (`3992ce4`).
- **Stale claims removed**: a `docs/README.md` assertion that login rate limiting was not
  implemented (it shipped in `7011bfa`), "not started" phase statuses, schema-frozen workarounds
  the unfreeze replaced (quiz publish state, analytics thresholds, team-formation profiles, LTI
  persistence, per-assessment attempt cap), "short-answer partial credit unbuilt", an outdated
  lint-warning count (13 at `22f608b`; 9 at `12e45be`), and a broken README anchor in
  `docs/demo.md`.
- **Measured counts recorded**: 93 test files, 69 API route handlers, 6 migrations, 9 lint
  warnings, and `main` = `dev` = `12e45be`.
- **Known gaps rewritten** to record what is genuinely open rather than resolved: `AuditLog`
  `before`/`after` snapshots are retained in full (they can embed student text), retained free
  text that may quote a student (`Submission.feedback`, `GradeReview.notes`,
  `ContributionEvent.summary`), no "unpublish" endpoint or admin UI for the retention purge,
  `POST /api/quiz/grade` remaining a choice-only preview, a global rather than per-question
  short-answer similarity threshold, the residual prompt-hackability of LLM-graded text (the
  safeguard is the human review gate), `deepseek-flash` having no immutable snapshot, DeepSeek
  having no embeddings endpoint, per-process rate limiting and session-revalidation caches, and
  the calibration report being deferred. See [`docs/README.md`](docs/README.md).
- `tests/README.md` now describes the current 93-file suite (~35 database-backed) and the
  six-migration provisioning path.
- Point-in-time records (`docs/verification/*`, the `security-review.md` findings table,
  `a11y-perf-audit.md`) deliberately keep their historical commit hashes and warning counts so
  their evidence provenance stays intact; a status note was added to `security-review.md` rather
  than editing its findings.

## [0.1.0] - 2026-09-11

Phase 0 (foundations): make the repository buildable, reviewable, and secret-free before product
work. Not yet git-tagged; `package.json` declares `0.1.0`.

### Added

- **CI pipeline** (`.github/workflows/ci.yml`). Runs on every pull request and on pushes to both
  `main` and `dev`: `npm ci`, `prisma generate`, `prisma validate`, typecheck, lint, format check,
  `npm test` against a `pgvector/pgvector:pg16` service container (so migrations and the database-backed
  suite are exercised on every run), and build, on Node 24, with placeholder environment values and
  `LLM_PROVIDER=mock` so CI needs no secrets and no network. Concurrency cancels superseded runs.
- **ESLint flat config** (`eslint.config.mjs`). `eslint-config-next` core-web-vitals and typescript,
  with `eslint-config-prettier` last. `react-hooks/set-state-in-effect` is demoted to `warn` until
  Phase 2 replaces the legacy fetch-on-mount components.
- **Prettier** (`.prettierrc`, `.prettierignore`) and published formatting scripts.
- **Environment template** (`.env.example`).
- **Product spec** (`docs/product-spec.md`): the education half as the product, the BI / NL2SQL half
  cut, the end-to-end spine, per-feature acceptance criteria, and the non-negotiable product rules.
- **`zod`** as the intended single API contract.
- **npm scripts**: `typecheck`, `lint`, `format`, `format:check`, `verify`, `prisma:generate`,
  `prisma:migrate`, `prisma:seed`.
- **Archive tag** `legacy-archive-v1` on the pre-rebuild baseline (see below).

### Changed

- Standardized on npm with a committed `package-lock.json`.
- `app/(dashboard)/admin/{page,data,offerings,users}/page.tsx` marked `force-dynamic` so the
  production build does not require a live database.

### Fixed

- `fix(ui): mocked filter selects showed raw values instead of labels` — Base UI's `Select.Value`
  renders the raw value unless the root receives the value→label map, so every list page's filters
  displayed `asm_descriptive`, `open`, `below-floor`. Fixed once in `FilterBar` (covering all 13
  list pages) rather than per page, and in the two standalone auth role selects.
- `fix(ui): mockup fixtures that contradicted the page rendering them` — `/mockup/teacher/code-tasks`
  printed "5741%" and "8067%" for averages whose callers had already converted to percentages
  (`mean()` scaled by 100 twice); the teacher dashboard's "Awaiting review 5" sat beside the hint
  "6 descriptive · 3 other"; `/mockup/student/quizzes` listed a **draft** question among released
  results, with its answer key, while item analysis reported that question as never administered;
  `/mockup/teacher/activity` said "No overrides recorded" beside an audit entry recording one; and
  every review-queue row read "No group". Each value is now derived from its own fixtures rather
  than typed in twice.
- `fix(ui): FilterBar pluralised the whole noun phrase` — the result count appended `"s"` to the
  entire `resultNoun`, so the reviews queue rendered "9 item in the queues". A new optional
  `resultNounPlural` prop supplies the plural for multi-word nouns (single-word callers are
  unchanged and it defaults to `${resultNoun}s`); this also fixed "8 entrys" → "8 entries" and a
  duplicated "grading rubric rubric" on the assignments page.
- `fix(ui): ui/chart.tsx formatted numbers in the runtime locale` — `toLocaleString()` with no
  argument resolves to the server's locale on the server and the browser's on the client, a
  hydration-mismatch risk of the same class already fixed in the student views. Now uses a hoisted
  `Intl.NumberFormat("en-US")`, and a repo-wide sweep for unlocalised `toLocale*` calls returns zero.
- `fix(ci): align hono lockfile entry with the npm override` — the `hono` override lived in a
  pnpm-only block that npm ignores, so the lockfile resolved `hono@4.13.0` while `package.json`
  required `4.12.25`, which `npm ci` rejects. The lockfile was regenerated so both agree.
- `fix(build): force dynamic rendering for admin dashboards` — the admin pages ran Prisma queries at
  page scope, so Next tried to statically prerender them and the build failed with `ECONNREFUSED`.
- Removed real React 19 violations surfaced by the new lint config: synchronous `setState` in mount
  effects, and a selected course that was synced via effect instead of being derived.

### Removed

- `pnpm-lock.yaml` and the `pnpm.overrides` block.
- `typescript.ignoreBuildErrors` from `next.config.mjs`; `tsc --noEmit` is now the real contract.

## [legacy-archive-v1] - 2026-09-11

### Added

- Archived the entire pre-rebuild application as the initial commit (`82a48fc`, 208 files, 33,866
  insertions) and tagged it `legacy-archive-v1`. This is the behavioural reference that Phase 4
  retires and deletes.

### Notes

- The baseline `.gitignore` already ignored `.env` and `pass` before product work began. Neither has
  ever been committed to this repository.
