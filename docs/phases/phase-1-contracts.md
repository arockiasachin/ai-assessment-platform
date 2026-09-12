# Phase 1 — Contracts

## Goal

Freeze the contracts that every feature pod will build against, so Phase 2 can fan out without
renegotiating the schema, the LLM interface, the API shapes, or the grading state machine. This is
the phase the whole parallel plan depends on: thirty agents on one small app produce merge conflicts
unless the interfaces are frozen first.

## Scope

### In

- The additive Prisma assessment spine: rubrics and criteria, the AI suggestion to grade pipeline,
  quiz questions, attempts and responses, code tasks and test runs, groups and peer evaluation,
  contribution and milestone tracking, similarity checks, submission versions, and materials with
  vector chunks.
- A migration that enables the `pgvector` extension and adds an HNSW cosine index.
- A pluggable LLM provider adapter with a deterministic, offline mock provider.
- A pgvector chunk, embed, and similarity-search module for course-material retrieval.
- Auth and session hardening: a signed, expiring session, `requireRole`, and object-level
  authorization on every route; delete the `admin`/`admin` backdoor and lock down the seed endpoint.
- The `zod` API contract shared between route handlers and client fetchers.
- The `AIGradeSuggestion` to `GradeReview` to `Grade` state machine with audit logging.
- The test harness: ephemeral seeded Postgres and a spine smoke test.

### Out

- All feature-pod UI and behaviour. That is Phase 2.
- Deleting legacy models. The spine is added alongside the legacy tree so the existing app keeps
  building; legacy deletion is Phase 4.
- The code sandbox worker (Phase 2) and LMS export (Phase 2).

## Deliverables

### Landed on this branch

| Area                 | Path                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------- |
| Assessment spine     | `prisma/schema.prisma`                                                                  |
| Baseline migration   | `prisma/migrations/20260911180000_baseline/migration.sql`                               |
| LLM adapter          | `lib/llm/` (`index.ts`, `types.ts`, `env.ts`, `errors.ts`, `http.ts`, `providers/*.ts`) |
| Retrieval module     | `lib/vector/` (`chunk.ts`, `embed.ts`, `search.ts`, `index.ts`)                         |
| Signed sessions      | `lib/session.ts`, `lib/auth.ts`, `lib/authz.ts`                                         |
| Route authorization  | `proxy.ts`, `lib/api.ts`, `app/api/**`                                                  |
| API contract         | `lib/contracts/` (`common.ts`, `auth.ts`, `gradebook.ts`, `grading.ts`, `quiz.ts`)      |
| Review state machine | `lib/grading/` (`state-machine.ts`, `review-service.ts`, `audit.ts`, `errors.ts`)       |
| Enum widening        | `lib/admin-db.ts` (`DbAssessmentType` extended for the new `AssessmentType` values)     |
| Test harness         | `tests/`, `vitest.config.mts`                                                           |

New Prisma models landed with the spine: `Material`, `MaterialChunk`, `Rubric`, `RubricCriterion`,
`AIGradeSuggestion`, `GradeReview`, `Grade`, `AuditLog`, `Question`, `QuestionOption`, `QuizAttempt`,
`QuizResponse`, `CodeTask`, `TestCase`, `TestRun`, `Group`, `GroupMember`, `PeerEvaluation`,
`ContributionEvent`, `Milestone`, `SimilarityCheck`, `SubmissionVersion`.

New enums: `MaterialKind`, `QuestionType`, `QuizAttemptStatus`, `GradeReviewStatus`, `GradeSource`,
`TestRunStatus`, `GroupStatus`, `PeerEvaluationStatus`, `MilestoneStatus`, `ContributionEventType`,
`SimilarityVerdict`. `AssessmentType` was extended with `DESCRIPTIVE`, `CODE`, and `GROUP_PROJECT`
(no removals).

### Landed since the first draft

| Area                       | Path                                                        | Commit    |
| -------------------------- | ----------------------------------------------------------- | --------- |
| Signed session + authz     | `lib/session.ts`, `lib/auth.ts`, `lib/authz.ts`, `proxy.ts` | `e87d7bd` |
| `zod` API contract         | `lib/contracts/**`, `lib/api.ts`, route handlers            | `3470a33` |
| Grade review state machine | `lib/grading/**`                                            | `ab1dd82` |

