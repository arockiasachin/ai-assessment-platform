# Bug-fix run 1 of 3 — verification report

Date: 2026-09-11
Branch: `dev` (committed locally; not pushed)
Base tree: `24debaf` (`fix(gradebook): stop sending the class cohort to students`)
Scope: main working tree only. The four Phase 2 pods in
`/Users/slade/Documents/Learning/GH/ad-wt/` were neither read nor touched.

This is the first of three real-time bug-fixing passes before Phase 3. It builds on
[`phase-1-verification.md`](./phase-1-verification.md) and does not repeat anything that report
already fixed or covered.

## Environment

| Item                | Value                                                                            |
| ------------------- | -------------------------------------------------------------------------------- |
| OS / shell          | macOS 27 (aarch64), zsh                                                          |
| Node                | v25.9.0                                                                          |
| Next.js             | 16.3.0                                                                           |
| Postgres            | 18.4 (Homebrew), `localhost:5432`                                                |
| `pgvector`          | 0.8.6 (already installed by run-0)                                               |
| LLM provider        | `mock` (offline; no external calls)                                              |
| App / seed database | `assessment_bugfix_dev` (created for this run)                                   |
| Test database       | `assessment_bugfix_test` (name contains `test`, created for this run)            |
| Developer database  | `assessment_dashboard` — **never** read, reset, migrated, or written by this run |

### Database-safety method

Two databases were created and owned by `assessment_user`:

- `assessment_bugfix_test` — used only by Vitest. `TEST_DATABASE_URL` contains `test`, so the
  harness guard accepts it; the harness drops and rebuilds `public` from the baseline migration on
  every run.
- `assessment_bugfix_dev` — used only by the dev server and `prisma db seed`. Its name does **not**
  contain `test`, so the harness can never be pointed at it.

`DATABASE_URL` was passed explicitly on every command; `@next/env` does not override an
already-set `process.env` value, so the repo `.env` (`assessment_dashboard`) could not win. This was
confirmed at runtime: the session user ids returned by `/api/auth/login` existed in
`assessment_bugfix_dev`.

No `prisma migrate reset`, `migrate dev`, schema edit, or migration edit was performed. `package.json`
and `package-lock.json` were not modified.

## Commands and outcomes

| Command                                                                    | Result                                                              |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `npm run verify` (typecheck + lint + format)                               | **exit 0** — 0 errors, **9 warnings** (was 13; 4 fixed, see below)  |
| `TEST_DATABASE_URL=…assessment_bugfix_test npm test`                       | **exit 0** — 14 files, **59 tests passed** (was 9 files / 37 tests) |
| `npx prisma validate`                                                      | `The schema at prisma/schema.prisma is valid 🚀`                    |
| `DATABASE_URL=…:59999/ci SESSION_SECRET=x LLM_PROVIDER=mock npm run build` | **exit 0** — compiled, 33/33 static pages                           |
| `DATABASE_URL="" SESSION_SECRET="" LLM_PROVIDER=mock npm run build`        | **exit 0** — blank env does not break the build                     |
| Dev server (`next dev -p 3201`) against `assessment_bugfix_dev`            | booted clean; no 500s or unhandled rejections in the log            |

### Runtime authorization matrix (dev server, re-confirmed)

| Endpoint                                   | anon | admin | teacher | student |
| ------------------------------------------ | ---- | ----- | ------- | ------- |
| `GET /api/gradebook`                       | 401  | 403   | 200     | 200     |
| `GET /api/student/assessments`             | 401  | 403   | 403     | 200     |
| `GET /api/student/courses`                 | 401  | 403   | 403     | 200     |
| `GET /api/teacher/offerings`               | 401  | 403   | 200     | 403     |
| `GET /api/teacher/assessments/submissions` | 401  | 403   | 200     | 403     |
| `GET /api/teacher/reports/ratings`         | 401  | 403   | 200     | 403     |

Page routes were also re-confirmed: `/admin/*` 200 for admin and 307 to the caller's home for
other roles; `/teacher` and `/student` behave the same; anon always 307→`/login`. No redirect loops.

## Bugs found and fixed

### BUG-1 — AI suggestion re-runs double-count, inflating draft and published grades (High)

**Evidence (before the fix).** A DB-backed probe against `assessment_bugfix_test` seeded two
criteria at 5 points each; the draft grade was 10. Recording the "Argument" criterion again with 5
points produced **15** (4 suggestion rows total). The `accept` action published the inflated total.

**Root cause.** `lib/grading/review-service.ts` aggregated
`_sum: { suggestedPoints: true }` over _every_ `AIGradeSuggestion` row for the
`(assessmentId, studentId)` pair. Each model re-run added a new row, so historical scores kept
accumulating. The same aggregate fed `submitReviewDecision`'s `accept` path, so the wrong total was
published. This violates the product rule that scores are produced per criterion.

