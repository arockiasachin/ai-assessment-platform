# Bug-fix run 4 — post-retirement verification pass

Date: 2026-09-12
Branch: `p4/verify-unified` (based on `dev` @ `e89724c`, committed locally; not pushed or merged)
Worktree: `/Users/slade/Documents/Learning/GH/Assessment-Dashboard/.worktrees/verify-unified` (the
main tree was never entered, read, modified, or cleaned).

This is the first adversarial pass since three structural changes landed on `dev`: the grade-store
unification (`87f094e`), the legacy quiz-store retirement (`d353a53`), and the git-history purge of
the assistant scaffolding. It starts from `bugfix-run-3.md` and the two structural verification
records and does not restate anything already fixed. The hunting ground is the unified grade
pipeline, the migrated quiz import, and the hand-migrated cross-feature readers.

## Environment

| Item                | Value                                                                  |
| ------------------- | ---------------------------------------------------------------------- |
| OS / shell          | macOS 27 (aarch64), zsh                                                |
| Node / npm          | v25.9.0 / 11.12.1                                                      |
| Next.js             | 16.3.0 (Turbopack)                                                     |
| Prisma              | 7.9.1 (`@prisma/adapter-pg`)                                           |
| Postgres            | 18.4 (Homebrew), `127.0.0.1:5432`, pgvector present                    |
| LLM provider        | `mock` (offline; no external calls)                                    |
| App / seed database | `assessment_verify4_dev` (created for this run)                        |
| Test database       | `assessment_verify4_test` (name contains `test`, created for this run) |
| Dev server          | `next dev` on `127.0.0.1:3314`                                         |
| Prod server         | `next start` on `127.0.0.1:3315` (DB-down health probe)                |
| Developer database  | `assessment_dashboard` — **never** read, reset, migrated, or written   |

Disk safety: `node_modules` was used as-is (no `npm ci`/`npm install`); no dependency was added;
`package.json`/`package-lock.json`/`prisma/schema.prisma`/`prisma/migrations/**` are unchanged.
`.next` was removed after the builds finished.

### One-time setup

The generated Prisma client (`lib/generated/prisma`, gitignored) is absent from a fresh worktree, so
the first `npm run verify` fails typecheck on missing `@/lib/generated/prisma/client`. After
`npx prisma generate` (reads the frozen schema only) all gates pass. This is environment setup, not
a defect.

## Commands and outcomes

| Command                                                                                                             | Result                                                                |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `npm run verify` (baseline, after `prisma generate`)                                                                | **exit 0** — 0 errors, 9 pre-existing warnings                        |
| `npx tsc --noEmit` (baseline)                                                                                       | **exit 0**                                                            |
| `TEST_DATABASE_URL=…assessment_verify4_test npm test` (baseline)                                                    | **exit 0** — 84 files, **536 passed**, 0 skipped                      |
| `npx vitest run tests/grade-manual-immutability.test.ts` (before fix)                                               | **failed 3/5** — reproduced BUG-1                                     |
| `npx vitest run tests/grade-rerun-race.test.ts` (before fix)                                                        | **failed 1/1** — reproduced BUG-2                                     |
| `npm run verify` (after fixes)                                                                                      | **exit 0** — 0 errors, 9 warnings (unchanged)                         |
| `npx tsc --noEmit` (after fixes)                                                                                    | **exit 0**                                                            |
| `TEST_DATABASE_URL=…assessment_verify4_test npm test` (after fixes)                                                 | **exit 0** — 86 files, **542 passed**, 0 skipped (+2 files, +6 tests) |
| `DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:59999/ci" SESSION_SECRET=x LLM_PROVIDER=mock npm run build` | **exit 0** — all routes emitted, `ƒ Proxy (Middleware)` present       |
| `next dev` on `:3314` against `assessment_verify4_dev`, exercised with `curl` for all three roles                   | booted clean; matrices below                                          |
| `next start` on `:3315` with a closed-port DB and `HEALTH_DB_TIMEOUT_MS=500`                                        | **`/api/health` → 503 degraded in 0.068 s**, no leak, no hang         |
| `git grep` for retired stores (`assessmentGrade`, `prisma.quiz.`, `model Quiz`)                                     | no live accessor (details below)                                      |
| `npx prettier --write` on the two edited files, then `npm run verify`                                               | **exit 0** — format clean                                             |

