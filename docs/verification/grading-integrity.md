# Grade-integrity and assessment-placement fixes — verification report

Date: 2026-09-12
Branch: `p4/grade-integrity` (based on `dev` @ `85fee42`, committed locally; not pushed or merged)
Worktree: `.worktrees/grade-integrity` (the main tree and `.worktrees/security-hardening` were never
entered or modified)
Scope: close three defects carried as SUSPECTED across bug-fix runs 1–3 with reproduced
failing-then-passing tests, not reasoning. The hunting ground is the grade-pipeline kernel
(`lib/grading/**`), the quiz scoring kernel (`lib/quiz-scoring.ts`), and assessment creation
(`lib/gradebook-db.ts`).

## Environment

| Item               | Value                                                                                |
| ------------------ | ------------------------------------------------------------------------------------ |
| OS / shell         | macOS 27 (aarch64), zsh                                                              |
| Node / npm         | v25.9.0 / 11.12.1                                                                    |
| Next.js            | 16.3.0                                                                               |
| Prisma             | 7.9.1 (`@prisma/adapter-pg`); client generated locally with `npx prisma generate`    |
| Postgres           | 18.4 (Homebrew), trust auth on `127.0.0.1:5432`                                      |
| LLM provider       | `mock` (offline; no external calls)                                                  |
| Test database      | `assessment_grade_integrity_test` (name contains `test`, owned by `assessment_user`) |
| Developer database | `assessment_dashboard` — **never** read, reset, migrated, or written                 |

`TEST_DATABASE_URL` was passed explicitly on every command, so no ambient URL could win. No
`prisma migrate reset`/`migrate dev`, schema edit, or migration edit was performed.
`prisma/schema.prisma`, `prisma/migrations/**`, `package.json`, and `package-lock.json` are
unchanged. `node_modules` was not re-installed (no `npm ci`/`npm install`); `npx prisma generate` was
run once because the generated client is not checked in to the worktree.

### Pre-existing gate failure repaired (not one of the three defects)

The baseline `dev` tree fails its own `format:check` gate: Prettier reformats the markdown table in
`docs/archive/duplicate-quiz-generation.md` (added by `85fee42`, unrelated to this work). Because
`npm run verify` must pass, the table was reformatted (6 insertions / 6 deletions, whitespace only).
This is the only change in the diff that is not one of the three fixes; it does not touch product
code or weaken any rule.

## Commands and outcomes

| Command                                                                               | Result                                                                                    |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `TEST_DATABASE_URL=…assessment_grade_integrity_test npm test` (baseline)              | **exit 0** — 67 files passed / 1 skipped, **404 passed**, 5 skipped                       |
| `npm run verify` (baseline, after `prisma generate`)                                  | **exit 1** — 0 type errors, 9 lint warnings, `format:check` failed (above)                |
| `TEST_DATABASE_URL=… npm test` (after fixes)                                          | **exit 0** — 70 files passed / 1 skipped, **422 passed**, 5 skipped (+3 files, +18 tests) |
| `npm run verify` (after fixes)                                                        | **exit 0** — 0 type errors, 9 pre-existing lint warnings                                  |
| `DATABASE_URL=…:59999/ci SESSION_SECRET=x LLM_PROVIDER=mock npm run build`            | **exit 0** — compiled, all routes emitted                                                 |
| Item 1 test before the fix (kind filtering and the rubric guard temporarily reverted) | **failed 3/6** — `expected 20 to be 18`, `expected 20 to be 10`, rubric created on a quiz |
| Item 2 test before the fix (equal-weight kernel restored)                             | **failed 2/5** — `expected 7 to be 14`, per-question `points` not honoured                |
| Item 3 test before the fix (`lib/gradebook-db.ts` reverted)                           | **failed 5/6** — assessment in the wrong offering, non-owner id accepted                  |

The pre-fix failures were produced by temporarily reverting the fixed behaviour, running the new
test, and restoring the file; the final tree is the fixed one and all three files pass.

## Item 1 — Bucket-kind summation (run-3 S-2)

**Verdict: CONFIRMED (Low severity, real silent grade corruption).**

**Defect.** `latestSuggestionTotals` (`lib/grading/review-service.ts`) deduped suggestions by logical
bucket but summed buckets of different kinds. A rubric criterion has `rubricCriterionId`
(`criterion:<id>`) and the deterministic quiz auto-scorer writes one suggestion with
`criterionLabel: "Quiz score"` (`label:Quiz score`), so if an assessment held both, the totals added
them and clamped to the rubric ceiling.

