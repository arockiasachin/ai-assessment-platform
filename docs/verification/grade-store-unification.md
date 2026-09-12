# Verification: grade store unification (`p4/grade-unify`)

Branch `p4/grade-unify`, based on `dev` @ `54cd363`. This closes the live
grade-integrity gap in which a teacher's manual mark was written to the legacy
`AssessmentGrade` store with **no audit trail** and was invisible to the modern
review pipeline, while the LMS export silently fell back to it.

## The gap (reproduced)

The headline product rule is "every grade is human-approved and audited". Two
grade stores existed and only one honoured it:

|              | Legacy `AssessmentGrade`               | Modern `Grade` / `GradeReview`     |
| ------------ | -------------------------------------- | ---------------------------------- |
| Written by   | gradebook + submission grading + seeds | `lib/grading/review-service.ts`    |
| Audit rows   | **0**                                  | 7 write paths                      |
| Publish gate | none                                   | requires human `accept`/`override` |

Reproduction: a temporary data-layer test called the real
`upsertAssessmentGrade` (the function behind `POST /api/gradebook/marks`) as the
owning teacher and counted the three stores:

```
REPRO_RESULT legacyAssessmentGrade=1 modernGrade=0 auditLog=0
```

So a teacher typing a mark produced exactly one unaudited legacy row — no modern
`Grade`, no `AuditLog` — confirming the gap. (The temporary test was removed once
the fix landed; the permanent coverage is described below.)

## The decision implemented

**A teacher setting a mark manually is itself the human approval.** Manual marks
therefore publish immediately into the modern pipeline — they are _not_ routed
through the `GradeReview` queue, which would make the gradebook unusable.

The write path now calls `recordManualMark` / `applyManualMark` in
`lib/grading/review-service.ts`, the same module that owns the only other writer
of `Grade.publishedAt` (`submitReviewDecision`). Both publish paths share
`writeAuditLog` and `serializeGrade`, so there is still one module writing the
column and no parallel audit implementation.

### Clearing a mark

`score: null` **deletes** the modern `Grade` row and writes an audit row
(`grade.manual_mark_cleared`) with the removed values in `before`. Deleting is
deliberate:

- it preserves the legacy/gradebook semantics of "no mark";
- voiding (`publishedAt = null`) would leave a row indistinguishable from a
  pending AI draft, which the next `recordAiSuggestion` would then silently
  adopt — conflating "a human cleared this" with "the model drafted this".

Either way the clear is audited, so a mark cannot disappear without a trace.

## Paths that now write `Grade` + `AuditLog`

| Path                                                                    | Entry point                                         | Audit action(s)                                                                           |
| ----------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Teacher gradebook cell (`POST /api/gradebook/marks`)                    | `upsertAssessmentGrade` → `recordManualMark`        | `grade.manual_mark_published` / `grade.manual_mark_updated` / `grade.manual_mark_cleared` |
| Teacher submission grading (`PUT /api/teacher/assessments/submissions`) | `applyManualMark` inside the submission transaction | same as above                                                                             |
| AI suggestion / review decisions (pre-existing)                         | `recordAiSuggestion`, `submitReviewDecision`        | `ai_suggestion.recorded`, `grade_review.*`, `grade.published`, `grade.ai_draft_*`         |
| Dev seeds                                                               | `prisma/seed.ts`, `app/api/auth/seed/route.ts`      | seed data only (no audit rows; not a user action)                                         |

### Audit row shape

`AuditLog` columns for a manual mark are:

- `entityType`: `"Grade"`, `entityId`: the `Grade.id` (for a clear, the id of the
  deleted row);
- `action`: `grade.manual_mark_published` (first publish), `grade.manual_mark_updated`
  (an already-published mark edited), or `grade.manual_mark_cleared`;
- `actorId`: the acting `User.id`; `actorRole`: `"teacher"` or `"admin"`;
- `before`: `{ points, maxPoints, source, approvedById, publishedAt }` of the prior
  grade, or `null` when none existed;
- `after`: the same snapshot for the new grade, or `{ cleared: true }`;
- `metadata`: `{ assessmentId, studentId }`;
- `createdAt`: database timestamp.

The `Grade` uses `source = TEACHER_OVERRIDE`, `approvedById` = the acting
teacher's `StaffProfile.id` (null for an admin without a staff profile), and
`publishedAt` set to now. The grade row and its audit row are written in one
transaction, so neither can commit without the other.

## Read dependencies removed

Only the modern `Grade` is read now (published rows only, where a grade is a
user-facing mark):

- `lib/gradebook-db.ts` — teacher and student gradebook payloads read
  `finalGrades` (published) instead of the `assessmentGrade` relation; the class
  average is computed from modern percentages.
- `app/api/teacher/assessments/submissions/route.ts` — `GET` score and `PUT`
  write both use the modern store.
- `app/api/student/assessments/route.ts` — student score and class average.
- `lib/groups/service.ts` — `resolveUniformGroupGrade` reads published `Grade`.
- `lib/lms-export/**` — no legacy row is loaded at all.
- `app/(dashboard)/admin/data/page.tsx` — the `grades` dataset replaces
  `assessment_grades`.

A modern grade is projected onto the assessment's own ceiling with
`toAssessmentScale(points, maxPoints, maxMarks)` (`lib/gradebook.ts`) so a rubric
ceiling that differs from `Assessment.maxMarks` still renders the right raw mark.

## What changed for the legacy fallback

