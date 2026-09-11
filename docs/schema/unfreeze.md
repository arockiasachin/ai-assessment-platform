# Schema unfreeze — real columns for six capabilities and seven dead models dropped

Date: 2026-09-12
Branch: `p4/schema-unfreeze` (based on `dev` @ `bf6b3f2`; committed locally, not pushed or merged)
Worktree: `.worktrees/schema-unfreeze` (the main tree was never entered or modified)

`prisma/schema.prisma` and `prisma/migrations/**` were frozen from Phase 1 through Phase 3. This is
the first schema change after the squashed baseline. It **adds** one migration after
`20260911180000_baseline`; the baseline was not rewritten or squashed.

Migration: `prisma/migrations/20260912000000_schema_unfreeze/migration.sql`
Generated with `prisma migrate diff --from-schema <baseline> --to-schema prisma/schema.prisma
--script` and applied with `prisma migrate deploy` (never `migrate dev`, never `db push`).

## What the migration does

**Adds**

| Object                             | Kind                                  | Purpose                                                |
| ---------------------------------- | ------------------------------------- | ------------------------------------------------------ |
| `StudentProfile.formationProfile`  | `JSONB` nullable                      | Per-student team-formation attributes + availability   |
| `CourseOffering.analyticsSettings` | `JSONB` nullable                      | Persisted intervention/item-analysis thresholds        |
| `Question.status`                  | `TEXT` nullable                       | Explicit draft/published state for generated questions |
| `Question.publishedAt`             | `TIMESTAMP(3)` nullable               | Publish timestamp                                      |
| `Question.publishedById`           | `TEXT` nullable + FK → `StaffProfile` | Publisher (a staff id)                                 |
| `AIGradeSuggestion.seq`            | `SERIAL NOT NULL`                     | Database-assigned monotonic dedupe/ordering key        |
| `Assessment.maxAttempts`           | `INTEGER` nullable                    | Per-assessment quiz attempt cap                        |
| `LtiRegistration`                  | table                                 | Persisted LTI 1.3 registration (no key material)       |
| `LtiUserMapping`                   | table                                 | Student ↔ LMS user id mapping                          |

**Drops**

- Tables: `Stream`, `StudentStream`, `CourseRating`, `AttendanceSession`, `AttendanceRecord`,
  `CourseGradeHistory`, `ExternalReference` (all seven).
- Enum: `AttendanceStatus` (only `AttendanceRecord` used it).
- Columns: `User.password` (mapped from `legacyPassword`), `CourseOffering.noSqlRefId`,
  `Assessment.noSqlRefId`, `Submission.noSqlRefId`, `CalendarEvent.noSqlRefId`.
- Back-relations removed from kept models: `StudentProfile.streamMemberships`/`attendance`/
  `courseHistory`/`courseRatings`, `Course.history`, `ClassRoom.history`,
  `CourseOffering.attendanceSessions`/`ratings`.

`AssessmentGrade` is deliberately **not** dropped: it has four live references and remains the
LMS-export legacy fallback (`lib/lms-export/**`). Retiring it depends on a separate product
decision.

## The six capabilities

### 1. Team-formation attributes and availability

- **Column:** `StudentProfile.formationProfile` — a JSON column.
- **Why JSON, not a dedicated model:** the attribute keys are instructor-defined and vary per
  course (a formation criterion names an arbitrary attribute), so a fixed set of columns cannot
  express them. Availability is a string array inside the same envelope. One additive column, no
  new join, no migration per new attribute.
- **Shape:** `{ attributes: Record<string, string | number | null>, availability?: string[] }`.
  An absent `availability` means "unconstrained"; `[]` means "never available" (unchanged
  semantics).
- **Workaround replaced:** the formation request used to carry the entire per-student attribute map
  and availability on every run; only provenance was persisted in `Group.metadata.formation`.
- **Code migrated:** `lib/groups/formation-profile.ts` (defensive reader/writer),
  `saveFormationProfilesForTeacher` + `listOfferingRosterForTeacher` in `lib/groups/service.ts`, the
  `PUT /api/teacher/groups/roster` route, and `components/teacher-groups-manager.tsx` (loads stored
  values, has a save action, and posts a formation run without a `students` array).
  `formTeamsForTeacher` reads each enrolled student's stored profile when the request omits
  `students`.
