# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The project is pre-1.0
(`package.json` is at `0.1.0`); until it reaches 1.0.0, minor versions may include breaking changes.

Entries below are derived from the actual git history. No git tags carry a SemVer version yet: the
only tag is `legacy-archive-v1` at commit `82a48fc`, which is documented as its own non-versioned
section.

## [Unreleased]

Phase 1 (contracts), Phase 2 (feature pods) and Phase 3 (hardening) are complete and landed on
`dev`. Phase 2 delivered seven feature pods (quiz generation, quiz attempt persistence, rubric
grading, sandboxed code evaluation, groups/peer evaluation, analytics, LMS export) and Phase 3
delivered three hardening pods (security review, accessibility/performance, observability). Phases 0
through 3 are merged; Phase 4 (cutover) has not started. Nothing below is released — `package.json`
is still `0.1.0`.

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
