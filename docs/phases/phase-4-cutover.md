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

**Not started.** The legacy tree is still present and still builds. The Phase 1 schema is explicitly
additive: commit `643f96d` states that legacy models "are untouched for Phase 4 cutover." The
existing seed is `prisma/seed.ts`.

## Key decisions and why

- **Additive first, delete last.** Phases 1 to 3 add the spine beside the legacy tree, so the app
  keeps building while the new path is proven. Phase 4 is where deletion happens, once nothing
  depends on the old code.
- **Seed the full spine, not a happy-path slice.** A demo that exercises one feature proves one
  feature. The cutover demo must exercise the entire path, which is also the Phase 2 completion
  criterion.
- **Delete the schema drift rather than migrate it.** Attendance, streams, course ratings, grade
  history, `ExternalReference`, and `noSqlRefId` serve no use case in this product and were imported
  from the BI half. There is nothing to preserve.

## Evidence

None for the cutover itself. The groundwork is visible in the current tree:

- Legacy models still in `prisma/schema.prisma`: `AttendanceSession`, `AttendanceRecord`, `Stream`,
  `StudentStream`, `CourseRating`, `CourseGradeHistory`, `ExternalReference`, `AssessmentGrade`,
  `QuizQuestion`.
- The legacy surface still present: `app/(dashboard)/`, `app/api/gradebook/`, `app/api/teacher/`,
  `app/api/student/`, `app/api/auth/seed/route.ts`, `app/api/admin/dev/rebalance-offerings/route.ts`,
  `components/admin-datasets-view.tsx`, `components/quiz-runner.tsx`, and the `lib/gradebook*.ts`
  modules.
- The archive tag `legacy-archive-v1` at commit `82a48fc` preserves the pre-rebuild tree, so the
  cutover can diff against it after deletion.

## Risks and open questions

- **Deletion breaks dependents that are easy to miss.** `lib/admin-db.ts`, `lib/gradebook-db.ts`,
  `components/admin-datasets-view.tsx`, and the rebalance endpoint all reference the legacy models.
  Removing the models without removing the readers is a build break, which the typecheck gate will
  catch.
- **The migration that drops tables is irreversible in production.** It needs a backup step and a
  dry run against a seeded database before it is applied.
- **The demo course is a fixture, not evidence of scale.** Passing the spine on one course does not
  prove performance or grading quality; those are Phase 3 findings.
- **LTI registration is external.** The LMS pod's LTI AGS path may need a real platform registration,
  which is outside the repository.

## Dependencies on other phases

- **Depends on Phase 3** for the security review, the accessibility and performance audit, and the
  grading-agreement report. Cutting over before those is a risk, not a shortcut.
- **Depends on Phase 2** for a spine that actually works end to end.
