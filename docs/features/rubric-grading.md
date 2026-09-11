# Feature: rubric grading (Phase 2, pod 3)

Descriptive grading against teacher-authored weighted rubrics, with per-criterion
AI suggestions and a teacher review queue. This is the pod that makes the
"AI produces suggestions, a human approves every grade" rule concrete for
free-text work.

Merged to `dev` in `d5f949b` (`feat(rubric-grading): weighted rubrics, per-criterion AI
evaluation, review queue`); the branch was cut from `dev` at `8e46b12` and deleted after merging.

## What it does

1. A teacher authors a weighted rubric for an assessment they own.
2. For one student submission, the model scores **each criterion separately**
   and returns a score, a rationale, a quoted evidence span, and a confidence.
3. Low-confidence criteria, unverified evidence, ceiling-clamped scores, and
   statistical-outlier totals move the submission to `NEEDS_REVIEW`.
4. A teacher lists the queue, inspects the per-criterion suggestion, then
   accepts, overrides (with a reason), rejects, or flags.
5. Only `accept` / `override` publish a `Grade`. A model output can never
   overwrite a published grade.

## New files

### Library — `lib/rubric-grading/`

| File                    | Responsibility                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `contracts.ts`          | Zod schemas for rubric upsert, rubric/queue responses, and evaluation requests. Reuses the Phase 1 decision schema. |
| `errors.ts`             | `RubricGradingError` (status-carrying), `RubricValidationError`, `CriterionParseError`.                             |
| `validation.ts`         | Pure rubric coherence checks (criteria, labels, weights, points, levels, totals, assessment ceiling).               |
| `parsing.ts`            | Extracts JSON from the model response and validates score / rationale / quoted evidence / confidence.               |
| `flagging.ts`           | Pure confidence + cohort-outlier heuristics (`collectFlagReasons`).                                                 |
| `rubric-service.ts`     | Teacher-owned rubric list / get / upsert (transactional, audited, freezes published rubrics).                       |
| `evaluation.ts`         | Per-criterion evaluation loop; calls `lib/llm/**` once per criterion and records suggestions.                       |
| `review-transitions.ts` | `flagReviewForAi`: the audited `NEEDS_REVIEW` transition (skips published grades).                                  |
| `review-queue.ts`       | Teacher-scoped queue, detail, and evaluation-candidate read models.                                                 |
| `serialize.ts`          | Response serializers and the AI-flag reader for `GradeReview.decisionsJson`.                                        |
| `http.ts`               | Maps thrown errors to JSON responses without leaking database internals (BUG-4).                                    |
| `index.ts`              | Barrel export.                                                                                                      |

### API — `app/api/teacher/**`

| Method + path                                          | Purpose                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| `GET /api/teacher/rubrics`                             | Teacher's assessments, each with its rubric or `null`.                    |
| `POST /api/teacher/rubrics`                            | Create/replace a weighted rubric (validated + ownership-checked).         |
| `GET /api/teacher/rubrics/[assessmentId]`              | One owned assessment and its rubric.                                      |
| `GET /api/teacher/reviews`                             | Review queue; `?status=PENDING                                            | NEEDS_REVIEW | all`, `?assessmentId=`. |
| `GET /api/teacher/reviews/candidates`                  | Submissions on rubric-bearing assessments, for "evaluate".                |
| `POST /api/teacher/reviews/evaluate`                   | Run per-criterion AI evaluation for one `submissionId` (never publishes). |
| `GET /api/teacher/reviews/[assessmentId]/[studentId]`  | Per-criterion detail (rubric internals visible to owner only).            |
| `POST /api/teacher/reviews/[assessmentId]/[studentId]` | Apply a human decision (`accept`/`override`/`reject`/`flag`/`reopen`).    |

### UI — `app/(dashboard)/teacher/{rubrics,reviews}` + `components/`

- `components/teacher-rubric-editor.tsx` — client form for rubric authoring.
- `components/teacher-review-queue.tsx` — client queue with criterion cards,
  evidence quotes, confidence badges, and accept/override/reject/flag controls.
- Pages are Server Components that load data server-side and pass it to the
  client components; mutations call `router.refresh()`. No fetch-on-mount, so the
  pod adds no `react-hooks/set-state-in-effect` warnings.

### Shared file touched

- `components/role-routes-menu.tsx` — added two teacher nav entries ("Rubrics",
  "Reviews"). No other shared file changed.

## How per-criterion scoring, evidence, and confidence work

`evaluateSubmissionForTeacher` (in `evaluation.ts`):

1. Loads the submission, its assessment, and the rubric criteria (ordered).
2. For **each criterion** builds a one-criterion prompt
   (`buildCriterionPrompt`) and calls the injected `LlmProvider` (default
   `getLlmProvider()`, `task: "rubric-grading"`, `json: true`, temperature 0).
3. Parses the response with `parseCriterionEvaluation`:
   - **score** — finite, non-negative, clamped to the criterion ceiling; clamping
     is recorded as a flag reason.
   - **rationale** — required, non-empty.
   - **evidence** — required, non-empty; verified as a whitespace/case-normalized
     substring of the student's text. Unverified evidence is a flag reason.
   - **confidence** — required, in `[0, 1]`.
   - Anything unparseable raises `CriterionParseError` (HTTP 502); we never invent
     a score.
