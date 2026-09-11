# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The project is pre-1.0
(`package.json` is at `0.1.0`); until it reaches 1.0.0, minor versions may include breaking changes.

Entries below are derived from the actual git history. No git tags carry a SemVer version yet: the
only tag is `legacy-archive-v1` at commit `82a48fc`, which is documented as its own non-versioned
section.

## [Unreleased]

Phase 1 (contracts) is in progress. The schema, migration, LLM adapter, and retrieval module are
landed on `dev`; auth and session hardening and the `zod` API contract with the grade review state
machine are not yet landed, and the test harness is being landed concurrently but is uncommitted.
Nothing below is released.

### Added

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
- **Phase 1 migration** (`prisma/migrations/20260911140500_phase1_assessment_spine/migration.sql`).
  Creates the new tables and enums, runs `CREATE EXTENSION IF NOT EXISTS vector`, and adds
  `MaterialChunk_embedding_hnsw_idx`, an HNSW index using `vector_cosine_ops`.
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

- `lib/admin-db.ts`: widened `DbAssessmentType` for the new `AssessmentType` enum values.

### Fixed

- `lib/vector/search.ts`: an empty query now reports the caller's configured provider instead of
  hardcoding the mock provider name.

## [0.1.0] - 2026-09-11

Phase 0 (foundations): make the repository buildable, reviewable, and secret-free before product
work. Not yet git-tagged; `package.json` declares `0.1.0`.

### Added

- **CI pipeline** (`.github/workflows/ci.yml`). Runs on every pull request and on pushes to `main`:
  `npm ci`, `prisma generate`, `prisma validate`, typecheck, lint, format check, and build, on Node
  24, with placeholder environment values and `LLM_PROVIDER=mock` so CI needs no secrets, no
  database, and no network. Concurrency cancels superseded runs.
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
