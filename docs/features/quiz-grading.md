# Feature: quiz attempt persistence and grading (Phase 2, final pod)

A student can take and submit a quiz, the answers are scored server-side and
persisted, and the outcome flows into the existing human grade-approval pipeline
as a **suggestion only**. Nothing in this pod publishes a grade.

Merged to `dev` in `a21ee3b` (`feat(quiz-grading): persist quiz attempts through the grade
pipeline`); the `p2/quiz-grading` branch was deleted after merging.

## Goal and product rules

This pod completes the delivery half of product-spec §2 (quiz grading) on top of
the `Question` / `QuestionOption` / `QuizAttempt` / `QuizResponse` spine. It keeps
the two non-negotiable rules it touches intact:

- **Grading is server-authoritative.** Correctness is derived only from
  `QuestionOption.isCorrect` on the server, through the existing kernel
  (`lib/quiz-scoring.ts`) via the reuse point `lib/quiz-generation/grading.ts`
  (`gradeGeneratedQuiz`). No client-side correctness logic exists, and the
  pre-submission payload carries no answer key and no explanation.
- **Teacher approves every grade.** Submission writes a deterministic
  `AIGradeSuggestion` and a `GradeReview` in `PENDING`; only a human
  `accept`/`override` sets `Grade.publishedAt`.

## API surface

Student routes are `requireRole("student")` **plus** an active-enrollment check
and ownership of the attempt. Teacher routes are `requireRole("teacher")` plus an
object-level ownership check (`Assessment.createdById === staffId` or
`offering.teacherId === staffId`).

