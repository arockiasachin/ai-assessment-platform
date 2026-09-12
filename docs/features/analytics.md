# Feature: analytics, item analysis, intervention alerts and adaptive retake (Phase 2, pod 5)

Item analysis from real quiz attempts, cohort distribution and pass rate,
threshold-driven intervention alerts for the owning teacher, and a targeted
adaptive retake containing only the questions a student failed.

Merged to `dev` in `6ffff60` (`feat(analytics): item analysis, intervention alerts and adaptive
retake`); the `p2/analytics` branch was deleted after merging.

## Goal and product rules

This pod implements product-spec §6 (analytics and intervention) and keeps the
rules it touches intact:

- **Only real attempts are analysed.** Indices come from `QuizAttempt` /
  `QuizResponse` rows, never from the model-generated `Question.difficulty`
  value or any client input.
- **Insufficient data is reported as such.** Below a documented minimum the
  index is `null` plus a reason, never a misleading number.
- **A teacher sees only their own offerings/assessments; a student only their
  own data.** Enforced with `requireRole` plus object-level ownership checks.
- **Nothing leaks the answer key.** Item-analysis payloads contain no
  correctness per student; the adaptive retake reuses the student-facing
  question serializer, which has no `correctOptionId` / `isCorrect` field.

## API surface

### Teacher — `app/api/teacher/analytics/**`

| Method + path                      | Input                                                         | Output                                                                                 |
| ---------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `GET /api/teacher/analytics`       | `?offeringId=` required; optional threshold overrides (below) | `{ success, offerings, offeringId, assessments[], alerts[], thresholds, generatedAt }` |
| `GET /api/teacher/analytics/items` | `?assessmentId=` required                                     | `{ success, assessment, cohort, items[], thresholds, generatedAt }`                    |

`assessments[]` carries `average` and `passRate` per assessment, built from each
student's **latest finalized** attempt (`SUBMITTED` or `GRADED`). `items[]`
carries the per-question difficulty and discrimination indices plus the
`insufficientData` flags and notes.

Threshold overrides are query params that override the offering's persisted
`CourseOffering.analyticsSettings` (added by `20260912000000_schema_unfreeze`, landed `759333b`):
`classAverageBelow`, `minClassSampleSize`,
`contributionShareAtLeast`, `minContributionEvents`, `pendingReviewsAtLeast`.
Out-of-range values are a 400.

### Student — `app/api/student/analytics/**`

| Method + path                       | Input                                                        | Output                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/student/analytics/retake` | `?assessmentId=` required, `?includeUnanswered=true\|false=` | `{ success, assessment, sourceAttemptId, questionIds[], failedQuestionIds[], unansweredQuestionIds[], questions[], previousResponses[], generatedAt }` |

Only the signed-in student's own latest finalized attempt is read, and the
request is refused (403) unless the student has an active `Enrollment` in the
assessment's offering.

## Exact formulae

### Difficulty index (`lib/analytics/item-analysis.ts`)

The classical test-theory item difficulty (facility) index is the proportion of
**answered** attempts that were correct:

```
facilityIndex  = correctCount / answeredCount
difficultyIndex = 1 - facilityIndex            // larger = harder, 0..1
```

Unanswered/blank responses are excluded from the denominator (they are reported
separately as `unansweredCount`) so a question everyone skipped is not mistaken
for one everyone failed. `correctCount`, `incorrectCount`, `answeredCount` and
`unansweredCount` are all returned so a teacher can see the sample the index is
built from.

### Discrimination index

The extreme-groups discrimination index D at 27%:

```
students ranked by total score on the assessment (descending; ties by ascending studentId)
groupSize  = max(1, min(round(n * 0.27), floor(n / 2)))
D = (correctInUpper / groupSize) - (correctInLower / groupSize)     // -1..1
```

An unanswered item counts as zero (no credit) for D, which is the standard 0/1
item score. Positive means high scorers answered correctly more often (the item
behaves), zero means uninformative, negative means it discriminates backwards.

### Small-sample policy

| Index          | Minimum               | Why                                                                                                                         |
| -------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Difficulty     | 10 answered responses | At 9 answered, one response moves the index by ~0.11 — larger than most hard/easy gaps, so it is not actionable.            |
| Discrimination | 20 scored responses   | 27% of 19 rounds to 5 per group, so one response shifts D by 0.2 and one outlier can flip its sign; 20 gives 5-6 per group. |

Below the minimum the field is `null`, `difficultyInsufficientData` /
`discriminationInsufficientData` is `true`, and a human-readable reason is added
to `notes`. The thresholds are exported as
`DEFAULT_ITEM_ANALYSIS_THRESHOLDS` and can be overridden in the pure function.

### Cohort distribution (`lib/analytics/cohort.ts`)

Per-student percentage is `sum(pointsAwarded) / maxScore * 100`, clamped to
`[0, 100]`, using the attempt's `maxScore` and falling back to
`Assessment.maxMarks`. `buildCohortDistribution` returns the count, average,
pass rate (default pass mark `>= 60%`), high/low, and an A/B/C/D/F histogram
using the same `letterGrade` bands as the gradebook. This builds on the
mark-map helpers in `lib/analytics/legacy.ts` (the original `lib/analytics.ts`).

### Intervention alerts (`lib/analytics/alerts.ts`)

Defaults in `DEFAULT_INTERVENTION_THRESHOLDS`:

| Alert                           | Fires when                                                                                                                                               | Boundary behaviour                           |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `class-average-below-threshold` | an assessment's cohort average is **strictly below** `classAverageBelow` (60) and at least `minClassSampleSize` (5) students have a finalized attempt    | average `== 60` does **not** fire; 59.9 does |
| `contribution-imbalance`        | one member holds `>= contributionShareAtLeast` (0.6) of the group's weighted contribution and has `>= minContributionEvents` (3) events in a group of 2+ | share `0.6` fires; `0.59` does not           |
| `pending-reviews`               | the offering's `PENDING` + `NEEDS_REVIEW` `GradeReview` count is `>= pendingReviewsAtLeast` (1)                                                          | count `1` fires; `0` does not                |

Severity is `warning` by default, `critical` for a class average 15+ points
under the threshold, a contribution share `>= 0.8`, or 10+ pending reviews.
Contribution imbalance is presented as evidence and its message states that
contribution is not a grade basis (aligned with the groups pod's
`CONTRIBUTION_EVIDENCE_NOTICE`).

### Adaptive retake (`lib/analytics/retake.ts`)

From the student's latest finalized attempt: a question is included when it was
answered incorrectly, or when it is unanswered and `includeUnanswered` is true
(the default). Selection preserves the assessment's question order. The service
serializes the chosen questions with `serializeQuestionForStudent`, which emits
no answer key.

## Scoping evidence

- `loadOwnedOffering` / `loadOwnedAssessment` (`lib/analytics/authz.ts`) read
  the teacher's `StaffProfile` from the signed session and require
  `offering.teacherId === staffId` (offering) or `createdById === staffId ||