### Runtime matrix (dev server, `assessment_verify4_dev`)

| Request                                 | anon | teacher | student | admin |
| --------------------------------------- | ---- | ------- | ------- | ----- |
| `GET /api/health`                       | 200  | —       | —       | —     |
| `GET /api/gradebook`                    | 401  | 200     | 200     | 403   |
| `GET /api/student/quiz-attempts`        | 401  | 403     | 200     | —     |
| `GET /api/teacher/reviews`              | —    | 200     | 403     | —     |
| `POST /api/gradebook/marks` (valid)     | 401  | 200     | 403     | 200   |
| `POST /api/teacher/quiz` (valid import) | 401  | 200     | 403     | —     |

Object-level negatives exercised live:

- `POST /api/gradebook/marks` with `score: 999` and `score: -1` → **400** `Score must be between 0
and 20.` with nothing written; a non-enrolled student → **400**; student → **403**; anon → **401**.
- `POST /api/teacher/quiz` with another teacher's `offeringId` → **403**; a non-existent id →
  **403**; a missing `offeringId` → **400**; student → **403**; anon → **401**; nothing written in
  every rejection.
- Manual mark → modern `Grade` (`TEACHER_OVERRIDE`, `publishedAt` set, `approvedById` = staff) plus
  exactly one `AuditLog` row; clear (`score: null`) deleted the row and wrote
  `grade.manual_mark_cleared`; no duplicate `(assessmentId, studentId)` pairs existed.
- Imported quiz → `Question`/`QuestionOption` rows published and attributed, student start payload
  key-free, weighted attempt score `2/3` for the 2-mark question, and an **unpublished** draft
  `Grade` (`AI_SUGGESTED`) plus one `Quiz score` suggestion — nothing published.
- Manual mark then `accept` → **409** with the manual mark preserved; then `reject` → **200**,
  review `REJECTED`, manual mark still preserved.

## Bugs found and fixed

### BUG-1 — The review path overwrote a teacher-published manual mark (High, grade integrity)

**Verdict: CONFIRMED** (failing-then-passing tests + live requests).

**Evidence.** A teacher's manual mark leaves a `GradeReview` in `PENDING` (a manual mark does not
route through the review queue). With that pending review and a stale AI suggestion present:

- `submitReviewDecision({ action: "accept" })` replaced the published manual `Grade` with the AI
  total, re-attributing it `source = AI_SUGGESTED` and `publishedAt = now` (the manual mark was
  gone). Reproduced in `tests/grade-manual-immutability.test.ts` (3 of 5 assertions failed before
  the fix); live, `POST /api/teacher/reviews/{asmt}/{student}` returned `200` and the grade became
  the suggestion.
- `submitReviewDecision({ action: "reject" | "flag" })` **un-published** and rewrote the manual
  grade: the `Grade` kept `publishedAt` semantics broken (set to `null`) and took the suggestion's
  points, so the teacher's mark silently disappeared from every published-only reader (gradebook,
  LMS export, class average). Reproduced in the same file (`reject` and `flag` cases).

**Root cause.** `submitReviewDecision` upserted the `Grade` unconditionally for every decision.
`recordAiSuggestion` correctly refuses to touch a published grade, but the human review endpoint had
no equivalent guard, and the review state machine only blocks `accept` once the _review_ is
published — which is never the case for a manual gradebook mark.