- **Default when unset:** `{}` attributes and undeclared availability (unconstrained).
- **Workaround kept, deliberately:** an explicit `students` array is still accepted as a one-off
  override for a preview/experiment. It is not dead code; it is documented in the contract as an
  override, and the stored roster is now the default.

### 2. Analytics alert thresholds

- **Column:** `CourseOffering.analyticsSettings` — a JSON column holding
  `{ intervention?: Partial<InterventionThresholds>, itemAnalysis?: Partial<ItemAnalysisThresholds> }`.
- **Workaround replaced:** `GET /api/teacher/analytics` accepted thresholds as query params every
  request and had nowhere to persist a choice.
- **Code migrated:** `lib/analytics/settings.ts` (defensive read + merge), `getTeacherAnalyticsOverview`
  and `getAssessmentItemAnalysisForTeacher` in `lib/analytics/service.ts` now resolve
  `code default ← persisted setting ← per-request override`, plus `GET`/`PUT
/api/teacher/analytics/settings` to read/write the persisted values.
- **Default when unset:** the existing code defaults (`DEFAULT_INTERVENTION_THRESHOLDS`,
  `DEFAULT_ITEM_ANALYSIS_THRESHOLDS`). A malformed stored value is treated as unset, never a crash.
- **Kept:** query-param overrides still work and win over the persisted value.

### 3. Quiz draft/published state

- **Columns:** `Question.status` (`"draft"`/`"published"`, nullable), `Question.publishedAt`,
  `Question.publishedById` (FK to `StaffProfile`, `SetNull`).
- **Workaround replaced:** state lived in `Question.metadata.generationStatus` (with
  `publishedAt`/`publishedByStaffId` inside the JSON envelope).
- **Code migrated:** `lib/quiz-generation/metadata.ts` now exposes `resolveGenerationStatus`,
  `resolvePublishedAt`, `resolvePublishedById`, and `isGeneratedQuestion`; generation writes
  `status: "draft"` and a provenance-only `metadata`; publish writes the three columns;
  `lib/quiz-generation/{serialize,review-service}.ts` and `lib/quiz-attempts/{metadata,service}.ts`
  resolve through the new helpers.
- **Default when unset:** a `null` status falls back to the legacy JSON value; a question with
  neither is hand-authored and treated as published (unchanged rule).
- **Backward compatibility: YES.** Rows written before the migration still have their state in
  `metadata`, and every reader reads the column first, then the legacy JSON keys. The migration does
  not backfill `status`, so NULL on old rows is expected and handled. A dedicated test asserts the
  legacy fallback.

### 4. Grading suggestion dedupe key

- **Column:** `AIGradeSuggestion.seq` — `SERIAL NOT NULL`, a database-assigned monotonic integer.
  Existing rows are backfilled by PostgreSQL in physical insert order.
- **Workaround replaced:** `latestSuggestionTotals` ordered only by `createdAt desc`, so two
  suggestions for the same bucket written in the same millisecond had an ambiguous "latest".
- **Code migrated:** `lib/grading/review-service.ts` selects `seq` and orders by
  `[{ seq: "desc" }, { createdAt: "desc" }]`. The bucket key/precedence logic is unchanged.
- **Default when unset:** `seq` is never unset — the sequence assigns it on insert.
- **Test impact:** `tests/grading-suggestion-dedupe.test.ts` still passes; its `sleep` calls are now
  belt-and-braces rather than the only tie-break. A new test forces an equal-`createdAt` tie and
  asserts the later insert (`seq`) wins.

### 5. LTI registration and user mapping

- **Models:** `LtiRegistration` (`platformIssuer`, `clientId`, `deploymentId`, `keyId`,
  `privateKeyRef`, `lineItemsUrl`, `scopes`, `name`, `isActive`) and `LtiUserMapping`
  (`registrationId`, `studentId`, `ltiUserId`).
- **Secrets policy:** there is **no private-key column**. `privateKeyRef` is an opaque pointer (an
  env-var name, secret-manager ARN, or vault id); the PEM stays in the environment/secret store and
  is never stored or returned. This is stated in the schema comment, the contract, and the service.