offering.teacherId === staffId` (assessment). Otherwise 403.
- `resolveStudentProfile` plus an active-enrollment check on the
  assessment's offering gate the retake route.
- `tests/analytics-scoping.test.ts` proves a second teacher gets 403 from both
  `getTeacherAnalyticsOverview` and `getAssessmentItemAnalysisForTeacher` and
  that their own offering list is empty; a student calling a teacher function is
  refused; an unenrolled student is refused the retake.
- `tests/analytics-route-auth.test.ts` proves anonymous → 401 and student →
  403 on teacher routes (and teacher → 403 on the student route) **before** the
  service is invoked.

## Tests

| File                                    | Coverage                                                                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/analytics-item-analysis.test.ts` | Exact facility/difficulty proportions, blank exclusion, both small-sample guards, threshold override, D = +1 / -1 / 0, tie determinism.                                        |
| `tests/analytics-alerts.test.ts`        | Every alert fires below/at the boundary and does not fire just outside it; minimum sample and minimum event guards; composition order.                                         |
| `tests/analytics-retake.test.ts`        | Failed + unanswered selection, `includeUnanswered:false`, ordering, nothing-correct case, unknown ids ignored.                                                                 |
| `tests/analytics-scoping.test.ts`       | DB-backed: item indices from real attempts, cohort stats, all three alerts wired from DB state, adaptive retake from a real attempt, cross-teacher/student/unenrolled denials. |
| `tests/analytics-route-auth.test.ts`    | Route-level role enforcement and malformed-input 400s with the service mocked.                                                                                                 |
| `tests/fixtures/analytics.ts`           | Roster + four-question fixture and attempt recorder.                                                                                                                           |

## New files

- `lib/analytics/` — `legacy.ts` (moved from `lib/analytics.ts`), `item-analysis.ts`,
  `cohort.ts`, `alerts.ts`, `retake.ts`, `errors.ts`, `authz.ts`, `http.ts`,
  `service.ts`, `index.ts` (pure barrel).
- `lib/contracts/analytics.ts` and one re-export line in `lib/contracts/index.ts`.
- `app/api/teacher/analytics/route.ts`, `app/api/teacher/analytics/items/route.ts`,
  `app/api/student/analytics/retake/route.ts`.
- `components/teacher-analytics-dashboard.tsx`, `components/student-adaptive-retake.tsx`,
  `app/(dashboard)/teacher/analytics/page.tsx`, `app/(dashboard)/student/retake/page.tsx`.
- Tests listed above and `tests/fixtures/analytics.ts`.

## Shared files touched

- `lib/analytics.ts` → `lib/analytics/legacy.ts`. The old file was moved into the
  new `lib/analytics/` module and re-exported from its barrel, so existing
  imports (`components/gradebook-table.tsx`, `components/teacher-view.tsx`,
  `components/student-view.tsx`) are unchanged at the call site.
- `lib/contracts/index.ts` — one line: re-exports the analytics contract.
- `components/role-routes-menu.tsx` — two nav entries ("Analytics" for teachers,
  "Retake" for students).

`prisma/schema.prisma`, `prisma/migrations/**`, `package.json`, and
`package-lock.json` are unchanged.

## Deferred items and limits

- **Thresholds are persisted per offering, with per-request overrides.**
  `CourseOffering.analyticsSettings` (added by `20260912000000_schema_unfreeze`,
  `759333b`) stores the intervention and item-analysis thresholds. Resolution is
  code default ← persisted setting ← query-param override, and `GET`/`PUT
/api/teacher/analytics/settings` read and write the stored values.
- **Extreme-groups D only.** No point-biserial correlation or distractor
  analysis yet; the 27% method matches the classic "discrimination index" but
  is noisy below ~30 responses even though the floor is 20.
- **Only finalized attempts count.** `IN_PROGRESS`, `EXPIRED` and `ABANDONED`
  attempts are excluded from every index.
- **Latest attempt per student.** A student who retakes an assessment
  contributes only their latest finalized attempt, so the cohort view is
  one-row-per-student rather than attempt-weighted.
- **No submit endpoint for the retake.** This pod selects and serializes the
  questions; turning them into a new graded attempt is the quiz-taking pod's
  existing flow. The student UI presents the targeted set and links the student
  to their assessments.
- **Pass mark fixed at 60%.** The cohort pass rate reuses the app-wide 60%
  convention; it is not yet configurable per assessment.
- **`GradeReview` "pending" is offering-wide** rather than per-assessment on the
  overview, matching the "review queue" acceptance criterion.