**Evidence it was real.** A DB-backed probe seeded a `DESCRIPTIVE` assessment with a rubric ceiling of
20 and two criteria worth 10 and 8, then recorded the illicit whole-quiz bucket worth 20. With the
kind filter reverted, the draft grade was `expected 20 to be 18` — exactly the clamp-to-ceiling
corruption described in run 3 (10 + 8 + 20 clamped to 20). The `accept` path published the same
inflated total (`expected 20 to be 10`). A second probe showed the illegal combination was creatable:
`upsertRubricForTeacher` on the `QUIZ` spine assessment resolved successfully instead of rejecting.

**Chosen semantics.** Rubric- and quiz-derived buckets are mutually exclusive; exactly one **bucket
kind** counts, chosen by explicit precedence (most specific first):

| Precedence | Kind           | Identifier                                          |
| ---------- | -------------- | --------------------------------------------------- |
| 1          | `rubric`       | `rubricCriterionId` present                         |
| 2          | `quizResponse` | `quizResponseId` present                            |
| 3          | `quizOverall`  | `criterionLabel === "Quiz score"` (whole-quiz auto) |
| 4          | `legacy`       | `submissionId`, another label, or overall fallback  |

Why this order: product-spec §3 makes the rubric "the binding contract", so it outranks a machine
score; a per-response quiz score is more specific than a whole-quiz auto-score; and a coarse
whole-assessment bucket must never be added to the finer buckets that produced it. The rule is
enforced in the totals computation and the classifier is exported so the invariant is unit-testable.

**Also fixed at the source.** A quiz is auto-scored and has no descriptive criteria, so
`upsertRubricForTeacher` now refuses a rubric on a `QUIZ` assessment with `409`.
`createAssessmentForSessionUser` only ever creates `QUIZ`/`ASSIGNMENT`, and `startQuizAttempt` /
`gradeQuizSubmission` only accept `type === "QUIZ"`, so a quiz can never gain a rubric and an
assignment can never gain a quiz attempt. The illegal combination is therefore unreachable through
any API, and the precedence rule is defence-in-depth for legacy/rogue rows.

**Fix.** `lib/grading/review-service.ts` — added `SuggestionBucketKind`, `suggestionBucketKind`,
`activeSuggestionKind`, and `SUGGESTION_KIND_PRECEDENCE`; `latestSuggestionTotals` now sums only the
latest bucket per key **within the single active kind**. `lib/rubric-grading/rubric-service.ts` —
`loadOwnedAssessment` returns `type`, and `upsertRubricForTeacher` rejects a `QUIZ`.

**Test.** `tests/grading-bucket-kinds.test.ts` (6 tests): pure classifier/precedence/dedupe-key
assertions; a DB test that sums two rubric criteria but excludes the whole-quiz bucket (draft `18`,
not `20`); a DB test that `accept` publishes the rubric total and a later quiz bucket cannot rewrite
the published grade (published `10`, one `grade.published` audit row); and a guard test that a rubric
on a `QUIZ` is rejected and no `Rubric` row is written.

**Residual risk / product decision.** None blocking. A quiz auto-score and per-response quiz
suggestions would now also be mutually exclusive (per-response wins); no current producer emits both,
which is safer than summing them. The rubric-authoring UI still lists `QUIZ` assessments and now
surfaces a clear `409` instead of authoring a rubric; filtering the picker is a cosmetic follow-up.

## Item 2 — `Question.points` ignored by scoring (run-3 S-3)

**Verdict: CONFIRMED (Low severity, client/server scoring disagreement).**

**Defect.** `lib/quiz-scoring.ts` scored `correctCount / totalQuestions × maxScore`, weighting every
question equally, while `Question.points` is editable (`PATCH /api/teacher/quiz-generation/[id]`
accepts `points`) and serialized to students through `serializeStudentQuestion`. A student saw
per-question point values the scorer ignored.

**Evidence it was real.** With the equal-weight kernel restored, the pipeline test failed with
`expected 7 to be 14`: three questions weighted 1/2/7 (total 10) with only the 7-point question
correct scored `round(1/3 × 20) = 7`, not `round(7/10 × 20) = 14`. The unit test also failed because
the result's per-question `maxPoints` was `1` instead of the declared `3`.

**Chosen semantics — honour `points` as a weight.** Scoring is weighted by each question's `points`
and the earned ratio is projected onto the assessment's `maxScore`:
`score = round(earnedPoints / totalPoints × maxScore)`. Consequences:

- **Backward compatible.** Every question defaults to `1`, so `earnedPoints = correctCount` and
  `totalPoints = questionCount`, which reproduces the old equal-weight result exactly. The legacy
  `QuizQuestion` model has no point column and therefore keeps the default `1`; the old rule is now
  the special case, so the legacy and new paths agree. This was chosen over "stop serializing points"
  because `points` is an intentional, teacher-editable column and the fix makes the stored value,
  the scorer, and the client agree rather than hiding it.
- **No division by zero.** `normalizeQuestionPoints` maps absent, `0`, negative, and non-finite
  weights to `1`; `totalPoints` is `> 0` whenever a quiz has at least one question, and the empty
  quiz scores `0`.
- **Bounded.** `earnedPoints ≤ totalPoints`, so the ratio is in `[0, 1]`; the score is rounded and
  clamped to `[0, maxScore]` (and a non-positive/non-finite `maxScore` is treated as `0`).

**Fix.** `lib/quiz-scoring.ts` — weighted kernel plus exported `normalizeQuestionPoints` and
`DEFAULT_QUESTION_POINTS`; results now carry the question's real `points`/`maxPoints`.
`lib/quiz-generation/grading.ts` — `GeneratedQuestionForScoring.points` passed through.
`lib/quiz-attempts/service.ts` — `toScorable` forwards `Number(question.points)` so both submission
scoring and post-submission result re-derivation use the weights.
`lib/quiz-attempts/serialize.ts` — the teacher view's `maxPoints` uses the same normalizer instead of
a hard-coded `1`, so it cannot disagree with the persisted `QuizResponse.pointsAwarded`.
`lib/quiz-grading.ts` — documented that the legacy path intentionally keeps the default weight.

**Test.** `tests/quiz-scoring-points.test.ts` (5 tests): weighted scores and per-question
`points`/`maxPoints`; legacy equal-weight equivalence; fallback for `0`/negative/`NaN`/`Infinity` and
no division by zero; `[0, maxScore]` bound and empty-quiz case; and a DB pipeline test proving the
student payload, attempt score (`14`), `AIGradeSuggestion`, draft `Grade`, and the teacher
per-question `maxPoints` all agree — and that scoring still only writes an unpublished suggestion
(`publishedAt` null, zero `grade.published` audit rows).

**Residual risk / product decision.** The per-question `points` shown to a student are now honoured
as **relative weights** normalised to `maxMarks`, not as absolute marks that sum to the total. If the
product wants the displayed points to sum to `maxMarks`, the UI should present them as weights (or
quiz generation should set `maxMarks` to the sum of `points`). This is a display/product decision,
not a scoring defect; the scorer can no longer disagree with the value it is given.

## Item 3 — Assessment created against the wrong offering (run-1 S-2)

**Verdict: CONFIRMED (Medium severity, silent wrong-class write).**

**Defect.** `createAssessmentForSessionUser` (`lib/gradebook-db.ts`) picked the offering with
`findFirst({ courseId, teacherId }, orderBy: academicYear desc)`. A teacher with the same course in
two offerings could have the assessment land in whichever offering the server's ordering preferred.

**Evidence it was real.** A teacher was given two offerings for one course, the target being the
**older** year (2024) and the other the spine offering (2026). With `lib/gradebook-db.ts` reverted,
the test failed 5/6:

- `writes into the offering the teacher asked for, not the newest year` — created assessment's
  `offeringId` was the 2026 offering, not the requested 2024 one;