### Closed after the first draft

| Area                              | Path                                                                        | State                    |
| --------------------------------- | --------------------------------------------------------------------------- | ------------------------ |
| Server-authoritative quiz answers | `lib/quiz-scoring.ts`, `lib/quiz-grading.ts`, `app/api/quiz/grade/route.ts` | Landed (answer key gone) |
| Student gradebook payload scoping | `lib/gradebook-db.ts`, `components/gradebook-provider.tsx`                  | Landed (own rows only)   |

- The legacy quiz path is no longer client-trusted: `lib/gradebook-db.ts` no longer returns
  `QuizQuestion.correctIndex`, and `components/quiz-runner.tsx` submits selected answers to
  `POST /api/quiz/grade`, which grades against the server's copy and enforces object-level
  authorization. Grade persistence and short-answer partial credit remain Phase 2 work.
- `GET /api/gradebook` no longer serializes the class roster to a student. The student branch of
  `getGradebookPayloadForSessionUser` returns only the signed-in student's row and marks plus a
  server-computed `classAverages` aggregate, so a student cannot read classmates' grades. This was
  found and closed during the pre-Phase-2 verification campaign; see
  [`../verification/phase-1-verification.md`](../verification/phase-1-verification.md).
- The test harness is landed (`0644bc1`, `f54b2f0`): `tests/` (including `tests/spine.test.ts`,
  `tests/llm-mock.test.ts`, fixtures, and DB helpers) and `vitest.config.mts` are committed, and
  `ci.yml` runs `npm test` in the `verify` job. Its global setup applies the committed migrations
  with `prisma migrate deploy`, so the smoke test also proves the migration history builds the schema
  from an empty database. There is no `playwright.config.*`.

## Acceptance criteria

Drawn from the non-negotiable rules in [`product-spec.md`](../product-spec.md):

- No plaintext or unsigned session material anywhere; sessions are signed and expiring.
- Correct answers and rubric internals never reach the client (server-authoritative grading).
- Every AI score carries rationale, evidence, confidence, model, prompt version, and latency — the
  `AIGradeSuggestion` model carries exactly those fields.
- The rubric is the binding contract: criteria carry point ceilings and weights.
- No secrets in the repository.
- The `AIGradeSuggestion` to `GradeReview` to `Grade` pipeline is a state machine whose transitions
  are recorded in `AuditLog`; no grade publishes without teacher sign-off.

Plus the engineering criteria from the Phase 1 plan: `prisma generate` and `prisma validate` pass,
the migration applies cleanly, and the harness runs a spine smoke test against ephemeral Postgres.

## Status

**Complete.** The schema, baseline migration, LLM adapter, retrieval module, and test harness are
committed, and as of `e87d7bd` / `3470a33` / `ab1dd82` the auth hardening, the `zod` API contract,
and the grade review state machine are landed as well. The legacy quiz path was subsequently moved
server-side (`63e642a`, `9ab0b64`, `8128b97`), so no answer key reaches the client.

Two items that Phase 1 left open for Phase 2 have since landed: quiz grade persistence
(`a21ee3b`, the quiz-grading pod) and a DB-backed state-machine/dedupe suite
(`tests/grading-state-machine.test.ts`, `tests/grading-suggestion-dedupe.test.ts`). Short-answer
partial credit, which this phase left open, shipped in Phase 4 (`5981203`). `main` and `dev` both
point at the frozen tip `12e45be`, so the full phase history is on both branches.

## Key decisions and why

- **Additive schema, no legacy removal yet.** `prisma/schema.prisma` grows the spine while the
  legacy models (`AssessmentGrade`, `AttendanceRecord`, `Stream`, `CourseRating`,
  `CourseGradeHistory`, `ExternalReference`, `noSqlRefId`, `legacyPassword`) stay in place. The
  legacy app must keep building until Phase 4 proves the spine end to end.
