/**
 * Adaptive retake selection.
 *
 * A retake is not the whole quiz: it contains only the questions the student
 * did not get right on their most recent finalized attempt. A question counts
 * as failed when the student selected an answer and it was wrong. A question
 * with no response, or a response with no graded correctness, is reported
 * separately as "unanswered" and is included by default (`includeUnanswered`),
 * because a student who ran out of time still needs to practise it. Passing
 * `includeUnanswered: false` restricts the retake to genuinely wrong answers.
 *
 * This module only chooses question ids. The service serializes the chosen
 * questions with the existing student-facing serializer, which carries no
 * answer key, so a retake can never leak the correct option.
 */

export type RetakeResponseInput = {
  questionId: string
  /** `null` means unanswered / not graded. */
  isCorrect: boolean | null
}

export type AdaptiveRetakeSelection = {
  /** Ids to include, in the quiz's question order. */
  questionIds: string[]
  /** Questions answered incorrectly. */
  failedQuestionIds: string[]
  /** Questions with no response or no graded correctness. */
  unansweredQuestionIds: string[]
  totalQuestions: number
  includeUnanswered: boolean
}

export type AdaptiveRetakeInput = {
  /** Every question id on the assessment, in display order. */
  questionIds: readonly string[]
  /** The student's responses on their latest finalized attempt. */
  responses: readonly RetakeResponseInput[]
  /** Include unanswered questions in the retake. Defaults to `true`. */
  includeUnanswered?: boolean
}

export function selectAdaptiveRetakeQuestions(input: AdaptiveRetakeInput): AdaptiveRetakeSelection {
  const includeUnanswered = input.includeUnanswered ?? true
  const byQuestion = new Map(input.responses.map((response) => [response.questionId, response]))

  const failedQuestionIds: string[] = []
  const unansweredQuestionIds: string[] = []
  const questionIds: string[] = []

  for (const questionId of input.questionIds) {
    const response = byQuestion.get(questionId)
    const isFailed = response?.isCorrect === false
    const isUnanswered = !response || response.isCorrect === null

    if (isFailed) {
      failedQuestionIds.push(questionId)
      questionIds.push(questionId)
    } else if (isUnanswered) {
      unansweredQuestionIds.push(questionId)
      if (includeUnanswered) questionIds.push(questionId)
    }
  }

  return {
    questionIds,
    failedQuestionIds,
    unansweredQuestionIds,
    totalQuestions: input.questionIds.length,
    includeUnanswered,
  }
}