| Method + path                                        | Input                                          | Output                                                                                           |
| ---------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `GET /api/student/quiz-attempts`                     | —                                              | `{ success, quizzes: StudentQuizSummary[] }` (enrolled quizzes, attempt budget, deadline)        |
| `GET /api/student/quiz-attempts?assessmentId=`       | query                                          | `{ success, attempts: QuizAttemptSummary[] }` (the student's own history for that quiz)          |
| `POST /api/student/quiz-attempts`                    | `{ assessmentId }`                             | `{ success, attempt }` — starts **or resumes** an in-progress attempt                            |
| `GET /api/student/quiz-attempts/[attemptId]`         | path                                           | `{ success, attempt }` — key-free questions pre-submission; per-question results post-submission |
| `POST /api/student/quiz-attempts/[attemptId]/submit` | `{ answers: [{ questionId, selectedIndex }] }` | `{ success, message, attempt }` — persists responses, scores, records the suggestion             |
| `GET /api/teacher/quiz-attempts?assessmentId=`       | query                                          | `{ success, attempts: TeacherQuizAttemptSummary[] }` — owned assessment only                     |
| `GET /api/teacher/quiz-attempts/[attemptId]`         | path                                           | `{ success, detail }` — responses with the answer key + review/grade state, owned only           |

Error mapping is the shared convention: domain errors keep their status, zod
errors are 400, database errors are logged and reduced to a generic 500
(bug-fix run 1, BUG-4).

## How scoring and persistence work

1. `startQuizAttempt` resolves the student from the signed session, loads the
   assessment from the database, checks active enrollment and that the type is
   `QUIZ`, then checks **deliverability** (see below). An existing `IN_PROGRESS`
   attempt is resumed instead of creating a new one. Otherwise the attempt cap and
   deadline are evaluated, an `attemptNumber` is assigned, and a `QuizAttempt`
   row plus a `quiz_attempt.started` audit row are written in one transaction.
2. `getStudentAttempt` returns the questions through
   `serializeStudentQuestion`, which has **no** `correctIndex`,
   `correctOptionId`, `isCorrect`, or `explanation` field. `results` is `null`
   until submission.
3. `submitQuizAttempt` projects the assessment's `Question` / `QuestionOption`
   rows into `ScorableQuizQuestion` and calls the existing `gradeGeneratedQuiz`.
   It validates that every answer references a real question and that
   `selectedIndex` is in range, then in one transaction writes the
   `QuizResponse` rows, updates the attempt (`SUBMITTED`, score, `maxScore`,
   `submittedAt`), and writes an audit row. A status-guarded `updateMany`
   prevents two concurrent submits from both persisting.
4. The per-question results are stored as `QuizResponse` rows and re-derived on
   read from the server key, so the disclosure always reflects the authoritative
   answer key. An unanswered question is persisted with `isCorrect: null` (not
   `false`) so the analytics item-analysis and adaptive-retake paths can tell
   "wrong" from "skipped".
5. Finally the score is recorded with `recordAiSuggestion` (see below).

## How the grade pipeline is wired (never auto-publishing)

The attempt's score is written as one `AIGradeSuggestion`:

- `criterionLabel: "Quiz score"` — a **constant** per assessment/student. This is
  the stable dedupe bucket from bug-fix run 1: `lib/grading` sums the latest
  suggestion per bucket, so a later attempt **supersedes** the previous draft
  instead of adding the two attempts together.
- `model: "deterministic-auto-scorer"`, `promptVersion: "quiz-scoring-v1"`,
  `confidence: 1` — the source/kind reflects a deterministic auto-scorer, not an
  LLM.
- `rationale` names the correct count and whether the submission was late;
  `rawResponse` carries the attempt id, counts, and late flag.

`recordAiSuggestion` creates/reopens the `GradeReview` (`PENDING`) and refreshes
the **unpublished** draft `Grade` (`source: AI_SUGGESTED`). A published grade is
never touched. Only the human `accept`/`override` actions in
`lib/grading/review-service.ts` set `publishedAt`; tests assert that the
auto-scorer produces zero `grade.published` audit rows and that a later attempt
cannot change a published grade.

## Attempt rules and defaults

| Rule                   | Default / behaviour                                                                                                                                                                        | Where it lives                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| Maximum attempts       | **3** (`DEFAULT_MAX_ATTEMPTS`), single override `QUIZ_MAX_ATTEMPTS`; a malformed/`< 1` value falls back to 3 so the cap can never be disabled                                              | `lib/quiz-attempts/eligibility.ts`  |
| Cap status code        | `429` once `attemptsUsed >= maxAttempts`                                                                                                                                                   | `lib/quiz-attempts/service.ts`      |
| Deadline (new attempt) | Starting a new attempt after `Assessment.dueDate` is blocked with `409`                                                                                                                    | `evaluateAttemptEligibility` (pure) |
| Late submission        | An attempt already started may be submitted after the due date; the response sets `isLate: true`, the audit action is `quiz_attempt.submitted_late`, and the suggestion rationale notes it | `isLateSubmission` + service        |
| Immutable submission   | A non-`IN_PROGRESS` attempt (or one with responses) rejects a second submit with `409`                                                                                                     | `submitQuizAttempt`                 |
| Resume                 | `POST /api/student/quiz-attempts` returns the existing `IN_PROGRESS` attempt rather than burning a new one on a refresh                                                                    | `startQuizAttempt`                  |
| Deliverability         | A quiz needs at least one question, every generated question must be `published` (not a `quiz-generation` draft), and every question must have exactly one correct option                  | `lib/quiz-attempts/metadata.ts`     |

### Published-quiz detection

`prisma/schema.prisma` is frozen and there is no assessment-level publish flag,
so "published quiz" reuses the quiz-generation pod's `Question.metadata`
envelope: a question with `generator: "quiz-generation"` is deliverable only when
`generationStatus === "published"`; a question without that marker is
hand-authored and treated as published. This is the same rule the generation pod
documents.

## Adaptive-retake compatibility

`QuizResponse.selectedOptionIds` stores the selected `QuestionOption.id` as a
one-element array (empty for unanswered), and `isCorrect` is `true` / `false` /
`null`. Those are exactly the columns the existing analytics service already
reads, so `GET /api/student/analytics/retake` works unchanged against persisted
attempts. `latestFailedQuestionIds` demonstrates the reuse: it loads the latest
finalized attempt's responses and delegates to `selectAdaptiveRetakeQuestions`
from `lib/analytics/retake.ts` — the selector logic is not duplicated. A test
asserts a persisted wrong answer feeds `failedQuestionIds` and that
`listStudentRetakableAssessmentsForStudent` reports the right failed/unanswered
counts.

## Answer-key handling

- `serializeStudentQuestion` emits only `id`, `order`, `prompt`, `points`, and
  `options[{ id, order, text }]`. A test asserts the pre-submission payload
  contains neither `correctIndex`, `correctOptionId`, `isCorrect`,
  `selectedIndex`, nor the explanation text.
- Only the post-submission `results` (the existing `quizQuestionResultSchema`)
  disclose correctness, the student's answer, the correct answer, and the
  explanation.
- `serializeTeacherResponse` is the only serializer that emits a
  `correctOptionId`, and it is reachable only behind `requireRole("teacher")`
  plus an ownership check.

## Legacy `Quiz` / `QuizQuestion` path

This pod persists against the Phase-1 `Question` / `QuestionOption` spine (the
same rows the quiz-generation pod creates). The legacy `Quiz` / `QuizQuestion`
model and `POST /api/quiz/grade` are untouched; they remain server-authoritative
and are not used by the new delivery routes.

## Deferred items and limits

- **Per-assessment attempt cap needs a migration.** There is no assessment-level
  JSON metadata column (`Assessment` has none; only `Question.metadata` /
  `Group.metadata` / `CodeTask.metadata` / `Rubric.metadata` exist), so a
  per-assessment override cannot be stored without a schema change. The cap is a
  documented server constant plus `QUIZ_MAX_ATTEMPTS`; `resolveMaxAttempts` is
  the single place to bind a real `Assessment.metadata` column once the schema is
  unfrozen. **This is the one schema gap this pod reports.**
- **Results are re-derived from the current answer key on read.** If a teacher
  edits a question after submission, the displayed per-question feedback reflects
  the new key while the persisted draft/published grade reflects the score at
  submission time. No teacher-facing key editing exists in this pod.
- **No partial credit.** Scoring is exact-match multiple choice, per product-spec
  §2; the optional short-answer similarity threshold is a separate item.
- **Teacher UI is read-only here.** Teachers can list and inspect attempts with
  the answer key, but approval still happens through the existing review routes /
  UI.
- **`QuizAttempt.expiresAt` is not used.** There is no timed-attempt feature in
  scope; the deadline is the assessment's `dueDate`.
- **Late attempts are flagged, not penalised.** No grade adjustment is applied
  for lateness; the flag is evidence for the teacher.