**Fix.** Added `latestSuggestionTotals`, which groups suggestions by their logical bucket
(`rubricCriterionId` → `quizResponseId` → `submissionId` → `criterionLabel` → overall), keeps the
latest per bucket (ordered by `createdAt desc`), and sums those. History is preserved; only the
current score per bucket counts. Both `recordAiSuggestion` and `submitReviewDecision` now use it.

**Regression test.** `tests/grading-suggestion-dedupe.test.ts` (3 tests): re-running a criterion
must not change the total; a corrected re-run supersedes; distinct quiz responses still combine;
`accept` publishes the deduped total; a post-publish model output leaves the published grade intact.

### BUG-2 — A student could overwrite or revert a graded submission (High)

**Evidence (live, dev server).** Seeded submission was `GRADED` with `submittedAt = 2026-01-02`.
`POST …/submission` with `action: "submit"` returned 200 and changed the row to
`LATE | 2026-09-11T16:57:03Z`; a following `action: "saveDraft"` returned 200 and changed it to
`DRAFT | null`, while the attached `AssessmentGrade`, feedback, and `gradedAt` remained.

**Root cause.** `app/api/student/assessments/[assessmentId]/submission/route.ts` upserted
`status`, `contentText`, and `submittedAt` unconditionally, with no guard on the existing submission
state. The client `StudentAssessmentsView` exposes both "Save draft" and "Resubmit" for a graded row.

**Fix.** The route now loads the student's own submission and refuses:

- any student write when the submission is `GRADED` (409), and
- `saveDraft` when the submission is already `SUBMITTED` / `RESUBMITTED` / `LATE` (409).

Draft→submit and submit/resubmit before grading are unchanged. The client view disables the two
buttons for graded rows as a UX follow-up.

**Regression test.** `tests/student-submission-guard.test.ts` (3 tests), calling the real route
against the test database with a signed session: a graded row is refused for both actions and is left
byte-for-byte intact; a submitted row cannot be reverted to draft; a genuine draft still saves.

### BUG-3 — Out-of-range marks were silently clamped while returning `200 success` (Medium)

**Evidence (live).** `score: 9999` on a 20-mark assessment returned `200 {"success":true}` and stored
`20.00`; `score: -50` returned 200 and stored `0`. A client could not detect that the stored value
differed from the value it sent.

**Root cause.** `upsertAssessmentGrade` normalised with `Math.max(0, Math.min(maxMarks, score))`
instead of validating, and the route only checked `Number.isFinite`.

**Fix.** The service rejects non-finite, negative, or `> maxMarks` scores with a clear message; the
route maps that to 400. Live re-check: `9999` → `400 Score must be between 0 and 20.`,
`-50` → same. No value is written on rejection.

**Regression test.** `tests/gradebook-marks.test.ts` (7 tests): in-range write, above-max rejection,
negative rejection, non-finite rejection, null deletes, cross-teacher `Forbidden`, admin allowed.

### BUG-4 — Unvalidated dates/numeric bounds reached Prisma, and the raw error was echoed (Medium)

**Evidence (live).** `POST /api/gradebook/assessments` with `date: "notadate"` returned 400 whose
`message` was a full `PrismaClientValidationError` body including
`/Users/…/.next/dev/server/chunks/…` and the generated query source. The same happened for
`maxMarks: 999999999999` (32-bit `Int` overflow). Separately, `PUT /api/teacher/offerings/[id]` with
`registrationOpenAt: "not-a-date"` returned `200 success` and stored `NULL`, silently wiping an
existing schedule field.

**Root cause.** `createAssessmentRequestSchema.date` was `nonEmptyString` and `maxMarks` was an
unbounded positive number, so both reached Prisma. `updateOfferingRequestSchema` accepted arbitrary
strings and the route's `parseDateOrNull` returned `null` for anything unparseable. The three routes
returned `error.message` for every error, including database errors.

**Fix.**

- `lib/contracts/common.ts`: added `parseableDateString`.
- `lib/contracts/gradebook.ts`: `createAssessmentRequestSchema.date` uses it;
  `maxMarks` is now `.int().positive().max(1_000_000)`; `updateOfferingRequestSchema` date fields use
  `parseableDateString.nullable().optional()` (explicit `null` still clears).
- `lib/api.ts`: added `isDatabaseError` (duck-typed by Prisma error name / `P####` code).
- Routes `gradebook/assessments`, `gradebook/marks`, and `teacher/quiz` now surface only known
  validation messages and otherwise log and return a generic 500.

**Regression tests.** `tests/input-validation.test.ts` (6 tests) and
`tests/route-error-handling.test.ts` (3 tests).

Live re-check: invalid date → `400 Invalid date.`; `maxMarks: 999999999999` →
`400 Max marks is too large.`; invalid offering date → `400 Invalid date.`; none of these responses
contain internal paths.

### BUG-5 — AI draft-grades were written without an `AuditLog` row (Low)

**Evidence.** The probe's audit trail for a record→accept flow was
`GradeReview:created`, `AIGradeSuggestion:recorded`, `GradeReview:accept`, `Grade:published`. The
`Grade` upsert inside `recordAiSuggestion` produced no audit row, contradicting the module's own
"every mutation runs in a transaction with its `AuditLog` rows" contract.

