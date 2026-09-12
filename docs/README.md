# Project documentation

An LLM-assisted assessment platform in which teachers keep final grading authority, grading is
server-authoritative, and group projects receive fair per-student assessment.

This directory is the documentation index for the greenfield rebuild. The status below reflects
`dev` at commit `8f00a5f` (`fix(instrumentation): stop bundling Node-only code into the Edge
runtime`), where all of Phases 0–3 have landed.

## Start here

- [`product-spec.md`](./product-spec.md) — the product scope and acceptance criteria. If a feature
  is not in the spec, it is not in the product.
- [`development-workflow.md`](./development-workflow.md) — the branch model, the phase-gated merge
  flow, the Definition of Done, CI gates, commit conventions, and the local verification commands.
- [`llm-providers.md`](./llm-providers.md) — how to select a provider, the DeepSeek
  configuration, the cost/latency trade-off, and how model provenance is recorded on AI grades.

## Phase documents

| Phase | Document                                                             | Status      |
| ----- | -------------------------------------------------------------------- | ----------- |
| 0     | [`phases/phase-0-foundations.md`](./phases/phase-0-foundations.md)   | Complete    |
| 1     | [`phases/phase-1-contracts.md`](./phases/phase-1-contracts.md)       | Complete    |
| 2     | [`phases/phase-2-feature-pods.md`](./phases/phase-2-feature-pods.md) | Complete    |
| 3     | [`phases/phase-3-hardening.md`](./phases/phase-3-hardening.md)       | Complete    |
| 4     | [`phases/phase-4-cutover.md`](./phases/phase-4-cutover.md)           | Not started |

