import { isTextQuestionType } from "@/lib/quiz-scoring"

import { resolveGenerationStatus } from "@/lib/quiz-generation/metadata"

/**
 * Quiz deliverability.
 *
 * There is no assessment-level publish flag on the frozen schema, so "published
 * quiz" is derived from the questions the assessment actually has:
 *
 * - A quiz with no `Question` rows is not deliverable.
 * - A generated question (explicit `Question.status`, or the legacy
 *   `Question.metadata` envelope for rows written before the column existed) is
 *   deliverable only when its state resolves to `"published"`. This reuses the
 *   generation pod's single draft/published marker rather than inventing a
 *   second one.
 * - A question without that envelope is a hand-authored question and is treated
 *   as published (the generation pod's own rule: "a question without this
 *   metadata marker is never treated as a generated draft").
 * - A choice question must have at least two options and exactly one correct
 *   option, because server-side scoring (`lib/quiz-scoring.ts`) needs a single
 *   unambiguous `correctIndex`. A free-text (`SHORT_ANSWER`/`ESSAY`) question
 *   has no options by design and is exempt from the option checks.
 *
 * The result is computed from server rows only. It never depends on a client
 * payload, and it never exposes which option is correct.
 */

export type QuizQuestionAvailability = {
  type?: string | null
  status: string | null
  metadata: unknown
  options: readonly { isCorrect: boolean }[]
}

export type QuizDeliverability = {
  deliverable: boolean
  reason: string | null
}

export function quizDeliveryStatus(
  questions: readonly QuizQuestionAvailability[],
): QuizDeliverability {
  if (questions.length === 0) {
    return { deliverable: false, reason: "This quiz has no questions yet." }
  }

  const draftCount = questions.filter((question) => {
    const status = resolveGenerationStatus(question)
    return status !== null && status !== "published"
  }).length
  if (draftCount > 0) {
    return {
      deliverable: false,
      reason: "This quiz has unpublished draft questions and is not open yet.",
    }
  }

  for (const question of questions) {
    if (isTextQuestionType(question.type)) continue
    if (question.options.length < 2) {
      return { deliverable: false, reason: "This quiz has a question with too few options." }
    }
    const correctCount = question.options.filter((option) => option.isCorrect).length
    if (correctCount !== 1) {
      return {
        deliverable: false,
        reason: "This quiz has a question without exactly one correct answer.",
      }
    }
  }

  return { deliverable: true, reason: null }
}