**Fix** (`lib/grading/review-service.ts`): `submitReviewDecision` now reads the existing grade and
(a) rejects `accept` with `409` when a published grade already exists ("use an override to change
it"), and (b) skips the grade write entirely for non-publishing decisions (`flag`/`reject`/`reopen`)
when a published grade exists, returning that grade untouched. An explicit human `override` still
replaces it (that is a deliberate human re-mark), and unpublished drafts still refresh as before.

**Test.** `tests/grade-manual-immutability.test.ts` (5 tests): `accept` → 409 with the mark intact;
`reject` → review `REJECTED`, mark intact and still published; `flag` → mark intact; `override` still
allowed; and a cleared mark is not silently resurrected by a later grading run (the re-run writes
only an unpublished draft, and no published row exists).

### BUG-2 — A model re-run could silently clobber a concurrent manual mark (High, grade integrity)

**Verdict: CONFIRMED** (failing-then-passing test).

**Evidence.** `tests/grade-rerun-race.test.ts` holds an uncommitted manual mark open in one
transaction and runs `recordAiSuggestion` on another connection. The suggestion's first read cannot
see the uncommitted row, proceeds to its `Grade` write, blocks on the unique key, and then applies
its update once the manual mark commits. Before the fix the final row was `points = 20`,
`source = AI_SUGGESTED` with a non-null human `publishedAt` — a published grade that looks
human-approved but carries the model's score. The test failed 1/1 before the fix and passes after.

**Root cause.** A read-then-write race. `recordAiSuggestion` reads `existingGrade.publishedAt` and
then upserts; its `update` branch deliberately never writes `publishedAt`. A human mark that commits
between the read and the write is invisible to the read, and the update then overwrites
`points`/`source`/`reviewId` while leaving the human `publishedAt` in place. The
`@@unique([assessmentId, studentId])` key prevents two rows but cannot prevent this lost update.

**Fix** (`lib/grading/review-service.ts`): every grade writer (`recordAiSuggestion`,
`submitReviewDecision`, `applyManualMark`) now takes the same `Assessment` row lock
(`SELECT … FOR UPDATE`, the pattern already used by `lib/quiz-attempts/service.ts` and the
enrollment route) before reading any grade state, so the read and the write are one ordered critical
section. A model run that started before a manual mark now blocks, then observes the published mark
and leaves it untouched; a manual mark that follows a model run simply supersedes the draft.

**Test.** `tests/grade-rerun-race.test.ts` (1 test).

### Uniqueness guarantee for the modern `Grade`

**Yes.** `prisma/schema.prisma` keeps `@@unique([assessmentId, studentId])` on `Grade` (and
`reviewId @unique`), and no duplicate pair existed in a seeded + exercised database. The `Grade`
store's uniqueness is therefore equivalent to the retired `AssessmentGrade`. No schema change is
needed.

### Can a manual clear be resurrected by a stale suggestion?

**No — not silently, and not to a published state.** After `score: null` the modern `Grade` is
deleted and audited; a subsequent grading run (`recordAiSuggestion`) writes **only** an unpublished
draft (`publishedAt = null`) and opens/reopens the review `PENDING`, so no published mark reappears
in any reader. Publishing that draft still requires a human `accept`/`override`, and after BUG-1's
fix a _different_ published mark can never be overwritten by `accept`. Pinned by the
"not silently resurrected" test in `tests/grade-manual-immutability.test.ts`.

### Is the migrated quiz import genuinely gradeable end to end?

**Yes — proven, not just re-pointed.** Live: import → 2 published `Question` rows attributed to the
teacher with exactly one correct `QuestionOption` each → student start (key-free payload) → submit →
`2/3` for the 2-mark question only (weighted by `Question.points`, projected onto `Assessment.maxMarks`)
→ `QuizResponse` rows and an unpublished `Grade` draft + `Quiz score` suggestion. The route/service
rejects a non-owner, non-existent and missing `offeringId` (`403`/`403`/`400`) with nothing written.
Existing regression coverage (`tests/legacy-quiz-retirement.test.ts`) still passes.

### Retired-store reference sweep

`rg` for `assessmentGrade` / `AssessmentGrade` / `quizQuestion` / `QuizQuestion` / `prisma.quiz.` /
`assessment.quiz` / `model Quiz` across `app lib components prisma` (excluding migration SQL) finds
only: historical comments in `lib/gradebook-db.ts` / `lib/lms-export/*` / `prisma/schema.prisma`,
the client-safe view types `Quiz`/`QuizQuestion` in `lib/gradebook.ts` (no answer key), the
`quizQuestionCount` UI field, and `ScorableQuizQuestion`/`StudentQuizQuestion` contract type names.
No live accessor of the retired models remains.

## CONFIRMED vs SUSPECTED

### CONFIRMED (reproduced by a failing-then-passing test or a live request)

| #     | Severity | Area            | Summary                                                                                       | Test file                                 |
| ----- | -------- | --------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------- |
| BUG-1 | High     | grade integrity | Review `accept` overwrote a manual published mark; `flag`/`reject` un-published/rewrote it    | `tests/grade-manual-immutability.test.ts` |
| BUG-2 | High     | grade integrity | A model re-run racing a manual mark silently produced a published `AI_SUGGESTED` hybrid grade | `tests/grade-rerun-race.test.ts`          |

### SUSPECTED (code-visible or reasoned, deliberately not changed)

| #   | Severity | Area            | Suspicion                                                                                                                                                                                                                                                                                                                  | Why it was not fixed                                                                                                                                                                                         |
| --- | -------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S-1 | Low      | groups          | `resolveUniformGroupGrade` compares raw `Grade.points` across members without normalising by `maxPoints`. A manual mark (ceiling `Assessment.maxMarks`) and an accepted rubric grade (ceiling `Rubric.maxPoints`) can differ per pair, so equal percentages can be missed and "equal" raw points may not be the same mark. | The value is an advisory `suggestedIndividualGrades` input, never published, and the returned number is a raw group grade (callers may also pass one in), so normalising it is a product-semantics decision. |
| S-2 | Low      | grade integrity | Non-publishing `submitReviewDecision` decisions still create/refresh an **unpublished** draft `Grade` without a `Grade`-scoped audit row (the `GradeReview` transition and its `after.points` are audited). No published/money-grade write is unaudited.                                                                   | Draft-only (never user-facing); changing it risks churn in existing audit-count tests for no correctness gain.                                                                                               |
| S-3 | Low      | quiz grading    | `POST /api/quiz/grade` (`gradeQuizSubmission`) does not apply `quizDeliveryStatus`, so it would grade an assessment whose question set is still a draft and disclose the key post-submission. Needs at least one valid question id, which an undelivered quiz does not expose to students.                                 | Pre-existing behaviour of the second transient grader (run-3 S-5), unchanged by the retirement; the attempt pipeline is properly gated.                                                                      |
| S-4 | Info     | audit           | `prisma/seed.ts`, `app/api/auth/seed/route.ts` and `prisma/seed-demo.ts`'s direct writes are the only `Grade` writers outside `review-service.ts`; the dev seeds write published rows without audit rows.                                                                                                                  | Documented as an intentional seed exception in `grade-store-unification.md`; not a user action.                                                                                                              |

## Could not verify

- **Docker-backed `code-eval` suite.** The sandbox denies the Docker socket; those tests skip as
  designed. Run from a Docker-capable environment.
- **GitHub Actions CI.** Not run (nothing was pushed).
- **True multi-process concurrency.** The BUG-2 reproduction is a deterministic two-connection
  interleaving against one Postgres instance, not a multi-replica deployment.
- **Production data migration.** The retirement migrations discard legacy rows by design; no
  production dataset was available to exercise a backfill.

## Cross-run status

| Prior item                                                          | Status now                                                                                   |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| run-1 S-4 (legacy vs modern grade dual source)                      | **Closed** — modern `Grade` is the only store; no live `AssessmentGrade` accessor remains.   |
| run-3 S-5 (imported quiz ungradeable / listed with 0 questions)     | **Closed** — import writes published modern questions and is gradeable end to end (proven).  |
| run-3 S-3 (quiz scoring ignored `Question.points`)                  | **Closed** — weighted scoring confirmed on an imported quiz (`2/3` for the 2-mark question). |
| run-3 BUG-1 (partial submissions PUT data loss)                     | Holds — presence semantics and the ESLint guard still pass.                                  |
| run-3 BUG-2 (concurrent attempt start 500)                          | Holds — attempt-pipeline tests pass with the new grade lock in place.                        |
| run-1 S-1 / S-2 / S-6, run-2 S-2, run-3 S-1 (multi-offering create) | Still open; unchanged and out of scope for this pass.                                        |

## Shared-file edits

- `lib/grading/review-service.ts` — BUG-1 + BUG-2 (grade-write lock + non-publishing guard).
- `tests/grade-manual-immutability.test.ts` — new.
- `tests/grade-rerun-race.test.ts` — new.
- `CHANGELOG.md` — one `[Unreleased]` entry.
- `docs/verification/bugfix-run-4.md` — this report.

No change was made to `prisma/schema.prisma`, `prisma/migrations/**`, `package.json`,
`package-lock.json`, the plan file, or any unrelated source file. No schema change is required for
the fixes. No gate, lint rule, or test was weakened, skipped, or disabled; no `@ts-ignore`/`any` was
introduced.

## Schema change believed to be needed

None. The `Grade` uniqueness the brief asked about is already present
(`@@unique([assessmentId, studentId])`). The BUG-2 fix is a transaction-locking change, not a schema
change.
