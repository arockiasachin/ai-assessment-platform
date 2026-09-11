import type { QuizAnswer } from "@/lib/contracts/quiz"
import {
  QuizScoringError,
  scoreQuiz,
  type ScorableQuizQuestion,
  type ScoredQuiz,
} from "@/lib/quiz-scoring"

import { QuizGenerationError } from "./errors"

/**
 * Server-side grading for generated questions.
 *
 * This is the reuse point for the existing server-authoritative grading path:
 * generated `Question` / `QuestionOption` rows are projected into the exact
 * `ScorableQuizQuestion` shape `lib/quiz-scoring.ts` already scores, and
 * `scoreQuiz` derives correctness only from the server-side answer key.
 *
 * Nothing in this module returns an answer key to a client; the caller decides
 * what to disclose (the existing quiz path discloses the correct answer only in
 * the post-submission grading response, per the product spec). There is no
 * client-side correctness logic anywhere in the generation pod.
 */

export type GeneratedQuestionForScoring = {
  id: string
  prompt: string
  explanation: string | null
  options: ReadonlyArray<{ text: string; isCorrect: boolean }>
  /** Optional per-question weight; the kernel falls back to 1 when absent. */
  points?: number
}

export function gradeGeneratedQuiz(
  questions: readonly GeneratedQuestionForScoring[],
  answers: QuizAnswer[],
  maxScore: number,
): ScoredQuiz {
  const scorable: ScorableQuizQuestion[] = questions.map((question) => {
    const correctIndex = question.options.findIndex((option) => option.isCorrect)
    if (correctIndex < 0) {
      throw new QuizGenerationError(
        409,
        `Question ${question.id} has no correct option and cannot be graded.`,
      )
    }
    return {
      id: question.id,
      prompt: question.prompt,
      options: question.options.map((option) => option.text),
      correctIndex,
      explanation: question.explanation,
      points: question.points,
    }
  })

  try {
    return scoreQuiz(scorable, answers, maxScore)
  } catch (error) {
    if (error instanceof QuizScoringError) {
      throw new QuizGenerationError(400, error.message)
    }
    throw error
  }
}
