# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The project is pre-1.0
(`package.json` is at `0.1.0`); until it reaches 1.0.0, minor versions may include breaking changes.

Entries below are derived from the actual git history. No git tags carry a SemVer version yet: the
only tag is `legacy-archive-v1` at commit `82a48fc`, which is documented as its own non-versioned
section.

## [Unreleased]

Phase 1 (contracts) is complete. The schema, baseline migration, LLM adapter, retrieval module, test
harness, auth hardening, the `zod` API contract, and the grade review state machine are landed on
`dev`. The legacy quiz path is now also server-authoritative: answer keys no longer reach the
client, and quiz results are graded by `POST /api/quiz/grade`. Nothing below is released.

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

### Added

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
  `tests/grading-state-machine.test.ts`, `tests/quiz-scoring.test.ts`, `tests/quiz-grading.test.ts`).
  They prove a forged admin cookie and a student self-grading attempt are rejected, that quiz
  correctness is derived server-side with object-level authorization, and exercise the contract
  schemas and state machine.
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
