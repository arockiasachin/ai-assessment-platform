# Phase 4 — Cutover

## Goal

Prove the new spine end to end on one seeded demo course, then retire the legacy tree. After Phase 4
there is one application, not a new spine growing alongside an old shell.

## Scope

### In

- A seeded demo course that exercises the whole spine: material is indexed, a teacher authors with AI
  assistance, a student takes or submits work, the system evaluates server-side, the teacher reviews
  and publishes, and the result reaches analytics and LMS export.
- Retiring the legacy tree and deleting the legacy dead code.
- Removing the deprecated schema drift from the datamodel and the database.

### Out

- New features. Cutover adds no capability.
- The BI / NL2SQL / GraphWeaver half of the original dissertation. It is permanently out of scope.

## Deliverables

- A seed script (or extension of the existing one) that produces a demo course with at least one
  quiz, one rubric-graded submission, one code task, one group project, and published grades.
- A walkthrough that exercises the spine end to end on that seeded course.
- Removal of the legacy application tree.
- A migration that drops the legacy tables and columns.

## Acceptance criteria

From the cutover definition and the product spec:

- The seeded demo course passes the whole spine in one run: author, generate, deliver, evaluate,
  review, publish, export.
- No grade is publishable without an explicit teacher action (Non-negotiable Rule 1 in
  [`product-spec.md`](../product-spec.md)).
- The legacy tree is deleted, and the build, typecheck, lint, format check, and tests still pass
  afterwards.
- No remaining code references a deleted model or table.
- The deprecated schema items are gone from both `prisma/schema.prisma` and the database:
  `AttendanceSession`, `AttendanceRecord`, `Stream`, `StudentStream`, `CourseRating`,
  `CourseGradeHistory`, `ExternalReference`, every `noSqlRefId` field, `legacyPassword`,
  `AssessmentGrade`, and the legacy `QuizQuestion` model where it has been superseded by
  `Question` / `QuestionOption`.
- The admin datasets browser, which exists only to browse `ExternalReference`, is removed.

## Status

**Complete** at `12e45be`; local `main`, `dev`, `origin/main` and `origin/dev` all point at it, and
`git rev-list --count main..dev` is 0. The cutover work landed in this order:

| Work                                                        | Landed in | Migration / source                                                                                                                |
| ----------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Security hardening (closes Phase 3 decisions S-1, S-2, S-4) | `7011bfa` | [`security/hardening.md`](../security/hardening.md)                                                                               |
| Schema unfreeze (six capabilities, seven dead models)       | `759333b` | `20260912000000_schema_unfreeze`; [`schema/unfreeze.md`](../schema/unfreeze.md)                                                   |
| Course-ratings restoration                                  | `b6222c8` | `20260912010000_restore_course_rating`; [`features/course-ratings.md`](../features/course-ratings.md)                             |
| Centralised partial-update guard                            | `b225b39` | [`engineering/partial-update-guide.md`](../engineering/partial-update-guide.md)                                                   |
| Unified grade store; `AssessmentGrade` retired              | `87f094e` | `20260912020000_retire_assessment_grade`; [`verification/grade-store-unification.md`](../verification/grade-store-unification.md) |
| Seeded demo course                                          | `9b7340f` | `prisma/seed-demo.ts`, `tests/demo-spine.test.ts`, [`demo.md`](../demo.md)                                                        |
| Legacy quiz store retired; JSON import migrated             | `d353a53` | `20260912030000_retire_quiz`; [`verification/legacy-quiz-retirement.md`](../verification/legacy-quiz-retirement.md)               |
| DeepSeek provider                                           | `fe65e5a` | [`llm-providers.md`](../llm-providers.md)                                                                                         |
| Student-work retention policy                               | `702ab25` | `20260912040000_add_retention_policy`; [`privacy/retention-policy.md`](../privacy/retention-policy.md)                            |
| Embeddings provider decoupled from chat                     | `aefe1c2` | [`llm-providers.md`](../llm-providers.md#split-providers-chat-and-embeddings)                                                     |
| Short-answer partial credit                                 | `5981203` | [`features/short-answer-partial-credit.md`](../features/short-answer-partial-credit.md)                                           |
| Grade-immutability fixes (bug-fix run 4)                    | `3992ce4` | [`verification/bugfix-run-4.md`](../verification/bugfix-run-4.md)                                                                 |

Two acceptance items are deliberately **not** met as originally written:

- **`CourseRating` is not gone.** The schema unfreeze dropped it on an audit that wrongly reported
  zero references, and it was restored in `b6222c8` because it is a live product feature. It is
  present in `prisma/schema.prisma` at `12e45be`; see
  [`features/course-ratings.md`](../features/course-ratings.md).
- **The admin datasets browser was not removed.** `components/admin-datasets-view.tsx` still exists
  and browses the live tables; the unfreeze removed only its panels for the deleted tables. Removing
  the browser entirely was not part of what shipped.

The seeded demo course is the end-to-end proof: `tests/demo-spine.test.ts` asserts the whole spine
(author → generate → deliver → evaluate → review → publish → analytics/export) on one course, and
that every published grade is attributable to a human action. It is composability evidence, not
scale or grading-quality evidence.

## Key decisions and why

- **Additive first, delete last.** Phases 1 to 3 add the spine beside the legacy tree, so the app
  keeps building while the new path is proven. Phase 4 is where deletion happens, once nothing
  depends on the old code.
- **Seed the full spine, not a happy-path slice.** A demo that exercises one feature proves one
  feature. The cutover demo must exercise the entire path, which is also the Phase 2 completion
  criterion.
- **Delete the schema drift rather than migrate it.** Attendance, streams, grade history,
  `ExternalReference`, and `noSqlRefId` serve no use case in this product and were imported from the
  BI half. There is nothing to preserve.
- **Restore `CourseRating` rather than lose a live feature.** The unfreeze's audit missed the
  generated-client call sites (`prisma.courseRating`) behind course ratings. Once that was found,
  the model and its modernized implementation were restored by a dedicated migration instead of
  leaving a product regression; see [`features/course-ratings.md`](../features/course-ratings.md).
- **Two stores retired, one at a time.** The grade store and the quiz store were each unified onto
  the audited modern pipeline with a migration that drops the legacy table, after a repo-wide
  reference sweep.

## Evidence

- Migrations, in order: `20260912000000_schema_unfreeze` (six capabilities added, seven dead models
  dropped), `20260912010000_restore_course_rating`, `20260912020000_retire_assessment_grade`,
  `20260912030000_retire_quiz`, `20260912040000_add_retention_policy`. There are six directories in
  `prisma/migrations/` including the baseline, and `tests/global-setup.ts` applies the full history
  to an empty database on every test run.
- `prisma/schema.prisma` no longer contains `AttendanceSession`, `AttendanceRecord`, `Stream`,
  `StudentStream`, `CourseGradeHistory`, `ExternalReference`, `AssessmentGrade`, `Quiz`,
  `QuizQuestion`, `noSqlRefId`, or `legacyPassword`. `CourseRating` is present because it was
  deliberately restored; `components/admin-datasets-view.tsx` still exists (see Status).
- `prisma/seed-demo.ts` seeds the demo course and `tests/demo-spine.test.ts` walks it; the counts and
  the per-route browser/curl evidence are in [`demo.md`](../demo.md).
- Bug-fix run 4 ([`verification/bugfix-run-4.md`](../verification/bugfix-run-4.md)) re-verified the
  unified grade pipeline and the migrated quiz import against a real database and added the
  grade-immutability regression tests (`tests/grade-manual-immutability.test.ts`,
  `tests/grade-rerun-race.test.ts`).
- At `12e45be` the suite is **93 test files** (`ls tests/*.test.ts`) and the route surface is **69**
  `app/api/**/route.ts` handlers; see [`README.md`](../README.md#repository-at-a-glance).
- The archive tag `legacy-archive-v1` at commit `82a48fc` preserves the pre-rebuild tree.

## Risks and open questions

- **Deletion breaks dependents that are easy to miss.** _Materialized and handled._ `lib/admin-db.ts`,
  `lib/gradebook-db.ts`, `components/admin-datasets-view.tsx`, and the rebalance endpoint all
  referenced legacy models; each reader was migrated before its model was dropped, and the typecheck
  gate would have caught a miss. The `CourseRating` case (a live feature found only after an
  incorrect "zero references" audit) is the cautionary example: a token grep is not a reference
  audit.
- **The migration that drops tables is irreversible in production.** The retirement migrations do
  not backfill legacy rows by design (the project is pre-release). A deployment with real legacy
  data must decide attribution and publish state before applying them; see
  [`verification/grade-store-unification.md`](../verification/grade-store-unification.md).
- **The demo course is a fixture, not evidence of scale.** Passing the spine on one five-student
  course does not prove performance or grading quality; those are Phase 3 findings.
- **LTI registration is external.** The `LtiRegistration`/`LtiUserMapping` models now persist a
  non-secret registration and user mapping, but a real AGS call still needs an actual platform
  registration and network egress, which is outside the repository.
- **No Phase 5 is defined.** The plan ends at Phase 4; there is no roadmap to invent beyond what the
  cutover delivered.

## Dependencies on other phases

- **Depended on Phase 3** for the security review, the accessibility and performance audit, and the
  grading-agreement report. The review and the audit are in hand; the grading-agreement report was
  never built, so cutting over skipped a stated gate. Phase 4 shipped anyway (`12e45be`), and the
  unbuilt report is recorded in
  [Known gaps and open decisions](../README.md#known-gaps-and-open-decisions).
- **Depended on Phase 2** for a spine that actually works end to end. All seven Phase 2 pods are
  merged, so this is satisfied, and the demo course proves the whole path.
