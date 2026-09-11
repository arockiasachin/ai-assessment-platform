# Bug-fix run 3 of 3 — verification report

Date: 2026-09-12
Branch: `bugfix/run-3` (based on `dev` @ `8f00a5f`, committed locally; not pushed or merged)
Scope: main working tree only. `/Users/slade/Documents/Learning/GH/ad-wt/quiz-generation` (a
separate worktree holding an unmerged branch) was never entered, read, modified, or cleaned.

This is the third and final real-time bug-fixing pass before Phase 4 (cutover). It starts from
[`bugfix-run-1.md`](./bugfix-run-1.md) and [`bugfix-run-2.md`](./bugfix-run-2.md) and does not
restate anything those runs already fixed. The hunting ground is everything that landed after run 2:
the quiz-attempt persistence feature, the observability layer, the a11y/contrast changes, and the
carried run-2 suspicion S-1.

## Environment

| Item                | Value                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| OS / shell          | macOS 27 (aarch64), zsh                                                   |
| Node / npm          | v25.9.0 / 11.12.1                                                         |
| Next.js             | 16.3.0 (Turbopack)                                                        |
| Prisma              | 7.9.1 (`@prisma/adapter-pg`)                                              |
| Postgres            | 18.4 (Homebrew), `localhost:5432`                                         |
| LLM provider        | `mock` (offline; no external calls)                                       |
| App / seed database | `assessment_bugfix3_dev` (created for this run)                           |
| Test database       | `assessment_bugfix3_test` (name contains `test`, created for this run)    |
| Dev server          | `next dev` on `127.0.0.1:3213` (then `:3214` for the DB-down health test) |
| Developer database  | `assessment_dashboard` — **never** read, reset, migrated, or written      |

### Database-safety method

Two databases were created and owned by `assessment_user`:

- `assessment_bugfix3_test` — used only by Vitest; `TEST_DATABASE_URL` contains `test`, so the
  harness guard accepts it. `tests/global-setup.ts` drops and rebuilds `public` from the baseline
  migration on every run.
- `assessment_bugfix3_dev` — used only by the dev server and `POST /api/auth/seed`. Its name does
  **not** contain `test`, so the harness can never be pointed at it.

`DATABASE_URL` was passed explicitly on every command, so the repo `.env`
(`assessment_dashboard`) could never win. No `prisma migrate reset`, `migrate dev`, schema edit, or
migration edit was performed. `prisma/schema.prisma`, `prisma/migrations/**`, `package.json`, and
`package-lock.json` are unchanged. Docker was unavailable inside the sandbox (socket denied); the
Docker-backed sandbox suite skipped cleanly, as designed.

## Commands and outcomes