- `resolveMarks` (`lib/lms-export/final-grade.ts`) now has a single origin
  (`modern-grade`) and no `legacy` candidate.
- `StudentFinalGrade.legacyFallbackAssessmentIds` is removed from the contract
  (`lib/contracts/lms-export.ts`) and responses; `finalGradeMarkOriginSchema` is
  now the literal `"modern-grade"`.
- The OneRoster `results.csv` `dateLastModified` no longer has a legacy branch
  and the `comment` column is always empty; the "legacy fallbacks" badge/text was
  removed from `components/teacher-lms-export.tsx`.
- Behaviour change: an assessment with no modern `Grade` (previously served by a
  legacy mark) now contributes **no** mark, exactly like any other ungraded
  assessment. This is the intended consequence of making modern `Grade` the only
  store; it is not a regression, and the test suite pins it.

## Retirement migration and the reference check

New migration (added after the existing three; the baseline and the two later
migrations are untouched):

```
prisma/migrations/20260912020000_retire_assessment_grade/migration.sql
DROP TABLE "AssessmentGrade";
```

`prisma migrate deploy` against an empty database applies all four migrations and
leaves only the modern tables:

```
Applying migration `20260911180000_baseline`
Applying migration `20260912000000_schema_unfreeze`
Applying migration `20260912010000_restore_course_rating`
Applying migration `20260912020000_retire_assessment_grade`
All migrations have been successfully applied.

Tables matching %grade%: AIGradeSuggestion, Grade, GradeReview
```

Reference check before dropping (only the schema model and explanatory comments
remained; no runtime accessor):

```
$ rg -n "prisma\.assessmentGrade|tx\.assessmentGrade" app lib prisma
(no matches)

$ rg -n "assessmentGrade" lib/generated/prisma
(no matches — the generated client has no delegate)
```

After the drop, the only `AssessmentGrade` occurrences are the historical
baseline migration (which creates it), this retirement migration (which drops
it), a historical comment in the schema-unfreeze migration, and explanatory
comments in `lib/gradebook-db.ts` / `lib/lms-export/*`. No code reads or writes
it.

## Tests

Baseline (branch point, unchanged code): **79 test files passed, 2 skipped; 499
tests passed, 5 skipped (512 total)**.

After this change: **80 test files passed, 2 skipped; 506 tests passed, 5 skipped
(519 total)**.

New `tests/grade-store-unification.test.ts` locks down:

- a teacher's manual mark produces exactly one `Grade` with `publishedAt` set,
  `approvedById` = that teacher, `source = TEACHER_OVERRIDE`, and exactly one
  `AuditLog` row with the expected actor and before/after;
- editing a published mark records the old value in `before`;
- clearing a mark deletes the grade and is audited with the removed values;
- a non-owner teacher and a student are still rejected (`Forbidden`), with
  nothing written;
- out-of-range scores (`-1`, `21`) are still rejected with no grade and no audit
  row, and `0` is accepted as a real mark (no silent clamping);
- a later AI suggestion cannot overwrite a teacher-published manual mark (the
  grade is untouched and the suggestion only opens a `PENDING` review);
- the modern grade flows into the LMS export with `origin: "modern-grade"` and no
  `legacyFallbackAssessmentIds` field.

Existing tests updated because they asserted the retired store or fallback:
`tests/gradebook-marks.test.ts`, `tests/gradebook-scoping.test.ts`,
`tests/teacher-submissions-partial-update.test.ts`,
`tests/lms-export-final-grade.test.ts`, `tests/lms-export-service.test.ts`,
`tests/lms-export-route-auth.test.ts`, `tests/fixtures/lms-export.ts`, and one
comment in `tests/student-submission-guard.test.ts`.

## Commands and results

```bash
npm run verify            # typecheck + lint + format:check — exit 0
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:59999/ci" \
  SESSION_SECRET=x LLM_PROVIDER=mock npm run build   # exit 0
TEST_DATABASE_URL="postgresql://assessment_user:assessment_pass@127.0.0.1:5432/assessment_grade_unify_test" \
  SESSION_SECRET=x LLM_PROVIDER=mock npm test        # 80 files / 506 passed
```

The test harness provisions its database with `prisma migrate deploy` from an
empty schema, so the retirement migration is exercised on every test run.

## Residual / human decisions

- **Existing legacy rows are discarded.** The retirement migration only drops the
  table; it does not backfill `AssessmentGrade` rows into `Grade`. There is no
  production data (the project is pre-release), and a backfill would have to
  guess at publish state and attribution. If a deployment with real legacy rows is
  ever cut over, a data migration must decide attribution and `publishedAt` for
  those rows first.
- **Dev seeds now write published `Grade` rows without audit rows.** Seeds are
  not user actions, so they intentionally do not fabricate audit history; if a
  seeded environment must look audited, a follow-up can route seeds through
  `recordManualMark`.
- **Manual marks and AI rubric grades can carry different `maxPoints`.** A manual
  mark is stored against `Assessment.maxMarks`; an accepted AI grade can carry the
  rubric ceiling. Both are normalized to a percentage, and readers scale back onto
  the assessment ceiling, so the displayed mark is consistent — but the raw
  `points`/`maxPoints` pair is the source of truth.
- **`Grade.overrideReason` is set to a fixed "Manual mark entered in the
  gradebook."** for manual marks. There is no per-mark reason field in the
  gradebook UI; the audit row is the detailed record.