- **`MaterialChunk.embedding` is `Unsupported("vector(1536)")`.** Prisma cannot type a `vector`
  column, but declaring it as `Unsupported` keeps the datamodel valid without a live Postgres
  connection during `prisma validate`. Vector reads and writes therefore use raw SQL in
  `lib/vector/`; the rest of the model stays typed.
- **pgvector instead of a separate vector store.** One datastore and no extra service. The migration
  runs `CREATE EXTENSION IF NOT EXISTS vector` and creates an HNSW index with `vector_cosine_ops`;
  search uses the `<=>` cosine-distance operator.
- **One LLM interface, four providers.** `lib/llm/types.ts` defines a single `LlmProvider` with
  `generate` and `embed`. `lib/llm/index.ts` builds the provider from `LLM_PROVIDER` and defaults to
  `mock`. The adapter is dependency-free TypeScript on `fetch`, so there is no SDK churn.
  `supportsEmbeddings` lets callers fail fast when a provider (Anthropic) cannot embed.
- **The mock provider is deterministic and offline.** CI and tests never need an API key or network.
  `createLlmProvider` accepts injected `env` and `fetchImpl` for deterministic tests, and
  `resetLlmProviderCache` drops the process-wide singleton.
- **Explainability is carried in the type system.** Every `generate` result includes `provider`,
  `model`, `usage`, and `latencyMs`, and the request carries `task` and `promptVersion` — the fields
  the `AIGradeSuggestion` row must store.
- **Sessions are HMAC-SHA256 signed with a server secret.** `lib/session.ts` encodes
  `base64url(payload).base64url(HMAC)`; `verifySessionValue` recomputes the MAC, compares it with
  `timingSafeEqual`, then checks expiry and shape with `zod`. The secret comes from `SESSION_SECRET`
  and a missing secret throws in production; dev/test fall back to a clearly non-secret value so the
  build and tests stay offline. `proxy.ts` verifies the same value instead of parsing it blindly, and
  `/quiz` is now in the matcher.
- **`requireRole` is the authorization boundary; `proxy.ts` is only a redirect.** Next documents
  Proxy as an optimistic pre-check, so every protected route re-verifies the signed session
  server-side and enforces the role, and object-level checks (teacher owns offering/assessment,
  student owns data) stay in the data layer. The `admin`/`admin` login backdoor is deleted; every
  login is a database lookup plus a bcrypt comparison.
- **`AUTO_ACCEPTED` means a human accepted the AI value.** The product rule is that a teacher
  approves every grade, so no machine path publishes: only the `accept` and `override` human actions
  set `Grade.publishedAt`, and `lib/grading/state-machine.ts` refuses every other transition.
- **Seeding is destructive only by explicit consent.** `POST /api/auth/seed` requires a
  signature-verified admin session re-checked against the database, an explicit
  `{ "confirm": "RESET-SEED" }` body, and (in production) `ALLOW_DESTRUCTIVE_SEED=true`; it no longer
  echoes credentials.

## Evidence

Phase 1 landing commits on `dev` (from `git log --oneline origin/main..dev` at the acceptance
point):

| Commit    | Subject                                                                | Files                                                                                                                                                               |
| --------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `22f608b` | `fix(vector): report configured provider for empty queries`            | `lib/vector/search.ts`                                                                                                                                              |
| `db9e7a2` | `feat(vector): add pgvector chunking, embedding and similarity search` | `lib/vector/{chunk,embed,index,search}.ts`                                                                                                                          |
| `f0088ef` | `feat(llm): add pluggable provider adapter with deterministic mock`    | `lib/llm/**`, `.env.example`                                                                                                                                        |
| `643f96d` | `feat(db): add Phase 1 assessment spine schema and migration`          | `prisma/schema.prisma`, the Phase 1 migration, `lib/admin-db.ts`                                                                                                    |
| `3470a33` | `feat(contracts): add zod schemas as the shared API contract`          | `lib/contracts/**`, `tests/contracts.test.ts`                                                                                                                       |
| `ab1dd82` | `feat(grading): add grade review state machine with audit logging`     | `lib/grading/**`, `tests/grading-state-machine.test.ts`                                                                                                             |
| `e87d7bd` | `feat(auth): sign session cookies and enforce role authorization`      | `lib/session.ts`, `lib/auth.ts`, `lib/authz.ts`, `lib/api.ts`, `proxy.ts`, `lib/gradebook-db.ts`, `app/api/**`, `tests/auth.test.ts`, `tests/authorization.test.ts` |

