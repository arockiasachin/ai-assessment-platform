# Feature: short-answer partial credit through the review queue

A student can now answer `SHORT_ANSWER` / `ESSAY` questions with prose. The
answer is scored for **partial credit**, and that score is routed through the
existing human review queue as an `AIGradeSuggestion` on a `GradeReview`. Nothing
auto-publishes: only a teacher `accept`/`override` in
`lib/grading/review-service.ts` sets `Grade.publishedAt`.

The schema already supported this (`QuizResponse.answerText`,
`QuizResponse.pointsAwarded`, nullable `QuizResponse.isCorrect`,
`QuizResponse.rationale`, `QuizResponse.aiGradeSuggestions`, and
`Question.explanation` as the reference answer), so **no migration was needed**.

## The scoring mechanism, and why

Two scorers exist, and they are deliberately linked:

1. **Semantic grade (primary).** `lib/quiz-attempts/text-grader.ts` asks the
   platform LLM (`lib/llm/**`, task tag `quiz-grading`) to compare the student's
   answer to the reference answer and return
   `{ similarity: 0..1, rationale, confidence }`. Natural-language equivalence
   ("storing energy in chemical bonds" ≈ "keeps the energy in bonds") is exactly
   what a lexical metric misses, and the platform's model surface is the right
   tool for it.
2. **Deterministic lexical score (documented fallback).** `lib/text-similarity.ts`
   computes the Dice coefficient over content-word sets blended with word-bigram
   Dice; `lib/quiz-scoring-text.ts` turns it into points. If the provider throws
   or returns unparseable JSON, the submission still scores reproducibly instead
   of failing. Under `LLM_PROVIDER=mock` the mock provider answers the
   `quiz-grading` task with this _same_ function, so end-to-end tests exercise
   real partial-credit behaviour (perfect match → 1.0, unrelated → 0) rather than
   a fixed constant.

Both paths produce the same three things, and the rules are pure and unit-tested:

```
similarity = similarity(studentAnswer, referenceAnswer)   // [0, 1], clamped
eligible   = similarity >= threshold
points     = eligible ? clamp(round(similarity × maxPoints), 0, maxPoints) : 0
```

- **Threshold.** `QUIZ_TEXT_SIMILARITY_THRESHOLD` (default **0.35**, see
  `DEFAULT_TEXT_SIMILARITY_THRESHOLD`). Below it the answer scores **zero**, not
  a token amount. An unset, non-numeric, or out-of-range value falls back to the
  default so the gate can never be silently disabled.
- **Clamping.** A similarity of 1.0 (or an over-generous/over-confident model
  response) can never award more than `Question.points`, and nothing goes
  negative; an out-of-range `similarity` fails the response schema and falls back
  to the deterministic score.
- **Evidence.** Every free-text suggestion stores the student's verbatim answer
  as `AIGradeSuggestion.evidence`, the model's justification as `rationale`, and
  the `confidence`, `model`, `promptVersion` (`quiz-text-grading-v1`) and
  `latencyMs` — the same explainability envelope rubric grading uses.
- **Prompt-hackability.** The dissertation flagged this risk, so it is mitigated
  in layers: (a) the answer is never trusted for correctness; (b) a narrow
  injection heuristic (`ignore previous instructions`, `give me full marks`, …)
  caps a suspicious response at its lexical similarity and drops its confidence,
  so it is `NEEDS_REVIEW`/low-confidence rather than high-scoring; and (c) most
  importantly, **nothing is published without a teacher**. The model is advice,
  not the grade.

## What the student sees before vs after review

| Stage                               | Student-visible                                                                                                                                                                                                                                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before submission                   | `type`, prompt, `points`, and (for choice questions) option text. **No** `correctIndex`, `correctOptionId`, `isCorrect`, `similarity`, or `explanation` (the reference answer).                                                                                                                     |
| Immediately after submission        | A **provisional, clearly-labelled** per-question figure: `Suggested X/Y (partial credit is a suggestion awaiting teacher approval)` plus the grader's rationale. The reference answer is disclosed only here, post-submission. The submit response says the score is a suggestion pending approval. |
| Awaiting manual scoring             | For a text answer with no reference answer: `Awaiting teacher scoring.` and no numeric suggestion.                                                                                                                                                                                                  |
| After a teacher `accept`/`override` | The published `Grade` is what the gradebook/analytics use. The attempt view still shows the per-question provisional figures.                                                                                                                                                                       |