- `rejects an offering owned by another teacher` and `rejects an unknown offering id` — the promise
  **resolved** instead of rejecting (the id was ignored and the teacher's own offering was used);
- the route tests returned the wrong offering and `200` where `403` was expected.

**Chosen semantics — explicit `offeringId`, validated ownership.** The `POST
/api/gradebook/assessments` contract now **requires** `offeringId`; `courseId` is no longer accepted.
The service loads the offering filtered by `id` **and** the signing-in teacher's `staffId`, so a
missing offering and another teacher's offering are the same `403` ("Offering not found or not owned
by you.") and the endpoint never confirms another teacher's offering exists. `courseId` and `classId`
are derived from the offering, never from the client. Backward compatibility was deliberately **not**
kept: the old request shape could silently write into the wrong class, and a clear error is strictly
safer.

**Fix.**

- `lib/contracts/gradebook.ts` — `createAssessmentRequestSchema` requires `offeringId` and drops
  `courseId`.
- `lib/gradebook-db.ts` — `createAssessmentForSessionUser` takes `offeringId`, validates ownership,
  derives `courseId`/`classId`, and returns `403` for a non-owned/unknown offering.
- `app/api/gradebook/assessments/route.ts` — maps the new domain error to `403`.
- `lib/gradebook.ts`, `lib/gradebook-db.ts` — the teacher gradebook payload now carries an
  `offerings` list (course, class/section, term, year), built from the offerings already loaded.
- `components/gradebook-provider.tsx`, `components/add-assessment-dialog.tsx`,
  `components/teacher-assignments-manager.tsx` — the create-assessment UI selects a **class offering**
  (e.g. "Data Structures — Section B (Fall 2024)") instead of a course, and sends `offeringId`.
- `tests/input-validation.test.ts`, `tests/route-error-handling.test.ts` — fixtures updated to the
  new contract; the route test now asserts the `403` domain-error path.

**Test.** `tests/assessment-offering-selection.test.ts` (6 tests): a teacher with two offerings for
one course gets the assessment in the requested (older) offering with the matching `classId`, and the
calendar event matches; a non-owner offering is rejected and writes nothing; an unknown offering id
is rejected; and the route returns `200` with the right offering / `403` for a non-owner / `400` when
`offeringId` is missing.

**Residual risk / product decision.** This is a breaking API change: any out-of-tree client still
sending `courseId` now gets a `400`. Within the repo the only callers are the two teacher dialogs,
both updated. `createQuizFromImportForSessionUser` (`POST /api/teacher/quiz`) is a separate legacy
import flow that still matches an offering by `courseId`/course name; it was out of scope here and is
recorded as the remaining instance of the same ambiguity if a teacher imports a quiz for a course
taught in two offerings.

## Non-negotiable product invariant (locked down)

- **Nothing publishes a grade except a human `accept`/`override`.** The item-2 pipeline test asserts
  a full scoring run writes an unpublished `Grade` (`publishedAt: null`, `source: AI_SUGGESTED`) and
  **zero** `grade.published` audit rows. The item-1 test asserts `accept` is the only publisher and
  produces exactly one `grade.published` row.
- **A published grade is never overwritten.** Both new DB tests record a further model/auto-score
  output after publication and assert the points and `publishedAt` are byte-for-byte unchanged. The
  item-3 change touches assessment creation only and cannot reach the grade pipeline.

## Shared files touched (all listed)

- `lib/contracts/gradebook.ts` (shared contract)
- `lib/gradebook-db.ts` (shared data layer)
- `lib/gradebook.ts` (shared client types)
- `lib/grading/review-service.ts`
- `lib/rubric-grading/rubric-service.ts`
- `lib/quiz-scoring.ts`
- `lib/quiz-generation/grading.ts`
- `lib/quiz-attempts/service.ts`
- `lib/quiz-attempts/serialize.ts`
- `lib/quiz-grading.ts` (comment only)
- `app/api/gradebook/assessments/route.ts`
- `components/gradebook-provider.tsx`
- `components/add-assessment-dialog.tsx`
- `components/teacher-assignments-manager.tsx`
- `tests/input-validation.test.ts`, `tests/route-error-handling.test.ts` (fixtures/assertions)
- `docs/archive/duplicate-quiz-generation.md` (pre-existing `format:check` gate repair, whitespace only)
- `CHANGELOG.md`

New files: `tests/grading-bucket-kinds.test.ts`, `tests/quiz-scoring-points.test.ts`,
`tests/assessment-offering-selection.test.ts`, and this report. `prisma/schema.prisma`,
`prisma/migrations/**`, `package.json`, `package-lock.json`, the plan file, and
`components/role-routes-menu.tsx` are unchanged.

## Could not verify / needs a human or product decision

- **Rubric picker UX.** The rubric-authoring UI still lists `QUIZ` assessments; the server now rejects
  them with a `409`. Filtering the picker (or hiding quizzes) is a UI follow-up, not a safety gap.
- **Legacy quiz import offering ambiguity.** `createQuizFromImportForSessionUser` still resolves an
  offering from `courseId`/course name and is unchanged; it should adopt the same explicit-offering
  requirement if the dual-offering import path is exercised.
- **Displayed points semantics.** `points` are honoured as relative weights; whether the UI should
  display them as weights or normalise `maxMarks` to their sum is a product decision.
- **Browser/UI smoke test.** No browser automation was used. The changed client components type-check
  and lint clean and their request shape is asserted at the route, but a manual browser pass over the
  two teacher dialogs is still advisable.
- **GitHub Actions CI.** Not run (nothing was pushed). Docker-backed sandbox tests were not in scope.