The baseline migration's header records how it was generated:

```
prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script
```

`prisma/migrations/20260911180000_baseline/migration.sql` is that output plus
`CREATE EXTENSION IF NOT EXISTS vector;` and the index
`MaterialChunk_embedding_hnsw_idx ON "MaterialChunk" USING hnsw ("embedding" vector_cosine_ops)`,
neither of which Prisma emits for the `Unsupported("vector(1536)")` column.

Commands re-run during the pre-Phase-2 verification campaign (2026-09-11; tree at `9ab0b64` plus the
gradebook-scoping fix):

```bash
npx prisma generate
npx prisma validate
npm run verify         # typecheck + lint + format:check; 0 errors, 13 warnings
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:59999/ci" SESSION_SECRET=x LLM_PROVIDER=mock npm run build
TEST_DATABASE_URL="postgresql://…/assessment_test" npm test   # 9 files, 37 tests
```

The build succeeds with no reachable database. The unit suite proves the forged-admin-cookie attack
and the student self-grading attempt are both rejected (see `tests/auth.test.ts` and
`tests/authorization.test.ts`). The DB-backed suite (`tests/spine.test.ts` and
`tests/gradebook-scoping.test.ts`) is not Docker-specific: it needs any Postgres with the `vector`
extension and runs locally from `TEST_DATABASE_URL`; CI supplies one via the `pgvector/pgvector`
service image. See the verification report for the full run log.

## Risks and open questions

- **Auth risk closed.** The unsigned cookie is gone; sessions are HMAC-signed, expiring, and
  verified on every read, with `requireRole` on every protected route and the seed endpoint gated
  behind an explicit confirmation. `tests/auth.test.ts` and `tests/authorization.test.ts` assert that
  a forged admin cookie and a student self-grading attempt are both rejected.
- **The state machine is enforced.** `lib/grading/state-machine.ts` defines the legal transitions and
  `lib/grading/review-service.ts` writes `AuditLog` rows in the same transaction as each transition.
  Only a human `accept`/`override` publishes a `Grade`. The deferred DB-backed coverage landed in
  `tests/grading-state-machine.test.ts` and `tests/grading-suggestion-dedupe.test.ts`, the latter
  added by bug-fix run 1.
- **Legacy quiz answer keys no longer reach the client.** `lib/gradebook-db.ts` stopped serializing
  `correctIndex`, and `components/quiz-runner.tsx` posts selected answers to `POST /api/quiz/grade`,
  which grades server-side. Persisting auto-graded quiz results landed in the Phase 2 quiz-grading
  pod (`a21ee3b`); short-answer partial credit shipped in Phase 4 (`5981203`, see
  [`../features/short-answer-partial-credit.md`](../features/short-answer-partial-credit.md)).
- **Unresolved spec questions that belong to this phase** (from
  [`product-spec.md`](../product-spec.md#open-questions-to-resolve-during-phase-1)): default LLM
  provider and model per task; retention policy for student work, rationales, and evidence quotes;
  whether short-answer partial credit is on by default or opt-in per assessment; and the sandbox
  backend and host.
- **Concurrent writers.** Three workers are committing to the same tree, so gate results are
  point-in-time and can move under the documentation.

## Dependencies on other phases

- **Depends on Phase 0** for CI, ESLint and Prettier, the removal of `ignoreBuildErrors`, and
  `product-spec.md`.
- **Phase 2 depended on this phase** for the frozen schema, the LLM interface, the `zod` contract,
  the review state machine, and the test harness. All landed, so the gate to Phase 2 was met and all
  seven Phase 2 pods have since shipped. The only Phase 1 carry-over was moving quiz grading
  server-side, which landed in `63e642a` and was completed by quiz persistence in `a21ee3b`.