The student is never told a mark is final before review: the UI copy, the API
message, and the `needsManualReview` flag all say the score is a suggestion.
`attempt.score` is persisted so the runner can render a provisional total, but
`Grade.publishedAt` stays `null` until a human acts.

## No-reference-answer behaviour

`Question.explanation` is the reference answer. If it is `null`/blank, the
feature **does not invent one**: the answer is persisted with
`pointsAwarded: null` and `isCorrect: null`, the response result carries
`needsManualReview: true`, and an `AIGradeSuggestion` with
`model: "manual-review-required"` and `confidence: 0` is written so the answer
lands in the review queue with the quoted prose and an explicit rationale. The
student sees `Awaiting teacher scoring.`

## Review-queue wiring and the dedupe invariant

Choice-only quizzes keep the original **single** whole-quiz suggestion
(`criterionLabel: "Quiz score"`). When a quiz contains any free-text question,
each score-bearing answer is written as its own `AIGradeSuggestion` keyed by
`quizResponseId`, carrying that answer's evidence, and the per-question points
are projected so their sum equals the kernel's rounded total
(`projectPerQuestion`, largest-remainder to the cent).

This is deliberate: the per-response bucket is what lets a teacher contest one
answer. But a `quizResponse` bucket key is unique to one attempt's response row,
so a re-attempt would otherwise leave the previous attempt's buckets in place and
`latestSuggestionTotals` would sum both. `recordTextQuizSuggestions` therefore
**deletes the previous per-response suggestions** before writing the new ones —
the same "supersede, never double-count" semantics the constant whole-quiz label
bucket gets for free (bug-fix runs 1/3). The audit trail for the removed
suggestions remains in `AuditLog`.

Published grades are untouched: `recordAiSuggestion` only refreshes an
unpublished draft, and `submitReviewDecision` is the only writer of
`Grade.publishedAt`. The uniqueness invariant (`@@unique(assessmentId,
studentId)` on `Grade`) is respected through upserts, so re-scoring never
surfaces a raw `P2002`.

## Code map

| Concern                                             | Where                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| Answer/result contracts, max length                 | `lib/contracts/quiz.ts` (`MAX_ANSWER_TEXT_LENGTH` = 10,000)        |
| Pre-submission question shape (`type`)              | `lib/contracts/quiz-attempts.ts`, `lib/quiz-attempts/serialize.ts` |
| Choice + text scoring kernel                        | `lib/quiz-scoring.ts`                                              |
| Threshold, deterministic score, projection          | `lib/quiz-scoring-text.ts`                                         |
| Neutral lexical similarity                          | `lib/text-similarity.ts`                                           |
| LLM semantic grade + fallback                       | `lib/quiz-attempts/text-grader.ts`                                 |
| Suggestion/review wiring                            | `lib/quiz-attempts/text-suggestions.ts`                            |
| Validation + orchestration                          | `lib/quiz-attempts/service.ts`                                     |
| Deliverability (text questions exempt from options) | `lib/quiz-attempts/metadata.ts`                                    |
| Student prose entry                                 | `components/student-quiz-attempts.tsx`                             |

## Validation rules

Server-side, against the question type — never trusting the client:

- prose for a choice question → `400`;
- a selected option for a text question → `400`;
- both `selectedIndex` and `answerText` in one answer → `400`;
- empty/whitespace-only prose → `400`;
- prose longer than `MAX_ANSWER_TEXT_LENGTH` (10,000 chars) → `400` at the
  contract boundary.

## Limits and deferred items

- **The legacy preview grader (`POST /api/quiz/grade`) still assumes options.**
  A text question there is rejected as "no correct option". The student attempt
  pipeline is the supported path; the preview route is not a publishing path.
- **Similarity is an imperfect proxy.** A correct paraphrase with little lexical
  overlap can score below the threshold when the model is unavailable (fallback),
  and a wrong answer that echoes reference vocabulary can score above it. This is
  why the score is a suggestion and a teacher reviews it.
- **Threshold is global, not per-question.** It is an environment setting; a
  per-question override would need a column the schema does not have.
- **Manual-review suggestions score zero in the draft.** An unscored free-text
  question contributes 0 until a teacher overrides, and the suggestion is marked
  low-confidence so the queue surfaces it.
- **`QuizResponse` does not persist `similarity`/`confidence`.** They live on the
  suggestion (`AIGradeSuggestion`) and `rawResponse`, not on the response row; the
  student/teacher result views therefore report `similarity: null`.
- **N suggestion transactions for N answers.** Free-text quizzes write one
  `recordAiSuggestion` per scored answer so each carries its own evidence; this is
  more transactions than the single choice-only bucket.
