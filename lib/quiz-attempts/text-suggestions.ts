import {
  QUIZ_ATTEMPT_CRITERION_LABEL,
  QUIZ_AUTO_SCORER_MODEL,
  QUIZ_SCORING_PROMPT_VERSION,
} from "@/lib/contracts/quiz-attempts"
import type { QuizQuestionResult } from "@/lib/contracts/quiz"
import { recordAiSuggestion } from "@/lib/grading"
import { prisma } from "@/lib/prisma"
import { isTextQuestionType, normalizeQuestionPoints } from "@/lib/quiz-scoring"
import { projectPerQuestion } from "@/lib/quiz-scoring-text"

import type { QuestionWithOptions } from "./serialize"
import {
  QUIZ_TEXT_DETERMINISTIC_MODEL,
  QUIZ_TEXT_PROMPT_VERSION,
  type TextGradeResult,
} from "./text-grader"

/**
 * Grade-pipeline wiring for a quiz that contains free-text questions.
 *
 * Each answer that carries a score or free-text evidence is written as its own
 * `AIGradeSuggestion` (keyed by `quizResponseId` so the teacher sees the quoted
 * answer, the rationale, the confidence, the model and the prompt version) and
 * lands on the single `GradeReview`. Nothing here publishes: only a human
 * `accept`/`override` in `lib/grading/review-service.ts` sets
 * `Grade.publishedAt`.
 *
 * Why per-response instead of one whole-quiz bucket? Evidence. A model-graded
 * free-text answer must be contestable per answer, and `QuizResponse` is the
 * row that owns the student's prose. The projection distributes the kernel's
 * rounded total across the responses so the summed draft grade stays exactly
 * the score the deterministic path would have produced.
 */

/** The `AIGradeSuggestion.model` marker for a free-text answer with no reference answer. */
export const QUIZ_MANUAL_REVIEW_MODEL = "manual-review-required"

export type RecordTextQuizSuggestionsInput = {
  assessmentId: string
  studentId: string
  attemptId: string
  attemptNumber: number
  questions: readonly QuestionWithOptions[]
  results: readonly QuizQuestionResult[]
  /** The persisted `QuizResponse.id` per question, for the suggestion's bucket key. */
  responseIdByQuestion: Map<string, string>
  textGrades: Map<string, TextGradeResult>
  manualQuestionIds: Set<string>
  /** The kernel's integer total score; the awarded shares sum to this exactly. */
  targetScore: number
  maxScore: number
  late: boolean
}

export async function recordTextQuizSuggestions(
  input: RecordTextQuizSuggestionsInput,
): Promise<void> {
  // Supersede, never double-count. A `quizResponse`-keyed bucket is unique to
  // one attempt's response row, so a re-attempt would otherwise leave the prior
  // attempt's buckets in place and `latestSuggestionTotals` would sum both.
  // Removing the previous per-response suggestions makes the newest attempt the
  // only contributor — the supersede semantics the constant whole-quiz label
  // bucket gets for free.
  await prisma.aIGradeSuggestion.deleteMany({
    where: {
      assessmentId: input.assessmentId,
      studentId: input.studentId,
      quizResponseId: { not: null },
    },
  })

  const weights = input.questions.map((question) =>
    normalizeQuestionPoints(Number(question.points)),
  )
  const points = input.results.map((result) => Math.max(0, result.points))
  const { awarded, ceilings } = projectPerQuestion({
    points,
    weights,
    maxScore: input.maxScore,
    targetScore: input.targetScore,
  })

  const actor = { role: "system" as const }
  let created = 0

  for (let index = 0; index < input.questions.length; index += 1) {
    const question = input.questions[index]
    const result = input.results[index]
    const responseId = input.responseIdByQuestion.get(question.id)
    if (!responseId) continue

    const isText = isTextQuestionType(question.type)
    const manual = input.manualQuestionIds.has(question.id)
    const answerText = result.answerText?.trim() ?? ""
    const hasAnswer = answerText.length > 0

    // A suggestion is written when it contributes points, or when it is a
    // free-text answer whose quoted evidence the teacher must see — even if it
    // scored zero or is awaiting manual scoring.
    if (awarded[index] <= 0 && !(isText && hasAnswer)) continue

    const base = {
      assessmentId: input.assessmentId,
      studentId: input.studentId,
      quizResponseId: responseId,
      criterionLabel: `Question ${question.order}`,
      suggestedPoints: awarded[index],
      maxPoints: ceilings[index],
    }

    if (manual) {
      await recordAiSuggestion(
        {
          ...base,
          rationale: `No reference answer is configured for Question ${question.order}; a teacher must score this answer manually.`,
          evidence: hasAnswer ? answerText : undefined,
          confidence: 0,
          model: QUIZ_MANUAL_REVIEW_MODEL,
          promptVersion: QUIZ_SCORING_PROMPT_VERSION,
          latencyMs: 0,
          rawResponse: {
            attemptId: input.attemptId,
            attemptNumber: input.attemptNumber,
            manualReview: true,
          },
        },
        actor,
      )
    } else if (isText) {
      const grade = input.textGrades.get(question.id)
      await recordAiSuggestion(
        {
          ...base,
          rationale:
            grade?.rationale ?? `Free-text answer scored ${awarded[index]} of ${ceilings[index]}.`,
          evidence: hasAnswer ? answerText : undefined,
          confidence: grade?.confidence ?? 0,
          model: grade?.model ?? QUIZ_TEXT_DETERMINISTIC_MODEL,
          promptVersion: QUIZ_TEXT_PROMPT_VERSION,
          latencyMs: grade?.latencyMs ?? 0,
          rawResponse: grade?.raw ?? {
            attemptId: input.attemptId,
            attemptNumber: input.attemptNumber,
            source: grade?.source ?? "unknown",
          },
        },
        actor,
      )
    } else {
      await recordAiSuggestion(
        {
          ...base,
          rationale: `Deterministic auto-scoring: Question ${question.order} answered correctly (${awarded[index]} of ${ceilings[index]}).`,
          evidence: result.selectedText ? `Selected option: "${result.selectedText}"` : undefined,
          confidence: 1,
          model: QUIZ_AUTO_SCORER_MODEL,
          promptVersion: QUIZ_SCORING_PROMPT_VERSION,
          latencyMs: 0,
        },
        actor,
      )
    }
    created += 1
  }

  if (created === 0) {
    // A submission with no scorable answer still needs a review row so the
    // teacher sees it; a single zero-point whole-quiz bucket is the legacy shape.
    await recordAiSuggestion(
      {
        assessmentId: input.assessmentId,
        studentId: input.studentId,
        criterionLabel: QUIZ_ATTEMPT_CRITERION_LABEL,
        suggestedPoints: 0,
        maxPoints: input.maxScore,
        rationale: `Free-text quiz submitted with no scorable answers${input.late ? " (submitted after the deadline)" : ""}.`,
        evidence: "No per-question outcome was recorded for this attempt.",
        confidence: 1,
        model: QUIZ_AUTO_SCORER_MODEL,
        promptVersion: QUIZ_SCORING_PROMPT_VERSION,
        latencyMs: 0,
        rawResponse: {
          attemptId: input.attemptId,
          attemptNumber: input.attemptNumber,
          late: input.late,
        },
      },
      actor,
    )
  }
}
