# Project documentation

An LLM-assisted assessment platform in which teachers keep final grading authority, grading is
server-authoritative, and group projects receive fair per-student assessment.

This directory is the documentation index for the greenfield rebuild. The status below reflects
`dev` at commit `12e45be` (`Merge branch 'p4/verify-unified' into dev`), where all of Phases 0–4 have
landed. Local `main`, `dev`, `origin/main` and `origin/dev` all point at `12e45be`; `git rev-list
--count main..dev` and `git rev-list --count origin/main..dev` are both **0**. There is no Phase 5 in
the plan or the repository.

## Start here

- [`product-spec.md`](./product-spec.md) — the product scope and acceptance criteria. If a feature
  is not in the spec, it is not in the product.
- [`development-workflow.md`](./development-workflow.md) — the branch model, the phase-gated merge
  flow, the Definition of Done, CI gates, commit conventions, and the local verification commands.
- [`llm-providers.md`](./llm-providers.md) — how to select a provider, the DeepSeek
  configuration, the cost/latency trade-off, and how model provenance is recorded on AI grades.
- [`privacy/retention-policy.md`](./privacy/retention-policy.md) — the student-work retention
  policy, the results-published anchor, and the entity-by-entity disposition.
- [`security/hardening.md`](./security/hardening.md) — the Phase 4 work that closed the Phase 3
  security decisions (login rate limiting, session role re-validation, out-of-process `unit`).

## Phase documents

| Phase | Document                                                             | Status   |
| ----- | -------------------------------------------------------------------- | -------- |
| 0     | [`phases/phase-0-foundations.md`](./phases/phase-0-foundations.md)   | Complete |
| 1     | [`phases/phase-1-contracts.md`](./phases/phase-1-contracts.md)       | Complete |
| 2     | [`phases/phase-2-feature-pods.md`](./phases/phase-2-feature-pods.md) | Complete |
| 3     | [`phases/phase-3-hardening.md`](./phases/phase-3-hardening.md)       | Complete |
| 4     | [`phases/phase-4-cutover.md`](./phases/phase-4-cutover.md)           | Complete |

