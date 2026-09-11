import { readGenerationMetadata } from "@/lib/quiz-generation/metadata"

/**
 * Quiz deliverability.
 *
 * There is no assessment-level publish flag on the frozen schema, so "published
 * quiz" is derived from the questions the assessment actually has:
 *
 * - A quiz with no `Question` rows is not deliverable.
 * - A question that carries the quiz-generation envelope
 *   (`Question.metadata.generator === "quiz-generation"`) is deliverable only
 *   when `generationStatus === "published"`. This reuses the generation pod's
 *   draft/published marker rather than inventing a second one.
 * - A question without that envelope is a hand-authored question and is treated
 *   as published (the generation pod's own rule: "a question without this
 *   metadata marker is never treated as a generated draft").
 * - Every question must have at least two options and exactly one correct
 *   option, because server-side scoring (`lib/quiz-scoring.ts`) needs a single
 *   unambiguous `correctIndex`.
 *
 * The result is computed from server rows only. It never depends on a client
 * payload, and it never exposes which option is correct.
 */

export type QuizQuestionAvailability = {
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
    const metadata = readGenerationMetadata(question.metadata)
    return metadata !== null && metadata.generationStatus !== "published"
  }).length
  if (draftCount > 0) {
    return {
      deliverable: false,
      reason: "This quiz has unpublished draft questions and is not open yet.",
    }
  }

  for (const question of questions) {
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
