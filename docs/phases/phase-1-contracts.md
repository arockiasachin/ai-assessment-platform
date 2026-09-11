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

| Area               | Path                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------- |
| Assessment spine   | `prisma/schema.prisma`                                                                  |
| Baseline migration | `prisma/migrations/20260911180000_baseline/migration.sql`                               |
| LLM adapter        | `lib/llm/` (`index.ts`, `types.ts`, `env.ts`, `errors.ts`, `http.ts`, `providers/*.ts`) |
| Retrieval module   | `lib/vector/` (`chunk.ts`, `embed.ts`, `search.ts`, `index.ts`)                         |
| Enum widening      | `lib/admin-db.ts` (`DbAssessmentType` extended for the new `AssessmentType` values)     |
| Test harness       | `tests/`, `vitest.config.mts`                                                           |

New Prisma models landed with the spine: `Material`, `MaterialChunk`, `Rubric`, `RubricCriterion`,
`AIGradeSuggestion`, `GradeReview`, `Grade`, `AuditLog`, `Question`, `QuestionOption`, `QuizAttempt`,
`QuizResponse`, `CodeTask`, `TestCase`, `TestRun`, `Group`, `GroupMember`, `PeerEvaluation`,
`ContributionEvent`, `Milestone`, `SimilarityCheck`, `SubmissionVersion`.

New enums: `MaterialKind`, `QuestionType`, `QuizAttemptStatus`, `GradeReviewStatus`, `GradeSource`,
`TestRunStatus`, `GroupStatus`, `PeerEvaluationStatus`, `MilestoneStatus`, `ContributionEventType`,
`SimilarityVerdict`. `AssessmentType` was extended with `DESCRIPTIVE`, `CODE`, and `GROUP_PROJECT`
(no removals).

### Still open or in flight

| Area                       | Intended path                                                                 | State       |
| -------------------------- | ----------------------------------------------------------------------------- | ----------- |
| Signed session + authz     | `lib/auth.ts`, `proxy.ts`, `requireRole`, `app/api/**`                        | Not started |
| `zod` API contract         | Route handlers and shared schemas                                             | Not started |
| Grade review state machine | Service layer over `AIGradeSuggestion` / `GradeReview` / `Grade` / `AuditLog` | Not started |

Evidence for the state of each:

- `lib/auth.ts` still stores the session as a plaintext JSON cookie (`auth-user`) and reads it back
  with `JSON.parse`; there is no signature and no verification. `proxy.ts` reads the same unsigned
  cookie for routing.
- `zod` is a dependency in `package.json` but is imported nowhere in the codebase.
- `app/api/auth/seed/route.ts` still creates the `admin` / `admin` credential, and there is no
  `requireRole` guard anywhere.
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

**In progress.** The schema, baseline migration, LLM adapter, retrieval module, and test harness are
landed and committed. Auth hardening and the `zod` contract with the review state machine are not
landed.

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

## Evidence

Commits on `dev` (from `git log --oneline origin/main..dev`):

| Commit    | Subject                                                                | Files                                                            |
| --------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `22f608b` | `fix(vector): report configured provider for empty queries`            | `lib/vector/search.ts`                                           |
| `db9e7a2` | `feat(vector): add pgvector chunking, embedding and similarity search` | `lib/vector/{chunk,embed,index,search}.ts`                       |
| `f0088ef` | `feat(llm): add pluggable provider adapter with deterministic mock`    | `lib/llm/**`, `.env.example`                                     |
| `643f96d` | `feat(db): add Phase 1 assessment spine schema and migration`          | `prisma/schema.prisma`, the Phase 1 migration, `lib/admin-db.ts` |

The baseline migration's header records how it was generated:

```
prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script
```

`prisma/migrations/20260911180000_baseline/migration.sql` is that output plus
`CREATE EXTENSION IF NOT EXISTS vector;` and the index
`MaterialChunk_embedding_hnsw_idx ON "MaterialChunk" USING hnsw ("embedding" vector_cosine_ops)`,
neither of which Prisma emits for the `Unsupported("vector(1536)")` column.

Commands used to verify (re-run on 2026-09-11 against `22f608b`):

```bash
npx prisma generate
npx prisma validate
npm run typecheck      # 0 errors
npm run lint           # 0 errors, 13 warnings
npx prettier --check . # clean
```

## Risks and open questions

- **Auth is the largest open risk.** Until the unsigned cookie is replaced, anyone can forge a
  session by editing a cookie, and the seed endpoint still exposes `admin` / `admin`. This is the
  first item to close before Phase 2.
- **The grade state machine exists only as enums and models.** `GradeReviewStatus` and the tables
  are in place, but no service enforces legal transitions or writes `AuditLog` rows yet. A schema
  without the transition logic is not a state machine.
- **No tests.** Every "verified" claim in this phase currently rests on `prisma validate` and the
  type/lint gates, not on behavioural tests.
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
- **Phase 2 depends on this phase** for the frozen schema, the LLM interface, the `zod` contract, the
  review state machine, and the test harness. Those open items are the gate to starting Phase 2.
