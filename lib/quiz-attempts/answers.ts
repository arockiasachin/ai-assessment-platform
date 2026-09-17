import type { QuizAnswer } from "@/lib/contracts/quiz"
import { isTextQuestionType } from "@/lib/quiz-scoring"

import { QuizAttemptError } from "./errors"
import type { QuestionWithOptions } from "./serialize"

/**
 * The per-answer shape rules, in one place.
 *
 * Both the submit path and the draft-save path accept the same `QuizAnswer` shape and must
 * reject the same malformations: a duplicate question, an unknown question, a choice question
 * given prose, a free-text question given a choice, an out-of-range option, an empty text
 * answer. Duplicating the rules would let the two paths drift — a draft that the save accepted
 * but the submit rejected, or worse, one the submit silently mishandled.
 *
 * Throws `QuizAttemptError(400, …)` on the first violation.
 */
export function assertAnswerShapes(
  questions: readonly QuestionWithOptions[],
  answers: readonly QuizAnswer[],
): void {
  const questionById = new Map(questions.map((question) => [question.id, question]))
  const seenAnswers = new Set<string>()
  for (const answer of answers) {
    if (seenAnswers.has(answer.questionId)) {
      throw new QuizAttemptError(400, `Duplicate answer for question ${answer.questionId}.`)
    }
    seenAnswers.add(answer.questionId)
    const question = questionById.get(answer.questionId)
    if (!question) {
      throw new QuizAttemptError(400, `Answer references unknown question ${answer.questionId}.`)
    }
    const isText = isTextQuestionType(question.type)
    const hasText = answer.answerText !== undefined
    const hasChoice = answer.selectedIndex !== null
    if (hasText && hasChoice) {
      throw new QuizAttemptError(
        400,
        `Question ${question.id} accepts either a selected option or a text answer, not both.`,
      )
    }
    if (isText) {
      if (hasChoice) {
        throw new QuizAttemptError(
          400,
          `Question ${question.id} is a free-text question and does not accept a selected option.`,
        )
      }
      if (hasText && answer.answerText!.length === 0) {
        throw new QuizAttemptError(
          400,
          `The text answer for question ${question.id} cannot be empty.`,
        )
      }
    } else {
      if (hasText) {
        throw new QuizAttemptError(
          400,
          `Question ${question.id} is multiple choice and does not accept a text answer.`,
        )
      }
      if (
        hasChoice &&
        (answer.selectedIndex! < 0 || answer.selectedIndex! >= question.options.length)
      ) {
        throw new QuizAttemptError(
          400,
          `Selected option is out of range for question ${question.id}.`,
        )
      }
    }
  }
}