- **Workaround replaced:** `ltiUserIds` was entirely request-supplied and the registration was read
  from env vars with no persistence.
- **Code migrated:** `lib/lms-export/registrations.ts` (read active registration, upsert,
  resolve mappings, save mappings for an owned offering's roster),
  `dryRunAgsPublishForTeacher` resolves each student as
  `request override → persisted LtiUserMapping → internal id` and reports which source was used in
  `userIdMapping` (`"provided" | "persisted" | "internal-id-fallback"`), and the persisted
  registration supplies `scopes`. New routes: `GET`/`PUT /api/teacher/export/lti/registration` and
  `GET`/`PUT /api/teacher/export/lti/mappings`.
- **Default when unset:** no mapping → the internal student id is used as the AGS `userId` (the
  previous fallback), and no registration means the env-driven config path is unchanged.

### 6. Per-assessment quiz attempt cap

- **Column:** `Assessment.maxAttempts` (`INTEGER` nullable).
- **Workaround replaced:** the cap was a server constant (`DEFAULT_MAX_ATTEMPTS = 3`) plus the
  `QUIZ_MAX_ATTEMPTS` env override, with nowhere to set it per assessment.
- **Code migrated:** `resolveMaxAttempts(assessmentMaxAttempts, raw)` is still the single bind
  point, with precedence **assessment column → `QUIZ_MAX_ATTEMPTS` → 3**. `lib/quiz-attempts/service.ts`
  selects `Assessment.maxAttempts` and passes it at all three call sites (`attemptSettings`,
  `listStudentQuizzes`, `startQuizAttempt`).
- **Default when unset:** `null` falls through to the env override, then 3. A malformed/non-positive
  value at either level is ignored so the cap can never be disabled. The env override still works
  exactly as before; only its precedence is now below the explicit per-assessment value.

## The seven deletions (and what had to be touched)

| Model                                   | Removed                          | Consumers handled                                                                                                                                                                                                                                                                   |
| --------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AttendanceSession`, `AttendanceRecord` | tables + `AttendanceStatus` enum | `prisma/seed.ts`, `app/api/auth/seed/route.ts`, `app/(dashboard)/admin/data/page.tsx`                                                                                                                                                                                               |
| `Stream`, `StudentStream`               | tables                           | `prisma/seed.ts` (replaced the stream grouping with a plain `humanities` boolean for the demo enrollment), admin data page                                                                                                                                                          |
| `CourseRating`                          | table                            | **The audit found live references the task table listed as zero:** the rating route, the teacher ratings report route + component + page, the student course-payload fields, the rating UI, and the `courseRatingRequestSchema` contract. All were removed. See "Deviations" below. |
| `CourseGradeHistory`                    | table                            | `prisma/seed.ts`, `app/api/auth/seed/route.ts`, admin data page                                                                                                                                                                                                                     |
| `ExternalReference`                     | table                            | `prisma/seed.ts`, admin data page                                                                                                                                                                                                                                                   |

Also removed: every `noSqlRefId` (from seed, auth-seed, and the admin page) and
`User.legacyPassword` (its only remaining reference was a comment, now corrected). The admin data
explorer no longer lists the deleted tables.

## Deviations / needs a human decision

- **`CourseRating` was not actually unreferenced.** The task table said 0 references, but a
  case-sensitive model-name search misses the generated-client calls (`prisma.courseRating`) and
  the surrounding feature. It had a student rating route, a teacher ratings report (route,
  component, page), payload fields, UI, and a request contract. Because the task requires the model
  deleted, all of those consumers were removed with it, and the `/teacher/reports` route and its
  menu entry were retired. If course ratings are still wanted as a product feature, they need to be
  rebuilt on a deliberate model — this is the one place where the requested deletion removed a
  user-facing feature.
- **`AssessmentGrade` retained** as instructed (LMS-export legacy fallback).
- **Legacy `Quiz`/`QuizQuestion`** retained (not in this task's deletion list).
- The admin datasets browser still exists for the live tables; only the deleted-table panels were
  removed (the Phase 4 doc plans to delete the whole browser later).

## From-empty deploy proof

Commands run against a dedicated database `assessment_schema_test` (name contains `test`; the
developer database `assessment_dashboard` was never touched).

```
$ DATABASE_URL=postgresql://assessment_user@127.0.0.1:5432/assessment_schema_test \
    npx prisma migrate deploy

2 migrations found in prisma/migrations
Applying migration `20260911180000_baseline`
Applying migration `20260912000000_schema_unfreeze`
All migrations have been successfully applied.
```

**Verified from empty: YES.** The database was created empty, `migrate deploy` applied the baseline
and then the new migration, and the resulting schema was diffed against the datamodel:

```
$ DATABASE_URL=…assessment_schema_test \
    npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code

[*] Changed the `MaterialChunk` table
  [-] Removed index on columns (embedding)
```

The only difference is the hand-written HNSW cosine index on `MaterialChunk.embedding`, which Prisma
cannot model because the column is `Unsupported("vector(1536)")`. The baseline migration documents
the same exception; it predates this change and is not caused by it. Excluding that known,
unrepresentable vector index, the migration chain builds exactly the datamodel.

The test harness itself proves the same thing on every run: `tests/global-setup.ts` drops `public`
and re-applies the committed migrations with `prisma migrate deploy` before the suite.

### Test counts

| Run                                                   | Result                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| Baseline (`HEAD` @ `bf6b3f2`, separate worktree + DB) | 76 test files: **74 passed, 2 skipped**; **458 passed, 5 skipped** |
| After the unfreeze (same harness, migrated DB)        | 77 test files: **75 passed, 2 skipped**; **467 passed, 5 skipped** |

Delta: +1 test file and +9 tests — the new `tests/schema-unfreeze.test.ts` (7) plus two extra
`resolveMaxAttempts` precedence cases. No test was deleted, skipped, or weakened.

Both runs provision their own database from the committed migrations. The two skipped files are the
Docker-backed sandbox suites (no Docker socket in the sandbox), as designed.

### Existing test updates (deliberate)

Two existing test files assert a workaround that this change replaces, so they were updated rather
than left to fail:

| File                                      | Change                                                                                                                                                                                                        | Why                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `tests/quiz-generation-pipeline.test.ts`  | Asserts `Question.status`/`publishedAt`/`publishedById` columns instead of `metadata.generationStatus`/`publishedAt`/`publishedByStaffId`; asserts the provenance envelope deliberately has **no** status key | The JSON keys were the workaround being removed.                          |
| `tests/quiz-attempts-eligibility.test.ts` | Calls `resolveMaxAttempts(assessmentCap, envRaw)` and adds precedence cases                                                                                                                                   | The single bind point gained the assessment column as its first argument. |

Everything else (including the legacy-JSON fallback) is covered by the new
`tests/schema-unfreeze.test.ts`, not by deleting assertions.

### Migration-is-the-diff evidence

Re-running the exact generating command and comparing it to the committed file is byte-identical
apart from the explanatory header comment and one trailing newline:

```
$ npx prisma migrate diff --from-schema <baseline schema> --to-schema prisma/schema.prisma --script
$ diff <committed migration minus header> <regenerated>
(no differences)
```

### Gates

| Command                                                                                                             | Result                                                 |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `npx tsc --noEmit`                                                                                                  | exit 0                                                 |
| `npm run verify`                                                                                                    | exit 0 (0 errors, 9 pre-existing warnings)             |
| `DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:59999/ci" SESSION_SECRET=x LLM_PROVIDER=mock npm run build` | exit 0 — compiled, all routes emitted                  |
| `DATABASE_URL=…assessment_schema_seed_check npx prisma db seed`                                                     | `Seed complete` (seed script migrated cleanly)         |
| `TEST_DATABASE_URL=…assessment_schema_test npm test`                                                                | exit 0 — 75 passed / 2 skipped files; 467 tests passed |

## Could not do / deferred

- **The Docker-backed sandbox tests** were skipped (no Docker socket); unrelated to this change.
- **No production data migration/backfill** was performed for `Question.status` or
  `AIGradeSuggestion.seq`; the columns are nullable/serial and readers fall back, so a backfill is
  optional and was left out.
- **No live LMS registration** exists to exercise a real AGS call; the dry run (`mode: "dry-run"`)
  remains network-free by design.
- **GitHub Actions CI** was not run (nothing was pushed).