Phase 3's three hardening pods (security review, accessibility and performance, observability) are
complete. The human-labeled grading-agreement report that `phase-3-hardening.md` also lists as a
deliverable is **not** shipped; see [Known gaps and open decisions](#known-gaps-and-open-decisions).

## Shipped feature pods

Ten pods are implemented and merged to `dev`. Commit hashes are the landing commits from
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

## Repository at a glance

Measured on `dev` at `8f00a5f`.

| Metric                | Value  | Measurement                                         |
| --------------------- | ------ | --------------------------------------------------- |
| Test files            | 65     | `ls tests/*.test.ts` (count)                        |
| API route handlers    | 64     | `app/api/**/route.ts` (count)                       |
| Phase 2 pods shipped  | 7      | Merged on `dev`                                     |
| Phase 3 pods shipped  | 3      | Merged on `dev`                                     |
| Repository visibility | public | `gh api repos/arockiasachin/ai-assessment-platform` |
| Default branch        | `main` | `gh api repos/arockiasachin/ai-assessment-platform` |

## Branch protection and CI

Branch protection is enabled on both long-lived branches (verified with
`gh api repos/arockiasachin/ai-assessment-platform/branches/<branch>/protection`):

- **`main`** — required status check: `Verify`. Zero required approving reviews
  (`required_approving_review_count: 0`); `enforce_admins: false`. `main` receives only
  phase-boundary merges and is currently at `22f608b` (the Phase 1 boundary).
- **`dev`** — required status check: `Verify` only (no required pull-request reviews;
  `enforce_admins: false`). The integration branch; Phase 2 and Phase 3 landed here.

`dev` is the default place for work. `main` lags: `git rev-list --count main..dev` is **36** and
`git rev-list --count origin/main..dev` is **40** (the remote `main` is four commits behind the
local `main`, which carries the four Phase 1 commits that were never pushed).

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
  analytics, LMS export). Each ships behind the Phase 1 `zod` contract with route/service tests; the
  per-pod schema workarounds are collected under [Known gaps](#known-gaps-and-open-decisions).
- **Phase 3, hardening — complete.** The security review, the accessibility and performance audit,
  and the observability instrumentation are merged. The security review left four items as
  SUSPECTED or product decisions, and the human-labeled grading-agreement report is not shipped;
  both are recorded under [Known gaps](#known-gaps-and-open-decisions).
- **Phase 4, cutover — not started.** A seeded demo course exercising the whole spine, then the
  legacy tree is retired.

## Known gaps and open decisions

These are reported, not hidden. Each item links to the source that documents it.

### Schema was frozen; six features worked around it (now unfrozen)

`prisma/schema.prisma` and `prisma/migrations/**` were not changed by the Phase 2/3 pods, so six
features needed a field the schema does not have and stored the state elsewhere. The
`p4/schema-unfreeze` branch adds a single migration
(`20260912000000_schema_unfreeze`) that gives each of the six a real column/model and drops seven
dead models; see [`schema/unfreeze.md`](./schema/unfreeze.md). The table below records the
workarounds that the migration replaced and how each is now handled.

| Feature                                    | Workaround                                                                                                 | Migration outcome                                                           | Source                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Team-formation attributes and availability | Supplied per run in the request body; only formation provenance is persisted in `Group.metadata.formation` | `StudentProfile.formationProfile` JSON; request `students` is an override   | [`features/groups-peereval.md`](./features/groups-peereval.md)         |
| Analytics alert thresholds                 | Query params per request; defaults in `DEFAULT_INTERVENTION_THRESHOLDS`                                    | `CourseOffering.analyticsSettings` JSON (code default ← stored ← override)  | [`features/analytics.md`](./features/analytics.md)                     |
| Quiz draft/published state                 | `Question.metadata.generationStatus` envelope                                                              | `Question.status` / `publishedAt` / `publishedById`; legacy JSON still read | [`features/quiz-generation.md`](./features/quiz-generation.md)         |
| Grading suggestion dedupe ordering         | `latestSuggestionTotals` orders only by `createdAt`; two same-millisecond suggestions for one bucket tie   | `AIGradeSuggestion.seq` (monotonic serial) is the ordering key              | [`verification/bugfix-run-1.md`](./verification/bugfix-run-1.md) (S-5) |
| LTI registration and user mapping          | Registration read from env vars; the platform `userId` is supplied per request                             | `LtiRegistration` + `LtiUserMapping`; request map is an override            | [`features/lms-export.md`](./features/lms-export.md)                   |
| Per-assessment quiz attempt cap            | Server constant (`DEFAULT_MAX_ATTEMPTS` = 3) plus `QUIZ_MAX_ATTEMPTS`                                      | `Assessment.maxAttempts` (column → env → 3)                                 | [`features/quiz-grading.md`](./features/quiz-grading.md)               |

### Grade store unified

The legacy `AssessmentGrade` model has been **retired** (table dropped by migration
`20260912020000_retire_assessment_grade`). A teacher's manual mark now publishes into the modern
`Grade` with an `AuditLog` row; every reader — the gradebook payload, student assessments,
submission grading, group-grade resolution, LMS export, and the admin explorer — reads the modern
store. See [`verification/grade-store-unification.md`](./verification/grade-store-unification.md).

### Security review — SUSPECTED and decisions (not fixed)

The Phase 3 review left four items deliberately unfixed. See
[`security/security-review.md`](./security/security-review.md) for evidence and rationale.

- **S-1, medium — no login rate limiting.** `POST /api/auth/login` has no lockout, so bcrypt
  guessing is unbounded. A meaningful fix needs shared state or edge middleware.
- **S-2, medium — session role staleness.** A signed session carries the role for up to 7 days with
  no database re-validation, so a demoted or deleted user keeps the old role until expiry
  (`/api/auth/seed` re-checks; other admin routes do not).
- **S-4, low — in-process `unit` code execution.** The demonstrated sandbox forgeries are closed,
  but restoring intrinsics is an arms race; running `unit` execution out-of-process would fully
  close it. That changes a documented sandbox behaviour and was left as a decision.
- **S-5, low — container cleanup.** The final `docker rm -f` depends on the Docker daemon being
  reachable; if it dies mid-request a container can leak. An orphan reaper is operational tooling.

### Preserved, deliberately unmerged quiz generation

A second, duplicate implementation of LLM quiz generation exists on the preserved branch
`feat/quiz-generation` at commit `67809f7` (`feat(quiz-generation): material-grounded drafts with
review and publish`, worktree `/Users/slade/Documents/Learning/GH/ad-wt/quiz-generation`). It was
deliberately **not** merged; the shipped implementation is the one landed in `25e47ed`.

### Deferred accessibility/performance follow-up

The a11y and performance audit deferred server-seeding the dashboard data: `GradebookProvider`
(mounted in `app/layout.tsx`) and two large views still fetch in a client `useEffect` on mount
instead of receiving server-fetched props. See
[`quality/a11y-perf-audit.md`](./quality/a11y-perf-audit.md) (P1/P2).

### End-to-end proof on one real course is Phase 4 work

`phase-2-feature-pods.md`'s goal says Phase 2 is not complete until the whole path works for one
real course. Each pod is merged with its own route/service tests, but the single seeded demo-course
run that proves the spine end to end is the Phase 4 deliverable
([`phases/phase-4-cutover.md`](./phases/phase-4-cutover.md)) and is not shipped. The Phase 2
"Complete" status above means merge-and-test completion, not an end-to-end course run.

### Grading-agreement report not shipped

`phase-3-hardening.md` lists a human-labeled grading-agreement report as a Phase 3 deliverable. No
such report exists in the repository and no agreement number should be quoted. The offline mock
provider and the per-pod test suites exercise the pipeline but do not measure grading quality.