Phase 3's three hardening pods (security review, accessibility and performance, observability) are
complete, and the Phase 3 security decisions the review left open were closed in Phase 4
([`security/hardening.md`](./security/hardening.md)). The human-labeled grading-agreement report
that `phase-3-hardening.md` also lists as a deliverable was **never built**; see
[Known gaps and open decisions](#known-gaps-and-open-decisions).

Phase 4 delivered the seeded demo course (`9b7340f`), the schema unfreeze (`759333b`), the security
hardening that closed the Phase 3 decisions (`7011bfa`), course-ratings restoration (`b6222c8`), the
centralised partial-update guard (`b225b39`), the unified grade store (`87f094e`, `AssessmentGrade`
retired), the legacy quiz retirement (`d353a53`, `Quiz`/`QuizQuestion` retired), the DeepSeek
provider (`fe65e5a`) with a decoupled embeddings provider (`aefe1c2`), the student-work retention
policy (`702ab25`), short-answer partial credit (`5981203`), and the grade-immutability fixes from
bug-fix run 4 (`3992ce4`, merged `83dbbe9`).

## Forward plan

Phase 4 ends the phased plan; no Phase 5 is defined. The next body of work is connecting the UI
mockups to the backend that already exists behind them:

- [`plans/mockup-to-backend.md`](./plans/mockup-to-backend.md) — the strategy (port the mockup
  _presentation_ onto the existing real pages, rather than wiring `/mockup` itself to data), the
  component seam, five sequenced waves, the fixture fields that have no schema backing and each
  need a decision, and the risks. Written against `dev` @ `2bc51b5`.
- [`plans/wave-1.md`](./plans/wave-1.md) — the Wave 1 research: field-by-field port dossiers for all
  twelve remaining pages, the nine decisions that gate them, cross-cutting prerequisites, and two
  corrections to the parent plan (`teacher/classes` is a different screen, not a re-skin, and
  `teacher/submissions` has no real page at all — since resolved: it is now a read-only queue, see
  §D2).

## Shipped feature pods

Ten Phase 2/3 pods are implemented and merged to `dev`. Commit hashes are the landing commits from
`git log --oneline dev`.

| #   | Pod                                                | Phase | Landed in                   | Feature doc                                                    |
| --- | -------------------------------------------------- | ----- | --------------------------- | -------------------------------------------------------------- |
| 1   | LLM quiz generation                                | 2     | `25e47ed`                   | [`features/quiz-generation.md`](./features/quiz-generation.md) |
| 2   | Quiz attempt persistence and grading               | 2     | `a21ee3b`                   | [`features/quiz-grading.md`](./features/quiz-grading.md)       |
| 3   | Rubric grading                                     | 2     | `d5f949b`                   | [`features/rubric-grading.md`](./features/rubric-grading.md)   |
| 4   | Sandboxed code and debugging evaluation            | 2     | `cfad031` (fix `eb73b68`)   | [`features/code-eval.md`](./features/code-eval.md)             |
| 5   | Groups, peer evaluation, contributions, milestones | 2     | `675dfa0`                   | [`features/groups-peereval.md`](./features/groups-peereval.md) |
| 6   | Analytics, item analysis, alerts, adaptive retake  | 2     | `6ffff60`                   | [`features/analytics.md`](./features/analytics.md)             |
| 7   | Weighted final grades and LMS export               | 2     | `9117b2e`                   | [`features/lms-export.md`](./features/lms-export.md)           |
| 8   | Observability                                      | 3     | `af4ce83` (merge `ac2c911`) | [`observability.md`](./observability.md)                       |
| 9   | Security review and hardening                      | 3     | `7360b16` (merge `ddbb30f`) | [`security/security-review.md`](./security/security-review.md) |
| 10  | Accessibility and performance                      | 3     | `ebeaa1a` (merge `0e04764`) | [`quality/a11y-perf-audit.md`](./quality/a11y-perf-audit.md)   |

Phase 4 then landed the cutover work. These are the Phase 4 landings, in landing order:

| Work                                                        | Landed in | Feature doc / source                                                                   |
| ----------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------- |
| Security hardening (Phase 3 decisions S-1, S-2, S-4 closed) | `7011bfa` | [`security/hardening.md`](./security/hardening.md)                                     |
| Schema unfreeze (six columns, seven dead models dropped)    | `759333b` | [`schema/unfreeze.md`](./schema/unfreeze.md)                                           |
| Restore course ratings                                      | `b6222c8` | [`features/course-ratings.md`](./features/course-ratings.md)                           |
| Centralised partial-update guard                            | `b225b39` | [`engineering/partial-update-guide.md`](./engineering/partial-update-guide.md)         |
| Unified grade store (`AssessmentGrade` retired)             | `87f094e` | [`verification/grade-store-unification.md`](./verification/grade-store-unification.md) |
| Seeded demo course                                          | `9b7340f` | [`demo.md`](./demo.md)                                                                 |
| Legacy quiz retirement (`Quiz`/`QuizQuestion` retired)      | `d353a53` | [`verification/legacy-quiz-retirement.md`](./verification/legacy-quiz-retirement.md)   |
| DeepSeek provider                                           | `fe65e5a` | [`llm-providers.md`](./llm-providers.md)                                               |
| Student-work retention policy                               | `702ab25` | [`privacy/retention-policy.md`](./privacy/retention-policy.md)                         |
| Embeddings provider decoupled from chat                     | `aefe1c2` | [`llm-providers.md`](./llm-providers.md#split-providers-chat-and-embeddings)           |
| Short-answer partial credit                                 | `5981203` | [`features/short-answer-partial-credit.md`](./features/short-answer-partial-credit.md) |
| Grade immutability fixes (bug-fix run 4)                    | `3992ce4` | [`verification/bugfix-run-4.md`](./verification/bugfix-run-4.md)                       |

## Repository at a glance

Measured on `dev` at `12e45be`.

| Metric                | Value  | Measurement                                               |
| --------------------- | ------ | --------------------------------------------------------- |
| Test files            | 93     | `ls tests/*.test.ts` (count)                              |
| API route handlers    | 69     | `find app/api -name route.ts` (count)                     |
| Prisma migrations     | 6      | `ls prisma/migrations/` (excluding `migration_lock.toml`) |
| Phase 2 pods shipped  | 7      | Merged on `dev`                                           |
| Phase 3 pods shipped  | 3      | Merged on `dev`                                           |
| Repository visibility | public | `gh api repos/arockiasachin/ai-assessment-platform`       |
| Default branch        | `main` | `gh api repos/arockiasachin/ai-assessment-platform`       |

## Branch protection and CI

Branch protection is enabled on both long-lived branches (verified 2026-09-12 with
`gh api repos/arockiasachin/ai-assessment-platform/branches/<branch>/protection`):

- **`main`** — required status check: `Verify`. Zero required approving reviews
  (`required_approving_review_count: 0`); `enforce_admins: false`.
- **`dev`** — required status check: `Verify` only (no required pull-request reviews;
  `enforce_admins: false`).

`main` and `dev` both point at `12e45be`; `git rev-list --count main..dev` is **0** and
`git rev-list --count origin/main..dev` is **0**. The Phase 1–4 boundary merges are all on both
branches. The no-direct-pushes-to-`main` rule remains a convention for administrators rather than an
absolute GitHub block, because `enforce_admins` is `false`.

CI ([`../.github/workflows/ci.yml`](../.github/workflows/ci.yml)) runs on every pull request and on
pushes to **both** `main` and `dev`. The `Verify` job installs dependencies, generates and validates
the Prisma client, typechecks, lints, checks formatting, runs `npm test` against a
`pgvector/pgvector:pg16` service container, and builds. `npm test` provisions its own database by
applying the committed migrations, so CI also proves the migration history still builds the schema
from empty. See [`development-workflow.md`](./development-workflow.md#ci-gates).

## Changelog

[`../CHANGELOG.md`](../CHANGELOG.md) records what actually landed, in Keep a Changelog format.

## Status at a glance

- **Phase 0, foundations — complete.** Git repository and GitHub remote, secret hygiene, the CI
  pipeline, ESLint flat config and Prettier, removal of `typescript.ignoreBuildErrors`, `zod`,
  `.env.example`, and `docs/product-spec.md`. Two build-breaking defects were caught by CI and
  fixed (the `hono` lockfile/override mismatch and admin pages that needed `force-dynamic`).
- **Phase 1, contracts — complete.** The additive Prisma assessment spine, the baseline migration
  with the `pgvector` extension and an HNSW cosine index, the pluggable LLM adapter with a
  deterministic mock provider, the pgvector chunk/embed/search module, the Vitest harness, signed
  sessions with `requireRole` authorization, the `zod` API contract, and the grade review state
  machine. The legacy quiz path was moved server-authoritative so no answer key reaches the client.
- **Phase 2, feature pods — complete.** All seven pods are implemented and merged (quiz generation,
  quiz attempt persistence and grading, rubric grading, code sandbox, groups and peer evaluation,
  analytics, LMS export). Each ships behind the Phase 1 `zod` contract with route/service tests.
  Short-answer partial credit, which Phase 1 and this phase left to a later item, shipped in Phase 4
  (`5981203`).
- **Phase 3, hardening — complete.** The security review, the accessibility and performance audit,
  and the observability instrumentation are merged. The security review left three decisions open
  (S-1, S-2, S-4) and one operational item (S-5); Phase 4 closed the three decisions, and S-5 is
  an operational orphan-reaper concern. The human-labeled grading-agreement report was never built.
  See [Known gaps](#known-gaps-and-open-decisions).
- **Phase 4, cutover — complete.** The schema was unfrozen (`759333b`), seven dead models were
  dropped, the Phase 3 security decisions were closed (`7011bfa`), course ratings were restored
  (`b6222c8`), the grade stores were unified and `AssessmentGrade` retired (`87f094e`), a whole-spine
  demo course was seeded and proven end to end (`9b7340f`), the legacy `Quiz`/`QuizQuestion` store
  was retired (`d353a53`), DeepSeek became a first-class provider (`fe65e5a`) with a decoupled
  embeddings provider (`aefe1c2`), the student-work retention policy shipped (`702ab25`),
  short-answer partial credit shipped (`5981203`), and the grade-immutability defects found by
  bug-fix run 4 were fixed (`3992ce4`).

## Known gaps and open decisions

These are reported, not hidden. Each item links to the source that documents it.

### The schema was unfrozen; the workarounds were replaced

`prisma/schema.prisma` and `prisma/migrations/**` were frozen from Phase 1 through Phase 3, so six
features needed a field the schema did not have and stored the state elsewhere. Migration
`20260912000000_schema_unfreeze` (landed `759333b`) gave each of the six a real column/model and
dropped seven dead models; see [`schema/unfreeze.md`](./schema/unfreeze.md). The table below records
the workarounds that the migration replaced and how each is handled now.

| Feature                                    | Workaround                                                                                                 | Migration outcome                                                           | Source                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Team-formation attributes and availability | Supplied per run in the request body; only formation provenance is persisted in `Group.metadata.formation` | `StudentProfile.formationProfile` JSON; request `students` is an override   | [`features/groups-peereval.md`](./features/groups-peereval.md)         |
| Analytics alert thresholds                 | Query params per request; defaults in `DEFAULT_INTERVENTION_THRESHOLDS`                                    | `CourseOffering.analyticsSettings` JSON (code default ← stored ← override)  | [`features/analytics.md`](./features/analytics.md)                     |
| Quiz draft/published state                 | `Question.metadata.generationStatus` envelope                                                              | `Question.status` / `publishedAt` / `publishedById`; legacy JSON still read | [`features/quiz-generation.md`](./features/quiz-generation.md)         |
| Grading suggestion dedupe ordering         | `latestSuggestionTotals` orders only by `createdAt`; two same-millisecond suggestions for one bucket tie   | `AIGradeSuggestion.seq` (monotonic serial) is the ordering key              | [`verification/bugfix-run-1.md`](./verification/bugfix-run-1.md) (S-5) |
| LTI registration and user mapping          | Registration read from env vars; the platform `userId` is supplied per request                             | `LtiRegistration` + `LtiUserMapping`; request map is an override            | [`features/lms-export.md`](./features/lms-export.md)                   |
| Per-assessment quiz attempt cap            | Server constant (`DEFAULT_MAX_ATTEMPTS` = 3) plus `QUIZ_MAX_ATTEMPTS`                                      | `Assessment.maxAttempts` (column → env → 3)                                 | [`features/quiz-grading.md`](./features/quiz-grading.md)               |

### Grade store unified, then the legacy quiz store retired

Two duplicate stores were retired in Phase 4:

- The legacy `AssessmentGrade` model was **retired** (table dropped by migration
  `20260912020000_retire_assessment_grade`). A teacher's manual mark now publishes into the modern
  `Grade` with an `AuditLog` row; every reader — the gradebook payload, student assessments,
  submission grading, group-grade resolution, LMS export, and the admin explorer — reads the modern
  store. See [`verification/grade-store-unification.md`](./verification/grade-store-unification.md).
- The legacy `Quiz`/`QuizQuestion` models were **retired** (tables dropped by migration
  `20260912030000_retire_quiz`). The JSON importer writes published `Question`/`QuestionOption`
  rows, and the import now requires an ownership-checked `offeringId`. See
  [`verification/legacy-quiz-retirement.md`](./verification/legacy-quiz-retirement.md).

`CourseRating` was dropped by the schema unfreeze and then deliberately restored in
`20260912010000_restore_course_rating`; see [`features/course-ratings.md`](./features/course-ratings.md).

### Security review — the Phase 3 decisions are closed

The Phase 3 review left three decisions open and one operational item; Phase 4 closed the three
decisions in `7011bfa` ([`security/hardening.md`](./security/hardening.md)):

- **S-1, login rate limiting — fixed.** `lib/login-rate-limit.ts` throttles `POST /api/auth/login`
  on a sliding window over the normalized identifier and the client IP, with `429` + `Retry-After`
  and non-enumerating responses.
- **S-2, session role staleness — fixed.** `lib/authz-actor.ts` + `lib/authz.ts` re-validate the
  actor against the database in `requireRole`/`requireUser`, with a short-lived cache.
- **S-4, in-process `unit` code execution — fixed.** The `unit` harness now runs the student module
  in a fresh child interpreter and owns the result framing, so the demonstrated container-stdout
  forgeries cannot alter the result set.
- **S-5, container cleanup — open, operational.** The final `docker rm -f` depends on the Docker
  daemon being reachable; if it dies mid-request a container can leak. An orphan reaper is
  operational tooling, not shipped code.

The CONFIRMED findings from the Phase 3 review (SEC-1 harness integrity, SEC-2 submission-cap race,
SEC-3 enrollment-cap race) were fixed in Phase 3 and were not re-audited.

### Retention — deliberate retention and reversible decisions

The retention policy ([`privacy/retention-policy.md`](./privacy/retention-policy.md)) is redact-only
and never deletes a row. What remains:

- **`AuditLog.before`/`after` snapshots are retained in full.** The policy never deletes or mutates
  audit rows, but those snapshots can embed student text (for example a grade or suggestion
  snapshot). Redacting inside an append-only audit row would weaken the evidence trail, so it is
  left as a noted residual risk for a human decision.
- **Retained free text that could quote a student.** `Submission.feedback`, `GradeReview.notes`,
  and `ContributionEvent.summary` are deliberately retained. Each is a documented, reversible call:
  adding the field to the redaction in `purgeOffering` and its tests is the change.
- **No "unpublish" endpoint and no admin UI for the retention purge.** Publication is one-way by
  design; the purge is available only as the guarded HTTP route
  (`POST /api/admin/retention/purge`) and the `npm run retention:purge` script.

### Grading quality and validation gaps

- **The grading-agreement / calibration-metrics report (a Phase 3 deliverable) was never built.**
  Human-labeled inter-rater agreement is not measured. No agreement number exists and none should
  be quoted; the offline mock provider and the per-pod test suites exercise the pipeline but do not
  measure grading quality.
- **Prompt-hackability on LLM-graded text is mitigated, not eliminated.** The answer is never
  trusted for correctness, an injection heuristic caps a suspicious response at its lexical
  similarity and drops its confidence, and nothing publishes without a teacher. The platform's
  safeguard is the human review gate, not a proof of model correctness.
- **The short-answer similarity threshold is global, not per-question.** It is
  `QUIZ_TEXT_SIMILARITY_THRESHOLD` (default `0.35`); a per-question override would need a schema
  column that does not exist. See [`features/short-answer-partial-credit.md`](./features/short-answer-partial-credit.md).

### Provider and multi-instance constraints

- **`deepseek-flash` has no immutable snapshot**, so a grade cannot be tied to an exact model build.
  The response `id` and provider-supplied `system_fingerprint` are retained in
  `AIGradeSuggestion.rawResponse` for contestability, but the fingerprint is a claim, not a
  guarantee. See [`llm-providers.md`](./llm-providers.md#provenance-deepseek-flash-is-a-moving-target).
- **DeepSeek has no embeddings endpoint**, so `EMBEDDINGS_PROVIDER` must differ from `LLM_PROVIDER`
  when using it; material indexing and retrieval need a provider that supports embeddings. See
  [`llm-providers.md`](./llm-providers.md#split-providers-chat-and-embeddings).
- **Multi-instance deployments need shared state.** The login rate limiter
  (`lib/login-rate-limit.ts`) and the session re-validation cache (`lib/authz-actor.ts`) are
  per-process. `next start` is a single process, so they are real mitigations there; a multi-instance
  or serverless deployment needs shared state (for example Redis or Postgres).

### Two quiz graders still exist, one of them transient

`createQuizFromImportForSessionUser` was fixed to write the modern `Question`/`QuestionOption` store,
so imported quizzes are delivered and scored by the student attempt pipeline. `POST /api/quiz/grade`
remains a second, transient grader that persists nothing, is choice-only (a text question there is
rejected with `409`), and is not a publishing path. The supported path is the student attempt
pipeline. See [`verification/bugfix-run-4.md`](./verification/bugfix-run-4.md) (S-3).

### Preserved, deliberately unmerged quiz generation

A second, duplicate implementation of LLM quiz generation is preserved on the annotated tag
`archive/quiz-generation-duplicate` at commit
`67809f7f93ad48d72d0b738aa3b7bf6ad88bcc4b` (`feat(quiz-generation): material-grounded drafts with
review and publish`). It was deliberately **not** merged; the shipped implementation is the one
landed in `25e47ed`. See [`archive/duplicate-quiz-generation.md`](./archive/duplicate-quiz-generation.md).

### Deferred accessibility/performance follow-up

The a11y and performance audit deferred server-seeding the dashboard data: `GradebookProvider`
(mounted in `app/layout.tsx`) and two large views still fetch in a client `useEffect` on mount
instead of receiving server-fetched props. The lint warning count at the frozen tip (`12e45be`) is
**9 warnings, 0 errors** (measured with `npm run lint`); these fetch-on-mount effects plus two
deliberate `window.location` assignments account for the residual warnings. See
[`quality/a11y-perf-audit.md`](./quality/a11y-perf-audit.md) (P1/P2).

### The demo course is composability evidence, not scale evidence

The seeded demo course ([`demo.md`](./demo.md)) proves the whole spine runs end to end on one
course with a five-student cohort and the offline mock provider. It does not prove scale, latency,
or grading quality. There is no Phase 5 roadmap defined in the plan or the repository, so none is
invented here.