| Command                                                                                           | Result                                                                    |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `npm run verify` (baseline)                                                                       | **exit 0** — 0 errors, 9 warnings (run 1's residual list)                 |
| `npx tsc --noEmit` (baseline)                                                                     | **exit 0**                                                                |
| `TEST_DATABASE_URL=…assessment_bugfix3_test npm test` (baseline)                                  | **exit 0** — 64 files, 387 passed, 5 skipped                              |
| `npm run verify` (after fixes)                                                                    | **exit 0** — 0 errors, 9 warnings (unchanged)                             |
| `npx tsc --noEmit` (after fixes)                                                                  | **exit 0**                                                                |
| `TEST_DATABASE_URL=…assessment_bugfix3_test npm test` (after fixes)                               | **exit 0** — 67 files, **404 passed**, 5 skipped (+3 files, +17 tests)    |
| `DATABASE_URL=…:59999/ci SESSION_SECRET=x LLM_PROVIDER=mock npm run build` (no-DB build)          | **exit 0** — compiled, all routes emitted, `ƒ Proxy (Middleware)` present |
| `npx vitest run tests/teacher-submissions-partial-update.test.ts` (before fix)                    | **failed 3/5** — reproduced the data loss                                 |
| `npx vitest run tests/quiz-attempts-adversarial.test.ts` (before the race fix)                    | **failed 1/7** — reproduced the P2002 → 500                               |
| Dev server booted against `assessment_bugfix3_dev`, routes exercised with `curl` for all 4 actors | booted clean; results below                                               |
| Dev server booted with `DATABASE_URL=…:59999` (closed port) and `HEALTH_DB_TIMEOUT_MS=500`        | `/api/health` → **503 degraded in 0.315s**; no leak, no hang              |

### Runtime role matrix (dev server, `assessment_bugfix3_dev`)

| Endpoint                                                     | anon | admin | teacher | student |
| ------------------------------------------------------------ | ---- | ----- | ------- | ------- |
| `GET /api/health`                                            | 200  | —     | —       | —       |
| `GET /api/student/quiz-attempts`                             | 401  | 403   | 403     | 200     |
| `GET /api/teacher/quiz-attempts?assessmentId=…`              | 401  | 403   | 200     | 403     |
| `GET /api/teacher/assessments/submissions`                   | 401  | 403   | 200     | 403     |
| `GET /api/gradebook`                                         | 401  | 403   | 200     | 200     |
| `GET /api/teacher/observability/grade-activity?offeringId=…` | 401  | 403   | 200     | 403     |

Object-level negatives were exercised too: `PUT /api/teacher/assessments/submissions` with a
different teacher's submission returned **404**, and a **404** cross-student
`GET /api/student/quiz-attempts/[id]`. No `500`s and no unhandled rejections appeared in the dev
server log; every request emitted one structured `http.request` line.

## Bugs found and fixed

### BUG-1 (run-2 S-1) — A partial `PUT /api/teacher/assessments/submissions` destroyed a grade (High, data loss)

**Verdict: CONFIRMED.** The carried run-2 suspicion was correct.

**Evidence (before the fix, real route + test database).** A `GRADED` submission with
`gradedAt = 2026-09-01T10:00:00Z`, `feedback = "Well done"` and `AssessmentGrade.marksObtained = 15`
was sent three bodies:

- `{ submissionId }` → `200`, status reverted to `SUBMITTED`, `gradedAt`/`gradedById` cleared,
  `feedback` set to `null` (the attached `AssessmentGrade` survived, so the row and the mark
  disagreed);
- `{ submissionId, feedback: "Great improvement" }` → same revert; the feedback update was the only
  intended effect;
- `{ submissionId, score: 18 }` → `200`, but the omitted `feedback` was wiped to `null`.

Three of the seven new regression assertions failed against the old code. The same request was then
reproduced live against `assessment_bugfix3_dev` on the seeded submission
`cmtxglykx0021f3k62ze9hiba` (`GRADED`, 21.00 marks).

**Root cause.** The handler was a full replace written as a partial update:
`score` was read as `rawScore === undefined ? null : Number(rawScore)`, and the `Submission` update
always wrote `status`/`gradedAt`/`gradedById`/`feedback`. An omitted `score` was therefore
indistinguishable from an explicit `score: null`, and an omitted `feedback` from `feedback: ""`.
This is the same class as run 2's BUG-1 (the offering PUT that nulled four date columns).

**Fix.** `app/api/teacher/assessments/submissions/route.ts` now distinguishes field presence with
`Object.prototype.hasOwnProperty`:

- `score` absent → the grade, `status`, `gradedAt` and `gradedById` are untouched;
- `feedback` absent → the existing feedback is untouched;
- `score: null` (or `""`) → still deliberately un-grades (`SUBMITTED`, null `gradedAt`/`gradedById`);
- neither field present → `400` "Provide a score or feedback to update.";
- malformed JSON → `400` "Invalid JSON body." instead of an unhandled throw → 500.

The only client (`components/teacher-submissions-manager.tsx`) already sends both `score` and
`feedback` on every save, so its behaviour is unchanged.

**Regression test.** `tests/teacher-submissions-partial-update.test.ts` (7 tests): omitting `score`
leaves status/`gradedAt`/`gradedById`/marks intact while updating only feedback; feedback is
preserved when only the score changes; an explicit `score: null` still un-grades; a body with
neither field is a 400 that writes nothing; an out-of-range score is a 400 that writes nothing; and
malformed JSON is a 400. Live re-check after the fix: the feedback-only request returned `200`,
`GRADED` and `gradedAt` were preserved, and the mark stayed `21.00`.

### BUG-2 — A concurrent quiz-attempt start returned a raw 500 and raced the attempt cap (Medium)

**Evidence (before the fix, service + test database).** Two simultaneous
`startQuizAttempt(...)` calls for a fresh student/assessment produced one success and one
`PrismaClientKnownRequestError` (`P2002`, unique constraint on
`("assessmentId","studentId","attemptNumber")`). `quizAttemptErrorResponse` reduces that to a
generic **500**, so a student who double-tapped "Start" (or refreshed twice) saw a server error
instead of resuming. The check-then-create window also left the attempt cap unprotected under
concurrency.

**Root cause.** `lib/quiz-attempts/service.ts` read the attempt count and the in-progress attempt
outside the write, then created `attemptNumber = max + 1`. Two callers read the same state, computed
the same number, and the unique key rejected the loser. (No cap bypass occurred — the unique key
prevented the extra row — but the status code was wrong and the create could still collide.)

**Fix.** Attempt creation now runs in one interactive transaction that first takes
`SELECT "id" FROM "Assessment" WHERE "id" = $1 FOR UPDATE` (the same pattern as the
security-review SEC-2/SEC-3 race fixes), then re-checks the existing `IN_PROGRESS` attempt and the
cap inside the lock. A concurrent start now resumes the winner; a start at the cap returns the
correct `429`/`409`. The cheap in-progress resume lookup is kept before the transaction for the
common refresh path.

**Regression test.** `tests/quiz-attempts-adversarial.test.ts` (7 tests) — including
"maps a concurrent start race to a domain error, never a raw database 500", which asserts the
mapped status is 409/429 for every rejected start. The existing
`tests/quiz-attempts-pipeline.test.ts` still passes. Live re-check: two parallel
`POST /api/student/quiz-attempts` returned **two 200s with the same attempt id** and exactly one
`QuizAttempt` row.

## Verified and held (no bug)

### Quiz-attempts — adversarial pass (new feature, never tested before)

`tests/quiz-attempts-adversarial.test.ts` (7 tests) plus live `curl`:

- **Concurrent double-submit.** Two submissions race the status guard; exactly one succeeds, the
  other is `409`, exactly one set of `QuizResponse` rows and one `AIGradeSuggestion` is written.
  The status-guarded `updateMany` inside the transaction holds.
- **Answer/question IDOR within an attempt.** An answer referencing another assessment's question is
  rejected `400`; the attempt stays `IN_PROGRESS` with zero rows.
- **Malformed payloads.** Empty `answers` and non-integer `selectedIndex` are rejected by the
  contract/service before any write.
- **Attempt cap accounting.** A started-but-unsubmitted attempt counts toward the cap; a refresh
  resumes the same attempt and never creates an extra `QuizAttempt`.
- **Resume past the deadline.** An `IN_PROGRESS` attempt started before `dueDate` still resumes after
  the deadline (returns the same attempt, `results: null`), matching the documented "handle late"
  rule.
- **Answer-key leakage.** Neither the start payload, the in-progress re-read, nor the list carries
  `isCorrect`, `correctIndex`, `correctOptionId`, `selectedIndex`, or `explanation` (asserted by
  substring on the serialized payload, live and in tests).
- **Cross-student read.** Another student's attempt is `404` and a non-owning teacher is `403`
  (live: 404 and, for the teacher list, `403`).
- **Grade integrity.** The auto-scorer writes an unpublished `Grade` (`publishedAt = null`,
  `source = AI_SUGGESTED`) and one suggestion; a later attempt supersedes the same `"Quiz score"`
  bucket and never rewrites a published grade (pipeline test); live check showed `points = 20`,
  `publishedAt` null, one suggestion, and no `grade.published` audit row.

### Observability layer

- **Redaction holds.** The existing redaction suite asserts secrets/cookies/passwords/tokens never
  serialize, and a new `tests/observability-instrumentation.test.ts` drives a real unhandled-error
  capture with an error message embedding a `postgresql://…supersecret@db.internal` URL — the
  emitted JSON line contains `"event":"http.unhandled_error"` and the request id, and **none** of
  the connection-string fragments.
- **Runtime dispatch still works.** `register()` on `NEXT_RUNTIME=nodejs` emits `app.start`;
  `onRequestError` emits `http.unhandled_error`; on `NEXT_RUNTIME=edge` both are no-ops and no
  Node-only logger is touched (new 3-test file). Next 16 defaults the proxy/middleware runtime to
  Node (`node_modules/next/dist/docs/.../proxy.md`), so the `proxy.ts` logger sink is reachable
  there.
- **`/api/health`.** Unit tests cover ok / database error / timeout / skipped / LLM mode. Live with
  `DATABASE_URL` pointing at a closed port and a 500 ms bound: **503 `degraded` in 0.315 s**, body
  contained none of `postgres`, `59999`, `ECONNREFUSED`, `/Users`, or `password`. The bounded
  `Promise.race` + `clearTimeout` means a hung query cannot hang the probe.
- **No behaviour regression.** The proxy only added a request line and an `x-request-id` on the
  `/api/**` branch (previously `/api` was not matched at all); handlers still authorize with
  `requireRole`, and the dev-server log showed correct `http.request` lines with the verified actor
  for every curl.

### A11y / contrast changes

Reviewed the `ebeaa1a` diff and the affected components:

- `components/charts.tsx` passes `title`/`desc` to recharts; recharts 3.8 plumbs those props to
  `RootSurface` (`node_modules/recharts/es6/chart/CategoricalChart.js`), so the accessible name is
  real and not a dropped prop.
- `--destructive` was darkened to `oklch(0.52 0.22 25)`; `--chart-4` deliberately kept `0.58`, so the
  charts are unchanged. `grade-badge.tsx` uses explicit light/dark band shades rather than the
  `success`/`warning` fill tokens.
- The `[@media(prefers-color-scheme:dark)]:` variants match how the app themes
  (`@media (prefers-color-scheme: dark) :root:not(.light)` in `globals.css`), not the unused `.dark`
  class.
- No duplicate or contradictory ARIA was found: the `role="radiogroup"` + `aria-labelledby` pairs
  reference ids rendered in the same block, `aria-expanded` is on the disclosure `<button>` (the
  textarea/buttons are siblings, not nested), and the new `aria-label`s match their controls. No
  regression found.

## CONFIRMED vs SUSPECTED

### CONFIRMED (reproduced by a failing-then-passing test or a live request)

| #     | Severity | Area          | Summary                                                                     | Test file                                          |
| ----- | -------- | ------------- | --------------------------------------------------------------------------- | -------------------------------------------------- |
| BUG-1 | High     | legacy route  | Partial submissions PUT un-graded a `GRADED` submission and wiped feedback  | `tests/teacher-submissions-partial-update.test.ts` |
| BUG-2 | Medium   | quiz-attempts | Concurrent attempt start returned a generic 500 (P2002) instead of resuming | `tests/quiz-attempts-adversarial.test.ts`          |

### SUSPECTED (code-visible or reasoned, deliberately not changed)

| #   | Severity | Area            | Suspicion                                                                                                                                                                                                                                                                            | Why it was not fixed                                                                                                                                                                                                                           |
| --- | -------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-1 | Medium   | legacy          | `createAssessmentForSessionUser` (`lib/gradebook-db.ts`) still picks an offering by `courseId` + newest `academicYear`. A teacher with the same course in two offerings gets the assessment in the wrong class.                                                                      | Carried from run 1. The correct fix needs an `offeringId` in the create-assessment contract and the shared teacher dialog; a guess-free fix is a product/UI change, so it stays flagged.                                                       |
| S-2 | Low      | grade integrity | The quiz auto-score bucket (`criterionLabel: "Quiz score"`) is summed by `latestSuggestionTotals` alongside any rubric-criterion buckets. A quiz that also has a rubric would add the auto-score to the criterion score instead of choosing one.                                     | Reproduced in reasoning (a criterion worth 10 plus a 20/20 attempt clamps to the rubric ceiling of 20). Whether a quiz may have a rubric is a product decision on frozen schema; no UI creates that today.                                     |
| S-3 | Low      | quiz scoring    | `lib/quiz-scoring.ts` weights every question equally (`correctCount / totalQuestions × maxMarks`) although `Question.points` exists and is serialized to the client.                                                                                                                 | The new feature deliberately reuses the existing kernel, and the legacy quiz path behaves identically. Changing the rule is a product decision, not a mechanical fix.                                                                          |
| S-4 | Low      | quiz UI         | `components/student-quiz-attempts.tsx` renders `new Date(...).toLocaleString()` during SSR and again on hydration; a server/client timezone difference can cause a hydration mismatch.                                                                                               | The same pattern already exists in several older components (`student-code-submissions`, `lib/gradebook.ts` formatters, `upcoming-events-panel`); fixing it in one new file would be inconsistent and repo-wide formatting is a separate task. |
| S-5 | Low      | cross-system    | A quiz created by the legacy importer (`POST /api/teacher/quiz`, `Quiz`/`QuizQuestion` rows) has no `Question`/`QuestionOption` rows, so the new quiz center lists it with `questionCount 0` and `canStart: false ("no questions yet")` while the legacy `/quiz` page still runs it. | The frozen schema holds two quiz representations; unifying them is a Phase-4 cutover decision. No crash and no leak.                                                                                                                           |
| S-6 | Low      | legacy client   | Run 1's S-1 (`components/gradebook-provider.tsx` `setMark` optimistic update with no `.catch()`/rollback) is unchanged.                                                                                                                                                              | Still no jsdom/Testing-Library harness and no new dependency permitted, so it cannot get a regression test in this pass.                                                                                                                       |

## Could not verify

- **Docker-backed sandbox tests.** The sandbox denies the Docker socket, so `code-eval-docker`
  skipped cleanly (as designed). Run `npx vitest run tests/code-eval-*.test.ts` from an environment
  with Docker to re-confirm SEC-1/SEC-2.
- **Real assistive-technology behaviour / browser hydration.** No browser automation was used; the
  a11y review is static plus the recharts plumbing check, and S-4 (hydration) is reasoned, not
  observed in a browser.
- **GitHub Actions CI.** Not run (nothing was pushed).
- **S-1 (multi-offering course) end-to-end.** The wrong-offering selection was not driven through
  the UI.
- **Environments other than Postgres 18.4 Homebrew.** Only the local instance was available.

## Schema and dependency changes

None were made and none are required for these fixes. `prisma/schema.prisma`,
`prisma/migrations/**`, `package.json`, and `package-lock.json` are unchanged; no dependency was
added; `node_modules`/`package-lock.json` were not touched. The two race fixes use `SELECT … FOR
UPDATE`, which needs no schema change.

## Shared-file edits (all listed)

- `app/api/teacher/assessments/submissions/route.ts` — BUG-1.
- `lib/quiz-attempts/service.ts` — BUG-2.
- `CHANGELOG.md` — the `bugfix-run-3` entry only.

New files: `tests/teacher-submissions-partial-update.test.ts`,
`tests/quiz-attempts-adversarial.test.ts`, `tests/observability-instrumentation.test.ts`, and this
report. No change was made to `lib/contracts/index.ts`, `lib/api.ts`,
`components/role-routes-menu.tsx`, `package.json`, `package-lock.json`, `prisma/**`, or the plan
file.

## Cross-run status

| Prior item                                                | Status now                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------------- |
| run-1 S-3 / security-review SEC-3 (enroll capacity race)  | **Closed** — fixed with a `CourseOffering` row lock in the security pass. |
| run-2 S-1 (submissions PUT full replace)                  | **Closed** — confirmed and fixed in this run (BUG-1).                     |
| run-2 S-2 (review-queue vs grade-dedup grouping key)      | Still SUSPECTED; no producer emits the divergent shape.                   |
| run-2 S-3 (enroll check-then-act)                         | Superseded by the run-1/security-review fix above.                        |
| run-1 S-1 (client `setMark` unhandled rejection)          | Still SUSPECTED (no client test harness).                                 |
| run-1 S-2 (assessment created against the wrong offering) | Still SUSPECTED (this report's S-1).                                      |
| run-1 S-4 (legacy vs modern grade dual source)            | Phase 4 cutover; unchanged.                                               |
| run-1 S-5 (suggestion tie-break on identical `createdAt`) | Unchanged; still theoretical.                                             |

## Branch status

`bugfix/run-3` is green:

- `npm run verify` → exit 0 (0 errors, 9 pre-existing warnings).
- `npx tsc --noEmit` → exit 0.
- `npm test` with `TEST_DATABASE_URL` → 67 files, 404 passed, 5 skipped.
- no-DB build → exit 0.
- Dev-server role matrix, object-level negatives, quiz-attempt adversarial cases, and the DB-down
  health probe all behaved as documented.
- No gate, lint rule, or test was weakened, skipped, or disabled; no `@ts-ignore`,
  `@ts-expect-error`, or new `any` was introduced. `.next` was removed after the run.