4. Persists each one through `recordAiSuggestion`, which stores the model,
   `promptVersion` (`rubric-grading-v1`), token counts, latency, and raw response
   on the `AIGradeSuggestion` row and writes an `AuditLog` row in the same
   transaction.
5. Refreshes the **unpublished draft** `Grade` from the latest suggestion per
   logical bucket, then, if any flag reason exists, transitions the review to
   `NEEDS_REVIEW` (audited). A published grade is left untouched.

`the rubric is the binding contract`: the stored score can never exceed the
criterion's `maxPoints`, and `resolveMaxPoints` caps the draft total at
`Rubric.maxPoints`.

## Human-approval invariant (evidence)

The invariant is enforced in `lib/grading/review-service.ts` (Phase 1, unchanged
by this pod) and exercised by the new pipeline tests:

- `recordAiSuggestion` returns the existing grade untouched when
  `publishedAt != null` and deliberately does not re-audit it.
- `submitReviewDecision` is the only code path that sets `Grade.publishedAt`, and
  only for `accept` / `override`. `ReviewDecision` validation lives in
  `lib/contracts/grading.ts`.
- `flagReviewForAi` refuses to move a review whose status is a publishing status.

Tests in `tests/rubric-grading-pipeline.test.ts`:

- after evaluation, `grade.publishedAt` is `null`;
- `accept` sets `publishedAt` and `approvedById` via the signed session, not the
  request body;
- a later model run leaves the published points and `publishedAt`
  byte-for-byte identical, and `grade.published` is audited exactly once;
- `override` publishes `TEACHER_OVERRIDE` with its reason, and an override above
  the ceiling is rejected;
- flagging never publishes.

## Respecting bug-fix run 1 (no double counting)

`AIGradeSuggestion.rubricCriterionId` is the bucket key `latestSuggestionTotals`
already dedupes on, so re-running evaluation supersedes the previous score for a
criterion instead of summing history. Tested directly:

- evaluating twice yields unchanged draft points (7 + 6 stays 13, not 26) while
  four suggestion rows remain for auditability;
- the review queue returns exactly one suggestion per criterion (the latest).

Rubric re-authoring is a second way to create two buckets for one criterion
because deleting a criterion nulls its suggestions' `rubricCriterionId`. To keep
the dedupe contract, `upsertRubricForTeacher` refuses to edit a rubric once any
grade for the assessment is published (409) and, while nothing is published,
deletes the AI drafts scored against the replaced criteria in the same
transaction. The audit trail for those suggestions remains.

## Authorization

- All routes use `requireRole("teacher")`; the reviewer identity comes from the
  signed session.
- `resolveTeacherStaffId` + `teacherOwnsAssessment` check `createdById` **or**
  `offering.teacherId`. A teacher only sees their own offerings' submissions.
- Students have no route that returns rubric internals, suggestions, or other
  students' work. `resolveTeacherStaffId` rejects a non-teacher with 403.
- Tests: a second teacher gets 403 on evaluate, 404 on review detail, and an
  empty queue; a student gets 403.

## Rubric coherence rules

Enforced by `validateRubricCoherence` before any write:

- at least one criterion (and at most 50);
- unique criterion labels and unique level labels within a criterion;
- positive, finite weight (`≤ 1000`) and point ceiling per criterion;
- level points cannot exceed the criterion ceiling;
- an explicit rubric total must equal the sum of criterion points;
- the total cannot exceed the assessment's `maxMarks`.

All thresholds and the pure functions are unit tested in
`tests/rubric-validation.test.ts`.

## Tests

| File                                     | Coverage                                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| `tests/rubric-validation.test.ts`        | Coherence rules, zod boundaries, weight sanity.                                               |
| `tests/rubric-criterion-parsing.test.ts` | JSON/fence extraction, clamping, evidence verification, parse failures.                       |
| `tests/rubric-flagging.test.ts`          | Confidence, cohort stats, outlier detection, reason collection.                               |
| `tests/rubric-grading-pipeline.test.ts`  | DB-backed: per-criterion records, dedupe, approval invariant, flagging, authz, rubric freeze. |

## Deferred / known limits

- **UI is functional, not polished.** The review queue shows the latest
  suggestion per criterion inline; a richer side-by-side diff of submission vs.
  evidence is Phase 3 polish.
- **Second-marker sampling** (product spec, rubric grading) is not implemented;
  it is a separate workflow on top of the review states.
- **Override calibration across batches** (rule 5) is recorded
  (`overrideReason`) but not yet fed back into prompts.
- **Cohort outliers** compare against current `Grade` totals for the assessment
  (drafts included) with population σ, `z ≥ 2`, and a minimum cohort of 5. The
  thresholds are constants in `flagging.ts`.
- **Model quality** is not proven here; a human-labeled fixture set and agreement
  score remain a Phase 3 deliverable.
- The `rubric-grading` evaluation runs one LLM call per criterion, which is
  intentionally simple and explainable rather than the cheapest batching.