**Fix.** `recordAiSuggestion` now writes `grade.ai_draft_created` / `grade.ai_draft_updated` for the
unpublished draft (and deliberately not for a published grade it refuses to touch).

**Regression test.** Covered by the third test in `tests/grading-suggestion-dedupe.test.ts`.

### Lint warnings — 4 fixed, 9 left with reasons

Fixes (real per-render recomputation, exactly what the rule reports):

- `components/student-assessments-view.tsx` — `payload?.assessments ?? []` allocated a new array each
  render, forcing three downstream `useMemo`s to recompute every render (3 warnings). Wrapped in
  `useMemo`.
- `components/student-courses-view.tsx` — same for `payload?.enrolledCourses ?? []` (1 warning).

Left in place, with reasons:

- **5× `react-hooks/set-state-in-effect`** (`gradebook-provider`, `student-assessments-view`,
  `student-courses-view`, `teacher-classes-manager`, `teacher-submissions-manager`). In every case
  the effect calls an `async` loader whose first statement is `fetch`/`await`; no `setState` runs
  synchronously inside the effect body. The rule is conservative about the transitive async call.
  These are the standard fetch-on-mount pattern, not cascade-render or stale-state bugs.
- **2× `@next/next/no-location-assign-relative-destination`** (`dashboard-header.tsx`). A deliberate
  `window.location.href = "/login"` after logout, to force a full navigation and drop client state.
- **2× `react-hooks/exhaustive-deps`** (`gradebook-provider.tsx`). The mount-only loader and the
  context `useMemo` omit function identities that are recreated each render but close only over
  stable setters; the captured versions fetch fresh data and set the same state, so there is no stale
  closure. Documented as a residual, not fixed.

## Suspected but NOT confirmed

| #   | Suspicion                                                                                                                                                                                                                                   | Why it was not confirmed / not fixed                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-1 | `components/gradebook-provider.tsx` `setMark` optimistically updates local state then `void fetch(...)` with no `.catch()` and no rollback. A rejected request is an unhandled rejection and a failed mark still looks saved until refresh. | Genuine risk, but the only client test harness available is Node (no jsdom/Testing-Library, and adding a dependency is out of scope). Not fixed without a test. |
| S-2 | `createAssessmentForSessionUser` picks an offering by `courseId` alone (newest `academicYear`). A teacher with the same course in several offerings can have an assessment created in the wrong class.                                      | Needs a contract change (`offeringId` instead of `courseId`) that would touch the shared teacher UI; flagged for the Phase 2 pods rather than changed here.     |
| S-3 | `POST /api/student/courses/enroll` counts active enrollments without a transaction/lock; two concurrent requests at capacity can over-enrol.                                                                                                | Not reproduced (needs a race harness); the check-then-act is visible in the code.                                                                               |
| S-4 | Legacy `AssessmentGrade` and Phase-1 `Grade` remain two sources of truth for a mark.                                                                                                                                                        | Known Phase 4 cutover, out of scope for this pass.                                                                                                              |
| S-5 | `latestSuggestionTotals` orders only by `createdAt`; two suggestions for the same bucket in the same millisecond tie.                                                                                                                       | Theoretical for real model calls (seconds apart). A deterministic tie-break needs either a schema column or a monotonic id; no schema change allowed.           |

## Could not verify

- **Browser hydration / client console.** No browser automation was used; the changed client
  components are type-checked and their server contract is covered by tests, but a manual browser
  smoke test is still advisable.
- **GitHub Actions CI.** Not run (nothing was pushed).
- **`POST /api/auth/seed` and `POST /api/admin/dev/rebalance-offerings`.** Not re-exercised; the
  seed endpoint was verified in run-0 and was not changed by this pass.
- **Environments other than Postgres 18.4 Homebrew.** Only the local instance was available.
- **The blank-`DATABASE_URL` runtime boot.** The blank-env _build_ passes; a server booted with a
  blank URL would fail on the first query, which is the intended loud failure, but it was not driven.
- **`createAssessmentForSessionUser` with a course the teacher teaches in multiple offerings**
  (S-2) — no fixture was built for it.

## Schema and dependency changes

None were made, and none are required for the fixes above. The only schema-level suggestion is
optional: a `supersededAt` column (or a unique key on the suggestion bucket) would let the grading
pipeline keep a compact "current" view instead of deduping in the service. `prisma/schema.prisma`,
`prisma/migrations/**`, `package.json`, and `package-lock.json` are unchanged.

## Branch status

`dev` is green and safe for the Phase 2 pods to merge into:

- `npm run verify` → exit 0 (0 errors, 9 warnings).
- `npm test` with `TEST_DATABASE_URL` → 14 files, 59 tests passed.
- `npx prisma validate` → valid.
- no-DB build → exit 0; blank-env build → exit 0.
- No gate, lint rule, or test was weakened, skipped, or disabled; no `@ts-ignore`, `@ts-expect-error`,
  or new `any` was introduced.
